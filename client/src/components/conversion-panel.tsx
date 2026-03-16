import { useState, useMemo, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Save, Loader2, AlertCircle, Sparkles, Link2, TriangleAlert, Info, FolderOpen, CheckCircle2 } from "lucide-react";
import type { UploadResult, OutputFormat } from "@shared/schema";

const RESOLUTION_TIERS = [512, 1024, 2048, 4096, 8192, 16384];

function getFormatBitDepth(format: OutputFormat): number {
  switch (format) {
    case "tiff": return 32;
    case "dds": return 16;
    case "exr": return 16;
    case "hdr": return 16;
    case "png": return 16;
    case "jpg": return 8;
    default: return 8;
  }
}

function parseSourceBitDepth(bitDepthStr: string): number {
  if (bitDepthStr.includes("32")) return 32;
  if (bitDepthStr.includes("16") || bitDepthStr.toLowerCase().includes("hdr")) return 16;
  return 8;
}

function tierLabel(w: number): string {
  if (w >= 16384) return "16K";
  if (w >= 8192) return "8K";
  if (w >= 4096) return "4K";
  if (w >= 2048) return "2K";
  if (w >= 1024) return "1K";
  return "512";
}

function computeMaxWidth(faceSize: number): number {
  const maxUseful = faceSize * 4;
  for (let i = RESOLUTION_TIERS.length - 1; i >= 0; i--) {
    if (RESOLUTION_TIERS[i] <= maxUseful) return RESOLUTION_TIERS[i];
  }
  return RESOLUTION_TIERS[0];
}

function computeOptimalWidth(faceSize: number): number {
  const optimal = faceSize * Math.PI;
  let best = RESOLUTION_TIERS[0];
  for (const tier of RESOLUTION_TIERS) {
    if (tier <= computeMaxWidth(faceSize)) {
      if (Math.abs(tier - optimal) < Math.abs(best - optimal)) {
        best = tier;
      }
    }
  }
  return best;
}

