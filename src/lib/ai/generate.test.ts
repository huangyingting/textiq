import assert from "node:assert/strict";
import test from "node:test";

import {
  EmptyInputError,
  GenerationError,
  InputTooLongError,
  MIN_CANDIDATES,
  coerceCandidates,
  extractJson,
  generateVisuals,
} from "@/lib/ai/generate";
import { AI_GENERATION_INPUT_MAX_CHARS } from "@/lib/limits/ai";
import { VISUAL_SCHEMA_VERSION } from "@/lib/visual/schema";

function visual(type = "flowchart") {
  return {
    version: VISUAL_SCHEMA_VERSION,
    type,
    nodes: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    edges: [{ id: "e1", from: "a", to: "b" }],
  };
}

function payload(count: number, type = "flowchart"): string {
  return JSON.stringify({
    visuals: Array.from({ length: count }, () => visual(type)),
  });
}

interface Sequence {
  complete: (messages: unknown) => Promise<string>;
  calls: { count: number; messages: unknown[] };
}

function sequence(responses: string[]): Sequence {
  const calls = { count: 0, messages: [] as unknown[] };
  const complete = async (messages: unknown): Promise<string> => {
    calls.messages.push(messages);
    const response = responses[Math.min(calls.count, responses.length - 1)];
    calls.count += 1;
    return response;
  };
  return { complete, calls };
}

test("returns at least MIN_CANDIDATES validated visuals", async () => {
  const { complete, calls } = sequence([payload(3)]);
  const result = await generateVisuals({ text: "some text" }, { complete });
  assert.equal(calls.count, 1);
  assert.ok(result.length >= MIN_CANDIDATES);
  for (const candidate of result) {
    assert.equal(candidate.version, VISUAL_SCHEMA_VERSION);
    // Validation fills in defaults (e.g. style/width/height).
    assert.ok(candidate.style);
    assert.ok(candidate.width > 0);
  }
});

test("rejects input longer than AI_GENERATION_INPUT_MAX_CHARS before any LLM call", async () => {
  let called = false;
  const complete = async (): Promise<string> => {
    called = true;
    return payload(3);
  };
  await assert.rejects(
    generateVisuals(
      { text: "x".repeat(AI_GENERATION_INPUT_MAX_CHARS + 1) },
      { complete },
    ),
    (error) => error instanceof InputTooLongError,
  );
  assert.equal(
    called,
    false,
    "complete() must not be called for oversized input",
  );
});

test("accepts input exactly at the limit", async () => {
  const { complete } = sequence([payload(3)]);
  const result = await generateVisuals(
    { text: "y".repeat(AI_GENERATION_INPUT_MAX_CHARS) },
    { complete },
  );
  assert.ok(result.length >= MIN_CANDIDATES);
});

test("rejects empty/blank input before any LLM call", async () => {
  let called = false;
  const complete = async (): Promise<string> => {
    called = true;
    return payload(3);
  };
  await assert.rejects(
    generateVisuals({ text: "   \n  " }, { complete }),
    (error) => error instanceof EmptyInputError,
  );
  assert.equal(called, false);
});

test("retries on garbled output then succeeds", async () => {
  const { complete, calls } = sequence(["this is not json", payload(3)]);
  const result = await generateVisuals(
    { text: "hello" },
    { complete, maxAttempts: 2 },
  );
  assert.equal(calls.count, 2);
  assert.ok(result.length >= MIN_CANDIDATES);
});

test("throws GenerationError when output never parses", async () => {
  const { complete, calls } = sequence(["nope"]);
  await assert.rejects(
    generateVisuals({ text: "hello" }, { complete, maxAttempts: 3 }),
    (error) =>
      error instanceof GenerationError &&
      error.message ===
        "Could not generate 3 valid visuals after 3 attempt(s). The AI response was not valid JSON.",
  );
  assert.equal(calls.count, 3);
});

