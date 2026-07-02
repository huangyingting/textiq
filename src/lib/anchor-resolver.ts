/**
 * Shared pure anchor-resolution helpers (issue #433).
 *
 * Every feature that points from one entity to another — source links (#377),
 * slide comments (#380), visual mirrors, version restore — needs identical
 * semantics for what "the target exists / is missing / is stale"
 * means. This module provides that shared vocabulary.
 *
 * All helpers are DOM-free and side-effect-free so they can run in server
 * actions, tests, and the browser without any adaptation.
 */

import { hashDocumentBlock } from "./presentation-shared/document-block-hash";
import type { SourceRef } from "./document/deck-kernel/deck";
import type {
  DeckV7,
  SlideChildNode,
  SlideNode,
} from "./presentation-vnext/schema";
import {
  resolveAnchorState,
  type SlideCommentAnchor,
} from "./document/deck-kernel/slide-comment-anchors";
import type { DocumentBlock } from "./content";

export type AnchorTargetStatus =
  | "found"
  | "stale"
  | "missing"
  | "ambiguous"
  | "unknown"
  | "invalid"
  | "unauthorized";

export interface AnchorResolution<T = unknown> {
  status: AnchorTargetStatus;
  target?: T;
  reason?: string;
}

function isNonEmptyId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveBlockRef(
  blockId: string,
  blocks: readonly DocumentBlock[],
): AnchorResolution<DocumentBlock> {
  if (!isNonEmptyId(blockId)) {
    return { status: "invalid", reason: "Block id is empty." };
  }
  const target = blocks.find(
    (block) => block.kind === "text" && block.blockId === blockId,
  );
  return target
    ? { status: "found", target }
    : { status: "missing", reason: `Block ${blockId} was not found.` };
}

export function resolveVisualRef(
  visualId: string,
  blocks: readonly DocumentBlock[],
): AnchorResolution<DocumentBlock> {
  if (!isNonEmptyId(visualId)) {
    return { status: "invalid", reason: "Visual id is empty." };
  }
  const target = blocks.find(
    (block) => block.kind === "visual" && block.visualId === visualId,
  );
  return target
    ? { status: "found", target }
    : { status: "missing", reason: `Visual ${visualId} was not found.` };
}

function resolveTableRef(
  blockId: string,
  blocks: readonly DocumentBlock[],
): AnchorResolution<DocumentBlock> {
  if (!isNonEmptyId(blockId)) {
    return { status: "invalid", reason: "Table block id is empty." };
  }
  const target = blocks.find(
    (block) => block.kind === "table" && block.blockId === blockId,
  );
  return target
    ? { status: "found", target }
    : { status: "missing", reason: `Table ${blockId} was not found.` };
}

export function resolveSourceRef(
  sourceRef: SourceRef,
  blocks: readonly DocumentBlock[],
): AnchorResolution<DocumentBlock> {
  if (!isNonEmptyId(sourceRef.blockId)) {
    return { status: "invalid", reason: "Source ref blockId is empty." };
  }

  const blockKind = sourceRef.blockKind;
  if (blockKind !== "text" && blockKind !== "visual" && blockKind !== "table") {
    return {
      status: "invalid",
      reason: `Unsupported source ref blockKind: ${String(blockKind)}.`,
    };
  }

  const resolution =
    blockKind === "visual"
      ? resolveVisualRef(sourceRef.blockId, blocks)
      : blockKind === "table"
        ? resolveTableRef(sourceRef.blockId, blocks)
        : resolveBlockRef(sourceRef.blockId, blocks);

  if (resolution.status !== "found" || !resolution.target) {
    return resolution;
  }

  if (
    typeof sourceRef.contentHash === "string" &&
    sourceRef.contentHash.length > 0 &&
    hashDocumentBlock(resolution.target) !== sourceRef.contentHash
  ) {
    return {
      status: "stale",
      target: resolution.target,
      reason: `Source ${sourceRef.blockId} content has changed.`,
    };
  }

  return resolution;
}

export function resolveSlideRef(
  slideId: string,
  deck: DeckV7,
): AnchorResolution<SlideNode> {
  if (!isNonEmptyId(slideId)) {
    return { status: "invalid", reason: "Slide id is empty." };
  }
  const target = deck.slides.find((slide) => slide.id === slideId);
  return target
    ? { status: "found", target }
    : { status: "missing", reason: `Slide ${slideId} was not found.` };
}

export function resolveSlideElementRef(
  slideId: string,
  elementId: string,
  deck: DeckV7,
): AnchorResolution<SlideChildNode> {
  if (!isNonEmptyId(slideId)) {
    return { status: "invalid", reason: "Slide id is empty." };
  }
  if (!isNonEmptyId(elementId)) {
    return { status: "invalid", reason: "Element id is empty." };
  }

  const slideResolution = resolveSlideRef(slideId, deck);
  if (slideResolution.status !== "found" || !slideResolution.target) {
    return {
      status: slideResolution.status,
      reason:
        slideResolution.status === "missing"
          ? `Slide missing: ${slideId}.`
          : slideResolution.reason,
    };
  }

  const target = findSlideNodeById(slideResolution.target.children, elementId);
  return target
    ? { status: "found", target }
    : {
        status: "missing",
        reason: `Element ${elementId} was not found on slide ${slideId}.`,
      };
}

function findSlideNodeById(
  nodes: readonly SlideChildNode[],
  nodeId: string,
): SlideChildNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.type === "group") {
      const found = findSlideNodeById(node.children, nodeId);
      if (found) return found;
    }
  }
  return undefined;
}

/* node:coverage ignore next 4 -- Comment-anchor states are asserted; tsx maps this signature as uncovered. */
export function resolveCommentAnchor(
  /* node:coverage ignore next -- Signature parameter row is a source-map artifact. */
  anchor: SlideCommentAnchor,
  deck: DeckV7 | null | undefined,
): AnchorResolution<SlideCommentAnchor> {
  const state = resolveAnchorState(anchor, deck);
  switch (state) {
    case "deck":
    case "attached":
      return { status: "found", target: anchor };
    case "orphaned":
      return { status: "missing", reason: "Comment anchor target is missing." };
    case "unknown":
      return {
        status: "unknown",
        reason:
          "Comment anchor could not be resolved against the current deck.",
      };
  }
}
