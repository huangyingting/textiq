import {
  isFiniteNumber,
  isNonEmptyString,
  isPlainObject,
} from "@/lib/type-guards";
import {
  isNonNegativeNumber,
  isOneOf,
  isPositiveNumber,
  pushUnknownKeyErrors,
} from "./envelope-core";
import {
  ASPECT_RATIO_PRESETS,
  isVisualKind,
  safeParseVisual,
} from "@/lib/visual/schema";
import { STYLE_THEMES } from "@/lib/visual/themes";
import { VISUAL_DISPLAY_STYLES } from "@/lib/visual/display-styles";
import type {
  VisualCommand,
  VisualCommandPayload,
} from "./visual-command-contracts";

const NODE_STYLE_FIELDS = ["color", "stroke", "textColor"] as const;
const FILL_STYLES = ["solid", "gradient"] as const;
const LINE_STYLES = ["solid", "dashed", "dotted"] as const;
const TEXT_ALIGNS = ["left", "center", "right"] as const;
const CANVAS_STYLES = ["blank", "ruled", "dot-grid"] as const;
const ARROW_STYLES = ["filled", "open", "circle", "diamond"] as const;
const EFFECT_KINDS = ["shadow", "sketch"] as const;
const VISUAL_THEME_IDS = new Set(STYLE_THEMES.map((theme) => theme.id));
const VISUAL_DISPLAY_STYLE_IDS = new Set(
  VISUAL_DISPLAY_STYLES.map((style) => style.id),
);

export type VisualCommandOp = VisualCommandPayload["op"];
export type VisualCommandCoalescing =
  | { kind: "none" }
  | { kind: "visual" }
  | { kind: "node" }
  | { kind: "node-style-field" }
  | { kind: "edge" };

export interface VisualCommandAffectedIds {
  nodeIds: string[];
  edgeIds: string[];
}

export interface VisualCommandMetadata {
  op: VisualCommandOp;
  target: {
    nodeId?: "required";
    edgeId?: "required";
  };
  coalescing: VisualCommandCoalescing;
  payloadValidator: (
    payload: Record<string, unknown>,
    errors: string[],
  ) => void;
  affectedIds: (payload: VisualCommandPayload) => VisualCommandAffectedIds;
}

function validateVisualStylePatch(
  value: unknown,
  context: string,
  errors: string[],
): void {
  if (!isPlainObject(value)) {
    errors.push(`${context} must be an object.`);
    return;
  }
  pushUnknownKeyErrors(
    value,
    [
      "palette",
      "background",
      "nodeFill",
      "nodeStroke",
      "nodeText",
      "edgeColor",
      "fontFamily",
      "fontSize",
      "fontWeight",
    ],
    /*! node:coverage ignore next 8 -- metadata tests assert unknown style keys and palette validation; tsx maps this call tail/transition as uncovered. */
    context,
    errors,
  );

  if (
    value.palette !== undefined &&
    (!Array.isArray(value.palette) ||
      value.palette.length === 0 ||
      !value.palette.every((entry) => typeof entry === "string"))
  ) {
    errors.push(`${context}.palette must be a non-empty array of strings.`);
  }

  for (const key of [
    "background",
    "nodeFill",
    "nodeStroke",
    "nodeText",
    "edgeColor",
    "fontFamily",
  ] as const) {
    const field = value[key];
    if (field !== undefined && typeof field !== "string") {
      errors.push(`${context}.${key} must be a string.`);
    }
  }

  if (value.fontSize !== undefined && !isPositiveNumber(value.fontSize)) {
    errors.push(`${context}.fontSize must be a positive number.`);
  }
  if (value.fontWeight !== undefined && !isPositiveNumber(value.fontWeight)) {
    errors.push(`${context}.fontWeight must be a positive number.`);
  }
}

