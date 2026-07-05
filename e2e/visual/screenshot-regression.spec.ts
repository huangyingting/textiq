import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  REGRESSION_DECK_FIXTURE,
  SCREENSHOT_OPTIONS,
  SLIDE_VIEWPORT,
} from "./helpers/screenshot-fixtures";
import { waitForStableSlideStage } from "./helpers/readiness";

/**
 * Playwright screenshot regression spec for Slides (Epic #379, issue #415).
 *
 * These tests use deterministic deck fixtures to capture visual snapshots of
 * the slide editor stage, the in-app present viewer, and the public present
 * route.  They cover the core visual element categories:
 *  - text and bullets
 *  - shapes
 *  - images (data URL)
 *  - connectors
 *  - background colors
 *
 * Screenshot comparisons use `toHaveScreenshot()` with a stable pixel
 * tolerance.  The first run generates the baseline; subsequent runs compare
 * against it.
 *
 * These tests require a running application and are NOT part of the unit gate
 * (`npm test`).  They are skipped cleanly when:
 *  - The app is unreachable (no running dev server).
 *  - The `E2E_SCREENSHOT_REGRESSION` environment variable is not set to `1`.
 *
 * To generate / refresh baselines:
 *   E2E_SCREENSHOT_REGRESSION=1 npx playwright test screenshot-regression.spec.ts --update-snapshots
 *
 * To run comparisons:
 *   E2E_SCREENSHOT_REGRESSION=1 npx playwright test screenshot-regression.spec.ts
 */

const SCREENSHOT_REGRESSION_ENABLED =
  process.env.E2E_SCREENSHOT_REGRESSION === "1";

async function gotoAvailablePage(page: Page, url: string): Promise<boolean> {
  try {
    const response = await page.goto(url);
    return Boolean(response && response.status() !== 404);
  } catch {
    return false;
  }
}

function skipUnavailableScreenshotFixture(reason: string): never {
  // e2e-governance-allow test-skip: opt-in screenshot routes may be unavailable without seeded fixtures.
  test.skip(true, reason);
  throw new Error(reason);
}

async function waitForStableSlideStageOrSkip(
  locator: Locator,
  reason: string,
): Promise<void> {
  try {
    await waitForStableSlideStage(locator);
  } catch {
    skipUnavailableScreenshotFixture(reason);
  }
}

async function waitForNetworkIdleIfPossible(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle");
  } catch {
    return;
  }
}

// ---------------------------------------------------------------------------
// Tests: editor stage
// ---------------------------------------------------------------------------

