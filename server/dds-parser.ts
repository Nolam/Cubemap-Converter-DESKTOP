const DDS_MAGIC = 0x20534444;

const DDSD_CAPS = 0x1;
const DDSD_HEIGHT = 0x2;
const DDSD_WIDTH = 0x4;
const DDSD_PIXELFORMAT = 0x1000;
const DDSD_MIPMAPCOUNT = 0x20000;
const DDSD_LINEARSIZE = 0x80000;
const DDSD_DEPTH = 0x800000;

const DDSCAPS_COMPLEX = 0x8;
const DDSCAPS_TEXTURE = 0x1000;
const DDSCAPS_MIPMAP = 0x400000;

const DDSCAPS2_CUBEMAP = 0x200;
const DDSCAPS2_CUBEMAP_POSITIVEX = 0x400;
const DDSCAPS2_CUBEMAP_NEGATIVEX = 0x800;
const DDSCAPS2_CUBEMAP_POSITIVEY = 0x1000;
const DDSCAPS2_CUBEMAP_NEGATIVEY = 0x2000;
const DDSCAPS2_CUBEMAP_POSITIVEZ = 0x4000;
const DDSCAPS2_CUBEMAP_NEGATIVEZ = 0x8000;

const DDPF_ALPHAPIXELS = 0x1;
const DDPF_ALPHA = 0x2;
const DDPF_FOURCC = 0x4;
const DDPF_RGB = 0x40;
const DDPF_LUMINANCE = 0x20000;
const DDPF_BUMPDUDV = 0x80000;

const DXGI_FORMAT_R32G32B32A32_FLOAT = 2;
const DXGI_FORMAT_R32G32B32_FLOAT = 6;
const DXGI_FORMAT_R16G16B16A16_FLOAT = 10;
const DXGI_FORMAT_R32G32_FLOAT = 16;
const DXGI_FORMAT_R16G16_FLOAT = 34;
const DXGI_FORMAT_R32_FLOAT = 41;
const DXGI_FORMAT_R16_FLOAT = 54;
const DXGI_FORMAT_R8G8B8A8_UNORM = 28;
const DXGI_FORMAT_B8G8R8A8_UNORM = 87;
const DXGI_FORMAT_BC6H_UF16 = 95;
const DXGI_FORMAT_BC6H_SF16 = 96;

function fourCC(str: string): number {
  return (
    str.charCodeAt(0) |
    (str.charCodeAt(1) << 8) |
    (str.charCodeAt(2) << 16) |
    (str.charCodeAt(3) << 24)
  );
}

export interface DdsHeader {
  width: number;
  height: number;
  mipMapCount: number;
  pixelFormat: {
    flags: number;
    fourCC: number;
    rgbBitCount: number;
    rBitMask: number;
    gBitMask: number;
    bBitMask: number;
    aBitMask: number;
  };
  caps: number;
  caps2: number;
  dx10Header?: {
    dxgiFormat: number;
    resourceDimension: number;
    miscFlag: number;
    arraySize: number;
    miscFlags2: number;
  };
}

export interface ParsedDds {
  header: DdsHeader;
  isCubemap: boolean;
  faceCount: number;
  format: string;
  faces: Float32Array[];
  faceWidth: number;
  faceHeight: number;
}

function float16ToFloat32(h: number): number {
  const sign = (h >> 15) & 0x1;
  const exponent = (h >> 10) & 0x1f;
  const mantissa = h & 0x3ff;

  if (exponent === 0) {
    if (mantissa === 0) {
      return sign ? -0 : 0;
    }
    const e = Math.pow(2, -14) * (mantissa / 1024);
    return sign ? -e : e;
  }

  if (exponent === 31) {
    if (mantissa === 0) {
      return sign ? -Infinity : Infinity;
    }
    return NaN;
  }

  const e = Math.pow(2, exponent - 15) * (1 + mantissa / 1024);
  return sign ? -e : e;
}

