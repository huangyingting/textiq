import type {
  SemanticDeckPlanV1,
  SemanticSlideSpecV1,
  BulletSlotItem,
  SlotValue,
} from "@/lib/presentation/semantic-deck-plan";
import type {
  DocumentBlock,
  DocumentTableBlock,
  DocumentTextBlock,
} from "@/lib/content";

import type { SemanticTemplateKind, SlideControls, SlotKey } from "./schema";
import type { DocumentSourcePlanV1 } from "./document-source-plan";

const DEFAULT_DERIVE_TITLE = "Document";
const DEFAULT_TABLE_TITLE = "Table";
const DEFAULT_VISUAL_TITLE = "Visual";
const MAX_BULLET_ITEMS_PER_SLIDE = 6;

export type DocumentSlidePlanner = "deterministic" | "ai";
export type DocumentSlideMode = "faithful" | "presentationRewrite";
export type DocumentPlannedSlideV1 = {
  id: string;
  kind: SemanticTemplateKind;
  sourceBlockIds: string[];
  slotSources: Partial<Record<SlotKey, string[]>>;
  controls?: SlideControls;
  slots: Partial<Record<SlotKey, SlotValue>>;
  speakerNotes?: string;
  rationale?: string;
  omittedBlockIds?: string[];
};

export type DocumentSlidePlanV1 = {
  planVersion: 1;
  planner: DocumentSlidePlanner;
  mode: DocumentSlideMode;
  title?: string;
  locale?: string;
  source: {
    documentId?: string;
    contentHash: string;
    truncated: boolean;
  };
  slides: DocumentPlannedSlideV1[];
  omittedBlockIds?: string[];
};
function trimText(block: DocumentTextBlock): string {
  return block.text.trim();
}

function isNonEmptyTextBlock(block: DocumentTextBlock): boolean {
  return trimText(block).length > 0;
}

function headingTitle(block: DocumentTextBlock): string {
  const title = trimText(block);
  return title.length > 0 ? title : DEFAULT_DERIVE_TITLE;
}

function buildTableSlot(block: DocumentTableBlock): SlotValue {
  return {
    type: "table",
    columns: block.columns.map((column) => column.label),
    rows: block.rows.map((row) => row.cells.map((cell) => cell.text)),
    ...(block.caption ? { caption: block.caption } : {}),
  };
}
function sourceIdsForBlocks(
  blockMap: ReadonlyMap<string, DocumentBlock>,
  blocks: readonly DocumentBlock[],
): string[] {
  const ids: string[] = [];
  for (const block of blocks) {
    for (const [id, candidate] of blockMap.entries()) {
      if (candidate === block) {
        ids.push(id);
        break;
      }
    }
  }
  return ids;
}

function pushTextPlannedSlides(
  slides: DocumentPlannedSlideV1[],
  blockMap: ReadonlyMap<string, DocumentBlock>,
  options: {
    title: string;
    titleSource?: DocumentBlock;
    bodyBlocks: DocumentTextBlock[];
  },
): void {
  const titleText = options.title.trim() || DEFAULT_DERIVE_TITLE;
  const titleSourceIds = options.titleSource
    ? sourceIdsForBlocks(blockMap, [options.titleSource])
    : [];
  if (options.bodyBlocks.length === 0) {
    slides.push({
      id: `plan-slide-${slides.length + 1}`,
      kind: slides.length === 0 ? "cover" : "content",
      sourceBlockIds: titleSourceIds,
      slotSources: titleSourceIds.length > 0 ? { title: titleSourceIds } : {},
      slots: { title: { type: "shortText", text: titleText } },
    });
    return;
  }

  for (
    let offset = 0;
    offset < options.bodyBlocks.length;
    offset += MAX_BULLET_ITEMS_PER_SLIDE
  ) {
    const chunk = options.bodyBlocks.slice(
      offset,
      offset + MAX_BULLET_ITEMS_PER_SLIDE,
    );
    const items: BulletSlotItem[] = chunk
      .map((block) => trimText(block))
      .filter((value) => value.length > 0)
      .map((value) => ({ text: value }));
    if (items.length === 0) continue;

    const bulletSourceIds = sourceIdsForBlocks(blockMap, chunk);
    const chunkTitle =
      offset === 0 ? titleText : `${titleText} (cont.)`.trimEnd();
    const titleIds =
      offset === 0 && titleSourceIds.length > 0
        ? titleSourceIds
        : bulletSourceIds.slice(0, 1);
    slides.push({
      id: `plan-slide-${slides.length + 1}`,
      kind: "content",
      sourceBlockIds: [...new Set([...titleIds, ...bulletSourceIds])],
      slotSources: {
        ...(titleIds.length > 0 ? { title: titleIds } : {}),
        ...(bulletSourceIds.length > 0 ? { bullets: bulletSourceIds } : {}),
      },
      slots: {
        title: { type: "shortText", text: chunkTitle },
        bullets: { type: "bullets", items },
      },
    });
  }
}

