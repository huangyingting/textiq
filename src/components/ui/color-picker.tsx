"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { getTabbableElements } from "@/lib/a11y/tabbable";

import { FloatingSurface } from "./floating-surface";
import { Swatch, type SwatchSize } from "./swatch";
import { Tooltip } from "./tooltip";
import {
  cx,
  FOCUS_RING,
  RADIUS,
  TOOLBAR_BUTTON_CHROME,
  type UILayer,
} from "./tokens";

/**
 * A neutral, broadly-useful default palette spanning the hue wheel plus a
 * grayscale ramp. Callers can override via {@link ColorPickerProps.presets}
 * (e.g. to surface the active visual's theme palette first).
 */
export const DEFAULT_SWATCH_PRESETS: readonly string[] = [
  "#ffffff",
  "#f1f5f9",
  "#cbd5e1",
  "#64748b",
  "#1e293b",
  "#000000",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#78716c",
];

// Gap (px) between the trigger/toolbar edge and the picker popover.
const PICKER_GAP = 8;
const EDGE_INSET = 8;
const PICKER_WIDTH = 216;
// Height (px) of the saturation/value square in the custom tab.
const SQUARE_HEIGHT = 124;
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

type HsvColor = { h: number; s: number; v: number };

/** Coerces an arbitrary CSS color to a `#rrggbb` value for the native input. */
function toHex(value: string | undefined, fallback: string): string {
  if (value && HEX_PATTERN.test(value)) {
    return value.toLowerCase();
  }
  return fallback;
}

function hexToHsv(hex: string): HsvColor {
  const normalized = toHex(hex, "#000000").slice(1);
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) {
      h = ((g - b) / d) % 6;
    } else if (max === g) {
      h = (b - r) / d + 2;
    } else {
      h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }
  const s = max === 0 ? 0 : d / max;
  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    v: Math.round(max * 100),
  };
}

function hsvToHex({ h, s, v }: HsvColor): string {
  const saturation = Math.max(0, Math.min(100, s)) / 100;
  const value = Math.max(0, Math.min(100, v)) / 100;
  const hue = (((h % 360) + 360) % 360) / 60;
  const c = value * saturation;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 1) {
    [r, g, b] = [c, x, 0];
  } else if (hue < 2) {
    [r, g, b] = [x, c, 0];
  } else if (hue < 3) {
    [r, g, b] = [0, c, x];
  } else if (hue < 4) {
    [r, g, b] = [0, x, c];
  } else if (hue < 5) {
    [r, g, b] = [x, 0, c];
  } else {
    [r, g, b] = [c, 0, x];
  }
  const m = value - c;
  const toChannel = (channel: number) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toChannel(r)}${toChannel(g)}${toChannel(b)}`;
}

export type ColorPickerProps = {
  /** Current color value (any CSS color; coerced to hex for the custom input). */
  color: string;
  onChange: (hex: string) => void;
  /** Accessible name for the trigger (e.g. "Background color"). */
  "aria-label": string;
  presets?: readonly string[];
  size?: SwatchSize;
  /** Fallback hex used when `color` isn't a `#rrggbb` value. */
  fallback?: string;
  /**
   * Optional icon rendered inside the trigger so adjacent color controls stay
   * distinguishable at a glance (e.g. a text-color "A" vs. a highlighter). When
   * set, the trigger shows the icon over a neutral tile with a thin underline
   * bar of the current color, instead of a fully color-filled swatch.
   */
  icon?: ReactNode;
  /** Whether the trigger reads as active/selected (a value is applied). */
  active?: boolean;
  /** Use shared toolbar button chrome for icon-only toolbar triggers. */
  triggerChrome?: "swatch" | "toolbar";
  /** Portal z-layer for the picker popover. Defaults from triggerChrome. */
  layer?: UILayer;
  /** Whether to expose the custom HSV/hex controls. Defaults to true. */
  allowCustom?: boolean;
  /** Show only the custom HSV/hex controls, without the swatch tab. */
  customOnly?: boolean;
  /**
   * When provided, the popover shows a "reset" action that clears the style.
   * Used for the "Default / None" affordance on text color & highlight.
   */
  onReset?: () => void;
  /** Label for the reset action. Defaults to "Default". */
  resetLabel?: string;
  /**
   * Keep the host editor's text selection intact while interacting with the
   * picker: skip the auto-focus-into-grid on open and `preventDefault` the
   * preset/reset pointer-downs so focus never leaves the editor (the toolbar and
   * its anchored selection stay alive). Used by the floating text toolbar.
   */
  preserveSelection?: boolean;
};

