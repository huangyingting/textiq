import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import {
  buildContextToolbarReorderActions,
  buildSlideToolInsertActions,
  ContextToolbar,
  contextToolbarTextRoleFontSizePt,
  isContextToolbarInlineTextCommandEnabled,
  isContextToolbarTextRole,
  routeContextToolbarAlign,
  routeContextToolbarConnectorArrow,
  routeContextToolbarConnectorRouting,
  routeContextToolbarConnectorStrokeColor,
  routeContextToolbarConnectorStrokeWidth,
  routeContextToolbarDeleteSlide,
  routeContextToolbarDetachDecoration,
  routeContextToolbarDistribute,
  routeContextToolbarFontSize,
  routeContextToolbarHideSelection,
  routeContextToolbarImageCropToggle,
  routeContextToolbarImageFit,
  routeContextToolbarLockToggle,
  routeContextToolbarMatchSize,
  routeContextToolbarOpacity,
  routeContextToolbarRotation,
  routeContextToolbarSlideBackground,
  routeContextToolbarTableHeaderToggle,
  routeContextToolbarTextAlign,
  routeContextToolbarTextColor,
  routeContextToolbarTextCommand,
  routeContextToolbarTextRoleChange,
  routeContextToolbarVisualBackgroundToggle,
  routeContextToolbarVisualThemeChange,
  resolveContextToolbarTextRole,
  restoreFocusAfterContextToolbarEscape,
  seedContextToolbarStyles,
  type SelectionAlignMode,
  type SelectionDistributeMode,
  type SelectionMatchSizeMode,
  tableWithAddedColumn,
  tableWithAddedRow,
  tableWithDeletedLastColumn,
  tableWithDeletedLastRow,
} from "./context-toolbar";
import { createHookRenderer } from "../slide-editor-failure-test-utils";
import type { SlideChildNode } from "@/lib/presentation/schema";
import type { StyleObject } from "@/lib/presentation/style-schema";
import {
  CURRENT_OBJECT_INSERT_NODE_COMMAND_DESCRIPTORS,
  currentObjectReorderCommandDescriptor,
} from "@/lib/presentation/current-object-command-descriptors";

const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "document",
);
const source = readFileSync(
  new URL("./floating-toolbar.tsx", import.meta.url),
  "utf8",
);

type ElementLike = ReactElement<Record<string, unknown>>;

function toolbarFixtureNode(node: unknown): SlideChildNode {
  return node as unknown as SlideChildNode;
}

function expandToolbarTree(
  node: ReactNode,
  collected: ElementLike[] = [],
): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) expandToolbarTree(child, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  collected.push(element);
  if (
    typeof element.type === "function" &&
    [
      "TBtn",
      "Divider",
      "ColorInput",
      "ToolbarSelect",
      "ToolbarNumber",
    ].includes(element.type.name)
  ) {
    expandToolbarTree(
      (element.type as (props: Record<string, unknown>) => ReactNode)(
        element.props,
      ),
      collected,
    );
  }
  const props = element.props as { children?: ReactNode; trigger?: ReactNode };
  expandToolbarTree(props.children, collected);
  expandToolbarTree(props.trigger, collected);
  return collected;
}

function renderToolbar(
  overrides: Partial<Parameters<typeof ContextToolbar>[0]>,
): ElementLike[] {
  const shapeNode: SlideChildNode = {
    id: "shape-1",
    type: "shape",
    role: "card",
    layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
    content: { shape: "rect" },
    localStyle: { text: { weight: 700, italic: true } },
  };
  const harness = createHookRenderer();
  return expandToolbarTree(
    harness.run(() =>
      ContextToolbar({
        selectedIds: ["shape-1"],
        selectedNode: shapeNode,
        selectedResolvedStyle: undefined,
        isInlineEditing: false,
        isDragging: false,
        isDecorationSelected: false,
        onDelete: () => undefined,
        onCut: () => undefined,
        onDuplicate: () => undefined,
        onGroup: () => undefined,
        onUngroup: () => undefined,
        onBringForward: () => undefined,
        onSendBackward: () => undefined,
        onUpdateSelectedContent: () => undefined,
        onUpdateSelectedLayout: () => undefined,
        onUpdateSelectedLocalStyle: () => undefined,
        onUpdateSelectedAttributes: () => undefined,
        ...overrides,
      }),
    ),
  );
}

function labels(elements: readonly ElementLike[]): string[] {
  return elements
    .map((element) => element.props["aria-label"] ?? element.props.label)
    .filter((label): label is string => typeof label === "string");
}

function invokeToolbarControls(elements: readonly ElementLike[]): void {
  for (const element of elements) {
    const props = element.props;
    if (typeof props.onClick === "function" && props.disabled !== true) {
      props.onClick();
    }
    if (typeof props.onChange === "function" && props.disabled !== true) {
      props.onChange({ currentTarget: { value: "#123456" } });
    }
    if (typeof props.onSubmit === "function") {
      props.onSubmit({ preventDefault: () => undefined });
    }
    if (typeof props.onKeyDown === "function") {
      props.onKeyDown({
        key: "Escape",
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
        target: null,
      });
    }
  }
}

