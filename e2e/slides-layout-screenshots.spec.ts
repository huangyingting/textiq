import { expect, test, type Locator, type Page } from "@playwright/test";

import { login } from "./helpers/auth";
import {
  e2eProfileEnabled,
  profileLayoutDocPath,
  profileOwnerCredentials,
} from "./helpers/profile";

/**
 * Playwright layout screenshots for the presentation slide editor.
 *
 * Coverage:
 *  - desktop / tablet / mobile
 *  - rail visible / hidden
 *  - notes collapsed / expanded
 *  - right panel open with a selected node
 *
 * The deterministic profile fixture is the default source of truth. Under
 * `E2E_PROFILE=1` this suite is a hard gate: unavailable fixtures fail the run
 * instead of skipping silently.
 */

const PROFILE_LAYOUT_GATE = e2eProfileEnabled();
const LAYOUT_SCREENSHOTS_ENABLED =
  PROFILE_LAYOUT_GATE || process.env.E2E_SLIDES_LAYOUT_SCREENSHOTS === "1";
const USE_PROFILE_LAYOUT_FIXTURE =
  PROFILE_LAYOUT_GATE || process.env.E2E_SLIDES_EDITOR_PATH === undefined;

const EDITOR_PATH =
  process.env.E2E_SLIDES_EDITOR_PATH ?? profileLayoutDocPath();

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const SCREENSHOT_OPTIONS = {
  maxDiffPixelRatio: 0.02,
  threshold: 0.2,
  animations: "disabled",
  caret: "hide",
} as const;

async function settleLayout(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

async function locatorExists(locator: Locator): Promise<boolean> {
  try {
    return (await locator.count()) > 0;
  } catch {
    return false;
  }
}

async function activate(locator: Locator): Promise<void> {
  await locator.focus();
  await locator.press("Enter");
}

function throwFixtureUnavailable(reason: string): never {
  throw new Error(
    `${reason}. Seed the deterministic profile fixture with \`npm run db:seed:e2e\` and run with E2E_PROFILE=1 (or set E2E_SLIDES_LAYOUT_SCREENSHOTS=1 for explicit screenshot runs).`,
  );
}

async function openEditor(page: Page): Promise<Locator> {
  if (USE_PROFILE_LAYOUT_FIXTURE) {
    await login(page, profileOwnerCredentials());
    await page.goto(EDITOR_PATH, { waitUntil: "domcontentloaded" });
  } else {
    let response;
    try {
      response = await page.goto(EDITOR_PATH);
    } catch {
      throwFixtureUnavailable(
        `Slide editor path ${EDITOR_PATH} is unreachable`,
      );
    }
    if (!response || response.status() === 404) {
      throwFixtureUnavailable(`Slide editor path ${EDITOR_PATH} returned 404`);
    }
  }

  const editor = page.getByRole("dialog", { name: "Slide editor" }).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await editor.waitFor({ state: "visible", timeout: 4_000 });
      break;
    } catch {
      const openEditorButton = page.getByRole("button", {
        name: "Open slide editor",
      });
      try {
        await openEditorButton.waitFor({ state: "visible", timeout: 15_000 });
      } catch {
        throwFixtureUnavailable(
          `Slide editor did not open at ${EDITOR_PATH} and no "Open slide editor" button was found`,
        );
      }
      await activate(openEditorButton);
      try {
        await editor.waitFor({ state: "visible", timeout: 10_000 });
        break;
      } catch {
        if (attempt === 2) {
          throwFixtureUnavailable("Slide editor dialog did not render");
        }
        await page.goto(EDITOR_PATH, { waitUntil: "domcontentloaded" });
      }
    }
  }

  const stage = editor
    .locator(
      '[data-slide-stage], [data-slide-stage-shell="true"], [data-slide-canvas="true"], [data-testid="slide-canvas"], .slide-canvas',
    )
    .first();
  try {
    await stage.waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    throwFixtureUnavailable("Slide stage shell did not render");
  }

  await settleLayout(page);
  return editor;
}

async function clickByName(page: Page, name: string | RegExp): Promise<void> {
  const control = page.getByRole("button", { name }).first();
  if (!(await locatorExists(control))) {
    return;
  }

  try {
    await control.click({ timeout: 2_000 });
    await settleLayout(page);
  } catch {
    return;
  }
}

for (const viewport of VIEWPORTS) {
  test.describe(`slides layout screenshots — ${viewport.name}`, () => {
    test.describe.configure({ timeout: 90_000 });

    test.beforeEach(({ page }) => {
      test.skip(
        !LAYOUT_SCREENSHOTS_ENABLED,
        "Set E2E_PROFILE=1 (deterministic gate) or E2E_SLIDES_LAYOUT_SCREENSHOTS=1 to run slide layout screenshots",
      );
      page.setViewportSize({ width: viewport.width, height: viewport.height });
    });

    test(`base editor layout (${viewport.name})`, async ({ page }) => {
      const screenshotRoot = await openEditor(page);
      await expect(screenshotRoot).toHaveScreenshot(
        `editor-${viewport.name}-base.png`,
        SCREENSHOT_OPTIONS,
      );
    });

    test(`rail hidden (${viewport.name})`, async ({ page }) => {
      const screenshotRoot = await openEditor(page);
      await clickByName(page, /hide slide thumbnails/i);
      await expect(screenshotRoot).toHaveScreenshot(
        `editor-${viewport.name}-rail-hidden.png`,
        SCREENSHOT_OPTIONS,
      );
    });

    test(`notes expanded (${viewport.name})`, async ({ page }) => {
      const screenshotRoot = await openEditor(page);
      await clickByName(page, /^notes$/i);
      await expect(screenshotRoot).toHaveScreenshot(
        `editor-${viewport.name}-notes-expanded.png`,
        SCREENSHOT_OPTIONS,
      );
    });

    test(`right panel open with selection (${viewport.name})`, async ({
      page,
    }) => {
      const screenshotRoot = await openEditor(page);

      const stage = screenshotRoot
        .locator('[data-slide-stage], [data-slide-stage-shell="true"]')
        .first();
      await stage.click({ position: { x: 5, y: 5 } });
      await settleLayout(page);

      await clickByName(
        page,
        /(arrange|details|layers|properties|panel|edit slide)/i,
      );

      await expect(screenshotRoot).toHaveScreenshot(
        `editor-${viewport.name}-panel-open.png`,
        SCREENSHOT_OPTIONS,
      );
    });
  });
}
