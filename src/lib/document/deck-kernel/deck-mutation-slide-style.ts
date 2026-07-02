import type { Deck } from "./deck-core";
import { mapSlide } from "./deck-mutation-shared";

function setSlideBackgroundOverride(
  slide: Record<string, any>,
  background: Record<string, unknown> | undefined,
) {
  return setSlideDesignOverride(slide, "background", background);
}

function setSlideDesignOverride(
  slide: Record<string, any>,
  key: string,
  value: Record<string, unknown> | undefined,
) {
  const designOverrides = { ...(slide.designOverrides ?? {}) };
  if (value === undefined) {
    delete designOverrides[key];
  } else {
    designOverrides[key] = value;
  }
  const next = { ...slide };
  if (Object.keys(designOverrides).length === 0) {
    delete next.designOverrides;
  } else {
    next.designOverrides = designOverrides;
  }
  return next;
}

/** Sets (or clears, with `undefined`) a slide's background color override. */
export function setSlideBackground(
  deck: Deck,
  index: number,
  background: string | undefined,
): Deck {
  return mapSlide(deck, index, (slide) => {
    return setSlideBackgroundOverride(
      slide as Record<string, any>,
      background === undefined
        ? undefined
        : { type: "solid", color: { value: background } },
    ) as typeof slide;
  });
}

/** Sets (or clears, with `undefined`) a slide's accent color override. */
export function setSlideAccent(
  deck: Deck,
  index: number,
  accent: string | undefined,
): Deck {
  return mapSlide(deck, index, (slide) => {
    return setSlideDesignOverride(
      slide as Record<string, any>,
      "accent",
      accent === undefined ? undefined : { value: accent },
    ) as typeof slide;
  });
}

/**
 * Sets (or clears) a slide's background gradient. Setting it clears any
 * background image so the precedence (image > gradient > solid) stays clean.
 */
export function setSlideBackgroundGradient(
  deck: Deck,
  index: number,
  gradient: { from: string; to: string; angle?: number } | undefined,
): Deck {
  return mapSlide(deck, index, (slide) => {
    return setSlideBackgroundOverride(
      slide as Record<string, any>,
      gradient === undefined
        ? undefined
        : {
            type: "gradient",
            from: { value: gradient.from },
            to: { value: gradient.to },
            ...(gradient.angle !== undefined ? { angle: gradient.angle } : {}),
          },
    ) as typeof slide;
  });
}

/**
 * Sets (or clears) a slide's background image. Setting it clears any background
 * gradient so the precedence stays clean.
 */
export function setSlideBackgroundImage(
  deck: Deck,
  index: number,
  image: string | undefined,
): Deck {
  return mapSlide(deck, index, (slide) => {
    return setSlideBackgroundOverride(
      slide as Record<string, any>,
      image === undefined ? undefined : { type: "image", url: image },
    ) as typeof slide;
  });
}

/**
 * Sets a slide's background to a server-stored asset, persisting both the
 * resolved URL (as `backgroundImage`) and the asset id (as `backgroundAssetId`)
 * so renderers can use the resolver.
 * Clears any background gradient.  Passing `undefined` for both clears the
 * background asset and image.
 */
export function setSlideBackgroundAsset(
  deck: Deck,
  index: number,
  opts: { url: string; assetId: string } | undefined,
): Deck {
  return mapSlide(deck, index, (slide) => {
    return setSlideBackgroundOverride(
      slide as Record<string, any>,
      opts === undefined
        ? undefined
        : { type: "image", url: opts.url, assetId: opts.assetId },
    ) as typeof slide;
  });
}
