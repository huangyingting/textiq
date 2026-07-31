/**
 * Direct behavior coverage for `VisualContextPopover` (#1963) — panel
 * open/close & switching, brand loading + apply, sync-to-text wiring, AI
 * variations generation (success/error/credit-error/empty-prompt guard),
 * component-context mode (element toolbar, reset/delete), the
 * selection-context-key reset, and the float-mode accessibility/positioning
 * wiring.
 *
 * The section content itself (`VisualExportPanel`/`VisualSyncPanel`/
 * `VisualInfoPanel`/`VisualVariationsPanel`) already has its own dedicated
 * `visual-context-popover-panels.test.tsx` + `generated-candidates-panel.
 * test.tsx` coverage, and the navigation/generation/sync/position hooks
 * already have their own `visual-context-popover-hooks.test.ts` coverage —
 * this file only asserts the *wiring* between the popover shell and those
 * already-covered pieces (which section renders for which toolbar click,
 * what data/callbacks get threaded through), not their internal branches.
 *
 * Colors/fonts/effects/size/layout/icon submenus are out of this issue's
 * required-coverage list (per #1963's own wording) — they stay
 * transitively import-covered only, so this file never opens them.
 *
 * Most tests use `mode="panel"` (renders content directly, no
 * `FloatingSurface`/portal) since that's where all of the popover's own
 * state logic lives. A dedicated `describe("float mode")` block asserts the
 * `mode="float"` wiring into the real `FloatingSurface` (accessibility role/
 * label, `closeOnClickAway`, and the `freezePosition`/width logic) without
 * re-testing `FloatingSurface`'s own Escape/click-away behavior (already
 * covered by `ui-interactions-coverage.test.ts`/`ui-remaining-coverage.
 * test.ts`).
 */
import assert from "node:assert/strict";
import { describe, test, afterEach } from "node:test";
import { act } from "react-test-renderer";
import type { ReactTestInstance } from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import { textOf, waitForAsyncDrain } from "@/test/render-text";
import { buildVisual, buildVisualNode } from "@/test/builders/visual";
import { FloatingSurface } from "@/components/ui";
import type { BrandStyle } from "@/lib/brand/schema";
import type { GenerateResult } from "@/lib/visual/generate";
import type { VisualGenerationActionPort } from "@/lib/action-ports";