function decodeBC6H(data: Buffer, width: number, height: number, signed: boolean): Float32Array {
  const pixels = new Float32Array(width * height * 4);

  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  let blockOffset = 0;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const blockPixels = decodeBC6HBlock(data, blockOffset, signed);
      blockOffset += 16;

      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;

          const srcIdx = (py * 4 + px) * 3;
          const dstIdx = (y * width + x) * 4;
          pixels[dstIdx] = blockPixels[srcIdx];
          pixels[dstIdx + 1] = blockPixels[srcIdx + 1];
          pixels[dstIdx + 2] = blockPixels[srcIdx + 2];
          pixels[dstIdx + 3] = 1.0;
        }
      }
    }
  }

  return pixels;
}

function decodeBC6HBlock(data: Buffer, offset: number, signed: boolean): Float32Array {
  const result = new Float32Array(16 * 3);

  if (offset + 16 > data.length) {
    return result;
  }

  const bits = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bits[i] = data[offset + i];
  }

  const mode = bits[0] & 0x1f;

  let r0 = 0, g0 = 0, b0 = 0;
  let r1 = 0, g1 = 0, b1 = 0;

  const low = data.readUInt32LE(offset);
  const mid = data.readUInt32LE(offset + 4);

  if ((mode & 0x3) === 0) {
    r0 = (low >> 5) & 0x3ff;
    g0 = (low >> 15) & 0x3ff;
    b0 = ((low >> 25) & 0x7f) | (((mid >> 0) & 0x7) << 7);
    r1 = (mid >> 3) & 0x1f;
    g1 = (mid >> 8) & 0x1f;
    b1 = (mid >> 13) & 0x1f;

    r1 = signExtend(r1, 5, r0, 10);
    g1 = signExtend(g1, 5, g0, 10);
    b1 = signExtend(b1, 5, b0, 10);
  } else {
    r0 = (low >> 5) & 0xff;
    g0 = (low >> 13) & 0xff;
    b0 = (low >> 21) & 0xff;
    r1 = ((low >> 29) & 0x7) | (((mid >> 0) & 0x1f) << 3);
    g1 = (mid >> 5) & 0xff;
    b1 = (mid >> 13) & 0xff;
  }

  const f0r = unquantize(r0, 10, signed);
  const f0g = unquantize(g0, 10, signed);
  const f0b = unquantize(b0, 10, signed);
  const f1r = unquantize(r1, 10, signed);
  const f1g = unquantize(g1, 10, signed);
  const f1b = unquantize(b1, 10, signed);

  for (let i = 0; i < 16; i++) {
    const weight = getBC6HWeight(data, offset, i, mode);
    const w = weight / 63.0;
    const iw = 1.0 - w;

    result[i * 3 + 0] = Math.max(0, finishUnquantize(f0r * iw + f1r * w, signed));
    result[i * 3 + 1] = Math.max(0, finishUnquantize(f0g * iw + f1g * w, signed));
    result[i * 3 + 2] = Math.max(0, finishUnquantize(f0b * iw + f1b * w, signed));
  }

  return result;
}

function signExtend(val: number, bits: number, base: number, baseBits: number): number {
  const sign = (val >> (bits - 1)) & 1;
  if (sign) {
    val = val | (~0 << bits);
    val = (base + val) & ((1 << baseBits) - 1);
  } else {
    val = (base + val) & ((1 << baseBits) - 1);
  }
  return val;
}

function unquantize(val: number, bits: number, signed: boolean): number {
  if (signed) {
    if (bits >= 16) return val;
    const s = val >= (1 << (bits - 1));
    const abs = s ? ((1 << bits) - val) : val;
    const unq = ((abs * 31) >> (bits - 1));
    return s ? -unq : unq;
  } else {
    if (bits >= 15) return val;
    if (val === 0) return 0;
    if (val === ((1 << bits) - 1)) return 0xffff;
    return ((val << 15) + 0x4000) >> (bits - 1);
  }
}

function finishUnquantize(val: number, signed: boolean): number {
  if (signed) {
    const sign = val < 0;
    const abs = Math.abs(val);
    const result = (abs * 31) / 32;
    return float16ToFloat32(Math.round(sign ? -result : result) & 0xffff);
  } else {
    return float16ToFloat32(Math.round(val * 31 / 64) & 0xffff);
  }
}

