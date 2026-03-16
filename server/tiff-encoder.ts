import type { ProgressCallback } from "./cubemap-converter";

export function encodeTiff32(
  pixels: Float32Array,
  width: number,
  height: number,
  onProgress?: ProgressCallback
): Buffer {
  const report = onProgress || (() => {});
  const channelCount = 3;
  const bytesPerSample = 4;
  const rowBytes = width * channelCount * bytesPerSample;
  const imageDataSize = height * rowBytes;

  const ifdEntryCount = 11;
  const ifdSize = 2 + ifdEntryCount * 12 + 4;

  const bitsPerSampleSize = channelCount * 2;
  const sampleFormatSize = channelCount * 2;

  const headerSize = 8;
  let offset = headerSize;

  const imageDataOffset = offset;
  offset += imageDataSize;

  const ifdOffset = offset;
  offset += ifdSize;

  const bitsPerSampleOffset = offset;
  offset += bitsPerSampleSize;

  const sampleFormatOffset = offset;
  offset += sampleFormatSize;

  const totalSize = offset;
  const buf = Buffer.alloc(totalSize);

  buf[0] = 0x49;
  buf[1] = 0x49;
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(ifdOffset, 4);

  report(91, "Writing 32-bit float pixel data...");

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = imageDataOffset + y * rowBytes + x * channelCount * bytesPerSample;
      for (let c = 0; c < channelCount; c++) {
        let val = pixels[srcIdx + c];
        if (!isFinite(val)) val = 0;
        buf.writeFloatLE(val, dstIdx + c * bytesPerSample);
      }
    }

    if (y % Math.max(1, Math.floor(height / 5)) === 0 && y > 0) {
      const p = Math.round(91 + (y / height) * 5);
      report(p, `Writing TIFF row ${y} of ${height}...`);
    }
  }

  report(96, "Writing TIFF header and IFD...");

  let pos = ifdOffset;
  buf.writeUInt16LE(ifdEntryCount, pos);
  pos += 2;

  function writeEntry(tag: number, type: number, count: number, value: number) {
    buf.writeUInt16LE(tag, pos); pos += 2;
    buf.writeUInt16LE(type, pos); pos += 2;
    buf.writeUInt32LE(count, pos); pos += 4;
    buf.writeUInt32LE(value, pos); pos += 4;
  }

  writeEntry(256, 4, 1, width);
  writeEntry(257, 4, 1, height);
  writeEntry(258, 3, channelCount, bitsPerSampleOffset);
  writeEntry(259, 3, 1, 1);
  writeEntry(262, 3, 1, 2);
  writeEntry(273, 4, 1, imageDataOffset);
  writeEntry(277, 3, 1, channelCount);
  writeEntry(278, 4, 1, height);
  writeEntry(279, 4, 1, imageDataSize);
  writeEntry(284, 3, 1, 1);
  writeEntry(339, 3, channelCount, sampleFormatOffset);

  buf.writeUInt32LE(0, pos);

  for (let c = 0; c < channelCount; c++) {
    buf.writeUInt16LE(32, bitsPerSampleOffset + c * 2);
  }

  for (let c = 0; c < channelCount; c++) {
    buf.writeUInt16LE(3, sampleFormatOffset + c * 2);
  }

  return buf;
}
