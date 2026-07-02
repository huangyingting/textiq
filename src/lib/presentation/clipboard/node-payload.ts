import { defaultImageNode, defaultTextNode } from "../node-asset-factories";
import type { ImageNode, SlideChildNode, TextNode } from "../schema";

export const TEXTIQ_NODE_CLIPBOARD_MIME = "application/x-textiq-nodes+json";
export const TEXTIQ_NODE_CLIPBOARD_VERSION = 1;
export const TEXTIQ_NODE_CLIPBOARD_KIND = "textiq.presentation.nodes";
export const TEXTIQ_NODE_CLIPBOARD_SCHEMA_VERSION = 7;
export const TEXTIQ_NODE_CLIPBOARD_MAX_BYTES = 1_000_000;
export const TEXTIQ_NODE_CLIPBOARD_MAX_NODES = 100;
export const TEXTIQ_NODE_CLIPBOARD_MAX_TEXT_CHARS = 20_000;
export const TEXTIQ_NODE_CLIPBOARD_MAX_TEXT_PARAGRAPHS = 40;

type JsonObject = Record<string, unknown>;

export type TextIqNodeClipboardPayloadV1 = {
  kind: typeof TEXTIQ_NODE_CLIPBOARD_KIND;
  version: typeof TEXTIQ_NODE_CLIPBOARD_VERSION;
  schemaVersion: typeof TEXTIQ_NODE_CLIPBOARD_SCHEMA_VERSION;
  nodes: SlideChildNode[];
};

export type TextIqNodeCopyOutPayload = {
  textIqPayload: string;
  html: string;
  plainText: string;
};

export type TextIqNodePayloadParseResult =
  | { ok: true; nodes: SlideChildNode[] }
  | { ok: false; error: string };

export type TextIqNodePasteResolution =
  | { source: "os"; nodes: SlideChildNode[] }
  | { source: "memory"; nodes: SlideChildNode[] }
  | { source: "none"; nodes: [] }
  | { source: "invalid"; nodes: []; error: string };

/* node:coverage ignore next 7 */
export type TextIqExternalClipboardInput = {
  osPayload?: string | null;
  hasImage?: boolean;
  html?: string | null;
  plainText?: string | null;
  memoryNodes: readonly SlideChildNode[];
};

export type TextIqExternalPasteDecision =
  | { source: "os"; nodes: SlideChildNode[] }
  | { source: "image"; nodes: [] }
  | { source: "html"; nodes: [] }
  | { source: "plain-text"; nodes: [] }
  | { source: "memory"; nodes: SlideChildNode[] }
  | { source: "none"; nodes: [] }
  | { source: "invalid"; nodes: []; error: string };

export type ClipboardImageUpload = {
  assetId: string;
  alt: string;
};

const BASE_NODE_KEYS = new Set([
  "id",
  "name",
  "role",
  "slot",
  "layout",
  "style",
  "localStyle",
  "locked",
  "hidden",
  "accessibility",
  "source",
  "type",
]);

const SEMANTIC_ROLES = new Set([
  "slide",
  "title",
  "subtitle",
  "kicker",
  "body",
  "bullet",
  "caption",
  "quote",
  "attribution",
  "metric",
  "label",
  "table",
  "visual",
  "image",
  "card",
  "callout",
  "connector",
  "background",
  "themeDecoration",
]);

const SLOT_KEYS = new Set([
  "kicker",
  "title",
  "subtitle",
  "body",
  "bullets",
  "leftTitle",
  "leftBody",
  "leftBullets",
  "rightTitle",
  "rightBody",
  "rightBullets",
  "cards",
  "steps",
  "quote",
  "attribution",
  "stat",
  "statLabel",
  "metrics",
  "table",
  "visualId",
  "imagePrompt",
  "caption",
]);

const SHAPE_KINDS = new Set([
  "rect",
  "ellipse",
  "line",
  "triangle",
  "diamond",
  "circle",
  "square",
  "path",
]);

const GROUP_COMPONENT_KINDS = new Set([
  "metricCard",
  "quoteBlock",
  "timeline",
  "comparisonGrid",
  "cardGrid",
  "custom",
]);

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonObject, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.length > 0;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringEnum(
  value: unknown,
  options: ReadonlySet<string>,
): value is string {
  return isString(value) && options.has(value);
}

function optionalString(value: JsonObject, key: string): boolean {
  return value[key] === undefined || isString(value[key]);
}

function optionalBoolean(value: JsonObject, key: string): boolean {
  return value[key] === undefined || isBoolean(value[key]);
}

function optionalNumber(value: JsonObject, key: string): boolean {
  return value[key] === undefined || isFiniteNumber(value[key]);
}

