import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyTemplate,
  cutNodes,
  detachDeckChrome,
  duplicateNodes,
  insertNode,
  moveNodesBy,
  pasteNodes,
  resetLocalStyleOverride,
  resetSlideLocalStyle,
  setThemePackage,
  updateNodeContent,
  updateNodeLayout,
  updateNodeRotation,
  updateSlideLocalStyle,
} from "./editor-commands";
import type { ResolvedRenderNode } from "./render-tree";
import type { SlideChildNode } from "./schema";
import {
  buildDeckV7,
  buildLayoutBox,
  buildSlideV7,
  buildTextNode,
} from "@/test/builders/deck-v7";
import { createDefaultTemplateRegistry } from "./theme-packages";

function find(
  nodes: readonly SlideChildNode[],
  id: string,
): SlideChildNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === "group") {
      const nested = find(node.children, id);
      if (nested) return nested;
    }
  }
}

test("editor commands cover nested id, layout, and no-op branches", () => {
  const child = buildTextNode({
    id: "child",
    layout: buildLayoutBox({
      frame: { x: 10, y: 10, w: 10, h: 10 },
      zIndex: 1,
    }),
  });
  const group: SlideChildNode = {
    id: "group",
    type: "group",
    component: "custom",
    layout: buildLayoutBox({ frame: { x: 5, y: 5, w: 30, h: 30 }, zIndex: 2 }),
    style: { ref: "surface.card" },
    children: [child],
  };
  const deck = buildDeckV7([buildSlideV7("content", [group])]);
  const slideId = deck.slides[0].id;

  const movedGroup = updateNodeLayout(deck, slideId, "group", {
    frame: { x: 7, y: 8, w: 30, h: 30 },
  });
  assert.deepEqual(
    find(movedGroup.slides[0].children, "child")?.layout?.frame,
    { x: 12, y: 13, w: 10, h: 10 },
  );
  assert.equal(
    find(
      updateNodeRotation(deck, slideId, "group", Number.NaN).slides[0].children,
      "group",
    )?.layout?.rotation,
    0,
  );

  const duplicateInsert = insertNode(deck, slideId, group);
  assert.equal(duplicateInsert.nodeId, "group-copy");
  assert.ok(find(duplicateInsert.deck.slides[0].children, "child-copy"));

  const pasted = pasteNodes(deck, slideId, [group]);
  assert.deepEqual(pasted.nodeIds, ["group-copy"]);
  assert.ok(find(pasted.deck.slides[0].children, "child-copy"));

  assert.deepEqual(cutNodes(deck, slideId, []), { deck, nodes: [] });
  assert.deepEqual(cutNodes(deck, "missing", ["child"]), { deck, nodes: [] });
  assert.deepEqual(cutNodes(deck, slideId, ["missing"]), { deck, nodes: [] });

  const duplicated = duplicateNodes(deck, slideId, ["group"]);
  assert.deepEqual(duplicated.duplicatedIds, ["group-copy", "child-copy"]);

  const childSelectedMove = moveNodesBy(deck, slideId, ["child"], {
    x: 5,
    y: 5,
  });
  assert.equal(
    find(childSelectedMove.slides[0].children, "child")?.layout?.frame.x,
    15,
  );
});

test("editor commands cover local style, content, and template preservation branches", () => {
  const existing: SlideChildNode = buildTextNode({
    id: "title-existing",
    slot: "title",
    name: "Authored title",
    source: { documentId: "doc" },
    localStyle: { text: { color: "#111111" } },
    locked: true,
    hidden: true,
    accessibility: { label: "Title" },
    content: { paragraphs: [{ id: "p", text: "Authored" }] },
  });
  const deck = buildDeckV7([
    buildSlideV7("content", [existing], {
      localStyle: { slide: { accent: "#000000" } },
      controls: { tone: "warm" },
      notes: "Keep",
    }),
  ]);
  const slideId = deck.slides[0].id;

  const styled = updateSlideLocalStyle(deck, slideId, {
    slide: { decoration: "subtle" },
  });
  assert.equal(styled.slides[0].localStyle?.slide?.decoration, "subtle");
  assert.deepEqual(resetSlideLocalStyle(styled, "missing"), styled);
  assert.equal(
    resetSlideLocalStyle(deck, slideId).slides[0].localStyle,
    undefined,
  );

  const content = updateNodeContent(deck, slideId, existing.id, {
    language: "en-US",
  });
  assert.equal(find(content.slides[0].children, existing.id)?.type, "text");

  const withLocalReset = resetLocalStyleOverride(deck, slideId, existing.id, [
    "text",
  ]);
  assert.equal(
    find(withLocalReset.slides[0].children, existing.id)?.localStyle,
    undefined,
  );

  const template = createDefaultTemplateRegistry().get("content")!;
  const applied = applyTemplate(
    deck,
    slideId,
    { kind: "content", slots: { title: { type: "shortText", text: "Fresh" } } },
    template,
  );
  const preserved = applied.slides[0].children.find(
    (node) => node.slot === "title",
  );
  assert.equal(preserved?.id, "title-existing");
  assert.equal(preserved?.name, "Authored title");
  assert.equal(preserved?.locked, true);
  assert.equal(applied.slides[0].notes, "Keep");
  assert.equal(applied.slides[0].controls?.tone, "warm");
});

