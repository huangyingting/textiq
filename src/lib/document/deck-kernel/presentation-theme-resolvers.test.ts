import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allThemeTokenSets,
  backgroundTreatmentToCss,
  deriveRoleToken,
  isBuiltInTheme,
  isPresentationRole,
  resolveBulletDefaults,
  resolveConnectorDefaults,
  resolveImageDefaults,
  resolvePresentationThemeId,
  resolvePresentationThemeTokens,
  resolveRoleToken,
  resolveSlideBackground,
  resolveThemeTokens,
  resolveVisualDefaults,
} from "./presentation-theme-resolvers";
import {
  BUILT_IN_TOKEN_SETS,
  DEFAULT_TOKEN_SET,
} from "./presentation-theme-data";
import type { PresentationTheme } from "./presentation-theme-types";

const INDIGO_THEME = BUILT_IN_TOKEN_SETS.find((ts) => ts.id === "indigo")!;
const OCEAN_THEME = BUILT_IN_TOKEN_SETS.find((ts) => ts.id === "ocean")!;

// ---------------------------------------------------------------------------
// isPresentationRole
// ---------------------------------------------------------------------------

test("isPresentationRole accepts every canonical role", () => {
  for (const role of [
    "title",
    "subtitle",
    "sectionTitle",
    "body",
    "bullet",
    "quote",
    "caption",
    "footer",
    "label",
    "media",
    "visual",
    "image",
    "table",
    "logo",
    "pageNumber",
    "background",
  ]) {
    assert.equal(isPresentationRole(role), true);
  }
});

test("isPresentationRole rejects unknown strings and non-strings", () => {
  assert.equal(isPresentationRole("unknown-role"), false);
  assert.equal(isPresentationRole(42), false);
  assert.equal(isPresentationRole(undefined), false);
  assert.equal(isPresentationRole(null), false);
});

// ---------------------------------------------------------------------------
// resolveThemeTokens
// ---------------------------------------------------------------------------

test("resolveThemeTokens returns the matching built-in token set", () => {
  assert.equal(resolveThemeTokens("indigo"), INDIGO_THEME);
});

test("resolveThemeTokens falls back to the default set for unknown ids", () => {
  assert.equal(resolveThemeTokens("not-a-real-theme"), DEFAULT_TOKEN_SET);
});

test("resolveThemeTokens falls back to the default set for absent ids", () => {
  assert.equal(resolveThemeTokens(undefined), DEFAULT_TOKEN_SET);
  assert.equal(resolveThemeTokens(null), DEFAULT_TOKEN_SET);
  assert.equal(resolveThemeTokens(""), DEFAULT_TOKEN_SET);
});

// ---------------------------------------------------------------------------
// resolvePresentationThemeId — three-level fallback precedence
// ---------------------------------------------------------------------------

test("resolvePresentationThemeId prefers the override token set id first", () => {
  const id = resolvePresentationThemeId({
    design: {
      themeId: "ocean",
      themeOverrides: { tokenSet: { ...INDIGO_THEME, id: "custom:ocean" } },
    },
  });
  assert.equal(id, "custom:ocean");
});

test("resolvePresentationThemeId falls back to design.themeId when no override token set", () => {
  const id = resolvePresentationThemeId({ design: { themeId: "forest" } });
  assert.equal(id, "forest");
});

test("resolvePresentationThemeId falls back to the default id when source is empty", () => {
  assert.equal(resolvePresentationThemeId({}), DEFAULT_TOKEN_SET.id);
  assert.equal(
    resolvePresentationThemeId({ design: {} }),
    DEFAULT_TOKEN_SET.id,
  );
});

// ---------------------------------------------------------------------------
// resolvePresentationThemeTokens
// ---------------------------------------------------------------------------

test("resolvePresentationThemeTokens prefers a custom override token set over the named theme", () => {
  const customTokenSet: PresentationTheme = { ...INDIGO_THEME, id: "custom:x" };
  const tokens = resolvePresentationThemeTokens({
    design: { themeId: "ocean", themeOverrides: { tokenSet: customTokenSet } },
  });
  assert.equal(tokens, customTokenSet);
});

test("resolvePresentationThemeTokens resolves the named built-in theme when no override exists", () => {
  const tokens = resolvePresentationThemeTokens({
    design: { themeId: "ocean" },
  });
  assert.equal(tokens, OCEAN_THEME);
});

test("resolvePresentationThemeTokens falls back to default tokens for an unrecognised theme id", () => {
  const tokens = resolvePresentationThemeTokens({
    design: { themeId: "not-real" },
  });
  assert.equal(tokens, DEFAULT_TOKEN_SET);
});

