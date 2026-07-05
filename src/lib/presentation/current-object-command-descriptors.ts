import type { InspectorPanelId } from "./inspector-panel-ui";

export const CURRENT_OBJECT_COMMAND_SURFACES = [
  "toolbar",
  "popover",
  "inspector",
  "keyboard",
  "stage",
] as const;

export type CurrentObjectCommandSurface =
  (typeof CURRENT_OBJECT_COMMAND_SURFACES)[number];

export const CURRENT_OBJECT_COMMAND_SURFACE_LABELS = {
  toolbar: "Primary toolbar",
  popover: "Context toolbar",
  inspector: "Inspector",
  keyboard: "Keyboard",
  stage: "Stage gesture",
} as const satisfies Record<CurrentObjectCommandSurface, string>;

export const CURRENT_OBJECT_DISABLED_REASONS = [
  "missing-current-slide",
  "missing-selection",
  "missing-handler",
  "requires-node-selection",
  "requires-single-selection",
  "requires-multi-selection",
  "requires-three-selections",
  "requires-inline-editing",
  "unsupported-current-object",
  "minimum-slide-count",
  "locked-selection",
  "decoration-selection",
  "read-only-source",
] as const;

export type CurrentObjectCommandDisabledReason =
  (typeof CURRENT_OBJECT_DISABLED_REASONS)[number];

export const CURRENT_OBJECT_DISABLED_REASON_LABELS = {
  "missing-current-slide": "Select or create a slide first.",
  "missing-selection": "Select an object first.",
  "missing-handler": "This command is not available in this surface.",
  "requires-node-selection": "Select a slide object first.",
  "requires-single-selection": "Select a single object first.",
  "requires-multi-selection": "Select multiple objects first.",
  "requires-three-selections": "Select at least three objects first.",
  "requires-inline-editing": "Enter text editing to use this command.",
  "unsupported-current-object": "This command does not apply here.",
  "minimum-slide-count": "A deck must keep at least one slide.",
  "locked-selection": "Unlock the selected object first.",
  "decoration-selection": "Detach the decoration before editing it.",
  "read-only-source": "Review or unlink the source before editing it.",
} as const satisfies Record<CurrentObjectCommandDisabledReason, string>;

export type CurrentObjectKind =
  | "slide"
  | "text"
  | "shape"
  | "image"
  | "visual"
  | "connector"
  | "table"
  | "group"
  | "multi-selection"
  | "decoration"
  | "diagnostic"
  | "source-review";

export const CURRENT_OBJECT_COMMAND_FAMILIES = [
  "insert-slide",
  "insert-node",
  "duplicate-slide",
  "delete-slide",
  "update-slide-style",
  "format-text",
  "update-node-style",
  "update-node-content",
  "align-selection",
  "distribute-selection",
  "match-selection-size",
  "reorder-selection",
  "group-selection",
  "ungroup-selection",
  "duplicate-selection",
  "delete-selection",
  "cut-selection",
  "update-node-attributes",
  "stage-select",
  "stage-transform",
  "create-connector",
  "review-source",
  "repair-diagnostic",
] as const;

export type CurrentObjectCommandFamily =
  (typeof CURRENT_OBJECT_COMMAND_FAMILIES)[number];

export type CurrentObjectCommandOwner = {
  surface: CurrentObjectCommandSurface;
  ownerId: string;
  inspectorPanel?: InspectorPanelId;
};

export type CurrentObjectCommandDescriptor = {
  id: string;
  family: CurrentObjectCommandFamily;
  label: string;
  shortLabel?: string;
  accessibilityLabel: string;
  liveMessage: string;
  shortcut?: string;
  currentObjects: readonly CurrentObjectKind[];
  owners: readonly CurrentObjectCommandOwner[];
  disabledReasons: readonly CurrentObjectCommandDisabledReason[];
};

export type CurrentObjectInsertNodeKind =
  "text" | "shape" | "image" | "visual" | "connector" | "table";

export type CurrentObjectInsertNodeCommandDescriptor =
  CurrentObjectCommandDescriptor & {
    family: "insert-node";
    nodeKind: CurrentObjectInsertNodeKind;
  };

export type CurrentObjectAlignMode =
  "left" | "center" | "right" | "top" | "middle" | "bottom";

