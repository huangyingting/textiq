import type { Prisma } from "@/generated/prisma/client";
import { regenerateBlockIds } from "@/lib/lexical/block-id";
import { safeParseDeck } from "@/lib/document/deck-schema";
import type { Deck, SlideElement, SourceRef } from "@/lib/document/deck-model";
import { prisma } from "@/lib/prisma";

const duplicateDocumentSourceSelect = {
  /* Coverage rationale: duplicate source select literal is asserted through duplicate tests; tsx maps literal head as uncovered. */
  /* node:coverage ignore next 4 */
  title: true,
  contentJson: true,
  deckJson: true,
  visuals: {
    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
    select: {
      anchorBlockId: true,
      orderIndex: true,
      type: true,
      title: true,
      data: true,
    },
  },
} satisfies Prisma.DocumentSelect;

type DuplicateDocumentSource = Prisma.DocumentGetPayload<{
  select: typeof duplicateDocumentSourceSelect;
}>;

type DuplicateDocumentDb = Pick<typeof prisma, "$transaction">;

export type DuplicatedDocument = { id: string };

function cloneJsonForCreate(value: Prisma.JsonValue): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function remapAnchorBlockId(
  anchorBlockId: string | null,
  bidMap: Map<string, string>,
): string | null {
  if (!anchorBlockId) return anchorBlockId;
  return bidMap.get(anchorBlockId) ?? anchorBlockId;
}

function remapSourceRef(
  ref: SourceRef | undefined,
  sourceDocumentId: string,
  targetDocumentId: string,
  bidMap: Map<string, string>,
): SourceRef | undefined {
  if (ref?.documentId !== sourceDocumentId) return ref;
  const blockId = bidMap.get(ref.blockId);
  if (!blockId) return ref;
  return { ...ref, documentId: targetDocumentId, blockId };
}

function remapElementSourceRef(
  element: SlideElement,
  sourceDocumentId: string,
  targetDocumentId: string,
  bidMap: Map<string, string>,
): SlideElement {
  const currentSource = element.source;
  const sourceRef = remapSourceRef(
    currentSource,
    sourceDocumentId,
    targetDocumentId,
    bidMap,
  );
  return sourceRef === currentSource
    ? element
    : { ...element, source: sourceRef };
}

export function remapDeckSourceRefs(
  deckJson: unknown,
  sourceDocumentId: string,
  targetDocumentId: string,
  bidMap: Map<string, string>,
): unknown {
  if (bidMap.size === 0) return deckJson;

  const parsed = safeParseDeck(deckJson);
  if (!parsed.success) return deckJson;

  const deck: Deck = {
    ...parsed.data,
    slides: parsed.data.slides.map((slide) => ({
      ...slide,
      elements: slide.elements?.map((element) =>
        remapElementSourceRef(
          element,
          sourceDocumentId,
          targetDocumentId,
          bidMap,
        ),
      ),
    })),
  };

  return deck;
}

export function buildDuplicateDocumentCreateData(
  source: DuplicateDocumentSource,
  ownerId: string,
  contentJson: Prisma.JsonValue | null,
  bidMap: Map<string, string>,
) {
  // Document.content (the plaintext mirror) is deprecated — stop writing it.
  // Physical column drop is a follow-up migration.
  return {
    ownerId,
    title: `${source.title} (copy)`,
    ...(contentJson != null && {
      contentJson: cloneJsonForCreate(contentJson),
    }),
    visuals: {
      create: source.visuals.map((visual) => ({
        anchorBlockId: remapAnchorBlockId(visual.anchorBlockId, bidMap),
        orderIndex: visual.orderIndex,
        type: visual.type,
        title: visual.title,
        data: cloneJsonForCreate(visual.data),
      })),
    },
  };
}

export async function duplicateDocumentForUser(
  userId: string,
  sourceDocumentId: string,
  db: DuplicateDocumentDb = prisma,
): Promise<DuplicatedDocument | null> {
  return db.$transaction(async (tx) => {
    const source = await tx.document.findFirst({
      where: {
        id: sourceDocumentId,
        deletedAt: null,
      },
      select: duplicateDocumentSourceSelect,
    });

    if (!source) return null;

    let contentJson: Prisma.JsonValue | null = source.contentJson;
    let bidMap = new Map<string, string>();
    if (source.contentJson != null) {
      /* node:coverage ignore next 2 -- Block-id regeneration is asserted; tsx maps destructuring assignment as uncovered. */
      const result = regenerateBlockIds(source.contentJson);
      contentJson = result.updated as Prisma.JsonValue;
      bidMap = result.bidMap;
    }

    const document = await tx.document.create({
      /* Coverage rationale: duplicate create payload is asserted; tsx maps multiline helper args as uncovered. */
      /* node:coverage ignore next 6 */
      data: buildDuplicateDocumentCreateData(
        source,
        userId,
        contentJson,
        bidMap,
      ),
      select: { id: true },
    });

    if (source.deckJson != null) {
      const deckJson = remapDeckSourceRefs(
        source.deckJson,
        sourceDocumentId,
        document.id,
        bidMap,
      ) as Prisma.JsonValue;

      await tx.document.update({
        where: { id: document.id },
        data: { deckJson: cloneJsonForCreate(deckJson) },
        select: { id: true },
      });
    }

    return document;
  });
}
