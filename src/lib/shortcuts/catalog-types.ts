export type ShortcutScope = "Global" | "Dashboard" | "Editor" | "Slides";

export type ShortcutSurface =
  | "app-shell"
  | "dashboard"
  | "document-editor"
  | "text-toolbar"
  | "slide-canvas"
  | "presentation-runtime"
  | "present-mode";

export type ShortcutHandlerKind =
  "global" | "local" | "browser-editor" | "canvas";

export type ModifierRule = "required" | "forbidden" | "optional";

export type ShortcutId =
  | "global.help"
  | "dashboard.new-document"
  | "editor.toggle-preview"
  | "editor.format.bold"
  | "editor.format.italic"
  | "editor.format.underline"
  | "editor.format.inline-code"
  | "editor.align.left"
  | "editor.align.center"
  | "editor.align.right"
  | "editor.align.justify"
  | "canvas.selection.traverse"
  | "canvas.selection.clear"
  | "canvas.move.step"
  | "canvas.move.large-step"
  | "canvas.resize.step"
  | "canvas.resize.large-step"
  | "canvas.edit.inline"
  | "canvas.edit.delete"
  | "canvas.edit.duplicate"
  | "canvas.edit.clipboard"
  | "canvas.edit.undo"
  | "canvas.edit.redo"
  | "canvas.arrange.forward-backward"
  | "canvas.arrange.front-back"
  | "canvas.rotate.step"
  | "canvas.arrange.group"
  | "canvas.arrange.ungroup"
  | "canvas.help"
  | "presentation.next"
  | "presentation.previous"
  | "presentation.first"
  | "presentation.last"
  | "presentation.help"
  | "presentation.exit"
  | "presentation.fullscreen"
  | "presentation.notes"
  | "presentation.overview"
  | "presentation.timer"
  | "presentation.laser";

export type KeyMatcherMetadata = {
  /** `event.key` values accepted by this shortcut. */
  key: string | readonly string[];
  /** Defaults to `true`, preserving current lowercase/uppercase matching. */
  caseInsensitive?: boolean;
  ctrlKey?: ModifierRule;
  metaKey?: ModifierRule;
  altKey?: ModifierRule;
  shiftKey?: ModifierRule;
  /** Requires Ctrl or Meta while preserving current behavior that allows both. */
  primaryModifier?: "required" | "forbidden";
};

export type KeyEventLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export type ShortcutEntry = {
  /** Stable id used by match helpers and local feature registries. */
  id: ShortcutId;
  /** Human-readable grouping for global and in-product help. */
  scope: ShortcutScope;
  /** Specific product surface where the shortcut applies. */
  surface: ShortcutSurface;
  /** Matcher metadata used by pure shortcut predicates. */
  match: KeyMatcherMetadata;
  /** Display tokens for a single chord, e.g. `["Mod", "B"]`. */
  displayTokens: readonly string[];
  /** Optional display string for multi-chord rows such as canvas help. */
  displayLabel?: string;
  /** Canonical local label source used by editor tooltips. */
  canonical?: string;
  /** What the shortcut does. */
  description: string;
  /** Whether it is handled by app-level, feature-local, browser/editor, or canvas wiring. */
  handler: ShortcutHandlerKind;
  /** Whether the shortcut is allowed to fire from text-entry targets. */
  allowInTextInput: boolean;
  /** Optional subgroup used by slide-canvas help. */
  helpGroup?: string;
  /** Hide implementation-only/local duplicates from the global shortcut dialog. */
  showInGlobalHelp?: boolean;
};
