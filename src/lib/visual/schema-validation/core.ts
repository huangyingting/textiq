/** Core visual schema validation and composition across concerns. */

import {
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  VISUAL_KINDS,
  VISUAL_SCHEMA_VERSION,
  isVisualKind,
  type Visual,
} from "@/lib/visual/schema-types";
import { validateEdge } from "./edges";
import { parseEffects } from "./effects";
import { parseVisualExportOptions } from "./export-options";
import { validateNode } from "./nodes";
import { normalizeStyle } from "./style";
/* node:coverage ignore next -- tsx maps this covered utility import line as uncovered. */
import { isPlainObject } from "@/lib/type-guards";
import { VisualValidationError, numberField } from "./utils";

export function validateVisual(input: unknown): Visual {
  if (!isPlainObject(input)) {
    throw new VisualValidationError("Visual must be an object");
  }

  if (input.version !== VISUAL_SCHEMA_VERSION) {
    throw new VisualValidationError(
      `Unsupported visual version: ${String(input.version)} (expected ${VISUAL_SCHEMA_VERSION})`,
    );
  }

  if (!isVisualKind(input.type)) {
    throw new VisualValidationError(
      `Visual.type must be one of: ${VISUAL_KINDS.join(", ")}`,
    );
  }

  if (!Array.isArray(input.nodes) || input.nodes.length === 0) {
    throw new VisualValidationError("Visual.nodes must be a non-empty array");
  }

  const nodes = input.nodes.map(validateNode);
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      throw new VisualValidationError(`Duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);
  }

  const rawEdges = input.edges ?? [];
  if (!Array.isArray(rawEdges)) {
    throw new VisualValidationError("Visual.edges must be an array");
  }
  const edges = rawEdges.map((edge, index) =>
    validateEdge(edge, index, nodeIds),
  );
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) {
      throw new VisualValidationError(`Duplicate edge id: ${edge.id}`);
    }
    edgeIds.add(edge.id);
  }

  let title: string | undefined;
  if (input.title !== undefined) {
    if (typeof input.title !== "string") {
      throw new VisualValidationError("Visual.title must be a string");
    }
    title = input.title;
  }

  const width =
    numberField(input, "width", "Visual", { positive: true }) ??
    DEFAULT_CANVAS_WIDTH;
  const height =
    numberField(input, "height", "Visual", { positive: true }) ??
    DEFAULT_CANVAS_HEIGHT;
  const exportOptions = parseVisualExportOptions(input);
  const effects = parseEffects(input.effects);

  return {
    version: VISUAL_SCHEMA_VERSION,
    type: input.type,
    ...(title !== undefined ? { title } : {}),
    width,
    height,
    nodes,
    edges,
    style: normalizeStyle(input.style),
    ...exportOptions,
    ...(typeof input.sourceText === "string"
      ? { sourceText: input.sourceText }
      : {}),
    ...(typeof input.sourceTextHash === "string"
      ? { sourceTextHash: input.sourceTextHash }
      : {}),
    ...(typeof input.autoLayout === "boolean"
      ? { autoLayout: input.autoLayout }
      : {}),
    ...(effects ? { effects } : {}),
  };
}