describe("buildSlideToolInsertActions", () => {
  test("returns all current-object insertion actions in stable order", () => {
    const actions = buildSlideToolInsertActions({
      onInsertText: () => undefined,
      onInsertShape: () => undefined,
      onInsertImage: () => undefined,
      onInsertVisual: () => undefined,
      onInsertConnector: () => undefined,
      onInsertTable: () => undefined,
    });

    assert.deepEqual(
      actions.map((action) => action.label),
      [
        "Insert text",
        "Insert shape",
        "Insert image",
        "Insert visual",
        "Insert connector",
        "Insert table",
      ],
    );
    assert.deepEqual(
      actions.map((action) => action.commandId),
      CURRENT_OBJECT_INSERT_NODE_COMMAND_DESCRIPTORS.map(
        (descriptor) => descriptor.id,
      ),
    );
  });

  test("omits actions when callbacks are unavailable", () => {
    const actions = buildSlideToolInsertActions({
      onInsertText: () => undefined,
      onInsertTable: () => undefined,
    });

    assert.deepEqual(
      actions.map((action) => action.label),
      ["Insert text", "Insert table"],
    );
  });

  test("preserves callback wiring for keyboard-triggered inserts", () => {
    const calls: string[] = [];
    const actions = buildSlideToolInsertActions({
      onInsertText: () => calls.push("text"),
      onInsertShape: () => calls.push("shape"),
      onInsertImage: () => calls.push("image"),
      onInsertVisual: () => calls.push("visual"),
      onInsertConnector: () => calls.push("connector"),
      onInsertTable: () => calls.push("table"),
    });

    for (const action of actions) {
      action.onClick();
    }

    assert.deepEqual(calls, [
      "text",
      "shape",
      "image",
      "visual",
      "connector",
      "table",
    ]);
  });
});

describe("buildContextToolbarReorderActions", () => {
  test("returns current-object reorder actions in toolbar order", () => {
    const actions = buildContextToolbarReorderActions({
      onBringForward: () => undefined,
      onSendBackward: () => undefined,
      onBringToFront: () => undefined,
      onSendToBack: () => undefined,
    });

    assert.deepEqual(
      actions.map((action) => action.key),
      ["forward", "backward", "front", "back"],
    );
    assert.deepEqual(
      actions.map((action) => action.label),
      ["Bring forward", "Send backward", "Bring to front", "Send to back"],
    );
    assert.deepEqual(
      actions.map((action) => action.commandId),
      actions.map(
        (action) => currentObjectReorderCommandDescriptor(action.key).id,
      ),
    );
  });

  test("preserves callback wiring for z-order commands", () => {
    const calls: string[] = [];
    const actions = buildContextToolbarReorderActions({
      onBringForward: () => calls.push("forward"),
      onSendBackward: () => calls.push("backward"),
      onBringToFront: () => calls.push("front"),
      onSendToBack: () => calls.push("back"),
    });

    for (const action of actions) {
      action.onClick();
    }

    assert.deepEqual(calls, ["forward", "backward", "front", "back"]);
  });
});

afterEach(() => {
  if (originalDocumentDescriptor) {
    Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, "document");
});

describe("restoreFocusAfterContextToolbarEscape", () => {
  test("prefers explicit stage-focus callback", () => {
    let callbackCalls = 0;
    let blurCalls = 0;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        activeElement: {
          blur: () => {
            blurCalls += 1;
          },
        },
      },
    });

    restoreFocusAfterContextToolbarEscape(() => {
      callbackCalls += 1;
    });

    assert.equal(callbackCalls, 1);
    assert.equal(blurCalls, 0);
  });

  test("blurs active element when callback is absent", () => {
    let blurCalls = 0;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        activeElement: {
          blur: () => {
            blurCalls += 1;
          },
        },
      },
    });

    restoreFocusAfterContextToolbarEscape(undefined);

    assert.equal(blurCalls, 1);
  });

  test("is safe when document is unavailable", () => {
    Reflect.deleteProperty(globalThis, "document");
    assert.doesNotThrow(() => restoreFocusAfterContextToolbarEscape(undefined));
  });
});

