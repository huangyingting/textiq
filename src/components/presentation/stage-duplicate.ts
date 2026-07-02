/**
 * Pairs freshly duplicated top-level nodes with the originals they were cloned
 * from. `duplicateNodes` inserts each clone immediately after its source at the
 * same array level and reports the clone ids, so a top-level original is always
 * directly followed by its duplicate. This lets an Alt-drag gesture drop the
 * duplicates at the moved position while leaving the originals in place (Canva
 * parity).
 */
export function pairDuplicatesAfterOriginals(
  topLevel: readonly { id: string }[],
  originalIds: ReadonlySet<string>,
  duplicatedIds: ReadonlySet<string>,
): Map<string, string> {
  const pairs = new Map<string, string>();
  for (let index = 0; index < topLevel.length - 1; index += 1) {
    const current = topLevel[index].id;
    const next = topLevel[index + 1].id;
    if (
      originalIds.has(current) &&
      duplicatedIds.has(next) &&
      !pairs.has(current)
    ) {
      pairs.set(current, next);
    }
  }
  return pairs;
}
