import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dedupePresentationDiagnostics,
  mergePresentationDiagnostics,
} from "./diagnostic-handoff";
import { makeDiagnostic } from "./diagnostics";

test("dedupePresentationDiagnostics removes duplicate diagnostic signatures", () => {
  const duplicate = makeDiagnostic(
    "slot-over-capacity",
    "warning",
    "Adjusted",
    {
      slideId: "slide-1",
    },
  );
  const diagnostics = [
    duplicate,
    { ...duplicate },
    makeDiagnostic("missing-required-slot", "warning", "Filled slot", {
      slideId: "slide-1",
    }),
  ];

  const deduped = dedupePresentationDiagnostics(diagnostics);
  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped[0], duplicate);
});

test("mergePresentationDiagnostics carries generation diagnostics into open diagnostics", () => {
  const generation = makeDiagnostic(
    "missing-required-slot",
    "warning",
    "Added fallback text",
    { slideId: "slide-2" },
  );
  const openBoundary = makeDiagnostic(
    "local-style-overrides",
    "info",
    "Opened generated deck",
  );

  const merged = mergePresentationDiagnostics(
    [generation],
    [openBoundary, { ...generation }],
  );

  assert.deepEqual(merged, [generation, openBoundary]);
});
