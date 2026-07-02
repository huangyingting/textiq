"use client";

/**
 * Tabbed inspector for the slide editor.
 *
 * Task panels cover selected-element editing, slide styling, speaker notes,
 * source links, and layer/arrange controls.
 *
 * Speaker notes live in a dedicated inspector tab so slide-level editing stays
 * in the right supplemental panel.
 *
 * Purely presentational: every change is reported through callbacks; the
 * component never mutates the deck.
 */

import {
  Bold,
  Italic,
  Image as ImageIcon,
  Link,
  Link2Off,
  Minus,
  Move,
  Palette,
  Plus,
  Spline,
  Underline,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { FOCUS_RING } from "@/components/ui/tokens";
import { useCoalesceSession } from "@/lib/presentation/gesture-primitives";
import {
  PropRow,
  PanelSection,
  SelectField,
} from "@/components/presentation/slide-inspector/primitives";
import type { SlideInspectorProps } from "@/components/presentation/slide-inspector/types";
import { ColorPicker, Swatch } from "@/components/ui";
import type {
  ConnectorArrow,
  ConnectorElement,
  ConnectorEndpoint,
  Deck,
  ImageCrop,
  ImageElement,
  ImageFitMode,
  ImageMaskShape,
  Paragraph,
  SlideElement,
  TextElementStyle,
  TextFitMode,
  TextRun,
} from "@/lib/presentation/deck";
import type { ElementPatch } from "@/lib/presentation/deck-mutations";
import type { PresentationRole } from "@/lib/presentation/presentation-theme";
import { detachConnectorEndpoint } from "@/lib/presentation/connector-lifecycle";
import { isEmptyImageSrc } from "@/lib/visual/image-element";
import { useImageUpload } from "@/lib/presentation/use-image-upload";
import type { SlideAssetActionPort } from "@/lib/action-ports";
import { serializeRichText } from "@/lib/presentation/rich-text-html";
import {
  FONT_MAX,
  FONT_MIN,
  FONT_STEP,
  stepFontSize,
} from "@/lib/presentation/text-style";
import { SLIDE_FONT_OPTIONS } from "@/lib/presentation-shared/slide-fonts";
import { ChoiceGroup } from "@/components/ui";
import {
  connectorContent,
  connectorDesign,
  elementDesignOverrides,
  imageContent,
  imageDesign,
  presentationRoleToPresentationRole,
  textContent,
} from "@/components/presentation/slide-canvas/v6-model";

/**
 * Selectable slide fonts for text/bullets elements. Each `value` is a stable
 * slide `fontId` from the self-hosted registry; the empty value inherits the
 * theme/role font.
 */
const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: "Default", value: "" },
  ...SLIDE_FONT_OPTIONS.map((font) => ({
    label: font.label,
    value: font.id,
  })),
];

const FIELD_CLASS =
  "w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-[13px] text-ds-text-primary outline-none";

const LABEL_CLASS = "mb-1 block text-xs font-medium text-ds-text-secondary";

/**
 * Module-level counter so every `RichTextBox` focus session gets a globally
 * unique coalesce key. Incrementing once per session (not per keystroke) means
 * the entire typed run collapses to one undo step, and each new focus session
 * starts a fresh entry (issue #306).
 */

