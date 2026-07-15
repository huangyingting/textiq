import assert from "node:assert/strict";
import { test } from "node:test";

import { backfillDocumentContentProjection } from "./content-projection-backfill";

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

test("backfills drifted search projections in bounded pages with a CAS guard", async () => {
  const pages = [
    [
      { id: "doc-1", content: "", contentJson: lexical("First") },
      { id: "doc-2", content: "Current", contentJson: lexical("Current") },
    ],
    [{ id: "doc-3", content: "stale", contentJson: lexical("Third") }],
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
      async updateMany(args: unknown) {
        updates.push(args);
        return { count: updates.length === 1 ? 1 : 0 };
      },
    },
  };

  assert.deepEqual(await backfillDocumentContentProjection(db as never, 2), {
    scanned: 3,
    updated: 1,
    skippedConcurrent: 1,
  });

  assert.equal(finds.length, 3);
  assert.deepEqual((finds[1] as { cursor: unknown; skip: number }).cursor, {
    id: "doc-2",
  });
  assert.equal((finds[1] as { skip: number }).skip, 1);
  assert.deepEqual(updates, [
    {
      where: { id: "doc-1", content: "" },
      data: { content: "First" },
    },
    {
      where: { id: "doc-3", content: "stale" },
      data: { content: "Third" },
    },
  ]);
});

test("uses the default batch size for invalid input", async () => {
  let take: number | undefined;
  const db = {
    document: {
      async findMany(args: { take: number }) {
        take = args.take;
        return [];
      },
      async updateMany() {
        return { count: 0 };
      },
    },
  };

  await backfillDocumentContentProjection(db as never, Number.NaN);

  assert.equal(take, 200);
});
