import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act } from "react-test-renderer";

import type { VisualGenerationActionPort } from "@/lib/action-ports";
import { configureProductTelemetrySink } from "@/lib/telemetry/product";
import { FIXTURES } from "@/lib/visual/fixtures";
import type { GenerateResult } from "@/lib/visual/generate";
import type { Visual } from "@/lib/visual/schema";
import { createReactRenderHarness } from "@/test/react-render-harness";

import {
  usePopoverGeneration,
  useVisualSync,
  type MenuSection,
} from "./visual-context-popover-hooks";
import { useVisualGeneration } from "./use-visual-generation";

const GENERATION_TRANSPORT_ERROR =
  "Couldn't reach the generator. Check your connection and try again.";
const SYNC_ERROR = "Sync failed. Please try again.";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function popoverOptions(args: {
  port: VisualGenerationActionPort;
  visual?: Visual;
  sections?: Array<MenuSection | null>;
}) {
  const visual = args.visual ?? FIXTURES.flowchart;
  return {
    visualRef: { current: visual },
    visualGenerationPort: args.port,
    visual,
    onChange: () => undefined,
    onSectionChange: (section: MenuSection | null) =>
      args.sections?.push(section),
  };
}

function syncOptions(args: {
  port: VisualGenerationActionPort;
  changes?: Visual[];
  sections?: Array<MenuSection | null>;
}) {
  const visual = { ...FIXTURES.flowchart, sourceText: "Current source" };
  return {
    visualRef: { current: visual },
    visualGenerationPort: args.port,
    currentSourceText: "Current source",
    onChange: (next: Visual) => args.changes?.push(next),
    onSectionChange: (section: MenuSection | null) =>
      args.sections?.push(section),
  };
}

describe("usePopoverGeneration operation boundary", () => {
  test("suppresses same-tick duplicate activation until the active request settles", async () => {
    const gate = deferred<GenerateResult>();
    let calls = 0;
    const port: VisualGenerationActionPort = {
      requestVisualCandidates: () => {
        calls += 1;
        return gate.promise;
      },
    };
    const harness = createReactRenderHarness();
    const render = () =>
      harness.run(() => usePopoverGeneration(popoverOptions({ port })));

    try {
      const hook = render();
      let first!: Promise<void>;
      let duplicate!: Promise<void>;
      act(() => {
        first = hook.runGenerate();
        duplicate = hook.runGenerate();
      });

      assert.equal(calls, 1);
      assert.equal(render().genStatus, "loading");

      await act(async () => {
        gate.resolve({ ok: true, candidates: [FIXTURES.list] });
        await Promise.all([first, duplicate]);
      });

      assert.equal(render().genStatus, "idle");
      assert.deepEqual(render().candidates, [FIXTURES.list]);
    } finally {
      harness.cleanup();
    }
  });

  test("turns a rejected port into retryable feedback and releases the lock", async () => {
    let calls = 0;
    const port: VisualGenerationActionPort = {
      requestVisualCandidates: async () => {
        calls += 1;
        if (calls === 1) throw new Error("connection reset");
        return { ok: true, candidates: [FIXTURES.list] };
      },
    };
    const harness = createReactRenderHarness();
    const render = () =>
      harness.run(() => usePopoverGeneration(popoverOptions({ port })));

    try {
      const firstAttempt = render();
      await act(async () => {
        await assert.doesNotReject(firstAttempt.runGenerate());
      });
      assert.equal(render().genStatus, "idle");
      assert.equal(render().genError, GENERATION_TRANSPORT_ERROR);

      const retry = render();
      await act(async () => {
        await retry.runGenerate();
      });
      assert.equal(calls, 2);
      assert.equal(render().genError, null);
      assert.deepEqual(render().candidates, [FIXTURES.list]);
    } finally {
      harness.cleanup();
    }
  });

  test("reset invalidates an in-flight completion and returns to idle", async () => {
    const gate = deferred<GenerateResult>();
    const sections: Array<MenuSection | null> = [];
    const port: VisualGenerationActionPort = {
      requestVisualCandidates: () => gate.promise,
    };
    const harness = createReactRenderHarness();
    const render = () =>
      harness.run(() =>
        usePopoverGeneration(popoverOptions({ port, sections })),
      );

    try {
      const pending = render();
      let request!: Promise<void>;
      act(() => {
        request = pending.runGenerate();
      });
      assert.equal(render().genStatus, "loading");

      const loading = render();
      act(() => loading.reset());
      assert.equal(render().genStatus, "idle");

      await act(async () => {
        gate.resolve({ ok: true, candidates: [FIXTURES.list] });
        await request;
      });

      assert.deepEqual(render().candidates, []);
      assert.deepEqual(sections, []);
    } finally {
      harness.cleanup();
    }
  });
});

