import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createCommentService,
  type LoadDeckForDocument,
  type RequireCommentDocumentContext,
} from "./service";
import type { Deck } from "@/lib/presentation/schema";

type FakeAuthor = { id: string; name: string | null; email: string };

type FakeComment = {
  id: string;
  documentId: string;
  authorId: string;
  body: string;
  resolved: boolean;
  parentId: string | null;
  anchorType: string | null;
  anchorText: string | null;
  anchorNodeId: string | null;
  slideId: string | null;
  elementId: string | null;
  anchorGeometry: unknown;
  createdAt: Date;
  author: FakeAuthor;
};

type FakeWhere = {
  id?: string | { in: string[] };
  documentId?: string;
  authorId?: { not: string };
  parentId?: string | null;
  slideId?: string | null | { not: null };
  elementId?: string;
};

type FakeData = Partial<
  Omit<FakeComment, "author" | "createdAt" | "id" | "resolved">
> & {
  body?: string;
  resolved?: boolean;
  anchorGeometry?: unknown;
};

type FakeRead = {
  userId: string;
  documentId: string;
  lastReadAt: Date;
};

function user(id: string): FakeAuthor {
  return { id, name: id, email: `${id}@example.test` };
}

function rootComment(partial: Partial<FakeComment> = {}): FakeComment {
  const author = partial.author ?? user(partial.authorId ?? "author-1");
  return {
    id: partial.id ?? "comment-1",
    documentId: partial.documentId ?? "doc-1",
    authorId: partial.authorId ?? author.id,
    body: partial.body ?? "Comment",
    resolved: partial.resolved ?? false,
    parentId: partial.parentId ?? null,
    anchorType: partial.anchorType ?? null,
    anchorText: partial.anchorText ?? null,
    anchorNodeId: partial.anchorNodeId ?? null,
    slideId: partial.slideId ?? null,
    elementId: partial.elementId ?? null,
    anchorGeometry: partial.anchorGeometry ?? null,
    createdAt: partial.createdAt ?? new Date("2024-01-01T00:00:00Z"),
    author,
  };
}

function buildDeck(slides: Array<{ id: string; elementIds?: string[] }>): Deck {
  return {
    schemaVersion: 7,
    canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
    theme: { packageId: "neutral" },
    assets: { images: {} },
    slides: slides.map(({ id, elementIds = [] }) => ({
      id,
      type: "slide",
      template: { kind: "content" },
      style: { ref: "slide.content" },
      children: elementIds.map((elementId) => ({
        id: elementId,
        type: "text",
        role: "body",
        style: { ref: "text.body" },
        content: { paragraphs: [{ id: `${elementId}-p1`, text: "" }] },
      })),
    })),
  } as never;
}

function matchesWhere(comment: FakeComment, where: FakeWhere): boolean {
  if (where.id !== undefined) {
    if (typeof where.id === "string" && comment.id !== where.id) return false;
    if (typeof where.id === "object" && !where.id.in.includes(comment.id)) {
      return false;
    }
  }
  if (
    where.documentId !== undefined &&
    comment.documentId !== where.documentId
  ) {
    return false;
  }
  if (where.parentId !== undefined && comment.parentId !== where.parentId) {
    return false;
  }
  if (
    where.authorId?.not !== undefined &&
    comment.authorId === where.authorId.not
  ) {
    return false;
  }
  if (where.elementId !== undefined && comment.elementId !== where.elementId) {
    return false;
  }
  if (where.slideId !== undefined) {
    if (where.slideId === null && comment.slideId !== null) return false;
    if (
      typeof where.slideId === "string" &&
      comment.slideId !== where.slideId
    ) {
      return false;
    }
    if (
      where.slideId !== null &&
      typeof where.slideId === "object" &&
      comment.slideId === null
    ) {
      return false;
    }
  }
  return true;
}

class FakeDb {
  comments: FakeComment[];
  reads: FakeRead[];
  nextId = 1;

  constructor(comments: FakeComment[] = [], reads: FakeRead[] = []) {
    this.comments = comments;
    this.reads = reads;
  }