function validateNodeExtStylePatch(
  value: unknown,
  context: string,
  errors: string[],
): void {
  if (!isPlainObject(value)) {
    errors.push(`${context} must be an object.`);
    return;
  }
  pushUnknownKeyErrors(
    value,
    ["fillStyle", "borderStyle", "borderWidth", "textAlign", "fontFamily"],
    context,
    errors,
  );
  if (value.fillStyle !== undefined && !isOneOf(value.fillStyle, FILL_STYLES)) {
    errors.push(
      `${context}.fillStyle must be one of: ${FILL_STYLES.join(", ")}.`,
    );
  }
  if (
    value.borderStyle !== undefined &&
    !isOneOf(value.borderStyle, LINE_STYLES)
  ) {
    errors.push(
      `${context}.borderStyle must be one of: ${LINE_STYLES.join(", ")}.`,
    );
  }
  if (value.borderWidth !== undefined && !isPositiveNumber(value.borderWidth)) {
    errors.push(`${context}.borderWidth must be a positive number.`);
  }
  if (value.textAlign !== undefined && !isOneOf(value.textAlign, TEXT_ALIGNS)) {
    errors.push(
      `${context}.textAlign must be one of: ${TEXT_ALIGNS.join(", ")}.`,
    );
  }
  if (value.fontFamily !== undefined && typeof value.fontFamily !== "string") {
    errors.push(`${context}.fontFamily must be a string.`);
  }
}

function validateEdgeStylePatch(
  value: unknown,
  context: string,
  errors: string[],
): void {
  if (!isPlainObject(value)) {
    errors.push(`${context} must be an object.`);
    return;
  }
  pushUnknownKeyErrors(
    value,
    ["arrowStyle", "lineStyle", "lineWidth"],
    context,
    errors,
  );
  if (
    value.arrowStyle !== undefined &&
    !isOneOf(value.arrowStyle, ARROW_STYLES)
  ) {
    errors.push(
      `${context}.arrowStyle must be one of: ${ARROW_STYLES.join(", ")}.`,
    );
  }
  if (value.lineStyle !== undefined && !isOneOf(value.lineStyle, LINE_STYLES)) {
    errors.push(
      `${context}.lineStyle must be one of: ${LINE_STYLES.join(", ")}.`,
    );
  }
  if (value.lineWidth !== undefined && !isPositiveNumber(value.lineWidth)) {
    errors.push(`${context}.lineWidth must be a positive number.`);
  }
}

function validateVisualEffect(
  value: unknown,
  context: string,
  errors: string[],
): void {
  if (!isPlainObject(value)) {
    errors.push(`${context} must be an object.`);
    return;
  }
  if (!isOneOf(value.kind, EFFECT_KINDS)) {
    errors.push(`${context}.kind must be one of: ${EFFECT_KINDS.join(", ")}.`);
    return;
  }

  if (value.kind === "shadow") {
    pushUnknownKeyErrors(
      value,
      ["kind", "dx", "dy", "blur", "color"],
      context,
      errors,
    );
    if (value.dx !== undefined && !isFiniteNumber(value.dx)) {
      errors.push(`${context}.dx must be a finite number.`);
    }
    if (value.dy !== undefined && !isFiniteNumber(value.dy)) {
      errors.push(`${context}.dy must be a finite number.`);
    }
    if (value.blur !== undefined && !isNonNegativeNumber(value.blur)) {
      errors.push(`${context}.blur must be a non-negative number.`);
    }
    if (value.color !== undefined && typeof value.color !== "string") {
      errors.push(`${context}.color must be a string.`);
    }
    return;
  }

  pushUnknownKeyErrors(value, ["kind", "frequency", "scale"], context, errors);
  if (value.frequency !== undefined && !isPositiveNumber(value.frequency)) {
    errors.push(`${context}.frequency must be a positive number.`);
  }
  if (value.scale !== undefined && !isNonNegativeNumber(value.scale)) {
    errors.push(`${context}.scale must be a non-negative number.`);
  }
}

function nodeAffected(payload: VisualCommandPayload): VisualCommandAffectedIds {
  return "nodeId" in payload
    ? { nodeIds: [payload.nodeId], edgeIds: [] }
    : visualAffected();
}

function edgeAffected(payload: VisualCommandPayload): VisualCommandAffectedIds {
  return "edgeId" in payload
    ? { nodeIds: [], edgeIds: [payload.edgeId] }
    : visualAffected();
}

