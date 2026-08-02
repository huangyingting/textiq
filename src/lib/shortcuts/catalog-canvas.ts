import type { ShortcutEntry, KeyMatcherMetadata } from "./catalog-types";
import {
  bareKey,
  modKey,
  modShiftKey,
  arrowKey,
  shiftArrowKey,
  altArrowKey,
  altShiftArrowKey,
  bracketKey,
  shiftBracketKey,
} from "./catalog-keys";

function canvasShortcut(args: {
  id: ShortcutEntry["id"];
  group: string;
  tokens: readonly string[];
  match: KeyMatcherMetadata;
  description: string;
  displayLabel?: string;
  canonical?: string;
}): ShortcutEntry {
  return {
    id: args.id,
    scope: "Slides",
    surface: "slide-canvas",
    match: args.match,
    displayTokens: args.tokens,
    displayLabel: args.displayLabel,
    canonical: args.canonical,
    description: args.description,
    handler: "canvas",
    allowInTextInput: false,
    helpGroup: args.group,
  };
}

export const CANVAS_SHORTCUTS: readonly ShortcutEntry[] = [
  canvasShortcut({
    id: "canvas.selection.traverse",
    group: "Selection",
    displayLabel: "Tab / Shift + Tab",
    tokens: ["Tab"],
    match: {
      key: "Tab",
      ctrlKey: "forbidden",
      metaKey: "forbidden",
      altKey: "forbidden",
      shiftKey: "optional",
    },
    description:
      "Select next / previous element; switch connector endpoint while editing",
  }),
  canvasShortcut({
    id: "canvas.selection.clear",
    group: "Selection",
    tokens: ["Escape"],
    match: bareKey("Escape", false),
    description:
      "Finish connector endpoint editing; otherwise clear selection / release canvas focus",
  }),
  canvasShortcut({
    id: "canvas.move.step",
    group: "Move & resize",
    tokens: ["Arrow"],
    match: arrowKey(),
    description: "Move selection or active connector endpoint by 1%",
  }),
  canvasShortcut({
    id: "canvas.move.large-step",
    group: "Move & resize",
    tokens: ["Shift", "Arrow"],
    match: shiftArrowKey(),
    description: "Move selection or active connector endpoint by 5%",
  }),
  canvasShortcut({
    id: "canvas.resize.step",
    group: "Move & resize",
    tokens: ["Alt", "Arrow"],
    match: altArrowKey(),
    description: "Resize selection by 1%",
  }),
  canvasShortcut({
    id: "canvas.resize.large-step",
    group: "Move & resize",
    tokens: ["Alt", "Shift", "Arrow"],
    match: altShiftArrowKey(),
    description: "Resize selection by 5%",
  }),
  canvasShortcut({
    id: "canvas.arrange.forward-backward",
    group: "Arrange",
    displayLabel: "[ / ]",
    tokens: ["["],
    match: bracketKey(),
    description: "Send backward / bring forward",
  }),
  canvasShortcut({
    id: "canvas.arrange.front-back",
    group: "Arrange",
    displayLabel: "Mod + [ / ]",
    tokens: ["Mod", "["],
    match: {
      key: ["[", "]"],
      caseInsensitive: false,
      primaryModifier: "required",
      altKey: "forbidden",
      shiftKey: "forbidden",
    },
    description: "Send to back / bring to front",
  }),
  canvasShortcut({
    id: "canvas.rotate.step",
    group: "Arrange",
    displayLabel: "Shift + [ / ]",
    tokens: ["Shift", "["],
    match: shiftBracketKey(),
    description: "Rotate selection by 1°",
  }),
  canvasShortcut({
    id: "canvas.edit.inline",
    group: "Edit",
    tokens: ["Enter"],
    match: bareKey("Enter", false),
    description: "Edit text, table, or connector endpoints; enter group",
  }),
  canvasShortcut({
    id: "canvas.edit.delete",
    group: "Edit",
    displayLabel: "Delete / Backspace",
    tokens: ["Delete"],
    match: {
      key: ["Delete", "Backspace"],
      ctrlKey: "forbidden",
      metaKey: "forbidden",
      altKey: "forbidden",
      shiftKey: "optional",
    },
    description: "Delete selection",
  }),
  canvasShortcut({
    id: "canvas.edit.duplicate",
    group: "Edit",
    tokens: ["Mod", "D"],
    canonical: "Mod+D",
    match: modKey("d"),
    description: "Duplicate selection",
  }),
  canvasShortcut({
    id: "canvas.edit.clipboard",
    group: "Edit",
    displayLabel: "Mod + C / V",
    tokens: ["Mod", "C"],
    match: {
      key: ["c", "v"],
      caseInsensitive: true,
      primaryModifier: "required",
      altKey: "forbidden",
      shiftKey: "forbidden",
    },
    description: "Copy / paste",
  }),
  canvasShortcut({
    id: "canvas.edit.undo",
    group: "Edit",
    tokens: ["Mod", "Z"],
    canonical: "Mod+Z",
    match: modKey("z"),
    description: "Undo",
  }),
  canvasShortcut({
    id: "canvas.edit.redo",
    group: "Edit",
    tokens: ["Mod", "Shift", "Z"],
    canonical: "Mod+Shift+Z",
    match: modShiftKey("z"),
    description: "Redo",
  }),
  canvasShortcut({
    id: "canvas.arrange.group",
    group: "Arrange",
    tokens: ["Mod", "G"],
    canonical: "Mod+G",
    match: modKey("g"),
    description: "Group selection",
  }),
  canvasShortcut({
    id: "canvas.arrange.ungroup",
    group: "Arrange",
    tokens: ["Mod", "Shift", "G"],
    canonical: "Mod+Shift+G",
    match: modShiftKey("g"),
    description: "Ungroup",
  }),
  canvasShortcut({
    id: "canvas.help",
    group: "Slides",
    tokens: ["?"],
    canonical: "?",
    match: {
      key: "?",
      ctrlKey: "forbidden",
      metaKey: "forbidden",
      altKey: "forbidden",
      shiftKey: "optional",
    },
    description: "Show this keyboard help",
  }),
];
