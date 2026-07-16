/**
 * Direct behavior coverage for `visual-context-popover-hooks.ts` (#1947):
 * `visualPromptText`, `useBrandContext`, `usePopoverGeneration`,
 * `useVisualSync`, and `usePopoverPosition`.
 *
 * The stateful hooks are exercised through the shared
 * `createReactRenderHarness` (`run()`/`cleanup()`), matching the convention
 * already used across this codebase's hook tests (e.g.
 * `src/lib/lexical/use-lexical-collaboration.test.ts`,
 * `src/components/editor/use-precision-guides.test.ts`): `run()` mounts a
 * probe component with `react-test-renderer` inside `act()` without ever
 * rendering its return value to a tree (so no Context ancestry is required),
 * and repeated calls re-render the same fiber via `renderer.update()`, which
 * is exactly what's needed to observe post-effect state.
 *
 * `usePopoverPosition` additionally needs real, working
 * `window`/`document` event listener registration/removal (its dismiss and
 * reposition logic depends on genuinely firing/removing `resize`, `scroll`,
 * and `mousedown` handlers) and a global `Element` class (the scroll handler
 * does `target instanceof Element`) — a small event-bus stub and `FakeElement`
 * class provide both without pulling in jsdom.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { act } from "react-test-renderer";

import { createReactRenderHarness } from "@/test/react-render-harness";
import { buildVisual, buildVisualNode } from "@/test/builders/visual";

import type { AnchorRect } from "@/lib/anchored-position";
import { computeAnchoredPosition } from "@/lib/anchored-position";
import type { GenerateResult } from "@/lib/visual/generate";
import type { Visual } from "@/lib/visual/schema";
import type { VisualCommandPayload } from "@/lib/commands/visual-command-contracts";
import type { BrandStyle } from "@/lib/brand/schema";

import {
  usePopoverGeneration,
  usePopoverPosition,
  useBrandContext,
  useVisualSync,
  visualPromptText,
  type MenuSection,
} from "./visual-context-popover-hooks";

function waitForAsyncDrain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function buildBrand(id: string, name: string): BrandStyle {
  return {
    id,
    name,
    ownerId: "owner-1",
    palette: null,
    background: null,
    nodeFill: null,
    nodeStroke: null,
    nodeText: null,
    edgeColor: null,
    fontFamily: null,
    fontAssetUrl: null,
    logoAssetUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// ---------------------------------------------------------------------------
// visualPromptText
// ---------------------------------------------------------------------------

describe("visualPromptText", () => {
  test("joins the title and every non-empty node label with newlines", () => {
    const visual = buildVisual({
      title: "Onboarding flow",
      nodes: [
        buildVisualNode({ id: "n1", label: "Sign up" }),
        buildVisualNode({ id: "n2", label: "  " }),
        buildVisualNode({ id: "n3", label: "Verify email" }),
      ],
    });
    assert.equal(
      visualPromptText(visual),
      "Onboarding flow\nSign up\nVerify email",
    );
  });

  test("omits a blank/whitespace-only title", () => {
    const visual = buildVisual({
      title: "   ",
      nodes: [buildVisualNode({ id: "n1", label: "Start" })],
    });
    assert.equal(visualPromptText(visual), "Start");
  });

  test("returns an empty string when there is no title and no labels", () => {
    const visual = buildVisual({
      title: "",
      nodes: [buildVisualNode({ id: "n1", label: "" })],
    });
    assert.equal(visualPromptText(visual), "");
  });
});

// ---------------------------------------------------------------------------
// useBrandContext
// ---------------------------------------------------------------------------

describe("useBrandContext", () => {
  test("stays idle with no brands when the branding section is not active", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls++;
      return Promise.reject(new Error("should not be called"));
    }) as typeof fetch;

    const harness = createReactRenderHarness();
    try {
      const first = harness.run(() => useBrandContext(null));
      assert.equal(first.status, "idle");
      assert.deepEqual(first.brands, []);

      await act(async () => {
        await waitForAsyncDrain();
      });
      const second = harness.run(() => useBrandContext(null));
      assert.equal(second.status, "idle");
      assert.equal(fetchCalls, 0);
    } finally {
      harness.cleanup();
    }
  });

  test("fetches and populates brands once the branding section becomes active", async () => {
    const brands = [buildBrand("b1", "Acme"), buildBrand("b2", "Globex")];
    let fetchCalls = 0;
    globalThis.fetch = ((url: string) => {
      fetchCalls++;
      assert.equal(url, "/api/brand");
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ brands }),
      });
    }) as typeof fetch;

    const harness = createReactRenderHarness();
    try {
      harness.run(() => useBrandContext("branding"));

      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });

      const settled = harness.run(() => useBrandContext("branding"));
      assert.equal(settled.status, "done");
      assert.deepEqual(settled.brands, brands);
      assert.equal(fetchCalls, 1);
    } finally {
      harness.cleanup();
    }
  });

  test("ends in done with empty brands when the fetch response is not ok", async () => {
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ brands: [] }),
      })) as unknown as typeof fetch;

    const harness = createReactRenderHarness();
    try {
      harness.run(() => useBrandContext("branding"));
      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const settled = harness.run(() => useBrandContext("branding"));
      assert.equal(settled.status, "done");
      assert.deepEqual(settled.brands, []);
    } finally {
      harness.cleanup();
    }
  });

  test("ends in done with empty brands when the fetch throws", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error("network down"))) as typeof fetch;

    const harness = createReactRenderHarness();
    try {
      harness.run(() => useBrandContext("branding"));
      await act(async () => {
        await waitForAsyncDrain();
        await waitForAsyncDrain();
      });
      const settled = harness.run(() => useBrandContext("branding"));
      assert.equal(settled.status, "done");
      assert.deepEqual(settled.brands, []);
    } finally {
      harness.cleanup();
    }
  });

  test("does not populate brands once the harness has been torn down mid-fetch (abort on unmount)", async () => {
    // A plain `let` reassigned only inside the Promise executor triggers a
    // TypeScript control-flow narrowing quirk here (this project's tsconfig
    // merges DOM's and @types/node's global `Response`/`fetch` typings,
    // which makes TS narrow the closed-over variable to `null` at the read
    // site below). A mutable holder object sidesteps it cleanly.
    const pendingFetch: { resolve: ((value: unknown) => void) | null } = {
      resolve: null,
    };
    globalThis.fetch = (() =>
      new Promise((resolve) => {
        pendingFetch.resolve = resolve;
      })) as unknown as typeof fetch;

    const harness = createReactRenderHarness();
    harness.run(() => useBrandContext("branding"));
    await act(async () => {
      await waitForAsyncDrain();
    });
    // Effect cleanup (aborted = true) runs synchronously on unmount.
    harness.cleanup();

    pendingFetch.resolve?.({
      ok: true,
      json: () => Promise.resolve({ brands: [buildBrand("late", "Late")] }),
    });
    await waitForAsyncDrain();
    await waitForAsyncDrain();
    // No assertion target remains mounted; reaching here without an
    // unhandled "setState after unmount" throw/warning is the behavior
    // under test (the `aborted` guard short-circuits every branch).
  });
});

// ---------------------------------------------------------------------------
// usePopoverGeneration
// ---------------------------------------------------------------------------

describe("usePopoverGeneration", () => {
  function makePort(result: GenerateResult) {
    const calls: Array<{ text: string; key: string | undefined }> = [];
    return {
      calls,
      port: {
        requestVisualCandidates: (
          text: string,
          _options?: unknown,
          request?: { idempotencyKey?: string },
        ) => {
          calls.push({ text, key: request?.idempotencyKey });
          return Promise.resolve(result);
        },
      },
    };
  }

  test("guards against generating with an empty prompt (no title, no labels)", async () => {
    const visual = buildVisual({ title: "", nodes: [] });
    const { port, calls } = makePort({ ok: true, candidates: [] });
    const sections: (MenuSection | null)[] = [];

    const harness = createReactRenderHarness();
    try {
      const hook = harness.run(() =>
        usePopoverGeneration({
          visualRef: { current: visual },
          visualGenerationPort: port,
          visual,
          onChange: () => {},
          onSectionChange: (s) => sections.push(s),
        }),
      );

      await act(async () => {
        await hook.runGenerate();
      });

      const settled = harness.run(() =>
        usePopoverGeneration({
          visualRef: { current: visual },
          visualGenerationPort: port,
          visual,
          onChange: () => {},
          onSectionChange: (s) => sections.push(s),
        }),
      );
      assert.equal(
        settled.genError,
        "Add some labels before generating variations.",
      );
      assert.deepEqual(sections, ["variations"]);
      assert.equal(calls.length, 0, "must not call the generation port");
    } finally {
      harness.cleanup();
    }
  });

  test("runGenerate populates candidates and switches to the variations section on success", async () => {
    const visual = buildVisual({ title: "Flow" });
    const candidate = buildVisual({ title: "Variation A" });
    const { port, calls } = makePort({ ok: true, candidates: [candidate] });
    const sections: (MenuSection | null)[] = [];

    const harness = createReactRenderHarness();
    try {
      const hook = harness.run(() =>
        usePopoverGeneration({
          visualRef: { current: visual },
          visualGenerationPort: port,
          visual,
          onChange: () => {},
          onSectionChange: (s) => sections.push(s),
        }),
      );

      await act(async () => {
        await hook.runGenerate();
      });

      const settled = harness.run(() =>
        usePopoverGeneration({
          visualRef: { current: visual },
          visualGenerationPort: port,
          visual,
          onChange: () => {},
          onSectionChange: (s) => sections.push(s),
        }),
      );
      assert.equal(settled.genStatus, "idle");
      assert.equal(settled.genError, null);
      assert.equal(settled.genCreditError, false);
      assert.deepEqual(settled.candidates, [candidate]);
      assert.deepEqual(sections, ["variations"]);
      assert.deepEqual(
        calls.map((call) => call.text),
        [visualPromptText(visual)],
      );
      assert.ok(calls[0]?.key?.startsWith("visual-generate-"));
    } finally {
      harness.cleanup();
    }
  });

  test("runGenerate reuses key on same prompt retry and rotates for distinct prompts", async () => {
    const firstVisual = buildVisual({ title: "Flow" });
    const visualRef = { current: firstVisual };
    const { port, calls } = makePort({
      ok: true,
      candidates: [buildVisual({ title: "Variation A" })],
    });
    const harness = createReactRenderHarness();
    try {
      const render = () =>
        harness.run(() =>
          usePopoverGeneration({
            visualRef,
            visualGenerationPort: port,
            visual: visualRef.current,
            onChange: () => {},
            onSectionChange: () => {},
          }),
        );

      let hook = render();
      await act(async () => {
        await hook.runGenerate();
      });
      hook = render();
      await act(async () => {
        await hook.runGenerate();
      });
      visualRef.current = buildVisual({ title: "New Flow" });
      hook = render();
      await act(async () => {
        await hook.runGenerate();
      });
      render();

      const keys = calls.map((call) => call.key ?? "");
      assert.equal(keys.length, 3);
      assert.equal(keys[0], keys[1]);
      assert.notEqual(keys[1], keys[2]);
      assert.ok(keys.every((key) => key.startsWith("visual-generate-")));
    } finally {
      harness.cleanup();
    }
  });

  test("runGenerate records a non-credit error", async () => {
    const visual = buildVisual({ title: "Flow" });
    const { port } = makePort({
      ok: false,
      error: "Something went wrong.",
      errorKind: "other",
    });

    const harness = createReactRenderHarness();
    try {
      const hook = harness.run(() =>
        usePopoverGeneration({
          visualRef: { current: visual },
          visualGenerationPort: port,
          visual,
          onChange: () => {},
          onSectionChange: () => {},
        }),
      );
      await act(async () => {
        await hook.runGenerate();
      });
      const settled = harness.run(() =>
        usePopoverGeneration({
          visualRef: { current: visual },
          visualGenerationPort: port,
          visual,
          onChange: () => {},
          onSectionChange: () => {},
        }),
      );
      assert.equal(settled.genError, "Something went wrong.");
      assert.equal(settled.genCreditError, false);
      assert.deepEqual(settled.candidates, []);
    } finally {
      harness.cleanup();
    }
  });

  test("runGenerate flags a credit error via genCreditError", async () => {
    const visual = buildVisual({ title: "Flow" });
    const { port } = makePort({
      ok: false,
      error: "Out of credits.",
      errorKind: "credit",
    });

    const harness = createReactRenderHarness();
    try {
      const hook = harness.run(() =>
        usePopoverGeneration({
          visualRef: { current: visual },
          visualGenerationPort: port,
          visual,
          onChange: () => {},
          onSectionChange: () => {},
        }),
      );
      await act(async () => {
        await hook.runGenerate();
      });
      const settled = harness.run(() =>
        usePopoverGeneration({
          visualRef: { current: visual },
          visualGenerationPort: port,
          visual,
          onChange: () => {},
          onSectionChange: () => {},
        }),
      );
      assert.equal(settled.genCreditError, true);
      assert.equal(settled.genError, "Out of credits.");
    } finally {
      harness.cleanup();
    }
  });

  test("chooseCandidate routes through onCommand (visual.merge_content), preserving autoLayout, and clears candidates/section", () => {
    const visual = buildVisual({ title: "Flow", autoLayout: true });
    const candidate = buildVisual({ title: "Variation A", autoLayout: false });
    const commands: VisualCommandPayload[] = [];
    const sections: (MenuSection | null)[] = [];
    const { port } = makePort({ ok: true, candidates: [] });

    const harness = createReactRenderHarness();
    try {
      const hook = harness.run(() =>
        usePopoverGeneration({
          visualRef: { current: visual },
          visualGenerationPort: port,
          visual,
          onChange: () => assert.fail("onChange should not be called"),
          onCommand: (payload) => commands.push(payload),
          onSectionChange: (s) => sections.push(s),
        }),
      );

      act(() => {
        hook.chooseCandidate(candidate);
      });

      assert.equal(commands.length, 1);
      assert.equal(commands[0]?.op, "visual.merge_content");
      const merged = commands[0] as {
        op: "visual.merge_content";
        newVisual: Visual;
      };
      assert.equal(merged.newVisual.title, "Variation A");
      assert.equal(merged.newVisual.autoLayout, true);
      assert.deepEqual(sections, [null]);
    } finally {
      harness.cleanup();
    }
  });

  test("chooseCandidate falls back to onChange when no onCommand is supplied", () => {
    const visual = buildVisual({ title: "Flow", autoLayout: true });
    const candidate = buildVisual({ title: "Variation A", autoLayout: false });
    const changed: Visual[] = [];
    const { port } = makePort({ ok: true, candidates: [] });

    const harness = createReactRenderHarness();
    try {
      const hook = harness.run(() =>
        usePopoverGeneration({
          visualRef: { current: visual },
          visualGenerationPort: port,
          visual,
          onChange: (next) => changed.push(next),
          onSectionChange: () => {},
        }),
      );

      act(() => {
        hook.chooseCandidate(candidate);
      });

      assert.equal(changed.length, 1);
      assert.equal(changed[0]?.title, "Variation A");
      assert.equal(changed[0]?.autoLayout, true);
    } finally {
      harness.cleanup();
    }
  });

  test("reset clears candidates, genError, and genCreditError", async () => {
    const visual = buildVisual({ title: "Flow" });
    const { port } = makePort({
      ok: false,
      error: "Out of credits.",
      errorKind: "credit",
    });

    const harness = createReactRenderHarness();
    try {
      const hook = harness.run(() =>
        usePopoverGeneration({
          visualRef: { current: visual },
          visualGenerationPort: port,
          visual,
          onChange: () => {},
          onSectionChange: () => {},
        }),
      );
      await act(async () => {
        await hook.runGenerate();
      });
      const beforeReset = harness.run(() =>
        usePopoverGeneration({
          visualRef: { current: visual },
          visualGenerationPort: port,
          visual,
          onChange: () => {},
          onSectionChange: () => {},
        }),
      );
      assert.equal(beforeReset.genCreditError, true);

      act(() => {
        beforeReset.reset();
      });
      const afterReset = harness.run(() =>
        usePopoverGeneration({
          visualRef: { current: visual },
          visualGenerationPort: port,
          visual,
          onChange: () => {},
          onSectionChange: () => {},
        }),
      );
      assert.equal(afterReset.genCreditError, false);
      assert.equal(afterReset.genError, null);
      assert.deepEqual(afterReset.candidates, []);
    } finally {
      harness.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// useVisualSync
// ---------------------------------------------------------------------------

describe("useVisualSync", () => {
  function makePort(result: GenerateResult) {
    const calls: Array<{ text: string; key: string | undefined }> = [];
    return {
      calls,
      port: {
        requestVisualCandidates: (
          text: string,
          _options?: unknown,
          request?: { idempotencyKey?: string },
        ) => {
          calls.push({ text, key: request?.idempotencyKey });
          return Promise.resolve(result);
        },
      },
    };
  }

  test("guards against syncing with no source text (neither currentSourceText nor visual.sourceText)", async () => {
    const visual = buildVisual({ sourceText: undefined });
    const { port, calls } = makePort({ ok: true, candidates: [] });

    const harness = createReactRenderHarness();
    try {
      const hook = harness.run(() =>
        useVisualSync({
          visualRef: { current: visual },
          visualGenerationPort: port,
          onChange: () => assert.fail("onChange should not be called"),
          onSectionChange: () =>
            assert.fail("onSectionChange should not be called"),
        }),
      );
      await act(async () => {
        await hook.runSync();
      });
      const settled = harness.run(() =>
        useVisualSync({
          visualRef: { current: visual },
          visualGenerationPort: port,
          onChange: () => {},
          onSectionChange: () => {},
        }),
      );
      assert.equal(settled.syncError, "No source text to sync from.");
      assert.equal(calls.length, 0);
    } finally {
      harness.cleanup();
    }
  });

  test("runSync merges the refreshed visual via mergeVisualContent + onChange when no onCommand is supplied", async () => {
    const visual = buildVisual({
      title: "Original",
      nodes: [buildVisualNode({ id: "node-1", label: "Start" })],
    });
    const candidate = buildVisual({
      title: "Refreshed",
      nodes: [buildVisualNode({ id: "node-1", label: "Start" })],
    });
    const { port, calls } = makePort({ ok: true, candidates: [candidate] });
    const changed: Visual[] = [];
    const sections: (MenuSection | null)[] = [];

    const harness = createReactRenderHarness();
    try {
      const hook = harness.run(() =>
        useVisualSync({
          visualRef: { current: visual },
          visualGenerationPort: port,
          currentSourceText: "Some source paragraph.",
          onChange: (next) => changed.push(next),
          onSectionChange: (s) => sections.push(s),
        }),
      );
      await act(async () => {
        await hook.runSync();
      });

      assert.deepEqual(
        calls.map((call) => call.text),
        ["Some source paragraph."],
      );
      assert.ok(calls[0]?.key?.startsWith("visual-sync-"));
      assert.equal(changed.length, 1);
      assert.equal(changed[0]?.sourceText, "Some source paragraph.");
      assert.deepEqual(sections, [null]);

      const settled = harness.run(() =>
        useVisualSync({
          visualRef: { current: visual },
          visualGenerationPort: port,
          currentSourceText: "Some source paragraph.",
          onChange: () => {},
          onSectionChange: () => {},
        }),
      );
      assert.equal(settled.syncStatus, "idle");
      assert.equal(settled.syncError, null);
    } finally {
      harness.cleanup();
    }
  });

  test("runSync routes through onCommand (visual.merge_content) with the stamped refreshed visual when supplied", async () => {
    const visual = buildVisual({ title: "Original" });
    const candidate = buildVisual({ title: "Refreshed" });
    const { port } = makePort({ ok: true, candidates: [candidate] });
    const commands: VisualCommandPayload[] = [];

    const harness = createReactRenderHarness();
    try {
      const hook = harness.run(() =>
        useVisualSync({
          visualRef: { current: visual },
          visualGenerationPort: port,
          currentSourceText: "Text to sync.",
          onChange: () => assert.fail("onChange should not be called"),
          onCommand: (payload) => commands.push(payload),
          onSectionChange: () => {},
        }),
      );
      await act(async () => {
        await hook.runSync();
      });
      assert.equal(commands.length, 1);
      assert.equal(commands[0]?.op, "visual.merge_content");
      const merged = commands[0] as {
        op: "visual.merge_content";
        newVisual: Visual;
      };
      assert.equal(merged.newVisual.title, "Refreshed");
      assert.equal(merged.newVisual.sourceText, "Text to sync.");
    } finally {
      harness.cleanup();
    }
  });

  test("runSync maps the generic failure message to a friendlier sync-specific message", async () => {
    const visual = buildVisual({ sourceText: "Existing text" });
    const { port } = makePort({
      ok: false,
      error: "We couldn't generate a visual. Please try again.",
      errorKind: "other",
    });

    const harness = createReactRenderHarness();
    try {
      const hook = harness.run(() =>
        useVisualSync({
          visualRef: { current: visual },
          visualGenerationPort: port,
          onChange: () => {},
          onSectionChange: () => {},
        }),
      );
      await act(async () => {
        await hook.runSync();
      });
      const settled = harness.run(() =>
        useVisualSync({
          visualRef: { current: visual },
          visualGenerationPort: port,
          onChange: () => {},
          onSectionChange: () => {},
        }),
      );
      assert.equal(settled.syncError, "Sync failed. Please try again.");
      assert.equal(settled.syncStatus, "idle");
    } finally {
      harness.cleanup();
    }
  });

  test("runSync passes through any other error message unchanged", async () => {
    const visual = buildVisual({ sourceText: "Existing text" });
    const { port } = makePort({
      ok: false,
      error: "Rate limited, try later.",
      errorKind: "other",
    });

    const harness = createReactRenderHarness();
    try {
      const hook = harness.run(() =>
        useVisualSync({
          visualRef: { current: visual },
          visualGenerationPort: port,
          onChange: () => {},
          onSectionChange: () => {},
        }),
      );
      await act(async () => {
        await hook.runSync();
      });
      const settled = harness.run(() =>
        useVisualSync({
          visualRef: { current: visual },
          visualGenerationPort: port,
          onChange: () => {},
          onSectionChange: () => {},
        }),
      );
      assert.equal(settled.syncError, "Rate limited, try later.");
    } finally {
      harness.cleanup();
    }
  });

  test("reset clears syncError", async () => {
    const visual = buildVisual({ sourceText: undefined });
    const { port } = makePort({ ok: true, candidates: [] });

    const harness = createReactRenderHarness();
    try {
      const hook = harness.run(() =>
        useVisualSync({
          visualRef: { current: visual },
          visualGenerationPort: port,
          onChange: () => {},
          onSectionChange: () => {},
        }),
      );
      await act(async () => {
        await hook.runSync();
      });
      const beforeReset = harness.run(() =>
        useVisualSync({
          visualRef: { current: visual },
          visualGenerationPort: port,
          onChange: () => {},
          onSectionChange: () => {},
        }),
      );
      assert.equal(beforeReset.syncError, "No source text to sync from.");

      act(() => {
        beforeReset.reset();
      });
      const afterReset = harness.run(() =>
        useVisualSync({
          visualRef: { current: visual },
          visualGenerationPort: port,
          onChange: () => {},
          onSectionChange: () => {},
        }),
      );
      assert.equal(afterReset.syncError, null);
    } finally {
      harness.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// usePopoverPosition
// ---------------------------------------------------------------------------

type Listener = (event: unknown) => void;

function createEventBus() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, fn: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string, event: unknown) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
    },
    count(type: string): number {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

class FakeElement {
  private closestMap: Record<string, FakeElement | null>;
  private nodeId?: string;
  private childElements: FakeElement[] = [];

  constructor(
    private rect: AnchorRect,
    opts: {
      closest?: Record<string, FakeElement | null>;
      nodeId?: string;
      children?: FakeElement[];
    } = {},
  ) {
    this.closestMap = opts.closest ?? {};
    this.nodeId = opts.nodeId;
    this.childElements = opts.children ?? [];
  }

  getAttribute(name: string): string | null {
    if (name === "data-node-id") return this.nodeId ?? null;
    return null;
  }

  getBoundingClientRect(): AnchorRect {
    return this.rect;
  }

  get offsetWidth(): number {
    return this.rect.width;
  }

  get offsetHeight(): number {
    return this.rect.height;
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (selector !== "[data-node-id]") return [];
    const found: FakeElement[] = [];
    const walk = (el: FakeElement) => {
      for (const child of el.childElements) {
        if (child.nodeId !== undefined) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  closest(selector: string): FakeElement | null {
    return this.closestMap[selector] ?? null;
  }
}

const ORIGINAL_ELEMENT = (globalThis as { Element?: unknown }).Element;
const ORIGINAL_WINDOW_POS = globalThis.window;
const ORIGINAL_DOCUMENT_POS = globalThis.document;

function installPositionStubs(viewport = { width: 1200, height: 800 }) {
  (globalThis as { Element?: unknown }).Element = FakeElement;
  const windowBus = createEventBus();
  const documentBus = createEventBus();
  (globalThis as { window?: unknown }).window = {
    addEventListener: windowBus.addEventListener,
    removeEventListener: windowBus.removeEventListener,
    innerWidth: viewport.width,
    innerHeight: viewport.height,
  };
  (globalThis as { document?: unknown }).document = {
    addEventListener: documentBus.addEventListener,
    removeEventListener: documentBus.removeEventListener,
  };
  return { windowBus, documentBus };
}

function restorePositionStubs() {
  (globalThis as { Element?: unknown }).Element = ORIGINAL_ELEMENT;
  (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW_POS;
  (globalThis as { document?: unknown }).document = ORIGINAL_DOCUMENT_POS;
}

const ANCHOR_RECT: AnchorRect = {
  top: 200,
  left: 300,
  right: 340,
  bottom: 240,
  width: 40,
  height: 40,
};
const MEASURE_RECT: AnchorRect = {
  top: 0,
  left: 0,
  right: 200,
  bottom: 100,
  width: 200,
  height: 100,
};

describe("usePopoverPosition", () => {
  test("panel mode registers no listeners and leaves coords at the default off-screen value", () => {
    const { windowBus, documentBus } = installPositionStubs();
    try {
      const anchor = new FakeElement(ANCHOR_RECT);
      const measure = new FakeElement(MEASURE_RECT);
      const harness = createReactRenderHarness();
      try {
        const value = harness.run(() =>
          usePopoverPosition({
            mode: "panel",
            anchorRef: { current: anchor as unknown as HTMLElement },
            measureRef: { current: measure as unknown as HTMLDivElement },
            toolbarRef: { current: null },
            componentContext: false,
            selectedNodeId: null,
            popoverExpanded: false,
            onClose: () => {},
          }),
        );
        assert.deepEqual(value.coords, { top: -1000, left: -1000 });
        assert.equal(windowBus.count("resize"), 0);
        assert.equal(windowBus.count("scroll"), 0);
        assert.equal(documentBus.count("mousedown"), 0);
      } finally {
        harness.cleanup();
      }
    } finally {
      restorePositionStubs();
    }
  });

  test("float mode computes coords on mount matching the computeAnchoredPosition oracle, and registers listeners", () => {
    const { windowBus, documentBus } = installPositionStubs();
    try {
      const anchor = new FakeElement(ANCHOR_RECT);
      const measure = new FakeElement(MEASURE_RECT);
      const harness = createReactRenderHarness();
      try {
        const value = harness.run(() =>
          usePopoverPosition({
            mode: "float",
            anchorRef: { current: anchor as unknown as HTMLElement },
            measureRef: { current: measure as unknown as HTMLDivElement },
            toolbarRef: { current: null },
            componentContext: false,
            selectedNodeId: null,
            popoverExpanded: false,
            onClose: () => {},
          }),
        );

        const expected = computeAnchoredPosition({
          anchor: ANCHOR_RECT,
          float: { width: MEASURE_RECT.width, height: MEASURE_RECT.height },
          viewport: { width: 1200, height: 800 },
          placement: "top",
          gap: 8,
          padding: 8,
        });
        assert.deepEqual(value.coords, {
          top: expected.top,
          left: expected.left,
        });
        assert.equal(windowBus.count("resize"), 1);
        assert.equal(windowBus.count("scroll"), 1);
        assert.equal(documentBus.count("mousedown"), 1);
      } finally {
        harness.cleanup();
      }
    } finally {
      restorePositionStubs();
    }
  });

  test("float mode with componentContext anchors on the selected sub-node element (right placement) matching the oracle", () => {
    const { windowBus } = installPositionStubs();
    try {
      const subRect: AnchorRect = {
        top: 50,
        left: 60,
        right: 100,
        bottom: 90,
        width: 40,
        height: 40,
      };
      const subNode = new FakeElement(subRect, { nodeId: "sub-1" });
      const anchor = new FakeElement(ANCHOR_RECT, { children: [subNode] });
      const measure = new FakeElement(MEASURE_RECT);
      const harness = createReactRenderHarness();
      try {
        const value = harness.run(() =>
          usePopoverPosition({
            mode: "float",
            anchorRef: { current: anchor as unknown as HTMLElement },
            measureRef: { current: measure as unknown as HTMLDivElement },
            toolbarRef: { current: null },
            componentContext: true,
            selectedNodeId: "sub-1",
            popoverExpanded: false,
            onClose: () => {},
          }),
        );

        const expected = computeAnchoredPosition({
          anchor: subRect,
          float: { width: MEASURE_RECT.width, height: MEASURE_RECT.height },
          viewport: { width: 1200, height: 800 },
          placement: "right",
          gap: 8,
          padding: 8,
        });
        assert.deepEqual(value.coords, {
          top: expected.top,
          left: expected.left,
        });
        assert.equal(windowBus.count("resize"), 1);
      } finally {
        harness.cleanup();
      }
    } finally {
      restorePositionStubs();
    }
  });

  test("resize dispatches trigger a reposition recompute", () => {
    const { windowBus } = installPositionStubs();
    try {
      const anchor = new FakeElement(ANCHOR_RECT);
      const measure = new FakeElement(MEASURE_RECT);
      const harness = createReactRenderHarness();
      try {
        harness.run(() =>
          usePopoverPosition({
            mode: "float",
            anchorRef: { current: anchor as unknown as HTMLElement },
            measureRef: { current: measure as unknown as HTMLDivElement },
            toolbarRef: { current: null },
            componentContext: false,
            selectedNodeId: null,
            popoverExpanded: false,
            onClose: () => {},
          }),
        );

        // Move the anchor and confirm a dispatched resize recomputes coords
        // against the *new* rect (proving reposition() re-reads live DOM
        // state rather than caching the mount-time rect).
        anchor.getBoundingClientRect = () => ({
          top: 500,
          left: 500,
          right: 540,
          bottom: 540,
          width: 40,
          height: 40,
        });
        act(() => {
          windowBus.dispatch("resize", {});
        });

        const settled = harness.run(() =>
          usePopoverPosition({
            mode: "float",
            anchorRef: { current: anchor as unknown as HTMLElement },
            measureRef: { current: measure as unknown as HTMLDivElement },
            toolbarRef: { current: null },
            componentContext: false,
            selectedNodeId: null,
            popoverExpanded: false,
            onClose: () => {},
          }),
        );
        const expected = computeAnchoredPosition({
          anchor: {
            top: 500,
            left: 500,
            right: 540,
            bottom: 540,
            width: 40,
            height: 40,
          },
          float: { width: MEASURE_RECT.width, height: MEASURE_RECT.height },
          viewport: { width: 1200, height: 800 },
          placement: "top",
          gap: 8,
          padding: 8,
        });
        assert.deepEqual(settled.coords, {
          top: expected.top,
          left: expected.left,
        });
      } finally {
        harness.cleanup();
      }
    } finally {
      restorePositionStubs();
    }
  });

  test("scroll outside any visual chrome dismisses the popover via onClose", () => {
    const { windowBus } = installPositionStubs();
    try {
      const anchor = new FakeElement(ANCHOR_RECT);
      const measure = new FakeElement(MEASURE_RECT);
      let closeCalls = 0;
      const harness = createReactRenderHarness();
      try {
        harness.run(() =>
          usePopoverPosition({
            mode: "float",
            anchorRef: { current: anchor as unknown as HTMLElement },
            measureRef: { current: measure as unknown as HTMLDivElement },
            toolbarRef: { current: null },
            componentContext: false,
            selectedNodeId: null,
            popoverExpanded: false,
            onClose: () => {
              closeCalls++;
            },
          }),
        );
        const outsideTarget = new FakeElement(ANCHOR_RECT, { closest: {} });
        act(() => {
          windowBus.dispatch("scroll", { target: outsideTarget });
        });
        assert.equal(closeCalls, 1);
      } finally {
        harness.cleanup();
      }
    } finally {
      restorePositionStubs();
    }
  });

  test("scroll inside visual chrome is ignored (no onClose, no reposition)", () => {
    const { windowBus } = installPositionStubs();
    try {
      const anchor = new FakeElement(ANCHOR_RECT);
      const measure = new FakeElement(MEASURE_RECT);
      let closeCalls = 0;
      const harness = createReactRenderHarness();
      try {
        const value = harness.run(() =>
          usePopoverPosition({
            mode: "float",
            anchorRef: { current: anchor as unknown as HTMLElement },
            measureRef: { current: measure as unknown as HTMLDivElement },
            toolbarRef: { current: null },
            componentContext: false,
            selectedNodeId: null,
            popoverExpanded: false,
            onClose: () => {
              closeCalls++;
            },
          }),
        );
        const chromeTarget = new FakeElement(ANCHOR_RECT);
        const chromeSelf = chromeTarget;
        // Simulate `target.closest("[data-visual-chrome]")` resolving to itself.
        Object.defineProperty(chromeTarget, "closest", {
          value: (selector: string) =>
            selector === "[data-visual-chrome]" ? chromeSelf : null,
        });
        act(() => {
          windowBus.dispatch("scroll", { target: chromeTarget });
        });
        assert.equal(closeCalls, 0);
        assert.deepEqual(value.coords, value.coords);
      } finally {
        harness.cleanup();
      }
    } finally {
      restorePositionStubs();
    }
  });

  test("scroll while popoverExpanded repositions instead of closing", () => {
    const { windowBus } = installPositionStubs();
    try {
      const anchor = new FakeElement(ANCHOR_RECT);
      const measure = new FakeElement(MEASURE_RECT);
      let closeCalls = 0;
      const harness = createReactRenderHarness();
      try {
        harness.run(() =>
          usePopoverPosition({
            mode: "float",
            anchorRef: { current: anchor as unknown as HTMLElement },
            measureRef: { current: measure as unknown as HTMLDivElement },
            toolbarRef: { current: null },
            componentContext: false,
            selectedNodeId: null,
            popoverExpanded: true,
            onClose: () => {
              closeCalls++;
            },
          }),
        );
        anchor.getBoundingClientRect = () => ({
          top: 10,
          left: 10,
          right: 50,
          bottom: 50,
          width: 40,
          height: 40,
        });
        const outsideTarget = new FakeElement(ANCHOR_RECT, { closest: {} });
        act(() => {
          windowBus.dispatch("scroll", { target: outsideTarget });
        });
        assert.equal(closeCalls, 0, "expanded popovers reposition, not close");

        const settled = harness.run(() =>
          usePopoverPosition({
            mode: "float",
            anchorRef: { current: anchor as unknown as HTMLElement },
            measureRef: { current: measure as unknown as HTMLDivElement },
            toolbarRef: { current: null },
            componentContext: false,
            selectedNodeId: null,
            popoverExpanded: true,
            onClose: () => {
              closeCalls++;
            },
          }),
        );
        const expected = computeAnchoredPosition({
          anchor: {
            top: 10,
            left: 10,
            right: 50,
            bottom: 50,
            width: 40,
            height: 40,
          },
          float: { width: MEASURE_RECT.width, height: MEASURE_RECT.height },
          viewport: { width: 1200, height: 800 },
          placement: "top",
          gap: 8,
          padding: 8,
        });
        assert.deepEqual(settled.coords, {
          top: expected.top,
          left: expected.left,
        });
      } finally {
        harness.cleanup();
      }
    } finally {
      restorePositionStubs();
    }
  });

  test("mousedown outside any visual chrome dismisses the popover via onClose", () => {
    const { documentBus } = installPositionStubs();
    try {
      const anchor = new FakeElement(ANCHOR_RECT);
      const measure = new FakeElement(MEASURE_RECT);
      let closeCalls = 0;
      const harness = createReactRenderHarness();
      try {
        harness.run(() =>
          usePopoverPosition({
            mode: "float",
            anchorRef: { current: anchor as unknown as HTMLElement },
            measureRef: { current: measure as unknown as HTMLDivElement },
            toolbarRef: { current: null },
            componentContext: false,
            selectedNodeId: null,
            popoverExpanded: false,
            onClose: () => {
              closeCalls++;
            },
          }),
        );
        const outsideTarget = new FakeElement(ANCHOR_RECT, { closest: {} });
        act(() => {
          documentBus.dispatch("mousedown", { target: outsideTarget });
        });
        assert.equal(closeCalls, 1);
      } finally {
        harness.cleanup();
      }
    } finally {
      restorePositionStubs();
    }
  });

  test("mousedown inside visual chrome does not dismiss the popover", () => {
    const { documentBus } = installPositionStubs();
    try {
      const anchor = new FakeElement(ANCHOR_RECT);
      const measure = new FakeElement(MEASURE_RECT);
      let closeCalls = 0;
      const harness = createReactRenderHarness();
      try {
        harness.run(() =>
          usePopoverPosition({
            mode: "float",
            anchorRef: { current: anchor as unknown as HTMLElement },
            measureRef: { current: measure as unknown as HTMLDivElement },
            toolbarRef: { current: null },
            componentContext: false,
            selectedNodeId: null,
            popoverExpanded: false,
            onClose: () => {
              closeCalls++;
            },
          }),
        );
        const insideTarget = new FakeElement(ANCHOR_RECT);
        Object.defineProperty(insideTarget, "closest", {
          value: (selector: string) =>
            selector === "[data-ds-floating]" ? insideTarget : null,
        });
        act(() => {
          documentBus.dispatch("mousedown", { target: insideTarget });
        });
        assert.equal(closeCalls, 0);
      } finally {
        harness.cleanup();
      }
    } finally {
      restorePositionStubs();
    }
  });

  test("unmount removes every registered resize/scroll/mousedown listener", () => {
    const { windowBus, documentBus } = installPositionStubs();
    try {
      const anchor = new FakeElement(ANCHOR_RECT);
      const measure = new FakeElement(MEASURE_RECT);
      const harness = createReactRenderHarness();
      harness.run(() =>
        usePopoverPosition({
          mode: "float",
          anchorRef: { current: anchor as unknown as HTMLElement },
          measureRef: { current: measure as unknown as HTMLDivElement },
          toolbarRef: { current: null },
          componentContext: false,
          selectedNodeId: null,
          popoverExpanded: false,
          onClose: () => {},
        }),
      );
      assert.equal(windowBus.count("resize"), 1);
      assert.equal(windowBus.count("scroll"), 1);
      assert.equal(documentBus.count("mousedown"), 1);

      harness.cleanup();

      assert.equal(windowBus.count("resize"), 0);
      assert.equal(windowBus.count("scroll"), 0);
      assert.equal(documentBus.count("mousedown"), 0);
    } finally {
      restorePositionStubs();
    }
  });
});
