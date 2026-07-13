/**
 * Captures the own property descriptor (or its absence) for a fixed set of
 * keys on `target`, and restores exactly that state later: a present
 * descriptor is reinstalled verbatim (preserving `value`/`get`/`set`,
 * `writable`, `enumerable`, and `configurable`), and an absent property is
 * deleted rather than left behind. Nesting works without extra bookkeeping —
 * each capture reads whatever is installed at call time, so an inner
 * restore peels back to exactly what an outer capture saw, and the outer
 * restore then peels back to the true original (or removes the property
 * entirely if it never existed).
 */
export type PropertyDescriptorSnapshot = ReadonlyMap<
  PropertyKey,
  PropertyDescriptor | undefined
>;

export function captureOwnPropertyDescriptors(
  target: object,
  keys: readonly PropertyKey[],
): PropertyDescriptorSnapshot {
  return new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(target, key)]),
  );
}

export function restoreOwnPropertyDescriptors(
  target: object,
  snapshot: PropertyDescriptorSnapshot,
): void {
  for (const [key, descriptor] of snapshot) {
    if (descriptor) {
      Object.defineProperty(target, key, descriptor);
    } else {
      Reflect.deleteProperty(target, key);
    }
  }
}
