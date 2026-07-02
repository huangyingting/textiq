/**
 * Tests for the document persistence service (#470, #474).
 *
 * Covers:
 *  - Atomicity: `mirrorVisualNodesInTx` runs inside the same transaction as
 *    the `contentJson` write, so a mirror failure rolls back both.
 *  - `sanitizeRestoredDeck` strips orphaned visual refs.
 *  - Service boundary: `mirrorVisualNodesInTx` accepts a caller-supplied tx.
 *
 * All tests are pure (no real DB) — they use in-memory stubs for the
 * `Prisma.TransactionClient` interface to verify transaction boundaries.
 */

// e2e-governance-allow oversized-test: persistence service transaction matrix stays centralized until split fixtures are extracted.

import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { Prisma } from "@/generated/prisma/client";

import {
  atomicSaveDocumentLexical,
  mirrorVisualNodesInTx,
  patchDeck,
  persistDeck,
  regenerateDocumentShareLink,
  rebuildMirror,
  reconcileDeckAfterMirror,
  revalidateSharePaths,
  restoreVersion,
  setDocumentSharing,
  sanitizeRestoredDeck,
  updateDocumentSharePolicyData,
} from "./persistence-service";
import { LEGACY_DECK_SCHEMA_VERSION } from "./deck-kernel/deck";
import { prisma } from "@/lib/prisma";
import type { DeckPatch } from "@/lib/commands/deck-command-contracts";
import * as persistenceService from "./persistence-service";
import { writeDeckWithCas, type DeckCasDb } from "./deck-cas-writer";
import { snapshotDocumentVersion } from "./persistence/helpers";

// ---------------------------------------------------------------------------
// mirrorVisualNodesInTx — shared transaction boundary
// ---------------------------------------------------------------------------

/**
 * Builds a minimal stub that satisfies the `Prisma.TransactionClient` shape
 * used by `mirrorVisualNodesInTx`.  We record every call so tests can assert
 * that the function ran against this specific tx and NOT a fresh prisma client.
 */
function makeStubTx(
  existingRows: Array<{
    id: string;
    anchorBlockId: string | null;
    orderIndex: number;
    data: Prisma.JsonValue;
    type: string;
    title: string | null;
    createdAt: Date;
  }> = [],
  staleRevisionIds: string[] = [],
) {
  const calls: string[] = [];
  const payloads: Array<{ method: string; args: unknown }> = [];

  const tx = {
    visual: {
      findMany: async () => {
        calls.push("visual.findMany");
        return existingRows;
      },
      upsert: async (args: unknown) => {
        calls.push("visual.upsert");
        payloads.push({ method: "visual.upsert", args });
        return {};
      },
      update: async (args: unknown) => {
        calls.push("visual.update");
        payloads.push({ method: "visual.update", args });
        return {};
      },
      deleteMany: async (args: unknown) => {
        calls.push("visual.deleteMany");
        payloads.push({ method: "visual.deleteMany", args });
        return {};
      },
    },
    visualRevision: {
      create: async (args: unknown) => {
        calls.push("visualRevision.create");
        payloads.push({ method: "visualRevision.create", args });
        return {};
      },
      findMany: async () => {
        calls.push("visualRevision.findMany");
        return staleRevisionIds.map((id) => ({ id }));
      },
      deleteMany: async (args: unknown) => {
        calls.push("visualRevision.deleteMany");
        payloads.push({ method: "visualRevision.deleteMany", args });
        return {};
      },
    },
    _calls: calls,
    _payloads: payloads,
  } as unknown as Prisma.TransactionClient & {
    _calls: string[];
    _payloads: Array<{ method: string; args: unknown }>;
  };

  return tx;
}

function stubPrismaMethod<T extends object, K extends keyof T>(
  t: { after: (fn: () => void) => void },
  object: T,
  methodName: K,
  implementation: (...args: any[]) => unknown,
): { calls: unknown[][] } {
  const original = object[methodName];
  const calls: unknown[][] = [];
  const wrapped = (...args: unknown[]) => {
    calls.push(args);
    return (implementation as (...args: unknown[]) => unknown)(...args);
  };
  Object.defineProperty(object, methodName, {
    value: wrapped,
    configurable: true,
  });
  t.after(() => {
    Object.defineProperty(object, methodName, {
      value: original,
      configurable: true,
    });
  });
  return { calls };
}

/** Minimal serialized Lexical state with no visual nodes. */
const EMPTY_LEXICAL_STATE = {
  root: {
    children: [],
    direction: "ltr",
    format: "",
    indent: 0,
    type: "root",
    version: 1,
  },
};

describe("mirrorVisualNodesInTx: uses the caller-supplied tx", () => {
  test("calls visual.findMany on the provided tx, not a separate client", async () => {
    const tx = makeStubTx();
    await mirrorVisualNodesInTx(tx, "doc-test-1", EMPTY_LEXICAL_STATE);
    assert.ok(
      tx._calls.includes("visual.findMany"),
      "findMany should have been called on the stub tx",
    );
  });

  test("returns zero outcome for an empty Lexical state", async () => {
    const tx = makeStubTx();
    const outcome = await mirrorVisualNodesInTx(
      tx,
      "doc-test-2",
      EMPTY_LEXICAL_STATE,
    );
    assert.equal(outcome.created, 0);
    assert.equal(outcome.updated, 0);
    assert.equal(outcome.deleted, 0);
    assert.equal(outcome.skipped, 0);
    assert.equal(outcome.invalid, 0);
  });
});

describe("mirrorVisualNodesInTx: rollback simulation", () => {
  test("mirror failure on a throwing tx propagates the error (atomicity)", async () => {
    const throwingTx = {
      visual: {
        findMany: async () => {
          throw new Error("Simulated DB failure");
        },
      },
    } as unknown as Prisma.TransactionClient;

    await assert.rejects(
      () => mirrorVisualNodesInTx(throwingTx, "doc-fail", EMPTY_LEXICAL_STATE),
      (err: Error) => {
        assert.equal(err.message, "Simulated DB failure");
        return true;
      },
      "mirror error should propagate so the outer transaction rolls back",
    );
  });
});