test("detachDeckChrome handles image and unsupported resolved content", () => {
  const deck = buildDeckV7([buildSlideV7("content", [])]);
  const slideId = deck.slides[0].id;
  const imageNode: ResolvedRenderNode = {
    id: "chrome-logo",
    type: "image",
    role: "image",
    layout: {
      frame: { x: 1, y: 1, w: 10, h: 10 },
      zIndex: 900,
      framePx: { x: 1, y: 1, w: 10, h: 10 },
    },
    style: { image: { fit: "contain" } },
    content: { type: "image", content: { assetId: "logo" } },
    source: "deckChrome",
    chromeKind: "logo",
  };
  const updated = detachDeckChrome(deck, slideId, "logo", imageNode);
  assert.equal(updated.slides[0].children[0]?.type, "image");

  const unsupported = {
    ...imageNode,
    content: { type: "unknown", content: {} },
  } as unknown as ResolvedRenderNode;
  assert.equal(detachDeckChrome(deck, slideId, "logo", unsupported), deck);
});

test("editor commands preserve compatible non-text slot content and duplicate suffixes", () => {
  const existingNodes: SlideChildNode[] = [
    {
      id: "image-existing",
      type: "image",
      slot: "imagePrompt",
      layout: buildLayoutBox(),
      style: { ref: "media.inline" },
      content: { assetId: "authored-image" },
    },
    {
      id: "shape-existing",
      type: "shape",
      slot: "stat",
      layout: buildLayoutBox(),
      style: { ref: "surface.card" },
      content: { shape: "diamond" },
    },
    {
      id: "table-existing",
      type: "table",
      slot: "table",
      layout: buildLayoutBox(),
      style: { ref: "surface.table" },
      content: {
        columns: [{ id: "c", label: "C" }],
        rows: [{ id: "r", cells: [{ text: "A" }] }],
      },
    },
    {
      id: "visual-existing",
      type: "visual",
      slot: "visualId",
      layout: buildLayoutBox(),
      style: { ref: "chart.primary" },
      content: { visualId: "authored-visual" },
    },
    {
      id: "group-existing",
      type: "group",
      slot: "cards",
      component: "custom",
      layout: buildLayoutBox(),
      style: { ref: "surface.card" },
      children: [buildTextNode({ id: "authored-child" })],
    },
    buildTextNode({ id: "group-copy" }),
  ];
  const deck = buildDeckV7([buildSlideV7("content", existingNodes)]);
  const template = createDefaultTemplateRegistry().get("content")!;
  const slideId = deck.slides[0].id;
  const applied = applyTemplate(
    deck,
    slideId,
    {
      kind: "content",
      slots: {
        title: { type: "shortText", text: "Title" },
        imagePrompt: { type: "image", prompt: "Hero" },
        stat: { type: "metric", value: "42", label: "Answer" },
        table: { type: "table", columns: ["C"], rows: [["B"]] },
        visualId: { type: "visual", visualId: "fresh" },
        cards: { type: "cards", items: [{ title: "Card" }] },
      },
    },
    template,
  );

  assert.equal(applied.slides[0].id, slideId);

  const duplicate = insertNode(deck, slideId, buildTextNode({ id: "group" }));
  assert.equal(duplicate.nodeId, "group");
  assert.equal(
    setThemePackage(deck, "new-theme").theme.packageVersion,
    undefined,
  );
  assert.equal(
    setThemePackage(deck, "new-theme", "1.0.0").theme.packageVersion,
    "1.0.0",
  );
});
