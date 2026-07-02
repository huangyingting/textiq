/**
 * Document-to-deck source reference model (#475).
 *
 * Centralizes the dependency model for how slides reference document visuals
 * and source blocks. Previously this logic was scattered across:
 *  - `stripOrphanedVisuals` — removes missing visual references from the deck.
 *  - `source-link-staleness.ts` — detects stale source-linked elements.
 *  - `anchor-resolver.ts` — resolves individual block/visual/slide refs.
 *  - `restoreDocumentVersion` — sanitizes restored decks + reconciles.
 *
 * This module provides:
 *  1. A typed `DocumentDeckDependency` that explicitly describes every reference
 *     from a deck slide to a document block or visual.
 *  2. `enumerateDeckDependencies(deck)` — returns ALL deck→document references.
 *  3. `checkDependencyHealth(deck, freshBlocks)` — classifies each dependency
 *     as "found", "stale", "missing", or "invalid" using the shared anchor
 *     resolver vocabulary.
 *  4. `reconcileDeckVisuals(deck, knownVisualIds)` — delegates to
 *     `stripOrphanedVisuals`, providing one canonical reconcile call-site.
 *  5. `collectDeckVisualIds(deck)` — enumerates all visual ids the deck references.
 *
 * All helpers are pure (no DB, no React) so they can run in server actions,
 * tests, and the browser without adaptation.
 */

import type { Deck, SlideElement, SourceRef } from "@/lib/document/deck-model";
import type { DocumentBlock } from "@/lib/content";
import { stripOrphanedVisuals } from "@/lib/document/strip-orphans";
import { resolveVisualRef, resolveSourceRef } from "@/lib/anchor-resolver";
import type { AnchorResolution } from "@/lib/anchor-resolver";

export type { AnchorResolution };

// ---------------------------------------------------------------------------
// Dependency types
// ---------------------------------------------------------------------------

/**
 * A single reference from a deck slide element to a document block or visual.
 */
export type DocumentDeckDependency =
  | {
      /** Reference via a `VisualElement.visualId`. */
      kind: "visual";
      slideId: string;
      elementId: string;
      visualId: string;
    }
  | {
      /**
       * Reference via a `SourceRef` on any slide element (text, visual, or
       * table block linked from the document).
       */
      kind: "source_ref";
      slideId: string;
      elementId: string;
      blockId: string;
      blockKind: SourceRef["blockKind"];
      source: SourceRef;
    };

// ---------------------------------------------------------------------------
// Dependency enumeration
// ---------------------------------------------------------------------------

/**
 * Returns every deck→document dependency: visual element references and
 * source-linked elements. The result is the complete graph of what the deck
 * depends on from the document.
 *
 * Callers can use this as the canonical input to `checkDependencyHealth`
 * and `reconcileDeckVisuals` so all consistency-maintenance paths start from
 * the same enumeration.
 */
export function enumerateDeckDependencies(
  deck: Deck,
): DocumentDeckDependency[] {
  const deps: DocumentDeckDependency[] = [];

  for (const slide of deck.slides) {
    if (slide.elements) {
      for (const element of slide.elements) {
        if (element.kind === "visual") {
          const visualId = element.content.visualId;
          deps.push({
            kind: "visual",
            slideId: slide.id,
            elementId: element.id,
            visualId,
          });
        }

        // Source-ref dependency (present on any element kind).
        const ref = (element as SlideElement & { source?: SourceRef }).source;
        if (
          ref !== undefined &&
          ref.unlinked !== true &&
          ref.blockId !== undefined
        ) {
          const blockKind = ref.blockKind;
          deps.push({
            kind: "source_ref",
            slideId: slide.id,
            elementId: element.id,
            blockId: ref.blockId,
            blockKind,
            source: ref,
          });
        }
      }
    }
  }

  return deps;
}

// ---------------------------------------------------------------------------
// Dependency health check
// ---------------------------------------------------------------------------

