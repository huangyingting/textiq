/**
 * The single, pure decision source for the editor's contextual editing
 * surfaces (epic #87, item 3 — "Unified EditingSurface").
 *
 * DOM-free and React-free, so it can be exercised headlessly under
 * `node --test`. The React bridge ({@link use-editing-surface.ts}) gathers the
 * runtime inputs (pointer fineness and the selection kind from
 * {@link useEditorContext}) and feeds them here; contextual surfaces then render
 * from the returned `{ mode, group }` instead of running their own ad-hoc
 * visibility checks. This keeps the #84 invariant intact: there is exactly one
 * place that turns "what is selected" into "which contextual surface shows
 * which content".
 *
 * The function is TOTAL over its 2 × 4 = 8 input combinations and is
 * exhaustively pinned by {@link editing-surface.test.ts}.
 */

import type { EditorContextKind } from "./editor-context";

/**
 * How the contextual editing content is presented:
 * - `"float"` — an anchored {@link FloatingSurface} popped near the active
 *   document, text, visual, or component context on fine pointers.
 * - `"sheet"` — the slide-up bottom sheet (coarse pointers).
 * - `"none"` — no contextual surface is shown (document-wide adjustments live
 *   in the top toolbar, not near the caret/canvas).
 */
type EditingSurfaceMode = "float" | "sheet" | "none";

/**
 * Which content group a surface should host. This is purely selection-derived
 * (see {@link selectionKindFromContext}):
 * - `"text-format"` ← a non-collapsed text range
 * - `"visual-edit"` ← a selected VisualNode
 * - `"table-edit"` ← a collapsed cursor/table selection inside a table
 * - `"overall"` ← no element selection (document-level adjustments)
 */
export type EditingSurfaceGroup =
  "text-format" | "visual-edit" | "table-edit" | "overall";

/** The selection kinds the resolver distinguishes (a projection of {@link EditorContextKind}). */
export type EditingSurfaceSelectionKind = "range" | "visual" | "table" | "none";

export type ResolveEditingSurfaceInput = {
  pointerFine: boolean;
  selectionKind: EditingSurfaceSelectionKind;
};

export type ResolvedEditingSurface = {
  mode: EditingSurfaceMode;
  group: EditingSurfaceGroup;
};

/**
 * Maps a raw {@link EditorContextKind} to the coarser
 * {@link EditingSurfaceSelectionKind} the resolver reasons about:
 * - `"range"` → `"range"`
 * - `"visual"` → `"visual"`
 * - `"table"` → `"table"`
 * - everything else (`"none"`, `"empty-block"`, `"collapsed"`) → `"none"`
 *
 * Pure: no DOM, no React. Keeps selection derivation centralised so callers
 * never re-implement the mapping.
 */
export function selectionKindFromContext(
  kind: EditorContextKind,
): EditingSurfaceSelectionKind {
  if (kind === "range") return "range";
  if (kind === "visual") return "visual";
  if (kind === "table") return "table";
  return "none";
}

/**
 * Derives the content group from a selection kind. Exposed so callers that
 * already have a {@link EditingSurfaceSelectionKind} can label content without
 * re-deriving the full surface decision.
 */
export function groupForSelectionKind(
  selectionKind: EditingSurfaceSelectionKind,
): EditingSurfaceGroup {
  if (selectionKind === "range") return "text-format";
  if (selectionKind === "visual") return "visual-edit";
  if (selectionKind === "table") return "table-edit";
  return "overall";
}

/**
 * The single decision: given the pointer and selection kind, return which
 * surface `mode` hosts which content `group`.
 *
 * Precedence (encoded in this exact order):
 * - **R1**: document context (`selectionKind === "none"`) → `"none"`.
 * - **R2**: fine pointer text/visual/table context → `"float"`.
 * - **R3**: coarse pointer text/visual/table context → `"sheet"`.
 *
 * The `group` is always returned (even when `mode === "none"`) so callers know
 * what would render.
 */
export function resolveEditingSurface({
  pointerFine,
  selectionKind,
}: ResolveEditingSurfaceInput): ResolvedEditingSurface {
  const group = groupForSelectionKind(selectionKind);

  if (selectionKind === "none") {
    return { mode: "none", group };
  }

  return { mode: pointerFine ? "float" : "sheet", group };
}
