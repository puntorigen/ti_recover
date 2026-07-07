/**
 * Assemble Titanium metadata from a parsed manifest plus decryption results.
 */
import { detectAlloy } from "./decrypt.js";
import type { DecryptMeta, ManifestInfo, MemorySource, TitaniumInfo } from "./types.js";

export interface BuildInfoInput {
  manifest: ManifestInfo | null;
  memorySource: MemorySource;
  meta?: DecryptMeta;
  developmentMode: boolean;
}

/**
 * Combines manifest fields, decryption metadata and the recovered file list
 * into the public {@link TitaniumInfo} shape returned by `TiRecover.info()`.
 */
export function buildInfo(input: BuildInfoInput): TitaniumInfo {
  const { manifest, memorySource, meta, developmentMode } = input;

  const files = Object.entries(memorySource).map(([name, file]) => ({
    name,
    bytes: file.bytes,
  }));

  const totalBytes = meta
    ? meta.totalBytes
    : files.reduce((sum, f) => sum + (f.bytes || 0), 0);

  return {
    package: manifest?.package,
    versionCode: manifest?.versionCode,
    versionName: manifest?.versionName,
    appName: manifest?.appName,
    dir: manifest?.dir,
    developmentMode,
    titaniumVersion: meta?.titaniumVersion ?? "unknown",
    alloy: meta?.alloy ?? detectAlloy(memorySource),
    files,
    totalBytes,
  };
}
