/**
 * Parse Android manifests.
 *
 * The main recovery path reads the APK's *binary* `AndroidManifest.xml` (AXML)
 * via adbkit-apkreader's binary XML parser and also serialises a readable XML
 * copy for the recovered output. A text parser (`parseManifest`) is kept for
 * the case where a caller points at a pre-decoded, textual manifest.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { load } from "cheerio";
import type { ManifestInfo } from "./types.js";
import { fileExists } from "./fs-utils.js";

const require = createRequire(import.meta.url);
// adbkit-apkreader ships no types; load its binary XML parser as a CJS module.
const BinaryXmlParser = require(
  "adbkit-apkreader/lib/apkreader/parser/binaryxml",
) as new (buffer: Buffer, options?: { debug?: boolean }) => { parse(): XmlNode };

interface XmlAttribute {
  namespaceURI: string | null;
  name: string;
  value: string | null;
  typedValue: { value: unknown; type: string } | null;
}

interface XmlNode {
  namespaceURI: string | null;
  nodeType: number;
  nodeName: string;
  attributes?: XmlAttribute[];
  childNodes?: XmlNode[];
}

const ANDROID_NS = "http://schemas.android.com/apk/res/android";

/** Binary AXML magic (`RES_XML_TYPE` = 0x0003 with header size 0x0008). */
export function isBinaryManifest(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0x03 && bytes[1] === 0x00;
}

function attr(node: XmlNode, name: string): XmlAttribute | undefined {
  return node.attributes?.find((a) => a.name === name);
}

function attrString(node: XmlNode, name: string): string | undefined {
  const a = attr(node, name);
  if (!a) return undefined;
  if (a.value != null) return a.value;
  const tv = a.typedValue?.value;
  return tv == null ? undefined : String(tv);
}

/**
 * Parses a binary `AndroidManifest.xml` buffer, returning both structured info
 * and a readable XML serialisation.
 */
export function parseBinaryManifest(bytes: Buffer, dir?: string): { info: ManifestInfo; xml: string } {
  const doc = new BinaryXmlParser(bytes).parse();
  const application = doc.childNodes?.find((n) => n.nodeName === "application");
  const info: ManifestInfo = {
    package: attrString(doc, "package"),
    versionCode: attrString(doc, "versionCode"),
    versionName: attrString(doc, "versionName"),
    appName: application ? attrString(application, "label") : undefined,
    dir,
  };
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n${serialize(doc)}\n`;
  return { info, xml };
}

/**
 * Text manifest parser (cheerio) for pre-decoded, human-readable manifests.
 */
export function parseManifest(xml: string, dir?: string): ManifestInfo {
  const $ = load(xml, { xml: true });
  return {
    package: $("manifest[package]").attr("package"),
    versionCode: $("manifest").attr("android:versionCode"),
    versionName: $("manifest").attr("android:versionName"),
    appName: $("manifest application").attr("android:label"),
    dir,
  };
}

/**
 * Reads `AndroidManifest.xml` from a directory, handling both binary (AXML) and
 * already-decoded text manifests. Returns `null` if the manifest is missing.
 */
export async function readManifest(apkDir: string): Promise<ManifestInfo | null> {
  const manifestPath = path.join(apkDir, "AndroidManifest.xml");
  if (!(await fileExists(manifestPath))) return null;
  const bytes = await readFile(manifestPath);
  if (isBinaryManifest(bytes)) {
    return parseBinaryManifest(bytes, apkDir).info;
  }
  return parseManifest(bytes.toString("utf8"), apkDir);
}

// ---------------------------------------------------------------------------
// Readable XML serialisation of the parsed manifest DOM.
// ---------------------------------------------------------------------------

function prefixFor(namespaceURI: string | null): string {
  if (!namespaceURI) return "";
  return namespaceURI === ANDROID_NS ? "android:" : "";
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function serialize(node: XmlNode, depth = 0): string {
  const indent = "    ".repeat(depth);
  const attrs: string[] = [];
  if (depth === 0) attrs.push(`xmlns:android="${ANDROID_NS}"`);
  for (const a of node.attributes ?? []) {
    const raw = a.value ?? (a.typedValue?.value == null ? "" : String(a.typedValue.value));
    attrs.push(`${prefixFor(a.namespaceURI)}${a.name}="${escapeXml(raw)}"`);
  }
  const attrText = attrs.length ? " " + attrs.join(" ") : "";
  const children = (node.childNodes ?? []).filter((c) => c.nodeType === 1);
  if (children.length === 0) {
    return `${indent}<${node.nodeName}${attrText} />`;
  }
  const inner = children.map((c) => serialize(c, depth + 1)).join("\n");
  return `${indent}<${node.nodeName}${attrText}>\n${inner}\n${indent}</${node.nodeName}>`;
}
