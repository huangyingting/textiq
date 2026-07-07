"use client";

import { Grid3x3, Ruler } from "lucide-react";

import { STAGE_CHROME_Z_INDEX } from "@/lib/presentation/stage-chrome";

import { DeckToolbarIconButton } from "./toolbar/deck-toolbar";
import type { PrecisionGuidePreferences } from "./precision-guides-storage";

const PRECISION_RULER_TICKS = [0, 25, 50, 75, 100] as const;

export function PrecisionGuideToolbarControls({
  preferences,
  onToggleGrid,
  onToggleRulers,
}: {
  preferences: PrecisionGuidePreferences;
  onToggleGrid: () => void;
  onToggleRulers: () => void;
}) {
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