import { VisualContextPopover } from "./visual-context-popover";

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// `ExportMenu` (mounted once the "export" section is opened) fetches user
// entitlements on mount via `useUserEntitlements`; `useBrandContext` fetches
// `/api/brand` once the "branding" section is opened. Route both to
// deterministic canned responses so no test depends on real network access.
function stubFetch(brands: BrandStyle[] = []): void {
  globalThis.fetch = (async (url: string) => {
    if (url === "/api/brand") {
      return {
        ok: true,
        json: async () => ({ brands }),
      } as Response;
    }
    if (url === "/api/user/entitlements") {
      return { ok: true, json: async () => ({}) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  }) as typeof fetch;
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
  } as BrandStyle;
}

function fakeSvg(): SVGSVGElement {
  return {
    viewBox: { baseVal: { width: 640, height: 360 } },
  } as unknown as SVGSVGElement;
}

function okPort(
  candidates = [buildVisual({ title: "Candidate" })],
): VisualGenerationActionPort {
  return {
    requestVisualCandidates: async (): Promise<GenerateResult> => ({
      ok: true,
      candidates,
    }),
  };
}

function failPort(
  error: string,
  errorKind: "credit" | "other" = "other",
): VisualGenerationActionPort {
  return {
    requestVisualCandidates: async (): Promise<GenerateResult> => ({
      ok: false,
      error,
      errorKind,
    }),
  };
}

function neverCalledPort(): VisualGenerationActionPort & { calls: number } {
  const port = {
    calls: 0,
    requestVisualCandidates: async (): Promise<GenerateResult> => {
      port.calls++;
      return { ok: true, candidates: [] };
    },
  };
  return port;
}

const anchorRef = { current: null };

function renderPopover(overrides: Record<string, unknown> = {}) {
  const changes: unknown[] = [];
  const props = {
    visualId: "visual-1",
    visual: buildVisual(),
    selectedNodeId: null,
    onChange: (next: unknown) => changes.push(next),
    onRemove: () => {},
    onClose: () => {},
    getSvgElement: fakeSvg,
    anchorRef,
    mode: "panel" as const,
    visualGenerationPort: okPort(),
    ...overrides,
  };
  const renderer = mountWithPortalDom(
    <VisualContextPopover {...(props as any)} />,
  );
  return { renderer, changes };
}

function findByAria(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.findByProps({ "aria-label": label });
}

function findToolbarButton(
  root: ReactTestInstance,
  label: string,
): ReactTestInstance {
  return root.find(
    (node) =>
      typeof node.props["aria-label"] === "string" &&
      (node.props["aria-label"] === `Show ${label}` ||
        node.props["aria-label"] === `Hide ${label}`),
  );
}

describe("VisualContextPopover — panel-mode rendering & accessibility", () => {
  test("renders the horizontal 'Visual tools' toolbar with all main-menu items and no section open initially", () => {
    withPortalDom(() => {
      stubFetch();
      const { renderer } = renderPopover();
      try {
        const toolbar = findByAria(renderer.root, "Visual tools");
        assert.equal(toolbar.props.role, "toolbar");
        assert.equal(toolbar.props["aria-orientation"], undefined);

        for (const label of [
          "Export Visual",
          "Effects",
          "Colors",
          "Fonts",
          "Size",
          "Swap Layout",
          "Swap Branding",
          "Sync with Text",
          "Info",
        ]) {
          const button = findToolbarButton(renderer.root, label);
          assert.equal(button.props["aria-label"], `Show ${label}`);
        }

        assert.ok(findByAria(renderer.root, "Generate AI variations"));
        assert.ok(findByAria(renderer.root, "Remove visual"));
        assert.doesNotMatch(textOf(renderer.root), /Export this visual as/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("Duplicate visual button only renders when onDuplicate is supplied", () => {
    withPortalDom(() => {
      stubFetch();
      const { renderer: withoutDup } = renderPopover();
      try {
        assert.throws(() => findByAria(withoutDup.root, "Duplicate visual"));
      } finally {
        act(() => withoutDup.unmount());
      }

      const { renderer: withDup } = renderPopover({ onDuplicate: () => {} });
      try {
        assert.ok(findByAria(withDup.root, "Duplicate visual"));
      } finally {
        act(() => withDup.unmount());
      }
    });
  });
});

describe("VisualContextPopover — panel switching (open/close)", () => {
  test("clicking a toolbar item opens its section and flips the aria-label to Hide; clicking again closes it", () => {
    withPortalDom(() => {
      stubFetch();
      const { renderer } = renderPopover();
      try {
        act(() => {
          (
            findToolbarButton(renderer.root, "Info").props.onClick as () => void
          )();
        });
        assert.equal(
          findToolbarButton(renderer.root, "Info").props["aria-label"],
          "Hide Info",
        );
        assert.match(textOf(renderer.root), /Nodes/);

        act(() => {
          (
            findToolbarButton(renderer.root, "Info").props.onClick as () => void
          )();
        });
        assert.equal(
          findToolbarButton(renderer.root, "Info").props["aria-label"],
          "Show Info",
        );
        assert.doesNotMatch(textOf(renderer.root), /Nodes/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("switching directly from one open section to another replaces the content", () => {
    withPortalDom(() => {
      stubFetch();
      const { renderer } = renderPopover();
      try {
        act(() => {
          (
            findToolbarButton(renderer.root, "Info").props.onClick as () => void
          )();
        });
        assert.match(textOf(renderer.root), /Nodes/);

        act(() => {
          (
            findToolbarButton(renderer.root, "Sync with Text").props
              .onClick as () => void
          )();
        });
        assert.doesNotMatch(textOf(renderer.root), /Nodes/);
        assert.match(textOf(renderer.root), /Sync to text/);
        assert.equal(
          findToolbarButton(renderer.root, "Info").props["aria-label"],
          "Show Info",
        );
        assert.equal(
          findToolbarButton(renderer.root, "Sync with Text").props[
            "aria-label"
          ],
          "Hide Sync with Text",
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the sync toolbar icon shows a 'Source changed' indicator dot only when the source is stale", () => {
    withPortalDom(() => {
      stubFetch();
      const staleVisual = buildVisual({ sourceText: "Original text" });
      const { renderer: fresh } = renderPopover({
        visual: staleVisual,
        currentSourceText: "Original text",
      });
      try {
        assert.throws(() => findByAria(fresh.root, "Source changed"));
      } finally {
        act(() => fresh.unmount());
      }

      const { renderer: stale } = renderPopover({
        visual: staleVisual,
        currentSourceText: "Updated text",
      });
      try {
        assert.ok(findByAria(stale.root, "Source changed"));
      } finally {
        act(() => stale.unmount());
      }
    });
  });
});

describe("VisualContextPopover — export section wiring", () => {
  test("opening 'Export Visual' mounts the export trigger without opening the dialog", () => {
    withPortalDom(() => {
      stubFetch();
      const { renderer } = renderPopover();
      try {
        act(() => {
          (
            findToolbarButton(renderer.root, "Export Visual").props
              .onClick as () => void
          )();
        });
        assert.match(
          textOf(renderer.root),
          /Export this visual as PNG, SVG, or PowerPoint\./,
        );
        assert.ok(findByAria(renderer.root, "Export visual"));
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

describe("VisualContextPopover — brand section wiring", () => {
  test("shows 'No brands yet.' when the fetch resolves with an empty list", async () => {
    await withPortalDom(async () => {
      stubFetch([]);
      const { renderer } = renderPopover();
      try {
        await act(async () => {
          (
            findToolbarButton(renderer.root, "Swap Branding").props
              .onClick as () => void
          )();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.match(textOf(renderer.root), /No brands yet\./);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("shows a retryable brand-load error and suppresses duplicate retry activation", async () => {
    await withPortalDom(async () => {
      let brandFetchCalls = 0;
      globalThis.fetch = (async (url: string) => {
        if (url === "/api/brand") {
          brandFetchCalls += 1;
          if (brandFetchCalls === 1) throw new Error("network down");
          return {
            ok: true,
            json: async () => ({ brands: [buildBrand("retry", "Retry")] }),
          } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      }) as typeof fetch;

      const { renderer } = renderPopover();
      try {
        await act(async () => {
          (
            findToolbarButton(renderer.root, "Swap Branding").props
              .onClick as () => void
          )();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.equal(brandFetchCalls, 1);
        assert.match(
          textOf(renderer.root.findByProps({ role: "alert" })),
          /Saved brands could not be loaded\./,
        );
        const retry = renderer.root.find(
          (node) => node.type === "button" && textOf(node) === "Try again",
        );

        act(() => {
          retry.props.onClick();
          retry.props.onClick();
        });
        assert.equal(brandFetchCalls, 1);

        await act(async () => {
          await waitForAsyncDrain();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });

        assert.equal(brandFetchCalls, 2);
        assert.ok(findByAria(renderer.root, "Apply brand Retry"));
        assert.equal(renderer.root.findAllByProps({ role: "alert" }).length, 0);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("renders a brand chip per loaded brand; applying it calls onChange, applying to all calls onApplyBrandToAll", async () => {
    await withPortalDom(async () => {
      stubFetch([buildBrand("b1", "Acme"), buildBrand("b2", "Globex")]);
      const applyAllCalls: unknown[] = [];
      const { renderer, changes } = renderPopover({
        onApplyBrandToAll: (brand: unknown) => applyAllCalls.push(brand),
      });
      try {
        await act(async () => {
          (
            findToolbarButton(renderer.root, "Swap Branding").props
              .onClick as () => void
          )();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.ok(findByAria(renderer.root, "Apply brand Acme"));
        assert.ok(findByAria(renderer.root, "Apply brand Globex"));

        act(() => {
          (
            findByAria(renderer.root, "Apply brand Acme").props
              .onClick as () => void
          )();
        });
        assert.equal(changes.length, 1);

        act(() => {
          (
            findByAria(renderer.root, "Apply brand Globex to all visuals").props
              .onClick as () => void
          )();
        });
        assert.equal(applyAllCalls.length, 1);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

describe("VisualContextPopover — sync-to-text wiring", () => {
  test("clicking Sync to text calls the generation port and applies the merged visual via onChange", async () => {
    await withPortalDom(async () => {
      stubFetch();
      const { renderer, changes } = renderPopover({
        visual: buildVisual({ sourceText: "Some source" }),
        visualGenerationPort: okPort([buildVisual({ title: "Synced" })]),
      });
      try {
        act(() => {
          (
            findToolbarButton(renderer.root, "Sync with Text").props
              .onClick as () => void
          )();
        });
        await act(async () => {
          (
            renderer.root.find(
              (node) =>
                node.type === "button" && textOf(node).includes("Sync to text"),
            ).props.onClick as () => void
          )();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.equal(changes.length, 1);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("sync failure surfaces the error via VisualSyncPanel's alert with a Try again retry", async () => {
    await withPortalDom(async () => {
      stubFetch();
      const { renderer } = renderPopover({
        visual: buildVisual({ sourceText: "Some source" }),
        visualGenerationPort: failPort("Sync failed."),
      });
      try {
        act(() => {
          (
            findToolbarButton(renderer.root, "Sync with Text").props
              .onClick as () => void
          )();
        });
        await act(async () => {
          (
            renderer.root.find(
              (node) =>
                node.type === "button" && textOf(node).includes("Sync to text"),
            ).props.onClick as () => void
          )();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        const alert = renderer.root.findByProps({ role: "alert" });
        assert.match(textOf(alert), /Sync failed\./);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("with no source text at all, Sync to text is disabled and shows the 'no source' message", () => {
    withPortalDom(() => {
      stubFetch();
      const { renderer } = renderPopover({
        visual: buildVisual({ sourceText: undefined }),
        currentSourceText: undefined,
      });
      try {
        act(() => {
          (
            findToolbarButton(renderer.root, "Sync with Text").props
              .onClick as () => void
          )();
        });
        assert.match(
          textOf(renderer.root),
          /No source text is associated with this visual/,
        );
        const button = renderer.root.find(
          (node) =>
            node.type === "button" && textOf(node).includes("Sync to text"),
        );
        assert.equal(button.props.disabled, true);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

describe("VisualContextPopover — info section wiring", () => {
  test("opening Info renders VisualInfoPanel with the visual's node/edge counts and title", () => {
    withPortalDom(() => {
      stubFetch();
      const { renderer } = renderPopover({
        visual: buildVisual({ title: "My Diagram" }),
      });
      try {
        act(() => {
          (
            findToolbarButton(renderer.root, "Info").props.onClick as () => void
          )();
        });
        const text = textOf(renderer.root);
        assert.match(text, /My Diagram/);
        assert.match(text, /Nodes/);
        assert.match(text, /2/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

describe("VisualContextPopover — AI variations generation", () => {
  test("generating successfully switches to the variations section and shows the returned candidates", async () => {
    await withPortalDom(async () => {
      stubFetch();
      const { renderer } = renderPopover({
        visualGenerationPort: okPort([buildVisual({ title: "Variation A" })]),
      });
      try {
        await act(async () => {
          (
            findByAria(renderer.root, "Generate AI variations").props
              .onClick as () => void
          )();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.equal(
          findByAria(renderer.root, "Generate AI variations").props.active,
          true,
        );
        assert.doesNotMatch(
          textOf(renderer.root),
          /Use the AI button in the toolbar/,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a generic generation failure surfaces genError via the candidates panel", async () => {
    await withPortalDom(async () => {
      stubFetch();
      const { renderer } = renderPopover({
        visualGenerationPort: failPort("Generation failed.", "other"),
      });
      try {
        await act(async () => {
          (
            findByAria(renderer.root, "Generate AI variations").props
              .onClick as () => void
          )();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.match(textOf(renderer.root), /Generation failed\./);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("a credit-error generation failure is distinguished from a generic error", async () => {
    await withPortalDom(async () => {
      stubFetch();
      const { renderer } = renderPopover({
        visualGenerationPort: failPort("Out of credits.", "credit"),
      });
      try {
        await act(async () => {
          (
            findByAria(renderer.root, "Generate AI variations").props
              .onClick as () => void
          )();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.match(textOf(renderer.root), /Out of credits\./);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("choosing a candidate merges it via onChange (preserving autoLayout) and clears the section", async () => {
    await withPortalDom(async () => {
      stubFetch();
      const candidate = buildVisual({ title: "Chosen", autoLayout: false });
      const { renderer, changes } = renderPopover({
        visual: buildVisual({ autoLayout: true }),
        visualGenerationPort: okPort([candidate]),
      });
      try {
        await act(async () => {
          (
            findByAria(renderer.root, "Generate AI variations").props
              .onClick as () => void
          )();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        const chooseButton = findByAria(
          renderer.root,
          "Select variation 1 of 1",
        );
        act(() => {
          (chooseButton.props.onClick as () => void)();
        });
        assert.equal(changes.length, 1);
        assert.equal((changes[0] as { autoLayout?: boolean }).autoLayout, true);
        assert.equal(
          findByAria(renderer.root, "Generate AI variations").props.active,
          false,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("routes through onCommand (visual.merge_content) instead of onChange when onCommand is supplied", async () => {
    await withPortalDom(async () => {
      stubFetch();
      const candidate = buildVisual({ title: "Chosen" });
      const commandCalls: unknown[] = [];
      const { renderer, changes } = renderPopover({
        onCommand: (payload: unknown) => commandCalls.push(payload),
        visualGenerationPort: okPort([candidate]),
      });
      try {
        await act(async () => {
          (
            findByAria(renderer.root, "Generate AI variations").props
              .onClick as () => void
          )();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        const chooseButton = findByAria(
          renderer.root,
          "Select variation 1 of 1",
        );
        act(() => {
          (chooseButton.props.onClick as () => void)();
        });
        assert.equal(changes.length, 0);
        assert.equal(commandCalls.length, 1);
        assert.equal(
          (commandCalls[0] as { op: string }).op,
          "visual.merge_content",
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the empty-prompt guard blocks generation before the port is ever called", async () => {
    await withPortalDom(async () => {
      stubFetch();
      const port = neverCalledPort();
      const { renderer } = renderPopover({
        visual: buildVisual({
          title: "",
          nodes: [buildVisualNode({ id: "n1", label: "" })],
          edges: [],
        }),
        visualGenerationPort: port,
      });
      try {
        await act(async () => {
          (
            findByAria(renderer.root, "Generate AI variations").props
              .onClick as () => void
          )();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.equal(port.calls, 0);
        assert.match(
          textOf(renderer.root),
          /Add some labels before generating variations\./,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("the AI Variations button is disabled while a generation request is pending", () => {
    withPortalDom(() => {
      stubFetch();
      let resolveGen!: (result: GenerateResult) => void;
      const pendingPort: VisualGenerationActionPort = {
        requestVisualCandidates: () =>
          new Promise((resolve) => {
            resolveGen = resolve;
          }),
      };
      const { renderer } = renderPopover({ visualGenerationPort: pendingPort });
      try {
        act(() => {
          (
            findByAria(renderer.root, "Generate AI variations").props
              .onClick as () => void
          )();
        });
        assert.equal(
          findByAria(renderer.root, "Generate AI variations").props.disabled,
          true,
        );
        act(() => {
          resolveGen({ ok: true, candidates: [] });
        });
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

describe("VisualContextPopover — component-context mode (element selected)", () => {
  test("renders the vertical 'Element tools' toolbar with the component menu items", () => {
    withPortalDom(() => {
      stubFetch();
      const { renderer } = renderPopover({ selectedNodeId: "node-1" });
      try {
        const toolbar = findByAria(renderer.root, "Element tools");
        assert.equal(toolbar.props.role, "toolbar");
        assert.equal(toolbar.props["aria-orientation"], "vertical");

        for (const label of ["Colors", "Font", "Icon"]) {
          assert.ok(findToolbarButton(renderer.root, label));
        }
        assert.throws(() => findToolbarButton(renderer.root, "Export Visual"));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("'Reset element style' calls onCommand twice (style + ext-style) with a shared coalesce key when onCommand is supplied", () => {
    withPortalDom(() => {
      stubFetch();
      const commandCalls: Array<{ payload: unknown; key?: string }> = [];
      const { renderer } = renderPopover({
        selectedNodeId: "node-1",
        onCommand: (payload: unknown, coalesceKey?: string) =>
          commandCalls.push({ payload, key: coalesceKey }),
      });
      try {
        act(() => {
          (
            findByAria(renderer.root, "Reset element style").props
              .onClick as () => void
          )();
        });
        assert.equal(commandCalls.length, 2);
        assert.equal(commandCalls[0].key, commandCalls[1].key);
        assert.equal(
          (commandCalls[0].payload as { op: string }).op,
          "visual.reset_node_style",
        );
        assert.equal(
          (commandCalls[1].payload as { op: string }).op,
          "visual.reset_node_ext_style",
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("'Reset element style' falls back to onChange when no onCommand is supplied", () => {
    withPortalDom(() => {
      stubFetch();
      const { renderer, changes } = renderPopover({ selectedNodeId: "node-1" });
      try {
        act(() => {
          (
            findByAria(renderer.root, "Reset element style").props
              .onClick as () => void
          )();
        });
        assert.equal(changes.length, 1);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("'Delete element' only renders when onRemoveSelectedNode is supplied, and invokes it directly", () => {
    withPortalDom(() => {
      stubFetch();
      const { renderer: without } = renderPopover({ selectedNodeId: "node-1" });
      try {
        assert.throws(() => findByAria(without.root, "Delete element"));
      } finally {
        act(() => without.unmount());
      }

      let removeCalls = 0;
      const { renderer: withRemove } = renderPopover({
        selectedNodeId: "node-1",
        onRemoveSelectedNode: () => {
          removeCalls++;
        },
      });
      try {
        act(() => {
          (
            findByAria(withRemove.root, "Delete element").props
              .onClick as () => void
          )();
        });
        assert.equal(removeCalls, 1);
      } finally {
        act(() => withRemove.unmount());
      }
    });
  });
});

describe("VisualContextPopover — selection-context-key reset", () => {
  test("switching selectedNodeId resets the open section and clears any error state from the previous selection", async () => {
    await withPortalDom(async () => {
      stubFetch();
      const { renderer } = renderPopover({
        selectedNodeId: null,
        visual: buildVisual({ sourceText: "Some source" }),
        visualGenerationPort: failPort("Sync failed."),
      });
      try {
        act(() => {
          (
            findToolbarButton(renderer.root, "Sync with Text").props
              .onClick as () => void
          )();
        });
        await act(async () => {
          (
            renderer.root.find(
              (node) =>
                node.type === "button" && textOf(node).includes("Sync to text"),
            ).props.onClick as () => void
          )();
          await waitForAsyncDrain();
          await waitForAsyncDrain();
        });
        assert.ok(renderer.root.findByProps({ role: "alert" }));

        act(() => {
          renderer.update(
            <VisualContextPopover
              visualId="visual-1"
              visual={buildVisual({ sourceText: "Some source" })}
              selectedNodeId="node-1"
              onChange={() => {}}
              onRemove={() => {}}
              onClose={() => {}}
              getSvgElement={fakeSvg}
              anchorRef={anchorRef}
              mode="panel"
              visualGenerationPort={failPort("Sync failed.")}
            />,
          );
        });

        assert.throws(() => renderer.root.findByProps({ role: "alert" }));
        assert.ok(findByAria(renderer.root, "Element tools"));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

describe("VisualContextPopover — float mode wiring", () => {
  test("mounts a FloatingSurface with the 'Visual controls' accessibility surface, disabled click-away, and the visual-context width", () => {
    withPortalDom(() => {
      stubFetch();
      const { renderer } = renderPopover({ mode: "float" });
      try {
        const surface = renderer.root.findByType(FloatingSurface);
        assert.equal(surface.props.role, "region");
        assert.equal(surface.props["aria-label"], "Visual controls");
        assert.equal(surface.props.closeOnClickAway, false);
        assert.equal(surface.props.style.width, 400);
        assert.equal(surface.props.clampToViewport, true);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("opening a section freezes the position (clampToViewport becomes false)", () => {
    withPortalDom(() => {
      stubFetch();
      const { renderer } = renderPopover({ mode: "float" });
      try {
        act(() => {
          (
            findToolbarButton(renderer.root, "Info").props.onClick as () => void
          )();
        });
        const surface = renderer.root.findByType(FloatingSurface);
        assert.equal(surface.props.clampToViewport, false);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("component-context float mode uses 'max-content' width when collapsed and the component popover width when a section is open", () => {
    withPortalDom(() => {
      stubFetch();
      const { renderer } = renderPopover({
        mode: "float",
        selectedNodeId: "node-1",
      });
      try {
        assert.equal(
          renderer.root.findByType(FloatingSurface).props.style.width,
          "max-content",
        );
        act(() => {
          (
            findToolbarButton(renderer.root, "Colors").props
              .onClick as () => void
          )();
        });
        assert.equal(
          renderer.root.findByType(FloatingSurface).props.style.width,
          300,
        );
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});
