import assert from "node:assert/strict";
import { test } from "node:test";

import type { CommandTarget } from "@/lib/commands/envelope-core";
import type { SlideCommand } from "@/lib/document/deck-kernel/slide-commands";
import { ARRANGE_MODES } from "@/lib/document/deck-kernel/element-arrange";
import {
  canCoalesceSlideCommands,
  getSlideCommandMetadata,
  mergeCoalescedSlideCommands,
  SLIDE_COMMAND_METADATA,
  validateDeckCommandPayload,
} from "./deck-command-metadata";

function slideCommandFixture(value: unknown): SlideCommand {
  return value as unknown as SlideCommand;
}

const deckTarget: CommandTarget = { surface: "deck" };
const sourceRef = {
  documentId: "doc-1",
  blockId: "block-1",
  linkedAt: "2026-07-02T20:42:41Z",
  blockKind: "text",
};

const validPayloads: Record<string, Record<string, unknown>> = {
  ADD_SLIDE: { type: "ADD_SLIDE", afterSlideId: null },
  REMOVE_SLIDE: { type: "REMOVE_SLIDE", slideId: "slide-1" },
  DUPLICATE_SLIDE: { type: "DUPLICATE_SLIDE", slideId: "slide-1" },
  REORDER_SLIDE: { type: "REORDER_SLIDE", slideId: "slide-1", toIndex: 1 },
  UPDATE_SLIDE: {
    type: "UPDATE_SLIDE",
    slideId: "slide-1",
    patch: { title: "Updated" },
  },
  ADD_ELEMENT: {
    type: "ADD_ELEMENT",
    slideId: "slide-1",
    element: { kind: "text" },
  },
  UPDATE_ELEMENT: {
    type: "UPDATE_ELEMENT",
    slideId: "slide-1",
    elementId: "el-1",
    patch: { box: { x: 1 } },
  },
  UPDATE_ELEMENT_CONTENT: {
    type: "UPDATE_ELEMENT_CONTENT",
    slideId: "slide-1",
    elementId: "el-1",
    content: { text: "Body" },
    role: "body",
  },
  UPDATE_ELEMENT_DESIGN_OVERRIDES: {
    type: "UPDATE_ELEMENT_DESIGN_OVERRIDES",
    slideId: "slide-1",
    elementId: "el-1",
    designOverrides: { fill: "red" },
  },
  REMOVE_ELEMENT: {
    type: "REMOVE_ELEMENT",
    slideId: "slide-1",
    elementId: "el-1",
  },
  MOVE_SLIDE: { type: "MOVE_SLIDE", slideIndex: 0, direction: 1 },
  INSERT_TEMPLATE_SLIDE: {
    type: "INSERT_TEMPLATE_SLIDE",
    slide: { id: "slide-new" },
    afterIndex: 0,
  },
  UPDATE_SLIDE_TITLE: {
    type: "UPDATE_SLIDE_TITLE",
    slideId: "slide-1",
    title: "Title",
  },
  UPDATE_SLIDE_NOTES: {
    type: "UPDATE_SLIDE_NOTES",
    slideId: "slide-1",
    notes: "Notes",
  },
  REMOVE_ELEMENTS: {
    type: "REMOVE_ELEMENTS",
    slideId: "slide-1",
    elementIds: ["el-1", "el-2"],
  },
  DUPLICATE_ELEMENT: {
    type: "DUPLICATE_ELEMENT",
    slideId: "slide-1",
    elementId: "el-1",
  },
  DUPLICATE_ELEMENTS: {
    type: "DUPLICATE_ELEMENTS",
    slideId: "slide-1",
    elementIds: ["el-1"],
  },
  NUDGE_ELEMENTS: {
    type: "NUDGE_ELEMENTS",
    slideId: "slide-1",
    elementIds: ["el-1"],
    dx: 1,
    dy: -1,
  },
  GROUP_ELEMENTS: {
    type: "GROUP_ELEMENTS",
    slideId: "slide-1",
    elementIds: ["el-1"],
  },
  UNGROUP_ELEMENTS: {
    type: "UNGROUP_ELEMENTS",
    slideId: "slide-1",
    groupId: "group-1",
  },
  ALIGN_ELEMENTS: {
    type: "ALIGN_ELEMENTS",
    slideId: "slide-1",
    elementIds: ["el-1"],
    mode: "left",
  },
  DISTRIBUTE_ELEMENTS: {
    type: "DISTRIBUTE_ELEMENTS",
    slideId: "slide-1",
    elementIds: ["el-1"],
    mode: "horizontal",
  },
  MATCH_SIZE_ELEMENTS: {
    type: "MATCH_SIZE_ELEMENTS",
    slideId: "slide-1",
    elementIds: ["el-1"],
    mode: "width",
  },
  ARRANGE_ELEMENTS: {
    type: "ARRANGE_ELEMENTS",
    slideId: "slide-1",
    elementIds: ["el-1"],
    mode: "front",
  },
  BRING_ELEMENT_TO_FRONT: {
    type: "BRING_ELEMENT_TO_FRONT",
    slideId: "slide-1",
    elementId: "el-1",
  },
  SEND_ELEMENT_TO_BACK: {
    type: "SEND_ELEMENT_TO_BACK",
    slideId: "slide-1",
    elementId: "el-1",
  },
  SET_ELEMENT_BOXES: {
    type: "SET_ELEMENT_BOXES",
    slideId: "slide-1",
    boxesById: { "el-1": { x: 1, y: 2, w: 3, h: 4 } },
  },
  SET_ELEMENT_PATCHES: {
    type: "SET_ELEMENT_PATCHES",
    slideId: "slide-1",
    patchesById: { "el-1": { hidden: true } },
  },
  SET_ELEMENT_HIDDEN: {
    type: "SET_ELEMENT_HIDDEN",
    slideId: "slide-1",
    elementId: "el-1",
    hidden: true,
  },
  SET_ELEMENT_LOCKED: {
    type: "SET_ELEMENT_LOCKED",
    slideId: "slide-1",
    elementId: "el-1",
    locked: false,
  },
  MOVE_ELEMENT_ZORDER: {
    type: "MOVE_ELEMENT_ZORDER",
    slideId: "slide-1",
    elementId: "el-1",
    direction: "up",
  },
  RENAME_ELEMENT: {
    type: "RENAME_ELEMENT",
    slideId: "slide-1",
    elementId: "el-1",
    name: "Logo",
  },
  REORDER_ELEMENT: {
    type: "REORDER_ELEMENT",
    slideId: "slide-1",
    elementId: "el-1",
    targetElementId: "el-2",
  },
  SET_PRESENTATION_THEME: {
    type: "SET_PRESENTATION_THEME",
    themeId: "default",
  },
  APPLY_THEME_PACKAGE: { type: "APPLY_THEME_PACKAGE", packageId: "clarity" },
  UPDATE_THEME_OVERRIDES: {
    type: "UPDATE_THEME_OVERRIDES",
    patch: { colors: {} },
    reset: true,
  },
  SET_CANVAS_FORMAT: { type: "SET_CANVAS_FORMAT", format: "16:9" },
  CREATE_MASTER: {
    type: "CREATE_MASTER",
    master: { id: "master-1", name: "Master", elements: [] },
  },
  UPDATE_MASTER: {
    type: "UPDATE_MASTER",
    masterId: "master-1",
    patch: { name: "Updated" },
  },
  DELETE_MASTER: { type: "DELETE_MASTER", masterId: "master-1" },
  SET_DEFAULT_MASTER: { type: "SET_DEFAULT_MASTER", masterId: "master-1" },
  SET_SLIDE_MASTER: {
    type: "SET_SLIDE_MASTER",
    slideId: "slide-1",
    masterId: undefined,
  },
  UPDATE_MASTER_ELEMENT: {
    type: "UPDATE_MASTER_ELEMENT",
    masterId: "master-1",
    elementId: "el-1",
    patch: { locked: true },
  },
  ADD_SLIDE_FROM_TEMPLATE: {
    type: "ADD_SLIDE_FROM_TEMPLATE",
    templateId: "title",
    afterSlideId: null,
  },
  APPLY_SLIDE_TEMPLATE: {
    type: "APPLY_SLIDE_TEMPLATE",
    slideId: "slide-1",
    templateId: "title",
  },
  CREATE_CUSTOM_TEMPLATE: {
    type: "CREATE_CUSTOM_TEMPLATE",
    template: {
      id: "template-1",
      name: "Template",
      category: "blank",
      elements: [],
    },
  },
  UPDATE_CUSTOM_TEMPLATE: {
    type: "UPDATE_CUSTOM_TEMPLATE",
    templateId: "template-1",
    patch: { name: "Updated" },
  },
  DELETE_CUSTOM_TEMPLATE: {
    type: "DELETE_CUSTOM_TEMPLATE",
    templateId: "template-1",
  },
  SET_SLIDE_BACKGROUND: {
    type: "SET_SLIDE_BACKGROUND",
    slideId: "slide-1",
    background: undefined,
  },
  SET_SLIDE_BACKGROUND_GRADIENT: {
    type: "SET_SLIDE_BACKGROUND_GRADIENT",
    slideId: "slide-1",
    gradient: { from: "#000", to: "#fff", angle: 45 },
  },
  SET_SLIDE_BACKGROUND_IMAGE: {
    type: "SET_SLIDE_BACKGROUND_IMAGE",
    slideId: "slide-1",
    image: undefined,
  },
  SET_SLIDE_BACKGROUND_ASSET: {
    type: "SET_SLIDE_BACKGROUND_ASSET",
    slideId: "slide-1",
    opts: { url: "https://example.test/bg.png", assetId: "asset-1" },
  },
  SET_SLIDE_ACCENT: {
    type: "SET_SLIDE_ACCENT",
    slideId: "slide-1",
    accent: undefined,
  },
  UPDATE_ELEMENT_SOURCE: {
    type: "UPDATE_ELEMENT_SOURCE",
    slideId: "slide-1",
    elementId: "el-1",
    source: sourceRef,
  },
  REMOVE_SOURCE_ELEMENT: {
    type: "REMOVE_SOURCE_ELEMENT",
    slideId: "slide-1",
    elementId: "el-1",
  },
};

