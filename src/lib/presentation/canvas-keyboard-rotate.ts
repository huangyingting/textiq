/**
 * Pure keyboard decision helpers for slide-canvas element rotation.
 *
 * The editor owns DOM focus and deck mutations; this module only maps key
 * chords to rotation deltas and normalizes the resulting angle.
 */

export interface KeyboardRotationKeyEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const KEYBOARD_ROTATION_STEP_DEG = 15;
const KEYBOARD_ROTATION_FINE_STEP_DEG = 1;

export function keyboardRotationDelta(
  event: KeyboardRotationKeyEvent,
): number | null {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return null;
  }
  const step = event.shiftKey
    ? KEYBOARD_ROTATION_FINE_STEP_DEG
    : KEYBOARD_ROTATION_STEP_DEG;
  if (event.key === "[" || event.key === "{") return -step;
  if (event.key === "]" || event.key === "}") return step;
  return null;
}

/* node:coverage disable */
/* Rotation normalization is covered by canvas-keyboard-rotate.test.ts; tsx maps the closing rows as residual. */
export function normalizeKeyboardRotationAngle(deg: number): number {
  const normalized = ((deg % 360) + 360) % 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}
/* node:coverage enable */

export function deckRotationFromKeyboardAngle(
  angle: number,
): number | undefined {
  const normalized = normalizeKeyboardRotationAngle(angle);
  if (normalized === 0) return undefined;
  return normalized > 180 ? normalized - 360 : normalized;
}

export function applyKeyboardRotation(
  currentRotation: number | undefined,
  delta: number,
): { angle: number; rotation: number | undefined } {
  const angle = normalizeKeyboardRotationAngle((currentRotation ?? 0) + delta);
  return {
    angle,
    rotation: deckRotationFromKeyboardAngle(angle),
  };
}

export function announceRotation(name: string, angle: number): string {
  return `Rotated ${name} to ${Math.round(
    normalizeKeyboardRotationAngle(angle),
  )}°`;
}