export function RichTextBox({
  label,
  html,
  placeholder,
  listMode = false,
  hideLabel = false,
  fill = false,
  onChange,
}: {
  label: string;
  html: string;
  placeholder?: string;
  listMode?: boolean;
  hideLabel?: boolean;
  fill?: boolean;
  onChange: (
    value: { text: string; runs: TextRun[] },
    coalesceKey?: string,
  ) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lastHtmlRef = useRef("");
  // Coalesce key for the active editing session — the whole run of keystrokes
  // collapses to one undo step (issue #306). Set on focus, cleared on blur.
  const { coalesceKeyRef, onSessionStart, onSessionEnd } =
    useCoalesceSession("rich-text-edit");

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (lastHtmlRef.current === html) return;
    if (document.activeElement === node) return;
    node.innerHTML = html;
    lastHtmlRef.current = html;
  }, [html]);

  const emitChange = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const serialized = serializeRichText(node);
    lastHtmlRef.current = node.innerHTML;
    onChange(serialized, coalesceKeyRef.current ?? undefined);
  }, [coalesceKeyRef, onChange]);

  const applyCommand = useCallback(
    (
      command: "bold" | "italic" | "underline" | "foreColor",
      value?: string,
    ) => {
      const node = ref.current;
      if (!node) return;
      node.focus();
      document.execCommand(command, false, value);
      emitChange();
    },
    [emitChange],
  );

  return (
    <div className={`flex flex-col gap-2 ${fill ? "min-h-0 flex-1" : ""}`}>
      {hideLabel ? null : <span className={LABEL_CLASS}>{label}</span>}
      <div className="flex items-center gap-1 rounded-ds-md bg-ds-surface p-1 ring-1 ring-ds-border-subtle">
        <button
          type="button"
          aria-label="Bold selected text"
          onClick={() => applyCommand("bold")}
          className={`flex h-7 w-7 items-center justify-center rounded-ds-sm text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary ${FOCUS_RING}`}
        >
          <Bold size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Italic selected text"
          onClick={() => applyCommand("italic")}
          className={`flex h-7 w-7 items-center justify-center rounded-ds-sm text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary ${FOCUS_RING}`}
        >
          <Italic size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Underline selected text"
          onClick={() => applyCommand("underline")}
          className={`flex h-7 w-7 items-center justify-center rounded-ds-sm text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary ${FOCUS_RING}`}
        >
          <Underline size={14} aria-hidden="true" />
        </button>
        <div className="ml-auto flex items-center">
          <ColorPicker
            color=""
            aria-label="Selected text color"
            size="md"
            layer="tooltip"
            icon={<Palette size={14} aria-hidden="true" />}
            preserveSelection
            onChange={(hex) => applyCommand("foreColor", hex)}
          />
        </div>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-label={label}
        aria-placeholder={placeholder}
        aria-multiline="true"
        data-placeholder={placeholder}
        contentEditable
        suppressContentEditableWarning
        onInput={emitChange}
        onFocus={onSessionStart}
        onBlur={() => {
          emitChange();
          onSessionEnd();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className={`min-h-32 w-full whitespace-pre-wrap rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2.5 py-2 text-sm leading-6 text-ds-text-primary outline-none transition-colors empty:before:pointer-events-none empty:before:text-ds-text-muted empty:before:content-[attr(data-placeholder)] focus:border-ds-accent ${
          fill ? "flex-1 overflow-auto" : ""
        } ${
          listMode ? "[&>div]:min-h-[1.5em] [&>div]:pl-1" : ""
        } ${FOCUS_RING}`}
      />
    </div>
  );
}

/**
 * Content editor for an {@link ImageElement}. Offers three ways to set a source,
 * all routed through `onUpdateElement` (the undoable + autosaving commit path):
 *
 *  - **Upload** — a file picker reads the chosen image to a base64 data URL via
 *    {@link FileReader}. Files are validated for type and size first so a stray
 *    non-image or an oversized file never bloats `deckJson` (#226), and the new
 *    image is rejected if it would push the deck past the total inlined-image
 *    budget so autosave stays cheap (#247).
 *  - **URL / data URL** — the existing text field still accepts a pasted source.
 *  - **Alt text** — accessible description, unchanged.
 *  - **Fit / mask / crop** — non-destructive presentation controls stored on the
 *    element so the canvas, present mode, and export paths can honor them.
 */
export function ImageContentControls({
  element,
  deck,
  onUpdateElement,
  documentId,
  slideAssetPort,
}: {
  element: ImageElement;
  deck: Deck;
  onUpdateElement: SlideInspectorProps["onUpdateElement"];
  documentId?: string;
  slideAssetPort?: SlideAssetActionPort;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const content = imageContent(element);

  const { handleFile } = useImageUpload({
    deck,
    currentSrc: content.src,
    onAccept: (src, assetId) => {
      setError(null);
      onUpdateElement(element.id, {
        content: {
          ...(element as unknown as { content?: Record<string, unknown> })
            .content,
          kind: "image",
          src,
          ...(assetId ? { assetId } : {}),
        },
      } as ElementPatch);
    },
    onError: (message) => setError(message),
    documentId,
    uploadFn: documentId ? slideAssetPort?.uploadSlideAsset : undefined,
  });

  const hasSource = !isEmptyImageSrc(content.src);

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        {hasSource ? (
          <span className="rounded-full bg-ds-accent-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ds-accent-text ring-1 ring-ds-accent-border">
            Image set
          </span>
        ) : (
          <span className="rounded-full bg-ds-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ds-text-muted ring-1 ring-ds-border-subtle">
            Empty
          </span>
        )}
      </div>

      <div className="relative aspect-video overflow-hidden rounded-ds-md border border-ds-border-subtle bg-ds-surface">
        {hasSource ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-contain bg-center bg-no-repeat"
            style={{ backgroundImage: `url(${content.src})` }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-ds-text-muted">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ds-accent-surface text-ds-accent-text ring-1 ring-ds-accent-border">
              <ImageIcon size={17} aria-hidden="true" />
            </span>
            <span className="text-xs font-medium">No image selected</span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className={`flex w-full items-center justify-center gap-2 rounded-ds-md border border-dashed border-ds-border-subtle bg-ds-surface px-2 py-2.5 text-[13px] font-semibold text-ds-text-secondary transition-colors hover:border-ds-border-strong hover:bg-ds-state-hover hover:text-ds-text-primary ${FOCUS_RING}`}
      >
        <Upload size={14} aria-hidden="true" />
        {hasSource ? "Replace image" : "Upload image"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          handleFile(event.target.files?.[0]);
          // Reset so re-selecting the same file fires onChange again.
          event.target.value = "";
        }}
      />
      {error ? (
        <p role="alert" className="text-xs text-ds-danger-text">
          {error}
        </p>
      ) : null}
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
          <Link size={12} aria-hidden="true" />
          Image URL
        </span>
        <input
          type="text"
          value={content.src ?? ""}
          onChange={(event) =>
            onUpdateElement(element.id, {
              content: {
                ...(element as unknown as { content?: Record<string, unknown> })
                  .content,
                kind: "image",
                src: event.target.value,
              },
            } as ElementPatch)
          }
          placeholder="https://… or data:image/…"
          className={`${FIELD_CLASS} bg-ds-surface py-2 placeholder:text-ds-text-muted ${FOCUS_RING}`}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
          Alt text
        </span>
        <input
          type="text"
          value={content.alt ?? ""}
          onChange={(event) =>
            onUpdateElement(element.id, {
              content: {
                ...(element as unknown as { content?: Record<string, unknown> })
                  .content,
                kind: "image",
                alt: event.target.value,
              },
            } as ElementPatch)
          }
          className={`${FIELD_CLASS} bg-ds-surface py-2 placeholder:text-ds-text-muted ${FOCUS_RING}`}
        />
      </label>
    </>
  );
}

export function ImageAdjustControls({
  element,
  showAdvanced,
  onUpdateElement,
}: {
  element: ImageElement;
  showAdvanced: boolean;
  onUpdateElement: SlideInspectorProps["onUpdateElement"];
}) {
  const content = imageContent(element);
  const design = imageDesign(element);

  return (
    <>
      <ImageFitModeControl
        fitMode={design.fitMode}
        onChange={(fitMode) =>
          onUpdateElement(element.id, {
            designOverrides: {
              ...elementDesignOverrides(element),
              fitMode,
            },
          } as ElementPatch)
        }
      />
      <ImageMaskControl
        maskShape={design.maskShape}
        onChange={(maskShape) =>
          onUpdateElement(element.id, {
            designOverrides: {
              ...elementDesignOverrides(element),
              maskShape,
            },
          } as ElementPatch)
        }
      />
      <ImageCropControl
        crop={content.crop}
        onChange={(crop) =>
          onUpdateElement(element.id, {
            content: {
              ...(element as unknown as { content?: Record<string, unknown> })
                .content,
              kind: "image",
              crop,
            },
          } as ElementPatch)
        }
      />
      {showAdvanced ? (
        <PropRow label="Radius">
          <input
            type="range"
            min={0}
            max={50}
            step={1}
            value={design.radius ?? 0}
            onChange={(event) => {
              const radius = Number(event.target.value);
              onUpdateElement(element.id, {
                designOverrides: {
                  ...elementDesignOverrides(element),
                  radius: radius <= 0 ? undefined : radius,
                },
              } as ElementPatch);
            }}
            className="min-w-0 flex-1 accent-ds-accent"
            aria-label="Image corner radius"
          />
        </PropRow>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Image controls
// ---------------------------------------------------------------------------

export const IMAGE_FIT_MODE_OPTIONS: {
  value: ImageFitMode;
  label: string;
  title: string;
}[] = [
  {
    value: "contain",
    label: "Contain",
    title: "Show the full image inside the box",
  },
  {
    value: "cover",
    label: "Cover",
    title: "Fill the box and crop overflow",
  },
  {
    value: "fill",
    label: "Stretch",
    title: "Stretch the image to fill the box",
  },
  {
    value: "none",
    label: "None",
    title: "Keep the image at its intrinsic size and clip overflow",
  },
];

export const IMAGE_MASK_OPTIONS: { value: ImageMaskShape; label: string }[] = [
  { value: "none", label: "None" },
  { value: "rect", label: "Rectangle" },
  { value: "circle", label: "Circle" },
  { value: "ellipse", label: "Ellipse" },
  { value: "rounded", label: "Rounded" },
  { value: "diamond", label: "Diamond" },
  { value: "triangle", label: "Triangle" },
];

export function ImageFitModeControl({
  fitMode,
  onChange,
}: {
  fitMode: ImageFitMode | undefined;
  onChange: (fitMode: ImageFitMode | undefined) => void;
}) {
  const active = fitMode ?? "contain";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={LABEL_CLASS + " mb-0"}>Fit</span>
      <ChoiceGroup
        aria-label="Image fit mode"
        value={active}
        options={IMAGE_FIT_MODE_OPTIONS}
        wrap
        onChange={(value) => onChange(value === "contain" ? undefined : value)}
      />
    </div>
  );
}

export function ImageMaskControl({
  maskShape,
  onChange,
}: {
  maskShape: ImageMaskShape | undefined;
  onChange: (maskShape: ImageMaskShape | undefined) => void;
}) {
  return (
    <PropRow label="Mask">
      <SelectField
        value={maskShape ?? "none"}
        ariaLabel="Image mask shape"
        onChange={(value) =>
          onChange(value === "none" ? undefined : (value as ImageMaskShape))
        }
        options={IMAGE_MASK_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
      />
    </PropRow>
  );
}

export function ImageCropControl({
  crop,
  onChange,
}: {
  crop: ImageCrop | undefined;
  onChange: (crop: ImageCrop | undefined) => void;
}) {
  const current: ImageCrop = crop ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };

  function commit(side: keyof ImageCrop, value: number) {
    const next = {
      ...current,
      [side]: Math.max(0, Math.min(100, value)) / 100,
    };
    onChange(
      Object.values(next).every((entry) => entry <= 0) ? undefined : next,
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-crop-dialog-label"
      className="flex flex-col gap-2"
    >
      <div className="flex items-center justify-between">
        <span id="image-crop-dialog-label" className={LABEL_CLASS + " mb-0"}>
          Crop
        </span>
        {/* Visible instruction pill — decorative; screen-reader text below */}
        <span
          aria-hidden="true"
          className="rounded-full border border-ds-border-subtle px-2 py-0.5 text-xs text-ds-text-secondary"
        >
          Enter % per side
        </span>
      </div>
      <span className="sr-only">
        Enter percentage values from 0 to 100 to crop each side of the image.
        Top, Right, Bottom, and Left fields trim that fraction of the image.
      </span>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Top %"
          value={current.top * 100}
          onCommit={(value) => commit("top", value)}
        />
        <NumberField
          label="Right %"
          value={current.right * 100}
          onCommit={(value) => commit("right", value)}
        />
        <NumberField
          label="Bottom %"
          value={current.bottom * 100}
          onCommit={(value) => commit("bottom", value)}
        />
        <NumberField
          label="Left %"
          value={current.left * 100}
          onCommit={(value) => commit("left", value)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fit mode picker (text / bullets elements)
// ---------------------------------------------------------------------------

export const FIT_MODE_OPTIONS: {
  value: TextFitMode;
  label: string;
  title: string;
}[] = [
  {
    value: "auto-height",
    label: "Auto",
    title: "Box grows to fit content (default)",
  },
  {
    value: "fixed-box",
    label: "Clip",
    title: "Box height is fixed; overflow is clipped",
  },
  {
    value: "shrink-to-fit",
    label: "Shrink",
    title: "Font shrinks until content fits the box",
  },
];

export function FitModeControl({
  fitMode,
  onChange,
}: {
  fitMode: TextFitMode | undefined;
  onChange: (mode: TextFitMode | undefined) => void;
}) {
  const active = fitMode ?? "auto-height";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={LABEL_CLASS + " mb-0"}>Text fit</span>
      <ChoiceGroup
        aria-label="Text fit mode"
        value={active}
        options={FIT_MODE_OPTIONS}
        onChange={(value) =>
          // Selecting the default "auto-height" clears the field
          onChange(value === "auto-height" ? undefined : value)
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vertical align control
// ---------------------------------------------------------------------------

type VerticalAlignValue = "top" | "middle" | "bottom";

export const VERTICAL_ALIGN_OPTIONS: {
  value: VerticalAlignValue;
  label: string;
  title: string;
}[] = [
  { value: "top", label: "Top", title: "Align text to top" },
  { value: "middle", label: "Mid", title: "Center text vertically (default)" },
  { value: "bottom", label: "Bot", title: "Align text to bottom" },
];

export function VerticalAlignControl({
  style,
  onChange,
}: {
  style: TextElementStyle;
  onChange: (style: TextElementStyle) => void;
}) {
  const active: VerticalAlignValue = style.verticalAlign ?? "middle";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={LABEL_CLASS + " mb-0"}>V-align</span>
      <ChoiceGroup
        aria-label="Vertical text alignment"
        value={active}
        options={VERTICAL_ALIGN_OPTIONS}
        onChange={(value) =>
          onChange({
            ...style,
            // "middle" is the default — clear the field to keep the model lean
            ...(value === "middle"
              ? { verticalAlign: undefined }
              : { verticalAlign: value }),
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line height control
// ---------------------------------------------------------------------------

export const LINE_HEIGHT_OPTIONS: { value: number; label: string }[] = [
  { value: 1.0, label: "1.0" },
  { value: 1.2, label: "1.2" },
  { value: 1.5, label: "1.5" },
  { value: 2.0, label: "2.0" },
];

export function LineHeightControl({
  style,
  onChange,
}: {
  style: TextElementStyle;
  onChange: (style: TextElementStyle) => void;
}) {
  const active = style.lineHeight ?? 1.2;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={LABEL_CLASS + " mb-0"}>Line height</span>
      <ChoiceGroup
        aria-label="Line height"
        value={active}
        options={LINE_HEIGHT_OPTIONS.map((option) => ({
          ...option,
          title: `Line height ${option.label}`,
        }))}
        onChange={(value) =>
          onChange({
            ...style,
            // 1.2 is the default — clear to keep model lean
            ...(Math.abs(value - 1.2) < 0.001
              ? { lineHeight: undefined }
              : { lineHeight: value }),
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paragraph spacing control (text elements)
// ---------------------------------------------------------------------------

export function ParagraphSpacingControl({
  style,
  onChange,
}: {
  style: TextElementStyle;
  onChange: (style: TextElementStyle) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className={LABEL_CLASS + " mb-0"}>Para spacing</span>
      <input
        type="number"
        min={0}
        max={20}
        step={0.5}
        value={style.paragraphSpacing ?? 0}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          const next = { ...style };
          if (!Number.isFinite(v) || v <= 0) {
            delete next.paragraphSpacing;
          } else {
            next.paragraphSpacing = v;
          }
          onChange(next);
        }}
        className={`w-16 rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1 text-right text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Bullets-specific: bulletGap and bulletIndent
// ---------------------------------------------------------------------------

export function BulletGapControl({
  element,
  onChange,
}: {
  element: Extract<SlideElement, { kind: "text" }>;
  onChange: (patch: ElementPatch) => void;
}) {
  const content = textContent(element);
  return (
    <label className="flex items-center justify-between gap-2">
      <span className={LABEL_CLASS + " mb-0"}>Bullet gap</span>
      <input
        type="number"
        min={0}
        max={20}
        step={0.5}
        value={content.bulletGap ?? 0}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          onChange({
            content: {
              ...content,
              kind: "text",
              bulletGap: !Number.isFinite(v) || v <= 0 ? undefined : v,
            },
          } as ElementPatch);
        }}
        className={`w-16 rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1 text-right text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
      />
    </label>
  );
}

export function BulletIndentControl({
  element,
  onChange,
}: {
  element: Extract<SlideElement, { kind: "text" }>;
  onChange: (patch: ElementPatch) => void;
}) {
  const content = textContent(element);
  return (
    <label className="flex items-center justify-between gap-2">
      <span className={LABEL_CLASS + " mb-0"}>Bullet indent</span>
      <input
        type="number"
        min={0}
        max={30}
        step={1}
        value={content.bulletIndent ?? 0}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          onChange({
            content: {
              ...content,
              kind: "text",
              bulletIndent: !Number.isFinite(v) || v <= 0 ? undefined : v,
            },
          } as ElementPatch);
        }}
        className={`w-16 rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1 text-right text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
      />
    </label>
  );
}

/**
 * List-type toggle: switches all items in the list between bullet and numbered.
 * Per-item list type is set via Tab/Shift+Tab in the inline editor.
 */
export function ListTypeControl({
  element,
  onChange,
}: {
  element: Extract<SlideElement, { kind: "text" }>;
  onChange: (patch: ElementPatch) => void;
}) {
  const content = textContent(element);
  const items = content.paragraphs;
  // Consider the list "numbered" if a majority of items are numbered.
  const numberedCount = items.filter(
    (it: Paragraph) => it.listType === "number",
  ).length;
  const isNumbered = items.length > 0 && numberedCount > items.length / 2;
  const activeType: "bullet" | "number" = isNumbered ? "number" : "bullet";

  function toggle() {
    const targetType = isNumbered ? "bullet" : "number";
    const newItems: Paragraph[] = items.map((it: Paragraph) => ({
      ...it,
      listType: targetType,
    }));
    onChange({
      content: {
        ...content,
        kind: "text",
        paragraphs: newItems,
      },
    } as ElementPatch);
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span className={LABEL_CLASS + " mb-0"}>List type</span>
      <ChoiceGroup
        aria-label="List type"
        value={activeType}
        options={[
          { value: "bullet", label: "• Bullet", title: "Bullet list" },
          { value: "number", label: "1. Number", title: "Numbered list" },
        ]}
        onChange={(value) => {
          if (value !== activeType) toggle();
        }}
      />
    </div>
  );
}

/** Hex color test used by the inheritance-aware color control. */
function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Semantic roles offered per element kind in the Text panel (#615). */
export const TEXT_ROLE_OPTIONS: Readonly<
  Record<
    "text" | "bullets" | "shape",
    ReadonlyArray<{ value: PresentationRole; label: string }>
  >
> = {
  text: [
    { value: "title", label: "Title" },
    { value: "sectionTitle", label: "Section title" },
    { value: "subtitle", label: "Subtitle" },
    { value: "body", label: "Body" },
    { value: "quote", label: "Quote" },
    { value: "caption", label: "Caption" },
  ],
  bullets: [
    { value: "bullet", label: "Bullet" },
    { value: "body", label: "Body" },
  ],
  shape: [
    { value: "label", label: "Label" },
    { value: "title", label: "Title" },
    { value: "sectionTitle", label: "Section title" },
    { value: "body", label: "Body" },
    { value: "caption", label: "Caption" },
  ],
};

/** The role an element inherits when it carries no explicit presentation role. */
export function defaultPresentationRole(
  element: SlideElement,
): PresentationRole {
  return presentationRoleToPresentationRole(
    (element as { role?: string }).role,
    element.kind === "text" ? "body" : "label",
  );
}

export function presentationRoleValue(role: PresentationRole): string {
  switch (role) {
    case "title":
      return "title";
    case "sectionTitle":
      return "sectionTitle";
    case "label":
      return "label";
    default:
      return role;
  }
}

/** Elements that carry a semantic text role + local style override (#615). */
type TextBearingElement = Extract<SlideElement, { kind: "text" | "shape" }>;

/** Role dropdown: switches the element's semantic typography role (#615). */
export function RoleSelectControl({
  element,
  onChange,
}: {
  element: TextBearingElement;
  onChange: (role: PresentationRole) => void;
}) {
  const kindKey = element.kind === "shape" ? "shape" : "text";
  const options = TEXT_ROLE_OPTIONS[kindKey];
  const current = defaultPresentationRole(element);
  return (
    <PropRow label="Role">
      <SelectField
        value={current}
        ariaLabel="Text role"
        onChange={(value) => onChange(value as PresentationRole)}
        options={options.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
      />
    </PropRow>
  );
}

/**
 * Header row marking a property as inherited or locally overridden, with a
 * per-property reset to the inherited theme value (#615).
 */
export function OverrideHeader({ label }: { label: string }) {
  return (
    <span className="mb-1 block">
      <span className="text-xs font-medium text-ds-text-secondary">
        {label}
      </span>
    </span>
  );
}

/**
 * Font-size stepper. The right Text panel owns precise typography size, so it
 * is intentionally absent from the on-canvas context toolbar (#651, #635).
 * Size is a percent of slide height, snapped to FONT_STEP and clamped to
 * [FONT_MIN, FONT_MAX].
 */
export function FontSizeControl({
  style,
  onChange,
}: {
  style: TextElementStyle;
  onChange: (style: TextElementStyle) => void;
}) {
  const size = style.fontSize;
  const setSize = (next: number) => onChange({ ...style, fontSize: next });
  const btnClass = `flex h-7 w-7 items-center justify-center rounded-ds-sm border border-ds-border-subtle text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`;
  return (
    <div className="block">
      <span className={LABEL_CLASS}>Size</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Decrease font size"
          disabled={size <= FONT_MIN}
          onClick={() => setSize(stepFontSize(size, -FONT_STEP))}
          className={btnClass}
        >
          <Minus size={14} aria-hidden="true" />
        </button>
        <input
          type="number"
          min={FONT_MIN}
          max={FONT_MAX}
          step={FONT_STEP}
          value={size}
          aria-label="Font size"
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) setSize(stepFontSize(next, 0));
          }}
          className={`w-16 text-center ${FIELD_CLASS} ${FOCUS_RING}`}
        />
        <button
          type="button"
          aria-label="Increase font size"
          disabled={size >= FONT_MAX}
          onClick={() => setSize(stepFontSize(size, FONT_STEP))}
          className={btnClass}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** Font control that surfaces inherited vs. local state with reset (#615). */
export function InheritedFontControl({
  style,
  inheritedLabel,
  onChange,
  showReset = true,
}: {
  style: TextElementStyle;
  inheritedLabel: string;
  onChange: (style: TextElementStyle) => void;
  showReset?: boolean;
}) {
  const overridden = style.fontId !== undefined;
  const reset = () => {
    const next = { ...style };
    delete next.fontId;
    onChange(next);
  };
  return (
    <div className="block">
      <OverrideHeader label="Font" />
      <div className="flex items-center gap-2">
        <SelectField
          value={style.fontId ?? ""}
          ariaLabel="Font family"
          onChange={(value) => {
            const next = { ...style };
            if (value) next.fontId = value;
            else delete next.fontId;
            onChange(next);
          }}
          options={[
            { value: "", label: `Theme default (${inheritedLabel})` },
            ...FONT_FAMILIES.filter((font) => font.value).map((font) => ({
              value: font.value,
              label: font.label,
            })),
          ]}
        />
        {showReset ? (
          <button
            type="button"
            onClick={reset}
            disabled={!overridden}
            className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ring-1 transition-colors disabled:cursor-not-allowed disabled:bg-ds-surface disabled:text-ds-text-muted disabled:opacity-45 disabled:ring-ds-border-subtle ${
              overridden
                ? "bg-ds-accent-surface text-ds-accent-text ring-ds-accent-border hover:bg-ds-accent hover:text-ds-text-on-accent"
                : ""
            } ${FOCUS_RING}`}
          >
            Reset
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Color control that surfaces inherited vs. local state with reset (#615). */
export function InheritedColorControl({
  style,
  inheritedColor,
  onChange,
}: {
  style: TextElementStyle;
  inheritedColor: string;
  onChange: (style: TextElementStyle) => void;
}) {
  const overridden = style.color !== undefined;
  const value = style.color ?? inheritedColor;
  const setColor = (hex: string) => onChange({ ...style, color: hex });
  const reset = () => {
    const next = { ...style };
    delete next.color;
    onChange(next);
  };
  return (
    <div className="block">
      <OverrideHeader label="Color" />
      <div className="flex items-center gap-2">
        <ColorPicker
          color={value}
          fallback="#000000"
          aria-label="Text color"
          layer="tooltip"
          onChange={(hex) => setColor(hex)}
        />
        <input
          key={value}
          type="text"
          spellCheck={false}
          defaultValue={value}
          aria-label="Text color hex"
          onBlur={(event) => {
            const next = event.target.value.trim();
            if (isHexColor(next) && next.toLowerCase() !== value.toLowerCase())
              setColor(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter")
              (event.target as HTMLInputElement).blur();
          }}
          className={`w-24 rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-1.5 py-1 font-mono text-[11px] text-ds-text-primary ${FOCUS_RING}`}
        />
        <button
          type="button"
          onClick={reset}
          disabled={!overridden}
          className={`ml-auto shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ring-1 transition-colors disabled:cursor-not-allowed disabled:bg-ds-surface disabled:text-ds-text-muted disabled:opacity-45 disabled:ring-ds-border-subtle ${
            overridden
              ? "bg-ds-accent-surface text-ds-accent-text ring-ds-accent-border hover:bg-ds-accent hover:text-ds-text-on-accent"
              : ""
          } ${FOCUS_RING}`}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

export const ARROW_OPTIONS: { value: ConnectorArrow; label: string }[] = [
  { value: "none", label: "None" },
  { value: "arrow", label: "Open arrow" },
  { value: "filled", label: "Filled arrow" },
];

/**
 * Inspector controls for a selected {@link ConnectorElement} (issue #325).
 *
 * Provides:
 *  - Arrowhead style at start/end (none / open arrow / filled arrow)
 *  - Dashed line toggle
 *  - Stroke color + width
 *  - Detach start / end endpoint (converts bound anchor to free point)
 */
export function ConnectorElementEditor({
  element,
  elements,
  onUpdateElement,
}: {
  element: ConnectorElement;
  elements: readonly SlideElement[];
  onUpdateElement: SlideInspectorProps["onUpdateElement"];
}) {
  const content = connectorContent(element);
  const design = connectorDesign(element);
  const startBound = "elementId" in content.start;
  const endBound = "elementId" in content.end;
  const arrowStart = design.arrowStart ?? "none";
  const arrowEnd = design.arrowEnd ?? "arrow";

  function detachStart() {
    if (!startBound) return;
    const freePoint = detachConnectorEndpoint(
      content.start as ConnectorEndpoint,
      elements,
    );
    onUpdateElement(element.id, {
      content: { ...content, kind: "connector", start: freePoint },
    } as ElementPatch);
  }

  function detachEnd() {
    if (!endBound) return;
    const freePoint = detachConnectorEndpoint(
      content.end as ConnectorEndpoint,
      elements,
    );
    onUpdateElement(element.id, {
      content: { ...content, kind: "connector", end: freePoint },
    } as ElementPatch);
  }

  return (
    <PanelSection title="Line" icon={<Spline size={12} aria-hidden="true" />}>
      {/* Arrowhead at start */}
      <PropRow label="Arrow start">
        <SelectField
          value={arrowStart}
          ariaLabel="Arrowhead style at start"
          onChange={(value) =>
            onUpdateElement(element.id, {
              designOverrides: {
                ...elementDesignOverrides(element),
                arrowStart: value as ConnectorArrow,
              },
            } as ElementPatch)
          }
          options={ARROW_OPTIONS.map((opt) => ({
            value: opt.value,
            label: opt.label,
          }))}
        />
      </PropRow>

      {/* Arrowhead at end */}
      <PropRow label="Arrow end">
        <SelectField
          value={arrowEnd}
          ariaLabel="Arrowhead style at end"
          onChange={(value) =>
            onUpdateElement(element.id, {
              designOverrides: {
                ...elementDesignOverrides(element),
                arrowEnd: value as ConnectorArrow,
              },
            } as ElementPatch)
          }
          options={ARROW_OPTIONS.map((opt) => ({
            value: opt.value,
            label: opt.label,
          }))}
        />
      </PropRow>

      {/* Routing */}
      <PropRow label="Routing">
        <SelectField
          value={content.routing ?? "straight"}
          ariaLabel="Connector routing"
          onChange={(value) =>
            onUpdateElement(element.id, {
              content: {
                ...content,
                kind: "connector",
                routing: value as "straight" | "elbow",
              },
            } as ElementPatch)
          }
          options={[
            { value: "straight", label: "Straight" },
            { value: "elbow", label: "Elbow" },
          ]}
        />
      </PropRow>

      {/* Dashed line toggle */}
      <PropRow label="Dashed line">
        <input
          type="checkbox"
          checked={design.dash ?? false}
          onChange={(event) =>
            onUpdateElement(element.id, {
              designOverrides: {
                ...elementDesignOverrides(element),
                dash: event.target.checked,
              },
            } as ElementPatch)
          }
          className="h-4 w-4 accent-ds-accent"
          aria-label="Toggle dashed line style"
        />
      </PropRow>

      {/* Stroke color */}
      <PropRow label="Stroke">
        <ColorPicker
          color={design.stroke?.color ?? "#a1a1aa"}
          fallback="#a1a1aa"
          aria-label="Stroke color"
          onChange={(hex) =>
            onUpdateElement(element.id, {
              designOverrides: {
                ...elementDesignOverrides(element),
                stroke: {
                  color: hex,
                  width: design.stroke?.width ?? 0.4,
                },
              },
            } as ElementPatch)
          }
        />
        <input
          type="range"
          min={0.1}
          max={3}
          step={0.1}
          value={design.stroke?.width ?? 0.4}
          onChange={(event) => {
            const width = Number(event.target.value);
            onUpdateElement(element.id, {
              designOverrides: {
                ...elementDesignOverrides(element),
                stroke: {
                  color: design.stroke?.color ?? "#a1a1aa",
                  width,
                },
              },
            } as ElementPatch);
          }}
          className="min-w-0 flex-1 accent-ds-accent"
          aria-label="Stroke width"
        />
      </PropRow>

      {/* Detach endpoint buttons — disabled when the endpoint is already free */}
      <PropRow label="Endpoints" align="center">
        <button
          type="button"
          disabled={!startBound}
          onClick={detachStart}
          aria-label="Detach start endpoint from shape"
          title={
            startBound
              ? "Detach start from its bound shape"
              : "Start endpoint is already free"
          }
          className={`flex flex-1 items-center justify-center gap-1 rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
        >
          <Link2Off size={12} aria-hidden="true" />
          Start
        </button>
        <button
          type="button"
          disabled={!endBound}
          onClick={detachEnd}
          aria-label="Detach end endpoint from shape"
          title={
            endBound
              ? "Detach end from its bound shape"
              : "End endpoint is already free"
          }
          className={`flex flex-1 items-center justify-center gap-1 rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
        >
          <Link2Off size={12} aria-hidden="true" />
          End
        </button>
      </PropRow>
    </PanelSection>
  );
}

/**
 * Numeric box field (percent units). Commits clamped values to the element box.
 */
export function NumberField({
  label,
  value,
  min = 0,
  max = 100,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-ds-text-muted">{label}</span>
      <input
        type="number"
        value={Math.round(value * 10) / 10}
        min={min}
        max={max}
        step={1}
        onChange={(event) => {
          const n = Number(event.target.value);
          if (Number.isFinite(n)) {
            onCommit(Math.max(min, Math.min(max, n)));
          }
        }}
        className={`w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1 text-sm text-ds-text-primary outline-none ${FOCUS_RING}`}
      />
    </label>
  );
}

/**
 * Shared position & size editor for any element (percent units). Height is only
 * offered for non-text kinds, since text height auto-fits the content.
 */
export function ElementArrangeControl({
  element,
  onUpdateElement,
}: {
  element: SlideElement;
  onUpdateElement: SlideInspectorProps["onUpdateElement"];
}) {
  const { x, y, w, h } = element.box;
  const showHeight = element.kind !== "text";
  const rotation = element.rotation ?? 0;
  const update = (patch: Partial<typeof element.box>) =>
    onUpdateElement(element.id, { box: { ...element.box, ...patch } });
  const numClass = `w-16 text-right ${FIELD_CLASS} ${FOCUS_RING}`;
  const round = (n: number) => Math.round(n * 10) / 10;
  const clamp = (n: number, min: number, max: number) =>
    Math.max(min, Math.min(max, n));
  return (
    <PanelSection
      title="Position &amp; size"
      icon={<Move size={12} aria-hidden="true" />}
    >
      <PropRow label="Position">
        <input
          type="number"
          value={round(x)}
          onChange={(event) => {
            const n = Number(event.target.value);
            if (Number.isFinite(n)) update({ x: clamp(n, 0, 100) });
          }}
          className={numClass}
          aria-label="X percent"
        />
        <input
          type="number"
          value={round(y)}
          onChange={(event) => {
            const n = Number(event.target.value);
            if (Number.isFinite(n)) update({ y: clamp(n, 0, 100) });
          }}
          className={numClass}
          aria-label="Y percent"
        />
      </PropRow>
      <PropRow label="Size">
        <input
          type="number"
          min={1}
          value={round(w)}
          onChange={(event) => {
            const n = Number(event.target.value);
            if (Number.isFinite(n)) update({ w: clamp(n, 1, 100) });
          }}
          className={numClass}
          aria-label="Width percent"
        />
        {showHeight ? (
          <input
            type="number"
            min={1}
            value={round(h)}
            onChange={(event) => {
              const n = Number(event.target.value);
              if (Number.isFinite(n)) update({ h: clamp(n, 1, 100) });
            }}
            className={numClass}
            aria-label="Height percent"
          />
        ) : null}
      </PropRow>
      <PropRow label="Rotation">
        <input
          type="number"
          min={-180}
          max={180}
          value={round(rotation)}
          onChange={(event) => {
            const n = Number(event.target.value);
            if (Number.isFinite(n)) {
              const v = clamp(n, -180, 180);
              onUpdateElement(element.id, {
                rotation: v === 0 ? undefined : v,
              });
            }
          }}
          className={numClass}
          aria-label="Rotation degrees"
        />
      </PropRow>
      <PropRow label="Center" align="center">
        <button
          type="button"
          onClick={() => update({ x: (100 - w) / 2 })}
          className={`flex-1 rounded-ds-md border border-ds-border-subtle px-2 py-1.5 text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary ${FOCUS_RING}`}
        >
          Horizontal
        </button>
        <button
          type="button"
          onClick={() => update({ y: (100 - h) / 2 })}
          className={`flex-1 rounded-ds-md border border-ds-border-subtle px-2 py-1.5 text-xs text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary ${FOCUS_RING}`}
        >
          Vertical
        </button>
      </PropRow>
    </PanelSection>
  );
}

/**
 * Font picker for text / bullets elements. Stores a stable slide `fontId` in
 * `style.fontId` (cleared to inherit the theme/role font when "Default").
 */
export function FontFamilyControl({
  style,
  onChange,
}: {
  style: TextElementStyle;
  onChange: (style: TextElementStyle) => void;
}) {
  return (
    <PropRow label="Font">
      <SelectField
        value={style.fontId ?? ""}
        ariaLabel="Font family"
        onChange={(value) => {
          const next = { ...style };
          if (value) next.fontId = value;
          else delete next.fontId;
          onChange(next);
        }}
        options={FONT_FAMILIES.map((font) => ({
          value: font.value,
          label: font.label,
        }))}
      />
    </PropRow>
  );
}

/**
 * Per-slide color override. Keeps the common palette inline and routes "more"
 * choices through the compact swatches-only color picker; no large custom color
 * editor is mounted inside the inspector.
 */
export function ColorOverride({
  label,
  value,
  fallback,
  presets,
  hint,
  onChange,
}: {
  label: string;
  value: string | undefined;
  fallback: string;
  presets: readonly string[];
  /** Compact inline origin tag (e.g. "Theme") shown to the right of the label. */
  hint?: string;
  onChange: (color: string | undefined) => void;
}) {
  const normalized = value?.toLowerCase();
  const currentColor = value ?? fallback;
  const inlinePresets = presets.slice(0, 6);

  return (
    <div className="flex flex-col gap-1.5 rounded-ds-md bg-ds-surface-raised/60 p-2 ring-1 ring-ds-border-subtle">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ds-text-primary">
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          {value === undefined && hint ? (
            <span className="rounded-full bg-ds-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ds-text-muted ring-1 ring-ds-border-subtle">
              {hint}
            </span>
          ) : null}
          {value !== undefined ? (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className={`rounded-full bg-ds-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ds-text-muted ring-1 ring-ds-border-subtle transition-colors hover:text-ds-text-primary ${FOCUS_RING}`}
            >
              Theme
            </button>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {inlinePresets.map((preset) => (
          <Swatch
            key={preset}
            color={preset}
            size="md"
            selected={normalized === preset.toLowerCase()}
            aria-label={`${label} ${preset}`}
            className="rounded-full transition-transform hover:scale-110"
            onClick={() => onChange(preset)}
          />
        ))}
        <ColorPicker
          color={currentColor}
          fallback={fallback}
          presets={presets}
          aria-label={`${label} more colors`}
          size="md"
          icon={<Plus size={13} aria-hidden="true" />}
          active={value !== undefined}
          allowCustom={false}
          onChange={(hex) => onChange(hex)}
        />
      </div>
    </div>
  );
}
