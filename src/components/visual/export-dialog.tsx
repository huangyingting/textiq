"use client";

import { AnimatePresence } from "framer-motion";
import { Download } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  Button,
  ColorPicker,
  FieldRow,
  SegmentedControl,
  cx,
  FOCUS_RING,
  type SegmentedOption,
} from "@/components/ui";
import {
  ExportPreviewThumbnail,
  VisualExportDialogShell,
} from "@/components/visual/export-workflow-chrome";
import type { PlanEntitlements } from "@/lib/billing/catalog";
import {
  applySocialPresetToOptions,
  clearSocialPreset,
  applyExportOptionsToSvg,
  type BackgroundMode,
  type ColorMode,
  type ExportOptions,
  type SocialPreset,
} from "@/lib/visual/export-options";
import { resolveExportPolicy } from "@/lib/visual/export-policy";
import { createDefaultExportDialogOptions } from "@/lib/visual/export-settings";
import { OUTPUT_PROFILE_CATALOG } from "@/lib/visual/output-profiles";
import {
  downloadBlob,
  exportPDF,
  exportPNG,
  exportPPTX,
} from "@/lib/visual/export";
import {
  bucketBytes,
  bucketDurationMs,
  emitProductTelemetry,
} from "@/lib/telemetry/product";
import type { Visual } from "@/lib/visual/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportFormat = "svg" | "png" | "pdf" | "pptx";

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  getSvgElement: () => SVGSVGElement | null;
  getVisual?: () => Visual | null;
  filename: string;
  /** Entitlements from the current user's plan. Defaults to free tier limits. */
  entitlements?: Pick<
    PlanEntitlements,
    "svgExport" | "pptxExport" | "removeWatermark"
  >;
}

// ---------------------------------------------------------------------------
// Segmented control option sets
// ---------------------------------------------------------------------------

const BG_OPTIONS: SegmentedOption<BackgroundMode>[] = [
  { value: "include", label: "Include" },
  { value: "transparent", label: "Transparent" },
  { value: "custom", label: "Custom" },
];

const COLOR_OPTIONS: SegmentedOption<ColorMode>[] = [
  { value: "color", label: "Color" },
  { value: "mono", label: "Mono" },
];

const SCALE_OPTIONS: SegmentedOption<string>[] = [
  { value: "1", label: "1×" },
  { value: "2", label: "2×" },
  { value: "3", label: "3×" },
];

const FORMAT_OPTIONS: SegmentedOption<ExportFormat>[] = [
  { value: "png", label: "PNG" },
  { value: "svg", label: "SVG" },
  { value: "pdf", label: "PDF" },
  { value: "pptx", label: "PPTX" },
];

// ---------------------------------------------------------------------------
// Live preview hook
// ---------------------------------------------------------------------------

/**
 * Builds a data URL that reflects the current ExportOptions against the source
 * SVG element. Returns undefined while the image is being re-generated.
 */
