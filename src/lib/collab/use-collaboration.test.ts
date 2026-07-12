import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";

import { createReactRenderHarness } from "@/test/react-render-harness";

import { useYText } from "./use-collaboration";

type FakeElement = {
  selectionStart: number;
  selectionEnd: number;
  ownerDocument: { activeElement: unknown };
  setSelectionRange: (start: number, end: number) => void;
};

// `useYText` only ever touches `selectionStart`/`selectionEnd`/`setSelectionRange`
// and `ownerDocument.activeElement`, so a minimal fake stands in for the real
// `HTMLTextAreaElement | HTMLInputElement` union it's typed against.
function makeElement(options: {
  focused?: boolean;
  selectionStart?: number;
  selectionEnd?: number;
}): {
  el: HTMLTextAreaElement;
  setSelectionRangeCalls: Array<[number, number]>;
} {
  const setSelectionRangeCalls: Array<[number, number]> = [];
  const el: FakeElement = {
    selectionStart: options.selectionStart ?? 0,
    selectionEnd: options.selectionEnd ?? 0,
    ownerDocument: { activeElement: null },
    setSelectionRange: (start, end) => {
      setSelectionRangeCalls.push([start, end]);
    },
  };
  el.ownerDocument.activeElement = options.focused ? el : null;
  return { el: el as unknown as HTMLTextAreaElement, setSelectionRangeCalls };
}

function textDoc(initial = ""): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc();
  const ytext = doc.getText("t");
  if (initial) {
    ytext.insert(0, initial);
  }
  return { doc, ytext };
}

// `Y.Text#_eH.l` is the live listener array behind `observe`/`unobserve` (see
// yjs's AbstractType) — used here only to assert registration/removal counts.
function observerCount(ytext: Y.Text): number {
  return (ytext as unknown as { _eH: { l: unknown[] } })._eH.l.length;
}

// ---------------------------------------------------------------------------
// useYText — lifecycle, wiring, and cleanup
// ---------------------------------------------------------------------------

test("useYText: before ready, shows the DB initial value regardless of ytext content", () => {
  const { ytext } = textDoc("from the room");
  const { el } = makeElement({});
  const harness = createReactRenderHarness();
  try {
    const result = harness.run(() =>
      useYText(ytext, {
        initial: "from the database",
        ready: false,
        editable: false,
        localOrigin: Symbol("local"),
        elementRef: { current: el },
      }),
    );
    assert.equal(result.value, "from the database");
  } finally {
    harness.cleanup();
  }
});

test("useYText: registers a Y.Text observer on mount and unobserves it on unmount", () => {
  const { ytext } = textDoc();
  const { el } = makeElement({});
  const harness = createReactRenderHarness();

  assert.equal(observerCount(ytext), 0);
  harness.run(() =>
    useYText(ytext, {
      initial: "",
      ready: true,
      editable: true,
      localOrigin: Symbol("local"),
      elementRef: { current: el },
    }),
  );
  assert.equal(observerCount(ytext), 1);

  harness.cleanup();
  assert.equal(observerCount(ytext), 0);
});

test("useYText: a remote edit (different transaction origin) updates the live value and reports nothing to onLocalChange", () => {
  const { ytext } = textDoc();
  const { el } = makeElement({});
  const localOrigin = Symbol("local");
  const localChanges: string[] = [];
  const harness = createReactRenderHarness();
  try {
    harness.run(() =>
      useYText(ytext, {
        initial: "",
        ready: true,
        editable: true,
        localOrigin,
        elementRef: { current: el },
        onLocalChange: (value) => localChanges.push(value),
      }),
    );

    ytext.doc?.transact(() => {
      ytext.insert(0, "hi");
    }, Symbol("remote"));

    const result = harness.run(() =>
      useYText(ytext, {
        initial: "",
        ready: true,
        editable: true,
        localOrigin,
        elementRef: { current: el },
        onLocalChange: (value) => localChanges.push(value),
      }),
    );
    assert.equal(result.value, "hi");
    assert.deepEqual(localChanges, []);
  } finally {
    harness.cleanup();
  }
});