export type CurrentObjectAlignCommandDescriptor =
  CurrentObjectCommandDescriptor & {
    family: "align-selection";
    mode: CurrentObjectAlignMode;
  };

export type CurrentObjectReorderMode =
  "front" | "back" | "forward" | "backward";

export type CurrentObjectReorderCommandId =
  `selection.reorder-${CurrentObjectReorderMode}`;

export type CurrentObjectReorderCommandDescriptor =
  CurrentObjectCommandDescriptor & {
    id: CurrentObjectReorderCommandId;
    family: "reorder-selection";
    mode: CurrentObjectReorderMode;
    shortLabel: string;
    inspectorSingleLabel: string;
  };

const SLIDE_OBJECTS = ["slide"] as const;
const NODE_OBJECTS = [
  "text",
  "shape",
  "image",
  "visual",
  "connector",
  "table",
  "group",
] as const;
const NODE_AND_MULTI_OBJECTS = [...NODE_OBJECTS, "multi-selection"] as const;
const INSERT_NODE_OWNERS = [
  { surface: "popover", ownerId: "context-toolbar" },
] as const satisfies readonly CurrentObjectCommandOwner[];
const ARRANGE_OWNERS = [
  { surface: "popover", ownerId: "context-toolbar" },
  { surface: "inspector", ownerId: "arrange-panel", inspectorPanel: "arrange" },
] as const satisfies readonly CurrentObjectCommandOwner[];
const KEYBOARD_SELECTION_OWNER = {
  surface: "keyboard",
  ownerId: "slide-editor-keyboard",
} as const satisfies CurrentObjectCommandOwner;

export const CURRENT_OBJECT_INSERT_NODE_COMMAND_DESCRIPTORS = [
  {
    id: "slide.insert-text",
    family: "insert-node",
    nodeKind: "text",
    label: "Insert text",
    accessibilityLabel: "Insert text box",
    liveMessage: "Text box inserted.",
    currentObjects: SLIDE_OBJECTS,
    owners: INSERT_NODE_OWNERS,
    disabledReasons: ["missing-current-slide", "missing-handler"],
  },
  {
    id: "slide.insert-shape",
    family: "insert-node",
    nodeKind: "shape",
    label: "Insert shape",
    accessibilityLabel: "Insert shape",
    liveMessage: "Shape inserted.",
    currentObjects: SLIDE_OBJECTS,
    owners: INSERT_NODE_OWNERS,
    disabledReasons: ["missing-current-slide", "missing-handler"],
  },
  {
    id: "slide.insert-image",
    family: "insert-node",
    nodeKind: "image",
    label: "Insert image",
    accessibilityLabel: "Insert image",
    liveMessage: "Image insertion started.",
    currentObjects: SLIDE_OBJECTS,
    owners: INSERT_NODE_OWNERS,
    disabledReasons: ["missing-current-slide", "missing-handler"],
  },
  {
    id: "slide.insert-visual",
    family: "insert-node",
    nodeKind: "visual",
    label: "Insert visual",
    accessibilityLabel: "Insert visual block",
    liveMessage: "Visual inserted.",
    currentObjects: SLIDE_OBJECTS,
    owners: INSERT_NODE_OWNERS,
    disabledReasons: ["missing-current-slide", "missing-handler"],
  },
  {
    id: "slide.insert-connector",
    family: "insert-node",
    nodeKind: "connector",
    label: "Insert connector",
    accessibilityLabel: "Insert connector",
    liveMessage: "Connector inserted.",
    currentObjects: SLIDE_OBJECTS,
    owners: INSERT_NODE_OWNERS,
    disabledReasons: ["missing-current-slide", "missing-handler"],
  },
  {
    id: "slide.insert-table",
    family: "insert-node",
    nodeKind: "table",
    label: "Insert table",
    accessibilityLabel: "Insert table",
    liveMessage: "Table inserted.",
    currentObjects: SLIDE_OBJECTS,
    owners: INSERT_NODE_OWNERS,
    disabledReasons: ["missing-current-slide", "missing-handler"],
  },
] as const satisfies readonly CurrentObjectInsertNodeCommandDescriptor[];

