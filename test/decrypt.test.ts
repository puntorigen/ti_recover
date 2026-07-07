import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  decodeJavaInt,
  parseRanges,
  parseAssetBuffer,
  detectAlloy,
} from "../src/decrypt.js";
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
