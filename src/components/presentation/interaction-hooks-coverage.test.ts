import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as React from "react";

import {
  buildDeck,
  buildSlide,
  buildTableNode,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import {
  createReactRenderHarness,
  type ServerRenderHarnessOptions,
} from "@/test/react-render-harness";
import type { Deck, SlideChildNode } from "@/lib/presentation/schema";
import {
  createSelectionState,
  setSelection as setSelectedNodeIds,
  type SelectionState,
} from "./selection-model";
import { useFilmstripDrag } from "./filmstrip/use-filmstrip-drag";
import { useTableCellEditing } from "./use-table-cell-editing";

type Listener = (event: PointerLike) => void;

type PointerLike = {
  pointerId?: number;
  button?: number;
  clientX: number;
  clientY: number;
  preventDefault?: () => void;
};

type FakeRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type TrackedKeyboardEvent = React.KeyboardEvent<HTMLElement> & {
  calls: { prevented: number; stopped: number };
};

function createHookRenderer(options: ServerRenderHarnessOptions = {}) {
  return createReactRenderHarness({
    idPrefix: "interaction-hooks-id",
    ...options,
  });
}

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): FakeRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

class FakeFilmstripCell {
  readonly dataset: Record<string, string>;
  private readonly frame: FakeRect;
  private readonly thumbnailFrame?: FakeRect;
  capturedPointerId: number | null = null;

  constructor(index: number, frame: FakeRect, thumbnailFrame?: FakeRect) {
    this.dataset = { slideIndex: String(index) };
    this.frame = frame;
    this.thumbnailFrame = thumbnailFrame;
  }

  querySelector(
    selector: string,
  ): { getBoundingClientRect: () => FakeRect } | null {
    if (selector === '[data-thumbnail-frame="true"]' && this.thumbnailFrame) {
      const thumbnailFrame = this.thumbnailFrame;
      return { getBoundingClientRect: () => thumbnailFrame };
    }
    return null;
  }

  getBoundingClientRect(): FakeRect {
    return this.frame;
  }

  setPointerCapture(pointerId: number): void {
    this.capturedPointerId = pointerId;
  }
}

class FakeFilmstripContainer {
  scrollLeft = 50;
  attributes = new Map<string, string>();

  constructor(private readonly cells: FakeFilmstripCell[]) {}

  querySelectorAll(selector: string): FakeFilmstripCell[] {
    return selector === "[data-slide-index]" ? this.cells : [];
  }

  getBoundingClientRect(): FakeRect {
    return rect(0, 0, 240, 80);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

function withPointerWindow(
  run: (dispatch: (type: string, event: PointerLike) => void) => void,
) {
  const previousWindow = globalThis.window;
  const listeners = new Map<string, Set<Listener>>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      addEventListener: (type: string, listener: Listener) => {
        const set = listeners.get(type) ?? new Set<Listener>();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener: (type: string, listener: Listener) => {
        listeners.get(type)?.delete(listener);
      },
    },
  });

  try {
    run((type, event) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    });
  } finally {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        writable: true,
        value: previousWindow,
      });
    }
  }
}

function pointerEvent(
  currentTarget: FakeFilmstripCell,
  clientX: number,
  clientY: number,
  options: Partial<PointerLike> = {},
) {
  return reactPointerEvent({
    pointerId: 7,
    button: 0,
    clientX,
    clientY,
    currentTarget,
    preventDefault: () => undefined,
    ...options,
  });
}

function reactPointerEvent(event: unknown): React.PointerEvent<HTMLLIElement> {
  return event as unknown as React.PointerEvent<HTMLLIElement>;
}

function findNodeById(
  nodes: readonly SlideChildNode[],
  id: string,
): SlideChildNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === "group") {
      const child = findNodeById(node.children, id);
      if (child) return child;
    }
  }
  return undefined;
}

function tableDeck() {
  const table = buildTableNode({ id: 'table-"quoted"' });
  const slide = buildSlide("table", [table], { id: "slide-table" });
  return { deck: buildDeck([slide]), slide, table };
}

