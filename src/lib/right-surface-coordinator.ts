/**
 * Pure state logic for the right-surface coordinator.
 *
 * DOM-free and React-free — unit-testable headlessly.
 * The React context ({@link right-surface-context.tsx}) wraps this logic.
 *
 * Enforces mutual exclusion between the Slide Editor panel and the floating
 * VisualContextPopover so large editor overlays do not compete:
 *
 *   Rule A — Opening the Slide Editor suppresses the floating
 *   VisualContextPopover. Closing it restores default behaviour.
 *   Rule B — Only one of {slide editor, floating visual popover} is active at
 *   any given time.
 */

export type RightSurfaceState = {
  /** True when the SlideEditor panel is currently open. */
  slideEditorOpen: boolean;
};

export const INITIAL_RIGHT_SURFACE_STATE: RightSurfaceState = {
  slideEditorOpen: false,
};

export type RightSurfaceAction =
  { type: "OPEN_SLIDE_EDITOR" } | { type: "CLOSE_SLIDE_EDITOR" };

/**
 * Pure reducer for right-surface coordinator state.
 * Returns a new object — never mutates the input.
 */
export function rightSurfaceReducer(
  state: RightSurfaceState,
  action: RightSurfaceAction,
): RightSurfaceState {
  switch (action.type) {
    case "OPEN_SLIDE_EDITOR":
      return { ...state, slideEditorOpen: true };
    case "CLOSE_SLIDE_EDITOR":
      return { ...state, slideEditorOpen: false };
    default:
      return state;
  }
}

/**
 * Returns `true` when the floating VisualContextPopover should be suppressed.
 *
 * When the full-page SlideEditor is open it covers the whole screen, so the
 * inline VisualContextPopover would be hidden behind it. Suppressing the float
 * keeps it from rendering while the slide editor is active.
 */
export function shouldSuppressFloatPopover(state: RightSurfaceState): boolean {
  return state.slideEditorOpen;
}