test("throws GenerationError when fewer than MIN_CANDIDATES are valid", async () => {
  const { complete } = sequence([payload(2)]);
  await assert.rejects(
    generateVisuals({ text: "hello" }, { complete, maxAttempts: 1 }),
    (error) => error instanceof GenerationError,
  );
});

test("extracts JSON wrapped in code fences", async () => {
  const fenced = "```json\n" + payload(3) + "\n```";
  const { complete } = sequence([fenced]);
  const result = await generateVisuals({ text: "hello" }, { complete });
  assert.ok(result.length >= MIN_CANDIDATES);
});

test("filters invalid candidates and keeps the valid ones", async () => {
  const mixed = JSON.stringify({
    visuals: [
      visual(),
      { version: 1, type: "not-a-kind", nodes: [] },
      visual(),
      { garbage: true },
      visual(),
    ],
  });
  const { complete } = sequence([mixed]);
  const result = await generateVisuals(
    { text: "hello" },
    { complete, maxAttempts: 1 },
  );
  assert.equal(result.length, 3);
});

test("drops invalid icon names without failing generation", async () => {
  const mixed = JSON.stringify({
    visuals: [
      {
        ...visual(),
        nodes: [
          { id: "a", label: "Idea", icon: "Lightbulb" },
          { id: "b", label: "Review", icon: "NotAnIcon" },
        ],
      },
      visual(),
      visual(),
    ],
  });
  const { complete } = sequence([mixed]);
  const result = await generateVisuals(
    { text: "hello" },
    { complete, maxAttempts: 1 },
  );
  assert.equal(result.length, 3);
  assert.equal(result[0]?.nodes[0]?.icon, "Lightbulb");
  assert.equal(result[0]?.nodes[1]?.icon, undefined);
});

test("prefers candidates matching the requested type", async () => {
  const mixed = JSON.stringify({
    visuals: [
      visual("mindmap"),
      visual("flowchart"),
      visual("mindmap"),
      visual("flowchart"),
    ],
  });
  const { complete } = sequence([mixed]);
  const result = await generateVisuals(
    { text: "hello", type: "flowchart" },
    { complete, maxAttempts: 1 },
  );
  assert.equal(result[0].type, "flowchart");
});

test("wraps a failing complete() as GenerationError", async () => {
  const complete = async (): Promise<string> => {
    throw new Error("network down");
  };
  await assert.rejects(
    generateVisuals({ text: "hello" }, { complete, maxAttempts: 2 }),
    (error) => error instanceof GenerationError,
  );
});

test("extractJson handles objects, arrays, fences, and surrounding prose", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson("[1,2,3]"), [1, 2, 3]);
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('prefix {"a":3} suffix'), { a: 3 });
  assert.equal(extractJson("not json at all"), undefined);
  assert.equal(extractJson(""), undefined);
});

test("coerceCandidates accepts only the current visuals wrapper", () => {
  assert.equal(coerceCandidates({ visuals: [1, 2] }).length, 2);
  assert.equal(coerceCandidates({ visuals: "not an array" }).length, 0);
  assert.equal(coerceCandidates({ candidates: [1] }).length, 0);
  assert.equal(coerceCandidates({ options: [1, 2, 3] }).length, 0);
  assert.equal(coerceCandidates({ results: [1] }).length, 0);
  assert.equal(coerceCandidates([1, 2]).length, 0);
  assert.equal(coerceCandidates({ nodes: [], type: "flowchart" }).length, 0);
  assert.equal(coerceCandidates({ unrelated: true }).length, 0);
  assert.equal(coerceCandidates(42).length, 0);
});

test("generation prompt uses the larger requested candidate count", async () => {
  const { complete, calls } = sequence([payload(5)]);
  const result = await generateVisuals(
    { text: "hello", count: 5 },
    { complete, minCandidates: 3, maxAttempts: 1 },
  );

  assert.equal(result.length, 5);
  assert.match(JSON.stringify(calls.messages[0]), /5/);
});
