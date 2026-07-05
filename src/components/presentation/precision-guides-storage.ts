import {
  normalizeStageGuideInputs,
  type StageGuideInput,
} from "@/lib/presentation/stage-guides";

const PRECISION_GUIDES_KEY_PREFIX = "slide-precision-guides";

type PrecisionGuidesStorage = Pick<Storage, "getItem" | "setItem">;

export type PrecisionGuidePreferences = {
  gridVisible: boolean;
  rulersVisible: boolean;
  guidesVisible: boolean;
  customGuides: StageGuideInput[];
};

export const DEFAULT_PRECISION_GUIDE_PREFERENCES: PrecisionGuidePreferences = {
  gridVisible: false,
  rulersVisible: false,
  guidesVisible: false,
  customGuides: [],
};

function getBrowserStorage(): PrecisionGuidesStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function precisionGuidesStorageKey(documentId: string): string {
  return `${PRECISION_GUIDES_KEY_PREFIX}:${encodeURIComponent(documentId)}`;
}

function guideInputsFromUnknown(value: unknown): StageGuideInput[] {
  if (!Array.isArray(value)) return [];
  return normalizeStageGuideInputs(
    value.flatMap((item): StageGuideInput[] => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as { axis?: unknown; positionPct?: unknown };
      if (candidate.axis !== "x" && candidate.axis !== "y") return [];
      const positionPct =
        typeof candidate.positionPct === "number"
          ? candidate.positionPct
          : Number(candidate.positionPct);
      return [{ axis: candidate.axis, positionPct }];
    }),
  );
}

export function normalizePrecisionGuidePreferences(
  value: Partial<PrecisionGuidePreferences> | unknown,
): PrecisionGuidePreferences {
  if (!value || typeof value !== "object") {
    return DEFAULT_PRECISION_GUIDE_PREFERENCES;
  }
  const candidate = value as Partial<PrecisionGuidePreferences>;
  return {
    gridVisible: candidate.gridVisible === true,
    rulersVisible: candidate.rulersVisible === true,
    guidesVisible: candidate.guidesVisible === true,
    customGuides: guideInputsFromUnknown(candidate.customGuides),
  };
}

export function readPrecisionGuidePreferences(
  documentId: string,
  storage: PrecisionGuidesStorage | undefined = getBrowserStorage(),
): PrecisionGuidePreferences {
  if (!storage) return DEFAULT_PRECISION_GUIDE_PREFERENCES;
  try {
    const raw = storage.getItem(precisionGuidesStorageKey(documentId));
    if (!raw) return DEFAULT_PRECISION_GUIDE_PREFERENCES;
    return normalizePrecisionGuidePreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_PRECISION_GUIDE_PREFERENCES;
  }
}

export function writePrecisionGuidePreferences(
  documentId: string,
  preferences: PrecisionGuidePreferences,
  storage: PrecisionGuidesStorage | undefined = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      precisionGuidesStorageKey(documentId),
      JSON.stringify(normalizePrecisionGuidePreferences(preferences)),
    );
  } catch {
    return;
  }
}