describe("useVisualSync operation boundary", () => {
  test("suppresses duplicate activation and applies one settled result", async () => {
    const gate = deferred<GenerateResult>();
    const changes: Visual[] = [];
    let calls = 0;
    const port: VisualGenerationActionPort = {
      requestVisualCandidates: () => {
        calls += 1;
        return gate.promise;
      },
    };
    const harness = createReactRenderHarness();
    const render = () =>
      harness.run(() => useVisualSync(syncOptions({ port, changes })));

    try {
      const hook = render();
      let first!: Promise<void>;
      let duplicate!: Promise<void>;
      act(() => {
        first = hook.runSync();
        duplicate = hook.runSync();
      });
      assert.equal(calls, 1);
      assert.equal(render().syncStatus, "loading");

      await act(async () => {
        gate.resolve({ ok: true, candidates: [FIXTURES.list] });
        await Promise.all([first, duplicate]);
      });
      assert.equal(render().syncStatus, "idle");
      assert.equal(changes.length, 1);
    } finally {
      harness.cleanup();
    }
  });

  test("handles rejected and empty-success ports safely, then allows retry", async () => {
    let calls = 0;
    const changes: Visual[] = [];
    const port: VisualGenerationActionPort = {
      requestVisualCandidates: async () => {
        calls += 1;
        if (calls === 1) throw new Error("offline");
        if (calls === 2) return { ok: true, candidates: [] };
        return { ok: true, candidates: [FIXTURES.list] };
      },
    };
    const harness = createReactRenderHarness();
    const render = () =>
      harness.run(() => useVisualSync(syncOptions({ port, changes })));

    try {
      const rejectedAttempt = render();
      await act(async () => {
        await assert.doesNotReject(rejectedAttempt.runSync());
      });
      assert.equal(render().syncStatus, "idle");
      assert.equal(render().syncError, SYNC_ERROR);

      const emptyAttempt = render();
      await act(async () => {
        await assert.doesNotReject(emptyAttempt.runSync());
      });
      assert.equal(render().syncError, SYNC_ERROR);
      assert.equal(changes.length, 0);

      const retry = render();
      await act(async () => {
        await retry.runSync();
      });
      assert.equal(calls, 3);
      assert.equal(render().syncError, null);
      assert.equal(changes.length, 1);
    } finally {
      harness.cleanup();
    }
  });

  test("reset prevents a late sync result from changing the visual or section", async () => {
    const gate = deferred<GenerateResult>();
    const changes: Visual[] = [];
    const sections: Array<MenuSection | null> = [];
    const port: VisualGenerationActionPort = {
      requestVisualCandidates: () => gate.promise,
    };
    const harness = createReactRenderHarness();
    const render = () =>
      harness.run(() =>
        useVisualSync(syncOptions({ port, changes, sections })),
      );

    try {
      const pending = render();
      let request!: Promise<void>;
      act(() => {
        request = pending.runSync();
      });
      const loading = render();
      act(() => loading.reset());
      assert.equal(render().syncStatus, "idle");

      await act(async () => {
        gate.resolve({ ok: true, candidates: [FIXTURES.list] });
        await request;
      });
      assert.deepEqual(changes, []);
      assert.deepEqual(sections, []);
    } finally {
      harness.cleanup();
    }
  });
});