export function deriveDocumentSlidePlanDeterministic({
  sourcePlan,
  blocks,
  blockMap,
}: {
  sourcePlan: DocumentSourcePlanV1;
  blocks: readonly DocumentBlock[];
  blockMap: ReadonlyMap<string, DocumentBlock>;
}): DocumentSlidePlanV1 {
  const slides: DocumentPlannedSlideV1[] = [];
  let sectionTitle = "";
  let sectionTitleSource: DocumentTextBlock | undefined;
  let pendingTitle = "";
  let pendingTitleSource: DocumentTextBlock | undefined;
  let pendingBodyBlocks: DocumentTextBlock[] = [];

  const flushText = () => {
    if (!pendingTitle && pendingBodyBlocks.length === 0) return;
    pushTextPlannedSlides(slides, blockMap, {
      title: pendingTitle || sectionTitle || DEFAULT_DERIVE_TITLE,
      titleSource: pendingTitleSource,
      bodyBlocks: pendingBodyBlocks,
    });
    pendingTitle = "";
    pendingTitleSource = undefined;
    pendingBodyBlocks = [];
  };

  for (const block of blocks) {
    if (block.kind === "text") {
      if (block.blockType === "heading") {
        flushText();
        const title = headingTitle(block);
        if ((block.level ?? 2) === 1) {
          const sourceBlockIds = sourceIdsForBlocks(blockMap, [block]);
          slides.push({
            id: `plan-slide-${slides.length + 1}`,
            kind: slides.length === 0 ? "cover" : "section",
            sourceBlockIds,
            slotSources:
              sourceBlockIds.length > 0 ? { title: sourceBlockIds } : {},
            slots: { title: { type: "shortText", text: title } },
          });
          sectionTitle = title;
          sectionTitleSource = block;
          pendingTitle = "";
          pendingTitleSource = undefined;
          continue;
        }

        pendingTitle = title;
        pendingTitleSource = block;
        continue;
      }

      if (block.blockType === "hr") {
        flushText();
        pendingTitle = sectionTitle || DEFAULT_DERIVE_TITLE;
        pendingTitleSource = sectionTitleSource;
        continue;
      }

      if (isNonEmptyTextBlock(block)) {
        if (!pendingTitle) {
          pendingTitle = sectionTitle || DEFAULT_DERIVE_TITLE;
          pendingTitleSource =
            pendingTitleSource ?? sectionTitleSource ?? block;
        }
        pendingBodyBlocks.push(block);
      }
      continue;
    }

    flushText();

    if (block.kind === "table") {
      const sourceBlockIds = sourceIdsForBlocks(blockMap, [block]);
      const tableTitle = sectionTitle || DEFAULT_TABLE_TITLE;
      slides.push({
        id: `plan-slide-${slides.length + 1}`,
        kind: "table",
        sourceBlockIds,
        slotSources: {
          ...(sourceBlockIds.length > 0 ? { title: sourceBlockIds } : {}),
          ...(sourceBlockIds.length > 0 ? { table: sourceBlockIds } : {}),
          ...(block.caption && sourceBlockIds.length > 0
            ? { caption: sourceBlockIds }
            : {}),
        },
        slots: {
          title: { type: "shortText", text: tableTitle },
          table: buildTableSlot(block),
          ...(block.caption
            ? { caption: { type: "shortText", text: block.caption } }
            : {}),
        },
      });
      continue;
    }

    const sourceBlockIds = sourceIdsForBlocks(blockMap, [block]);
    const visualTitle =
      block.visual.title?.trim() || sectionTitle || DEFAULT_VISUAL_TITLE;
    const caption = block.visual.type ? String(block.visual.type) : undefined;
    slides.push({
      id: `plan-slide-${slides.length + 1}`,
      kind: "visual-focus",
      sourceBlockIds,
      slotSources: {
        ...(sourceBlockIds.length > 0 ? { title: sourceBlockIds } : {}),
        ...(sourceBlockIds.length > 0 ? { visualId: sourceBlockIds } : {}),
        ...(caption && sourceBlockIds.length > 0
          ? { caption: sourceBlockIds }
          : {}),
      },
      slots: {
        title: { type: "shortText", text: visualTitle },
        visualId: { type: "visual", visualId: block.visualId },
        ...(caption ? { caption: { type: "shortText", text: caption } } : {}),
      },
    });
  }

  flushText();
  return {
    planVersion: 1,
    planner: "deterministic",
    mode: "faithful",
    source: {
      ...(sourcePlan.documentId ? { documentId: sourcePlan.documentId } : {}),
      contentHash: sourcePlan.contentHash,
      truncated: sourcePlan.truncated,
    },
    slides,
  };
}