  comment = {
    findMany: async (args: { where?: FakeWhere }) => {
      const where = args.where ?? {};
      return this.comments
        .filter((comment) => matchesWhere(comment, where))
        .filter(
          (comment) =>
            comment.parentId === where.parentId || where.parentId === undefined,
        )
        .map((comment) => ({
          ...comment,
          replies: this.comments
            .filter((reply) => reply.parentId === comment.id)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
        }))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    },
    findFirst: async (args: { where: FakeWhere }) =>
      this.comments.find((comment) => matchesWhere(comment, args.where)) ??
      null,
    findUnique: async (args: { where: { id: string } }) =>
      this.comments.find((comment) => comment.id === args.where.id) ?? null,
    create: async (args: { data: FakeData }) => {
      const authorId = args.data.authorId ?? "viewer";
      const comment = rootComment({
        id: `created-${this.nextId++}`,
        documentId: args.data.documentId,
        authorId,
        author: user(authorId),
        body: args.data.body,
        parentId: args.data.parentId ?? null,
        anchorType: args.data.anchorType ?? null,
        anchorText: args.data.anchorText ?? null,
        anchorNodeId: args.data.anchorNodeId ?? null,
        slideId: args.data.slideId ?? null,
        elementId: args.data.elementId ?? null,
        anchorGeometry: args.data.anchorGeometry ?? null,
      });
      this.comments.push(comment);
      return comment;
    },
    update: async (args: { where: { id: string }; data: FakeData }) => {
      const comment = this.comments.find((item) => item.id === args.where.id);
      assert.ok(comment);
      Object.assign(comment, args.data);
      return comment;
    },
    delete: async (args: { where: { id: string } }) => {
      const index = this.comments.findIndex(
        (item) => item.id === args.where.id,
      );
      assert.notEqual(index, -1);
      const [deleted] = this.comments.splice(index, 1);
      this.comments = this.comments.filter(
        (item) => item.parentId !== deleted.id,
      );
      return deleted;
    },
    updateMany: async (args: { where: FakeWhere; data: FakeData }) => {
      let count = 0;
      for (const comment of this.comments) {
        if (matchesWhere(comment, args.where)) {
          const data = { ...args.data };
          if (
            "anchorGeometry" in data &&
            data.anchorGeometry !== null &&
            typeof data.anchorGeometry === "object"
          ) {
            data.anchorGeometry = null;
          }
          Object.assign(comment, data);
          count += 1;
        }
      }
      return { count };
    },
  };

  commentRead = {
    findUnique: async (args: {
      where: { userId_documentId: { userId: string; documentId: string } };
    }) =>
      this.reads.find(
        (read) =>
          read.userId === args.where.userId_documentId.userId &&
          read.documentId === args.where.userId_documentId.documentId,
      ) ?? null,
    upsert: async (args: {
      where: { userId_documentId: { userId: string; documentId: string } };
      update: { lastReadAt: Date };
      create: FakeRead;
    }) => {
      const existing = this.reads.find(
        (read) =>
          read.userId === args.where.userId_documentId.userId &&
          read.documentId === args.where.userId_documentId.documentId,
      );
      if (existing) {
        existing.lastReadAt = args.update.lastReadAt;
        return existing;
      }
      this.reads.push(args.create);
      return args.create;
    },
  };
}

function makeService(
  db: FakeDb,
  userId = "viewer",
  loadDeckForDocument?: LoadDeckForDocument,
) {
  const seenContexts: string[] = [];
  const requireDocumentContext: RequireCommentDocumentContext = async (
    documentId,
    capability,
  ) => {
    seenContexts.push(`${documentId}:${capability}`);
    return { user: { id: userId } };
  };
  return {
    service: createCommentService({
      db: db as never,
      now: () => new Date("2024-01-02T00:00:00Z"),
      requireDocumentContext,
      loadDeckForDocument,
    }),
    seenContexts,
  };
}

