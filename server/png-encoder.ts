import zlib from "zlib";
import type { ProgressCallback } from "./cubemap-converter";

const crc32Table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crc32Table[n] = c;
}

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = crc32Table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeB, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeB, data, crcBuf]);
}

export async function encodePng16(
  pixels: Float32Array,
  width: number,
  height: number,
  onProgress?: ProgressCallback
): Promise<Buffer> {
  const report = onProgress || (() => {});

  report(91, "Preparing 16-bit scanlines...");

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 16;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowBytes = 1 + width * 3 * 2;
  const rawData = Buffer.alloc(rowBytes * height);

  for (let y = 0; y < height; y++) {
    const rowOff = y * rowBytes;
    rawData[rowOff] = 0;
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstOff = rowOff + 1 + x * 6;

      for (let c = 0; c < 3; c++) {
        let val = pixels[srcIdx + c];
        if (!isFinite(val)) val = 0;
        val = Math.max(0, val);
        val = val / (1.0 + val);
        val = Math.pow(val, 1.0 / 2.2);
        rawData.writeUInt16BE(Math.round(Math.min(1, val) * 65535), dstOff + c * 2);
      }
    }

    if (y % Math.max(1, Math.floor(height / 4)) === 0 && y > 0) {
      const p = Math.round(91 + (y / height) * 3);
      report(p, `Preparing scanline ${y} of ${height}...`);
    }
  }

  report(94, "Deflate compressing pixel data...");

  const compressed = zlib.deflateSync(rawData, { level: 6 });

  report(96, "Writing PNG chunks...");

  const srgb = Buffer.alloc(1);
  srgb[0] = 0;

  const gama = Buffer.alloc(4);
  gama.writeUInt32BE(45455, 0);

  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdr),
    makeChunk("sRGB", srgb),
    makeChunk("gAMA", gama),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}