describe("seedContextToolbarStyles", () => {
  test("seeds shape controls from resolved style values", () => {
    const node: SlideChildNode = {
      id: "shape-1",
      type: "shape",
      role: "card",
      layout: { frame: { x: 0, y: 0, w: 40, h: 20 }, zIndex: 1 },
      content: { shape: "rect" },
      localStyle: {},
    };
    const resolvedStyle: StyleObject = {
      text: { color: "#1d4ed8", fontSizePt: 26 },
      fill: { type: "solid", color: "#dbeafe" },
      stroke: { color: "#2563eb", widthPt: 3 },
      opacity: 0.84,
    };

    const seed = seedContextToolbarStyles(node, resolvedStyle);

    assert.equal(seed.textColor, "#1d4ed8");
    assert.equal(seed.fontSize, 26);
    assert.equal(seed.fillColor, "#dbeafe");
    assert.equal(seed.shapeStrokeColor, "#2563eb");
    assert.equal(seed.shapeStrokeWidth, 3);
    assert.equal(seed.opacity, 0.84);
  });

  test("seeds connector controls from resolved connector stroke values", () => {
    const node: SlideChildNode = {
      id: "connector-1",
      type: "connector",
      role: "connector",
      layout: { frame: { x: 0, y: 0, w: 40, h: 20 }, zIndex: 1 },
      content: {
        from: { kind: "point", point: { x: 0, y: 0 } },
        to: { kind: "point", point: { x: 100, y: 100 } },
      },
      localStyle: {},
    };
    const resolvedStyle: StyleObject = {
      connector: {
        stroke: { color: "#0f172a", widthPt: 2.5, dash: "dashed" },
        startArrow: "filled",
        endArrow: "none",
      },
    };

    const seed = seedContextToolbarStyles(node, resolvedStyle);

    assert.equal(seed.connectorStrokeColor, "#0f172a");
    assert.equal(seed.connectorStrokeWidth, 2.5);
    assert.equal(seed.connectorStartArrow, "filled");
    assert.equal(seed.connectorEndArrow, "none");
  });

  test("seeds fallback style controls from local styles and defaults", () => {
    const node: SlideChildNode = {
      id: "shape-local",
      type: "shape",
      role: "card",
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
      content: { shape: "rect" },
      localStyle: {
        fill: { type: "solid", color: "#f8fafc" },
        stroke: { color: "#64748b", widthPt: 2 },
        connector: {
          stroke: { color: "#334155", widthPt: 4 },
          startArrow: "arrow",
          endArrow: "filled",
        },
        text: { color: "#0f172a", fontSizePt: 20 },
        opacity: 0.5,
      },
    };

    const localSeed = seedContextToolbarStyles(node, undefined);
    assert.equal(localSeed.fillColor, "#f8fafc");
    assert.equal(localSeed.shapeStrokeColor, "#64748b");
    assert.equal(localSeed.shapeStrokeWidth, 2);
    assert.equal(localSeed.connectorStrokeColor, "#334155");
    assert.equal(localSeed.connectorStrokeWidth, 4);
    assert.equal(localSeed.connectorStartArrow, "arrow");
    assert.equal(localSeed.connectorEndArrow, "filled");
    assert.equal(localSeed.textColor, "#0f172a");
    assert.equal(localSeed.fontSize, 20);
    assert.equal(localSeed.opacity, 0.5);

    const defaultSeed = seedContextToolbarStyles(undefined, undefined);
    assert.equal(defaultSeed.fillColor, "#ffffff");
    assert.equal(defaultSeed.connectorEndArrow, "arrow");
    assert.equal(defaultSeed.opacity, 1);
  });
});

describe("context toolbar measurement scheduling", () => {
  test("does not keep a requestAnimationFrame polling loop alive", () => {
    assert.equal(source.includes("const tick = () => {"), false);
    assert.equal(
      source.includes("frame = window.requestAnimationFrame(tick);"),
      false,
    );
  });

  test("updates position from event and observer scheduling", () => {
    assert.equal(
      source.includes("const schedulePositionUpdate = () => {"),
      true,
    );
    assert.equal(
      source.includes("new ResizeObserver(schedulePositionUpdate)"),
      true,
    );
    assert.equal(
      source.includes("new MutationObserver(schedulePositionUpdate)"),
      true,
    );
  });
});

describe("inline align persistence wiring", () => {
  test("always mirrors align commands to persistent local style patches", () => {
    assert.equal(
      source.includes("onUpdateSelectedLocalStyle?.({ text: { align } });"),
      true,
    );
    assert.equal(
      source.includes(
        "if (!isInlineEditing) onUpdateSelectedLocalStyle?.({ text: { align } });",
      ),
      false,
    );
  });
});

describe("strikethrough toolbar persistence wiring", () => {
  test("routes strikethrough through runTextCommand and local style updates", () => {
    assert.equal(source.includes("command: ContextToolbarTextCommand"), true);
    assert.equal(
      source.includes("text: { strikethrough: !textStyle?.strikethrough }"),
      true,
    );
    assert.equal(
      source.includes('onClick={() => runTextCommand("strikethrough")}'),
      true,
    );
  });
});

