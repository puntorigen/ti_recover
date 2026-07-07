import { describe, it, expect } from "vitest";
import { reconstruct, buildTiappXml } from "../src/reconstruct.js";
import type { MemorySource, TitaniumInfo } from "../src/types.js";

const baseInfo: TitaniumInfo = {
  package: "cl.pabloschaffner.recovered",
  versionCode: "42",
  versionName: "1.3.0",
  appName: "RecoveredApp",
  developmentMode: false,
  titaniumVersion: "5.x",
  alloy: false,
  files: [],
  totalBytes: 0,
};

const memory: MemorySource = {
  "app.js": { offset: 0, bytes: 5, content: "app" },
  "ui/index.js": { offset: 0, bytes: 5, content: "idx" },
};

describe("reconstruct", () => {
  it("nests every source under Resources/ and adds tiapp.xml", () => {
    const result = reconstruct(memory, baseInfo);
    expect(result.restructured).toBe(true);
    expect(Object.keys(result.memorySource).sort()).toEqual([
      "Resources/app.js",
      "Resources/ui/index.js",
      "tiapp.xml",
    ]);
    expect(result.memorySource["tiapp.xml"]?.content).toBe(result.tiappXml);
  });

  it("does not double-prefix files already under Resources/", () => {
    const already: MemorySource = {
      "Resources/app.js": { offset: 0, bytes: 5, content: "app" },
    };
    const result = reconstruct(already, baseInfo);
    expect(result.memorySource["Resources/app.js"]).toBeDefined();
    expect(result.memorySource["Resources/Resources/app.js"]).toBeUndefined();
  });

  it("normalizes windows-style separators and leading slashes", () => {
    const windows: MemorySource = {
      "\\ui\\win.js": { offset: 0, bytes: 5, content: "w" },
    };
    const result = reconstruct(windows, baseInfo);
    expect(result.memorySource["Resources/ui/win.js"]).toBeDefined();
  });

  it("carries the alloy flag through", () => {
    const result = reconstruct(memory, { ...baseInfo, alloy: true });
    expect(result.alloy).toBe(true);
    expect(result.tiappXml).toContain("Alloy build");
  });
});

describe("buildTiappXml", () => {
  it("includes app metadata and is well-formed", () => {
    const xml = buildTiappXml(baseInfo);
    expect(xml).toContain("<id>cl.pabloschaffner.recovered</id>");
    expect(xml).toContain("<name>RecoveredApp</name>");
    expect(xml).toContain("<version>1.3.0</version>");
    expect(xml).toMatch(/<guid>[0-9a-f-]{36}<\/guid>/);
  });

  it("escapes special characters and applies fallbacks", () => {
    const xml = buildTiappXml({
      ...baseInfo,
      package: undefined,
      appName: "A & B <app>",
      versionName: undefined,
    });
    expect(xml).toContain("A &amp; B &lt;app&gt;");
    expect(xml).toContain("<id>com.recovered.app</id>");
    expect(xml).toContain("<version>1.0.0</version>");
  });
});
