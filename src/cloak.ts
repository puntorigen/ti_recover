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
 * into every `libti.cloak.so` (exported as the `KEY_BLOCK` symbol), from which
 * the AES key is `salt XOR xor`, where `xor` is assembled from four 4-byte
 * slices of that block. This mirrors the technique documented by @hacker1024
 * and @j4k0xb in ti_recover issues #6 and #13.
 *
 * The file offset of `KEY_BLOCK` varies by ABI/SDK/compile flags (e.g. arm64
 * 0x2008, x86 0x2004, x86_64 0x2010, armeabi-v7a 0x3004/0x4004). Rather than
 * hardcode one, we resolve the exported `KEY_BLOCK` symbol via a tiny ELF
 * parser ({@link extractKeyBlock}); if that fails we fall back to the known
 * offsets. Every candidate is confirmed by trial decryption (see
 * {@link pickCloakKey}), so a wrong-arch candidate can never be selected.
 */
import { createDecipheriv } from "node:crypto";
import { gunzipSync } from "node:zlib";

/** IV/salt length and AES-128 key length. */
const KEY_LEN = 16;

/** Size of the embedded `KEY_BLOCK` (64 bytes). */
const BLOCK_LEN = 0x40;

/**
 * Known `KEY_BLOCK` file offsets across shipped `ti.cloak` ABIs/SDKs, tried
 * only as a fallback when ELF symbol resolution fails (see issue #13).
 */
const FALLBACK_BLOCK_OFFSETS = [0x2008, 0x2004, 0x2010, 0x3004, 0x4004];

/**
 * Locates the 64-byte `KEY_BLOCK` inside a `libti.cloak.so` by reading its
 * exported symbol from the ELF (works for ELF32/ELF64, any ABI). Returns the
 * block bytes, or `null` if the symbol can't be resolved.
 */