function getBC6HWeight(data: Buffer, offset: number, index: number, mode: number): number {
  const bitOffset = 82 + index * 3;
  const byteIdx = Math.floor(bitOffset / 8);
  const bitIdx = bitOffset % 8;

  if (offset + byteIdx + 1 >= data.length) return 0;

  let val = (data[offset + byteIdx] >> bitIdx);
  if (bitIdx > 5 && offset + byteIdx + 1 < data.length) {
    val |= (data[offset + byteIdx + 1] << (8 - bitIdx));
  }

  return Math.min(val & 0x7, 7) * 9;
}

function decodePixelData(
  data: Buffer,
  dataOffset: number,
  width: number,
  height: number,
  header: DdsHeader
): Float32Array {
  const pixelCount = width * height;
  const pixels = new Float32Array(pixelCount * 4);

  if (header.dx10Header) {
    const fmt = header.dx10Header.dxgiFormat;

    if (fmt === DXGI_FORMAT_R32G32B32A32_FLOAT) {
      for (let i = 0; i < pixelCount; i++) {
        const off = dataOffset + i * 16;
        pixels[i * 4] = data.readFloatLE(off);
        pixels[i * 4 + 1] = data.readFloatLE(off + 4);
        pixels[i * 4 + 2] = data.readFloatLE(off + 8);
        pixels[i * 4 + 3] = data.readFloatLE(off + 12);
      }
      return pixels;
    }

    if (fmt === DXGI_FORMAT_R32G32B32_FLOAT) {
      for (let i = 0; i < pixelCount; i++) {
        const off = dataOffset + i * 12;
        pixels[i * 4] = data.readFloatLE(off);
        pixels[i * 4 + 1] = data.readFloatLE(off + 4);
        pixels[i * 4 + 2] = data.readFloatLE(off + 8);
        pixels[i * 4 + 3] = 1.0;
      }
      return pixels;
    }

    if (fmt === DXGI_FORMAT_R16G16B16A16_FLOAT) {
      for (let i = 0; i < pixelCount; i++) {
        const off = dataOffset + i * 8;
        pixels[i * 4] = float16ToFloat32(data.readUInt16LE(off));
        pixels[i * 4 + 1] = float16ToFloat32(data.readUInt16LE(off + 2));
        pixels[i * 4 + 2] = float16ToFloat32(data.readUInt16LE(off + 4));
        pixels[i * 4 + 3] = float16ToFloat32(data.readUInt16LE(off + 6));
      }
      return pixels;
    }

    if (fmt === DXGI_FORMAT_BC6H_UF16 || fmt === DXGI_FORMAT_BC6H_SF16) {
      const blocksX = Math.ceil(width / 4);
      const blocksY = Math.ceil(height / 4);
      const blockSize = 16;
      const compressedSize = blocksX * blocksY * blockSize;
      const blockData = data.subarray(dataOffset, dataOffset + compressedSize);
      return decodeBC6H(blockData as any, width, height, fmt === DXGI_FORMAT_BC6H_SF16);
    }

    if (fmt === DXGI_FORMAT_R8G8B8A8_UNORM || fmt === DXGI_FORMAT_B8G8R8A8_UNORM) {
      const isBGRA = fmt === DXGI_FORMAT_B8G8R8A8_UNORM;
      for (let i = 0; i < pixelCount; i++) {
        const off = dataOffset + i * 4;
        if (isBGRA) {
          pixels[i * 4] = data[off + 2] / 255.0;
          pixels[i * 4 + 1] = data[off + 1] / 255.0;
          pixels[i * 4 + 2] = data[off] / 255.0;
        } else {
          pixels[i * 4] = data[off] / 255.0;
          pixels[i * 4 + 1] = data[off + 1] / 255.0;
          pixels[i * 4 + 2] = data[off + 2] / 255.0;
        }
        pixels[i * 4 + 3] = data[off + 3] / 255.0;
      }
      return pixels;
    }
  }

  const pf = header.pixelFormat;

  if (pf.flags & DDPF_FOURCC) {
    const cc = pf.fourCC;

    if (cc === 116) {
      for (let i = 0; i < pixelCount; i++) {
        const off = dataOffset + i * 16;
        pixels[i * 4] = data.readFloatLE(off);
        pixels[i * 4 + 1] = data.readFloatLE(off + 4);
        pixels[i * 4 + 2] = data.readFloatLE(off + 8);
        pixels[i * 4 + 3] = data.readFloatLE(off + 12);
      }
      return pixels;
    }

    if (cc === 115) {
      for (let i = 0; i < pixelCount; i++) {
        const off = dataOffset + i * 8;
        pixels[i * 4] = data.readFloatLE(off);
        pixels[i * 4 + 1] = data.readFloatLE(off + 4);
        pixels[i * 4 + 2] = 0;
        pixels[i * 4 + 3] = 1.0;
      }
      return pixels;
    }

    if (cc === 114) {
      for (let i = 0; i < pixelCount; i++) {
        const off = dataOffset + i * 4;
        pixels[i * 4] = data.readFloatLE(off);
        pixels[i * 4 + 1] = 0;
        pixels[i * 4 + 2] = 0;
        pixels[i * 4 + 3] = 1.0;
      }
      return pixels;
    }

    if (cc === 113) {
      for (let i = 0; i < pixelCount; i++) {
        const off = dataOffset + i * 8;
        pixels[i * 4] = float16ToFloat32(data.readUInt16LE(off));
        pixels[i * 4 + 1] = float16ToFloat32(data.readUInt16LE(off + 2));
        pixels[i * 4 + 2] = float16ToFloat32(data.readUInt16LE(off + 4));
        pixels[i * 4 + 3] = float16ToFloat32(data.readUInt16LE(off + 6));
      }
      return pixels;
    }

    if (cc === 112) {
      for (let i = 0; i < pixelCount; i++) {
        const off = dataOffset + i * 4;
        pixels[i * 4] = float16ToFloat32(data.readUInt16LE(off));
        pixels[i * 4 + 1] = float16ToFloat32(data.readUInt16LE(off + 2));
        pixels[i * 4 + 2] = 0;
        pixels[i * 4 + 3] = 1.0;
      }
      return pixels;
    }

    if (cc === 111) {
      for (let i = 0; i < pixelCount; i++) {
        const off = dataOffset + i * 2;
        pixels[i * 4] = float16ToFloat32(data.readUInt16LE(off));
        pixels[i * 4 + 1] = 0;
        pixels[i * 4 + 2] = 0;
        pixels[i * 4 + 3] = 1.0;
      }
      return pixels;
    }
  }

  if (pf.flags & DDPF_RGB) {
    const bpp = pf.rgbBitCount / 8;
    const hasAlpha = !!(pf.flags & DDPF_ALPHAPIXELS);

    for (let i = 0; i < pixelCount; i++) {
      const off = dataOffset + i * bpp;
      let pixel = 0;
      for (let b = 0; b < bpp; b++) {
        pixel |= data[off + b] << (b * 8);
      }

      pixels[i * 4] = extractChannel(pixel, pf.rBitMask);
      pixels[i * 4 + 1] = extractChannel(pixel, pf.gBitMask);
      pixels[i * 4 + 2] = extractChannel(pixel, pf.bBitMask);
      pixels[i * 4 + 3] = hasAlpha ? extractChannel(pixel, pf.aBitMask) : 1.0;
    }
    return pixels;
  }

  for (let i = 0; i < pixelCount; i++) {
    const off = dataOffset + i * 4;
    if (off + 3 < data.length) {
      pixels[i * 4] = data[off] / 255.0;
      pixels[i * 4 + 1] = data[off + 1] / 255.0;
      pixels[i * 4 + 2] = data[off + 2] / 255.0;
      pixels[i * 4 + 3] = data[off + 3] / 255.0;
    }
  }

  return pixels;
}

