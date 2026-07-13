/**
 * Direct, batch-rendered contracts for the seven route-level loading
 * boundaries under `src/app/app/**` (#1949): `app/loading.tsx` (dashboard),
 * `documents/[id]/loading.tsx` (editor), `brands/loading.tsx`,
 * `settings/loading.tsx`, `settings/billing/loading.tsx`,
 * `workspaces/loading.tsx`, and `workspaces/[id]/loading.tsx`.
 *
 * Every one of these is a plain server-renderable function component built
 * from the shared `LoadingRegion`/`Skeleton` primitives
 * (`src/components/ui/skeleton.tsx`) — no hooks, no effects, no DOM/window
 * access — so each is mounted directly with `react-test-renderer`'s `create`
 * (no `act`/harness needed).
 *
 * Assertions are structural, not string/class snapshots: `findAllByType` is
 * used to find the actual `LoadingRegion`/`Skeleton` component instances in
 * the rendered tree (immune to Tailwind class-name changes), and behavior is
 * asserted against real component props/DOM-like attributes
 * (`role`, `aria-busy`, `aria-label`) rather than re-asserting a copy of the
 * JSX. Distinctness of the seven `aria-label`s is checked across all of them
 * together, which is why this file batch-renders every boundary rather than
 * testing each in isolation.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, type ComponentType } from "react";
import { act, create, type ReactTestInstance } from "react-test-renderer";

// Imported for its module-level side effect only: it flips
// `IS_REACT_ACT_ENVIRONMENT` on, which `act()` requires.
import "@/test/react-render-harness";

import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";

import DashboardLoading from "@/app/app/loading";
import EditorLoading from "@/app/app/documents/[id]/loading";
import BrandsLoading from "@/app/app/brands/loading";
import SettingsLoading from "@/app/app/settings/loading";
import BillingLoading from "@/app/app/settings/billing/loading";
import WorkspacesLoading from "@/app/app/workspaces/loading";
import WorkspaceDetailLoading from "@/app/app/workspaces/[id]/loading";

type LoadingBoundary = {
  /** Human-readable identifier used only in assertion failure messages. */
  name: string;
  Component: ComponentType;
  /** A conservative floor — well under the current real count — so this
   * stays robust to minor content tweaks while still catching a boundary
   * that regresses to an empty/near-empty skeleton. */
  minSkeletons: number;
};

const BOUNDARIES: LoadingBoundary[] = [
  { name: "dashboard", Component: DashboardLoading, minSkeletons: 8 },
  { name: "editor", Component: EditorLoading, minSkeletons: 8 },
  { name: "brands", Component: BrandsLoading, minSkeletons: 6 },
  { name: "settings", Component: SettingsLoading, minSkeletons: 6 },
  { name: "billing", Component: BillingLoading, minSkeletons: 8 },
  { name: "workspaces", Component: WorkspacesLoading, minSkeletons: 6 },
  {
    name: "workspace-detail",
    Component: WorkspaceDetailLoading,
    minSkeletons: 8,
  },
];

function renderBoundary(Component: ComponentType) {
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(createElement(Component));
  });
  if (!renderer) throw new Error("renderer was never created");
  return renderer.root;
}

/**
 * Recursively checks whether `text` appears as a rendered text node anywhere
 * under `instance` — used to confirm the visually-hidden screen-reader
 * announcement without coupling the assertion to any particular class name.
 */
function containsText(instance: ReactTestInstance, text: string): boolean {
  return instance.children.some((child) =>
    typeof child === "string" ? child === text : containsText(child, text),
  );
}

// ---------------------------------------------------------------------------
// Distinct accessible LoadingRegion labels — checked across all seven at once
// ---------------------------------------------------------------------------

test("every loading boundary renders exactly one LoadingRegion with a distinct, non-empty label", () => {
  const labels = BOUNDARIES.map(({ name, Component }) => {
    const root = renderBoundary(Component);
    const regions = root.findAllByType(LoadingRegion);
    assert.equal(
      regions.length,
      1,
      `${name}: expected exactly one LoadingRegion`,
    );
    const label = regions[0]?.props.label as string | undefined;
    assert.ok(
      typeof label === "string" && label.trim().length > 0,
      `${name}: expected a non-empty label`,
    );
    return label as string;
  });

  assert.equal(
    new Set(labels).size,
    BOUNDARIES.length,
    `expected all ${BOUNDARIES.length} loading boundaries to have distinct labels, got: ${labels.join(", ")}`,
  );
});

// ---------------------------------------------------------------------------
// role="status" / aria-busy / aria-label semantics
// ---------------------------------------------------------------------------

test("every loading boundary's LoadingRegion exposes role=status, aria-busy=true, and a matching aria-label", () => {
  for (const { name, Component } of BOUNDARIES) {
    const root = renderBoundary(Component);
    const statusNodes = root.findAllByProps({ role: "status" });
    assert.equal(
      statusNodes.length,
      1,
      `${name}: expected exactly one role="status" node`,
    );

    const [status] = statusNodes;
    assert.equal(status?.props["aria-busy"], "true", `${name}: aria-busy`);
    assert.equal(
      typeof status?.props["aria-label"],
      "string",
      `${name}: aria-label should be a string`,
    );
    assert.ok(
      (status?.props["aria-label"] as string).length > 0,
      `${name}: aria-label should be non-empty`,
    );

    // The visually-hidden announcement text mirrors the label so
    // screen-reader users hear the same copy sighted users would if the
    // label were visible — checked structurally (a real rendered text
    // node), not by matching any particular class name.
    assert.ok(
      containsText(status as ReactTestInstance, status?.props["aria-label"]),
      `${name}: expected a rendered text node matching the aria-label`,
    );
  }
});

// ---------------------------------------------------------------------------
// Meaningful skeleton structure (not brittle exact counts / class snapshots)
// ---------------------------------------------------------------------------

test("every loading boundary renders a meaningful number of Skeleton placeholders", () => {
  for (const { name, Component, minSkeletons } of BOUNDARIES) {
    const root = renderBoundary(Component);
    const skeletons = root.findAllByType(Skeleton);
    assert.ok(
      skeletons.length >= minSkeletons,
      `${name}: expected at least ${minSkeletons} Skeleton placeholders, found ${skeletons.length}`,
    );
  }
});

test("each loading boundary's default export is a distinct component", () => {
  const uniqueComponents = new Set(
    BOUNDARIES.map(({ Component }) => Component),
  );
  assert.equal(
    uniqueComponents.size,
    BOUNDARIES.length,
    "expected each route's loading.tsx to export its own component, not a shared/aliased one",
  );
});