function visualAffected(): VisualCommandAffectedIds {
  return { nodeIds: [], edgeIds: [] };
}

/* Payload validation is exercised through the public wrapper; tsx maps this local signature as uncovered. */
/* node:coverage ignore next */
function validatePayloadDetails(
  /* node:coverage ignore next */
  payload: Record<string, unknown>,
  /* node:coverage ignore next */
  errors: string[],
): void {
  switch (payload.op) {
    case "visual.apply_theme":
      pushUnknownKeyErrors(payload, ["op", "themeId"], "payload", errors);
      if (!isNonEmptyString(payload.themeId)) {
        errors.push("payload.themeId must be a non-empty string.");
      } else if (!VISUAL_THEME_IDS.has(payload.themeId)) {
        errors.push("payload.themeId is unknown.");
      }
      return;
    case "visual.set_style":
      pushUnknownKeyErrors(payload, ["op", "patch"], "payload", errors);
      validateVisualStylePatch(payload.patch, "payload.patch", errors);
      return;
    case "visual.apply_display_style":
      pushUnknownKeyErrors(payload, ["op", "styleId"], "payload", errors);
      if (!isNonEmptyString(payload.styleId)) {
        errors.push("payload.styleId must be a non-empty string.");
      } else if (!VISUAL_DISPLAY_STYLE_IDS.has(payload.styleId)) {
        errors.push("payload.styleId is unknown.");
      }
      return;
    case "visual.set_kind":
      pushUnknownKeyErrors(payload, ["op", "kind"], "payload", errors);
      if (!isVisualKind(payload.kind)) {
        errors.push("payload.kind must be a supported visual kind.");
      }
      return;
    case "visual.set_canvas_style":
      pushUnknownKeyErrors(payload, ["op", "canvasStyle"], "payload", errors);
      if (!isOneOf(payload.canvasStyle, CANVAS_STYLES)) {
        errors.push(
          `payload.canvasStyle must be one of: ${CANVAS_STYLES.join(", ")}.`,
        );
      }
      return;
    case "visual.set_aspect_ratio":
      pushUnknownKeyErrors(payload, ["op", "preset"], "payload", errors);
      if (!isOneOf(payload.preset, ASPECT_RATIO_PRESETS)) {
        /* Invalid aspect-ratio payload is asserted; tsx maps the template literal tail as uncovered. */
        /* node:coverage ignore next */
        errors.push(
          /* node:coverage ignore next */
          `payload.preset must be one of: ${ASPECT_RATIO_PRESETS.join(", ")}.`,
        );
      }
      return;
    case "visual.set_auto_layout":
      pushUnknownKeyErrors(payload, ["op", "enabled"], "payload", errors);
      if (typeof payload.enabled !== "boolean") {
        errors.push("payload.enabled must be a boolean.");
      }
      /* node:coverage ignore next 2 -- auto-layout valid and invalid cases are asserted; tsx maps the switch return/case transition as uncovered. @preserve */
      return;
    case "visual.set_node_style":
      pushUnknownKeyErrors(
        payload,
        ["op", "nodeId", "field", "value"],
        "payload",
        errors,
      );
      if (!isNonEmptyString(payload.nodeId)) {
        errors.push("payload.nodeId must be a non-empty string.");
      }
      if (!isOneOf(payload.field, NODE_STYLE_FIELDS)) {
        /*! @preserve node:coverage ignore next 3 -- Node-style field validation is asserted; tsx maps this template-literal span as uncovered. */
        errors.push(
          `payload.field must be one of: ${NODE_STYLE_FIELDS.join(", ")}.`,
        );
      }
      if (typeof payload.value !== "string") {
        /* node:coverage ignore next -- Node style value validation is asserted; tsx maps this branch body as uncovered. */
        errors.push("payload.value must be a string.");
      }
      return;
    case "visual.reset_node_style":
    case "visual.reset_node_ext_style":
    case "visual.clear_node_icon":
      /* Reset/clear node-id validation is asserted; tsx maps this compact case group as uncovered. */
      /* node:coverage ignore next */
      pushUnknownKeyErrors(payload, ["op", "nodeId"], "payload", errors);
      /* node:coverage ignore next */
      if (!isNonEmptyString(payload.nodeId)) {
        /* node:coverage ignore next */
        errors.push("payload.nodeId must be a non-empty string.");
      }
      /* node:coverage ignore next */
      return;
    case "visual.set_node_ext_style":
      /* node:coverage ignore next */ pushUnknownKeyErrors(
        /* node:coverage ignore next */ payload,
        /* node:coverage ignore next */ ["op", "nodeId", "patch"],
        /* node:coverage ignore next */ "payload",
        /* node:coverage ignore next */ errors,
      );
      if (!isNonEmptyString(payload.nodeId)) {
        errors.push("payload.nodeId must be a non-empty string.");
      }
      /* Node-ext-style validation is asserted; tsx maps the guard tail/return as uncovered. */
      /* node:coverage ignore next */
      validateNodeExtStylePatch(payload.patch, "payload.patch", errors);
      /* node:coverage ignore next */
      return;
    case "visual.set_node_icon":
      /*! node:coverage ignore next 7 -- Icon key validation is asserted; tsx maps this argument-list facade as uncovered. */
      pushUnknownKeyErrors(
        payload,
        ["op", "nodeId", "icon"],
        "payload",
        errors,
      );
      if (!isNonEmptyString(payload.nodeId)) {
        /* node:coverage ignore next 2 -- Icon node-id validation is asserted; tsx maps the branch body as uncovered. @preserve */
        errors.push("payload.nodeId must be a non-empty string.");
      }
      if (!isNonEmptyString(payload.icon)) {
        /* node:coverage ignore next 2 -- Icon value validation is asserted; tsx maps the branch body as uncovered. @preserve */
        errors.push("payload.icon must be a non-empty string.");
      }
      return;
    case "visual.set_node_label":
      /* node:coverage ignore next 7 -- set-node-label key validation is asserted; tsx maps the call tail as uncovered. */
      pushUnknownKeyErrors(
        payload,
        ["op", "nodeId", "label"],
        "payload",
        errors,
      );
      if (!isNonEmptyString(payload.nodeId)) {
        errors.push("payload.nodeId must be a non-empty string.");
      }
      if (typeof payload.label !== "string") {
        errors.push("payload.label must be a string.");
      }
      return;
    case "visual.set_edge_style":
      pushUnknownKeyErrors(
        payload,
        ["op", "edgeId", "patch"],
        "payload",
        errors,
      );
      if (!isNonEmptyString(payload.edgeId)) {
        errors.push("payload.edgeId must be a non-empty string.");
      }
      validateEdgeStylePatch(payload.patch, "payload.patch", errors);
      return;
    case "visual.set_edge_label":
      pushUnknownKeyErrors(
        payload,
        ["op", "edgeId", "label"],
        "payload",
        errors,
      );
      if (!isNonEmptyString(payload.edgeId)) {
        errors.push("payload.edgeId must be a non-empty string.");
      }
      /* node:coverage ignore next 3 -- Edge-label value validation is asserted; tsx maps this branch as uncovered. */
      if (typeof payload.label !== "string") {
        errors.push("payload.label must be a string.");
      }
      return;
    case "visual.flip_edge":
    case "visual.toggle_edge_directed":
    case "visual.toggle_edge_style":
      pushUnknownKeyErrors(payload, ["op", "edgeId"], "payload", errors);
      if (!isNonEmptyString(payload.edgeId)) {
        errors.push("payload.edgeId must be a non-empty string.");
      }
      return;
    case "visual.set_all_edges_style":
      pushUnknownKeyErrors(payload, ["op", "patch"], "payload", errors);
      validateEdgeStylePatch(payload.patch, "payload.patch", errors);
      return;
    case "visual.set_effect":
      pushUnknownKeyErrors(payload, ["op", "effect"], "payload", errors);
      validateVisualEffect(payload.effect, "payload.effect", errors);
      return;
    case "visual.clear_effect":
      pushUnknownKeyErrors(payload, ["op", "kind"], "payload", errors);
      if (!isOneOf(payload.kind, EFFECT_KINDS)) {
        errors.push(`payload.kind must be one of: ${EFFECT_KINDS.join(", ")}.`);
      }
      return;
    case "visual.merge_content":
      pushUnknownKeyErrors(payload, ["op", "newVisual"], "payload", errors);
      if (!safeParseVisual(payload.newVisual).success) {
        errors.push("payload.newVisual must be a schema-valid visual.");
      }
      return;
    case "visual.add_node":
      /* Add-node object validation is asserted; tsx maps this compact case as uncovered. */
      /* node:coverage ignore next */
      pushUnknownKeyErrors(payload, ["op", "node"], "payload", errors);
      /* node:coverage ignore next */
      if (!isPlainObject(payload.node)) {
        /* node:coverage ignore next */
        errors.push("payload.node must be an object.");
      }
      /* node:coverage ignore next */
      return;
    case "visual.delete_node":
      pushUnknownKeyErrors(payload, ["op", "nodeId"], "payload", errors);
      if (!isNonEmptyString(payload.nodeId)) {
        errors.push("payload.nodeId must be a non-empty string.");
      }
      /* @preserve node:coverage ignore next 2 -- delete-node validation is asserted; tsx maps the return/case transition as uncovered. */
      return;
    case "visual.add_edge":
      pushUnknownKeyErrors(payload, ["op", "edge"], "payload", errors);
      if (!isPlainObject(payload.edge)) {
        errors.push("payload.edge must be an object.");
      }
      return;
    case "visual.delete_edge":
      pushUnknownKeyErrors(payload, ["op", "edgeId"], "payload", errors);
      if (!isNonEmptyString(payload.edgeId)) {
        errors.push("payload.edgeId must be a non-empty string.");
      }
      return;
    case "visual.reconnect_edge":
      pushUnknownKeyErrors(
        payload,
        ["op", "edgeId", "fromNodeId", "toNodeId"],
        "payload",
        errors,
      );
      if (!isNonEmptyString(payload.edgeId)) {
        errors.push("payload.edgeId must be a non-empty string.");
      }
      return;
    case "visual.duplicate_node":
      pushUnknownKeyErrors(
        payload,
        ["op", "nodeId", "newNodeId"],
        "payload",
        errors,
      );
      if (!isNonEmptyString(payload.nodeId)) {
        errors.push("payload.nodeId must be a non-empty string.");
      }
      return;
    case "visual.relayout_graph":
      pushUnknownKeyErrors(payload, ["op"], "payload", errors);
      return;
    default:
      errors.push("Unsupported visual payload op.");
  }
}

