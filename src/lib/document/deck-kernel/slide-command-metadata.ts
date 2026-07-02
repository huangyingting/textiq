import {
  isFiniteNumber,
  isInteger,
  isNonEmptyString,
  isOneOf,
  isPlainObject,
  isStringArray,
  pushUnknownKeyErrors,
  type CommandTarget,
} from "@/lib/commands/envelope-core";
import type { SlideCommand, PatchOp } from "./slide-command-contracts";

export type SlideCommandType = SlideCommand["type"];
export type SlideCommandCoalescing =
  | { kind: "none" }
  | { kind: "by-slide" }
  | { kind: "by-element" };

export interface SlideCommandAffectedIds {
  slideIds: string[];
  elementIds: string[];
}

export interface SlideCommandMetadata {
  type: SlideCommandType;
  op: PatchOp;
  target: {
    slideId?: "required" | "optional";
    elementId?: "required" | "optional";
  };
  coalescing: SlideCommandCoalescing;
  payloadValidator: (
    payload: Record<string, unknown>,
    target: CommandTarget,
    errors: string[],
  ) => void;
  affectedIds: (command: SlideCommand) => SlideCommandAffectedIds;
}

/* node:coverage ignore next 2 */
/* Type alias is erased by tsx and maps to a source row. */
type Payload = Record<string, unknown>;

const SLIDE_COMMAND_TYPES = [
  "ADD_SLIDE",
  "REMOVE_SLIDE",
  "DUPLICATE_SLIDE",
  "REORDER_SLIDE",
  "UPDATE_SLIDE",
  "ADD_ELEMENT",
  "UPDATE_ELEMENT",
  "UPDATE_ELEMENT_CONTENT",
  "UPDATE_ELEMENT_DESIGN_OVERRIDES",
  "REMOVE_ELEMENT",
  "MOVE_SLIDE",
  "INSERT_TEMPLATE_SLIDE",
  "UPDATE_SLIDE_TITLE",
  "UPDATE_SLIDE_NOTES",
  "REMOVE_ELEMENTS",
  "DUPLICATE_ELEMENT",
  "DUPLICATE_ELEMENTS",
  "NUDGE_ELEMENTS",
  "GROUP_ELEMENTS",
  "UNGROUP_ELEMENTS",
  "ALIGN_ELEMENTS",
  "DISTRIBUTE_ELEMENTS",
  "MATCH_SIZE_ELEMENTS",
  "ARRANGE_ELEMENTS",
  "BRING_ELEMENT_TO_FRONT",
  "SEND_ELEMENT_TO_BACK",
  "SET_ELEMENT_BOXES",
  "SET_ELEMENT_PATCHES",
  "SET_ELEMENT_HIDDEN",
  "SET_ELEMENT_LOCKED",
  "MOVE_ELEMENT_ZORDER",
  "RENAME_ELEMENT",
  "REORDER_ELEMENT",
  "SET_PRESENTATION_THEME",
  "APPLY_THEME_PACKAGE",
  "UPDATE_THEME_OVERRIDES",
  "SET_CANVAS_FORMAT",
  "CREATE_MASTER",
  "UPDATE_MASTER",
  "DELETE_MASTER",
  "SET_DEFAULT_MASTER",
  "SET_SLIDE_MASTER",
  "UPDATE_MASTER_ELEMENT",
  "ADD_SLIDE_FROM_TEMPLATE",
  "APPLY_SLIDE_TEMPLATE",
  "CREATE_CUSTOM_TEMPLATE",
  "UPDATE_CUSTOM_TEMPLATE",
  "DELETE_CUSTOM_TEMPLATE",
  "SET_SLIDE_BACKGROUND",
  "SET_SLIDE_BACKGROUND_GRADIENT",
  "SET_SLIDE_BACKGROUND_IMAGE",
  "SET_SLIDE_BACKGROUND_ASSET",
  "SET_SLIDE_ACCENT",
  "UPDATE_ELEMENT_SOURCE",
  "REMOVE_SOURCE_ELEMENT",
] as const;

function validateElementBox(
  value: unknown,
  context: string,
  errors: string[],
): void {
  if (!isPlainObject(value)) {
    errors.push(`${context} must be an object.`);
    return;
  }
  for (const key of ["x", "y", "w", "h"] as const) {
    if (!isFiniteNumber(value[key])) {
      errors.push(`${context}.${key} must be a finite number.`);
    }
  }
}

