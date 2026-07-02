import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as runtime from "@/lib/presentation";
import {
  cutNodes,
  deleteNodes,
  duplicateNodes,
  groupNodes,
  insertNode,
  moveNodesBy,
  pasteNodes,
  resetLocalStyleOverride,
  updateNodeLayout,
  updateNodeRotation,
} from "@/lib/presentation/editor-commands";
import { repairSemanticDeckPlan } from "@/lib/presentation/semantic-deck-plan-repair";
import { hitTestSlideNodes } from "@/lib/presentation/stage-hit-test";
import { createDefaultTemplateRegistry } from "@/lib/presentation/theme-packages";
import { safeParseDeck } from "@/lib/presentation/validation";
import {
  buildDeck,
  buildImageNode,
  buildLayoutBox,
  buildShapeNode,
  buildSlide,
  buildTextNode,
} from "@/test/builders/presentation-deck";
import type {
  ConnectorNode,
  Deck,
  SlideChildNode,
} from "@/lib/presentation/schema";

function cloneDeck(deck: Deck): Record<string, unknown> {
  return JSON.parse(JSON.stringify(deck)) as Record<string, unknown>;
}

function errorsFor(input: unknown): string[] {
  const result = safeParseDeck(input);
  assert.equal(result.success, false);
  return result.success ? [] : result.errors;
}

