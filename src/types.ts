/**
 * Public type definitions for ti_recover.
 */

/** Configuration accepted by {@link TiRecover}. */
export interface RecoverConfig {
  /** Path to the `.apk` file to recover. Relative paths resolve against `cwd`. */
  apk?: string;
  /**
   * Path to an already-unpacked `apk_unpack` output directory. When provided,
   * the (slow) decompile step is skipped and this directory is used as-is.
   */
  apkDir?: string;
  /** Directory where recovered source and assets are written. */
  outDir?: string;
  /** Temporary directory used while unpacking the APK. Defaults to `_tmp`. */
  tmpDir?: string;
  /** Emit progress logging to the console. Defaults to `false`. */
  debug?: boolean;
}

/** A single recovered source file held in memory. */
export interface RecoveredFile {
  /** Byte offset of the file inside the encrypted asset blob (0 for dev mode). */
  offset: number;
  /** Length in bytes of the recovered content. */
  bytes: number;
  /** Recovered file contents. */
  content: string | Buffer;
}

/** Map of relative file path -> recovered file. */
export type MemorySource = Record<string, RecoveredFile>;

/** Raw values parsed from a decoded `AndroidManifest.xml`. */
export interface ManifestInfo {
  package?: string;
  versionCode?: string;
  versionName?: string;
  appName?: string;
  /** Directory the manifest was read from. */
  dir?: string;
}

/** Detected Titanium metadata, returned by {@link TiRecover.info}. */
export interface TitaniumInfo extends ManifestInfo {
  /** Whether the APK was built in Titanium "development" mode (plain sources). */
  developmentMode: boolean;
  /** Coarse Titanium engine version bucket: `"<5"`, `"5.x"` or `"unknown"`. */
  titaniumVersion: TitaniumVersion;
  /** Whether the project appears to be built with Alloy. */
  alloy: boolean;
  /** Recovered files and their sizes. */
  files: { name: string; bytes: number }[];
  /** Total number of recovered bytes across all files. */
  totalBytes: number;
}

export type TitaniumVersion = "<5" | "5.x" | "unknown";

/** Metadata collected while decrypting the asset blob. */
export interface DecryptMeta {
  totalBytes: number;
  titaniumVersion: TitaniumVersion;
  alloy: boolean;
}

/** Result of a decryption pass. */
export interface DecryptResult {
  files: MemorySource;
  meta: DecryptMeta;
}
