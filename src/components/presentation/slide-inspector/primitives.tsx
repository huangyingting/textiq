"use client";

import type { ReactNode } from "react";

import { ChoiceGroup } from "@/components/ui/choice-group";
import { FOCUS_RING } from "@/components/ui/tokens";
import { SelectMenu, type SelectMenuOption } from "@/components/ui/select-menu";
import type {
  BulletItem,
  TextElement,
  TextElementStyle,
  TextFitMode,
} from "@/lib/presentation/deck";
import { normalizeTextParagraphs } from "@/lib/presentation/deck";
import { useCoalesceSession } from "@/lib/presentation/gesture-primitives";
import { SLIDE_FONT_OPTIONS } from "@/lib/presentation-shared/slide-fonts";

const FIELD_CLASS =
  "w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-[13px] text-ds-text-primary outline-none";
const LABEL_CLASS = "mb-1 block text-xs font-medium text-ds-text-secondary";

/**
 * Task-panel scaffolding for the current inspector layout. A panel body is a
 * vertical stack of {@link PanelSection}s separated by hairline dividers
 * (`divide-y` on the parent), each with a small uppercase caption; properties
 * inside render as {@link PropRow}s with the label on the left and the control
 * flush right.
 */
export const PANEL_BODY_CLASS = "divide-y divide-ds-border-subtle";

export function PanelSection({
  title,
  icon,
  children,
  className,
}: {
  title?: string;
  /** Optional leading glyph (e.g. a lucide icon sized ~12px) for the caption. */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col gap-2 px-3 py-2.5 ${className ?? ""}`.trim()}
    >
      {title ? (
        <h4 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
          {icon ? (
            <span aria-hidden="true" className="flex text-ds-accent">
              {icon}
            </span>
          ) : null}
          {title}
        </h4>
      ) : null}
      {children}
    </section>
  );
}

export function PropRow({
  label,
  children,
  align = "center",
}: {
  label: ReactNode;
  children: ReactNode;
  /** Vertical alignment when the control is taller than one line. */
  align?: "center" | "start";
}) {
  return (
    <div
      className={`grid grid-cols-[72px_minmax(0,1fr)] gap-2 ${
        align === "start" ? "items-start" : "items-center"
      }`}
    >
      <span className="pt-px text-xs text-ds-text-secondary">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-1.5">
        {children}
      </div>
    </div>
  );
}

/** Full-width custom select styled as an inspector form field. */
export function SelectField({
  value,
  options,
  onChange,
  ariaLabel,
  align = "end",
}: {
  value: string;
  options: readonly SelectMenuOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  align?: "start" | "center" | "end";
}) {
  return (
    <SelectMenu
      variant="field"
      value={value}
      options={options}
      onChange={onChange}
      aria-label={ariaLabel}
      align={align}
    />
  );
}

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

export { FIELD_CLASS, LABEL_CLASS, FONT_FAMILIES };

export function SpeakerNotesControl({
  notes,
  onChange,
}: {
  notes: string;
  onChange: (value: string, coalesceKey?: string) => void;
}) {
  const { coalesceKeyRef, onSessionStart, onSessionEnd } =
    useCoalesceSession("notes-edit");

  return (
    <textarea
      value={notes}
      onChange={(event) =>
        onChange(event.target.value, coalesceKeyRef.current ?? undefined)
      }
      onFocus={onSessionStart}
      onBlur={onSessionEnd}
      rows={12}
      aria-label="Speaker notes"
      placeholder="Add speaker notes…"
      className={`${FIELD_CLASS} min-h-0 flex-1 resize-none leading-6 placeholder:text-ds-text-muted ${FOCUS_RING}`}
    />
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
  element: TextElement;
  onChange: (patch: Partial<TextElement>) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className={LABEL_CLASS + " mb-0"}>Bullet gap</span>
      <input
        type="number"
        min={0}
        max={20}
        step={0.5}
        value={element.content.bulletGap ?? 0}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isFinite(v) || v <= 0) {
            onChange({ content: { ...element.content, bulletGap: undefined } });
          } else {
            onChange({ content: { ...element.content, bulletGap: v } });
          }
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
  element: TextElement;
  onChange: (patch: Partial<TextElement>) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className={LABEL_CLASS + " mb-0"}>Bullet indent</span>
      <input
        type="number"
        min={0}
        max={30}
        step={1}
        value={element.content.bulletIndent ?? 0}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isFinite(v) || v <= 0) {
            onChange({
              content: { ...element.content, bulletIndent: undefined },
            });
          } else {
            onChange({ content: { ...element.content, bulletIndent: v } });
          }
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
  element: TextElement;
  onChange: (patch: Partial<TextElement>) => void;
}) {
  const items = normalizeTextParagraphs(element);
  // Consider the list "numbered" if a majority of items are numbered.
  const numberedCount = items.filter(
    (it: BulletItem) => it.listType === "number",
  ).length;
  const isNumbered = items.length > 0 && numberedCount > items.length / 2;
  const activeType: "bullet" | "number" = isNumbered ? "number" : "bullet";

  function toggle() {
    const targetType = isNumbered ? "bullet" : "number";
    const newItems: BulletItem[] = items.map((it: BulletItem) => ({
      ...it,
      listType: targetType,
    }));
    onChange({ content: { ...element.content, paragraphs: newItems } });
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
