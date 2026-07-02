/**
 * Inline text editor command event for presentation.
 *
 * The context toolbar dispatches a `textiq:inline-text-command-presentation` custom
 * event on `document`; the active `InlineTextEditorPresentation` instance handles it.
 */

export const INLINE_TEXT_COMMAND_EVENT_ =
  "textiq:inline-text-command-presentation";

export type InlineTextCommandName =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "bullet-list"
  | "numbered-list"
  | "indent-list"
  | "outdent-list"
  | "align-left"
  | "align-center"
  | "align-right"
  | "link"
  | "unlink"
  | "color"
  | "font-size";

export type InlineTextCommandPayload = {
  command: InlineTextCommandName;
  /** Used by "color", "font-size", and "link" commands. */
  value?: string;
};

/** Dispatch a command to the focused inline text editor. */
export function dispatchInlineTextCommand(
  payload: InlineTextCommandPayload,
): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(
    new CustomEvent(INLINE_TEXT_COMMAND_EVENT_, { detail: payload }),
  );
}
