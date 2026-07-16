import assert from "node:assert/strict";
import { test } from "node:test";

import {
  commentUnreadScope,
  isCommentUnread,
  isCommentUnreadForScope,
} from "./read-state";

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

test("reply unread scope is inherited from its top-level thread", () => {
  const textReply = {
    createdAt: AFTER,
    authorId: "author-1",
    slideId: null,
    parent: { slideId: null },
  };
  const slideReply = {
    ...textReply,
    parent: { slideId: "slide-1" },
  };

  assert.equal(commentUnreadScope(textReply), "text");
  assert.equal(commentUnreadScope(slideReply), "slide");
  assert.equal(
    isCommentUnreadForScope(slideReply, "user-1", BASE_DATE, "slide"),
    true,
  );
  assert.equal(
    isCommentUnreadForScope(slideReply, "user-1", BASE_DATE, "text"),
    false,
  );
});

test("top-level unread scope comes from its own slide anchor", () => {
  const textRoot = {
    createdAt: AFTER,
    authorId: "author-1",
    slideId: null,
    parent: null,
  };
  const slideRoot = { ...textRoot, slideId: "slide-1" };

  assert.equal(commentUnreadScope(textRoot), "text");
  assert.equal(commentUnreadScope(slideRoot), "slide");
  assert.equal(
    isCommentUnreadForScope(textRoot, "user-1", BASE_DATE, "all"),
    true,
  );
});
