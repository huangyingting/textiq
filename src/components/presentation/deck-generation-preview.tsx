"use client";

/**
 * presentation deck generation preview surface.
 *
 * Reviews a generated `Deck` proposal. Thumbnails are rendered via
 * `SlideCanvas` without any v6 materialisation.
 *
 * The AI-generated presentation deck is reviewed in this panel before it is applied to
 * the editor. A diff summary against the baseline deck (count of added /
 * changed / unchanged slides) is displayed for each thumbnail.
 *
 * Actions:
 *   - Apply  — hand the proposal to the parent (opens the presentation editor)
 *   - Regenerate — re-invoke AI generation, replacing the proposal once ready
 *   - Use derived deck — discard and fall back to the baseline
 *   - Cancel — dismiss without changes
 */

import { RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui";
import { Dialog } from "@/components/ui";
import { DeckDiagnosticsReview } from "@/components/presentation/deck-diagnostics-review";
import { GeneratingIndicator } from "@/components/motion/generation-status";
import { dedupePresentationDiagnostics } from "@/lib/presentation/diagnostic-handoff";
import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import type { Deck } from "@/lib/presentation/schema";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import { NEUTRAL_THEME_PACKAGE } from "@/lib/presentation/neutral-theme-package";
import {
  useDeckGeneration,
  type DeckGenerationOptions,
} from "@/lib/ai/use-deck-generation";
import { useDeckRenderTree } from "./use-deck-render-tree";
import { SlideCanvas } from "./slide-canvas";

// ---------------------------------------------------------------------------
// Diff types (simplified — counts only)
// ---------------------------------------------------------------------------

type DiffStatus = "added" | "changed" | "unchanged";

interface SlideDiffEntry {
  index: number;
  status: DiffStatus;
}

type SlideFingerprint = string;

function buildSlideFingerprintMap(
  slides: Deck["slides"],
  stringifySlide: (slide: Deck["slides"][number]) => SlideFingerprint,
) {
  const fingerprints = new Map<string, SlideFingerprint>();
  for (const slide of slides) {
    if (!fingerprints.has(slide.id)) {
      fingerprints.set(slide.id, stringifySlide(slide));
    }
  }
  return fingerprints;
}

export function diffDecks(
  baseline: Deck,
  proposal: Deck,
  options: {
    stringifySlide?: (slide: Deck["slides"][number]) => SlideFingerprint;
  } = {},
): {
  entries: SlideDiffEntry[];
  summary: string;
  added: number;
  changed: number;
} {
  const stringifySlide = options.stringifySlide ?? JSON.stringify;
  const baselineFingerprints = buildSlideFingerprintMap(
    baseline.slides,
    stringifySlide,
  );
  let added = 0;
  let changed = 0;

  const entries: SlideDiffEntry[] = proposal.slides.map((slide, index) => {
    const baselineFingerprint = baselineFingerprints.get(slide.id);
    if (baselineFingerprint === undefined) {
      added++;
      return { index, status: "added" };
    }

    if (baselineFingerprint !== stringifySlide(slide)) {
      changed++;
      return { index, status: "changed" };
    }
    return { index, status: "unchanged" };
  });

  const total = proposal.slides.length;
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} new`);
  if (changed > 0) parts.push(`${changed} changed`);
  const unchanged = total - added - changed;
  if (unchanged > 0) parts.push(`${unchanged} unchanged`);
  const summary = `${total} slide${total === 1 ? "" : "s"} — ${parts.join(", ")}`;

  return { entries, summary, added, changed };
}

// ---------------------------------------------------------------------------
// Marker styles
// ---------------------------------------------------------------------------

const MARKER_LABEL: Record<DiffStatus, string> = {
  added: "New",
  changed: "Changed",
  unchanged: "Same",
};

const MARKER_CLASS: Record<DiffStatus, string> = {
  added: "bg-ds-success-surface text-ds-success-text",
  changed: "bg-ds-warning-surface text-ds-warning-text",
  unchanged: "bg-ds-surface-raised text-ds-text-muted",
};

export interface DeckGenerationDiagnosticsNoticeProps {
  diagnosticsCount: number;
  isRegenerating: boolean;
  onReview: () => void;
}

export function DeckGenerationDiagnosticsNotice({
  diagnosticsCount,
  isRegenerating,
  onReview,
}: DeckGenerationDiagnosticsNoticeProps) {
  if (diagnosticsCount <= 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-ds-md border border-ds-warning-border bg-ds-warning-surface px-3 py-2 text-xs text-ds-warning-text">
      <p>
        AI generation reported {diagnosticsCount} diagnostic
        {diagnosticsCount === 1 ? "" : "s"}.
      </p>
      <Button
        variant="plain"
        size="sm"
        onClick={onReview}
        disabled={isRegenerating}
      >
        Review AI diagnostics ({diagnosticsCount})
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DeckGenerationPreviewProps {
  /** The AI-generated presentation deck under review. */
  proposedDeck: Deck;
  /** The deck the editor would otherwise open — the diff baseline. */
  baselineDeck: Deck;
  /** Theme package for thumbnail rendering. Defaults to neutral. */
  themePackage?: ThemePackageV1 | null;
  /** Whether the source outline was trimmed to fit the input budget. */
  truncated: boolean;
  /** AI repair/compile diagnostics to review before apply. */
  generationDiagnostics: PresentationDiagnostic[];
  /** Serialised document content — re-sent verbatim on Regenerate. */
  contentJson: string;
  /** Generation options — re-sent verbatim on Regenerate. */
  options: DeckGenerationOptions;
  /** Apply the current proposal: parent opens the presentation editor with it. */
  onApply: (deck: Deck, diagnostics: PresentationDiagnostic[]) => void;
  /** Discard the proposal and fall back to the baseline. */
  onDerive: () => void;
  /** Dismiss without opening anything. */
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DeckGenerationPreview({
  proposedDeck,
  baselineDeck,
  themePackage,
  truncated,
  generationDiagnostics,
  contentJson,
  options,
  onApply,
  onDerive,
  onCancel,
}: DeckGenerationPreviewProps) {
  const titleId = useId();
  const pkg = themePackage ?? NEUTRAL_THEME_PACKAGE;

  const [proposal, setProposal] = useState<Deck>(proposedDeck);
  const [diagnostics, setDiagnostics] = useState<PresentationDiagnostic[]>(() =>
    dedupePresentationDiagnostics(generationDiagnostics),
  );
  const isTruncated = truncated;
  const [regenError, setRegenError] = useState(false);
  const [diagnosticsReviewOpen, setDiagnosticsReviewOpen] = useState(false);

  const { generate, status, reset } = useDeckGeneration();
  const isRegenerating = status === "loading";

  useEffect(() => reset, [reset]);

  const diff = useMemo(
    () => diffDecks(baselineDeck, proposal),
    [baselineDeck, proposal],
  );

  const renderTree = useDeckRenderTree(proposal, pkg);

  const handleRegenerate = async () => {
    setRegenError(false);
    const result = await generate(contentJson, options);
    if (result.ok) {
      setProposal(result.deck);
      setDiagnostics(dedupePresentationDiagnostics(result.diagnostics));
      setDiagnosticsReviewOpen(false);
    } else {
      setRegenError(true);
    }
  };

  const canvasAspectRatio =
    renderTree && renderTree.canvas.width > 0 && renderTree.canvas.height > 0
      ? renderTree.canvas.width / renderTree.canvas.height
      : 16 / 9;

  return (
    <Dialog
      open
      onClose={onCancel}
      aria-labelledby={titleId}
      aria-busy={isRegenerating}
      className="flex max-h-[calc(100vh-2rem)] w-[44rem] max-w-[calc(100vw-2rem)] flex-col gap-4 border-ds-border-subtle bg-ds-surface-overlay p-5 shadow-ds-popover"
    >
      <div className="flex items-start gap-2">
        <Sparkles
          size={18}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-ds-accent-text"
        />
        <div className="flex flex-col gap-1">
          <h2
            id={titleId}
            className="text-base font-semibold text-ds-text-primary"
          >
            Review AI slides
          </h2>
          <p className="text-sm text-ds-text-secondary" aria-live="polite">
            {diff.summary}
          </p>
        </div>
      </div>

      {isTruncated ? (
        <p
          role="note"
          className="rounded-ds-md border border-ds-warning-border bg-ds-warning-surface px-3 py-2 text-xs text-ds-warning-text"
        >
          Your document was long, so some content was trimmed. The deck covers
          the most important sections.
        </p>
      ) : null}

      {regenError ? (
        <p
          role="alert"
          className="rounded-ds-md border border-ds-danger-border bg-ds-danger-surface px-3 py-2 text-xs text-ds-danger-text"
        >
          Couldn&apos;t regenerate just now — showing the previous draft. Try
          again, or use the derived deck instead.
        </p>
      ) : null}

      <DeckGenerationDiagnosticsNotice
        diagnosticsCount={diagnostics.length}
        isRegenerating={isRegenerating}
        onReview={() => setDiagnosticsReviewOpen(true)}
      />

      <div className="relative min-h-0 flex-1 overflow-y-auto rounded-ds-md border border-ds-border-subtle bg-ds-surface-raised p-3">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {(renderTree?.slides ?? []).map((slideTree, index) => {
            const entry = diff.entries[index];
            const marker = entry?.status ?? "unchanged";
            return (
              <li key={slideTree.id} className="flex flex-col gap-1">
                <span
                  className="relative block overflow-hidden rounded-ds-sm border border-ds-border-subtle"
                  style={{ aspectRatio: canvasAspectRatio }}
                >
                  <SlideCanvas
                    slide={slideTree}
                    canvas={renderTree?.canvas}
                    preview
                  />
                  <span
                    className={`absolute right-1 top-1 rounded-ds-sm px-1.5 py-0.5 text-[0.625rem] font-medium ${MARKER_CLASS[marker]}`}
                    aria-label={`${MARKER_LABEL[marker]}: Slide ${index + 1}`}
                  >
                    {MARKER_LABEL[marker]}
                  </span>
                </span>
                <span className="flex items-baseline gap-1.5 px-0.5">
                  <span className="text-xs tabular-nums text-ds-text-muted">
                    {index + 1}
                  </span>
                  <span className="truncate text-xs text-ds-text-secondary">
                    Slide {index + 1}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        {isRegenerating ? (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ds-surface-overlay/70"
          >
            <GeneratingIndicator isLoading className="text-center" />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="plain"
          size="md"
          onClick={onCancel}
          disabled={isRegenerating}
        >
          Cancel
        </Button>
        <Button
          variant="subtle"
          size="md"
          onClick={onDerive}
          disabled={isRegenerating}
        >
          Use derived deck instead
        </Button>
        <Button
          variant="subtle"
          size="md"
          onClick={handleRegenerate}
          disabled={isRegenerating}
        >
          <RefreshCw size={15} aria-hidden="true" />
          {isRegenerating ? "Regenerating…" : "Regenerate"}
        </Button>
        <Button
          variant="solid"
          size="md"
          onClick={() => onApply(proposal, diagnostics)}
          disabled={isRegenerating}
        >
          <Sparkles size={15} aria-hidden="true" />
          Apply
        </Button>
      </div>
      {diagnosticsReviewOpen ? (
        <DeckDiagnosticsReview
          diagnostics={diagnostics}
          onClose={() => setDiagnosticsReviewOpen(false)}
          onNavigate={() => undefined}
          onAction={() => undefined}
        />
      ) : null}
    </Dialog>
  );
}
