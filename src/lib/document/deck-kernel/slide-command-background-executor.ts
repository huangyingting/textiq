import type { Deck } from "./deck-core";
import {
  setSlideAccent,
  setSlideBackground,
  setSlideBackgroundAsset,
  setSlideBackgroundGradient,
  setSlideBackgroundImage,
} from "./deck-mutation-slide-style";
import type {
  DeckPatch,
  SetSlideAccentCommand,
  SetSlideBackgroundAssetCommand,
  SetSlideBackgroundCommand,
  SetSlideBackgroundGradientCommand,
  SetSlideBackgroundImageCommand,
} from "./slide-command-contracts";
import {
  failure,
  findSlideIndex,
  makePatch,
  success,
} from "./slide-command-executor-helpers";

export type BackgroundFamilyCommand =
  | SetSlideBackgroundCommand
  | SetSlideBackgroundGradientCommand
  | SetSlideBackgroundImageCommand
  | SetSlideBackgroundAssetCommand
  | SetSlideAccentCommand;

type SlideFieldPatch = NonNullable<DeckPatch["slideFields"]>[string];

function slideDesignFields(
  slideId: string,
  designOverrides: SlideFieldPatch["designOverrides"],
): DeckPatch["slideFields"] {
  return { [slideId]: { designOverrides } };
}

export function executeBackgroundFamilyCommand(
  deck: Deck,
  cmd: BackgroundFamilyCommand,
) {
  switch (cmd.type) {
    case "SET_SLIDE_BACKGROUND": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      const fields: DeckPatch["slideFields"] =
        cmd.background !== undefined
          ? slideDesignFields(cmd.slideId, {
              background: {
                type: "solid",
                color: { value: cmd.background },
              },
            })
          : slideDesignFields(cmd.slideId, {});
      return success(
        setSlideBackground(deck, index, cmd.background),
        [cmd.slideId],
        [],
        undefined,
        [
          makePatch("slide.set_background", [cmd.slideId], [], {
            slideFields: fields,
          }),
        ],
      );
    }
    case "SET_SLIDE_BACKGROUND_GRADIENT": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      const fields: DeckPatch["slideFields"] =
        cmd.gradient !== undefined
          ? slideDesignFields(cmd.slideId, {
              background: {
                type: "gradient",
                from: { value: cmd.gradient.from },
                to: { value: cmd.gradient.to },
                ...(cmd.gradient.angle !== undefined
                  ? { angle: cmd.gradient.angle }
                  : {}),
              },
            })
          : slideDesignFields(cmd.slideId, {});
      return success(
        setSlideBackgroundGradient(deck, index, cmd.gradient),
        [cmd.slideId],
        [],
        undefined,
        [
          makePatch("slide.set_background_gradient", [cmd.slideId], [], {
            slideFields: fields,
          }),
        ],
      );
    }
    case "SET_SLIDE_BACKGROUND_IMAGE": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      const fields: DeckPatch["slideFields"] =
        cmd.image !== undefined
          ? slideDesignFields(cmd.slideId, {
              background: { type: "image", url: cmd.image },
            })
          : slideDesignFields(cmd.slideId, {});
      return success(
        setSlideBackgroundImage(deck, index, cmd.image),
        [cmd.slideId],
        [],
        undefined,
        [
          makePatch("slide.set_background_image", [cmd.slideId], [], {
            slideFields: fields,
          }),
        ],
      );
    }
    case "SET_SLIDE_BACKGROUND_ASSET": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      const fields: DeckPatch["slideFields"] = cmd.opts
        ? slideDesignFields(cmd.slideId, {
            background: {
              type: "image",
              url: cmd.opts.url,
              assetId: cmd.opts.assetId,
            },
          })
        : slideDesignFields(cmd.slideId, {});
      return success(
        setSlideBackgroundAsset(deck, index, cmd.opts),
        [cmd.slideId],
        [],
        undefined,
        [
          makePatch("slide.set_background_asset", [cmd.slideId], [], {
            slideFields: fields,
          }),
        ],
      );
    }
    case "SET_SLIDE_ACCENT": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      const fields: DeckPatch["slideFields"] =
        cmd.accent !== undefined
          ? slideDesignFields(cmd.slideId, { accent: { value: cmd.accent } })
          : slideDesignFields(cmd.slideId, {});
      return success(
        setSlideAccent(deck, index, cmd.accent),
        [cmd.slideId],
        [],
        undefined,
        [
          makePatch("slide.set_accent", [cmd.slideId], [], {
            slideFields: fields,
          }),
        ],
      );
    }
  }
}