function findNode(
  nodes: readonly SlideChildNode[],
  id: string,
): SlideChildNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === "group") {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

function connector(
  id: string,
  from: ConnectorNode["content"]["from"],
  to: ConnectorNode["content"]["to"],
  routing: ConnectorNode["content"]["routing"] = "straight",
): ConnectorNode {
  return {
    id,
    type: "connector",
    role: "connector",
    layout: { frame: { x: 10, y: 10, w: 80, h: 80 }, zIndex: 10 },
    style: { ref: "connector.primary" },
    content: { from, to, routing },
  };
}

describe("presentation remaining library coverage", () => {
  test("safeParseDeck reports remaining chrome, asset, table, and source diagnostics", () => {
    const thrown = errorsFor(
      new Proxy(
        {},
        {
          get(_target, property) {
            if (property === "schemaVersion") {
              throw new Error("schema getter failed");
            }
            return undefined;
          },
        },
      ),
    );
    assert.ok(thrown.some((error) => error.includes("schema getter failed")));

    const base = cloneDeck(
      buildDeck([
        buildSlide("content", [
          buildTextNode({ id: "text-1" }),
          buildImageNode("img-001", { id: "image-1" }),
        ]),
      ]),
    );
    base.assets = {
      images: {
        "img-001": {
          id: "img-001",
          src: "ftp://example.test/image.png",
          origin: "remote",
        },
        "img-object": null,
      },
      fonts: {
        "font-object": null,
      },
      visuals: {
        "visual-object": null,
      },
      files: {
        "file-object": null,
      },
    };
    base.chrome = {
      logo: {
        enabled: true,
        layer: "middle",
        placement: "center",
        size: "huge",
        layout: {
          frame: { x: 0, y: 0, w: 10, h: 10 },
          zIndex: 1,
          flipY: "yes",
        },
        style: {
          fill: {
            type: "pattern",
            kind: "zigzag",
            assetId: "",
            stops: "bad",
          },
        },
      },
      pageNumber: { enabled: true, format: "letters", placement: "top" },
      watermark: {
        enabled: true,
        text: 7,
        opacity: Number.POSITIVE_INFINITY,
        layoutMode: "horizontal",
        size: "giant",
      },
      border: { enabled: true, color: 12, widthPt: "wide" },
      safeArea: { enabled: true, insets: "bad", color: 12, widthPt: "wide" },
    };
    const slide = (base.slides as Record<string, unknown>[])[0]!;
    slide.children = [
      {
        id: "table-overflow",
        type: "table",
        layout: { frame: { x: 0, y: 0, w: 50, h: 50 }, zIndex: 1 },
        content: {
          columns: Array.from({ length: 9 }, (_, index) => ({
            id: `c-${index}`,
            label: `Column ${index}`,
          })),
          rows: [
            null,
            ...Array.from({ length: 21 }, (_, index) => ({
              id: `r-${index}`,
              cells: Array.from({ length: 9 }, () => ({ text: "cell" })),
            })),
          ],
          header: "yes",
          caption: 7,
        },
      },
      {
        id: "source-invalid",
        type: "text",
        role: "body",
        slot: "made-up-slot",
        accessibility: { extra: true, alt: 9 },
        source: {
          documentId: "doc",
          blockKind: "audio",
          display: "bad",
          refresh: "bad",
        },
        layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 2 },
        style: { ref: "text.body" },
        content: { paragraphs: [{ id: "p1", text: "Text" }] },
      },
    ];

    const errors = errorsFor(base);

    assert.ok(errors.some((error) => error.includes("URL scheme")));
    assert.ok(errors.some((error) => error.includes("Deck.chrome.logo.layer")));
    assert.ok(errors.some((error) => error.includes("Deck.chrome.logo.style")));
    assert.ok(errors.some((error) => error.includes("columns count")));
    assert.ok(
      errors.some((error) => error.includes("rows[0] must be an object")),
    );
    assert.ok(
      errors.some((error) => error.includes("slot is not a known slot key")),
    );
    assert.ok(
      errors.some((error) =>
        error.includes("source.display must be an object"),
      ),
    );
  });

  test("editor commands move, duplicate, delete, and reset nested group state", () => {
    const child = buildTextNode({
      id: "group-child",
      layout: buildLayoutBox({
        frame: { x: 10, y: 10, w: 10, h: 10 },
        zIndex: 1,
      }),
      localStyle: {
        fill: { type: "solid", color: "#ffffff" },
        stroke: { color: "#111111" },
      },
    });
    const sibling = buildShapeNode({
      id: "shape-sibling",
      layout: buildLayoutBox({
        frame: { x: 25, y: 10, w: 10, h: 10 },
        zIndex: 2,
      }),
    });
    const group: SlideChildNode = {
      id: "group-1",
      type: "group",
      component: "custom",
      style: { ref: "surface.card" },
      layout: buildLayoutBox({
        frame: { x: 8, y: 8, w: 35, h: 20 },
        zIndex: 3,
      }),
      children: [child, sibling],
    };
    const deck = buildDeck([buildSlide("content", [group])]);
    const slideId = deck.slides[0].id;

    const moved = updateNodeLayout(deck, slideId, "group-1", {
      frame: { x: 18, y: 18, w: 35, h: 20 },
    });
    assert.deepEqual(
      findNode(moved.slides[0].children, "group-child")?.layout?.frame,
      { x: 20, y: 20, w: 10, h: 10 },
    );

    const duplicated = duplicateNodes(moved, slideId, ["group-1"]);
    assert.ok(duplicated.duplicatedIds.includes("group-1-copy"));
    assert.ok(duplicated.duplicatedIds.includes("group-child-copy"));

    const pasted = pasteNodes(duplicated.deck, slideId, [
      findNode(duplicated.deck.slides[0].children, "group-1")!,
    ]);
    assert.deepEqual(pasted.nodeIds, ["group-1-copy-2"]);

    const inserted = insertNode(
      pasted.deck,
      slideId,
      buildShapeNode({ id: "unique-node" }),
    );
    assert.equal(inserted.nodeId, "unique-node");

    const colliding = insertNode(
      inserted.deck,
      slideId,
      buildShapeNode({ id: "unique-node" }),
    );
    assert.equal(colliding.nodeId, "unique-node-copy");

    const cut = cutNodes(colliding.deck, slideId, ["missing", "unique-node"]);
    assert.deepEqual(
      cut.nodes.map((node) => node.id),
      ["unique-node"],
    );

    const rotated = updateNodeRotation(
      cut.deck,
      slideId,
      "unique-node-copy",
      Number.NaN,
    );
    assert.equal(
      findNode(rotated.slides[0].children, "unique-node-copy")?.layout
        ?.rotation,
      0,
    );

    const reset = resetLocalStyleOverride(rotated, slideId, "group-child", [
      "fill",
      "stroke",
    ]);
    assert.equal(
      findNode(reset.slides[0].children, "group-child")?.localStyle,
      undefined,
    );

    const movedBy = moveNodesBy(reset, slideId, ["group-child"], {
      x: 5,
      y: 5,
    });
    assert.deepEqual(
      findNode(movedBy.slides[0].children, "group-child")?.layout?.frame,
      { x: 25, y: 25, w: 10, h: 10 },
    );

    const deleted = deleteNodes(movedBy, slideId, ["group-1"]);
    assert.equal(
      findNode(deleted.slides[0].children, "group-child"),
      undefined,
    );
  });

  test("groupNodes handles nested selections under a common ancestor", () => {
    const group: SlideChildNode = {
      id: "parent-group",
      type: "group",
      component: "custom",
      style: { ref: "surface.card" },
      layout: buildLayoutBox({
        frame: { x: 0, y: 0, w: 70, h: 30 },
        zIndex: 0,
      }),
      children: [
        buildTextNode({
          id: "nested-a",
          layout: buildLayoutBox({
            frame: { x: 10, y: 10, w: 10, h: 10 },
            zIndex: 1,
          }),
        }),
        buildTextNode({
          id: "nested-b",
          layout: buildLayoutBox({
            frame: { x: 30, y: 15, w: 15, h: 5 },
            zIndex: 2,
          }),
        }),
      ],
    };
    const deck = buildDeck([buildSlide("content", [group])]);

    const grouped = groupNodes(
      deck,
      deck.slides[0].id,
      ["nested-a", "nested-b"],
      "nested-group",
      { ref: "surface.card" },
    );

    const nested = findNode(grouped.slides[0].children, "nested-group");
    assert.equal(nested?.type, "group");
    assert.deepEqual(nested?.layout?.frame, { x: 10, y: 10, w: 35, h: 10 });
  });

  test("hitTestSlideNodes covers rotated text, shape geometry, and connector endpoint fallbacks", () => {
    const text = buildTextNode({
      id: "bottom-right-text",
      layout: buildLayoutBox({
        frame: { x: 0, y: 0, w: 80, h: 80 },
        zIndex: 1,
        rotation: 0,
      }),
      localStyle: {
        text: {
          fontSizePt: 4,
          align: "right",
          verticalAlign: "bottom",
          lineHeight: 1,
        },
      },
      content: { paragraphs: [{ id: "p1", text: "Edge" }] },
    });
    const triangle = buildShapeNode({
      id: "triangle",
      layout: buildLayoutBox({
        frame: { x: 10, y: 10, w: 20, h: 20 },
        zIndex: 3,
      }),
      content: { shape: "triangle" },
    });
    const diamond = buildShapeNode({
      id: "diamond",
      layout: buildLayoutBox({
        frame: { x: 40, y: 10, w: 20, h: 20 },
        zIndex: 4,
      }),
      content: { shape: "diamond" },
    });
    const ellipse = buildShapeNode({
      id: "ellipse",
      layout: buildLayoutBox({
        frame: { x: 10, y: 45, w: 20, h: 10 },
        zIndex: 5,
      }),
      content: { shape: "ellipse" },
    });
    const line = buildShapeNode({
      id: "line",
      layout: buildLayoutBox({
        frame: { x: 50, y: 45, w: 30, h: 10 },
        zIndex: 6,
        rotation: 30,
      }),
      content: { shape: "line" },
    });
    const connectors = [
      connector(
        "fallback-top",
        { kind: "node", nodeId: "missing", anchor: "top" },
        { kind: "point", point: { x: 100, y: 100 } },
        "elbow",
      ),
      connector(
        "fallback-right",
        { kind: "node", nodeId: "missing", anchor: "right" },
        { kind: "point", point: { x: 0, y: 0 } },
        "curved",
      ),
      connector(
        "fallback-bottom-left",
        { kind: "node", nodeId: "missing", anchor: "bottom" },
        { kind: "node", nodeId: "missing", anchor: "left" },
      ),
    ];

    assert.equal(
      hitTestSlideNodes({ x: 76, y: 76 }, [text])[0]?.reason,
      "text-content",
    );
    assert.equal(
      hitTestSlideNodes({ x: 20, y: 29 }, [triangle])[0]?.node.id,
      "triangle",
    );
    assert.equal(hitTestSlideNodes({ x: 11, y: 11 }, [triangle]).length, 0);
    assert.equal(
      hitTestSlideNodes({ x: 50, y: 20 }, [diamond])[0]?.node.id,
      "diamond",
    );
    assert.equal(hitTestSlideNodes({ x: 40, y: 10 }, [diamond]).length, 0);
    assert.equal(
      hitTestSlideNodes({ x: 20, y: 50 }, [ellipse])[0]?.node.id,
      "ellipse",
    );
    assert.equal(hitTestSlideNodes({ x: 10, y: 45 }, [ellipse]).length, 0);
    assert.equal(
      hitTestSlideNodes({ x: 65, y: 50 }, [line], {
        lineThresholdPct: 3,
        stageAspect: 1.6,
      })[0]?.reason,
      "line-stroke",
    );
    assert.ok(
      hitTestSlideNodes({ x: 50, y: 50 }, connectors, {
        lineThresholdPct: 100,
      }).length >= 3,
    );
  });

  test("repairSemanticDeckPlan emits malformed slot diagnostics and preserves safe unknown slots", () => {
    const registry = createDefaultTemplateRegistry();
    const result = repairSemanticDeckPlan(
      {
        planVersion: 1,
        title: "Repair coverage",
        locale: "en-US",
        slides: [
          null,
          {
            kind: "content",
            tone: "confident",
            density: "dense",
            emphasis: "action",
            speakerNotes: "Keep this note",
            slots: {
              title: {
                type: "shortText",
                text: "  This title has    normalized whitespace  ",
              },
              body: { type: "paragraph", paragraphs: "not an array" },
              bullets: { type: "bullets", items: [{ text: "ok" }, 7] },
              table: {
                type: "table",
                columns: ["A", 7],
                rows: [["ok"], "bad"],
              },
              visualExtra: {
                type: "visual",
                visualId: "visual-1",
                caption: "Chart",
              },
              imageExtra: { type: "image", assetId: 7, prompt: 8, alt: 9 },
              mystery: { type: "unknown" },
            },
          },
        ],
      },
      registry,
    );

    assert.equal(result.plan.title, "Repair coverage");
    assert.equal(result.plan.locale, "en-US");
    assert.equal(result.plan.slides.length, 1);
    assert.equal(result.plan.slides[0]?.speakerNotes, "Keep this note");
    assert.deepEqual(result.plan.slides[0]?.slots.title, {
      type: "shortText",
      text: "This title has normalized whitespace",
    });
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(
        result.plan.slides[0]?.slots ?? {},
        "visualExtra",
      )?.value,
      {
        type: "visual",
        visualId: "visual-1",
        caption: "Chart",
      },
    );
    assert.ok(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("slides[0] must be an object"),
      ),
    );
    assert.ok(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("paragraphs: must be an array"),
      ),
    );
    assert.ok(
      result.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("unsupported slot value type"),
      ),
    );
  });

  test("barrel exports remaining runtime helpers as live values", () => {
    assert.equal(typeof runtime.categoryForDiagnosticCode, "function");
    assert.equal(typeof runtime.retargetDiagnostic, "function");
    assert.equal(typeof runtime.getDiagnosticTarget, "function");
    assert.equal(typeof runtime.getDiagnosticNodeId, "function");
    assert.equal(typeof runtime.getDiagnosticSlideId, "function");
    assert.equal(typeof runtime.diagnosticTargetKey, "function");
    assert.equal(typeof runtime.diagnosticTargetLabel, "function");
    assert.equal(typeof runtime.groupDiagnostics, "function");
    assert.equal(typeof runtime.applyDiagnosticRepairAction, "function");
    assert.equal(typeof runtime.SUPPORTED_VISUAL_COLOR_CHANNELS, "object");
    assert.equal(typeof runtime.normalizeVisualChannelColors, "function");
    assert.equal(typeof runtime.insertTemplateSlide, "function");
    assert.equal(typeof runtime.cutNodes, "function");
    assert.equal(typeof runtime.detachDeckChrome, "function");
    assert.equal(typeof runtime.diffDeckNodes, "function");
    assert.equal(typeof runtime.pickUndoFocusTarget, "function");
    assert.equal(typeof runtime.openAiGeneratedDeck, "function");
    assert.equal(typeof runtime.decideDeckOpen, "function");
    assert.equal(typeof runtime.applyPptxSpec, "function");
  });
});
