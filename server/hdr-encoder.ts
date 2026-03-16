import type { ProgressCallback } from "./cubemap-converter";

export function encodeHdr(pixels: Float32Array, width: number, height: number, onProgress?: ProgressCallback): Buffer {
  const report = onProgress || (() => {});
  const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\nSOFTWARE=CubeMapToHDRI\n\n-Y ${height} +X ${width}\n`;
  const headerBytes = Buffer.from(header, "ascii");

  report(91, "Converting pixels to RGBE format...");

  const scanlineBuffers: Buffer[] = [];

  for (let y = 0; y < height; y++) {
    const scanline = encodeScanline(pixels, y, width);
    scanlineBuffers.push(scanline);

    if (y % Math.max(1, Math.floor(height / 5)) === 0 && y > 0) {
      const p = Math.round(91 + (y / height) * 4);
      report(p, `RLE compressing scanline ${y} of ${height}...`);
    }
  }

  report(96, "Writing HDR file...");

  const totalSize =
    headerBytes.length +
    scanlineBuffers.reduce((sum, b) => sum + b.length, 0);

  const result = Buffer.alloc(totalSize);
  let offset = 0;

  headerBytes.copy(result, offset);
  offset += headerBytes.length;

  for (const scanline of scanlineBuffers) {
    scanline.copy(result, offset);
    offset += scanline.length;
  }

  return result;
}

function floatToRgbe(r: number, g: number, b: number): [number, number, number, number] {
  if (!isFinite(r)) r = 0;
  if (!isFinite(g)) g = 0;
  if (!isFinite(b)) b = 0;
  r = Math.max(0, r);
  g = Math.max(0, g);
  b = Math.max(0, b);

  const maxComp = Math.max(r, g, b);

  if (maxComp < 1e-32) {
    return [0, 0, 0, 0];
  }

  const exp = Math.ceil(Math.log2(maxComp));
  const scale = Math.pow(2, -exp) * 256;

  return [
    Math.min(255, Math.max(0, Math.round(r * scale))),
    Math.min(255, Math.max(0, Math.round(g * scale))),
    Math.min(255, Math.max(0, Math.round(b * scale))),
    exp + 128,
  ];
}

function encodeScanline(pixels: Float32Array, y: number, width: number): Buffer {
  if (width < 8 || width > 32767) {
    const raw = Buffer.alloc(width * 4);
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [re, ge, be, e] = floatToRgbe(
        pixels[idx],
        pixels[idx + 1],
        pixels[idx + 2]
      );
      raw[x * 4] = re;
      raw[x * 4 + 1] = ge;
      raw[x * 4 + 2] = be;
      raw[x * 4 + 3] = e;
    }
    return raw;
  }

  const header = Buffer.alloc(4);
  header[0] = 2;
  header[1] = 2;
  header[2] = (width >> 8) & 0xff;
  header[3] = width & 0xff;

  const channels: Uint8Array[] = [];
  for (let c = 0; c < 4; c++) {
    channels.push(new Uint8Array(width));
  }

  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    const [re, ge, be, e] = floatToRgbe(
      pixels[idx],
      pixels[idx + 1],
      pixels[idx + 2]
    );
    channels[0][x] = re;
    channels[1][x] = ge;
    channels[2][x] = be;
    channels[3][x] = e;
  }

  const encodedChannels: Buffer[] = [];
  for (let c = 0; c < 4; c++) {
    encodedChannels.push(rleEncodeChannel(channels[c], width));
  }

  const totalLen =
    4 + encodedChannels.reduce((sum, b) => sum + b.length, 0);
  const result = Buffer.alloc(totalLen);
  let offset = 0;

  header.copy(result, offset);
  offset += 4;

  for (const ch of encodedChannels) {
    ch.copy(result, offset);
    offset += ch.length;
  }

  return result;
}

function rleEncodeChannel(data: Uint8Array, width: number): Buffer {
  const output: number[] = [];
  let pos = 0;

  while (pos < width) {
    let runStart = pos;

    if (pos + 1 < width && data[pos] === data[pos + 1]) {
      let runLen = 1;
      while (
        pos + runLen < width &&
        runLen < 127 &&
        data[pos + runLen] === data[pos]
      ) {
        runLen++;
      }
      output.push(runLen + 128);
      output.push(data[pos]);
      pos += runLen;
    } else {
      let nonRunLen = 0;
      const startPos = pos;

      while (pos + nonRunLen < width && nonRunLen < 128) {
        if (
          pos + nonRunLen + 1 < width &&
          pos + nonRunLen + 2 < width &&
          data[pos + nonRunLen] === data[pos + nonRunLen + 1] &&
          data[pos + nonRunLen] === data[pos + nonRunLen + 2]
        ) {
          break;
        }
        nonRunLen++;
      }

      if (nonRunLen > 0) {
        output.push(nonRunLen);
        for (let i = 0; i < nonRunLen; i++) {
          output.push(data[startPos + i]);
        }
        pos += nonRunLen;
      } else {
        output.push(1);
        output.push(data[pos]);
        pos++;
      }
    }
  }

  return Buffer.from(output);
}
