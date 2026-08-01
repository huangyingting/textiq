/**
 * Direct contract coverage for `Skeleton`/`LoadingRegion`
 * (`src/components/ui/skeleton.tsx`, #1965).
 *
 * Both primitives are already loaded transitively — `src/app/app/loading.test.tsx`
 * batch-mounts the seven route-level loading boundaries and asserts on the
 * `LoadingRegion`/`Skeleton` instances found inside them via `findAllByType` —
 * but that coverage is necessarily indirect: it only ever exercises the
 * *default* `label` and whatever `className`/props each boundary happens to
 * pass. This file imports `skeleton.tsx` directly and asserts its own
 * contract in isolation: `Skeleton`'s className merge + arbitrary DOM
 * attribute forwarding, and `LoadingRegion`'s accessibility surface
 * (`role="status"`, `aria-busy="true"`, the visually-hidden announcement,
 * custom vs. default `label`, and children passthrough) — including the
 * `{...props}` spread's override of the computed `aria-label`/`className`
 * when a caller supplies its own, which no existing test exercises.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { create, act } from "react-test-renderer";

import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function mount(element: Parameters<typeof createElement>[0], props?: object) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(element, props));
  });
  return renderer;
}

test("Skeleton merges a caller className onto the default pulse/radius/surface classes rather than replacing them", () => {
  const renderer = mount(Skeleton, { className: "h-4 w-24" });
  const div = renderer.root.findByType("div");
  const className = div.props.className as string;
  assert.match(className, /animate-pulse/);
  assert.match(className, /motion-reduce:animate-none/);
  assert.match(className, /rounded-\[var\(--ds-radius-sm,8px\)\]/);
  assert.match(className, /bg-\[var\(--ds-surface-raised,#f3f4f6\)\]/);
  assert.match(className, /h-4 w-24/);
});

test("Skeleton renders with only its default classes when no className is passed", () => {
  const renderer = mount(Skeleton, {});
  const div = renderer.root.findByType("div");
  assert.equal(
    div.props.className,
    "animate-pulse rounded-[var(--ds-radius-sm,8px)] bg-[var(--ds-surface-raised,#f3f4f6)] motion-reduce:animate-none",
  );
});

test("Skeleton forwards arbitrary HTML attributes (data-testid, aria-hidden) to the underlying div", () => {
  const renderer = mount(Skeleton, {
    "data-testid": "thumbnail-skeleton",
    "aria-hidden": "true",
  });
  const div = renderer.root.findByType("div");
  assert.equal(div.props["data-testid"], "thumbnail-skeleton");
  assert.equal(div.props["aria-hidden"], "true");
});

test("LoadingRegion defaults to role=status, aria-busy=true, and a 'Loading…' announcement when no label is given", () => {
  const renderer = mount(LoadingRegion, {
    children: createElement(Skeleton, { className: "h-4" }),
  });
  const region = renderer.root.findByType("div");
  assert.equal(region.props.role, "status");
  assert.equal(region.props["aria-busy"], "true");
  assert.equal(region.props["aria-label"], "Loading…");
  const srOnly = renderer.root.findByProps({ className: "sr-only" });
  assert.equal(srOnly.props.className, "sr-only");
});

test("LoadingRegion uses a custom label for both the aria-label and the visually-hidden text", () => {
  const renderer = mount(LoadingRegion, {
    label: "Loading brand assets…",
  });
  const region = renderer.root.findByType("div");
  assert.equal(region.props["aria-label"], "Loading brand assets…");
  const srOnlySpan = renderer.root.findByProps({ className: "sr-only" });
  assert.equal(srOnlySpan.children[0], "Loading brand assets…");
});

test("LoadingRegion renders its children after the sr-only announcement, and forwards the className prop", () => {
  const renderer = mount(LoadingRegion, {
    className: "flex flex-col gap-2",
    children: [
      createElement(Skeleton, { key: "a", className: "h-4" }),
      createElement(Skeleton, { key: "b", className: "h-4" }),
    ],
  });
  const region = renderer.root.findByType("div");
  assert.equal(region.props.className, "flex flex-col gap-2");
  const skeletons = renderer.root.findAllByType(Skeleton);
  assert.equal(skeletons.length, 2);
});

test("LoadingRegion keeps its status, busy state, and accessible label authoritative and synchronized", () => {
  const renderer = mount(LoadingRegion, {
    label: "Loading brand assets…",
    role: "alert",
    "aria-busy": "false",
    "aria-label": "Conflicting override",
  } as Record<string, unknown>);
  const region = renderer.root.findByType("div");
  assert.equal(region.props.role, "status");
  assert.equal(region.props["aria-busy"], "true");
  assert.equal(region.props["aria-label"], "Loading brand assets…");
  const srOnlySpan = renderer.root.findByProps({ className: "sr-only" });
  assert.equal(srOnlySpan.children[0], "Loading brand assets…");
});