function extractChannel(pixel: number, mask: number): number {
  if (mask === 0) return 0;
  let shift = 0;
  let m = mask >>> 0;
  while ((m & 1) === 0 && shift < 32) {
    shift++;
    m >>>= 1;
  }
  let bits = 0;
  while ((m & 1) !== 0 && bits < 32) {
    bits++;
    m >>>= 1;
  }
  if (bits === 0) return 0;
  const maxVal = (1 << bits) - 1;
  if (maxVal === 0) return 0;
  const val = ((pixel & mask) >>> shift) & maxVal;
  return val / maxVal;
}

function getFormatBytesPerPixel(header: DdsHeader): number {
  if (header.dx10Header) {
    const fmt = header.dx10Header.dxgiFormat;
    switch (fmt) {
      case DXGI_FORMAT_R32G32B32A32_FLOAT: return 16;
      case DXGI_FORMAT_R32G32B32_FLOAT: return 12;
      case DXGI_FORMAT_R16G16B16A16_FLOAT: return 8;
      case DXGI_FORMAT_R32G32_FLOAT: return 8;
      case DXGI_FORMAT_R16G16_FLOAT: return 4;
      case DXGI_FORMAT_R32_FLOAT: return 4;
      case DXGI_FORMAT_R16_FLOAT: return 2;
      case DXGI_FORMAT_R8G8B8A8_UNORM: return 4;
      case DXGI_FORMAT_B8G8R8A8_UNORM: return 4;
      case DXGI_FORMAT_BC6H_UF16:
      case DXGI_FORMAT_BC6H_SF16:
        return -1;
      default: return 4;
    }
  }

  const pf = header.pixelFormat;
  if (pf.flags & DDPF_FOURCC) {
    const cc = pf.fourCC;
    if (cc === 116) return 16;
    if (cc === 115) return 8;
    if (cc === 114) return 4;
    if (cc === 113) return 8;
    if (cc === 112) return 4;
    if (cc === 111) return 2;
  }

  if (pf.flags & DDPF_RGB) {
    return pf.rgbBitCount / 8;
  }

  return 4;
}

