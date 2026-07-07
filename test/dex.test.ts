import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DexFile } from "libdex-ts";
import {
  extractStringChunks,
  extractRanges,
  instructionWidth,
  readAssetCrypt,
} from "../src/dex.js";
import { decryptRanges } from "../src/decrypt.js";

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));

// ---------------------------------------------------------------------------
// A tiny mock exposing only the DexFile methods the scanner calls.
// ---------------------------------------------------------------------------
function mockDex(opts: {
  strings: string[];
  types?: string[];
  methodIds?: { classIdx: number; nameIdx: number }[];
}): DexFile {
  const { strings, types = [], methodIds = [] } = opts;
  return {
    getStringById: (i: number) => strings[i],
    getTypeDescriptorByIdx: (i: number) => types[i],
    getMethodId: (i: number) => methodIds[i],
  } as unknown as DexFile;
}

const insns = (...units: number[]): Uint16Array => Uint16Array.from(units);

// Instruction encoders (little pieces of DEX bytecode).
const constString = (reg: number, s: number) => [((reg & 0xff) << 8) | 0x1a, s & 0xffff];
const constStringJumbo = (reg: number, s: number) => [
  ((reg & 0xff) << 8) | 0x1b,
  s & 0xffff,
  (s >>> 16) & 0xffff,
];
const const16 = (reg: number, v: number) => [((reg & 0xff) << 8) | 0x13, v & 0xffff];
const const31i = (reg: number, v: number) => [
  ((reg & 0xff) << 8) | 0x14,
  v & 0xffff,
  (v >>> 16) & 0xffff,
];
const newInstance = (reg: number, type: number) => [((reg & 0xff) << 8) | 0x22, type & 0xffff];
const invoke35c = (op: number, args: number[], methodIdx: number) => {
  const [c = 0, d = 0, e = 0, f = 0, g = 0] = args;
  return [(args.length << 12) | (g << 8) | op, methodIdx & 0xffff, (f << 12) | (e << 8) | (d << 4) | c];
};

describe("instructionWidth", () => {
  it("returns the correct code-unit width per opcode", () => {
    expect(instructionWidth(insns(0x0000), 0)).toBe(1); // nop
    expect(instructionWidth(insns(0x0012), 0)).toBe(1); // const/4 (11n)
    expect(instructionWidth(insns(0x001a, 0), 0)).toBe(2); // const-string (21c)
    expect(instructionWidth(insns(0x0014, 0, 0), 0)).toBe(3); // const (31i)
    expect(instructionWidth(insns(0x006e, 0, 0), 0)).toBe(3); // invoke-virtual (35c)
    expect(instructionWidth(insns(0x0018, 0, 0, 0, 0), 0)).toBe(5); // const-wide (51l)
  });

  it("computes payload widths", () => {
    // packed-switch-payload: size=3 -> 3*2 + 4 = 10
    expect(instructionWidth(insns(0x0100, 3), 0)).toBe(10);
    // fill-array-data-payload: elWidth=1, size=4 -> 4 + ceil(4/2) = 6
    expect(instructionWidth(insns(0x0300, 1, 4, 0), 0)).toBe(6);
  });
});

describe("extractStringChunks", () => {
  it("collects const-string / const-string/jumbo operands in order", () => {
    const dex = mockDex({ strings: ["", "AB", "CD", "EF"] });
    const code = insns(
      ...const16(0, 100), // CharBuffer.allocate size (skipped)
      ...constString(1, 1),
      ...invoke35c(0x6e, [0, 1], 5), // append() noise, must be stepped over
      ...constString(1, 2),
      ...constStringJumbo(2, 3),
    );
    expect(extractStringChunks(dex, code)).toEqual(["AB", "CD", "EF"]);
  });
});

