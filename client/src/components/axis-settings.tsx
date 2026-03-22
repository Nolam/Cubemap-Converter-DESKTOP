import { useState, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Settings2, RotateCw, Info, ArrowRight, ChevronUp, ChevronDown } from "lucide-react";
import {
  cubemapFaceNames,
  cubemapFaceLabels,
  coordinatePresets,
  defaultAxisConfig,
  type AxisConfig,
  type CoordinatePreset,
  type CubemapFaceName,
  type AxisMapping,
} from "@shared/schema";

const opposites: Record<CubemapFaceName, CubemapFaceName> = {
  positiveX: "negativeX",
  negativeX: "positiveX",
  positiveY: "negativeY",
  negativeY: "positiveY",
  positiveZ: "negativeZ",
  negativeZ: "positiveZ",
};

const primaryAxes: { key: keyof AxisMapping; opposite: keyof AxisMapping; label: string; oppositeLabel: string; desc: string }[] = [
  { key: "right", opposite: "left", label: "Right", oppositeLabel: "Left", desc: "Which cubemap face represents the right direction" },
  { key: "up", opposite: "down", label: "Up", oppositeLabel: "Down", desc: "Which cubemap face represents the up direction" },
  { key: "front", opposite: "back", label: "Front", oppositeLabel: "Back", desc: "Which cubemap face represents the forward direction" },
];

function matchesMapping(a: AxisMapping, b: AxisMapping): boolean {
  return a.right === b.right && a.left === b.left &&
    a.up === b.up && a.down === b.down &&
    a.front === b.front && a.back === b.back;
}

function findMatchingPreset(mapping: AxisMapping): CoordinatePreset | undefined {
  return coordinatePresets.find((p) => matchesMapping(p.axisMapping, mapping));
}

interface AxisSettingsProps {
  config: AxisConfig;
  onChange: (config: AxisConfig) => void;
}

export function AxisSettings({ config, onChange }: AxisSettingsProps) {
  const [expanded, setExpanded] = useState(false);
  const lastCustomMapping = useRef<AxisMapping | null>(
    config.presetId === "custom" ? { ...config.axisMapping } : null
  );

  const handlePresetChange = useCallback((presetId: string) => {
    if (presetId === "custom") {
      onChange({
        ...config,
        presetId: "custom",
        axisMapping: lastCustomMapping.current
          ? { ...lastCustomMapping.current }
          : { ...config.axisMapping },
      });
      return;
    }
    const preset = coordinatePresets.find((p) => p.id === presetId);
    if (preset) {
      onChange({
        presetId: preset.id,
        handedness: preset.handedness,
        axisMapping: { ...preset.axisMapping },
      });
    }
  }, [config, onChange]);

  const handleAxisChange = useCallback((axis: keyof AxisMapping, face: CubemapFaceName) => {
    const pair = primaryAxes.find((p) => p.key === axis || p.opposite === axis);
    if (!pair) return;
    const isPrimary = pair.key === axis;
    const newMapping: AxisMapping = {
      ...config.axisMapping,
      [axis]: face,
      [isPrimary ? pair.opposite : pair.key]: opposites[face],
    };
    const matched = findMatchingPreset(newMapping);
    if (!matched) {
      lastCustomMapping.current = { ...newMapping };
    }
    onChange({
      ...config,
      presetId: matched ? matched.id : "custom",
      handedness: matched ? matched.handedness : config.handedness,
      axisMapping: newMapping,
    });
  }, [config, onChange]);

  const handleReset = useCallback(() => {
    onChange({ ...defaultAxisConfig });
  }, [onChange]);

  const currentPreset = coordinatePresets.find((p) => p.id === config.presetId);
  const isCustom = config.presetId === "custom";

  const panelOpen = isCustom && expanded;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Settings2 className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-medium" data-testid="text-axis-settings-title">
          Coordinate System
        </h3>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              <p className="text-xs">
                Different 3D tools use different coordinate systems.
                Select the tool that generated your cubemap to ensure
                faces are mapped correctly during conversion.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5" data-testid="preset-buttons">
          {coordinatePresets.map((preset) => (
            <Button
              key={preset.id}
              variant={config.presetId === preset.id ? "default" : "outline"}
              size="sm"
              onClick={() => {
                handlePresetChange(preset.id);
                setExpanded(false);
              }}
              className="text-xs h-7 px-2.5"
              data-testid={`button-preset-${preset.id}`}
            >
              {preset.label}
            </Button>
          ))}
          <Button
            variant={isCustom ? "default" : "outline"}
            size="sm"
            onClick={() => {
              if (isCustom) {
                setExpanded(!expanded);
              } else {
                handlePresetChange("custom");
                setExpanded(true);
              }
            }}
            className="text-xs h-7 px-2.5 gap-1"
            data-testid="button-preset-custom"
          >
            Custom
            {isCustom && (
              expanded
                ? <ChevronUp className="w-3 h-3" />
                : <ChevronDown className="w-3 h-3" />
            )}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground" data-testid="text-preset-description">
          {isCustom
            ? "Custom axis mapping"
            : currentPreset
            ? currentPreset.description
            : "Select a coordinate system preset"}
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateRows: panelOpen ? "1fr" : "0fr",
          transition: "grid-template-rows 280ms ease, opacity 280ms ease",
          opacity: panelOpen ? 1 : 0,
        }}
      >
        <div className="overflow-hidden min-h-0">
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">Axis Assignments</Label>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  className="h-6 px-2 text-xs"
                  data-testid="button-reset-axis"
                >
                  <RotateCw className="w-3 h-3 mr-1" />
                  Reset
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setExpanded(false)}
                  className="h-6 px-2 text-xs"
                  data-testid="button-collapse-axis-settings"
                >
                  <ChevronUp className="w-3 h-3 mr-1" />
                  Collapse
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              {primaryAxes.map(({ key, opposite, label, oppositeLabel, desc }) => (
                <div key={key} className="grid grid-cols-[40px_1fr_16px_40px_1fr] items-center gap-1.5">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Label className="text-xs text-muted-foreground cursor-help text-right">
                          {label}
                        </Label>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">{desc}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Select
                    value={config.axisMapping[key]}
                    onValueChange={(v) => handleAxisChange(key, v as CubemapFaceName)}
                  >
                    <SelectTrigger
                      className="h-7 text-xs"
                      data-testid={`select-axis-${key}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {cubemapFaceNames.map((face) => (
                        <SelectItem key={face} value={face} className="text-xs">
                          {cubemapFaceLabels[face]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ArrowRight className="w-3 h-3 text-muted-foreground mx-auto" />
                  <Label className="text-xs text-muted-foreground text-right">
                    {oppositeLabel}
                  </Label>
                  <Select
                    value={config.axisMapping[opposite]}
                    onValueChange={(v) => handleAxisChange(opposite, v as CubemapFaceName)}
                  >
                    <SelectTrigger
                      className="h-7 text-xs"
                      data-testid={`select-axis-${opposite}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {cubemapFaceNames.map((face) => (
                        <SelectItem key={face} value={face} className="text-xs">
                          {cubemapFaceLabels[face]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Changing either side automatically sets the opposite face.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
