/**
 * Slide command envelope, CommandResult type, and command executor.
 *
 * Pure and headless — no DOM, no React, no browser APIs. Fully testable under
 * `node --test`. All mutation helpers from `deck-mutations.ts` are called as
 * lower-level primitives; this module only adds the command envelope, result
 * type, validation, and coalescing logic on top.
 *
 * Design goals:
 *  - `executeCommand` is pure and deterministic: same deck + command → same result.
 *    **Caveat:** commands that create new slides or elements (ADD_SLIDE,
 *    DUPLICATE_SLIDE, ADD_ELEMENT) generate fresh ids via `crypto.randomUUID()`
 *    internally, so those specific results are not replay-identical across calls.
 *  - The input deck is **never mutated** — failures return the same reference.
 *  - Validation errors are explicit and do not partially mutate the deck.
 *  - Slide `id`, `index`, and `theme` fields are structurally immutable: the
 *    `UpdateSlideCommand.patch` type excludes them, and the executor strips any
 *    `id` key that reaches it through an unsafe cast.
 *  - `CommandResult` exposes enough metadata (affected ids, historyKey, patches)
 *    for upstream undo/redo, autosave, patch persistence, and analytics consumers.
 *
 * ## Patch output (issue #401)
 *
 * Each successful `CommandResult` includes a `patches` array of serialisable
 * {@link DeckPatch} records. The patch format is schema-versioned (mirrors
 * `LEGACY_DECK_SCHEMA_VERSION`) and intentionally minimal so it can be
 * validated server-side and forwarded to the persistence epic (#376/#403).
 *
 * Use {@link applyPatch} to re-apply a patch to a deck for testing or
 * server-side replay.
 *
 * ## Command history adapter (issue #402)
 *
 * {@link commitCommand} is the single shared commit path for all command-based
 * editor handlers. It wraps `executeCommand`, extracts `coalesceKey` and
 * `affectedSlideIds` for the history/autosave layer, and returns a
 * {@link CommitCommandResult} that the editor can pass directly to
 * `onDeckChange` (commit) and downstream analytics hooks.
 */

import type { Deck } from "./deck-core";
import {
  setDeckSlideFormat,
  setPresentationTheme,
} from "./deck-mutation-deck-settings";
import { setElementPatches } from "./deck-mutation-elements";
import { updateSlide } from "./deck-mutation-slides";
import { resetPresentationThemeOverrides } from "./presentation-theme-overrides";
import { executeBackgroundFamilyCommand } from "./slide-command-background-executor";
import { executePresentationThemeFamilyCommand } from "./slide-command-presentation-executor";
import { executeElementFamilyCommand } from "./slide-command-element-executor";
import {
  canCoalesceSlideCommands,
  mergeCoalescedSlideCommands,
} from "./slide-command-metadata";
import { executeSlideFamilyCommand } from "./slide-command-slide-executor";
import { executeSourceRefFamilyCommand } from "./slide-command-source-ref-executor";
import type {
  CommandResult,
  DeckPatch,
  SlideCommand,
} from "./slide-command-contracts";