test("metadata is available and accepts the minimal valid payload for every slide command", () => {
  assert.deepEqual(
    Object.keys(validPayloads).sort(),
    Object.keys(SLIDE_COMMAND_METADATA).sort(),
  );
  for (const [type, payload] of Object.entries(validPayloads)) {
    const metadata = getSlideCommandMetadata(type);
    assert.ok(metadata, type);
    assert.equal(metadata.type, type);
    const errors: string[] = [];
    validateDeckCommandPayload(
      { ...payload, commandId: "cmd-1", coalesceKey: "gesture-1" },
      deckTarget,
      errors,
    );
    assert.deepEqual(errors, [], type);
  }
  assert.equal(getSlideCommandMetadata("NOT_A_COMMAND"), undefined);
});

test("payload validation rejects unsupported envelopes and target mismatches", () => {
  const errors: string[] = [];
  validateDeckCommandPayload(null, deckTarget, errors);
  validateDeckCommandPayload({ type: "NOPE" }, deckTarget, errors);
  validateDeckCommandPayload(
    {
      type: "UPDATE_SLIDE",
      slideId: "slide-1",
      patch: {},
      commandId: "",
      coalesceKey: "",
    },
    { surface: "deck", slideId: "other" },
    errors,
  );
  validateDeckCommandPayload(
    {
      type: "UPDATE_ELEMENT",
      slideId: "slide-1",
      elementId: "el-1",
      patch: {},
    },
    { surface: "deck", elementId: "other" },
    errors,
  );
  assert.deepEqual(errors, [
    "Deck command payloads must be objects.",
    "payload.type must be a supported SlideCommand.",
    "payload.commandId must be a non-empty string when provided.",
    "payload.coalesceKey must be a non-empty string when provided.",
    "target.slideId must match payload.slideId.",
    "target.elementId must match payload.elementId.",
  ]);
});

