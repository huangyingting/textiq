import type { StyleObject, StylePatch } from "./style-schema";

type MergeStylePatchOptions = {
  skipUndefined?: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDiscriminatedStyleUnion(value: Record<string, unknown>): boolean {
  return typeof value.type === "string" || typeof value.kind === "string";
}

function mergePatchObject(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  skipUndefined: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined && skipUndefined) continue;
    result[key] = mergePatchValue(base[key], patchValue, skipUndefined);
  }
  return result;
}

function mergePatchValue(
  baseValue: unknown,
  patchValue: unknown,
  skipUndefined: boolean,
): unknown {
  if (patchValue === undefined) return undefined;
  if (!isPlainObject(patchValue)) return patchValue;
  if (isDiscriminatedStyleUnion(patchValue)) return { ...patchValue };

  if (!isPlainObject(baseValue) || isDiscriminatedStyleUnion(baseValue)) {
    return mergePatchObject({}, patchValue, skipUndefined);
  }

  return mergePatchObject(baseValue, patchValue, skipUndefined);
}

export function mergeStylePatchDeep(
  base: StylePatch | StyleObject | undefined,
  patch: StylePatch,
  options: MergeStylePatchOptions = {},
): StylePatch | StyleObject {
  return mergePatchObject(
    (base ?? {}) as Record<string, unknown>,
    patch as Record<string, unknown>,
    options.skipUndefined ?? false,
  ) as StylePatch | StyleObject;
}
