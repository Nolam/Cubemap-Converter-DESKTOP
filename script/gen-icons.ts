import sharp from "sharp";
import pngToIco from "png-to-ico";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";

const BUILD_DIR = path.resolve(import.meta.dirname || __dirname, "..", "build");
const SVG_PATH = path.join(BUILD_DIR, "icon.svg");

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const ICNS_ENTRIES: { osType: string; size: number }[] = [
  { osType: "ic07", size: 128 },
  { osType: "ic08", size: 256 },
  { osType: "ic09", size: 512 },
  { osType: "ic10", size: 1024 },
  { osType: "ic11", size: 32 },
  { osType: "ic12", size: 64 },
  { osType: "ic13", size: 256 },
  { osType: "ic14", size: 512 },
];

function buildIcns(pngBuffers: Map<number, Buffer>): Buffer {
  const entries: { osType: string; data: Buffer }[] = [];
  for (const { osType, size } of ICNS_ENTRIES) {
    const png = pngBuffers.get(size);
    if (png) {
      entries.push({ osType, data: png });
    }
  }

  let totalSize = 8;
  for (const entry of entries) {
    totalSize += 8 + entry.data.length;
  }

  const buf = Buffer.alloc(totalSize);
  buf.write("icns", 0, 4, "ascii");
  buf.writeUInt32BE(totalSize, 4);

  let offset = 8;
  for (const entry of entries) {
    buf.write(entry.osType, offset, 4, "ascii");
    buf.writeUInt32BE(8 + entry.data.length, offset + 4);
    entry.data.copy(buf, offset + 8);
    offset += 8 + entry.data.length;
  }

  return buf;
}

async function main() {
  mkdirSync(BUILD_DIR, { recursive: true });

  const svgData = readFileSync(SVG_PATH);

  console.log("Rendering SVG to PNG at 1024x1024...");
  const png1024 = await sharp(svgData, { density: 300 })
    .resize(1024, 1024)
    .png()
    .toBuffer();
  writeFileSync(path.join(BUILD_DIR, "icon.png"), png1024);
  console.log("  -> build/icon.png");

  const allSizes = new Set([...ICO_SIZES, ...ICNS_ENTRIES.map((e) => e.size)]);
  const pngBuffers = new Map<number, Buffer>();
  pngBuffers.set(1024, png1024);

  for (const size of allSizes) {
    if (size === 1024) continue;
    const buf = await sharp(svgData, { density: 300 })
      .resize(size, size)
      .png()
      .toBuffer();
    pngBuffers.set(size, buf);
  }

  console.log("Creating ICO (Windows)...");
  const icoInputs = ICO_SIZES.map((s) => pngBuffers.get(s)!);
  const icoBuffer = await pngToIco(icoInputs);
  writeFileSync(path.join(BUILD_DIR, "icon.ico"), icoBuffer);
  console.log("  -> build/icon.ico");

  console.log("Creating ICNS (macOS)...");
  const icnsBuffer = buildIcns(pngBuffers);
  writeFileSync(path.join(BUILD_DIR, "icon.icns"), icnsBuffer);
  console.log("  -> build/icon.icns");

  console.log("Done! Generated icon files in build/");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
