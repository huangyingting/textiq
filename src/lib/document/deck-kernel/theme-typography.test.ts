import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_TYPOGRAPHY,
  THEME_TYPOGRAPHY,
  getThemeTypography,
  resolveBodyFont,
  resolveHeadingFont,
  roleStyle,
} from "./theme-typography";

// ---------------------------------------------------------------------------
// getThemeTypography — canonical resolution and unknown/absent fallback
// ---------------------------------------------------------------------------

test("getThemeTypography returns the named theme's typography for every built-in theme id", () => {
  for (const themeId of Object.keys(THEME_TYPOGRAPHY)) {
    assert.equal(getThemeTypography(themeId), THEME_TYPOGRAPHY[themeId]);
  }
});

test("getThemeTypography falls back to the default typography for an unknown theme id", () => {
  assert.equal(getThemeTypography("not-a-real-theme"), DEFAULT_TYPOGRAPHY);
});

test("getThemeTypography falls back to the default typography when themeId is absent", () => {
  assert.equal(getThemeTypography(undefined), DEFAULT_TYPOGRAPHY);
  assert.equal(getThemeTypography(), DEFAULT_TYPOGRAPHY);
});

test("getThemeTypography falls back to the default typography for an empty-string theme id", () => {
  // Falsy but non-undefined input exercises the ternary's falsy branch, not
  // the map-miss `??` fallback.
  assert.equal(getThemeTypography(""), DEFAULT_TYPOGRAPHY);
});

// ---------------------------------------------------------------------------
// resolveHeadingFont / resolveBodyFont
// ---------------------------------------------------------------------------

test("resolveHeadingFont returns the theme's dedicated heading font stack when set", () => {
  assert.equal(
    resolveHeadingFont(THEME_TYPOGRAPHY.indigo),
    THEME_TYPOGRAPHY.indigo.headingFontFamily,
  );
});

test("resolveHeadingFont falls back to the body font stack when no heading font is set", () => {
  assert.equal(THEME_TYPOGRAPHY.ocean.headingFontFamily, undefined);
  assert.equal(
    resolveHeadingFont(THEME_TYPOGRAPHY.ocean),
    THEME_TYPOGRAPHY.ocean.fontFamily,
  );
});

test("resolveBodyFont always returns the theme's body font stack, ignoring any heading font", () => {
  assert.equal(
    resolveBodyFont(THEME_TYPOGRAPHY.indigo),
    THEME_TYPOGRAPHY.indigo.fontFamily,
  );
  assert.equal(
    resolveBodyFont(THEME_TYPOGRAPHY.ocean),
    THEME_TYPOGRAPHY.ocean.fontFamily,
  );
});

// ---------------------------------------------------------------------------
// roleStyle — every semantic role plus the default fallback
// ---------------------------------------------------------------------------

test("roleStyle builds the title hint from the heading font and h1 scale, centered and bold", () => {
  const hint = roleStyle("title", THEME_TYPOGRAPHY.indigo);
  assert.deepEqual(hint, {
    fontFamily: THEME_TYPOGRAPHY.indigo.headingFontFamily,
    fontSize: THEME_TYPOGRAPHY.indigo.scale.h1,
    bold: true,
    align: "center",
  });
});

test("roleStyle builds the subtitle hint from the body font and h2 scale, centered and not bold", () => {
  const hint = roleStyle("subtitle", THEME_TYPOGRAPHY.default);
  assert.deepEqual(hint, {
    fontFamily: THEME_TYPOGRAPHY.default.fontFamily,
    fontSize: THEME_TYPOGRAPHY.default.scale.h2,
    align: "center",
  });
  assert.equal("bold" in hint, false);
});

test("roleStyle builds the body hint from the body font and list scale, left-aligned", () => {
  const hint = roleStyle("body", THEME_TYPOGRAPHY.default);
  assert.deepEqual(hint, {
    fontFamily: THEME_TYPOGRAPHY.default.fontFamily,
    fontSize: THEME_TYPOGRAPHY.default.scale.list,
    align: "left",
  });
});

test("roleStyle builds the visual hint from the heading font and h3 scale, centered and bold", () => {
  const hint = roleStyle("visual", THEME_TYPOGRAPHY.sunset);
  assert.deepEqual(hint, {
    fontFamily: resolveHeadingFont(THEME_TYPOGRAPHY.sunset),
    fontSize: THEME_TYPOGRAPHY.sunset.scale.h3,
    bold: true,
    align: "center",
  });
});

test("roleStyle builds the footer hint from the body font and footer scale, centered and not bold", () => {
  const hint = roleStyle("footer", THEME_TYPOGRAPHY.default);
  assert.deepEqual(hint, {
    fontFamily: THEME_TYPOGRAPHY.default.fontFamily,
    fontSize: THEME_TYPOGRAPHY.default.scale.footer,
    align: "center",
  });
});

test("roleStyle returns an empty hint for an unrecognised role (malformed input)", () => {
  const hint = roleStyle("not-a-role" as never, THEME_TYPOGRAPHY.default);
  assert.deepEqual(hint, {});
});

// ---------------------------------------------------------------------------
// Cross-theme consistency — every built-in theme yields well-formed,
// monotonically-scaled typography across all roles
// ---------------------------------------------------------------------------

test("every built-in theme's font scale is strictly decreasing from h1 through footer", () => {
  for (const [themeId, typography] of Object.entries(THEME_TYPOGRAPHY)) {
    const { h1, h2, h3, body, list, footer } = typography.scale;
    assert.ok(h1 > h2, `${themeId}: h1 should exceed h2`);
    assert.ok(h2 > h3, `${themeId}: h2 should exceed h3`);
    assert.ok(h3 > body, `${themeId}: h3 should exceed body`);
    assert.ok(body >= list, `${themeId}: body should be >= list`);
    assert.ok(list > footer, `${themeId}: list should exceed footer`);
  }
});

test("every built-in theme resolves a non-empty heading and body font stack via roleStyle", () => {
  for (const typography of Object.values(THEME_TYPOGRAPHY)) {
    for (const role of [
      "title",
      "subtitle",
      "body",
      "visual",
      "footer",
    ] as const) {
      const hint = roleStyle(role, typography);
      assert.ok(hint.fontFamily && hint.fontFamily.length > 0);
      assert.equal(typeof hint.fontSize, "number");
    }
  }
});
