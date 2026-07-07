/**
 * Pure-JS APK unpack (no JVM). Reads the APK zip with `fflate`, parses the
 * binary manifest, extracts `assets/Resources/**` and a readable manifest into
 * a working directory, and returns the raw `classes*.dex` buffers for DEX-based
 * asset recovery.
 */
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { readApkEntries, isDexEntry } from "./zip.js";
import { parseBinaryManifest } from "./manifest.js";
import { fileExists } from "./fs-utils.js";
import type { ManifestInfo } from "./types.js";

export interface UnpackResult {
  /** Working directory (with trailing separator) holding manifest + assets. */
  apkDir: string;
  /** Parsed manifest info, or null if the APK had no manifest. */
  manifest: ManifestInfo | null;
  /** Raw `classes*.dex` buffers, ordered `classes.dex`, `classes2.dex`, ... */
  dexBuffers: Uint8Array[];
  /** `lib/<abi>/libti.cloak.so` buffers (for ti.cloak key derivation). */
  cloakLibs: Buffer[];
}

const ASSETS_PREFIX = "assets/Resources/";
const CLOAK_LIB_SUFFIX = "/libti.cloak.so";

function isCloakLib(name: string): boolean {
  return name.startsWith("lib/") && name.endsWith(CLOAK_LIB_SUFFIX);
}

/**
 * Unpacks an APK into `tmpDir` (relative to `cwd`): writes a readable
 * `AndroidManifest.xml` and `assets/Resources/**`, and returns the manifest and
 * DEX buffers for downstream recovery.
 */
export async function unpackApk(
  apkPath: string,
  tmpDir: string,
  debug = false,
): Promise<UnpackResult> {
  if (!(await fileExists(apkPath))) {
    throw new Error(`The given APK file doesn't exist: ${apkPath}`);
  }

  if (debug) console.log("preparing -> reading APK entries");
  const entries = await readApkEntries(
    apkPath,
    (f) =>
      f.name === "AndroidManifest.xml" ||
      isDexEntry(f.name) ||
      f.name.startsWith(ASSETS_PREFIX) ||
      isCloakLib(f.name),
  );

  const apkDir = path.join(process.cwd(), tmpDir) + path.sep;
  await mkdir(apkDir, { recursive: true });

  const dexBuffers = Object.keys(entries)
    .filter(isDexEntry)
    .sort()
    .map((name) => entries[name]!);

  const cloakLibs = Object.keys(entries)
    .filter(isCloakLib)
    .sort()
    .map((name) => Buffer.from(entries[name]!));

  let manifest: ManifestInfo | null = null;
  const manifestBytes = entries["AndroidManifest.xml"];
  if (manifestBytes) {
    const { info, xml } = parseBinaryManifest(Buffer.from(manifestBytes), apkDir);
    manifest = info;
    await writeFile(path.join(apkDir, "AndroidManifest.xml"), xml);
  }

  for (const [name, data] of Object.entries(entries)) {
    if (!name.startsWith(ASSETS_PREFIX) || name.endsWith("/")) continue;
    const dest = path.join(apkDir, name);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(data));
  }

  if (debug) console.log("preparing -> ready");
  return { apkDir, manifest, dexBuffers, cloakLibs };
}
