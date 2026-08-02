import { expect, test, type Locator, type Page } from "@playwright/test";

import { login } from "../helpers/auth";
import {
  e2eProfileEnabled,
  profileLayoutDocPath,
  profileOwnerCredentials,
} from "../helpers/profile";

/**
 * Playwright layout checks for the presentation slide editor.
 *
 * Coverage:
 *  - desktop / tablet / mobile
 *  - rail visible / hidden
 *  - notes collapsed / expanded
 *  - right panel open with a selected node
 *
 * The deterministic profile fixture is the default source of truth. Under
 * `E2E_PROFILE=1` this suite is a hard layout-rendering gate. Pixel screenshot
 * comparisons remain opt-in via `E2E_SLIDES_LAYOUT_SCREENSHOTS=1`.
 */

const PROFILE_LAYOUT_GATE = e2eProfileEnabled();
const LAYOUT_SCREENSHOTS_ENABLED =
  PROFILE_LAYOUT_GATE || process.env.E2E_SLIDES_LAYOUT_SCREENSHOTS === "1";
const COMPARE_SCREENSHOTS = process.env.E2E_SLIDES_LAYOUT_SCREENSHOTS === "1";
const USE_PROFILE_LAYOUT_FIXTURE =
  PROFILE_LAYOUT_GATE || process.env.E2E_SLIDES_EDITOR_PATH === undefined;

const EDITOR_PATH =
  process.env.E2E_SLIDES_EDITOR_PATH ?? profileLayoutDocPath();

const VIEWPORTS = {
  desktop: { name: "desktop", width: 1280, height: 800 },
  tablet: { name: "tablet", width: 834, height: 1112 },
  mobile: { name: "mobile", width: 390, height: 844 },
} as const;

type LayoutViewport = (typeof VIEWPORTS)[keyof typeof VIEWPORTS];

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

async function activate(locator: Locator): Promise<void> {
  await locator.focus();
  await locator.press("Enter");
}

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

function rectanglesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

async function locatorOwnsCenterHit(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const topmost = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return Boolean(topmost && element.contains(topmost));
  });
}

