/** Node-level visual schema validation. */

import { isKnownIcon } from "@/lib/icons/catalog";
import {
  NODE_SHAPES,
  isFillStyle,
  isLineStyle,
  isNodeShape,
  isTextAlign,
  type VisualNode,
} from "@/lib/visual/schema-types";
import { isPlainObject } from "@/lib/type-guards";
import { isSafeVisualColor } from "./colors";
import { VisualValidationError, numberField } from "./utils";

export function validateNode(input: unknown, index: number): VisualNode {
  const context = `nodes[${index}]`;
  if (!isPlainObject(input)) {
    throw new VisualValidationError(`${context} must be an object`);
  }

  const { id, label } = input;
  if (typeof id !== "string" || id.length === 0) {
    throw new VisualValidationError(`${context}.id must be a non-empty string`);
  }
  if (typeof label !== "string") {
    throw new VisualValidationError(`${context}.label must be a string`);
  }

  const node: VisualNode = { id, label };

  const x = numberField(input, "x", context);
  if (x !== undefined) node.x = x;
  const y = numberField(input, "y", context);
  if (y !== undefined) node.y = y;
  const width = numberField(input, "width", context, { positive: true });
  if (width !== undefined) node.width = width;
  const height = numberField(input, "height", context, { positive: true });
  if (height !== undefined) node.height = height;
  const value = numberField(input, "value", context);
  if (value !== undefined) node.value = value;

  if (input.shape !== undefined) {
    if (!isNodeShape(input.shape)) {
      throw new VisualValidationError(
        `${context}.shape must be one of: ${NODE_SHAPES.join(", ")}`,
      );
    }
    node.shape = input.shape;
  }

  if (input.color !== undefined) {
    if (typeof input.color !== "string") {
      throw new VisualValidationError(`${context}.color must be a string`);
    }
    if (!isSafeVisualColor(input.color)) {
      throw new VisualValidationError(`${context}.color must be a safe color`);
    }
    node.color = input.color;
  }

  if (input.stroke !== undefined) {
    if (typeof input.stroke !== "string") {
      throw new VisualValidationError(`${context}.stroke must be a string`);
    }
    if (!isSafeVisualColor(input.stroke)) {
      throw new VisualValidationError(`${context}.stroke must be a safe color`);
    }
    node.stroke = input.stroke;
  }

  if (input.textColor !== undefined) {
    if (typeof input.textColor !== "string") {
      throw new VisualValidationError(`${context}.textColor must be a string`);
    }
    if (!isSafeVisualColor(input.textColor)) {
      throw new VisualValidationError(
        `${context}.textColor must be a safe color`,
      );
    }
    node.textColor = input.textColor;
  }

  if (typeof input.icon === "string" && isKnownIcon(input.icon)) {
    node.icon = input.icon;
  }

  if (isFillStyle(input.fillStyle)) {
    node.fillStyle = input.fillStyle;
  }
  if (isLineStyle(input.borderStyle)) {
    node.borderStyle = input.borderStyle;
  }
  const borderWidth = numberField(input, "borderWidth", context, {
    positive: true,
  });
  if (borderWidth !== undefined) node.borderWidth = borderWidth;
  if (isTextAlign(input.textAlign)) {
    node.textAlign = input.textAlign;
  }
  if (typeof input.fontFamily === "string" && input.fontFamily.length > 0) {
    node.fontFamily = input.fontFamily.slice(0, 200);
  }

  return node;
}
