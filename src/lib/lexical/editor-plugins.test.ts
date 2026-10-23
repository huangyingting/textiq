/**
 * Direct contracts for `createCoreEditorPlugins` (#1929).
 *
 * `createCoreEditorPlugins` is a pure factory: it returns an ordered array of
 * `CoreEditorPlugin` descriptors (`{ id, render }`), and `plugin.render()`
 * builds a React *element* — it does not invoke the underlying component, so
 * calling it here never runs a plugin's hooks/effects (which need a live
 * Lexical editor + DOM and are exercised elsewhere: `use-collaboration-gate`,
 * `table-observer-guard`, `block-id-runtime`, etc.). This file locks down:
 *  - plugin id/order composition (a stable, unique contract other code and
 *    tests can key off of),
 *  - config propagation — that each factory input reaches the right
 *    element's props unmodified, and that the hardcoded table-plugin flags
 *    stay hardcoded regardless of caller input,
 *  - the one plugin with no hooks (`rich-text`) can be inspected one level
 *    deeper (calling its element's `.type` directly is safe precisely
 *    because it has no hooks), verifying the ready/connecting placeholder
 *    swap and the ContentEditable/ErrorBoundary wiring.
 *
 * No React render harness or Lexical editor is needed: everything here is
 * plain element-tree inspection, matching `editor-api.test.ts`'s existing
 * `plugin.render()` contract test for the same `CoreEditorPlugin` shape.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidElement, type ReactElement } from "react";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  KEY_DOWN_COMMAND,
} from "lexical";

import { CollaborationPlugin } from "@lexical/react/LexicalCollaborationPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";

import {
  createCoreEditorPlugins,
  registerDocumentBoundaryNavigation,
} from "./editor-plugins";
import { VisualNode, $createVisualNode } from "./visual-node";
import { createBlankVisual } from "@/lib/visual/blank";

type ElementLike = ReactElement<Record<string, unknown>>;

function elementOf(node: unknown): ElementLike {
  assert.ok(isValidElement(node), "expected a valid React element");
  return node as ElementLike;
}

function baseConfig() {
  const texts: string[] = [];
  const changes: unknown[] = [];
  return {
    documentId: "doc-1",
    providerFactory: (() => ({})) as never,
    initialStateJson: '{"root":{}}',
    userName: "Ada",
    cursorColor: "#ff00ff",
    ready: true,
    degraded: false,
    synced: true,
    editable: true,
    onText: (text: string) => texts.push(text),
    onChange: (state: unknown) => changes.push(state),
    texts,
    changes,
  };
}

function pluginMap(plugins: ReturnType<typeof createCoreEditorPlugins>) {
  return new Map(plugins.map((plugin) => [plugin.id, plugin]));
}

// ---------------------------------------------------------------------------
// Composition — stable, unique, ordered plugin ids
// ---------------------------------------------------------------------------

test("createCoreEditorPlugins composes a stable, unique, ordered plugin id list", () => {
  const config = baseConfig();
  const plugins = createCoreEditorPlugins(config);

  assert.deepEqual(
    plugins.map((plugin) => plugin.id),
    [
      "rich-text",
      "collaboration",
      "durable-block-ids",
      "document-boundary-navigation",
      "editable-gate",
      "local-fallback-seed",
      "document-stats",
      "list",
      "link",
      "table",
      "horizontal-rule",
      "autosave",
    ],
  );
  assert.equal(
    new Set(plugins.map((plugin) => plugin.id)).size,
    plugins.length,
  );
});

test("every plugin's render() returns a valid React element without invoking hooks", () => {
  const plugins = createCoreEditorPlugins(baseConfig());
  for (const plugin of plugins) {
    const element = plugin.render();
    assert.ok(
      isValidElement(element),
      `expected plugin "${plugin.id}" to render a valid element`,
    );
  }
});

// ---------------------------------------------------------------------------
// Config propagation
// ---------------------------------------------------------------------------

test("collaboration plugin receives the collaboration config verbatim", () => {
  const config = baseConfig();
  const plugins = pluginMap(createCoreEditorPlugins(config));
  const element = elementOf(plugins.get("collaboration")?.render());

  assert.equal(element.type, CollaborationPlugin);
  assert.equal(element.props.id, "doc-1");
  assert.equal(element.props.providerFactory, config.providerFactory);
  assert.equal(element.props.shouldBootstrap, true);
  assert.equal(element.props.initialEditorState, config.initialStateJson);
  assert.equal(element.props.username, "Ada");
  assert.equal(element.props.cursorColor, "#ff00ff");
});

test("collaboration plugin passes null initialEditorState through as null, not undefined", () => {
  const config = baseConfig();
  const plugins = pluginMap(
    createCoreEditorPlugins({ ...config, initialStateJson: null }),
  );
  const element = elementOf(plugins.get("collaboration")?.render());

  assert.equal(element.props.initialEditorState, null);
});

test("editable-gate plugin propagates the editable flag", () => {
  for (const editable of [true, false]) {
    const config = baseConfig();
    const plugins = pluginMap(createCoreEditorPlugins({ ...config, editable }));
    const element = elementOf(plugins.get("editable-gate")?.render());
    assert.equal(element.props.editable, editable);
  }
});

test("local-fallback-seed plugin propagates initialStateJson/degraded/synced", () => {
  const config = baseConfig();
  const plugins = pluginMap(
    createCoreEditorPlugins({ ...config, degraded: true, synced: false }),
  );
  const element = elementOf(plugins.get("local-fallback-seed")?.render());

  assert.equal(element.props.initialStateJson, config.initialStateJson);
  assert.equal(element.props.degraded, true);
  assert.equal(element.props.synced, false);
});

test("document-stats plugin propagates the onText callback by reference", () => {
  const config = baseConfig();
  const plugins = pluginMap(createCoreEditorPlugins(config));
  const element = elementOf(plugins.get("document-stats")?.render());

  assert.equal(element.props.onText, config.onText);
});

test("table plugin hardcodes its flags regardless of caller input", () => {
  const config = baseConfig();
  const plugins = pluginMap(createCoreEditorPlugins(config));
  const element = elementOf(plugins.get("table")?.render());

  // These are fixed contract values inside editor-plugins.tsx: the document
  // editor never exposes cell-merge/background-color/horizontal-scroll
  // toggles, so they must stay hardcoded no matter what config is passed in.
  assert.equal(element.props.hasCellMerge, false);
  assert.equal(element.props.hasCellBackgroundColor, false);
  assert.equal(element.props.hasHorizontalScroll, false);
  assert.equal(element.props.hasTabHandler, true);
});

test("list/link/horizontal-rule plugins render the expected library components with no props", () => {
  const plugins = pluginMap(createCoreEditorPlugins(baseConfig()));

  assert.equal(elementOf(plugins.get("list")?.render()).type, ListPlugin);
  assert.equal(elementOf(plugins.get("link")?.render()).type, LinkPlugin);
  assert.equal(
    elementOf(plugins.get("horizontal-rule")?.render()).type,
    HorizontalRulePlugin,
  );
});

test("autosave plugin ignores selection-only updates but observes history-merged typing", () => {
  const config = baseConfig();
  const plugins = pluginMap(createCoreEditorPlugins(config));
  const element = elementOf(plugins.get("autosave")?.render());

  assert.equal(element.type, OnChangePlugin);
  assert.equal(element.props.onChange, config.onChange);
  assert.equal(element.props.ignoreSelectionChange, true);
  assert.equal(element.props.ignoreHistoryMergeTagChange, false);
});

// ---------------------------------------------------------------------------
// rich-text — the one plugin with no hooks, safe to render one level deeper
// ---------------------------------------------------------------------------

function renderRichText(ready: boolean): ElementLike {
  const plugins = pluginMap(
    createCoreEditorPlugins({ ...baseConfig(), ready }),
  );
  const element = elementOf(plugins.get("rich-text")?.render());
  // CoreRichTextPlugin has no hooks, so calling it directly outside of a
  // render pass is safe and simply returns its JSX output.
  const rendered = (element.type as (props: unknown) => unknown)(element.props);
  return elementOf(rendered);
}

test("rich-text plugin renders RichTextPlugin with a labeled ContentEditable and error boundary", () => {
  const outer = renderRichText(true);
  const richText = elementOf(outer.props.children);

  assert.equal(richText.type, RichTextPlugin);
  assert.equal(richText.props.ErrorBoundary, LexicalErrorBoundary);

  const contentEditable = elementOf(richText.props.contentEditable);
  assert.equal(contentEditable.type, ContentEditable);
  assert.equal(contentEditable.props["aria-label"], "Document body");
});

test("rich-text plugin swaps its placeholder copy based on the ready flag", () => {
  const readyPlaceholder = elementOf(
    elementOf(renderRichText(true).props.children).props.placeholder,
  );
  const connectingPlaceholder = elementOf(
    elementOf(renderRichText(false).props.children).props.placeholder,
  );

  assert.equal(readyPlaceholder.props.children, "Start writing…");
  assert.equal(connectingPlaceholder.props.children, "Connecting…");
});

function documentKeyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return Object.assign(
    new Event("keydown", { cancelable: true }),
    {
      key: "End",
      code: overrides.key ?? "End",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      isComposing: false,
    },
    overrides,
  ) as KeyboardEvent;
}

for (const shortcut of [
  { name: "Control+End", key: "End", ctrlKey: true, toEnd: true },
  { name: "Meta+ArrowDown", key: "ArrowDown", metaKey: true, toEnd: true },
  { name: "Control+Home", key: "Home", ctrlKey: true, toEnd: false },
  { name: "Meta+ArrowUp", key: "ArrowUp", metaKey: true, toEnd: false },
]) {
  test(`${shortcut.name} positions edits at the document boundary without changing content`, () => {
    const editor = createHeadlessEditor({
      nodes: [VisualNode],
      onError(error) {
        throw error;
      },
    });
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode("Original paragraph")),
          $createVisualNode(createBlankVisual("flowchart")),
        );
      },
      { discrete: true },
    );
    const before = editor.getEditorState().toJSON();
    const unregister = registerDocumentBoundaryNavigation(editor);
    const event = documentKeyEvent(shortcut);
    try {
      editor.update(
        () =>
          assert.equal(editor.dispatchCommand(KEY_DOWN_COMMAND, event), true),
        { discrete: true },
      );
      assert.equal(event.defaultPrevented, true);
      assert.deepEqual(editor.getEditorState().toJSON(), before);
      editor.update(
        () => {
          const selection = $getSelection();
          assert.ok($isRangeSelection(selection));
          if (shortcut.name === "Control+End") selection.insertParagraph();
          selection.insertText("Boundary edit");
          const children = $getRoot().getChildren();
          assert.equal(
            shortcut.toEnd
              ? children.at(-1)?.getTextContent()
              : children[0].getTextContent(),
            shortcut.toEnd
              ? "Boundary edit"
              : "Boundary editOriginal paragraph",
          );
          assert.equal(
            children.filter((child) => child.getType() === "visual").length,
            1,
          );
        },
        { discrete: true },
      );
    } finally {
      unregister();
    }
  });
}

test("boundary navigation preserves native selection, composition, and read-only behavior and cleans up", () => {
  for (const editable of [true, false]) {
    const editor = createHeadlessEditor({
      editable,
      onError(error) {
        throw error;
      },
    });
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode("Original")),
        );
      },
      { discrete: true },
    );
    const unregister = registerDocumentBoundaryNavigation(editor);
    const variants = editable
      ? [
          { shiftKey: true },
          { altKey: true },
          { isComposing: true },
          { ctrlKey: false },
          { metaKey: true },
          { key: "ArrowLeft" },
        ]
      : [{}];
    try {
      for (const variant of variants) {
        const event = documentKeyEvent({
          ctrlKey: true,
          ...variant,
        });
        editor.update(
          () => {
            editor.dispatchCommand(KEY_DOWN_COMMAND, event);
          },
          { discrete: true },
        );
        assert.equal(event.defaultPrevented, false);
      }
    } finally {
      unregister();
    }
    const event = documentKeyEvent({ ctrlKey: true });
    editor.update(
      () => {
        editor.dispatchCommand(KEY_DOWN_COMMAND, event);
      },
      { discrete: true },
    );
    assert.equal(event.defaultPrevented, false);
  }
});
