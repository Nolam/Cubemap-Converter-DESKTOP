import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { parseDds, createPreviewBmp } from "./dds-parser";
import { encodeHdr } from "./hdr-encoder";
import { encodeExr } from "./exr-encoder";
import { encodePng16 } from "./png-encoder";
import { encodeJpeg } from "./jpeg-encoder";
import { encodeTiff32 } from "./tiff-encoder";
import { encodeDds } from "./dds-encoder";
import { cubemapToEquirectangular } from "./cubemap-converter";
import { decodeImage, isSupportedImageFormat } from "./image-decoder";
import type { CubemapFaceName, UploadResult, AxisConfig, FileFormatInfo } from "@shared/schema";
import { cubemapFaceNames, cubemapFaceLabels, axisConfigSchema } from "@shared/schema";

interface DdsFormatDetails {
  bitDepth: string;
  channels: string;
  channelCount: number;
  bitsPerChannel: number;
}

function parseDdsFormat(format: string): DdsFormatDetails {
  const f = format.toUpperCase();
  if (f.includes("32F")) {
    if (f.includes("RGBA") || f === "RGBA32F" || f.startsWith("R32G32B32A32")) return { bitDepth: "32-bit float", channels: "RGBA", channelCount: 4, bitsPerChannel: 32 };
    if (f.startsWith("R32G32B32")) return { bitDepth: "32-bit float", channels: "RGB", channelCount: 3, bitsPerChannel: 32 };
    return { bitDepth: "32-bit float", channels: "RGBA", channelCount: 4, bitsPerChannel: 32 };
  }
  if (f.includes("16F")) {
    if (f.includes("RGBA")) return { bitDepth: "16-bit float", channels: "RGBA", channelCount: 4, bitsPerChannel: 16 };
    if (f.includes("RG")) return { bitDepth: "16-bit float", channels: "RG", channelCount: 2, bitsPerChannel: 16 };
    return { bitDepth: "16-bit float", channels: "R", channelCount: 1, bitsPerChannel: 16 };
  }
  if (f.includes("BC6H")) return { bitDepth: "HDR compressed", channels: "RGB", channelCount: 3, bitsPerChannel: 16 };
  if (f.includes("BC7") || f.includes("BC3") || f.includes("BC2") || f.includes("DXT5") || f.includes("DXT3")) return { bitDepth: "8-bit", channels: "RGBA", channelCount: 4, bitsPerChannel: 8 };
  if (f.includes("BC4")) return { bitDepth: "8-bit", channels: "R", channelCount: 1, bitsPerChannel: 8 };
  if (f.includes("BC1") || f.includes("DXT1")) return { bitDepth: "8-bit", channels: "RGB", channelCount: 3, bitsPerChannel: 8 };
  if (f.includes("BC5")) return { bitDepth: "8-bit", channels: "RG", channelCount: 2, bitsPerChannel: 8 };
  if (f.startsWith("RGB")) {
    const bits = parseInt(f.replace("RGB", "")) || 24;
    return { bitDepth: `${bits > 24 ? bits / 4 : 8}-bit`, channels: bits > 24 ? "RGBA" : "RGB", channelCount: bits > 24 ? 4 : 3, bitsPerChannel: bits > 24 ? bits / 4 : 8 };
  }
  return { bitDepth: "Unknown", channels: "RGBA", channelCount: 4, bitsPerChannel: 8 };
}

function ddsFormatToFileInfo(format: string): FileFormatInfo {
  const details = parseDdsFormat(format);
  return { inputFormat: `DDS (${format})`, bitDepth: details.bitDepth, channels: details.channels };
}

function channelCountToString(count: number): string {
  if (count >= 4) return "RGBA";
  if (count === 3) return "RGB";
  if (count === 2) return "RG";
  if (count === 1) return "Grayscale";
  return "RGBA";
}

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const OUTPUT_DIR = path.join(process.cwd(), "outputs");

function cleanDirOnStartup(dir: string) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}
cleanDirOnStartup(UPLOAD_DIR);
cleanDirOnStartup(OUTPUT_DIR);

interface CachedConversion {
  filename: string;
  downloadUrl: string;
  outputId: string;
  ext: string;
  width: number;
  height: number;
  format: string;
}

interface SessionData {
  id: string;
  mode: "single" | "individual";
  faces: Map<CubemapFaceName, Float32Array>;
  faceSize: number;
  format: string;
  createdAt: number;
  conversionCache: Map<string, CachedConversion>;
}

const sessions = new Map<string, SessionData>();

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > 15 * 60 * 1000) {
      sessions.delete(id);
      const sessionDir = path.join(UPLOAD_DIR, id);
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
      const outputDir = path.join(OUTPUT_DIR, id);
      if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
    }
  }
}, 5 * 60 * 1000);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 * 1024 },
});