export function documentSlidePlanToSemanticDeckPlan(
  plan: DocumentSlidePlanV1,
): SemanticDeckPlanV1 {
  return {
    planVersion: 1,
    ...(plan.title ? { title: plan.title } : {}),
    ...(plan.locale ? { locale: plan.locale } : {}),
    slides: plan.slides.map(
      (slide): SemanticSlideSpecV1 => ({
        kind: slide.kind,
        ...(slide.controls?.tone ? { tone: slide.controls.tone } : {}),
        ...(slide.controls?.density ? { density: slide.controls.density } : {}),
        ...(slide.controls?.emphasis
          ? { emphasis: slide.controls.emphasis }
          : {}),
        slots: slide.slots,
        ...(slide.speakerNotes ? { speakerNotes: slide.speakerNotes } : {}),
      }),
    ),
  };
}

export function semanticDeckPlanToDocumentSlidePlan({
  semanticPlan,
  sourcePlan,
  planner,
  mode,
}: {
  semanticPlan: SemanticDeckPlanV1;
  sourcePlan: DocumentSourcePlanV1;
  planner: DocumentSlidePlanner;
  mode: DocumentSlideMode;
}): DocumentSlidePlanV1 {
  return {
    planVersion: 1,
    planner,
    mode,
    ...(semanticPlan.title ? { title: semanticPlan.title } : {}),
    ...(semanticPlan.locale ? { locale: semanticPlan.locale } : {}),
    source: {
      ...(sourcePlan.documentId ? { documentId: sourcePlan.documentId } : {}),
      contentHash: sourcePlan.contentHash,
      truncated: sourcePlan.truncated,
    },
    slides: semanticPlan.slides.map(
      (slide, index): DocumentPlannedSlideV1 => ({
        id: `plan-slide-${index + 1}`,
        kind: slide.kind,
        sourceBlockIds: [],
        slotSources: {},
        slots: slide.slots,
        ...((slide.tone || slide.density || slide.emphasis) && {
          controls: {
            ...(slide.tone ? { tone: slide.tone } : {}),
            ...(slide.density ? { density: slide.density } : {}),
            ...(slide.emphasis ? { emphasis: slide.emphasis } : {}),
          },
        }),
        ...(slide.speakerNotes ? { speakerNotes: slide.speakerNotes } : {}),
      }),
    ),
  };
}
