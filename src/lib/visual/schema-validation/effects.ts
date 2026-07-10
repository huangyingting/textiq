/** Effect-level visual schema validation. */

import {
  isEffectKind,
  type SketchEffect,
  type ShadowEffect,
  type VisualEffect,
} from "@/lib/visual/schema-types";
import { isFiniteNumber, isPlainObject } from "@/lib/type-guards";

export function parseEffect(item: unknown): VisualEffect | null {
  if (!isPlainObject(item)) return null;
  const { kind } = item;
  if (!isEffectKind(kind)) return null;

  if (kind === "shadow") {
    const effect: ShadowEffect = { kind };
    const dx = item.dx;
    if (isFiniteNumber(dx)) effect.dx = dx; /* node:coverage ignore next */
    const dy = item.dy;
    if (isFiniteNumber(dy)) effect.dy = dy;
    const blur = item.blur;
    if (isFiniteNumber(blur) && blur >= 0) effect.blur = blur;
    if (typeof item.color === "string") effect.color = item.color;
    return effect;
  }

  const effect: SketchEffect = { kind };
  const frequency = item.frequency;
  if (isFiniteNumber(frequency) && frequency > 0) effect.frequency = frequency;
  const scale = item.scale;
  if (isFiniteNumber(scale) && scale >= 0) effect.scale = scale;
  return effect;
}

export function parseEffects(input: unknown): VisualEffect[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const effects: VisualEffect[] = [];
  for (const item of input) {
    const parsed = parseEffect(item);
    if (parsed) effects.push(parsed);
  }
  return effects.length > 0 ? effects : undefined;
}
