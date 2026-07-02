import type { Deck, Slide } from "./deck-core";
import type { BackgroundTreatment } from "./presentation-theme-types";
import { resolveMaster, resolveSlideStyle } from "./style-cascade-layers";

export type SlideDesignOriginLayer = "theme" | "master" | "slide" | "deck";

export interface SlideDesignOrigin<T> {
  layer: SlideDesignOriginLayer;
  value: T;
  sourceId?: string;
}

export interface SlideDesignOriginReport {
  themeId: SlideDesignOrigin<string>;
  masterId?: SlideDesignOrigin<string>;
  background: SlideDesignOrigin<BackgroundTreatment>;
  accent: SlideDesignOrigin<string>;
}

function hasOwnRecordKey(value: unknown, key: string): boolean {
  return Boolean(value && typeof value === "object" && key in value);
}

export function inspectSlideDesignOrigins(
  deck: Deck,
  slide: Slide,
): SlideDesignOriginReport {
  const style = resolveSlideStyle(deck, slide);
  const master = resolveMaster(deck, slide);
  const rawDeck = deck as any;
  const rawSlide = slide as any;
  const slideDesign = rawSlide.designOverrides;

  const themeId =
    typeof rawDeck.design?.themeId === "string"
      ? rawDeck.design.themeId
      : style.tokenSet.id;

  const backgroundLayer: SlideDesignOriginLayer = hasOwnRecordKey(
    slideDesign,
    "background",
  )
    ? "slide"
    : master?.background !== undefined
      ? "master"
      : "theme";

  const accentLayer: SlideDesignOriginLayer = hasOwnRecordKey(
    slideDesign,
    "accent",
  )
    ? "slide"
    : "theme";

  return {
    themeId: { layer: "theme", value: themeId },
    ...(master !== undefined
      ? {
          masterId: {
            layer: "deck",
            value: master.id,
            sourceId: master.id,
          },
        }
      : {}),
    background: {
      layer: backgroundLayer,
      value: style.background,
      ...(backgroundLayer === "master" && master !== undefined
        ? { sourceId: master.id }
        : {}),
    },
    accent: { layer: accentLayer, value: style.accent },
  };
}