const invalidPayloads: Array<[string, Record<string, unknown>, string[]]> = [
  [
    "ADD_SLIDE",
    { type: "ADD_SLIDE", afterSlideId: 1 },
    ["payload.afterSlideId must be a non-empty string or null."],
  ],
  [
    "REORDER_SLIDE",
    { type: "REORDER_SLIDE", slideId: "", toIndex: 1.5 },
    [
      "payload.slideId must be a non-empty string.",
      "payload.toIndex must be an integer.",
    ],
  ],
  [
    "UPDATE_SLIDE",
    { type: "UPDATE_SLIDE", slideId: "", patch: null },
    [
      "payload.slideId must be a non-empty string.",
      "payload.patch must be an object.",
    ],
  ],
  [
    "ADD_ELEMENT",
    { type: "ADD_ELEMENT", slideId: "", element: null },
    [
      "payload.slideId must be a non-empty string.",
      "payload.element must be an object.",
    ],
  ],
  [
    "UPDATE_ELEMENT",
    { type: "UPDATE_ELEMENT", slideId: "", elementId: "", patch: null },
    [
      "payload.slideId must be a non-empty string.",
      "payload.elementId must be a non-empty string.",
      "payload.patch must be an object.",
    ],
  ],
  [
    "UPDATE_ELEMENT_CONTENT",
    {
      type: "UPDATE_ELEMENT_CONTENT",
      slideId: "",
      elementId: "",
      content: "text",
      role: "",
    },
    [
      "payload.slideId must be a non-empty string.",
      "payload.elementId must be a non-empty string.",
      "payload.content must be an object when provided.",
      "payload.role must be a non-empty string when provided.",
    ],
  ],
  [
    "UPDATE_ELEMENT_CONTENT",
    { type: "UPDATE_ELEMENT_CONTENT", slideId: "slide-1", elementId: "el-1" },
    ["payload.content or payload.role must be provided."],
  ],
  [
    "UPDATE_ELEMENT_DESIGN_OVERRIDES",
    {
      type: "UPDATE_ELEMENT_DESIGN_OVERRIDES",
      slideId: "",
      elementId: "",
      designOverrides: null,
    },
    [
      "payload.slideId must be a non-empty string.",
      "payload.elementId must be a non-empty string.",
      "payload.designOverrides must be an object.",
    ],
  ],
  [
    "REMOVE_ELEMENT",
    { type: "REMOVE_ELEMENT", slideId: "", elementId: "" },
    [
      "payload.slideId must be a non-empty string.",
      "payload.elementId must be a non-empty string.",
    ],
  ],
  [
    "SET_ELEMENT_HIDDEN",
    { type: "SET_ELEMENT_HIDDEN", slideId: "", elementId: "", hidden: "yes" },
    [
      "payload.slideId must be a non-empty string.",
      "payload.elementId must be a non-empty string.",
      "payload.hidden must be a boolean.",
    ],
  ],
  [
    "SET_ELEMENT_LOCKED",
    {
      type: "SET_ELEMENT_LOCKED",
      slideId: "slide-1",
      elementId: "el-1",
      locked: "no",
    },
    ["payload.locked must be a boolean."],
  ],
  [
    "MOVE_ELEMENT_ZORDER",
    {
      type: "MOVE_ELEMENT_ZORDER",
      slideId: "slide-1",
      elementId: "el-1",
      direction: "left",
    },
    ['payload.direction must be "up" or "down".'],
  ],
  [
    "RENAME_ELEMENT",
    { type: "RENAME_ELEMENT", slideId: "slide-1", elementId: "el-1", name: 1 },
    ["payload.name must be a string."],
  ],
  [
    "REORDER_ELEMENT",
    {
      type: "REORDER_ELEMENT",
      slideId: "slide-1",
      elementId: "el-1",
      targetElementId: "",
    },
    ["payload.targetElementId must be a non-empty string."],
  ],
  [
    "UPDATE_ELEMENT_SOURCE",
    {
      type: "UPDATE_ELEMENT_SOURCE",
      slideId: "",
      elementId: "",
      unlink: "yes",
      source: null,
    },
    [
      "payload.slideId must be a non-empty string.",
      "payload.elementId must be a non-empty string.",
      "payload.unlink must be a boolean when provided.",
      "payload.source must be an object.",
    ],
  ],
  [
    "MOVE_SLIDE",
    { type: "MOVE_SLIDE", slideIndex: 1.2, direction: Number.NaN },
    [
      "payload.slideIndex must be an integer.",
      "payload.direction must be a finite number.",
    ],
  ],
  [
    "INSERT_TEMPLATE_SLIDE",
    { type: "INSERT_TEMPLATE_SLIDE", slide: null, afterIndex: 1.2 },
    [
      "payload.slide must be an object.",
      "payload.afterIndex must be an integer when provided.",
    ],
  ],
  [
    "UPDATE_SLIDE_TITLE",
    { type: "UPDATE_SLIDE_TITLE", slideId: "", title: 1 },
    [
      "payload.slideId must be a non-empty string.",
      "payload.title must be a string.",
    ],
  ],
  [
    "UPDATE_SLIDE_NOTES",
    { type: "UPDATE_SLIDE_NOTES", slideId: "", notes: 1 },
    [
      "payload.slideId must be a non-empty string.",
      "payload.notes must be a string.",
    ],
  ],
  [
    "REMOVE_ELEMENTS",
    { type: "REMOVE_ELEMENTS", slideId: "", elementIds: [1] },
    [
      "payload.slideId must be a non-empty string.",
      "payload.elementIds must be an array of strings.",
    ],
  ],
  [
    "NUDGE_ELEMENTS",
    {
      type: "NUDGE_ELEMENTS",
      slideId: "",
      elementIds: [1],
      dx: Number.NaN,
      dy: "no",
    },
    [
      "payload.slideId must be a non-empty string.",
      "payload.elementIds must be an array of strings.",
      "payload.dx must be a finite number.",
      "payload.dy must be a finite number.",
    ],
  ],
  [
    "ALIGN_ELEMENTS",
    { type: "ALIGN_ELEMENTS", slideId: "", elementIds: [1], mode: "" },
    [
      "payload.slideId must be a non-empty string.",
      "payload.elementIds must be an array of strings.",
      "payload.mode must be a non-empty string.",
    ],
  ],
  [
    "ARRANGE_ELEMENTS",
    {
      type: "ARRANGE_ELEMENTS",
      slideId: "slide-1",
      elementIds: ["el-1"],
      mode: "sideways",
    },
    ["payload.mode must be one of: front, back, forward, backward."],
  ],
  [
    "UNGROUP_ELEMENTS",
    { type: "UNGROUP_ELEMENTS", slideId: "", groupId: "" },
    [
      "payload.slideId must be a non-empty string.",
      "payload.groupId must be a non-empty string.",
    ],
  ],
  [
    "SET_ELEMENT_BOXES",
    {
      type: "SET_ELEMENT_BOXES",
      slideId: "",
      boxesById: { "": { x: "x", y: 1, w: 2, h: 3 }, good: null },
    },
    [
      "payload.slideId must be a non-empty string.",
      "payload.boxesById keys must be non-empty strings.",
      "payload.boxesById..x must be a finite number.",
      "payload.boxesById.good must be an object.",
    ],
  ],
  [
    "SET_ELEMENT_BOXES",
    { type: "SET_ELEMENT_BOXES", slideId: "slide-1", boxesById: null },
    ["payload.boxesById must be an object."],
  ],
  [
    "SET_ELEMENT_PATCHES",
    { type: "SET_ELEMENT_PATCHES", slideId: "", patchesById: null },
    [
      "payload.slideId must be a non-empty string.",
      "payload.patchesById must be an object.",
    ],
  ],
  [
    "SET_PRESENTATION_THEME",
    { type: "SET_PRESENTATION_THEME", themeId: "" },
    ["payload.themeId must be a non-empty string."],
  ],
  [
    "APPLY_THEME_PACKAGE",
    { type: "APPLY_THEME_PACKAGE", packageId: "" },
    ["payload.packageId must be a non-empty string."],
  ],
  [
    "UPDATE_THEME_OVERRIDES",
    { type: "UPDATE_THEME_OVERRIDES", patch: null, reset: "yes" },
    [
      "payload.patch must be an object.",
      "payload.reset must be a boolean when provided.",
    ],
  ],
  [
    "SET_CANVAS_FORMAT",
    { type: "SET_CANVAS_FORMAT", format: "" },
    ["payload.format must be a non-empty string."],
  ],
  [
    "CREATE_MASTER",
    { type: "CREATE_MASTER", master: null },
    ["payload.master must be an object."],
  ],
  [
    "UPDATE_MASTER",
    { type: "UPDATE_MASTER", masterId: "", patch: null },
    [
      "payload.masterId must be a non-empty string.",
      "payload.patch must be an object.",
    ],
  ],
  [
    "DELETE_MASTER",
    { type: "DELETE_MASTER", masterId: "" },
    ["payload.masterId must be a non-empty string."],
  ],
  [
    "SET_SLIDE_MASTER",
    { type: "SET_SLIDE_MASTER", slideId: "", masterId: "" },
    [
      "payload.slideId must be a non-empty string.",
      "payload.masterId must be a non-empty string when provided.",
    ],
  ],
  [
    "UPDATE_MASTER_ELEMENT",
    { type: "UPDATE_MASTER_ELEMENT", masterId: "", elementId: "", patch: null },
    [
      "payload.masterId must be a non-empty string.",
      "payload.elementId must be a non-empty string.",
      "payload.patch must be an object.",
    ],
  ],
  [
    "ADD_SLIDE_FROM_TEMPLATE",
    { type: "ADD_SLIDE_FROM_TEMPLATE", templateId: "", afterSlideId: 1 },
    [
      "payload.templateId must be a non-empty string.",
      "payload.afterSlideId must be a non-empty string or null.",
    ],
  ],
  [
    "APPLY_SLIDE_TEMPLATE",
    { type: "APPLY_SLIDE_TEMPLATE", slideId: "", templateId: "" },
    [
      "payload.slideId must be a non-empty string.",
      "payload.templateId must be a non-empty string.",
    ],
  ],
  [
    "CREATE_CUSTOM_TEMPLATE",
    { type: "CREATE_CUSTOM_TEMPLATE", template: null },
    ["payload.template must be an object."],
  ],
  [
    "UPDATE_CUSTOM_TEMPLATE",
    { type: "UPDATE_CUSTOM_TEMPLATE", templateId: "", patch: null },
    [
      "payload.templateId must be a non-empty string.",
      "payload.patch must be an object.",
    ],
  ],
  [
    "DELETE_CUSTOM_TEMPLATE",
    { type: "DELETE_CUSTOM_TEMPLATE", templateId: "" },
    ["payload.templateId must be a non-empty string."],
  ],
  [
    "SET_SLIDE_BACKGROUND",
    { type: "SET_SLIDE_BACKGROUND", slideId: "", background: 1 },
    [
      "payload.slideId must be a non-empty string.",
      "payload.background must be a string or undefined.",
    ],
  ],
  [
    "SET_SLIDE_BACKGROUND_GRADIENT",
    {
      type: "SET_SLIDE_BACKGROUND_GRADIENT",
      slideId: "slide-1",
      gradient: { from: "", to: 1, angle: "right" },
    },
    [
      "payload.gradient.from must be a non-empty string.",
      "payload.gradient.to must be a non-empty string.",
      "payload.gradient.angle must be a finite number when provided.",
    ],
  ],
  [
    "SET_SLIDE_BACKGROUND_GRADIENT",
    {
      type: "SET_SLIDE_BACKGROUND_GRADIENT",
      slideId: "slide-1",
      gradient: null,
    },
    ["payload.gradient must be an object or undefined."],
  ],
  [
    "SET_SLIDE_BACKGROUND_IMAGE",
    { type: "SET_SLIDE_BACKGROUND_IMAGE", slideId: "", image: 1 },
    [
      "payload.slideId must be a non-empty string.",
      "payload.image must be a string or undefined.",
    ],
  ],
  [
    "SET_SLIDE_BACKGROUND_ASSET",
    {
      type: "SET_SLIDE_BACKGROUND_ASSET",
      slideId: "slide-1",
      opts: { url: "", assetId: 1 },
    },
    [
      "payload.opts.url must be a non-empty string.",
      "payload.opts.assetId must be a non-empty string.",
    ],
  ],
  [
    "SET_SLIDE_BACKGROUND_ASSET",
    { type: "SET_SLIDE_BACKGROUND_ASSET", slideId: "slide-1", opts: null },
    ["payload.opts must be an object or undefined."],
  ],
  [
    "SET_SLIDE_ACCENT",
    { type: "SET_SLIDE_ACCENT", slideId: "", accent: 1 },
    [
      "payload.slideId must be a non-empty string.",
      "payload.accent must be a string or undefined.",
    ],
  ],
  [
    "UPDATE_ELEMENT_SOURCE",
    {
      type: "UPDATE_ELEMENT_SOURCE",
      slideId: "slide-1",
      elementId: "el-1",
      source: {
        ...sourceRef,
        documentId: "",
        blockId: "",
        linkedAt: "",
        contentHash: "",
        unlinked: "no",
        blockKind: "bad",
        extra: true,
      },
    },
    [
      "payload.source.extra is not supported.",
      "payload.source.documentId must be a non-empty string.",
      "payload.source.blockId must be a non-empty string.",
      "payload.source.linkedAt must be a non-empty string.",
      "payload.source.contentHash must be a non-empty string when provided.",
      "payload.source.unlinked must be a boolean when provided.",
      'payload.source.blockKind must be "text", "visual", or "table".',
    ],
  ],
];

