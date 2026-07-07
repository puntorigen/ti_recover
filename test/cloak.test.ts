import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { deriveCloakKey, decryptCloakAsset, pickCloakKey, isProbablyText } from "../src/cloak.js";
import { readAssetCrypt } from "../src/dex.js";
import { recover } from "../src/index.js";

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const BLOCK_BASE = 0x2008;

/**
 * Builds a synthetic `libti.cloak.so` such that deriveCloakKey(so, salt) === key.
 * Mirrors the documented four-slice XOR layout with a `randomOffset` indirection.
 */
function buildSyntheticSo(salt: Buffer, key: Buffer): Buffer {
  const so = randomBytes(0x3000);
  const xor = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) xor[i] = salt[i]! ^ key[i]!;

  const randomOffset = 0x34; // slice base+0x34..0x38, clear of the fixed slices
  so[BLOCK_BASE + 0x3e] = randomOffset;
  xor.copy(so, BLOCK_BASE + 1, 0, 4);
  xor.copy(so, BLOCK_BASE + randomOffset, 4, 8);
  xor.copy(so, BLOCK_BASE + 0xf, 8, 12);
  xor.copy(so, BLOCK_BASE + 0x1e, 12, 16);
  return so;
}

function aesCbc(plain: Buffer, key: Buffer, iv: Buffer): Buffer {
  const c = createCipheriv("aes-128-cbc", key, iv);
  c.setAutoPadding(true);
  return Buffer.concat([c.update(plain), c.final()]);
}

// ---------------------------------------------------------------------------
// deriveCloakKey
// ---------------------------------------------------------------------------
describe("deriveCloakKey", () => {
  const salt = Buffer.from("8f2a4c6e1b3d5f79a0c2e4068a1b3d5f", "hex");
  const key = Buffer.from("CloakKey_16bytes", "latin1");

  it("reconstructs salt XOR xor from the native key block", () => {
    const so = buildSyntheticSo(salt, key);
    expect(deriveCloakKey(so, salt)?.equals(key)).toBe(true);
  });

  it("returns null for a too-small library buffer", () => {
    expect(deriveCloakKey(Buffer.alloc(0x100), salt)).toBeNull();
  });

  it("returns null when the salt is not 16 bytes", () => {
    expect(deriveCloakKey(buildSyntheticSo(salt, key), Buffer.alloc(8))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// decryptCloakAsset
// ---------------------------------------------------------------------------
describe("decryptCloakAsset", () => {
  const salt = randomBytes(16);
  const key = randomBytes(16);

  it("round-trips AES-128-CBC (IV = salt)", () => {
    const plain = Buffer.from("Ti.API.info('hi');\n", "utf8");
    const out = decryptCloakAsset(aesCbc(plain, key, salt), key, salt);
    expect(out?.toString("utf8")).toBe("Ti.API.info('hi');\n");
  });

  it("transparently gunzips gzip-compressed plaintext", () => {
    const plain = Buffer.from("exports.x = function () { return 1; };\n", "utf8");
    const out = decryptCloakAsset(aesCbc(gzipSync(plain), key, salt), key, salt);
    expect(out?.toString("utf8")).toBe(plain.toString("utf8"));
  });

  it("preserves binary (non-gzip) payloads verbatim", () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const out = decryptCloakAsset(aesCbc(bytes, key, salt), key, salt);
    expect(out?.equals(bytes)).toBe(true);
  });

  it("returns null on a wrong key (padding failure)", () => {
    const enc = aesCbc(Buffer.from("hello world padded", "utf8"), key, salt);
    // A different key almost always yields an invalid final block.
    let sawNull = false;
    for (let i = 0; i < 8 && !sawNull; i++) {
      if (decryptCloakAsset(enc, randomBytes(16), salt) === null) sawNull = true;
    }
    expect(sawNull).toBe(true);
  });
});

describe("isProbablyText", () => {
  it("recognises source text and rejects binary", () => {
    expect(isProbablyText(Buffer.from("var x = 1; // js\n"))).toBe(true);
    // Deterministic binary: a PNG signature followed by many NUL/control bytes.
    const binary = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(120),
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04]),
    ]);
    expect(isProbablyText(binary)).toBe(false);
    expect(isProbablyText(Buffer.alloc(0))).toBe(false);
  });
});

