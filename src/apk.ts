/**
 * Promise wrapper around the `apk_unpack` package (apktool + jadx via the
 * shared `java` bridge). Produces an unpacked directory containing the decoded
 * `AndroidManifest.xml`, `assets/`, decompiled `src/` and disassembled `smali/`.
 */
import path from "node:path";
import { createRequire } from "node:module";
import { getJava } from "./java.js";
import { fileExists } from "./fs-utils.js";

const require = createRequire(import.meta.url);

interface ApkUnpack {
  init(config: { apk: string; dir: string; java?: boolean }): void;
  extract(cb: (ok: boolean) => void): void;
  decompile(onReady: () => void): void;
}

/**
 * Unpacks and decompiles an APK into `tmpDir` (relative to `cwd`), returning the
 * absolute path (with trailing separator) of the unpacked directory.
 */
export async function unpackApk(
  apkPath: string,
  tmpDir: string,
  debug = false,
): Promise<string> {
  if (!(await fileExists(apkPath))) {
    throw new Error(`The given APK file doesn't exist: ${apkPath}`);
  }

  // Ensure the shared JVM classpath (incl. commons-lang for decryption) is
  // registered before `apk_unpack` requires 'java' and boots the JVM.
  getJava();
  const apk = require("apk_unpack") as ApkUnpack;

  apk.init({ apk: apkPath, dir: tmpDir, java: true });

  await new Promise<void>((resolve, reject) => {
    apk.extract((ok) => {
      if (!ok) {
        reject(new Error(`Failed to extract APK: ${apkPath}`));
        return;
      }
      if (debug) console.log("preparing -> extracting and decrypting classes.dex");
      apk.decompile(() => {
        if (debug) console.log("preparing -> ready");
        resolve();
      });
    });
  });

  const apkDir = path.join(process.cwd(), tmpDir) + path.sep;
  return apkDir;
}
