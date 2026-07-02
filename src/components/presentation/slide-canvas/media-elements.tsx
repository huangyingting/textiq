import type { JSX } from "react";
import type * as React from "react";

import type { ImageElement } from "@/lib/presentation/deck";
import { isEmptyImageSrc } from "@/lib/visual/image-element";
import type { ResolvedElementDesign } from "@/lib/presentation/slide-render-model";

import { boxStyle } from "./primitives";
import { imageContent } from "./v6-model";

type ResolvedImageDesign = Extract<ResolvedElementDesign, { kind: "image" }>;

function hasImageCrop(
  crop: ImageElement["content"]["crop"] | undefined,
): crop is NonNullable<ImageElement["content"]["crop"]> {
  return Boolean(
    crop &&
    (crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0),
  );
}

function imageObjectPosition(
  crop: ImageElement["content"]["crop"] | undefined,
): string {
  if (!crop) return "50% 50%";
  const remainingX = Math.max(0, 1 - crop.left - crop.right);
  const remainingY = Math.max(0, 1 - crop.top - crop.bottom);
  const x = Math.max(0, Math.min(1, crop.left + remainingX / 2));
  const y = Math.max(0, Math.min(1, crop.top + remainingY / 2));
  return `${x * 100}% ${y * 100}%`;
}

function imageCropClipPath(
  crop: ImageElement["content"]["crop"] | undefined,
): string | undefined {
  if (!hasImageCrop(crop)) return undefined;
  return `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`;
}

function imageMaskStyle(mask: {
  maskShape?:
    | "none"
    | "rect"
    | "circle"
    | "ellipse"
    | "rounded"
    | "diamond"
    | "triangle";
  radius?: number;
}): React.CSSProperties {
  const radius =
    mask.radius !== undefined && mask.radius > 0 ? mask.radius : undefined;
  switch (mask.maskShape) {
    case "circle":
      return { clipPath: "circle(50% at 50% 50%)" };
    case "ellipse":
      return { clipPath: "ellipse(50% 50% at 50% 50%)" };
    case "diamond":
      return {
        clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
      };
    case "triangle":
      return { clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)" };
    case "rounded":
      return { borderRadius: `${radius ?? 12}%` };
    default:
      return radius ? { borderRadius: `${radius}%` } : {};
  }
}

export function ImageElementView({
  element,
  editable = false,
  resolvedDesign,
}: {
  element: ImageElement;
  /**
   * True only on the editing stage. Controls how an empty-source image renders:
   * editor shows an "Add image" dropzone affordance; present / public / preview
   * surfaces render a neutral box so they never show a broken image (#226).
   */
  editable?: boolean;
  resolvedDesign?: ResolvedImageDesign;
}): JSX.Element {
  const content = imageContent(element);
  const cropClipPath = imageCropClipPath(content.crop);
  const effMask = {
    maskShape: resolvedDesign?.maskShape,
    radius: resolvedDesign?.radius,
  };
  const outerStyle: React.CSSProperties = {
    ...boxStyle(element),
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    ...imageMaskStyle(effMask),
  };
  const innerStyle: React.CSSProperties = {
    height: "100%",
    width: "100%",
    overflow: "hidden",
    ...(cropClipPath ? { clipPath: cropClipPath } : {}),
  };

  // Never emit `<img src="">` — it shows a broken-image box and can re-request
  // the current page. Branch on the empty-source predicate instead.
  if (isEmptyImageSrc(content.src)) {
    return (
      <div style={outerStyle}>
        <div
          style={{
            ...innerStyle,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5em",
            ...(editable
              ? {
                  color: "rgba(113, 113, 122, 0.9)",
                  border: "1px dashed rgba(113, 113, 122, 0.5)",
                  borderRadius: "0.5em",
                  backgroundColor: "rgba(113, 113, 122, 0.06)",
                  fontSize: "3.5cqh",
                }
              : {}),
          }}
        >
          {editable ? (
            <>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ height: "8cqh", width: "8cqh" }}
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
              <span>Add image</span>
            </>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div style={outerStyle}>
      <div style={innerStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={content.src}
          alt={content.alt ?? ""}
          style={{
            display: "block",
            height: "100%",
            width: "100%",
            objectFit: resolvedDesign?.fitMode ?? "contain",
            objectPosition: imageObjectPosition(content.crop),
          }}
        />
      </div>
    </div>
  );
}