function getFaceDataSize(width: number, height: number, header: DdsHeader): number {
  const bpp = getFormatBytesPerPixel(header);
  if (bpp === -1) {
    const blocksX = Math.ceil(width / 4);
    const blocksY = Math.ceil(height / 4);
    return blocksX * blocksY * 16;
  }
  return width * height * bpp;
}

function getFormatName(header: DdsHeader): string {
  if (header.dx10Header) {
    const fmt = header.dx10Header.dxgiFormat;
    switch (fmt) {
      case DXGI_FORMAT_R32G32B32A32_FLOAT: return "RGBA32F";
      case DXGI_FORMAT_R32G32B32_FLOAT: return "RGB32F";
      case DXGI_FORMAT_R16G16B16A16_FLOAT: return "RGBA16F";
      case DXGI_FORMAT_R8G8B8A8_UNORM: return "RGBA8";
      case DXGI_FORMAT_B8G8R8A8_UNORM: return "BGRA8";
      case DXGI_FORMAT_BC6H_UF16: return "BC6H_UF16";
      case DXGI_FORMAT_BC6H_SF16: return "BC6H_SF16";
      default: return `DXGI_${fmt}`;
    }
  }

  const pf = header.pixelFormat;
  if (pf.flags & DDPF_FOURCC) {
    const cc = pf.fourCC;
    if (cc === 116) return "RGBA32F";
    if (cc === 115) return "RG32F";
    if (cc === 114) return "R32F";
    if (cc === 113) return "RGBA16F";
    if (cc === 112) return "RG16F";
    if (cc === 111) return "R16F";
    const c1 = String.fromCharCode(cc & 0xff);
    const c2 = String.fromCharCode((cc >> 8) & 0xff);
    const c3 = String.fromCharCode((cc >> 16) & 0xff);
    const c4 = String.fromCharCode((cc >> 24) & 0xff);
    return `FourCC(${c1}${c2}${c3}${c4})`;
  }

  if (pf.flags & DDPF_RGB) {
    return `RGB${pf.rgbBitCount}`;
  }

  return "Unknown";
}

