/**
 * Parse a decoded `AndroidManifest.xml` into structured info.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import type { ManifestInfo } from "./types.js";
import { fileExists } from "./fs-utils.js";

/**
 * Reads and parses `AndroidManifest.xml` from an unpacked APK directory.
 * Returns `null` if the manifest does not exist.
 */
export async function readManifest(apkDir: string): Promise<ManifestInfo | null> {
  const manifestPath = path.join(apkDir, "AndroidManifest.xml");
  if (!(await fileExists(manifestPath))) return null;

  const data = await readFile(manifestPath);
  return parseManifest(data.toString("utf8"), apkDir);
}

/**
 * Pure manifest parser, split out so it can be unit-tested without touching the
 * filesystem.
 */
export function parseManifest(xml: string, dir?: string): ManifestInfo {
  const $ = load(xml, { xml: true });
  return {
    package: $("manifest[package]").attr("package"),
    versionCode: $("manifest").attr("android:versionCode"),
    versionName: $("manifest").attr("android:versionName"),
    appName: $("manifest application").attr("android:label"),
    dir,
  };
}