function useExportPreview(
  getSvgElement: () => SVGSVGElement | null,
  options: ExportOptions,
  format: ExportFormat,
): string | undefined {
  const [dataUrl, setDataUrl] = useState<string | undefined>(undefined);
  const pendingRef = useRef(0);

  useEffect(() => {
    const tick = ++pendingRef.current;
    const svg = getSvgElement();
    if (!svg) return;

    // SVG and PDF share SVG-based preview; PNG/PPTX use PNG-based preview.
    if (format === "svg" || format === "pdf") {
      let url: string | undefined;
      try {
        const serializer = new XMLSerializer();
        const raw = serializer.serializeToString(svg);
        const transformed = applyExportOptionsToSvg(raw, options);
        const blob = new Blob([transformed], {
          type: "image/svg+xml;charset=utf-8",
        });
        url = URL.createObjectURL(blob);
      } catch {
        // fall through to undefined
      }

      if (url) {
        const capturedUrl = url;
        // Schedule state update after effect body to satisfy lint rule
        queueMicrotask(() => {
          if (tick === pendingRef.current) setDataUrl(capturedUrl);
        });
        return () => URL.revokeObjectURL(capturedUrl);
      }
    } else {
      // PNG / PPTX — use a lower-res preview (1x)
      const previewOpts: ExportOptions = { ...options, scale: 1 };
      let cancelled = false;
      let objectUrl: string | undefined;

      exportPNG(svg, previewOpts).then((blob) => {
        if (cancelled || !blob || tick !== pendingRef.current) return;
        objectUrl = URL.createObjectURL(blob);
        setDataUrl(objectUrl);
      });

      return () => {
        cancelled = true;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }
  }, [getSvgElement, options, format]);

  return dataUrl;
}

// ---------------------------------------------------------------------------
// Format label helpers
// ---------------------------------------------------------------------------

function formatLabel(format: ExportFormat): string {
  return format.toUpperCase();
}

function formatDescription(format: ExportFormat): string {
  switch (format) {
    case "svg":
      return "Scalable vector";
    case "png":
      return "Raster image";
    case "pdf":
      return "Document";
    case "pptx":
      return "Slide";
  }
}

// ---------------------------------------------------------------------------
// ExportDialog
// ---------------------------------------------------------------------------

/**
 * Modal export dialog with live preview, background/color-mode/resolution
 * controls, and per-format download.
 */
export function ExportDialog({
  open,
  onClose,
  getSvgElement,
  getVisual,
  filename,
  entitlements,
}: ExportDialogProps) {
  const exportPolicy = resolveExportPolicy(entitlements);
  const canSvg = exportPolicy.canSvg;
  const canPptx = exportPolicy.canPptx;
  const canRemoveWatermark = exportPolicy.canRemoveWatermark;
  const defaultWatermark = exportPolicy.defaultWatermark;

  const [format, setFormat] = useState<ExportFormat>("png");
  const [options, setOptions] = useState<ExportOptions>(() =>
    createDefaultExportDialogOptions(exportPolicy),
  );
  const [watermarkOverride, setWatermarkOverride] = useState<
    boolean | undefined
  >(undefined);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const exportOperationIdRef = useRef(0);
  const exportInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      exportOperationIdRef.current += 1;
      exportInFlightRef.current = false;
    };
  }, []);

  const effectiveWatermark = canRemoveWatermark
    ? (watermarkOverride ?? defaultWatermark)
    : defaultWatermark;
  const exportOptions = useMemo<ExportOptions>(
    () => ({ ...options, watermark: effectiveWatermark }),
    [effectiveWatermark, options],
  );

  const previewUrl = useExportPreview(getSvgElement, exportOptions, format);

  const requestClose = useCallback(() => {
    if (exportInFlightRef.current) return;
    onClose();
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, requestClose]);

  const setBackground = useCallback(
    (bg: BackgroundMode) =>
      setOptions((o) => ({ ...o, background: bg, socialPreset: undefined })),
    [],
  );

  const setColorMode = useCallback(
    (mode: ColorMode) => setOptions((o) => ({ ...o, colorMode: mode })),
    [],
  );

  const setScale = useCallback(
    (s: string) => setOptions((o) => ({ ...o, scale: Number(s) })),
    [],
  );

  const selectSocialPreset = useCallback(
    (preset: SocialPreset) =>
      setOptions((o) =>
        o.socialPreset === preset
          ? clearSocialPreset(o)
          : applySocialPresetToOptions(preset, o),
      ),
    [],
  );

  const toggleBranding = useCallback(
    () => setWatermarkOverride((current) => !(current ?? defaultWatermark)),
    [defaultWatermark],
  );

  const setCustomBackground = useCallback(
    (hex: string) => setOptions((o) => ({ ...o, customBackground: hex })),
    [],
  );

  const handleExport = useCallback(async () => {
    if (exportInFlightRef.current) return;
    exportInFlightRef.current = true;
    const operationId = ++exportOperationIdRef.current;
    setError(null);
    setExporting(true);
    const startedAt = performance.now();
    emitProductTelemetry("product.export.started", {
      exportKind: "visual",
      outputFormat: format,
    });

    try {
      // Entitlement guard
      if (format === "svg" && !canSvg) {
        emitProductTelemetry("product.export.failed", {
          durationBucket: bucketDurationMs(performance.now() - startedAt),
          exportKind: "visual",
          failureReason: "entitlement",
          outputFormat: format,
        });
        setError("SVG export requires Plus or Pro. Upgrade your plan.");
        return;
      }
      if (format === "pptx" && !canPptx) {
        emitProductTelemetry("product.export.failed", {
          durationBucket: bucketDurationMs(performance.now() - startedAt),
          exportKind: "visual",
          failureReason: "entitlement",
          outputFormat: format,
        });
        setError("PPTX export requires Plus or Pro. Upgrade your plan.");
        return;
      }

      const svg = getSvgElement();
      if (!svg) {
        emitProductTelemetry("product.export.failed", {
          durationBucket: bucketDurationMs(performance.now() - startedAt),
          exportKind: "visual",
          failureReason: "missing_visual",
          outputFormat: format,
        });
        setError("No visual to export");
        return;
      }

      let blob: Blob | null = null;
      const ext = format;

      switch (format) {
        case "svg": {
          // For SVG apply the export options as transforms, then download
          const serializer = new XMLSerializer();
          const raw = serializer.serializeToString(svg);
          const transformed = applyExportOptionsToSvg(raw, exportOptions);
          const xmlHeader = `<?xml version="1.0" encoding="UTF-8"?>\n`;
          blob = new Blob([xmlHeader + transformed], {
            type: "image/svg+xml;charset=utf-8",
          });
          break;
        }
        case "png":
          blob = await exportPNG(svg, exportOptions);
          break;
        case "pdf":
          blob = await exportPDF(svg, exportOptions);
          break;
        case "pptx":
          blob = await exportPPTX(
            svg,
            getVisual?.() ?? undefined,
            exportOptions,
          );
          break;
      }

      if (!mountedRef.current || exportOperationIdRef.current !== operationId) {
        return;
      }

      if (!blob) {
        emitProductTelemetry("product.export.failed", {
          durationBucket: bucketDurationMs(performance.now() - startedAt),
          exportKind: "visual",
          failureReason: "empty_blob",
          outputFormat: format,
        });
        setError(`${formatLabel(format)} export failed`);
        return;
      }

      const scaleLabel =
        format === "png" && exportOptions.scale !== 1
          ? `@${exportOptions.scale}x`
          : "";
      downloadBlob(blob, `${filename}${scaleLabel}.${ext}`);
      emitProductTelemetry("product.export.succeeded", {
        durationBucket: bucketDurationMs(performance.now() - startedAt),
        exportKind: "visual",
        fileSizeBucket: bucketBytes(blob.size),
        outputFormat: format,
      });
      onClose();
    } catch {
      if (!mountedRef.current || exportOperationIdRef.current !== operationId) {
        return;
      }
      emitProductTelemetry("product.export.failed", {
        durationBucket: bucketDurationMs(performance.now() - startedAt),
        exportKind: "visual",
        failureReason: "exception",
        outputFormat: format,
      });
      setError(`${formatLabel(format)} export failed`);
    } finally {
      if (mountedRef.current && exportOperationIdRef.current === operationId) {
        exportInFlightRef.current = false;
        setExporting(false);
      }
    }
  }, [
    format,
    exportOptions,
    getSvgElement,
    getVisual,
    filename,
    onClose,
    canSvg,
    canPptx,
  ]);

  // PPTX native exports are editable Office shapes; raster-only controls do not apply.
  const isRaster = format === "png" || format === "pdf";
  const supportsCanvasOptions = format !== "pptx";

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <VisualExportDialogShell
            title="Export visual"
            onClose={requestClose}
            busy={exporting}
          >
            {/* Body */}
            <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto overscroll-contain sm:flex-row sm:overflow-hidden">
              {/* Preview panel */}
              <div className="flex min-h-[180px] flex-1 items-center justify-center bg-ds-surface-sunken p-4 sm:min-h-[280px]">
                <ExportPreviewThumbnail
                  dataUrl={previewUrl}
                  background={options.background}
                  customBackground={options.customBackground}
                />
              </div>

              {/* Controls panel */}
              <div className="flex w-full flex-col gap-4 border-t border-ds-border-subtle p-5 sm:w-[260px] sm:border-l sm:border-t-0">
                {supportsCanvasOptions && (
                  <ControlField label="Social preset">
                    <div className="grid grid-cols-2 gap-1.5">
                      {OUTPUT_PROFILE_CATALOG.map((preset) => {
                        const isActive = options.socialPreset === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            aria-pressed={isActive}
                            onClick={() => selectSocialPreset(preset.id)}
                            className={cx(
                              "flex flex-col items-start rounded-ds-sm border px-2.5 py-2 text-left transition-colors",
                              FOCUS_RING,
                              isActive
                                ? "border-ds-accent bg-ds-state-selected text-ds-accent"
                                : "border-ds-border-subtle bg-ds-surface-raised text-ds-text-primary hover:border-ds-border-strong",
                            )}
                          >
                            <span className="text-[11px] font-semibold leading-tight">
                              {preset.label}
                            </span>
                            <span className="mt-0.5 text-[10px] leading-tight opacity-60">
                              {preset.canonicalWidth}×{preset.canonicalHeight}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {options.socialPreset && (
                      <p className="mt-1 text-xs text-ds-text-muted">
                        Click again to clear preset.
                      </p>
                    )}
                  </ControlField>
                )}

                {/* Format */}
                <ControlField label="Format">
                  <SegmentedControl
                    options={FORMAT_OPTIONS}
                    value={format}
                    onChange={(v) => {
                      const f = v as ExportFormat;
                      if (f === "svg" && !canSvg) return;
                      if (f === "pptx" && !canPptx) return;
                      setFormat(f);
                    }}
                    aria-label="Export format"
                    size="sm"
                  />
                  {format === "svg" && !canSvg && (
                    <p className="mt-1 text-xs text-ds-danger">
                      SVG export requires Plus or Pro.{" "}
                      <a href="/app/settings/billing" className="underline">
                        Upgrade
                      </a>
                    </p>
                  )}
                  {format === "pptx" && !canPptx && (
                    <p className="mt-1 text-xs text-ds-danger">
                      PPTX export requires Plus or Pro.{" "}
                      <a href="/app/settings/billing" className="underline">
                        Upgrade
                      </a>
                    </p>
                  )}
                  {!canRemoveWatermark && (
                    <p className="mt-1 text-xs text-ds-text-muted">
                      Free plan: exports include a watermark.{" "}
                      <a href="/app/settings/billing" className="underline">
                        Upgrade
                      </a>{" "}
                      to remove.
                    </p>
                  )}
                </ControlField>

                {/* Background (raster/SVG) */}
                {supportsCanvasOptions && (
                  <ControlField label="Background">
                    <SegmentedControl
                      options={BG_OPTIONS}
                      value={options.background}
                      onChange={setBackground}
                      aria-label="Background mode"
                      size="sm"
                    />
                    {options.background === "custom" && (
                      <div className="mt-2 flex items-center gap-2">
                        <ColorPicker
                          color={options.customBackground ?? "#ffffff"}
                          onChange={setCustomBackground}
                          aria-label="Custom background color"
                          layer="menu"
                        />
                        <span className="font-mono text-xs text-ds-text-muted">
                          {options.customBackground ?? "#ffffff"}
                        </span>
                      </div>
                    )}
                  </ControlField>
                )}

                {/* Color mode (raster) */}
                {isRaster && (
                  <ControlField label="Color mode">
                    <SegmentedControl
                      options={COLOR_OPTIONS}
                      value={options.colorMode}
                      onChange={setColorMode}
                      aria-label="Color mode"
                      size="sm"
                    />
                  </ControlField>
                )}

                {/* Resolution (raster) */}
                {isRaster && (
                  <ControlField label="Resolution">
                    <SegmentedControl
                      options={SCALE_OPTIONS}
                      value={String(options.scale)}
                      onChange={setScale}
                      aria-label="Export resolution"
                      size="sm"
                    />
                    <p className="mt-1 text-xs text-ds-text-muted">
                      <ExportDimensions
                        getSvgElement={getSvgElement}
                        options={options}
                      />
                    </p>
                  </ControlField>
                )}

                {/* Branding toggle (paid plans only) */}
                {canRemoveWatermark && (
                  <ControlField label="Branding">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={exportOptions.watermark ?? false}
                        onChange={toggleBranding}
                        aria-label="Include TextIQ branding"
                        className={cx(
                          "h-4 w-4 cursor-pointer rounded border border-ds-border-strong",
                          FOCUS_RING,
                        )}
                      />
                      <span className="text-xs text-ds-text-secondary">
                        Include TextIQ branding
                      </span>
                    </label>
                  </ControlField>
                )}

                {/* Format hint */}
                <p className="text-xs text-ds-text-muted">
                  {formatLabel(format)} — {formatDescription(format)}
                  {format === "pptx"
                    ? ". Native PPTX exports are editable shapes; social, background, color, and resolution controls apply only to raster formats."
                    : ""}
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-ds-border-subtle px-5 py-3">
              {error ? (
                <div className="flex items-center gap-2">
                  <p role="alert" className="text-xs text-ds-danger">
                    {error}
                  </p>
                  <button
                    type="button"
                    aria-label="Dismiss export error"
                    onClick={() => setError(null)}
                    className={cx(
                      "rounded-ds-sm px-1.5 py-0.5 text-xs font-semibold text-ds-danger hover:bg-ds-danger-surface",
                      FOCUS_RING,
                    )}
                  >
                    Dismiss
                  </button>
                </div>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <Button
                  variant="plain"
                  size="sm"
                  disabled={exporting}
                  onClick={requestClose}
                >
                  Cancel
                </Button>
                <Button
                  variant="solid"
                  size="sm"
                  disabled={exporting}
                  onClick={handleExport}
                  leadingIcon={
                    exporting ? (
                      <span
                        aria-hidden="true"
                        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                      />
                    ) : (
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    )
                  }
                >
                  {exporting ? "Exporting…" : `Download ${formatLabel(format)}`}
                </Button>
              </div>
            </div>
          </VisualExportDialogShell>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ControlField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return <FieldRow label={label}>{children}</FieldRow>;
}

function ExportDimensions({
  getSvgElement,
  options,
}: {
  getSvgElement: () => SVGSVGElement | null;
  options: ExportOptions;
}) {
  const svg = getSvgElement();
  if (!svg) return null;
  const vb = svg.viewBox.baseVal;
  if (vb.width === 0 || vb.height === 0) return null;
  // Import lazily to avoid bundling compute in the component tree — values are
  // already computed server-side; here we just need the dimensions for display.
  const { canvasW, canvasH } = (() => {
    const pad = options.padding ?? 0;
    const ar = options.aspectRatio;
    if (!ar || ar === "auto") {
      return { canvasW: vb.width, canvasH: vb.height };
    }
    const RATIO: Record<string, number> = {
      "16:9": 16 / 9,
      "1:1": 1,
      "4:5": 4 / 5,
      "9:16": 9 / 16,
    };
    const targetRatio = RATIO[ar];
    if (!targetRatio) return { canvasW: vb.width, canvasH: vb.height };
    const effectiveW = vb.width + 2 * pad;
    const effectiveH = vb.height + 2 * pad;
    const naturalRatio = effectiveW / effectiveH;
    let cW: number, cH: number;
    if (naturalRatio > targetRatio) {
      cW = effectiveW;
      cH = effectiveW / targetRatio;
    } else if (naturalRatio < targetRatio) {
      cH = effectiveH;
      cW = effectiveH * targetRatio;
    } else {
      cW = effectiveW;
      cH = effectiveH;
    }
    return { canvasW: cW, canvasH: cH };
  })();
  const w = Math.round(canvasW * options.scale);
  const h = Math.round(canvasH * options.scale);
  return (
    <>
      {w} × {h} px
    </>
  );
}
