import assert from "node:assert/strict";
import { test } from "node:test";

import { isValidBase64, parseCollabFlushPayload } from "./parser";

test("parseCollabFlushPayload accepts the canonical documentId", () => {
  assert.deepEqual(
    parseCollabFlushPayload({ documentId: " doc ", update: "AQID" }),
    {
      ok: true,
      payload: { documentId: "doc", update: "AQID" },
    },
  );
});

test("parseCollabFlushPayload preserves validation messages", () => {
  assert.deepEqual(parseCollabFlushPayload({ update: "AQID" }), {
    ok: false,
    status: 400,
    message: "Missing documentId.",
  });
  assert.deepEqual(
    parseCollabFlushPayload({ documentId: "doc", update: "bad" }),
    {
      ok: false,
      status: 400,
      message: "Missing or invalid update.",
    },
  );
  assert.equal(isValidBase64(""), false);
});

test("parseCollabFlushPayload rejects non-object JSON as missing documentId", () => {
  for (const body of [null, 42, true, "payload", ["doc", "AQID"]]) {
    assert.deepEqual(parseCollabFlushPayload(body), {
      ok: false,
      status: 400,
      message: "Missing documentId.",
    });
  }
});
