import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { DocumentPermissionError } from "@/lib/auth/document-permissions";
import {
  createCommentService,
  type LoadDeckForDocument,
  type RequireCommentDocumentContext,
} from "./service";
import { CommentError, CommentUnavailableError } from "./errors";
import type { Deck } from "@/lib/presentation/schema";
import { isRetryableSerializableTransactionError } from "@/lib/serializable-transaction";

const execFileAsync = promisify(execFile);
const REPO_ROOT = process.cwd();
const SQLITE_TEST_DB_DIRECTORY = resolvePath(REPO_ROOT, "prisma", ".test-dbs");

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

type FakeTransaction = <T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
) => Promise<T>;

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
  transactionOptions: Array<{
    isolationLevel?: Prisma.TransactionIsolationLevel;
  }> = [];

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
          parent:
            this.comments.find((parent) => parent.id === comment.parentId) ??
            null,
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
    deleteMany: async (args: { where: FakeWhere }) => {
      const deletedIds = this.comments
        .filter((comment) => matchesWhere(comment, args.where))
        .map((comment) => comment.id);
      this.comments = this.comments.filter(
        (comment) =>
          !deletedIds.includes(comment.id) &&
          !deletedIds.includes(comment.parentId ?? ""),
      );
      return { count: deletedIds.length };
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

  $transaction: FakeTransaction = async (operation, options = {}) => {
    this.transactionOptions.push(options);
    const commentsBefore = this.comments.map((comment) => ({
      ...comment,
      author: { ...comment.author },
    }));
    const readsBefore = this.reads.map((read) => ({ ...read }));
    try {
      return await operation(this as never);
    } catch (error) {
      this.comments = commentsBefore;
      this.reads = readsBefore;
      throw error;
    }
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

function prismaAdapterTimeoutError(
  originalCode: string,
  originalMessage: string,
): Prisma.PrismaClientKnownRequestError {
  const driverAdapterError = Object.assign(new Error("SocketTimeout"), {
    name: "DriverAdapterError",
    cause: {
      originalCode,
      originalMessage,
      kind: "SocketTimeout",
    },
  });

  return new Prisma.PrismaClientKnownRequestError("Operation has timed out", {
    code: "P1008",
    clientVersion: "7.8.0",
    meta: {
      modelName: "Comment",
      driverAdapterError,
    },
  });
}

test("serializable transaction retry classification keeps PostgreSQL write conflicts retryable", () => {
  assert.equal(
    isRetryableSerializableTransactionError({ code: "P2034" }),
    true,
  );
  assert.equal(
    isRetryableSerializableTransactionError({
      cause: {
        cause: new Prisma.PrismaClientKnownRequestError(
          "Transaction failed due to a write conflict or a deadlock",
          {
            code: "P2034",
            clientVersion: "7.8.0",
          },
        ),
      },
    }),
    true,
  );
});

test("serializable transaction retry classification recognizes Prisma SQLite adapter lock timeouts", () => {
  assert.equal(
    isRetryableSerializableTransactionError(
      prismaAdapterTimeoutError("SQLITE_BUSY", "database is locked"),
    ),
    true,
  );
  assert.equal(
    isRetryableSerializableTransactionError(
      prismaAdapterTimeoutError(
        "SQLITE_LOCKED",
        "database table is locked: Comment",
      ),
    ),
    true,
  );
});

test("serializable transaction retry classification rejects generic Prisma timeouts", () => {
  assert.equal(
    isRetryableSerializableTransactionError(
      new Prisma.PrismaClientKnownRequestError("Operation has timed out", {
        code: "P1008",
        clientVersion: "7.8.0",
      }),
    ),
    false,
  );
  assert.equal(
    isRetryableSerializableTransactionError({ code: "P2002" }),
    false,
  );
  assert.equal(
    isRetryableSerializableTransactionError({
      code: "P1008",
      meta: {
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            kind: "SocketTimeout",
            originalCode: "SQLITE_BUSY",
          },
        },
      },
    }),
    false,
  );
  assert.equal(
    isRetryableSerializableTransactionError({
      cause: { code: "SQLITE_BUSY" },
    }),
    false,
  );
  assert.equal(
    isRetryableSerializableTransactionError({
      code: "P1008",
      meta: {
        name: "DriverAdapterError",
        kind: "SocketTimeout",
        originalCode: "SQLITE_BUSY",
        originalMessage: "database is locked",
      },
    }),
    false,
  );
});