function lexicalStateWithVisuals(
  visualIds: string[],
  labelPrefix = "Node",
): unknown {
  return {
    root: {
      children: visualIds.map((visualId, index) => ({
        type: "visual",
        visualId,
        visual: {
          version: 1,
          type: "flowchart",
          title: `${labelPrefix} ${index + 1}`,
          width: 760,
          height: 480,
          nodes: [
            { id: `n${index + 1}`, label: `${labelPrefix} ${index + 1}` },
          ],
          edges: [],
        },
      })),
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  };
}

describe("mirrorVisualNodesInTx: visual mirror diff writes", () => {
  test("creates new rows and counts blank visual ids as invalid", async () => {
    const tx = makeStubTx();
    const base = lexicalStateWithVisuals([" vis-create "]) as any;
    const outcome = await mirrorVisualNodesInTx(tx, "doc-create", {
      root: {
        ...base.root,
        children: [
          ...base.root.children,
          {
            type: "visual",
            visualId: "   ",
            visual: {
              version: 1,
              type: "flowchart",
              width: 760,
              height: 480,
              nodes: [],
              edges: [],
            },
          },
        ],
      },
    });

    assert.equal(outcome.created, 1);
    assert.equal(outcome.invalid, 1);
    assert.ok(tx._calls.includes("visual.upsert"));
    assert.equal(
      (tx._payloads.find((p) => p.method === "visual.upsert")?.args as any)
        .create.anchorBlockId,
      "vis-create",
    );
  });

  test("snapshots payload changes, prunes stale revisions, and deletes missing rows", async () => {
    const previousVisual = {
      version: 1,
      type: "flowchart",
      title: "Old visual",
      width: 760,
      height: 480,
      nodes: [{ id: "n1", label: "Old" }],
      edges: [],
    };
    const tx = makeStubTx(
      [
        {
          id: "row-update",
          anchorBlockId: "vis-update",
          orderIndex: 1,
          data: previousVisual as Prisma.JsonValue,
          type: "FLOWCHART",
          title: "Old visual",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          id: "row-delete",
          anchorBlockId: "vis-delete",
          orderIndex: 0,
          data: previousVisual as Prisma.JsonValue,
          type: "FLOWCHART",
          title: "Deleted visual",
          createdAt: new Date("2026-01-02T00:00:00Z"),
        },
      ],
      ["rev-stale"],
    );

    const outcome = await mirrorVisualNodesInTx(
      tx,
      "doc-update",
      lexicalStateWithVisuals(["vis-update"], "New visual"),
    );

    assert.equal(outcome.updated, 1);
    assert.equal(outcome.deleted, 1);
    assert.ok(tx._calls.includes("visualRevision.create"));
    assert.ok(tx._calls.includes("visualRevision.deleteMany"));
    assert.ok(tx._calls.includes("visual.deleteMany"));
    assert.equal(
      (tx._payloads.find((p) => p.method === "visual.deleteMany")?.args as any)
        .where.id.in[0],
      "row-delete",
    );
  });

  test("updates only order when payload data is unchanged", async () => {
    const visual = {
      version: 1,
      type: "flowchart",
      title: "Node 1",
      width: 760,
      height: 480,
      nodes: [{ id: "n1", label: "Node 1" }],
      edges: [],
    };
    const tx = makeStubTx([
      {
        id: "row-reorder",
        anchorBlockId: "vis-reorder",
        orderIndex: 5,
        data: visual as Prisma.JsonValue,
        type: "FLOWCHART",
        title: "Node 1",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const outcome = await mirrorVisualNodesInTx(
      tx,
      "doc-reorder",
      lexicalStateWithVisuals(["vis-reorder"]),
    );

    assert.equal(outcome.updated, 1);
    assert.equal(tx._calls.includes("visualRevision.create"), false);
    assert.deepEqual(
      (tx._payloads.find((p) => p.method === "visual.update")?.args as any)
        .data,
      { orderIndex: 0 },
    );
  });
});

// ---------------------------------------------------------------------------
// sanitizeRestoredDeck
// ---------------------------------------------------------------------------

const VALID_DECK = {
  schemaVersion: LEGACY_DECK_SCHEMA_VERSION,
  canvas: { format: "16:9" },
  design: { themeId: "indigo" },
  masters: [{ id: "master-default", name: "Default", elements: [] }],
  defaultMasterId: "master-default",
  slides: [
    {
      id: "s1",
      title: "Slide 1",
      index: 0,
      notes: "",
      elements: [
        {
          id: "e1",
          kind: "visual",
          role: "visual",
          content: { kind: "visual", visualId: "vis-keep" },
          box: { x: 0, y: 0, w: 400, h: 300 },
          zIndex: 0,
        },
        {
          id: "e2",
          kind: "visual",
          role: "visual",
          content: { kind: "visual", visualId: "vis-drop" },
          box: { x: 0, y: 0, w: 400, h: 300 },
          zIndex: 1,
        },
      ],
    },
  ],
};

const VALID_DECK_V7 = {
  schemaVersion: 7,
  canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
  theme: { packageId: "neutral" },
  assets: { images: {} },
  slides: [
    {
      id: "slide-0001",
      type: "slide",
      template: { kind: "cover" },
      style: { ref: "slide.cover" },
      children: [],
    },
  ],
};

const VALID_RESTORE_DECK_V7 = {
  schemaVersion: 7,
  canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
  theme: { packageId: "neutral" },
  assets: {
    images: {},
    visuals: {
      "visual-asset-1": {
        id: "visual-asset-1",
        visualId: "asset-visual-id",
      },
    },
  },
  slides: [
    {
      id: "slide-restore-v7",
      type: "slide",
      template: { kind: "cover" },
      style: { ref: "slide.cover" },
      children: [
        {
          id: "visual-keep",
          type: "visual",
          layout: { frame: { x: 5, y: 8, w: 35, h: 28 }, zIndex: 1 },
          style: { ref: "chart.primary" },
          content: { visualId: "vis-keep" },
        },
        {
          id: "visual-drop",
          type: "visual",
          layout: { frame: { x: 42, y: 8, w: 35, h: 28 }, zIndex: 2 },
          style: { ref: "chart.primary" },
          content: { visualId: "vis-drop" },
        },
        {
          id: "group-1",
          type: "group",
          component: "custom",
          layout: { frame: { x: 8, y: 40, w: 84, h: 50 }, zIndex: 3 },
          style: { ref: "surface.card" },
          children: [
            {
              id: "group-visual-drop",
              type: "visual",
              layout: { frame: { x: 0, y: 0, w: 30, h: 30 }, zIndex: 1 },
              style: { ref: "chart.primary" },
              content: { visualId: "vis-group-drop" },
            },
            {
              id: "group-visual-asset",
              type: "visual",
              layout: { frame: { x: 35, y: 0, w: 30, h: 30 }, zIndex: 2 },
              style: { ref: "chart.primary" },
              content: {
                assetId: "visual-asset-1",
                visualId: "vis-asset-drop",
              },
            },
          ],
        },
      ],
    },
  ],
};

/** Minimal Lexical state carrying a single visual node with the given visualId. */
function lexicalStateWithVisual(visualId: string): unknown {
  return {
    root: {
      children: [
        {
          type: "visual",
          visualId,
          visual: {
            version: 1,
            type: "flowchart",
            width: 760,
            height: 480,
            nodes: [{ id: "n1", label: "Start" }],
            edges: [],
          },
        },
      ],
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  };
}

function collectDeckV7VisualIds(deck: any): string[] {
  const visualIds: string[] = [];
  const visit = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.type === "group") {
        visit(node.children ?? []);
        continue;
      }
      if (
        node.type === "visual" &&
        typeof node.content?.visualId === "string"
      ) {
        visualIds.push(node.content.visualId);
      }
    }
  };
  for (const slide of deck.slides ?? []) {
    visit(slide.children ?? []);
  }
  return visualIds;
}

describe("sanitizeRestoredDeck", () => {
  test("returns Prisma.DbNull when rawDeckJson is null", () => {
    const result = sanitizeRestoredDeck(null, EMPTY_LEXICAL_STATE);
    assert.equal(result, Prisma.DbNull);
  });

  test("strips orphaned visual element from restored deck", () => {
    // Restored content only has vis-keep; vis-drop is orphaned.
    const restoredContent = lexicalStateWithVisual("vis-keep");
    const result = sanitizeRestoredDeck(
      VALID_DECK as unknown as Prisma.JsonValue,
      restoredContent,
    );
    // The result should be a Prisma.InputJsonValue (not DbNull)
    assert.notEqual(result, Prisma.DbNull);
    const deck = result as typeof VALID_DECK;
    const elements = deck.slides[0].elements ?? [];
    const visIds = elements
      .filter((e) => e.kind === "visual")
      .map((e) => (e as any).content?.visualId);
    assert.ok(visIds.includes("vis-keep"), "vis-keep should remain");
    assert.ok(!visIds.includes("vis-drop"), "vis-drop should be stripped");
  });

  test("returns all visuals intact when all are known", () => {
    // Build a content with both vis-keep AND vis-drop.
    const restoredContent = {
      root: {
        children: [
          {
            type: "visual",
            visualId: "vis-keep",
            visual: {
              version: 1,
              type: "flowchart",
              width: 760,
              height: 480,
              nodes: [{ id: "n1", label: "A" }],
              edges: [],
            },
          },
          {
            type: "visual",
            visualId: "vis-drop",
            visual: {
              version: 1,
              type: "flowchart",
              width: 760,
              height: 480,
              nodes: [{ id: "n2", label: "B" }],
              edges: [],
            },
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "root",
        version: 1,
      },
    };
    const result = sanitizeRestoredDeck(
      VALID_DECK as unknown as Prisma.JsonValue,
      restoredContent,
    );
    assert.notEqual(result, Prisma.DbNull);
    const deck = result as typeof VALID_DECK;
    const elements = deck.slides[0].elements ?? [];
    // Both vis-keep and vis-drop are in the restored content, so both should remain.
    const visualElements = elements.filter((e) => e.kind === "visual");
    assert.equal(
      visualElements.length,
      2,
      "both visual elements should remain",
    );
  });

  test("reconciles DeckV7 child visual references during restore", () => {
    const restoredContent = lexicalStateWithVisual("vis-keep");
    const result = sanitizeRestoredDeck(
      VALID_RESTORE_DECK_V7 as unknown as Prisma.JsonValue,
      restoredContent,
    );

    assert.notEqual(result, Prisma.DbNull);
    const deck = result as any;
    const visualIds = collectDeckV7VisualIds(deck);
    assert.deepEqual(visualIds, ["vis-keep"]);

    const group = deck.slides[0].children.find(
      (node: any) => node.id === "group-1",
    );
    assert.ok(group, "group should remain");
    const assetNode = group.children.find(
      (node: any) => node.id === "group-visual-asset",
    );
    assert.ok(assetNode, "asset-backed visual node should remain");
    assert.equal(
      assetNode.content.visualId,
      undefined,
      "stale visualId should be stripped from asset-backed visual nodes",
    );
  });

  test("falls back to raw value when deckJson cannot be parsed", () => {
    const malformed = { not: "a valid deck" } as unknown as Prisma.JsonValue;
    const result = sanitizeRestoredDeck(malformed, EMPTY_LEXICAL_STATE);
    // Falls back to the raw value since safeParseDeck fails.
    assert.deepEqual(result, malformed);
  });
});

// ---------------------------------------------------------------------------
// Schema parse-failure telemetry (#504) — diagnostics without crashing
// ---------------------------------------------------------------------------

/** Captures every console.error JSON line emitted while `fn` runs. */
async function captureErrorLines(
  fn: () => void | Promise<void>,
): Promise<Record<string, unknown>[]> {
  const original = console.error;
  const records: Record<string, unknown>[] = [];
  console.error = (line?: unknown) => {
    try {
      records.push(JSON.parse(String(line)));
    } catch {
      // ignore non-JSON lines
    }
  };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return records;
}

describe("schema parse-failure telemetry", () => {
  test("sanitizeRestoredDeck emits a deck-parse-failed diagnostic and does not throw", async () => {
    const malformed = { not: "a valid deck" } as unknown as Prisma.JsonValue;
    let result: unknown;
    const records = await captureErrorLines(() => {
      result = sanitizeRestoredDeck(malformed, EMPTY_LEXICAL_STATE);
    });
    // Returns the raw value (flow not interrupted).
    assert.deepEqual(result, malformed);
    const diag = records.find((r) => r.category === "deck-parse-failed");
    assert.ok(diag, "expected a deck-parse-failed diagnostic");
    assert.equal(diag?.scope, "schema.persisted");
    // No document content leaked.
    const serialized = JSON.stringify(records);
    assert.ok(!serialized.includes("a valid deck"));
  });

  test("mirrorVisualNodesInTx emits content-visual-parse-failed for an invalid visual and keeps going", async () => {
    const stateWithBadVisual = {
      root: {
        children: [
          {
            type: "visual",
            visualId: "vis-bad",
            visual: { version: 1, type: "not-a-real-kind" },
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "root",
        version: 1,
      },
    };
    const { tx } = { tx: makeStubTx() };
    let outcome: Awaited<ReturnType<typeof mirrorVisualNodesInTx>> | undefined;
    const records = await captureErrorLines(async () => {
      outcome = await mirrorVisualNodesInTx(tx, "doc-1", stateWithBadVisual);
    });
    // The invalid node is skipped, not fatal.
    assert.ok(outcome);
    const diag = records.find(
      (r) => r.category === "content-visual-parse-failed",
    );
    assert.ok(diag, "expected a content-visual-parse-failed diagnostic");
    assert.equal(diag?.documentId, "doc-1");
    assert.equal(diag?.anchorBlockId, "vis-bad");
  });
});

// ---------------------------------------------------------------------------
// persistence/deck service boundaries
// ---------------------------------------------------------------------------

describe("deck persistence operations", () => {
  test("patchDeck returns not found before replaying patches", async (t) => {
    stubPrismaMethod(t, prisma.document, "findUnique", async () => null);

    const result = await patchDeck("doc-missing", [], null);

    assert.deepEqual(result, {
      ok: false,
      error: "Document not found.",
      failure: { code: "document_not_found", retryable: false },
    });
  });

  test("patchDeck returns fallback for existing documents", async (t) => {
    stubPrismaMethod(t, prisma.document, "findUnique", async () => ({
      id: "doc-fallback",
    }));
    const updateMany = stubPrismaMethod(
      t,
      prisma.document,
      "updateMany",
      async () => ({ count: 1 }),
    );

    const result = await patchDeck("doc-fallback", [], "client-token");

    assert.deepEqual(result, { ok: "fallback" });
    assert.equal(updateMany.calls.length, 0);
  });

  test("patchDeck returns fallback when a patch is not replayable", async (t) => {
    stubPrismaMethod(t, prisma.document, "findUnique", async () => ({
      deckJson: VALID_DECK,
      deckRevisionToken: "deck-token",
    }));

    const unsupportedPatch = {
      schemaVersion: LEGACY_DECK_SCHEMA_VERSION,
      op: "slide.add",
      slideIds: ["s2"],
    } as unknown as DeckPatch;

    const result = await patchDeck(
      "doc-fallback",
      [unsupportedPatch],
      "deck-token",
    );

    assert.deepEqual(result, { ok: "fallback" });
  });

  test("patchDeck returns fallback for replayable-looking patches with stale tokens", async (t) => {
    stubPrismaMethod(t, prisma.document, "findUnique", async () => ({
      id: "doc-fallback",
    }));
    const updateMany = stubPrismaMethod(
      t,
      prisma.document,
      "updateMany",
      async () => ({ count: 1 }),
    );

    const titlePatch = {
      schemaVersion: LEGACY_DECK_SCHEMA_VERSION,
      op: "slide.update_title",
      slideIds: ["s1"],
      slideFields: { s1: { title: "Stale token still falls back" } },
    } as unknown as DeckPatch;

    const result = await patchDeck(
      "doc-fallback",
      [titlePatch],
      "stale-client-token",
    );

    assert.deepEqual(result, { ok: "fallback" });
    assert.equal(updateMany.calls.length, 0);
  });

  test("patchDeck does not replay patches or snapshot documents", async (t) => {
    stubPrismaMethod(t, prisma.document, "findUnique", async () => ({
      id: "doc-patch",
    }));
    stubPrismaMethod(t, prisma.document, "updateMany", async () => ({
      count: 1,
    }));
    stubPrismaMethod(t, prisma.documentVersion, "findFirst", async () => null);
    const createVersion = stubPrismaMethod(
      t,
      prisma.documentVersion,
      "create",
      async () => ({}),
    );
    stubPrismaMethod(t, prisma.documentVersion, "findMany", async () => []);
    const deleteMany = stubPrismaMethod(
      t,
      prisma.documentVersion,
      "deleteMany",
      async () => ({}),
    );

    const titlePatch = {
      schemaVersion: LEGACY_DECK_SCHEMA_VERSION,
      op: "slide.update_title",
      slideIds: ["s1"],
      slideFields: { s1: { title: "Quarterly Readout" } },
    } as unknown as DeckPatch;

    const result = await patchDeck("doc-patch", [titlePatch], "deck-token", {
      userId: "user-editor",
    });

    assert.deepEqual(result, { ok: "fallback" });
    assert.equal(createVersion.calls.length, 0);
    assert.equal(deleteMany.calls.length, 0);
  });

  test("persistDeck validates input before writing", async () => {
    const result = await persistDeck("doc-invalid", { not: "a deck" }, null);

    assert.equal(result.ok, false);
    assert.match(result.error, /^Invalid deck:/);
  });

  test("persistDeck writes valid decks and snapshots on success", async (t) => {
    stubPrismaMethod(t, prisma.document, "updateMany", async () => ({
      count: 1,
    }));
    stubPrismaMethod(t, prisma.documentVersion, "findFirst", async () => null);
    stubPrismaMethod(t, prisma.document, "findUnique", async () => ({
      contentJson: EMPTY_LEXICAL_STATE,
      deckJson: VALID_DECK_V7,
    }));
    const createVersion = stubPrismaMethod(
      t,
      prisma.documentVersion,
      "create",
      async () => ({}),
    );
    stubPrismaMethod(t, prisma.documentVersion, "findMany", async () => []);
    stubPrismaMethod(t, prisma.documentVersion, "deleteMany", async () => ({}));
    stubPrismaMethod(t, prisma.comment, "findMany", async () => []);
    stubPrismaMethod(t, prisma.comment, "updateMany", async () => ({
      count: 0,
    }));

    const result = await persistDeck("doc-save", VALID_DECK_V7, null, {
      userId: "user-editor",
    });

    assert.equal(result.ok, true);
    assert.equal(createVersion.calls.length, 1);
  });

  test("persistDeck floats deleted-slide comment anchors after CAS success", async (t) => {
    const beforeDeck = {
      ...VALID_DECK_V7,
      slides: [
        {
          id: "slide-delete",
          type: "slide",
          template: { kind: "content" },
          style: { ref: "slide.content" },
          children: [],
        },
        {
          id: "slide-keep",
          type: "slide",
          template: { kind: "content" },
          style: { ref: "slide.content" },
          children: [],
        },
      ],
    };
    const nextDeck = {
      ...VALID_DECK_V7,
      slides: [beforeDeck.slides[1]],
    };

    stubPrismaMethod(t, prisma.document, "updateMany", async () => ({
      count: 1,
    }));
    stubPrismaMethod(t, prisma.document, "findUnique", async (args: any) => {
      if (args.select?.contentJson) {
        return { contentJson: EMPTY_LEXICAL_STATE, deckJson: nextDeck };
      }
      return { deckJson: beforeDeck };
    });
    stubPrismaMethod(t, prisma.documentVersion, "findFirst", async () => null);
    stubPrismaMethod(t, prisma.documentVersion, "create", async () => ({}));
    stubPrismaMethod(t, prisma.documentVersion, "findMany", async () => []);
    stubPrismaMethod(t, prisma.documentVersion, "deleteMany", async () => ({}));
    stubPrismaMethod(t, prisma.comment, "findMany", async () => []);
    const commentUpdateMany = stubPrismaMethod(
      t,
      prisma.comment,
      "updateMany",
      async () => ({ count: 1 }),
    );

    const result = await persistDeck("doc-slide-delete", nextDeck, null, {
      userId: "user-editor",
    });

    assert.equal(result.ok, true);
    assert.equal(commentUpdateMany.calls.length, 1);
    assert.deepEqual((commentUpdateMany.calls[0]![0] as any).where, {
      documentId: "doc-slide-delete",
      slideId: "slide-delete",
    });
    assert.deepEqual((commentUpdateMany.calls[0]![0] as any).data, {
      slideId: null,
      elementId: null,
      anchorGeometry: Prisma.DbNull,
    });
  });

  test("persistDeck floats deleted-node comment anchors to slide level after CAS success", async (t) => {
    const beforeDeck = {
      ...VALID_DECK_V7,
      slides: [
        {
          id: "slide-keep",
          type: "slide",
          template: { kind: "content" },
          style: { ref: "slide.content" },
          children: [
            {
              id: "node-delete",
              type: "text",
              role: "body",
              layout: { frame: { x: 5, y: 8, w: 40, h: 18 }, zIndex: 1 },
              style: { ref: "text.body" },
              content: { paragraphs: [{ id: "node-delete-p1", text: "" }] },
            },
            {
              id: "node-keep",
              type: "text",
              role: "body",
              layout: { frame: { x: 5, y: 30, w: 40, h: 18 }, zIndex: 2 },
              style: { ref: "text.body" },
              content: { paragraphs: [{ id: "node-keep-p1", text: "" }] },
            },
          ],
        },
      ],
    };
    const nextDeck = {
      ...beforeDeck,
      slides: [
        {
          ...beforeDeck.slides[0],
          children: [beforeDeck.slides[0].children[1]],
        },
      ],
    };

    stubPrismaMethod(t, prisma.document, "updateMany", async () => ({
      count: 1,
    }));
    stubPrismaMethod(t, prisma.document, "findUnique", async (args: any) => {
      if (args.select?.contentJson) {
        return { contentJson: EMPTY_LEXICAL_STATE, deckJson: nextDeck };
      }
      return { deckJson: beforeDeck };
    });
    stubPrismaMethod(t, prisma.documentVersion, "findFirst", async () => null);
    stubPrismaMethod(t, prisma.documentVersion, "create", async () => ({}));
    stubPrismaMethod(t, prisma.documentVersion, "findMany", async () => []);
    stubPrismaMethod(t, prisma.documentVersion, "deleteMany", async () => ({}));
    stubPrismaMethod(t, prisma.comment, "findMany", async () => []);
    const commentUpdateMany = stubPrismaMethod(
      t,
      prisma.comment,
      "updateMany",
      async () => ({ count: 1 }),
    );

    const result = await persistDeck("doc-node-delete", nextDeck, null, {
      userId: "user-editor",
    });

    assert.equal(result.ok, true);
    assert.equal(commentUpdateMany.calls.length, 1);
    assert.deepEqual((commentUpdateMany.calls[0]![0] as any).where, {
      documentId: "doc-node-delete",
      slideId: "slide-keep",
      elementId: { in: ["node-delete"] },
    });
    assert.deepEqual((commentUpdateMany.calls[0]![0] as any).data, {
      elementId: null,
    });
  });

  test("persistDeck floats orphaned current anchors when previous deck load fails", async (t) => {
    const nextDeck = {
      ...VALID_DECK_V7,
      slides: [
        {
          ...VALID_DECK_V7.slides[0],
          children: [
            {
              id: "node-keep",
              type: "text",
              role: "body",
              layout: { frame: { x: 5, y: 8, w: 40, h: 18 }, zIndex: 1 },
              style: { ref: "text.body" },
              content: { paragraphs: [{ id: "node-keep-p1", text: "" }] },
            },
          ],
        },
      ],
    };

    stubPrismaMethod(t, prisma.document, "updateMany", async () => ({
      count: 1,
    }));
    stubPrismaMethod(t, prisma.document, "findUnique", async (args: any) => {
      if (args.select?.deckJson && !args.select?.contentJson) {
        throw new Error("previous deck unavailable");
      }
      return { contentJson: EMPTY_LEXICAL_STATE, deckJson: nextDeck };
    });
    stubPrismaMethod(t, prisma.documentVersion, "findFirst", async () => null);
    stubPrismaMethod(t, prisma.documentVersion, "create", async () => ({}));
    stubPrismaMethod(t, prisma.documentVersion, "findMany", async () => []);
    stubPrismaMethod(t, prisma.documentVersion, "deleteMany", async () => ({}));
    stubPrismaMethod(t, prisma.comment, "findMany", async () => [
      { id: "defensive-null-slide", slideId: null, elementId: null },
      { id: "missing-slide", slideId: "slide-gone", elementId: null },
      {
        id: "missing-node",
        slideId: "slide-0001",
        elementId: "node-gone",
      },
      { id: "kept-node", slideId: "slide-0001", elementId: "node-keep" },
    ]);
    const commentUpdateMany = stubPrismaMethod(
      t,
      prisma.comment,
      "updateMany",
      async () => ({ count: 2 }),
    );

    const result = await persistDeck("doc-orphaned-current", nextDeck, null, {
      userId: "user-editor",
    });

    assert.equal(result.ok, true);
    assert.equal(commentUpdateMany.calls.length, 1);
    assert.deepEqual((commentUpdateMany.calls[0]![0] as any).where, {
      id: { in: ["missing-slide", "missing-node"] },
    });
    assert.deepEqual((commentUpdateMany.calls[0]![0] as any).data, {
      slideId: null,
      elementId: null,
      anchorGeometry: Prisma.DbNull,
    });
  });

  test("persistDeck does not reconcile comment anchors when CAS conflicts", async (t) => {
    const nextDeck = VALID_DECK_V7;

    stubPrismaMethod(t, prisma.document, "updateMany", async () => ({
      count: 0,
    }));
    stubPrismaMethod(t, prisma.document, "findUnique", async (args: any) => {
      if (args.select?.deckRevisionToken) {
        return { deckRevisionToken: "server-token" };
      }
      return { deckJson: nextDeck };
    });
    const commentFindMany = stubPrismaMethod(
      t,
      prisma.comment,
      "findMany",
      async () => [],
    );
    const commentUpdateMany = stubPrismaMethod(
      t,
      prisma.comment,
      "updateMany",
      async () => ({ count: 0 }),
    );

    const result = await persistDeck(
      "doc-conflict",
      nextDeck,
      "stale-client-token",
      {
        userId: "user-editor",
      },
    );

    assert.deepEqual(result, {
      ok: "conflict",
      serverRevisionToken: "server-token",
    });
    assert.equal(commentFindMany.calls.length, 0);
    assert.equal(commentUpdateMany.calls.length, 0);
  });

  test("patchDeck ignores invalid stored deck content and returns fallback", async (t) => {
    stubPrismaMethod(t, prisma.document, "findUnique", async () => ({
      id: "doc-invalid-stored",
    }));

    const result = await patchDeck("doc-invalid-stored", [], "deck-token");

    assert.deepEqual(result, { ok: "fallback" });
  });

  test("persistence-service closes command save export and keeps supported save exports", () => {
    assert.equal(typeof persistenceService.persistDeck, "function");
    assert.equal(typeof persistenceService.patchDeck, "function");
    assert.equal("persistDeckCommand" in persistenceService, false);
  });
});

// ---------------------------------------------------------------------------
// persistence/sharing service boundaries
// ---------------------------------------------------------------------------

describe("sharing persistence operations", () => {
  test("setDocumentSharing disables a public share and clears link fields", async (t) => {
    const update = stubPrismaMethod(t, prisma.document, "update", async () => ({
      isShared: false,
      shareId: null,
      slug: null,
      shareExpiresAt: null,
      shareEmbedEnabled: false,
      sharePresentEnabled: false,
      shareMetadataMode: "generic",
      shareDiscoverable: false,
    }));

    const result = await setDocumentSharing("doc-share", false);

    assert.equal(result.isShared, false);
    assert.equal(result.shareUrl, null);
    assert.equal((update.calls[0]![0] as any).data.shareId, null);
  });

  test("setDocumentSharing enables a share with a slugged public URL", async (t) => {
    stubPrismaMethod(t, prisma.document, "findFirst", async () => ({
      title: "Team Readout",
    }));
    stubPrismaMethod(t, prisma.document, "update", async (args: any) => ({
      isShared: true,
      shareId: args.data.shareId,
      slug: args.data.slug,
      shareExpiresAt: new Date("2026-07-01T00:00:00.000Z"),
      shareEmbedEnabled: true,
      sharePresentEnabled: true,
      shareMetadataMode: "title-excerpt",
      shareDiscoverable: true,
    }));

    const result = await setDocumentSharing("doc-share", true);

    assert.equal(result.isShared, true);
    assert.ok(result.shareId);
    assert.match(result.slug ?? "", /^team-readout-/);
    assert.match(result.shareUrl ?? "", /\/share\/team-readout-/);
    assert.equal(result.metadataMode, "title-excerpt");
    assert.equal(result.discoverable, true);
  });

  test("setDocumentSharing handles shared documents without a stored title", async (t) => {
    stubPrismaMethod(t, prisma.document, "findFirst", async () => null);
    stubPrismaMethod(t, prisma.document, "update", async (args: any) => ({
      isShared: true,
      shareId: args.data.shareId,
      slug: args.data.slug,
      shareExpiresAt: null,
      shareEmbedEnabled: false,
      sharePresentEnabled: false,
      shareMetadataMode: "generic",
      shareDiscoverable: false,
    }));

    const result = await setDocumentSharing("doc-untitled", true);

    assert.equal(result.isShared, true);
    assert.ok(result.shareId);
    assert.equal(result.slug, null);
    assert.equal(result.shareUrl, null);
  });

  test("setDocumentSharing retries share slug writes after unique collisions", async (t) => {
    stubPrismaMethod(t, prisma.document, "findFirst", async () => ({
      title: "Collision Deck",
    }));
    let attempts = 0;
    const update = stubPrismaMethod(
      t,
      prisma.document,
      "update",
      async (args: any) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Prisma.PrismaClientKnownRequestError("slug collision", {
            code: "P2002",
            clientVersion: "test",
          });
        }
        return {
          isShared: true,
          shareId: args.data.shareId,
          slug: args.data.slug,
          shareExpiresAt: null,
          shareEmbedEnabled: false,
          sharePresentEnabled: false,
          shareMetadataMode: "generic",
          shareDiscoverable: false,
        };
      },
    );

    const result = await setDocumentSharing("doc-collision", true);

    assert.equal(attempts, 2);
    assert.equal(update.calls.length, 2);
    assert.match(result.slug ?? "", /^collision-deck-/);
  });

  test("updateDocumentSharePolicyData normalizes invalid metadata modes", async (t) => {
    stubPrismaMethod(t, prisma.document, "update", async () => ({
      isShared: true,
      shareId: "share-policy",
      slug: "policy-deck",
      shareExpiresAt: null,
      shareEmbedEnabled: false,
      sharePresentEnabled: true,
      shareMetadataMode: "unexpected",
      shareDiscoverable: undefined,
    }));

    const result = await updateDocumentSharePolicyData("doc-policy", {
      shareMetadataMode: "unexpected",
    });

    assert.equal(result.metadataMode, "generic");
    assert.equal(result.discoverable, false);
    assert.match(result.shareUrl ?? "", /\/share\/policy-deck-share-policy$/);
  });

  test("regenerateDocumentShareLink returns null for private documents", async (t) => {
    stubPrismaMethod(t, prisma.document, "findFirst", async () => ({
      title: "Private Draft",
      isShared: false,
    }));

    const result = await regenerateDocumentShareLink("doc-private");

    assert.equal(result, null);
  });

  test("regenerateDocumentShareLink returns null when the document is missing", async (t) => {
    stubPrismaMethod(t, prisma.document, "findFirst", async () => null);

    const result = await regenerateDocumentShareLink("doc-missing");

    assert.equal(result, null);
  });

  test("regenerateDocumentShareLink writes a fresh share id for shared documents", async (t) => {
    stubPrismaMethod(t, prisma.document, "findFirst", async () => ({
      title: "Shared Roadmap",
      isShared: true,
    }));
    const update = stubPrismaMethod(
      t,
      prisma.document,
      "update",
      async (args: any) => ({
        isShared: true,
        shareId: args.data.shareId,
        slug: args.data.slug,
        shareExpiresAt: null,
        shareEmbedEnabled: true,
        sharePresentEnabled: false,
        shareMetadataMode: "title",
        shareDiscoverable: false,
      }),
    );

    const result = await regenerateDocumentShareLink("doc-shared");

    assert.ok(result?.shareId);
    assert.match(result?.slug ?? "", /^shared-roadmap-/);
    assert.equal((update.calls[0]![0] as any).data.isShared, true);
  });

  test("revalidateSharePaths swallows lookup failures", async (t) => {
    stubPrismaMethod(t, prisma.document, "findUnique", async () => {
      throw new Error("cache lookup failed");
    });

    await assert.doesNotReject(() => revalidateSharePaths("doc-cache"));
  });

  test("revalidateSharePaths exits quietly for private documents", async (t) => {
    stubPrismaMethod(t, prisma.document, "findUnique", async () => ({
      isShared: false,
      shareId: "share-private",
      slug: "private-deck",
    }));

    await assert.doesNotReject(() => revalidateSharePaths("doc-private"));
  });

  test("revalidateSharePaths handles shared documents with public paths", async (t) => {
    stubPrismaMethod(t, prisma.document, "findUnique", async () => ({
      isShared: true,
      shareId: "share-cache",
      slug: "cache-deck",
    }));

    await assert.doesNotReject(() => revalidateSharePaths("doc-cache"));
  });
});

// ---------------------------------------------------------------------------
// persistence/helpers snapshots and version restore
// ---------------------------------------------------------------------------

describe("document snapshot and restore operations", () => {
  test("snapshotDocumentVersion skips duplicate content inside the throttle window", async (t) => {
    stubPrismaMethod(t, prisma.documentVersion, "findFirst", async () => ({
      createdAt: new Date(),
      contentJson: { b: 2, a: [1, { z: true }] },
      deckJson: { theme: "indigo" },
    }));
    stubPrismaMethod(t, prisma.document, "findUnique", async () => ({
      contentJson: { a: [1, { z: true }], b: 2 },
      deckJson: { theme: "indigo" },
    }));
    const create = stubPrismaMethod(
      t,
      prisma.documentVersion,
      "create",
      async () => ({}),
    );

    await snapshotDocumentVersion("doc-snapshot");

    assert.equal(create.calls.length, 0);
  });

  test("snapshotDocumentVersion skips when throttled before reading the document", async (t) => {
    stubPrismaMethod(t, prisma.documentVersion, "findFirst", async () => ({
      createdAt: new Date(),
      contentJson: EMPTY_LEXICAL_STATE,
      deckJson: null,
    }));
    const findUnique = stubPrismaMethod(
      t,
      prisma.document,
      "findUnique",
      async () => {
        throw new Error("should not read document while throttled");
      },
    );

    await snapshotDocumentVersion("doc-snapshot");

    assert.equal(findUnique.calls.length, 0);
  });

  test("snapshotDocumentVersion skips missing or contentless documents", async (t) => {
    stubPrismaMethod(t, prisma.documentVersion, "findFirst", async () => null);
    const create = stubPrismaMethod(
      t,
      prisma.documentVersion,
      "create",
      async () => ({}),
    );
    stubPrismaMethod(t, prisma.document, "findUnique", async () => null);

    await snapshotDocumentVersion("missing-doc");

    assert.equal(create.calls.length, 0);
  });

  test("snapshotDocumentVersion skips documents without content JSON", async (t) => {
    stubPrismaMethod(t, prisma.documentVersion, "findFirst", async () => null);
    stubPrismaMethod(t, prisma.document, "findUnique", async () => ({
      contentJson: null,
      deckJson: null,
    }));
    const create = stubPrismaMethod(
      t,
      prisma.documentVersion,
      "create",
      async () => ({}),
    );

    await snapshotDocumentVersion("contentless-doc");

    assert.equal(create.calls.length, 0);
  });

  test("snapshotDocumentVersion prunes stale versions after creating a forced snapshot", async (t) => {
    stubPrismaMethod(t, prisma.documentVersion, "findFirst", async () => null);
    stubPrismaMethod(t, prisma.document, "findUnique", async () => ({
      contentJson: EMPTY_LEXICAL_STATE,
      deckJson: null,
    }));
    const create = stubPrismaMethod(
      t,
      prisma.documentVersion,
      "create",
      async () => ({}),
    );
    stubPrismaMethod(t, prisma.documentVersion, "findMany", async () =>
      Array.from({ length: 55 }, (_, index) => ({ id: `version-${index}` })),
    );
    const deleteMany = stubPrismaMethod(
      t,
      prisma.documentVersion,
      "deleteMany",
      async () => ({}),
    );

    await snapshotDocumentVersion("doc-snapshot", {
      force: true,
      label: "Manual checkpoint",
      userId: "user-editor",
    });

    assert.equal(create.calls.length, 1);
    assert.ok(
      ((deleteMany.calls[0]![0] as any).where.id.in as string[]).length > 0,
    );
  });

  test("snapshotDocumentVersion swallows persistence failures", async (t) => {
    stubPrismaMethod(t, prisma.documentVersion, "findFirst", async () => {
      throw new Error("database unavailable");
    });

    await assert.doesNotReject(() => snapshotDocumentVersion("doc-snapshot"));
  });

  test("restoreVersion rejects snapshots from a different document", async (t) => {
    stubPrismaMethod(
      t,
      prisma.documentVersion,
      "findUniqueOrThrow",
      async () => ({
        documentId: "other-doc",
        contentJson: EMPTY_LEXICAL_STATE,
        deckJson: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
    );

    await assert.rejects(
      () => restoreVersion("doc-restore", "version-other", "user-editor"),
      /does not belong to document/,
    );
  });

  test("restoreVersion writes sanitized state, rebuilds visual rows, and revalidates shares", async (t) => {
    stubPrismaMethod(
      t,
      prisma.documentVersion,
      "findUniqueOrThrow",
      async () => ({
        documentId: "doc-restore",
        contentJson: lexicalStateWithVisual("vis-keep"),
        deckJson: VALID_DECK,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
    );
    stubPrismaMethod(t, prisma.documentVersion, "findFirst", async () => null);
    stubPrismaMethod(t, prisma.documentVersion, "create", async () => ({}));
    stubPrismaMethod(t, prisma.documentVersion, "findMany", async () => []);
    stubPrismaMethod(t, prisma.documentVersion, "deleteMany", async () => ({}));
    stubPrismaMethod(t, prisma.document, "findUnique", async (args: any) => {
      if (args.select?.contentJson) {
        return { contentJson: EMPTY_LEXICAL_STATE, deckJson: VALID_DECK };
      }
      if (args.select?.deckJson) {
        return { deckJson: null };
      }
      return { shareId: null, slug: null, isShared: false };
    });
    const tx = {
      ...makeStubTx(),
      document: {
        updateMany: async () => ({ count: 1 }),
      },
    } as unknown as Prisma.TransactionClient;
    stubPrismaMethod(t, prisma, "$transaction", async (fn: any) => fn(tx));

    const result = await restoreVersion(
      "doc-restore",
      "version-restore",
      "user-editor",
    );

    assert.equal(result.documentId, "doc-restore");
  });

  test("restoreVersion rotates deck tokens so pre-restore CAS writes conflict", async (t) => {
    const preRestoreToken = "pre-restore-token";
    let currentRevisionToken = preRestoreToken;

    stubPrismaMethod(
      t,
      prisma.documentVersion,
      "findUniqueOrThrow",
      async () => ({
        documentId: "doc-restore",
        contentJson: lexicalStateWithVisual("vis-keep"),
        deckJson: VALID_DECK,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
    );
    stubPrismaMethod(t, prisma.documentVersion, "findFirst", async () => null);
    stubPrismaMethod(t, prisma.documentVersion, "create", async () => ({}));
    stubPrismaMethod(t, prisma.documentVersion, "findMany", async () => []);
    stubPrismaMethod(t, prisma.documentVersion, "deleteMany", async () => ({}));
    stubPrismaMethod(t, prisma.document, "findUnique", async (args: any) => {
      if (args.select?.contentJson) {
        return { contentJson: EMPTY_LEXICAL_STATE, deckJson: VALID_DECK };
      }
      if (args.select?.deckJson) {
        return { deckJson: null };
      }
      return { shareId: null, slug: null, isShared: false };
    });
    const tx = {
      ...makeStubTx(),
      document: {
        updateMany: async (args: any) => {
          currentRevisionToken = args.data.deckRevisionToken;
          return { count: 1 };
        },
      },
    } as unknown as Prisma.TransactionClient;
    stubPrismaMethod(t, prisma, "$transaction", async (fn: any) => fn(tx));

    await restoreVersion("doc-restore", "version-restore", "user-editor");

    assert.notEqual(currentRevisionToken, preRestoreToken);

    const casDb = {
      document: {
        updateMany: async (args: any) => {
          const whereToken = args.where.deckRevisionToken;
          if (whereToken !== currentRevisionToken) {
            return { count: 0 };
          }
          currentRevisionToken = args.data.deckRevisionToken;
          return { count: 1 };
        },
        findUnique: async () => ({ deckRevisionToken: currentRevisionToken }),
      },
    } satisfies DeckCasDb;

    const staleWriteResult = await writeDeckWithCas({
      documentId: "doc-restore",
      deckJson: VALID_DECK_V7,
      clientToken: preRestoreToken,
      telemetryArea: "test",
      db: casDb,
    });

    assert.deepEqual(staleWriteResult, {
      ok: "conflict",
      serverRevisionToken: currentRevisionToken,
    });
  });
});

// ---------------------------------------------------------------------------
// persistence/visual exported flows
// ---------------------------------------------------------------------------

describe("visual persistence exported flows", () => {
  test("atomicSaveDocumentLexical snapshots, writes content, mirrors visuals, and logs outcome", async (t) => {
    const txBase = makeStubTx();
    const tx = {
      ...txBase,
      documentVersion: {
        findFirst: async () => null,
        create: async () => {
          txBase._calls.push("documentVersion.create");
          return {};
        },
        findMany: async () => [],
        deleteMany: async () => ({}),
      },
      document: {
        findUnique: async () => ({
          contentJson: EMPTY_LEXICAL_STATE,
          deckJson: null,
        }),
        updateMany: async () => ({ count: 1 }),
      },
    } as unknown as Prisma.TransactionClient & {
      _calls: string[];
    };
    stubPrismaMethod(t, prisma, "$transaction", async (fn: any) => fn(tx));

    const outcome = await atomicSaveDocumentLexical(
      "doc-atomic",
      EMPTY_LEXICAL_STATE,
      "user-editor",
    );

    assert.equal(outcome.created, 0);
    assert.ok(tx._calls.includes("documentVersion.create"));
    assert.ok(tx._calls.includes("visual.findMany"));
  });

  test("atomicSaveDocumentLexical rolls back snapshot version writes when mirror rebuild fails", async (t) => {
    const attempts = { created: 0, deleted: 0 };
    const committed = { created: 0, deleted: 0 };

    stubPrismaMethod(t, prisma, "$transaction", async (fn: any) => {
      const pending = { created: 0, deleted: 0 };
      const txBase = makeStubTx();
      const tx = {
        ...txBase,
        visual: {
          ...(txBase as any).visual,
          findMany: async () => {
            txBase._calls.push("visual.findMany");
            throw new Error("mirror rebuild failed");
          },
        },
        documentVersion: {
          findFirst: async () => null,
          create: async () => {
            attempts.created += 1;
            pending.created += 1;
            return {};
          },
          findMany: async () =>
            Array.from({ length: 55 }, (_, index) => ({
              id: `version-${index}`,
            })),
          deleteMany: async () => {
            attempts.deleted += 1;
            pending.deleted += 1;
            return {};
          },
        },
        document: {
          findUnique: async () => ({
            contentJson: EMPTY_LEXICAL_STATE,
            deckJson: null,
          }),
          updateMany: async () => ({ count: 1 }),
        },
      } as unknown as Prisma.TransactionClient;

      try {
        const result = await fn(tx);
        committed.created += pending.created;
        committed.deleted += pending.deleted;
        return result;
      } catch (error) {
        throw error;
      }
    });

    await assert.rejects(
      () => atomicSaveDocumentLexical("doc-atomic-fail", EMPTY_LEXICAL_STATE),
      /mirror rebuild failed/,
    );

    assert.equal(attempts.created, 1);
    assert.equal(attempts.deleted, 1);
    assert.equal(committed.created, 0);
    assert.equal(committed.deleted, 0);
  });

  test("rebuildMirror wraps mirror rebuilds in a transaction", async (t) => {
    const tx = makeStubTx();
    stubPrismaMethod(t, prisma, "$transaction", async (fn: any) => fn(tx));

    const outcome = await rebuildMirror("doc-rebuild", EMPTY_LEXICAL_STATE);

    assert.equal(outcome.deleted, 0);
    assert.ok(tx._calls.includes("visual.findMany"));
  });

  test("reconcileDeckAfterMirror strips deck visuals without live rows", async (t) => {
    stubPrismaMethod(t, prisma.document, "findUnique", async () => ({
      deckJson: VALID_DECK,
    }));
    stubPrismaMethod(t, prisma.visual, "findMany", async () => [
      { anchorBlockId: "vis-keep" },
    ]);
    const updateMany = stubPrismaMethod(
      t,
      prisma.document,
      "updateMany",
      async () => ({ count: 1 }),
    );

    await reconcileDeckAfterMirror("doc-reconcile");

    assert.equal(updateMany.calls.length, 1);
    const deckJson = (updateMany.calls[0]![0] as any).data.deckJson;
    const visualIds = deckJson.slides[0].elements
      .filter((element: any) => element.kind === "visual")
      .map((element: any) => element.content.visualId);
    assert.deepEqual(visualIds, ["vis-keep"]);
  });

  test("reconcileDeckAfterMirror logs and swallows invalid stored decks", async (t) => {
    stubPrismaMethod(t, prisma.document, "findUnique", async () => ({
      deckJson: { not: "a deck" },
    }));
    const updateMany = stubPrismaMethod(
      t,
      prisma.document,
      "updateMany",
      async () => ({ count: 1 }),
    );

    await assert.doesNotReject(() =>
      reconcileDeckAfterMirror("doc-invalid-deck"),
    );
    assert.equal(updateMany.calls.length, 0);
  });
});
