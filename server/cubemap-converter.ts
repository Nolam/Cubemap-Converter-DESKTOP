import type { AxisConfig, AxisMapping, CubemapFaceName } from "@shared/schema";
import { defaultAxisConfig, getDdsFaceCorrections } from "@shared/schema";

export type ProgressCallback = (percent: number, stage: string) => void;

function faceNameToAxis(face: CubemapFaceName): [number, number, number] {
  switch (face) {
    case "positiveX": return [1, 0, 0];
    case "negativeX": return [-1, 0, 0];
    case "positiveY": return [0, 1, 0];
    case "negativeY": return [0, -1, 0];
    case "positiveZ": return [0, 0, 1];
    case "negativeZ": return [0, 0, -1];
  }
}

type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

function buildTransformMatrix(config: AxisConfig): Mat3 {
  const col0 = faceNameToAxis(config.axisMapping.right);
  const col1 = faceNameToAxis(config.axisMapping.up);
  const col2 = faceNameToAxis(config.axisMapping.front);

  return [
    [col0[0], col1[0], col2[0]],
    [col0[1], col1[1], col2[1]],
    [col0[2], col1[2], col2[2]],
  ];
}

function isIdentityMatrix(m: Mat3): boolean {
  return (
    m[0][0] === 1 && m[0][1] === 0 && m[0][2] === 0 &&
    m[1][0] === 0 && m[1][1] === 1 && m[1][2] === 0 &&
    m[2][0] === 0 && m[2][1] === 0 && m[2][2] === 1
  );
}

function transformDir(
  m: Mat3,
  dx: number, dy: number, dz: number
): [number, number, number] {
  return [
    m[0][0] * dx + m[0][1] * dy + m[0][2] * dz,
    m[1][0] * dx + m[1][1] * dy + m[1][2] * dz,
    m[2][0] * dx + m[2][1] * dy + m[2][2] * dz,
  ];
}

function rotateFace180(face: Float32Array, faceSize: number): Float32Array {
  const rotated = new Float32Array(face.length);
  const totalPixels = faceSize * faceSize;
  for (let i = 0; i < totalPixels; i++) {
    const srcIdx = i * 4;
    const dstIdx = (totalPixels - 1 - i) * 4;
    rotated[dstIdx] = face[srcIdx];
    rotated[dstIdx + 1] = face[srcIdx + 1];
    rotated[dstIdx + 2] = face[srcIdx + 2];
    rotated[dstIdx + 3] = face[srcIdx + 3];
  }
  return rotated;
}

function flipFaceVertical(face: Float32Array, faceSize: number): Float32Array {
  const flipped = new Float32Array(face.length);
  for (let row = 0; row < faceSize; row++) {
    const srcRow = row * faceSize * 4;
    const dstRow = (faceSize - 1 - row) * faceSize * 4;
    for (let col = 0; col < faceSize * 4; col++) {
      flipped[dstRow + col] = face[srcRow + col];
    }
  }
  return flipped;
}

function formatPixelCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`;
  return `${count}`;
}

function formatResolution(w: number): string {
  if (w >= 16384) return "16K";
  if (w >= 8192) return "8K";
  if (w >= 4096) return "4K";
  if (w >= 2048) return "2K";
  if (w >= 1024) return "1K";
  return `${w}px`;
}

export function cubemapToEquirectangular(
  faces: Float32Array[],
  faceSize: number,
  outputWidth: number,
  outputHeight: number,
  axisConfig?: AxisConfig,
  uploadMode?: "single" | "individual",
  onProgress?: ProgressCallback
): Float32Array {
  const totalPixels = outputWidth * outputHeight;
  const report = onProgress || (() => {});

  report(1, `Allocating ${formatResolution(outputWidth)} output buffer (${outputWidth} x ${outputHeight}) — ${formatPixelCount(totalPixels)} pixels`);
  const output = new Float32Array(totalPixels * 4);

  const config = axisConfig || defaultAxisConfig;
  const corrections = getDdsFaceCorrections(config.axisMapping, uploadMode || "individual");

  let correctedFaces = faces;
  if (corrections) {
    if (corrections.flipVertical) {
      report(3, "Applying vertical flip correction to all faces...");
      correctedFaces = faces.map((face) => flipFaceVertical(face, faceSize));
    } else {
      report(3, "Applying 180° rotation correction to all faces...");
      correctedFaces = faces.map((face) => rotateFace180(face, faceSize));
    }
    if (corrections.swapLeftRight) {
      report(4, "Swapping +X / -X faces...");
      const tempLR = correctedFaces[0];
      correctedFaces[0] = correctedFaces[1];
      correctedFaces[1] = tempLR;
    }
    if (corrections.swapTopBottom) {
      report(5, "Swapping +Y / -Y faces...");
      const temp = correctedFaces[2];
      correctedFaces[2] = correctedFaces[3];
      correctedFaces[3] = temp;
    }
  } else {
    report(3, "No face corrections needed");
  }

  const presetLabel = config.presetId
    ? config.presetId.charAt(0).toUpperCase() + config.presetId.slice(1)
    : "Custom";
  report(6, `Building coordinate transform (${presetLabel} axis mapping)...`);
  const mat = buildTransformMatrix(config);
  const useTransform = !isIdentityMatrix(mat);

  if (useTransform) {
    report(7, "Non-identity transform detected — applying axis remapping during projection");
  } else {
    report(7, "Identity transform — using direct cubemap sampling");
  }

  let lastReportedPercent = 7;

  for (let y = 0; y < outputHeight; y++) {
    const v = y / outputHeight;
    const theta = v * Math.PI;

    for (let x = 0; x < outputWidth; x++) {
      const u = x / outputWidth;
      const phi = u * 2 * Math.PI - Math.PI / 2;

      let dx = Math.sin(theta) * Math.cos(phi);
      let dy = Math.cos(theta);
      let dz = Math.sin(theta) * Math.sin(phi);

      if (useTransform) {
        [dx, dy, dz] = transformDir(mat, dx, dy, dz);
      }

      const { faceIndex, faceU, faceV } = directionToFace(dx, dy, dz);

      if (faceIndex >= 0 && faceIndex < correctedFaces.length) {
        const pixel = sampleFace(correctedFaces[faceIndex], faceSize, faceU, faceV);
        const outIdx = (y * outputWidth + x) * 4;
        output[outIdx] = pixel[0];
        output[outIdx + 1] = pixel[1];
        output[outIdx + 2] = pixel[2];
        output[outIdx + 3] = 1.0;
      }
    }

    const percent = Math.round(8 + (y / outputHeight) * 82);
    if (percent >= lastReportedPercent + 3) {
      lastReportedPercent = percent;
      report(percent, `Projecting row ${y + 1} of ${outputHeight}...`);
    }
  }

  report(90, `Projection complete — ${formatPixelCount(totalPixels)} pixels processed`);
  return output;
}

function directionToFace(
  x: number,
  y: number,
  z: number
): { faceIndex: number; faceU: number; faceV: number } {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);

  let faceIndex: number;
  let sc: number;
  let tc: number;
  let ma: number;

  if (ax >= ay && ax >= az) {
    ma = ax;
    if (x > 0) {
      faceIndex = 0;
      sc = -z;
      tc = -y;
    } else {
      faceIndex = 1;
      sc = z;
      tc = -y;
    }
  } else if (ay >= ax && ay >= az) {
    ma = ay;
    if (y > 0) {
      faceIndex = 2;
      sc = x;
      tc = z;
    } else {
      faceIndex = 3;
      sc = x;
      tc = -z;
    }
  } else {
    ma = az;
    if (z > 0) {
      faceIndex = 4;
      sc = x;
      tc = -y;
    } else {
      faceIndex = 5;
      sc = -x;
      tc = -y;
    }
  }

  const faceU = (sc / ma + 1) * 0.5;
  const faceV = (tc / ma + 1) * 0.5;

  return { faceIndex, faceU, faceV };
}

function sampleFace(
  faceData: Float32Array,
  faceSize: number,
  u: number,
  v: number
): [number, number, number] {
  const fx = u * (faceSize - 1);
  const fy = v * (faceSize - 1);

  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, faceSize - 1);
  const y1 = Math.min(y0 + 1, faceSize - 1);

  const dx = fx - x0;
  const dy = fy - y0;

  const idx00 = (y0 * faceSize + x0) * 4;
  const idx10 = (y0 * faceSize + x1) * 4;
  const idx01 = (y1 * faceSize + x0) * 4;
  const idx11 = (y1 * faceSize + x1) * 4;

  const r =
    faceData[idx00] * (1 - dx) * (1 - dy) +
    faceData[idx10] * dx * (1 - dy) +
    faceData[idx01] * (1 - dx) * dy +
    faceData[idx11] * dx * dy;

  const g =
    faceData[idx00 + 1] * (1 - dx) * (1 - dy) +
    faceData[idx10 + 1] * dx * (1 - dy) +
    faceData[idx01 + 1] * (1 - dx) * dy +
    faceData[idx11 + 1] * dx * dy;

  const b =
    faceData[idx00 + 2] * (1 - dx) * (1 - dy) +
    faceData[idx10 + 2] * dx * (1 - dy) +
    faceData[idx01 + 2] * (1 - dx) * dy +
    faceData[idx11 + 2] * dx * dy;

  return [r, g, b];
}
