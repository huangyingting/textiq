export type ClipboardShortcutAction = "copy" | "cut" | "paste";

export function clipboardShortcutActionFromKey(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  key: string;
}): ClipboardShortcutAction | null {
  if (!event.metaKey && !event.ctrlKey) return null;
  const key = event.key.toLowerCase();
  if (key === "c") return "copy";
  if (key === "x") return "cut";
  if (key === "v") return "paste";
  return null;
}
