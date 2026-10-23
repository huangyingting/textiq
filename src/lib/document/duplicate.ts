import type { Prisma } from "@/generated/prisma/client";
import type { AssetStorageAdapter } from "@/lib/assets/storage";
import { calculateAssetChecksum } from "@/lib/assets/store";
import { regenerateBlockIds } from "@/lib/lexical/block-id";
import {
  safeParseDeck,
  safeParseCurrentDeck,
} from "@/lib/document/deck-schema";
import type {
  CurrentDeck,
  CurrentSlideChildNode,
} from "@/lib/document/deck-schema";
import type { Deck, SlideElement, SourceRef } from "@/lib/document/deck-model";
import {
  createDocumentWithCanonicalContent,
  updateDocumentMetadata,
} from "@/lib/document/document-write-port";
import { generateRevisionToken } from "@/lib/document/deck-revision-token";
import { mapNodes } from "@/lib/presentation/node-tree-ops";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/log";
import { collectDeckAssetRefs } from "@/lib/slides/asset-orphan";
import {
  deriveStorageKey,
  getDefaultStorageAdapter,
} from "@/lib/slides/asset-storage";

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
type DuplicateTransaction = Parameters<
  Parameters<DuplicateDocumentDb["$transaction"]>[0]
>[0];

export type DuplicatedDocument = { id: string };

const ASSET_REGISTRIES = new Set(["images", "files", "visuals"]);
const ASSET_URL_BASE = "https://textiq.invalid";

function assetUrlIdentity(value: string): string | null {
  if (!URL.canParse(value, ASSET_URL_BASE)) return null;
  const url = new URL(value, ASSET_URL_BASE);
  url.search = "";
  url.hash = "";
  return url.href;
}

function remapCopiedAssets(
  value: Prisma.JsonValue,
  ids: ReadonlyMap<string, string>,
  urls: ReadonlyMap<string, string>,
  path: readonly string[] = [],
): Prisma.JsonValue {
  if (Array.isArray(value)) {
    return value.map((child) => remapCopiedAssets(child, ids, urls, path));
  }
  if (value === null || typeof value !== "object") return value;

  const registry = path[0] === "assets" && ASSET_REGISTRIES.has(path[1] ?? "");
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (child === undefined) return [];
      let next = remapCopiedAssets(child, ids, urls, [...path, key]);
      if (typeof child === "string") {
        if (
          key === "assetId" ||
          (registry && path.length === 3 && key === "id")
        ) {
          next = ids.get(child) ?? child;
        } else if (key === "src") {
          const identity = assetUrlIdentity(child);
          next = (identity ? urls.get(identity) : undefined) ?? child;
        }
      }
      const nextKey =
        registry && path.length === 2 ? (ids.get(key) ?? key) : key;
      return [[nextKey, next]];
    }),
  );
}

async function copyDeckAssets(
  tx: DuplicateTransaction,
  sourceDocumentId: string,
  targetDocumentId: string,
  deckJson: Prisma.JsonValue,
  storage: AssetStorageAdapter,
  copiedKeys: string[],
): Promise<Prisma.JsonValue> {
  const references = collectDeckAssetRefs(deckJson);
  if (references.size === 0) return deckJson;
  const assets = await tx.asset.findMany({
    where: {
      documentId: sourceDocumentId,
      id: { in: [...references] },
      deletedAt: null,
    },
  });
  const ids = new Map<string, string>();
  const urls = new Map<string, string>();
  for (const asset of assets) {
    const bytes = await storage.read(asset.storageKey);
    if (calculateAssetChecksum(bytes) !== asset.checksum) {
      throw new Error(
        "Cannot duplicate an asset whose stored bytes are corrupted.",
      );
    }
    const storageKey = deriveStorageKey(
      targetDocumentId,
      asset.checksum,
      asset.mimeType,
    );
    copiedKeys.push(storageKey);
    const url = await storage.store(storageKey, bytes, asset.mimeType);
    const copied = await tx.asset.create({
      data: {
        documentId: targetDocumentId,
        mimeType: asset.mimeType,
        byteSize: bytes.byteLength,
        checksum: asset.checksum,
        storageKey,
        widthPx: asset.widthPx,
        heightPx: asset.heightPx,
        originalName: asset.originalName,
      },
      select: { id: true },
    });
    ids.set(asset.id, copied.id);
    const sourceUrl = assetUrlIdentity(storage.urlFor(asset.storageKey));
    if (sourceUrl) urls.set(sourceUrl, url);
  }
  return remapCopiedAssets(deckJson, ids, urls);
}

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