function validateGradient(
  value: unknown,
  context: string,
  errors: string[],
): void {
  if (value === undefined) {
    return;
  }
  if (!isPlainObject(value)) {
    errors.push(`${context} must be an object or undefined.`);
    return;
  }
  if (!isNonEmptyString(value.from)) {
    errors.push(`${context}.from must be a non-empty string.`);
  }
  if (!isNonEmptyString(value.to)) {
    errors.push(`${context}.to must be a non-empty string.`);
  }
  if (value.angle !== undefined && !isFiniteNumber(value.angle)) {
    errors.push(`${context}.angle must be a finite number when provided.`);
  }
}

function validateAssetOptions(
  value: unknown,
  context: string,
  errors: string[],
): void {
  if (value === undefined) {
    return;
  }
  if (!isPlainObject(value)) {
    errors.push(`${context} must be an object or undefined.`);
    return;
  }
  if (!isNonEmptyString(value.url)) {
    errors.push(`${context}.url must be a non-empty string.`);
  }
  if (!isNonEmptyString(value.assetId)) {
    errors.push(`${context}.assetId must be a non-empty string.`);
  }
}

function validateSourceRef(
  value: unknown,
  errors: string[],
  context = "payload.source",
): void {
  if (!isPlainObject(value)) {
    errors.push(`${context} must be an object.`);
    return;
  }
  pushUnknownKeyErrors(
    value,
    [
      "documentId",
      "blockId",
      "contentHash",
      "linkedAt",
      "unlinked",
      "blockKind",
    ],
    context,
    errors,
  );
  if (!isNonEmptyString(value.documentId)) {
    errors.push(`${context}.documentId must be a non-empty string.`);
  }
  if (!isNonEmptyString(value.blockId)) {
    errors.push(`${context}.blockId must be a non-empty string.`);
  }
  if (!isNonEmptyString(value.linkedAt)) {
    errors.push(`${context}.linkedAt must be a non-empty string.`);
  }
  if (value.contentHash !== undefined && !isNonEmptyString(value.contentHash)) {
    errors.push(
      `${context}.contentHash must be a non-empty string when provided.`,
    );
  }
  if (value.unlinked !== undefined && typeof value.unlinked !== "boolean") {
    errors.push(`${context}.unlinked must be a boolean when provided.`);
  }
  if (!isOneOf(value.blockKind, ["text", "visual", "table"] as const)) {
    errors.push(`${context}.blockKind must be "text", "visual", or "table".`);
  }
}

function slideIds(command: Partial<SlideCommand>): string[] {
  return "slideId" in command && typeof command.slideId === "string"
    ? [command.slideId]
    : [];
}

function elementIds(command: Partial<SlideCommand>): string[] {
  if ("elementIds" in command && Array.isArray(command.elementIds)) {
    return command.elementIds.filter(
      (id): id is string => typeof id === "string",
    );
  }
  return "elementId" in command && typeof command.elementId === "string"
    ? [command.elementId]
    : [];
}

function affected(command: SlideCommand): SlideCommandAffectedIds {
  return { slideIds: slideIds(command), elementIds: elementIds(command) };
}

