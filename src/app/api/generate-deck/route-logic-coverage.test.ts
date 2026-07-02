import assert from "node:assert/strict";
import { test } from "node:test";

import type { GenerateDeckPayload } from "./parser";
import {
  buildGenerateDeckSuccessLogFields,
  buildGenerateDeckSuccessResponse,
} from "./route-logic";
import { DEFAULT_THEME_PACKAGE_ID } from "@/lib/presentation-shared/theme-packages";
import { makeDiagnostic } from "@/lib/presentation-vnext/diagnostics";
import { buildContentSlide, buildDeckV7 } from "@/test/builders/deck-v7";

const payload: GenerateDeckPayload = {
  contentJson: { root: { children: [] } },
  options: {},
  blocks: [],
  visuals: new Map(),
  outline: "Launch\nMeasure",
  truncated: false,
  themePackageId: DEFAULT_THEME_PACKAGE_ID,
};

test("generate deck success helpers preserve result payload and telemetry", () => {
  const deck = buildDeckV7([buildContentSlide()]);
  const diagnostics = [
    makeDiagnostic("missing-required-slot", "warning", "Filled title"),
  ];
  const result = {
    deck,
    truncated: true,
    diagnostics,
    planner: "ai" as const,
    mode: "faithful" as const,
  };

  const response = buildGenerateDeckSuccessResponse(result);
  assert.equal(response.deck, deck);
  assert.equal(response.truncated, true);
  assert.equal(response.diagnostics, diagnostics);
  assert.equal(response.metadata.schemaValid, true);
  assert.equal(response.metadata.tableSlideCount, 0);
  assert.equal(response.metadata.planner, "ai");
  assert.equal(response.metadata.mode, "faithful");

  const fields = buildGenerateDeckSuccessLogFields(result, {
    payload,
    requestId: "req-coverage",
    latencyMs: 42,
  });
  assert.equal(fields.requestId, "req-coverage");
  assert.equal(fields.latencyMs, 42);
  assert.equal(fields.outlineChars, payload.outline.length);
  assert.equal(fields.outlineWords, 2);
  assert.equal(fields.truncated, true);
});
