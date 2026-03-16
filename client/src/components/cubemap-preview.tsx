import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { cubemapFaceLabels, getDdsFaceCorrections, type CubemapFaceName, type AxisMapping } from "@shared/schema";

type Vec3 = [number, number, number];

const faceToVec: Record<CubemapFaceName, Vec3> = {
  positiveX: [1, 0, 0],
  negativeX: [-1, 0, 0],
  positiveY: [0, 1, 0],
  negativeY: [0, -1, 0],
  positiveZ: [0, 0, 1],
  negativeZ: [0, 0, -1],
};

const faceTangents: Record<CubemapFaceName, { right: Vec3; down: Vec3 }> = {
  positiveX: { right: [0, 0, -1], down: [0, -1, 0] },
  negativeX: { right: [0, 0, 1], down: [0, -1, 0] },
  positiveY: { right: [1, 0, 0], down: [0, 0, 1] },
  negativeY: { right: [1, 0, 0], down: [0, 0, -1] },
  positiveZ: { right: [1, 0, 0], down: [0, -1, 0] },
  negativeZ: { right: [-1, 0, 0], down: [0, -1, 0] },
};

function neg(v: Vec3): Vec3 {
  return [-v[0], -v[1], -v[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function getSlotExpectedTangents(
  slot: keyof AxisMapping,
  R: Vec3,
  U: Vec3,
  F: Vec3
): { right: Vec3; down: Vec3 } {
  switch (slot) {
    case "right": return { right: neg(F), down: neg(U) };
    case "left": return { right: F, down: neg(U) };
    case "up": return { right: R, down: F };
    case "down": return { right: R, down: neg(F) };
    case "front": return { right: R, down: neg(U) };
    case "back": return { right: neg(R), down: neg(U) };
  }
}

function computeFaceTransform(
  face: CubemapFaceName,
  slot: keyof AxisMapping,
  axisMapping: AxisMapping
): string {
  const R = faceToVec[axisMapping.right];
  const U = faceToVec[axisMapping.up];
  const F = faceToVec[axisMapping.front];

  const native = faceTangents[face];
  const expected = getSlotExpectedTangents(slot, R, U, F);

  const a = dot(expected.right, native.right);
  const b = dot(expected.right, native.down);
  const c = dot(expected.down, native.right);
  const d = dot(expected.down, native.down);

  if (a === 1 && b === 0 && c === 0 && d === 1) return "";
  if (a === 0 && b === 1 && c === -1 && d === 0) return "rotate(-90deg)";
  if (a === -1 && b === 0 && c === 0 && d === -1) return "rotate(180deg)";
  if (a === 0 && b === -1 && c === 1 && d === 0) return "rotate(90deg)";
  if (a === -1 && b === 0 && c === 0 && d === 1) return "scaleX(-1)";
  if (a === 1 && b === 0 && c === 0 && d === -1) return "scaleY(-1)";
  if (a === 0 && b === 1 && c === 1 && d === 0) return "rotate(-90deg) scaleX(-1)";
  if (a === 0 && b === -1 && c === -1 && d === 0) return "rotate(90deg) scaleX(-1)";

  return "";
}

const directionSlots: { key: keyof AxisMapping; label: string; row: number; col: number }[] = [
  { key: "up", label: "Up", row: 0, col: 1 },
  { key: "left", label: "Left", row: 1, col: 0 },
  { key: "front", label: "Front", row: 1, col: 1 },
  { key: "right", label: "Right", row: 1, col: 2 },
  { key: "back", label: "Back", row: 1, col: 3 },
  { key: "down", label: "Down", row: 2, col: 1 },
];

const sideSlots = new Set<keyof AxisMapping>(["right", "left", "front", "back"]);

function composeTransforms(mathTransform: string, correction: string): string {
  if (!correction) return mathTransform;
  if (!mathTransform) return correction;
  return `${correction} ${mathTransform}`;
}

interface CubemapPreviewProps {
  sessionId: string;
  faces: CubemapFaceName[];
  faceSize: number;
  axisMapping?: AxisMapping;
  uploadMode?: "single" | "individual";
  compact?: boolean;
}

export function CubemapPreview({ sessionId, faces, faceSize, axisMapping, uploadMode, compact }: CubemapPreviewProps) {
  const corrections = useMemo(() => {
    if (!axisMapping || !uploadMode) return null;
    return getDdsFaceCorrections(axisMapping, uploadMode);
  }, [axisMapping, uploadMode]);

  const transforms = useMemo(() => {
    if (!axisMapping) return null;
    const result: Record<string, string> = {};
    for (const slot of directionSlots) {
      const face = axisMapping[slot.key];
      const mathTransform = computeFaceTransform(face, slot.key, axisMapping);
      const correction = corrections
        ? (sideSlots.has(slot.key) ? corrections.sides : corrections.topBottom)
        : "";
      result[slot.key] = composeTransforms(mathTransform, correction);
    }
    return result;
  }, [axisMapping, corrections]);

  if (!axisMapping) {
    return (
      <div className={compact ? "space-y-2" : "space-y-3"}>
        {!compact && (
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-medium" data-testid="text-preview-title">
              Cubemap Face Preview
            </h3>
            {faceSize > 0 && (
              <span className="text-xs text-muted-foreground">
                {faceSize} x {faceSize} per face
              </span>
            )}
          </div>
        )}
        <div className={`grid ${compact ? "grid-cols-3 gap-1" : "grid-cols-3 sm:grid-cols-6 gap-2"}`}>
          {faces.map((face) => (
            <FaceCard key={face} sessionId={sessionId} face={face} compact={compact} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-1" : "space-y-3"}>
      {!compact && (
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-sm font-medium" data-testid="text-preview-title">
            Cubemap Face Preview
          </h3>
          {faceSize > 0 && (
            <span className="text-xs text-muted-foreground">
              {faceSize} x {faceSize} per face
            </span>
          )}
        </div>
      )}
      <div className={`grid grid-cols-4 ${compact ? "gap-0.5" : "gap-1.5"}`} style={{ gridTemplateRows: "repeat(3, 1fr)" }}>
        {Array.from({ length: 12 }).map((_, idx) => {
          const row = Math.floor(idx / 4);
          const col = idx % 4;
          const slot = directionSlots.find((s) => s.row === row && s.col === col);
          if (!slot) {
            return <div key={idx} />;
          }
          let face = axisMapping[slot.key];
          if (corrections?.swapTopBottom) {
            if (slot.key === "up") face = axisMapping["down"];
            else if (slot.key === "down") face = axisMapping["up"];
          }
          const transform = transforms?.[slot.key] || "";
          return (
            <FaceCard
              key={slot.key}
              sessionId={sessionId}
              face={face}
              directionLabel={slot.label}
              transform={transform}
              compact={compact}
            />
          );
        })}
      </div>
    </div>
  );
}

function FaceCard({
  sessionId,
  face,
  directionLabel,
  transform,
  compact,
}: {
  sessionId: string;
  face: CubemapFaceName;
  directionLabel?: string;
  transform?: string;
  compact?: boolean;
}) {
  return (
    <Card
      className="aspect-square relative group overflow-hidden"
      data-testid={`preview-face-${face}`}
    >
      <img
        src={`/api/preview/${sessionId}/${face}`}
        alt={cubemapFaceLabels[face]}
        className="w-full h-full object-cover rounded-md transition-transform duration-300"
        loading="lazy"
        style={transform ? { transform } : undefined}
      />
      <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent rounded-b-md ${compact ? "p-0.5" : "p-1"} opacity-0 group-hover:opacity-100 transition-opacity duration-150`}>
        <p className={`${compact ? "text-[8px]" : "text-[10px]"} text-white font-medium text-center leading-tight`}>
          {cubemapFaceLabels[face]}
        </p>
      </div>
      {directionLabel && (
        <div className={`absolute top-0 left-0 bg-black/50 rounded-br-md ${compact ? "px-1 py-px" : "px-1.5 py-0.5"}`}>
          <p className={`${compact ? "text-[8px]" : "text-[10px]"} text-white font-medium`}>{directionLabel}</p>
        </div>
      )}
    </Card>
  );
}