test("comment service lists canonical threads after injected view context", async () => {
  const db = new FakeDb([
    rootComment({
      id: "thread-1",
      authorId: "author-1",
      anchorType: "text",
      anchorText: "Paragraph",
    }),
    rootComment({
      id: "reply-1",
      parentId: "thread-1",
      authorId: "author-2",
      body: "Reply",
    }),
  ]);
  const { service, seenContexts } = makeService(db);

  const threads = await service.listComments("doc-1");

  assert.deepEqual(seenContexts, ["doc-1:view"]);
  assert.equal(threads.length, 1);
  assert.deepEqual(threads[0].anchor, {
    kind: "text",
    text: "Paragraph",
    nodeId: null,
  });
  assert.equal(threads[0].anchorType, "text");
  assert.equal(threads[0].replies[0].body, "Reply");
});

test("comment service filters list results by anchor scope and slide", async () => {
  const db = new FakeDb([
    rootComment({ id: "text-thread", anchorType: "text", anchorText: "Text" }),
    rootComment({ id: "slide-1-thread", slideId: "slide-1" }),
    rootComment({ id: "slide-2-thread", slideId: "slide-2" }),
  ]);
  const { service } = makeService(db);

  const textThreads = await service.listComments("doc-1", {
    anchorScope: "text",
  });
  const slideThreads = await service.listComments("doc-1", {
    anchorScope: "slide",
    slideId: "slide-1",
  });

  assert.deepEqual(
    textThreads.map((thread) => thread.id),
    ["text-thread"],
  );
  assert.deepEqual(
    slideThreads.map((thread) => thread.id),
    ["slide-1-thread"],
  );
});

test("comment service creates replies and rejects missing parent comments", async () => {
  const db = new FakeDb([rootComment({ id: "thread-1" })]);
  const { service } = makeService(db, "author-2");

  await service.createComment("doc-1", {
    parentId: "thread-1",
    body: "Reply",
  });
  assert.equal(
    db.comments.some((comment) => comment.parentId === "thread-1"),
    true,
  );

  await assert.rejects(
    () =>
      service.createComment("doc-1", {
        parentId: "missing",
        body: "Nope",
      }),
    /Parent comment not found/,
  );
});

test("comment service creates table anchor root comment persisting anchorNodeId and anchorText", async () => {
  const db = new FakeDb();
  const { service } = makeService(db, "author-1");

  await service.createComment("doc-1", {
    body: "Table anchor",
    anchorType: "table",
    anchorNodeId: "table-node-42",
    anchorText: "Row 3",
  });

  assert.equal(db.comments[0].anchorType, "table");
  assert.equal(db.comments[0].anchorNodeId, "table-node-42");
  assert.equal(db.comments[0].anchorText, "Row 3");
});

test("comment service creates trimmed text and visual root comments", async () => {
  const db = new FakeDb();
  const { service } = makeService(db, "author-1");

  await service.createComment("doc-1", {
    body: "  Text anchor  ",
    anchorType: "text",
    anchorText: "  Selected paragraph  ",
  });
  await service.createComment("doc-1", {
    body: "Visual anchor",
    anchorType: "visual",
    anchorNodeId: "visual-node-1",
  });

  assert.equal(db.comments[0].body, "Text anchor");
  assert.equal(db.comments[0].anchorType, "text");
  assert.equal(db.comments[0].anchorText, "Selected paragraph");
  assert.equal(db.comments[0].anchorNodeId, null);
  assert.equal(db.comments[1].anchorType, "visual");
  assert.equal(db.comments[1].anchorNodeId, "visual-node-1");
});

test("comment service creates slide root comments with geometry", async () => {
  const db = new FakeDb();
  const { service } = makeService(db, "author-1", async () =>
    buildDeck([{ id: "slide-1", elementIds: ["element-1"] }]),
  );

  const anchorGeometry = { x: 1, y: 2, width: 3, height: 4 };
  await service.createComment("doc-1", {
    body: "Slide anchor",
    slideId: "slide-1",
    elementId: "element-1",
    anchorGeometry,
  });

  assert.equal(db.comments[0].slideId, "slide-1");
  assert.equal(db.comments[0].elementId, "element-1");
  assert.deepEqual(db.comments[0].anchorGeometry, { x: 1, y: 2 });
});