// ---------------------------------------------------------------------------
// Re-exports from slide-command-contracts
// (single-source truth; importers of this module keep working unchanged)
// ---------------------------------------------------------------------------
export type {
  AddElementCommand,
  AddSlideCommand,
  ApplyThemePackageCommand,
  AlignElementsCommand,
  ArrangeElementsCommand,
  BringElementToFrontCommand,
  CommandResult,
  DeckPatch,
  DistributeElementsCommand,
  DuplicateElementCommand,
  DuplicateElementsCommand,
  DuplicateSlideCommand,
  GroupElementsCommand,
  InsertTemplateSlideCommand,
  MatchSizeElementsCommand,
  MoveElementZOrderCommand,
  MoveSlideCommand,
  NudgeElementsCommand,
  PatchOp,
  RemoveElementCommand,
  RemoveElementsCommand,
  RemoveSlideCommand,
  RemoveSourceElementCommand,
  RenameElementCommand,
  ReorderElementCommand,
  ReorderSlideCommand,
  SendElementToBackCommand,
  SetCanvasFormatCommand,
  SetPresentationThemeCommand,
  SetElementBoxesCommand,
  SetElementHiddenCommand,
  SetElementLockedCommand,
  SetElementPatchesCommand,
  SetSlideAccentCommand,
  SetSlideBackgroundAssetCommand,
  SetSlideBackgroundCommand,
  SetSlideBackgroundGradientCommand,
  SetSlideBackgroundImageCommand,
  SlideCommand,
  UngroupElementsCommand,
  UpdateElementSourceCommand,
  UpdateThemeOverridesCommand,
  UpdateElementContentCommand,
  UpdateElementCommand,
  UpdateElementDesignOverridesCommand,
  UpdateSlideCommand,
  UpdateSlideNotesCommand,
  UpdateSlideTitleCommand,
} from "./slide-command-contracts";

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export function executeCommand(deck: Deck, cmd: SlideCommand): CommandResult {
  switch (cmd.type) {
    case "ADD_SLIDE":
    case "REMOVE_SLIDE":
    case "DUPLICATE_SLIDE":
    case "REORDER_SLIDE":
    case "UPDATE_SLIDE":
    case "MOVE_SLIDE":
    case "INSERT_TEMPLATE_SLIDE":
    case "UPDATE_SLIDE_TITLE":
    case "UPDATE_SLIDE_NOTES":
      return executeSlideFamilyCommand(deck, cmd);
    case "ADD_ELEMENT":
    case "UPDATE_ELEMENT":
    case "UPDATE_ELEMENT_CONTENT":
    case "UPDATE_ELEMENT_DESIGN_OVERRIDES":
    case "REMOVE_ELEMENT":
    case "REMOVE_ELEMENTS":
    case "DUPLICATE_ELEMENT":
    case "DUPLICATE_ELEMENTS":
    case "NUDGE_ELEMENTS":
    case "GROUP_ELEMENTS":
    case "UNGROUP_ELEMENTS":
    case "ALIGN_ELEMENTS":
    case "DISTRIBUTE_ELEMENTS":
    case "MATCH_SIZE_ELEMENTS":
    case "ARRANGE_ELEMENTS":
    case "BRING_ELEMENT_TO_FRONT":
    case "SEND_ELEMENT_TO_BACK":
    case "SET_ELEMENT_BOXES":
    case "SET_ELEMENT_PATCHES":
    case "SET_ELEMENT_HIDDEN":
    case "SET_ELEMENT_LOCKED":
    case "MOVE_ELEMENT_ZORDER":
    case "RENAME_ELEMENT":
    case "REORDER_ELEMENT":
      return executeElementFamilyCommand(deck, cmd);
    case "SET_PRESENTATION_THEME":
    case "APPLY_THEME_PACKAGE":
    case "UPDATE_THEME_OVERRIDES":
    case "SET_CANVAS_FORMAT":
    case "CREATE_MASTER":
    case "UPDATE_MASTER":
    case "DELETE_MASTER":
    case "SET_DEFAULT_MASTER":
    case "SET_SLIDE_MASTER":
    case "UPDATE_MASTER_ELEMENT":
    case "ADD_SLIDE_FROM_TEMPLATE":
    case "APPLY_SLIDE_TEMPLATE":
    case "CREATE_CUSTOM_TEMPLATE":
    case "UPDATE_CUSTOM_TEMPLATE":
    case "DELETE_CUSTOM_TEMPLATE":
      return executePresentationThemeFamilyCommand(deck, cmd);
    case "SET_SLIDE_BACKGROUND":
    case "SET_SLIDE_BACKGROUND_GRADIENT":
    case "SET_SLIDE_BACKGROUND_IMAGE":
    case "SET_SLIDE_BACKGROUND_ASSET":
    case "SET_SLIDE_ACCENT":
      return executeBackgroundFamilyCommand(deck, cmd);
    case "UPDATE_ELEMENT_SOURCE":
    case "REMOVE_SOURCE_ELEMENT":
      return executeSourceRefFamilyCommand(deck, cmd);
  }
}

// ---------------------------------------------------------------------------
// Coalescing
// ---------------------------------------------------------------------------

/**
 * Collapses adjacent commands in `history` that share the same `coalesceKey`
 * and target (slide + optional element) into a single merged command.
 *
 * Rules:
 * - Only gesture/edit commands carrying a `coalesceKey` are considered.
 * - Two adjacent commands may coalesce when their `type`, `slideId`, element
 *   id (if applicable), and `coalesceKey` all match.
 * - When coalescing, the *later* patch is merged on top of the earlier one —
 *   last write wins per field.
 * - Commands without a `coalesceKey` are passed through unchanged.
 *
 * This is purely structural — it does not execute commands or touch a deck.
 * Upstream history can call this before committing a sequence to undo/redo.
 */
