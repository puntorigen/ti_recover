import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createCipheriv } from "node:crypto";
import {
  decodeJavaInt,
  parseRanges,
  parseAssetBuffer,
  detectAlloy,
  decryptRange,
  decryptRanges,
} from "../src/decrypt.js";
import type { DexRange } from "../src/dex.js";
import type { MemorySource } from "../src/types.js";

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));
const smali = readFileSync(`${fixturesDir}/AssetCryptImpl.smali`, "utf8");
const javaSrc = readFileSync(`${fixturesDir}/AssetCryptImpl.java`, "utf8");

describe("decodeJavaInt", () => {
  it("decodes decimal, hex and octal literals like Integer.decode", () => {
    expect(decodeJavaInt("128")).toBe(128);
    expect(decodeJavaInt("0x10")).toBe(16);
    expect(decodeJavaInt("0X1F")).toBe(31);
    expect(decodeJavaInt("#ff")).toBe(255);
    expect(decodeJavaInt("010")).toBe(8);
    expect(decodeJavaInt("-0x10")).toBe(-16);
    expect(decodeJavaInt("  42 ")).toBe(42);
    expect(decodeJavaInt("0")).toBe(0);
  });
});

describe("parseRanges", () => {
  it("parses hashMap.put ranges (decimal and hex offsets)", () => {
    const ranges = parseRanges(javaSrc);
    expect(ranges["app.js"]).toEqual({ offset: 0, bytes: 128 });
    expect(ranges["alloy.js"]).toEqual({ offset: 128, bytes: 64 });
    expect(ranges["ui/index.js"]).toEqual({ offset: 192, bytes: 256 });
  });

  it("preserves insertion order", () => {
    const ranges = parseRanges(javaSrc);
    expect(Object.keys(ranges)).toEqual(["app.js", "alloy.js", "ui/index.js"]);
  });

  it("returns an empty object when there are no ranges", () => {
    expect(parseRanges("no ranges here")).toEqual({});
  });
});

describe("parseAssetBuffer", () => {
  it("parses buffer length, version and concatenated literal from smali", () => {
    const parsed = parseAssetBuffer(smali);
    expect(parsed.titaniumVersion).toBe("5.x");
    expect(parsed.bufferLen).toBe(0x40);
    expect(parsed.escaped).toBe("hello\\nworld");
  });

  it("detects Titanium < v5 via the plain const opcode", () => {
    const legacy = [
      ".method private static initAssetsBytes()Ljava/nio/CharBuffer;",
      "    const v0, 0x20",
      '    const-string v1, "abc"',
      "    invoke-virtual {v0}, Ljava/nio/CharBuffer;->rewind()Ljava/nio/Buffer;",
      ".end method",
    ].join("\n");
    const parsed = parseAssetBuffer(legacy);
    expect(parsed.titaniumVersion).toBe("<5");
    expect(parsed.bufferLen).toBe(0x20);
    expect(parsed.escaped).toBe("abc");
  });

  it("ignores content before initAssetsBytes starts", () => {
    const parsed = parseAssetBuffer('const-string v1, "ignored"\n' + smali);
    expect(parsed.escaped).toBe("hello\\nworld");
  });
});

describe("detectAlloy", () => {
  it("flags projects containing alloy artifacts", () => {
    const alloy: MemorySource = {
      "alloy.js": { offset: 0, bytes: 1, content: "" },
      "app.js": { offset: 0, bytes: 1, content: "" },
    };
    expect(detectAlloy(alloy)).toBe(true);
  });

  it("returns false for classic projects", () => {
    const classic: MemorySource = {
      "app.js": { offset: 0, bytes: 1, content: "" },
      "ui/index.js": { offset: 0, bytes: 1, content: "" },
    };
    expect(detectAlloy(classic)).toBe(false);
  });
});

