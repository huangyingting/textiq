import assert from "node:assert/strict";
import { test } from "node:test";

import { DocumentPermissionError } from "@/lib/auth/document-permissions";

import {
  adaptKnownCommentActionError,
  commentActionObservation,
  commentActionError,
  commentActionOk,
} from "./action-result";
import { CommentError, CommentUnavailableError } from "./errors";

test("comment action adapter preserves typed domain failures", () => {
  assert.deepEqual(
    adaptKnownCommentActionError(
      new CommentError("parent_not_found", "Parent comment not found."),
    ),
    {
      code: "parent_not_found",
      message: "Parent comment not found.",
    },
  );
});

test("comment action adapter conceals document permission details", () => {
  assert.deepEqual(
    adaptKnownCommentActionError(
      new DocumentPermissionError(
        "Document permissions are misconfigured because workspace membership data is invalid.",
        "view",
      ),
    ),
    {
      code: "access_denied",
      message: "You don't have access to this document.",
    },
  );
});

test("comment action adapter exposes one safe mutation outcome while retaining identifier-free classification", () => {
  for (const classification of [
    "document_not_visible",
    "target_missing_in_document",
    "target_changed",
  ] as const) {
    const error = new CommentUnavailableError(classification);
    assert.deepEqual(adaptKnownCommentActionError(error), {
      code: "comment_unavailable",
      message: "Comment is unavailable.",
    });
    assert.deepEqual(commentActionObservation(error), {
      message: "Comment mutation target unavailable.",
      context: { classification },
    });
  }
  assert.equal(commentActionObservation(new Error("unknown")), null);
});

test("comment action adapter leaves unknown persistence failures for logging", () => {
  assert.equal(
    adaptKnownCommentActionError(
      new Error("database connection string leaked"),
    ),
    null,
  );
  assert.deepEqual(commentActionOk(["thread-1"]), {
    ok: true,
    data: ["thread-1"],
  });
  assert.deepEqual(
    commentActionError({
      code: "unexpected",
      message: "Couldn't update comments. Please try again.",
    }),
    {
      ok: false,
      error: {
        code: "unexpected",
        message: "Couldn't update comments. Please try again.",
      },
    },
  );
});
