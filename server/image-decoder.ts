import sharp from "sharp";

export interface DecodedImage {
  pixels: Float32Array;
  width: number;
  height: number;
  bitDepth: number;
  channels: number;
}

const SUPPORTED_SHARP_EXTS = [".png", ".jpg", ".jpeg", ".tif", ".tiff"];
const SUPPORTED_TGA_EXTS = [".tga"];

export function isSupportedImageFormat(filename: string): boolean {
  const ext = filename.toLowerCase().replace(/^.*(\.[^.]+)$/, "$1");
  return [...SUPPORTED_SHARP_EXTS, ...SUPPORTED_TGA_EXTS].includes(ext);
}

export function isTgaFile(filename: string): boolean {
  const ext = filename.toLowerCase().replace(/^.*(\.[^.]+)$/, "$1");
  return SUPPORTED_TGA_EXTS.includes(ext);
}

export async function decodeImage(buffer: Buffer, filename: string): Promise<DecodedImage> {
  if (isTgaFile(filename)) {
    return decodeTga(buffer);
  }
  return decodeWithSharp(buffer);
}

async function decodeWithSharp(buffer: Buffer): Promise<DecodedImage> {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const width = metadata.width!;
  const height = metadata.height!;

  const rawPixels = await image
    .ensureAlpha()
    .raw()
    .toBuffer();

  const pixelCount = width * height;
  const expectedBytes8 = pixelCount * 4;
  const expectedBytes16 = pixelCount * 4 * 2;
  const pixels = new Float32Array(pixelCount * 4);

  let bitDepth: number;
  if (rawPixels.length === expectedBytes16) {
    bitDepth = 16;
    const scale = 1.0 / 65535.0;
    for (let i = 0; i < pixelCount * 4; i++) {
      pixels[i] = rawPixels.readUInt16LE(i * 2) * scale;
    }
  } else {
    bitDepth = 8;
    const scale = 1.0 / 255.0;
    const len = Math.min(rawPixels.length, expectedBytes8);
    for (let i = 0; i < len; i++) {
      pixels[i] = rawPixels[i] * scale;
    }
  }

  const channels = metadata.channels || (metadata.hasAlpha ? 4 : 3);

  return { pixels, width, height, bitDepth: metadata.depth === "ushort" ? 16 : bitDepth, channels };
}

function decodeTga(buffer: Buffer): DecodedImage {
  if (buffer.length < 18) {
    throw new Error("Invalid TGA file: too small");
  }

  const idLength = buffer[0];
  const colorMapType = buffer[1];
  const imageType = buffer[2];
  const width = buffer.readUInt16LE(12);
  const height = buffer.readUInt16LE(14);
  const bitsPerPixel = buffer[16];
  const descriptor = buffer[17];

  if (imageType !== 1 && imageType !== 2 && imageType !== 3 &&
      imageType !== 9 && imageType !== 10 && imageType !== 11) {
    throw new Error(`Unsupported TGA image type: ${imageType}`);
  }

  const bytesPerPixel = bitsPerPixel / 8;
  if (bytesPerPixel < 1 || bytesPerPixel > 4) {
    throw new Error(`Unsupported TGA bit depth: ${bitsPerPixel}`);
  }

  let colorMapSize = 0;
  if (colorMapType === 1) {
    const colorMapEntrySize = buffer[7];
    const colorMapLength = buffer.readUInt16LE(5);
    colorMapSize = Math.ceil(colorMapEntrySize / 8) * colorMapLength;
  }

  const dataOffset = 18 + idLength + colorMapSize;
  const isRle = imageType === 9 || imageType === 10 || imageType === 11;
  const isTopToBottom = (descriptor & 0x20) !== 0;

  const pixelCount = width * height;
  const rawPixels = new Uint8Array(pixelCount * bytesPerPixel);

  if (isRle) {
    let srcIdx = dataOffset;
    let dstIdx = 0;
    while (dstIdx < rawPixels.length && srcIdx < buffer.length) {
      const header = buffer[srcIdx++];
      const count = (header & 0x7F) + 1;
      if (header & 0x80) {
        const pixel = buffer.slice(srcIdx, srcIdx + bytesPerPixel);
        srcIdx += bytesPerPixel;
        for (let i = 0; i < count; i++) {
          for (let b = 0; b < bytesPerPixel; b++) {
            rawPixels[dstIdx++] = pixel[b];
          }
        }
      } else {
        for (let i = 0; i < count * bytesPerPixel; i++) {
          rawPixels[dstIdx++] = buffer[srcIdx++];
        }
      }
    }
  } else {
    buffer.copy(Buffer.from(rawPixels.buffer), 0, dataOffset, dataOffset + rawPixels.length);
  }

  const pixels = new Float32Array(pixelCount * 4);
  const scale = 1.0 / 255.0;

  for (let y = 0; y < height; y++) {
    const srcY = isTopToBottom ? y : (height - 1 - y);
    for (let x = 0; x < width; x++) {
      const srcIdx = (srcY * width + x) * bytesPerPixel;
      const dstIdx = (y * width + x) * 4;

      if (bytesPerPixel >= 3) {
        pixels[dstIdx] = rawPixels[srcIdx + 2] * scale;
        pixels[dstIdx + 1] = rawPixels[srcIdx + 1] * scale;
        pixels[dstIdx + 2] = rawPixels[srcIdx] * scale;
        pixels[dstIdx + 3] = bytesPerPixel === 4 ? rawPixels[srcIdx + 3] * scale : 1.0;
      } else if (bytesPerPixel === 1) {
        const gray = rawPixels[srcIdx] * scale;
        pixels[dstIdx] = gray;
        pixels[dstIdx + 1] = gray;
        pixels[dstIdx + 2] = gray;
        pixels[dstIdx + 3] = 1.0;
      }
    }
  }

  const channels = bytesPerPixel >= 3 ? (bytesPerPixel === 4 ? 4 : 3) : 1;
  return { pixels, width, height, bitDepth: 8, channels };
}
