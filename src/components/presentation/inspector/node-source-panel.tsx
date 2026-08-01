"use client";

import type { JSX } from "react";

import type {
  NodeSourceMetadata,
  SlideChildNode,
} from "@/lib/presentation/schema";
import type { SourceBlockIndexEntry } from "@/lib/presentation/block-index";
import type { SourceLinkClassification } from "@/lib/presentation/source-links";
import { FOCUS_RING } from "@/components/ui/tokens";

export interface NodeSourcePanelProps {
  node: SlideChildNode;
  onUpdateSource: (source: NodeSourceMetadata | undefined) => void;
  onRefreshSource?: () => void;
  sourceRefreshPending?: boolean;
  onUnlinkSource?: () => void;
  onRelinkSource?: (block: SourceBlockIndexEntry) => void;
  classification?: SourceLinkClassification;
  availableBlocks?: readonly SourceBlockIndexEntry[];
}

const BLOCK_KIND_OPTIONS: NonNullable<NodeSourceMetadata["blockKind"]>[] = [
  "text",
  "visual",
  "table",
  "image",
];

export function sourceStatus(
  source: NodeSourceMetadata | undefined,
  classification?: SourceLinkClassification,
):
  | "Standalone"
  | "Fresh"
  | "Stale"
  | "Orphaned"
  | "Unknown"
  | "Unlinked"
  | "Dismissed"
  | "Linked"
  | "Draft link" {
  if (classification) {
    if (classification.dismissed === true) return "Dismissed";
    switch (classification.state) {
      case "fresh":
        return "Fresh";
      case "stale":
        return "Stale";
      case "orphan":
        return "Orphaned";
      case "unknown":
        return "Unknown";
      case "unlinked":
        return "Unlinked";
    }
  }
  const hasLink = Boolean(source?.documentId || source?.blockId);
  return !source
    ? "Standalone"
    : source.unlinked
      ? "Unlinked"
      : hasLink
        ? "Linked"
        : "Draft link";
}

export function sourceWithPatch(
  source: NodeSourceMetadata | undefined,
  patch: Partial<NodeSourceMetadata>,
): NodeSourceMetadata {
  return {
    documentId: source?.documentId ?? "",
    blockId: source?.blockId ?? "",
    ...(source?.blockKind ? { blockKind: source.blockKind } : {}),
    ...(source?.contentHash ? { contentHash: source.contentHash } : {}),
    ...(source?.blockRevision ? { blockRevision: source.blockRevision } : {}),
    ...(source?.linkedAt ? { linkedAt: source.linkedAt } : {}),
    ...(source?.display ? { display: source.display } : {}),
    ...(source?.refresh ? { refresh: source.refresh } : {}),
    ...(source?.unlinked ? { unlinked: source.unlinked } : {}),
    ...(source?.extra ? { extra: source.extra } : {}),
    ...patch,
  };
}