test("serializable transaction retry classification safely rejects cyclic metadata", () => {
  const cyclicCause: Record<string, unknown> = {};
  cyclicCause.cause = cyclicCause;

  const cyclicAdapterError: Record<string, unknown> = {
    name: "DriverAdapterError",
  };
  cyclicAdapterError.cause = cyclicAdapterError;

  assert.equal(isRetryableSerializableTransactionError(cyclicCause), false);
  assert.equal(
    isRetryableSerializableTransactionError({
      code: "P1008",
      meta: { driverAdapterError: cyclicAdapterError },
    }),
    false,
  );
});

test("serializable transaction retry classification bounds cause and adapter inspection depth", () => {
  const deeplyNestedP2034: Record<string, unknown> = { code: "P2034" };
  let causeChain = deeplyNestedP2034;
  for (let depth = 0; depth < 100; depth += 1) {
    causeChain = { cause: causeChain };
  }

  const deeplyNestedSqliteMetadata: Record<string, unknown> = {
    kind: "SocketTimeout",
    originalCode: "SQLITE_LOCKED",
    originalMessage: "database table is locked: Comment",
  };
  let adapterCauseChain = deeplyNestedSqliteMetadata;
  for (let depth = 0; depth < 100; depth += 1) {
    adapterCauseChain = { cause: adapterCauseChain };
  }

  assert.equal(isRetryableSerializableTransactionError(causeChain), false);
  assert.equal(
    isRetryableSerializableTransactionError({
      code: "P1008",
      meta: {
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: adapterCauseChain,
        },
      },
    }),
    false,
  );
});

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

test("comment service creates replies atomically and rejects missing parent comments", async () => {
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
  assert.deepEqual(db.transactionOptions, [
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  ]);

  await assert.rejects(
    () =>
      service.createComment("doc-1", {
        parentId: "missing",
        body: "Nope",
      }),
    /Parent comment not found/,
  );
});

test("comment service atomically reopens a resolved root when adding a reply", async () => {
  const db = new FakeDb([
    rootComment({ id: "thread-1", resolved: true, authorId: "author-1" }),
  ]);
  const { service } = makeService(db, "author-2");

  const result = await service.createComment("doc-1", {
    parentId: "thread-1",
    body: "New activity",
  });

  assert.equal(db.comments[0].resolved, false);
  assert.equal(db.comments[1].parentId, "thread-1");
  assert.equal(result.threads[0].resolved, false);
  assert.equal(result.threads[0].replies.length, 1);
});

test("comment service retries a reply/delete race and returns parent_not_found without an orphan", async () => {
  const db = new FakeDb([
    rootComment({ id: "thread-1", resolved: true, authorId: "author-1" }),
  ]);
  let attempt = 0;
  db.$transaction = async (operation, options = {}) => {
    db.transactionOptions.push(options);
    attempt += 1;
    const beforeAttempt = db.comments.map((comment) => ({
      ...comment,
      author: { ...comment.author },
    }));
    try {
      const result = await operation(db as never);
      if (attempt === 1) {
        db.comments = beforeAttempt.filter(
          (comment) => comment.id !== "thread-1",
        );
        throw Object.assign(new Error("serialization conflict"), {
          code: "P2034",
        });
      }
      return result;
    } catch (error) {
      if (attempt !== 1) {
        db.comments = beforeAttempt;
      }
      throw error;
    }
  };
  const { service } = makeService(db, "author-2");

  await assert.rejects(
    () =>
      service.createComment("doc-1", {
        parentId: "thread-1",
        body: "Racing reply",
      }),
    (error: unknown) =>
      error instanceof CommentError && error.code === "parent_not_found",
  );

  assert.equal(attempt, 2);
  assert.equal(db.comments.length, 0);
});

