import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { INLINE_TEXT_COMMAND_EVENT_ } from "@/lib/presentation/inline-text-commands";
import type { Paragraph } from "@/lib/presentation/schema";
import { createServerRenderHarness } from "@/test/react-server-renderer";
import { InlineTextEditorPresentation } from "./inline-text-editor";

function createHookRenderer({ runEffects = false } = {}) {
  return createServerRenderHarness({ idPrefix: "inline-test-id", runEffects });
}

function collectElements(node: ReactNode, elements: ReactElement[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, elements);
    return elements;
  }
  if (!isValidElement(node)) return elements;
  elements.push(node);
  collectElements((node.props as { children?: ReactNode }).children, elements);
  return elements;
}

function editorElement(node: ReactNode): ReactElement {
  const element = collectElements(node).find(
    (candidate) =>
      (candidate.props as { "data-inline-editor-presentation"?: string })[
        "data-inline-editor-presentation"
      ] === "text-1",
  );
  assert.ok(element);
  return element;
}

function commandEvent(value: unknown): Event {
  return value as unknown as Event;
}

type FakeElement = {
  nodeType: number;
  tagName: string;
  textContent?: string;
  innerText?: string;
  innerHTML?: string;
  childNodes: unknown[];
  children?: unknown[];
  dataset: Record<string, string>;
  style: Record<string, string>;
  parentElement: FakeElement | null;
  parentNode?: unknown;
  getAttribute: (name: string) => string | null;
  closest: (selector: string) => FakeElement | null;
  contains: (node: unknown) => boolean;
  focus: () => void;
};

function textNode(text: string, parentElement: FakeElement) {
  return {
    nodeType: 3,
    textContent: text,
    parentElement,
  };
}

function fakeBlock({
  tagName = "DIV",
  text,
  dataset = {},
  style = {},
}: {
  tagName?: string;
  text: string;
  dataset?: Record<string, string>;
  style?: Record<string, string>;
}): FakeElement {
  const block: FakeElement = {
    nodeType: 1,
    tagName,
    childNodes: [],
    children: [],
    dataset,
    style: {
      fontWeight: "",
      fontStyle: "",
      textDecorationLine: "",
      color: "",
      fontSize: "",
      ...style,
    },
    parentElement: null,
    getAttribute: () => null,
    closest: () => block,
    contains: (node) => node === block || block.childNodes.includes(node),
    focus: () => undefined,
  };
  block.childNodes = [textNode(text, block)];
  block.children = block.childNodes;
  block.textContent = text;
  block.innerText = text;
  block.innerHTML = text;
  return block;
}

function fakeContainer(children: FakeElement[]): FakeElement {
  const container: FakeElement = {
    nodeType: 1,
    tagName: "DIV",
    childNodes: children,
    children,
    dataset: {},
    style: {},
    parentElement: null,
    innerText: children.map((child) => child.textContent ?? "").join("\n"),
    getAttribute: () => null,
    closest: () => container,
    contains: (node) =>
      node === container ||
      children.some(
        (child) => child === node || child.childNodes.includes(node),
      ),
    focus: () => undefined,
  };
  for (const child of children) child.parentElement = container;
  return container;
}

function baseProps(
  overrides: Partial<Parameters<typeof InlineTextEditorPresentation>[0]> = {},
) {
  const initialParagraphs: Paragraph[] = [{ id: "p-1", text: "Initial" }];
  return {
    nodeId: "text-1",
    initialParagraphs,
    frame: { x: 10, y: 20, w: 30, h: 12 },
    onCommit: () => undefined,
    onCancel: () => undefined,
    ...overrides,
  } satisfies Parameters<typeof InlineTextEditorPresentation>[0];
}

function keyEvent(key: string, shiftKey = false) {
  return {
    key,
    shiftKey,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  };
}

