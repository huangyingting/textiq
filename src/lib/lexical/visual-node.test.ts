import assert from "node:assert/strict";
import { test } from "node:test";

import { createHeadlessEditor } from "@lexical/headless";
import { $getRoot } from "lexical";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { safeParseVisual } from "@/lib/visual/schema";
import { buildVisual } from "@/test/builders/visual";

import {
  $createVisualNode,
  $isVisualNode,
  VisualNode,
  VisualNodeRendererProvider,
} from "@/lib/lexical/visual-node";

type BuiltVisual = ReturnType<typeof buildVisual>;

function invalidVisual(value: unknown): BuiltVisual {
  return value as unknown as BuiltVisual;
}

function mockDocument(value: unknown): Document {
  return value as unknown as Document;
}

function makeEditor() {
  return createHeadlessEditor({
    namespace: "visual-node-test",
    nodes: [VisualNode],
    onError(error) {
      throw error;
    },
  });
}

test("serializes and deserializes a visual node round-trip", () => {
  const visual = buildVisual({ title: "Flow fixture" });

  const editor = makeEditor();
  editor.update(
    () => {
      $getRoot().clear().append($createVisualNode(visual, "vis-1"));
    },
    { discrete: true },
  );

  const json = JSON.stringify(editor.getEditorState().toJSON());

  // Parse into a fresh editor to prove importJSON reconstructs the node.
  const editor2 = makeEditor();
  editor2.setEditorState(editor2.parseEditorState(json));

  editor2.getEditorState().read(() => {
    const node = $getRoot().getChildren().find($isVisualNode);
    assert.ok(node, "expected a VisualNode after round-trip");
    assert.equal(node.getVisualId(), "vis-1");
    assert.deepEqual(node.getVisual(), visual);
  });
});

test("exportJSON includes the visual payload, id, and node type", () => {
  const visual = buildVisual({ type: "mindmap", title: "Mind map fixture" });
  const editor = makeEditor();

  editor.update(
    () => {
      $getRoot().clear().append($createVisualNode(visual, "vis-2"));
    },
    { discrete: true },
  );

  editor.getEditorState().read(() => {
    const node = $getRoot().getChildren().find($isVisualNode);
    assert.ok(node);
    const exported = node.exportJSON();
    assert.equal(exported.type, "visual");
    assert.equal(exported.visualId, "vis-2");
    assert.deepEqual(exported.visual, visual);
  });
});

test("generates a stable id when none is provided", () => {
  const editor = makeEditor();
  editor.update(
    () => {
      $getRoot()
        .clear()
        .append($createVisualNode(buildVisual({ type: "list" })));
    },
    { discrete: true },
  );

  editor.getEditorState().read(() => {
    const node = $getRoot().getChildren().find($isVisualNode);
    assert.ok(node);
    assert.ok(
      node.getVisualId().length > 0,
      "expected an auto-generated visual id",
    );
  });
});

test("preserves an invalid payload through round-trip and flags it as invalid", () => {
  // The node stores whatever payload it is given; rendering uses safeParseVisual
  // to degrade gracefully, so a malformed visual must not break serialization.
  const broken = invalidVisual({ not: "a visual" });

  const editor = makeEditor();
  editor.update(
    () => {
      $getRoot().clear().append($createVisualNode(broken, "vis-bad"));
    },
    { discrete: true },
  );

  const json = JSON.stringify(editor.getEditorState().toJSON());

  const editor2 = makeEditor();
  editor2.setEditorState(editor2.parseEditorState(json));

  editor2.getEditorState().read(() => {
    const node = $getRoot().getChildren().find($isVisualNode);
    assert.ok(node, "expected the visual node to survive round-trip");
    const parsed = safeParseVisual(node.getVisual());
    assert.equal(
      parsed.success,
      false,
      "expected safeParseVisual to flag the broken payload",
    );
  });
});