export function coalesceCommands(history: SlideCommand[]): SlideCommand[] {
  if (history.length === 0) return history;

  const result: SlideCommand[] = [history[0]!];
  for (let i = 1; i < history.length; i++) {
    const prev = result[result.length - 1]!;
    const curr = history[i]!;
    if (canCoalesce(prev, curr)) {
      result[result.length - 1] = mergeCommands(prev, curr);
    } else {
      result.push(curr);
    }
  }

  return result;
}

function canCoalesce(a: SlideCommand, b: SlideCommand): boolean {
  return canCoalesceSlideCommands(a, b);
}

function mergeCommands(a: SlideCommand, b: SlideCommand): SlideCommand {
  return mergeCoalescedSlideCommands(a, b);
}

// ---------------------------------------------------------------------------
// Issue #401 — applyPatch helper (round-trip support and server-side use)
// ---------------------------------------------------------------------------

/**
 * Re-applies a serialised {@link DeckPatch} to `deck`, producing the same
 * deck state as executing the original command did.
 *
 * This helper is intentionally conservative:
 * - Only `deck.*` and select `slide.*` patches are fully replayable from the
 *   patch payload alone (they carry the new field values in `deckFields` /
 *   `slideFields`).
 * - Element patches (`element.*`) carry only affected ids; to replay them the
 *   caller needs the full command, not just the patch.  `applyPatch` returns
 *   `null` for ops it cannot reproduce from the patch payload alone.
 *
 * The return value is `null` when the patch cannot be applied (unsupported op,
 * missing payload, or slide not found). Callers should fall back to the full
 * command executor in that case.
 */
export function applyPatch(deck: Deck, patch: DeckPatch): Deck | null {
  switch (patch.op) {
    case "presentation.set_theme": {
      const theme = patch.deckFields?.design?.themeId;
      if (!theme) return null;
      return setPresentationTheme(deck, theme);
    }
    case "presentation.apply_theme_package": {
      const design = patch.deckFields?.design;
      const masters = patch.deckFields?.masters;
      const defaultMasterId = patch.deckFields?.defaultMasterId;
      const customTemplates = patch.deckFields?.customTemplates;
      if (!design || !masters || !defaultMasterId || !customTemplates) {
        return null;
      }
      let next = {
        ...deck,
        design: { ...((deck as any).design ?? {}), ...design },
        masters,
        defaultMasterId,
        customTemplates,
      } as Deck;
      if (patch.slideFields) {
        for (const [slideId, fields] of Object.entries(patch.slideFields)) {
          const index = next.slides.findIndex((slide) => slide.id === slideId);
          if (index === -1) return null;
          next = updateSlide(next, index, fields);
        }
      }
      return next;
    }
    case "presentation.update_theme_overrides": {
      if (patch.deckFields?.resetThemeOverrides) {
        return resetPresentationThemeOverrides(deck);
      }
      const themeOverrides = patch.deckFields?.design?.themeOverrides;
      if (!themeOverrides) return null;
      return {
        ...deck,
        design: { ...((deck as any).design ?? {}), themeOverrides },
      } as Deck;
    }
    case "canvas.set_format": {
      const format = patch.deckFields?.canvas?.format;
      if (!format) return null;
      return setDeckSlideFormat(deck, format);
    }
    case "master.create":
    case "master.update":
    case "master.delete":
    case "master.element.update": {
      const masters = patch.deckFields?.masters;
      if (!masters) return null;
      return { ...deck, masters } as Deck;
    }
    case "master.set_default": {
      const defaultMasterId = patch.deckFields?.defaultMasterId;
      if (!defaultMasterId) return null;
      return { ...deck, defaultMasterId } as Deck;
    }
    case "template.create_custom":
    case "template.update_custom":
    case "template.delete_custom": {
      const customTemplates = patch.deckFields?.customTemplates;
      if (!customTemplates) return null;
      return { ...deck, customTemplates } as Deck;
    }
    case "slide.update_title":
    case "slide.update_notes":
    case "slide.set_background":
    case "slide.set_background_gradient":
    case "slide.set_background_image":
    case "slide.set_background_asset":
    case "slide.set_accent":
    case "slide.update": {
      if (!patch.slideFields) return null;
      let next = deck;
      for (const [slideId, fields] of Object.entries(patch.slideFields)) {
        const index = next.slides.findIndex((s) => s.id === slideId);
        if (index === -1) return null;
        next = updateSlide(next, index, fields);
      }
      return next;
    }
    case "element.update":
    case "element.update_content":
    case "element.update_design_overrides":
    case "element.set_patches": {
      if (!patch.elementFields || patch.slideIds.length === 0) return null;
      const slideId = patch.slideIds[0]!;
      const index = deck.slides.findIndex((s) => s.id === slideId);
      if (index === -1) return null;
      return setElementPatches(deck, index, patch.elementFields);
    }
    default:
      // For add/remove/reorder/duplicate/group/arrange ops the patch does not
      // carry enough payload to reproduce the result; return null to signal
      // "use the full command executor instead".
      return null;
  }
}