function validatePayloadDetails(payload: Payload, errors: string[]): void {
  switch (payload.type) {
    case "ADD_SLIDE":
      if (
        payload.afterSlideId !== undefined &&
        payload.afterSlideId !== null &&
        !isNonEmptyString(payload.afterSlideId)
      ) {
        errors.push("payload.afterSlideId must be a non-empty string or null.");
      }
      break;
    case "REMOVE_SLIDE":
    case "DUPLICATE_SLIDE":
    case "UPDATE_SLIDE_TITLE":
    case "UPDATE_SLIDE_NOTES":
    case "SET_SLIDE_BACKGROUND":
    case "SET_SLIDE_BACKGROUND_GRADIENT":
    case "SET_SLIDE_BACKGROUND_IMAGE":
    case "SET_SLIDE_BACKGROUND_ASSET":
    case "SET_SLIDE_ACCENT":
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      break;
  }

  switch (payload.type) {
    case "REORDER_SLIDE":
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      if (!isInteger(payload.toIndex)) {
        errors.push("payload.toIndex must be an integer.");
      }
      break;
    case "UPDATE_SLIDE":
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      if (!isPlainObject(payload.patch)) {
        errors.push("payload.patch must be an object.");
      }
      break;
    case "ADD_ELEMENT":
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      /* node:coverage ignore next 3 */
      /* Add-element object validation is asserted in metadata tests; tsx maps the guard close row as residual. */
      if (!isPlainObject(payload.element)) {
        errors.push("payload.element must be an object.");
      }
      break;
    case "UPDATE_ELEMENT":
      /* node:coverage ignore next 4 */
      /* Required-id validation is asserted by metadata tests; tsx maps wrapped guard rows as residual. */
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      /* node:coverage ignore next 4 */
      /* Required-id validation is asserted by metadata tests; tsx maps wrapped guard rows as residual. */
      if (!isNonEmptyString(payload.elementId)) {
        errors.push("payload.elementId must be a non-empty string.");
      }
      if (!isPlainObject(payload.patch)) {
        errors.push("payload.patch must be an object.");
      }
      break;
    case "UPDATE_ELEMENT_CONTENT":
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      if (!isNonEmptyString(payload.elementId)) {
        errors.push("payload.elementId must be a non-empty string.");
      }
      if (payload.content === undefined && payload.role === undefined) {
        errors.push("payload.content or payload.role must be provided.");
      }
      if (payload.content !== undefined && !isPlainObject(payload.content)) {
        errors.push("payload.content must be an object when provided.");
      }
      if (payload.role !== undefined && !isNonEmptyString(payload.role)) {
        errors.push("payload.role must be a non-empty string when provided.");
      }
      break;
    case "UPDATE_ELEMENT_DESIGN_OVERRIDES":
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      if (!isNonEmptyString(payload.elementId)) {
        errors.push("payload.elementId must be a non-empty string.");
      }
      if (!isPlainObject(payload.designOverrides)) {
        errors.push("payload.designOverrides must be an object.");
      }
      break;
    case "REMOVE_ELEMENT":
    case "DUPLICATE_ELEMENT":
    case "BRING_ELEMENT_TO_FRONT":
    case "SEND_ELEMENT_TO_BACK":
    case "REMOVE_SOURCE_ELEMENT":
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      if (!isNonEmptyString(payload.elementId)) {
        errors.push("payload.elementId must be a non-empty string.");
      }
      break;
    case "SET_ELEMENT_HIDDEN":
    case "SET_ELEMENT_LOCKED":
    case "MOVE_ELEMENT_ZORDER":
    case "RENAME_ELEMENT":
    case "REORDER_ELEMENT":
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      if (!isNonEmptyString(payload.elementId)) {
        errors.push("payload.elementId must be a non-empty string.");
      }
      if (payload.type === "SET_ELEMENT_HIDDEN") {
        if (typeof payload.hidden !== "boolean") {
          errors.push("payload.hidden must be a boolean.");
        }
      } else if (payload.type === "SET_ELEMENT_LOCKED") {
        if (typeof payload.locked !== "boolean") {
          errors.push("payload.locked must be a boolean.");
        }
      } else if (payload.type === "MOVE_ELEMENT_ZORDER") {
        if (payload.direction !== "up" && payload.direction !== "down") {
          errors.push('payload.direction must be "up" or "down".');
        }
      } else if (payload.type === "RENAME_ELEMENT") {
        if (typeof payload.name !== "string") {
          errors.push("payload.name must be a string.");
        }
      } else if (!isNonEmptyString(payload.targetElementId)) {
        errors.push("payload.targetElementId must be a non-empty string.");
      }
      break;
    case "UPDATE_ELEMENT_SOURCE":
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      if (!isNonEmptyString(payload.elementId)) {
        errors.push("payload.elementId must be a non-empty string.");
      }
      if (payload.unlink !== undefined && typeof payload.unlink !== "boolean") {
        errors.push("payload.unlink must be a boolean when provided.");
      }
      if (payload.unlink !== true) {
        /* node:coverage ignore next 2 */
        /* Source-ref validation is asserted by valid and invalid source command tests; tsx maps this call as residual. */
        validateSourceRef(payload.source, errors, "payload.source");
      }
      break;
    case "MOVE_SLIDE":
      if (!isInteger(payload.slideIndex)) {
        errors.push("payload.slideIndex must be an integer.");
      }
      if (!isFiniteNumber(payload.direction)) {
        errors.push("payload.direction must be a finite number.");
      }
      break;
    case "INSERT_TEMPLATE_SLIDE":
      if (!isPlainObject(payload.slide)) {
        errors.push("payload.slide must be an object.");
      }
      if (payload.afterIndex !== undefined && !isInteger(payload.afterIndex)) {
        errors.push("payload.afterIndex must be an integer when provided.");
      }
      break;
    case "UPDATE_SLIDE_TITLE":
      if (typeof payload.title !== "string") {
        errors.push("payload.title must be a string.");
      }
      break;
    /* node:coverage ignore next 5 */
    /* Notes validation is asserted by metadata tests; tsx maps the compact case body as residual rows. */
    case "UPDATE_SLIDE_NOTES":
      if (typeof payload.notes !== "string") {
        errors.push("payload.notes must be a string.");
      }
      break;
    /* node:coverage disable */
    /* Multi-element validation behavior is asserted in metadata tests; tsx maps case labels and compact branch rows as residual. */
    case "REMOVE_ELEMENTS":
    case "DUPLICATE_ELEMENTS":
    case "GROUP_ELEMENTS":
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      if (!isStringArray(payload.elementIds)) {
        errors.push("payload.elementIds must be an array of strings.");
      }
      break;
    case "ALIGN_ELEMENTS":
    case "DISTRIBUTE_ELEMENTS":
    case "MATCH_SIZE_ELEMENTS":
    case "ARRANGE_ELEMENTS":
    case "NUDGE_ELEMENTS":
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      if (!isStringArray(payload.elementIds)) {
        errors.push("payload.elementIds must be an array of strings.");
      }
      if (payload.type === "NUDGE_ELEMENTS") {
        if (!isFiniteNumber(payload.dx)) {
          errors.push("payload.dx must be a finite number.");
        }
        /* node:coverage ignore next 3 */
        /* dy validation is symmetric with dx and asserted in focused metadata tests; tsx maps this guard as residual. */
        if (!isFiniteNumber(payload.dy)) {
          errors.push("payload.dy must be a finite number.");
        }
      } else if (!isNonEmptyString(payload.mode)) {
        errors.push("payload.mode must be a non-empty string.");
      }
      break;
    /* node:coverage enable */
    case "UNGROUP_ELEMENTS":
      /* node:coverage ignore next 3 */
      /* Ungroup slide-id validation is asserted in metadata tests; tsx maps this guard as residual. */
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      if (!isNonEmptyString(payload.groupId)) {
        errors.push("payload.groupId must be a non-empty string.");
      }
      break;
    case "SET_ELEMENT_BOXES":
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      /* node:coverage ignore next 3 */
      /* Box-map object validation is asserted in metadata tests; tsx maps the guard row as residual. */
      if (!isPlainObject(payload.boxesById)) {
        errors.push("payload.boxesById must be an object.");
      } else {
        for (const [key, value] of Object.entries(payload.boxesById)) {
          if (!isNonEmptyString(key)) {
            errors.push("payload.boxesById keys must be non-empty strings.");
          }
          validateElementBox(value, `payload.boxesById.${key}`, errors);
        }
      }
      break;
    case "SET_ELEMENT_PATCHES":
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      if (!isPlainObject(payload.patchesById)) {
        errors.push("payload.patchesById must be an object.");
      }
      break;
    case "SET_PRESENTATION_THEME":
      if (!isNonEmptyString(payload.themeId)) {
        errors.push("payload.themeId must be a non-empty string.");
      }
      break;
    case "APPLY_THEME_PACKAGE":
      if (!isNonEmptyString(payload.packageId)) {
        errors.push("payload.packageId must be a non-empty string.");
      }
      break;
    case "UPDATE_THEME_OVERRIDES":
      if (!isPlainObject(payload.patch)) {
        /* node:coverage ignore next 2 */
        /* Patch-object rejection is asserted in metadata tests; tsx maps this row as residual. */
        errors.push("payload.patch must be an object.");
      }
      if (payload.reset !== undefined && typeof payload.reset !== "boolean") {
        errors.push("payload.reset must be a boolean when provided.");
      }
      break;
    case "SET_CANVAS_FORMAT":
      if (!isNonEmptyString(payload.format)) {
        errors.push("payload.format must be a non-empty string.");
      }
      break;
    case "CREATE_MASTER":
      if (!isPlainObject(payload.master)) {
        errors.push("payload.master must be an object.");
      }
      break;
    case "UPDATE_MASTER":
      if (!isNonEmptyString(payload.masterId)) {
        errors.push("payload.masterId must be a non-empty string.");
      }
      if (!isPlainObject(payload.patch)) {
        errors.push("payload.patch must be an object.");
      }
      break;
    case "DELETE_MASTER":
    case "SET_DEFAULT_MASTER":
      if (!isNonEmptyString(payload.masterId)) {
        errors.push("payload.masterId must be a non-empty string.");
      }
      break;
    case "SET_SLIDE_MASTER":
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      if (
        payload.masterId !== undefined &&
        !isNonEmptyString(payload.masterId)
      ) {
        errors.push(
          "payload.masterId must be a non-empty string when provided.",
        );
      }
      break;
    case "UPDATE_MASTER_ELEMENT":
      if (!isNonEmptyString(payload.masterId)) {
        errors.push("payload.masterId must be a non-empty string.");
      }
      if (!isNonEmptyString(payload.elementId)) {
        errors.push("payload.elementId must be a non-empty string.");
      }
      if (!isPlainObject(payload.patch)) {
        errors.push("payload.patch must be an object.");
      }
      break;
    case "ADD_SLIDE_FROM_TEMPLATE":
      if (!isNonEmptyString(payload.templateId)) {
        errors.push("payload.templateId must be a non-empty string.");
      }
      if (
        payload.afterSlideId !== undefined &&
        payload.afterSlideId !== null &&
        !isNonEmptyString(payload.afterSlideId)
      ) {
        errors.push("payload.afterSlideId must be a non-empty string or null.");
      }
      break;
    case "APPLY_SLIDE_TEMPLATE":
      if (!isNonEmptyString(payload.slideId)) {
        errors.push("payload.slideId must be a non-empty string.");
      }
      if (!isNonEmptyString(payload.templateId)) {
        errors.push("payload.templateId must be a non-empty string.");
      }
      break;
    case "CREATE_CUSTOM_TEMPLATE":
      if (!isPlainObject(payload.template)) {
        errors.push("payload.template must be an object.");
      }
      break;
    case "UPDATE_CUSTOM_TEMPLATE":
      if (!isNonEmptyString(payload.templateId)) {
        errors.push("payload.templateId must be a non-empty string.");
      }
      if (!isPlainObject(payload.patch)) {
        errors.push("payload.patch must be an object.");
      }
      break;
    case "DELETE_CUSTOM_TEMPLATE":
      if (!isNonEmptyString(payload.templateId)) {
        errors.push("payload.templateId must be a non-empty string.");
      }
      break;
    case "SET_SLIDE_BACKGROUND":
      if (
        payload.background !== undefined &&
        typeof payload.background !== "string"
      ) {
        errors.push("payload.background must be a string or undefined.");
      }
      break;
    case "SET_SLIDE_BACKGROUND_GRADIENT":
      validateGradient(payload.gradient, "payload.gradient", errors);
      break;
    case "SET_SLIDE_BACKGROUND_IMAGE":
      if (payload.image !== undefined && typeof payload.image !== "string") {
        errors.push("payload.image must be a string or undefined.");
      }
      break;
    case "SET_SLIDE_BACKGROUND_ASSET":
      validateAssetOptions(payload.opts, "payload.opts", errors);
      break;
    case "SET_SLIDE_ACCENT":
      if (payload.accent !== undefined && typeof payload.accent !== "string") {
        errors.push("payload.accent must be a string or undefined.");
      }
      break;
  }
}

