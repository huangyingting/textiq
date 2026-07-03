"use client";

import { useEditorContext } from "@/lib/lexical/editor-context";
import {
  resolveEditingSurface,
  selectionKindFromContext,
  type ResolvedEditingSurface,
} from "@/lib/lexical/editing-surface";
import { useIsPointerFine } from "@/lib/pointer";

import { useActiveTableCaptionKey } from "./use-active-table-caption";
import { useVisualPanel } from "./visual-panel-context";

/**
 * The React bridge to the pure {@link resolveEditingSurface} decision (epic #87,
 * item 3). It gathers the runtime inputs — pointer fineness and the selection
 * kind derived from the shared {@link useEditorContext} snapshot — and returns
 * the single `{ mode, group }` that every contextual editing surface renders
 * from.
 *
 * This is the ONE place that decides which contextual surface mode hosts which
 * content group; the floating text toolbar, visual popover, and bottom sheet all
 * read from here instead of running their own ad-hoc visibility checks.
 * Text/document selection is derived via {@link useEditorContext};
 * VisualCard's local active-visual state is bridged through
 * {@link useVisualPanel} because collaborative decorator NodeSelections are not
 * stable enough to be the only source for visual clicks.
 */
export function useEditingSurface(): ResolvedEditingSurface {
  const ctx = useEditorContext();
  const { activeVisual } = useVisualPanel();
  const pointerFine = useIsPointerFine();
  const activeCaptionTableKey = useActiveTableCaptionKey();
  const contextSelectionKind = selectionKindFromContext(ctx.kind);
  const selectionKind = activeVisual
    ? "visual"
    : contextSelectionKind === "range"
      ? "range"
      : activeCaptionTableKey !== null
        ? "table"
        : contextSelectionKind;

  return resolveEditingSurface({
    pointerFine,
    selectionKind,
  });
}
