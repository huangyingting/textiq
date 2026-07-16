export type CommentErrorCode =
  | "empty_body"
  | "parent_not_found"
  | "comment_unavailable"
  | "edit_forbidden"
  | "delete_forbidden"
  | "thread_required"
  | "invalid_anchor_geometry"
  | "invalid_slide_id"
  | "invalid_element_id"
  | "slide_deck_missing"
  | "slide_deck_invalid"
  | "slide_anchor_orphaned";

export class CommentError extends Error {
  readonly code: CommentErrorCode;

  constructor(code: CommentErrorCode, message: string) {
    super(message);
    this.name = "CommentError";
    this.code = code;
  }
}

export type CommentUnavailableClassification =
  | "document_not_visible"
  | "target_missing_in_document"
  | "target_changed";

export class CommentUnavailableError extends CommentError {
  readonly classification: CommentUnavailableClassification;

  constructor(classification: CommentUnavailableClassification) {
    super("comment_unavailable", "Comment is unavailable.");
    this.name = "CommentUnavailableError";
    this.classification = classification;
  }
}
