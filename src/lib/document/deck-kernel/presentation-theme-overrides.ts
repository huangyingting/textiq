import type { Deck } from "./deck-core";
import type {
  BackgroundTreatment,
  BulletDefaultsToken,
  ColorToken,
  ConnectorDefaultsToken,
  PresentationRole,
  PresentationTheme,
  ImageDefaultsToken,
  PresentationRoleToken,
  PresentationRoleTokenMap,
  VisualDefaultsToken,
} from "./presentation-theme-types";
import {
  resolvePresentationThemeId,
  resolvePresentationThemeTokens,
  resolveRoleToken,
} from "./presentation-theme-resolvers";
import { getThemePackage } from "./theme-packages";

/**
 * Structured patch for editing the global presentation theme (#614). Every field is
 * optional and shallow-merges over the current (or theme-materialised) token
 * set. Role-token patches merge over the *resolved* role token so a partial
 * edit still yields complete typography.
 */
export interface PresentationThemeOverridesPatch {
  colors?: Partial<ColorToken>;
  typography?: {
    fontFamily?: string;
    headingFontFamily?: string;
    roles?: Partial<Record<PresentationRole, Partial<PresentationRoleToken>>>;
  };
  defaultBackground?: BackgroundTreatment;
  bullet?: Partial<BulletDefaultsToken>;
  connector?: Partial<ConnectorDefaultsToken>;
  image?: Partial<ImageDefaultsToken>;
  visual?: Partial<VisualDefaultsToken>;
}

function mergeRoleTokens(
  base: PresentationTheme,
  existing: PresentationRoleTokenMap | undefined,
  patchRoles: Partial<Record<PresentationRole, Partial<PresentationRoleToken>>>,
): PresentationRoleTokenMap {
  const out: PresentationRoleTokenMap = { ...(existing ?? {}) };
  for (const key of Object.keys(patchRoles) as PresentationRole[]) {
    const partial = patchRoles[key];
    if (!partial) continue;
    const baseToken = out[key] ?? resolveRoleToken(base, key);
    out[key] = { ...baseToken, ...partial };
  }
  return out;
}

/**
 * Applies a {@link PresentationThemeOverridesPatch} to the deck's global template (#614).
 * When the deck has no theme override token set yet, one is materialised from the
 * current theme's built-in token set first, so editing a template always
 * produces a complete, persistable set. Returns a new deck (immutable).
 */
export function updatePresentationThemeOverrides(
  deck: Deck,
  patch: PresentationThemeOverridesPatch,
): Deck {
  const themeId = resolvePresentationThemeId(deck);
  const existingTokenSet = (deck as any).design?.themeOverrides?.tokenSet as
    | PresentationTheme
    | undefined;
  const base: PresentationTheme = existingTokenSet ?? {
    ...resolvePresentationThemeTokens(deck),
    id: `custom:${themeId}`,
    name: `Custom (${themeId})`,
  };
  const next: PresentationTheme = {
    ...base,
    ...(patch.colors ? { colors: { ...base.colors, ...patch.colors } } : {}),
    ...(patch.typography
      ? {
          typography: {
            ...base.typography,
            ...(patch.typography.fontFamily !== undefined
              ? { fontFamily: patch.typography.fontFamily }
              : {}),
            ...(patch.typography.headingFontFamily !== undefined
              ? { headingFontFamily: patch.typography.headingFontFamily }
              : {}),
            ...(patch.typography.roles
              ? {
                  roles: mergeRoleTokens(
                    base,
                    base.typography.roles,
                    patch.typography.roles,
                  ),
                }
              : {}),
          },
        }
      : {}),
    ...(patch.defaultBackground
      ? { defaultBackground: patch.defaultBackground }
      : {}),
    ...(patch.bullet ? { bullet: { ...base.bullet, ...patch.bullet } } : {}),
    ...(patch.connector
      ? { connector: { ...base.connector, ...patch.connector } }
      : {}),
    ...(patch.image ? { image: { ...base.image, ...patch.image } } : {}),
    ...(patch.visual ? { visual: { ...base.visual, ...patch.visual } } : {}),
  };
  return {
    ...deck,
    design: {
      ...((deck as any).design ?? {}),
      themeOverrides: {
        ...((deck as any).design?.themeOverrides ?? {}),
        tokenSet: next,
      },
    },
  } as Deck;
}

/**
 * Removes the deck's theme override token set, resetting the global template back to the
 * built-in theme (#612 "reset to theme"). Returns a new deck (immutable).
 */
export function resetPresentationThemeOverrides(deck: Deck): Deck {
  const design = { ...((deck as any).design ?? {}) };
  const themeOverrides = { ...(design.themeOverrides ?? {}) };
  if (!("tokenSet" in themeOverrides)) return deck;
  delete (themeOverrides as { tokenSet?: unknown }).tokenSet;
  const packageTheme =
    typeof design.themeId === "string" ? getThemePackage(design.themeId) : null;
  if (packageTheme) {
    themeOverrides.tokenSet = packageTheme.tokenSet;
  }
  if (Object.keys(themeOverrides).length === 0) {
    delete (design as { themeOverrides?: unknown }).themeOverrides;
  } else {
    design.themeOverrides = themeOverrides;
  }
  return { ...deck, design } as Deck;
}