// ---------------------------------------------------------------------------
// resolveSlideBackground — cascade order
// ---------------------------------------------------------------------------

test("resolveSlideBackground prioritizes an explicit slide background image", () => {
  const bg = resolveSlideBackground(DEFAULT_TOKEN_SET, {
    slideBackgroundImage: "https://example.com/bg.png",
    slideBackgroundGradient: { from: "#000", to: "#fff" },
    slideBackground: "#123456",
    masterBackground: { type: "solid", color: "#abcdef" },
  });
  assert.deepEqual(bg, { type: "image", url: "https://example.com/bg.png" });
});

test("resolveSlideBackground prefers a slide gradient over solid/master when no image", () => {
  const bg = resolveSlideBackground(DEFAULT_TOKEN_SET, {
    slideBackgroundGradient: { from: "#000", to: "#fff", angle: 45 },
    slideBackground: "#123456",
    masterBackground: { type: "solid", color: "#abcdef" },
  });
  assert.deepEqual(bg, {
    type: "gradient",
    from: "#000",
    to: "#fff",
    angle: 45,
  });
});

test("resolveSlideBackground prefers a slide solid color over the master background", () => {
  const bg = resolveSlideBackground(DEFAULT_TOKEN_SET, {
    slideBackground: "#123456",
    masterBackground: { type: "solid", color: "#abcdef" },
  });
  assert.deepEqual(bg, { type: "solid", color: "#123456" });
});

test("resolveSlideBackground falls back to the master background when no slide override exists", () => {
  const bg = resolveSlideBackground(DEFAULT_TOKEN_SET, {
    masterBackground: { type: "solid", color: "#abcdef" },
  });
  assert.deepEqual(bg, { type: "solid", color: "#abcdef" });
});

test("resolveSlideBackground falls back to the theme default background when nothing else is set", () => {
  const bg = resolveSlideBackground(DEFAULT_TOKEN_SET, {});
  assert.deepEqual(bg, DEFAULT_TOKEN_SET.defaultBackground);
});

test("resolveSlideBackground falls back to the theme default background with no options object", () => {
  const bg = resolveSlideBackground(DEFAULT_TOKEN_SET);
  assert.deepEqual(bg, DEFAULT_TOKEN_SET.defaultBackground);
});

// ---------------------------------------------------------------------------
// backgroundTreatmentToCss — every union member
// ---------------------------------------------------------------------------

test("backgroundTreatmentToCss renders a solid color as-is", () => {
  assert.equal(
    backgroundTreatmentToCss({ type: "solid", color: "#112233" }),
    "#112233",
  );
});

test("backgroundTreatmentToCss renders a linear gradient from/to with the default angle", () => {
  const css = backgroundTreatmentToCss({
    type: "gradient",
    from: "#000",
    to: "#fff",
  });
  assert.equal(css, "linear-gradient(135deg, #000, #fff)");
});

test("backgroundTreatmentToCss renders a linear gradient with an explicit angle", () => {
  const css = backgroundTreatmentToCss({
    type: "gradient",
    from: "#000",
    to: "#fff",
    angle: 90,
  });
  assert.equal(css, "linear-gradient(90deg, #000, #fff)");
});

test("backgroundTreatmentToCss renders a linear gradient from explicit stops when present", () => {
  const css = backgroundTreatmentToCss({
    type: "gradient",
    from: "#000",
    to: "#fff",
    stops: [{ color: "#111", offset: 0 }, { color: "#222" }],
  });
  assert.equal(css, "linear-gradient(135deg, #111 0%, #222)");
});

test("backgroundTreatmentToCss renders a radial gradient with defaults when inner/outer only", () => {
  const css = backgroundTreatmentToCss({
    type: "radialGradient",
    inner: "#000",
    outer: "#fff",
  });
  assert.equal(css, "radial-gradient(70% 70% at 50% 50%, #000, #fff)");
});

test("backgroundTreatmentToCss renders a radial gradient using `r` for both radii when rx/ry absent", () => {
  const css = backgroundTreatmentToCss({
    type: "radialGradient",
    inner: "#000",
    outer: "#fff",
    r: 40,
    cx: 20,
    cy: 30,
  });
  assert.equal(css, "radial-gradient(40% 40% at 20% 30%, #000, #fff)");
});

