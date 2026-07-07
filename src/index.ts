/**
 * ti_recover - recover the source code from Appcelerator Titanium APKs.
 *
 * Public entry point exposing the {@link TiRecover} class and the one-shot
 * {@link recover} helper.
 */
import path from "node:path";
import { readdir, readFile, rm } from "node:fs/promises";
import { unpackApk } from "./apk.js";
import { readManifest } from "./manifest.js";
import { decryptRanges, detectAlloy } from "./decrypt.js";
import { readAssetCrypt, type AssetCryptResult } from "./dex.js";
import { buildInfo } from "./info.js";
import { reconstruct as reconstructProject } from "./reconstruct.js";
import { writeToDisk, copyAssets, type WrittenFile } from "./write.js";
import { fileExists, dirExists } from "./fs-utils.js";
import { isDexEntry } from "./zip.js";
import type {
  DecryptMeta,
  ManifestInfo,
  MemorySource,
  RecoverConfig,
  TitaniumInfo,
} from "./types.js";

export type {
  RecoverConfig,
  RecoveredFile,
  MemorySource,
  ManifestInfo,
  TitaniumInfo,
  TitaniumVersion,
  DecryptMeta,
  DecryptResult,
} from "./types.js";
export { parseManifest, parseBinaryManifest } from "./manifest.js";
export {
  parseRanges,
  parseAssetBuffer,
  decodeJavaInt,
  detectAlloy,
  decryptRange,
  decryptRanges,
  type Range,
} from "./decrypt.js";
export {
  readAssetCrypt,
  extractRanges,
  extractStringChunks,
  instructionWidth,
  type DexRange,
  type AssetCrypt,
  type AssetCryptResult,
} from "./dex.js";
export { buildInfo } from "./info.js";
export { reconstruct as buildReconstruct, buildTiappXml } from "./reconstruct.js";
export type { WrittenFile } from "./write.js";

/** Thrown when an APK uses Titanium's newer, unsupported encryption scheme. */
export class UnsupportedEncryptionError extends Error {
  constructor() {
    super(
      "This APK uses Titanium's newer asset encryption (ti.cloak / .bin assets) " +
        "whose key is derived natively at runtime and cannot be recovered statically.",
    );
    this.name = "UnsupportedEncryptionError";
  }
}

/** Source file extensions recovered into memory in development mode. */
const DEV_SOURCE_EXTENSIONS = [".js", ".json", ".xml", ".tss", ".rjss", ".jss", ".css"];

const DEFAULT_CONFIG: Required<Pick<RecoverConfig, "tmpDir" | "debug">> = {
  tmpDir: "_tmp",
  debug: false,
};

/**
 * Orchestrates recovery of a Titanium APK: unpack, detect, decrypt/extract,
 * optionally reconstruct a project, and write everything to disk.
 */
export class TiRecover {
  private readonly cwd = process.cwd();
  private config: RecoverConfig & typeof DEFAULT_CONFIG;

  private apkDir = "";
  private tmpUsed = false;
  private manifest: ManifestInfo | null = null;
  private dexBuffers: Uint8Array[] = [];
  private assetCrypt: AssetCryptResult = { kind: "none" };
  private developmentMode = false;
  private tested = false;
  private isTitanium = false;

  private memorySource: MemorySource = {};
  private meta?: DecryptMeta;
  private restructured = false;

