import type { ProgressCallback } from "./cubemap-converter";

export function encodeExr(pixels: Float32Array, width: number, height: number, onProgress?: ProgressCallback): Buffer {
  const report = onProgress || (() => {});
  const channelNames = ["B", "G", "R"];
  const FLOAT_TYPE = 2;
  const HALF_TYPE = 1;

  const useHalf = true;
  const pixelType = useHalf ? HALF_TYPE : FLOAT_TYPE;
  const bytesPerChannel = useHalf ? 2 : 4;

  report(91, "Converting to 16-bit half-float precision...");

  const headerParts: Buffer[] = [];

  headerParts.push(Buffer.from([0x76, 0x2f, 0x31, 0x01]));
  const versionBuf = Buffer.alloc(4);
  versionBuf.writeUInt32LE(2);
  headerParts.push(versionBuf);

  function writeAttribute(name: string, type: string, value: Buffer) {
    const nameBuf = Buffer.from(name + "\0", "ascii");
    const typeBuf = Buffer.from(type + "\0", "ascii");
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeUInt32LE(value.length);
    headerParts.push(nameBuf, typeBuf, sizeBuf, value);
  }

  const channelsData: Buffer[] = [];
  for (const chName of channelNames) {
    const chBuf = Buffer.alloc(chName.length + 1 + 16);
    let off = 0;
    chBuf.write(chName, off, "ascii");
    off += chName.length + 1;
    chBuf.writeInt32LE(pixelType, off); off += 4;
    chBuf.writeUInt8(1, off); off += 1;
    chBuf.fill(0, off, off + 3); off += 3;
    chBuf.writeInt32LE(1, off); off += 4;
    chBuf.writeInt32LE(1, off); off += 4;
    channelsData.push(chBuf);
  }
  const chTerminator = Buffer.alloc(1, 0);
  const allChannels = Buffer.concat([...channelsData, chTerminator]);
  writeAttribute("channels", "chlist", allChannels);

  const compressionBuf = Buffer.alloc(1);
  compressionBuf.writeUInt8(0);
  writeAttribute("compression", "compression", compressionBuf);

  const dataWindowBuf = Buffer.alloc(16);
  dataWindowBuf.writeInt32LE(0, 0);
  dataWindowBuf.writeInt32LE(0, 4);
  dataWindowBuf.writeInt32LE(width - 1, 8);
  dataWindowBuf.writeInt32LE(height - 1, 12);
  writeAttribute("dataWindow", "box2i", dataWindowBuf);

  writeAttribute("displayWindow", "box2i", dataWindowBuf);

  const lineOrderBuf = Buffer.alloc(1);
  lineOrderBuf.writeUInt8(0);
  writeAttribute("lineOrder", "lineOrder", lineOrderBuf);

  const pixelAspectBuf = Buffer.alloc(4);
  pixelAspectBuf.writeFloatLE(1.0);
  writeAttribute("pixelAspectRatio", "float", pixelAspectBuf);

  const screenWindowCenterBuf = Buffer.alloc(8);
  screenWindowCenterBuf.writeFloatLE(0.0, 0);
  screenWindowCenterBuf.writeFloatLE(0.0, 4);
  writeAttribute("screenWindowCenter", "v2f", screenWindowCenterBuf);

  const screenWindowWidthBuf = Buffer.alloc(4);
  screenWindowWidthBuf.writeFloatLE(1.0);
  writeAttribute("screenWindowWidth", "float", screenWindowWidthBuf);

  headerParts.push(Buffer.alloc(1, 0));

  const headerBuf = Buffer.concat(headerParts);

  const scanlineDataSize = width * channelNames.length * bytesPerChannel;
  const offsetTableSize = height * 8;
  const offsetTableStart = headerBuf.length;

  const scanlineHeaders = 8;
  let dataStart = offsetTableStart + offsetTableSize;

  const offsets = Buffer.alloc(offsetTableSize);
  const scanlines: Buffer[] = [];

  report(93, "Writing EXR channels (B, G, R)...");

  for (let y = 0; y < height; y++) {
    offsets.writeUInt32LE(dataStart & 0xFFFFFFFF, y * 8);
    offsets.writeUInt32LE(Math.floor(dataStart / 0x100000000) & 0xFFFFFFFF, y * 8 + 4);

    const scanlineBuf = Buffer.alloc(scanlineHeaders + scanlineDataSize);
    scanlineBuf.writeInt32LE(y, 0);
    scanlineBuf.writeInt32LE(scanlineDataSize, 4);

    let writeOff = scanlineHeaders;

    for (let c = 0; c < channelNames.length; c++) {
      const channelIdx = channelNames[c] === "R" ? 0 : channelNames[c] === "G" ? 1 : 2;

      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * 4 + channelIdx;
        const val = pixels[srcIdx];

        const safeVal = isFinite(val) ? val : 0;

        if (useHalf) {
          const half = floatToHalf(safeVal);
          scanlineBuf.writeUInt16LE(half, writeOff);
          writeOff += 2;
        } else {
          scanlineBuf.writeFloatLE(safeVal, writeOff);
          writeOff += 4;
        }
      }
    }

    scanlines.push(scanlineBuf);
    dataStart += scanlineBuf.length;

    if (y % Math.max(1, Math.floor(height / 5)) === 0 && y > 0) {
      const p = Math.round(93 + (y / height) * 3);
      report(p, `Writing EXR scanline ${y} of ${height}...`);
    }
  }

  report(96, "Finalising scan offsets...");

  return Buffer.concat([headerBuf, offsets, ...scanlines]);
}

function floatToHalf(val: number): number {
  const buf = Buffer.alloc(4);
  buf.writeFloatLE(val);
  const f = buf.readUInt32LE();

  const sign = (f >> 31) & 0x1;
  const exp = (f >> 23) & 0xff;
  const mantissa = f & 0x7fffff;

  if (exp === 0) {
    return sign << 15;
  }

  if (exp === 0xff) {
    if (mantissa === 0) {
      return (sign << 15) | 0x7c00;
    }
    return (sign << 15) | 0x7c00 | (mantissa >> 13);
  }

  let newExp = exp - 127 + 15;

  if (newExp >= 31) {
    return (sign << 15) | 0x7c00;
  }

  if (newExp <= 0) {
    if (newExp < -10) {
      return sign << 15;
    }
    const m = (mantissa | 0x800000) >> (1 - newExp);
    return (sign << 15) | (m >> 13);
  }

  return (sign << 15) | (newExp << 10) | (mantissa >> 13);
}
