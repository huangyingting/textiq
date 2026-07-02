"use client";

import type { JSX } from "react";

import {
  findSourceBlock,
  type SourceBlockIndexEntry,
} from "@/lib/presentation/block-index";
import type { SourceReviewItem } from "@/lib/presentation/source-links";
import {
  sourceReviewActionDescriptor,
  type SourceReviewActionType,
} from "@/lib/presentation/review-action-descriptors";

export interface SourceReviewPanelProps {
  items: readonly SourceReviewItem[];
  sourceBlocks: readonly SourceBlockIndexEntry[];
  onSelect: (slideId: string, nodeId: string) => void;
  onRefresh: (slideId: string, nodeId: string) => void;
  onUnlink: (slideId: string, nodeId: string) => void;
  onRelink: (
    slideId: string,
    nodeId: string,
    block: SourceBlockIndexEntry,
  ) => void;
  onNavigateSource: (documentId: string, blockId: string) => void;
  onDismiss: (slideId: string, nodeId: string) => void;
  onRefreshAll: () => void;
  statusMessage?: string;
}

const STATE_LABEL: Record<SourceReviewItem["state"], string> = {
  fresh: "Fresh",
  stale: "Stale",
  orphan: "Orphaned",
  unknown: "Unknown",
  unlinked: "Unlinked",
};

function stateClass(state: SourceReviewItem["state"]): string {
  switch (state) {
    case "stale":
      return "bg-ds-status-warning-subtle text-ds-status-warning-text";
    case "orphan":
      return "bg-ds-status-error-subtle text-ds-status-error-text";
    case "unknown":
    case "unlinked":
      return "bg-ds-surface-2 text-ds-text-secondary";
    case "fresh":
      return "bg-ds-status-success-subtle text-ds-status-success-text";
  }
}

function sourceReviewItemContextLabel(item: SourceReviewItem): string {
  return `${item.slideLabel}, ${item.nodeName ?? item.nodeId}`;
}

function sourceBlockExcerpt(block: SourceBlockIndexEntry): string {
  const { refresh } = block;
  if (refresh.kind === "text") return refresh.text;
  if (refresh.kind === "table") {
    return [
      refresh.caption,
      ...refresh.rows.flatMap((row) => row.cells.map((cell) => cell.text)),
    ]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(" ");
  }
  return refresh.alt ?? block.displayLabel;
}

function shortExcerpt(text: string, maxLength = 140): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function resolveSourceReviewBlock(
  item: SourceReviewItem,
  sourceBlocks: readonly SourceBlockIndexEntry[],
): SourceBlockIndexEntry | undefined {
  if (item.block) return item.block;
  const documentId =
    item.source.documentId ?? sourceBlocks[0]?.documentId ?? "unknown-document";
  return findSourceBlock({ documentId, blocks: sourceBlocks }, item.source);
}

export function sourceReviewActionAriaLabel(
  actionType: SourceReviewActionType,
  item: SourceReviewItem,
): string {
  const actionLabel = sourceReviewActionDescriptor(actionType, { item }).label;
  return `${actionLabel} for ${sourceReviewItemContextLabel(item)}`;
}

