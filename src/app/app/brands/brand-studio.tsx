"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronUp,
  Edit2,
  Loader2,
  Palette,
  Plus,
  Trash2,
  Upload,
  X,
  Check,
} from "lucide-react";

import {
  Button,
  Dialog,
  IconButton,
  ColorPicker,
  cx,
  FOCUS_RING,
} from "@/components/ui";
import {
  BRAND_WEB_FONTS,
  type BrandStyle,
  type BrandInput,
} from "@/lib/brand/schema";
import type { BrandStudioViewModel } from "@/lib/brand-studio/view-model";
import { brandPreviewStyle } from "@/lib/brand/transforms";
import { hydrateBrandFont, useHydrateBrandFont } from "@/lib/brand/font-hooks";
import {
  validateLogoUpload,
  validateFontUpload,
  formatUploadError,
} from "@/lib/brand/upload";
import { DEFAULT_STYLE } from "@/lib/visual/schema";
import { buildSampleBrandedVisual } from "@/lib/brand/sample-visual";
import { VisualRenderer } from "@/components/visual/visual-renderer";
import { createBrand, updateBrand, deleteBrand } from "./actions";
import {
  routeBrandUploadPort,
  type BrandUploadPort,
} from "./brand-studio-ports";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_PALETTE = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
];

type BrandFormState = BrandInput & {
  id?: string;
  logoAssetUrl: string | null;
  fontAssetUrl: string | null;
};

function emptyInput(): BrandFormState {
  return {
    name: "",
    palette: [...DEFAULT_PALETTE],
    background: "#ffffff",
    nodeFill: "#eef2ff",
    nodeStroke: "#4f46e5",
    nodeText: "#312e81",
    edgeColor: "#a5b4fc",
    fontFamily: null,
    fontAssetId: null,
    logoAssetId: null,
    fontAssetUrl: null,
    logoAssetUrl: null,
  };
}

/**
 * Quantizes a logo image's pixel data down to up to 6 dominant hex colors,
 * sorted by frequency. Extracted from `handleLogoUpload`'s `img.onload`
 * (issue #1956) so the bucket-counting/sorting algorithm is directly
 * unit-testable without a canvas/Image — the orchestration that produces
 * `data` (drawing the uploaded logo onto an offscreen canvas and reading
 * `ImageData`) still requires a real `document`/`Image`/`CanvasRenderingContext2D`
 * and remains inline in `handleLogoUpload`.
 *
 * Samples every 8th pixel (`4 * 8` = 32 bytes) for speed, skips
 * near-transparent (`alpha < 128`), near-black, and near-white pixels so the
 * palette favors the logo's actual brand colors, and quantizes each channel
 * to 16 levels (`(c >> 4) << 4`) to merge near-duplicate shades into the same
 * bucket.
 */
export function extractPaletteFromImageData(data: Uint8ClampedArray): string[] {
  const buckets = new Map<string, number>();
  for (let i = 0; i < data.length; i += 4 * 8) {
    const a = data[i + 3];
    if (a < 128) continue;
    const qr = (data[i] >> 4) << 4;
    const qg = (data[i + 1] >> 4) << 4;
    const qb = (data[i + 2] >> 4) << 4;
    if (qr < 20 && qg < 20 && qb < 20) continue; // skip near-black
    if (qr > 235 && qg > 235 && qb > 235) continue; // skip near-white
    const hex = `#${qr.toString(16).padStart(2, "0")}${qg.toString(16).padStart(2, "0")}${qb.toString(16).padStart(2, "0")}`;
    buckets.set(hex, (buckets.get(hex) ?? 0) + 1);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([hex]) => hex);
}

