import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resetPresentationThemeOverrides,
  updatePresentationThemeOverrides,
} from "./presentation-theme-overrides";
import { makeDeck, makeSlide } from "./deck-mutation-test-fixtures";
import { DEFAULT_TOKEN_SET } from "./presentation-theme-data";
import { resolveRoleToken } from "./presentation-theme-resolvers";
import type { Deck } from "./deck-core";

function deckWithTheme(themeId: string, overrides: Partial<Deck> = {}): Deck {
  return makeDeck([makeSlide()], { design: { themeId }, ...overrides });
}

// ---------------------------------------------------------------------------
// updatePresentationThemeOverrides — materialization and immutability
// ---------------------------------------------------------------------------

test("updatePresentationThemeOverrides materializes a custom token set from the current theme when none exists", () => {
  const deck = deckWithTheme("ocean");
  const next = updatePresentationThemeOverrides(deck, {
    colors: { accent: "#ff0000" },
  });
  const tokenSet = next.design?.themeOverrides
    ?.tokenSet as typeof DEFAULT_TOKEN_SET;
  assert.equal(tokenSet.id, "custom:ocean");
  assert.equal(tokenSet.name, "Custom (ocean)");
  assert.equal(tokenSet.colors.accent, "#ff0000");
  // Untouched color fields carry over from the resolved base theme.
  assert.equal(tokenSet.colors.onBg, "#0c4a6e");
});

test("updatePresentationThemeOverrides does not mutate the input deck (immutable)", () => {
  const deck = deckWithTheme("ocean");
  const originalDesign = deck.design;
  const next = updatePresentationThemeOverrides(deck, {
    colors: { accent: "#ff0000" },
  });
  assert.notEqual(next, deck);
  assert.equal(deck.design, originalDesign);
  assert.equal(deck.design?.themeOverrides, undefined);
});

test("updatePresentationThemeOverrides shallow-merges colors over the existing custom token set", () => {
  const deck = deckWithTheme("ocean");
  const first = updatePresentationThemeOverrides(deck, {
    colors: { accent: "#111111" },
  });
  const second = updatePresentationThemeOverrides(first, {
    colors: { onBg: "#222222" },
  });
  const tokenSet = second.design?.themeOverrides
    ?.tokenSet as typeof DEFAULT_TOKEN_SET;
  // Both edits persist: colors merge rather than replace wholesale.
  assert.equal(tokenSet.colors.accent, "#111111");
  assert.equal(tokenSet.colors.onBg, "#222222");
});

test("updatePresentationThemeOverrides patches fontFamily/headingFontFamily independently", () => {
  const deck = deckWithTheme("default");
  const next = updatePresentationThemeOverrides(deck, {
    typography: { fontFamily: "Custom Sans, sans-serif" },
  });
  const tokenSet = next.design?.themeOverrides
    ?.tokenSet as typeof DEFAULT_TOKEN_SET;
  assert.equal(tokenSet.typography.fontFamily, "Custom Sans, sans-serif");
  assert.equal(tokenSet.typography.headingFontFamily, undefined);

  const withHeading = updatePresentationThemeOverrides(next, {
    typography: { headingFontFamily: "Custom Display" },
  });
  const tokenSet2 = withHeading.design?.themeOverrides
    ?.tokenSet as typeof DEFAULT_TOKEN_SET;
  assert.equal(tokenSet2.typography.fontFamily, "Custom Sans, sans-serif");
  assert.equal(tokenSet2.typography.headingFontFamily, "Custom Display");
});

test("updatePresentationThemeOverrides merges a role-token patch over the resolved role default", () => {
  const deck = deckWithTheme("default");
  const next = updatePresentationThemeOverrides(deck, {
    typography: { roles: { title: { fontSize: 55 } } },
  });
  const tokenSet = next.design?.themeOverrides
    ?.tokenSet as typeof DEFAULT_TOKEN_SET;
  const titleRole = tokenSet.typography.roles?.title;
  assert.equal(titleRole?.fontSize, 55);
  // The rest of the role token is filled in from the resolved default so a
  // partial edit still yields complete typography.
  const derivedDefault = resolveRoleToken(DEFAULT_TOKEN_SET, "title");
  assert.equal(titleRole?.color, derivedDefault.color);
  assert.equal(titleRole?.weight, derivedDefault.weight);
});

test("updatePresentationThemeOverrides preserves previously authored roles not touched by this patch", () => {
  const deck = deckWithTheme("default");
  const first = updatePresentationThemeOverrides(deck, {
    typography: { roles: { title: { fontSize: 55 } } },
  });
  const second = updatePresentationThemeOverrides(first, {
    typography: { roles: { body: { fontSize: 18 } } },
  });
  const tokenSet = second.design?.themeOverrides
    ?.tokenSet as typeof DEFAULT_TOKEN_SET;
  assert.equal(tokenSet.typography.roles?.title?.fontSize, 55);
  assert.equal(tokenSet.typography.roles?.body?.fontSize, 18);
});

test("updatePresentationThemeOverrides patches defaultBackground, bullet, connector, image, and visual defaults", () => {
  const deck = deckWithTheme("default");
  const next = updatePresentationThemeOverrides(deck, {
    defaultBackground: { type: "solid", color: "#101010" },
    bullet: { gapPct: 8 },
    connector: { width: 2 },
    image: { shadow: true },
    visual: { transparentBackground: true },
  });
  const tokenSet = next.design?.themeOverrides
    ?.tokenSet as typeof DEFAULT_TOKEN_SET;
  assert.deepEqual(tokenSet.defaultBackground, {
    type: "solid",
    color: "#101010",
  });
  assert.equal(tokenSet.bullet?.gapPct, 8);
  assert.equal(tokenSet.connector?.width, 2);
  assert.equal(tokenSet.image?.shadow, true);
  assert.equal(tokenSet.visual?.transparentBackground, true);
});

