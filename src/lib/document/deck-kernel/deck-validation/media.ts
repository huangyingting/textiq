import {
  IMAGE_FIT_MODES,
  IMAGE_MASK_SHAPES,
  type ImageCrop,
  type ImageFitMode,
  type ImageMaskShape,
} from "../deck-elements";
import {
  DeckValidationError,
  isPlainObject,
  validateUnitFraction,
} from "./shared";

export function validateImageFitMode(
  value: unknown,
  context: string,
): ImageFitMode | undefined {
  if (value === undefined) return undefined;
  if (!IMAGE_FIT_MODES.includes(value as ImageFitMode)) {
    throw new DeckValidationError(
      `${context} must be one of: ${IMAGE_FIT_MODES.join(", ")}`,
    );
  }
  return value as ImageFitMode;
}

export function validateImageMaskShape(
  value: unknown,
  context: string,
): ImageMaskShape | undefined {
  if (value === undefined) return undefined;
  if (!IMAGE_MASK_SHAPES.includes(value as ImageMaskShape)) {
    throw new DeckValidationError(
      `${context} must be one of: ${IMAGE_MASK_SHAPES.join(", ")}`,
    );
  }
  return value as ImageMaskShape;
}

export function validateImageCrop(
  input: unknown,
  context: string,
): ImageCrop | undefined {
  if (input === undefined) return undefined;
  if (!isPlainObject(input)) {
    throw new DeckValidationError(`${context} must be an object`);
  }
  return {
    top: validateUnitFraction(input.top, `${context}.top`),
    right: validateUnitFraction(input.right, `${context}.right`),
    bottom: validateUnitFraction(input.bottom, `${context}.bottom`),
    left: validateUnitFraction(input.left, `${context}.left`),
  };
}
