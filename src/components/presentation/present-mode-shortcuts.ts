import type { PresentShortcutAction } from "@/lib/presentation/present-shell";

export type PresentModeShortcutContext = {
  keyboardHelpOpen: boolean;
  overviewOpen: boolean;
};

export type PresentModeNavigateAction = Extract<
  PresentShortcutAction,
  "next" | "previous" | "first" | "last"
>;

export type PresentModeShortcutEffect =
  | { type: "close-keyboard-help" }
  | { type: "close-overview" }
  | { type: "exit" }
  | { type: "toggle-keyboard-help" }
  | { type: "blocked" }
  | { type: "navigate"; action: PresentModeNavigateAction }
  | { type: "toggle-fullscreen" }
  | { type: "toggle-notes" }
  | { type: "toggle-overview" }
  | { type: "toggle-timer" }
  | { type: "toggle-laser" };

export function resolvePresentModeShortcutEffect(
  action: PresentShortcutAction,
  context: PresentModeShortcutContext,
): PresentModeShortcutEffect {
  if (action === "exit") {
    if (context.keyboardHelpOpen) return { type: "close-keyboard-help" };
    if (context.overviewOpen) return { type: "close-overview" };
    return { type: "exit" };
  }
  if (action === "help") return { type: "toggle-keyboard-help" };
  if (context.keyboardHelpOpen) return { type: "blocked" };
  if (context.overviewOpen) {
    return action === "overview"
      ? { type: "close-overview" }
      : { type: "blocked" };
  }

  switch (action) {
    case "next":
    case "previous":
    case "first":
    case "last":
      return { type: "navigate", action };
    case "fullscreen":
      return { type: "toggle-fullscreen" };
    case "notes":
      return { type: "toggle-notes" };
    case "overview":
      return { type: "toggle-overview" };
    case "timer":
      return { type: "toggle-timer" };
    case "laser":
      return { type: "toggle-laser" };
  }
}
