import {
  shortcutById,
  shortcutDisplayTokens,
  type ShortcutId,
} from "@/lib/shortcuts/catalog";

import {
  fitCanvasToViewport,
  type StageFitSize,
} from "@/lib/presentation/stage-fit";

export type PresentShortcutAction =
  | "next"
  | "previous"
  | "first"
  | "last"
  | "help"
  | "exit"
  | "fullscreen"
  | "notes"
  | "overview"
  | "timer"
  | "laser";

export type PresentShortcutIdMap = Partial<
  Record<PresentShortcutAction, ShortcutId>
>;

export type PresentShortcutRow = {
  id: ShortcutId;
  action: PresentShortcutAction;
  keys: string[];
  description: string;
};

export type PresentProgress = {
  label: string;
  percentage: number;
};

export const DEFAULT_PRESENT_VIEWPORT: StageFitSize = { width: 16, height: 9 };

export const PRESENTATION_NAVIGATION_SHORTCUT_IDS = {
  next: "presentation.next",
  previous: "presentation.previous",
  first: "presentation.first",
  last: "presentation.last",
} as const satisfies PresentShortcutIdMap;

export const PRESENT_MODE_SHORTCUT_IDS = {
  ...PRESENTATION_NAVIGATION_SHORTCUT_IDS,
  fullscreen: "presentation.fullscreen",
  exit: "presentation.exit",
  help: "presentation.help",
  notes: "presentation.notes",
  overview: "presentation.overview",
  timer: "presentation.timer",
  laser: "presentation.laser",
} as const satisfies PresentShortcutIdMap;

export function presentShortcutRows(
  shortcuts: PresentShortcutIdMap,
): PresentShortcutRow[] {
  return Object.entries(shortcuts).map(([action, id]) => {
    const entry = shortcutById(id);
    return {
      id,
      action: action as PresentShortcutAction,
      keys: shortcutDisplayTokens(entry),
      description: entry.description,
    };
  });
}

export const PRESENT_MODE_SHORTCUTS = presentShortcutRows(
  PRESENT_MODE_SHORTCUT_IDS,
);

export function clampPresentSlideIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.max(Math.floor(index), 0), total - 1);
}

export function formatPresentProgress(current: number, total: number): string {
  if (total <= 0) return "0 / 0";
  const display = clampPresentSlideIndex(current, total) + 1;
  return `${display} / ${total}`;
}

export function presentProgress(
  current: number,
  total: number,
): PresentProgress {
  return {
    label: formatPresentProgress(current, total),
    percentage:
      total > 1
        ? (clampPresentSlideIndex(current, total) / (total - 1)) * 100
        : 100,
  };
}

export function presentSlideIndexFromHash(hash: string, total: number): number {
  const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
  const parsed = parseInt(stripped, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 0;
  return clampPresentSlideIndex(parsed - 1, total);
}

export function presentHashFromSlideIndex(index: number): string {
  return `#${Math.max(0, Math.floor(index)) + 1}`;
}

export const PRESENT_SWIPE_THRESHOLD_PX = 50;

export function resolvePresentSwipeNavigation(
  deltaX: number,
  threshold: number = PRESENT_SWIPE_THRESHOLD_PX,
): "next" | "prev" | null {
  if (Math.abs(deltaX) < threshold) return null;
  return deltaX < 0 ? "next" : "prev";
}

export function presentCanvasAspectRatio(
  canvas: { width: number; height: number } | null | undefined,
): number {
  return canvas && canvas.width > 0 && canvas.height > 0
    ? canvas.width / canvas.height
    : DEFAULT_PRESENT_VIEWPORT.width / DEFAULT_PRESENT_VIEWPORT.height;
}

export function fitPresentCanvasToViewport(
  viewport: StageFitSize,
  aspectRatio: number,
): StageFitSize {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return DEFAULT_PRESENT_VIEWPORT;
  }

  const fit = fitCanvasToViewport({
    viewport,
    aspectRatio,
    zoomPercent: 100,
  });
  return { width: fit.frame.width, height: fit.frame.height };
}

export function formatPresentElapsedTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}