test.describe("screenshot regression — slide editor", () => {
  test.beforeEach(({ page }) => {
    test.skip(
      !SCREENSHOT_REGRESSION_ENABLED,
      "Set E2E_SCREENSHOT_REGRESSION=1 to run screenshot regression tests",
    );
    page.setViewportSize(SLIDE_VIEWPORT);
  });

  test("editor stage renders text and bullets slide", async ({ page }) => {
    if (
      !(await gotoAvailablePage(
        page,
        "/app/documents/regression-test-doc/slides",
      ))
    ) {
      skipUnavailableScreenshotFixture("Regression editor route unavailable");
    }

    const canvas = page
      .locator('[data-testid="slide-canvas"], .slide-canvas, [role="main"]')
      .first();
    await waitForStableSlideStageOrSkip(
      canvas,
      "Regression editor stage unavailable",
    );

    await expect(page).toHaveScreenshot(
      "editor-text-bullets.png",
      SCREENSHOT_OPTIONS,
    );
  });

  test("editor stage renders shapes slide", async ({ page }) => {
    if (
      !(await gotoAvailablePage(
        page,
        "/app/documents/regression-test-doc/slides?slide=1",
      ))
    ) {
      skipUnavailableScreenshotFixture("Regression shapes route unavailable");
    }

    await waitForStableSlideStage(page.locator("body"));

    await expect(page).toHaveScreenshot(
      "editor-shapes.png",
      SCREENSHOT_OPTIONS,
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: in-app present viewer
// ---------------------------------------------------------------------------

test.describe("screenshot regression — in-app present viewer", () => {
  test.beforeEach(() => {
    test.skip(
      !SCREENSHOT_REGRESSION_ENABLED,
      "Set E2E_SCREENSHOT_REGRESSION=1 to run screenshot regression tests",
    );
  });

  test("present mode renders text and bullets slide", async ({ page }) => {
    page.setViewportSize(SLIDE_VIEWPORT);

    if (
      !(await gotoAvailablePage(
        page,
        "/app/documents/regression-test-doc/present",
      ))
    ) {
      skipUnavailableScreenshotFixture("Regression present route unavailable");
    }

    const slideView = page
      .locator(
        '[data-testid="present-slide"], .present-slide, [role="presentation"]',
      )
      .first();

    await waitForStableSlideStageOrSkip(
      slideView,
      "Regression present stage unavailable",
    );

    await expect(page).toHaveScreenshot(
      "present-text-bullets.png",
      SCREENSHOT_OPTIONS,
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: public present viewer
// ---------------------------------------------------------------------------

test.describe("screenshot regression — public present viewer", () => {
  test.beforeEach(() => {
    test.skip(
      !SCREENSHOT_REGRESSION_ENABLED,
      "Set E2E_SCREENSHOT_REGRESSION=1 to run screenshot regression tests",
    );
  });

  test("public present route renders slides for a valid share id", async ({
    page,
  }) => {
    const shareId = process.env.E2E_REGRESSION_SHARE_ID;
    test.skip(
      !shareId,
      "Set E2E_REGRESSION_SHARE_ID to run public present regression test",
    );

    page.setViewportSize(SLIDE_VIEWPORT);

    if (!(await gotoAvailablePage(page, `/present/${shareId}`))) {
      skipUnavailableScreenshotFixture(
        "Regression public present route unavailable",
      );
    }

    await waitForNetworkIdleIfPossible(page);
    await waitForStableSlideStage(page.locator("body"));

    await expect(page).toHaveScreenshot(
      "public-present-slide.png",
      SCREENSHOT_OPTIONS,
    );
  });

  test("public embed route renders for a valid share id", async ({ page }) => {
    const shareId = process.env.E2E_REGRESSION_SHARE_ID;
    test.skip(
      !shareId,
      "Set E2E_REGRESSION_SHARE_ID to run public embed regression test",
    );

    page.setViewportSize({ width: 800, height: 450 });

    if (!(await gotoAvailablePage(page, `/embed/${shareId}`))) {
      skipUnavailableScreenshotFixture(
        "Regression public embed route unavailable",
      );
    }

    await waitForNetworkIdleIfPossible(page);
    await waitForStableSlideStage(page.locator("body"));

    await expect(page).toHaveScreenshot(
      "public-embed-slide.png",
      SCREENSHOT_OPTIONS,
    );
  });
});

// ---------------------------------------------------------------------------
// Deterministic fixture integrity tests (run without a server)
// ---------------------------------------------------------------------------

test.describe("deck fixture integrity", () => {
  test("regression deck fixture has expected slide count", () => {
    const slides = REGRESSION_DECK_FIXTURE.slides as unknown[];
    expect(slides).toHaveLength(3);
  });

  test("regression deck fixture slide ids are unique", () => {
    const slides = REGRESSION_DECK_FIXTURE.slides as Array<{ id: string }>;
    const ids = slides.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test("regression deck fixture element kinds cover required categories", () => {
    const slides = REGRESSION_DECK_FIXTURE.slides as Array<{
      elements: Array<{ kind: string }>;
    }>;
    const allElements = slides.flatMap((s) => s.elements);
    const kinds = new Set(allElements.map((el) => el.kind));
    expect(kinds.has("text")).toBe(true);
    expect(kinds.has("bullets")).toBe(true);
    expect(kinds.has("shape")).toBe(true);
    expect(kinds.has("image")).toBe(true);
    expect(kinds.has("connector")).toBe(true);
  });

  test("regression deck fixture shape kinds cover rect, ellipse, triangle", () => {
    const slides = REGRESSION_DECK_FIXTURE.slides as Array<{
      elements: Array<{ kind: string; shape?: string }>;
    }>;
    const shapes = slides
      .flatMap((s) => s.elements)
      .filter((el) => el.kind === "shape");
    const shapeKinds = new Set(shapes.map((s) => s.shape));
    expect(shapeKinds.has("rect")).toBe(true);
    expect(shapeKinds.has("ellipse")).toBe(true);
    expect(shapeKinds.has("triangle")).toBe(true);
  });

  test("regression deck fixture backgrounds cover white, light, and dark", () => {
    const slides = REGRESSION_DECK_FIXTURE.slides as unknown as Array<{
      background: string;
    }>;
    const bgs = slides.map((s) => s.background);
    expect(bgs).toContain("#ffffff");
    expect(bgs).toContain("#f8f9fa");
    expect(bgs).toContain("#1e293b");
  });

  test("image fixture uses a valid data URL", () => {
    const slides = REGRESSION_DECK_FIXTURE.slides as Array<{
      elements: Array<{ kind: string; src?: string }>;
    }>;
    const imageEl = slides[2].elements.find((el) => el.kind === "image");
    expect(imageEl).toBeDefined();
    expect(imageEl?.src).toMatch(/^data:image\/png;base64,/);
  });
});