test("comment service rolls back root reopening when reply insertion fails", async () => {
  const db = new FakeDb([
    rootComment({ id: "thread-1", resolved: true, authorId: "author-1" }),
  ]);
  db.comment.create = async () => {
    throw new Error("reply insert failed");
  };
  const { service } = makeService(db, "author-2");

  await assert.rejects(
    () =>
      service.createComment("doc-1", {
        parentId: "thread-1",
        body: "Reply",
      }),
    /reply insert failed/,
  );

  assert.equal(db.comments.length, 1);
  assert.equal(db.comments[0].resolved, true);
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
  const { service } = makeService(
    db,
    "author-1",
    async (_documentId, transactionDb) => {
      assert.equal(transactionDb, db as never);
      return buildDeck([{ id: "slide-1", elementIds: ["element-1"] }]);
    },
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
  assert.deepEqual(db.transactionOptions, [
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  ]);
});

test("comment service retries a serialization conflict and rejects an anchor removed by the concurrent deck save", async () => {
  const db = new FakeDb();
  let attempt = 0;
  db.$transaction = async (operation, options = {}) => {
    db.transactionOptions.push(options);
    attempt += 1;
    const beforeAttempt = [...db.comments];
    const result = await operation(db as never);
    if (attempt === 1) {
      assert.equal(db.comments.length, 1);
      db.comments = beforeAttempt;
      throw Object.assign(new Error("serialization conflict"), {
        code: "P2034",
      });
    }
    return result;
  };
  const { service } = makeService(
    db,
    "author-1",
    async (_documentId, transactionDb) => {
      assert.equal(transactionDb, db as never);
      return attempt === 1
        ? buildDeck([{ id: "slide-1", elementIds: ["element-1"] }])
        : buildDeck([{ id: "slide-1" }]);
    },
  );

  await assert.rejects(
    () =>
      service.createComment("doc-1", {
        body: "Racing anchor",
        slideId: "slide-1",
        elementId: "element-1",
      }),
    (error: unknown) =>
      error instanceof CommentError && error.code === "slide_anchor_orphaned",
  );

  assert.equal(attempt, 2);
  assert.equal(db.comments.length, 0);
  assert.equal(
    db.transactionOptions.every(
      (options) =>
        options.isolationLevel ===
        Prisma.TransactionIsolationLevel.Serializable,
    ),
    true,
  );
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
    (error: unknown) =>
      error instanceof CommentError &&
      error.code === "empty_body" &&
      error.message === "Comment cannot be empty.",
  );
  await assert.rejects(
    () => service.editComment("doc-1", "thread-1", "   "),
    (error: unknown) =>
      error instanceof CommentError && error.code === "empty_body",
  );
});

test("comment service scopes mutations to an authorized document and conceals missing, cross-document, and inaccessible targets", async () => {
  const db = new FakeDb([
    rootComment({
      id: "other-comment",
      documentId: "doc-other-workspace",
      authorId: "viewer",
    }),
  ]);
  const authorized = makeService(db, "viewer").service;

  for (const mutate of [
    () => authorized.editComment("doc-current", "missing", "Updated"),
    () => authorized.deleteComment("doc-current", "other-comment"),
    () => authorized.setCommentResolved("doc-current", "other-comment", true),
  ]) {
    await assert.rejects(
      mutate,
      (error: unknown) =>
        error instanceof CommentUnavailableError &&
        error.code === "comment_unavailable" &&
        error.message === "Comment is unavailable." &&
        error.classification === "target_missing_in_document",
    );
  }

  const inaccessible = createCommentService({
    db: db as never,
    requireDocumentContext: async () => {
      throw new DocumentPermissionError("Document not found.", null);
    },
  });
  await assert.rejects(
    () =>
      inaccessible.editComment(
        "doc-other-workspace",
        "other-comment",
        "Updated",
      ),
    (error: unknown) =>
      error instanceof CommentUnavailableError &&
      error.code === "comment_unavailable" &&
      error.message === "Comment is unavailable." &&
      error.classification === "document_not_visible",
  );
  assert.equal(db.comments[0].body, "Comment");
});