export type CurrentObjectInsertNodeCommandId =
  (typeof CURRENT_OBJECT_INSERT_NODE_COMMAND_DESCRIPTORS)[number]["id"];

export const CURRENT_OBJECT_ALIGN_COMMAND_DESCRIPTORS = [
  {
    id: "selection.align-left",
    family: "align-selection",
    mode: "left",
    label: "Align left",
    shortLabel: "Left",
    accessibilityLabel: "Align selection left",
    liveMessage: "Selection aligned left.",
    currentObjects: NODE_AND_MULTI_OBJECTS,
    owners: ARRANGE_OWNERS,
    disabledReasons: ["missing-selection", "missing-handler"],
  },
  {
    id: "selection.align-center",
    family: "align-selection",
    mode: "center",
    label: "Align center",
    shortLabel: "Center",
    accessibilityLabel: "Align selection center",
    liveMessage: "Selection aligned center.",
    currentObjects: NODE_AND_MULTI_OBJECTS,
    owners: ARRANGE_OWNERS,
    disabledReasons: ["missing-selection", "missing-handler"],
  },
  {
    id: "selection.align-right",
    family: "align-selection",
    mode: "right",
    label: "Align right",
    shortLabel: "Right",
    accessibilityLabel: "Align selection right",
    liveMessage: "Selection aligned right.",
    currentObjects: NODE_AND_MULTI_OBJECTS,
    owners: ARRANGE_OWNERS,
    disabledReasons: ["missing-selection", "missing-handler"],
  },
  {
    id: "selection.align-top",
    family: "align-selection",
    mode: "top",
    label: "Align top",
    shortLabel: "Top",
    accessibilityLabel: "Align selection top",
    liveMessage: "Selection aligned top.",
    currentObjects: NODE_AND_MULTI_OBJECTS,
    owners: ARRANGE_OWNERS,
    disabledReasons: ["missing-selection", "missing-handler"],
  },
  {
    id: "selection.align-middle",
    family: "align-selection",
    mode: "middle",
    label: "Align middle",
    shortLabel: "Middle",
    accessibilityLabel: "Align selection middle",
    liveMessage: "Selection aligned middle.",
    currentObjects: NODE_AND_MULTI_OBJECTS,
    owners: ARRANGE_OWNERS,
    disabledReasons: ["missing-selection", "missing-handler"],
  },
  {
    id: "selection.align-bottom",
    family: "align-selection",
    mode: "bottom",
    label: "Align bottom",
    shortLabel: "Bottom",
    accessibilityLabel: "Align selection bottom",
    liveMessage: "Selection aligned bottom.",
    currentObjects: NODE_AND_MULTI_OBJECTS,
    owners: ARRANGE_OWNERS,
    disabledReasons: ["missing-selection", "missing-handler"],
  },
] as const satisfies readonly CurrentObjectAlignCommandDescriptor[];

export type CurrentObjectAlignCommandId =
  (typeof CURRENT_OBJECT_ALIGN_COMMAND_DESCRIPTORS)[number]["id"];

export const CURRENT_OBJECT_REORDER_COMMAND_DESCRIPTORS = [
  {
    id: "selection.reorder-front",
    family: "reorder-selection",
    mode: "front",
    label: "Bring to front",
    shortLabel: "Front",
    inspectorSingleLabel: "Bring front",
    accessibilityLabel: "Bring selection to front",
    liveMessage: "Selection brought to front.",
    shortcut: "Ctrl+]",
    currentObjects: NODE_AND_MULTI_OBJECTS,
    owners: [...ARRANGE_OWNERS, KEYBOARD_SELECTION_OWNER],
    disabledReasons: ["missing-selection", "missing-handler"],
  },
  {
    id: "selection.reorder-back",
    family: "reorder-selection",
    mode: "back",
    label: "Send to back",
    shortLabel: "Back",
    inspectorSingleLabel: "Send back",
    accessibilityLabel: "Send selection to back",
    liveMessage: "Selection sent to back.",
    shortcut: "Ctrl+[",
    currentObjects: NODE_AND_MULTI_OBJECTS,
    owners: [...ARRANGE_OWNERS, KEYBOARD_SELECTION_OWNER],
    disabledReasons: ["missing-selection", "missing-handler"],
  },
  {
    id: "selection.reorder-forward",
    family: "reorder-selection",
    mode: "forward",
    label: "Bring forward",
    shortLabel: "Forward",
    inspectorSingleLabel: "Forward",
    accessibilityLabel: "Bring selection forward",
    liveMessage: "Selection brought forward.",
    shortcut: "]",
    currentObjects: NODE_AND_MULTI_OBJECTS,
    owners: [...ARRANGE_OWNERS, KEYBOARD_SELECTION_OWNER],
    disabledReasons: ["missing-selection", "missing-handler"],
  },
  {
    id: "selection.reorder-backward",
    family: "reorder-selection",
    mode: "backward",
    label: "Send backward",
    shortLabel: "Backward",
    inspectorSingleLabel: "Backward",
    accessibilityLabel: "Send selection backward",
    liveMessage: "Selection sent backward.",
    shortcut: "[",
    currentObjects: NODE_AND_MULTI_OBJECTS,
    owners: [...ARRANGE_OWNERS, KEYBOARD_SELECTION_OWNER],
    disabledReasons: ["missing-selection", "missing-handler"],
  },
] as const satisfies readonly CurrentObjectReorderCommandDescriptor[];

