import {
  SHORTCUT_REGISTRY,
  shortcutDisplayLabel,
} from "@/lib/shortcuts/catalog";

/** A single keyboard shortcut row in the help overlay. */
export interface ShortcutHelpEntry {
  /** Human-readable key combination, e.g. `"Alt + Arrow"`. */
  keys: string;
  /** What the shortcut does. */
  description: string;
}

/** A titled group of related shortcuts. */
export interface ShortcutHelpGroup {
  title: string;
  entries: ShortcutHelpEntry[];
}

/**
 * Returns the grouped canvas keyboard shortcut reference rendered by the
 * in-product help dialog (#535). `isMac` swaps the Ctrl modifier for ⌘ so the
 * overlay matches the platform shortcuts used by the editor.
 */
export function canvasShortcutHelp(
  opts: { isMac?: boolean } = {},
): ShortcutHelpGroup[] {
  const groups = new Map<string, ShortcutHelpEntry[]>();
  for (const shortcut of SHORTCUT_REGISTRY) {
    if (shortcut.surface !== "slide-canvas" || !shortcut.helpGroup) {
      continue;
    }
    const entries = groups.get(shortcut.helpGroup) ?? [];
    entries.push({
      keys: shortcutDisplayLabel(shortcut, opts),
      description: shortcut.description,
    });
    groups.set(shortcut.helpGroup, entries);
  }
  return Array.from(groups, ([title, entries]) => ({ title, entries }));
}
