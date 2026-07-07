/**
 * Regenerates `assetcrypt.dex` + `assetcrypt.expected.json`: a REAL Android DEX
 * containing an old-scheme Titanium `AssetCryptImpl` (initAssetsBytes +
 * initAssets + nested Range) with a genuine AES-encrypted asset blob.
 *
 * This lets the test suite validate the full pure-JS distribution recovery
 * pipeline (DEX parse -> blob/range extraction -> node:crypto decrypt) against
 * bytecode produced by real Android tooling. javac + d8 are used ONLY to build
 * the fixture; ti_recover itself never touches Java.
 *
 * Requirements to regenerate (not needed to run the tests, the .dex is committed):
 *   - javac (JDK 8+)
 *   - Android build-tools `d8` (run with JDK 11+)
 *   - an android.jar
 * Override autodetection with env vars: D8, ANDROID_JAR, D8_JAVA_HOME.
 * Run: node test/fixtures/gen-dex.mjs
 */
import { createCipheriv } from "node:crypto";
import { writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import path from "node:path";

const fixturesDir = fileURLToPath(new URL(".", import.meta.url));
const work = path.join(fixturesDir, ".dexgen");
const pkgDir = path.join(work, "com/example/recovered");
rmSync(work, { recursive: true, force: true });
mkdirSync(pkgDir, { recursive: true });

const KEY = Buffer.from("Titanium!Key0123", "latin1");
const sources = {
  "app.js": "Ti.API.info('hello world');\nvar win = Ti.UI.createWindow();\nwin.open();\n",
  "alloy.js": "var Alloy = require('/alloy');\nAlloy.createController('index');\n",
  "ui/index.js": "exports.render = function () {\n  return { ok: true };\n};\n",
};

function aesEcb(text) {
  const c = createCipheriv("aes-128-ecb", KEY, null);
  c.setAutoPadding(true);
  return Buffer.concat([c.update(Buffer.from(text, "utf8")), c.final()]);
}

const parts = [];
const ranges = [];
let offset = 0;
for (const [file, content] of Object.entries(sources)) {
  const enc = aesEcb(content);
  parts.push(enc);
  ranges.push({ file, offset, bytes: enc.length });
  offset += enc.length;
}
parts.push(KEY);
const blob = Buffer.concat(parts);

function javaChunks(buf, size = 200) {
  const chunks = [];
  for (let i = 0; i < buf.length; i += size) {
    let s = "";
    for (let j = i; j < Math.min(i + size, buf.length); j++) s += "\\" + buf[j].toString(8).padStart(3, "0");
    chunks.push(s);
  }
  return chunks;
}

const appendLines = javaChunks(blob).map((c) => `        cb.append("${c}");`).join("\n");
const putLines = ranges.map((r) => `        m.put("${r.file}", new Range(${r.offset}, ${r.bytes}));`).join("\n");

const java = `package com.example.recovered;

import java.nio.CharBuffer;
import java.util.HashMap;

public class AssetCryptImpl {
    static final class Range {
        final int offset;
        final int length;
        Range(int offset, int length) {
            this.offset = offset;
            this.length = length;
        }
    }

    private static CharBuffer initAssetsBytes() {
        CharBuffer cb = CharBuffer.allocate(${blob.length});
${appendLines}
        cb.rewind();
        return cb;
    }

    private static HashMap<String, Range> initAssets() {
        HashMap<String, Range> m = new HashMap<String, Range>();
${putLines}
        return m;
    }

    public static int size() {
        return initAssetsBytes().length() + initAssets().size();
    }
}
`;
writeFileSync(path.join(pkgDir, "AssetCryptImpl.java"), java);

// --- locate tooling -------------------------------------------------------
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

execFileSync("javac", ["-source", "8", "-target", "8", "com/example/recovered/AssetCryptImpl.java"], {
  cwd: work,
  stdio: "inherit",
});

const env = { ...process.env };
if (process.env.D8_JAVA_HOME) env.PATH = `${path.join(process.env.D8_JAVA_HOME, "bin")}:${env.PATH}`;
execFileSync(
  findD8(),
  ["--min-api", "21", "--lib", findAndroidJar(), "--output", ".", "com/example/recovered/AssetCryptImpl.class", "com/example/recovered/AssetCryptImpl$Range.class"],
  { cwd: work, stdio: "inherit", env },
);

copyFileSync(path.join(work, "classes.dex"), path.join(fixturesDir, "assetcrypt.dex"));
writeFileSync(
  path.join(fixturesDir, "assetcrypt.expected.json"),
  JSON.stringify({ package: "com.example.recovered", sources, ranges, blobLength: blob.length }, null, 2) + "\n",
);
rmSync(work, { recursive: true, force: true });
console.log(`wrote assetcrypt.dex (blob ${blob.length} bytes, ${ranges.length} files)`);
