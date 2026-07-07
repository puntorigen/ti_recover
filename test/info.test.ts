import { describe, it, expect } from "vitest";
import { buildInfo } from "../src/info.js";
import type { DecryptMeta, ManifestInfo, MemorySource } from "../src/types.js";

const manifest: ManifestInfo = {
  package: "cl.pabloschaffner.recovered",
  versionCode: "42",
  versionName: "1.3.0",
  appName: "RecoveredApp",
  dir: "/tmp/apk",
};

const memory: MemorySource = {
  "app.js": { offset: 0, bytes: 128, content: "x" },
  "ui/index.js": { offset: 128, bytes: 256, content: "y" },
};

describe("buildInfo", () => {
  it("merges manifest, meta and file list for a distribution build", () => {
    const meta: DecryptMeta = { totalBytes: 384, titaniumVersion: "5.x", alloy: false };
    const info = buildInfo({ manifest, memorySource: memory, meta, developmentMode: false });
    expect(info.package).toBe("cl.pabloschaffner.recovered");
    expect(info.appName).toBe("RecoveredApp");
    expect(info.titaniumVersion).toBe("5.x");
    expect(info.alloy).toBe(false);
    expect(info.developmentMode).toBe(false);
    expect(info.totalBytes).toBe(384);
    expect(info.files).toHaveLength(2);
    expect(info.files).toContainEqual({ name: "app.js", bytes: 128 });
  });

  it("falls back to summing bytes and detecting alloy when meta is absent", () => {
    const devMemory: MemorySource = {
      "alloy.js": { offset: 0, bytes: 10, content: "" },
      "app.js": { offset: 0, bytes: 20, content: "" },
    };
    const info = buildInfo({
      manifest,
      memorySource: devMemory,
      developmentMode: true,
    });
    expect(info.developmentMode).toBe(true);
    expect(info.titaniumVersion).toBe("unknown");
    expect(info.alloy).toBe(true);
    expect(info.totalBytes).toBe(30);
  });

  it("tolerates a missing manifest", () => {
    const info = buildInfo({ manifest: null, memorySource: {}, developmentMode: false });
    expect(info.package).toBeUndefined();
    expect(info.files).toEqual([]);
    expect(info.totalBytes).toBe(0);
  });
});
