import type { ShortcutId } from "./catalog-types";

export const _CANVAS_RUNTIME_SHORTCUT_IDS = [
  "canvas.selection.traverse",
  "canvas.selection.clear",
  "canvas.move.step",
  "canvas.move.large-step",
  "canvas.resize.step",
  "canvas.resize.large-step",
  "canvas.edit.inline",
  "canvas.edit.delete",
  "canvas.edit.duplicate",
  "canvas.edit.clipboard",
  "canvas.edit.undo",
  "canvas.edit.redo",
  "canvas.arrange.forward-backward",
  "canvas.arrange.front-back",
  "canvas.rotate.step",
  "canvas.arrange.group",
  "canvas.arrange.ungroup",
  "canvas.help",
] as const satisfies readonly ShortcutId[];

export type CanvasArrangeShortcutKind =
  "forward" | "backward" | "front" | "back";

export interface CanvasArrangeShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function canvasArrangeShortcutKind(
  event: CanvasArrangeShortcutEvent,
): CanvasArrangeShortcutKind | null {
  if (event.altKey || event.shiftKey) return null;
  if (event.key !== "[" && event.key !== "]") return null;
  if (event.ctrlKey || event.metaKey) {
    return event.key === "]" ? "front" : "back";
  }
  return event.key === "]" ? "forward" : "backward";
}
