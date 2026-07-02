import type { DocumentBlock } from "@/lib/content";
import { hashDocumentBlock } from "@/lib/presentation/document-block-hash";

import type {
  NodeSourceMetadata,
  SlideChildNode,
  SlideNode,
  SlotKey,
} from "./schema";
import type { JsonValue } from "./types";
import type { DocumentPlannedSlideV1 } from "./document-slide-planner";
import { buildNodeDerivationExtra } from "./provenance-extra";

function slotSourceIds(
  slotSources: Partial<Record<SlotKey, string[]>>,
  slot: SlotKey | undefined,
): string[] {
  if (!slot) return [];
  return slotSources[slot] ?? [];
}

function sourceForBlock(
  block: DocumentBlock,
  sourceBlockIds: readonly string[],
  documentId: string | undefined,
  linkedAt: string,
  derivation: {
    slidePlanId: string;
    slotKey?: SlotKey;
  },
): NodeSourceMetadata | undefined {
  if (!documentId) return undefined;
  const extra: Record<string, JsonValue> = {
    derivation: buildNodeDerivationExtra({
      slidePlanId: derivation.slidePlanId,
      ...(derivation.slotKey ? { slotKey: derivation.slotKey } : {}),
      sourceBlockIds: [...sourceBlockIds],
    }),
  };
  const base = {
    documentId,
    contentHash: hashDocumentBlock(block),
    linkedAt,
    extra,
  };
  if (block.kind === "visual") {
    return {
      ...base,
      blockId: block.visualId,
      blockKind: "visual",
    };
  }
  return {
    ...base,
    ...(block.blockId ? { blockId: block.blockId } : {}),
    blockKind: block.kind === "table" ? "table" : "text",
  };
}

function stampNodeSourceBySlot(
  node: SlideChildNode,
  slidePlan: DocumentPlannedSlideV1,
  blockMap: ReadonlyMap<string, DocumentBlock>,
  documentId: string | undefined,
  linkedAt: string,
): SlideChildNode {
  const sourceBlockIds = slotSourceIds(slidePlan.slotSources, node.slot);
  const primaryBlock = sourceBlockIds[0]
    ? blockMap.get(sourceBlockIds[0])
    : undefined;
  const source = primaryBlock
    ? sourceForBlock(primaryBlock, sourceBlockIds, documentId, linkedAt, {
        slidePlanId: slidePlan.id,
        ...(node.slot ? { slotKey: node.slot } : {}),
      })
    : undefined;

  if (node.type === "group") {
    return {
      ...node,
      ...(source ? { source } : {}),
      children: node.children.map((child) =>
        stampNodeSourceBySlot(child, slidePlan, blockMap, documentId, linkedAt),
      ),
    };
  }

  return {
    ...node,
    ...(source ? { source } : {}),
  };
}

export function stampSlideSources(
  slide: SlideNode,
  slidePlan: DocumentPlannedSlideV1,
  blockMap: ReadonlyMap<string, DocumentBlock>,
  documentId: string | undefined,
  linkedAt: string,
): SlideNode {
  return {
    ...slide,
    children: slide.children.map((child) =>
      stampNodeSourceBySlot(child, slidePlan, blockMap, documentId, linkedAt),
    ),
  };
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