test("InlineTextEditorPresentation commits serialized list content and toolbar alignment", () => {
  const previousNode = globalThis.Node;
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  let commandListener: ((event: Event) => void) | undefined;
  const block = fakeBlock({
    text: "Indented bullet",
    dataset: { listKind: "bullet", listIndent: "2" },
    style: { fontWeight: "700", color: "#123456", fontSize: "18pt" },
  });
  const container = fakeContainer([block]);
  const text = block.childNodes[0];
  const commits: Array<{
    paragraphs: Paragraph[];
    align: unknown;
  }> = [];

  Object.assign(globalThis, {
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    window: {
      getSelection: () => ({
        rangeCount: 1,
        getRangeAt: () => ({ startContainer: text, endContainer: text }),
      }),
    },
    document: {
      activeElement: container,
      addEventListener: (name: string, listener: (event: Event) => void) => {
        if (name === INLINE_TEXT_COMMAND_EVENT_) commandListener = listener;
      },
      removeEventListener: () => undefined,
      createTextNode: (value: string) => ({ nodeType: 3, textContent: value }),
    },
  });

  try {
    const tree = createHookRenderer({ runEffects: true }).run(() =>
      InlineTextEditorPresentation(
        baseProps({
          onCommit: (_nodeId, paragraphs, _frame, align) => {
            commits.push({ paragraphs, align });
          },
        }),
      ),
    );
    const element = editorElement(tree);
    const ref = (element.props as { ref: { current: FakeElement | null } }).ref;
    ref.current = container;

    assert.ok(commandListener);
    commandListener(commandEvent({ detail: { command: "align-right" } }));
    (element.props as { onBlur: () => void }).onBlur();

    assert.equal(commits.length, 1);
    assert.equal(commits[0]?.align, "right");
    assert.equal(block.style.textAlign, "right");
    assert.deepEqual(commits[0]?.paragraphs, [
      {
        id: "p-1",
        text: "Indented bullet",
        runs: [
          {
            text: "Indented bullet",
            bold: true,
            localStyle: { color: "#123456", fontSizePt: 18 },
          },
        ],
        list: { kind: "bullet", indent: 2 },
      },
    ]);
  } finally {
    Object.assign(globalThis, {
      Node: previousNode,
      window: previousWindow,
      document: previousDocument,
    });
  }
});

test("InlineTextEditorPresentation routes Escape and Tab keyboard exits", () => {
  let cancelCalls = 0;
  let nextCalls = 0;
  let prevCalls = 0;
  let commitCalls = 0;

  const escapeTree = createHookRenderer().run(() =>
    InlineTextEditorPresentation(
      baseProps({
        onCancel: () => {
          cancelCalls += 1;
        },
      }),
    ),
  );
  const escapeElement = editorElement(escapeTree);
  (
    escapeElement.props as { ref: { current: { innerText: string } } }
  ).ref.current = {
    innerText: "",
  };
  (escapeElement.props as { onKeyDown: (event: unknown) => void }).onKeyDown(
    keyEvent("Escape"),
  );

  const tabTree = createHookRenderer().run(() =>
    InlineTextEditorPresentation(
      baseProps({
        onCommit: () => {
          commitCalls += 1;
        },
        onTabNext: () => {
          nextCalls += 1;
        },
      }),
    ),
  );
  const tabElement = editorElement(tabTree);
  (tabElement.props as { onKeyDown: (event: unknown) => void }).onKeyDown(
    keyEvent("Tab"),
  );

  const shiftTabTree = createHookRenderer().run(() =>
    InlineTextEditorPresentation(
      baseProps({
        onCancel: () => {
          cancelCalls += 1;
        },
        onTabPrev: () => {
          prevCalls += 1;
        },
      }),
    ),
  );
  const shiftTabElement = editorElement(shiftTabTree);
  (shiftTabElement.props as { onKeyDown: (event: unknown) => void }).onKeyDown(
    keyEvent("Tab", true),
  );

  assert.equal(cancelCalls, 2);
  assert.equal(commitCalls, 0);
  assert.equal(nextCalls, 1);
  assert.equal(prevCalls, 1);
});
