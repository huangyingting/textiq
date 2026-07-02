import type { Deck, Slide } from "./deck-core";
import { makeSlideId } from "./deck-ids";
import {
  addSlide,
  duplicateSlide,
  insertSlide,
  moveSlide,
  removeSlide,
  reorderSlides,
  updateSlide,
} from "./deck-mutation-slides";
import type {
  AddSlideCommand,
  DuplicateSlideCommand,
  InsertTemplateSlideCommand,
  MoveSlideCommand,
  RemoveSlideCommand,
  ReorderSlideCommand,
  UpdateSlideCommand,
  UpdateSlideNotesCommand,
  UpdateSlideTitleCommand,
} from "./slide-command-contracts";
import {
  failure,
  findSlideIndex,
  makePatch,
  success,
} from "./slide-command-executor-helpers";

export type SlideFamilyCommand =
  | AddSlideCommand
  | RemoveSlideCommand
  | DuplicateSlideCommand
  | ReorderSlideCommand
  | UpdateSlideCommand
  | MoveSlideCommand
  | InsertTemplateSlideCommand
  | UpdateSlideTitleCommand
  | UpdateSlideNotesCommand;

function uniqueSlideId(deck: Deck): string {
  const existingIds = new Set(deck.slides.map((slide) => slide.id));
  let id = makeSlideId();
  while (existingIds.has(id)) {
    id = makeSlideId();
  }
  return id;
}

function ensureUniqueInsertedSlideId(deck: Deck, slide: Slide): Slide {
  return deck.slides.some((entry) => entry.id === slide.id)
    ? ({ ...slide, id: uniqueSlideId(deck) } as Slide)
    : slide;
}

export function executeSlideFamilyCommand(deck: Deck, cmd: SlideFamilyCommand) {
  switch (cmd.type) {
    case "ADD_SLIDE": {
      const afterIndex =
        cmd.afterSlideId == null
          ? deck.slides.length - 1
          : findSlideIndex(deck, cmd.afterSlideId);
      if (cmd.afterSlideId != null && afterIndex === -1) {
        return failure(deck, `Slide not found: ${cmd.afterSlideId}`);
      }
      const next = addSlide(deck, afterIndex);
      const originalIds = new Set(deck.slides.map((s) => s.id));
      const newSlide = next.slides.find((s) => !originalIds.has(s.id));
      const newId = newSlide?.id;
      return success(next, newId ? [newId] : [], [], undefined, [
        makePatch("slide.add", newId ? [newId] : [], [], {
          addedIds: newId ? [newId] : [],
        }),
      ]);
    }
    case "REMOVE_SLIDE": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      if (deck.slides.length <= 1)
        return failure(deck, "Cannot remove the last slide");
      return success(removeSlide(deck, index), [cmd.slideId], [], undefined, [
        makePatch("slide.remove", [cmd.slideId], [], {
          removedIds: [cmd.slideId],
        }),
      ]);
    }
    case "DUPLICATE_SLIDE": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      const next = duplicateSlide(deck, index);
      const originalIds = new Set(deck.slides.map((s) => s.id));
      const newSlide = next.slides.find((s) => !originalIds.has(s.id));
      const affected = [cmd.slideId, ...(newSlide ? [newSlide.id] : [])];
      return success(next, affected, [], undefined, [
        makePatch("slide.duplicate", affected, [], {
          addedIds: newSlide ? [newSlide.id] : [],
        }),
      ]);
    }
    case "REORDER_SLIDE": {
      const fromIndex = findSlideIndex(deck, cmd.slideId);
      if (fromIndex === -1)
        return failure(deck, `Slide not found: ${cmd.slideId}`);
      if (cmd.toIndex < 0 || cmd.toIndex >= deck.slides.length) {
        return failure(deck, `Invalid target index: ${cmd.toIndex}`);
      }
      const next = reorderSlides(deck, fromIndex, cmd.toIndex);
      const lo = Math.min(fromIndex, cmd.toIndex);
      const hi = Math.max(fromIndex, cmd.toIndex);
      const affectedSlideIds = deck.slides.slice(lo, hi + 1).map((s) => s.id);
      return success(next, affectedSlideIds, [], undefined, [
        makePatch("slide.reorder", affectedSlideIds, []),
      ]);
    }
    case "UPDATE_SLIDE": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      const { id: _discardedId, ...safePatch } = cmd.patch as Partial<Slide>;
      return success(
        updateSlide(deck, index, safePatch),
        [cmd.slideId],
        [],
        cmd.coalesceKey,
        [
          makePatch("slide.update", [cmd.slideId], [], {
            slideFields: {
              [cmd.slideId]: safePatch as NonNullable<
                import("./slide-commands").DeckPatch["slideFields"]
              >[string],
            },
          }),
        ],
      );
    }
    case "MOVE_SLIDE": {
      if (
        cmd.slideIndex < 0 ||
        cmd.slideIndex >= deck.slides.length ||
        cmd.direction === 0
      ) {
        return failure(
          deck,
          `Invalid move: index ${cmd.slideIndex}, direction ${cmd.direction}`,
        );
      }
      const target = cmd.slideIndex + (cmd.direction > 0 ? 1 : -1);
      if (target < 0 || target >= deck.slides.length) {
        return failure(deck, `Move would exceed deck bounds`);
      }
      const next = moveSlide(deck, cmd.slideIndex, cmd.direction);
      if (next === deck) return failure(deck, "Move had no effect");
      const lo = Math.min(cmd.slideIndex, target);
      const hi = Math.max(cmd.slideIndex, target);
      const affectedSlideIds = deck.slides.slice(lo, hi + 1).map((s) => s.id);
      return success(next, affectedSlideIds, [], undefined, [
        makePatch("slide.move", affectedSlideIds, []),
      ]);
    }
    case "INSERT_TEMPLATE_SLIDE": {
      const afterIndex = cmd.afterIndex ?? deck.slides.length - 1;
      if (afterIndex < -1 || afterIndex >= deck.slides.length) {
        return failure(deck, `Invalid afterIndex: ${afterIndex}`);
      }
      const slide = ensureUniqueInsertedSlideId(deck, cmd.slide);
      const next = insertSlide(deck, afterIndex, slide);
      return success(next, [slide.id], [], undefined, [
        makePatch("slide.insert_template", [slide.id], [], {
          addedIds: [slide.id],
        }),
      ]);
    }
    case "UPDATE_SLIDE_TITLE": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      return success(
        updateSlide(deck, index, { title: cmd.title }),
        [cmd.slideId],
        [],
        cmd.coalesceKey,
        [
          makePatch("slide.update_title", [cmd.slideId], [], {
            slideFields: { [cmd.slideId]: { title: cmd.title } },
          }),
        ],
      );
    }
    case "UPDATE_SLIDE_NOTES": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      return success(
        updateSlide(deck, index, { notes: cmd.notes }),
        [cmd.slideId],
        [],
        cmd.coalesceKey,
        [
          makePatch("slide.update_notes", [cmd.slideId], [], {
            slideFields: { [cmd.slideId]: { notes: cmd.notes } },
          }),
        ],
      );
    }
  }
}
