import sharp from "sharp";
import type { ProgressCallback } from "./cubemap-converter";

export async function encodeJpeg(
  pixels: Float32Array,
  width: number,
  height: number,
  quality: number = 92,
  onProgress?: ProgressCallback
): Promise<Buffer> {
  const report = onProgress || (() => {});

  report(91, "Tone-mapping (Reinhard)...");

  const rgb = Buffer.alloc(width * height * 3);

  for (let i = 0; i < width * height; i++) {
    const srcIdx = i * 4;
    for (let c = 0; c < 3; c++) {
      let val = pixels[srcIdx + c];
      if (!isFinite(val)) val = 0;
      val = Math.max(0, val);
      val = val / (1.0 + val);
      val = Math.pow(val, 1.0 / 2.2);
      rgb[i * 3 + c] = Math.round(Math.min(1, val) * 255);
    }
  }

  report(94, "JPEG encoding (mozjpeg)...");

  return sharp(rgb, {
    raw: { width, height, channels: 3 },
  })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}