const CURRENT_OBJECT_BASE_COMMAND_DESCRIPTORS = [
  {
    id: "slide.update-background",
    family: "update-slide-style",
    label: "Slide background",
    accessibilityLabel: "Update slide background",
    liveMessage: "Slide background updated.",
    currentObjects: SLIDE_OBJECTS,
    owners: [
      { surface: "popover", ownerId: "context-toolbar" },
      { surface: "inspector", ownerId: "slide-panel", inspectorPanel: "slide" },
    ],
    disabledReasons: ["missing-current-slide", "missing-handler"],
  },
  {
    id: "slide.insert",
    family: "insert-slide",
    label: "Add slide",
    accessibilityLabel: "Add slide",
    liveMessage: "Slide added.",
    currentObjects: SLIDE_OBJECTS,
    owners: [
      { surface: "popover", ownerId: "context-toolbar" },
      { surface: "keyboard", ownerId: "slide-editor-keyboard" },
    ],
    disabledReasons: ["missing-current-slide", "missing-handler"],
  },
  {
    id: "slide.duplicate",
    family: "duplicate-slide",
    label: "Duplicate slide",
    accessibilityLabel: "Duplicate current slide",
    liveMessage: "Slide duplicated.",
    currentObjects: SLIDE_OBJECTS,
    owners: [{ surface: "popover", ownerId: "context-toolbar" }],
    disabledReasons: ["missing-current-slide", "missing-handler"],
  },
  {
    id: "slide.delete",
    family: "delete-slide",
    label: "Delete slide",
    accessibilityLabel: "Delete current slide",
    liveMessage: "Slide deleted.",
    currentObjects: SLIDE_OBJECTS,
    owners: [{ surface: "popover", ownerId: "context-toolbar" }],
    disabledReasons: [
      "missing-current-slide",
      "minimum-slide-count",
      "missing-handler",
    ],
  },
  {
    id: "text.bold",
    family: "format-text",
    label: "Bold",
    accessibilityLabel: "Toggle bold text",
    liveMessage: "Bold text toggled.",
    shortcut: "Ctrl+B",
    currentObjects: ["text", "shape"],
    owners: [
      { surface: "popover", ownerId: "context-toolbar" },
      { surface: "inspector", ownerId: "text-panel", inspectorPanel: "text" },
      KEYBOARD_SELECTION_OWNER,
    ],
    disabledReasons: [
      "missing-selection",
      "unsupported-current-object",
      "missing-handler",
    ],
  },
  {
    id: "shape.update-fill",
    family: "update-node-style",
    label: "Fill color",
    accessibilityLabel: "Update shape fill color",
    liveMessage: "Shape fill color updated.",
    currentObjects: ["shape"],
    owners: [
      { surface: "popover", ownerId: "context-toolbar" },
      { surface: "inspector", ownerId: "shape-panel", inspectorPanel: "shape" },
    ],
    disabledReasons: [
      "missing-selection",
      "unsupported-current-object",
      "missing-handler",
    ],
  },
  {
    id: "image.crop",
    family: "update-node-content",
    label: "Crop image",
    accessibilityLabel: "Crop image",
    liveMessage: "Image crop updated.",
    currentObjects: ["image"],
    owners: [
      { surface: "popover", ownerId: "context-toolbar" },
      {
        surface: "inspector",
        ownerId: "adjust-panel",
        inspectorPanel: "adjust",
      },
    ],
    disabledReasons: [
      "missing-selection",
      "unsupported-current-object",
      "missing-handler",
    ],
  },
  {
    id: "table.insert-row",
    family: "update-node-content",
    label: "Insert row",
    accessibilityLabel: "Insert table row",
    liveMessage: "Table row inserted.",
    currentObjects: ["table"],
    owners: [
      { surface: "popover", ownerId: "context-toolbar" },
      { surface: "inspector", ownerId: "table-panel", inspectorPanel: "table" },
    ],
    disabledReasons: [
      "missing-selection",
      "unsupported-current-object",
      "missing-handler",
    ],
  },
  {
    id: "selection.distribute-horizontal",
    family: "distribute-selection",
    label: "Distribute horizontally",
    shortLabel: "Distribute H",
    accessibilityLabel: "Distribute selection horizontally",
    liveMessage: "Selection distributed horizontally.",
    currentObjects: ["multi-selection"],
    owners: ARRANGE_OWNERS,
    disabledReasons: [
      "requires-multi-selection",
      "requires-three-selections",
      "missing-handler",
    ],
  },
  {
    id: "selection.distribute-vertical",
    family: "distribute-selection",
    label: "Distribute vertically",
    shortLabel: "Distribute V",
    accessibilityLabel: "Distribute selection vertically",
    liveMessage: "Selection distributed vertically.",
    currentObjects: ["multi-selection"],
    owners: ARRANGE_OWNERS,
    disabledReasons: [
      "requires-multi-selection",
      "requires-three-selections",
      "missing-handler",
    ],
  },
  {
    id: "selection.match-width",
    family: "match-selection-size",
    label: "Match width",
    accessibilityLabel: "Match selection width",
    liveMessage: "Selection widths matched.",
    currentObjects: ["multi-selection"],
    owners: ARRANGE_OWNERS,
    disabledReasons: ["requires-multi-selection", "missing-handler"],
  },
  {
    id: "selection.match-height",
    family: "match-selection-size",
    label: "Match height",
    accessibilityLabel: "Match selection height",
    liveMessage: "Selection heights matched.",
    currentObjects: ["multi-selection"],
    owners: ARRANGE_OWNERS,
    disabledReasons: ["requires-multi-selection", "missing-handler"],
  },
  {
    id: "selection.group",
    family: "group-selection",
    label: "Group",
    accessibilityLabel: "Group selection",
    liveMessage: "Selection grouped.",
    shortcut: "Ctrl+G",
    currentObjects: ["multi-selection"],
    owners: [...ARRANGE_OWNERS, KEYBOARD_SELECTION_OWNER],
    disabledReasons: ["requires-multi-selection", "missing-handler"],
  },
  {
    id: "selection.ungroup",
    family: "ungroup-selection",
    label: "Ungroup",
    accessibilityLabel: "Ungroup selection",
    liveMessage: "Group ungrouped.",
    shortcut: "Ctrl+Shift+G",
    currentObjects: ["group"],
    owners: [...ARRANGE_OWNERS, KEYBOARD_SELECTION_OWNER],
    disabledReasons: [
      "requires-single-selection",
      "unsupported-current-object",
      "missing-handler",
    ],
  },
  {
    id: "selection.duplicate",
    family: "duplicate-selection",
    label: "Duplicate",
    accessibilityLabel: "Duplicate selection",
    liveMessage: "Selection duplicated.",
    shortcut: "Ctrl+D",
    currentObjects: NODE_AND_MULTI_OBJECTS,
    owners: [
      { surface: "popover", ownerId: "context-toolbar" },
      KEYBOARD_SELECTION_OWNER,
    ],
    disabledReasons: ["missing-selection", "missing-handler"],
  },
  {
    id: "selection.delete",
    family: "delete-selection",
    label: "Delete",
    accessibilityLabel: "Delete selection",
    liveMessage: "Selection deleted.",
    shortcut: "Delete",
    currentObjects: NODE_AND_MULTI_OBJECTS,
    owners: [
      { surface: "popover", ownerId: "context-toolbar" },
      KEYBOARD_SELECTION_OWNER,
    ],
    disabledReasons: ["missing-selection", "missing-handler"],
  },
  {
    id: "selection.cut",
    family: "cut-selection",
    label: "Cut",
    accessibilityLabel: "Cut selection",
    liveMessage: "Selection cut.",
    shortcut: "Ctrl+X",
    currentObjects: NODE_AND_MULTI_OBJECTS,
    owners: [
      { surface: "popover", ownerId: "context-toolbar" },
      KEYBOARD_SELECTION_OWNER,
    ],
    disabledReasons: ["missing-selection", "missing-handler"],
  },
  {
    id: "selection.lock",
    family: "update-node-attributes",
    label: "Lock",
    accessibilityLabel: "Toggle selection lock",
    liveMessage: "Selection lock updated.",
    currentObjects: NODE_OBJECTS,
    owners: [{ surface: "popover", ownerId: "context-toolbar-more-menu" }],
    disabledReasons: [
      "missing-selection",
      "unsupported-current-object",
      "missing-handler",
    ],
  },
  {
    id: "stage.select-object",
    family: "stage-select",
    label: "Select object",
    accessibilityLabel: "Select object on stage",
    liveMessage: "Selection updated.",
    shortcut: "Tab",
    currentObjects: NODE_OBJECTS,
    owners: [
      { surface: "stage", ownerId: "stage-pointer" },
      KEYBOARD_SELECTION_OWNER,
    ],
    disabledReasons: ["missing-current-slide"],
  },
  {
    id: "stage.transform-selection",
    family: "stage-transform",
    label: "Transform selection",
    accessibilityLabel: "Move or resize selection on stage",
    liveMessage: "Selection transformed.",
    shortcut: "Arrow keys",
    currentObjects: NODE_AND_MULTI_OBJECTS,
    owners: [
      { surface: "stage", ownerId: "stage-pointer" },
      KEYBOARD_SELECTION_OWNER,
    ],
    disabledReasons: ["missing-selection", "locked-selection"],
  },
  /*! node:coverage ignore next 18 -- Static connector descriptor object is covered through catalog lookup tests, but tsx source maps report it as a gap. */
  {
    id: "connector.create",
    family: "create-connector",
    label: "Create connector",
    accessibilityLabel: "Create connector between objects",
    liveMessage: "Connector created.",
    shortcut: "C",
    currentObjects: ["text", "shape", "image", "visual", "table"],
    owners: [
      { surface: "stage", ownerId: "connector-endpoint-gesture" },
      KEYBOARD_SELECTION_OWNER,
      { surface: "popover", ownerId: "context-toolbar" },
    ],
    disabledReasons: [
      "missing-selection",
      "unsupported-current-object",
      "missing-handler",
    ],
  },
  {
    id: "source.review",
    family: "review-source",
    label: "Review source",
    accessibilityLabel: "Review source link",
    liveMessage: "Source review opened.",
    currentObjects: [
      "source-review",
      "text",
      "shape",
      "image",
      "visual",
      "table",
    ],
    owners: [
      { surface: "toolbar", ownerId: "document-source-menu" },
      {
        surface: "inspector",
        ownerId: "source-panel",
        inspectorPanel: "source",
      },
    ],
    disabledReasons: ["read-only-source", "missing-handler"],
  },
  {
    id: "diagnostics.repair",
    family: "repair-diagnostic",
    label: "Repair diagnostic",
    accessibilityLabel: "Repair presentation diagnostic",
    liveMessage: "Diagnostic repair applied.",
    currentObjects: ["diagnostic"],
    owners: [
      { surface: "toolbar", ownerId: "diagnostics-popover" },
      {
        surface: "inspector",
        ownerId: "diagnostics-panel",
        inspectorPanel: "diagnostics",
      },
    ],
    disabledReasons: ["missing-handler", "unsupported-current-object"],
  },
] as const satisfies readonly CurrentObjectCommandDescriptor[];