const MAX_FACE_DIMENSION = 8192;
const MAX_MIP_LEVELS = 16;

export function parseDds(buffer: Buffer): ParsedDds {
  if (buffer.length < 128) {
    throw new Error("File is too small to be a valid DDS file");
  }

  const magic = buffer.readUInt32LE(0);
  if (magic !== DDS_MAGIC) {
    throw new Error("Invalid DDS magic number - not a DDS file");
  }

  const headerSize = buffer.readUInt32LE(4);
  if (headerSize !== 124) {
    throw new Error("Invalid DDS header size");
  }

  const flags = buffer.readUInt32LE(8);
  const height = buffer.readUInt32LE(12);
  const width = buffer.readUInt32LE(16);
  const pitchOrLinearSize = buffer.readUInt32LE(20);
  const depth = buffer.readUInt32LE(24);
  const rawMipCount = buffer.readUInt32LE(28) || 1;
  const mipMapCount = Math.min(rawMipCount, MAX_MIP_LEVELS);

  if (width === 0 || height === 0) {
    throw new Error("Invalid DDS dimensions: width and height must be > 0");
  }
  if (width > MAX_FACE_DIMENSION || height > MAX_FACE_DIMENSION) {
    throw new Error(`DDS face dimensions too large (${width}x${height}). Maximum supported is ${MAX_FACE_DIMENSION}x${MAX_FACE_DIMENSION}`);
  }

  const pfFlags = buffer.readUInt32LE(80);
  const pfFourCC = buffer.readUInt32LE(84);
  const pfRGBBitCount = buffer.readUInt32LE(88);
  const pfRBitMask = buffer.readUInt32LE(92);
  const pfGBitMask = buffer.readUInt32LE(96);
  const pfBBitMask = buffer.readUInt32LE(100);
  const pfABitMask = buffer.readUInt32LE(104);

  const caps = buffer.readUInt32LE(108);
  const caps2 = buffer.readUInt32LE(112);

  const header: DdsHeader = {
    width,
    height,
    mipMapCount,
    pixelFormat: {
      flags: pfFlags,
      fourCC: pfFourCC,
      rgbBitCount: pfRGBBitCount,
      rBitMask: pfRBitMask,
      gBitMask: pfGBitMask,
      bBitMask: pfBBitMask,
      aBitMask: pfABitMask,
    },
    caps,
    caps2,
  };

  let dataOffset = 128;

  if ((pfFlags & DDPF_FOURCC) && pfFourCC === fourCC("DX10")) {
    if (buffer.length < 148) {
      throw new Error("File too small for DX10 extended header");
    }
    header.dx10Header = {
      dxgiFormat: buffer.readUInt32LE(128),
      resourceDimension: buffer.readUInt32LE(132),
      miscFlag: buffer.readUInt32LE(136),
      arraySize: buffer.readUInt32LE(140),
      miscFlags2: buffer.readUInt32LE(144),
    };
    dataOffset = 148;
  }

  const isCubemap = !!(caps2 & DDSCAPS2_CUBEMAP);
  let faceCount = 1;

  if (isCubemap) {
    faceCount = 0;
    if (caps2 & DDSCAPS2_CUBEMAP_POSITIVEX) faceCount++;
    if (caps2 & DDSCAPS2_CUBEMAP_NEGATIVEX) faceCount++;
    if (caps2 & DDSCAPS2_CUBEMAP_POSITIVEY) faceCount++;
    if (caps2 & DDSCAPS2_CUBEMAP_NEGATIVEY) faceCount++;
    if (caps2 & DDSCAPS2_CUBEMAP_POSITIVEZ) faceCount++;
    if (caps2 & DDSCAPS2_CUBEMAP_NEGATIVEZ) faceCount++;

    if (faceCount === 0) faceCount = 6;
  }

  const faceDataSize = getFaceDataSize(width, height, header);
  const format = getFormatName(header);

  const totalDataNeeded = faceDataSize * faceCount;
  const availableData = buffer.length - dataOffset;
  if (availableData < faceDataSize) {
    throw new Error(
      `DDS file is truncated: need at least ${faceDataSize} bytes for first face, but only ${availableData} bytes available after header`
    );
  }

  const faces: Float32Array[] = [];
  let currentOffset = dataOffset;

  for (let f = 0; f < faceCount; f++) {
    if (currentOffset >= buffer.length) {
      throw new Error(`DDS file truncated at face ${f + 1}/${faceCount}: offset ${currentOffset} exceeds file size ${buffer.length}`);
    }

    let mipOffset = currentOffset;
    const facePixels = decodePixelData(buffer, mipOffset, width, height, header);
    faces.push(facePixels);

    let mipW = width;
    let mipH = height;
    for (let m = 0; m < mipMapCount; m++) {
      const mipSize = getFaceDataSize(mipW, mipH, header);
      mipOffset += mipSize;
      if (mipOffset > buffer.length) break;
      mipW = Math.max(1, mipW >> 1);
      mipH = Math.max(1, mipH >> 1);
    }
    currentOffset = mipOffset;
  }

  return {
    header,
    isCubemap,
    faceCount,
    format,
    faces,
    faceWidth: width,
    faceHeight: height,
  };
}