describe("extractRanges", () => {
  it("recovers (file, offset, length) triples from put/new-Range patterns", () => {
    const dex = mockDex({
      strings: ["", "", "", "", "", "", "app.js", "alloy.js", "<init>", "put"],
      types: ["Lcom/x/AssetCryptImpl$Range;", "Ljava/util/HashMap;"],
      methodIds: [
        { classIdx: 0, nameIdx: 8 }, // Range.<init>
        { classIdx: 1, nameIdx: 9 }, // HashMap.put
      ],
    });
    const code = insns(
      // entry 1: app.js -> {0, 128}
      ...constString(0, 6),
      ...newInstance(1, 0),
      ...const16(2, 0),
      ...const16(3, 128),
      ...invoke35c(0x70, [1, 2, 3], 0), // Range.<init>(off, len)
      ...invoke35c(0x6e, [5, 0, 1], 1), // map.put(key, range)
      // entry 2: alloy.js -> {65536, 32} (const 31i offset + jumbo key)
      ...constStringJumbo(0, 7),
      ...newInstance(1, 0),
      ...const31i(2, 65536),
      ...const16(3, 32),
      ...invoke35c(0x70, [1, 2, 3], 0),
      ...invoke35c(0x6e, [5, 0, 1], 1),
    );
    expect(extractRanges(dex, code)).toEqual([
      { file: "app.js", offset: 0, bytes: 128 },
      { file: "alloy.js", offset: 65536, bytes: 32 },
    ]);
  });

  it("ignores puts whose value register is not a Range", () => {
    const dex = mockDex({
      strings: ["", "", "", "", "", "", "app.js", "", "<init>", "put"],
      types: ["Ljava/lang/Object;", "Ljava/util/HashMap;"],
      methodIds: [
        { classIdx: 0, nameIdx: 8 }, // Object.<init> (not a Range)
        { classIdx: 1, nameIdx: 9 },
      ],
    });
    const code = insns(
      ...constString(0, 6),
      ...newInstance(1, 0),
      ...const16(2, 0),
      ...const16(3, 128),
      ...invoke35c(0x70, [1, 2, 3], 0),
      ...invoke35c(0x6e, [5, 0, 1], 1),
    );
    expect(extractRanges(dex, code)).toEqual([]);
  });
});

// Full distribution pipeline against a REAL DEX (compiled from an old-scheme
// AssetCryptImpl via javac + d8; see gen-dex.mjs). Exercises the actual
// libdex-ts parse path, blob/range extraction and node:crypto decryption.
describe("readAssetCrypt + decryptRanges (real assetcrypt.dex)", () => {
  const expected = JSON.parse(readFileSync(`${fixturesDir}/assetcrypt.expected.json`, "utf8"));
  const dex = readFileSync(`${fixturesDir}/assetcrypt.dex`);

  it("locates AssetCryptImpl and extracts the exact blob + ranges", () => {
    const result = readAssetCrypt([dex], expected.package);
    expect(result.kind).toBe("classic");
    if (result.kind !== "classic") return;
    expect(result.data.blob.length).toBe(expected.blobLength);
    expect(result.data.ranges).toEqual(expected.ranges);
  });

  it("decrypts every source file back to its original contents", () => {
    const result = readAssetCrypt([dex]); // no package hint -> falls back to scan
    expect(result.kind).toBe("classic");
    if (result.kind !== "classic") return;
    const { files } = decryptRanges(result.data.blob, result.data.ranges);
    for (const [name, content] of Object.entries(expected.sources)) {
      expect(files[name]?.content).toBe(content);
    }
  });
});

// Real-APK integration slot: drop a `classes.dex` from a distribution-mode
// Titanium APK into test/fixtures/ to exercise extraction against a real app.
const realDex = `${fixturesDir}/classes.dex`;
const hasRealDex = existsSync(realDex);

(hasRealDex ? describe : describe.skip)("readAssetCrypt (real classes.dex)", () => {
  it("locates AssetCryptImpl and extracts blob + ranges", () => {
    const result = readAssetCrypt([readFileSync(realDex)]);
    expect(["classic", "newscheme"]).toContain(result.kind);
    if (result.kind === "classic") {
      expect(result.data.blob.length).toBeGreaterThan(16);
      expect(result.data.ranges.length).toBeGreaterThan(0);
    }
  });
});