test("updatePresentationThemeOverrides materializes the base theme unchanged when the patch omits every field", () => {
  const deck = deckWithTheme("ocean");
  const next = updatePresentationThemeOverrides(deck, {});
  const tokenSet = next.design?.themeOverrides
    ?.tokenSet as typeof DEFAULT_TOKEN_SET;
  assert.equal(tokenSet.id, "custom:ocean");
  assert.equal(tokenSet.colors.accent, "#0284c7");
});

test("updatePresentationThemeOverrides preserves other design fields on the deck", () => {
  const deck = deckWithTheme("ocean", {
    design: { themeId: "ocean", extra: "kept" },
  });
  const next = updatePresentationThemeOverrides(deck, {
    colors: { accent: "#fff" },
  });
  assert.equal((next.design as Record<string, unknown>).extra, "kept");
  assert.equal(next.design?.themeId, "ocean");
});

// ---------------------------------------------------------------------------
// resetPresentationThemeOverrides — removal and fallback to the theme package
// ---------------------------------------------------------------------------

test("resetPresentationThemeOverrides is a no-op (returns the same deck) when there is no token set to remove", () => {
  const deck = deckWithTheme("indigo");
  const next = resetPresentationThemeOverrides(deck);
  assert.equal(next, deck);
});

test("resetPresentationThemeOverrides removes an existing token set override for a theme id with no matching theme package", () => {
  const deck = deckWithTheme("indigo");
  const withOverride = updatePresentationThemeOverrides(deck, {
    colors: { accent: "#fff" },
  });
  const reset = resetPresentationThemeOverrides(withOverride);
  assert.equal("tokenSet" in (reset.design?.themeOverrides ?? {}), false);
});

test("resetPresentationThemeOverrides drops the themeOverrides object entirely when it becomes empty", () => {
  const deck = deckWithTheme("indigo");
  const withOverride = updatePresentationThemeOverrides(deck, {
    colors: { accent: "#fff" },
  });
  const reset = resetPresentationThemeOverrides(withOverride);
  assert.equal(reset.design?.themeOverrides, undefined);
});

test("resetPresentationThemeOverrides re-installs the matching theme package's own token set when themeId collides with a built-in theme package id", async () => {
  const { getThemePackage } = await import("./theme-packages");
  const deck = deckWithTheme("ocean");
  const withOverride = updatePresentationThemeOverrides(deck, {
    colors: { accent: "#fff" },
  });
  const reset = resetPresentationThemeOverrides(withOverride);
  const packageTokenSet = getThemePackage("ocean")?.tokenSet;
  assert.equal(reset.design?.themeOverrides?.tokenSet, packageTokenSet);
  // The package token set differs from the plain presentation-theme "ocean" set.
  assert.notEqual(
    (reset.design?.themeOverrides?.tokenSet as typeof DEFAULT_TOKEN_SET).name,
    "Ocean",
  );
});

test("resetPresentationThemeOverrides preserves sibling themeOverrides fields alongside removing tokenSet", () => {
  const deck: Deck = makeDeck([makeSlide()], {
    design: {
      themeId: "indigo",
      themeOverrides: { tokenSet: DEFAULT_TOKEN_SET, otherField: "kept" },
    },
  });
  const reset = resetPresentationThemeOverrides(deck);
  assert.equal(
    (reset.design?.themeOverrides as Record<string, unknown> | undefined)
      ?.otherField,
    "kept",
  );
  assert.equal("tokenSet" in (reset.design?.themeOverrides ?? {}), false);
});

test("resetPresentationThemeOverrides does not mutate the input deck (immutable)", () => {
  const deck = deckWithTheme("ocean");
  const withOverride = updatePresentationThemeOverrides(deck, {
    colors: { accent: "#fff" },
  });
  const frozenThemeOverrides = { ...withOverride.design?.themeOverrides };
  resetPresentationThemeOverrides(withOverride);
  assert.deepEqual(withOverride.design?.themeOverrides, frozenThemeOverrides);
});

test("resetPresentationThemeOverrides is a no-op when design is entirely absent, even though themeId would resolve to default", () => {
  const deck = makeDeck([makeSlide()]);
  const next = resetPresentationThemeOverrides(deck);
  // No token set exists to remove, so the function returns the original deck
  // unchanged rather than materializing a design object.
  assert.equal(next, deck);
  assert.equal(next.design, undefined);
});

test("resetPresentationThemeOverrides derives design.themeId via resolvePresentationThemeId when the design is missing an explicit themeId", () => {
  const malformedDesign = {
    themeOverrides: { tokenSet: { ...DEFAULT_TOKEN_SET, id: "indigo" } },
  } as unknown as Deck["design"];
  const deck: Deck = makeDeck([makeSlide()], { design: malformedDesign });
  const reset = resetPresentationThemeOverrides(deck);
  // themeId falls back to the (soon-to-be-removed) override token set's id
  // since the design carried no explicit themeId of its own.
  assert.equal(reset.design?.themeId, "indigo");
  assert.equal("tokenSet" in (reset.design?.themeOverrides ?? {}), false);
});
