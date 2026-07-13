/**
 * Direct render coverage for the App Router root error boundary
 * (`error.tsx`) (#1948).
 *
 * `Error` is a plain "use client" component with no server-only imports and
 * no async loader, so it mounts directly through `react-test-renderer`
 * (`act`/`create`), the same low-level pattern
 * `document-export-button.test.tsx` uses; `@/test/react-render-harness` is
 * imported for its side effect of flipping `IS_REACT_ACT_ENVIRONMENT` on and
 * quieting the `react-test-renderer is deprecated` warning.
 *
 * `next/link`'s `<Link>` (the "Go home" recovery action) mounts a
 * `useIntersection` effect that calls the browser-only `self.setTimeout`
 * (via `requestIdleCallback`); `globalThis.self` is polyfilled to
 * `globalThis` for the duration of this suite so that effect resolves against
 * Node's real `setTimeout` instead of throwing `ReferenceError: self is not
 * defined`.
 *
 * Coverage here: the fallback heading/copy, the digest line's
 * present/absent branches, the "Try again" button invoking `reset()`, the
 * "Go home" link's href, and the `useEffect(() => console.error(error))`
 * diagnostic side effect.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import "@/test/react-render-harness";

import ErrorBoundary from "./error";

// Cast to a plain string-indexed record (rather than `typeof globalThis &
// { self?: unknown }`) so this assignment doesn't get merged with lib.dom's
// existing `self: Window & typeof globalThis` declaration, which would
// otherwise reject the plain `globalThis` value assigned below.
const globalForSelf = globalThis as unknown as Record<string, unknown>;
let hadSelf = false;
let previousSelf: unknown;

before(() => {
  hadSelf = "self" in globalForSelf;
  previousSelf = globalForSelf.self;
  globalForSelf.self = globalThis;
});

after(() => {
  if (hadSelf) {
    globalForSelf.self = previousSelf;
  } else {
    delete globalForSelf.self;
  }
});

function renderError(
  error: Error & { digest?: string },
  reset: () => void,
): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<ErrorBoundary error={error} reset={reset} />);
  });
  return renderer;
}

function unmount(renderer: ReactTestRenderer): void {
  act(() => {
    renderer.unmount();
  });
}

describe("Error", () => {
  test("renders the fallback heading and recovery copy", () => {
    const renderer = renderError(new Error("boom"), () => {});
    try {
      const heading = renderer.root.findByType("h1");
      assert.equal(heading.children.join(""), "Something went wrong");
      const body = renderer.root.findAllByType("p")[0];
      assert.match(
        body.children.join(""),
        /An unexpected error occurred\. You can try again/,
      );
    } finally {
      unmount(renderer);
    }
  });

  test("shows the error digest when present", () => {
    const error = Object.assign(new Error("boom"), { digest: "abc123" });
    const renderer = renderError(error, () => {});
    try {
      const digestParagraphs = renderer.root
        .findAllByType("p")
        .filter((instance) => instance.children.join("").includes("Error ID:"));
      assert.equal(digestParagraphs.length, 1);
      assert.match(digestParagraphs[0].children.join(""), /Error ID: abc123/);
    } finally {
      unmount(renderer);
    }
  });

  test("omits the digest paragraph when absent", () => {
    const renderer = renderError(new Error("boom"), () => {});
    try {
      const digestParagraphs = renderer.root
        .findAllByType("p")
        .filter((instance) => instance.children.join("").includes("Error ID:"));
      assert.equal(digestParagraphs.length, 0);
    } finally {
      unmount(renderer);
    }
  });

  test("clicking 'Try again' invokes reset()", () => {
    let resetCalls = 0;
    const renderer = renderError(new Error("boom"), () => {
      resetCalls += 1;
    });
    try {
      const button = renderer.root.findByType("button");
      assert.equal(button.children.join(""), "Try again");
      act(() => {
        button.props.onClick();
      });
      assert.equal(resetCalls, 1);
    } finally {
      unmount(renderer);
    }
  });

  test("'Go home' links back to the root path", () => {
    const renderer = renderError(new Error("boom"), () => {});
    try {
      const anchor = renderer.root.findByType("a");
      assert.equal(anchor.props.href, "/");
      assert.equal(anchor.children.join(""), "Go home");
    } finally {
      unmount(renderer);
    }
  });

  test("logs the thrown error to console.error on mount", () => {
    const seen: unknown[][] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      // Filter the same `react-test-renderer is deprecated` notice
      // `@/test/react-render-harness` normally swallows — this test
      // temporarily replaces that wrapper to capture calls directly.
      if (
        typeof args[0] === "string" &&
        args[0].startsWith("react-test-renderer is deprecated")
      ) {
        return;
      }
      seen.push(args);
    };
    const error = new Error("boom-log");
    let renderer!: ReactTestRenderer;
    try {
      renderer = renderError(error, () => {});
    } finally {
      console.error = originalConsoleError;
    }
    try {
      assert.equal(seen.length, 1);
      assert.equal(seen[0][0], error);
    } finally {
      unmount(renderer);
    }
  });
});
