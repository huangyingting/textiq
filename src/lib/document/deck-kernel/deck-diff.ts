/**
 * Pure, DOM-free deck diff used by the AI deck preview (issue #269).
 *
 * {@link diffDecks} compares a `proposed` deck (e.g. a freshly generated AI
 * deck) against a `baseline` deck (the freshest deck the editor would otherwise
 * open — from `pickFreshestDeck` / `buildDeckFromBlocks`) and reports, per
 * proposed slide, whether it is `added`, `changed`, or `unchanged`, plus which
 * baseline slides were `removed` (have no proposed counterpart).
 *
 * Slides are matched first by normalized effective title (so a reordered slide
 * stays matched to its counterpart regardless of position) and then positionally
 * by index for title-less slides. This mirrors how `deck-merge` keys slides via
 * {@link slideEffectiveTitle} + {@link normalizeTitle}, so the displayed diff and
 * a later sync never disagree about identity.
 *
 * The function is fully immutable — neither input deck nor its slides are
 * mutated — so it is safe to run while the proposal is still on screen. No
 * React, no DOM: unit-tested under `node --test`.
 */

import type { Deck, Slide } from "./deck-core";
import { normalizeTextParagraphs } from "./deck-elements";
import { normalizeTitle } from "./deck-hash";
import { slideEffectiveTitle } from "./slide-title";

/** Per-slide diff marker against the baseline deck. */
export type DeckDiffStatus = "added" | "changed" | "unchanged" | "removed";

/** A single slide marker in the diff, in proposed (or, for removed, baseline) order. */
export interface DeckDiffEntry {
  /** Index in the proposed deck, or `-1` for a removed baseline slide. */
  proposedIndex: number;
  /** Index in the baseline deck, or `-1` for an added proposed slide. */
  baselineIndex: number;
  status: DeckDiffStatus;
  /** Effective (or positional) title for display. */
  title: string;
}

/** Result of {@link diffDecks}: counts, per-slide markers, and a summary string. */
export interface DeckDiff {
  /** Proposed slides with no baseline match. */
  added: number;
  /** Matched proposed slides whose content differs from the baseline. */
  changed: number;
  /** Baseline slides with no proposed match. */
  removed: number;
  /** Matched proposed slides whose content is identical to the baseline. */
  unchanged: number;
  /** Total proposed slide count (convenience for the "N slides" lead-in). */
  proposedCount: number;
  /**
   * Per-proposed-slide markers, in proposed order, followed by per-removed
   * baseline-slide markers (in baseline order). Lets the preview annotate each
   * proposed thumbnail and still list what dropped out.
   */
  entries: DeckDiffEntry[];
  /** Human-readable summary, e.g. `"12 slides — 8 new, 3 changed, 1 removed"`. */
  summary: string;
}

/** Positional fallback title so title-less slides still read sensibly. */
function displayTitle(slide: Slide, index: number): string {
  const effective = slideEffectiveTitle(slide);
  return effective !== "" ? effective : `Slide ${index + 1}`;
}

function elementContent(element: any): Record<string, any> {
  return (element?.content ?? {}) as Record<string, any>;
}

function elementRole(element: any): string | undefined {
  return element?.role;
}

function slideBullets(slide: Slide): string[] {
  const bullet = (slide.elements ?? []).find(
    (element) => element.kind === "text" && elementRole(element) === "bullet",
  );
  return (elementContent(bullet).paragraphs ?? []).map(
    (paragraph: any) => paragraph.text ?? "",
  );
}

function slideVisualIds(slide: Slide): string[] {
  return (slide.elements ?? [])
    .filter((element) => element.kind === "visual")
    .map((element) => elementContent(element).visualId)
    .filter((visualId): visualId is string => typeof visualId === "string");
}

function slideTableSignatures(slide: Slide): string[] {
  return (slide.elements ?? [])
    .filter((element) => element.kind === "table")
    .map((element) => {
      const columns = element.content.columns
        .map((column) => column.label.trim())
        .join("\u0001");
      const rows = element.content.rows
        .map((row) =>
          row.cells
            .map((cell) =>
              JSON.stringify({
                text: cell.text.trim(),
                runs: cell.runs ?? [],
              }),
            )
            .join("\u0001"),
        )
        .join("\u0002");
      return [
        element.content.header ? "header" : "body",
        element.content.caption?.trim() ?? "",
        columns,
        rows,
      ].join("\u0001");
    });
}

/**
 * A content fingerprint capturing v6 slide metadata and authoritative
 * `elements[]`. Used only to decide `changed` vs `unchanged` for an
 * already-matched pair.
 */
