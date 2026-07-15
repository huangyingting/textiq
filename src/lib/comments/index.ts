/* node:coverage disable */
/* Barrel re-export facade has no runtime branch beyond import wiring. */
export {
  normalizeAnchorType,
  normalizeAnchorText,
  validateAnchorGeometry,
  sanitizeAnchorGeometry,
  validateSlideId,
  validateElementId,
  slideAnchorFromRecord,
  slideAnchorToRecord,
  commentAnchorFromRecord,
  commentAnchorToRecord,
} from "./anchors";
export type {
  CommentAnchorType,
  AnchorPoint,
  DeckCommentAnchor,
  TextCommentAnchor,
  DocumentBlockCommentAnchor,
  SlideLevelCommentAnchor,
  SlideElementCommentAnchor,
  CommentAnchor,
  CommentAnchorRecord,
} from "./anchors";

export {
  applySlideDeleteToAnchors,
  applyElementDeleteToAnchors,
  findOrphanedAnchors,
  planSlideCommentAnchorRepairs,
} from "./lifecycle";
export type {
  PersistedSlideCommentAnchor,
  SlideCommentAnchorRepairPlan,
} from "./lifecycle";

export { mapCommentThreadRecord } from "./mappers";
export {
  reconcileSlideCommentAnchors,
  type CommentAnchorPersistenceDb,
  type CommentAnchorReconciliationResult,
} from "./persistence";
export type { CommentReplyRecord, CommentThreadRecord } from "./records";

export { CommentError, type CommentErrorCode } from "./errors";
export {
  adaptKnownCommentActionError,
  commentActionError,
  commentActionOk,
} from "./action-result";
export type {
  CommentActionError,
  CommentActionErrorCode,
  CommentActionResult,
} from "./action-result";

export { canEditComment, canDeleteComment } from "./policy";
export type { CommentOwnership } from "./policy";

export {
  commentUnreadScope,
  isCommentUnread,
  isCommentUnreadForScope,
} from "./read-state";
export type { CommentUnreadRecord, UnreadCountScope } from "./read-state";

export { createCommentService } from "./service";
/* node:coverage ignore next 6 -- Service type-only facade exports are erased by tsx. */
export type {
  CommentCapabilityContext,
  RequireCommentDocumentContext,
  CommentMutationResult,
  CommentService,
} from "./service";

/* node:coverage ignore next 7 -- Comment type-only facade exports are erased by tsx. */
export type {
  CommentAuthor,
  CommentNode,
  CommentThread,
  CreateCommentInput,
  ListCommentsOptions,
} from "./types";
/* node:coverage ignore next -- Re-enabling coverage marker has no runtime branch. */
/* node:coverage enable */
