import { useState, useCallback, useEffect } from "react";
import { FileUploadZone } from "@/components/file-upload-zone";
import { CubemapPreview } from "@/components/cubemap-preview";
import { ConversionPanel } from "@/components/conversion-panel";
import { AxisSettings } from "@/components/axis-settings";
import { WelcomePopup } from "@/components/welcome-popup";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RotateCcw, Box, ArrowRight, Sun, Moon } from "lucide-react";
import type { UploadResult, OutputFormat } from "@shared/schema";
import { defaultAxisConfig, type AxisConfig } from "@shared/schema";

export default function Home() {
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState(0);
  const [conversionStage, setConversionStage] = useState("");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadFilename, setDownloadFilename] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [axisConfig, setAxisConfig] = useState<AxisConfig>({ ...defaultAxisConfig });
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      return document.documentElement.classList.contains("dark");
    }
    return true;
  });

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  }, []);

  const handleUploadComplete = useCallback((result: UploadResult) => {
    setUploadResult(result);
    setDownloadUrl(null);
    setError(null);
    setConversionProgress(0);
  }, []);

  const handleAxisConfigChange = useCallback((newConfig: AxisConfig) => {
    setAxisConfig(newConfig);
    setDownloadUrl(null);
    setError(null);
    setConversionProgress(0);
  }, []);

  const handleConvert = useCallback(
    async (format: OutputFormat, width: number, height: number) => {
      if (!uploadResult) return;

      setIsConverting(true);
      setConversionProgress(0);
      setConversionStage("Starting conversion...");
      setError(null);
      setDownloadUrl(null);

      try {
        const res = await fetch("/api/convert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: uploadResult.sessionId,
            outputFormat: format,
            outputWidth: width,
            outputHeight: height,
            axisConfig,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ message: "Conversion failed" }));
          if (res.status === 413) {
            throw new Error("File too large. Try a smaller file or lower resolution.");
          }
          throw new Error(errData.message || "Conversion failed");
        }

        const contentType = res.headers.get("content-type") || "";

        if (contentType.includes("text/event-stream")) {
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const event = JSON.parse(line.slice(6));
                  if (event.type === "progress") {
                    setConversionProgress(event.percent);
                    if (event.stage) setConversionStage(event.stage);
                  } else if (event.type === "complete") {
                    setConversionProgress(100);
                    setConversionStage("Complete!");
                    setDownloadUrl(event.downloadUrl);
                    setDownloadFilename(event.filename);
                  } else if (event.type === "error") {
                    throw new Error(event.message || "Conversion failed");
                  }
                } catch (parseErr: any) {
                  if (parseErr.message && parseErr.message !== "Conversion failed" && !parseErr.message.includes("JSON")) {
                    throw parseErr;
                  }
                }
              }
            }
          }
        } else {
          const data = await res.json();
          setConversionProgress(100);
          setConversionStage("Complete!");
          setDownloadUrl(data.downloadUrl);
          setDownloadFilename(data.filename);
        }
      } catch (err: any) {
        setError(err.message || "An unexpected error occurred");
      } finally {
        setIsConverting(false);
      }
    },
    [uploadResult, axisConfig]
  );

  const handleReset = useCallback(() => {
    if (uploadResult?.sessionId) {
      fetch(`/api/session/${uploadResult.sessionId}`, { method: "DELETE" }).catch(() => {});
    }
    setUploadResult(null);
    setDownloadUrl(null);
    setError(null);
    setConversionProgress(0);
    setIsConverting(false);
  }, [uploadResult]);

  return (
    <div className="min-h-screen bg-background">
      <WelcomePopup />
      <header className="border-b sticky top-0 z-50 bg-background/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <svg className="w-5 h-5 text-primary-foreground" viewBox="0 0 512 512" fill="currentColor">
                <path d="M256,0L28.44,117.55v276.901L256,512l227.56-117.55v-276.9L256,0z M256,33.776l179.864,92.91l-75.078,38.783
                  c-25.423-29.386-62.97-48.009-104.786-48.009c-41.815,0-79.363,18.623-104.786,48.009l-75.078-38.783L256,33.776z M364.532,256
                  c0,54.754-40.759,100.159-93.528,107.489V245.623l80.312-41.486C359.739,219.555,364.532,237.228,364.532,256z M240.996,470.475
                  L58.448,376.176V151.325l75.575,39.04c-10.561,19.547-16.563,41.902-16.563,65.636c0,71.322,54.176,130.221,123.536,137.725
                  V470.475z M240.996,363.489c-52.768-7.33-93.528-52.735-93.528-107.489c0-18.772,4.792-36.445,13.216-51.863l80.312,41.486
                  V363.489z M178.85,179.745c19.687-19.915,47-32.277,77.15-32.277c30.15,0,57.463,12.361,77.15,32.277L256,219.598L178.85,179.745z
                  M453.552,376.175l-182.548,94.299v-76.749C340.364,386.221,394.54,327.322,394.54,256c0-23.732-6.002-46.089-16.563-65.636
                  l75.575-39.04V376.175z"/>
              </svg>
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold tracking-tight" data-testid="text-app-title">
                CubeMap to HDRI
              </h1>
              <Badge variant="secondary" className="text-xs font-normal">Converter (Desktop Version)</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {uploadResult && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                data-testid="button-reset"
              >
                <RotateCcw className="w-4 h-4 mr-1.5" />
                New Conversion
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleDarkMode}
              data-testid="button-theme-toggle"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </header>
      <main className={`max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 ${uploadResult ? "py-4" : "py-8"}`}>
        {!uploadResult ? (
          <div className="space-y-8">
            <div className="text-center max-w-2xl mx-auto space-y-3">
              <h2 className="text-3xl font-bold tracking-tight" data-testid="text-hero-title">
                Convert DDS Cubemaps to HDRI
              </h2>
              <p className="text-muted-foreground text-base leading-relaxed">Open a DDS cubemap file containing all 6 faces, or load each face individually. Export in multiple formats, such as Radiance HDR or OpenEXR.</p>
            </div>

            <FileUploadZone onUploadComplete={handleUploadComplete} />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mx-auto">
              <Card className="p-5 text-center space-y-2">
                <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mx-auto">
                  <Box className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-sm font-medium">DDS Cubemap Input</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Single DDS with all 6 faces or 6 individual face files
                </p>
              </Card>
              <Card className="p-5 text-center space-y-2">
                <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mx-auto">
                  <ArrowRight className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-sm font-medium">Equirectangular Projection</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Precise cubemap-to-equirectangular mapping with HDR preservation
                </p>
              </Card>
              <Card className="p-5 text-center space-y-2">
                <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mx-auto">
                  <Sun className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-sm font-medium">HDR / EXR Output</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Export as Radiance .hdr or OpenEXR .exr with full dynamic range
                </p>
              </Card>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold tracking-tight" data-testid="text-upload-title">
                  Cubemap Loaded
                </h2>
                <Badge variant="secondary" data-testid="badge-upload-mode">
                  {uploadResult.mode === "single" ? "Single DDS" : "Individual Files"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {uploadResult.mode === "single"
                  ? "Single DDS file"
                  : `${uploadResult.faces.length} face files`}
                {uploadResult.faceSize > 0 && (
                  <span> &middot; {uploadResult.faceSize}x{uploadResult.faceSize}px</span>
                )}
                {uploadResult.fileInfo && (
                  <span> &middot; {uploadResult.fileInfo.inputFormat} &middot; {uploadResult.fileInfo.bitDepth} {uploadResult.fileInfo.channels}</span>
                )}
              </p>
            </div>

            <div className="grid grid-cols-[2fr_3fr] gap-6 items-start">
              <Card className="p-3">
                <CubemapPreview
                  sessionId={uploadResult.sessionId}
                  faces={uploadResult.faces}
                  faceSize={uploadResult.faceSize}
                  axisMapping={axisConfig.axisMapping}
                  uploadMode={uploadResult.mode}
                  compact
                />
              </Card>

              <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-10rem)]">
                <AxisSettings
                  config={axisConfig}
                  onChange={handleAxisConfigChange}
                />

                <ConversionPanel
                  uploadResult={uploadResult}
                  isConverting={isConverting}
                  progress={conversionProgress}
                  conversionStage={conversionStage}
                  downloadUrl={downloadUrl}
                  downloadFilename={downloadFilename}
                  error={error}
                  onConvert={handleConvert}
                  onSettingsChange={() => {
                    setDownloadUrl(null);
                    setError(null);
                    setConversionProgress(0);
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </main>
      <footer className={`border-t ${uploadResult ? "mt-4" : "mt-16"}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>Designed by David Parrella - <a href="https://www.paypal.com/paypalme/parrella/" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">Click Here</a> to buy me a Coffee! :)</span>
          <span>Supports DDS cubemap formats with HDR data</span>
        </div>
      </footer>
    </div>
  );
}
