/**
 * Direct contracts for `useVisualGeneration` (#1946), including the pure
 * `visualResultSectionForType` section-routing helper co-located in the same
 * module.
 *
 * Covers: the section routing table (auto → "ai", each mapped `VisualKind`
 * category, and the defensive "more" fallback for an unrecognized kind), the
 * full generate() success/failure/credit-error transitions and their
 * `emitProductTelemetry` events, append-vs-replace + per-section result
 * limiting, `resetGeneration`'s `keepOptions` behavior, and
 * `stampGeneratedVisual`'s binding to the most recent generate() call's
 * trimmed source text.
 *
 * The hook has no React Context dependency, so it is exercised with the
 * shared `react-render-harness`'s `run()` — called repeatedly on the same
 * mounted fiber (as `interaction-hooks-coverage.test.ts` does) so hook state
 * persists across calls, with `await waitForScheduledEffects()` used to let
 * `generate()`'s awaited action promise settle before re-reading state.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createReactRenderHarness } from "@/test/react-render-harness";
import {
  configureProductTelemetrySink,
  type ProductTelemetryRecord,
} from "@/lib/telemetry/product";
import { hashSourceText } from "@/lib/visual/schema";
import { FIXTURES } from "@/lib/visual/fixtures";
import type { GenerateResult } from "@/lib/visual/generate";
import type { VisualGenerationActionPort } from "@/lib/action-ports";

import {
  DEFAULT_GEN_OPTIONS,
  useVisualGeneration,
  visualResultSectionForType,
  VISUAL_KIND_CATEGORY,
  type VisualGenerationTarget,
} from "./use-visual-generation";

async function waitForScheduledEffects() {
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function captureTelemetry(): {
  events: ProductTelemetryRecord[];
  restore: () => void;
} {
  const events: ProductTelemetryRecord[] = [];
  const restore = configureProductTelemetrySink((event) => {
    events.push(event);
  });
  return { events, restore };
}

function target(text: string): VisualGenerationTarget {
  return { text, sourceKind: "block" };
}

// ---------------------------------------------------------------------------
// visualResultSectionForType — pure routing table
// ---------------------------------------------------------------------------

test("visualResultSectionForType routes 'auto' to the ai section", () => {
  assert.equal(visualResultSectionForType("auto"), "ai");
});

test("visualResultSectionForType routes each mapped VisualKind to its category", () => {
  for (const [kind, category] of Object.entries(VISUAL_KIND_CATEGORY)) {
    assert.equal(
      visualResultSectionForType(kind as never),
      category,
      `expected ${kind} to route to ${category}`,
    );
  }
});

test("visualResultSectionForType falls back to 'more' for an unmapped kind", () => {
  assert.equal(visualResultSectionForType("unknown-kind" as never), "more");
});

// ---------------------------------------------------------------------------
// generate() — success path
// ---------------------------------------------------------------------------

test("generate() transitions idle -> loading -> idle and stores candidates under the routed section", async () => {
  const telemetry = captureTelemetry();
  const requested: unknown[] = [];
  const actions: VisualGenerationActionPort = {
    requestVisualCandidates: async (text, options) => {
      requested.push({ text, options });
      return { ok: true, candidates: [FIXTURES.list] } satisfies GenerateResult;
    },
  };
  const renderer = createReactRenderHarness();
  try {
    const render = () => renderer.run(() => useVisualGeneration(actions));
    assert.equal(render().status, "idle");

    const call = render().generate(target("Hello world"));
    // Status flips to loading synchronously, before the action resolves.
    assert.equal(render().status, "loading");
    assert.equal(render().activeGenerationSection, "ai");

    const result = await call;
    await waitForScheduledEffects();

    assert.equal(result.section, "ai");
    const snapshot = render();
    assert.equal(snapshot.status, "idle");
    assert.equal(snapshot.activeGenerationSection, null);
    assert.equal(snapshot.error, null);
    assert.equal(snapshot.creditError, false);
    assert.deepEqual(snapshot.generatedVisualsBySection.ai, [FIXTURES.list]);

    assert.equal(requested.length, 1);
    const eventNames = telemetry.events.map((e) => e.eventName);
    assert.deepEqual(eventNames, [
      "product.ai.visual.started",
      "product.ai.visual.candidates",
    ]);
    assert.equal(telemetry.events[1]?.fields.candidateCount, 1);
  } finally {
    telemetry.restore();
    renderer.cleanup();
  }
});

test("generate() routes a non-'auto' type to its VISUAL_KIND_CATEGORY section", async () => {
  const actions: VisualGenerationActionPort = {
    requestVisualCandidates: async () => ({
      ok: true,
      candidates: [FIXTURES.flowchart],
    }),
  };
  const renderer = createReactRenderHarness();
  try {
    const render = () => renderer.run(() => useVisualGeneration(actions));
    render().setGenOptions({ ...DEFAULT_GEN_OPTIONS, type: "flowchart" });

    const result = await render().generate(target("Steps"));
    await waitForScheduledEffects();

    assert.equal(result.section, "process");
    assert.deepEqual(render().generatedVisualsBySection.process, [
      FIXTURES.flowchart,
    ]);
  } finally {
    renderer.cleanup();
  }
});

test("generate() reuses an idempotency key for the same operation and rotates for distinct operations", async () => {
  const seenKeys: string[] = [];
  const actions: VisualGenerationActionPort = {
    requestVisualCandidates: async (_text, _options, request) => {
      seenKeys.push(request?.idempotencyKey ?? "");
      return {
        ok: true,
        candidates: [FIXTURES.list],
      };
    },
  };
  const renderer = createReactRenderHarness();
  try {
    const render = () => renderer.run(() => useVisualGeneration(actions));

    await render().generate(target("same input"));
    await waitForScheduledEffects();
    await render().generate(target("same input"));
    await waitForScheduledEffects();
    await render().generate(target("different input"));
    await waitForScheduledEffects();

    assert.equal(seenKeys.length, 3);
    assert.equal(seenKeys[0], seenKeys[1]);
    assert.notEqual(seenKeys[1], seenKeys[2]);
    assert.ok(seenKeys.every((key) => key.startsWith("visual-generate-")));
  } finally {
    renderer.cleanup();
  }
});

test("resetGeneration starts a fresh idempotency lifecycle for subsequent operations", async () => {
  const seenKeys: string[] = [];
  const actions: VisualGenerationActionPort = {
    requestVisualCandidates: async (_text, _options, request) => {
      seenKeys.push(request?.idempotencyKey ?? "");
      return {
        ok: true,
        candidates: [FIXTURES.list],
      };
    },
  };
  const renderer = createReactRenderHarness();
  try {
    const render = () => renderer.run(() => useVisualGeneration(actions));

    await render().generate(target("same input"));
    await waitForScheduledEffects();
    render().resetGeneration();
    await render().generate(target("same input"));
    await waitForScheduledEffects();

    assert.equal(seenKeys.length, 2);
    assert.notEqual(seenKeys[0], seenKeys[1]);
  } finally {
    renderer.cleanup();
  }
});

// ---------------------------------------------------------------------------
// generate() — failure paths (credit vs. generic)
// ---------------------------------------------------------------------------

test("a credit/quota failure sets creditError and emits a 'quota' failureReason", async () => {
  const telemetry = captureTelemetry();
  const actions: VisualGenerationActionPort = {
    requestVisualCandidates: async () => ({
      ok: false,
      error: "Out of credits",
      errorKind: "credit",
    }),
  };
  const renderer = createReactRenderHarness();
  try {
    const render = () => renderer.run(() => useVisualGeneration(actions));

    await render().generate(target("Hello"));
    await waitForScheduledEffects();

    const snapshot = render();
    assert.equal(snapshot.status, "idle");
    assert.equal(snapshot.error, "Out of credits");
    assert.equal(snapshot.errorSection, "ai");
    assert.equal(snapshot.creditError, true);
    assert.deepEqual(snapshot.generatedVisualsBySection, {});

    const failedEvent = telemetry.events.find(
      (e) => e.eventName === "product.ai.visual.failed",
    );
    assert.equal(failedEvent?.fields.failureReason, "quota");
  } finally {
    telemetry.restore();
    renderer.cleanup();
  }
});

test("a generic failure clears creditError and emits an 'unknown' failureReason", async () => {
  const telemetry = captureTelemetry();
  const actions: VisualGenerationActionPort = {
    requestVisualCandidates: async () => ({
      ok: false,
      error: "Something went wrong",
      errorKind: "other",
    }),
  };
  const renderer = createReactRenderHarness();
  try {
    const render = () => renderer.run(() => useVisualGeneration(actions));

    await render().generate(target("Hello"));
    await waitForScheduledEffects();

    const snapshot = render();
    assert.equal(snapshot.error, "Something went wrong");
    assert.equal(snapshot.creditError, false);

    const failedEvent = telemetry.events.find(
      (e) => e.eventName === "product.ai.visual.failed",
    );
    assert.equal(failedEvent?.fields.failureReason, "unknown");
  } finally {
    telemetry.restore();
    renderer.cleanup();
  }
});

test("a subsequent successful generate() clears a previous failure's error state", async () => {
  let shouldFail = true;
  const actions: VisualGenerationActionPort = {
    requestVisualCandidates: async () =>
      shouldFail
        ? { ok: false, error: "boom", errorKind: "other" }
        : { ok: true, candidates: [FIXTURES.list] },
  };
  const renderer = createReactRenderHarness();
  try {
    const render = () => renderer.run(() => useVisualGeneration(actions));

    await render().generate(target("first"));
    await waitForScheduledEffects();
    assert.equal(render().error, "boom");

    shouldFail = false;
    await render().generate(target("second"));
    await waitForScheduledEffects();

    const snapshot = render();
    assert.equal(snapshot.error, null);
    assert.equal(snapshot.errorSection, null);
    assert.equal(snapshot.creditError, false);
  } finally {
    renderer.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Append vs. replace + per-section limiting
// ---------------------------------------------------------------------------

test("append (default) prepends new candidates ahead of existing ones for the same section, capped at the limit", async () => {
  let batch = 0;
  const actions: VisualGenerationActionPort = {
    requestVisualCandidates: async () => {
      batch += 1;
      return {
        ok: true,
        candidates: [{ ...FIXTURES.list, title: `batch-${batch}` }],
      };
    },
  };
  const renderer = createReactRenderHarness();
  try {
    const render = () => renderer.run(() => useVisualGeneration(actions));

    await render().generate(target("first"), { limit: 1 });
    await waitForScheduledEffects();
    assert.deepEqual(
      render().generatedVisualsBySection.ai?.map((v) => v.title),
      ["batch-1"],
    );

    await render().generate(target("second"), { limit: 1 });
    await waitForScheduledEffects();
    // The newest candidate is prepended, but the section is capped at limit=1.
    assert.deepEqual(
      render().generatedVisualsBySection.ai?.map((v) => v.title),
      ["batch-2"],
    );
  } finally {
    renderer.cleanup();
  }
});

test("append=false replaces the section's prior candidates outright", async () => {
  let batch = 0;
  const actions: VisualGenerationActionPort = {
    requestVisualCandidates: async () => {
      batch += 1;
      return {
        ok: true,
        candidates: [{ ...FIXTURES.list, title: `batch-${batch}` }],
      };
    },
  };
  const renderer = createReactRenderHarness();
  try {
    const render = () => renderer.run(() => useVisualGeneration(actions));

    await render().generate(target("first"));
    await waitForScheduledEffects();
    await render().generate(target("second"), { append: false });
    await waitForScheduledEffects();

    assert.deepEqual(
      render().generatedVisualsBySection.ai?.map((v) => v.title),
      ["batch-2"],
    );
  } finally {
    renderer.cleanup();
  }
});

// ---------------------------------------------------------------------------
// resetGeneration — keepOptions default vs. explicit reset
// ---------------------------------------------------------------------------

test("resetGeneration keeps genOptions by default while clearing every other field", async () => {
  const actions: VisualGenerationActionPort = {
    requestVisualCandidates: async () => ({
      ok: false,
      error: "boom",
      errorKind: "credit",
    }),
  };
  const renderer = createReactRenderHarness();
  try {
    const render = () => renderer.run(() => useVisualGeneration(actions));

    render().setGenOptions({ ...DEFAULT_GEN_OPTIONS, type: "chart" });
    await render().generate(target("hi"));
    await waitForScheduledEffects();
    assert.equal(render().creditError, true);

    render().resetGeneration();

    const snapshot = render();
    assert.equal(snapshot.error, null);
    assert.equal(snapshot.errorSection, null);
    assert.equal(snapshot.creditError, false);
    assert.equal(snapshot.status, "idle");
    assert.equal(snapshot.activeGenerationSection, null);
    assert.deepEqual(snapshot.generatedVisualsBySection, {});
    assert.equal(snapshot.genOptions.type, "chart");
  } finally {
    renderer.cleanup();
  }
});

test("resetGeneration(false) also resets genOptions back to the default", async () => {
  const actions: VisualGenerationActionPort = {
    requestVisualCandidates: async () => ({ ok: true, candidates: [] }),
  };
  const renderer = createReactRenderHarness();
  try {
    const render = () => renderer.run(() => useVisualGeneration(actions));

    render().setGenOptions({ ...DEFAULT_GEN_OPTIONS, type: "chart" });
    assert.equal(render().genOptions.type, "chart");

    render().resetGeneration(false);

    assert.deepEqual(render().genOptions, DEFAULT_GEN_OPTIONS);
  } finally {
    renderer.cleanup();
  }
});

// ---------------------------------------------------------------------------
// stampGeneratedVisual — bound to the most recent generate() call's source
// ---------------------------------------------------------------------------

test("stampGeneratedVisual stamps the trimmed source text from the most recent generate() call", async () => {
  const actions: VisualGenerationActionPort = {
    requestVisualCandidates: async () => ({ ok: true, candidates: [] }),
  };
  const renderer = createReactRenderHarness();
  try {
    const render = () => renderer.run(() => useVisualGeneration(actions));

    await render().generate(target("  Hello world  "));
    await waitForScheduledEffects();

    const stamped = render().stampGeneratedVisual(FIXTURES.list);
    assert.equal(stamped.sourceText, "Hello world");
    assert.equal(stamped.sourceTextHash, hashSourceText("Hello world"));
  } finally {
    renderer.cleanup();
  }
});

test("stampGeneratedVisual is a no-op after resetGeneration clears the source text", async () => {
  const actions: VisualGenerationActionPort = {
    requestVisualCandidates: async () => ({ ok: true, candidates: [] }),
  };
  const renderer = createReactRenderHarness();
  try {
    const render = () => renderer.run(() => useVisualGeneration(actions));

    await render().generate(target("Hello world"));
    await waitForScheduledEffects();
    render().resetGeneration();

    const stamped = render().stampGeneratedVisual(FIXTURES.list);
    assert.deepEqual(stamped, FIXTURES.list);
  } finally {
    renderer.cleanup();
  }
});