describe("useVisualGeneration operation boundary", () => {
  test("suppresses duplicate activation while preserving one request lifecycle", async () => {
    const gate = deferred<GenerateResult>();
    let calls = 0;
    const port: VisualGenerationActionPort = {
      requestVisualCandidates: () => {
        calls += 1;
        return gate.promise;
      },
    };
    const harness = createReactRenderHarness();
    const render = () => harness.run(() => useVisualGeneration(port));

    try {
      const hook = render();
      let first!: ReturnType<typeof hook.generate>;
      let duplicate!: ReturnType<typeof hook.generate>;
      act(() => {
        first = hook.generate({ text: "Generate this", sourceKind: "block" });
        duplicate = hook.generate({
          text: "Generate this",
          sourceKind: "block",
        });
      });
      assert.equal(calls, 1);
      assert.equal(render().status, "loading");

      await act(async () => {
        gate.resolve({ ok: true, candidates: [FIXTURES.list] });
        await Promise.all([first, duplicate]);
      });
      assert.equal(render().status, "idle");
      assert.deepEqual(render().generatedVisualsBySection.ai, [FIXTURES.list]);
    } finally {
      harness.cleanup();
    }
  });

  test("converts a rejected port to visible failure state and permits retry", async () => {
    let calls = 0;
    const telemetryEvents: string[] = [];
    const restoreTelemetry = configureProductTelemetrySink((record) => {
      telemetryEvents.push(record.eventName);
    });
    const port: VisualGenerationActionPort = {
      requestVisualCandidates: async () => {
        calls += 1;
        if (calls === 1) throw new Error("network down");
        return { ok: true, candidates: [FIXTURES.list] };
      },
    };
    const harness = createReactRenderHarness();
    const render = () => harness.run(() => useVisualGeneration(port));

    try {
      const rejectedAttempt = render();
      await act(async () => {
        await assert.doesNotReject(
          rejectedAttempt.generate({ text: "Generate this" }),
        );
      });
      assert.equal(render().status, "idle");
      assert.equal(render().activeGenerationSection, null);
      assert.equal(render().error, GENERATION_TRANSPORT_ERROR);

      const retry = render();
      await act(async () => {
        await retry.generate({ text: "Generate this" });
      });
      assert.equal(calls, 2);
      assert.equal(render().error, null);
      assert.deepEqual(render().generatedVisualsBySection.ai, [FIXTURES.list]);
    } finally {
      restoreTelemetry();
      harness.cleanup();
    }

    assert.deepEqual(telemetryEvents, [
      "product.ai.visual.started",
      "product.ai.visual.failed",
      "product.ai.visual.started",
      "product.ai.visual.candidates",
    ]);
  });

  test("a later rendered choice supersedes the active request and ignores its late result", async () => {
    const firstGate = deferred<GenerateResult>();
    const secondGate = deferred<GenerateResult>();
    let calls = 0;
    const port: VisualGenerationActionPort = {
      requestVisualCandidates: () => {
        calls += 1;
        return calls === 1 ? firstGate.promise : secondGate.promise;
      },
    };
    const harness = createReactRenderHarness();
    const render = () => harness.run(() => useVisualGeneration(port));

    try {
      const firstHook = render();
      let firstRequest!: ReturnType<typeof firstHook.generate>;
      act(() => {
        firstRequest = firstHook.generate({ text: "first choice" });
      });

      const secondHook = render();
      let secondRequest!: ReturnType<typeof secondHook.generate>;
      act(() => {
        secondRequest = secondHook.generate(
          { text: "second choice" },
          { options: { ...secondHook.genOptions, type: "chart" } },
        );
      });
      assert.equal(calls, 2);

      await act(async () => {
        secondGate.resolve({ ok: true, candidates: [FIXTURES.chart] });
        await secondRequest;
      });
      assert.deepEqual(render().generatedVisualsBySection.data, [
        FIXTURES.chart,
      ]);

      await act(async () => {
        firstGate.resolve({ ok: true, candidates: [FIXTURES.list] });
        await firstRequest;
      });
      assert.deepEqual(render().generatedVisualsBySection.ai, undefined);
      assert.deepEqual(render().generatedVisualsBySection.data, [
        FIXTURES.chart,
      ]);
    } finally {
      harness.cleanup();
    }
  });

  test("reset invalidates a late result and allows a fresh operation", async () => {
    const firstGate = deferred<GenerateResult>();
    let calls = 0;
    const port: VisualGenerationActionPort = {
      requestVisualCandidates: async () => {
        calls += 1;
        return calls === 1
          ? firstGate.promise
          : { ok: true, candidates: [FIXTURES.chart] };
      },
    };
    const harness = createReactRenderHarness();
    const render = () => harness.run(() => useVisualGeneration(port));

    try {
      const initial = render();
      let staleRequest!: ReturnType<ReturnType<typeof render>["generate"]>;
      act(() => {
        staleRequest = initial.generate({ text: "stale" });
      });
      const loading = render();
      act(() => loading.resetGeneration());
      assert.equal(render().status, "idle");

      const fresh = render();
      await act(async () => {
        await fresh.generate({ text: "fresh" });
      });
      assert.deepEqual(render().generatedVisualsBySection.ai, [FIXTURES.chart]);

      await act(async () => {
        firstGate.resolve({ ok: true, candidates: [FIXTURES.list] });
        await staleRequest;
      });
      assert.deepEqual(render().generatedVisualsBySection.ai, [FIXTURES.chart]);
    } finally {
      harness.cleanup();
    }
  });
});
