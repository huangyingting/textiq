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
import type { Visual } from "@/lib/visual/schema";

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

function summarizeVisual(visual: Visual) {
  const labels = Array.isArray(visual.nodes)
    ? visual.nodes
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
  visuals: ReadonlyMap<string, Visual> | undefined,
): DocumentSourceBlockV1 | null {
  if (block.kind === "visual") {
    const visual = visuals?.get(block.visualId) ?? block.visual;
    return {
      id,
      kind: "visual",
      visualId: block.visualId,
      ...(visual.title ? { title: visual.title } : {}),
      summary: summarizeVisual(visual),
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
  visuals?: ReadonlyMap<string, Visual>,
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
    const sourceBlock = sourceBlockForDocumentBlock(block, id, visuals);
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

export function buildDocumentSourceVisualInventory(
  blocks: readonly DocumentBlock[],
  visuals: ReadonlyMap<string, Visual> = new Map(),
): DocumentSourceVisualInventoryItem[] {
  const inventory: DocumentSourceVisualInventoryItem[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (inventory.length >= AI_VISUAL_INVENTORY_MAX_ITEMS) break;
    if (block.kind !== "visual") continue;
    if (seen.has(block.visualId)) continue;
    seen.add(block.visualId);
    const visual = visuals.get(block.visualId) ?? block.visual;
    const type = String(visual.type ?? "");
    inventory.push({
      id: block.visualId,
      title:
        typeof visual.title === "string" && visual.title.trim().length > 0
          ? visual.title.trim()
          : titleFromType(type),
      type,
      summary: summarizeVisual(visual),
    });
  }
  return inventory;
}

export function renderDocumentSourcePlanForPrompt(
  sourcePlan: Pick<
    DocumentSourcePlanV1,
    "planVersion" | "contentHash" | "truncated"
  > & {
    sections: readonly DocumentSourceSectionV1[];
  },
): string {
  return JSON.stringify(
    {
      planVersion: sourcePlan.planVersion,
      contentHash: sourcePlan.contentHash,
      truncated: sourcePlan.truncated,
      sections: sourcePlan.sections,
    },
    null,
    2,
  );
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

function cloneSectionShell(
  section: DocumentSourceSectionV1,
): DocumentSourceSectionV1 {
  return {
    id: section.id,
    ...(section.title ? { title: section.title } : {}),
    sourceBlockIds: [],
    blocks: [],
  };
}

function addBlockToSection(
  sections: DocumentSourceSectionV1[],
  sourceSection: DocumentSourceSectionV1,
  block: DocumentSourceBlockV1,
) {
  let target = sections.find((section) => section.id === sourceSection.id);
  if (!target) {
    target = cloneSectionShell(sourceSection);
    sections.push(target);
    sections.sort(
      (a, b) =>
        Number(a.id.replace("section-", "")) -
        Number(b.id.replace("section-", "")),
    );
  }
  target.sourceBlockIds.push(block.id);
  target.blocks.push(block);
}

function planPromptLength({
  contentHash,
  truncated,
  sections,
}: {
  contentHash: string;
  truncated: boolean;
  sections: readonly DocumentSourceSectionV1[];
}): number {
  return renderDocumentSourcePlanForPrompt({
    planVersion: 1,
    contentHash,
    truncated,
    sections,
  }).length;
}

function fitSectionsToPromptBudget(
  sections: readonly DocumentSourceSectionV1[],
  contentHash: string,
): {
  sections: DocumentSourceSectionV1[];
  originalChars: number;
  keptChars: number;
  truncated: boolean;
} {
  const originalChars = planPromptLength({
    contentHash,
    truncated: false,
    sections,
  });
  if (originalChars <= AI_GENERATION_INPUT_MAX_CHARS) {
    return {
      sections: [...sections],
      originalChars,
      keptChars: originalChars,
      truncated: false,
    };
  }

  const candidates = sections.flatMap((section) =>
    section.blocks.map((block) => ({ section, block })),
  );
  const prioritized = [
    ...candidates.filter(({ block }) => block.kind === "heading"),
    ...candidates.filter(({ block }) => block.kind !== "heading"),
  ];

  const keptSections: DocumentSourceSectionV1[] = [];
  for (const { section, block } of prioritized) {
    const nextSections = keptSections.map((kept) => ({
      ...kept,
      sourceBlockIds: [...kept.sourceBlockIds],
      blocks: [...kept.blocks],
    }));
    addBlockToSection(nextSections, section, block);
    if (
      planPromptLength({
        contentHash,
        truncated: true,
        sections: nextSections,
      }) <= AI_GENERATION_INPUT_MAX_CHARS
    ) {
      keptSections.splice(0, keptSections.length, ...nextSections);
    }
  }

  return {
    sections: keptSections,
    originalChars,
    keptChars: planPromptLength({
      contentHash,
      truncated: true,
      sections: keptSections,
    }),
    truncated: true,
  };
}

export function buildDocumentSourcePlanV1({
  contentJson,
  documentId,
  visuals,
}: {
  contentJson: unknown;
  documentId?: string;
  visuals?: ReadonlyMap<string, Visual>;
}): DocumentSourcePlanBuildResult {
  const blocks = collectDocumentBlocks(contentJson);
  const ids = blocks.map(sourceIdForBlock);
  const sections = buildSourceSections(blocks, ids, visuals);
  const contentHash = buildContentHash(blocks);
  const budgeted = fitSectionsToPromptBudget(sections, contentHash);
  return {
    sourcePlan: {
      planVersion: 1,
      ...(documentId ? { documentId } : {}),
      contentHash,
      truncated: budgeted.truncated,
      originalChars: budgeted.originalChars,
      keptChars: budgeted.keptChars,
      sections: budgeted.sections,
      visualInventory: buildDocumentSourceVisualInventory(blocks, visuals),
    },
    blocks,
    blockMap: blockMapFor(blocks, ids),
  };
}
