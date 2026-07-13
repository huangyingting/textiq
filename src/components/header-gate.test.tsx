/**
 * Direct behavior coverage for `HeaderGate` (#1964) — the client wrapper that
 * hides the global app shell (`SiteHeader`) on embed/present routes and the
 * full-bleed slide editor.
 *
 * `shouldRenderAppHeader` (the actual route-matching logic) is already
 * exhaustively covered by `src/lib/app-shell/header-gate.test.ts`; this file
 * only asserts `HeaderGate` wires `usePathname()` into that pure function
 * correctly and mounts/withholds `children` accordingly. `next/navigation` is
 * stubbed via the shared `@/test/module-stub` helper (same pattern as
 * `document-list.test.tsx`) so each render just reads whatever pathname the
 * test last set, rather than requiring a real Next.js router. No
 * `document`/`window` fake is needed — `HeaderGate` renders no DOM of its own
 * and touches no browser API.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createElement, type ReactNode } from "react";

import { stubModule } from "@/test/module-stub";

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [message] = args;
  if (
    typeof message === "string" &&
    message.startsWith("react-test-renderer is deprecated")
  ) {
    return;
  }
  originalConsoleError(...args);
};
after(() => {
  console.error = originalConsoleError;
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const globalForNav = globalThis as typeof globalThis & {
  __headerGateNavState: { pathname: string | null };
};
globalForNav.__headerGateNavState = { pathname: "/app" };

stubModule(
  "next/navigation",
  `module.exports = {
  usePathname: () => globalThis.__headerGateNavState.pathname,
};`,
);

function setPathname(pathname: string | null): void {
  globalForNav.__headerGateNavState.pathname = pathname;
}

// Dynamically imported after the `stubModule` call above: a static import
// would resolve the whole module graph (including `next/navigation`) before
// this file's own top-level statements run.
let HeaderGate: typeof import("./header-gate").HeaderGate;
before(async () => {
  HeaderGate = (await import("./header-gate")).HeaderGate;
});

beforeEach(() => setPathname("/app"));

function mount(children: ReactNode): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(HeaderGate, null, children));
  });
  return renderer;
}

describe("HeaderGate", () => {
  test("renders children on an ordinary app route", () => {
    setPathname("/app");
    const renderer = mount("header content");
    try {
      assert.equal(renderer.toJSON(), "header content");
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("renders null on an /embed route", () => {
    setPathname("/embed/abc123");
    const renderer = mount("header content");
    try {
      assert.equal(renderer.toJSON(), null);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("renders null on a /present route", () => {
    setPathname("/present/abc123");
    const renderer = mount("header content");
    try {
      assert.equal(renderer.toJSON(), null);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("renders null on the full-bleed slide editor route", () => {
    setPathname("/app/documents/doc-1/slides");
    const renderer = mount("header content");
    try {
      assert.equal(renderer.toJSON(), null);
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("renders children on a nested slide-editor sub-path that isn't the bare editor route", () => {
    // Only `/app/documents/[id]/slides(/...)` is suppressed; a sibling
    // detail route like `/app/documents/doc-1/comments` keeps the header.
    setPathname("/app/documents/doc-1/comments");
    const renderer = mount("header content");
    try {
      assert.equal(renderer.toJSON(), "header content");
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("renders children when usePathname returns null (matches shouldRenderAppHeader's null-safe default)", () => {
    setPathname(null);
    const renderer = mount("header content");
    try {
      assert.equal(renderer.toJSON(), "header content");
    } finally {
      act(() => renderer.unmount());
    }
  });

  test("re-renders reactively when the pathname changes between renders", () => {
    setPathname("/app");
    const renderer = mount("header content");
    try {
      assert.equal(renderer.toJSON(), "header content");
      setPathname("/embed/xyz");
      act(() => {
        renderer.update(createElement(HeaderGate, null, "header content"));
      });
      assert.equal(renderer.toJSON(), null);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
