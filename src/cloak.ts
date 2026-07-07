/**
 * Recover Titanium's newer "ti.cloak" asset encryption in pure JS.
 *
 * Since ~Titanium SDK 8, distribution builds no longer embed the sources as one
 * blob in `AssetCryptImpl`. Instead each asset ships as an encrypted
 * `Resources/<name>.bin` file and is decrypted at runtime with
 * `AES/CBC/PKCS5Padding`, IV = a hardcoded `salt` (in `AssetCryptImpl`), and a
 * key produced by the native `libti.cloak.so` via `ti.cloak.Binding.getKey(salt)`.
 *
 * The native key is not truly dynamic: the build writes a fixed 64-byte block
 * into every `libti.cloak.so`, from which the AES key is `salt XOR xor`, where
 * `xor` is assembled from four 4-byte slices of that block. This mirrors the
 * technique documented by @hacker1024 and @j4k0xb in ti_recover issue #6.
 *
 * Because the exact block offset can vary by arch/SDK, callers should derive a
 * candidate key from each bundled `libti.cloak.so` and confirm it by trial
 * decryption (see {@link pickCloakKey}).
 */
import { createDecipheriv } from "node:crypto";
import { gunzipSync } from "node:zlib";

/** IV/salt length and AES-128 key length. */
const KEY_LEN = 16;

/** Base offset of the embedded key block inside `libti.cloak.so`. */
const BLOCK_BASE = 0x2008;

/**
 * Derives the AES key from a `libti.cloak.so` buffer and the `salt`.
 * Returns `null` if the buffer is too small or the salt is not 16 bytes.
 */
export function deriveCloakKey(so: Buffer, salt: Buffer): Buffer | null {
  if (salt.length !== KEY_LEN) return null;
  try {
    if (so.length < BLOCK_BASE + 0x40) return null;
    const randomOffset = so.readUInt8(BLOCK_BASE + 0x3e);
    const xor = Buffer.concat([
      so.subarray(BLOCK_BASE + 1, BLOCK_BASE + 5),
      so.subarray(BLOCK_BASE + randomOffset, BLOCK_BASE + randomOffset + 4),
      so.subarray(BLOCK_BASE + 0xf, BLOCK_BASE + 0xf + 4),
      so.subarray(BLOCK_BASE + 0x1e, BLOCK_BASE + 0x1e + 4),
    ]);
    if (xor.length < KEY_LEN) return null;
    const key = Buffer.alloc(KEY_LEN);
    for (let i = 0; i < KEY_LEN; i++) key[i] = (salt[i] ?? 0) ^ (xor[i] ?? 0);
    return key;
  } catch {
    return null;
  }
}

/**
 * Decrypts one `.bin` asset with AES-128-CBC (IV = salt), transparently
 * gunzipping the result when it is gzip-compressed. Returns `null` on failure.
 */
export function decryptCloakAsset(bin: Buffer, key: Buffer, salt: Buffer): Buffer | null {
  if (key.length !== KEY_LEN || salt.length !== KEY_LEN) return null;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, salt);
    decipher.setAutoPadding(true);
    let out = Buffer.concat([decipher.update(bin), decipher.final()]);
    if (out.length >= 2 && out[0] === 0x1f && out[1] === 0x8b) {
      try {
        out = gunzipSync(out);
      } catch {
        // not actually gzip; keep the decrypted bytes
      }
    }
    return out;
  } catch {
    return null;
  }
}

/** Heuristic: does this buffer look like decoded UTF-8 text (e.g. JS source)? */
export function isProbablyText(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 512));
  let control = 0;
  for (const b of sample) {
    // Allow tab/newline/carriage-return; count other C0 control bytes.
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32 || b === 127) control++;
  }
  return control / sample.length < 0.1;
}

/**
 * Tries each `libti.cloak.so` buffer, derives a candidate key and confirms it
 * by decrypting `sampleBin` into readable text. Returns the first working key,
 * or `null` if none produce a valid decryption.
 */
export function pickCloakKey(
  cloakLibs: Buffer[],
  salt: Buffer,
  sampleBin: Buffer,
): Buffer | null {
  for (const so of cloakLibs) {
    const key = deriveCloakKey(so, salt);
    if (!key) continue;
    const decrypted = decryptCloakAsset(sampleBin, key, salt);
    if (decrypted && isProbablyText(decrypted)) return key;
  }
  return null;
}
