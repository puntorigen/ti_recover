![ti_recover](https://user-images.githubusercontent.com/57605485/133170750-20244127-1ea0-4cd0-9c67-ac5ca44f17bc.png)

![license](https://img.shields.io/npm/l/ti_recover) ![lines](https://img.shields.io/tokei/lines/github/puntorigen/ti_recover)

Recover the source code from almost any APK built with [Appcelerator Titanium](https://titaniumsdk.com/), whether it was compiled in **development** or **distribution** (encrypted) mode.

It ships as both a modern, promise-based **library** (TypeScript types included, ESM + CommonJS) and a **command-line tool**, and runs **entirely in JavaScript** — no JDK, apktool or jadx required.

> As featured in my blog post: [How recoverable is an APK's source code made with Titanium?](https://pabloschaffner.cl/2017/02/01/how-recoverable-is-an-apk-source-code-made-with-titanium/)

## Requirements

- **Node.js >= 18**

That's it. Since **v2.1.0** everything (APK unzip, binary manifest parsing, DEX
parsing and AES decryption) runs in pure JS, so no Java/JDK installation is
needed.

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

await ti.init();                 // unzip the APK (pure JS)
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
| `init()` | Unzips the APK in pure JS (or reuses a provided extracted `apkDir`). |
| `test()` | Resolves `true` if the APK was built with Titanium (dev or distribution). |
| `extract()` | Recovers sources into memory; resolves a `MemorySource` map. |
| `info()` | Resolves `TitaniumInfo` (package, versions, mode, engine, Alloy, files). Call after `extract()`. |
| `reconstruct()` | Rebuilds sources into an openable Titanium project (`Resources/` + `tiapp.xml`). |
| `writeToDisk()` | Writes in-memory sources to `outDir` (`.js` files are beautified). |
| `copyAssets()` | Copies the APK's images/resources and `AndroidManifest.xml` to `outDir`. |
| `clean()` | Removes the temporary working directory. |

Pure, JVM-free helpers are also exported for advanced use and testing:
`parseManifest`, `parseBinaryManifest`, `readAssetCrypt`, `decryptRange`,
`decryptRanges`, `parseRanges`, `parseAssetBuffer`, `decodeJavaInt`,
`detectAlloy`, `extractStringChunks`, `extractRanges`, `instructionWidth`,
`buildInfo`, `buildReconstruct` and `buildTiappXml`.

## How it works

Everything runs in pure JS:

- The APK is unzipped with [`fflate`](https://www.npmjs.com/package/fflate).
- The binary `AndroidManifest.xml` is parsed with
  [`adbkit-apkreader`](https://www.npmjs.com/package/adbkit-apkreader) for the
  package id and versions (and re-serialised to readable XML in the output).
- **Development-mode** APKs ship plain JS/JSON/XML sources under
  `assets/Resources`, which are read directly.
- **Distribution-mode** APKs store all sources as a single AES-encrypted blob.
  Titanium's generated `AssetCryptImpl` class holds that blob and the per-file
  byte ranges in its bytecode. ti_recover reads `classes*.dex` with
  [`libdex-ts`](https://www.npmjs.com/package/libdex-ts) and walks the
  `initAssetsBytes()` / `initAssets()` instruction streams to lift the blob and
  ranges directly, then decrypts each file with `node:crypto`
  (`aes-128-ecb`, key = the blob's last 16 bytes).

### Unsupported: the newer `ti.cloak` scheme

Recent Titanium SDKs replaced the static `AssetCryptImpl` blob with a scheme
that stores each source as an encrypted `.bin` asset whose key is derived
**natively at runtime** (see [issue #9](https://github.com/puntorigen/ti_recover/issues/9)).
Because the key never appears statically, those APKs cannot be recovered by
static analysis. ti_recover detects this case and reports it with a clear
error instead of producing garbage.

## Development

```bash
npm install        # install deps
npm run build      # bundle ESM + CJS + types into dist/
npm test           # run the vitest suite (pure JS, no JVM)
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

## Updates

### version 2.1.0

- **Removed the Java/JDK dependency entirely** — recovery now runs in pure JS.
  - APK unzip via `fflate` (replaces the `apk_unpack` apktool step).
  - Binary `AndroidManifest.xml` parsing via `adbkit-apkreader` (replaces the apktool text decode); a readable manifest is still written to the output.
  - Distribution-mode asset data (encrypted blob + per-file ranges) is lifted directly from `classes*.dex` with `libdex-ts` and a small DEX instruction walker (replaces the jadx decompile of `AssetCryptImpl`).
  - AES decryption via `node:crypto` `aes-128-ecb` (replaces `javax.crypto`); DEX stores real strings, so the old `commons-lang` string-unescape step is gone.
- Dropped the optional `java` and `apk_unpack` dependencies and the bundled ~13 MB `java/` directory (apktool + jadx JARs).
- Detects and clearly reports APKs using the newer, statically-unrecoverable `ti.cloak` / `.bin` encryption scheme.
- Multidex aware (scans `classes.dex`, `classes2.dex`, …).

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