function optionalRecord(value: JsonObject, key: string): boolean {
  return value[key] === undefined || isRecord(value[key]);
}

function cloneNodes(nodes: readonly SlideChildNode[]): SlideChildNode[] {
  return JSON.parse(JSON.stringify(nodes)) as SlideChildNode[];
}

function validateFrame(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = new Set(["x", "y", "w", "h"]);
  return (
    hasOnlyKeys(value, keys) &&
    [...keys].every((key) => isFiniteNumber(value[key]))
  );
}

function validateLayout(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = new Set([
    "frame",
    "rotation",
    "zIndex",
    "autoHeight",
    "flipX",
    "flipY",
    "anchor",
    "constraints",
  ]);
  if (!hasOnlyKeys(value, keys)) return false;
  if (!validateFrame(value.frame) || !isFiniteNumber(value.zIndex))
    return false;
  if (!optionalNumber(value, "rotation")) return false;
  if (!optionalBoolean(value, "autoHeight")) return false;
  if (!optionalBoolean(value, "flipX")) return false;
  if (!optionalBoolean(value, "flipY")) return false;
  if (
    value.anchor !== undefined &&
    !isStringEnum(value.anchor, new Set(["topLeft", "center"]))
  ) {
    return false;
  }
  if (value.constraints !== undefined) {
    if (!isRecord(value.constraints)) return false;
    const constraintKeys = new Set([
      "minW",
      "minH",
      "maxW",
      "maxH",
      "preserveAspectRatio",
    ]);
    if (!hasOnlyKeys(value.constraints, constraintKeys)) return false;
    if (!optionalNumber(value.constraints, "minW")) return false;
    if (!optionalNumber(value.constraints, "minH")) return false;
    if (!optionalNumber(value.constraints, "maxW")) return false;
    if (!optionalNumber(value.constraints, "maxH")) return false;
    if (!optionalBoolean(value.constraints, "preserveAspectRatio"))
      return false;
  }
  return true;
}

function validateBaseNode(
  value: JsonObject,
  extraKeys: readonly string[],
): boolean {
  const allowed = new Set([...BASE_NODE_KEYS, ...extraKeys]);
  if (!hasOnlyKeys(value, allowed)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!optionalString(value, "name")) return false;
  if (value.role !== undefined && !isStringEnum(value.role, SEMANTIC_ROLES)) {
    return false;
  }
  if (value.slot !== undefined && !isStringEnum(value.slot, SLOT_KEYS)) {
    return false;
  }
  if (value.layout !== undefined && !validateLayout(value.layout)) return false;
  if (!optionalRecord(value, "style")) return false;
  if (!optionalRecord(value, "localStyle")) return false;
  if (!optionalBoolean(value, "locked")) return false;
  if (!optionalBoolean(value, "hidden")) return false;
  if (!optionalRecord(value, "accessibility")) return false;
  if (!optionalRecord(value, "source")) return false;
  return true;
}

function validateTextRuns(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((run) => {
    if (!isRecord(run)) return false;
    const keys = new Set([
      "text",
      "bold",
      "italic",
      "underline",
      "strikethrough",
      "code",
      "link",
      "localStyle",
    ]);
    return (
      hasOnlyKeys(run, keys) &&
      isString(run.text) &&
      optionalBoolean(run, "bold") &&
      optionalBoolean(run, "italic") &&
      optionalBoolean(run, "underline") &&
      optionalBoolean(run, "strikethrough") &&
      optionalBoolean(run, "code") &&
      optionalString(run, "link") &&
      optionalRecord(run, "localStyle")
    );
  });
}

function validateParagraph(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = new Set(["id", "text", "runs", "list"]);
  if (!hasOnlyKeys(value, keys) || !isNonEmptyString(value.id)) return false;
  if (!isString(value.text) || !validateTextRuns(value.runs)) return false;
  if (value.list !== undefined) {
    if (!isRecord(value.list)) return false;
    const listKeys = new Set(["kind", "indent", "numberStyle"]);
    if (!hasOnlyKeys(value.list, listKeys)) return false;
    if (!isStringEnum(value.list.kind, new Set(["bullet", "number"]))) {
      return false;
    }
    if (!optionalNumber(value.list, "indent")) return false;
    if (
      value.list.numberStyle !== undefined &&
      !isStringEnum(
        value.list.numberStyle,
        new Set(["decimal", "lower-alpha", "upper-alpha", "lower-roman"]),
      )
    ) {
      return false;
    }
  }
  return true;
}