describe("pickCloakKey", () => {
  it("selects the library whose derived key validates against a sample", () => {
    const salt = randomBytes(16);
    const key = randomBytes(16);
    const good = buildSyntheticSo(salt, key);
    const bogus = randomBytes(0x3000);
    const sample = aesCbc(Buffer.from("Ti.API.info('ok');\n"), key, salt);
    expect(pickCloakKey([bogus, good], salt, sample)?.equals(key)).toBe(true);
  });

  it("returns null when no library yields a valid key", () => {
    const salt = randomBytes(16);
    const sample = aesCbc(Buffer.from("Ti.API.info('ok');\n"), randomBytes(16), salt);
    expect(pickCloakKey([randomBytes(0x3000)], salt, sample)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Real new-scheme DEX: detects ti.cloak + lifts the salt out of <clinit>
// (cloak.dex compiled from a salt-only AssetCryptImpl via javac + d8; see
// gen-cloak-dex.mjs).
// ---------------------------------------------------------------------------
describe("readAssetCrypt (real new-scheme cloak.dex)", () => {
  const expected = JSON.parse(readFileSync(`${fixturesDir}/cloak.expected.json`, "utf8"));
  const dex = readFileSync(`${fixturesDir}/cloak.dex`);

  it("reports newscheme and extracts the hardcoded salt", () => {
    const result = readAssetCrypt([dex], expected.package);
    expect(result.kind).toBe("newscheme");
    if (result.kind !== "newscheme") return;
    expect(result.salt?.toString("hex")).toBe(expected.salt);
  });

  it("finds the salt even without a package hint", () => {
    const result = readAssetCrypt([dex]);
    expect(result.kind).toBe("newscheme");
    if (result.kind !== "newscheme") return;
    expect(result.salt?.toString("hex")).toBe(expected.salt);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: build a synthetic ti.cloak APK (new-scheme dex + libti.cloak.so +
// AES-CBC .bin assets) and recover it through the full public pipeline.
// ---------------------------------------------------------------------------
describe("recover() ti.cloak end-to-end", () => {
  const expected = JSON.parse(readFileSync(`${fixturesDir}/cloak.expected.json`, "utf8"));
  const salt = Buffer.from(expected.salt, "hex");
  const key = Buffer.from("CloakKey_16bytes", "latin1");

  const appJs = "Ti.API.info('cloak recovered');\nvar w = Ti.UI.createWindow();\nw.open();\n";
  const indexJs = "exports.hello = function () { return 42; };\n";
  const logoPng = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    randomBytes(48),
  ]);

  const outDir = mkdtempSync(path.join(tmpdir(), "ti-cloak-out-"));
  const tmpDir = `_tmp_cloak_${randomUUID().slice(0, 8)}`;
  let apkPath = "";

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(path.join(process.cwd(), tmpDir), { recursive: true, force: true });
    if (apkPath) rmSync(apkPath, { force: true });
  });

  it("decrypts every .bin asset back to its original source/bytes", async () => {
    const zip = zipSync({
      "AndroidManifest.xml": new Uint8Array(readFileSync(`${fixturesDir}/AndroidManifest.bin`)),
      "classes.dex": new Uint8Array(readFileSync(`${fixturesDir}/cloak.dex`)),
      "lib/arm64-v8a/libti.cloak.so": new Uint8Array(buildSyntheticSo(salt, key)),
      // app.js is additionally gzipped before encryption to exercise gunzip.
      "assets/Resources/app.js.bin": new Uint8Array(aesCbc(gzipSync(Buffer.from(appJs)), key, salt)),
      "assets/Resources/ui/index.js.bin": new Uint8Array(aesCbc(Buffer.from(indexJs), key, salt)),
      "assets/Resources/images/logo.png.bin": new Uint8Array(aesCbc(logoPng, key, salt)),
    });

    apkPath = path.join(tmpdir(), `ti-cloak-${randomUUID().slice(0, 8)}.apk`);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(apkPath, zip);

    const result = await recover({ apk: apkPath, outDir, tmpDir, reconstruct: false });
    expect(result.recovered).toBe(true);

    const recoveredApp = await readFile(path.join(outDir, "app.js"), "utf8");
    expect(recoveredApp).toContain("cloak recovered");
    expect(recoveredApp).toContain("createWindow");

    const recoveredIndex = await readFile(path.join(outDir, "ui/index.js"), "utf8");
    expect(recoveredIndex).toContain("return 42");

    const recoveredLogo = await readFile(path.join(outDir, "images/logo.png"));
    expect(recoveredLogo.equals(logoPng)).toBe(true);

    // The encrypted `.bin` files must NOT be copied into the output.
    const rootEntries = await readdir(outDir);
    expect(rootEntries.some((n) => n.endsWith(".bin"))).toBe(false);
  });
});
