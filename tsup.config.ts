import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm", "cjs"],
  dts: { entry: { index: "src/index.ts" } },
  target: "node18",
  platform: "node",
  clean: true,
  sourcemap: true,
  // Provides working `import.meta.url` in the CJS bundle and `__dirname` in the
  // ESM bundle (used for `createRequire` when loading adbkit-apkreader).
  shims: true,
});