describe("text role semantic persistence", () => {
  test("normalizes and validates context-toolbar text role options", () => {
    assert.equal(isContextToolbarTextRole("kicker"), true);
    assert.equal(isContextToolbarTextRole("title"), true);
    assert.equal(isContextToolbarTextRole("quote"), true);
    assert.equal(isContextToolbarTextRole("metric"), true);
    assert.equal(isContextToolbarTextRole("card"), false);
    assert.equal(resolveContextToolbarTextRole(undefined), "body");
    assert.equal(resolveContextToolbarTextRole("card"), "body");
    assert.equal(resolveContextToolbarTextRole("kicker"), "kicker");
    assert.equal(resolveContextToolbarTextRole("subtitle"), "subtitle");
  });

  test("maps text roles to stable toolbar font-size presets", () => {
    assert.equal(contextToolbarTextRoleFontSizePt("kicker"), 11);
    assert.equal(contextToolbarTextRoleFontSizePt("title"), 34);
    assert.equal(contextToolbarTextRoleFontSizePt("subtitle"), 24);
    assert.equal(contextToolbarTextRoleFontSizePt("body"), 18);
    assert.equal(contextToolbarTextRoleFontSizePt("quote"), 26);
    assert.equal(contextToolbarTextRoleFontSizePt("caption"), 11);
    assert.equal(contextToolbarTextRoleFontSizePt("metric"), 40);
  });

  test("routes text-role changes through node attributes and disables without selection", () => {
    assert.equal(
      source.includes("onUpdateSelectedAttributes?.({ role });"),
      true,
    );
    assert.equal(
      source.includes(
        "disabled={!selectedNode || !onUpdateSelectedAttributes}",
      ),
      true,
    );
  });
});

describe("context toolbar more-menu accessibility wiring", () => {
  test("exposes the More trigger as a menu button", () => {
    assert.equal(source.includes('hasPopup="menu"'), true);
    assert.equal(source.includes("buttonRef={moreMenuTriggerRef}"), true);
    assert.equal(
      source.includes("controls={moreOpen ? moreMenuId : undefined}"),
      true,
    );
  });

  test("focuses and keyboard-navigates menu commands", () => {
    assert.equal(
      source.includes("focusFirstMenuCommand(moreMenuRef.current)"),
      true,
    );
    assert.equal(source.includes("onKeyDown={handleMoreMenuKeyDown}"), true);
    assert.equal(source.includes("moveMenuCommandFocus({"), true);
    assert.equal(source.includes("closeMoreMenuAndRestoreFocus();"), true);
  });
});

describe("slide delete affordance wiring", () => {
  test("threads canDeleteSlide into the context-toolbar contract", () => {
    assert.equal(source.includes("canDeleteSlide?: boolean;"), true);
    assert.equal(source.includes("canDeleteSlide = true,"), true);
  });

  test("disables Delete slide when deletion is unavailable", () => {
    assert.equal(
      source.includes("disabled={!canDeleteSlide || !onDeleteSlide}"),
      true,
    );
  });
});

describe("isContextToolbarInlineTextCommandEnabled", () => {
  test("disables inline-only commands outside inline edit mode", () => {
    assert.equal(
      isContextToolbarInlineTextCommandEnabled("bullet-list", false),
      false,
    );
    assert.equal(
      isContextToolbarInlineTextCommandEnabled("numbered-list", false),
      false,
    );
    assert.equal(
      isContextToolbarInlineTextCommandEnabled("indent-list", false),
      false,
    );
    assert.equal(
      isContextToolbarInlineTextCommandEnabled("outdent-list", false),
      false,
    );
    assert.equal(
      isContextToolbarInlineTextCommandEnabled("link", false),
      false,
    );
    assert.equal(
      isContextToolbarInlineTextCommandEnabled("unlink", false),
      false,
    );
  });

  test("keeps text commands enabled in inline edit mode", () => {
    assert.equal(
      isContextToolbarInlineTextCommandEnabled("bullet-list", true),
      true,
    );
    assert.equal(
      isContextToolbarInlineTextCommandEnabled("numbered-list", true),
      true,
    );
    assert.equal(
      isContextToolbarInlineTextCommandEnabled("indent-list", true),
      true,
    );
    assert.equal(
      isContextToolbarInlineTextCommandEnabled("outdent-list", true),
      true,
    );
    assert.equal(isContextToolbarInlineTextCommandEnabled("link", true), true);
    assert.equal(
      isContextToolbarInlineTextCommandEnabled("unlink", true),
      true,
    );
  });

  test("does not disable commands that already mutate selected node style", () => {
    assert.equal(isContextToolbarInlineTextCommandEnabled("bold", false), true);
    assert.equal(
      isContextToolbarInlineTextCommandEnabled("italic", false),
      true,
    );
    assert.equal(
      isContextToolbarInlineTextCommandEnabled("underline", false),
      true,
    );
    assert.equal(
      isContextToolbarInlineTextCommandEnabled("strikethrough", false),
      true,
    );
    assert.equal(
      isContextToolbarInlineTextCommandEnabled("align-left", false),
      true,
    );
    assert.equal(
      isContextToolbarInlineTextCommandEnabled("font-size", false),
      true,
    );
  });
});