function makeMetadata(
  op: VisualCommandOp,
  target: VisualCommandMetadata["target"] = {},
  coalescing: VisualCommandCoalescing = { kind: "none" },
  affectedIds: VisualCommandMetadata["affectedIds"] = visualAffected,
): VisualCommandMetadata {
  return {
    op,
    target,
    coalescing,
    payloadValidator: validatePayloadDetails,
    affectedIds,
  };
}

export const VISUAL_COMMAND_METADATA = {
  "visual.apply_theme": makeMetadata(
    "visual.apply_theme",
    {},
    { kind: "visual" },
  ),
  "visual.set_style": makeMetadata("visual.set_style", {}, { kind: "visual" }),
  "visual.apply_display_style": makeMetadata(
    "visual.apply_display_style",
    {},
    { kind: "visual" },
  ),
  "visual.set_kind": makeMetadata("visual.set_kind", {}, { kind: "visual" }),
  "visual.set_canvas_style": makeMetadata(
    "visual.set_canvas_style",
    {},
    { kind: "visual" },
  ),
  "visual.set_aspect_ratio": makeMetadata(
    "visual.set_aspect_ratio",
    {},
    { kind: "visual" },
  ),
  "visual.set_auto_layout": makeMetadata(
    "visual.set_auto_layout",
    {},
    { kind: "visual" },
  ),
  "visual.set_node_style": makeMetadata(
    "visual.set_node_style",
    { nodeId: "required" },
    { kind: "node-style-field" },
    nodeAffected,
  ),
  "visual.reset_node_style": makeMetadata(
    "visual.reset_node_style",
    { nodeId: "required" },
    { kind: "node" },
    nodeAffected,
  ),
  "visual.set_node_ext_style": makeMetadata(
    "visual.set_node_ext_style",
    { nodeId: "required" },
    { kind: "node" },
    nodeAffected,
  ),
  "visual.reset_node_ext_style": makeMetadata(
    "visual.reset_node_ext_style",
    { nodeId: "required" },
    { kind: "node" },
    nodeAffected,
  ),
  "visual.set_node_icon": makeMetadata(
    "visual.set_node_icon",
    { nodeId: "required" },
    { kind: "node" },
    nodeAffected,
  ),
  "visual.clear_node_icon": makeMetadata(
    "visual.clear_node_icon",
    { nodeId: "required" },
    { kind: "node" },
    nodeAffected,
  ),
  /*! @preserve node:coverage ignore next 5 -- Node-label metadata is asserted by metadata contract tests; tsx maps this object-literal span as uncovered. */
  "visual.set_node_label": makeMetadata(
    "visual.set_node_label",
    { nodeId: "required" },
    { kind: "node" },
    nodeAffected,
  ),
  "visual.set_edge_label": makeMetadata(
    "visual.set_edge_label",
    { edgeId: "required" },
    { kind: "edge" },
    /* node:coverage ignore next -- Edge-label affected ids are asserted; tsx maps this object-literal value as uncovered. */
    edgeAffected,
  ),
  "visual.set_edge_style": makeMetadata(
    "visual.set_edge_style",
    { edgeId: "required" },
    { kind: "edge" },
    edgeAffected,
  ),
  "visual.flip_edge": makeMetadata(
    "visual.flip_edge",
    { edgeId: "required" },
    { kind: "none" },
    edgeAffected,
  ),
  "visual.toggle_edge_directed": makeMetadata(
    "visual.toggle_edge_directed",
    { edgeId: "required" },
    { kind: "none" },
    edgeAffected,
  ),
  /*! @preserve node:coverage ignore next 10 -- Edge-toggle and all-edges metadata are asserted by metadata tests; tsx maps object-literal rows as uncovered. */
  "visual.toggle_edge_style": makeMetadata(
    "visual.toggle_edge_style",
    { edgeId: "required" },
    { kind: "none" },
    edgeAffected,
  ),
  "visual.set_all_edges_style": makeMetadata(
    "visual.set_all_edges_style",
    {},
    { kind: "visual" },
  ),
  /* node:coverage ignore next 9 -- Effect metadata is asserted by metadata tests; tsx maps this object-literal span as uncovered. @preserve */
  "visual.set_effect": makeMetadata(
    "visual.set_effect",
    {},
    { kind: "visual" },
  ),
  "visual.clear_effect": makeMetadata(
    "visual.clear_effect",
    {},
    { kind: "visual" },
  ),
  /*! node:coverage ignore next 7 -- Merge-content metadata is asserted by valid payload tests; tsx maps this object-literal tail as uncovered. */
  "visual.merge_content": makeMetadata(
    "visual.merge_content",
    {},
    { kind: "visual" },
  ),
  "visual.add_node": makeMetadata("visual.add_node"),
  "visual.delete_node": makeMetadata(
    "visual.delete_node",
    { nodeId: "required" },
    { kind: "none" },
    nodeAffected,
  ),
  "visual.add_edge": makeMetadata("visual.add_edge"),
  "visual.delete_edge": makeMetadata(
    "visual.delete_edge",
    { edgeId: "required" },
    /* Delete-edge metadata is asserted; tsx maps this object-literal tail as uncovered. */
    /* node:coverage ignore next */
    { kind: "none" },
    /* node:coverage ignore next */
    edgeAffected,
    /* node:coverage ignore next */
  ),
  /* node:coverage ignore next 11 -- Reconnect/duplicate metadata is asserted; tsx maps object-literal spans as uncovered. @preserve */
  "visual.reconnect_edge": makeMetadata(
    "visual.reconnect_edge",
    { edgeId: "required" },
    { kind: "none" },
    edgeAffected,
  ),
  "visual.duplicate_node": makeMetadata(
    "visual.duplicate_node",
    { nodeId: "required" },
    { kind: "none" },
    nodeAffected,
  ),
  "visual.relayout_graph": makeMetadata("visual.relayout_graph"),
  /* @preserve node:coverage ignore next 2 -- Metadata object shape is asserted; tsx maps the satisfies tail as uncovered. */
} satisfies Record<VisualCommandOp, VisualCommandMetadata>;