/* node:coverage disable */
/* Dependency health DTO type is erased at runtime. */
/** Health status of a single dependency. */
export type DependencyHealth = {
  dependency: DocumentDeckDependency;
  /** Resolution result from the anchor resolver. */
  resolution: AnchorResolution<DocumentBlock>;
};
/* node:coverage enable */

/**
 * Classifies every deck→document dependency against the current document
 * state. Returns one `DependencyHealth` entry per dependency.
 *
 * Callers can filter by `resolution.status`:
 *  - `"found"` — dependency is satisfied.
 *  - `"stale"` — found but content hash doesn't match.
 *  - `"missing"` — block or visual no longer exists in the document.
 *  - `"invalid"` — dependency descriptor itself is malformed.
 *
 * @param deck         The deck to inspect.
 * @param freshBlocks  Output of `collectDocumentBlocks` from the current
 *                     document state (or `collectVisualNodes` mapped to
 *                     `DocumentBlock` form).
 */
export function checkDependencyHealth(
  deck: Deck,
  freshBlocks: readonly DocumentBlock[],
): DependencyHealth[] {
  const deps = enumerateDeckDependencies(deck);
  return deps.map((dep) => {
    let resolution: AnchorResolution<DocumentBlock>;

    switch (dep.kind) {
      case "visual":
        resolution = resolveVisualRef(dep.visualId, freshBlocks);
        break;
      case "source_ref":
        resolution = resolveSourceRef(dep.source, freshBlocks);
        break;
    }

    return { dependency: dep, resolution };
  });
}

// ---------------------------------------------------------------------------
// Reconciliation helpers
// ---------------------------------------------------------------------------

/**
 * Returns a copy of `deck` with all orphaned visual references removed.
 *
 * This is the canonical reconcile entry point for all paths that need to
 * ensure the deck does not reference visuals that no longer exist:
 *  - Version restore sanitization.
 *  - Post-mirror deck reconciliation.
 *  - Duplicate/derive operations.
 *
 * Delegates to `stripOrphanedVisuals` so the stripping logic stays in one
 * place; callers that were calling `stripOrphanedVisuals` directly may continue
 * doing so — this function provides a stable name in the dependency model.
 *
 * @param deck            The deck to sanitize.
 * @param knownVisualIds  Set of visual ids that currently exist in the document.
 */
export function reconcileDeckVisuals(
  deck: Deck,
  knownVisualIds: ReadonlySet<string>,
): Deck {
  return stripOrphanedVisuals(deck, knownVisualIds);
}

// ---------------------------------------------------------------------------
// Canonical deck reconciliation
// ---------------------------------------------------------------------------

/** Reconciliation status of a single deck→document dependency. */
export type ReconciledDependencyStatus =
  | "found"
  | "stale"
  | "missing"
  | "invalid";

/** A single dependency together with its reconciliation outcome. */
export interface ReconciledDependency {
  dependency: DocumentDeckDependency;
  status: ReconciledDependencyStatus;
  /** True when this reference was removed from the reconciled deck. */
  removed: boolean;
  reason?: string;
}

/** Per-status counts plus the number of references removed from the deck. */
export interface ReconciliationCounts {
  found: number;
  stale: number;
  missing: number;
  invalid: number;
  removed: number;
}

export interface ReconcileDeckDependenciesInput {
  /** The deck to reconcile. */
  deck: Deck;
  /**
   * The set of visual ids that currently exist in the document
   * (anchor/visual ids). When omitted it is derived from `freshBlocks`.
   */
  visualsById?: ReadonlySet<string>;
  /**
   * Current document blocks. When provided, enables `source_ref` staleness
   * classification via the shared anchor resolver; also supplies the known
   * visual id set when `visualsById` is omitted.
   */
  sourceRefs?: readonly DocumentBlock[];
}

export interface DeckReconciliationResult {
  /** Reconciled deck: orphaned/invalid visual references stripped. */
  deck: Deck;
  /** True when the reconciled deck differs from the input deck. */
  changed: boolean;
  counts: ReconciliationCounts;
  /** One entry per enumerated dependency, in enumeration order. */
  dependencies: ReconciledDependency[];
}