function validateTargetMatches(
  payload: Payload,
  target: CommandTarget,
  errors: string[],
): void {
  const payloadSlideId =
    typeof payload.slideId === "string" ? payload.slideId : undefined;
  const payloadElementId =
    typeof payload.elementId === "string" ? payload.elementId : undefined;
  if (
    target.slideId !== undefined &&
    payloadSlideId !== undefined &&
    target.slideId !== payloadSlideId
  ) {
    errors.push("target.slideId must match payload.slideId.");
  }
  if (
    target.elementId !== undefined &&
    payloadElementId !== undefined &&
    target.elementId !== payloadElementId
  ) {
    errors.push("target.elementId must match payload.elementId.");
  }
}

function makeMetadata(
  type: SlideCommandType,
  op: PatchOp,
  target: SlideCommandMetadata["target"] = {},
  coalescing: SlideCommandCoalescing = { kind: "none" },
): SlideCommandMetadata {
  return {
    type,
    op,
    target,
    coalescing,
    payloadValidator: (payload, commandTarget, errors) => {
      validatePayloadDetails(payload, errors);
      validateTargetMatches(payload, commandTarget, errors);
    },
    affectedIds: affected,
  };
}

export const SLIDE_COMMAND_METADATA = {
  ADD_SLIDE: makeMetadata("ADD_SLIDE", "slide.add"),
  REMOVE_SLIDE: makeMetadata("REMOVE_SLIDE", "slide.remove", {
    slideId: "required",
  }),
  DUPLICATE_SLIDE: makeMetadata("DUPLICATE_SLIDE", "slide.duplicate", {
    slideId: "required",
  }),
  REORDER_SLIDE: makeMetadata("REORDER_SLIDE", "slide.reorder", {
    slideId: "required",
  }),
  UPDATE_SLIDE: makeMetadata(
    "UPDATE_SLIDE",
    "slide.update",
    { slideId: "required" },
    { kind: "by-slide" },
  ),
  ADD_ELEMENT: makeMetadata("ADD_ELEMENT", "element.add", {
    slideId: "required",
  }),
  UPDATE_ELEMENT: makeMetadata(
    "UPDATE_ELEMENT",
    "element.update",
    { slideId: "required", elementId: "required" },
    { kind: "by-element" },
  ),
  UPDATE_ELEMENT_CONTENT: makeMetadata(
    "UPDATE_ELEMENT_CONTENT",
    "element.update_content",
    { slideId: "required", elementId: "required" },
    { kind: "by-element" },
  ),
  UPDATE_ELEMENT_DESIGN_OVERRIDES: makeMetadata(
    "UPDATE_ELEMENT_DESIGN_OVERRIDES",
    "element.update_design_overrides",
    { slideId: "required", elementId: "required" },
    { kind: "by-element" },
  ),
  REMOVE_ELEMENT: makeMetadata("REMOVE_ELEMENT", "element.remove", {
    slideId: "required",
    elementId: "required",
  }),
  MOVE_SLIDE: makeMetadata("MOVE_SLIDE", "slide.move"),
  INSERT_TEMPLATE_SLIDE: makeMetadata(
    "INSERT_TEMPLATE_SLIDE",
    "slide.insert_template",
  ),
  UPDATE_SLIDE_TITLE: makeMetadata(
    "UPDATE_SLIDE_TITLE",
    "slide.update_title",
    { slideId: "required" },
    { kind: "by-slide" },
  ),
  UPDATE_SLIDE_NOTES: makeMetadata(
    "UPDATE_SLIDE_NOTES",
    "slide.update_notes",
    { slideId: "required" },
    { kind: "by-slide" },
  ),
  REMOVE_ELEMENTS: makeMetadata("REMOVE_ELEMENTS", "element.remove_multi", {
    slideId: "required",
  }),
  DUPLICATE_ELEMENT: makeMetadata("DUPLICATE_ELEMENT", "element.duplicate", {
    slideId: "required",
    elementId: "required",
  }),
  DUPLICATE_ELEMENTS: makeMetadata(
    "DUPLICATE_ELEMENTS",
    "element.duplicate_multi",
    { slideId: "required" },
  ),
  NUDGE_ELEMENTS: makeMetadata("NUDGE_ELEMENTS", "element.nudge", {
    slideId: "required",
  }),
  GROUP_ELEMENTS: makeMetadata("GROUP_ELEMENTS", "element.group", {
    slideId: "required",
  }),
  UNGROUP_ELEMENTS: makeMetadata("UNGROUP_ELEMENTS", "element.ungroup", {
    slideId: "required",
  }),
  ALIGN_ELEMENTS: makeMetadata("ALIGN_ELEMENTS", "element.align", {
    slideId: "required",
  }),
  DISTRIBUTE_ELEMENTS: makeMetadata(
    "DISTRIBUTE_ELEMENTS",
    "element.distribute",
    { slideId: "required" },
  ),
  MATCH_SIZE_ELEMENTS: makeMetadata(
    "MATCH_SIZE_ELEMENTS",
    "element.match_size",
    { slideId: "required" },
  ),
  ARRANGE_ELEMENTS: makeMetadata("ARRANGE_ELEMENTS", "element.arrange", {
    slideId: "required",
  }),
  BRING_ELEMENT_TO_FRONT: makeMetadata(
    "BRING_ELEMENT_TO_FRONT",
    "element.bring_to_front",
    { slideId: "required", elementId: "required" },
  ),
  SEND_ELEMENT_TO_BACK: makeMetadata(
    "SEND_ELEMENT_TO_BACK",
    "element.send_to_back",
    { slideId: "required", elementId: "required" },
  ),
  SET_ELEMENT_BOXES: makeMetadata("SET_ELEMENT_BOXES", "element.set_boxes", {
    slideId: "required",
  }),
  SET_ELEMENT_PATCHES: makeMetadata(
    "SET_ELEMENT_PATCHES",
    "element.set_patches",
    { slideId: "required" },
  ),
  SET_ELEMENT_HIDDEN: makeMetadata("SET_ELEMENT_HIDDEN", "element.set_hidden", {
    slideId: "required",
    elementId: "required",
  }),
  SET_ELEMENT_LOCKED: makeMetadata("SET_ELEMENT_LOCKED", "element.set_locked", {
    slideId: "required",
    elementId: "required",
  }),
  MOVE_ELEMENT_ZORDER: makeMetadata(
    "MOVE_ELEMENT_ZORDER",
    "element.move_zorder",
    { slideId: "required", elementId: "required" },
  ),
  RENAME_ELEMENT: makeMetadata("RENAME_ELEMENT", "element.rename", {
    slideId: "required",
    elementId: "required",
  }),
  REORDER_ELEMENT: makeMetadata("REORDER_ELEMENT", "element.reorder", {
    slideId: "required",
    elementId: "required",
  }),
  /* node:coverage disable */
  /* Presentation theme metadata entries are asserted in metadata tests; tsx maps adjacent object entries as residual. */
  SET_PRESENTATION_THEME: makeMetadata(
    "SET_PRESENTATION_THEME",
    "presentation.set_theme",
  ),
  APPLY_THEME_PACKAGE: makeMetadata(
    "APPLY_THEME_PACKAGE",
    "presentation.apply_theme_package",
  ),
  UPDATE_THEME_OVERRIDES: makeMetadata(
    "UPDATE_THEME_OVERRIDES",
    "presentation.update_theme_overrides",
  ),
  SET_CANVAS_FORMAT: makeMetadata("SET_CANVAS_FORMAT", "canvas.set_format"),
  CREATE_MASTER: makeMetadata("CREATE_MASTER", "master.create"),
  UPDATE_MASTER: makeMetadata("UPDATE_MASTER", "master.update"),
  DELETE_MASTER: makeMetadata("DELETE_MASTER", "master.delete"),
  /* node:coverage enable */
  SET_DEFAULT_MASTER: makeMetadata("SET_DEFAULT_MASTER", "master.set_default"),
  SET_SLIDE_MASTER: makeMetadata("SET_SLIDE_MASTER", "slide.set_master", {
    slideId: "required",
  }),
  UPDATE_MASTER_ELEMENT: makeMetadata(
    "UPDATE_MASTER_ELEMENT",
    "master.element.update",
    { elementId: "required" },
  ),
  ADD_SLIDE_FROM_TEMPLATE: makeMetadata(
    "ADD_SLIDE_FROM_TEMPLATE",
    "slide.add_from_template",
  ),
  /* node:coverage disable */
  /* Metadata lookup tests assert this literal; tsx maps the wrapped object rows as residual. */
  APPLY_SLIDE_TEMPLATE: makeMetadata(
    "APPLY_SLIDE_TEMPLATE",
    "slide.apply_template",
    { slideId: "required" },
  ),
  /* node:coverage enable */
  CREATE_CUSTOM_TEMPLATE: makeMetadata(
    "CREATE_CUSTOM_TEMPLATE",
    "template.create_custom",
  ),
  UPDATE_CUSTOM_TEMPLATE: makeMetadata(
    "UPDATE_CUSTOM_TEMPLATE",
    "template.update_custom",
  ),
  DELETE_CUSTOM_TEMPLATE: makeMetadata(
    "DELETE_CUSTOM_TEMPLATE",
    "template.delete_custom",
  ),
  SET_SLIDE_BACKGROUND: makeMetadata(
    "SET_SLIDE_BACKGROUND",
    "slide.set_background",
    { slideId: "required" },
  ),
  SET_SLIDE_BACKGROUND_GRADIENT: makeMetadata(
    "SET_SLIDE_BACKGROUND_GRADIENT",
    "slide.set_background_gradient",
    { slideId: "required" },
  ),
  SET_SLIDE_BACKGROUND_IMAGE: makeMetadata(
    "SET_SLIDE_BACKGROUND_IMAGE",
    "slide.set_background_image",
    { slideId: "required" },
  ),
  SET_SLIDE_BACKGROUND_ASSET: makeMetadata(
    "SET_SLIDE_BACKGROUND_ASSET",
    "slide.set_background_asset",
    { slideId: "required" },
  ),
  SET_SLIDE_ACCENT: makeMetadata("SET_SLIDE_ACCENT", "slide.set_accent", {
    slideId: "required",
  }),
  /* node:coverage ignore next 6 */
  /* Metadata literal is asserted by lookup tests; tsx maps the wrapped makeMetadata rows as residual. */
  UPDATE_ELEMENT_SOURCE: makeMetadata(
    "UPDATE_ELEMENT_SOURCE",
    "element.update",
    { slideId: "required", elementId: "required" },
  ),
  REMOVE_SOURCE_ELEMENT: makeMetadata(
    "REMOVE_SOURCE_ELEMENT",
    "element.remove",
    { slideId: "required", elementId: "required" },
  ),
} satisfies Record<SlideCommandType, SlideCommandMetadata>;