/**
 * A swatch-triggered color picker popover replacing the bare
 * `<input type=color>` rows. The trigger is a {@link Swatch} of the current
 * color; activating it opens a portal popover ({@link FloatingSurface}) with a
 * preset palette grid plus a custom color input + hex field. Token-driven,
 * keyboard-accessible (roving focus into the grid on open, Escape/click-away to
 * close via the surface), and reduced-motion-aware.
 *
 * The popover content carries `data-ds-floating` so an outer surface's
 * click-away logic can recognise it as a transient DS layer and not dismiss
 * itself when the user reaches into the picker.
 */
export function ColorPicker({
  color,
  onChange,
  "aria-label": ariaLabel,
  presets = DEFAULT_SWATCH_PRESETS,
  size = "md",
  fallback = "#000000",
  icon,
  active,
  triggerChrome = "swatch",
  layer,
  allowCustom = true,
  customOnly = false,
  onReset,
  resetLabel = "Default",
  preserveSelection = false,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const firstPresetRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({
    top: -1000,
    left: -1000,
  });
  const labelId = useId();
  const hex = toHex(color, fallback);
  const hasColor = color.trim() !== "";
  const [hexDraftState, setHexDraftState] = useState({
    source: hex,
    value: hex,
  });
  const hexDraft = hexDraftState.source === hex ? hexDraftState.value : hex;

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const startLeft = rect.left;
    const endLeft = rect.right - PICKER_WIDTH;
    const viewportRight = window.innerWidth - EDGE_INSET;
    let left =
      startLeft + PICKER_WIDTH > viewportRight && endLeft >= EDGE_INSET
        ? endLeft
        : startLeft;
    left = Math.max(
      EDGE_INSET,
      Math.min(left, window.innerWidth - PICKER_WIDTH - EDGE_INSET),
    );
    const top = rect.bottom + PICKER_GAP;
    setCoords((prev) =>
      prev.top === top && prev.left === left ? prev : { top, left },
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    let animationFrame = 0;
    const trackPosition = () => {
      reposition();
      animationFrame = window.requestAnimationFrame(trackPosition);
    };
    reposition();
    animationFrame = window.requestAnimationFrame(trackPosition);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [open, reposition]);

  // Move focus into the grid when the popover opens so it's keyboard-operable,
  // and restore focus to the trigger when it closes (focus management). Both are
  // skipped in `preserveSelection` mode, where focus deliberately stays in the
  // host editor so the anchored selection + toolbar survive.
  useEffect(() => {
    if (preserveSelection) {
      wasOpenRef.current = open;
      return;
    }
    if (open) {
      firstPresetRef.current?.focus();
    } else if (wasOpenRef.current) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open, preserveSelection]);

  // Trap Tab within the popover so keyboard focus can't escape behind it while
  // it's open (skipped in `preserveSelection` mode, which keeps editor focus).
  const onContentKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== "Tab" || preserveSelection) {
        return;
      }
      const container = contentRef.current;
      if (!container) return;
      const focusables = getTabbableElements(container);
      if (focusables.length === 0) {
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement;
      if (event.shiftKey && activeEl === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeEl === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [preserveSelection],
  );

  // In `preserveSelection` mode, swallow the pointer-down default so clicking a
  // preset never blurs the editor (the anchored selection + toolbar stay alive).
  const onPointerDownCapture = preserveSelection
    ? (event: MouseEvent) => event.preventDefault()
    : undefined;

  const [tab, setTab] = useState<"swatches" | "custom">(
    customOnly ? "custom" : "swatches",
  );
  const effectiveTab = customOnly ? "custom" : tab;
  const rawHsv = hexToHsv(hex);
  const [lastHue, setLastHue] = useState(rawHsv.h);
  const hsv =
    rawHsv.s === 0 || rawHsv.v === 0 ? { ...rawHsv, h: lastHue } : rawHsv;

  const pick = useCallback(
    (next: string) => {
      const nextHsv = hexToHsv(next);
      if (nextHsv.s > 0 && nextHsv.v > 0) {
        setLastHue(nextHsv.h);
      }
      onChange(next);
    },
    [onChange],
  );

  const updateHsv = (patch: Partial<HsvColor>) => {
    const next = { ...hsv, ...patch };
    if (patch.h !== undefined) {
      next.h = ((patch.h % 360) + 360) % 360;
      setLastHue(next.h);
    }
    pick(hsvToHex(next));
  };

  // Saturation/value square (Design 2): x is saturation, y is value (top is
  // brightest). A separate hue bar below rotates the hue. Pure HSV so the
  // gradient overlays stay perceptually accurate.
  const squareRef = useRef<HTMLDivElement | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const startPointerDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    apply: (clientX: number, clientY: number) => void,
  ) => {
    if (preserveSelection) {
      event.preventDefault();
    }
    event.stopPropagation();
    apply(event.clientX, event.clientY);
    dragCleanupRef.current?.();
    const onMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      apply(moveEvent.clientX, moveEvent.clientY);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", cleanup, true);
      window.removeEventListener("pointercancel", cleanup, true);
      dragCleanupRef.current = null;
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", cleanup, true);
    window.addEventListener("pointercancel", cleanup, true);
    dragCleanupRef.current = cleanup;
  };

  const applySquareFromPoint = (clientX: number, clientY: number) => {
    const el = squareRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const ratioX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const ratioY = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    pick(
      hsvToHex({
        ...hsv,
        s: Math.round(ratioX * 100),
        v: Math.round((1 - ratioY) * 100),
      }),
    );
  };

  // Hue bar: a custom pointer-driven control (not a native range input) so it
  // keeps working when `preserveSelection` swallows the mousedown default to
  // protect the host editor's text selection.
  const hueBarRef = useRef<HTMLDivElement | null>(null);
  const applyHueFromPoint = (clientX: number) => {
    const el = hueBarRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    updateHsv({ h: Math.round(ratio * 360) });
  };

  const toolbarTrigger = icon ? (
    <Tooltip label={ariaLabel} side="bottom">
      <button
        ref={triggerRef}
        type="button"
        aria-pressed={active}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseDown={
          preserveSelection ? (event) => event.preventDefault() : undefined
        }
        onClick={() => setOpen((value) => !value)}
        className={cx(
          "inline-flex h-7 min-w-7 w-7 items-center justify-center text-xs transition-colors disabled:pointer-events-none disabled:opacity-50",
          RADIUS.sm,
          active === true
            ? TOOLBAR_BUTTON_CHROME.active
            : TOOLBAR_BUTTON_CHROME.subtle,
          FOCUS_RING,
        )}
      >
        <span className="relative flex h-full w-full items-center justify-center">
          {icon}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-[2px] left-1 right-1 h-[3px] rounded-full border border-ds-border-subtle"
            style={{ backgroundColor: hasColor ? hex : "transparent" }}
          />
        </span>
      </button>
    </Tooltip>
  ) : null;

  return (
    <>
      {icon && triggerChrome === "toolbar" ? (
        toolbarTrigger
      ) : (
        <Swatch
          ref={triggerRef}
          color={icon ? "transparent" : hex}
          size={size}
          selected={active && !icon}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {icon ? (
            <span className="relative flex h-full w-full items-center justify-center text-[var(--ds-text-secondary,#52525b)]">
              {icon}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-[2px] left-1 right-1 h-[3px] rounded-full border border-[var(--ds-border-subtle,rgba(0,0,0,0.12))]"
                style={{ backgroundColor: hasColor ? hex : "transparent" }}
              />
            </span>
          ) : null}
        </Swatch>
      )}
      <FloatingSurface
        open={open}
        onClose={() => setOpen(false)}
        position={coords}
        role="dialog"
        aria-label={`${ariaLabel} picker`}
        layer={layer ?? (triggerChrome === "toolbar" ? "tooltip" : "dropdown")}
        elevation="popover"
        radius="lg"
        clickAwayIgnoreRef={triggerRef}
        style={{ width: PICKER_WIDTH }}
      >
        <div
          ref={contentRef}
          data-ds-floating="color-picker"
          className="overflow-hidden"
          onKeyDown={onContentKeyDown}
        >
          <div className="p-2.5">
            <div className="mb-2 flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cx(
                  "relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden border border-ds-border-subtle shadow-inner",
                  RADIUS.md,
                )}
                style={{ backgroundColor: hex }}
              >
                {!hasColor ? (
                  <span className="block h-px w-8 -rotate-45 bg-ds-border-strong/70" />
                ) : null}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  id={labelId}
                  className="truncate text-xs font-normal text-ds-text-primary"
                >
                  {ariaLabel}
                </p>
                <p className="text-xs font-normal tracking-normal text-ds-text-muted">
                  {hasColor ? hex : resetLabel}
                </p>
              </div>
              {onReset ? (
                <button
                  type="button"
                  onMouseDown={onPointerDownCapture}
                  onClick={() => {
                    onReset();
                    setOpen(false);
                  }}
                  className={cx(
                    "px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-ds-text-muted transition hover:text-ds-text-primary",
                    RADIUS.sm,
                    FOCUS_RING,
                  )}
                >
                  Reset
                </button>
              ) : null}
            </div>

            {allowCustom && !customOnly ? (
              <div className="mt-2.5 grid grid-cols-2 gap-0.5 rounded-ds-md border border-ds-border-subtle bg-ds-surface-raised p-0.5 text-[11px] font-semibold">
                {(["swatches", "custom"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onMouseDown={onPointerDownCapture}
                    onClick={() => setTab(id)}
                    aria-pressed={tab === id}
                    className={cx(
                      "rounded-[var(--ds-radius-sm,6px)] px-2 py-1 capitalize transition-colors",
                      tab === id
                        ? "bg-ds-surface-base text-ds-text-primary shadow-ds-raised"
                        : "text-ds-text-muted hover:text-ds-text-primary",
                      FOCUS_RING,
                    )}
                  >
                    {id}
                  </button>
                ))}
              </div>
            ) : null}

            {!customOnly && (!allowCustom || effectiveTab === "swatches") ? (
              <div
                role="group"
                aria-labelledby={labelId}
                className={cx(
                  "grid grid-cols-8 gap-1.5",
                  allowCustom ? "mt-2.5" : "mt-2",
                )}
              >
                {presets.map((preset, index) => {
                  const selected = hasColor && toHex(preset, "") === hex;
                  return (
                    <button
                      key={`${preset}-${index}`}
                      ref={index === 0 ? firstPresetRef : undefined}
                      type="button"
                      aria-label={preset}
                      aria-pressed={selected}
                      title={preset}
                      onMouseDown={onPointerDownCapture}
                      onClick={() => pick(preset)}
                      className={cx(
                        "aspect-square w-full rounded-full border transition-transform hover:scale-110 motion-reduce:scale-100 motion-reduce:transition-none motion-reduce:hover:scale-100",
                        selected
                          ? "border-transparent ring-2 ring-ds-accent ring-offset-1 ring-offset-ds-surface-base"
                          : "border-ds-border-subtle",
                        FOCUS_RING,
                      )}
                      style={{ backgroundColor: preset }}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="mt-2.5">
                <div
                  ref={squareRef}
                  role="slider"
                  tabIndex={0}
                  aria-label={`${ariaLabel} saturation and brightness`}
                  aria-valuetext={`Saturation ${hsv.s}%, brightness ${hsv.v}%`}
                  aria-valuenow={hsv.v}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  onPointerDown={(event) =>
                    startPointerDrag(event, applySquareFromPoint)
                  }
                  onKeyDown={(event) => {
                    const step = event.shiftKey ? 10 : 2;
                    if (event.key === "ArrowLeft") {
                      event.preventDefault();
                      updateHsv({ s: hsv.s - step });
                    } else if (event.key === "ArrowRight") {
                      event.preventDefault();
                      updateHsv({ s: hsv.s + step });
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      updateHsv({ v: hsv.v + step });
                    } else if (event.key === "ArrowDown") {
                      event.preventDefault();
                      updateHsv({ v: hsv.v - step });
                    }
                  }}
                  className={cx(
                    "relative w-full cursor-crosshair overflow-hidden border border-ds-border-subtle",
                    RADIUS.md,
                    FOCUS_RING,
                  )}
                  style={{
                    height: SQUARE_HEIGHT,
                    backgroundColor: `hsl(${hsv.h}, 100%, 50%)`,
                    backgroundImage:
                      "linear-gradient(to top, #000000, rgba(0,0,0,0)), linear-gradient(to right, #ffffff, rgba(255,255,255,0))",
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                    style={{
                      left: `${hsv.s}%`,
                      top: `${100 - hsv.v}%`,
                      backgroundColor: hex,
                    }}
                  />
                </div>

                <div
                  ref={hueBarRef}
                  role="slider"
                  tabIndex={0}
                  aria-label={`${ariaLabel} hue`}
                  aria-valuenow={hsv.h}
                  aria-valuemin={0}
                  aria-valuemax={360}
                  onPointerDown={(event) =>
                    startPointerDrag(event, (clientX) =>
                      applyHueFromPoint(clientX),
                    )
                  }
                  onKeyDown={(event) => {
                    const step = event.shiftKey ? 10 : 2;
                    if (event.key === "ArrowLeft") {
                      event.preventDefault();
                      updateHsv({ h: hsv.h - step });
                    } else if (event.key === "ArrowRight") {
                      event.preventDefault();
                      updateHsv({ h: hsv.h + step });
                    }
                  }}
                  className={cx(
                    "relative mt-2.5 h-3 w-full cursor-pointer rounded-full border border-ds-border-subtle",
                    FOCUS_RING,
                  )}
                  style={{
                    background:
                      "linear-gradient(to right, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                    style={{
                      left: `${(hsv.h / 360) * 100}%`,
                      backgroundColor: `hsl(${hsv.h}, 100%, 50%)`,
                    }}
                  />
                </div>

                <div className="mt-2.5 flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-7 w-8 shrink-0 rounded-full border border-ds-border-subtle shadow-inner"
                    style={{ backgroundColor: hex }}
                  />
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Custom hex color</span>
                    <input
                      type="text"
                      aria-label={`${ariaLabel} hex value`}
                      value={hexDraft}
                      spellCheck={false}
                      onBlur={() => {
                        if (!HEX_PATTERN.test(hexDraft)) {
                          setHexDraftState({ source: hex, value: hex });
                        }
                      }}
                      onChange={(event) => {
                        const value = event.target.value.trim();
                        setHexDraftState({ source: hex, value });
                        if (HEX_PATTERN.test(value)) {
                          pick(value.toLowerCase());
                        }
                      }}
                      className={cx(
                        "h-7 w-full min-w-0 border bg-ds-surface-base px-2 text-xs font-normal tracking-normal text-ds-text-primary outline-none transition",
                        HEX_PATTERN.test(hexDraft)
                          ? "border-ds-border-subtle"
                          : "border-red-400/70",
                        RADIUS.sm,
                        FOCUS_RING,
                      )}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </FloatingSurface>
    </>
  );
}
