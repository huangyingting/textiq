import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EmptyInputError,
  GenerationError,
  InputTooLongError,
} from "@/lib/ai/generate";
import { ModelOutputBudgetError } from "@/lib/ai/generation-runner";
import { AI_GENERATION_INPUT_MAX_CHARS } from "@/lib/limits/ai";

import { mapGenerateError, parseGeneratePayload } from "./parser";

function assertParseStatus(
  body: Record<string, unknown>,
  expectedStatus: number,
): void {
  const result = parseGeneratePayload(body);
  assert.equal(result.ok, false);
  assert.equal(result.status, expectedStatus);
}

test("parseGeneratePayload accepts the full typed payload", () => {
  const result = parseGeneratePayload({
    text: "make a timeline",
    type: "timeline",
    orientation: "horizontal",
    detailLevel: "detailed",
    stayCloserToText: true,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.payload, {
    text: "make a timeline",
    type: "timeline",
    orientation: "horizontal",
    detailLevel: "detailed",
    stayCloserToText: true,
  });
});

test("parseGeneratePayload accepts a valid visual kind without other options", () => {
  assert.deepEqual(
    parseGeneratePayload({ text: "make a flowchart", type: "flowchart" }),
    {
      ok: true,
      payload: {
        text: "make a flowchart",
        type: "flowchart",
        orientation: undefined,
        detailLevel: undefined,
        stayCloserToText: undefined,
      },
    },
  );
});

test("parseGeneratePayload preserves validation statuses", () => {
  assert.deepEqual(parseGeneratePayload({ text: " " }), {
    ok: false,
    status: 400,
    message: "`text` is required.",
  });
  assertParseStatus(
    { text: "x".repeat(AI_GENERATION_INPUT_MAX_CHARS + 1) },
    413,
  );
  assertParseStatus({ text: "ok", type: "bad" }, 400);
});

test("parseGeneratePayload rejects non-string optional enums", () => {
  assertParseStatus({ text: "ok", type: 1 }, 400);
  assertParseStatus({ text: "ok", orientation: 1 }, 400);
  assertParseStatus({ text: "ok", detailLevel: 1 }, 400);
});

test("parseGeneratePayload rejects invalid orientation and detail options", () => {
  assert.deepEqual(
    parseGeneratePayload({ text: "ok", orientation: "diagonal" }),
    {
      ok: false,
      status: 400,
      message:
        "`orientation` must be one of: vertical, horizontal, square, auto.",
    },
  );
  assert.deepEqual(
    parseGeneratePayload({ text: "ok", detailLevel: "verbose" }),
    {
      ok: false,
      status: 400,
      message: "`detailLevel` must be one of: detailed, summary.",
    },
  );
});

test("parseGeneratePayload omits optional fields when null or false", () => {
  assert.deepEqual(
    parseGeneratePayload({
      text: "make a process",
      type: null,
      orientation: null,
      detailLevel: null,
      stayCloserToText: false,
    }),
    {
      ok: true,
      payload: {
        text: "make a process",
        type: undefined,
        orientation: undefined,
        detailLevel: undefined,
        stayCloserToText: undefined,
      },
    },
  );
});

test("mapGenerateError maps input validation errors and ignores unknown errors", () => {
  assert.deepEqual(mapGenerateError(new EmptyInputError()), {
    status: 400,
    message: "Input text is required.",
  });
  const tooLong = new InputTooLongError(AI_GENERATION_INPUT_MAX_CHARS + 1);
  assert.deepEqual(mapGenerateError(tooLong), {
    status: 413,
    message: tooLong.message,
  });
  assert.equal(mapGenerateError(new Error("unexpected")), null);
});

test("mapGenerateError preserves generation failure contract", () => {
  assert.deepEqual(mapGenerateError(new GenerationError("bad output")), {
    status: 502,
    message: "We couldn't generate visuals from that text. Please try again.",
    log: { reason: "generation-failed", status: 502 },
  });
});

test("mapGenerateError maps model-output budget failures safely", () => {
  assert.deepEqual(
    mapGenerateError(new ModelOutputBudgetError("bytes", 10, 5)),
    {
      status: 502,
      message: "The AI response was too large. Please try again.",
      log: { reason: "model-output-budget", status: 502 },
    },
  );
});
