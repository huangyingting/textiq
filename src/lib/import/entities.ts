const NAMED_CHARACTER_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
};

const MAX_CODE_POINT = 0x10ffff;
const HIGH_SURROGATE_START = 0xd800;
const LOW_SURROGATE_END = 0xdfff;

function isValidCodePoint(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_CODE_POINT &&
    (value < HIGH_SURROGATE_START || value > LOW_SURROGATE_END)
  );
}

function decodeNumericEntity(
  match: string,
  raw: string,
  radix: 10 | 16,
): string {
  const codePoint = Number.parseInt(raw, radix);
  return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : match;
}

export function decodeBasicCharacterEntities(value: string): string {
  return value.replace(
    /&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi,
    (
      match,
      hex: string | undefined,
      decimal: string | undefined,
      name: string | undefined,
    ) => {
      if (hex !== undefined) {
        return decodeNumericEntity(match, hex, 16);
      }
      if (decimal !== undefined) {
        return decodeNumericEntity(match, decimal, 10);
      }
      const decoded = NAMED_CHARACTER_ENTITIES[name?.toLowerCase() ?? ""];
      return decoded ?? match;
    },
  );
}