describe("context toolbar routing helpers", () => {
  test("routes text formatting commands through inline command dispatch and persisted style patches", () => {
    const dispatched: unknown[] = [];
    const patches: unknown[] = [];

    routeContextToolbarTextCommand({
      command: "strikethrough",
      isInlineEditing: false,
      textStyle: { strikethrough: false },
      onUpdateSelectedLocalStyle: (patch) => patches.push(patch),
      dispatchCommand: (payload) => dispatched.push(payload),
    });

    assert.deepEqual(dispatched, [{ command: "strikethrough" }]);
    assert.deepEqual(patches, [{ text: { strikethrough: true } }]);
  });

  test("skips persisted text style patches while inline editing", () => {
    const dispatched: unknown[] = [];
    const patches: unknown[] = [];

    routeContextToolbarTextCommand({
      command: "bold",
      isInlineEditing: true,
      textStyle: { weight: 400 },
      onUpdateSelectedLocalStyle: (patch) => patches.push(patch),
      dispatchCommand: (payload) => dispatched.push(payload),
    });

    assert.deepEqual(dispatched, [{ command: "bold" }]);
    assert.deepEqual(patches, []);
  });

  test("routes text color, alignment, and font-size updates with the expected payloads", () => {
    const dispatched: unknown[] = [];
    const patches: unknown[] = [];

    routeContextToolbarTextColor({
      color: "#2563eb",
      isInlineEditing: false,
      onUpdateSelectedLocalStyle: (patch) => patches.push(patch),
      dispatchCommand: (payload) => dispatched.push(payload),
    });
    routeContextToolbarTextAlign({
      align: "center",
      onUpdateSelectedLocalStyle: (patch) => patches.push(patch),
      dispatchCommand: (payload) => dispatched.push(payload),
    });
    routeContextToolbarFontSize({
      value: 28,
      isInlineEditing: false,
      onUpdateSelectedLocalStyle: (patch) => patches.push(patch),
      dispatchCommand: (payload) => dispatched.push(payload),
    });

    assert.deepEqual(dispatched, [
      { command: "color", value: "#2563eb" },
      { command: "align-center" },
      { command: "font-size", value: "28pt" },
    ]);
    assert.deepEqual(patches, [
      { text: { color: "#2563eb" } },
      { text: { align: "center" } },
      { text: { fontSizePt: 28 } },
    ]);
  });

  test("routes text role updates through attributes plus semantic font-size defaults", () => {
    const attributes: unknown[] = [];
    const stylePatches: unknown[] = [];

    routeContextToolbarTextRoleChange({
      role: "kicker",
      onUpdateSelectedAttributes: (patch) => attributes.push(patch),
      onUpdateSelectedLocalStyle: (patch) => stylePatches.push(patch),
    });
    routeContextToolbarTextRoleChange({
      role: "not-a-role",
      onUpdateSelectedAttributes: (patch) => attributes.push(patch),
      onUpdateSelectedLocalStyle: (patch) => stylePatches.push(patch),
    });

    assert.deepEqual(attributes, [{ role: "kicker" }]);
    assert.deepEqual(stylePatches, [{ text: { fontSizePt: 11 } }]);
  });

  test("routes image crop and fit commands through selected-content patches", () => {
    const imageNodeNoCrop: SlideChildNode = {
      id: "image-1",
      type: "image",
      role: "image",
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
      content: { assetId: "asset-1", fit: "cover" },
      localStyle: {},
    };
    const imageNodeCropped: SlideChildNode = {
      ...imageNodeNoCrop,
      content: {
        ...imageNodeNoCrop.content,
        crop: { top: 4, right: 4, bottom: 4, left: 4 },
      },
    };
    const contentPatches: unknown[] = [];
    let resetCalls = 0;

    routeContextToolbarImageCropToggle({
      selectedNode: imageNodeNoCrop,
      onUpdateSelectedContent: (patch) => contentPatches.push(patch),
      onResetImageCrop: () => {
        resetCalls += 1;
      },
    });
    routeContextToolbarImageCropToggle({
      selectedNode: imageNodeCropped,
      onUpdateSelectedContent: (patch) => contentPatches.push(patch),
      onResetImageCrop: () => {
        resetCalls += 1;
      },
    });
    routeContextToolbarImageFit({
      fit: "contain",
      onUpdateSelectedContent: (patch) => contentPatches.push(patch),
    });

    assert.deepEqual(contentPatches, [
      { crop: { top: 8, right: 8, bottom: 8, left: 8 } },
      { fit: "contain" },
    ]);
    assert.equal(resetCalls, 1);
  });

  test("routes visual, connector, and table controls with expected callback payloads", () => {
    const visualNode: SlideChildNode = {
      id: "visual-1",
      type: "visual",
      role: "visual",
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
      content: { visualId: "v1", transparentBackground: false },
      localStyle: { visual: { styleThemeId: "default" } },
    };
    const connectorNode: SlideChildNode = {
      id: "connector-1",
      type: "connector",
      role: "connector",
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
      content: {
        from: { kind: "point", point: { x: 0, y: 0 } },
        to: { kind: "point", point: { x: 10, y: 10 } },
        routing: "straight",
      },
      localStyle: { connector: { endArrow: "arrow" } },
    };
    const tableNode: SlideChildNode = {
      id: "table-1",
      type: "table",
      role: "table",
      layout: { frame: { x: 0, y: 0, w: 20, h: 10 }, zIndex: 1 },
      content: {
        columns: [
          { id: "c1", label: "A" },
          { id: "c2", label: "B" },
        ],
        rows: [
          { id: "r1", cells: [{ text: "1" }, { text: "2" }] },
          { id: "r2", cells: [{ text: "3" }, { text: "4" }] },
        ],
        header: true,
      },
      localStyle: {},
    };

    const contentPatches: unknown[] = [];
    const stylePatches: unknown[] = [];

    routeContextToolbarVisualBackgroundToggle({
      selectedNode: visualNode,
      onUpdateSelectedContent: (patch) => contentPatches.push(patch),
    });
    routeContextToolbarVisualThemeChange({
      selectedNode: visualNode,
      styleThemeId: "accent",
      onUpdateSelectedLocalStyle: (patch) => stylePatches.push(patch),
    });
    routeContextToolbarConnectorRouting({
      routing: "elbow",
      onUpdateSelectedContent: (patch) => contentPatches.push(patch),
    });
    routeContextToolbarConnectorStrokeColor({
      color: "#0f172a",
      connectorStrokeWidth: 2.5,
      onUpdateSelectedLocalStyle: (patch) => stylePatches.push(patch),
    });
    routeContextToolbarConnectorStrokeWidth({
      widthPt: 3,
      connectorStrokeColor: "#334155",
      onUpdateSelectedLocalStyle: (patch) => stylePatches.push(patch),
    });
    routeContextToolbarConnectorArrow({
      selectedNode: connectorNode,
      edge: "startArrow",
      value: "filled",
      onUpdateSelectedLocalStyle: (patch) => stylePatches.push(patch),
    });
    routeContextToolbarTableHeaderToggle({
      selectedNode: tableNode,
      onUpdateSelectedContent: (patch) => contentPatches.push(patch),
    });
    routeContextToolbarOpacity({
      value: 75,
      onUpdateSelectedLocalStyle: (patch) => stylePatches.push(patch),
    });

    assert.deepEqual(contentPatches, [
      { transparentBackground: true },
      { routing: "elbow" },
      { header: false },
    ]);
    assert.deepEqual(stylePatches, [
      { visual: { styleThemeId: "accent" } },
      { connector: { stroke: { color: "#0f172a", widthPt: 2.5 } } },
      { connector: { stroke: { color: "#334155", widthPt: 3 } } },
      { connector: { endArrow: "arrow", startArrow: "filled" } },
      { opacity: 0.75 },
    ]);

    const withAddedRow = tableWithAddedRow(tableNode);
    const withAddedColumn = tableWithAddedColumn(tableNode);
    const withDeletedRow = tableWithDeletedLastRow(tableNode);
    const withDeletedColumn = tableWithDeletedLastColumn(tableNode);
    assert.equal(withAddedRow.rows.length, 3);
    assert.equal(withAddedColumn.columns.length, 3);
    assert.equal(withDeletedRow.rows.length, 1);
    assert.equal(withDeletedColumn.columns.length, 1);
  });

  test("routes arrange, lock/hide, decoration, and slide-level actions", () => {
    const alignCalls: string[] = [];
    const distributeCalls: string[] = [];
    const matchCalls: string[] = [];
    const layoutPatches: unknown[] = [];
    const attributePatches: unknown[] = [];
    const slideStylePatches: unknown[] = [];
    let deleteCalls = 0;
    let detachCalls = 0;

    routeContextToolbarRotation({
      rotation: 30,
      delta: -15,
      onUpdateSelectedLayout: (patch) => layoutPatches.push(patch),
    });
    routeContextToolbarAlign({
      mode: "left",
      onAlignSelection: (mode) => alignCalls.push(mode),
    });
    routeContextToolbarDistribute({
      mode: "horizontal",
      onDistributeSelection: (mode) => distributeCalls.push(mode),
    });
    routeContextToolbarMatchSize({
      mode: "both",
      onMatchSize: (mode) => matchCalls.push(mode),
    });
    routeContextToolbarLockToggle({
      selectedNode: {
        id: "shape-1",
        type: "shape",
        role: "card",
        layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
        content: { shape: "rect" },
        localStyle: {},
      },
      onUpdateSelectedAttributes: (patch) => attributePatches.push(patch),
    });
    routeContextToolbarHideSelection({
      onUpdateSelectedAttributes: (patch) => attributePatches.push(patch),
    });
    routeContextToolbarSlideBackground({
      color: "#111827",
      onUpdateSlideLocalStyle: (patch) => slideStylePatches.push(patch),
    });

    const deleted = routeContextToolbarDeleteSlide({
      canDeleteSlide: true,
      onDeleteSlide: () => {
        deleteCalls += 1;
      },
    });
    const skippedDelete = routeContextToolbarDeleteSlide({
      canDeleteSlide: false,
      onDeleteSlide: () => {
        deleteCalls += 1;
      },
    });
    routeContextToolbarDetachDecoration({
      onDetachDecoration: () => {
        detachCalls += 1;
      },
    });

    assert.deepEqual(layoutPatches, [{ rotation: 15 }]);
    assert.deepEqual(alignCalls, ["left"]);
    assert.deepEqual(distributeCalls, ["horizontal"]);
    assert.deepEqual(matchCalls, ["both"]);
    assert.deepEqual(attributePatches, [{ locked: true }, { hidden: true }]);
    assert.deepEqual(slideStylePatches, [
      { slide: { background: { type: "solid", color: "#111827" } } },
    ]);
    assert.equal(deleted, true);
    assert.equal(skippedDelete, false);
    assert.equal(deleteCalls, 1);
    assert.equal(detachCalls, 1);
  });
});