test("comment service preserves author-only edit and delete policy", async () => {
  const db = new FakeDb([
    rootComment({ id: "thread-1", authorId: "author-1" }),
  ]);
  const nonAuthor = makeService(db, "viewer").service;

  await assert.rejects(
    () => nonAuthor.editComment("doc-1", "thread-1", "Updated"),
    /own comments/,
  );
  await assert.rejects(
    () => nonAuthor.deleteComment("doc-1", "thread-1"),
    /own comments/,
  );

  const author = makeService(db, "author-1").service;
  await author.editComment("doc-1", "thread-1", "Updated");
  assert.equal(db.comments[0].body, "Updated");
  await author.deleteComment("doc-1", "thread-1");
  assert.equal(db.comments.length, 0);
});

test("comment service allows any viewer to resolve a thread", async () => {
  const db = new FakeDb([
    rootComment({ id: "thread-1", authorId: "author-1" }),
  ]);
  const { service } = makeService(db, "viewer");

  await service.setCommentResolved("doc-1", "thread-1", true);

  assert.equal(db.comments[0].resolved, true);
});

test("comment service rejects resolving a reply because resolved state belongs to roots", async () => {
  const db = new FakeDb([
    rootComment({ id: "thread-1", authorId: "author-1" }),
    rootComment({
      id: "reply-1",
      parentId: "thread-1",
      authorId: "author-2",
    }),
  ]);
  const { service } = makeService(db, "viewer");

  await assert.rejects(
    () => service.setCommentResolved("doc-1", "reply-1", true),
    (error: unknown) =>
      error instanceof CommentError && error.code === "thread_required",
  );

  assert.equal(db.comments[1].resolved, false);
});

test("comment service keeps resolution root-owned across reply deletion", async () => {
  const db = new FakeDb([
    rootComment({ id: "thread-1", authorId: "author-1" }),
    rootComment({
      id: "reply-1",
      parentId: "thread-1",
      authorId: "author-2",
    }),
  ]);
  const viewer = makeService(db, "viewer").service;
  const replyAuthor = makeService(db, "author-2").service;

  await viewer.setCommentResolved("doc-1", "thread-1", true);
  await replyAuthor.deleteComment("doc-1", "reply-1");

  assert.equal(db.comments.length, 1);
  assert.equal(db.comments[0].resolved, true);
});

test("comment service deletes an existing root and all of its replies", async () => {
  const db = new FakeDb([
    rootComment({ id: "thread-1", authorId: "author-1" }),
    rootComment({
      id: "reply-1",
      parentId: "thread-1",
      authorId: "author-2",
    }),
  ]);
  const service = makeService(db, "author-1").service;

  await service.deleteComment("doc-1", "thread-1");

  assert.deepEqual(db.comments, []);
});

