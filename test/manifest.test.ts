import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { parseManifest, parseBinaryManifest, isBinaryManifest } from "../src/manifest.js";
import { readManifest } from "../src/manifest.js";

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));
const binaryManifest = readFileSync(`${fixturesDir}/AndroidManifest.bin`);

describe("parseManifest", () => {
  it("extracts package, versions and app name from an AndroidManifest", () => {
    const xml = `<?xml version="1.0"?>
      <manifest xmlns:android="http://schemas.android.com/apk/res/android"
        package="com.example.demo"
        android:versionCode="7"
        android:versionName="2.1.0">
        <application android:label="DemoApp" />
      </manifest>`;
    const info = parseManifest(xml, "/tmp/apk");
    expect(info.package).toBe("com.example.demo");
    expect(info.versionCode).toBe("7");
    expect(info.versionName).toBe("2.1.0");
    expect(info.appName).toBe("DemoApp");
    expect(info.dir).toBe("/tmp/apk");
  });

  it("returns undefined fields for a manifest without them", () => {
    const info = parseManifest('<manifest package="only.pkg"></manifest>');
    expect(info.package).toBe("only.pkg");
    expect(info.versionName).toBeUndefined();
    expect(info.appName).toBeUndefined();
  });
});

describe("isBinaryManifest", () => {
  it("recognises the AXML magic and rejects text", () => {
    expect(isBinaryManifest(binaryManifest)).toBe(true);
    expect(isBinaryManifest(Buffer.from("<?xml version=\"1.0\"?>"))).toBe(false);
  });
});

describe("parseBinaryManifest", () => {
  it("extracts package/versions/label from a binary AXML manifest", () => {
    const { info } = parseBinaryManifest(binaryManifest, "/tmp/apk");
    expect(info.package).toBe("com.example.tibin");
    expect(info.versionCode).toBe("99");
    expect(info.versionName).toBe("3.2.1");
    expect(info.appName).toBe("TiBinApp");
    expect(info.dir).toBe("/tmp/apk");
  });

  it("serialises a readable XML copy with the android namespace", () => {
    const { xml } = parseBinaryManifest(binaryManifest);
    expect(xml).toContain("<?xml");
    expect(xml).toContain('xmlns:android="http://schemas.android.com/apk/res/android"');
    expect(xml).toContain('package="com.example.tibin"');
    expect(xml).toContain('android:versionName="3.2.1"');
    expect(xml).toContain('android:label="TiBinApp"');
    expect(xml).toContain("<application");
  });
});

describe("readManifest", () => {
  it("reads and parses the (text) fixture manifest", async () => {
    const info = await readManifest(fixturesDir);
    expect(info).not.toBeNull();
    expect(info?.package).toBe("cl.pabloschaffner.recovered");
    expect(info?.versionCode).toBe("42");
    expect(info?.versionName).toBe("1.3.0");
    expect(info?.appName).toBe("RecoveredApp");
  });

  it("returns null when the manifest is missing", async () => {
    const info = await readManifest("/nonexistent/dir");
    expect(info).toBeNull();
  });
});