describe("ContextToolbar render branches", () => {
  test("renders slide insertion tools when no object is selected", () => {
    const elements = renderToolbar({
      selectedIds: [],
      selectedNode: undefined,
      onUpdateSlideLocalStyle: () => undefined,
      onInsertSlide: () => undefined,
      onInsertText: () => undefined,
      onInsertShape: () => undefined,
      onInsertImage: () => undefined,
      onInsertVisual: () => undefined,
      onInsertConnector: () => undefined,
      onInsertTable: () => undefined,
      onDuplicateSlide: () => undefined,
      onDeleteSlide: () => undefined,
      canDeleteSlide: false,
    });

    assert.ok(labels(elements).includes("Slide background"));
    assert.ok(labels(elements).includes("Add slide"));
    assert.ok(labels(elements).includes("Insert connector"));
    assert.ok(labels(elements).includes("Delete slide"));
  });

  test("renders text and shape controls for a selected shape", () => {
    const elements = renderToolbar({});
    const renderedLabels = labels(elements);

    assert.ok(renderedLabels.includes("Bold"));
    assert.ok(renderedLabels.includes("Text role"));
    assert.ok(renderedLabels.includes("Bullet list"));
    assert.ok(renderedLabels.includes("Text color"));
    assert.ok(renderedLabels.includes("Fill color"));
    assert.ok(renderedLabels.includes("Border color"));
    assert.ok(renderedLabels.includes("Opacity"));
    assert.ok(renderedLabels.includes("Rotate left 15°"));
    assert.ok(renderedLabels.includes("Bring to front"));
    assert.ok(renderedLabels.includes("More"));
  });

  test("renders media, visual, connector, table, multi-select, and decoration branches", () => {
    const imageNode: SlideChildNode = {
      id: "image-1",
      type: "image",
      role: "image",
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
      content: {
        assetId: "asset-1",
        crop: { top: 1, right: 2, bottom: 3, left: 4 },
        fit: "contain",
      },
      localStyle: {},
    };
    const visualNode: SlideChildNode = {
      id: "visual-1",
      type: "visual",
      role: "visual",
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
      content: { visualId: "visual-1", transparentBackground: true },
      localStyle: { visual: { styleThemeId: "accent" } },
    };
    const connectorNode: SlideChildNode = {
      id: "connector-1",
      type: "connector",
      role: "connector",
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
      content: {
        from: { kind: "point", point: { x: 0, y: 0 } },
        to: { kind: "point", point: { x: 10, y: 10 } },
        routing: "curved",
      },
      localStyle: {},
    };
    const tableNode: SlideChildNode = {
      id: "table-1",
      type: "table",
      role: "table",
      layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
      content: {
        columns: [{ id: "col-1", label: "A" }],
        rows: [{ id: "row-1", cells: [{ text: "A" }] }],
      },
      localStyle: {},
    };

    assert.ok(
      labels(
        renderToolbar({
          selectedIds: ["image-1"],
          selectedNode: imageNode,
          onReplaceImage: () => undefined,
          onResetImageCrop: () => undefined,
        }),
      ).includes("Reset crop"),
    );
    assert.ok(
      labels(
        renderToolbar({
          selectedIds: ["visual-1"],
          selectedNode: visualNode,
          onReplaceVisual: () => undefined,
        }),
      ).includes("Visual theme"),
    );
    assert.ok(
      labels(
        renderToolbar({
          selectedIds: ["connector-1"],
          selectedNode: connectorNode,
        }),
      ).includes("End arrow"),
    );
    assert.ok(
      labels(
        renderToolbar({
          selectedIds: ["table-1"],
          selectedNode: tableNode,
          onEnterTableEdit: () => undefined,
        }),
      ).includes("Toggle header row"),
    );
    assert.ok(
      labels(
        renderToolbar({
          selectedIds: ["a", "b", "c"],
          selectedNode: { ...tableNode, id: "a" },
          onAlignSelection: () => undefined,
          onDistributeSelection: () => undefined,
          onMatchSize: () => undefined,
        }),
      ).includes("Distribute horizontally"),
    );
    assert.ok(
      labels(
        renderToolbar({
          isDecorationSelected: true,
          onDetachDecoration: () => undefined,
        }),
      ).includes("Detach from theme"),
    );
    assert.ok(renderToolbar({ isDragging: true }).length > 0);
  });

  test("invokes public controls from rendered toolbar variants", () => {
    const calls: unknown[] = [];
    const callbacks = {
      onDelete: () => calls.push("delete"),
      onCut: () => calls.push("cut"),
      onDuplicate: () => calls.push("duplicate"),
      onGroup: () => calls.push("group"),
      onUngroup: () => calls.push("ungroup"),
      onBringForward: () => calls.push("forward"),
      onSendBackward: () => calls.push("backward"),
      onBringToFront: () => calls.push("front"),
      onSendToBack: () => calls.push("back"),
      onAlignSelection: (mode: SelectionAlignMode) => calls.push(mode),
      onDistributeSelection: (mode: SelectionDistributeMode) =>
        calls.push(mode),
      onMatchSize: (mode: SelectionMatchSizeMode) => calls.push(mode),
      onUpdateSelectedContent: (patch: unknown) => calls.push(patch),
      onUpdateSelectedLayout: (patch: unknown) => calls.push(patch),
      onUpdateSelectedLocalStyle: (patch: unknown) => calls.push(patch),
      onUpdateSelectedAttributes: (patch: unknown) => calls.push(patch),
      onReplaceImage: () => calls.push("replace-image"),
      onReplaceVisual: () => calls.push("replace-visual"),
      onResetImageCrop: () => calls.push("reset-crop"),
      onEnterTableEdit: () => calls.push("table-edit"),
      onUpdateSlideLocalStyle: (patch: unknown) => calls.push(patch),
      onInsertSlide: () => calls.push("insert-slide"),
      onInsertText: () => calls.push("insert-text"),
      onInsertShape: () => calls.push("insert-shape"),
      onInsertImage: () => calls.push("insert-image"),
      onInsertVisual: () => calls.push("insert-visual"),
      onInsertConnector: () => calls.push("insert-connector"),
      onInsertTable: () => calls.push("insert-table"),
      onDuplicateSlide: () => calls.push("duplicate-slide"),
      onDeleteSlide: () => calls.push("delete-slide"),
      onDetachDecoration: () => calls.push("detach"),
      onRequestStageFocus: () => calls.push("stage-focus"),
    };
    const variants = [
      renderToolbar({ selectedIds: [], selectedNode: undefined, ...callbacks }),
      renderToolbar({ ...callbacks }),
      renderToolbar({
        selectedIds: ["image-1"],
        selectedNode: toolbarFixtureNode({
          id: "image-1",
          type: "image",
          role: "image",
          layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
          content: {
            assetId: "asset-1",
            crop: { top: 1, right: 2, bottom: 3, left: 4 },
            fit: "cover",
          },
        }),
        ...callbacks,
      }),
      renderToolbar({
        selectedIds: ["visual-1"],
        selectedNode: toolbarFixtureNode({
          id: "visual-1",
          type: "visual",
          role: "visual",
          layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
          content: { visualId: "visual-1", transparentBackground: false },
          localStyle: { visual: { styleThemeId: "default" } },
        }),
        ...callbacks,
      }),
      renderToolbar({
        selectedIds: ["connector-1"],
        selectedNode: toolbarFixtureNode({
          id: "connector-1",
          type: "connector",
          role: "connector",
          layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
          content: {
            from: { kind: "point", point: { x: 0, y: 0 } },
            to: { kind: "point", point: { x: 10, y: 10 } },
            routing: "straight",
          },
          localStyle: { connector: { startArrow: "none", endArrow: "arrow" } },
        }),
        ...callbacks,
      }),
      renderToolbar({
        selectedIds: ["table-1"],
        selectedNode: toolbarFixtureNode({
          id: "table-1",
          type: "table",
          role: "table",
          layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
          content: {
            columns: [
              { id: "col-1", label: "A" },
              { id: "col-2", label: "B" },
            ],
            rows: [
              { id: "row-1", cells: [{ text: "A" }, { text: "B" }] },
              { id: "row-2", cells: [{ text: "C" }, { text: "D" }] },
            ],
            header: false,
          },
        }),
        ...callbacks,
      }),
      renderToolbar({
        selectedIds: ["a", "b", "c"],
        selectedNode: toolbarFixtureNode({
          id: "a",
          type: "group",
          role: "group",
          layout: { frame: { x: 0, y: 0, w: 10, h: 10 }, zIndex: 1 },
          children: [],
        }),
        ...callbacks,
      }),
    ];

    for (const elements of variants) invokeToolbarControls(elements);

    assert.ok(calls.includes("insert-slide"));
    assert.ok(calls.includes("delete"));
    assert.ok(calls.length > 10);
  });
});