export const CURRENT_OBJECT_COMMAND_DESCRIPTORS = [
  ...CURRENT_OBJECT_BASE_COMMAND_DESCRIPTORS,
  ...CURRENT_OBJECT_ALIGN_COMMAND_DESCRIPTORS,
  ...CURRENT_OBJECT_REORDER_COMMAND_DESCRIPTORS,
  ...CURRENT_OBJECT_INSERT_NODE_COMMAND_DESCRIPTORS,
] as const satisfies readonly CurrentObjectCommandDescriptor[];

export type CurrentObjectCommandId =
  (typeof CURRENT_OBJECT_COMMAND_DESCRIPTORS)[number]["id"];

const CURRENT_OBJECT_COMMAND_DESCRIPTOR_BY_ID = new Map<
  string,
  CurrentObjectCommandDescriptor
>(
  CURRENT_OBJECT_COMMAND_DESCRIPTORS.map(
    (descriptor) => [descriptor.id, descriptor] as const,
  ),
);

const CURRENT_OBJECT_ALIGN_DESCRIPTOR_BY_MODE = new Map<
  CurrentObjectAlignMode,
  CurrentObjectAlignCommandDescriptor
>(
  CURRENT_OBJECT_ALIGN_COMMAND_DESCRIPTORS.map(
    (descriptor) => [descriptor.mode, descriptor] as const,
  ),
);

