import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Loader2, ImageIcon } from "lucide-react";
import type { AxisConfig } from "@shared/schema";

interface EquirectangularPreviewProps {
  sessionId: string;
  axisConfig: AxisConfig;
}

export function EquirectangularPreview({ sessionId, axisConfig }: EquirectangularPreviewProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageUrlRef = useRef<string | null>(null);

  const fetchPreview = useCallback(async (signal: AbortSignal) => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/preview-equirect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, axisConfig }),
        signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: "Preview failed" }));
        throw new Error(data.message || "Preview failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      setImageUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        imageUrlRef.current = url;
        return url;
      });
      setError(null);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError(err.message || "Preview failed");
    } finally {
      if (!signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [sessionId, axisConfig]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      fetchPreview(controller.signal);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchPreview]);

  useEffect(() => {
    return () => {
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    };
  }, []);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground" data-testid="text-equirect-preview-title">
          Equirectangular Preview
        </h3>
        <span className="text-[10px] text-muted-foreground/60">512 × 256 low-res</span>
      </div>
      <Card className="overflow-hidden relative" data-testid="card-equirect-preview">
        {imageUrl && !error ? (
          <img
            src={imageUrl}
            alt="Equirectangular preview"
            className={`w-full h-auto block transition-opacity duration-200 ${isLoading ? "opacity-40" : "opacity-100"}`}
            data-testid="img-equirect-preview"
          />
        ) : (
          <div className="w-full aspect-[2/1] flex items-center justify-center bg-muted/30">
            {error ? (
              <p className="text-xs text-destructive px-4 text-center" data-testid="text-equirect-error">{error}</p>
            ) : (
              <ImageIcon className="w-6 h-6 text-muted-foreground/30" />
            )}
          </div>
        )}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/30">
            <Loader2 className="w-5 h-5 animate-spin text-primary" data-testid="spinner-equirect-preview" />
          </div>
        )}
      </Card>
    </div>
  );
}
