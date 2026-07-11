import assert from "node:assert/strict";
import { test } from "node:test";

import { isCommentUnread } from "./read-state";

const BASE_DATE = new Date("2024-06-01T12:00:00Z");
const BEFORE = new Date("2024-06-01T11:00:00Z");
const AFTER = new Date("2024-06-01T13:00:00Z");

test("isCommentUnread returns false for own comment regardless of lastReadAt", () => {
  assert.equal(
    isCommentUnread(
      { createdAt: BASE_DATE, authorId: "user-1" },
      "user-1",
      null,
    ),
    false,
  );
  assert.equal(
    isCommentUnread(
      { createdAt: BASE_DATE, authorId: "user-1" },
      "user-1",
      BEFORE,
    ),
    false,
  );
});

test("isCommentUnread returns true when lastReadAt is null for another author", () => {
  assert.equal(
    isCommentUnread(
      { createdAt: BASE_DATE, authorId: "author-1" },
      "user-1",
      null,
    ),
    true,
  );
});

test("isCommentUnread returns true when createdAt is after lastReadAt", () => {
  assert.equal(
    isCommentUnread(
      { createdAt: AFTER, authorId: "author-1" },
      "user-1",
      BASE_DATE,
    ),
    true,
  );
});

test("isCommentUnread returns false when createdAt is before lastReadAt", () => {
  assert.equal(
    isCommentUnread(
      { createdAt: BEFORE, authorId: "author-1" },
      "user-1",
      BASE_DATE,
    ),
    false,
  );
});

test("isCommentUnread returns false when createdAt equals lastReadAt (boundary)", () => {
  assert.equal(
    isCommentUnread(
      { createdAt: BASE_DATE, authorId: "author-1" },
      "user-1",
      BASE_DATE,
    ),
    false,
  );
});
