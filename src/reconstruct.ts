/**
 * Rebuild recovered sources into a structure that opens as a Titanium project.
 *
 * Distribution-mode recovery yields the *compiled* `Resources/`-relative files
 * (for both classic and Alloy apps). A classic `Resources/` project is runnable
 * and openable, so reconstruct normalises everything under `Resources/` and
 * synthesises a minimal `tiapp.xml` from the manifest info. For Alloy apps the
 * original `app/` sources (notably `.xml` views) cannot be derived from the
 * compiled output, so the compiled `Resources/` project is emitted as-is and
 * flagged via {@link ReconstructResult.alloy}.
 */
import { randomUUID } from "node:crypto";
import type { MemorySource, RecoveredFile, TitaniumInfo } from "./types.js";

export interface ReconstructResult {
  /** Remapped sources, everything nested under `Resources/`, plus `tiapp.xml`. */
  memorySource: MemorySource;
  /** The generated tiapp.xml content. */
  tiappXml: string;
  /** Whether the source appears to be an Alloy project. */
  alloy: boolean;
  /** Always true; signals that assets should be nested under `Resources/`. */
  restructured: true;
}

const RESOURCES_PREFIX = "Resources/";

/**
 * Produces a reconstructed, Titanium-openable project from recovered sources.
 */
export function reconstruct(memorySource: MemorySource, info: TitaniumInfo): ReconstructResult {
  const remapped: MemorySource = {};

  for (const [relPath, file] of Object.entries(memorySource)) {
    const normalized = relPath.replace(/^[/\\]+/, "").split("\\").join("/");
    const key = normalized.startsWith(RESOURCES_PREFIX)
      ? normalized
      : RESOURCES_PREFIX + normalized;
    remapped[key] = file;
  }

  const tiappXml = buildTiappXml(info);
  const tiappFile: RecoveredFile = {
    offset: 0,
    bytes: Buffer.byteLength(tiappXml, "utf8"),
    content: tiappXml,
  };
  remapped["tiapp.xml"] = tiappFile;

  return { memorySource: remapped, tiappXml, alloy: info.alloy, restructured: true };
}

/** Builds a minimal but valid classic `tiapp.xml` from recovered metadata. */
export function buildTiappXml(info: TitaniumInfo): string {
  const id = escapeXml(info.package || "com.recovered.app");
  const name = escapeXml(info.appName || info.package || "RecoveredApp");
  const version = escapeXml(info.versionName || "1.0.0");
  const guid = randomUUID();
  const alloyNote = info.alloy
    ? "\n    <!-- Reconstructed from an Alloy build: files under Resources/ are the\n         compiled output. Original app/ sources (views/styles) are not\n         recoverable from a distribution APK. -->"
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Reconstructed by ti_recover. Review before building. -->
<ti:app xmlns:ti="http://ti.appcelerator.org">${alloyNote}
    <id>${id}</id>
    <name>${name}</name>
    <version>${version}</version>
    <guid>${guid}</guid>
    <deployment-targets>
        <target device="android">true</target>
    </deployment-targets>
    <android xmlns:android="http://schemas.android.com/apk/res/android"/>
</ti:app>
`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