function estimateFileSize(format: OutputFormat, w: number, h: number): string {
  const pixels = w * h;
  let bytes: number;
  switch (format) {
    case "hdr":
      bytes = pixels * 5;
      break;
    case "exr":
      bytes = pixels * 6.5;
      break;
    case "png":
      bytes = pixels * 4;
      break;
    case "tiff":
      bytes = pixels * 12 + 1024;
      break;
    case "jpg":
      bytes = pixels * 1.2;
      break;
    case "dds":
      bytes = pixels * 8 + 148;
      break;
    default:
      bytes = pixels * 4;
  }
  if (bytes >= 1024 * 1024 * 1024) return `~${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `~${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `~${(bytes / 1024).toFixed(0)} KB`;
  return `~${bytes} B`;
}

function nearestTierIndex(w: number, maxIdx: number): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i <= maxIdx; i++) {
    const dist = Math.abs(RESOLUTION_TIERS[i] - w);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

interface ConversionPanelProps {
  uploadResult: UploadResult;
  isConverting: boolean;
  progress: number;
  conversionStage: string;
  downloadUrl: string | null;
  downloadFilename: string;
  error: string | null;
  savedDestPath: string | null;
  outputPath: string;
  onBrowseOutputPath: (defaultFilename: string, ext: string) => void;
  onConvert: (format: OutputFormat, width: number, height: number) => void;
  onSettingsChange?: () => void;
  onOutputSettingsChange?: (format: OutputFormat, width: number, height: number) => void;
}

const hasElectronAPI = typeof window !== "undefined" && !!window.electronAPI;

export function ConversionPanel({
  uploadResult,
  isConverting,
  progress,
  conversionStage,
  downloadUrl,
  downloadFilename,
  error,
  savedDestPath,
  outputPath,
  onBrowseOutputPath,
  onConvert,
  onSettingsChange,
  onOutputSettingsChange,
}: ConversionPanelProps) {
  const maxWidth = useMemo(() => computeMaxWidth(uploadResult.faceSize), [uploadResult.faceSize]);
  const optimalWidth = useMemo(() => computeOptimalWidth(uploadResult.faceSize), [uploadResult.faceSize]);
  const maxTierIdx = useMemo(() => RESOLUTION_TIERS.indexOf(maxWidth), [maxWidth]);
  const availableTiers = useMemo(() => RESOLUTION_TIERS.slice(0, maxTierIdx + 1), [maxTierIdx]);

  const [format, setFormat] = useState<OutputFormat>("hdr");
  const [width, setWidth] = useState(optimalWidth);
  const [height, setHeight] = useState(Math.round(optimalWidth / 2));
  const [widthText, setWidthText] = useState(String(optimalWidth));
  const [heightText, setHeightText] = useState(String(Math.round(optimalWidth / 2)));
  const [lockRatio, setLockRatio] = useState(true);

  const sliderIndex = nearestTierIndex(width, maxTierIdx);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onOutputSettingsChange?.(format, width, height);
  }, [format, width, height]);

  const applyWidth = (val: number) => {
    const clamped = Math.max(64, Math.min(16384, val));
    setWidth(clamped);
    setWidthText(String(clamped));
    if (lockRatio) {
      const h = Math.round(clamped / 2);
      setHeight(h);
      setHeightText(String(h));
    }
    onSettingsChange?.();
  };

  const applyHeight = (val: number) => {
    if (lockRatio) {
      const clampedH = Math.max(32, Math.min(8192, val));
      setHeight(clampedH);
      setHeightText(String(clampedH));
      const w = clampedH * 2;
      setWidth(w);
      setWidthText(String(w));
    } else {
      const clampedH = Math.max(32, Math.min(8192, val));
      setHeight(clampedH);
      setHeightText(String(clampedH));
    }
    onSettingsChange?.();
  };

  const sourceBitDepth = useMemo(() => {
    return uploadResult.fileInfo ? parseSourceBitDepth(uploadResult.fileInfo.bitDepth) : 0;
  }, [uploadResult.fileInfo]);

  const formatBitDepth = getFormatBitDepth(format);
  const isUpscaling = width > maxWidth;
  const isHigherBitDepth = sourceBitDepth > 0 && formatBitDepth > sourceBitDepth;
  const isLowerBitDepth = sourceBitDepth > 0 && formatBitDepth < sourceBitDepth;

  const handleSliderChange = (values: number[]) => {
    const idx = values[0];
    const newWidth = RESOLUTION_TIERS[idx];
    setWidth(newWidth);
    setWidthText(String(newWidth));
    if (lockRatio) {
      const h = Math.round(newWidth / 2);
      setHeight(h);
      setHeightText(String(h));
    }
    onSettingsChange?.();
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium" data-testid="text-settings-title">
        Conversion Settings
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="output-format" className="text-xs">Output Format</Label>
            <Select value={format} onValueChange={(v) => { setFormat(v as OutputFormat); onSettingsChange?.(); }}>
              <SelectTrigger id="output-format" data-testid="select-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hdr">Radiance HDR (.hdr)</SelectItem>
                <SelectItem value="exr">OpenEXR (.exr)</SelectItem>
                <SelectItem value="png">16-bit PNG (.png)</SelectItem>
                <SelectItem value="tiff">TIFF 32-bit float (.tiff)</SelectItem>
                <SelectItem value="jpg">JPEG (.jpg)</SelectItem>
                <SelectItem value="dds">DDS RGBA16F (.dds)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {format === "hdr"
                ? "RGBE encoding, widely compatible with 3D software"
                : format === "exr"
                ? "IEEE 754 half-float encoding, higher precision color data"
                : format === "png"
                ? "16-bit per channel with tone mapping, high precision output"
                : format === "tiff"
                ? "32-bit float per channel, full HDR precision, no tone mapping"
                : format === "jpg"
                ? "8-bit lossy compression, lightweight and widely compatible"
                : "RGBA half-float, uncompressed HDR texture for 3D engines"}
            </p>
            {isLowerBitDepth && (
              <div className="flex items-start gap-1.5 text-[11px] text-amber-500 dark:text-amber-400" data-testid="warning-lower-bitdepth">
                <TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Output is {formatBitDepth}-bit — lower than the {sourceBitDepth}-bit source. Some precision will be lost.</span>
              </div>
            )}
            {isHigherBitDepth && (
              <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground" data-testid="warning-higher-bitdepth">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Output is {formatBitDepth}-bit — higher than the {sourceBitDepth}-bit source. No additional detail will be gained.</span>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">Output Resolution</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLockRatio(!lockRatio)}
                className="h-6 px-2 text-xs"
                data-testid="button-lock-ratio"
              >
                <Link2 className={`w-3 h-3 mr-1 ${lockRatio ? "text-primary" : "text-muted-foreground"}`} />
                {lockRatio ? "2:1 Locked" : "Unlocked"}
              </Button>
            </div>

            <div className="space-y-2">
              <Slider
                value={[sliderIndex]}
                min={0}
                max={maxTierIdx}
                step={1}
                onValueChange={handleSliderChange}
                data-testid="slider-resolution"
              />
              <div className="flex justify-between px-0.5">
                {availableTiers.map((tier, i) => (
                  <button
                    key={tier}
                    onClick={() => handleSliderChange([i])}
                    className={`text-[10px] cursor-pointer transition-colors ${
                      sliderIndex === i
                        ? "text-primary font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid={`button-tier-${tierLabel(tier)}`}
                  >
                    {tierLabel(tier)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="width" className="text-xs text-muted-foreground">Width</Label>
                <Input
                  id="width"
                  type="number"
                  min={64}
                  max={16384}
                  step={64}
                  value={widthText}
                  onChange={(e) => setWidthText(e.target.value)}
                  onBlur={() => applyWidth(parseInt(widthText) || optimalWidth)}
                  onKeyDown={(e) => { if (e.key === "Enter") applyWidth(parseInt(widthText) || optimalWidth); }}
                  data-testid="input-width"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="height" className="text-xs text-muted-foreground">Height</Label>
                <Input
                  id="height"
                  type="number"
                  min={32}
                  max={8192}
                  step={32}
                  value={heightText}
                  onChange={(e) => setHeightText(e.target.value)}
                  onBlur={() => applyHeight(parseInt(heightText) || Math.round(optimalWidth / 2))}
                  onKeyDown={(e) => { if (e.key === "Enter") applyHeight(parseInt(heightText) || Math.round(optimalWidth / 2)); }}
                  data-testid="input-height"
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Max useful: {maxWidth}x{maxWidth / 2} based on {uploadResult.faceSize}px input faces
            </p>
            {isUpscaling && (
              <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground" data-testid="warning-upscaling">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Output resolution exceeds the source — no additional detail will be gained.</span>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-5 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Ready to Convert</span>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Output: <span className="text-foreground font-medium">{width} x {height}</span></p>
              <p>Format: <span className="text-foreground font-medium">{format === "hdr" ? "Radiance HDR" : format === "exr" ? "OpenEXR" : format === "png" ? "16-bit PNG" : format === "tiff" ? "TIFF 32-bit" : format === "dds" ? "DDS RGBA16F" : "JPEG"}</span></p>
              <p>Est. size: <span className="text-foreground font-medium">{estimateFileSize(format, width, height)}</span></p>
              <p>Source faces: <span className="text-foreground font-medium">{uploadResult.faces.length}</span></p>
            </div>
          </div>

          {hasElectronAPI && (
            <div className="space-y-1.5">
              <Label className="text-xs">Output File</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={outputPath}
                  placeholder="Choose output file..."
                  className="text-xs h-8 flex-1 cursor-default"
                  data-testid="input-output-path"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 shrink-0"
                  onClick={() => {
                    const ext = format;
                    const defaultName = `cubemap_hdri_${width}x${height}.${ext}`;
                    onBrowseOutputPath(defaultName, ext);
                  }}
                  disabled={isConverting}
                  data-testid="button-browse-output"
                >
                  <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
                  Browse
                </Button>
              </div>
            </div>
          )}

          {isConverting ? (
            <div className="space-y-2">
              <Progress value={progress} className="h-2" data-testid="progress-conversion" />
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span data-testid="text-conversion-stage">
                  {conversionStage || "Starting conversion..."}{progress > 0 && progress < 100 ? ` ${Math.round(progress)}%` : ""}
                </span>
              </div>
            </div>
          ) : savedDestPath ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-3 rounded-md bg-green-500/10 text-green-700 dark:text-green-400 text-xs" data-testid="text-saved-dest">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="break-all">Saved to {savedDestPath}</span>
              </div>
            </div>
          ) : downloadUrl ? (
            <div className="space-y-2">
              <Badge variant="secondary" className="w-full justify-center py-1.5">
                Conversion Complete
              </Badge>
              <Button
                className="w-full"
                asChild
                data-testid="button-download"
              >
                <a href={downloadUrl} download={downloadFilename}>
                  <Save className="w-4 h-4 mr-1.5" />
                  Save {downloadFilename}
                </a>
              </Button>
            </div>
          ) : (
            <Button
              className="w-full"
              onClick={() => onConvert(format, width, height)}
              disabled={isConverting || (hasElectronAPI && !outputPath)}
              data-testid="button-convert"
            >
              <Sparkles className="w-4 h-4 mr-1.5" />
              Convert to {format.toUpperCase()}
            </Button>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="text-conversion-error">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