export function NodeSourcePanel({
  node,
  onUpdateSource,
  onRefreshSource,
  sourceRefreshPending = false,
  onUnlinkSource,
  onRelinkSource,
  classification,
  availableBlocks = [],
}: NodeSourcePanelProps): JSX.Element {
  const source = node.source;
  const status = sourceStatus(source, classification);
  const relinkBlocks = availableBlocks.slice(0, 8);

  function updateSource(patch: Partial<NodeSourceMetadata>) {
    onUpdateSource(sourceWithPatch(source, patch));
  }

  return (
    <section className="flex flex-col gap-2 px-3 py-2.5">
      <h4 className="text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
        Source
      </h4>
      <div className="rounded-ds-sm border border-ds-border-subtle bg-ds-surface-raised px-2 py-1.5 text-xs text-ds-text-secondary">
        <div className="font-medium text-ds-text-primary">{status}</div>
        {source?.linkedAt ? (
          <div className="mt-0.5 font-mono text-[11px] text-ds-text-muted">
            Linked {source.linkedAt}
          </div>
        ) : null}
        {source?.contentHash ? (
          <div className="mt-0.5 truncate font-mono text-[11px] text-ds-text-muted">
            Hash {source.contentHash}
          </div>
        ) : null}
        {classification ? (
          <div className="mt-1 text-[11px] text-ds-text-muted">
            {classification.reason}
          </div>
        ) : null}
        {classification?.block ? (
          <div className="mt-1 text-[11px] text-ds-text-muted">
            Current block: {classification.block.displayLabel} ·{" "}
            <span className="font-mono">{classification.block.hash}</span>
          </div>
        ) : source?.display?.blockLabel ? (
          <div className="mt-1 text-[11px] text-ds-text-muted">
            Source block: {source.display.blockLabel}
          </div>
        ) : null}
      </div>
      <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
        Document id
        <input
          value={source?.documentId ?? ""}
          onChange={(event) =>
            updateSource({ documentId: event.currentTarget.value })
          }
          className={`rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 font-mono text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
        Block id
        <input
          value={source?.blockId ?? ""}
          onChange={(event) =>
            updateSource({ blockId: event.currentTarget.value })
          }
          className={`rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 font-mono text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
        Kind
        <select
          value={source?.blockKind ?? ""}
          onChange={(event) =>
            updateSource({
              blockKind: event.currentTarget.value as NonNullable<
                NodeSourceMetadata["blockKind"]
              >,
            })
          }
          className={`rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
        >
          <option value="">Unspecified</option>
          {BLOCK_KIND_OPTIONS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-ds-text-secondary">
        <input
          type="checkbox"
          checked={source?.unlinked === true}
          onChange={(event) =>
            updateSource({ unlinked: event.currentTarget.checked })
          }
        />
        Unlinked
      </label>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={!source}
          onClick={() =>
            updateSource({
              linkedAt: new Date().toISOString(),
              unlinked: false,
            })
          }
          className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover disabled:opacity-40"
        >
          Mark updated
        </button>
        <button
          type="button"
          disabled={
            !source || onRefreshSource === undefined || sourceRefreshPending
          }
          aria-busy={sourceRefreshPending}
          onClick={onRefreshSource}
          className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover disabled:opacity-40"
        >
          {sourceRefreshPending ? "Updating…" : "Update from document"}
        </button>
        <button
          type="button"
          disabled={!source || source.unlinked === true}
          onClick={() => {
            if (onUnlinkSource) {
              onUnlinkSource();
              return;
            }
            updateSource({ unlinked: true });
          }}
          className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover disabled:opacity-40"
        >
          Unlink
        </button>
        <button
          type="button"
          disabled={
            !source || onRelinkSource === undefined || relinkBlocks.length === 0
          }
          onClick={() => {
            if (onRelinkSource && relinkBlocks[0]) {
              onRelinkSource(relinkBlocks[0]);
            }
          }}
          className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover disabled:opacity-40"
        >
          Relink to first local block
        </button>
      </div>
      {onRelinkSource && relinkBlocks.length > 0 ? (
        <div className="rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-2 py-1.5">
          <div className="text-[11px] font-medium text-ds-text-secondary">
            Explicit relink choices
          </div>
          <div className="mt-1 flex max-h-36 flex-col gap-1 overflow-auto">
            {relinkBlocks.map((block) => (
              <button
                key={`${block.kind}-${block.id}`}
                type="button"
                onClick={() => onRelinkSource(block)}
                className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-left text-[11px] text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary"
              >
                <span className="font-medium">{block.displayLabel}</span>
                <span className="ml-1 font-mono text-ds-text-muted">
                  {block.kind}:{block.id}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {source ? (
        <button
          type="button"
          onClick={() => onUpdateSource(undefined)}
          className="self-start rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover"
        >
          Clear source
        </button>
      ) : null}
    </section>
  );
}
