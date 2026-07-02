import type { Deck } from "./deck-core";
import {
  activeSourceRef,
  unlinkSource,
  type SourceRef,
} from "./deck-source-refs";
import { removeElement, updateElement } from "./deck-mutation-elements";
import type { ElementPatch } from "./deck-mutation-shared";
import type {
  RemoveSourceElementCommand,
  UpdateElementSourceCommand,
} from "./slide-command-contracts";
import {
  failure,
  findSlideIndex,
  makePatch,
  success,
} from "./slide-command-executor-helpers";

export type SourceRefFamilyCommand =
  | UpdateElementSourceCommand
  | RemoveSourceElementCommand;

function elementSource(element: unknown): SourceRef | undefined {
  return (element as { source?: SourceRef }).source;
}

export function executeSourceRefFamilyCommand(
  deck: Deck,
  cmd: SourceRefFamilyCommand,
) {
  switch (cmd.type) {
    case "UPDATE_ELEMENT_SOURCE": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      const element = deck.slides[index]!.elements?.find(
        (e) => e.id === cmd.elementId,
      );
      if (!element) return failure(deck, `Element not found: ${cmd.elementId}`);
      const currentSource = elementSource(element);
      if (currentSource === undefined)
        return failure(deck, `Element has no source link: ${cmd.elementId}`);
      const source: SourceRef = cmd.unlink
        ? (unlinkSource({ source: currentSource }).source ?? currentSource)
        : activeSourceRef(cmd.source ?? currentSource);
      const patch: ElementPatch = {
        source,
        ...(element.kind === "text" && cmd.text !== undefined
          ? {
              content: {
                ...((element as any).content ?? {}),
                kind: "text",
                text: cmd.text,
                ...(cmd.runs !== undefined ? { runs: cmd.runs } : {}),
                paragraphs: [
                  {
                    text: cmd.text,
                    ...(cmd.runs !== undefined ? { runs: cmd.runs } : {}),
                  },
                ],
              },
            }
          : {}),
      } as unknown as ElementPatch;
      return success(
        updateElement(deck, index, cmd.elementId, patch),
        [cmd.slideId],
        [cmd.elementId],
        undefined,
        [
          makePatch("element.update", [cmd.slideId], [cmd.elementId], {
            elementFields: { [cmd.elementId]: patch },
          }),
        ],
      );
    }
    case "REMOVE_SOURCE_ELEMENT": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      if (!deck.slides[index]!.elements?.some((e) => e.id === cmd.elementId))
        return failure(deck, `Element not found: ${cmd.elementId}`);
      return success(
        removeElement(deck, index, cmd.elementId),
        [cmd.slideId],
        [cmd.elementId],
        undefined,
        [
          makePatch("element.remove", [cmd.slideId], [cmd.elementId], {
            removedIds: [cmd.elementId],
          }),
        ],
      );
    }
  }
}
