/**
 * Extract Titanium's encrypted asset data directly from `classes*.dex`,
 * replacing the apktool (smali) + jadx (java) decompile step.
 *
 * The generated `AssetCryptImpl` class has two private static methods:
 *  - `initAssetsBytes()` builds the encrypted blob by appending a sequence of
 *    `const-string` literals into a CharBuffer.
 *  - `initAssets()` fills a HashMap with `put("file", new Range(offset, length))`
 *    entries.
 *
 * Both are ordinary DEX bytecode. We locate the class, then walk each method's
 * instruction stream: for the blob we collect `const-string`/`const-string/jumbo`
 * operands in order; for the ranges we do a tiny register trace to recover the
 * (file, offset, length) triples. A DEX instruction width table lets us step
 * over every opcode correctly. Since DEX stores real (already-unescaped)
 * strings, the old Java string-unescape step is gone entirely.
 */
import { DexFile, type DexClassDef, type DexCode } from "libdex-ts";
import type { TitaniumVersion } from "./types.js";

/** A single file's location inside the decrypted blob, from `initAssets`. */
export interface DexRange {
  file: string;
  offset: number;
  bytes: number;
}

export interface AssetCrypt {
  /** The raw encrypted asset blob (last 16 bytes are the AES key). */
  blob: Buffer;
  ranges: DexRange[];
  titaniumVersion: TitaniumVersion;
}

export type AssetCryptResult =
  | { kind: "classic"; data: AssetCrypt }
  | { kind: "newscheme" } // AssetCryptImpl present but the ti.cloak/.bin variant
  | { kind: "none" };

// ---------------------------------------------------------------------------
// DEX instruction widths (in 16-bit code units), indexed by base opcode.
// Derived from the Dalvik bytecode instruction formats.
// ---------------------------------------------------------------------------
const WIDTHS = buildWidthTable();

function buildWidthTable(): Uint8Array {
  const w = new Uint8Array(256).fill(1);
  const set = (from: number, to: number, units: number) => {
    for (let op = from; op <= to; op++) w[op] = units;
  };
  // 2-code-unit instructions
  set(0x02, 0x03, 2); // move/from16, move/16 (0x03 is 3 -> fixed below)
  w[0x03] = 3;
  set(0x05, 0x06, 2);
  w[0x06] = 3;
  set(0x08, 0x09, 2);
  w[0x09] = 3;
  w[0x13] = 2; // const/16
  w[0x14] = 3; // const
  w[0x15] = 2; // const/high16
  w[0x16] = 2; // const-wide/16
  w[0x17] = 3; // const-wide/32
  w[0x18] = 5; // const-wide
  w[0x19] = 2; // const-wide/high16
  w[0x1a] = 2; // const-string
  w[0x1b] = 3; // const-string/jumbo
  w[0x1c] = 2; // const-class
  w[0x1f] = 2; // check-cast
  w[0x20] = 2; // instance-of
  w[0x22] = 2; // new-instance
  w[0x23] = 2; // new-array
  w[0x24] = 3; // filled-new-array (35c)
  w[0x25] = 3; // filled-new-array/range (3rc)
  w[0x26] = 3; // fill-array-data (31t)
  w[0x29] = 2; // goto/16
  w[0x2a] = 3; // goto/32
  w[0x2b] = 3; // packed-switch
  w[0x2c] = 3; // sparse-switch
  set(0x2d, 0x31, 2); // cmpkind (23x)
  set(0x32, 0x37, 2); // if-test (22t)
  set(0x38, 0x3d, 2); // if-testz (21t)
  set(0x44, 0x51, 2); // aget/aput (23x)
  set(0x52, 0x5f, 2); // iget/iput (22c)
  set(0x60, 0x6d, 2); // sget/sput (21c)
  set(0x6e, 0x72, 3); // invoke-kind (35c)
  set(0x74, 0x78, 3); // invoke-kind/range (3rc)
  set(0x90, 0xaf, 2); // binop (23x)
  set(0xd0, 0xd7, 2); // binop/lit16 (22s)
  set(0xd8, 0xe2, 2); // binop/lit8 (22b)
  w[0xfa] = 4; // invoke-polymorphic (45cc)
  w[0xfb] = 4; // invoke-polymorphic/range (4rcc)
  w[0xfc] = 3; // invoke-custom (35c)
  w[0xfd] = 3; // invoke-custom/range (3rc)
  w[0xfe] = 2; // const-method-handle
  w[0xff] = 2; // const-method-type
  return w;
}

