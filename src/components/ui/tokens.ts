// Shared class-string tokens for `src/components/ui/` primitives. The fallback
// values keep primitives legible until runtime CSS custom properties resolve.

/** Keyboard focus ring driven by the Tailwind `ds-*` token bridge. */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus-ring focus-visible:ring-offset-1 focus-visible:ring-offset-ds-focus-offset";

/** Radii scale (`--ds-radius-*`). */
export const RADIUS = {
  sm: "rounded-[var(--ds-radius-sm,6px)]",
  md: "rounded-[var(--ds-radius-md,8px)]",
  lg: "rounded-[var(--ds-radius-lg,10px)]",
  xl: "rounded-[var(--ds-radius-xl,12px)]",
  pill: "rounded-[var(--ds-radius-pill,9999px)]",
} as const;

export type Radius = keyof typeof RADIUS;

/** Elevation scale (`--ds-shadow-*`). */
export const ELEVATION = {
  flat: "shadow-[var(--ds-shadow-flat,none)]",
  raised: "shadow-[var(--ds-shadow-raised,0_1px_2px_rgba(15,23,42,0.06))]",
  overlay:
    "shadow-[var(--ds-shadow-overlay,0_18px_40px_-28px_rgba(15,23,42,0.45))]",
  popover:
    "shadow-[var(--ds-shadow-popover,0_24px_60px_-34px_rgba(15,23,42,0.5))]",
} as const;

export type Elevation = keyof typeof ELEVATION;

/** Semantic app z-index layers. Mirrors the global `--z-index-*` scale. */
export const UI_LAYER = {
  raised: "z-raised",
  sticky: "z-sticky",
  header: "z-header",
  canvas: "z-canvas",
  dropdown: "z-dropdown",
  overlay: "z-overlay",
  panel: "z-panel",
  modal: "z-modal",
  menu: "z-menu",
  toast: "z-toast",
  tooltip: "z-tooltip",
} as const;

export type UILayer = keyof typeof UI_LAYER;

/** Base surface fill, border color, and text color. */
export const SURFACE_BASE =
  "bg-[var(--ds-surface-base,#f8fafc)] text-[var(--ds-text-primary,#172033)] border-[var(--ds-border-subtle,rgba(23,32,51,0.10))]";

/** Shared form field chrome for inputs, selects, and textareas. */
export const FIELD_CONTROL = cx(
  "border border-ds-border-subtle bg-ds-surface-raised text-sm text-ds-text-primary placeholder:text-ds-text-muted",
  "focus:border-ds-accent focus:outline-none focus:ring-2 focus:ring-ds-focus-ring/20",
  RADIUS.md,
);

/** Shared page card/panel shell. */
export const PANEL_CHROME = cx(
  "border border-ds-border-subtle bg-ds-surface-raised text-ds-text-primary",
  RADIUS.lg,
);

/** Shared empty-state shell. */
export const EMPTY_STATE_CHROME = cx(
  "border border-dashed border-ds-border-strong bg-ds-surface-raised text-center",
  RADIUS.lg,
);

/** Shared dropdown/menu shell. */
export const MENU_CHROME = cx(
  "overflow-hidden border border-ds-border-subtle bg-ds-surface-overlay py-1",
  RADIUS.md,
  ELEVATION.popover,
);

/** Shared menu item row. */
export const MENU_ITEM =
  "flex w-full items-center px-3 py-2 text-left text-sm text-ds-text-secondary transition hover:bg-ds-state-hover hover:text-ds-text-primary";

/** Shared color transition for interactive chrome. */
export const CONTROL_TRANSITION = "transition-colors";

/** Square icon button used by editor gutter affordances. */
export const GUTTER_BUTTON = cx(
  "flex h-9 w-9 items-center justify-center rounded-ds-sm border border-ds-border-subtle bg-ds-surface-raised text-ds-text-muted shadow-ds-raised",
  CONTROL_TRANSITION,
  "hover:bg-ds-state-hover hover:text-ds-text-primary active:bg-ds-state-active aria-expanded:bg-ds-state-hover aria-expanded:text-ds-text-primary",
  FOCUS_RING,
);

/** Base inactive/active toolbar icon-button states. */
export const TOOLBAR_BUTTON_CHROME = {
  active: "bg-ds-accent-surface text-ds-accent-text",
  subtle:
    "text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary",
  surface:
    "border border-ds-border-subtle bg-ds-surface-raised text-ds-text-primary hover:bg-ds-state-hover active:bg-ds-state-active",
} as const;

/* node:coverage ignore next -- tsx maps the covered object close/comment to a non-runtime line. */
/** Joins truthy class fragments. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