test("useYText: onChange applies a minimal diff to the shared text tagged with localOrigin, and onLocalChange fires via the resulting observe event", () => {
  const { ytext } = textDoc("helo");
  const { el } = makeElement({});
  const localOrigin = Symbol("local");
  const localChanges: string[] = [];
  const origins: unknown[] = [];
  ytext.observe((_event, transaction) => origins.push(transaction.origin));
  const harness = createReactRenderHarness();
  try {
    const result = harness.run(() =>
      useYText(ytext, {
        initial: "",
        ready: true,
        editable: true,
        localOrigin,
        elementRef: { current: el },
        onLocalChange: (value) => localChanges.push(value),
      }),
    );

    result.onChange("hello");

    assert.equal(ytext.toString(), "hello");
    assert.deepEqual(localChanges, ["hello"]);
    assert.ok(origins.includes(localOrigin));
  } finally {
    harness.cleanup();
  }
});

test("useYText: onChange is a no-op while not editable", () => {
  const { ytext } = textDoc("helo");
  const { el } = makeElement({});
  const localChanges: string[] = [];
  const harness = createReactRenderHarness();
  try {
    const result = harness.run(() =>
      useYText(ytext, {
        initial: "",
        ready: true,
        editable: false,
        localOrigin: Symbol("local"),
        elementRef: { current: el },
        onLocalChange: (value) => localChanges.push(value),
      }),
    );

    result.onChange("hello");

    assert.equal(ytext.toString(), "helo");
    assert.deepEqual(localChanges, []);
  } finally {
    harness.cleanup();
  }
});

test("useYText: remote insert before a focused caret remaps the selection and restores it via setSelectionRange", () => {
  const { ytext } = textDoc("hello world");
  const { el, setSelectionRangeCalls } = makeElement({
    focused: true,
    selectionStart: 6,
    selectionEnd: 6,
  });
  const harness = createReactRenderHarness();
  try {
    harness.run(() =>
      useYText(ytext, {
        initial: "",
        ready: true,
        editable: true,
        localOrigin: Symbol("local"),
        elementRef: { current: el },
      }),
    );

    ytext.doc?.transact(() => {
      ytext.insert(0, "XY");
    }, Symbol("remote"));

    // Re-run so the layout effect that restores the caret has a chance to
    // flush against the latest render.
    harness.run(() =>
      useYText(ytext, {
        initial: "",
        ready: true,
        editable: true,
        localOrigin: Symbol("local"),
        elementRef: { current: el },
      }),
    );

    assert.deepEqual(setSelectionRangeCalls, [[8, 8]]);
  } finally {
    harness.cleanup();
  }
});

test("useYText: a remote edit while the element is not focused never restores the selection", () => {
  const { ytext } = textDoc("hello world");
  const { el, setSelectionRangeCalls } = makeElement({
    focused: false,
    selectionStart: 6,
    selectionEnd: 6,
  });
  const harness = createReactRenderHarness();
  try {
    harness.run(() =>
      useYText(ytext, {
        initial: "",
        ready: true,
        editable: true,
        localOrigin: Symbol("local"),
        elementRef: { current: el },
      }),
    );

    ytext.doc?.transact(() => {
      ytext.insert(0, "XY");
    }, Symbol("remote"));

    harness.run(() =>
      useYText(ytext, {
        initial: "",
        ready: true,
        editable: true,
        localOrigin: Symbol("local"),
        elementRef: { current: el },
      }),
    );

    assert.deepEqual(setSelectionRangeCalls, []);
  } finally {
    harness.cleanup();
  }
});

test("useYText: keeps calling the latest onLocalChange across re-renders", () => {
  const { ytext } = textDoc("helo");
  const { el } = makeElement({});
  const localOrigin = Symbol("local");
  const firstCalls: string[] = [];
  const secondCalls: string[] = [];
  const harness = createReactRenderHarness();
  try {
    harness.run(() =>
      useYText(ytext, {
        initial: "",
        ready: true,
        editable: true,
        localOrigin,
        elementRef: { current: el },
        onLocalChange: (value) => firstCalls.push(value),
      }),
    );

    const result = harness.run(() =>
      useYText(ytext, {
        initial: "",
        ready: true,
        editable: true,
        localOrigin,
        elementRef: { current: el },
        onLocalChange: (value) => secondCalls.push(value),
      }),
    );

    result.onChange("hello");

    assert.deepEqual(firstCalls, []);
    assert.deepEqual(secondCalls, ["hello"]);
  } finally {
    harness.cleanup();
  }
});
