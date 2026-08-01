import assert from "node:assert/strict";
import { test } from "node:test";

import { Prisma } from "@/generated/prisma/client";
import { syncSeededDemoDocument } from "@/lib/onboarding/seed-demo-document-state";

test("seeded demo sync clears stale deck state while projecting current content", async () => {
  const calls: Array<{
    where: { id: string };
    data: {
      content: string;
      contentJson: unknown;
      deckJson?: unknown;
      deckRevisionToken?: string | null;
    };
  }> = [];
  const db = {
    document: {
      async update(args: never) {
        calls.push(args);
        return { id: "demo-document" };
      },
    },
  };
  const contentSnapshot = {
    root: {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", text: "Current sample content" }],
        },
      ],
    },
  };

  await syncSeededDemoDocument(db, {
    documentId: "demo-document",
    contentSnapshot,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.where.id, "demo-document");
  assert.equal(calls[0]!.data.content, "Current sample content");
  assert.deepEqual(calls[0]!.data.contentJson, contentSnapshot);
  assert.equal(calls[0]!.data.deckJson, Prisma.DbNull);
  assert.equal(calls[0]!.data.deckRevisionToken, null);
});