test("payload validation reports command-specific invalid fields", () => {
  for (const [name, payload, expected] of invalidPayloads) {
    const errors: string[] = [];
    validateDeckCommandPayload(payload, deckTarget, errors);
    assert.deepEqual(errors, expected, name);
  }
});

test("ARRANGE_ELEMENTS validation accepts only arrange modes", () => {
  for (const mode of ARRANGE_MODES) {
    const errors: string[] = [];
    validateDeckCommandPayload(
      {
        type: "ARRANGE_ELEMENTS",
        slideId: "slide-1",
        elementIds: ["el-1"],
        mode,
      },
      deckTarget,
      errors,
    );
    assert.deepEqual(errors, [], mode);
  }

  const errors: string[] = [];
  validateDeckCommandPayload(
    {
      type: "ARRANGE_ELEMENTS",
      slideId: "slide-1",
      elementIds: ["el-1"],
      mode: "sideways",
    },
    deckTarget,
    errors,
  );
  assert.deepEqual(errors, [
    "payload.mode must be one of: front, back, forward, backward.",
  ]);
});

test("affected id metadata extracts slide ids and string element ids", () => {
  assert.deepEqual(
    SLIDE_COMMAND_METADATA.REMOVE_SLIDE.affectedIds({
      type: "REMOVE_SLIDE",
      slideId: "slide-1",
    }),
    { slideIds: ["slide-1"], elementIds: [] },
  );
  assert.deepEqual(
    SLIDE_COMMAND_METADATA.REMOVE_ELEMENTS.affectedIds(
      slideCommandFixture({
        type: "REMOVE_ELEMENTS",
        slideId: "slide-1",
        elementIds: ["el-1", 2, "el-2"],
      }),
    ),
    { slideIds: ["slide-1"], elementIds: ["el-1", "el-2"] },
  );
  assert.deepEqual(
    SLIDE_COMMAND_METADATA.SET_PRESENTATION_THEME.affectedIds(
      slideCommandFixture({
        type: "SET_PRESENTATION_THEME",
        themeId: "forest",
      }),
    ),
    { slideIds: [], elementIds: [] },
  );
});

