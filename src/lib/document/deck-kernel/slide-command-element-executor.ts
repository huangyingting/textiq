import type { Deck } from "./deck-core";
import {
  alignElements,
  arrangeSelectedElements,
  distributeElements,
  matchSizeElements,
} from "./deck-mutation-arrangement";
import {
  addElement,
  bringElementToFront,
  duplicateElement,
  duplicateElements,
  groupElements,
  nudgeElements,
  removeElement,
  removeElements,
  sendElementToBack,
  setElementBoxes,
  setElementPatches,
  ungroupElements,
  updateElement,
} from "./deck-mutation-elements";
import {
  moveElementZOrder,
  renameElement,
  reorderElement,
  setElementHidden,
  setElementLocked,
} from "./deck-mutation-layers";
import type {
  AddElementCommand,
  AlignElementsCommand,
  ArrangeElementsCommand,
  BringElementToFrontCommand,
  DistributeElementsCommand,
  DuplicateElementCommand,
  DuplicateElementsCommand,
  MatchSizeElementsCommand,
  MoveElementZOrderCommand,
  NudgeElementsCommand,
  RemoveElementCommand,
  RemoveElementsCommand,
  RenameElementCommand,
  ReorderElementCommand,
  SendElementToBackCommand,
  SetElementBoxesCommand,
  SetElementHiddenCommand,
  SetElementLockedCommand,
  SetElementPatchesCommand,
  UngroupElementsCommand,
  GroupElementsCommand,
  UpdateElementContentCommand,
  UpdateElementCommand,
  UpdateElementDesignOverridesCommand,
} from "./slide-command-contracts";
import {
  failure,
  findSlideIndex,
  makePatch,
  success,
} from "./slide-command-executor-helpers";

export type ElementFamilyCommand =
  | AddElementCommand
  | UpdateElementCommand
  | UpdateElementContentCommand
  | UpdateElementDesignOverridesCommand
  | RemoveElementCommand
  | RemoveElementsCommand
  | DuplicateElementCommand
  | DuplicateElementsCommand
  | NudgeElementsCommand
  | GroupElementsCommand
  | UngroupElementsCommand
  | AlignElementsCommand
  | DistributeElementsCommand
  | MatchSizeElementsCommand
  | ArrangeElementsCommand
  | BringElementToFrontCommand
  | SendElementToBackCommand
  | SetElementBoxesCommand
  | SetElementPatchesCommand
  | SetElementHiddenCommand
  | SetElementLockedCommand
  | MoveElementZOrderCommand
  | RenameElementCommand
  | ReorderElementCommand;

