"use client";

import {
  resolveCardMotion,
  resolvePopMotion,
  type MotionPreset,
} from "./presets";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * Motion props spreadable onto a `motion.*` element (`initial`/`animate`/`exit`
 * + `transition`). All presets are transform/opacity-based so they never trigger
 * layout shift, and they collapse to a no-op when the user prefers reduced
 * motion (US-015).
 */
export type RevealMotion = MotionPreset;

/**
 * Fade + subtle scale for transient overlays (floating toolbar, "+"/"/" insert
 * menu, block spark button/panel, the visual card controls popover). Pair with
 * `<AnimatePresence>` so the exit animation can run before unmount.
 */
export function usePopMotion(): RevealMotion {
  return resolvePopMotion(Boolean(useReducedMotion()));
}

/**
 * Slightly softer fade + scale for blocks/cards (e.g. a visual card mounting
 * into the document). Mount-only usages can spread `initial`/`animate`/
 * `transition`; in/out usages should wrap in `<AnimatePresence>`.
 */
export function useCardMotion(): RevealMotion {
  return resolveCardMotion(Boolean(useReducedMotion()));
}
