import type { SourceBlockIndex, SourceBlockIndexEntry } from "./block-index";
import type { SlideChildNode } from "./schema";
import { buildFreshNodeSourceMetadata } from "./source-links";

export type DocumentSourceInsertBlock = SourceBlockIndexEntry & {
  kind: "text" | "table" | "visual";
  refresh: Extract<
    SourceBlockIndexEntry["refresh"],
    { kind: "text" | "table" | "visual" }
  >;
};

function isDocumentSourceInsertBlock(
  entry: SourceBlockIndexEntry,
): entry is DocumentSourceInsertBlock {
  return (
    (entry.kind === "text" && entry.refresh.kind === "text") ||
    (entry.kind === "table" && entry.refresh.kind === "table") ||
    (entry.kind === "visual" && entry.refresh.kind === "visual")
  );
}

export function documentSourceInsertBlocks(
  index?: SourceBlockIndex,
): DocumentSourceInsertBlock[] {
  if (!index) return [];
  return index.blocks.filter(isDocumentSourceInsertBlock);
}

export function sourceBlockKindLabel(
  kind: DocumentSourceInsertBlock["kind"],
): string {
  if (kind === "visual") return "Visual";
  if (kind === "table") return "Table";
  return "Text";
}

export function createDocumentSourceNode({
  block,
  nodeId,
  zIndex,
  linkedAt,
}: {
  block: DocumentSourceInsertBlock;
  nodeId: string;
  zIndex: number;
  linkedAt: string;
}): SlideChildNode {
  const source = buildFreshNodeSourceMetadata(block, linkedAt, {
    display: { blockKindLabel: sourceBlockKindLabel(block.kind) },
  });
  if (block.kind === "text") {
    const refresh = block.refresh;
    if (refresh.kind !== "text") {
      throw new Error("Text source block payload mismatch.");
    }
    return {
      id: nodeId,
      type: "text",
      role: "body",
      layout: { frame: { x: 12, y: 16, w: 42, h: 12 }, zIndex },
      style: { ref: "text.body" },
      content: {
        paragraphs: [
          {
            id: `${nodeId}-source-p-1`,
            text: refresh.text,
            ...(refresh.runs && refresh.runs.length > 0
              ? { runs: refresh.runs }
              : {}),
          },
        ],
      },
      source,
    };
  }
  if (block.kind === "table") {
    const refresh = block.refresh;
    if (refresh.kind !== "table") {
      throw new Error("Table source block payload mismatch.");
    }
    return {
      id: nodeId,
      type: "table",
      role: "table",
      layout: { frame: { x: 12, y: 18, w: 56, h: 24 }, zIndex },
      style: { ref: "surface.table" },
      content: {
        columns: refresh.columns,
        rows: refresh.rows,
        header: true,
        ...(refresh.caption ? { caption: refresh.caption } : {}),
      },
      source,
    };
  }
  const refresh = block.refresh;
  if (refresh.kind !== "visual") {
    throw new Error("Visual source block payload mismatch.");
  }
  return {
    id: nodeId,
    type: "visual",
    role: "visual",
    layout: { frame: { x: 18, y: 18, w: 46, h: 30 }, zIndex },
    style: { ref: "chart.primary" },
    content: {
      visualId: refresh.visualId,
      ...(refresh.alt ? { alt: refresh.alt } : {}),
    },
    source,
  };
}
