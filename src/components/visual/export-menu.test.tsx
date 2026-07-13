/**
 * Direct contract coverage for `ExportMenu`
 * (`src/components/visual/export-menu.tsx`, #1965) — the toolbar trigger
 * that opens the advanced export dialog: open/close state, the disabled
 * (`aria-haspopup="dialog"`) trigger button, and the options bridge that
 * forwards `getSvgElement`/`getVisual`/`filename` plus the fetched plan
 * entitlements through to `ExportDialog` unchanged.
 *
 * Nothing imports `export-menu.tsx` in any test today — its two production
 * consumers (`document-export-button.tsx`,
 * `visual-context-popover-panels.tsx`) have no test files of their own
 * either, so this is `ExportMenu`'s first direct coverage of any kind.
 *
 * `ExportDialog` (heavy: framer-motion, a live SVG/PPTX export pipeline) and
 * `useUserEntitlements` (a `fetch`-backed hook) are both out of scope for
 * this file's own contract — *which* props `ExportMenu` computes and passes
 * down, not what `ExportDialog` does with them — so both are stubbed via
 * `@/test/module-stub`. The stub entitlements hook is driven by mutable
 * test state so a single test file can assert the *same* returned object is
 * forwarded to `ExportDialog` on every render (the "options bridge").
 * `ToolbarButton` (`@/components/ui`) is used for real: it's a plain,
 * effect-free intrinsic-button wrapper.
 */
import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";
import { act, create } from "react-test-renderer";
import { createElement } from "react";

import { stubModule } from "@/test/module-stub";
import type { PlanEntitlements } from "@/lib/billing/catalog";
import type { Visual } from "@/lib/visual/schema";

type ExportMenuTestState = {
  entitlements: PlanEntitlements;
  exportDialogProps: Array<Record<string, unknown>>;
};

declare global {
  var __exportMenuTestState: ExportMenuTestState | undefined;
}

const FREE_ENTITLEMENTS: PlanEntitlements = {
  creditsPerPeriod: 30,
  periodDays: 7,
  svgExport: false,
  pptxExport: false,
  brandStyles: false,
  removeWatermark: false,
  fontUpload: false,
};

function resetState(entitlements: PlanEntitlements = FREE_ENTITLEMENTS): void {
  globalThis.__exportMenuTestState = {
    entitlements,
    exportDialogProps: [],
  };
}
resetState();

stubModule(
  "@/lib/billing/use-user-entitlements",
  `module.exports = {
  useUserEntitlements: () => globalThis.__exportMenuTestState.entitlements,
};`,
);

stubModule(
  "@/components/visual/export-dialog",
  `const { createElement } = require("react");
module.exports = {
  ExportDialog: (props) => {
    globalThis.__exportMenuTestState.exportDialogProps.push(props);
    return createElement("div", {
      "data-stub": "export-dialog",
      "data-open": String(props.open),
    });
  },
};`,
);

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let ExportMenu: typeof import("./export-menu").ExportMenu;

before(async () => {
  ({ ExportMenu } = await import("./export-menu"));
});

beforeEach(() => {
  resetState();
});

function mountMenu(props: {
  getSvgElement: () => SVGSVGElement | null;
  getVisual?: () => Visual | null;
  filename: string;
}) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(ExportMenu, props));
  });
  return renderer;
}

test("renders a single 'Export' toolbar trigger button with dialog affordances, and the dialog starts closed", () => {
  const renderer = mountMenu({
    getSvgElement: () => null,
    filename: "my-visual",
  });
  const trigger = renderer.root.findByProps({ "aria-label": "Export visual" });
  assert.equal(trigger.props["aria-haspopup"], "dialog");
  assert.equal(trigger.props.children, "Export");

  const dialogStub = renderer.root.findByProps({
    "data-stub": "export-dialog",
  });
  assert.equal(dialogStub.props["data-open"], "false");
});

test("clicking the trigger opens the dialog (props.open becomes true)", () => {
  const renderer = mountMenu({
    getSvgElement: () => null,
    filename: "my-visual",
  });
  const trigger = renderer.root.findByProps({ "aria-label": "Export visual" });
  act(() => {
    (trigger.props.onClick as () => void)();
  });
  const dialogStub = renderer.root.findByProps({
    "data-stub": "export-dialog",
  });
  assert.equal(dialogStub.props["data-open"], "true");
});

test("the dialog's onClose callback closes the dialog again (props.open returns to false)", () => {
  const renderer = mountMenu({
    getSvgElement: () => null,
    filename: "my-visual",
  });
  const trigger = renderer.root.findByProps({ "aria-label": "Export visual" });
  act(() => {
    (trigger.props.onClick as () => void)();
  });
  const state = globalThis.__exportMenuTestState;
  assert.ok(state);
  const latestOpenProps = state.exportDialogProps.at(-1);
  act(() => {
    (latestOpenProps?.onClose as () => void)();
  });
  const dialogStub = renderer.root.findByProps({
    "data-stub": "export-dialog",
  });
  assert.equal(dialogStub.props["data-open"], "false");
});

test("forwards getSvgElement, getVisual, and filename through to ExportDialog unchanged", () => {
  const svg = {} as SVGSVGElement;
  const visual = { id: "v1" } as unknown as Visual;
  const getSvgElement = () => svg;
  const getVisual = () => visual;
  mountMenu({ getSvgElement, getVisual, filename: "quarterly-report" });

  const state = globalThis.__exportMenuTestState;
  assert.ok(state);
  const props = state.exportDialogProps.at(-1);
  assert.equal(props?.getSvgElement, getSvgElement);
  assert.equal(props?.getVisual, getVisual);
  assert.equal(props?.filename, "quarterly-report");
});

test("omitting getVisual forwards undefined to ExportDialog (image-only export)", () => {
  mountMenu({ getSvgElement: () => null, filename: "no-visual" });
  const state = globalThis.__exportMenuTestState;
  assert.ok(state);
  const props = state.exportDialogProps.at(-1);
  assert.equal(props?.getVisual, undefined);
});

test("forwards the entitlements returned by useUserEntitlements to ExportDialog (options bridge)", () => {
  const proEntitlements: PlanEntitlements = {
    creditsPerPeriod: 1000,
    periodDays: 30,
    svgExport: true,
    pptxExport: true,
    brandStyles: true,
    removeWatermark: true,
    fontUpload: true,
  };
  resetState(proEntitlements);
  mountMenu({ getSvgElement: () => null, filename: "pro-export" });

  const state = globalThis.__exportMenuTestState;
  assert.ok(state);
  const props = state.exportDialogProps.at(-1);
  assert.equal(props?.entitlements, proEntitlements);
});

test("re-renders (e.g. after opening) keep forwarding the same entitlements object reference from the hook", () => {
  const renderer = mountMenu({
    getSvgElement: () => null,
    filename: "my-visual",
  });
  const trigger = renderer.root.findByProps({ "aria-label": "Export visual" });
  act(() => {
    (trigger.props.onClick as () => void)();
  });
  const state = globalThis.__exportMenuTestState;
  assert.ok(state);
  const entitlementsSeen = state.exportDialogProps.map(
    (props) => props.entitlements,
  );
  assert.ok(entitlementsSeen.length >= 2);
  for (const seen of entitlementsSeen) {
    assert.equal(seen, FREE_ENTITLEMENTS);
  }
});