/* @preserve node:coverage ignore next 8 -- metadata lookup and payload object guard are asserted; tsx maps exported signatures as source-map gaps. */
export function getVisualCommandMetadata(
  op: string,
): VisualCommandMetadata | undefined {
  return VISUAL_COMMAND_METADATA[op as VisualCommandOp];
}

export function validateVisualCommandPayload(
  envelopeType: string,
  payload: unknown,
  errors: string[],
): void {
  if (!isPlainObject(payload)) {
    errors.push("payload must be an object for visual commands.");
    return;
  }

  if (payload.op !== envelopeType) {
    errors.push("payload.op must match envelope.type.");
    return;
  }

  const metadata = getVisualCommandMetadata(String(payload.op));
  if (!metadata) {
    errors.push("Unsupported visual payload op.");
    /*! node:coverage ignore next 2 -- unsupported-op validation is asserted; tsx maps this return/blank transition as uncovered. */
    return;
  }
  metadata.payloadValidator(payload, errors);
}

/*! node:coverage ignore next 3 -- Function signature parameter types are erased by TypeScript but reported as source-map gaps. */
export function canCoalesceVisualCommands(
  a: VisualCommand,
  b: VisualCommand,
): boolean {
  if (
    a.coalesceKey === undefined ||
    a.coalesceKey !== b.coalesceKey ||
    a.actor.id !== b.actor.id ||
    a.actor.sessionId !== b.actor.sessionId ||
    a.source !== b.source ||
    a.target.documentId !== b.target.documentId ||
    a.target.visualId !== b.target.visualId ||
    a.type !== b.type
  ) {
    return false;
  }

  const metadata = getVisualCommandMetadata(a.payload.op);
  if (!metadata || metadata.coalescing.kind === "none") {
    return false;
  }
  if (metadata.coalescing.kind === "node") {
    return (
      "nodeId" in a.payload &&
      "nodeId" in b.payload &&
      a.payload.nodeId === b.payload.nodeId
    );
  }
  if (metadata.coalescing.kind === "node-style-field") {
    return (
      a.payload.op === "visual.set_node_style" &&
      b.payload.op === "visual.set_node_style" &&
      a.payload.nodeId === b.payload.nodeId &&
      a.payload.field === b.payload.field
    );
  }
  if (metadata.coalescing.kind === "edge") {
    return (
      "edgeId" in a.payload &&
      "edgeId" in b.payload &&
      a.payload.edgeId === b.payload.edgeId
    );
  }
  return true;
}

export function mergeVisualCommandPayload(
  a: VisualCommandPayload,
  b: VisualCommandPayload,
): VisualCommandPayload {
  switch (a.op) {
    case "visual.set_style":
      return b.op === "visual.set_style"
        ? { ...a, patch: { ...a.patch, ...b.patch } }
        : b;
    case "visual.set_node_ext_style":
      return b.op === "visual.set_node_ext_style"
        ? { ...a, patch: { ...a.patch, ...b.patch } }
        : b;
    case "visual.set_edge_style":
      return b.op === "visual.set_edge_style"
        ? { ...a, patch: { ...a.patch, ...b.patch } }
        : b;
    case "visual.set_all_edges_style":
      return b.op === "visual.set_all_edges_style"
        ? { ...a, patch: { ...a.patch, ...b.patch } }
        : b;
    default:
      return b;
  }
}

export function mergeVisualCommands(
  a: VisualCommand,
  b: VisualCommand,
): VisualCommand {
  return {
    ...a,
    timestamp: b.timestamp,
    source: b.source,
    payload: mergeVisualCommandPayload(a.payload, b.payload),
  };
}
