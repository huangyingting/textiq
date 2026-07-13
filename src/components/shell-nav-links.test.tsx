/**
 * Direct contract coverage for `ShellNavLinks`
 * (`src/components/shell-nav-links.tsx`, #1965) — the shared nav-item
 * renderer used by `SiteHeaderView` for its desktop/mobile-drawer/
 * mobile-inline nav lists.
 *
 * Nothing imports this file in any test today, so its only prior coverage
 * was incidental (rendered — never asserted on — inside whatever consumed
 * `SiteHeaderView`). This file mounts the real component with real
 * `ShellNavItem`/`ShellChromeVariant` values and asserts: one `<Link>` per
 * item (in order, keyed/hrefed correctly), the emphasis→chrome className
 * mapping (`primary` vs. default) *per variant* (via the real
 * `SHELL_NAV_ITEM_CHROME` table, not a re-derived copy of it), and the
 * empty-list case.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

// Imported for its module-level side effect only, and *before* `next/link`
// below: it polyfills a no-op `IntersectionObserver` before `next/link`'s
// `use-intersection` module evaluates its `hasIntersectionObserver` constant
// (computed once, at that module's first import), which otherwise falls
// back to a `requestIdleCallback` shim that references the browser-only
// `self` global (absent under Node) the moment the prefetch effect runs.
import "@/test/portal-dom";
import Link from "next/link";

import { ShellNavLinks } from "@/components/shell-nav-links";
import { SHELL_NAV_ITEM_CHROME } from "@/lib/app-shell/chrome";
import type { ShellNavItem } from "@/lib/app-shell/navigation";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS: ShellNavItem[] = [
  { id: "documents", href: "/app", label: "Documents", emphasis: "default" },
  {
    id: "workspaces",
    href: "/app/workspaces",
    label: "Workspaces",
    emphasis: "default",
  },
  { id: "signup", href: "/signup", label: "Sign up", emphasis: "primary" },
];

function mount(
  items: ShellNavItem[],
  variant: "desktop" | "mobileDrawer" | "mobileInline",
) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(ShellNavLinks, { items, variant }));
  });
  return renderer;
}

test("renders exactly one Link per item, in the given order, with matching href and label text", () => {
  const renderer = mount(ITEMS, "desktop");
  const links = renderer.root.findAllByType(Link);
  assert.equal(links.length, 3);
  assert.deepEqual(
    links.map((link) => link.props.href),
    ["/app", "/app/workspaces", "/signup"],
  );
  assert.deepEqual(
    links.map((link) => link.props.children),
    ["Documents", "Workspaces", "Sign up"],
  );
});

test("desktop variant: default-emphasis items get SHELL_NAV_ITEM_CHROME.desktop.default, primary gets .primary", () => {
  const renderer = mount(ITEMS, "desktop");
  const links = renderer.root.findAllByType(Link);
  assert.equal(links[0].props.className, SHELL_NAV_ITEM_CHROME.desktop.default);
  assert.equal(links[1].props.className, SHELL_NAV_ITEM_CHROME.desktop.default);
  assert.equal(links[2].props.className, SHELL_NAV_ITEM_CHROME.desktop.primary);
  assert.notEqual(
    SHELL_NAV_ITEM_CHROME.desktop.default,
    SHELL_NAV_ITEM_CHROME.desktop.primary,
    "fixture assumption: desktop default/primary chrome classes must differ",
  );
});

test("mobileDrawer variant maps to SHELL_NAV_ITEM_CHROME.mobileDrawer classes (distinct from desktop's)", () => {
  const renderer = mount(ITEMS, "mobileDrawer");
  const links = renderer.root.findAllByType(Link);
  assert.equal(
    links[0].props.className,
    SHELL_NAV_ITEM_CHROME.mobileDrawer.default,
  );
  assert.equal(
    links[2].props.className,
    SHELL_NAV_ITEM_CHROME.mobileDrawer.primary,
  );
  assert.notEqual(
    links[0].props.className,
    SHELL_NAV_ITEM_CHROME.desktop.default,
  );
});

test("mobileInline variant maps to SHELL_NAV_ITEM_CHROME.mobileInline classes", () => {
  const renderer = mount(ITEMS, "mobileInline");
  const links = renderer.root.findAllByType(Link);
  assert.equal(
    links[0].props.className,
    SHELL_NAV_ITEM_CHROME.mobileInline.default,
  );
  assert.equal(
    links[2].props.className,
    SHELL_NAV_ITEM_CHROME.mobileInline.primary,
  );
});

test("renders no links at all for an empty items array", () => {
  const renderer = mount([], "desktop");
  const links = renderer.root.findAllByType(Link);
  assert.equal(links.length, 0);
});
