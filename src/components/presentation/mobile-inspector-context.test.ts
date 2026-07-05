import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { defaultConnectorNode } from "@/lib/presentation/node-asset-factories";
import type { InspectorPanelId } from "@/lib/presentation/inspector-panel-ui";
import type { SlideChildNode } from "@/lib/presentation/schema";
import {
  buildImageNode,
  buildShapeNode,
  buildSlide,
  buildTableNode,
  buildTextNode,
} from "@/test/builders/presentation-deck";

import { buildMobileInspectorContext } from "./mobile-inspector-context";

function context({
  selectedNode,
  selectedIds = selectedNode ? [selectedNode.id] : [],
  requestedPanel,
}: {
  selectedNode?: SlideChildNode;
  selectedIds?: readonly string[];
  requestedPanel?: InspectorPanelId;
} = {}) {
  return buildMobileInspectorContext({
    activeSlide: buildSlide(),
    selectedNode,
    selectedIds,
    isDecorationSelected: false,
    requestedPanel,
    hasDiagnostics: false,
  });
}

describe("buildMobileInspectorContext", () => {
  test("labels default mobile inspector targets by current selection", () => {
    const text = buildTextNode({ id: "text-1" });
    const image = buildImageNode("img-1", { id: "image-1" });
    const connector = {
      ...defaultConnectorNode(3),
      id: "connector-1",
    } as SlideChildNode;
    const table = buildTableNode({ id: "table-1" });

    assert.deepEqual(
      [
        context(),
        context({ selectedNode: text }),
        context({ selectedNode: image }),
        context({ selectedNode: connector }),
        context({ selectedNode: table }),
        context({ selectedNode: text, selectedIds: ["text-1", "image-1"] }),
        context({ selectedNode: text, requestedPanel: "source" }),
        context({ requestedPanel: "notes" }),
        context({ requestedPanel: "layers" }),
      ].map(({ targetLabel, actionLabel, activePanel }) => ({
        targetLabel,
        actionLabel,
        activePanel,
      })),
      [
        {
          targetLabel: "Slide",
          actionLabel: "Edit slide",
          activePanel: "slide",
        },
        { targetLabel: "Text", actionLabel: "Edit text", activePanel: "text" },
        {
          targetLabel: "Image",
          actionLabel: "Edit image",
          activePanel: "image",
        },
        {
          targetLabel: "Connector",
          actionLabel: "Edit connector",
          activePanel: "line",
        },
        {
          targetLabel: "Table",
          actionLabel: "Edit table",
          activePanel: "table",
        },
        {
          targetLabel: "2 selected",
          actionLabel: "Edit selected objects",
          activePanel: "arrange",
        },
        {
          targetLabel: "Source",
          actionLabel: "Edit source",
          activePanel: "source",
        },
        {
          targetLabel: "Notes",
          actionLabel: "Edit notes",
          activePanel: "notes",
        },
        {
          targetLabel: "Layers",
          actionLabel: "Edit layers",
          activePanel: "layers",
        },
      ],
    );
  });

  test("keeps the last compatible panel and falls back to the current object", () => {
    const text = buildTextNode({ id: "text-1" });
    const image = buildImageNode("img-1", { id: "image-1" });
    const shape = buildShapeNode({ id: "shape-1" });

    assert.equal(
      context({ selectedNode: text, requestedPanel: "source" }).activePanel,
      "source",
    );
    assert.equal(
      context({ selectedNode: image, requestedPanel: "adjust" }).activePanel,
      "adjust",
    );
    assert.equal(
      context({ selectedNode: shape, requestedPanel: "adjust" }).activePanel,
      "shape",
    );
  });
});