  constructor(config: RecoverConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Absolute output directory (resolved against cwd for relative paths). */
  private get outDir(): string {
    const out = this.config.outDir ?? "";
    return path.isAbsolute(out) ? out : path.resolve(this.cwd, out);
  }

  private log(message: string): void {
    if (this.config.debug) console.log(message);
  }

  /**
   * Prepares the working directory. If `apkDir` is supplied it is used directly
   * (reading any `classes*.dex` and manifest found there); otherwise the
   * configured `apk` is unzipped into `tmpDir`.
   */
  async init(): Promise<void> {
    if (this.config.apkDir) {
      this.apkDir = this.config.apkDir.endsWith(path.sep)
        ? this.config.apkDir
        : this.config.apkDir + path.sep;
      this.dexBuffers = await readDexBuffersFromDir(this.apkDir);
      this.manifest = await readManifest(this.apkDir);
      return;
    }
    if (!this.config.apk) {
      throw new Error("init() requires either 'apk' or 'apkDir' in the config.");
    }
    const apkResolved = path.isAbsolute(this.config.apk)
      ? this.config.apk
      : path.resolve(this.cwd, this.config.apk);
    const result = await unpackApk(apkResolved, this.config.tmpDir, this.config.debug);
    this.apkDir = result.apkDir;
    this.manifest = result.manifest;
    this.dexBuffers = result.dexBuffers;
    this.tmpUsed = true;
  }

  /**
   * Returns `true` if the prepared APK was built with Titanium (in either
   * distribution or development mode), populating internal detection state.
   */
  async test(): Promise<boolean> {
    if (!this.apkDir) {
      throw new Error("Call init() before test().");
    }
    if (!this.manifest) {
      this.manifest = await readManifest(this.apkDir);
    }
    this.tested = true;

    // Distribution mode: look for the generated AssetCryptImpl class in the DEX.
    this.assetCrypt = readAssetCrypt(this.dexBuffers, this.manifest?.package);
    if (this.assetCrypt.kind !== "none") {
      // `classic` (recoverable) and `newscheme` (unsupported) are both Titanium.
      this.developmentMode = false;
      this.isTitanium = true;
      return true;
    }

    // Development-mode APKs ship plain sources under assets/Resources.
    const appDev = path.join(this.apkDir, "assets", "Resources", "app.js");
    if (await fileExists(appDev)) {
      this.developmentMode = true;
      this.isTitanium = true;
      return true;
    }

    this.isTitanium = false;
    return false;
  }

  /**
   * Extracts recovered sources into memory. For distribution builds this
   * decrypts the AES asset blob (from data lifted out of the DEX); for
   * development builds it reads the plain `assets/Resources` tree.
   */
  async extract(): Promise<MemorySource> {
    if (!this.tested) await this.test();
    if (!this.isTitanium) {
      throw new Error("The given APK was not created using Appcelerator Titanium.");
    }

    if (!this.developmentMode) {
      if (this.assetCrypt.kind === "newscheme") {
        throw new UnsupportedEncryptionError();
      }
      if (this.assetCrypt.kind !== "classic") {
        throw new Error("No recoverable Titanium asset data was found in the APK.");
      }
      const { blob, ranges, titaniumVersion } = this.assetCrypt.data;
      const { files, totalBytes } = decryptRanges(blob, ranges, this.config.debug);
      this.memorySource = files;
      this.meta = { totalBytes, titaniumVersion, alloy: detectAlloy(files) };
      return files;
    }

    // Development mode: read plain source files from assets/Resources.
    const baseAssets = path.join(this.apkDir, "assets", "Resources");
    const relFiles = await readSourceFiles(baseAssets);
    const source: MemorySource = {};
    for (const rel of relFiles) {
      const content = await readFile(path.join(baseAssets, rel));
      source[rel.split(path.sep).join("/")] = {
        offset: 0,
        bytes: content.length,
        content,
      };
    }
    this.memorySource = source;
    return source;
  }

  /**
   * Returns Titanium metadata for the current APK. Must be called after
   * {@link extract} to include the recovered file list.
   */
  async info(): Promise<TitaniumInfo> {
    if (!this.manifest && this.apkDir) {
      this.manifest = await readManifest(this.apkDir);
    }
    return buildInfo({
      manifest: this.manifest,
      memorySource: this.memorySource,
      meta: this.meta,
      developmentMode: this.developmentMode,
    });
  }

  /**
   * Rebuilds the in-memory sources into a Titanium-openable project structure
   * (everything under `Resources/`, plus a synthesised `tiapp.xml`).
   */
  async reconstruct(): Promise<MemorySource> {
    if (Object.keys(this.memorySource).length === 0) {
      throw new Error("Call extract() before reconstruct().");
    }
    const info = await this.info();
    const result = reconstructProject(this.memorySource, info);
    this.memorySource = result.memorySource;
    this.restructured = result.restructured;
    return this.memorySource;
  }

  /** Writes the in-memory sources to the configured `outDir`. */
  async writeToDisk(): Promise<WrittenFile[]> {
    if (!this.config.outDir) {
      throw new Error("writeToDisk() requires 'outDir' in the config.");
    }
    if (Object.keys(this.memorySource).length === 0) {
      throw new Error("Call extract() before writeToDisk().");
    }
    const written = await writeToDisk(this.memorySource, this.outDir);
    for (const file of written) {
      const size = file.bytes > 1000 ? `${Math.round(file.bytes / 1024)} KB` : `${file.bytes} Bytes`;
      this.log(`writeToDisk-> file ${file.name} written (${size}).`);
    }
    return written;
  }

  /** Copies the APK's static assets and manifest into `outDir`. */
  async copyAssets(): Promise<void> {
    if (!this.config.outDir) {
      throw new Error("copyAssets() requires 'outDir' in the config.");
    }
    await copyAssets(this.apkDir, this.outDir, this.restructured);
  }

  /** Removes the temporary directory created during {@link init}. */
  async clean(): Promise<void> {
    if (!this.tmpUsed || !this.apkDir) return;
    try {
      await rm(this.apkDir, { recursive: true, force: true });
      this.log("clean->ok");
    } catch {
      // best-effort cleanup
    }
  }
}

export interface RecoverOptions extends RecoverConfig {
  /** Reconstruct an openable Titanium project layout. Defaults to `false`. */
  reconstruct?: boolean;
  /** Remove the temporary working directory when finished. Defaults to `true`. */
  clean?: boolean;
}

export interface RecoverResult {
  /** Whether the APK was recognised as a Titanium app and recovered. */
  recovered: boolean;
  /** Titanium metadata, present when `recovered` is true. */
  info?: TitaniumInfo;
  /** Files written to disk, present when `recovered` is true. */
  files?: WrittenFile[];
}

/**
 * One-shot recovery: unpack, detect, extract, optionally reconstruct, write to
 * disk, copy assets and clean up. Returns whether recovery succeeded plus the
 * gathered info.
 */
export async function recover(options: RecoverOptions): Promise<RecoverResult> {
  const { reconstruct = false, clean = true, ...config } = options;
  const ti = new TiRecover(config);
  try {
    await ti.init();
    if (!(await ti.test())) {
      return { recovered: false };
    }
    await ti.extract();
    const info = await ti.info();
    if (reconstruct) {
      await ti.reconstruct();
    }
    const files = await ti.writeToDisk();
    await ti.copyAssets();
    return { recovered: true, info, files };
  } finally {
    if (clean) await ti.clean();
  }
}

/** Reads `classes*.dex` buffers from a pre-extracted directory (if any). */
async function readDexBuffersFromDir(dir: string): Promise<Uint8Array[]> {
  if (!(await dirExists(dir))) return [];
  const names = (await readdir(dir)).filter(isDexEntry).sort();
  const buffers: Uint8Array[] = [];
  for (const name of names) {
    buffers.push(await readFile(path.join(dir, name)));
  }
  return buffers;
}

/** Recursively lists source files (relative paths) under `base`. */
async function readSourceFiles(base: string): Promise<string[]> {
  if (!(await dirExists(base))) return [];
  const entries = await readdir(base, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!DEV_SOURCE_EXTENSIONS.includes(ext)) continue;
    const parentPath = (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
      (entry as unknown as { path?: string }).path ??
      base;
    const abs = path.join(parentPath, entry.name);
    files.push(path.relative(base, abs));
  }
  return files;
}