export function SourceReviewPanel({
  items,
  sourceBlocks,
  onSelect,
  onRefresh,
  onUnlink,
  onRelink,
  onNavigateSource,
  onDismiss,
  onRefreshAll,
  statusMessage,
}: SourceReviewPanelProps): JSX.Element | null {
  const relinkOptions = sourceBlocks;
  if (items.length === 0) return null;
  const staleCount = items.filter((item) => item.state === "stale").length;
  const refreshAllDescriptor = sourceReviewActionDescriptor(
    "refresh-all-safe-stale",
    { staleCount },
  );

  return (
    <section className="shrink-0 border-b border-ds-border-subtle bg-ds-surface px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-ds-text-muted">
            Source Review
          </h3>
          <p className="mt-0.5 text-xs text-ds-text-secondary">
            {items.length} source issue{items.length === 1 ? "" : "s"} across
            the deck
          </p>
        </div>
        <button
          type="button"
          disabled={Boolean(refreshAllDescriptor.disabledReason)}
          title={refreshAllDescriptor.disabledReason}
          onClick={onRefreshAll}
          className="rounded-ds-sm border border-ds-border-subtle px-2.5 py-1 text-xs font-medium text-ds-text-primary hover:bg-ds-state-hover disabled:opacity-40"
        >
          {refreshAllDescriptor.label}
        </button>
      </div>
      {statusMessage ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 rounded-ds-sm bg-ds-surface-raised px-2 py-1 text-xs text-ds-text-secondary"
        >
          {statusMessage}
        </p>
      ) : null}
      <div className="mt-2 max-h-44 overflow-auto rounded-ds-sm border border-ds-border-subtle">
        <table className="min-w-full text-left text-xs">
          <thead className="sticky top-0 bg-ds-surface-raised text-ds-text-muted">
            <tr>
              <th className="px-2 py-1 font-medium">Slide</th>
              <th className="px-2 py-1 font-medium">Node</th>
              <th className="px-2 py-1 font-medium">Source block</th>
              <th className="px-2 py-1 font-medium">State</th>
              <th className="px-2 py-1 font-medium">Reason</th>
              <th className="px-2 py-1 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ds-border-subtle">
            {items.map((item) => {
              const goDescriptor = sourceReviewActionDescriptor(
                "go-to-target",
                { item },
              );
              const refreshDescriptor = sourceReviewActionDescriptor(
                "refresh-source-link",
                { item },
              );
              const relinkDescriptor = sourceReviewActionDescriptor(
                "relink-source",
                { item, sourceBlockCount: relinkOptions.length },
              );
              const sourceDescriptor = sourceReviewActionDescriptor(
                "go-to-source",
                { item },
              );
              const unlinkDescriptor = sourceReviewActionDescriptor(
                "mark-source-unlinked",
                { item },
              );
              const dismissDescriptor = sourceReviewActionDescriptor(
                "dismiss-source-issue",
                { item },
              );
              const resolvedBlock = resolveSourceReviewBlock(
                item,
                sourceBlocks,
              );
              const sourceDocumentId =
                item.source.documentId ?? resolvedBlock?.documentId;
              const sourceBlockId = item.source.blockId ?? resolvedBlock?.id;
              const canNavigateSource = Boolean(
                resolvedBlock && sourceDocumentId && sourceBlockId,
              );
              const excerpt = resolvedBlock
                ? shortExcerpt(sourceBlockExcerpt(resolvedBlock))
                : "";
              return (
                <tr key={`${item.slideId}-${item.nodeId}`}>
                  <td className="px-2 py-1 text-ds-text-primary">
                    {item.slideLabel}
                  </td>
                  <td className="px-2 py-1 font-mono text-ds-text-secondary">
                    {item.nodeName ?? item.nodeId}
                  </td>
                  <td className="px-2 py-1 text-ds-text-secondary">
                    <span>{item.sourceLabel}</span>
                    <span className="ml-1 font-mono text-ds-text-muted">
                      {item.source.blockKind ?? item.block?.kind ?? "source"}:
                      {item.source.blockId ?? "unknown"}
                    </span>
                    <span
                      className={`mt-0.5 block max-w-[18rem] text-[11px] ${
                        resolvedBlock
                          ? "text-ds-text-primary"
                          : "text-ds-text-muted"
                      }`}
                    >
                      {resolvedBlock
                        ? excerpt || "Source block has no text excerpt."
                        : "Source block not found."}
                    </span>
                  </td>
                  <td className="px-2 py-1">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${stateClass(item.state)}`}
                    >
                      {STATE_LABEL[item.state]}
                    </span>
                  </td>
                  <td className="max-w-[14rem] px-2 py-1 text-ds-text-muted">
                    {item.reason}
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        aria-label={sourceReviewActionAriaLabel(
                          "go-to-target",
                          item,
                        )}
                        onClick={() => onSelect(item.slideId, item.nodeId)}
                        className="rounded-ds-sm border border-ds-border-subtle px-1.5 py-0.5 text-[11px] text-ds-text-secondary hover:bg-ds-state-hover"
                      >
                        {goDescriptor.shortLabel ?? goDescriptor.label}
                      </button>
                      <button
                        type="button"
                        aria-label={sourceReviewActionAriaLabel(
                          "go-to-source",
                          item,
                        )}
                        disabled={!canNavigateSource}
                        title={
                          canNavigateSource
                            ? undefined
                            : "Source block is missing from the current document."
                        }
                        onClick={() => {
                          if (!sourceDocumentId || !sourceBlockId) return;
                          onNavigateSource(sourceDocumentId, sourceBlockId);
                        }}
                        className="rounded-ds-sm border border-ds-border-subtle px-1.5 py-0.5 text-[11px] text-ds-text-secondary hover:bg-ds-state-hover disabled:opacity-40"
                      >
                        {sourceDescriptor.shortLabel ?? sourceDescriptor.label}
                      </button>
                      <button
                        type="button"
                        aria-label={sourceReviewActionAriaLabel(
                          "refresh-source-link",
                          item,
                        )}
                        disabled={Boolean(refreshDescriptor.disabledReason)}
                        title={refreshDescriptor.disabledReason}
                        onClick={() => onRefresh(item.slideId, item.nodeId)}
                        className="rounded-ds-sm border border-ds-border-subtle px-1.5 py-0.5 text-[11px] text-ds-text-secondary hover:bg-ds-state-hover disabled:opacity-40"
                      >
                        {refreshDescriptor.shortLabel ??
                          refreshDescriptor.label}
                      </button>
                      <select
                        aria-label={sourceReviewActionAriaLabel(
                          "relink-source",
                          item,
                        )}
                        defaultValue=""
                        disabled={Boolean(relinkDescriptor.disabledReason)}
                        title={relinkDescriptor.disabledReason}
                        onChange={(event) => {
                          const block = relinkOptions.find(
                            (option) =>
                              `${option.kind}:${option.id}` ===
                              event.currentTarget.value,
                          );
                          if (block) onRelink(item.slideId, item.nodeId, block);
                          event.currentTarget.value = "";
                        }}
                        className="rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-1.5 py-0.5 text-[11px] text-ds-text-secondary disabled:opacity-40"
                      >
                        <option value="">Relink…</option>
                        {relinkOptions.map((block) => (
                          <option
                            key={`${block.kind}:${block.id}`}
                            value={`${block.kind}:${block.id}`}
                          >
                            {block.displayLabel} ({block.kind}:{block.id})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label={sourceReviewActionAriaLabel(
                          "mark-source-unlinked",
                          item,
                        )}
                        onClick={() => onUnlink(item.slideId, item.nodeId)}
                        className="rounded-ds-sm border border-ds-border-subtle px-1.5 py-0.5 text-[11px] text-ds-text-secondary hover:bg-ds-state-hover"
                      >
                        {unlinkDescriptor.shortLabel ?? unlinkDescriptor.label}
                      </button>
                      <button
                        type="button"
                        aria-label={sourceReviewActionAriaLabel(
                          "dismiss-source-issue",
                          item,
                        )}
                        onClick={() => onDismiss(item.slideId, item.nodeId)}
                        className="rounded-ds-sm border border-ds-border-subtle px-1.5 py-0.5 text-[11px] text-ds-text-secondary hover:bg-ds-state-hover"
                      >
                        {dismissDescriptor.shortLabel ??
                          dismissDescriptor.label}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