test("comment service rejects slide root comments with non-finite geometry", async () => {
  const db = new FakeDb();
  const { service } = makeService(db, "author-1", async () =>
    buildDeck([{ id: "slide-1", elementIds: ["element-1"] }]),
  );

  await assert.rejects(
    () =>
      service.createComment("doc-1", {
        body: "Bad geometry x",
        slideId: "slide-1",
        anchorGeometry: { x: Number.NaN, y: 2 },
      }),
    /Anchor geometry must have numeric x and y coordinates/,
  );
  await assert.rejects(
    () =>
      service.createComment("doc-1", {
        body: "Bad geometry y",
        slideId: "slide-1",
        anchorGeometry: { x: 2, y: Number.NaN },
      }),
    /Anchor geometry must have numeric x and y coordinates/,
  );
  assert.equal(db.comments.length, 0);
});

test("comment service rejects slide comments anchored to missing slides", async () => {
  const db = new FakeDb();
  const { service } = makeService(db, "author-1", async () =>
    buildDeck([{ id: "slide-1", elementIds: ["element-1"] }]),
  );

  await assert.rejects(
    () =>
      service.createComment("doc-1", {
        body: "Missing slide",
        slideId: "missing-slide",
        elementId: "element-1",
      }),
    /existing slide or element in the saved deck/i,
  );
});

test("comment service rejects slide comments anchored to missing elements", async () => {
  const db = new FakeDb();
  const { service } = makeService(db, "author-1", async () =>
    buildDeck([{ id: "slide-1", elementIds: ["element-1"] }]),
  );

  await assert.rejects(
    () =>
      service.createComment("doc-1", {
        body: "Missing element",
        slideId: "slide-1",
        elementId: "missing-element",
      }),
    /existing slide or element in the saved deck/i,
  );
});

test("comment service rejects slide comments when the saved deck is unavailable", async () => {
  const db = new FakeDb();
  const loadDeckForDocument: LoadDeckForDocument = async () => {
    throw new Error("Slide comments require a saved deck on this document.");
  };
  const { service } = makeService(db, "author-1", loadDeckForDocument);

  await assert.rejects(
    () =>
      service.createComment("doc-1", {
        body: "No deck",
        slideId: "slide-1",
      }),
    /saved deck on this document/i,
  );
});

test("comment service rejects slide comments when the saved deck is invalid", async () => {
  const db = new FakeDb();
  const loadDeckForDocument: LoadDeckForDocument = async () => {
    throw new Error("Slide comments require a valid saved presentation deck.");
  };
  const { service } = makeService(db, "author-1", loadDeckForDocument);

  await assert.rejects(
    () =>
      service.createComment("doc-1", {
        body: "Bad deck",
        slideId: "slide-1",
      }),
    /valid saved presentation deck/i,
  );
});

test("comment service rejects empty created and edited comments", async () => {
  const db = new FakeDb([
    rootComment({ id: "thread-1", authorId: "author-1" }),
  ]);
  const { service } = makeService(db, "author-1");

  await assert.rejects(
    () => service.createComment("doc-1", { body: "   " }),
    /Comment cannot be empty/,
  );
  await assert.rejects(
    () => service.editComment("thread-1", "   "),
    /Comment cannot be empty/,
  );
});

test("comment service reports missing comments for mutation helpers", async () => {
  const db = new FakeDb();
  const { service } = makeService(db, "viewer");

  await assert.rejects(
    () => service.editComment("missing", "Updated"),
    /not found/,
  );
  await assert.rejects(() => service.deleteComment("missing"), /not found/);
  await assert.rejects(
    () => service.setCommentResolved("missing", true),
    /not found/,
  );
});

