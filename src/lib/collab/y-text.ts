import type * as Y from "yjs";

/** A Quill-style delta op as produced by `Y.Text` `observe` events. */
type DeltaOp = {
  retain?: number;
  insert?: string | object;
  delete?: number;
};

/**
 * Applies the minimal single-region edit that turns `oldStr` into `newStr` onto
 * a `Y.Text`, as one transaction. Computing the common prefix/suffix keeps the
 * change small so concurrent edits in *different* regions merge cleanly (CRDT)
 * instead of clobbering each other the way a full delete+insert would.
 *
 * `origin` is attached to the transaction so observers can tell whether a change
 * came from this client.
 */
export function applyTextDiff(
  ytext: Y.Text,
  oldStr: string,
  newStr: string,
  origin?: unknown,
): void {
  if (oldStr === newStr) {
    return;
  }

  let start = 0;
  const minLen = Math.min(oldStr.length, newStr.length);
  while (start < minLen && oldStr[start] === newStr[start]) {
    start += 1;
  }

  let endOld = oldStr.length;
  let endNew = newStr.length;
  while (
    endOld > start &&
    endNew > start &&
    oldStr[endOld - 1] === newStr[endNew - 1]
  ) {
    endOld -= 1;
    endNew -= 1;
  }

  const doc = ytext.doc;
  const run = () => {
    if (endOld > start) {
      ytext.delete(start, endOld - start);
    }
    if (endNew > start) {
      ytext.insert(start, newStr.slice(start, endNew));
    }
  };

  if (doc) {
    doc.transact(run, origin);
  } else {
    run();
  }
}

/**
 * Maps a caret/selection index in the *pre-change* text to its position in the
 * *post-change* text, given the `Y.Text` observe delta. This keeps a user's
 * cursor stable when a remote collaborator edits text before it. Insertions at
 * exactly the cursor push the cursor right (it "sticks" after remote inserts).
 */
export function adjustIndex(index: number, delta: DeltaOp[]): number {
  let pos = 0;
  let result = index;

  for (const op of delta) {
    if (op.retain != null) {
      pos += op.retain;
    } else if (op.insert != null) {
      const len = typeof op.insert === "string" ? op.insert.length : 1;
      if (pos <= index) {
        result += len;
      }
    } else if (op.delete != null) {
      if (pos < index) {
        result -= Math.min(op.delete, index - pos);
      }
      pos += op.delete;
    }
  }

  return Math.max(0, result);
}

/** A small, shared palette for presence carets, selections, and avatars. */
export const PRESENCE_COLORS = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#a855f7", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
];

/** Deterministically picks a presence color from a numeric id (e.g. clientID). */
export function colorFromId(id: number): string {
  const index = Math.abs(Math.trunc(id)) % PRESENCE_COLORS.length;
  return PRESENCE_COLORS[index];
}

type Rgb = { r: number; g: number; b: number };

const AVATAR_LIGHT_TEXT = "#ffffff";
const AVATAR_DARK_TEXT = "#111827";
const AVATAR_MIN_CONTRAST = 4.6;

function normalizeHex(hex: string): string {
  const raw = hex.trim().replace(/^#/, "");
  if (raw.length === 3) {
    return `#${raw
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toLowerCase()}`;
  }
  return `#${raw.toLowerCase()}`;
}

function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHex(hex).slice(1);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b]
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function darken(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  const scale = 1 - amount;
  return rgbToHex({
    r: rgb.r * scale,
    g: rgb.g * scale,
    b: rgb.b * scale,
  });
}

function linearizedSrgb(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance for a 3- or 6-digit hex color. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * linearizedSrgb(r) +
    0.7152 * linearizedSrgb(g) +
    0.0722 * linearizedSrgb(b)
  );
}

/** WCAG contrast ratio between two 3- or 6-digit hex colors. */
export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns avatar colors that preserve the base hue while guaranteeing WCAG AA
 * contrast for small initials. If neither light nor dark text works on the raw
 * palette color, the avatar-only background is darkened toward black.
 */
export function readableAvatarColors(baseHex: string): {
  background: string;
  text: string;
} {
  const background = normalizeHex(baseHex);
  const lightContrast = contrastRatio(AVATAR_LIGHT_TEXT, background);
  const darkContrast = contrastRatio(AVATAR_DARK_TEXT, background);

  if (lightContrast >= AVATAR_MIN_CONTRAST) {
    return { background, text: AVATAR_LIGHT_TEXT };
  }
  if (darkContrast >= AVATAR_MIN_CONTRAST) {
    return { background, text: AVATAR_DARK_TEXT };
  }

  let low = 0;
  let high = 1;
  let readableBackground = background;

  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    const candidate = darken(background, mid);
    if (contrastRatio(AVATAR_LIGHT_TEXT, candidate) >= AVATAR_MIN_CONTRAST) {
      readableBackground = candidate;
      high = mid;
    } else {
      low = mid;
    }
  }

  while (
    contrastRatio(AVATAR_LIGHT_TEXT, readableBackground) < AVATAR_MIN_CONTRAST
  ) {
    high = Math.min(1, high + 0.001);
    readableBackground = darken(background, high);
  }

  return { background: readableBackground, text: AVATAR_LIGHT_TEXT };
}

/** Two uppercase initials for an avatar, derived from a display name. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
