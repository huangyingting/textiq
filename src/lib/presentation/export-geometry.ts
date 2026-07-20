export const CUSTOM_EXPORT_MAX_AXIS_IN = 13.333;

export type CanvasPhysicalInches = {
  widthIn: number;
  heightIn: number;
};

export function resolveCanvasAspectRatio(
  width: number,
  height: number,
  fallbackRatio = 16 / 9,
): number {
  return width > 0 && height > 0 ? width / height : fallbackRatio;
}

export function resolveCappedCanvasInches(
  width: number,
  height: number,
  maxAxisIn = CUSTOM_EXPORT_MAX_AXIS_IN,
): CanvasPhysicalInches {
  const ratio = resolveCanvasAspectRatio(width, height);

  if (ratio >= 1) {
    return { widthIn: maxAxisIn, heightIn: maxAxisIn / ratio };
  }

  return { widthIn: maxAxisIn * ratio, heightIn: maxAxisIn };
}
