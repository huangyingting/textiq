import {
  collectDocumentBlocks,
  type DocumentBlock,
  type DocumentTextBlock,
} from "@/lib/content";
import {
  AI_GENERATION_INPUT_MAX_CHARS,
  AI_VISUAL_INVENTORY_MAX_ITEMS,
} from "@/lib/limits/ai";
import {
  documentBlockSignature,
  hashDocumentBlock,
} from "@/lib/presentation/document-block-hash";
import { fnv1aHash32 } from "@/lib/presentation/fnv-hash";

const DEFAULT_DERIVE_TITLE = "Document";
const MAX_VISUAL_SUMMARY_CHARS = 120;

export type DocumentSourceVisualInventoryItem = {
  id: string;
  title: string;
  type: string;
  summary: string;
};

export type DocumentSourceBlockV1 =
  | { id: string; kind: "heading"; level?: 1 | 2 | 3; text: string }
  | {
      id: string;
      kind: "paragraph" | "listitem" | "quote" | "hr";
      text: string;
    }
  | {
      id: string;
      kind: "table";
      caption?: string;
      columns: string[];
      rows: string[][];
    }
  | {
      id: string;
      kind: "visual";
      visualId: string;
      title?: string;
      summary?: string;
    };

export type DocumentSourceSectionV1 = {
  id: string;
  title?: string;
  sourceBlockIds: string[];
  blocks: DocumentSourceBlockV1[];
};

export type DocumentSourcePlanV1 = {
  planVersion: 1;
  documentId?: string;
  contentHash: string;
  locale?: string;
  truncated: boolean;
  originalChars: number;
  keptChars: number;
  sections: DocumentSourceSectionV1[];
  visualInventory: DocumentSourceVisualInventoryItem[];
};
export type DocumentSourcePlanBuildResult = {
  sourcePlan: DocumentSourcePlanV1;
  blocks: DocumentBlock[];
  blockMap: ReadonlyMap<string, DocumentBlock>;
};
function trimText(block: DocumentTextBlock): string {
  return block.text.trim();
}

