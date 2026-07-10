import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EmptyInputError,
  GenerationError,
  InputTooLongError,
} from "@/lib/ai/generate";
import { ModelOutputBudgetError } from "@/lib/ai/generation-runner";
import {
  AI_GENERATION_INPUT_MAX_CHARS,
  AI_OPTION_MAX_CHARS,
} from "@/lib/limits";
import {
  buildContentJson,
  buildParagraphNode,
  buildTextNode,
} from "@/test/builders/lexical";

import {
  mapGenerateDeckError,
  parseDeckOptions,
  parseGenerateDeckPayload,
  visualsFromContent,
} from "./parser";

test("parseDeckOptions accepts current tuning fields", () => {
  assert.deepEqual(
    parseDeckOptions({
      length: "short",
      tone: "clear",
      audience: "execs",
      mode: "presentationRewrite",
    }),
    {
      options: {
        length: "short",
        tone: "clear",
        audience: "execs",
        mode: "presentationRewrite",
      },
    },
  );
});

test("parseDeckOptions treats missing or null options as defaults", () => {
  assert.deepEqual(parseDeckOptions(undefined), { options: {} });
  assert.deepEqual(parseDeckOptions(null), { options: {} });
});

test("parseDeckOptions rejects non-object and invalid option shapes", () => {
  assert.deepEqual(parseDeckOptions("short"), {
    error: "`options` must be an object.",
  });
  assert.deepEqual(parseDeckOptions({ length: "tiny" }), {
    error: "`options.length` must be one of: short, medium, long.",
  });
  assert.deepEqual(
    parseDeckOptions({ tone: "x".repeat(AI_OPTION_MAX_CHARS + 1) }),
    {
      error: `\`options.tone\` is too long (${AI_OPTION_MAX_CHARS + 1} characters). The maximum is ${AI_OPTION_MAX_CHARS}.`,
    },
  );
  assert.deepEqual(parseDeckOptions({ tone: 42 }), {
    error: "`options.tone` must be a string.",
  });
  assert.deepEqual(parseDeckOptions({ audience: 42 }), {
    error: "`options.audience` must be a string.",
  });
  assert.deepEqual(
    parseDeckOptions({ audience: "x".repeat(AI_OPTION_MAX_CHARS + 1) }),
    {
      error: `\`options.audience\` is too long (${AI_OPTION_MAX_CHARS + 1} characters). The maximum is ${AI_OPTION_MAX_CHARS}.`,
    },
  );
  assert.deepEqual(parseDeckOptions({ mode: "magic" }), {
    error: "`options.mode` must be one of: faithful, presentationRewrite.",
  });
});

test("parseGenerateDeckPayload preserves required content errors", () => {
  assert.deepEqual(parseGenerateDeckPayload({}), {
    ok: false,
    status: 400,
    message: "`contentJson` is required.",
  });
});

test("parseGenerateDeckPayload returns an empty content error", () => {
  assert.deepEqual(parseGenerateDeckPayload({ contentJson: { root: [] } }), {
    ok: false,
    status: 400,
    message: "`contentJson` does not contain any usable outline content.",
  });
});

test("parseGenerateDeckPayload rejects whitespace-only document content", () => {
  assert.deepEqual(
    parseGenerateDeckPayload({
      contentJson: buildContentJson([
        buildParagraphNode([buildTextNode("   \n\t   ")]),
      ]),
    }),
    {
      ok: false,
      status: 400,
      message: "`contentJson` does not contain any usable outline content.",
    },
  );
});

test("parseGenerateDeckPayload builds a payload with outline and options", () => {
  const result = parseGenerateDeckPayload({
    contentJson: buildContentJson([
      buildParagraphNode([buildTextNode("Roadmap")]),
    ]),
    options: { length: "medium", tone: "direct", mode: "faithful" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.options.length, "medium");
  assert.equal(result.payload.options.tone, "direct");
  assert.equal(result.payload.options.mode, "faithful");
  assert.equal(result.payload.themePackageId, "clarity");
  assert.match(result.payload.outline, /Roadmap/);
});

test("parseGenerateDeckPayload accepts current request fields", () => {
  const result = parseGenerateDeckPayload({
    contentJson: buildContentJson([
      buildParagraphNode([buildTextNode("Roadmap")]),
    ]),
    themePackageId: "noir",
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload.themePackageId, "noir");
});

test("parseGenerateDeckPayload defaults theme package to clarity", () => {
  const result = parseGenerateDeckPayload({
    contentJson: buildContentJson([
      buildParagraphNode([buildTextNode("Roadmap")]),
    ]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload.themePackageId, "clarity");
});

test("parseGenerateDeckPayload rejects invalid request fields", () => {
  assert.deepEqual(
    parseGenerateDeckPayload({
      contentJson: buildContentJson([
        buildParagraphNode([buildTextNode("Roadmap")]),
      ]),
      themePackageId: "unknown",
    }),
    { ok: false, status: 400, message: "`themePackageId` is invalid." },
  );
});

test("visualsFromContent indexes visual blocks by id", () => {
  const visual = {
    kind: "timeline",
    title: "Roadmap",
    items: [{ label: "Launch", date: "Q1" }],
  } as const;

  const visuals = visualsFromContent([
    { kind: "paragraph", text: "Intro" } as never,
    { kind: "visual", visualId: "visual-roadmap", visual } as never,
  ]);

  assert.equal(visuals.get("visual-roadmap"), visual);
  assert.equal(visuals.size, 1);
});

test("mapGenerateDeckError maps input validation errors and ignores unknown errors", () => {
  assert.deepEqual(mapGenerateDeckError(new EmptyInputError()), {
    status: 400,
    message: "Input text is required.",
  });
  const tooLong = new InputTooLongError(AI_GENERATION_INPUT_MAX_CHARS + 1);
  assert.deepEqual(mapGenerateDeckError(tooLong), {
    status: 413,
    message: tooLong.message,
  });
  assert.equal(mapGenerateDeckError(new Error("unexpected")), null);
});

test("mapGenerateDeckError preserves generation failure contract", () => {
  assert.deepEqual(mapGenerateDeckError(new GenerationError("bad output")), {
    status: 502,
    message:
      "We couldn't generate a deck from that document. Please try again.",
    log: { reason: "generation-failed", status: 502 },
  });
});

test("mapGenerateDeckError maps model-output budget failures safely", () => {
  assert.deepEqual(
    mapGenerateDeckError(new ModelOutputBudgetError("bytes", 10, 5)),
    {
      status: 502,
      message: "The AI response was too large. Please try again.",
      log: { reason: "model-output-budget", status: 502 },
    },
  );
});