// A fixed key keeps the round-trip deterministic (avoids the tiny chance of a
// wrong-key fallback attempt producing valid PKCS padding by luck).
const KEY = Buffer.from("Titanium!Key0123", "latin1");

function aesEcb(content: string, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(Buffer.from(content, "utf8")), cipher.final()]);
}

interface Built {
  blob: Buffer;
  ranges: DexRange[];
  sources: Record<string, string>;
}

/**
 * Builds an encrypted asset blob the way Titanium does: each file's ciphertext
 * is concatenated and the 16-byte AES key is appended.
 * `trailingByte` appends an extra byte (exercises the `length - 1` key path);
 * `leadingByte` prepends a byte and reports padded offsets (`offset - 1` path).
 */
function buildBlob(
  sources: Record<string, string>,
  { trailingByte = false, leadingByte = false } = {},
): Built {
  const ranges: DexRange[] = [];
  const parts: Buffer[] = [];
  let offset = leadingByte ? 1 : 0;
  if (leadingByte) parts.push(Buffer.from([0x00]));
  for (const [file, content] of Object.entries(sources)) {
    const enc = aesEcb(content, KEY);
    parts.push(enc);
    ranges.push({ file, offset: leadingByte ? offset + 1 : offset, bytes: enc.length });
    offset += enc.length;
  }
  parts.push(KEY);
  if (trailingByte) parts.push(Buffer.from([0x00]));
  return { blob: Buffer.concat(parts), ranges, sources };
}

describe("decryptRange", () => {
  it("recovers a slice with the key as the last 16 bytes (offset exact)", () => {
    const { blob, ranges } = buildBlob({ "app.js": "Ti.API.info('hi');\n" });
    const r = ranges[0]!;
    expect(decryptRange(blob, r.offset, r.bytes)).toBe("Ti.API.info('hi');\n");
  });

  it("recovers with the older length-1 key convention (trailing byte)", () => {
    const { blob, ranges } = buildBlob({ "x.js": "var a = 1;\n" }, { trailingByte: true });
    const r = ranges[0]!;
    expect(decryptRange(blob, r.offset, r.bytes)).toBe("var a = 1;\n");
  });

  it("recovers with a padded offset (offset-1 fallback)", () => {
    const { blob, ranges } = buildBlob({ "y.js": "module.exports = {};\n" }, { leadingByte: true });
    const r = ranges[0]!;
    expect(decryptRange(blob, r.offset, r.bytes)).toBe("module.exports = {};\n");
  });

  it("returns null when nothing decrypts cleanly", () => {
    const junk = Buffer.alloc(64, 0x7);
    expect(decryptRange(junk, 0, 16)).toBeNull();
  });
});

describe("decryptRanges", () => {
  it("decrypts every file and sums the byte total", () => {
    const sources = {
      "app.js": "Ti.UI.createWindow().open();\n",
      "alloy.js": "var Alloy = require('alloy');\n",
      "ui/index.js": "exports.render = function () {};\n",
    };
    const { blob, ranges } = buildBlob(sources);
    const { files, totalBytes } = decryptRanges(blob, ranges);

    expect(Object.keys(files)).toEqual(["app.js", "alloy.js", "ui/index.js"]);
    for (const [name, content] of Object.entries(sources)) {
      expect(files[name]?.content).toBe(content);
    }
    expect(totalBytes).toBe(ranges.reduce((sum, r) => sum + r.bytes, 0));
  });

  it("skips out-of-bounds ranges rather than throwing", () => {
    const { blob, ranges } = buildBlob({ "ok.js": "1;\n" });
    // An offset past the end of the blob can never decrypt (every fallback
    // slice is out of bounds), so the file is skipped, not thrown on.
    const withBad: DexRange[] = [...ranges, { file: "bad.js", offset: blob.length + 100, bytes: 16 }];
    const { files } = decryptRanges(blob, withBad);
    expect(files["ok.js"]?.content).toBe("1;\n");
    expect(files["bad.js"]).toBeUndefined();
  });
});
