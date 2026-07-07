/**
 * Regenerates `cloak.dex` + `cloak.expected.json`: a REAL Android DEX containing
 * a *new-scheme* (ti.cloak) Titanium `AssetCryptImpl` — i.e. one WITHOUT
 * `initAssetsBytes`, but WITH a hardcoded `byte[] salt` field (the AES-CBC IV).
 *
 * This lets the test suite validate that ti_recover:
 *   1. recognises the ti.cloak variant (kind === "newscheme"), and
 *   2. lifts the `salt` out of `AssetCryptImpl.<clinit>` (fill-array-data).
 *
 * javac + d8 are used ONLY to build the fixture; ti_recover never touches Java.
 * Requirements to regenerate (the .dex is committed, so this isn't needed to run
 * the tests): javac (JDK 8+), Android build-tools `d8` (run with JDK 11+), and an
 * android.jar. Override autodetection with env vars: D8, ANDROID_JAR, D8_JAVA_HOME.
 * Run: node test/fixtures/gen-cloak-dex.mjs
 */
import { writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import path from "node:path";

const fixturesDir = fileURLToPath(new URL(".", import.meta.url));
const work = path.join(fixturesDir, ".cloakgen");
const pkgDir = path.join(work, "com/example/cloak");
rmSync(work, { recursive: true, force: true });
mkdirSync(pkgDir, { recursive: true });

// A fixed 16-byte salt (the AES-CBC IV). Contains bytes > 0x7f on purpose.
const SALT = Buffer.from("8f2a4c6e1b3d5f79a0c2e4068a1b3d5f", "hex");
const saltLiteral = [...SALT].map((b) => `(byte)0x${b.toString(16).padStart(2, "0")}`).join(", ");

const java = `package com.example.cloak;

public class AssetCryptImpl {
    private static byte[] salt = { ${saltLiteral} };

    public static byte[] getSalt() {
        return salt;
    }
}
`;
writeFileSync(path.join(pkgDir, "AssetCryptImpl.java"), java);

function findD8() {
  if (process.env.D8) return process.env.D8;
  const base = path.join(process.env.ANDROID_HOME ?? path.join(homedir(), "Library/Android/sdk"), "build-tools");
  if (!existsSync(base)) throw new Error("Android build-tools not found; set D8 env var");
  const version = readdirSync(base).sort().reverse()[0];
  return path.join(base, version, "d8");
}
function findAndroidJar() {
  if (process.env.ANDROID_JAR) return process.env.ANDROID_JAR;
  const base = path.join(process.env.ANDROID_HOME ?? path.join(homedir(), "Library/Android/sdk"), "platforms");
  const version = readdirSync(base).sort().reverse()[0];
  return path.join(base, version, "android.jar");
}

execFileSync("javac", ["-source", "8", "-target", "8", "com/example/cloak/AssetCryptImpl.java"], {
  cwd: work,
  stdio: "inherit",
});

const env = { ...process.env };
if (process.env.D8_JAVA_HOME) env.PATH = `${path.join(process.env.D8_JAVA_HOME, "bin")}:${env.PATH}`;
execFileSync(
  findD8(),
  ["--min-api", "21", "--lib", findAndroidJar(), "--output", ".", "com/example/cloak/AssetCryptImpl.class"],
  { cwd: work, stdio: "inherit", env },
);

copyFileSync(path.join(work, "classes.dex"), path.join(fixturesDir, "cloak.dex"));
writeFileSync(
  path.join(fixturesDir, "cloak.expected.json"),
  JSON.stringify({ package: "com.example.cloak", salt: SALT.toString("hex") }, null, 2) + "\n",
);
rmSync(work, { recursive: true, force: true });
console.log(`wrote cloak.dex (salt ${SALT.toString("hex")})`);