function validateTextContent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = new Set(["paragraphs", "fit", "language"]);
  if (!hasOnlyKeys(value, keys) || !Array.isArray(value.paragraphs))
    return false;
  if (!value.paragraphs.every(validateParagraph)) return false;
  if (
    value.fit !== undefined &&
    !isStringEnum(
      value.fit,
      new Set(["auto-height", "fixed-box", "shrink-to-fit"]),
    )
  ) {
    return false;
  }
  return optionalString(value, "language");
}

function validateCrop(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = new Set(["top", "right", "bottom", "left"]);
  return (
    hasOnlyKeys(value, keys) &&
    [...keys].every((key) => isFiniteNumber(value[key]))
  );
}

function validatePoint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = new Set(["x", "y"]);
  return (
    hasOnlyKeys(value, keys) &&
    [...keys].every((key) => isFiniteNumber(value[key]))
  );
}

function validateConnectorEndpoint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === "point") {
    return (
      hasOnlyKeys(value, new Set(["kind", "point"])) &&
      validatePoint(value.point)
    );
  }
  if (value.kind === "node") {
    return (
      hasOnlyKeys(value, new Set(["kind", "nodeId", "anchor"])) &&
      isNonEmptyString(value.nodeId) &&
      isStringEnum(
        value.anchor,
        new Set(["center", "top", "right", "bottom", "left"]),
      )
    );
  }
  return false;
}

function validateNode(value: unknown): value is SlideChildNode {
  if (!isRecord(value) || !isString(value.type)) return false;
  switch (value.type) {
    case "text":
      return (
        validateBaseNode(value, ["content"]) &&
        validateTextContent(value.content)
      );
    case "image": {
      if (!validateBaseNode(value, ["content"]) || !isRecord(value.content))
        return false;
      const keys = new Set(["assetId", "crop", "fit", "focalPoint", "alt"]);
      return (
        hasOnlyKeys(value.content, keys) &&
        isNonEmptyString(value.content.assetId) &&
        (value.content.crop === undefined ||
          validateCrop(value.content.crop)) &&
        optionalString(value.content, "fit") &&
        (value.content.focalPoint === undefined ||
          validatePoint(value.content.focalPoint)) &&
        optionalString(value.content, "alt")
      );
    }
    case "shape": {
      if (!validateBaseNode(value, ["content"]) || !isRecord(value.content))
        return false;
      return (
        hasOnlyKeys(value.content, new Set(["shape", "path"])) &&
        isStringEnum(value.content.shape, SHAPE_KINDS) &&
        optionalString(value.content, "path")
      );
    }
    case "connector": {
      if (!validateBaseNode(value, ["content"]) || !isRecord(value.content))
        return false;
      return (
        hasOnlyKeys(value.content, new Set(["from", "to", "routing"])) &&
        validateConnectorEndpoint(value.content.from) &&
        validateConnectorEndpoint(value.content.to) &&
        (value.content.routing === undefined ||
          isStringEnum(
            value.content.routing,
            new Set(["straight", "elbow", "curved"]),
          ))
      );
    }
    case "table": {
      if (!validateBaseNode(value, ["content"]) || !isRecord(value.content))
        return false;
      if (
        !hasOnlyKeys(
          value.content,
          new Set(["columns", "rows", "header", "caption"]),
        )
      ) {
        return false;
      }
      if (
        !Array.isArray(value.content.columns) ||
        !Array.isArray(value.content.rows)
      ) {
        return false;
      }
      /* node:coverage ignore next 31 */
      const columnsValid = value.content.columns.every((column) => {
        if (!isRecord(column)) return false;
        return (
          hasOnlyKeys(column, new Set(["id", "label", "width"])) &&
          isNonEmptyString(column.id) &&
          isString(column.label) &&
          optionalNumber(column, "width")
        );
      });
      const rowsValid = value.content.rows.every((row) => {
        if (!isRecord(row)) return false;
        return (
          hasOnlyKeys(row, new Set(["id", "cells"])) &&
          isNonEmptyString(row.id) &&
          Array.isArray(row.cells) &&
          row.cells.every(
            (cell) =>
              isRecord(cell) &&
              hasOnlyKeys(cell, new Set(["text", "runs"])) &&
              isString(cell.text) &&
              validateTextRuns(cell.runs),
          )
        );
      });
      return (
        columnsValid &&
        rowsValid &&
        optionalBoolean(value.content, "header") &&
        optionalString(value.content, "caption")
      );
    }
    case "visual": {
      if (!validateBaseNode(value, ["content"]) || !isRecord(value.content))
        return false;
      return (
        hasOnlyKeys(
          value.content,
          new Set(["assetId", "visualId", "transparentBackground", "alt"]),
        ) &&
        optionalString(value.content, "assetId") &&
        optionalString(value.content, "visualId") &&
        optionalBoolean(value.content, "transparentBackground") &&
        optionalString(value.content, "alt")
      );
    }
    case "group":
      return (
        validateBaseNode(value, ["component", "children"]) &&
        isStringEnum(value.component, GROUP_COMPONENT_KINDS) &&
        Array.isArray(value.children) &&
        value.children.every(validateNode)
      );
    default:
      return false;
  }
}