test("creates DOM, exports copy payload, and imports valid visual HTML with a fresh id", () => {
  const visual = buildVisual({ type: "flowchart", title: "Copyable visual" });
  withDocumentStub(() => {
    const editor = makeEditor();
    editor.update(
      () => {
        const node = $createVisualNode(visual, "source-visual-id");
        $getRoot().clear().append(node);
        const dom = node.createDOM({
          theme: { visual: "visual-block" },
        } as never);
        assert.equal(dom.tagName, "DIV");
        assert.equal(dom.className, "visual-block");
        assert.equal(
          node.createDOM({ theme: {} } as never).className,
          "",
          "theme without a visual class should leave the wrapper unstyled",
        );
        assert.equal(node.updateDOM(), false);

        const exported = node.exportDOM().element as HTMLElement;
        assert.equal(
          exported.getAttribute("data-lexical-visual-id"),
          "source-visual-id",
        );
        assert.deepEqual(
          JSON.parse(exported.getAttribute("data-lexical-visual") ?? ""),
          visual,
        );

        const converter = VisualNode.importDOM()?.div?.(exported);
        assert.ok(converter, "expected a visual import converter");
        const converted = converter.conversion(exported);
        const pasted = converted?.node;
        assert.ok($isVisualNode(pasted), "expected converted VisualNode");
        assert.deepEqual(pasted.getVisual(), visual);
        assert.notEqual(pasted.getVisualId(), "source-visual-id");
      },
      { discrete: true },
    );
  });
});

test("visual DOM import skips unrelated, missing, malformed, and invalid payloads", () => {
  withDocumentStub(() => {
    const unrelated = document.createElement("div");
    assert.equal(VisualNode.importDOM()?.div?.(unrelated), null);

    const missingPayload = document.createElement("div");
    missingPayload.setAttribute("data-lexical-visual-id", "vis-missing");
    const converter = VisualNode.importDOM()?.div?.(missingPayload);
    assert.ok(converter);
    assert.equal(converter.conversion(missingPayload), null);

    const malformed = document.createElement("div");
    malformed.setAttribute("data-lexical-visual-id", "vis-malformed");
    malformed.setAttribute("data-lexical-visual", "{");
    assert.equal(converter.conversion(malformed), null);

    const invalid = document.createElement("div");
    invalid.setAttribute("data-lexical-visual-id", "vis-invalid");
    invalid.setAttribute("data-lexical-visual", JSON.stringify({ nope: true }));
    assert.equal(converter.conversion(invalid), null);
  });
});

test("visual node renderer provider supplies custom markup and defaults when absent", () => {
  const visual = buildVisual({ title: "Rendered visual" });
  const custom = renderToStaticMarkup(
    createElement(
      VisualNodeRendererProvider,
      {
        renderVisualNode: ({ visualId }) =>
          createElement(
            "span",
            { "data-custom-visual-id": visualId },
            "custom",
          ),
      },
      VisualNode.prototype.decorate.call({
        getKey: () => "node-key",
        __visual: visual,
        __visualId: "visual-provider",
      }),
    ),
  );
  assert.match(custom, /data-custom-visual-id="visual-provider"/);

  const fallback = renderToStaticMarkup(
    VisualNode.prototype.decorate.call({
      getKey: () => "node-key",
      __visual: visual,
      __visualId: "visual-fallback",
    }),
  );
  assert.match(fallback, /data-lexical-visual-renderer="missing"/);
  assert.match(fallback, /Visual unavailable/);
});

test("visual id generation falls back when randomUUID is unavailable", () => {
  const originalCrypto = globalThis.crypto;
  const originalRandom = Math.random;
  const originalNow = Date.now;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {},
  });
  Math.random = () => 0.5;
  Date.now = () => 36;
  try {
    const editor = makeEditor();
    let visualId = "";
    editor.update(
      () => {
        const node = $createVisualNode(buildVisual({ type: "list" }));
        visualId = node.getVisualId();
      },
      { discrete: true },
    );
    assert.equal(visualId, "visual-i-10");
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
    Math.random = originalRandom;
    Date.now = originalNow;
  }
});

function withDocumentStub(run: () => void): void {
  const originalDocument = globalThis.document;
  (globalThis as typeof globalThis & { document: Document }).document =
    mockDocument({
      createElement(tagName: string) {
        const attributes = new Map<string, string>();
        const classNames: string[] = [];
        const element = {
          tagName: tagName.toUpperCase(),
          className: "",
          classList: {
            add(...names: string[]) {
              classNames.push(...names);
              element.className = classNames.join(" ");
            },
          },
          setAttribute(name: string, value: string) {
            attributes.set(name, value);
          },
          getAttribute(name: string) {
            return attributes.get(name) ?? null;
          },
          hasAttribute(name: string) {
            return attributes.has(name);
          },
        };
        return element;
      },
    });
  try {
    run();
  } finally {
    if (originalDocument === undefined) {
      Reflect.deleteProperty(globalThis, "document");
    } else {
      (globalThis as typeof globalThis & { document: Document }).document =
        originalDocument;
    }
  }
}