function remapV7NodeSourceRef(
  node: CurrentSlideChildNode,
  sourceDocumentId: string,
  targetDocumentId: string,
  bidMap: Map<string, string>,
): CurrentSlideChildNode {
  const source = node.source;
  if (source?.documentId !== sourceDocumentId) return node;
  const { blockId } = source;
  if (blockId === undefined) return node;
  const newBlockId = bidMap.get(blockId);
  if (!newBlockId) return node;
  return {
    ...node,
    source: { ...source, documentId: targetDocumentId, blockId: newBlockId },
  };
}

export function remapDeckSourceRefs(
  deckJson: unknown,
  sourceDocumentId: string,
  targetDocumentId: string,
  bidMap: Map<string, string>,
): unknown {
  if (bidMap.size === 0) return deckJson;

  const currentParsed = safeParseCurrentDeck(deckJson);
  if (currentParsed.success) {
    const deck: CurrentDeck = {
      ...currentParsed.data,
      slides: currentParsed.data.slides.map((slide) => ({
        ...slide,
        children: mapNodes(slide.children, (node) =>
          remapV7NodeSourceRef(
            node,
            sourceDocumentId,
            targetDocumentId,
            bidMap,
          ),
        ),
      })),
    };
    return deck;
  }

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

export function buildDuplicateDocumentCreateInput(
  source: DuplicateDocumentSource,
  ownerId: string,
  contentJson: Prisma.JsonValue | null,
  bidMap: Map<string, string>,
) {
  const data = {
    ownerId,
    title: `${source.title} (copy)`,
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
  return contentJson == null
    ? { data }
    : { data, contentSnapshot: contentJson };
}

export async function duplicateDocumentForUser(
  userId: string,
  sourceDocumentId: string,
  db: DuplicateDocumentDb = prisma,
  storage: AssetStorageAdapter = getDefaultStorageAdapter(),
): Promise<DuplicatedDocument | null> {
  const copiedKeys: string[] = [];
  try {
    return await db.$transaction(
      async (tx) => {
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
          const result = regenerateBlockIds(source.contentJson);
          contentJson = result.updated as Prisma.JsonValue;
          bidMap = result.bidMap;
        }

        const document = await createDocumentWithCanonicalContent<{
          id: string;
        }>(tx, {
          ...buildDuplicateDocumentCreateInput(
            source,
            userId,
            contentJson,
            bidMap,
          ),
          select: { id: true },
        });

        if (source.deckJson != null) {
          let deckJson = remapDeckSourceRefs(
            source.deckJson,
            sourceDocumentId,
            document.id,
            bidMap,
          ) as Prisma.JsonValue;
          if (safeParseCurrentDeck(deckJson).success) {
            deckJson = await copyDeckAssets(
              tx,
              sourceDocumentId,
              document.id,
              deckJson,
              storage,
              copiedKeys,
            );
          }

          await updateDocumentMetadata(tx, {
            where: { id: document.id },
            data: {
              deckJson: cloneJsonForCreate(deckJson),
              deckRevisionToken: generateRevisionToken(),
            },
            select: { id: true },
          });
        }

        return document;
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    for (const storageKey of copiedKeys) {
      try {
        await storage.delete(storageKey);
      } catch (cleanupError) {
        logError("document.duplicate", cleanupError, {
          documentId: sourceDocumentId,
          operation: "asset_cleanup",
        });
      }
    }
    throw error;
  }
}
