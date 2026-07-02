import type { DocumentBlock } from "@/lib/content";
import { hashDocumentBlock } from "@/lib/presentation/document-block-hash";
import type {
  NodeSourceMetadata,
  TableColumn,
  TableRow,
  TextRun,
} from "./schema";

export type SourceBlockKind = NonNullable<NodeSourceMetadata["blockKind"]>;

export type SourceBlockRefreshPayload =
  | {
      kind: "text";
      text: string;
      runs?: TextRun[];
    }
  | {
      kind: "table";
      columns: TableColumn[];
      rows: TableRow[];
      caption?: string;
    }
  | {
      kind: "visual";
      visualId: string;
      alt?: string;
    }
  | {
      kind: "image";
      assetId?: string;
      alt?: string;
    };

export type SourceBlockIndexEntry = {
  documentId: string;
  id: string;
  kind: SourceBlockKind;
  hash: string;
  revision?: string;
  displayLabel: string;
  refresh: SourceBlockRefreshPayload;
};

export type SourceBlockIndex = {
  documentId: string;
  blocks: readonly SourceBlockIndexEntry[];
};

function presentationTextRuns(
  runs: Extract<DocumentBlock, { kind: "text" }>["runs"],
): TextRun[] | undefined {
  if (!runs || runs.length === 0) return undefined;
  const converted = runs.map((run): TextRun => {
    const localStyle: TextRun["localStyle"] =
      typeof run.color === "string" ? { color: run.color } : undefined;
    return {
      text: run.text,
      ...(run.bold === true ? { bold: true } : {}),
      ...(run.italic === true ? { italic: true } : {}),
      ...(run.underline === true ? { underline: true } : {}),
      ...(run.code === true ? { code: true } : {}),
      ...(typeof run.link === "string" ? { link: run.link } : {}),
      ...(localStyle ? { localStyle } : {}),
    };
  });
  return converted.length > 0 ? converted : undefined;
}

function tableRows(
  block: Extract<DocumentBlock, { kind: "table" }>,
): TableRow[] {
  return block.rows.map((row) => ({
    id: row.id,
    cells: row.cells.map((cell) => ({
      text: cell.text,
      ...(cell.runs && cell.runs.length > 0
        ? { runs: presentationTextRuns(cell.runs) }
        : {}),
    })),
  }));
}

function labelForBlock(block: DocumentBlock, fallbackId: string): string {
  if (block.kind === "text") {
    const text = block.text.trim();
    if (text.length > 0)
      return text.length > 64 ? `${text.slice(0, 61)}…` : text;
    return block.blockType === "hr" ? "Horizontal rule" : fallbackId;
  }
  if (block.kind === "table") {
    if (block.caption && block.caption.trim().length > 0) return block.caption;
    return `Table ${fallbackId}`;
  }
  return block.visual.title ?? `Visual ${block.visualId}`;
}

export function buildSourceBlockIndex(
  documentId: string,
  blocks: readonly DocumentBlock[],
): SourceBlockIndex {
  const indexed: SourceBlockIndexEntry[] = [];
  for (const block of blocks) {
    if (block.kind === "text") {
      if (!block.blockId) continue;
      indexed.push({
        documentId,
        id: block.blockId,
        kind: "text",
        hash: hashDocumentBlock(block),
        displayLabel: labelForBlock(block, block.blockId),
        refresh: {
          kind: "text",
          text: block.text,
          ...(block.runs && block.runs.length > 0
            ? { runs: presentationTextRuns(block.runs) }
            : {}),
        },
      });
      continue;
    }
    if (block.kind === "table") {
      if (!block.blockId) continue;
      indexed.push({
        documentId,
        id: block.blockId,
        kind: "table",
        hash: hashDocumentBlock(block),
        displayLabel: labelForBlock(block, block.blockId),
        refresh: {
          kind: "table",
          columns: block.columns.map((column) => ({
            id: column.id,
            label: column.label,
          })),
          rows: tableRows(block),
          ...(block.caption ? { caption: block.caption } : {}),
        },
      });
      continue;
    }
    indexed.push({
      documentId,
      id: block.visualId,
      kind: "visual",
      hash: hashDocumentBlock(block),
      displayLabel: labelForBlock(block, block.visualId),
      refresh: {
        kind: "visual",
        visualId: block.visualId,
        ...(block.visual.title ? { alt: block.visual.title } : {}),
      },
    });
  }
  return { documentId, blocks: indexed };
}

export function findSourceBlock(
  index: SourceBlockIndex,
  source: Pick<NodeSourceMetadata, "blockId" | "blockKind">,
): SourceBlockIndexEntry | undefined {
  if (!source.blockId) return undefined;
  return index.blocks.find(
    (block) =>
      block.id === source.blockId &&
      (source.blockKind === undefined || block.kind === source.blockKind),
  );
}
