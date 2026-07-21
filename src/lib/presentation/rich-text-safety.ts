const SAFE_INLINE_TEXT_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;
const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const DESIGN_TOKEN =
  /^(?:brand|theme|palette|color|colors|visual|text|background|border|accent|semantic|surface)\.[a-z0-9][a-z0-9._-]*$/i;
const CSS_IDENTIFIER_LIST = /^[a-zA-Z0-9\s'",._-]+$/;

export function normalizeInlineTextLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || CONTROL_CHAR_PATTERN.test(trimmed)) return null;
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("\\\\") ||
    trimmed.startsWith("/\\")
  ) {
    return null;
  }

  const schemeMatch = /^([a-zA-Z][a-zA-Z\d+\-.]*):/.exec(trimmed);
  if (!schemeMatch) return null;
  const scheme = `${schemeMatch[1].toLowerCase()}:`;
  if (!SAFE_INLINE_TEXT_LINK_SCHEMES.has(scheme)) return null;

  try {
    const normalized = new URL(
      `${scheme}${trimmed.slice(schemeMatch[0].length)}`,
    );
    return normalized.toString();
  } catch {
    return null;
  }
}

export function sanitizeInlineTextColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || /[;"'<>\\]/.test(trimmed)) return null;
  return HEX_COLOR.test(trimmed) || DESIGN_TOKEN.test(trimmed) ? trimmed : null;
}

export function sanitizeInlineTextFontFamily(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  if (!CSS_IDENTIFIER_LIST.test(trimmed)) return null;
  return trimmed;
}

export function sanitizeInlineTextFontSizePt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= 0 || value > 400) return null;
  return value;
}

export function sanitizeInlineTextCssFontSize(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = /^(\d+(?:\.\d+)?)(pt|px)$/i.exec(trimmed);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 400) return null;
  return `${amount}${match[2].toLowerCase()}`;
}
