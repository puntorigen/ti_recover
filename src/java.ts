/**
 * Single, shared node-java bridge instance.
 *
 * Historically the classpath was configured in three different places
 * (`java_init.js`, `ti_unpack.js` and inside `apk_unpack`), each doing its own
 * `require('java')`. Because node-java is a process-wide singleton, the JVM and
 * its classpath are actually shared; the only real requirement is that every
 * classpath entry is registered *before* the JVM boots (i.e. before the first
 * `java.import`). This module centralises that setup so callers just import
 * {@link getJava} and never touch the classpath directly.
 *
 * The native `java` addon is loaded lazily so the rest of the library (parsing,
 * manifest reading, reconstruct planning) can be imported and unit-tested even
 * on machines without a JDK. Phase 2 of the modernization will remove this
 * bridge entirely in favour of `node:crypto`.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Absolute path to the bundled `java/` directory shipped with the package. */
export function jarsDir(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  // Both `src/` (dev/test) and `dist/` (published) sit one level under the
  // package root, so the bundled JARs are always at `../java`.
  return path.join(moduleDir, "..", "java");
}

// node-java's public type surface is intentionally loose here.
type JavaBridge = any;

let cached: JavaBridge | undefined;
let loadError: Error | undefined;

/**
 * Returns the configured, shared node-java instance, booting and configuring it
 * on first use. Throws a friendly error if the native bridge is unavailable.
 */
export function getJava(): JavaBridge {
  if (cached) return cached;
  if (loadError) throw loadError;

  let java: JavaBridge;
  try {
    java = require("java");
  } catch (err) {
    loadError = new Error(
      "The native 'java' bridge could not be loaded. Ensure a JDK is installed " +
        "and the 'java' npm package built successfully.\nOriginal error: " +
        (err instanceof Error ? err.message : String(err)),
    );
    throw loadError;
  }

  const dir = jarsDir();
  // jadx + apktool decompiler stack and our own helper JARs (commons-lang).
  java.classpath.pushDir(path.join(dir, "jadx"));
  java.classpath.pushDir(dir);
  // Reduce OS signal handling so Ctrl-C behaves in the host process.
  java.options.push("-Xrs");

  // Silence the default java.util.logging output from the bundled libraries.
  try {
    const logManager = java.import("java.util.logging.LogManager");
    logManager.getLogManagerSync().resetSync();
  } catch {
    // Non-fatal: logging silencing is best-effort.
  }

  cached = java;
  return java;
}

/** Whether the native `java` bridge can be loaded in this environment. */
export function isJavaAvailable(): boolean {
  try {
    getJava();
    return true;
  } catch {
    return false;
  }
}
