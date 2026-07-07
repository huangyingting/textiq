import { useEffect, useState } from "react";

import {
  normalizeStageGuideInputs,
  stageGuideInputKey,
  type StageGuideInput,
} from "@/lib/presentation/stage-guides";

import {
  DEFAULT_PRECISION_GUIDE_PREFERENCES,
  normalizePrecisionGuidePreferences,
  readPrecisionGuidePreferences,
  writePrecisionGuidePreferences,
  type PrecisionGuidePreferences,
} from "./precision-guides-storage";

function formatGuidePosition(positionPct: number): string {
  return Number.isInteger(positionPct)
    ? String(positionPct)
    : positionPct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function guideAxisLabel(axis: StageGuideInput["axis"]): string {
  return axis === "x" ? "vertical" : "horizontal";
}

export function usePrecisionGuides(
  documentId: string,
  setStageAnnouncement: (announcement: string) => void,
) {
  const [precisionGuides, setPrecisionGuides] =
    useState<PrecisionGuidePreferences>(DEFAULT_PRECISION_GUIDE_PREFERENCES);

  useEffect(() => {
    let canceled = false;
    const timeoutId = globalThis.setTimeout(() => {
      if (!canceled) {
        setPrecisionGuides(readPrecisionGuidePreferences(documentId));
      }
    }, 0);
    return () => {
      canceled = true;
      globalThis.clearTimeout(timeoutId);
    };
  }, [documentId]);

  function updatePrecisionGuides(
    updater: (
      current: PrecisionGuidePreferences,
    ) => Partial<PrecisionGuidePreferences>,
    announcement: string,
  ) {
    setPrecisionGuides((current) => {
      const next = normalizePrecisionGuidePreferences(updater(current));
      writePrecisionGuidePreferences(documentId, next);
      return next;
    });
    setStageAnnouncement(announcement);
  }

  function togglePrecisionGrid() {
    updatePrecisionGuides(
      (current) => ({ ...current, gridVisible: !current.gridVisible }),
      precisionGuides.gridVisible
        ? "Grid overlay hidden"
        : "Grid overlay shown",
    );
  }

  function togglePrecisionRulers() {
    updatePrecisionGuides(
      (current) => ({ ...current, rulersVisible: !current.rulersVisible }),
      precisionGuides.rulersVisible
        ? "Rulers hidden"
        : "Rulers shown for precision layout",
    );
  }

  function toggleCustomGuidesVisible() {
    updatePrecisionGuides(
      (current) => ({ ...current, guidesVisible: !current.guidesVisible }),
      precisionGuides.guidesVisible
        ? "Custom guides hidden"
        : "Custom guides shown",
    );
  }

  function addCustomGuide(axis: StageGuideInput["axis"], value: string) {
    const [guide] = normalizeStageGuideInputs([
      { axis, positionPct: Number(value) },
    ]);
    if (!guide) {
      setStageAnnouncement("Enter a guide position between 0 and 100 percent");
      return;
    }
    const nextGuides = normalizeStageGuideInputs([
      ...precisionGuides.customGuides,
      guide,
    ]);
    const existed =
      nextGuides.length === precisionGuides.customGuides.length &&
      precisionGuides.customGuides.some(
        (item) => stageGuideInputKey(item) === stageGuideInputKey(guide),
      );
    updatePrecisionGuides(
      (current) => ({
        ...current,
        guidesVisible: true,
        customGuides: nextGuides,
      }),
      existed
        ? `${guideAxisLabel(guide.axis)} guide already exists at ${formatGuidePosition(
            guide.positionPct,
          )}%`
        : `Added ${guideAxisLabel(guide.axis)} guide at ${formatGuidePosition(
            guide.positionPct,
          )}%`,
    );
  }

  function removeCustomGuide(index: number) {
    const guide = precisionGuides.customGuides[index];
    const nextGuides = precisionGuides.customGuides.filter(
      (_item, itemIndex) => itemIndex !== index,
    );
    updatePrecisionGuides(
      (current) => ({ ...current, customGuides: nextGuides }),
      guide
        ? `Removed ${guideAxisLabel(guide.axis)} guide at ${formatGuidePosition(
            guide.positionPct,
          )}%`
        : "Removed guide",
    );
  }

  return {
    precisionGuides,
    togglePrecisionGrid,
    togglePrecisionRulers,
    toggleCustomGuidesVisible,
    addCustomGuide,
    removeCustomGuide,
  };
}
