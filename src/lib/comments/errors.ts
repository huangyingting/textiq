export type CommentErrorCode =
  | "empty_body"
  | "parent_not_found"
  | "comment_not_found"
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