const CURRENT_OBJECT_REORDER_DESCRIPTOR_BY_MODE = new Map<
  CurrentObjectReorderMode,
  CurrentObjectReorderCommandDescriptor
>(
  CURRENT_OBJECT_REORDER_COMMAND_DESCRIPTORS.map(
    (descriptor) => [descriptor.mode, descriptor] as const,
  ),
);

const CURRENT_OBJECT_INSERT_NODE_DESCRIPTOR_BY_KIND = new Map<
  CurrentObjectInsertNodeKind,
  CurrentObjectInsertNodeCommandDescriptor
>(
  CURRENT_OBJECT_INSERT_NODE_COMMAND_DESCRIPTORS.map(
    (descriptor) => [descriptor.nodeKind, descriptor] as const,
  ),
);

export function findCurrentObjectCommandDescriptor(
  id: string,
): CurrentObjectCommandDescriptor | undefined {
  return CURRENT_OBJECT_COMMAND_DESCRIPTOR_BY_ID.get(id);
}

export function currentObjectCommandDescriptor(
  id: CurrentObjectCommandId,
): CurrentObjectCommandDescriptor {
  const descriptor = findCurrentObjectCommandDescriptor(id);
  if (!descriptor) {
    throw new Error(`Unknown current-object command descriptor: ${id}`);
  }
  return descriptor;
}