interface ProcessingStep {
  label: string;
  status: "done" | "error";
}

const faceOrder: CubemapFaceName[] = [
  "positiveX",
  "negativeX",
  "positiveY",
  "negativeY",
  "positiveZ",
  "negativeZ",
];

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post("/api/upload/single", upload.single("ddsFile"), (req, res) => {
    req.setTimeout(120000);
    res.setTimeout(120000);

    const steps: ProcessingStep[] = [];

    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      steps.push({ label: "Parsing DDS file header", status: "done" });

      const buffer = req.file.buffer;
      const parsed = parseDds(buffer);
      console.log(`DDS parse: format=${parsed.format}, fourCC=${parsed.header.pixelFormat.fourCC}, flags=0x${parsed.header.pixelFormat.flags.toString(16)}, dx10=${parsed.header.dx10Header ? `dxgi=${parsed.header.dx10Header.dxgiFormat}` : 'none'}, faces=${parsed.faceCount}, size=${parsed.faceWidth}x${parsed.faceHeight}`);

      steps.push({ label: `Detected pixel format: ${parsed.format}`, status: "done" });

      if (!parsed.isCubemap) {
        return res.status(400).json({
          message: "This DDS file is not a cubemap. Please upload a DDS file with cubemap faces.",
        });
      }

      if (parsed.faceCount < 6) {
        return res.status(400).json({
          message: `Cubemap has only ${parsed.faceCount} faces. Expected 6 faces.`,
        });
      }

      steps.push({ label: "Validated cubemap structure", status: "done" });

      const sessionId = randomUUID();
      const faceMap = new Map<CubemapFaceName, Float32Array>();

      for (let i = 0; i < Math.min(parsed.faceCount, 6); i++) {
        const faceName = faceOrder[i];
        faceMap.set(faceName, parsed.faces[i]);
        steps.push({ label: `Extracted face ${i + 1}/6 — ${cubemapFaceLabels[faceName]}`, status: "done" });
      }

      sessions.set(sessionId, {
        id: sessionId,
        mode: "single",
        faces: faceMap,
        faceSize: parsed.faceWidth,
        format: parsed.format,
        createdAt: Date.now(),
        conversionCache: new Map(),
      });

      steps.push({ label: "Session created successfully", status: "done" });

      const result: UploadResult = {
        sessionId,
        mode: "single",
        ddsInfo: {
          width: parsed.faceWidth,
          height: parsed.faceHeight,
          format: parsed.format,
          isCubemap: parsed.isCubemap,
          faceCount: parsed.faceCount,
          mipLevels: parsed.header.mipMapCount,
        },
        fileInfo: ddsFormatToFileInfo(parsed.format),
        faces: Array.from(faceMap.keys()),
        faceSize: parsed.faceWidth,
      };

      return res.json({ ...result, processingSteps: steps });
    } catch (err: any) {
      console.error("Upload error:", err);
      steps.push({ label: err.message || "Processing failed", status: "error" });
      return res.status(400).json({
        message: err.message || "Failed to parse DDS file",
        processingSteps: steps,
      });
    }
  });

  app.post(
    "/api/upload/individual",
    upload.fields(
      cubemapFaceNames.map((name) => ({ name, maxCount: 1 }))
    ),
    async (req, res) => {
      req.setTimeout(120000);
      res.setTimeout(120000);

      const steps: ProcessingStep[] = [];

      try {
        const files = req.files as Record<string, Express.Multer.File[]>;

        if (!files) {
          return res.status(400).json({ message: "No files uploaded" });
        }

        const sessionId = randomUUID();
        const faceMap = new Map<CubemapFaceName, Float32Array>();
        let faceSize = 0;
        const detectedFormats = new Set<string>();
        let detectedBitDepth = 0;
        let detectedChannels = 0;

        for (let i = 0; i < cubemapFaceNames.length; i++) {
          const faceName = cubemapFaceNames[i];
          const faceFiles = files[faceName];
          if (!faceFiles || faceFiles.length === 0) {
            return res.status(400).json({
              message: `Missing face file for ${faceName}`,
            });
          }

          const file = faceFiles[0];
          const buffer = Buffer.from(file.buffer);
          const filename = file.originalname.toLowerCase();
          const shortName = file.originalname.length > 25
            ? file.originalname.slice(0, 22) + "..."
            : file.originalname;

          steps.push({ label: `Decoding face ${i + 1}/6 — ${cubemapFaceLabels[faceName]} (${shortName})`, status: "done" });

          let pixels: Float32Array;
          let fileWidth: number;

          if (filename.endsWith(".dds")) {
            const parsed = parseDds(buffer);
            pixels = parsed.faces[0];
            fileWidth = parsed.faceWidth;
            detectedFormats.add("DDS");
            const ddsDetails = parseDdsFormat(parsed.format);
            if (ddsDetails.bitsPerChannel > detectedBitDepth) {
              detectedBitDepth = ddsDetails.bitsPerChannel;
            }
            if (ddsDetails.channelCount > detectedChannels) {
              detectedChannels = ddsDetails.channelCount;
            }
          } else if (isSupportedImageFormat(filename)) {
            const decoded = await decodeImage(buffer, filename);
            if (decoded.width !== decoded.height) {
              return res.status(400).json({
                message: `Face ${faceName}: image must be square (got ${decoded.width}x${decoded.height})`,
              });
            }
            pixels = decoded.pixels;
            fileWidth = decoded.width;
            const ext = filename.replace(/^.*(\.[^.]+)$/, "$1").toUpperCase().replace(".", "");
            detectedFormats.add(ext === "JPG" || ext === "JPEG" ? "JPEG" : ext === "TIF" ? "TIFF" : ext);
            if (detectedBitDepth === 0 || decoded.bitDepth > detectedBitDepth) {
              detectedBitDepth = decoded.bitDepth;
            }
            if (decoded.channels > detectedChannels) {
              detectedChannels = decoded.channels;
            }
          } else {
            return res.status(400).json({
              message: `Unsupported file format for ${faceName}. Use DDS, PNG, JPG, TGA, or TIFF.`,
            });
          }

          if (faceSize === 0) {
            faceSize = fileWidth;
          } else if (fileWidth !== faceSize) {
            return res.status(400).json({
              message: `Face ${faceName} has different dimensions (${fileWidth}) than previous faces (${faceSize})`,
            });
          }

          faceMap.set(faceName, pixels);
        }

        steps.push({ label: "Validated cubemap dimensions", status: "done" });

        sessions.set(sessionId, {
          id: sessionId,
          mode: "individual",
          faces: faceMap,
          faceSize,
          format: "Individual",
          createdAt: Date.now(),
          conversionCache: new Map(),
        });

        steps.push({ label: "Session created successfully", status: "done" });

        const formatNames = Array.from(detectedFormats).join("/");
        const channelStr = channelCountToString(detectedChannels);
        const result: UploadResult = {
          sessionId,
          mode: "individual",
          fileInfo: {
            inputFormat: formatNames,
            bitDepth: `${detectedBitDepth}-bit`,
            channels: channelStr,
          },
          faces: Array.from(faceMap.keys()),
          faceSize,
        };

        return res.json({ ...result, processingSteps: steps });
      } catch (err: any) {
        console.error("Upload error:", err);
        steps.push({ label: err.message || "Processing failed", status: "error" });
        return res.status(400).json({
          message: err.message || "Failed to process uploaded files",
          processingSteps: steps,
        });
      }
    }
  );

  app.get("/api/preview/:sessionId/:face", (req, res) => {
    try {
      const { sessionId, face } = req.params;
      const session = sessions.get(sessionId);

      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      const faceName = face as CubemapFaceName;
      const faceData = session.faces.get(faceName);

      if (!faceData) {
        return res.status(404).json({ message: "Face not found" });
      }

      const bmpData = createPreviewBmp(
        faceData,
        session.faceSize,
        session.faceSize
      );

      res.set("Content-Type", "image/bmp");
      res.set("Cache-Control", "public, max-age=3600");
      return res.send(bmpData);
    } catch (err: any) {
      console.error("Preview error:", err);
      return res.status(500).json({ message: "Failed to generate preview" });
    }
  });

  app.delete("/api/session/:sessionId", (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = sessions.get(sessionId);

      if (session) {
        sessions.delete(sessionId);
        const uploadDir = path.join(UPLOAD_DIR, sessionId);
        if (fs.existsSync(uploadDir)) {
          fs.rmSync(uploadDir, { recursive: true, force: true });
        }
        const outputDir = path.join(OUTPUT_DIR, sessionId);
        if (fs.existsSync(outputDir)) {
          fs.rmSync(outputDir, { recursive: true, force: true });
        }
      }

      return res.json({ success: true });
    } catch (err: any) {
      console.error("Session cleanup error:", err);
      return res.json({ success: true });
    }
  });

  app.post("/api/convert", async (req, res) => {
    try {
      const { sessionId, outputFormat, outputWidth, outputHeight, axisConfig: rawAxisConfig } = req.body;

      if (!sessionId || !outputFormat) {
        return res.status(400).json({ message: "Missing required parameters" });
      }

      let axisConfig: AxisConfig | undefined;
      if (rawAxisConfig) {
        const parsed = axisConfigSchema.safeParse(rawAxisConfig);
        if (!parsed.success) {
          return res.status(400).json({
            message: "Invalid axis configuration: " + parsed.error.issues.map(i => i.message).join(", "),
          });
        }
        axisConfig = parsed.data;
      }

      const session = sessions.get(sessionId);
      if (!session) {
        return res.status(404).json({ message: "Session not found or expired" });
      }

      const width = Math.min(Math.max(64, outputWidth || 2048), 16384);
      const height = Math.min(Math.max(32, outputHeight || 1024), 8192);

      const axisSuffix = axisConfig
        ? `_${axisConfig.presetId}_${axisConfig.handedness}_${Object.values(axisConfig.axisMapping).join("-")}`
        : "";
      const cacheKey = `${outputFormat}_${width}x${height}${axisSuffix}`;
      const cached = session.conversionCache.get(cacheKey);
      if (cached) {
        const cachedFilePath = path.join(OUTPUT_DIR, sessionId, `${cached.outputId}.${cached.ext}`);
        if (fs.existsSync(cachedFilePath)) {
          session.createdAt = Date.now();
          return res.json({
            success: true,
            cached: true,
            filename: cached.filename,
            downloadUrl: cached.downloadUrl,
            width: cached.width,
            height: cached.height,
            format: cached.format,
          });
        }
        session.conversionCache.delete(cacheKey);
      }

      const faces: Float32Array[] = [];
      for (const name of faceOrder) {
        const face = session.faces.get(name);
        if (!face) {
          return res.status(400).json({
            message: `Missing cubemap face: ${name}`,
          });
        }
        faces.push(face);
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sendSSE = (data: object) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      sendSSE({ type: "progress", percent: 1, stage: "Starting conversion..." });

      const equirect = cubemapToEquirectangular(
        faces,
        session.faceSize,
        width,
        height,
        axisConfig,
        session.mode,
        (percent, stage) => {
          sendSSE({ type: "progress", percent, stage });
        }
      );

      let encoded: Buffer;
      let ext: string;

      const encoderProgress = (percent: number, stage: string) => {
        sendSSE({ type: "progress", percent, stage });
      };

      if (outputFormat === "exr") {
        encoded = encodeExr(equirect, width, height, encoderProgress);
        ext = "exr";
      } else if (outputFormat === "png") {
        encoded = await encodePng16(equirect, width, height, encoderProgress);
        ext = "png";
      } else if (outputFormat === "jpg") {
        encoded = await encodeJpeg(equirect, width, height, 92, encoderProgress);
        ext = "jpg";
      } else if (outputFormat === "tiff") {
        encoded = encodeTiff32(equirect, width, height, encoderProgress);
        ext = "tiff";
      } else if (outputFormat === "dds") {
        encoded = encodeDds(equirect, width, height, encoderProgress);
        ext = "dds";
      } else {
        encoded = encodeHdr(equirect, width, height, encoderProgress);
        ext = "hdr";
      }

      sendSSE({ type: "progress", percent: 97, stage: "Writing output file to disk..." });

      const outputId = randomUUID();
      const outputDirPath = path.join(OUTPUT_DIR, sessionId);
      if (!fs.existsSync(outputDirPath)) {
        fs.mkdirSync(outputDirPath, { recursive: true });
      }

      const filename = `cubemap_hdri_${width}x${height}.${ext}`;
      const outputPath = path.join(outputDirPath, `${outputId}.${ext}`);
      fs.writeFileSync(outputPath, encoded);

      session.conversionCache.set(cacheKey, {
        filename,
        downloadUrl: `/api/download/${sessionId}/${outputId}.${ext}`,
        outputId,
        ext,
        width,
        height,
        format: outputFormat,
      });

      sendSSE({
        type: "complete",
        success: true,
        cached: false,
        filename,
        downloadUrl: `/api/download/${sessionId}/${outputId}.${ext}`,
        width,
        height,
        format: outputFormat,
      });

      res.end();
    } catch (err: any) {
      console.error("Conversion error:", err);
      try {
        const isSSE = res.headersSent;
        if (isSSE) {
          res.write(`data: ${JSON.stringify({ type: "error", message: err.message || "Conversion failed" })}\n\n`);
          res.end();
        } else {
          return res.status(500).json({ message: err.message || "Conversion failed" });
        }
      } catch {
        res.end();
      }
    }
  });

  app.get("/api/download/:sessionId/:filename", (req, res) => {
    try {
      const { sessionId, filename } = req.params;
      const filePath = path.join(OUTPUT_DIR, sessionId, filename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "File not found" });
      }

      const ext = path.extname(filename).toLowerCase();
      const downloadName = `cubemap_hdri${ext}`;

      res.set("Content-Type", "application/octet-stream");
      res.set("Content-Disposition", `attachment; filename="${downloadName}"`);
      return res.sendFile(filePath);
    } catch (err: any) {
      console.error("Download error:", err);
      return res.status(500).json({ message: "Download failed" });
    }
  });

  return httpServer;
}
