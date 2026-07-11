import assert from "node:assert/strict";
import { test } from "node:test";

import { canDeleteComment, canEditComment } from "./policy";

test("canEditComment returns true when userId matches comment authorId", () => {
  assert.equal(canEditComment("user-1", { authorId: "user-1" }), true);
});

test("canEditComment returns false when userId differs from comment authorId", () => {
  assert.equal(canEditComment("user-2", { authorId: "user-1" }), false);
});

test("canDeleteComment returns true when userId matches comment authorId", () => {
  assert.equal(canDeleteComment("user-1", { authorId: "user-1" }), true);
});

test("canDeleteComment returns false when userId differs from comment authorId", () => {
  assert.equal(canDeleteComment("editor", { authorId: "author-1" }), false);
});
