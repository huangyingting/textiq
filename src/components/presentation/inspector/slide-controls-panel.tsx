"use client";

/**
 * Slide controls panel for the presentation inspector.
 *
 * Exposes the five slide-level controls defined in the presentation spec:
 *   - tone       — "neutral" | "confident" | "warm" | "urgent" | "premium" | "technical"
 *   - density    — "airy" | "normal" | "dense"
 *   - emphasis   — "balanced" | "title" | "data" | "visual" | "quote" | "action"
 *   - decoration — "none" | "subtle" | "default" | "expressive"
 *   - chrome     — "default" | "minimal" | "none"
 *
 * Changes are reported via `onUpdateControls` and `onUpdateProps`; the
 * component never mutates the deck directly.
 */

import type { JSX } from "react";

import type {
  SlideControls,
  SlideProps,
  SlideTone,
  SlideDensity,
  SlideEmphasis,
} from "@/lib/presentation/schema";
import { FOCUS_RING } from "@/components/ui/tokens";

// ---------------------------------------------------------------------------
// Option lists
// ---------------------------------------------------------------------------

const TONE_OPTIONS: SlideTone[] = [
  "neutral",
  "confident",
  "warm",
  "urgent",
  "premium",
  "technical",
];

const DENSITY_OPTIONS: SlideDensity[] = ["airy", "normal", "dense"];

const EMPHASIS_OPTIONS: SlideEmphasis[] = [
  "balanced",
  "title",
  "data",
  "visual",
  "quote",
  "action",
];

const DECORATION_OPTIONS: NonNullable<SlideProps["decoration"]>[] = [
  "none",
  "subtle",
  "default",
  "expressive",
];

const CHROME_OPTIONS: NonNullable<SlideProps["chrome"]>[] = [
  "default",
  "minimal",
  "none",
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SlideControlsPanelProps {
  controls?: SlideControls;
  props?: SlideProps;
  onUpdateControls: (patch: Partial<SlideControls>) => void;
  onUpdateProps: (patch: Partial<SlideProps>) => void;
  /**
   * Supported tone/density/emphasis values for the current template.
   * When provided, unsupported options are disabled.
   */
  supportedControls?: {
    tone?: SlideTone[];
    density?: SlideDensity[];
    emphasis?: SlideEmphasis[];
  };
}

// ---------------------------------------------------------------------------
// Generic select row
// ---------------------------------------------------------------------------

function ControlSelect<T extends string>({
  id,
  label,
  value,
  options,
  disabledOptions,
  onChange,
}: {
  id: string;
  label: string;
  value: T | undefined;
  options: T[];
  disabledOptions?: T[];
  onChange: (v: T) => void;
}): JSX.Element {
  const disabledSet = new Set(disabledOptions ?? []);
  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className="shrink-0 text-xs text-ds-text-secondary">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.currentTarget.value as T)}
        className={`w-36 rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1 text-[12px] text-ds-text-primary outline-none ${FOCUS_RING}`}
      >
        <option value="" disabled>
          —
        </option>
        {options.map((opt) => (
          <option key={opt} value={opt} disabled={disabledSet.has(opt)}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SlideControlsPanel({
  controls,
  props,
  onUpdateControls,
  onUpdateProps,
  supportedControls,
}: SlideControlsPanelProps): JSX.Element {
  // Compute disabled options for tone/density/emphasis
  const disabledTones =
    supportedControls?.tone !== undefined
      ? TONE_OPTIONS.filter((t) => !supportedControls.tone!.includes(t))
      : undefined;
  const disabledDensities =
    supportedControls?.density !== undefined
      ? DENSITY_OPTIONS.filter((d) => !supportedControls.density!.includes(d))
      : undefined;
  const disabledEmphases =
    supportedControls?.emphasis !== undefined
      ? EMPHASIS_OPTIONS.filter((e) => !supportedControls.emphasis!.includes(e))
      : undefined;

  return (
    <section className="flex flex-col gap-2 px-3 py-2.5">
      <h4 className="text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
        Slide Controls
      </h4>

      <ControlSelect
        id="presentation-tone"
        label="Tone"
        value={controls?.tone}
        options={TONE_OPTIONS}
        disabledOptions={disabledTones}
        onChange={(v) => onUpdateControls({ tone: v })}
      />

      <ControlSelect
        id="presentation-density"
        label="Density"
        value={controls?.density}
        options={DENSITY_OPTIONS}
        disabledOptions={disabledDensities}
        onChange={(v) => onUpdateControls({ density: v })}
      />

      <ControlSelect
        id="presentation-emphasis"
        label="Emphasis"
        value={controls?.emphasis}
        options={EMPHASIS_OPTIONS}
        disabledOptions={disabledEmphases}
        onChange={(v) => onUpdateControls({ emphasis: v })}
      />

      <div className="my-1 h-px bg-ds-border-subtle" aria-hidden="true" />

      <ControlSelect
        id="presentation-decoration"
        label="Decoration"
        value={props?.decoration}
        options={DECORATION_OPTIONS}
        onChange={(v) => onUpdateProps({ decoration: v })}
      />

      <ControlSelect
        id="presentation-chrome"
        label="Chrome"
        value={props?.chrome}
        options={CHROME_OPTIONS}
        onChange={(v) => onUpdateProps({ chrome: v })}
      />
    </section>
  );
}