test("backgroundTreatmentToCss renders a radial gradient from explicit stops when present", () => {
  const css = backgroundTreatmentToCss({
    type: "radialGradient",
    inner: "#000",
    outer: "#fff",
    stops: [{ color: "#333" }, { color: "#444", offset: 80 }],
  });
  assert.equal(css, "radial-gradient(70% 70% at 50% 50%, #333, #444 80%)");
});

test("backgroundTreatmentToCss renders an image url with a JSON-escaped src", () => {
  const css = backgroundTreatmentToCss({
    type: "image",
    url: "https://a.com/x.png",
  });
  assert.equal(css, 'url("https://a.com/x.png") center / cover no-repeat');
});

// ---------------------------------------------------------------------------
// allThemeTokenSets / isBuiltInTheme
// ---------------------------------------------------------------------------

test("allThemeTokenSets returns every built-in token set as a fresh array", () => {
  const sets = allThemeTokenSets();
  assert.deepEqual(sets, [...BUILT_IN_TOKEN_SETS]);
  assert.notEqual(sets, BUILT_IN_TOKEN_SETS);
});

test("isBuiltInTheme is true only for registered built-in ids", () => {
  assert.equal(isBuiltInTheme("default"), true);
  assert.equal(isBuiltInTheme("indigo"), true);
  assert.equal(isBuiltInTheme("custom:indigo"), false);
  assert.equal(isBuiltInTheme("not-a-theme"), false);
});

// ---------------------------------------------------------------------------
// deriveRoleToken — heading vs body font stacks, footer/caption color
// ---------------------------------------------------------------------------

test("deriveRoleToken uses the heading font stack (with CJK fallback) for heading roles", () => {
  const token = deriveRoleToken(INDIGO_THEME, "title");
  assert.equal(
    token.fontFamily,
    "Space Grotesk, Inter, 'Noto Sans SC', ui-sans-serif, system-ui, sans-serif",
  );
  assert.equal(token.fontSize, INDIGO_THEME.typography.scale.h1);
  assert.equal(token.weight, 700);
  assert.equal(token.align, "center");
  assert.equal(token.color, INDIGO_THEME.colors.onBg);
});

test("deriveRoleToken falls back to the body font stack for headings when no heading font is set", () => {
  const token = deriveRoleToken(OCEAN_THEME, "title");
  assert.equal(
    token.fontFamily,
    "Avenir Next, Inter, 'Noto Sans SC', ui-sans-serif, system-ui, sans-serif",
  );
});

test("deriveRoleToken uses the body font stack for non-heading roles", () => {
  const token = deriveRoleToken(INDIGO_THEME, "body");
  assert.equal(
    token.fontFamily,
    "Inter, 'Noto Sans SC', ui-sans-serif, system-ui, sans-serif",
  );
  assert.equal(token.fontSize, INDIGO_THEME.typography.scale.body);
});

test("deriveRoleToken uses the muted color for footer and caption roles", () => {
  assert.equal(
    deriveRoleToken(DEFAULT_TOKEN_SET, "footer").color,
    DEFAULT_TOKEN_SET.colors.muted,
  );
  assert.equal(
    deriveRoleToken(DEFAULT_TOKEN_SET, "caption").color,
    DEFAULT_TOKEN_SET.colors.muted,
  );
});

test("deriveRoleToken uses onBg for every other role", () => {
  assert.equal(
    deriveRoleToken(DEFAULT_TOKEN_SET, "body").color,
    DEFAULT_TOKEN_SET.colors.onBg,
  );
  assert.equal(
    deriveRoleToken(DEFAULT_TOKEN_SET, "logo").color,
    DEFAULT_TOKEN_SET.colors.onBg,
  );
});

// ---------------------------------------------------------------------------
// resolveRoleToken — authored overrides merge over derived defaults
// ---------------------------------------------------------------------------

test("resolveRoleToken returns the fully derived token when no role is authored", () => {
  const token = resolveRoleToken(DEFAULT_TOKEN_SET, "title");
  assert.deepEqual(token, deriveRoleToken(DEFAULT_TOKEN_SET, "title"));
});

test("resolveRoleToken merges a partial authored token over the derived defaults", () => {
  const themed: PresentationTheme = {
    ...DEFAULT_TOKEN_SET,
    typography: {
      ...DEFAULT_TOKEN_SET.typography,
      roles: { title: { fontSize: 99, color: "#ff00ff", weight: 500 } },
    },
  };
  const token = resolveRoleToken(themed, "title");
  assert.equal(token.fontSize, 99);
  assert.equal(token.color, "#ff00ff");
  assert.equal(token.weight, 500);
  // Untouched fields still come from the derived default.
  assert.equal(token.align, "center");
});