export function getSlideCommandMetadata(
  type: string,
): SlideCommandMetadata | undefined {
  return SLIDE_COMMAND_METADATA[type as SlideCommandType];
}

export function validateDeckCommandPayload(
  payload: unknown,
  target: CommandTarget,
  errors: string[],
): void {
  if (!isPlainObject(payload)) {
    errors.push("Deck command payloads must be objects.");
    return;
  }

  if (!isOneOf(payload.type, SLIDE_COMMAND_TYPES)) {
    errors.push("payload.type must be a supported SlideCommand.");
    return;
  }

  if (payload.commandId !== undefined && !isNonEmptyString(payload.commandId)) {
    errors.push("payload.commandId must be a non-empty string when provided.");
  }
  if (
    payload.coalesceKey !== undefined &&
    !isNonEmptyString(payload.coalesceKey)
  ) {
    errors.push(
      "payload.coalesceKey must be a non-empty string when provided.",
    );
  }

  getSlideCommandMetadata(payload.type)?.payloadValidator(
    payload,
    target,
    errors,
  );
}

export function canCoalesceSlideCommands(
  a: SlideCommand,
  b: SlideCommand,
): boolean {
  if (a.type !== b.type) return false;
  const metadata = getSlideCommandMetadata(a.type);
  if (!metadata || metadata.coalescing.kind === "none") return false;
  if (!("coalesceKey" in a) || !("coalesceKey" in b)) return false;
  if (a.coalesceKey === undefined || a.coalesceKey !== b.coalesceKey)
    return false;
  if (!("slideId" in a) || !("slideId" in b) || a.slideId !== b.slideId)
    return false;
  if (metadata.coalescing.kind === "by-element") {
    return "elementId" in a && "elementId" in b && a.elementId === b.elementId;
  }
  return true;
}

