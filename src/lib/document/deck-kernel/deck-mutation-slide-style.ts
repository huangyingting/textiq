import type {
  ColorRef,
  Deck,
  Slide,
  SlideBackgroundDesign,
  SlideDesignOverrides,
} from "./deck-core";
import { mapSlide } from "./deck-mutation-shared";

function setSlideBackgroundOverride(
  slide: Slide,
  background: SlideBackgroundDesign | undefined,
) {
  return setSlideDesignOverride(slide, "background", background);
}

function setSlideDesignOverride(
  slide: Slide,
  key: string,
  value: SlideDesignOverrides[string] | undefined,
) {
  const designOverrides: SlideDesignOverrides = {
    ...(slide.designOverrides ?? {}),
  };
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
      slide,
      background === undefined
        ? undefined
        : { type: "solid", color: { value: background } },
    );
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
      slide,
      "accent",
      accent === undefined ? undefined : ({ value: accent } satisfies ColorRef),
    );
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
      slide,
      gradient === undefined
        ? undefined
        : {
            type: "gradient",
            from: { value: gradient.from },
            to: { value: gradient.to },
            ...(gradient.angle !== undefined ? { angle: gradient.angle } : {}),
          },
    );
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
      slide,
      image === undefined ? undefined : { type: "image", url: image },
    );
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
      slide,
      opts === undefined
        ? undefined
        : { type: "image", url: opts.url, assetId: opts.assetId },
    );
  });
}
