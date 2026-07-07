/**
 * Decrypt Titanium's asset blob with pure Node crypto (no JVM).
 *
 * Distribution-mode Titanium stores every source file as one AES-encrypted
 * blob; the AES key is the last 16 bytes of that blob and each file occupies an
 * `[offset, length]` range within it. Java's default `Cipher.getInstance("AES")`
 * is `AES/ECB/PKCS5Padding`, which maps directly to Node's `aes-128-ecb` with
 * automatic PKCS padding.
 *
 * The blob and ranges now come from {@link readAssetCrypt} (DEX parsing). The
 * smali/java text parsers below (`parseAssetBuffer`, `parseRanges`,
 * `decodeJavaInt`) are retained as standalone helpers for callers working from
 * decompiled sources, but are no longer on the main recovery path.
 */
import { createDecipheriv } from "node:crypto";
import type { DexRange } from "./dex.js";
import type { MemorySource, TitaniumVersion } from "./types.js";

/** A single file's location inside the decrypted asset blob. */
export interface Range {
  offset: number;
  bytes: number;
}

/** Result of parsing `AssetCryptImpl.smali`'s `initAssetsBytes()`. */
export interface AssetBufferParse {
  titaniumVersion: TitaniumVersion;
  bufferLen: number;
  escaped: string;
}

/**
 * Decodes an integer literal the way `java.lang.Integer.decode` does:
 * supports optional sign, `0x`/`0X`/`#` hex, leading-zero octal, and decimal.
 */
export function decodeJavaInt(literal: string): number {
  let s = literal.trim();
  let sign = 1;
  if (s.startsWith("+")) {
    s = s.slice(1);
  } else if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  }
  let value: number;
  if (s.startsWith("0x") || s.startsWith("0X")) {
    value = parseInt(s.slice(2), 16);
  } else if (s.startsWith("#")) {
    value = parseInt(s.slice(1), 16);
  } else if (s.length > 1 && s.startsWith("0")) {
    value = parseInt(s.slice(1), 8);
  } else {
    value = parseInt(s, 10);
  }
  return sign * value;
}

/**
 * Parses the `hashMap.put("file", new Range(offset, length))` entries from an
 * `AssetCryptImpl.java` source into an ordered map of file -> range.
 */
export function parseRanges(javaContent: string): Record<string, Range> {
  const ranges: Record<string, Range> = {};
  const re =
    /hashMap\.put\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*new Range\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(javaContent)) !== null) {
    const file = match[1];
    const offset = match[2];
    const length = match[3];
    if (file === undefined || offset === undefined || length === undefined) continue;
    ranges[file] = {
      offset: decodeJavaInt(offset),
      bytes: decodeJavaInt(length),
    };
  }
  return ranges;
}

/**
 * Parses `AssetCryptImpl.smali`, extracting the declared buffer length, the
 * concatenated escaped string literal and a coarse Titanium version.
 */
export function parseAssetBuffer(smaliContent: string): AssetBufferParse {
  const lines = smaliContent.split(/\r?\n/);
  let started = false;
  let titaniumVersion: TitaniumVersion = "unknown";
  let bufferLen = -1;
  const chunks: string[] = [];

  for (const line of lines) {
    if (line.indexOf("private static initAssetsBytes()Ljava/nio/CharBuffer") !== -1) {
      started = true;
      continue;
    }
    if (!started) continue;

    if (line.indexOf("const v0, ") !== -1) {
      titaniumVersion = "<5";
      bufferLen = decodeJavaInt(line.split("const v0, ").join("").trim());
    } else if (line.indexOf("const/16 v0, ") !== -1) {
      titaniumVersion = "5.x";
      bufferLen = decodeJavaInt(line.split("const/16 v0, ").join("").trim());
    } else if (line.indexOf("const-string v1") !== -1) {
      let content = line.split('const-string v1, "').join("").trim();
      content = content.slice(0, -1);
      chunks.push(content);
    } else if (line.indexOf("rewind()Ljava/nio/Buffer;") !== -1) {
      break;
    }
  }

  return { titaniumVersion, bufferLen, escaped: chunks.join("") };
}

/** Heuristic: does the recovered file set look like an Alloy project? */
export function detectAlloy(files: MemorySource): boolean {
  return Object.keys(files).some(
    (name) =>
      name === "alloy.js" ||
      name.startsWith("alloy/") ||
      name.includes("/alloy/") ||
      name === "_app_props_.json",
  );
}

const KEY_LEN = 16;

/**
 * Decrypts one `[offset, length]` slice of the blob. The key is the last 16
 * bytes of the blob. Titanium varied two conventions across versions, so we try
 * the key derived from both `length` and `length - 1`, and the slice from both
 * `offset` and `offset - 1` (some files have a padded offset).
 */
export function decryptRange(blob: Buffer, offset: number, length: number): string | null {
  for (const total of [blob.length - 1, blob.length]) {
    if (total - KEY_LEN < 0) continue;
    const key = blob.subarray(total - KEY_LEN, total);
    for (const start of [offset, offset - 1]) {
      if (start < 0 || start + length > blob.length) continue;
      try {
        const decipher = createDecipheriv("aes-128-ecb", key, null);
        decipher.setAutoPadding(true);
        const out = Buffer.concat([
          decipher.update(blob.subarray(start, start + length)),
          decipher.final(),
        ]);
        const text = out.toString("utf8");
        if (text !== "") return text;
      } catch {
        // try the next key/offset combination
      }
    }
  }
  return null;
}

export interface DecryptRangesResult {
  files: MemorySource;
  totalBytes: number;
}

/**
 * Decrypts every range out of the blob into an in-memory source map. Files that
 * fail to decrypt are skipped rather than aborting the whole run.
 */
export function decryptRanges(
  blob: Buffer,
  ranges: DexRange[],
  debug = false,
): DecryptRangesResult {
  const files: MemorySource = {};
  let totalBytes = 0;
  for (const range of ranges) {
    const content = decryptRange(blob, range.offset, range.bytes);
    if (content === null) continue;
    files[range.file] = { offset: range.offset, bytes: range.bytes, content };
    totalBytes += range.bytes;
    if (debug) console.log(`file:${range.file}, decrypted !`);
  }
  return { files, totalBytes };
}