function contentSignature(slide: Slide): string {
  const parts: string[] = [
    `t:${normalizeTitle(slideEffectiveTitle(slide))}`,
    `l:${(slide as any).templateId ?? "blank"}`,
    `b:${slideBullets(slide)
      .map((bullet) => bullet.trim())
      .join("\u0001")}`,
    `v:${slideVisualIds(slide).sort().join("\u0001")}`,
    `tb:${slideTableSignatures(slide).join("\u0001")}`,
    `n:${(slide.notes ?? "").trim()}`,
  ];

  const elements = slide.elements ?? [];
  for (const element of elements) {
    if (element.kind === "text") {
      const text = normalizeTextParagraphs(element)
        .map((paragraph) => paragraph.text.trim())
        .join("\u0001");
      parts.push(`et:${elementRole(element) ?? ""}:${text}`);
    } else if (element.kind === "visual") {
      parts.push(`ev:${elementContent(element).visualId}`);
    } else if (element.kind === "image") {
      parts.push(`ei:${(elementContent(element).src ?? "").trim()}`);
    } else if (element.kind === "shape") {
      const content = elementContent(element);
      const design = ((element as any).designOverrides ?? {}) as Record<
        string,
        any
      >;
      parts.push(
        `es:${content.shape}:${design.fill?.value ?? ""}:${content.text?.trim() ?? ""}`,
      );
    } else if (element.kind === "table") {
      parts.push(
        `etb:${slideTableSignatures({ ...slide, elements: [element] }).join("\u0001")}`,
      );
    }
  }

  return parts.join("\u0002");
}

/**
 * Diff `proposed` against `baseline`.
 *
 * Matching: a proposed slide is paired with a baseline slide that shares its
 * non-empty normalized effective title (each baseline slide is consumed at most
 * once, earliest first). Remaining proposed slides are paired positionally with
 * any still-unmatched baseline slide at the same index (covers title-less and
 * untitled slides). Unmatched proposed slides are `added`; unmatched baseline
 * slides are `removed`. A matched pair is `changed` when its content
 * fingerprint differs, else `unchanged`.
 *
 * Pure and immutable: inputs are never mutated.
 */
export function diffDecks(baseline: Deck, proposed: Deck): DeckDiff {
  const baselineSlides = baseline.slides;
  const proposedSlides = proposed.slides;

  // Title pool: normalized non-empty title → queue of baseline indices.
  const titlePool = new Map<string, number[]>();
  baselineSlides.forEach((slide, index) => {
    const key = normalizeTitle(slideEffectiveTitle(slide));
    if (key === "") return;
    const bucket = titlePool.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      titlePool.set(key, [index]);
    }
  });

  const matchedBaseline = new Set<number>();
  // proposedIndex → baselineIndex (or undefined if unmatched yet).
  const matchOf = new Array<number>(proposedSlides.length).fill(-1);

  // Pass 1: match by normalized title.
  proposedSlides.forEach((slide, index) => {
    const key = normalizeTitle(slideEffectiveTitle(slide));
    if (key === "") return;
    const bucket = titlePool.get(key);
    if (bucket && bucket.length > 0) {
      const baselineIndex = bucket.shift() as number;
      matchOf[index] = baselineIndex;
      matchedBaseline.add(baselineIndex);
    }
  });

  // Pass 2: positionally match still-unmatched proposed slides to the
  // still-unmatched baseline slide at the same index.
  proposedSlides.forEach((_slide, index) => {
    if (matchOf[index] !== -1) return;
    if (index >= baselineSlides.length) return;
    if (matchedBaseline.has(index)) return;
    // Only positionally match when the baseline slide is still available AND was
    // not skipped because it had a title that simply didn't match (a titled
    // baseline slide that found no proposed match is a genuine removal, not a
    // positional re-pairing target).
    const baselineKey = normalizeTitle(
      slideEffectiveTitle(baselineSlides[index]),
    );
    const proposedKey = normalizeTitle(
      slideEffectiveTitle(proposedSlides[index]),
    );
    if (baselineKey !== "" || proposedKey !== "") return;
    matchOf[index] = index;
    matchedBaseline.add(index);
  });

  const entries: DeckDiffEntry[] = [];
  let added = 0;
  let changed = 0;
  let unchanged = 0;

  proposedSlides.forEach((slide, index) => {
    const baselineIndex = matchOf[index];
    if (baselineIndex === -1) {
      added += 1;
      entries.push({
        proposedIndex: index,
        baselineIndex: -1,
        status: "added",
        title: displayTitle(slide, index),
      });
      return;
    }
    const isChanged =
      contentSignature(slide) !==
      contentSignature(baselineSlides[baselineIndex]);
    if (isChanged) {
      changed += 1;
    } else {
      unchanged += 1;
    }
    entries.push({
      proposedIndex: index,
      baselineIndex,
      status: isChanged ? "changed" : "unchanged",
      title: displayTitle(slide, index),
    });
  });

  let removed = 0;
  baselineSlides.forEach((slide, index) => {
    if (matchedBaseline.has(index)) return;
    removed += 1;
    entries.push({
      proposedIndex: -1,
      baselineIndex: index,
      status: "removed",
      title: displayTitle(slide, index),
    });
  });

  return {
    added,
    changed,
    removed,
    unchanged,
    proposedCount: proposedSlides.length,
    entries,
    summary: buildSummary(proposedSlides.length, added, changed, removed),
  };
}

/** Builds the compact "N slides — 8 new, 3 changed, 1 removed" summary line. */
function buildSummary(
  proposedCount: number,
  added: number,
  changed: number,
  removed: number,
): string {
  const slideLabel = `${proposedCount} ${proposedCount === 1 ? "slide" : "slides"}`;
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} new`);
  if (changed > 0) parts.push(`${changed} changed`);
  if (removed > 0) parts.push(`${removed} removed`);
  if (parts.length === 0) {
    return `${slideLabel} — no changes from current`;
  }
  return `${slideLabel} — ${parts.join(", ")}`;
}