async function waitForScheduledEffects() {
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function keyEvent(
  key: string,
  extras: Partial<{
    shiftKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
  }> = {},
) {
  const calls = { prevented: 0, stopped: 0 };
  return trackedKeyboardEvent({
    key,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    preventDefault: () => {
      calls.prevented += 1;
    },
    stopPropagation: () => {
      calls.stopped += 1;
    },
    calls,
    ...extras,
  });
}

function trackedKeyboardEvent(event: unknown): TrackedKeyboardEvent {
  return event as unknown as TrackedKeyboardEvent;
}

function filmstripContainerRefCurrent(
  container: unknown,
): React.RefObject<HTMLOListElement>["current"] {
  return container as unknown as React.RefObject<HTMLOListElement>["current"];
}

describe("useFilmstripDrag", () => {
  test("selects on click, ignores non-left pointers, drags after threshold, auto-scrolls, and cancels cleanly", () => {
    withPointerWindow((dispatch) => {
      const selected: number[] = [];
      const moved: Array<[string, number]> = [];
      const renderer = createHookRenderer();
      const result = renderer.run(() =>
        useFilmstripDrag({
          onMoveSlide: (slideId, targetIndex) =>
            moved.push([slideId, targetIndex]),
          onSelectSlide: (slideIndex) => selected.push(slideIndex),
        }),
      );
      const cells = [
        new FakeFilmstripCell(0, rect(0, 0, 60, 60), rect(4, 4, 52, 40)),
        new FakeFilmstripCell(1, rect(70, 0, 60, 60)),
        new FakeFilmstripCell(2, rect(140, 0, 60, 60)),
      ];
      const container = new FakeFilmstripContainer(cells);
      result.containerRef.current = filmstripContainerRefCurrent(container);

      result.onCellPointerDown(
        pointerEvent(cells[1], 92, 16, { button: 2 }),
        "slide-2",
        1,
      );
      dispatch("pointerup", { clientX: 92, clientY: 16 });
      assert.deepEqual(selected, []);

      result.onCellPointerDown(pointerEvent(cells[1], 92, 16), "slide-2", 1);
      dispatch("pointermove", { clientX: 94, clientY: 17 });
      dispatch("pointerup", { clientX: 94, clientY: 17 });
      assert.deepEqual(selected, [1]);

      result.onCellPointerDown(pointerEvent(cells[0], 10, 10), "slide-1", 0);
      dispatch("pointermove", {
        clientX: 235,
        clientY: 12,
        preventDefault: () => undefined,
      });
      assert.equal(container.scrollLeft, 64);
      assert.ok(container.attributes.has("data-drag-target"));
      dispatch("pointermove", {
        clientX: 4,
        clientY: 12,
        preventDefault: () => undefined,
      });
      assert.equal(container.scrollLeft, 50);
      dispatch("pointerup", {
        clientX: 188,
        clientY: 12,
        preventDefault: () => undefined,
      });
      assert.equal(moved.length, 1);
      assert.equal(moved[0]?.[0], "slide-1");
      assert.notEqual(moved[0]?.[1], 0);
      assert.equal(container.attributes.has("data-drag-target"), false);

      result.onCellPointerDown(pointerEvent(cells[2], 150, 10), "slide-3", 2);
      dispatch("pointermove", {
        clientX: 210,
        clientY: 10,
        preventDefault: () => undefined,
      });
      dispatch("pointercancel", { clientX: 210, clientY: 10 });
      assert.equal(container.attributes.has("data-drag-target"), false);
    });
  });
});

describe("useTableCellEditing", () => {
  test("enters table edit mode, commits cells, moves focus, exits, and ignores invalid nodes", () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const focusedSelectors: string[] = [];
    Object.assign(globalThis, {
      window: {
        setTimeout: (callback: () => void) => {
          callback();
          return 0;
        },
      },
      document: {
        querySelector: (selector: string) => {
          focusedSelectors.push(selector);
          return { focus: () => focusedSelectors.push("focus") };
        },
      },
    });

    try {
      const { deck, slide, table } = tableDeck();
      let selectionState: SelectionState = createSelectionState("normal");
      const focusedNodeIds: Array<string | null> = [];
      const announcements: string[] = [];
      const changedDecks: Deck[] = [];
      const focusSelected: Array<string | undefined> = [];
      const renderer = createHookRenderer();
      const hook = renderer.run(() =>
        useTableCellEditing({
          deck,
          activeSlide: slide,
          selectedNodeId: table.id,
          selectedNodeIds: [],
          findNodeById,
          setSelection: (next) => {
            selectionState =
              typeof next === "function" ? next(selectionState) : next;
          },
          setFocusedNodeId: (next) => {
            focusedNodeIds.push(
              typeof next === "function"
                ? next(focusedNodeIds.at(-1) ?? null)
                : next,
            );
          },
          onDeckChange: (nextDeck) => changedDecks.push(nextDeck),
          setStageAnnouncement: (next) => {
            announcements.push(
              typeof next === "function"
                ? next(announcements.at(-1) ?? "")
                : next,
            );
          },
          focusSelectedNodeSoon: (nodeId) => focusSelected.push(nodeId),
        }),
      );

      hook.handleEnterTableEdit(undefined, {
        announcement: "Custom table edit",
      });
      hook.handleTableCellFocus(table.id, 1, 1);
      hook.handleTableCellCommit(table.id, 0, 0, "Updated revenue");
      hook.handleTableCellCommit("missing", 0, 0, "Ignored");
      hook.handleTableCellCommit(table.id, 99, 99, "Ignored");
      const tab = keyEvent("Tab");
      const grid = keyEvent("ArrowDown", { ctrlKey: true });
      const escape = keyEvent("Escape");
      const ignored = keyEvent("ArrowRight");
      hook.handleTableCellKeyDown(table.id, 0, 0, tab);
      hook.handleTableCellKeyDown(table.id, 0, 0, grid);
      hook.handleTableCellKeyDown(table.id, 0, 0, ignored);
      hook.handleTableCellKeyDown(table.id, 0, 0, escape);
      hook.handleEnterTableEdit("missing");

      assert.equal(focusedNodeIds.at(0), table.id);
      assert.equal(announcements[0], "Custom table edit");
      assert.ok(focusedSelectors[0]?.includes('table-\\"quoted\\"'));
      assert.ok(focusedSelectors.includes("focus"));
      assert.deepEqual([...selectionState.nodeIds], [table.id]);
      assert.equal(changedDecks.length, 1);
      assert.equal(
        changedDecks[0]?.slides[0]?.children[0]?.type === "table"
          ? changedDecks[0].slides[0].children[0].content.rows[0]?.cells[0]
              ?.text
          : undefined,
        "Updated revenue",
      );
      assert.equal(tab.calls.prevented, 1);
      assert.equal(grid.calls.stopped, 1);
      assert.equal(ignored.calls.prevented, 0);
      assert.deepEqual(focusSelected, [table.id]);
    } finally {
      Object.assign(globalThis, {
        window: previousWindow,
        document: previousDocument,
      });
    }
  });

  test("clears table editing when the editing node is deleted", async () => {
    const { deck, slide, table } = tableDeck();
    let activeSlide = slide;
    let selectionState = createSelectionState("normal");
    const renderer = createHookRenderer({ runEffects: true });
    const render = () =>
      renderer.run(() =>
        useTableCellEditing({
          deck,
          activeSlide,
          selectedNodeId: [...selectionState.nodeIds][0],
          selectedNodeIds: [...selectionState.nodeIds],
          findNodeById,
          setSelection: (next) => {
            selectionState =
              typeof next === "function" ? next(selectionState) : next;
          },
          setFocusedNodeId: () => undefined,
          onDeckChange: () => undefined,
          setStageAnnouncement: () => undefined,
          focusSelectedNodeSoon: () => undefined,
        }),
      );

    let hook = render();
    hook.handleEnterTableEdit(table.id);
    hook = render();
    assert.equal(hook.tableEditingNodeId, table.id);

    activeSlide = buildSlide("table", [], { id: slide.id });
    render();
    await waitForScheduledEffects();
    hook = render();
    assert.equal(hook.tableEditingNodeId, null);
    assert.equal(hook.activeTableCell, null);
  });

  test("clears table editing when selection moves to a different node", async () => {
    const table = buildTableNode({ id: "table-editing" });
    const text = buildTextNode({ id: "text-selected" });
    const slide = buildSlide("table", [table, text]);
    const deck = buildDeck([slide]);
    let selectionState = createSelectionState("normal");
    const renderer = createHookRenderer({ runEffects: true });
    const render = () =>
      renderer.run(() =>
        useTableCellEditing({
          deck,
          activeSlide: slide,
          selectedNodeId: [...selectionState.nodeIds][0],
          selectedNodeIds: [...selectionState.nodeIds],
          findNodeById,
          setSelection: (next) => {
            selectionState =
              typeof next === "function" ? next(selectionState) : next;
          },
          setFocusedNodeId: () => undefined,
          onDeckChange: () => undefined,
          setStageAnnouncement: () => undefined,
          focusSelectedNodeSoon: () => undefined,
        }),
      );

    let hook = render();
    hook.handleEnterTableEdit(table.id);
    hook = render();
    assert.equal(hook.tableEditingNodeId, table.id);

    selectionState = setSelectedNodeIds(selectionState, [text.id]);
    render();
    await waitForScheduledEffects();
    hook = render();
    assert.equal(hook.tableEditingNodeId, null);
    assert.equal(hook.activeTableCell, null);
  });

  test("keeps table editing when the selected node is the editing node", async () => {
    const { deck, slide, table } = tableDeck();
    let selectionState = createSelectionState("normal");
    const renderer = createHookRenderer({ runEffects: true });
    const render = () =>
      renderer.run(() =>
        useTableCellEditing({
          deck,
          activeSlide: slide,
          selectedNodeId: [...selectionState.nodeIds][0],
          selectedNodeIds: [...selectionState.nodeIds],
          findNodeById,
          setSelection: (next) => {
            selectionState =
              typeof next === "function" ? next(selectionState) : next;
          },
          setFocusedNodeId: () => undefined,
          onDeckChange: () => undefined,
          setStageAnnouncement: () => undefined,
          focusSelectedNodeSoon: () => undefined,
        }),
      );

    let hook = render();
    hook.handleEnterTableEdit(table.id);
    hook = render();
    await waitForScheduledEffects();
    hook = render();

    assert.equal(hook.tableEditingNodeId, table.id);
    assert.deepEqual(hook.activeTableCell, { rowIndex: 0, colIndex: 0 });
  });

  test("returns inert table editing handlers without an active slide", () => {
    const calls: string[] = [];
    const renderer = createHookRenderer();
    const hook = renderer.run(() =>
      useTableCellEditing({
        deck: buildDeck([]),
        activeSlide: undefined,
        selectedNodeId: undefined,
        selectedNodeIds: [],
        findNodeById,
        setSelection: () => calls.push("selection"),
        setFocusedNodeId: () => calls.push("focus"),
        onDeckChange: () => calls.push("deck"),
        setStageAnnouncement: () => calls.push("announce"),
        focusSelectedNodeSoon: () => calls.push("restore"),
      }),
    );

    hook.handleEnterTableEdit();
    hook.handleTableCellCommit("table", 0, 0, "Text");
    hook.handleTableCellKeyDown("table", 0, 0, keyEvent("Tab"));

    assert.deepEqual(calls, []);
    assert.equal(hook.tableEditingNodeId, null);
    assert.equal(hook.activeTableCell, null);
  });
});