export function currentObjectCommandDescriptorsForSurface(
  surface: CurrentObjectCommandSurface,
): CurrentObjectCommandDescriptor[] {
  return CURRENT_OBJECT_COMMAND_DESCRIPTORS.filter((descriptor) =>
    descriptor.owners.some((owner) => owner.surface === surface),
  );
}

export function currentObjectAlignCommandDescriptor(
  mode: CurrentObjectAlignMode,
): CurrentObjectAlignCommandDescriptor {
  const descriptor = CURRENT_OBJECT_ALIGN_DESCRIPTOR_BY_MODE.get(mode);
  if (!descriptor) {
    throw new Error(`Unknown current-object align command mode: ${mode}`);
  }
  return descriptor;
}

export function currentObjectReorderCommandDescriptor(
  mode: CurrentObjectReorderMode,
): CurrentObjectReorderCommandDescriptor {
  const descriptor = CURRENT_OBJECT_REORDER_DESCRIPTOR_BY_MODE.get(mode);
  if (!descriptor) {
    throw new Error(`Unknown current-object reorder command mode: ${mode}`);
  }
  return descriptor;
}

export function currentObjectInsertNodeCommandDescriptor(
  nodeKind: CurrentObjectInsertNodeKind,
): CurrentObjectInsertNodeCommandDescriptor {
  const descriptor =
    CURRENT_OBJECT_INSERT_NODE_DESCRIPTOR_BY_KIND.get(nodeKind);
  if (!descriptor) {
    throw new Error(`Unknown current-object insert node kind: ${nodeKind}`);
  }
  return descriptor;
}
