/**
 * Generates `AndroidManifest.bin`: a minimal but valid binary Android XML
 * (AXML) manifest, used to exercise the binary-manifest parser without needing
 * a real APK. Regenerate with: `node test/fixtures/gen-axml.mjs`.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ANDROID_URI = "http://schemas.android.com/apk/res/android";

// String pool. Index 0 is an unused placeholder (AXML skips value refs <= 0).
const strings = [
  "", // 0
  ANDROID_URI, // 1
  "android", // 2
  "package", // 3
  "versionCode", // 4
  "versionName", // 5
  "manifest", // 6
  "application", // 7
  "label", // 8
  "com.example.tibin", // 9
  "3.2.1", // 10
  "TiBinApp", // 11
];

const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;

function encodeStringPool(list) {
  const encoded = list.map((s) => {
    const body = Buffer.from(s, "utf8");
    return Buffer.concat([Buffer.from([s.length & 0x7f, body.length & 0x7f]), body, Buffer.from([0])]);
  });
  const offsets = [];
  let acc = 0;
  for (const e of encoded) {
    offsets.push(acc);
    acc += e.length;
  }
  const data = Buffer.concat(encoded);
  const headerSize = 28;
  const stringsStart = headerSize + list.length * 4;
  let chunkSize = stringsStart + data.length;
  chunkSize += (4 - (chunkSize % 4)) % 4;

  const buf = Buffer.alloc(chunkSize);
  let p = 0;
  buf.writeUInt16LE(0x0001, p); p += 2;
  buf.writeUInt16LE(headerSize, p); p += 2;
  buf.writeUInt32LE(chunkSize, p); p += 4;
  buf.writeUInt32LE(list.length, p); p += 4;
  buf.writeUInt32LE(0, p); p += 4;
  buf.writeUInt32LE(0x100, p); p += 4; // UTF-8 flag
  buf.writeUInt32LE(stringsStart, p); p += 4;
  buf.writeUInt32LE(0, p); p += 4;
  for (const off of offsets) {
    buf.writeUInt32LE(off, p);
    p += 4;
  }
  data.copy(buf, stringsStart);
  return buf;
}

function namespaceChunk(type, prefixRef, uriRef) {
  const buf = Buffer.alloc(24);
  let p = 0;
  buf.writeUInt16LE(type, p); p += 2;
  buf.writeUInt16LE(0x0010, p); p += 2;
  buf.writeUInt32LE(24, p); p += 4;
  buf.writeUInt32LE(1, p); p += 4; // line
  buf.writeUInt32LE(0xffffffff, p); p += 4; // comment
  buf.writeInt32LE(prefixRef, p); p += 4;
  buf.writeInt32LE(uriRef, p); p += 4;
  return buf;
}

function encodeAttr(a) {
  const buf = Buffer.alloc(20);
  let p = 0;
  buf.writeInt32LE(a.nsRef, p); p += 4;
  buf.writeInt32LE(a.nameRef, p); p += 4;
  buf.writeInt32LE(a.valueRef, p); p += 4;
  buf.writeUInt16LE(8, p); p += 2; // typed value size
  buf.writeUInt8(0, p); p += 1;
  buf.writeUInt8(a.dataType, p); p += 1;
  buf.writeInt32LE(a.data, p); p += 4;
  return buf;
}

function startElement(nsRef, nameRef, attrs) {
  const size = 8 + 16 + 12 + attrs.length * 20;
  const buf = Buffer.alloc(size);
  let p = 0;
  buf.writeUInt16LE(0x0102, p); p += 2;
  buf.writeUInt16LE(0x0010, p); p += 2;
  buf.writeUInt32LE(size, p); p += 4;
  buf.writeUInt32LE(1, p); p += 4; // line
  buf.writeUInt32LE(0xffffffff, p); p += 4; // comment
  buf.writeInt32LE(nsRef, p); p += 4;
  buf.writeInt32LE(nameRef, p); p += 4;
  buf.writeUInt16LE(0x0014, p); p += 2; // attributeStart
  buf.writeUInt16LE(0x0014, p); p += 2; // attributeSize
  buf.writeUInt16LE(attrs.length, p); p += 2;
  buf.writeUInt16LE(0, p); p += 2; // idIndex
  buf.writeUInt16LE(0, p); p += 2; // classIndex
  buf.writeUInt16LE(0, p); p += 2; // styleIndex
  for (const a of attrs) {
    encodeAttr(a).copy(buf, p);
    p += 20;
  }
  return buf;
}

function endElement(nsRef, nameRef) {
  const buf = Buffer.alloc(24);
  let p = 0;
  buf.writeUInt16LE(0x0103, p); p += 2;
  buf.writeUInt16LE(0x0010, p); p += 2;
  buf.writeUInt32LE(24, p); p += 4;
  buf.writeUInt32LE(1, p); p += 4;
  buf.writeUInt32LE(0xffffffff, p); p += 4;
  buf.writeInt32LE(nsRef, p); p += 4;
  buf.writeInt32LE(nameRef, p); p += 4;
  return buf;
}

const manifestAttrs = [
  { nsRef: -1, nameRef: 3, valueRef: 9, dataType: TYPE_STRING, data: 9 }, // package
  { nsRef: 1, nameRef: 4, valueRef: -1, dataType: TYPE_INT_DEC, data: 99 }, // android:versionCode
  { nsRef: 1, nameRef: 5, valueRef: 10, dataType: TYPE_STRING, data: 10 }, // android:versionName
];
const appAttrs = [
  { nsRef: 1, nameRef: 8, valueRef: 11, dataType: TYPE_STRING, data: 11 }, // android:label
];

const body = Buffer.concat([
  encodeStringPool(strings),
  namespaceChunk(0x0100, 2, 1),
  startElement(-1, 6, manifestAttrs),
  startElement(-1, 7, appAttrs),
  endElement(-1, 7),
  endElement(-1, 6),
  namespaceChunk(0x0101, 2, 1),
]);

const header = Buffer.alloc(8);
header.writeUInt16LE(0x0003, 0);
header.writeUInt16LE(0x0008, 2);
header.writeUInt32LE(8 + body.length, 4);

const out = Buffer.concat([header, body]);
const dest = fileURLToPath(new URL("./AndroidManifest.bin", import.meta.url));
writeFileSync(dest, out);
console.log(`wrote ${out.length} bytes to ${dest}`);