test("comment service counts unread roots and replies in their root anchor scope", async () => {
  const db = new FakeDb(
    [
      rootComment({
        id: "text-root",
        authorId: "author-1",
        createdAt: new Date("2024-01-01T00:00:00Z"),
      }),
      rootComment({
        id: "text-reply",
        parentId: "text-root",
        authorId: "author-2",
        createdAt: new Date("2024-01-03T00:00:00Z"),
      }),
      rootComment({
        id: "slide-root",
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

  assert.equal(await service.getUnreadCommentCount("doc-1"), 2);
  assert.equal(await service.getUnreadCommentCount("doc-1", "slide"), 1);
  assert.equal(await service.getUnreadCommentCount("doc-1", "text"), 1);

  await service.markDocumentCommentsRead("doc-1");
  assert.equal(
    db.reads[0].lastReadAt.toISOString(),
    "2024-01-02T00:00:00.000Z",
  );
});

test("comment service integration keeps reply races atomic and rolls back reopening", async (t) => {
  await mkdir(SQLITE_TEST_DB_DIRECTORY, { recursive: true });
  const databaseFilePath = resolvePath(
    SQLITE_TEST_DB_DIRECTORY,
    `comment-reply-${randomUUID()}.db`,
  );
  const databaseUrl = `file:${databaseFilePath}`;
  await execFileAsync(
    "npx",
    ["prisma", "db", "push", "--schema", "prisma/schema.sqlite.prisma"],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DB_PROVIDER: "sqlite",
        DATABASE_URL: databaseUrl,
      },
    },
  );

  const firstClient = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
  });
  const secondClient = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
  });
  t.after(async () => {
    await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
    await rm(databaseFilePath, { force: true });
    await rm(`${databaseFilePath}-journal`, { force: true });
    await rm(`${databaseFilePath}-wal`, { force: true });
    await rm(`${databaseFilePath}-shm`, { force: true });
  });

  const ownerId = `owner-${randomUUID()}`;
  const replyAuthorId = `reply-author-${randomUUID()}`;
  const documentId = `document-${randomUUID()}`;
  await firstClient.user.createMany({
    data: [
      { id: ownerId, email: `${ownerId}@example.test` },
      { id: replyAuthorId, email: `${replyAuthorId}@example.test` },
    ],
  });
  await firstClient.document.create({
    data: {
      id: documentId,
      ownerId,
      title: "Comment integration",
    },
  });

  const rollbackRoot = await firstClient.comment.create({
    data: {
      documentId,
      authorId: ownerId,
      body: "Resolved root",
      resolved: true,
    },
  });
  const ghostService = createCommentService({
    db: firstClient,
    requireDocumentContext: async () => ({
      user: { id: `missing-${randomUUID()}` },
    }),
  });
  await assert.rejects(() =>
    ghostService.createComment(documentId, {
      parentId: rollbackRoot.id,
      body: "Cannot persist",
    }),
  );
  assert.deepEqual(
    await firstClient.comment.findUnique({
      where: { id: rollbackRoot.id },
      select: { resolved: true, replies: { select: { id: true } } },
    }),
    { resolved: true, replies: [] },
  );

  const cascadeRoot = await firstClient.comment.create({
    data: {
      documentId,
      authorId: ownerId,
      body: "Root with existing reply",
      replies: {
        create: {
          documentId,
          authorId: replyAuthorId,
          body: "Existing reply",
        },
      },
    },
  });
  const cascadeService = createCommentService({
    db: firstClient,
    requireDocumentContext: async () => ({
      user: { id: ownerId },
    }),
  });
  await cascadeService.deleteComment(documentId, cascadeRoot.id);
  assert.equal(
    await firstClient.comment.count({
      where: { OR: [{ id: cascadeRoot.id }, { parentId: cascadeRoot.id }] },
    }),
    0,
  );

  const racingRoot = await firstClient.comment.create({
    data: {
      documentId,
      authorId: ownerId,
      body: "Racing root",
      resolved: true,
    },
  });
  const replyService = createCommentService({
    db: firstClient,
    requireDocumentContext: async () => ({
      user: { id: replyAuthorId },
    }),
  });
  const [replyOutcome, deleteOutcome] = await Promise.allSettled([
    replyService.createComment(documentId, {
      parentId: racingRoot.id,
      body: "Concurrent reply",
    }),
    secondClient.comment.delete({ where: { id: racingRoot.id } }),
  ]);

  assert.equal(deleteOutcome.status, "fulfilled");
  if (replyOutcome.status === "rejected") {
    assert.ok(replyOutcome.reason instanceof CommentError);
    assert.equal(replyOutcome.reason.code, "parent_not_found");
  }
  assert.equal(
    await firstClient.comment.count({
      where: { OR: [{ id: racingRoot.id }, { parentId: racingRoot.id }] },
    }),
    0,
  );
});
