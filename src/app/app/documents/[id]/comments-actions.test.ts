import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, beforeEach, describe, it } from "node:test";

import type {
  CommentMutationResult,
  CommentThread,
  CreateCommentInput,
  ListCommentsOptions,
  RequireCommentDocumentContext,
} from "@/lib/comments";

// This suite exercises the comments-actions.ts action boundary only: DI
// wiring into `@/lib/comments`, revalidation-path derivation from the
// service's *returned* documentId (not any caller-supplied id), and safe error
// adaptation. Ownership/validation rules (own-comment edit/delete, empty
// body, orphaned anchors, etc.) are the comment service's responsibility and
// are already covered by src/lib/comments/service.test.ts; they are not
// re-asserted here.

type ModuleHooks = {
  registerHooks(hooks: {
    resolve(
      specifier: string,
      context: unknown,
      nextResolve: (specifier: string, context: unknown) => unknown,
    ): unknown;
    load(
      url: string,
      context: unknown,
      nextLoad: (url: string, context: unknown) => unknown,
    ): unknown;
  }): void;
};

type FakeCommentService = {
  listComments(
    documentId: string,
    options?: ListCommentsOptions,
  ): Promise<CommentThread[]>;
  createComment(
    documentId: string,
    input: CreateCommentInput,
  ): Promise<CommentMutationResult>;
  editComment(
    documentId: string,
    commentId: string,
    newBody: string,
  ): Promise<CommentMutationResult>;
  deleteComment(
    documentId: string,
    commentId: string,
  ): Promise<CommentMutationResult>;
  setCommentResolved(
    documentId: string,
    commentId: string,
    resolved: boolean,
  ): Promise<CommentMutationResult>;
};

type CommentsActionsState = {
  calls: unknown[];
  requireDocumentActionContext: RequireCommentDocumentContext;
  service: FakeCommentService;
  revalidatePath: (path: string) => void;
  logError: (scope: string, error: unknown) => void;
  logInfo: (
    scope: string,
    message: string,
    context: Record<string, unknown>,
  ) => void;
};

function thread(id: string): CommentThread {
  return {
    id,
    body: "body",
    author: { id: "author-1", name: "Author" },
    createdAt: "2026-01-01T00:00:00.000Z",
    resolved: false,
    anchor: { kind: "deck" },
    anchorType: null,
    anchorText: null,
    anchorNodeId: null,
    replies: [],
  };
}

const globalForComments = globalThis as typeof globalThis & {
  __commentsActionsState: CommentsActionsState;
  // Captured once, at module-singleton construction time in
  // comments-actions.ts, so it is intentionally NOT reset in beforeEach.
  __commentsActionsWiring: RequireCommentDocumentContext | null;
};

function state(): CommentsActionsState {
  return globalForComments.__commentsActionsState;
}

function createDefaultState(): CommentsActionsState {
  const calls: unknown[] = [];
  const requireDocumentActionContext: RequireCommentDocumentContext = async (
    documentId,
    capability,
  ) => {
    calls.push(["requireDocumentActionContext", documentId, capability]);
    return { user: { id: "user-1" } };
  };

  const service: FakeCommentService = {
    async listComments(documentId, options = {}) {
      await state().requireDocumentActionContext(documentId, "view");
      calls.push(["service.listComments", documentId, options]);
      return [thread("comment-list")];
    },
    async createComment(documentId, input) {
      await state().requireDocumentActionContext(documentId, "view");
      calls.push(["service.createComment", documentId, input]);
      return { documentId, threads: [thread("comment-created")] };
    },
    async editComment(documentId, commentId, newBody) {
      calls.push(["service.editComment", documentId, commentId, newBody]);
      await state().requireDocumentActionContext(documentId, "view");
      return {
        documentId,
        threads: [thread("comment-edited")],
      };
    },
    async deleteComment(documentId, commentId) {
      calls.push(["service.deleteComment", documentId, commentId]);
      await state().requireDocumentActionContext(documentId, "view");
      return {
        documentId,
        threads: [thread("comment-after-delete")],
      };
    },
    async setCommentResolved(documentId, commentId, resolved) {
      calls.push([
        "service.setCommentResolved",
        documentId,
        commentId,
        resolved,
      ]);
      await state().requireDocumentActionContext(documentId, "view");
      return {
        documentId,
        threads: [thread("comment-resolved")],
      };
    },
  };

  return {
    calls,
    requireDocumentActionContext,
    service,
    revalidatePath(path) {
      calls.push(["revalidatePath", path]);
    },
    logError(scope, error) {
      calls.push(["logError", scope, error]);
    },
    logInfo(scope, message, context) {
      calls.push(["logInfo", scope, message, context]);
    },
  };
}