// ---------------------------------------------------------------------------
// Issue #402 — Command history adapter (single shared commit path)
// ---------------------------------------------------------------------------

/**
 * Options passed to the upstream `onDeckChange` (history `commit`) function.
 * Mirrors the second argument of `useDeckHistory`'s `commit` helper.
 */
export interface CommitOptions {
  /**
   * When set, adjacent commits sharing this key are collapsed into one
   * undo/redo step (gesture coalescing for drag, resize, text edits, nudge).
   */
  coalesceKey?: string;
}

/**
 * The return value of {@link commitCommand}: the command result plus the
 * extracted commit options ready to pass to `onDeckChange` / `commit`.
 */
export interface CommitCommandResult {
  /**
   * The raw `CommandResult` from `executeCommand`. Inspect `result.ok` before
   * passing `result.deck` to the history commit function.
   */
  result: CommandResult;
  /**
   * Commit options extracted from the `CommandResult` for the upstream
   * `onDeckChange` call. Pass these as the second argument to `onDeckChange` /
   * `commit` for consistent gesture coalescing across all command paths.
   */
  commitOptions: CommitOptions | undefined;
  /**
   * All slide ids affected by this command. Convenience accessor over
   * `result.affectedSlideIds` for autosave staging.
   */
  affectedSlideIds: string[];
  /**
   * All element ids affected by this command. Convenience accessor over
   * `result.affectedElementIds` for autosave staging.
   */
  affectedElementIds: string[];
  /**
   * Serialisable patches emitted by the command, forwarded from
   * `result.patches`. The persistence epic (#376) can consume these directly.
   */
  patches: DeckPatch[];
}

/**
 * The single shared commit path for all command-based editor handlers
 * (issue #402).
 *
 * Wraps {@link executeCommand} and extracts the commit options (coalesce key,
 * affected ids, patches) into a structured {@link CommitCommandResult} so
 * every UI handler can follow the same pattern:
 *
 * ```ts
 * const { result, commitOptions } = commitCommand(deck, cmd);
 * if (result.ok) onDeckChange(result.deck, commitOptions);
 * ```
 *
 * This function:
 *  - Routes the coalesce key from the `CommandResult` historyKey to the
 *    `commitOptions.coalesceKey` so undo/redo coalescing stays consistent.
 *  - Exposes `affectedSlideIds` and `affectedElementIds` as top-level fields
 *    so autosave staging can consume them without digging into `result`.
 *  - Forwards `patches` from the command result so the persistence layer can
 *    eventually consume granular patch payloads without re-auditing every
 *    UI handler.
 *
 * Analytics/audit hooks should subscribe to `commitOptions` and `patches`
 * in one place rather than instrumenting individual UI controls.
 */
export function commitCommand(
  deck: Deck,
  cmd: SlideCommand,
): CommitCommandResult {
  const result = executeCommand(deck, cmd);
  const commitOptions: CommitOptions | undefined =
    result.historyKey !== undefined
      ? { coalesceKey: result.historyKey }
      : undefined;
  return {
    result,
    commitOptions,
    affectedSlideIds: result.affectedSlideIds,
    affectedElementIds: result.affectedElementIds,
    patches: result.patches,
  };
}
