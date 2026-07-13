/**
 * Direct behavior coverage for the four exported panels in
 * `visual-context-popover-panels.tsx` (#1963): `VisualExportPanel`,
 * `VisualSyncPanel`, `VisualInfoPanel`, `VisualVariationsPanel`.
 *
 * `computeVisualInfo` (`@/lib/visual/info`) already has dedicated
 * `info.test.ts` coverage, so `VisualInfoPanel`'s test here only asserts that
 * the panel *wires* the computed info into the DOM correctly (kind label,
 * counts, stale banner) — not every branch of `computeVisualInfo` itself.
 * Likewise `GeneratedCandidatesPanel` (used by `VisualVariationsPanel`) has
 * its own dedicated `generated-candidates-panel.test.tsx`; this file only
 * asserts the wrapper passes its props through and supplies the panel's own
 * `empty` copy.
 *
 * `VisualExportPanel` renders `ExportMenu` → `ExportDialog` with `open`
 * initially `false` (`ExportDialog` early-returns/renders nothing via
 * `{open && (...)}` inside its `AnimatePresence`), so this file only asserts
 * the panel renders the "Export visual" trigger — it does not open the
 * dialog (that would require `export-dialog.test.tsx`'s full stub set —
 * `@/lib/visual/export`, `XMLSerializer` — and would duplicate that file's
 * own coverage).
 *
 * All four panels render through `@/test/portal-dom`'s
 * `withPortalDom`/`mountWithPortalDom` for the shared fake `document.body`/
 * `IntersectionObserver`/framer-motion stubs used by `Button`/`ToolbarButton`/
 * `GeneratingIndicator`.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act } from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import { textOf } from "@/test/render-text";
import { buildVisual, buildVisualNode } from "@/test/builders/visual";

import {
  VisualExportPanel,
  VisualSyncPanel,
  VisualInfoPanel,
  VisualVariationsPanel,
} from "./visual-context-popover-panels";

function noop() {}

describe("VisualExportPanel", () => {
  test("renders the export blurb and an 'Export visual' trigger without opening the dialog", () => {
    withPortalDom(() => {
      const renderer = mountWithPortalDom(
        <VisualExportPanel
          visual={buildVisual({ title: "Q3 roadmap" })}
          getSvgElement={() => null}
        />,
      );
      try {
        assert.match(textOf(renderer.root), /Export this visual as PNG/);
        const trigger = renderer.root.findByProps({
          "aria-label": "Export visual",
        });
        assert.equal(trigger.props["aria-haspopup"], "dialog");
        assert.throws(() => renderer.root.findByProps({ role: "dialog" }));
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

describe("VisualSyncPanel", () => {
  test("stale banner shows only when stale, and disappears when not", () => {
    withPortalDom(() => {
      const staleRenderer = mountWithPortalDom(
        <VisualSyncPanel
          visual={buildVisual({ sourceText: "Some source" })}
          stale
          syncStatus="idle"
          syncError={null}
          onSync={noop}
        />,
      );
      try {
        assert.match(
          textOf(staleRenderer.root),
          /Source text has changed since this visual was generated\./,
        );
      } finally {
        act(() => staleRenderer.unmount());
      }

      const freshRenderer = mountWithPortalDom(
        <VisualSyncPanel
          visual={buildVisual({ sourceText: "Some source" })}
          stale={false}
          syncStatus="idle"
          syncError={null}
          onSync={noop}
        />,
      );
      try {
        assert.doesNotMatch(
          textOf(freshRenderer.root),
          /Source text has changed/,
        );
      } finally {
        act(() => freshRenderer.unmount());
      }
    });
  });

  test("shows the 'no source' message and disables the Sync button when neither the visual nor currentSourceText has source text", () => {
    withPortalDom(() => {
      const renderer = mountWithPortalDom(
        <VisualSyncPanel
          visual={buildVisual({ sourceText: undefined })}
          currentSourceText={undefined}
          stale={false}
          syncStatus="idle"
          syncError={null}
          onSync={noop}
        />,
      );
      try {
        assert.match(
          textOf(renderer.root),
          /No source text is associated with this visual/,
        );
        const syncButton = renderer.root.find(
          (node) =>
            node.type === "button" && textOf(node).includes("Sync to text"),
        );
        assert.equal(syncButton.props.disabled, true);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("currentSourceText alone (no visual.sourceText) is enough to satisfy hasSource and enable Sync", () => {
    withPortalDom(() => {
      const renderer = mountWithPortalDom(
        <VisualSyncPanel
          visual={buildVisual({ sourceText: undefined })}
          currentSourceText="Fresh paragraph text"
          stale={false}
          syncStatus="idle"
          syncError={null}
          onSync={noop}
        />,
      );
      try {
        assert.doesNotMatch(
          textOf(renderer.root),
          /No source text is associated/,
        );
        const syncButton = renderer.root.find(
          (node) =>
            node.type === "button" && textOf(node).includes("Sync to text"),
        );
        assert.equal(syncButton.props.disabled, false);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("loading shows the generating indicator and disables Sync; clicking Sync (while enabled) calls onSync", () => {
    withPortalDom(() => {
      let synced = 0;
      const renderer = mountWithPortalDom(
        <VisualSyncPanel
          visual={buildVisual({ sourceText: "Some source" })}
          stale={false}
          syncStatus="loading"
          syncError={null}
          onSync={() => {
            synced += 1;
          }}
        />,
      );
      try {
        assert.match(textOf(renderer.root), /Analysing/);
        const syncButton = renderer.root.find(
          (node) =>
            node.type === "button" && textOf(node).includes("Sync to text"),
        );
        assert.equal(syncButton.props.disabled, true);
      } finally {
        act(() => renderer.unmount());
      }
      assert.equal(synced, 0);
    });
  });

  test("a sync error shows an alert with a Try again button that calls onSync", () => {
    withPortalDom(() => {
      let synced = 0;
      const renderer = mountWithPortalDom(
        <VisualSyncPanel
          visual={buildVisual({ sourceText: "Some source" })}
          stale
          syncStatus="idle"
          syncError="Sync failed."
          onSync={() => {
            synced += 1;
          }}
        />,
      );
      try {
        const alert = renderer.root.findByProps({ role: "alert" });
        assert.match(textOf(alert), /Sync failed\./);
        const retry = alert.find(
          (node) =>
            node.type === "button" && textOf(node).trim() === "Try again",
        );
        act(() => {
          (retry.props.onClick as () => void)();
        });
      } finally {
        act(() => renderer.unmount());
      }
      assert.equal(synced, 1);
    });
  });
});

describe("VisualInfoPanel", () => {
  test("renders the computed kind label, node/edge counts, and title", () => {
    withPortalDom(() => {
      const visual = buildVisual({
        type: "mindmap",
        title: "Launch plan",
        nodes: [
          buildVisualNode({ id: "a", label: "Root" }),
          buildVisualNode({ id: "b", label: "Child", x: 300 }),
          buildVisualNode({ id: "c", label: "Child 2", x: 500 }),
        ],
        edges: [],
      });
      const renderer = mountWithPortalDom(
        <VisualInfoPanel visual={visual} stale={false} />,
      );
      try {
        const text = textOf(renderer.root);
        assert.match(text, /Mind map/);
        assert.match(text, /Launch plan/);
        assert.doesNotMatch(text, /Source text has changed/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });

  test("shows the stale indicator when stale is true", () => {
    withPortalDom(() => {
      const renderer = mountWithPortalDom(
        <VisualInfoPanel visual={buildVisual()} stale />,
      );
      try {
        assert.match(textOf(renderer.root), /Source text has changed/);
      } finally {
        act(() => renderer.unmount());
      }
    });
  });
});

describe("VisualVariationsPanel", () => {
  test("delegates to GeneratedCandidatesPanel with its own empty-state copy and wires callbacks through", () => {
    withPortalDom(() => {
      let generated = 0;
      const chosen: unknown[] = [];
      const renderer = mountWithPortalDom(
        <VisualVariationsPanel
          candidates={[]}
          genStatus="idle"
          genError={null}
          onGenerate={() => {
            generated += 1;
          }}
          onChooseCandidate={(candidate) => chosen.push(candidate)}
        />,
      );
      try {
        assert.match(
          textOf(renderer.root),
          /Use the AI button in the toolbar to generate variations\./,
        );
      } finally {
        act(() => renderer.unmount());
      }
      assert.equal(generated, 0);
      assert.equal(chosen.length, 0);
    });
  });

  test("passes a generation error + creditError through to the underlying panel, and onGenerate doubles as the retry handler", () => {
    withPortalDom(() => {
      let generated = 0;
      const renderer = mountWithPortalDom(
        <VisualVariationsPanel
          candidates={[]}
          genStatus="idle"
          genError="Out of credits."
          creditError
          onGenerate={() => {
            generated += 1;
          }}
          onChooseCandidate={noop}
        />,
      );
      try {
        const alert = renderer.root.findByProps({ role: "alert" });
        assert.match(textOf(alert), /Out of credits\./);
        const upgrade = renderer.root.findByType("a");
        assert.equal(upgrade.props.href, "/app/settings/billing");
      } finally {
        act(() => renderer.unmount());
      }
      assert.equal(generated, 0);
    });
  });
});