// ---------------------------------------------------------------------------
// Brand preview mini-visual card
// ---------------------------------------------------------------------------
function BrandPreviewCard({ brand }: { brand: BrandStyle }) {
  const preview = brandPreviewStyle(brand);
  const palette = preview.palette.slice(0, 5);

  return (
    <div
      className="flex h-16 flex-col justify-between rounded-[var(--ds-radius-md,10px)] border p-2"
      style={{
        backgroundColor: preview.background,
        borderColor: preview.nodeStroke,
      }}
    >
      {/* Fake nodes */}
      <div className="flex gap-1">
        {palette.slice(0, 3).map((color, i) => (
          <span
            key={i}
            className="h-3 flex-1 rounded-sm"
            style={{
              backgroundColor: preview.nodeFill,
              borderColor: color,
              borderWidth: 1.5,
              borderStyle: "solid",
            }}
          />
        ))}
      </div>
      {/* Palette dots */}
      <div className="flex gap-1">
        {palette.map((color, i) => (
          <span
            key={i}
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brand editor form (create / edit)
// ---------------------------------------------------------------------------
function BrandForm({
  initial,
  onSave,
  onCancel,
  canFontUpload,
  uploadPort,
}: {
  initial: BrandFormState;
  onSave: (saved: BrandStyle) => void;
  onCancel: () => void;
  canFontUpload: boolean;
  uploadPort: BrandUploadPort;
}) {
  const [form, setForm] = useState<BrandFormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingFont, setUploadingFont] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);

  function setPaletteColor(index: number, color: string) {
    setForm((f) => {
      const palette = [...(f.palette ?? DEFAULT_PALETTE)];
      palette[index] = color;
      return { ...f, palette };
    });
  }

  function addPaletteColor() {
    setForm((f) => {
      const palette = [...(f.palette ?? DEFAULT_PALETTE)];
      if (palette.length >= 8) return f;
      palette.push("#6366f1");
      return { ...f, palette };
    });
  }

  function removePaletteColor(index: number) {
    setForm((f) => {
      const palette = [...(f.palette ?? DEFAULT_PALETTE)];
      if (palette.length <= 1) return f;
      palette.splice(index, 1);
      return { ...f, palette };
    });
  }

  async function handleLogoUpload(file: File) {
    const v = validateLogoUpload(file.type, file.name, file.size);
    if (!v.ok) {
      setError(formatUploadError(v.error));
      return;
    }
    setUploadingLogo(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      if (form.id) fd.append("brandId", form.id);
      const json = await uploadPort.uploadLogo(fd);
      const logoAssetUrl = json.url;
      setForm((f) => ({ ...f, logoAssetUrl, logoAssetId: json.assetId }));

      // Auto-extract palette from the image using canvas. The protected URL is
      // same-origin, so the canvas is not tainted and getImageData succeeds.
      const img = new Image();
      img.onload = () => {
        try {
          const SIZE = 64;
          const canvas = document.createElement("canvas");
          canvas.width = SIZE;
          canvas.height = SIZE;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(img, 0, 0, SIZE, SIZE);
          const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
          const top = extractPaletteFromImageData(data);
          if (top.length >= 2) {
            setForm((f) => ({ ...f, palette: top }));
          }
        } catch {
          // Best-effort; ignore extraction errors
        }
      };
      img.src = logoAssetUrl;
    } catch {
      setError("Logo upload failed. Please try again.");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleFontUpload(file: File) {
    const v = validateFontUpload(file.type, file.name, file.size);
    if (!v.ok) {
      setError(formatUploadError(v.error));
      return;
    }
    setUploadingFont(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("font", file);
      if (form.id) fd.append("brandId", form.id);
      const json = await uploadPort.uploadFont(fd);
      const family = json.familyName ?? file.name.replace(/\.[^.]+$/, "");
      const fontAssetUrl = json.url;
      hydrateBrandFont(
        `upload-${json.assetId}`,
        `'${family}', sans-serif`,
        fontAssetUrl,
      );
      // Persist the CSS family name plus the asset ref so the font survives
      // save → reload (rehydration done in BrandCard useEffect).
      setForm((f) => ({
        ...f,
        fontFamily: `'${family}', sans-serif`,
        fontAssetId: json.assetId,
        fontAssetUrl,
      }));
    } catch {
      setError("Font upload failed. Please try again.");
    } finally {
      setUploadingFont(false);
    }
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const payload: BrandInput = {
        name: form.name,
        palette: form.palette,
        background: form.background,
        nodeFill: form.nodeFill,
        nodeStroke: form.nodeStroke,
        nodeText: form.nodeText,
        edgeColor: form.edgeColor,
        fontFamily: form.fontFamily,
        logoAssetId: form.logoAssetId ?? null,
        fontAssetId: form.fontAssetId ?? null,
      };
      const result = form.id
        ? await updateBrand(form.id, payload)
        : await createBrand(payload);

      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSave(result.data);
    });
  }

  const palette = form.palette ?? DEFAULT_PALETTE;

  return (
    <div className="flex flex-col gap-5">
      {/* Name */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="brand-name"
          className="text-xs font-semibold uppercase tracking-wide text-[var(--ds-text-muted,#6f7d83)]"
        >
          Brand name
        </label>
        <input
          id="brand-name"
          type="text"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Acme Brand"
          maxLength={80}
          className={cx(
            "h-9 w-full rounded-[var(--ds-radius-md,10px)] border bg-[var(--ds-surface-base,#fff)] px-3 text-sm text-[var(--ds-text-primary,#18181b)] placeholder:text-[var(--ds-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-focus-ring,#6366f1)]",
            "border-[var(--ds-border-subtle,rgba(0,0,0,0.08))]",
          )}
        />
      </div>

      {/* Color palette */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ds-text-muted,#6f7d83)]">
          Palette
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {palette.map((color, i) => (
            <div key={i} className="relative flex flex-col items-center">
              <ColorPicker
                color={color}
                onChange={(c) => setPaletteColor(i, c)}
                aria-label={`Palette color ${i + 1}`}
              />
              {palette.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove palette color ${i + 1}`}
                  onClick={() => removePaletteColor(i)}
                  className="tiq-touch-target absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--ds-surface-raised)] text-[var(--ds-text-muted)] hover:bg-[var(--ds-danger,#dc2626)] hover:text-[var(--ds-text-on-accent,#ffffff)]"
                >
                  <X className="h-2 w-2" />
                </button>
              )}
            </div>
          ))}
          {palette.length < 8 && (
            <button
              type="button"
              aria-label="Add palette color"
              onClick={addPaletteColor}
              className={cx(
                "flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-[var(--ds-border-subtle)] text-[var(--ds-text-muted)] hover:border-[var(--ds-accent)] hover:text-[var(--ds-accent)]",
                FOCUS_RING,
              )}
            >
              <Plus className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Base colors grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {(
          [
            ["background", "Background"],
            ["nodeFill", "Node fill"],
            ["nodeStroke", "Node stroke"],
            ["nodeText", "Node text"],
            ["edgeColor", "Edge color"],
          ] as const
        ).map(([field, label]) => (
          <div key={field} className="flex items-center justify-between gap-2">
            <span className="text-xs text-[var(--ds-text-secondary,#52525b)]">
              {label}
            </span>
            <ColorPicker
              color={form[field] ?? DEFAULT_STYLE[field]}
              onChange={(c) => setForm((f) => ({ ...f, [field]: c }))}
              aria-label={label}
            />
          </div>
        ))}
      </div>

      {/* Font */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ds-text-muted,#6f7d83)]">
          Font
        </span>
        <select
          value={form.fontFamily ?? ""}
          onChange={(e) =>
            setForm((f) => ({ ...f, fontFamily: e.target.value || null }))
          }
          className={cx(
            "h-9 rounded-[var(--ds-radius-md,10px)] border bg-[var(--ds-surface-base,#fff)] px-3 text-sm text-[var(--ds-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-focus-ring,#6366f1)]",
            "border-[var(--ds-border-subtle,rgba(0,0,0,0.08))]",
          )}
        >
          <option value="">System default</option>
          {BRAND_WEB_FONTS.map((f) => (
            <option key={f.id} value={f.cssFamily}>
              {f.name}
            </option>
          ))}
          {form.fontFamily &&
            !BRAND_WEB_FONTS.some((f) => f.cssFamily === form.fontFamily) && (
              <option value={form.fontFamily}>Custom: {form.fontFamily}</option>
            )}
        </select>

        {/* Custom font upload — Pro-only (fontUpload entitlement) */}
        {canFontUpload && (
          <div className="flex items-center gap-2">
            <input
              ref={fontInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFontUpload(file);
                e.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="subtle"
              leadingIcon={
                uploadingFont ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )
              }
              onClick={() => fontInputRef.current?.click()}
              disabled={uploadingFont}
            >
              Upload font (TTF/OTF/WOFF)
            </Button>
            {form.fontFamily &&
              !BRAND_WEB_FONTS.some((f) => f.cssFamily === form.fontFamily) && (
                <span className="truncate text-xs text-[var(--ds-text-muted)]">
                  {form.fontFamily}
                </span>
              )}
          </div>
        )}
        {uploadingFont ? (
          <p role="status" className="text-xs text-[var(--ds-text-muted)]">
            Uploading and validating font…
          </p>
        ) : null}
      </div>

      {/* Logo */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ds-text-muted,#6f7d83)]">
          Logo <span className="normal-case font-normal">(optional)</span>
        </span>
        <div className="flex items-center gap-3">
          {form.logoAssetUrl && (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={form.logoAssetUrl}
                alt="Brand logo preview"
                className="h-12 w-12 rounded-[var(--ds-radius-sm)] border border-[var(--ds-border-subtle)] object-contain bg-white"
              />
              <button
                type="button"
                aria-label="Remove logo"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    logoAssetUrl: null,
                    logoAssetId: null,
                  }))
                }
                className="tiq-touch-target absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--ds-surface-raised)] border border-[var(--ds-border-subtle)] text-[var(--ds-text-muted)] hover:bg-[var(--ds-danger,#dc2626)] hover:text-[var(--ds-text-on-accent,#ffffff)]"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleLogoUpload(file);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            variant="subtle"
            leadingIcon={
              uploadingLogo ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )
            }
            onClick={() => logoInputRef.current?.click()}
            disabled={uploadingLogo}
          >
            {form.logoAssetUrl ? "Replace logo" : "Upload logo (PNG/SVG/JPG)"}
          </Button>
        </div>
        {form.logoAssetUrl && (
          <p className="text-xs text-[var(--ds-text-muted)]">
            Palette extracted automatically from the logo.
          </p>
        )}
        {uploadingLogo ? (
          <p role="status" className="text-xs text-[var(--ds-text-muted)]">
            Uploading logo and extracting palette…
          </p>
        ) : null}
      </div>

      {/* Live sample preview — updates reactively as the form changes */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ds-text-muted,#6f7d83)]">
          Preview
        </span>
        <div
          className="overflow-hidden rounded-[var(--ds-radius-md,10px)] border border-[var(--ds-border-subtle)]"
          aria-label="Live brand preview on sample visual"
        >
          <VisualRenderer
            visual={buildSampleBrandedVisual({
              id: form.id ?? "__preview__",
              name: form.name || "Preview",
              ownerId: "",
              palette: form.palette ?? DEFAULT_PALETTE,
              background: form.background ?? null,
              nodeFill: form.nodeFill ?? null,
              nodeStroke: form.nodeStroke ?? null,
              nodeText: form.nodeText ?? null,
              edgeColor: form.edgeColor ?? null,
              fontFamily: form.fontFamily ?? null,
              fontAssetUrl: form.fontAssetUrl ?? null,
              logoAssetUrl: form.logoAssetUrl ?? null,
              createdAt: "",
              updatedAt: "",
            })}
            className="h-auto w-full"
            title="Brand preview on sample visual"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-[var(--ds-danger,#dc2626)]">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 border-t border-[var(--ds-border-subtle)] bg-[var(--ds-surface-base,#fff)] px-1 py-3 pb-[calc(var(--ds-space-3)+var(--tiq-safe-area-bottom))]">
        <Button variant="plain" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button
          variant="solid"
          onClick={handleSubmit}
          disabled={isPending || !form.name.trim()}
          leadingIcon={
            isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )
          }
        >
          {form.id ? "Save changes" : "Create brand"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single brand card
// ---------------------------------------------------------------------------
function BrandCard({
  brand,
  onUpdated,
  onDeleted,
  canFontUpload,
  uploadPort,
}: {
  brand: BrandStyle;
  onUpdated: (b: BrandStyle) => void;
  onDeleted: (id: string) => void;
  canFontUpload: boolean;
  uploadPort: BrandUploadPort;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, startDelete] = useTransition();

  useHydrateBrandFont(brand);

  const previewStyle = brandPreviewStyle(brand);

  function handleDelete() {
    startDelete(async () => {
      const result = await deleteBrand(brand.id);
      if (result.ok) onDeleted(brand.id);
    });
  }

  return (
    <article
      className="flex flex-col overflow-hidden rounded-[var(--ds-radius-lg,14px)] border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-base,#fff)] shadow-[var(--ds-shadow-raised)]"
      aria-label={`Brand: ${brand.name}`}
    >
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Logo or fallback swatch */}
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--ds-radius-sm)] border border-[var(--ds-border-subtle)]"
          style={{ backgroundColor: previewStyle.background }}
        >
          {brand.logoAssetUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoAssetUrl}
              alt=""
              aria-hidden="true"
              className="h-8 w-8 object-contain"
            />
          ) : (
            <Palette className="h-4 w-4 text-[var(--ds-text-muted)]" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-semibold text-[var(--ds-text-primary)]"
            style={{ fontFamily: previewStyle.fontFamily }}
          >
            {brand.name}
          </p>
          {/* Palette strip */}
          <div className="mt-1 flex gap-0.5">
            {previewStyle.palette.slice(0, 6).map((color, i) => (
              <span
                key={i}
                className="h-2 w-4 rounded-sm"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            size="sm"
            variant="plain"
            aria-label="Edit brand"
            onClick={() => setExpanded((v) => !v)}
          >
            <Edit2 className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            size="sm"
            variant="plain"
            aria-label="Delete brand"
            onClick={() => setConfirmingDelete(true)}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </IconButton>
          <IconButton
            size="sm"
            variant="plain"
            aria-label={expanded ? "Collapse" : "Expand"}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </IconButton>
        </div>
      </div>

      <Dialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        aria-labelledby={`delete-brand-${brand.id}`}
        aria-busy={deleting}
        className="max-w-sm"
      >
        <div className="p-6 text-sm text-ds-danger-text">
          <p id={`delete-brand-${brand.id}`} className="font-semibold">
            Delete “{brand.name}”?
          </p>
          <p className="mt-1 text-xs">This cannot be undone.</p>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              size="sm"
              variant="plain"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={handleDelete}
              disabled={deleting}
              leadingIcon={
                deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null
              }
            >
              Delete brand
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Preview swatch row */}
      {!expanded && !confirmingDelete && (
        <div
          className="mx-4 mb-3 rounded-[var(--ds-radius-sm)] border px-2 py-1.5"
          style={{
            backgroundColor: previewStyle.background,
            borderColor: previewStyle.nodeStroke,
          }}
        >
          <BrandPreviewCard brand={brand} />
        </div>
      )}

      {/* Edit form */}
      {expanded && (
        <div className="border-t border-[var(--ds-border-subtle)] px-4 py-4">
          <BrandForm
            initial={{
              id: brand.id,
              name: brand.name,
              palette: brand.palette,
              background: brand.background,
              nodeFill: brand.nodeFill,
              nodeStroke: brand.nodeStroke,
              nodeText: brand.nodeText,
              edgeColor: brand.edgeColor,
              fontFamily: brand.fontFamily,
              fontAssetId: brand.fontAssetId ?? null,
              logoAssetId: brand.logoAssetId ?? null,
              fontAssetUrl: brand.fontAssetUrl,
              logoAssetUrl: brand.logoAssetUrl,
            }}
            onSave={(saved) => {
              onUpdated(saved);
              setExpanded(false);
            }}
            onCancel={() => setExpanded(false)}
            canFontUpload={canFontUpload}
            uploadPort={uploadPort}
          />
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Create new brand inline panel
// ---------------------------------------------------------------------------
function CreateBrandPanel({
  onCreated,
  canFontUpload,
  uploadPort,
}: {
  onCreated: (b: BrandStyle) => void;
  canFontUpload: boolean;
  uploadPort: BrandUploadPort;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx(
          "flex w-full items-center justify-center gap-2 rounded-[var(--ds-radius-lg,14px)] border-2 border-dashed border-[var(--ds-border-subtle)] py-6 text-sm font-medium text-[var(--ds-text-muted)] transition hover:border-[var(--ds-accent)] hover:text-[var(--ds-accent)]",
          FOCUS_RING,
        )}
      >
        <Plus className="h-4 w-4" />
        New brand style
      </button>
    );
  }

  return (
    <div className="rounded-[var(--ds-radius-lg,14px)] border border-[var(--ds-accent,#6366f1)] bg-[var(--ds-surface-base,#fff)] p-4 shadow-[var(--ds-shadow-raised)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--ds-text-primary)]">
          New brand style
        </h2>
        <IconButton
          size="sm"
          variant="plain"
          aria-label="Close"
          onClick={() => setOpen(false)}
        >
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <BrandForm
        initial={emptyInput()}
        onSave={(saved) => {
          onCreated(saved);
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
        canFontUpload={canFontUpload}
        uploadPort={uploadPort}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root BrandStudio component
// ---------------------------------------------------------------------------
export function BrandStudio({
  initialBrands,
  canFontUpload,
  uploadPort = routeBrandUploadPort,
}: {
  initialBrands: BrandStudioViewModel["brands"];
  canFontUpload: BrandStudioViewModel["canUploadFont"];
  uploadPort?: BrandUploadPort;
}) {
  const [brands, setBrands] = useState<BrandStyle[]>(initialBrands);

  const handleCreated = useCallback((b: BrandStyle) => {
    setBrands((prev) => [...prev, b]);
  }, []);

  const handleUpdated = useCallback((b: BrandStyle) => {
    setBrands((prev) => prev.map((x) => (x.id === b.id ? b : x)));
  }, []);

  const handleDeleted = useCallback((id: string) => {
    setBrands((prev) => prev.filter((b) => b.id !== id));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {brands.length === 0 && (
        <p className="text-sm text-[var(--ds-text-muted)]">
          No brand styles yet. Create one below to get started.
        </p>
      )}

      {brands.map((brand) => (
        <BrandCard
          key={brand.id}
          brand={brand}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
          canFontUpload={canFontUpload}
          uploadPort={uploadPort}
        />
      ))}

      <CreateBrandPanel
        onCreated={handleCreated}
        canFontUpload={canFontUpload}
        uploadPort={uploadPort}
      />
    </div>
  );
}