/** Width, in code units, of the instruction at `idx` (handles payloads). */
export function instructionWidth(insns: Uint16Array, idx: number): number {
  const unit = insns[idx] ?? 0;
  const op = unit & 0xff;
  if (op === 0x00 && unit !== 0x0000) {
    // Pseudo-op payload tables.
    switch (unit) {
      case 0x0100: {
        // packed-switch-payload: ident + size + first_key(2) + targets(size*2)
        const size = insns[idx + 1] ?? 0;
        return size * 2 + 4;
      }
      case 0x0200: {
        // sparse-switch-payload: ident + size + keys(size*2) + targets(size*2)
        const size = insns[idx + 1] ?? 0;
        return size * 4 + 2;
      }
      case 0x0300: {
        // fill-array-data-payload
        const elementWidth = insns[idx + 1] ?? 0;
        const size = (insns[idx + 2] ?? 0) + (insns[idx + 3] ?? 0) * 0x10000;
        return 4 + Math.ceil((size * elementWidth) / 2);
      }
      default:
        return 1;
    }
  }
  return WIDTHS[op] ?? 1;
}

const s16 = (v: number): number => (v > 0x7fff ? v - 0x10000 : v);

/** Collects `const-string` operands from a method in execution order. */
export function extractStringChunks(dex: DexFile, insns: Uint16Array): string[] {
  const chunks: string[] = [];
  let idx = 0;
  while (idx < insns.length) {
    const unit = insns[idx] ?? 0;
    const op = unit & 0xff;
    if (op === 0x1a) {
      chunks.push(dex.getStringById(insns[idx + 1] ?? 0));
    } else if (op === 0x1b) {
      chunks.push(dex.getStringById((insns[idx + 1] ?? 0) + (insns[idx + 2] ?? 0) * 0x10000));
    }
    idx += instructionWidth(insns, idx);
  }
  return chunks;
}

/**
 * Walks `initAssets` with a small register trace to recover the file ranges.
 * Tracks integer/string constants per register, associates `new Range(off,len)`
 * with the object register at its `<init>`, and emits an entry when that object
 * is stored into the map via `put(key, rangeObj)`.
 */
export function extractRanges(dex: DexFile, insns: Uint16Array): DexRange[] {
  const regInt = new Map<number, number>();
  const regStr = new Map<number, string>();
  const pending = new Map<number, { offset: number; length: number }>();
  const ranges: DexRange[] = [];

  const resolveInvoke = (methodIdx: number, args: number[]): void => {
    const mid = dex.getMethodId(methodIdx);
    const cls = dex.getTypeDescriptorByIdx(mid.classIdx);
    const name = dex.getStringById(mid.nameIdx);
    if (name === "<init>" && /[/$]Range;$/.test(cls) && args.length >= 3) {
      const offset = regInt.get(args[1]!);
      const length = regInt.get(args[2]!);
      if (offset !== undefined && length !== undefined) {
        pending.set(args[0]!, { offset, length });
      }
    } else if (name === "put" && args.length >= 3) {
      const key = regStr.get(args[1]!);
      const range = pending.get(args[2]!);
      if (key !== undefined && range) {
        ranges.push({ file: key, offset: range.offset, bytes: range.length });
      }
    }
  };

  let idx = 0;
  while (idx < insns.length) {
    const unit = insns[idx] ?? 0;
    const op = unit & 0xff;
    switch (op) {
      case 0x12: {
        // const/4 (11n)
        const a = (unit >> 8) & 0xf;
        let v = (unit >> 12) & 0xf;
        if (v > 7) v -= 16;
        regInt.set(a, v);
        break;
      }
      case 0x13: {
        // const/16 (21s)
        regInt.set((unit >> 8) & 0xff, s16(insns[idx + 1] ?? 0));
        break;
      }
      case 0x14: {
        // const (31i)
        const v = ((insns[idx + 1] ?? 0) | ((insns[idx + 2] ?? 0) << 16)) | 0;
        regInt.set((unit >> 8) & 0xff, v);
        break;
      }
      case 0x15: {
        // const/high16 (21h)
        regInt.set((unit >> 8) & 0xff, ((insns[idx + 1] ?? 0) << 16) | 0);
        break;
      }
      case 0x1a: {
        // const-string (21c)
        regStr.set((unit >> 8) & 0xff, dex.getStringById(insns[idx + 1] ?? 0));
        break;
      }
      case 0x1b: {
        // const-string/jumbo (31c)
        regStr.set(
          (unit >> 8) & 0xff,
          dex.getStringById((insns[idx + 1] ?? 0) + (insns[idx + 2] ?? 0) * 0x10000),
        );
        break;
      }
      case 0x6e:
      case 0x6f:
      case 0x70:
      case 0x71:
      case 0x72: {
        // invoke-kind (35c)
        const a = (unit >> 12) & 0xf;
        const g = (unit >> 8) & 0xf;
        const methodIdx = insns[idx + 1] ?? 0;
        const regsWord = insns[idx + 2] ?? 0;
        const args = [
          regsWord & 0xf,
          (regsWord >> 4) & 0xf,
          (regsWord >> 8) & 0xf,
          (regsWord >> 12) & 0xf,
          g,
        ].slice(0, a);
        resolveInvoke(methodIdx, args);
        break;
      }
      case 0x74:
      case 0x75:
      case 0x76:
      case 0x77:
      case 0x78: {
        // invoke-kind/range (3rc)
        const count = (unit >> 8) & 0xff;
        const methodIdx = insns[idx + 1] ?? 0;
        const first = insns[idx + 2] ?? 0;
        const args: number[] = [];
        for (let i = 0; i < count; i++) args.push(first + i);
        resolveInvoke(methodIdx, args);
        break;
      }
    }
    idx += instructionWidth(insns, idx);
  }

  return ranges;
}

