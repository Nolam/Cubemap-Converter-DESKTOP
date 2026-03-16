import { useState, useCallback, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Upload, FileBox, Layers, AlertCircle, CheckCircle2, Loader2, FileIcon } from "lucide-react";
import type { UploadResult, CubemapFaceName } from "@shared/schema";
import { cubemapFaceLabels } from "@shared/schema";

interface FileUploadZoneProps {
  onUploadComplete: (result: UploadResult) => void;
}

type UploadStage = "idle" | "uploading" | "processing" | "done";

interface ProcessingStep {
  label: string;
  status: "done" | "error";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const faceOrder: CubemapFaceName[] = [
  "positiveX",
  "negativeX",
  "positiveY",
  "negativeY",
  "positiveZ",
  "negativeZ",
];

export function FileUploadZone({ onUploadComplete }: FileUploadZoneProps) {
  const [mode, setMode] = useState<"single" | "individual">("single");
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadFileSize, setUploadFileSize] = useState(0);
  const [allSteps, setAllSteps] = useState<ProcessingStep[]>([]);
  const [visibleStepCount, setVisibleStepCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [individualFiles, setIndividualFiles] = useState<Record<CubemapFaceName, File | null>>({
    positiveX: null,
    negativeX: null,
    positiveY: null,
    negativeY: null,
    positiveZ: null,
    negativeZ: null,
  });

  const singleInputRef = useRef<HTMLInputElement>(null);
  const faceInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const animTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isUploading = uploadStage !== "idle";

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (xhrRef.current) {
        xhrRef.current.abort();
        xhrRef.current = null;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (animTimerRef.current) clearInterval(animTimerRef.current);
      if (xhrRef.current) {
        xhrRef.current.abort();
        xhrRef.current = null;
      }
    };
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const animateSteps = useCallback((steps: ProcessingStep[]): Promise<void> => {
    return new Promise((resolve) => {
      if (animTimerRef.current) {
        clearInterval(animTimerRef.current);
        animTimerRef.current = null;
      }

      setAllSteps(steps);
      setVisibleStepCount(0);

      let current = 0;
      const interval = setInterval(() => {
        current++;
        setVisibleStepCount(current);
        if (current >= steps.length) {
          clearInterval(interval);
          animTimerRef.current = null;
          resolve();
        }
      }, 180);
      animTimerRef.current = interval;
    });
  }, []);

  const uploadWithXhr = useCallback(
    (url: string, formData: FormData): Promise<any> => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(pct);
          }
        });

        xhr.upload.addEventListener("loadend", () => {
          setUploadStage("processing");
          setAllSteps([{ label: "Analyzing file...", status: "done" }]);
          setVisibleStepCount(1);
        });

        xhr.addEventListener("load", () => {
          xhrRef.current = null;
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(data);
            } else {
              reject({ message: data.message || `Error (${xhr.status})`, steps: data.processingSteps });
            }
          } catch {
            reject({ message: `Unexpected error (${xhr.status})` });
          }
        });

        xhr.addEventListener("error", () => {
          xhrRef.current = null;
          reject({ message: "Something went wrong — please try again" });
        });

        xhr.addEventListener("timeout", () => {
          xhrRef.current = null;
          reject({ message: "Processing timed out — the file may be too large" });
        });

        xhr.addEventListener("abort", () => {
          xhrRef.current = null;
          reject({ message: "Cancelled" });
        });

        xhr.open("POST", url);
        xhr.timeout = 5 * 60 * 1000;
        xhr.send(formData);
      });
    },
    []
  );

  const runUploadFlow = useCallback(
    async (url: string, formData: FormData, fileName: string, fileSize: number) => {
      setUploadStage("uploading");
      setUploadProgress(0);
      setUploadFileName(fileName);
      setUploadFileSize(fileSize);
      setAllSteps([]);
      setVisibleStepCount(0);
      setError(null);

      try {
        const data = await uploadWithXhr(url, formData);
        const steps: ProcessingStep[] = data.processingSteps || [];

        setUploadStage("processing");

        if (steps.length > 0) {
          await animateSteps(steps);
        }

        setUploadStage("done");

        const { processingSteps: _, ...result } = data;

        setTimeout(() => {
          setUploadStage("idle");
          setAllSteps([]);
          setVisibleStepCount(0);
          onUploadComplete(result as UploadResult);
        }, 600);
      } catch (err: any) {
        const errSteps: ProcessingStep[] = err.steps || [];
        if (errSteps.length > 0) {
          setUploadStage("processing");
          await animateSteps(errSteps);
        }
        setError(err.message || "Failed to load file");
        setUploadStage("idle");
        setAllSteps([]);
        setVisibleStepCount(0);
      }
    },
    [onUploadComplete, uploadWithXhr, animateSteps]
  );

  const uploadSingleFile = useCallback(
    async (file: File) => {
      const formData = new FormData();
      formData.append("ddsFile", file);
      await runUploadFlow("/api/upload/single", formData, file.name, file.size);
    },
    [runUploadFlow]
  );

  const handleSingleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadSingleFile(file);
    },
    [uploadSingleFile]
  );

  const handleSingleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) uploadSingleFile(file);
      if (e.target) e.target.value = "";
    },
    [uploadSingleFile]
  );

  const handleFaceFileSelect = useCallback(
    (face: CubemapFaceName, file: File) => {
      setIndividualFiles((prev) => ({ ...prev, [face]: file }));
      setError(null);
    },
    []
  );

  const uploadIndividualFiles = useCallback(async () => {
    const filledFaces = faceOrder.filter((f) => individualFiles[f] !== null);
    if (filledFaces.length < 6) {
      setError("Please select all 6 cubemap face files");
      return;
    }

    let totalSize = 0;
    const formData = new FormData();
    for (const face of faceOrder) {
      const file = individualFiles[face];
      if (file) {
        formData.append(face, file);
        totalSize += file.size;
      }
    }

    await runUploadFlow("/api/upload/individual", formData, `${filledFaces.length} face files`, totalSize);
  }, [individualFiles, runUploadFlow]);

  const filledCount = faceOrder.filter((f) => individualFiles[f] !== null).length;

  const visibleSteps = allSteps.slice(0, visibleStepCount);
  const processingPercent = allSteps.length > 0
    ? Math.round((visibleStepCount / allSteps.length) * 100)
    : 0;

  const inlineStatusContent = (
    <>
      {uploadStage === "uploading" && (
        <div className="space-y-3 w-full max-w-xs">
          <div className="flex items-center gap-3">
            <FileIcon className="w-5 h-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" data-testid="text-upload-stage">
                Loading {uploadFileName}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(uploadFileSize)} &middot; {uploadProgress}%
              </p>
            </div>
          </div>
          <Progress value={uploadProgress} className="h-2" data-testid="progress-upload" />
        </div>
      )}

      {uploadStage === "processing" && (
        <div className="space-y-3 w-full max-w-xs">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" data-testid="text-upload-stage">
                Processing cubemap data
              </p>
              <p className="text-xs text-muted-foreground">
                Step {visibleStepCount}/{allSteps.length} &middot; {processingPercent}%
              </p>
            </div>
          </div>

          <Progress value={processingPercent} className="h-2" data-testid="progress-processing" />

          <div className="space-y-1.5 max-h-32 overflow-y-auto" data-testid="list-processing-steps">
            {visibleSteps.map((s, i) => {
              const isCurrent = i === visibleStepCount - 1 && visibleStepCount < allSteps.length;
              const isComplete = i < visibleStepCount - 1 || (i === visibleStepCount - 1 && visibleStepCount === allSteps.length);
              const isError = s.status === "error";
              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 text-xs transition-all duration-200 ${
                    isError
                      ? "text-destructive font-medium"
                      : isComplete
                      ? "text-muted-foreground"
                      : isCurrent
                      ? "text-foreground font-medium"
                      : "text-muted-foreground"
                  }`}
                  data-testid={`step-${i + 1}`}
                >
                  {isError ? (
                    <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                  ) : isComplete ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                  ) : isCurrent ? (
                    <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/30 shrink-0" />
                  )}
                  <span className="truncate">{s.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {uploadStage === "done" && (
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
          <p className="text-sm font-medium" data-testid="text-upload-stage">
            Processing complete!
          </p>
        </div>
      )}
    </>
  );

  return (
    <div className="max-w-2xl mx-auto">
      <Tabs value={mode} onValueChange={(v) => setMode(v as "single" | "individual")}>
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="single" disabled={isUploading} data-testid="tab-single-file">
            <FileBox className="w-4 h-4 mr-1.5" />
            Single DDS File
          </TabsTrigger>
          <TabsTrigger value="individual" disabled={isUploading} data-testid="tab-individual-files">
            <Layers className="w-4 h-4 mr-1.5" />
            Individual Faces
          </TabsTrigger>
        </TabsList>

        <TabsContent value="single" className="mt-4">
          <Card
            className={`relative border-2 border-dashed transition-colors duration-200 ${
              isUploading ? "" : "cursor-pointer"
            } ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/20"
            }`}
            onDragOver={!isUploading ? handleDragOver : undefined}
            onDragLeave={!isUploading ? handleDragLeave : undefined}
            onDrop={!isUploading ? handleSingleDrop : undefined}
            onClick={() => !isUploading && singleInputRef.current?.click()}
            data-testid="dropzone-single"
          >
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              {isUploading ? (
                inlineStatusContent
              ) : (
                <>
                  <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
                    <Upload className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium mb-1">
                    Drop your DDS cubemap file here
                  </p>
                  <p className="text-xs text-muted-foreground mb-4">
                    or click to browse &middot; Supports .dds files with cubemap faces
                  </p>
                  <Button variant="secondary" size="sm" data-testid="button-browse-single">
                    Browse Files
                  </Button>
                </>
              )}
            </div>
            <input
              ref={singleInputRef}
              type="file"
              accept=".dds"
              className="hidden"
              onChange={handleSingleFileSelect}
              data-testid="input-file-single"
            />
          </Card>
        </TabsContent>

        <TabsContent value="individual" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {faceOrder.map((face) => {
              const file = individualFiles[face];
              return (
                <Card
                  key={face}
                  className={`p-4 cursor-pointer transition-colors duration-150 ${
                    file ? "border-primary/40 bg-primary/5" : ""
                  } ${isUploading ? "pointer-events-none opacity-60" : ""}`}
                  onClick={() => !isUploading && faceInputRefs.current[face]?.click()}
                  data-testid={`dropzone-face-${face}`}
                >
                  <div className="flex flex-col items-center text-center gap-2">
                    {file ? (
                      <CheckCircle2 className="w-5 h-5 text-primary" />
                    ) : (
                      <Upload className="w-5 h-5 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-xs font-medium">{cubemapFaceLabels[face]}</p>
                      {file ? (
                        <p className="text-xs text-muted-foreground truncate max-w-[120px]">
                          {file.name}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Click to select file</p>
                      )}
                    </div>
                  </div>
                  <input
                    ref={(el) => {
                      faceInputRefs.current[face] = el;
                    }}
                    type="file"
                    accept=".dds,.png,.jpg,.jpeg,.tga,.tif,.tiff"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFaceFileSelect(face, f);
                      if (e.target) e.target.value = "";
                    }}
                    data-testid={`input-file-${face}`}
                  />
                </Card>
              );
            })}
          </div>

          {isUploading ? (
            <Card className="p-4 space-y-3" data-testid="card-upload-status">
              {inlineStatusContent}
            </Card>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground">
                  {filledCount}/6 faces selected
                </p>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                  You can choose which coordinate system you're using after loading
                </p>
              </div>
              <Button
                onClick={uploadIndividualFiles}
                disabled={filledCount < 6 || isUploading}
                data-testid="button-upload-individual"
              >
                Load All Faces
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {error && (
        <div className="mt-4 flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="text-upload-error">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