test("resolveRoleToken re-applies the CJK fallback when the authored token supplies its own font stack", () => {
  const themed: PresentationTheme = {
    ...DEFAULT_TOKEN_SET,
    typography: {
      ...DEFAULT_TOKEN_SET.typography,
      roles: {
        title: {
          fontSize: 40,
          color: "#000",
          weight: 700,
          fontFamily: "Georgia, serif",
        },
      },
    },
  };
  const token = resolveRoleToken(themed, "title");
  assert.equal(token.fontFamily, "Georgia, 'Noto Sans SC', serif");
});

test("resolveRoleToken keeps the derived CJK-fallback font stack when the authored token omits fontFamily", () => {
  const themed: PresentationTheme = {
    ...DEFAULT_TOKEN_SET,
    typography: {
      ...DEFAULT_TOKEN_SET.typography,
      roles: { title: { fontSize: 40, color: "#000", weight: 700 } },
    },
  };
  const token = resolveRoleToken(themed, "title");
  assert.equal(
    token.fontFamily,
    deriveRoleToken(DEFAULT_TOKEN_SET, "title").fontFamily,
  );
});

// ---------------------------------------------------------------------------
// resolveBulletDefaults / resolveConnectorDefaults / resolveImageDefaults /
// resolveVisualDefaults — deterministic fallbacks and full overrides
// ---------------------------------------------------------------------------

test("resolveBulletDefaults falls back to accent color and zero/decimal defaults when absent", () => {
  const defaults = resolveBulletDefaults(DEFAULT_TOKEN_SET);
  assert.deepEqual(defaults, {
    markerColor: DEFAULT_TOKEN_SET.colors.accent,
    gapPct: 0,
    indentPct: 0,
    numberStyle: "decimal",
  });
});

test("resolveBulletDefaults honors an explicit partial bullet token", () => {
  const themed: PresentationTheme = {
    ...DEFAULT_TOKEN_SET,
    bullet: { gapPct: 5 },
  };
  const defaults = resolveBulletDefaults(themed);
  assert.equal(defaults.gapPct, 5);
  assert.equal(defaults.markerColor, DEFAULT_TOKEN_SET.colors.accent);
});

test("resolveConnectorDefaults falls back to onBg color, 0.4 width, solid dash, none/arrow ends", () => {
  const defaults = resolveConnectorDefaults(DEFAULT_TOKEN_SET);
  assert.deepEqual(defaults, {
    color: DEFAULT_TOKEN_SET.colors.onBg,
    width: 0.4,
    dash: "solid",
    startArrow: "none",
    endArrow: "arrow",
  });
});

test("resolveConnectorDefaults honors a full explicit connector token", () => {
  const themed: PresentationTheme = {
    ...DEFAULT_TOKEN_SET,
    connector: {
      color: "#abc",
      width: 1.2,
      dash: "dashed",
      startArrow: "arrow",
      endArrow: "none",
    },
  };
  assert.deepEqual(resolveConnectorDefaults(themed), {
    color: "#abc",
    width: 1.2,
    dash: "dashed",
    startArrow: "arrow",
    endArrow: "none",
  });
});

test("resolveImageDefaults falls back to contain/0/none/false when absent", () => {
  assert.deepEqual(resolveImageDefaults(DEFAULT_TOKEN_SET), {
    fitMode: "contain",
    radiusPct: 0,
    maskShape: "none",
    shadow: false,
  });
});

test("resolveImageDefaults honors explicit image token fields", () => {
  const themed: PresentationTheme = {
    ...DEFAULT_TOKEN_SET,
    image: {
      fitMode: "cover",
      radiusPct: 12,
      maskShape: "circle",
      shadow: true,
    },
  };
  assert.deepEqual(resolveImageDefaults(themed), {
    fitMode: "cover",
    radiusPct: 12,
    maskShape: "circle",
    shadow: true,
  });
});

test("resolveVisualDefaults falls back to transparentBackground=false and omits styleThemeId when absent", () => {
  const defaults = resolveVisualDefaults(DEFAULT_TOKEN_SET);
  assert.deepEqual(defaults, { transparentBackground: false });
  assert.equal("styleThemeId" in defaults, false);
});

test("resolveVisualDefaults includes styleThemeId when explicitly set", () => {
  const themed: PresentationTheme = {
    ...DEFAULT_TOKEN_SET,
    visual: { styleThemeId: "ocean", transparentBackground: true },
  };
  assert.deepEqual(resolveVisualDefaults(themed), {
    styleThemeId: "ocean",
    transparentBackground: true,
  });
});