function headingTitle(block: DocumentTextBlock): string {
  const title = trimText(block);
  return title.length > 0 ? title : DEFAULT_DERIVE_TITLE;
}
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}...`;
}

function titleFromType(type: string): string {
  if (type.length === 0) return "Untitled visual";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function summarizeVisual(block: Extract<DocumentBlock, { kind: "visual" }>) {
  const labels = Array.isArray(block.visual.nodes)
    ? block.visual.nodes
        .map((node) =>
          typeof node?.label === "string" ? node.label.trim() : "",
        )
        .filter((label) => label.length > 0)
    : [];
  return truncate(labels.join(", "), MAX_VISUAL_SUMMARY_CHARS);
}

function sourceIdForBlock(block: DocumentBlock, index: number): string {
  if (block.kind === "visual") return block.visualId;
  if (block.blockId) return block.blockId;
  return `block-${index + 1}-${hashDocumentBlock(block)}`;
}

function sourceBlockForDocumentBlock(
  block: DocumentBlock,
  id: string,
): DocumentSourceBlockV1 | null {
  if (block.kind === "visual") {
    return {
      id,
      kind: "visual",
      visualId: block.visualId,
      ...(block.visual.title ? { title: block.visual.title } : {}),
      summary: summarizeVisual(block),
    };
  }
  if (block.kind === "table") {
    return {
      id,
      kind: "table",
      ...(block.caption ? { caption: block.caption } : {}),
      columns: block.columns.map((column) => column.label),
      rows: block.rows.map((row) => row.cells.map((cell) => cell.text)),
    };
  }
  if (block.blockType === "heading") {
    return {
      id,
      kind: "heading",
      ...(block.level ? { level: block.level } : {}),
      text: block.text,
    };
  }
  return { id, kind: block.blockType, text: block.text };
}

function buildSourceSections(
  blocks: readonly DocumentBlock[],
  ids: readonly string[],
): DocumentSourceSectionV1[] {
  const sections: DocumentSourceSectionV1[] = [];
  let current: DocumentSourceSectionV1 | null = null;

  const ensureSection = () => {
    if (current) return current;
    current = {
      id: `section-${sections.length + 1}`,
      sourceBlockIds: [],
      blocks: [],
    };
    sections.push(current);
    return current;
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const id = ids[i];
    if (!block || !id) continue;
    const sourceBlock = sourceBlockForDocumentBlock(block, id);
    if (!sourceBlock) continue;

    if (block.kind === "text" && block.blockType === "heading") {
      current = {
        id: `section-${sections.length + 1}`,
        title: headingTitle(block),
        sourceBlockIds: [],
        blocks: [],
      };
      sections.push(current);
    }

    const section = ensureSection();
    section.sourceBlockIds.push(id);
    section.blocks.push(sourceBlock);
  }

  return sections.filter((section) => section.blocks.length > 0);
}

function buildVisualInventory(
  blocks: readonly DocumentBlock[],
): DocumentSourceVisualInventoryItem[] {
  const inventory: DocumentSourceVisualInventoryItem[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (inventory.length >= AI_VISUAL_INVENTORY_MAX_ITEMS) break;
    if (block.kind !== "visual") continue;
    if (seen.has(block.visualId)) continue;
    seen.add(block.visualId);
    const type = String(block.visual.type ?? "");
    inventory.push({
      id: block.visualId,
      title:
        typeof block.visual.title === "string" &&
        block.visual.title.trim().length > 0
          ? block.visual.title.trim()
          : titleFromType(type),
      type,
      summary: summarizeVisual(block),
    });
  }
  return inventory;
}

function serializeSourcePlanForBudget(
  sections: readonly DocumentSourceSectionV1[],
): string {
  return sections
    .flatMap((section) =>
      section.blocks.map((block) => {
        if (block.kind === "heading") {
          return `${"#".repeat(block.level ?? 2)} ${block.text}`.trimEnd();
        }
        if (block.kind === "listitem") return `- ${block.text}`;
        if (block.kind === "quote") return `> ${block.text}`;
        if (block.kind === "hr") return "---";
        if (block.kind === "table") {
          return [
            block.caption,
            `| ${block.columns.join(" | ")} |`,
            `| ${block.columns.map(() => "---").join(" | ")} |`,
            ...block.rows.map((row) => `| ${row.join(" | ")} |`),
          ]
            .filter((line): line is string => typeof line === "string")
            .join("\n");
        }
        if (block.kind === "visual") return `[visual: ${block.visualId}]`;
        return block.text;
      }),
    )
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function buildContentHash(blocks: readonly DocumentBlock[]): string {
  return fnv1aHash32(blocks.map(documentBlockSignature).join("\x1e"));
}

function blockMapFor(
  blocks: readonly DocumentBlock[],
  ids: readonly string[],
): ReadonlyMap<string, DocumentBlock> {
  const map = new Map<string, DocumentBlock>();
  for (let i = 0; i < blocks.length; i++) {
    const id = ids[i];
    const block = blocks[i];
    if (id && block) map.set(id, block);
  }
  return map;
}

export function buildDocumentSourcePlanV1({
  contentJson,
  documentId,
}: {
  contentJson: unknown;
  documentId?: string;
}): DocumentSourcePlanBuildResult {
  const blocks = collectDocumentBlocks(contentJson);
  const ids = blocks.map(sourceIdForBlock);
  const sections = buildSourceSections(blocks, ids);
  const fullOutline = serializeSourcePlanForBudget(sections);
  const truncated = fullOutline.length > AI_GENERATION_INPUT_MAX_CHARS;
  return {
    sourcePlan: {
      planVersion: 1,
      ...(documentId ? { documentId } : {}),
      contentHash: buildContentHash(blocks),
      truncated,
      originalChars: fullOutline.length,
      keptChars: Math.min(fullOutline.length, AI_GENERATION_INPUT_MAX_CHARS),
      sections,
      visualInventory: buildVisualInventory(blocks),
    },
    blocks,
    blockMap: blockMapFor(blocks, ids),
  };
}
