export {
  SLIDE_COMMAND_METADATA,
  canCoalesceSlideCommands,
  getSlideCommandMetadata,
  mergeCoalescedSlideCommands,
  validateDeckCommandPayload,
} from "@/lib/document/deck-kernel/slide-command-metadata";
export type {
  SlideCommandAffectedIds,
  SlideCommandCoalescing,
  SlideCommandMetadata,
  SlideCommandType,
} from "@/lib/document/deck-kernel/slide-command-metadata";