globalForComments.__commentsActionsState = createDefaultState();
globalForComments.__commentsActionsWiring = null;

const { registerHooks } = createRequire(import.meta.url)(
  "node:module",
) as ModuleHooks;

const stubPrefix = "textiq-comments-actions-test:";
const stubbedModules = new Map<string, string>([
  [
    "next/cache",
    `
      export function revalidatePath(path) {
        globalThis.__commentsActionsState.revalidatePath(path);
      }
    `,
  ],
  [
    "next/navigation",
    `
      export function unstable_rethrow(error) {
        if (
          error?.message === "NEXT_REDIRECT" ||
          String(error?.digest ?? "").startsWith("NEXT_REDIRECT")
        ) {
          throw error;
        }
      }
    `,
  ],
  [
    "@/lib/log",
    `
      export function logError(scope, error) {
        globalThis.__commentsActionsState.logError(scope, error);
      }
      export function logInfo(scope, message, context) {
        globalThis.__commentsActionsState.logInfo(scope, message, context);
      }
    `,
  ],
  [
    "./document-context",
    `
      export async function requireDocumentActionContext(...args) {
        return globalThis.__commentsActionsState.requireDocumentActionContext(...args);
      }
    `,
  ],
  [
    "@/lib/comments",
    `
      export function createCommentService(deps) {
        // Captured once at module-load time; comments-actions.ts builds this
        // service singleton exactly once per process, so this only ever
        // runs during the initial dynamic import() below.
        globalThis.__commentsActionsWiring = deps.requireDocumentContext;
        return {
          listComments: (...args) => globalThis.__commentsActionsState.service.listComments(...args),
          createComment: (...args) => globalThis.__commentsActionsState.service.createComment(...args),
          editComment: (...args) => globalThis.__commentsActionsState.service.editComment(...args),
          deleteComment: (...args) => globalThis.__commentsActionsState.service.deleteComment(...args),
          setCommentResolved: (...args) => globalThis.__commentsActionsState.service.setCommentResolved(...args),
        };
      }
    `,
  ],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (stubbedModules.has(specifier)) {
      return {
        url: `${stubPrefix}${encodeURIComponent(specifier)}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(stubPrefix)) {
      const specifier = decodeURIComponent(url.slice(stubPrefix.length));
      return {
        format: "module",
        source: stubbedModules.get(specifier) ?? "",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

let commentsActions: typeof import("./comments-actions");
let CommentErrorCtor: typeof import("@/lib/comments/errors").CommentError;
let CommentUnavailableErrorCtor: typeof import("@/lib/comments/errors").CommentUnavailableError;
let DocumentPermissionErrorCtor: typeof import("@/lib/auth/document-permissions").DocumentPermissionError;

before(async () => {
  ({
    CommentError: CommentErrorCtor,
    CommentUnavailableError: CommentUnavailableErrorCtor,
  } = await import("@/lib/comments/errors"));
  ({ DocumentPermissionError: DocumentPermissionErrorCtor } =
    await import("@/lib/auth/document-permissions"));
  commentsActions = await import("./comments-actions");
});

beforeEach(() => {
  globalForComments.__commentsActionsState = createDefaultState();
});

describe("comments actions module wiring", () => {
  it("builds the singleton comment service from the live document-context dependency", async () => {
    // comments-actions.ts constructs its comment service exactly once, at
    // module-load time, injecting the shared document-context module's
    // `requireDocumentActionContext` as the service's auth dependency. Prove
    // the captured dependency is actually live-wired (not an inert
    // placeholder) by swapping the document-context stub's behavior and
    // observing it take effect through the captured function.
    assert.equal(typeof globalForComments.__commentsActionsWiring, "function");

    globalForComments.__commentsActionsState.requireDocumentActionContext =
      async (documentId, capability) => {
        globalForComments.__commentsActionsState.calls.push([
          "wiring-probe",
          documentId,
          capability,
        ]);
        return { user: { id: "probe-user" } };
      };

    await globalForComments.__commentsActionsWiring?.("doc-probe", "view");
    assert.deepEqual(globalForComments.__commentsActionsState.calls, [
      ["wiring-probe", "doc-probe", "view"],
    ]);
  });
});

describe("comments actions read path", () => {
  it("forwards documentId and options without revalidating", async () => {
    const result = await commentsActions.listComments("doc-1", {
      anchorScope: "slide",
      slideId: "slide-1",
    });

    assert.deepEqual(result, {
      ok: true,
      data: [thread("comment-list")],
    });
    assert.deepEqual(state().calls, [
      ["requireDocumentActionContext", "doc-1", "view"],
      [
        "service.listComments",
        "doc-1",
        { anchorScope: "slide", slideId: "slide-1" },
      ],
    ]);
  });

  it("adapts read denial without exposing authorization details", async () => {
    state().requireDocumentActionContext = async () => {
      throw new DocumentPermissionErrorCtor(
        "Document permissions are misconfigured.",
        "view",
      );
    };

    assert.deepEqual(await commentsActions.listComments("doc-1"), {
      ok: false,
      error: {
        code: "access_denied",
        message: "You don't have access to this document.",
      },
    });
    assert.deepEqual(state().calls, []);
  });
});

describe("comments actions mutation revalidation", () => {
  it("creates a comment and revalidates using the service's documentId", async () => {
    const threads = await commentsActions.createComment("doc-1", {
      body: "Hello",
    });

    assert.deepEqual(threads, {
      ok: true,
      data: [thread("comment-created")],
    });
    assert.deepEqual(state().calls, [
      ["requireDocumentActionContext", "doc-1", "view"],
      ["service.createComment", "doc-1", { body: "Hello" }],
      ["revalidatePath", "/app/documents/doc-1"],
    ]);
  });

  it("edits, deletes, and resolves within the caller-supplied document boundary", async () => {
    const editedThreads = await commentsActions.editComment(
      "doc-owning",
      "comment-9",
      "Updated body",
    );
    assert.deepEqual(editedThreads, {
      ok: true,
      data: [thread("comment-edited")],
    });
    assert.deepEqual(state().calls.at(-1), [
      "revalidatePath",
      "/app/documents/doc-owning",
    ]);

    state().calls.length = 0;
    const deletedThreads = await commentsActions.deleteComment(
      "doc-owning",
      "comment-9",
    );
    assert.deepEqual(deletedThreads, {
      ok: true,
      data: [thread("comment-after-delete")],
    });
    assert.deepEqual(state().calls.at(-1), [
      "revalidatePath",
      "/app/documents/doc-owning",
    ]);

    state().calls.length = 0;
    const resolvedThreads = await commentsActions.setCommentResolved(
      "doc-owning",
      "comment-9",
      true,
    );
    assert.deepEqual(resolvedThreads, {
      ok: true,
      data: [thread("comment-resolved")],
    });
    assert.deepEqual(state().calls, [
      ["service.setCommentResolved", "doc-owning", "comment-9", true],
      ["requireDocumentActionContext", "doc-owning", "view"],
      ["revalidatePath", "/app/documents/doc-owning"],
    ]);
  });

  it("returns typed comment service errors without revalidating", async () => {
    state().service.createComment = async () => {
      throw new CommentErrorCtor(
        "parent_not_found",
        "Parent comment not found.",
      );
    };

    assert.deepEqual(
      await commentsActions.createComment("doc-1", { body: "Hello" }),
      {
        ok: false,
        error: {
          code: "parent_not_found",
          message: "Parent comment not found.",
        },
      },
    );
    assert.deepEqual(
      state().calls.filter(
        (call) => (call as unknown[])[0] === "revalidatePath",
      ),
      [],
    );

    state().service.editComment = async () => {
      throw new CommentErrorCtor(
        "edit_forbidden",
        "You can only edit your own comments.",
      );
    };
    assert.deepEqual(
      await commentsActions.editComment("doc-1", "comment-9", "New body"),
      {
        ok: false,
        error: {
          code: "edit_forbidden",
          message: "You can only edit your own comments.",
        },
      },
    );
    assert.deepEqual(
      state().calls.filter(
        (call) => (call as unknown[])[0] === "revalidatePath",
      ),
      [],
    );
  });

  it("logs unknown persistence failures and returns a sanitized result", async () => {
    const persistenceError = new Error(
      "connection failed for postgres://private-host",
    );
    state().service.deleteComment = async () => {
      throw persistenceError;
    };

    assert.deepEqual(
      await commentsActions.deleteComment("doc-1", "comment-9"),
      {
        ok: false,
        error: {
          code: "unexpected",
          message: "Couldn't update comments. Please try again.",
        },
      },
    );

    assert.deepEqual(state().calls, [
      ["logError", "comments.delete", persistenceError],
    ]);
  });

  it("returns one safe outcome for missing, cross-document, and inaccessible mutation targets while logging identifier-free classification", async () => {
    const outcomes = [];
    const classifications = [
      "target_missing_in_document",
      "document_not_visible",
      "target_changed",
    ] as const;
    const operations = [
      {
        name: "edit",
        setFailure(classification: (typeof classifications)[number]) {
          state().service.editComment = async () => {
            throw new CommentUnavailableErrorCtor(classification);
          };
        },
        run: () =>
          commentsActions.editComment(
            "doc-current",
            "comment-secret",
            "Updated",
          ),
      },
      {
        name: "delete",
        setFailure(classification: (typeof classifications)[number]) {
          state().service.deleteComment = async () => {
            throw new CommentUnavailableErrorCtor(classification);
          };
        },
        run: () =>
          commentsActions.deleteComment("doc-current", "comment-secret"),
      },
      {
        name: "resolve",
        setFailure(classification: (typeof classifications)[number]) {
          state().service.setCommentResolved = async () => {
            throw new CommentUnavailableErrorCtor(classification);
          };
        },
        run: () =>
          commentsActions.setCommentResolved(
            "doc-current",
            "comment-secret",
            true,
          ),
      },
    ] as const;
    for (const operation of operations) {
      for (const classification of classifications) {
        operation.setFailure(classification);
        outcomes.push(await operation.run());
      }
    }

    assert.deepEqual(
      outcomes,
      Array.from(
        { length: operations.length * classifications.length },
        () => ({
          ok: false,
          error: {
            code: "comment_unavailable",
            message: "Comment is unavailable.",
          },
        }),
      ),
    );
    const observations = state().calls.filter(
      (call) => (call as unknown[])[0] === "logInfo",
    );
    assert.deepEqual(
      observations,
      operations.flatMap((operation) =>
        classifications.map((classification) => [
          "logInfo",
          `comments.${operation.name}`,
          "Comment mutation target unavailable.",
          { classification },
        ]),
      ),
    );
    assert.doesNotMatch(
      JSON.stringify(observations),
      /doc-current|comment-secret/,
    );
  });

  it("rethrows framework redirect control flow", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    state().service.createComment = async () => {
      throw redirect;
    };

    await assert.rejects(
      () => commentsActions.createComment("doc-1", { body: "Hello" }),
      redirect,
    );
    assert.deepEqual(state().calls, []);
  });
});
