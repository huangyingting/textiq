"use client";

import { Grid3x3, ListPlus, Ruler, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { Popover } from "@/components/ui/popover";
import { SelectMenu, type SelectMenuOption } from "@/components/ui/select-menu";
import { cx, FOCUS_RING } from "@/components/ui/tokens";
import { STAGE_CHROME_Z_INDEX } from "@/lib/presentation/stage-chrome";
import type { StageGuideInput } from "@/lib/presentation/stage-guides";

import { DeckToolbarIconButton } from "./toolbar/deck-toolbar";
import type { PrecisionGuidePreferences } from "./precision-guides-storage";

const PRECISION_RULER_TICKS = [0, 25, 50, 75, 100] as const;

const GUIDE_ORIENTATION_OPTIONS: readonly SelectMenuOption[] = [
  { value: "x", label: "Vertical" },
  { value: "y", label: "Horizontal" },
];

function guideOrientationLabel(axis: StageGuideInput["axis"]): string {
  return axis === "x" ? "vertical" : "horizontal";
}

function guidePositionLabel(positionPct: number): string {
  return Number.isInteger(positionPct)
    ? String(positionPct)
    : positionPct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function PrecisionGuideToolbarControls({
  preferences,
  onToggleGrid,
  onToggleRulers,
  onToggleCustomGuides,
  onAddCustomGuide,
  onRemoveCustomGuide,
}: {
  preferences: PrecisionGuidePreferences;
  onToggleGrid: () => void;
  onToggleRulers: () => void;
  onToggleCustomGuides: () => void;
  onAddCustomGuide: (axis: StageGuideInput["axis"], position: string) => void;
  onRemoveCustomGuide: (index: number) => void;
}) {
  const [customGuidesOpen, setCustomGuidesOpen] = useState(false);
  const [axis, setAxis] = useState<StageGuideInput["axis"]>("x");
  const [position, setPosition] = useState("50");
  const customGuidesTriggerRef = useRef<HTMLButtonElement | null>(null);

  function closeCustomGuides() {
    setCustomGuidesOpen(false);
    queueMicrotask(() => customGuidesTriggerRef.current?.focus());
  }

  return (
    <>
      <DeckToolbarIconButton
        label="Toggle grid overlay"
        tooltip={
          preferences.gridVisible
            ? "Grid overlay: shown"
            : "Grid overlay: hidden"
        }
        active={preferences.gridVisible}
        onClick={onToggleGrid}
      >
        <Grid3x3 size={14} aria-hidden="true" />
      </DeckToolbarIconButton>
      <DeckToolbarIconButton
        label="Toggle rulers"
        tooltip={preferences.rulersVisible ? "Rulers: shown" : "Rulers: hidden"}
        active={preferences.rulersVisible}
        onClick={onToggleRulers}
      >
        <Ruler size={14} aria-hidden="true" />
      </DeckToolbarIconButton>
      <Popover
        open={customGuidesOpen}
        onClose={closeCustomGuides}
        aria-label="Custom guides"
        portal
        align="start"
        className="w-72 space-y-3 p-3"
        trigger={
          <DeckToolbarIconButton
            label="Manage custom guides"
            active={customGuidesOpen}
            hasPopup="dialog"
            expanded={customGuidesOpen}
            buttonRef={customGuidesTriggerRef}
            onClick={() => {
              if (customGuidesOpen) {
                closeCustomGuides();
              } else {
                setCustomGuidesOpen(true);
              }
            }}
          >
            <ListPlus size={14} aria-hidden="true" />
          </DeckToolbarIconButton>
        }
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-ds-text-primary">
            Custom guides
          </span>
          <button
            type="button"
            onClick={closeCustomGuides}
            className={cx(
              "rounded-ds-sm px-2 py-1 text-xs font-medium text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary",
              FOCUS_RING,
            )}
          >
            Close
          </button>
        </div>
        <button
          type="button"
          aria-pressed={preferences.guidesVisible}
          onClick={onToggleCustomGuides}
          className={cx(
            "flex w-full items-center justify-between rounded-ds-sm border border-ds-border-subtle px-2.5 py-2 text-left text-xs font-medium text-ds-text-primary hover:bg-ds-state-hover",
            FOCUS_RING,
          )}
        >
          <span>Show custom guides</span>
          <span className="text-[11px] text-ds-text-muted">
            {preferences.guidesVisible ? "Shown" : "Hidden"}
          </span>
        </button>

        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <div className="text-xs font-medium text-ds-text-secondary">
            Orientation
            <div className="mt-1">
              <SelectMenu
                aria-label="Guide orientation"
                variant="field"
                value={axis}
                options={GUIDE_ORIENTATION_OPTIONS}
                onChange={(next) => setAxis(next as StageGuideInput["axis"])}
              />
            </div>
          </div>
          <label className="text-xs font-medium text-ds-text-secondary">
            Position (%)
            <input
              aria-label="Guide position (%)"
              type="number"
              role="spinbutton"
              min={0}
              max={100}
              step={0.01}
              value={position}
              onChange={(event) => setPosition(event.currentTarget.value)}
              className={cx(
                "mt-1 h-8 w-full rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-2 text-xs text-ds-text-primary",
                FOCUS_RING,
              )}
            />
          </label>
          <button
            type="button"
            onClick={() => onAddCustomGuide(axis, position)}
            className={cx(
              "h-8 rounded-ds-sm bg-ds-accent-fill px-3 text-xs font-semibold text-ds-accent-contrast",
              FOCUS_RING,
            )}
          >
            Add guide
          </button>
        </div>

        {preferences.customGuides.length ? (
          <ul className="max-h-44 space-y-1 overflow-y-auto">
            {preferences.customGuides.map((guide, index) => {
              const label = `${guideOrientationLabel(guide.axis)} guide at ${guidePositionLabel(guide.positionPct)}%`;
              return (
                <li
                  key={`${guide.axis}:${guide.positionPct}`}
                  className="flex items-center justify-between gap-2 rounded-ds-sm bg-ds-surface-muted px-2 py-1.5 text-xs text-ds-text-secondary"
                >
                  <span>{label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${label}`}
                    onClick={() => onRemoveCustomGuide(index)}
                    className={cx(
                      "rounded-ds-sm p-1 text-ds-text-muted hover:bg-ds-state-hover hover:text-ds-danger",
                      FOCUS_RING,
                    )}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-ds-text-muted">No custom guides yet.</p>
        )}
      </Popover>
    </>
  );
}

export function PrecisionGuideOverlays({
  preferences,
}: {
  preferences: PrecisionGuidePreferences;
}) {
  return (
    <>
      {preferences.gridVisible ? (
        <div
          aria-hidden="true"
          data-precision-grid-overlay="true"
          className="pointer-events-none absolute inset-0"
          style={{
            zIndex: STAGE_CHROME_Z_INDEX.precisionGuide,
            backgroundImage:
              "linear-gradient(to right, rgba(99, 102, 241, 0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(99, 102, 241, 0.18) 1px, transparent 1px)",
            backgroundSize: "10% 10%",
          }}
        />
      ) : null}

      {preferences.guidesVisible && preferences.customGuides.length > 0 ? (
        <div
          aria-hidden="true"
          data-precision-guides-overlay="true"
          className="pointer-events-none absolute inset-0"
          style={{ zIndex: STAGE_CHROME_Z_INDEX.precisionGuide }}
        >
          {preferences.customGuides.map((guide, index) => (
            <span
              key={`${guide.axis}-${guide.positionPct}-${index}`}
              className="absolute bg-ds-accent-fill/45"
              style={
                guide.axis === "x"
                  ? {
                      left: `${guide.positionPct}%`,
                      top: 0,
                      width: 1,
                      height: "100%",
                    }
                  : {
                      left: 0,
                      top: `${guide.positionPct}%`,
                      width: "100%",
                      height: 1,
                    }
              }
            />
          ))}
        </div>
      ) : null}

      {preferences.rulersVisible ? (
        <div
          aria-hidden="true"
          data-precision-ruler-overlay="true"
          className="pointer-events-none absolute inset-0 text-[8px] font-medium text-ds-text-muted"
          style={{ zIndex: STAGE_CHROME_Z_INDEX.precisionRuler }}
        >
          <div className="absolute left-0 top-0 h-5 w-full border-b border-ds-border-subtle bg-ds-surface">
            {PRECISION_RULER_TICKS.map((tick) => (
              <span key={`x-${tick}`} aria-hidden="true">
                <span
                  className="absolute bottom-0 h-2 w-px bg-ds-border-strong"
                  style={{ left: `${tick}%` }}
                />
                <span
                  className="absolute top-0 -translate-x-1/2"
                  style={{ left: `${tick}%` }}
                >
                  {tick}
                </span>
              </span>
            ))}
          </div>
          <div className="absolute left-0 top-0 h-full w-6 border-r border-ds-border-subtle bg-ds-surface">
            {PRECISION_RULER_TICKS.map((tick) => (
              <span key={`y-${tick}`} aria-hidden="true">
                <span
                  className="absolute right-0 h-px w-2 bg-ds-border-strong"
                  style={{ top: `${tick}%` }}
                />
                <span
                  className="absolute left-0 -translate-y-1/2"
                  style={{ top: `${tick}%` }}
                >
                  {tick}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
