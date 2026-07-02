import type { ElementBox, ShapeKind } from "./deck-elements";

/**
 * Fixed-aspect semantic shapes (`circle`, `square`) keep the same outer layout
 * box as any other element, but render as the largest centered square inside
 * that box. Canvas callers must use `inscribedElementBox` because percentage
 * boxes need slide aspect-ratio math; SVG/PPTX callers already work in real
 * units and can use `shapeRenderBox` directly.
 */

export interface RectLike {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanvasLike {
  width: number;
  height: number;
}

export function isInscribedShape(shape: ShapeKind): boolean {
  return shape === "circle" || shape === "square";
}

export function inscribedSquareBox<T extends RectLike>(box: T): T {
  const side = Math.min(box.w, box.h);
  return {
    ...box,
    x: box.x + (box.w - side) / 2,
    y: box.y + (box.h - side) / 2,
    w: side,
    h: side,
  };
}

export function shapeRenderBox<T extends RectLike>(
  shape: ShapeKind,
  box: T,
): T {
  return isInscribedShape(shape) ? inscribedSquareBox(box) : box;
}

export function inscribedElementBox(
  shape: ShapeKind,
  box: ElementBox,
  canvas: CanvasLike,
): ElementBox {
  if (!isInscribedShape(shape)) return box;
  const actualW = (box.w / 100) * canvas.width;
  const actualH = (box.h / 100) * canvas.height;
  const side = Math.min(actualW, actualH);
  const w = (side / canvas.width) * 100;
  const h = (side / canvas.height) * 100;
  return {
    x: box.x + (box.w - w) / 2,
    y: box.y + (box.h - h) / 2,
    w,
    h,
  };
}

export function relativeBox(inner: RectLike, outer: RectLike): RectLike {
  return {
    x: outer.w === 0 ? 0 : ((inner.x - outer.x) / outer.w) * 100,
    y: outer.h === 0 ? 0 : ((inner.y - outer.y) / outer.h) * 100,
    w: outer.w === 0 ? 0 : (inner.w / outer.w) * 100,
    h: outer.h === 0 ? 0 : (inner.h / outer.h) * 100,
  };
}