/** Heuristic Titanium version from the CharBuffer.allocate size opcode. */
function detectVersion(insns: Uint16Array): TitaniumVersion {
  let idx = 0;
  while (idx < insns.length) {
    const op = (insns[idx] ?? 0) & 0xff;
    if (op === 0x14) return "<5"; // const (large size)
    if (op === 0x13) return "5.x"; // const/16 (fits 16 bits)
    if (op === 0x1a || op === 0x1b) break; // reached the string appends
    idx += instructionWidth(insns, idx);
  }
  return "unknown";
}

function findAssetCryptClassDef(dex: DexFile, packageHint?: string): DexClassDef | null {
  if (packageHint) {
    const descriptor = `L${packageHint.split(".").join("/")}/AssetCryptImpl;`;
    const byHint = dex.getClassDefByDescriptor(descriptor);
    if (byHint) return byHint;
  }
  for (let i = 0; i < dex.header.classDefsSize; i++) {
    const classDef = dex.getClassDef(i);
    const descriptor = dex.getTypeDescriptorByIdx(classDef.classIdx);
    if (descriptor.endsWith("/AssetCryptImpl;")) return classDef;
  }
  return null;
}

function methodCode(dex: DexFile, classDef: DexClassDef, methodName: string): DexCode | null {
  const classData = dex.getClassData(classDef);
  // In a class_data_item, method indices are ULEB128 deltas that must be
  // accumulated (separately for direct and virtual methods). libdex-ts returns
  // the raw delta in `methodIdx`, so we do the running sum here.
  for (const list of [classData.directMethods, classData.virtualMethods]) {
    let methodIdx = 0;
    for (const method of list) {
      methodIdx += method.methodIdx;
      const name = dex.getStringById(dex.getMethodId(methodIdx).nameIdx);
      if (name === methodName) return dex.getDexCode(method);
    }
  }
  return null;
}

/**
 * Locates `AssetCryptImpl` across the given DEX buffers and extracts the
 * encrypted blob plus file ranges. Returns `newscheme` when the class exists
 * but lacks `initAssetsBytes` (the ti.cloak/.bin variant), or `none` when the
 * class is absent entirely.
 */
export function readAssetCrypt(
  dexBuffers: Uint8Array[],
  packageHint?: string,
): AssetCryptResult {
  for (const bytes of dexBuffers) {
    let dex: DexFile;
    try {
      dex = new DexFile(bytes);
    } catch {
      continue;
    }
    const classDef = findAssetCryptClassDef(dex, packageHint);
    if (!classDef) continue;

    const bytesCode = methodCode(dex, classDef, "initAssetsBytes");
    if (!bytesCode) return { kind: "newscheme" };

    const assetsCode = methodCode(dex, classDef, "initAssets");
    const chunks = extractStringChunks(dex, bytesCode.insns);
    const blob = Buffer.from(chunks.join(""), "latin1");
    const ranges = assetsCode ? extractRanges(dex, assetsCode.insns) : [];
    const titaniumVersion = detectVersion(bytesCode.insns);

    return { kind: "classic", data: { blob, ranges, titaniumVersion } };
  }
  return { kind: "none" };
}