function narrowStatus(status: AnchorResolution["status"]): {
  status: ReconciledDependencyStatus;
} {
  switch (status) {
    case "found":
    case "stale":
    case "missing":
    case "invalid":
      return { status };
    default:
      // ambiguous / unknown / unauthorized are not produced by the visual or
      // source-ref resolvers used here; classify defensively as invalid.
      return { status: "invalid" };
  }
}

/**
 * Canonical entry point for deck↔document dependency reconciliation (#503).
 *
 * Classifies every deck visual reference and active `sourceRef` as
 * `found` | `stale` | `missing` | `invalid`, then produces a reconciled deck
 * applying the established product rules:
 *  - **Missing / invalid visual references are stripped** (delegates to
 *    {@link reconcileDeckVisuals} / `stripOrphanedVisuals`) so a public render
 *    never shows a silently blank slide for a visual that no longer exists.
 *  - **Stale source links are surfaced, NOT auto-deleted** — they remain in the
 *    returned deck and are reported via `counts.stale` so callers can flag them.
 *
 * The reconciled deck is byte-equivalent to the prior `stripOrphanedVisuals`
 * output, so routing existing call sites through here preserves externally
 * observable behavior while giving every path one shared vocabulary + counts.
 *
 * Pure: no DB, no React.
 */
export function reconcileDocumentDeckDependencies(
  input: ReconcileDeckDependenciesInput,
): DeckReconciliationResult {
  const { deck, sourceRefs } = input;
  const knownVisualIds: ReadonlySet<string> =
    input.visualsById ??
    new Set(
      (sourceRefs ?? [])
        .filter(
          (b): b is Extract<DocumentBlock, { kind: "visual" }> =>
            b.kind === "visual",
        )
        .map((b) => b.visualId),
    );

  const dependencies: ReconciledDependency[] = [];
  const counts: ReconciliationCounts = {
    found: 0,
    stale: 0,
    missing: 0,
    invalid: 0,
    removed: 0,
  };

  for (const dependency of enumerateDeckDependencies(deck)) {
    let status: ReconciledDependencyStatus;
    let reason: string | undefined;
    let removed = false;

    if (dependency.kind === "visual") {
      if (dependency.visualId.trim().length === 0) {
        status = "invalid";
        reason = "Visual id is empty.";
      } else if (knownVisualIds.has(dependency.visualId)) {
        status = "found";
      } else {
        status = "missing";
        reason = `Visual ${dependency.visualId} was not found.`;
      }
      // Missing/invalid visual refs are stripped from the reconciled deck.
      removed = status !== "found";
    } else {
      // source_ref: classifiable only against fresh document blocks. Without
      // them we cannot detect staleness, so treat as found (link preserved).
      if (sourceRefs) {
        const resolution = resolveSourceRef(dependency.source, sourceRefs);
        status = narrowStatus(resolution.status).status;
        reason = resolution.reason;
      } else {
        status = "found";
      }
      // Stale/missing source links are surfaced, never auto-deleted.
      removed = false;
    }

    counts[status] += 1;
    if (removed) counts.removed += 1;
    dependencies.push({
      dependency,
      status,
      removed,
      ...(reason ? { reason } : {}),
    });
  }

  const reconciledDeck = reconcileDeckVisuals(deck, knownVisualIds);
  const changed = counts.removed > 0;

  return { deck: reconciledDeck, changed, counts, dependencies };
}

/**
 * Collects every visual id the deck references from visual element content.
 *
 * Useful as a quick way to build the "what does this deck need?" set for
 * orphan detection or dependency checks without running a full
 * `enumerateDeckDependencies` pass.
 */
export function collectDeckVisualIds(deck: Deck): Set<string> {
  const ids = new Set<string>();
  for (const slide of deck.slides) {
    if (slide.elements) {
      for (const element of slide.elements) {
        if (element.kind === "visual") {
          const visualId = element.content.visualId;
          if (visualId) ids.add(visualId);
        }
      }
    }
  }
  return ids;
}
