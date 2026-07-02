import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDuplicateDocumentCreateData,
  duplicateDocumentForUser,
  remapDeckSourceRefs,
} from "./duplicate";
import { LEGACY_DECK_SCHEMA_VERSION } from "./deck-kernel/deck";

const sourceRef = {
  documentId: "source-doc",
  blockId: "old-bid",
  linkedAt: "2026-06-25T00:00:00.000Z",
  blockKind: "text" as const,
};

function deckWithSourceRefs() {
  return {
    schemaVersion: LEGACY_DECK_SCHEMA_VERSION,
    canvas: { format: "16:9" },
    design: { themeId: "default" },
    masters: [{ id: "master-default", name: "Default", elements: [] }],
    defaultMasterId: "master-default",
    slides: [
      {
        id: "slide-1",
        index: 0,
        title: "",
        notes: "",
        elements: [
          {
            id: "el-linked",
            kind: "visual",
            role: "visual",
            content: { kind: "visual", visualId: "visual-1" },
            box: { x: 0, y: 0, w: 10, h: 10 },
            zIndex: 1,
            source: sourceRef,
          },
          {
            id: "el-other-doc",
            kind: "visual",
            role: "visual",
            content: { kind: "visual", visualId: "visual-2" },
            box: { x: 10, y: 10, w: 10, h: 10 },
            zIndex: 2,
            source: { ...sourceRef, documentId: "other-doc" },
          },
        ],
      },
    ],
  };
}

test("remapDeckSourceRefs updates source document id and regenerated block id", () => {
  const remapped = remapDeckSourceRefs(
    deckWithSourceRefs(),
    "source-doc",
    "copy-doc",
    new Map([["old-bid", "new-bid"]]),
  ) as ReturnType<typeof deckWithSourceRefs>;

  const linked = (remapped.slides[0]!.elements[0]! as any).source!;
  assert.equal(linked.documentId, "copy-doc");
  assert.equal(linked.blockId, "new-bid");
  assert.equal(linked.blockKind, "text");

  const other = (remapped.slides[0]!.elements[1]! as any).source!;
  assert.equal(other.documentId, "other-doc");
  assert.equal(other.blockId, "old-bid");
});

test("remapDeckSourceRefs returns the original deck when there is nothing to remap", () => {
  const deck = deckWithSourceRefs();
  const invalidDeck = { not: "a deck" };

  assert.equal(
    remapDeckSourceRefs(deck, "source-doc", "copy-doc", new Map()),
    deck,
  );
  assert.equal(
    remapDeckSourceRefs(
      invalidDeck,
      "source-doc",
      "copy-doc",
      new Map([["old-bid", "new-bid"]]),
    ),
    invalidDeck,
  );
});

test("remapDeckSourceRefs preserves source refs when the block id was not regenerated", () => {
  const remapped = remapDeckSourceRefs(
    deckWithSourceRefs(),
    "source-doc",
    "copy-doc",
    new Map([["different-bid", "new-bid"]]),
  ) as ReturnType<typeof deckWithSourceRefs>;

  const linked = (remapped.slides[0]!.elements[0]! as any).source!;
  assert.equal(linked.documentId, "source-doc");
  assert.equal(linked.blockId, "old-bid");
});

test("duplicate create data is private and clones visuals without comments or share state", () => {
  const data = buildDuplicateDocumentCreateData(
    {
      title: "Source",
      contentJson: { root: { children: [] } },
      deckJson: null,
      visuals: [
        {
          anchorBlockId: "old-bid",
          orderIndex: 0,
          type: "flowchart",
          title: "Visual",
          data: { kind: "flowchart" },
        },
      ],
    },
    "user-1",
    { root: { children: [] } },
    new Map([["old-bid", "new-bid"]]),
  );

  assert.equal(data.ownerId, "user-1");
  assert.equal(data.title, "Source (copy)");
  assert.equal(data.visuals.create[0]!.anchorBlockId, "new-bid");
  assert.equal("isShared" in data, false);
  assert.equal("shareId" in data, false);
  assert.equal("comments" in data, false);
  assert.equal("tags" in data, false);
});

test("duplicate create data omits contentJson when source content is null", () => {
  const data = buildDuplicateDocumentCreateData(
    {
      title: "Draft",
      contentJson: null,
      deckJson: null,
      visuals: [
        {
          anchorBlockId: null,
          orderIndex: 0,
          type: "flowchart",
          title: "Floating visual",
          data: { kind: "flowchart" },
        },
      ],
    },
    "user-1",
    null,
    new Map(),
  );

  assert.equal("contentJson" in data, false);
  assert.equal(data.visuals.create[0]!.anchorBlockId, null);
});

test("duplicateDocumentForUser returns null when the source document is missing", async () => {
  const db = {
    $transaction: async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        document: {
          findFirst: async () => null,
        },
      }),
  };

  assert.equal(
    await duplicateDocumentForUser("user-1", "missing", db as never),
    null,
  );
});

test("duplicateDocumentForUser regenerates content block ids and remaps deck source refs", async () => {
  const createdData: unknown[] = [];
  const updatedData: unknown[] = [];
  const sourceContent = {
    root: {
      type: "root",
      children: [{ type: "paragraph", bid: "old-bid", children: [] }],
    },
  };
  const db = {
    $transaction: async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        document: {
          findFirst: async () => ({
            title: "Source",
            contentJson: sourceContent,
            deckJson: deckWithSourceRefs(),
            visuals: [
              {
                anchorBlockId: "old-bid",
                orderIndex: 0,
                type: "flowchart",
                title: "Visual",
                data: { kind: "flowchart" },
              },
            ],
          }),
          create: async ({ data }: { data: unknown }) => {
            createdData.push(data);
            return { id: "copy-doc" };
          },
          update: async ({ data }: { data: any }) => {
            updatedData.push(data);
            return { id: "copy-doc" };
          },
        },
      }),
  };

  const result = await duplicateDocumentForUser(
    "user-1",
    "source-doc",
    db as never,
  );

  assert.deepEqual(result, { id: "copy-doc" });
  const createData = createdData[0] as any;
  const newBid = createData.contentJson.root.children[0].bid;
  assert.notEqual(newBid, "old-bid");
  assert.equal(createData.visuals.create[0].anchorBlockId, newBid);
  const deckUpdate = updatedData[0] as any;
  assert.equal(
    deckUpdate.deckJson.slides[0].elements[0].source.documentId,
    "copy-doc",
  );
  assert.equal(
    deckUpdate.deckJson.slides[0].elements[0].source.blockId,
    newBid,
  );
});
