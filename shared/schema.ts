import { z } from "zod";

export const cubemapFaceNames = [
  "positiveX",
  "negativeX",
  "positiveY",
  "negativeY",
  "positiveZ",
  "negativeZ",
] as const;

export const cubemapFaceLabels: Record<typeof cubemapFaceNames[number], string> = {
  positiveX: "+X",
  negativeX: "-X",
  positiveY: "+Y",
  negativeY: "-Y",
  positiveZ: "+Z",
  negativeZ: "-Z",
};

export type CubemapFaceName = typeof cubemapFaceNames[number];

export type Handedness = "left" | "right";

export type AxisMapping = {
  right: CubemapFaceName;
  left: CubemapFaceName;
  up: CubemapFaceName;
  down: CubemapFaceName;
  front: CubemapFaceName;
  back: CubemapFaceName;
};

export type FaceImageCorrection = "" | "scaleY(-1)" | "scaleX(-1)" | "rotate(180deg)" | "rotate(90deg)" | "rotate(-90deg)" | "rotate(90deg) scaleX(-1)" | "rotate(-90deg) scaleX(-1)";

export type FaceImageCorrections = {
  sides: FaceImageCorrection;
  topBottom: FaceImageCorrection;
  swapTopBottom?: boolean;
  swapLeftRight?: boolean;
  flipVertical?: boolean;
};

export type CoordinatePresetId = "opengl" | "directx" | "spaceengine" | "custom";

export interface CoordinatePreset {
  id: CoordinatePresetId;
  label: string;
  description: string;
  handedness: Handedness;
  axisMapping: AxisMapping;
  faceImageCorrections?: FaceImageCorrections;
}

export const coordinatePresets: CoordinatePreset[] = [
  {
    id: "directx",
    label: "DirectX / DDS",
    description: "Left-handed, Y-up — default for DDS cubemaps",
    handedness: "left",
    axisMapping: {
      right: "positiveX",
      left: "negativeX",
      up: "positiveY",
      down: "negativeY",
      front: "positiveZ",
      back: "negativeZ",
    },
  },
  {
    id: "spaceengine",
    label: "SpaceEngine",
    description: "Right-handed, Y-up — right is -Z, front is +X",
    handedness: "right",
    axisMapping: {
      right: "negativeZ",
      left: "positiveZ",
      up: "positiveY",
      down: "negativeY",
      front: "positiveX",
      back: "negativeX",
    },
    faceImageCorrections: {
      sides: "scaleY(-1)",
      topBottom: "scaleX(-1)",
      swapTopBottom: true,
      swapLeftRight: true,
    },
  },
  {
    id: "opengl",
    label: "OpenGL",
    description: "Right-handed, Y-up — front is -Z (RenderMan upper-left origin)",
    handedness: "right",
    axisMapping: {
      right: "positiveX",
      left: "negativeX",
      up: "positiveY",
      down: "negativeY",
      front: "negativeZ",
      back: "positiveZ",
    },
    faceImageCorrections: {
      sides: "scaleY(-1)",
      topBottom: "scaleY(-1)",
      flipVertical: true,
    },
  },
];

export const defaultPreset = coordinatePresets[0];

export function getDdsFaceCorrections(
  axisMapping: AxisMapping,
  uploadMode: "single" | "individual"
): FaceImageCorrections | null {
  if (uploadMode !== "single") return null;
  const match = coordinatePresets.find(
    (p) =>
      p.faceImageCorrections &&
      p.axisMapping.right === axisMapping.right &&
      p.axisMapping.left === axisMapping.left &&
      p.axisMapping.up === axisMapping.up &&
      p.axisMapping.down === axisMapping.down &&
      p.axisMapping.front === axisMapping.front &&
      p.axisMapping.back === axisMapping.back
  );
  return match?.faceImageCorrections ?? null;
}

export interface AxisConfig {
  presetId: CoordinatePresetId;
  handedness: Handedness;
  axisMapping: AxisMapping;
}

export const defaultAxisConfig: AxisConfig = {
  presetId: "directx",
  handedness: defaultPreset.handedness,
  axisMapping: { ...defaultPreset.axisMapping },
};

export const axisMappingSchema = z.object({
  right: z.enum(cubemapFaceNames),
  left: z.enum(cubemapFaceNames),
  up: z.enum(cubemapFaceNames),
  down: z.enum(cubemapFaceNames),
  front: z.enum(cubemapFaceNames),
  back: z.enum(cubemapFaceNames),
});

export const axisConfigSchema = z.object({
  presetId: z.enum(["opengl", "directx", "spaceengine", "custom"]),
  handedness: z.enum(["left", "right"]),
  axisMapping: axisMappingSchema,
});

export const outputFormatSchema = z.enum(["hdr", "exr", "png", "jpg", "tiff", "dds"]);
export type OutputFormat = z.infer<typeof outputFormatSchema>;

export const conversionRequestSchema = z.object({
  outputFormat: outputFormatSchema,
  outputWidth: z.number().min(64).max(16384).default(2048),
  outputHeight: z.number().min(32).max(8192).default(1024),
  axisConfig: axisConfigSchema.optional(),
});

export type ConversionRequest = z.infer<typeof conversionRequestSchema>;

export interface ConversionResult {
  success: boolean;
  filename: string;
  downloadUrl: string;
  width: number;
  height: number;
  format: OutputFormat;
}

export interface DdsInfo {
  width: number;
  height: number;
  format: string;
  isCubemap: boolean;
  faceCount: number;
  mipLevels: number;
}

export interface FileFormatInfo {
  inputFormat: string;
  bitDepth: string;
  channels: string;
}

export interface UploadResult {
  sessionId: string;
  mode: "single" | "individual";
  ddsInfo?: DdsInfo;
  fileInfo: FileFormatInfo;
  faces: CubemapFaceName[];
  faceSize: number;
}
