"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Grid3x3, Plus, Ruler, Trash2 } from "lucide-react";

import { STAGE_CHROME_Z_INDEX } from "@/lib/presentation/stage-chrome";
import type { StageGuideInput } from "@/lib/presentation/stage-guides";

import { Popover } from "@/components/ui/popover";
import { cx, FOCUS_RING } from "@/components/ui/tokens";
import { DeckToolbarButton } from "./toolbar/deck-toolbar";
import { useFocusFirstDescendantWhenOpen } from "./use-stage-focus-controller";
import type { PrecisionGuidePreferences } from "./precision-guides-storage";

const PRECISION_RULER_TICKS = [0, 25, 50, 75, 100] as const;

export function formatGuidePosition(positionPct: number): string {
  return Number.isInteger(positionPct)
    ? String(positionPct)
    : positionPct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function guideAxisLabel(axis: StageGuideInput["axis"]): string {
  return axis === "x" ? "vertical" : "horizontal";
}

export function PrecisionGuideToolbarControls({
  preferences,
  onToggleGrid,
  onToggleRulers,
  onToggleGuides,
  onAddGuide,
  onRemoveGuide,
}: {
  preferences: PrecisionGuidePreferences;
  onToggleGrid: () => void;
  onToggleRulers: () => void;
  onToggleGuides: () => void;
  onAddGuide: (axis: StageGuideInput["axis"], value: string) => void;
  onRemoveGuide: (index: number) => void;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [verticalGuideInput, setVerticalGuideInput] = useState("50");
  const [horizontalGuideInput, setHorizontalGuideInput] = useState("50");
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useFocusFirstDescendantWhenOpen(panelOpen, panelRef);

  function handleAddVerticalGuide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onAddGuide("x", verticalGuideInput);
  }

  function handleAddHorizontalGuide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onAddGuide("y", horizontalGuideInput);
  }

  return (
    <>
      <DeckToolbarButton
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
        Grid
      </DeckToolbarButton>
      <DeckToolbarButton
        label="Toggle rulers"
        tooltip={preferences.rulersVisible ? "Rulers: shown" : "Rulers: hidden"}
        active={preferences.rulersVisible}
        onClick={onToggleRulers}
      >
        <Ruler size={14} aria-hidden="true" />
        Rulers
      </DeckToolbarButton>
      <Popover
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        aria-label="Precision guide controls"
        portal
        className="w-80 p-3"
        trigger={
          <DeckToolbarButton
            label="Manage custom guides"
            tooltip="Manage custom guides"
            active={panelOpen || preferences.guidesVisible}
            hasPopup="dialog"
            expanded={panelOpen}
            controls={panelOpen ? panelId : undefined}
            onClick={() => setPanelOpen((open) => !open)}
          >
            <Plus size={14} aria-hidden="true" />
            Guides
          </DeckToolbarButton>
        }
      >
        <div
          id={panelId}
          ref={panelRef}
          data-precision-guide-panel="true"
          className="space-y-3 text-xs text-ds-text-primary"
        >
          <div>
            <p className="font-semibold">Precision guides</p>
            <p className="mt-1 text-ds-text-muted">
              Positions use slide percent units and persist for this deck.
            </p>
          </div>
          <div className="grid gap-2">
            <PrecisionToggle
              label="Show custom guides"
              checked={preferences.guidesVisible}
              onChange={onToggleGuides}
            />
            <PrecisionToggle
              label="Show grid"
              checked={preferences.gridVisible}
              onChange={onToggleGrid}
            />
            <PrecisionToggle
              label="Show rulers"
              checked={preferences.rulersVisible}
              onChange={onToggleRulers}
            />
          </div>
          <GuideAddForm
            label="Vertical guide (%)"
            ariaLabel="Vertical guide position percent"
            value={verticalGuideInput}
            onValueChange={setVerticalGuideInput}
            onSubmit={handleAddVerticalGuide}
          />
          <GuideAddForm
            label="Horizontal guide (%)"
            ariaLabel="Horizontal guide position percent"
            value={horizontalGuideInput}
            onValueChange={setHorizontalGuideInput}
            onSubmit={handleAddHorizontalGuide}
          />
          <div>
            <p className="font-medium">Custom guides</p>
            {preferences.customGuides.length === 0 ? (
              <p className="mt-1 text-ds-text-muted">No custom guides yet.</p>
            ) : (
              <ul className="mt-1 space-y-1" aria-label="Custom guides">
                {preferences.customGuides.map((guide, index) => (
                  <li
                    key={`${guide.axis}-${guide.positionPct}-${index}`}
                    className="flex items-center justify-between gap-2 rounded-ds-sm bg-ds-surface-subtle px-2 py-1"
                  >
                    <span>
                      {guideAxisLabel(guide.axis)}{" "}
                      {formatGuidePosition(guide.positionPct)}%
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${guideAxisLabel(
                        guide.axis,
                      )} guide at ${formatGuidePosition(guide.positionPct)}%`}
                      onClick={() => onRemoveGuide(index)}
                      className={cx(
                        "rounded-ds-sm p-1 text-ds-text-muted hover:bg-ds-state-hover hover:text-ds-text-primary",
                        FOCUS_RING,
                      )}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Popover>
    </>
  );
}

function PrecisionToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-ds-sm border border-ds-border-subtle px-2 py-1.5">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className={cx("h-4 w-4", FOCUS_RING)}
      />
    </label>
  );
}

function GuideAddForm({
  label,
  ariaLabel,
  value,
  onValueChange,
  onSubmit,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="grid grid-cols-[1fr_auto] gap-2" onSubmit={onSubmit}>
      <label className="grid gap-1">
        <span className="font-medium">{label}</span>
        <input
          aria-label={ariaLabel}
          type="number"
          min="0"
          max="100"
          step="0.5"
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          className={cx(
            "h-8 rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-2",
            FOCUS_RING,
          )}
        />
      </label>
      <button
        type="submit"
        className={cx(
          "self-end rounded-ds-sm border border-ds-border-subtle px-2 py-1.5 font-medium hover:bg-ds-state-hover",
          FOCUS_RING,
        )}
      >
        Add
      </button>
    </form>
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