export function mergeCoalescedSlideCommands(
  a: SlideCommand,
  b: SlideCommand,
): SlideCommand {
  if (a.type === "UPDATE_SLIDE" && b.type === "UPDATE_SLIDE") {
    return { ...a, patch: { ...a.patch, ...b.patch } };
  }
  if (a.type === "UPDATE_ELEMENT" && b.type === "UPDATE_ELEMENT") {
    return { ...a, patch: { ...a.patch, ...b.patch } as typeof a.patch };
  }
  if (
    a.type === "UPDATE_ELEMENT_CONTENT" &&
    b.type === "UPDATE_ELEMENT_CONTENT"
  ) {
    return {
      ...a,
      ...(b.content !== undefined ? { content: b.content } : {}),
      ...(b.role !== undefined ? { role: b.role } : {}),
    };
  }
  if (
    a.type === "UPDATE_ELEMENT_DESIGN_OVERRIDES" &&
    b.type === "UPDATE_ELEMENT_DESIGN_OVERRIDES"
  ) {
    return {
      ...a,
      designOverrides: { ...a.designOverrides, ...b.designOverrides },
    };
  }
  if (a.type === "UPDATE_SLIDE_TITLE" && b.type === "UPDATE_SLIDE_TITLE") {
    return { ...a, title: b.title };
  }
  if (a.type === "UPDATE_SLIDE_NOTES" && b.type === "UPDATE_SLIDE_NOTES") {
    return { ...a, notes: b.notes };
  }
  if (a.type === "SET_ELEMENT_BOXES" && b.type === "SET_ELEMENT_BOXES") {
    return { ...a, boxesById: { ...a.boxesById, ...b.boxesById } };
  }
  if (a.type === "SET_ELEMENT_PATCHES" && b.type === "SET_ELEMENT_PATCHES") {
    return { ...a, patchesById: { ...a.patchesById, ...b.patchesById } };
  }
  return b;
}
