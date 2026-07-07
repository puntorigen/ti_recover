/**
 * Small async filesystem helpers used across the library.
 */
import { stat } from "node:fs/promises";

/** Resolves to `true` if `filePath` exists and is a regular file. */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

/** Resolves to `true` if `dirPath` exists and is a directory. */
export async function dirExists(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}
