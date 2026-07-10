/** Edge-level visual schema validation. */

import {
  isArrowStyle,
  isEdgeStyle,
  isLineStyle,
  type VisualEdge,
} from "@/lib/visual/schema-types";
import { isPlainObject } from "@/lib/type-guards";
import { VisualValidationError, numberField } from "./utils";

export function validateEdge(
  input: unknown,
  index: number,
  nodeIds: ReadonlySet<string>,
): VisualEdge {
  const context = `edges[${index}]`;
  if (!isPlainObject(input)) {
    throw new VisualValidationError(`${context} must be an object`);
  }

  const { id, from, to } = input;
  if (typeof id !== "string" || id.length === 0) {
    throw new VisualValidationError(`${context}.id must be a non-empty string`);
  }
  if (typeof from !== "string" || !nodeIds.has(from)) {
    throw new VisualValidationError(
      `${context}.from must reference an existing node id`,
    );
  }
  if (typeof to !== "string" || !nodeIds.has(to)) {
    throw new VisualValidationError(
      `${context}.to must reference an existing node id`,
    );
  }

  const edge: VisualEdge = { id, from, to };

  if (input.label !== undefined) {
    if (typeof input.label !== "string") {
      throw new VisualValidationError(`${context}.label must be a string`);
    }
    edge.label = input.label;
  }

  if (input.directed !== undefined) {
    if (typeof input.directed !== "boolean") {
      throw new VisualValidationError(`${context}.directed must be a boolean`);
    }
    edge.directed = input.directed;
  }

  if (isEdgeStyle(input.style)) {
    edge.style = input.style;
  }
  if (isArrowStyle(input.arrowStyle)) {
    edge.arrowStyle = input.arrowStyle;
  }
  if (isLineStyle(input.lineStyle)) {
    edge.lineStyle = input.lineStyle;
  }
  const lineWidth = numberField(input, "lineWidth", context, {
    positive: true,
  });
  if (lineWidth !== undefined) edge.lineWidth = lineWidth;

  return edge;
}
