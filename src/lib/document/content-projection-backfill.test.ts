import assert from "node:assert/strict";
import { test } from "node:test";

import {
  backfillDocumentContentProjection,
  resolveContentProjectionBackfillOptions,
} from "./content-projection-backfill";

function lexical(text: string) {
  return {
    root: {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", text }],
        },
      ],
    },
  };
}

const firstUpdatedAt = new Date("2026-07-15T18:00:00.000Z");
const secondUpdatedAt = new Date("2026-07-15T18:00:01.000Z");

test("backfills drifted projections in bounded pages using canonical snapshot CAS predicates", async () => {
  const pages = [
    [
      {
        id: "doc-1",
        content: "",
        contentJson: lexical("First"),
        updatedAt: firstUpdatedAt,
      },
      {
        id: "doc-2",
        content: "Current",
        contentJson: lexical("Current"),
        updatedAt: firstUpdatedAt,
      },
    ],
    [
      {
        id: "doc-3",
        content: "stale",
        contentJson: lexical("Third"),
        updatedAt: secondUpdatedAt,
      },
    ],
    [],
  ];
  const finds: unknown[] = [];
  const updates: unknown[] = [];
  const db = {
    document: {
      async findMany(args: unknown) {
        finds.push(args);
        return pages.shift() ?? [];
      },
      async findUnique() {
        throw new Error("retry should not be needed");
      },
      async updateMany(args: unknown) {
        updates.push(args);
        return { count: 1 };
      },
    },
  };

  assert.deepEqual(
    await backfillDocumentContentProjection(db as never, {
      batchSize: 2,
      sampleLimit: 1,
    }),
    {
      scanned: 3,
      drifted: 2,
      updated: 2,
      skippedConcurrent: 0,
      retries: 0,
      sampleDocumentIds: ["doc-1"],
    },
  );

  assert.equal(finds.length, 3);
  assert.deepEqual((finds[1] as { cursor: unknown; skip: number }).cursor, {
    id: "doc-2",
  });
  assert.equal((finds[1] as { skip: number }).skip, 1);
  assert.deepEqual(updates, [
    {
      where: {
        id: "doc-1",
        updatedAt: firstUpdatedAt,
        contentJson: { equals: lexical("First") },
      },
      data: { content: "First" },
    },
    {
      where: {
        id: "doc-3",
        updatedAt: secondUpdatedAt,
        contentJson: { equals: lexical("Third") },
      },
      data: { content: "Third" },
    },
  ]);
});

test("a concurrent canonical edit makes the old CAS miss and never restores stale text", async () => {
  const state = {
    id: "doc-race",
    content: "stale",
    contentJson: lexical("Old"),
    updatedAt: firstUpdatedAt,
  };
  let page = 0;
  let updateCalls = 0;
  const db = {
    document: {
      async findMany() {
        page += 1;
        return page === 1 ? [{ ...state }] : [];
      },
      async findUnique() {
        return { ...state };
      },
      async updateMany(args: {
        where: {
          updatedAt: Date;
          contentJson: { equals: unknown };
        };
        data: { content: string };
      }) {
        updateCalls += 1;
        if (updateCalls === 1) {
          state.contentJson = lexical("New");
          state.content = "New";
          state.updatedAt = secondUpdatedAt;
        }
        const snapshotStillMatches =
          args.where.updatedAt.getTime() === state.updatedAt.getTime() &&
          JSON.stringify(args.where.contentJson.equals) ===
            JSON.stringify(state.contentJson);
        if (!snapshotStillMatches) return { count: 0 };
        state.content = args.data.content;
        return { count: 1 };
      },
    },
  };

  const result = await backfillDocumentContentProjection(db as never, {
    maxRetries: 2,
  });

  assert.deepEqual(result, {
    scanned: 1,
    drifted: 1,
    updated: 0,
    skippedConcurrent: 1,
    retries: 1,
    sampleDocumentIds: ["doc-race"],
  });
  assert.equal(state.content, "New");
  assert.deepEqual(state.contentJson, lexical("New"));
});

test("dry-run reports bounded samples without issuing writes", async () => {
  let updateCalled = false;
  let page = 0;
  const db = {
    document: {
      async findMany() {
        page += 1;
        return page === 1
          ? [
              {
                id: "doc-dry",
                content: "stale",
                contentJson: lexical("Preview"),
                updatedAt: firstUpdatedAt,
              },
            ]
          : [];
      },
      async findUnique() {
        throw new Error("dry-run should not retry");
      },
      async updateMany() {
        updateCalled = true;
        return { count: 1 };
      },
    },
  };

  assert.deepEqual(
    await backfillDocumentContentProjection(db as never, {
      dryRun: true,
      sampleLimit: 1,
    }),
    {
      scanned: 1,
      drifted: 1,
      updated: 0,
      skippedConcurrent: 0,
      retries: 0,
      sampleDocumentIds: ["doc-dry"],
    },
  );
  assert.equal(updateCalled, false);
});

test("backfill option bounds reject invalid direct callers", () => {
  assert.throws(
    () => resolveContentProjectionBackfillOptions({ batchSize: 0 }),
    /batchSize must be an integer between 1 and 1000/,
  );
  assert.throws(
    () => resolveContentProjectionBackfillOptions({ maxRetries: 11 }),
    /maxRetries must be an integer between 0 and 10/,
  );
  assert.throws(
    () => resolveContentProjectionBackfillOptions({ sampleLimit: -1 }),
    /sampleLimit must be an integer between 0 and 100/,
  );
});