test("comment service preserves author-only edit and delete policy", async () => {
  const db = new FakeDb([
    rootComment({ id: "thread-1", authorId: "author-1" }),
  ]);
  const nonAuthor = makeService(db, "viewer").service;

  await assert.rejects(
    () => nonAuthor.editComment("thread-1", "Updated"),
    /own comments/,
  );
  await assert.rejects(
    () => nonAuthor.deleteComment("thread-1"),
    /own comments/,
  );

  const author = makeService(db, "author-1").service;
  await author.editComment("thread-1", "Updated");
  assert.equal(db.comments[0].body, "Updated");
  await author.deleteComment("thread-1");
  assert.equal(db.comments.length, 0);
});

test("comment service allows any viewer to resolve a thread", async () => {
  const db = new FakeDb([
    rootComment({ id: "thread-1", authorId: "author-1" }),
  ]);
  const { service } = makeService(db, "viewer");

  await service.setCommentResolved("thread-1", true);

  assert.equal(db.comments[0].resolved, true);
});

test("comment service owns lifecycle float helpers", async () => {
  const db = new FakeDb([
    rootComment({
      id: "slide-comment",
      slideId: "sl-1",
      elementId: "el-1",
      anchorGeometry: { x: 1, y: 2 },
    }),
  ]);
  const { service } = makeService(db);

  await service.floatCommentsOnElementDelete("doc-1", "sl-1", "el-1");
  assert.equal(db.comments[0].elementId, null);
  await service.floatCommentsOnSlideDelete("doc-1", "sl-1");
  assert.equal(db.comments[0].slideId, null);
  assert.equal(db.comments[0].anchorGeometry, null);
});

test("comment service finds and floats orphaned slide comments after restore", async () => {
  const db = new FakeDb([
    rootComment({
      id: "attached",
      slideId: "slide-1",
      elementId: "element-1",
    }),
    rootComment({
      id: "orphaned",
      slideId: "missing-slide",
      elementId: "element-2",
      anchorGeometry: { x: 12, y: 34 },
    }),
  ]);
  const { service } = makeService(db);
  const deck = {
    schemaVersion: 7,
    canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
    theme: { packageId: "neutral" },
    assets: { images: {} },
    slides: [
      {
        id: "slide-1",
        type: "slide",
        template: { kind: "content" },
        style: { ref: "slide.content" },
        children: [
          {
            id: "element-1",
            type: "text",
            role: "body",
            style: { ref: "text.body" },
            content: { paragraphs: [{ id: "element-1-p1", text: "" }] },
          },
        ],
      },
    ],
  } as never;

  assert.deepEqual(await service.getOrphanedCommentIds("doc-1", deck), [
    "orphaned",
  ]);

  const result = await service.floatOrphanedCommentsAfterRestore("doc-1", deck);
  assert.deepEqual(result, { floatedCount: 1 });
  const orphaned = db.comments.find((comment) => comment.id === "orphaned");
  assert.ok(orphaned);
  assert.equal(orphaned.slideId, null);
  assert.equal(orphaned.elementId, null);
  assert.equal(orphaned.anchorGeometry, null);
});

test("comment service counts unread and marks document comments read", async () => {
  const db = new FakeDb(
    [
      rootComment({
        id: "old",
        authorId: "author-1",
        createdAt: new Date("2024-01-01T00:00:00Z"),
      }),
      rootComment({
        id: "new",
        authorId: "author-1",
        slideId: "sl-1",
        createdAt: new Date("2024-01-03T00:00:00Z"),
      }),
      rootComment({
        id: "own",
        authorId: "viewer",
        createdAt: new Date("2024-01-03T00:00:00Z"),
      }),
    ],
    [
      {
        userId: "viewer",
        documentId: "doc-1",
        lastReadAt: new Date("2024-01-02T00:00:00Z"),
      },
    ],
  );
  const { service } = makeService(db, "viewer");

  assert.equal(await service.getUnreadCommentCount("doc-1"), 1);
  assert.equal(await service.getUnreadCommentCount("doc-1", "slide"), 1);

  await service.markDocumentCommentsRead("doc-1");
  assert.equal(
    db.reads[0].lastReadAt.toISOString(),
    "2024-01-02T00:00:00.000Z",
  );
});