async function locatorContentMetrics(locator: Locator) {
  return locator.evaluate((element) => {
    const content = element.firstElementChild as HTMLElement | null;
    const paragraph = content?.querySelector("p");
    const contentStyle = content ? getComputedStyle(content) : null;
    return {
      clientHeight: content?.clientHeight ?? 0,
      contentBottom: content?.getBoundingClientRect().bottom ?? 0,
      fontSize: contentStyle?.fontSize ?? "",
      lineHeight: contentStyle?.lineHeight ?? "",
      paragraphBottom: paragraph?.getBoundingClientRect().bottom ?? 0,
      paragraphTop: paragraph?.getBoundingClientRect().top ?? 0,
      scrollHeight: content?.scrollHeight ?? 0,
    };
  });
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
      const openEditorLink = page.getByRole("link", {
        name: "Open slide editor",
      });
      try {
        await openEditorLink.waitFor({ state: "visible", timeout: 15_000 });
      } catch {
        throwFixtureUnavailable(
          `Slide editor did not open at ${EDITOR_PATH} and no "Open slide editor" link was found`,
        );
      }
      await activate(openEditorLink);
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
      '[data-slide-stage-shell="true"], [data-slide-stage-viewport="true"], [data-slide-stage-frame="true"], [data-slide-canvas="true"], [data-testid="slide-canvas"], .slide-canvas',
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

async function activateButton(
  page: Page,
  name: string | RegExp,
): Promise<void> {
  const control = page.getByRole("button", { name }).first();
  await expect(control).toBeVisible();
  await activate(control);
  await settleLayout(page);
}

async function expectLayoutState(
  screenshotRoot: Locator,
  snapshotName: string,
): Promise<void> {
  await expect(
    screenshotRoot
      .locator(
        '[data-slide-stage-shell="true"], [data-slide-stage-viewport="true"], [data-slide-stage-frame="true"]',
      )
      .first(),
  ).toBeVisible({ timeout: 20_000 });

  if (COMPARE_SCREENSHOTS) {
    await expect(screenshotRoot).toHaveScreenshot(
      snapshotName,
      SCREENSHOT_OPTIONS,
    );
  }
}

async function openEditorAtViewport(
  page: Page,
  viewport: LayoutViewport,
): Promise<Locator> {
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  return openEditor(page);
}

async function expectBaseEditorLayout(
  page: Page,
  viewport: LayoutViewport,
): Promise<void> {
  const screenshotRoot = await openEditorAtViewport(page, viewport);
  await expectLayoutState(screenshotRoot, `editor-${viewport.name}-base.png`);
}

async function expectRailHiddenLayout(
  page: Page,
  viewport: LayoutViewport,
): Promise<void> {
  const screenshotRoot = await openEditorAtViewport(page, viewport);
  await activateButton(page, "Hide slide thumbnails");
  await expect(
    screenshotRoot.getByRole("button", {
      name: "Show slide thumbnails",
    }),
  ).toHaveAttribute("aria-pressed", "false");
  await expectLayoutState(
    screenshotRoot,
    `editor-${viewport.name}-rail-hidden.png`,
  );
}

async function expectNotesExpandedLayout(
  page: Page,
  viewport: LayoutViewport,
): Promise<void> {
  const screenshotRoot = await openEditorAtViewport(page, viewport);
  await activateButton(page, /^notes$/i);
  await expect(screenshotRoot.getByLabel("Speaker notes")).toBeVisible();
  await expectLayoutState(
    screenshotRoot,
    `editor-${viewport.name}-notes-expanded.png`,
  );
}

async function expectRightPanelLayout(
  page: Page,
  viewport: LayoutViewport,
): Promise<void> {
  const screenshotRoot = await openEditorAtViewport(page, viewport);
  const titleNode = screenshotRoot.getByRole("button", {
    name: "Text: Release Gate Fixture Slide",
  });
  await expect(titleNode).toBeVisible();
  const titleMetrics = await locatorContentMetrics(titleNode);
  expect(
    titleMetrics.scrollHeight,
    JSON.stringify(titleMetrics),
  ).toBeLessThanOrEqual(titleMetrics.clientHeight + 1);
  const contextToolbar = page.getByRole("toolbar", {
    name: "Context toolbar",
  });
  await expect(contextToolbar).toBeVisible();
  expect(await locatorOwnsCenterHit(titleNode)).toBe(true);
  if (viewport.name !== "desktop") {
    expect(
      rectanglesOverlap(
        await requiredBox(titleNode),
        await requiredBox(contextToolbar),
      ),
    ).toBe(false);
  }
  await titleNode.click();
  await expect(titleNode).toHaveAttribute("aria-pressed", "true");
  await settleLayout(page);

  await activateButton(page, "Open Text inspector");
  const inspector =
    viewport.name === "desktop"
      ? screenshotRoot.getByRole("region", { name: "Inspector" })
      : page.getByRole("dialog", { name: "Text inspector" });
  await expect(inspector).toBeVisible();
  await expect(
    inspector.getByLabel("Inspector panel", { exact: true }),
  ).toHaveValue("text");

  await expectLayoutState(
    screenshotRoot,
    `editor-${viewport.name}-panel-open.png`,
  );
}

test.describe("slides layout screenshots", () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(() => {
    test.skip(
      !LAYOUT_SCREENSHOTS_ENABLED,
      "Set E2E_PROFILE=1 (deterministic gate) or E2E_SLIDES_LAYOUT_SCREENSHOTS=1 to run slide layout screenshots",
    );
  });

  test("base editor layout (desktop) @required-profile", async ({ page }) => {
    await expectBaseEditorLayout(page, VIEWPORTS.desktop);
  });

  test("rail hidden (desktop)", async ({ page }) => {
    await expectRailHiddenLayout(page, VIEWPORTS.desktop);
  });

  test("notes expanded (desktop)", async ({ page }) => {
    await expectNotesExpandedLayout(page, VIEWPORTS.desktop);
  });

  test("right panel open with selection (desktop) @required-profile", async ({
    page,
  }) => {
    await expectRightPanelLayout(page, VIEWPORTS.desktop);
  });

  test("base editor layout (tablet) @required-profile", async ({ page }) => {
    await expectBaseEditorLayout(page, VIEWPORTS.tablet);
  });

  test("rail hidden (tablet)", async ({ page }) => {
    await expectRailHiddenLayout(page, VIEWPORTS.tablet);
  });

  test("notes expanded (tablet)", async ({ page }) => {
    await expectNotesExpandedLayout(page, VIEWPORTS.tablet);
  });

  test("right panel open with selection (tablet) @required-profile", async ({
    page,
  }) => {
    await expectRightPanelLayout(page, VIEWPORTS.tablet);
  });

  test("base editor layout (mobile) @required-profile", async ({ page }) => {
    await expectBaseEditorLayout(page, VIEWPORTS.mobile);
  });

  test("rail hidden (mobile)", async ({ page }) => {
    await expectRailHiddenLayout(page, VIEWPORTS.mobile);
  });

  test("notes expanded (mobile)", async ({ page }) => {
    await expectNotesExpandedLayout(page, VIEWPORTS.mobile);
  });

  test("right panel open with selection (mobile) @required-profile", async ({
    page,
  }) => {
    await expectRightPanelLayout(page, VIEWPORTS.mobile);
  });
});