export function executeElementFamilyCommand(
  deck: Deck,
  cmd: ElementFamilyCommand,
) {
  switch (cmd.type) {
    case "ADD_ELEMENT": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      const next = addElement(deck, index, cmd.element);
      const elements = next.slides[index]?.elements;
      const newId = elements?.[elements.length - 1]?.id;
      return success(next, [cmd.slideId], newId ? [newId] : [], undefined, [
        makePatch("element.add", [cmd.slideId], newId ? [newId] : [], {
          addedIds: newId ? [newId] : [],
        }),
      ]);
    }
    case "UPDATE_ELEMENT": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      const slide = deck.slides[index]!;
      if (!slide.elements?.some((e) => e.id === cmd.elementId))
        return failure(deck, `Element not found: ${cmd.elementId}`);
      return success(
        updateElement(deck, index, cmd.elementId, cmd.patch),
        [cmd.slideId],
        [cmd.elementId],
        cmd.coalesceKey,
        [
          makePatch("element.update", [cmd.slideId], [cmd.elementId], {
            elementFields: { [cmd.elementId]: cmd.patch },
          }),
        ],
      );
    }
    case "UPDATE_ELEMENT_CONTENT": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      const slide = deck.slides[index]!;
      if (!slide.elements?.some((e) => e.id === cmd.elementId))
        return failure(deck, `Element not found: ${cmd.elementId}`);
      const patch = {
        ...(cmd.content !== undefined ? { content: cmd.content } : {}),
        ...(cmd.role !== undefined ? { role: cmd.role } : {}),
      } as never;
      return success(
        updateElement(deck, index, cmd.elementId, patch),
        [cmd.slideId],
        [cmd.elementId],
        cmd.coalesceKey,
        [
          makePatch("element.update_content", [cmd.slideId], [cmd.elementId], {
            elementFields: { [cmd.elementId]: patch },
          }),
        ],
      );
    }
    case "UPDATE_ELEMENT_DESIGN_OVERRIDES": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      const slide = deck.slides[index]!;
      if (!slide.elements?.some((e) => e.id === cmd.elementId))
        return failure(deck, `Element not found: ${cmd.elementId}`);
      const patch = {
        designOverrides: cmd.designOverrides,
      } as never;
      return success(
        updateElement(deck, index, cmd.elementId, patch),
        [cmd.slideId],
        [cmd.elementId],
        cmd.coalesceKey,
        [
          makePatch(
            "element.update_design_overrides",
            [cmd.slideId],
            [cmd.elementId],
            {
              elementFields: { [cmd.elementId]: patch },
            },
          ),
        ],
      );
    }
    case "REMOVE_ELEMENT": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      const slide = deck.slides[index]!;
      if (!slide.elements?.some((e) => e.id === cmd.elementId))
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
    case "REMOVE_ELEMENTS": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      if (cmd.elementIds.length === 0)
        return failure(deck, "elementIds must not be empty");
      const existingIds = new Set(
        (deck.slides[index]!.elements ?? []).map((e) => e.id),
      );
      const validIds = cmd.elementIds.filter((id) => existingIds.has(id));
      if (validIds.length === 0)
        return failure(deck, "None of the element ids were found");
      return success(
        removeElements(deck, index, validIds),
        [cmd.slideId],
        validIds,
        undefined,
        [
          /* node:coverage ignore next 5 */
          /* Multi-remove patch metadata is asserted in command tests; tsx maps this literal as residual rows. */
          makePatch("element.remove_multi", [cmd.slideId], validIds, {
            removedIds: validIds,
          }),
        ],
      );
    }
    case "DUPLICATE_ELEMENT": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      if (!deck.slides[index]!.elements?.some((e) => e.id === cmd.elementId))
        return failure(deck, `Element not found: ${cmd.elementId}`);
      const { deck: next, newElementId } = duplicateElement(
        deck,
        index,
        cmd.elementId,
      );
      if (!newElementId) return failure(deck, "Duplicate element failed");
      return success(
        next,
        [cmd.slideId],
        [cmd.elementId, newElementId],
        undefined,
        [
          makePatch(
            "element.duplicate",
            [cmd.slideId],
            [cmd.elementId, newElementId],
            /* node:coverage ignore next 3 */
            /* Duplicate patch metadata is asserted in command tests; tsx maps this literal row as residual. */
            { addedIds: [newElementId] },
          ),
        ],
      );
    }
    case "DUPLICATE_ELEMENTS": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      if (cmd.elementIds.length === 0)
        return failure(deck, "elementIds must not be empty");
      const { deck: next, newElementIds } = duplicateElements(
        deck,
        index,
        cmd.elementIds,
      );
      if (newElementIds.length === 0)
        return failure(deck, "Duplicate elements failed");
      const affected = [...cmd.elementIds, ...newElementIds];
      return success(next, [cmd.slideId], affected, undefined, [
        makePatch("element.duplicate_multi", [cmd.slideId], affected, {
          addedIds: newElementIds,
        }),
      ]);
    }
    case "NUDGE_ELEMENTS": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      if (cmd.elementIds.length === 0)
        return failure(deck, "elementIds must not be empty");
      return success(
        nudgeElements(deck, index, cmd.elementIds, cmd.dx, cmd.dy),
        [cmd.slideId],
        cmd.elementIds,
        cmd.coalesceKey,
        [makePatch("element.nudge", [cmd.slideId], cmd.elementIds)],
      );
    }
    case "GROUP_ELEMENTS": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      if (cmd.elementIds.length < 2)
        return failure(deck, "GROUP_ELEMENTS requires at least 2 element ids");
      const { deck: next } = groupElements(deck, index, cmd.elementIds);
      return success(next, [cmd.slideId], cmd.elementIds, undefined, [
        makePatch("element.group", [cmd.slideId], cmd.elementIds),
      ]);
    }
    case "UNGROUP_ELEMENTS": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      const memberIds = (deck.slides[index]!.elements ?? [])
        .filter((e) => (e as { groupId?: string }).groupId === cmd.groupId)
        .map((e) => e.id);
      if (memberIds.length === 0)
        return failure(deck, `Group not found: ${cmd.groupId}`);
      return success(
        ungroupElements(deck, index, cmd.groupId),
        [cmd.slideId],
        memberIds,
        undefined,
        [makePatch("element.ungroup", [cmd.slideId], memberIds)],
      );
    }
    case "ALIGN_ELEMENTS": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      if (cmd.elementIds.length < 2)
        return failure(deck, "ALIGN_ELEMENTS requires at least 2 element ids");
      return success(
        alignElements(deck, index, cmd.elementIds, cmd.mode),
        [cmd.slideId],
        cmd.elementIds,
        undefined,
        [makePatch("element.align", [cmd.slideId], cmd.elementIds)],
      );
    }
    case "DISTRIBUTE_ELEMENTS": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      if (cmd.elementIds.length < 3)
        return failure(
          deck,
          "DISTRIBUTE_ELEMENTS requires at least 3 element ids",
        );
      return success(
        distributeElements(deck, index, cmd.elementIds, cmd.mode),
        [cmd.slideId],
        cmd.elementIds,
        undefined,
        [makePatch("element.distribute", [cmd.slideId], cmd.elementIds)],
      );
    }
    case "MATCH_SIZE_ELEMENTS": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      if (cmd.elementIds.length < 2)
        return failure(
          deck,
          "MATCH_SIZE_ELEMENTS requires at least 2 element ids",
        );
      return success(
        matchSizeElements(deck, index, cmd.elementIds, cmd.mode),
        [cmd.slideId],
        cmd.elementIds,
        undefined,
        [makePatch("element.match_size", [cmd.slideId], cmd.elementIds)],
      );
    }
    case "ARRANGE_ELEMENTS": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      if (cmd.elementIds.length === 0)
        return failure(deck, "elementIds must not be empty");
      return success(
        arrangeSelectedElements(deck, index, cmd.elementIds, cmd.mode),
        [cmd.slideId],
        cmd.elementIds,
        undefined,
        [makePatch("element.arrange", [cmd.slideId], cmd.elementIds)],
      );
    }
    case "BRING_ELEMENT_TO_FRONT":
    case "SEND_ELEMENT_TO_BACK":
    case "SET_ELEMENT_HIDDEN":
    case "SET_ELEMENT_LOCKED":
    case "MOVE_ELEMENT_ZORDER":
    case "RENAME_ELEMENT":
    case "REORDER_ELEMENT": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      if (!deck.slides[index]!.elements?.some((e) => e.id === cmd.elementId))
        return failure(deck, `Element not found: ${cmd.elementId}`);
      if (cmd.type === "BRING_ELEMENT_TO_FRONT") {
        return success(
          bringElementToFront(deck, index, cmd.elementId),
          [cmd.slideId],
          [cmd.elementId],
          undefined,
          [makePatch("element.bring_to_front", [cmd.slideId], [cmd.elementId])],
        );
      }
      if (cmd.type === "SEND_ELEMENT_TO_BACK") {
        return success(
          sendElementToBack(deck, index, cmd.elementId),
          [cmd.slideId],
          [cmd.elementId],
          undefined,
          [makePatch("element.send_to_back", [cmd.slideId], [cmd.elementId])],
        );
      }
      if (cmd.type === "SET_ELEMENT_HIDDEN") {
        return success(
          setElementHidden(deck, index, cmd.elementId, cmd.hidden),
          [cmd.slideId],
          [cmd.elementId],
          undefined,
          [makePatch("element.set_hidden", [cmd.slideId], [cmd.elementId])],
        );
      }
      if (cmd.type === "SET_ELEMENT_LOCKED") {
        return success(
          setElementLocked(deck, index, cmd.elementId, cmd.locked),
          [cmd.slideId],
          [cmd.elementId],
          undefined,
          [makePatch("element.set_locked", [cmd.slideId], [cmd.elementId])],
        );
      }
      if (cmd.type === "MOVE_ELEMENT_ZORDER") {
        return success(
          moveElementZOrder(deck, index, cmd.elementId, cmd.direction),
          [cmd.slideId],
          [cmd.elementId],
          undefined,
          [makePatch("element.move_zorder", [cmd.slideId], [cmd.elementId])],
        );
      }
      if (cmd.type === "RENAME_ELEMENT") {
        return success(
          renameElement(deck, index, cmd.elementId, cmd.name),
          [cmd.slideId],
          [cmd.elementId],
          undefined,
          [makePatch("element.rename", [cmd.slideId], [cmd.elementId])],
        );
      }
      return success(
        reorderElement(deck, index, cmd.elementId, cmd.targetElementId),
        [cmd.slideId],
        [cmd.elementId],
        undefined,
        [makePatch("element.reorder", [cmd.slideId], [cmd.elementId])],
      );
    }
    case "SET_ELEMENT_BOXES": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      const elementIds = Object.keys(cmd.boxesById);
      if (elementIds.length === 0)
        return failure(deck, "boxesById must not be empty");
      return success(
        setElementBoxes(deck, index, cmd.boxesById),
        [cmd.slideId],
        elementIds,
        cmd.coalesceKey,
        [makePatch("element.set_boxes", [cmd.slideId], elementIds)],
      );
    }
    case "SET_ELEMENT_PATCHES": {
      const index = findSlideIndex(deck, cmd.slideId);
      if (index === -1) return failure(deck, `Slide not found: ${cmd.slideId}`);
      const elementIds = Object.keys(cmd.patchesById);
      if (elementIds.length === 0)
        return failure(deck, "patchesById must not be empty");
      return success(
        setElementPatches(deck, index, cmd.patchesById),
        [cmd.slideId],
        elementIds,
        cmd.coalesceKey,
        [
          makePatch("element.set_patches", [cmd.slideId], elementIds, {
            elementFields: cmd.patchesById,
          }),
        ],
      );
    }
  }
}
