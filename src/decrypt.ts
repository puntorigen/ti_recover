/**
 * Recover Titanium's encrypted JavaScript assets.
 *
 * A distribution-mode Titanium APK stores every JS/JSON/etc. source file as a
 * single AES-encrypted blob. Two generated Java classes describe how to rebuild
 * it:
 *
 *  - `AssetCryptImpl.smali` contains `initAssetsBytes()` which concatenates a
 *    (Java-escaped) string literal that, once ISO-8859-1 encoded, is the raw
 *    encrypted byte buffer. The AES key is the last 16 bytes of that buffer.
 *  - `AssetCryptImpl.java` contains a `hashMap.put("file", new Range(off, len))`
 *    entry per source file describing where that file lives inside the blob.
 *
 * The parsing of both files is implemented as pure functions (unit-tested
 * without a JVM). Only the AES step still uses the bundled `java` bridge; that
 * will move to `node:crypto` in Phase 2.
 */
import { readFile } from "node:fs/promises";
import { getJava } from "./java.js";
import type { DecryptMeta, DecryptResult, MemorySource, TitaniumVersion } from "./types.js";

/** A single file's location inside the decrypted asset blob. */
export interface Range {
  offset: number;
  bytes: number;
}

/** Result of parsing `AssetCryptImpl.smali`'s `initAssetsBytes()`. */
export interface AssetBufferParse {
  /** Coarse engine version bucket derived from the smali const opcode. */
  titaniumVersion: TitaniumVersion;
  /** Declared CharBuffer length, or -1 when not found. */
  bufferLen: number;
  /** Concatenated, still Java-escaped string literal. */
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
      // Titanium < v5
      titaniumVersion = "<5";
      bufferLen = decodeJavaInt(line.split("const v0, ").join("").trim());
    } else if (line.indexOf("const/16 v0, ") !== -1) {
      // Titanium v5.x +
      titaniumVersion = "5.x";
      bufferLen = decodeJavaInt(line.split("const/16 v0, ").join("").trim());
    } else if (line.indexOf("const-string v1") !== -1) {
      let content = line.split('const-string v1, "').join("").trim();
      content = content.slice(0, -1); // drop the trailing quote
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

export interface DecryptOptions {
  smaliPath: string;
  javaPath: string;
  debug?: boolean;
}

/**
 * Reads and decrypts the Titanium asset blob described by the given
 * `AssetCryptImpl` smali + java files. Requires the native `java` bridge.
 */
export async function decryptAssets(options: DecryptOptions): Promise<DecryptResult> {
  const { smaliPath, javaPath, debug = false } = options;
  const log = (msg: string) => {
    if (debug) console.log(msg);
  };

  const [smaliContent, javaContent] = await Promise.all([
    readFile(smaliPath, "utf8"),
    readFile(javaPath, "utf8"),
  ]);

  const parsed = parseAssetBuffer(smaliContent);
  const ranges = parseRanges(javaContent);

  const java = getJava();
  const Charset = java.import("java.nio.charset.Charset");
  const CharBuffer = java.import("java.nio.CharBuffer");
  const StringEscapeUtils = java.import("org.apache.commons.lang.StringEscapeUtils");

  log("decoding bytes ...");
  const unescaped: string = StringEscapeUtils.unescapeJavaSync(parsed.escaped);
  const bufferLen = parsed.bufferLen > 0 ? parsed.bufferLen : unescaped.length;
  const charBuffer = CharBuffer.allocateSync(bufferLen);
  charBuffer.appendSync(unescaped);
  charBuffer.rewindSync();

  log("converting into java array of bytes ... takes some time");
  const assetBytes: number[] = Charset.forNameSync("ISO-8859-1")
    .encodeSync(charBuffer)
    .arraySync();
  const boxedBytes = assetBytes.map((b) => java.newByte(b));
  const byteArray = java.newArray("byte", boxedBytes);

  log("extracting file ranges ...");
  const files: MemorySource = {};
  let totalBytes = 0;
  for (const [file, range] of Object.entries(ranges)) {
    try {
      const content = decryptRange(java, byteArray, range.offset, range.bytes);
      files[file] = { offset: range.offset, bytes: range.bytes, content };
      totalBytes += range.bytes;
      if (content !== "") log(`file:${file}, decrypted !`);
    } catch {
      // Skip files that fail to decrypt rather than aborting the whole run.
    }
  }

  const meta: DecryptMeta = {
    totalBytes,
    titaniumVersion: parsed.titaniumVersion,
    alloy: detectAlloy(files),
  };

  return { files, meta };
}

/**
 * Decrypts a single [offset, length] slice of the AES blob. The key is the last
 * 16 bytes of the buffer. Two attempts cover the two key-offset conventions
 * Titanium used across versions (<= 3.4.0 uses length-1, later uses length).
 */
function decryptRange(java: any, bytes: any, offset: number, length: number): string {
  const SecretKeySpec = java.import("javax.crypto.spec.SecretKeySpec");
  const Cipher = java.import("javax.crypto.Cipher");
  const DECRYPT_MODE = 2;
  const keyLen = 0x10;

  const attempt = (bytesLen: number): string => {
    const key = new SecretKeySpec(bytes, bytesLen - keyLen, keyLen, "AES");
    const cipher = Cipher.getInstanceSync("AES");
    cipher.initSync(DECRYPT_MODE, key);
    let decrypted: number[];
    try {
      decrypted = cipher.doFinalSync(bytes, offset, length);
    } catch {
      // Some files have a padded offset.
      decrypted = cipher.doFinalSync(bytes, offset - 1, length);
    }
    return String.fromCharCode.apply(null, Array.from(new Uint16Array(decrypted)));
  };

  const totalLen = bytes.length;
  // FIRST ATTEMPT - Titanium below 3.2.2 / 3.4.0 (key derived from length - 1).
  try {
    const result = attempt(totalLen - 1);
    if (result !== "") return result;
  } catch {
    // fall through to second attempt
  }
  // SECOND ATTEMPT - Titanium over v3.4.0.
  try {
    return attempt(totalLen);
  } catch {
    return "";
  }
}
