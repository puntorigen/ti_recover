/**
 * Minimal pure-JS APK (zip) reader built on `fflate`. Used to pull the entries
 * we care about (`AndroidManifest.xml`, `classes*.dex`, `assets/Resources/**`)
 * without shelling out to apktool or a JVM.
 */
import { readFile } from "node:fs/promises";
import { unzip, type Unzipped, type UnzipFileInfo } from "fflate";

export type ApkEntries = Unzipped;

/**
 * Reads an APK from disk and returns the decompressed entries matching
 * `filter` (or all entries when no filter is given).
 */
export async function readApkEntries(
  apkPath: string,
  filter?: (info: UnzipFileInfo) => boolean,
): Promise<ApkEntries> {
  const buf = await readFile(apkPath);
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return await new Promise<ApkEntries>((resolve, reject) => {
    unzip(u8, { filter: filter ?? (() => true) }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/** True for `classes.dex`, `classes2.dex`, ... entries. */
export function isDexEntry(name: string): boolean {
  return /^classes\d*\.dex$/.test(name);
}