test("coalescing requires compatible metadata, keys, slides, and elements", () => {
  const updateA = {
    type: "UPDATE_SLIDE",
    slideId: "slide-1",
    patch: { title: "A" },
    coalesceKey: "drag",
  } as SlideCommand;
  const updateB = {
    type: "UPDATE_SLIDE",
    slideId: "slide-1",
    patch: { notes: "B" },
    coalesceKey: "drag",
  } as SlideCommand;
  assert.equal(canCoalesceSlideCommands(updateA, updateB), true);
  assert.equal(
    canCoalesceSlideCommands(updateA, {
      ...updateB,
      type: "REMOVE_SLIDE",
    } as SlideCommand),
    false,
  );
  assert.equal(
    canCoalesceSlideCommands(updateA, {
      ...updateB,
      coalesceKey: "other",
    } as SlideCommand),
    false,
  );
  assert.equal(
    canCoalesceSlideCommands(updateA, {
      ...updateB,
      slideId: "slide-2",
    } as SlideCommand),
    false,
  );
  assert.equal(
    canCoalesceSlideCommands(
      { type: "REMOVE_SLIDE", slideId: "slide-1" } as SlideCommand,
      { type: "REMOVE_SLIDE", slideId: "slide-1" } as SlideCommand,
    ),
    false,
  );

  const elementA = {
    type: "UPDATE_ELEMENT",
    slideId: "slide-1",
    elementId: "el-1",
    patch: { box: { x: 1 } },
    coalesceKey: "drag",
  } as SlideCommand;
  const elementB = {
    type: "UPDATE_ELEMENT",
    slideId: "slide-1",
    elementId: "el-1",
    patch: { box: { y: 2 } },
    coalesceKey: "drag",
  } as SlideCommand;
  assert.equal(canCoalesceSlideCommands(elementA, elementB), true);
  assert.equal(
    canCoalesceSlideCommands(elementA, {
      ...elementB,
      elementId: "el-2",
    } as SlideCommand),
    false,
  );
});