export function extractKeyBlock(so: Buffer): Buffer | null {
  try {
    if (so.length < 0x40) return null;
    // ELF magic: 0x7f 'E' 'L' 'F'
    if (so[0] !== 0x7f || so[1] !== 0x45 || so[2] !== 0x4c || so[3] !== 0x46) return null;

    const is64 = so[4] === 2;
    const le = so[5] !== 2;
    const u16 = (o: number): number => (le ? so.readUInt16LE(o) : so.readUInt16BE(o));
    const u32 = (o: number): number => (le ? so.readUInt32LE(o) : so.readUInt32BE(o));
    const u64 = (o: number): number => Number(le ? so.readBigUInt64LE(o) : so.readBigUInt64BE(o));

    const shoff = is64 ? u64(0x28) : u32(0x20);
    const shentsize = u16(is64 ? 0x3a : 0x2e);
    const shnum = u16(is64 ? 0x3c : 0x30);
    if (shoff === 0 || shnum === 0 || shentsize === 0) return null;

    interface Section {
      type: number;
      addr: number;
      offset: number;
      size: number;
      link: number;
      entsize: number;
    }
    const secs: Section[] = [];
    for (let i = 0; i < shnum; i++) {
      const b = shoff + i * shentsize;
      if (b + shentsize > so.length) return null;
      secs.push(
        is64
          ? {
              type: u32(b + 4),
              addr: u64(b + 0x10),
              offset: u64(b + 0x18),
              size: u64(b + 0x20),
              link: u32(b + 0x28),
              entsize: u64(b + 0x38),
            }
          : {
              type: u32(b + 4),
              addr: u32(b + 0x0c),
              offset: u32(b + 0x10),
              size: u32(b + 0x14),
              link: u32(b + 0x18),
              entsize: u32(b + 0x24),
            },
      );
    }

    const SHT_SYMTAB = 2;
    const SHT_DYNSYM = 11;
    // KEY_BLOCK is an exported (dynamic) symbol; prefer .dynsym, else .symtab.
    const symSec = secs.find((s) => s.type === SHT_DYNSYM) ?? secs.find((s) => s.type === SHT_SYMTAB);
    const strSec = symSec ? secs[symSec.link] : undefined;
    if (!symSec || !strSec) return null;

    const symEnt = is64 ? 24 : 16;
    const count = Math.floor(symSec.size / (symSec.entsize || symEnt));
    for (let i = 0; i < count; i++) {
      const s = symSec.offset + i * symEnt;
      if (s + symEnt > so.length) break;
      const nameOff = strSec.offset + u32(s);
      if (nameOff <= 0 || nameOff >= so.length) continue;
      let end = nameOff;
      while (end < so.length && so[end] !== 0) end++;
      if (so.toString("latin1", nameOff, end) !== "KEY_BLOCK") continue;

      const value = is64 ? u64(s + 8) : u32(s + 4);
      const shndx = u16(s + (is64 ? 6 : 0x0e));
      // Map the symbol's virtual address to a file offset via its section.
      const host =
        secs[shndx]?.addr && value >= secs[shndx]!.addr && value < secs[shndx]!.addr + secs[shndx]!.size
          ? secs[shndx]
          : secs.find((x) => x.addr !== 0 && x.size > 0 && value >= x.addr && value < x.addr + x.size);
      if (!host) return null;
      const fileOff = value - host.addr + host.offset;
      if (fileOff < 0 || fileOff + BLOCK_LEN > so.length) return null;
      return so.subarray(fileOff, fileOff + BLOCK_LEN);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Applies the four-slice XOR recipe to a 64-byte `KEY_BLOCK`, yielding the
 * AES-128 key (`salt XOR xor`). Returns `null` on malformed input.
 */
export function deriveKeyFromBlock(block: Buffer, salt: Buffer): Buffer | null {
  if (salt.length !== KEY_LEN || block.length < BLOCK_LEN) return null;
  const randomOffset = block.readUInt8(0x3e);
  if (randomOffset + 4 > BLOCK_LEN) return null;
  const xor = Buffer.concat([
    block.subarray(1, 5),
    block.subarray(randomOffset, randomOffset + 4),
    block.subarray(0xf, 0xf + 4),
    block.subarray(0x1e, 0x1e + 4),
  ]);
  if (xor.length < KEY_LEN) return null;
  const key = Buffer.alloc(KEY_LEN);
  for (let i = 0; i < KEY_LEN; i++) key[i] = (salt[i] ?? 0) ^ (xor[i] ?? 0);
  return key;
}

/**
 * Collects candidate AES keys from one `libti.cloak.so`: the ELF-resolved
 * `KEY_BLOCK` first, then each known fallback offset. Keys are de-duplicated;
 * callers validate the right one by trial decryption ({@link pickCloakKey}).
 */
export function cloakKeyCandidates(so: Buffer, salt: Buffer): Buffer[] {
  if (salt.length !== KEY_LEN) return [];
  const blocks: Buffer[] = [];
  const elf = extractKeyBlock(so);
  if (elf) blocks.push(elf);
  for (const off of FALLBACK_BLOCK_OFFSETS) {
    if (off + BLOCK_LEN <= so.length) blocks.push(so.subarray(off, off + BLOCK_LEN));
  }
  const keys: Buffer[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const key = deriveKeyFromBlock(block, salt);
    if (!key) continue;
    const hex = key.toString("hex");
    if (seen.has(hex)) continue;
    seen.add(hex);
    keys.push(key);
  }
  return keys;
}

/**
 * Derives the AES key from a `libti.cloak.so` buffer and the `salt`, resolving
 * `KEY_BLOCK` via the ELF symbol table (falling back to known offsets). Returns
 * the first candidate, or `null` if none could be derived. Prefer
 * {@link pickCloakKey} when a sample asset is available, since it validates.
 */
export function deriveCloakKey(so: Buffer, salt: Buffer): Buffer | null {
  return cloakKeyCandidates(so, salt)[0] ?? null;
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
 * Tries each `libti.cloak.so` buffer, deriving every candidate key (ELF-resolved
 * plus known-offset fallbacks) and confirming it by decrypting `sampleBin` into
 * readable text. Returns the first working key, or `null` if none produce a
 * valid decryption.
 */
export function pickCloakKey(
  cloakLibs: Buffer[],
  salt: Buffer,
  sampleBin: Buffer,
): Buffer | null {
  for (const so of cloakLibs) {
    for (const key of cloakKeyCandidates(so, salt)) {
      const decrypted = decryptCloakAsset(sampleBin, key, salt);
      if (decrypted && isProbablyText(decrypted)) return key;
    }
  }
  return null;
}
