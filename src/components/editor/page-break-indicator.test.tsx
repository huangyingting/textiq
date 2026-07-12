/**
 * Direct contract coverage for `PageBreakIndicator` (issue #1933).
 *
 * `computePageBreaks`/`PAGE_SIZE_DIMENSIONS` are pure and already exhaustively
 * tested in `src/lib/visual/frame-settings.test.ts`, so this file focuses on
 * the component's own wiring: measuring `contentRef.current.scrollHeight` on
 * mount, observing it for resize, re-measuring when the observed element (or
 * `pageSize`) changes, disconnecting the observer on unmount, and rendering
 * the correct label/width text (or `null` when there are no breaks).
 *
 * A minimal fake `ResizeObserver` global stands in for the browser API so the
 * component can be mounted with plain `react-test-renderer` (no `document`).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import "@/test/react-render-harness";

import { PageBreakIndicator } from "./page-break-indicator";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: () => void;
  observed: unknown[] = [];
  disconnected = false;
  constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(target: unknown) {
    this.observed.push(target);
  }
  disconnect() {
    this.disconnected = true;
  }
  unobserve() {}
  trigger() {
    this.callback();
  }
}

function installFakeResizeObserver(): () => void {
  FakeResizeObserver.instances = [];
  const original = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    FakeResizeObserver;
  return () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = original;
  };
}

function makeContentRef(scrollHeight: number) {
  const el: { scrollHeight: number } = { scrollHeight };
  return { current: el as unknown as HTMLElement, el };
}

describe("PageBreakIndicator", () => {
  test("renders nothing when the content ref is not yet attached", () => {
    const restore = installFakeResizeObserver();
    let renderer!: ReactTestRenderer;
    try {
      act(() => {
        renderer = create(
          <PageBreakIndicator contentRef={{ current: null }} pageSize="a4" />,
        );
      });
      assert.equal(renderer.toJSON(), null);
      assert.equal(FakeResizeObserver.instances.length, 0);
    } finally {
      act(() => renderer.unmount());
      restore();
    }
  });

  test("renders nothing when the content is shorter than one page", () => {
    const restore = installFakeResizeObserver();
    let renderer!: ReactTestRenderer;
    try {
      act(() => {
        renderer = create(
          <PageBreakIndicator contentRef={makeContentRef(500)} pageSize="a4" />,
        );
      });
      assert.equal(renderer.toJSON(), null);
    } finally {
      act(() => renderer.unmount());
      restore();
    }
  });

  test("measures on mount, observes the element, and renders one indicator per break with the right label/width", () => {
    const restore = installFakeResizeObserver();
    let renderer!: ReactTestRenderer;
    const contentRef = makeContentRef(2500);
    try {
      act(() => {
        renderer = create(
          <PageBreakIndicator contentRef={contentRef} pageSize="a4" />,
        );
      });
      assert.equal(FakeResizeObserver.instances.length, 1);
      const observer = FakeResizeObserver.instances[0];
      assert.deepEqual(observer.observed, [contentRef.current]);

      const indicators = renderer.root.findAllByProps({
        "aria-hidden": "true",
      });
      assert.equal(indicators.length, 2);
      assert.equal(indicators[0].props.style.top, 1123);
      assert.equal(indicators[1].props.style.top, 2246);
      const label = renderer.root.findAllByType("span")[0];
      assert.equal(label.props.children.join(""), "A4 · 794px");
    } finally {
      act(() => renderer.unmount());
      restore();
    }
  });

  test("renders the 16:9 slide label with the widescreen pixel width", () => {
    const restore = installFakeResizeObserver();
    let renderer!: ReactTestRenderer;
    try {
      act(() => {
        renderer = create(
          <PageBreakIndicator
            contentRef={makeContentRef(1500)}
            pageSize="16:9"
          />,
        );
      });
      const label = renderer.root.findAllByType("span")[0];
      assert.equal(label.props.children.join(""), "16:9 slide · 1280px");
    } finally {
      act(() => renderer.unmount());
      restore();
    }
  });

  test("re-measures when the ResizeObserver callback fires with a new scrollHeight", () => {
    const restore = installFakeResizeObserver();
    let renderer!: ReactTestRenderer;
    const contentRef = makeContentRef(500);
    try {
      act(() => {
        renderer = create(
          <PageBreakIndicator contentRef={contentRef} pageSize="letter" />,
        );
      });
      assert.equal(renderer.toJSON(), null);

      contentRef.el.scrollHeight = 3000;
      act(() => {
        FakeResizeObserver.instances[0].trigger();
      });
      const indicators = renderer.root.findAllByProps({
        "aria-hidden": "true",
      });
      // letter heightPx = 1056: breaks at 1056 and 2112.
      assert.equal(indicators.length, 2);
      assert.equal(indicators[0].props.style.top, 1056);
      assert.equal(indicators[1].props.style.top, 2112);
    } finally {
      act(() => renderer.unmount());
      restore();
    }
  });

  test("disconnects the previous observer and re-observes when contentRef/pageSize props change", () => {
    const restore = installFakeResizeObserver();
    let renderer!: ReactTestRenderer;
    const firstRef = makeContentRef(2000);
    const secondRef = makeContentRef(4000);
    try {
      act(() => {
        renderer = create(
          <PageBreakIndicator contentRef={firstRef} pageSize="a4" />,
        );
      });
      const firstObserver = FakeResizeObserver.instances[0];
      assert.equal(firstObserver.disconnected, false);

      act(() => {
        renderer.update(
          <PageBreakIndicator contentRef={secondRef} pageSize="a4" />,
        );
      });
      assert.equal(firstObserver.disconnected, true);
      assert.equal(FakeResizeObserver.instances.length, 2);
      assert.deepEqual(FakeResizeObserver.instances[1].observed, [
        secondRef.current,
      ]);
    } finally {
      act(() => renderer.unmount());
      restore();
    }
  });

  test("disconnects the observer on unmount", () => {
    const restore = installFakeResizeObserver();
    const contentRef = makeContentRef(2000);
    let renderer!: ReactTestRenderer;
    try {
      act(() => {
        renderer = create(
          <PageBreakIndicator contentRef={contentRef} pageSize="a4" />,
        );
      });
      const observer = FakeResizeObserver.instances[0];
      act(() => renderer.unmount());
      assert.equal(observer.disconnected, true);
    } finally {
      restore();
    }
  });
});