export function createPreviewBmp(facePixels: Float32Array, width: number, height: number): Buffer {
  const previewSize = Math.min(256, width);
  const scale = previewSize / width;
  const pH = Math.round(height * scale);
  const pW = previewSize;

  const pngData = Buffer.alloc(pW * pH * 4);

  for (let y = 0; y < pH; y++) {
    for (let x = 0; x < pW; x++) {
      const srcX = Math.min(Math.floor(x / scale), width - 1);
      const srcY = Math.min(Math.floor(y / scale), height - 1);
      const srcIdx = (srcY * width + srcX) * 4;
      const dstIdx = (y * pW + x) * 4;

      let rv = facePixels[srcIdx];
      let gv = facePixels[srcIdx + 1];
      let bv = facePixels[srcIdx + 2];
      if (!isFinite(rv)) rv = 0;
      if (!isFinite(gv)) gv = 0;
      if (!isFinite(bv)) bv = 0;
      const r = Math.pow(Math.max(0, Math.min(1, rv)), 1 / 2.2);
      const g = Math.pow(Math.max(0, Math.min(1, gv)), 1 / 2.2);
      const b = Math.pow(Math.max(0, Math.min(1, bv)), 1 / 2.2);

      pngData[dstIdx] = Math.round(r * 255);
      pngData[dstIdx + 1] = Math.round(g * 255);
      pngData[dstIdx + 2] = Math.round(b * 255);
      pngData[dstIdx + 3] = 255;
    }
  }

  return createBmpBuffer(pngData, pW, pH);
}

function createBmpBuffer(rgbaData: Buffer, width: number, height: number): Buffer {
  const headerSize = 54;
  const rowSize = width * 3;
  const paddedRowSize = Math.ceil(rowSize / 4) * 4;
  const dataSize = paddedRowSize * height;
  const fileSize = headerSize + dataSize;

  const bmp = Buffer.alloc(fileSize);

  bmp.write("BM", 0);
  bmp.writeUInt32LE(fileSize, 2);
  bmp.writeUInt32LE(0, 6);
  bmp.writeUInt32LE(headerSize, 10);

  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(-height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(0, 30);
  bmp.writeUInt32LE(dataSize, 34);
  bmp.writeInt32LE(2835, 38);
  bmp.writeInt32LE(2835, 42);
  bmp.writeUInt32LE(0, 46);
  bmp.writeUInt32LE(0, 50);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = headerSize + y * paddedRowSize + x * 3;
      bmp[dstIdx] = rgbaData[srcIdx + 2];
      bmp[dstIdx + 1] = rgbaData[srcIdx + 1];
      bmp[dstIdx + 2] = rgbaData[srcIdx];
    }
  }

  return bmp;
}
