![ti_recover](https://user-images.githubusercontent.com/57605485/133170750-20244127-1ea0-4cd0-9c67-ac5ca44f17bc.png)

![license](https://img.shields.io/npm/l/ti_recover) ![lines](https://img.shields.io/tokei/lines/github/puntorigen/ti_recover)

Recover the source code from almost any APK built with [Appcelerator Titanium](https://titaniumsdk.com/), whether it was compiled in **development** or **distribution** (encrypted) mode.

It ships as both a modern, promise-based **library** (TypeScript types included, ESM + CommonJS) and a **command-line tool**.

> As featured in my blog post: [How recoverable is an APK's source code made with Titanium?](https://pabloschaffner.cl/2017/02/01/how-recoverable-is-an-apk-source-code-made-with-titanium/)

## Requirements

- **Node.js >= 18**
- A **JDK** (Java 8+) available on your machine. The APK unpacking (apktool + jadx) and the distribution-mode asset decryption currently run through a bundled JVM via the optional [`java`](https://www.npmjs.com/package/java) native bridge. If the bridge cannot be built, the pure-JS parts of the library still work but recovery of a real APK will be unavailable until a JDK is present.

> Removing the JVM requirement entirely (pure JS decryption + APK parsing) is planned — see the [roadmap](#roadmap).

## Install

```bash
# as a CLI
npm install -g ti_recover

# or as a dependency
npm install ti_recover
```

## CLI usage

```bash
# recover a project into ./out
ti_recover myapp.apk ./out

# just inspect what's inside (no files written)
ti_recover info myapp.apk

# emit machine-readable JSON
ti_recover myapp.apk ./out --json
```

By default the CLI **reconstructs** an openable Titanium project (sources under
`Resources/`, plus a generated `tiapp.xml`). Pass `--no-reconstruct` to keep the
raw recovered layout instead.

### Commands & options

```
ti_recover <apk> <outdir>        Recover source code and assets (default command)
ti_recover info <apk>            Print Titanium metadata about an APK

Options (recover):
  --no-reconstruct   keep the flat recovered layout instead of a Titanium project
  --keep-tmp         keep the temporary working directory
  --tmp-dir <dir>    temporary working directory (default: "_tmp")
  --json             print recovery info as JSON
  -q, --quiet        suppress progress output
  -d, --debug        verbose logging
```

Exit codes: `0` success, `1` error, `2` the APK was not built with Titanium.

## Library usage

### One-shot helper

```ts
import { recover } from "ti_recover";

const result = await recover({
  apk: "myapp.apk",
  outDir: "./out",
  reconstruct: true, // produce an openable Titanium project (default: false)
});

if (result.recovered) {
  console.log(result.info);   // TitaniumInfo
  console.log(result.files);  // [{ name, bytes }, ...]
}
```

CommonJS works too:

```js
const { recover } = require("ti_recover");
```

### Step-by-step with the `TiRecover` class

```ts
import { TiRecover } from "ti_recover";

const ti = new TiRecover({ apk: "myapp.apk", outDir: "./out" });

await ti.init();                 // unpack + decompile the APK
if (await ti.test()) {           // is it a Titanium app?
  await ti.extract();            // recover sources into memory
  const info = await ti.info();  // Titanium metadata (call after extract)
  await ti.reconstruct();        // optional: rebuild a Titanium project layout
  await ti.writeToDisk();        // write recovered sources to outDir
  await ti.copyAssets();         // copy images/resources + manifest
}
await ti.clean();                // remove the temporary working directory
```

### API

| Method | Description |
| --- | --- |
| `new TiRecover(config)` | Create an instance. Config: `apk`, `apkDir`, `outDir`, `tmpDir`, `debug`. |
| `init()` | Unpacks and decompiles the APK (or reuses a provided `apkDir`). |
| `test()` | Resolves `true` if the APK was built with Titanium (dev or distribution). |
| `extract()` | Recovers sources into memory; resolves a `MemorySource` map. |
| `info()` | Resolves `TitaniumInfo` (package, versions, mode, engine, Alloy, files). Call after `extract()`. |
| `reconstruct()` | Rebuilds sources into an openable Titanium project (`Resources/` + `tiapp.xml`). |
| `writeToDisk()` | Writes in-memory sources to `outDir` (`.js` files are beautified). |
| `copyAssets()` | Copies the APK's images/resources and `AndroidManifest.xml` to `outDir`. |
| `clean()` | Removes the temporary working directory. |

Pure, JVM-free helpers are also exported for advanced use and testing:
`parseManifest`, `parseRanges`, `parseAssetBuffer`, `decodeJavaInt`,
`detectAlloy`, `buildInfo`, `buildReconstruct`, `buildTiappXml`, and
`isJavaAvailable`.

## How it works

- **Development-mode** APKs ship plain JS/JSON/XML sources under
  `assets/Resources`, which are read directly.
- **Distribution-mode** APKs store all sources as a single AES-encrypted blob.
  Two generated classes describe how to rebuild it: `AssetCryptImpl.smali`
  (the encrypted byte buffer) and `AssetCryptImpl.java` (per-file byte ranges).
  ti_recover parses both, derives the AES key from the buffer and decrypts each
  file's range.

## Roadmap

**Phase 2 — remove the Java dependency** so recovery runs entirely in JS:

- Replace `javax.crypto` AES decryption with Node's built-in `node:crypto`, and
  the Java string un-escaping with a small JS helper (drops `commons-lang` and
  the `java` bridge from the decryption path).
- Replace the `apk_unpack` (apktool + jadx) step with a JS/WASM APK unpack and a
  pure-JS binary `AndroidManifest.xml` parser.

## Development

```bash
npm install        # install deps (native 'java' bridge is optional)
npm run build      # bundle ESM + CJS + types into dist/
npm test           # run the vitest suite (no JVM required)
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

## Updates

### version 2.0.0

- Full rewrite in **TypeScript** with an ESM + CommonJS dual build and shipped type definitions.
- New **promise-based API** (`TiRecover` class + `recover()` helper); the old callback API has been removed (breaking change).
- New **commander-based CLI** with `--help`, an `info` subcommand, `--json`, `--no-reconstruct`, `--keep-tmp`, `--quiet`, `--debug` flags and proper exit codes.
- Implemented the previously pending **`reconstruct()`** (rebuild an openable Titanium project) and **`info()`** (Titanium metadata) methods.
- Single shared JVM instance and async, non-blocking filesystem I/O.
- The native `java` bridge and `apk_unpack` are now **optional dependencies**, so installs no longer fail on machines without a JDK.
- Added a **test suite** (vitest) with synthetic fixtures.

### version 1.1.1

- now assets are put on the correct directories.

### version 1.0.9

- updated to latest apk_unpack to use jadx.
- now resources and manifest are also copied to outputdir.

### version 1.0.6

- added ability to recover APKs created in development mode.

### version 1.0.5

- improved readability of CLI, added prettifier to source code, and bugfix several issues.

### version 1.0.4

- fixed tmp dir location bug. Now CLI works ok.

### version 1.0.2-3

- added delay before decrypting files, to account for slower hdd disks.

### version 1.0.1

- fixed console debug.

### version 1.0.0

- first version.
