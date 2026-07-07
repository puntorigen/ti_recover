/**
 * Write recovered in-memory sources to disk and copy over static assets.
 */
import path from "node:path";
import { mkdir, writeFile, cp, copyFile } from "node:fs/promises";
import jsBeautify from "js-beautify";
import type { MemorySource } from "./types.js";
import { fileExists, dirExists } from "./fs-utils.js";

/** Prettifies JavaScript source with tab indentation. */
export function prettyCode(code: string): string {
  return jsBeautify.js(code, { indent_with_tabs: true });
}

export interface WrittenFile {
  name: string;
  bytes: number;
}

/**
 * Writes every file in `memorySource` under `outDir`, creating directories as
 * needed. `.js` files are beautified; everything else is written verbatim.
 */
export async function writeToDisk(
  memorySource: MemorySource,
  outDir: string,
): Promise<WrittenFile[]> {
  const written: WrittenFile[] = [];
  await mkdir(outDir, { recursive: true });

  for (const [relPath, file] of Object.entries(memorySource)) {
    const target = path.join(outDir, relPath);
    await mkdir(path.dirname(target), { recursive: true });

    let data: string | Buffer = file.content;
    if (typeof data === "string" && relPath.endsWith(".js")) {
      data = prettyCode(data);
    }
    await writeFile(target, data);
    const bytes = typeof data === "string" ? Buffer.byteLength(data, "utf8") : data.length;
    written.push({ name: relPath, bytes });
  }

  return written;
}

/**
 * Copies the APK's static resources (and its `AndroidManifest.xml`) into the
 * output directory. When `restructured` is set the resources are nested under
 * `Resources/` to match a reconstructed Titanium project layout.
 */
export async function copyAssets(
  apkDir: string,
  outDir: string,
  restructured = false,
): Promise<void> {
  const manifestSrc = path.join(apkDir, "AndroidManifest.xml");
  if (await fileExists(manifestSrc)) {
    await mkdir(outDir, { recursive: true });
    await copyFile(manifestSrc, path.join(outDir, "AndroidManifest.xml"));
  }

  const resourcesSrc = path.join(apkDir, "assets", "Resources");
  if (await dirExists(resourcesSrc)) {
    const dest = restructured ? path.join(outDir, "Resources") : outDir;
    await mkdir(dest, { recursive: true });
    await cp(resourcesSrc, dest, { recursive: true });
  }
}