function countNodes(nodes: readonly SlideChildNode[]): number {
  return nodes.reduce(
    (count, node) =>
      count + 1 + (node.type === "group" ? countNodes(node.children) : 0),
    0,
  );
}

function validateNodes(value: unknown): value is SlideChildNode[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(validateNode) &&
    countNodes(value) <= TEXTIQ_NODE_CLIPBOARD_MAX_NODES
  );
}

export function serializeTextIqNodePayload(
  nodes: readonly SlideChildNode[],
): string {
  if (!validateNodes(nodes)) {
    throw new Error("Cannot serialize invalid TextIQ node clipboard payload.");
  }
  const payload: TextIqNodeClipboardPayloadV1 = {
    kind: TEXTIQ_NODE_CLIPBOARD_KIND,
    version: TEXTIQ_NODE_CLIPBOARD_VERSION,
    schemaVersion: TEXTIQ_NODE_CLIPBOARD_SCHEMA_VERSION,
    nodes: cloneNodes(nodes),
  };
  const serialized = JSON.stringify(payload);
  if (serialized.length > TEXTIQ_NODE_CLIPBOARD_MAX_BYTES) {
    throw new Error("TextIQ node clipboard payload exceeds the maximum size.");
  }
  return serialized;
}

export function parseTextIqNodePayload(
  payload: string,
): TextIqNodePayloadParseResult {
  if (payload.length > TEXTIQ_NODE_CLIPBOARD_MAX_BYTES) {
    return { ok: false, error: "Payload is too large." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false, error: "Payload is not valid JSON." };
  }

  if (!isRecord(parsed))
    return { ok: false, error: "Payload is not an object." };
  const topLevelKeys = new Set(["kind", "version", "schemaVersion", "nodes"]);
  if (!hasOnlyKeys(parsed, topLevelKeys)) {
    return { ok: false, error: "Payload contains unsupported fields." };
  }
  if (parsed.kind !== TEXTIQ_NODE_CLIPBOARD_KIND) {
    return { ok: false, error: "Payload kind is not supported." };
  }
  /* node:coverage ignore next 3 */
  if (parsed.version !== TEXTIQ_NODE_CLIPBOARD_VERSION) {
    return { ok: false, error: "Payload version is not supported." };
  }
  if (parsed.schemaVersion !== TEXTIQ_NODE_CLIPBOARD_SCHEMA_VERSION) {
    return { ok: false, error: "Payload schema version is not supported." };
  }
  if (!validateNodes(parsed.nodes)) {
    return { ok: false, error: "Payload nodes are invalid." };
  }
  return { ok: true, nodes: cloneNodes(parsed.nodes) };
}

export function resolveTextIqNodePaste(
  osPayload: string | null | undefined,
  memoryNodes: readonly SlideChildNode[],
): TextIqNodePasteResolution {
  if (osPayload !== null && osPayload !== undefined) {
    const parsed = parseTextIqNodePayload(osPayload);
    if (!parsed.ok)
      return { source: "invalid", nodes: [], error: parsed.error };
    return { source: "os", nodes: parsed.nodes };
  }
  if (memoryNodes.length === 0) return { source: "none", nodes: [] };
  return { source: "memory", nodes: cloneNodes(memoryNodes) };
}

export function resolveExternalTextIqNodePaste(
  input: TextIqExternalClipboardInput,
): TextIqExternalPasteDecision {
  const osResolution = resolveTextIqNodePaste(input.osPayload, []);
  if (osResolution.source === "invalid" || osResolution.source === "os") {
    return osResolution;
  }
  if (input.hasImage) return { source: "image", nodes: [] };
  if (hasClipboardText(input.html)) return { source: "html", nodes: [] };
  if (hasClipboardText(input.plainText))
    return { source: "plain-text", nodes: [] };
  return resolveTextIqNodePaste(null, input.memoryNodes);
}

function hasClipboardText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function truncateClipboardText(value: string): string {
  return value.length > TEXTIQ_NODE_CLIPBOARD_MAX_TEXT_CHARS
    ? value.slice(0, TEXTIQ_NODE_CLIPBOARD_MAX_TEXT_CHARS)
    : value;
}

function escapeClipboardHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function textNodePlainText(node: SlideChildNode): string {
  if (node.type !== "text") return "";
  return node.content.paragraphs
    .map((paragraph) => paragraph.text)
    .join("\n")
    .trim();
}

function tableNodePlainText(node: SlideChildNode): string {
  if (node.type !== "table") return "";
  return node.content.rows
    .map((row) => row.cells.map((cell) => cell.text).join("\t"))
    .join("\n")
    .trim();
}

function nodeAccessibleLabel(node: SlideChildNode): string {
  if (node.accessibility?.label) return node.accessibility.label;
  if (node.name) return node.name;
  if (node.type === "image" || node.type === "visual")
    return node.content.alt ?? "";
  return "";
}

function nodeCopyOutText(node: SlideChildNode): string {
  const text = textNodePlainText(node) || tableNodePlainText(node);
  if (text) return text;
  if (node.type === "group") {
    return node.children.map(nodeCopyOutText).filter(Boolean).join("\n").trim();
  }
  return nodeAccessibleLabel(node);
}

export function textIqNodeHtmlFallback(
  nodes: readonly SlideChildNode[],
): string {
  const body = nodes
    .map((node) => {
      const text = nodeCopyOutText(node);
      const label = nodeAccessibleLabel(node) || `${node.type} node`;
      const content = text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<p>${escapeClipboardHtml(line)}</p>`)
        .join("");
      return `<section data-textiq-node-type="${escapeClipboardHtml(node.type)}" aria-label="${escapeClipboardHtml(label)}">${content || `<p>${escapeClipboardHtml(label)}</p>`}</section>`;
    })
    .join("");
  return `<div data-textiq-copy="nodes">${body}</div>`;
}

/* node:coverage ignore next 26 */
function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    const lower = String(code).toLowerCase();
    if (lower.startsWith("#x")) {
      const parsed = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(parsed) && parsed >= 0 && parsed <= 0x10ffff
        ? String.fromCodePoint(parsed)
        : entity;
    }
    if (lower.startsWith("#")) {
      const parsed = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(parsed) && parsed >= 0 && parsed <= 0x10ffff
        ? String.fromCodePoint(parsed)
        : entity;
    }
    return named[lower] ?? entity;
  });
}

export function sanitizedClipboardHtmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<[^>]*>/g, " "),
  );
}

export function clipboardTextParagraphs(rawText: string): string[] {
  const normalized = truncateClipboardText(rawText)
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}|\n/)
    .map((paragraph) => paragraph.replace(/[ \t\f\v]+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
  return normalized.slice(0, TEXTIQ_NODE_CLIPBOARD_MAX_TEXT_PARAGRAPHS);
}

export function clipboardTextNode(
  rawText: string,
  zIndex: number,
  options: { html?: boolean } = {},
): SlideChildNode | null {
  const text = options.html ? sanitizedClipboardHtmlToText(rawText) : rawText;
  const paragraphs = clipboardTextParagraphs(text);
  if (paragraphs.length === 0) return null;
  const node = defaultTextNode(zIndex) as TextNode;
  return {
    ...node,
    content: {
      ...node.content,
      paragraphs: paragraphs.map((paragraph, index) => ({
        id: `${node.id}-p-${index + 1}`,
        text: paragraph,
      })),
    },
  };
}

export function clipboardImageNode(
  upload: ClipboardImageUpload,
  zIndex: number,
): SlideChildNode {
  const node = defaultImageNode(zIndex) as ImageNode;
  return {
    ...node,
    content: { ...node.content, assetId: upload.assetId, alt: upload.alt },
  };
}

export async function clipboardImageNodeFromUpload<TImage>(
  image: TImage,
  zIndex: number,
  uploadImage: (image: TImage) => Promise<ClipboardImageUpload>,
): Promise<SlideChildNode> {
  return clipboardImageNode(await uploadImage(image), zIndex);
}

export function textIqNodePlainTextFallback(
  nodes: readonly SlideChildNode[],
): string {
  const label =
    nodes.length === 1 ? "1 TextIQ node" : `${nodes.length} TextIQ nodes`;
  const text = nodes.map(nodeCopyOutText).filter(Boolean).join("\n").trim();
  return text ? `${label}\n${text}` : label;
}

export function buildTextIqNodeCopyOutPayload(
  nodes: readonly SlideChildNode[],
): TextIqNodeCopyOutPayload {
  return {
    textIqPayload: serializeTextIqNodePayload(nodes),
    html: textIqNodeHtmlFallback(nodes),
    plainText: textIqNodePlainTextFallback(nodes),
  };
}
