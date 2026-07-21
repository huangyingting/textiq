import assert from "node:assert/strict";
import { test } from "node:test";

import {
  validateAddElementPayload,
  validateElementContentPayload,
  validateElementDesignOverridesPayload,
  validateElementPatchPayload,
  validateElementRole,
} from "./elements";

// ---------------------------------------------------------------------------
// Command payload validators — add/update element command boundaries.
// ---------------------------------------------------------------------------

test("validateAddElementPayload accepts an add-element shape without id or zIndex", () => {
  const result = validateAddElementPayload(
    {
      kind: "shape",
      box: { x: 0, y: 0, w: 10, h: 10 },
      content: { kind: "shape", shape: "rect" },
    },
    "payload.element",
  );
  assert.equal(result.id, "__command_validation_element__");
  assert.equal(result.zIndex, 0);
  assert.equal(result.kind, "shape");
});

test("validateAddElementPayload rejects malformed add-element content", () => {
  assert.throws(
    () =>
      validateAddElementPayload(
        {
          kind: "visual",
          box: { x: 0, y: 0, w: 10, h: 10 },
          content: { kind: "visual", visualId: "" },
        },
        "payload.element",
      ),
    {
      message:
        /^payload\.element\.content\.visualId must be a non-empty string$/,
    },
  );
});

test("validateElementPatchPayload accepts valid mutable element fields", () => {
  const result = validateElementPatchPayload(
    {
      box: { x: 1, y: 2, w: 3, h: 4 },
      hidden: false,
      locked: true,
      content: { kind: "shape", shape: "ellipse" },
      designOverrides: { fill: { value: "#ff00ff" } },
      role: "body",
    },
    "payload.patch",
  );
  assert.deepEqual(result.box, { x: 1, y: 2, w: 3, h: 4 });
  assert.equal(result.hidden, false);
  assert.equal(result.locked, true);
});

test("validateElementPatchPayload rejects immutable and typed-wrong patch fields", () => {
  assert.throws(
    () => validateElementPatchPayload({ kind: "shape" }, "payload.patch"),
    {
      message: /^payload\.patch\.kind is not part of the current schema$/,
    },
  );
  assert.throws(
    () => validateElementPatchPayload({ hidden: 1 }, "payload.patch"),
    { message: /^payload\.patch\.hidden must be a boolean$/ },
  );
});

test("validateElementContentPayload validates standalone element content", () => {
  assert.deepEqual(
    validateElementContentPayload(
      { kind: "text", text: "Hello" },
      "payload.content",
    ),
    {
      kind: "text",
      text: "Hello",
      paragraphs: [{ text: "Hello" }],
    },
  );
  assert.throws(
    () =>
      validateElementContentPayload(
        { kind: "visual", visualId: "" },
        "payload.content",
      ),
    { message: /^payload\.content\.visualId must be a non-empty string$/ },
  );
});

test("validateElementDesignOverridesPayload and role helper reject invalid command values", () => {
  assert.throws(
    () =>
      validateElementDesignOverridesPayload(
        { fill: "red" },
        "payload.designOverrides",
      ),
    { message: /^payload\.designOverrides\.fill must be an object$/ },
  );
  assert.throws(() => validateElementRole("hero", "payload.role"), {
    message: /^payload\.role must be one of:/,
  });
});
