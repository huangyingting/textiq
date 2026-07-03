/**
 * Style resolver for the presentation system.
 *
 * Resolution order:
 *   package.styles[ref][variant/default]
 *   + deck.theme.overrides.styles[ref][variant/default]
 *   + node.localStyle
 */

import type {
  StyleObject,
  StyleBinding,
  StylePatch,
  ThemeTokens,
} from "./style-schema";
import type { ThemePackageV1 } from "./theme-package-schema";
import type { DeckThemeBinding } from "./schema";
import type { PresentationDiagnostic } from "./diagnostics";
import { DiagnosticCollector } from "./diagnostics";
import { mergeStylePatchDeep } from "./style-patch-merge";

// ---------------------------------------------------------------------------
// Deep merge helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

/** Resolves a token path against the provided tokens, returning undefined if missing. */
function resolveTokenPath(
  tokens: ThemeTokens,
  path: string,
): string | number | undefined {
  const parts = path.split(".");
  let cursor: unknown = tokens;
  for (const part of parts) {
    if (!isPlainObject(cursor)) return undefined;
    cursor = cursor[part];
  }
  if (typeof cursor === "string" || typeof cursor === "number") return cursor;
  return undefined;
}

/** Resolves all `{ token: ... }` refs inside a style object to concrete values. */
export function resolveTokensInStyle(
  style: StyleObject,
  tokens: ThemeTokens,
  dc: DiagnosticCollector,
  ctx: string,
): StyleObject {
  return resolveTokensDeep(style, tokens, dc, ctx) as StyleObject;
}

function resolveTokensDeep(
  value: unknown,
  tokens: ThemeTokens,
  dc: DiagnosticCollector,
  ctx: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      resolveTokensDeep(item, tokens, dc, `${ctx}.${index}`),
    );
  }
  if (!isPlainObject(value)) return value;
  if (typeof value.token === "string") {
    const resolved = resolveTokenPath(tokens, value.token);
    if (resolved === undefined) {
      dc.error(
        "missing-token",
        `Token "${value.token}" could not be resolved`,
        { path: ctx },
      );
      return value; // keep unresolved rather than dropping
    }
    return resolved;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = resolveTokensDeep(v, tokens, dc, `${ctx}.${k}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public resolver
// ---------------------------------------------------------------------------

export type StyleResolutionResult = {
  style: StyleObject;
  diagnostics: PresentationDiagnostic[];
};

/**
 * Resolves the full style for a node binding:
 *   package default -> package variant -> deck overrides -> local style.
 *
 * Token refs are resolved to concrete values. All diagnostics are returned
 * alongside the resolved style so callers can decide how to handle issues.
 */
export function resolveNodeStyle(
  binding: StyleBinding,
  themeBinding: DeckThemeBinding,
  pkg: ThemePackageV1,
  localStyle?: StylePatch,
): StyleResolutionResult {
  const dc = new DiagnosticCollector();
  const { ref, variant } = binding;

  // 1. Package base (default variant)
  const refStyles = pkg.styles[ref];
  if (!refStyles) {
    dc.error(
      "unknown-style-ref",
      `Theme package does not define style ref "${ref}"`,
      {
        path: `styles.${ref}`,
        action: { type: "replace-style-ref" },
        details: { styleRef: ref },
      },
    );
    return { style: {}, diagnostics: dc.diagnostics };
  }

  const defaultVariant = refStyles["default"];
  if (!defaultVariant) {
    dc.error(
      "missing-style-default",
      `Theme package style "${ref}" is missing the "default" variant`,
      {
        path: `styles.${ref}.default`,
        action: { type: "replace-style-ref" },
        details: { styleRef: ref },
      },
    );
    return { style: {}, diagnostics: dc.diagnostics };
  }

  let resolved: StyleObject = { ...defaultVariant };

  // 2. Apply requested variant (falls back to default with warning)
  if (variant && variant !== "default") {
    const requestedVariant = refStyles[variant];
    if (!requestedVariant) {
      dc.warning(
        "missing-style-variant",
        `Style variant "${variant}" for ref "${ref}" is absent; using "default"`,
        {
          path: `styles.${ref}.${variant}`,
          action: { type: "replace-style-ref" },
          details: { styleRef: ref },
        },
      );
    } else {
      resolved = mergeStylePatchDeep(resolved, requestedVariant as StylePatch, {
        skipUndefined: true,
      }) as StyleObject;
    }
  }

  // 3. Apply deck-level overrides
  const deckOverrides = themeBinding.overrides?.styles?.[ref];
  if (deckOverrides) {
    const variantOverride = variant ? deckOverrides[variant] : undefined;
    const defaultOverride = deckOverrides["default"];
    if (defaultOverride) {
      resolved = mergeStylePatchDeep(resolved, defaultOverride as StylePatch, {
        skipUndefined: true,
      }) as StyleObject;
    }
    if (variantOverride && variantOverride !== defaultOverride) {
      resolved = mergeStylePatchDeep(resolved, variantOverride as StylePatch, {
        skipUndefined: true,
      }) as StyleObject;
    }
  }

  // 4. Apply local style override
  if (localStyle) {
    resolved = mergeStylePatchDeep(resolved, localStyle, {
      skipUndefined: true,
    }) as StyleObject;
    if (Object.keys(localStyle).length > 0) {
      dc.info(
        "local-style-overrides",
        `Node has local style overrides on "${ref}"`,
      );
    }
  }

  // 5. Resolve tokens
  const resolvedWithTokens = resolveTokensInStyle(
    resolved,
    resolveTheme(pkg, themeBinding).tokens,
    dc,
    ref,
  );

  return { style: resolvedWithTokens, diagnostics: dc.diagnostics };
}

/** Resolves the background slide style for a slide node. */
export type ResolvedTheme = {
  tokens: ThemeTokens;
  packageId: string;
  packageVersion?: string;
};

export function resolveTheme(
  pkg: ThemePackageV1,
  themeBinding: DeckThemeBinding,
): ResolvedTheme {
  // Merge deck token overrides on top of package tokens
  const tokens: ThemeTokens = themeBinding.overrides?.tokens
    ? (deepMerge(pkg.tokens, themeBinding.overrides.tokens) as ThemeTokens)
    : pkg.tokens;

  return {
    tokens,
    packageId: pkg.id,
    packageVersion: pkg.version,
  };
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (isPlainObject(v) && isPlainObject(base[k])) {
      result[k] = deepMerge(base[k] as Record<string, unknown>, v);
    } else {
      result[k] = v;
    }
  }
  return result;
}
