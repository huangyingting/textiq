import assert from "node:assert/strict";
import { test } from "node:test";

import {
  backfillDocumentContentProjectionCas,
  createDocumentWithCanonicalContent,
  type DocumentCreateMetadata,
  updateDocumentMetadata,
} from "./document-write-port";

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

test("canonical content is cloned and sealed immediately before create", async () => {
  const source = lexical("Original");
  type CreateCapture = {
    data: {
      content: string;
      contentJson: ReturnType<typeof lexical>;
    };
  };
  const calls: CreateCapture[] = [];
  const db = {
    document: {
      async create(args: never) {
        calls.push(args);
        return { id: "doc-1" };
      },
    },
  };

  const result = await createDocumentWithCanonicalContent<{ id: string }>(db, {
    contentSnapshot: source,
    data: { ownerId: "owner-1" },
    select: { id: true },
  });
  source.root.children[0]!.children[0]!.text = "Forged later";

  assert.deepEqual(result, { id: "doc-1" });
  const captured = calls[0]!;
  assert.equal(captured.data.content, "Original");
  assert.equal(
    captured.data.contentJson.root.children[0]!.children[0]!.text,
    "Original",
  );
  assert.equal(Object.isFrozen(captured.data), true);
  assert.equal(Object.isFrozen(captured.data.contentJson), true);
  assert.equal(
    Reflect.set(captured.data, "content", "forged projection"),
    false,
  );
});

test("metadata writes reject canonical fields even through a type escape", async () => {
  let called = false;
  const db = {
    document: {
      async update() {
        called = true;
        return {};
      },
    },
  };

  if (false) {
    const unsafeMetadata: DocumentCreateMetadata = {
      ownerId: "owner-1",
      // @ts-expect-error Document projection fields are not accepted from callers.
      content: "forged",
    };
    void unsafeMetadata;
  }

  await assert.rejects(
    updateDocumentMetadata(db, {
      where: { id: "doc-1" },
      data: {
        title: "Unsafe",
        content: "forged",
        contentJson: lexical("forged"),
      } as never,
    }),
    /owned by the document write port/,
  );
  assert.equal(called, false);
});

test("metadata writes seal a projection-free copy before Prisma receives it", async () => {
  const metadata = { title: "Original" };
  const calls: Array<{ data: Record<string, unknown> }> = [];
  const db = {
    document: {
      async update(args: never) {
        calls.push(args);
        return {};
      },
    },
  };

  await updateDocumentMetadata(db, {
    where: { id: "doc-1" },
    data: metadata,
  });
  metadata.title = "Mutated later";
  Reflect.set(metadata, "content", "forged later");

  const captured = calls[0]!;
  assert.deepEqual(captured.data, { title: "Original" });
  assert.equal(Object.isFrozen(captured.data), true);
});

test("backfill CAS derives predicate and projection from its sealed snapshot", async () => {
  const oldContent = lexical("Old");
  const oldUpdatedAt = new Date("2026-07-16T00:00:00.000Z");
  let snapshot = {
    id: "doc-1",
    contentJson: oldContent,
    updatedAt: oldUpdatedAt,
  };
  type BackfillCapture = {
    where: {
      id: string;
      contentJson: { equals: ReturnType<typeof lexical> };
      updatedAt: Date;
    };
    data: { content: string };
  };
  const calls: BackfillCapture[] = [];
  const db = {
    document: {
      async updateMany(args: never) {
        calls.push(args);
        return { count: 1 };
      },
    },
  };

  const write = backfillDocumentContentProjectionCas(db, snapshot);
  snapshot = {
    id: "doc-2",
    contentJson: lexical("New"),
    updatedAt: new Date("2026-07-16T00:01:00.000Z"),
  };
  oldContent.root.children[0]!.children[0]!.text = "Mutated old object";
  oldUpdatedAt.setUTCFullYear(2030);

  assert.deepEqual(await write, { count: 1 });
  const captured = calls[0]!;
  assert.equal(captured.where.id, "doc-1");
  assert.equal(
    captured.where.updatedAt.toISOString(),
    "2026-07-16T00:00:00.000Z",
  );
  assert.equal(
    captured.where.contentJson.equals.root.children[0]!.children[0]!.text,
    "Old",
  );
  assert.equal(captured.data.content, "Old");
  assert.equal(snapshot.id, "doc-2");
});
