import type { ProgressCallback } from "./cubemap-converter";

function floatToHalf(val: number): number {
  const floatView = new Float32Array(1);
  const int32View = new Int32Array(floatView.buffer);
  floatView[0] = val;
  const f = int32View[0];

  const sign = (f >>> 31) & 0x1;
  const exp = (f >>> 23) & 0xff;
  const frac = f & 0x7fffff;

  if (exp === 0) {
    return sign << 15;
  }

  if (exp === 0xff) {
    return (sign << 15) | 0x7c00 | (frac ? 0x0200 : 0);
  }

  const unbiasedExp = exp - 127;

  if (unbiasedExp > 15) {
    return (sign << 15) | 0x7c00;
  }

  if (unbiasedExp < -14) {
    const shift = -14 - unbiasedExp + 13;
    if (shift >= 24) return sign << 15;
    const halfFrac = (0x800000 | frac) >> shift;
    return (sign << 15) | (halfFrac & 0x3ff);
  }

  return (sign << 15) | ((unbiasedExp + 15) << 10) | (frac >> 13);
}

export function encodeDds(pixels: Float32Array, width: number, height: number, onProgress?: ProgressCallback): Buffer {
  const report = onProgress || (() => {});
  const DDS_MAGIC = 0x20534444;
  const DDSD_CAPS = 0x1;
  const DDSD_HEIGHT = 0x2;
  const DDSD_WIDTH = 0x4;
  const DDSD_PITCH = 0x8;
  const DDSD_PIXELFORMAT = 0x1000;
  const DDPF_FOURCC = 0x4;
  const DDSCAPS_TEXTURE = 0x1000;

  const DXGI_FORMAT_R16G16B16A16_FLOAT = 10;

  const bytesPerPixel = 8;
  const pitchOrLinearSize = width * bytesPerPixel;

  const headerSize = 128;
  const dx10HeaderSize = 20;
  const pixelDataSize = width * height * bytesPerPixel;
  const totalSize = headerSize + dx10HeaderSize + pixelDataSize;

  report(91, "Writing DDS header (RGBA16F / DX10)...");

  const buf = Buffer.alloc(totalSize);
  let offset = 0;

  buf.writeUInt32LE(DDS_MAGIC, offset); offset += 4;

  buf.writeUInt32LE(124, offset); offset += 4;

  const flags = DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PITCH | DDSD_PIXELFORMAT;
  buf.writeUInt32LE(flags, offset); offset += 4;

  buf.writeUInt32LE(height, offset); offset += 4;
  buf.writeUInt32LE(width, offset); offset += 4;
  buf.writeUInt32LE(pitchOrLinearSize, offset); offset += 4;

  buf.writeUInt32LE(0, offset); offset += 4;
  buf.writeUInt32LE(1, offset); offset += 4;

  offset += 44;

  buf.writeUInt32LE(32, offset); offset += 4;
  buf.writeUInt32LE(DDPF_FOURCC, offset); offset += 4;

  buf.write("DX10", offset, 4, "ascii"); offset += 4;

  offset += 20;

  buf.writeUInt32LE(DDSCAPS_TEXTURE, offset); offset += 4;

  offset += 16;

  const dx10Offset = 128;
  buf.writeUInt32LE(DXGI_FORMAT_R16G16B16A16_FLOAT, dx10Offset);
  buf.writeUInt32LE(3, dx10Offset + 4);
  buf.writeUInt32LE(0, dx10Offset + 8);
  buf.writeUInt32LE(1, dx10Offset + 12);
  buf.writeUInt32LE(0, dx10Offset + 16);

  report(93, "Writing half-float pixel data...");

  const dataOffset = headerSize + dx10HeaderSize;
  const dataView = new DataView(buf.buffer, buf.byteOffset + dataOffset, pixelDataSize);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = (y * width + x) * 8;

      const r = floatToHalf(pixels[srcIdx]);
      const g = floatToHalf(pixels[srcIdx + 1]);
      const b = floatToHalf(pixels[srcIdx + 2]);
      const a = floatToHalf(1.0);

      dataView.setUint16(dstIdx, r, true);
      dataView.setUint16(dstIdx + 2, g, true);
      dataView.setUint16(dstIdx + 4, b, true);
      dataView.setUint16(dstIdx + 6, a, true);
    }

    if (y % Math.max(1, Math.floor(height / 5)) === 0 && y > 0) {
      const p = Math.round(93 + (y / height) * 3);
      report(p, `Writing DDS row ${y} of ${height}...`);
    }
  }

  return buf;
}
