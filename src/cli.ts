#!/usr/bin/env node
/**
 * ti_recover command-line interface.
 */
import { Command } from "commander";
import pc from "picocolors";
import { TiRecover, recover, type TitaniumInfo } from "./index.js";

const EXIT_ERROR = 1;
const EXIT_NOT_TITANIUM = 2;

const program = new Command();

program
  .name("ti_recover")
  .description("Recover the source code from an Appcelerator Titanium APK.")
  .version("2.2.0");

program
  .command("recover", { isDefault: true })
  .description("Recover source code and assets from an APK into a directory.")
  .argument("<apk>", "path to the .apk file")
  .argument("<outdir>", "directory to write the recovered project into")
  .option("--no-reconstruct", "keep the flat recovered layout instead of a Titanium project")
  .option("--keep-tmp", "keep the temporary working directory")
  .option("--tmp-dir <dir>", "temporary working directory", "_tmp")
  .option("--json", "print recovery info as JSON")
  .option("-q, --quiet", "suppress progress output")
  .option("-d, --debug", "verbose logging")
  .action(async (apk: string, outdir: string, opts) => {
    const quiet = Boolean(opts.quiet);
    if (!quiet) {
      console.log(
        `${pc.yellow("Appcelerator Titanium")} - ${pc.green(pc.underline("APK Source Code Recovery Tool"))}`,
      );
    }
    try {
      const result = await recover({
        apk,
        outDir: outdir,
        reconstruct: opts.reconstruct,
        clean: !opts.keepTmp,
        tmpDir: opts.tmpDir,
        debug: Boolean(opts.debug),
      });

      if (!result.recovered) {
        console.error(
          pc.red("The given APK was not created using Appcelerator Titanium."),
        );
        process.exitCode = EXIT_NOT_TITANIUM;
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(result.info, null, 2));
      } else if (!quiet) {
        printInfo(result.info);
        console.log(pc.green(`\nRecovered ${result.files?.length ?? 0} file(s) to ${outdir}`));
      }
    } catch (err) {
      console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = EXIT_ERROR;
    }
  });

program
  .command("info")
  .description("Print Titanium metadata about an APK without writing sources.")
  .argument("<apk>", "path to the .apk file")
  .option("--keep-tmp", "keep the temporary working directory")
  .option("--tmp-dir <dir>", "temporary working directory", "_tmp")
  .option("--json", "print info as JSON (default is a formatted summary)")
  .option("-d, --debug", "verbose logging")
  .action(async (apk: string, opts) => {
    const ti = new TiRecover({ apk, tmpDir: opts.tmpDir, debug: Boolean(opts.debug) });
    try {
      await ti.init();
      if (!(await ti.test())) {
        console.error(pc.red("The given APK was not created using Appcelerator Titanium."));
        process.exitCode = EXIT_NOT_TITANIUM;
        return;
      }
      await ti.extract();
      const info = await ti.info();
      if (opts.json) {
        console.log(JSON.stringify(info, null, 2));
      } else {
        printInfo(info);
      }
    } catch (err) {
      console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = EXIT_ERROR;
    } finally {
      if (!opts.keepTmp) await ti.clean();
    }
  });

function printInfo(info?: TitaniumInfo): void {
  if (!info) return;
  const row = (label: string, value: unknown) =>
    console.log(`  ${pc.dim(label.padEnd(16))} ${value ?? pc.dim("(unknown)")}`);
  console.log(pc.bold("\nTitanium APK info:"));
  row("App name", info.appName);
  row("Package", info.package);
  row("Version", info.versionName);
  row("Version code", info.versionCode);
  row("Mode", info.developmentMode ? "development" : "distribution");
  row("Titanium", info.titaniumVersion);
  row("Alloy", info.alloy ? "yes" : "no");
  row("Files", info.files.length);
  row("Total bytes", info.totalBytes);
}

// Exit explicitly once the command finishes so any lingering worker handles
// (e.g. fflate's async unzip pool) don't hold the process open.
program
  .parseAsync()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(EXIT_ERROR);
  });