test("mergeCoalescedSlideCommands preserves command identity while applying the latest mutable fields", () => {
  assert.deepEqual(
    mergeCoalescedSlideCommands(
      {
        type: "UPDATE_SLIDE",
        slideId: "slide-1",
        patch: { title: "A" },
      } as SlideCommand,
      {
        type: "UPDATE_SLIDE",
        slideId: "slide-1",
        patch: { notes: "B" },
      } as SlideCommand,
    ),
    {
      type: "UPDATE_SLIDE",
      slideId: "slide-1",
      patch: { title: "A", notes: "B" },
    },
  );
  assert.deepEqual(
    mergeCoalescedSlideCommands(
      {
        type: "UPDATE_ELEMENT",
        slideId: "slide-1",
        elementId: "el-1",
        patch: { hidden: false },
      } as SlideCommand,
      {
        type: "UPDATE_ELEMENT",
        slideId: "slide-1",
        elementId: "el-1",
        patch: { hidden: true },
      } as SlideCommand,
    ),
    {
      type: "UPDATE_ELEMENT",
      slideId: "slide-1",
      elementId: "el-1",
      patch: { hidden: true },
    },
  );
  assert.deepEqual(
    mergeCoalescedSlideCommands(
      {
        type: "UPDATE_ELEMENT_CONTENT",
        slideId: "slide-1",
        elementId: "el-1",
        content: { text: "A" },
        role: "body",
      } as SlideCommand,
      {
        type: "UPDATE_ELEMENT_CONTENT",
        slideId: "slide-1",
        elementId: "el-1",
        role: "title",
      } as SlideCommand,
    ),
    {
      type: "UPDATE_ELEMENT_CONTENT",
      slideId: "slide-1",
      elementId: "el-1",
      content: { text: "A" },
      role: "title",
    },
  );
  assert.deepEqual(
    mergeCoalescedSlideCommands(
      {
        type: "UPDATE_ELEMENT_DESIGN_OVERRIDES",
        slideId: "slide-1",
        elementId: "el-1",
        designOverrides: { radius: 4 },
      } as SlideCommand,
      {
        type: "UPDATE_ELEMENT_DESIGN_OVERRIDES",
        slideId: "slide-1",
        elementId: "el-1",
        designOverrides: { fitMode: "cover" },
      } as SlideCommand,
    ),
    {
      type: "UPDATE_ELEMENT_DESIGN_OVERRIDES",
      slideId: "slide-1",
      elementId: "el-1",
      designOverrides: { radius: 4, fitMode: "cover" },
    },
  );
  assert.deepEqual(
    mergeCoalescedSlideCommands(
      {
        type: "UPDATE_SLIDE_TITLE",
        slideId: "slide-1",
        title: "A",
      } as SlideCommand,
      {
        type: "UPDATE_SLIDE_TITLE",
        slideId: "slide-1",
        title: "B",
      } as SlideCommand,
    ),
    { type: "UPDATE_SLIDE_TITLE", slideId: "slide-1", title: "B" },
  );
  assert.deepEqual(
    mergeCoalescedSlideCommands(
      {
        type: "UPDATE_SLIDE_NOTES",
        slideId: "slide-1",
        notes: "A",
      } as SlideCommand,
      {
        type: "UPDATE_SLIDE_NOTES",
        slideId: "slide-1",
        notes: "B",
      } as SlideCommand,
    ),
    { type: "UPDATE_SLIDE_NOTES", slideId: "slide-1", notes: "B" },
  );
  assert.deepEqual(
    mergeCoalescedSlideCommands(
      {
        type: "SET_ELEMENT_BOXES",
        slideId: "slide-1",
        boxesById: { a: { x: 1, y: 1, w: 1, h: 1 } },
      } as SlideCommand,
      {
        type: "SET_ELEMENT_BOXES",
        slideId: "slide-1",
        boxesById: { b: { x: 2, y: 2, w: 2, h: 2 } },
      } as SlideCommand,
    ),
    {
      type: "SET_ELEMENT_BOXES",
      slideId: "slide-1",
      boxesById: {
        a: { x: 1, y: 1, w: 1, h: 1 },
        b: { x: 2, y: 2, w: 2, h: 2 },
      },
    },
  );
  assert.deepEqual(
    mergeCoalescedSlideCommands(
      {
        type: "SET_ELEMENT_PATCHES",
        slideId: "slide-1",
        patchesById: { a: { hidden: false } },
      } as SlideCommand,
      {
        type: "SET_ELEMENT_PATCHES",
        slideId: "slide-1",
        patchesById: { a: { hidden: true } },
      } as SlideCommand,
    ),
    {
      type: "SET_ELEMENT_PATCHES",
      slideId: "slide-1",
      patchesById: { a: { hidden: true } },
    },
  );
  assert.deepEqual(
    mergeCoalescedSlideCommands(
      { type: "REMOVE_SLIDE", slideId: "old" } as SlideCommand,
      { type: "REMOVE_SLIDE", slideId: "new" } as SlideCommand,
    ),
    { type: "REMOVE_SLIDE", slideId: "new" },
  );
});
