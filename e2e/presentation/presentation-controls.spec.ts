import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { login } from "../helpers/auth";
import {
  E2E_CUSTOM_THEME_FIXTURE,
  E2E_VERSIONED_THEME_FIXTURE,
  PRESENTATION_CONTROL_FIXTURES,
  presentationTestFixture,
} from "../helpers/presentation-fixtures";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  fixturePngBuffer,
  profileDocPath,
  profileOwnerCredentials,
  profilePresentPath,
} from "../helpers/profile";
import {
  waitForDocumentAutosaveAfter,
  waitForDocumentEditorReady,
  waitForSlideAutosave,
  waitForSlideAutosaveAfter,
  waitForStableLocatorBoxes,
  waitForStableSlideStage,
} from "../helpers/readiness";

const STAGE_NODE_SELECTOR =
  '[data-slide-stage-viewport="true"] [data-slide-canvas="true"] [data-node-id][role="button"]';

type FramePercent = {
  x: number;
  y: number;
  width: number;
  height: number;
};

async function openPresentationFixture(
  page: Page,
  testInfo: TestInfo,
  fixtureName:
    | "multiSelectArrange"
    | "precisionGuides"
    | "builtInTheme"
    | "customThemeAuthoring"
    | "versionedCustomTheme"
    | "groupLayerOrder"
    | "slideRatio"
    | "slideMaster"
    | "sourceReview"
    | "sourceActions"
    | "speakerNotes"
    | "deckDiagnostics",
): Promise<{ editor: Locator; canvas: Locator }> {
  await login(
    page,
    profileOwnerCredentials(),
    `${profileDocPath(PRESENTATION_CONTROL_FIXTURES[fixtureName], testInfo)}/slides`,
  );
  const editor = page.locator('[data-slide-editor="true"]').first();
  const canvas = editor.locator('[data-slide-canvas="true"]').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await waitForStableSlideStage(canvas);
  return { editor, canvas };
}

async function framePercent(
  node: Locator,
  canvas: Locator,
): Promise<FramePercent> {
  const [nodeBox, canvasBox] = await Promise.all([
    node.boundingBox(),
    canvas.boundingBox(),
  ]);
  expect(nodeBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  return {
    x: ((nodeBox!.x - canvasBox!.x) / canvasBox!.width) * 100,
    y: ((nodeBox!.y - canvasBox!.y) / canvasBox!.height) * 100,
    width: (nodeBox!.width / canvasBox!.width) * 100,
    height: (nodeBox!.height / canvasBox!.height) * 100,
  };
}

function expectPercent(actual: number, expected: number, tolerance = 0.35) {
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);
}

function expectFrameEqual(actual: FramePercent, expected: FramePercent) {
  expectPercent(actual.x, expected.x);
  expectPercent(actual.y, expected.y);
  expectPercent(actual.width, expected.width);
  expectPercent(actual.height, expected.height);
}

async function expectCanvasRatio(
  canvas: Locator,
  expectedRatio: number,
): Promise<void> {
  await waitForStableSlideStage(canvas);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.width / box!.height - expectedRatio)).toBeLessThan(
    0.015,
  );
}

async function selectSlideRatio(
  page: Page,
  ratio: "16:9" | "4:3" | "1:1",
): Promise<void> {
  const trigger = page.getByRole("button", { name: "Slide ratio" });
  await trigger.click();
  const listbox = page.getByRole("listbox", { name: "Slide ratio" });
  await expect(listbox).toBeVisible();
  await listbox.getByRole("option", { name: ratio, exact: true }).click();
  await expect(listbox).toHaveCount(0);
  await expect(trigger).toContainText(ratio);
}

async function expectSaved(page: Page): Promise<void> {
  await expect(
    page.locator('button[aria-label^="Footer status:"]').first(),
  ).toHaveAttribute("aria-label", /^Footer status: All changes saved\./);
}

async function openThemePicker(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Deck theme" }).click();
  const picker = page.getByRole("dialog", { name: "Theme picker" });
  await expect(picker).toBeVisible();
  return picker;
}

test.describe("presentation editing controls", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed the deterministic profile",
  );
  test.setTimeout(120_000);

  test("multi-select Arrange distributes three named nodes with undo, redo, and persistence", async ({
    page,
  }, testInfo) => {
    const { editor, canvas } = await openPresentationFixture(
      page,
      testInfo,
      "multiSelectArrange",
    );
    const nodeA = editor.getByRole("button", { name: "A", exact: true });
    const nodeB = editor.getByRole("button", { name: "B", exact: true });
    const nodeC = editor.getByRole("button", { name: "C", exact: true });

    const initialA = await framePercent(nodeA, canvas);
    const initialB = await framePercent(nodeB, canvas);
    const initialC = await framePercent(nodeC, canvas);
    expectPercent(initialA.x, 10);
    expectPercent(initialB.x, 30);
    expectPercent(initialC.x, 80);

    await nodeA.click();
    await nodeB.click({ modifiers: ["Shift"] });
    await nodeC.click({ modifiers: ["Shift"] });
    await expect(nodeA).toHaveAttribute("aria-pressed", "true");
    await expect(nodeB).toHaveAttribute("aria-pressed", "true");
    await expect(nodeC).toHaveAttribute("aria-pressed", "true");

    await page
      .getByRole("toolbar", { name: "Context toolbar" })
      .getByRole("button", { name: "Open Selection inspector" })
      .click();
    const inspector = editor.getByRole("region", { name: "Inspector" });
    await expect(inspector).toBeVisible();
    await inspector
      .getByRole("combobox", { name: "Inspector panel" })
      .selectOption("arrange");
    await expect(
      inspector.getByRole("heading", { name: "Arrange 3 nodes" }),
    ).toBeVisible();

    for (const control of [
      "Left",
      "Center",
      "Right",
      "Top",
      "Middle",
      "Bottom",
      "Distribute H",
      "Distribute V",
      "Match width",
      "Match height",
      "Match both",
      "Group",
      "Ungroup",
    ]) {
      await expect(
        inspector.getByRole("button", { name: control, exact: true }),
      ).toBeVisible();
    }

    await inspector
      .getByRole("button", { name: "Distribute H", exact: true })
      .click();
    let distributedB = await framePercent(nodeB, canvas);
    const distributedA = await framePercent(nodeA, canvas);
    const distributedC = await framePercent(nodeC, canvas);
    expectPercent(distributedB.x, 40);
    expectPercent(distributedA.x, initialA.x);
    expectPercent(distributedC.x, initialC.x);
    expectPercent(distributedA.width, initialA.width);
    expectPercent(distributedB.width, initialB.width);
    expectPercent(distributedC.width, initialC.width);

    const undo = editor.getByRole("button", { name: "Undo", exact: true });
    const redo = editor.getByRole("button", { name: "Redo", exact: true });
    await undo.click();
    expectPercent((await framePercent(nodeB, canvas)).x, 30);
    await redo.click();
    distributedB = await framePercent(nodeB, canvas);
    expectPercent(distributedB.x, 40);

    await waitForSlideAutosave(page);
    await page.reload();
    await waitForStableSlideStage(canvas);
    expectPercent((await framePercent(nodeB, canvas)).x, 40);
  });

  test("precision guide preferences persist locally and custom guide visibility controls snapping", async ({
    page,
  }, testInfo) => {
    const { editor, canvas } = await openPresentationFixture(
      page,
      testInfo,
      "precisionGuides",
    );
    await expectSaved(page);
    const grid = editor.getByRole("button", { name: "Toggle grid overlay" });
    const rulers = editor.getByRole("button", { name: "Toggle rulers" });
    const snapToGuides = editor.getByRole("button", {
      name: "Toggle snap to guides",
    });
    await expect(snapToGuides).toHaveAttribute("aria-pressed", "true");

    await grid.click();
    await rulers.click();
    await expect(grid).toHaveAttribute("aria-pressed", "true");
    await expect(rulers).toHaveAttribute("aria-pressed", "true");
    await expect(
      editor.locator('[data-precision-grid-overlay="true"]'),
    ).toBeVisible();
    await expect(
      editor.locator('[data-precision-ruler-overlay="true"]'),
    ).toBeVisible();
    await expectSaved(page);

    const documentId = presentationTestFixture(
      PRESENTATION_CONTROL_FIXTURES.precisionGuides,
      testInfo,
    ).documentId;
    const storageState = await page.context().storageState();
    const localStorage = storageState.origins.find(
      (origin) => origin.origin === new URL(page.url()).origin,
    )?.localStorage;
    const storedPreferences = localStorage?.find(
      (entry) => entry.name === `slide-precision-guides:${documentId}`,
    );
    expect(storedPreferences).toBeDefined();
    expect(JSON.parse(storedPreferences!.value)).toMatchObject({
      gridVisible: true,
      rulersVisible: true,
    });

    await page.reload();
    await waitForStableSlideStage(canvas);
    await expect(grid).toHaveAttribute("aria-pressed", "true");
    await expect(rulers).toHaveAttribute("aria-pressed", "true");
    await expect(
      editor.locator('[data-precision-grid-overlay="true"]'),
    ).toBeVisible();
    await expect(
      editor.locator('[data-precision-ruler-overlay="true"]'),
    ).toBeVisible();
    await expectSaved(page);

    await editor.getByRole("button", { name: "Manage custom guides" }).click();
    let customGuides = page.getByRole("dialog", { name: "Custom guides" });
    await expect(customGuides).toBeVisible();
    await customGuides
      .getByRole("combobox", { name: "Guide orientation" })
      .selectOption({ label: "Vertical" });
    await customGuides.getByLabel("Guide position (%)").fill("37");
    await customGuides.getByRole("button", { name: "Add guide" }).click();
    await expect(customGuides.getByText(/vertical.*37%/i)).toBeVisible();
    const showCustomGuides = customGuides.getByRole("button", {
      name: "Show custom guides",
    });
    await expect(showCustomGuides).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Manage custom guides" }).click();
    await expect(customGuides).toHaveCount(0);
    await expect(
      editor.locator('[data-precision-guides-overlay="true"]'),
    ).toBeVisible();
    await expectSaved(page);

    const target = editor.locator(
      `${STAGE_NODE_SELECTOR}[data-node-id="guide-target"]`,
    );
    const initial = await framePercent(target, canvas);
    const snapped = await dragNodeCenterNearXGuide({
      page,
      editor,
      canvas,
      node: target,
      guideCenterPct: 36.5,
      expectSnapGuide: true,
    });
    expectPercent(snapped.x + snapped.width / 2, 37);

    // Undo reverts the drag to the already-saved position; no new save cycle
    // fires when the resulting state matches the last saved state.
    await editor.getByRole("button", { name: "Undo", exact: true }).click();
    await waitForSlideAutosave(page);
    expectPercent((await framePercent(target, canvas)).x, initial.x);

    await snapToGuides.click();
    await expect(snapToGuides).toHaveAttribute("aria-pressed", "false");
    await expect(
      editor.getByText("Snap to guides off", { exact: true }),
    ).toBeAttached();
    const unsnappedByToggle = await waitForSlideAutosaveAfter(page, () =>
      dragNodeCenterNearXGuide({
        page,
        editor,
        canvas,
        node: target,
        guideCenterPct: 36.5,
        expectSnapGuide: false,
      }),
    );
    expectPercent(unsnappedByToggle.x + unsnappedByToggle.width / 2, 36.5);
    expect(Math.abs(unsnappedByToggle.x - snapped.x)).toBeGreaterThan(0.35);
    await editor.getByRole("button", { name: "Undo", exact: true }).click();
    await waitForSlideAutosave(page);
    expectPercent((await framePercent(target, canvas)).x, initial.x);
    await snapToGuides.click();
    await expect(snapToGuides).toHaveAttribute("aria-pressed", "true");
    await expect(
      editor.getByText("Snap to guides on", { exact: true }),
    ).toBeAttached();

    await editor.getByRole("button", { name: "Manage custom guides" }).click();
    customGuides = page.getByRole("dialog", { name: "Custom guides" });
    await expect(customGuides).toBeVisible();
    await customGuides
      .getByRole("button", { name: "Show custom guides" })
      .click();
    await expect(
      customGuides.getByRole("button", { name: "Show custom guides" }),
    ).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Manage custom guides" }).click();
    await expect(customGuides).toHaveCount(0);
    await expect(
      editor.locator('[data-precision-guides-overlay="true"]'),
    ).toHaveCount(0);

    const unsnapped = await waitForSlideAutosaveAfter(page, () =>
      dragNodeCenterNearXGuide({
        page,
        editor,
        canvas,
        node: target,
        guideCenterPct: 36.5,
        expectSnapGuide: false,
      }),
    );
    expectPercent(unsnapped.x + unsnapped.width / 2, 36.5);
    expect(Math.abs(unsnapped.x - snapped.x)).toBeGreaterThan(0.35);

    await snapToGuides.click();
    await expect(snapToGuides).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await waitForStableSlideStage(canvas);
    await expect(snapToGuides).toHaveAttribute("aria-pressed", "true");
    await expect(
      editor.locator('[data-precision-guides-overlay="true"]'),
    ).toHaveCount(0);
    expectPercent((await framePercent(target, canvas)).x, unsnapped.x);
    await expectSaved(page);
  });

  test("built-in theme selection preserves geometry and survives undo, redo, and reload", async ({
    page,
  }, testInfo) => {
    const { editor, canvas } = await openPresentationFixture(
      page,
      testInfo,
      "builtInTheme",
    );
    const title = editor.locator(
      `${STAGE_NODE_SELECTOR}[data-node-id="fixture-title"]`,
    );
    const initialGeometry = await framePercent(title, canvas);

    let picker = await openThemePicker(page);
    const allFilter = picker.getByRole("button", { name: "All", exact: true });
    const darkFilter = picker.getByRole("button", {
      name: "Dark",
      exact: true,
    });
    await expect(allFilter).toHaveAttribute("aria-pressed", "true");
    await darkFilter.click();
    await expect(darkFilter).toHaveAttribute("aria-pressed", "true");
    await expect(allFilter).toHaveAttribute("aria-pressed", "false");
    await allFilter.click();

    const search = picker.getByRole("textbox", { name: "Search themes" });
    await search.fill("ocean");
    await expect(
      picker.getByText(/\d+ visible · \d+ matched · \d+ total/),
    ).toBeVisible();
    const ocean = picker.getByRole("option", { name: /Iridescent Gradient/ });
    await expect(ocean).toBeVisible();
    await ocean.click();
    await expect(
      page.getByRole("button", { name: "Deck theme" }),
    ).toContainText("Iridescent Gradient");
    expectFrameEqual(await framePercent(title, canvas), initialGeometry);

    await editor.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Deck theme" }),
    ).toContainText("Neutral");
    await editor.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Deck theme" }),
    ).toContainText("Iridescent Gradient");
    expectFrameEqual(await framePercent(title, canvas), initialGeometry);
    await waitForSlideAutosave(page);

    await page.reload();
    await waitForStableSlideStage(canvas);
    await expect(
      page.getByRole("button", { name: "Deck theme" }),
    ).toContainText("Iridescent Gradient");
    picker = await openThemePicker(page);
    await expect(
      picker.getByRole("option", { name: /Iridescent Gradient/ }),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("slide ratio preserves percent geometry through undo, redo, reload, and public rendering", async ({
    page,
  }, testInfo) => {
    const { editor, canvas } = await openPresentationFixture(
      page,
      testInfo,
      "slideRatio",
    );
    const ratioTrigger = page.getByRole("button", { name: "Slide ratio" });
    const title = canvas.locator(
      '[data-node-id="fixture-title"][role="button"]',
    );
    const initialGeometry = await framePercent(title, canvas);

    await expect(ratioTrigger).toContainText("16:9");
    await expectCanvasRatio(canvas, 16 / 9);

    await selectSlideRatio(page, "4:3");
    await expectCanvasRatio(canvas, 4 / 3);
    expectFrameEqual(await framePercent(title, canvas), initialGeometry);

    await editor.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(ratioTrigger).toContainText("16:9");
    await expectCanvasRatio(canvas, 16 / 9);
    expectFrameEqual(await framePercent(title, canvas), initialGeometry);

    await editor.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(ratioTrigger).toContainText("4:3");
    await expectCanvasRatio(canvas, 4 / 3);
    expectFrameEqual(await framePercent(title, canvas), initialGeometry);

    await selectSlideRatio(page, "1:1");
    await expectCanvasRatio(canvas, 1);
    expectFrameEqual(await framePercent(title, canvas), initialGeometry);
    await waitForSlideAutosave(page);

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(ratioTrigger).toContainText("1:1");
    await expectCanvasRatio(canvas, 1);
    expectFrameEqual(await framePercent(title, canvas), initialGeometry);

    await ratioTrigger.click();
    const ratioListbox = page.getByRole("listbox", { name: "Slide ratio" });
    await expect(
      ratioListbox.getByRole("option", { name: "1:1", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(ratioListbox).toHaveCount(0);

    const publicPage = await page.context().newPage();
    const response = await publicPage.goto(
      profilePresentPath(PRESENTATION_CONTROL_FIXTURES.slideRatio, testInfo),
    );
    expect(response?.status()).toBe(200);
    const publicCanvas = publicPage
      .locator('[data-public-present-viewer] [data-slide-canvas="true"]')
      .first();
    await expect(publicCanvas).toBeVisible({ timeout: 30_000 });
    await expectCanvasRatio(publicCanvas, 1);
    await publicPage.close();
  });

  test("slide master preserves deck defaults and slide overrides through history, reload, and public rendering", async ({
    page,
  }, testInfo) => {
    const { editor, canvas } = await openPresentationFixture(
      page,
      testInfo,
      "slideMaster",
    );
    const masterTrigger = editor.getByRole("button", { name: "Slide master" });
    const footer = canvas.locator('[data-node-id="deck-chrome-footer"]');
    const pageNumber = canvas.locator(
      '[data-node-id="deck-chrome-pageNumber"]',
    );
    const deckFooterText = "E2E deck footer";
    const firstSlideFooterText = "E2E first-slide footer";

    await masterTrigger.click();
    let master = page.getByRole("dialog", { name: "Slide master controls" });
    await expect(master).toBeVisible();
    await master.getByLabel("Deck default footer").check();
    await master
      .getByRole("textbox", { name: /Deck-level footer copied/ })
      .fill(deckFooterText);
    const pageNumberToggle = master.getByRole("combobox", {
      name: "Deck default page number",
    });
    const pageNumberFormat = master.getByRole("combobox", {
      name: "Format",
      exact: true,
    });
    await expect(pageNumberToggle).toBeVisible();
    await pageNumberToggle.selectOption("on");
    await expect(pageNumberFormat).toBeVisible();
    await pageNumberFormat.selectOption("number-total");
    await expect(footer).toContainText(deckFooterText);
    await expect(pageNumber).toContainText("1 / 2");

    const footerOverride = master.getByRole("combobox", {
      name: "Footer",
      exact: true,
    });
    await expect(footerOverride).toBeVisible();
    await footerOverride.selectOption("override");
    await master
      .getByPlaceholder("Footer text")
      .last()
      .fill(firstSlideFooterText);
    await expect(footer).toContainText(firstSlideFooterText);

    await page.keyboard.press("Escape");
    await expect(master).toHaveCount(0);
    await expect(masterTrigger).toBeFocused();

    const filmstrip = editor.locator('[aria-label="Slide filmstrip"]');
    const firstSlide = filmstrip.getByRole("button", {
      name: `Slide 1: ${E2E_PROFILE_FIXTURE.slideTitleText}`,
    });
    const secondSlide = filmstrip.getByRole("button", {
      name: `Slide 2: ${E2E_PROFILE_FIXTURE.slideTwoTitleText}`,
    });
    await secondSlide.click();
    await expect(footer).toContainText(deckFooterText);
    await expect(pageNumber).toContainText("2 / 2");

    await editor.getByRole("button", { name: "Undo", exact: true }).click();
    await firstSlide.click();
    await expect(footer).toContainText(deckFooterText);
    await editor.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(footer).toContainText(firstSlideFooterText);
    await waitForSlideAutosave(page);

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(canvas);
    await expect(footer).toContainText(firstSlideFooterText);
    await expect(pageNumber).toContainText("1 / 2");
    await masterTrigger.click();
    master = page.getByRole("dialog", { name: "Slide master controls" });
    await expect(master.getByLabel("Deck default footer")).toBeChecked();
    await expect(
      master.getByRole("textbox", { name: /Deck-level footer copied/ }),
    ).toHaveValue(deckFooterText);
    await expect(
      master.getByRole("combobox", { name: "Footer", exact: true }),
    ).toHaveValue("override");
    await expect(master.getByPlaceholder("Footer text").last()).toHaveValue(
      firstSlideFooterText,
    );
    await page.keyboard.press("Escape");
    await expect(masterTrigger).toBeFocused();

    const publicPage = await page.context().newPage();
    const response = await publicPage.goto(
      profilePresentPath(PRESENTATION_CONTROL_FIXTURES.slideMaster, testInfo),
    );
    expect(response?.status()).toBe(200);
    const activePublicCanvas = () =>
      publicPage
        .locator(
          '[data-public-present-viewer] [aria-hidden="false"] [data-slide-canvas="true"]',
        )
        .first();
    await expect(activePublicCanvas()).toBeVisible({ timeout: 30_000 });
    await expect(
      activePublicCanvas().locator('[data-node-id="deck-chrome-footer"]'),
    ).toContainText(firstSlideFooterText);
    await expect(
      activePublicCanvas().locator('[data-node-id="deck-chrome-pageNumber"]'),
    ).toContainText("1 / 2");

    await publicPage.getByRole("button", { name: "Next slide" }).last().click();
    await expect(
      activePublicCanvas().locator('[data-node-id="deck-chrome-footer"]'),
    ).toContainText(deckFooterText);
    await expect(
      activePublicCanvas().locator('[data-node-id="deck-chrome-pageNumber"]'),
    ).toContainText("2 / 2");
    await publicPage.close();
  });

  test("document source review refreshes stale content through history, reload, and public rendering", async ({
    page,
  }, testInfo) => {
    const fixtureName = PRESENTATION_CONTROL_FIXTURES.sourceReview;
    const documentPath = profileDocPath(fixtureName, testInfo);
    const refreshedText = `${E2E_PROFILE_FIXTURE.documentBodyText} [source refreshed]`;
    const { editor, canvas } = await openPresentationFixture(
      page,
      testInfo,
      "sourceReview",
    );
    const sourceNode = canvas.locator(
      '[data-node-id="fixture-title"][role="button"]',
    );
    const undo = editor.getByRole("button", { name: "Undo", exact: true });

    await expect(sourceNode).toContainText(
      E2E_PROFILE_FIXTURE.documentBodyText,
    );
    await expect(
      editor.getByRole("button", {
        name: "Refresh all source links",
        exact: true,
      }),
    ).toBeVisible();
    await expect(undo).toBeDisabled();
    await editor
      .getByRole("button", {
        name: "Refresh all source links",
        exact: true,
      })
      .click();
    await expect(
      editor
        .locator('[aria-live="polite"]')
        .filter({ hasText: "Refreshed 0 source links; skipped 0." }),
    ).toBeAttached();
    await expect(undo).toBeDisabled();

    await page.goto(documentPath);
    const documentBody = await waitForDocumentEditorReady(page);
    const sourceParagraph = documentBody.locator(
      `[data-lexical-block-id="${E2E_PROFILE_FIXTURE.documentBodyBlockId}"]`,
    );
    await expect(sourceParagraph).toContainText(
      E2E_PROFILE_FIXTURE.documentBodyText,
    );
    await waitForDocumentAutosaveAfter(page, async () => {
      await sourceParagraph.click();
      await page.keyboard.press("End");
      await page.keyboard.type(" [source refreshed]");
    });
    await expect(sourceParagraph).toContainText(refreshedText);

    await page.goto(`${documentPath}/slides`);
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(canvas);
    await expect(sourceNode).toContainText(
      E2E_PROFILE_FIXTURE.documentBodyText,
    );
    const reviewSourceLinks = editor.getByRole("button", {
      name: "Review source links",
      exact: true,
    });
    await expect(reviewSourceLinks).toBeVisible();
    const sourceReviewHeading = editor.getByRole("heading", {
      name: "Source Review",
    });
    await expect(sourceReviewHeading).toBeVisible();
    await expect(editor.getByText("Stale", { exact: true })).toBeVisible();

    await reviewSourceLinks.click();
    await expect(sourceNode).toHaveAttribute("aria-pressed", "true");
    const inspector = page.getByRole("region", { name: "Inspector" });
    await expect(
      inspector.getByRole("combobox", { name: "Inspector panel" }),
    ).toHaveValue("source");
    await expect(inspector.getByText("Stale", { exact: true })).toBeVisible();

    await waitForSlideAutosaveAfter(page, () =>
      editor
        .getByRole("button", {
          name: "Refresh source link for Slide 1, fixture-title",
          exact: true,
        })
        .click(),
    );
    await expect(sourceReviewHeading).toHaveCount(0);
    await expect(sourceNode).toContainText(refreshedText);
    await expect(
      editor.getByRole("button", {
        name: "Refresh all source links",
        exact: true,
      }),
    ).toBeVisible();

    await waitForSlideAutosaveAfter(page, () => undo.click());
    await expect(sourceNode).not.toContainText("[source refreshed]");
    await expect(reviewSourceLinks).toBeVisible();

    await waitForSlideAutosaveAfter(page, () =>
      editor.getByRole("button", { name: "Redo", exact: true }).click(),
    );
    await expect(sourceNode).toContainText(refreshedText);
    await expect(
      editor.getByRole("button", {
        name: "Refresh all source links",
        exact: true,
      }),
    ).toBeVisible();

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(canvas);
    await expect(sourceNode).toContainText(refreshedText);
    await expect(
      editor.getByRole("button", {
        name: "Refresh all source links",
        exact: true,
      }),
    ).toBeVisible();

    const publicPage = await page.context().newPage();
    const response = await publicPage.goto(
      profilePresentPath(fixtureName, testInfo),
    );
    expect(response?.status()).toBe(200);
    const publicSourceNode = publicPage
      .locator('[data-public-present-viewer] [data-node-id="fixture-title"]')
      .first();
    await expect(publicSourceNode).toBeVisible({ timeout: 30_000 });
    await expect(publicSourceNode).toContainText(refreshedText);
    await publicPage.close();
  });

  test("source review navigation, dismiss, unlink, and relink actions preserve reversible state", async ({
    page,
  }, testInfo) => {
    const fixtureName = PRESENTATION_CONTROL_FIXTURES.sourceActions;
    const documentPath = profileDocPath(fixtureName, testInfo);
    const refreshedText = `${E2E_PROFILE_FIXTURE.documentBodyText} [source actions]`;

    await login(page, profileOwnerCredentials(), documentPath);
    const documentBody = await waitForDocumentEditorReady(page);
    const sourceParagraph = documentBody.locator(
      `[data-lexical-block-id="${E2E_PROFILE_FIXTURE.documentBodyBlockId}"]`,
    );
    await waitForDocumentAutosaveAfter(page, async () => {
      await sourceParagraph.click();
      await page.keyboard.press("End");
      await page.keyboard.type(" [source actions]");
    });

    await page.goto(`${documentPath}/slides`);
    const editor = page.locator('[data-slide-editor="true"]').first();
    const canvas = editor.locator('[data-slide-canvas="true"]').first();
    const sourceNode = canvas.locator(
      '[data-node-id="fixture-title"][role="button"]',
    );
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(canvas);
    await expect(sourceNode).not.toContainText("[source actions]");

    const reviewSourceLinks = editor.getByRole("button", {
      name: "Review source links",
      exact: true,
    });
    const sourceReviewHeading = editor.getByRole("heading", {
      name: "Source Review",
    });
    await expect(reviewSourceLinks).toBeVisible();
    await expect(sourceReviewHeading).toBeVisible();
    await reviewSourceLinks.click();

    const inspector = page.getByRole("region", { name: "Inspector" });
    await expect(
      inspector.getByRole("combobox", { name: "Inspector panel" }),
    ).toHaveValue("source");
    await expect(inspector.getByText("Stale", { exact: true })).toBeVisible();

    const sourcePopupPromise = page.waitForEvent("popup");
    await editor
      .getByRole("button", {
        name: "Jump to source block for Slide 1, fixture-title",
        exact: true,
      })
      .click();
    const sourcePage = await sourcePopupPromise;
    await expect(sourcePage).toHaveURL(
      new RegExp(
        `${documentPath.replaceAll("/", "\\/")}\\?sourceBlock=${E2E_PROFILE_FIXTURE.documentBodyBlockId}$`,
      ),
    );
    const sourcePageBody = await waitForDocumentEditorReady(sourcePage);
    const focusedSourceBlock = sourcePageBody.locator(
      `[data-lexical-block-id="${E2E_PROFILE_FIXTURE.documentBodyBlockId}"]`,
    );
    await expect(focusedSourceBlock).toContainText(refreshedText);
    await expect(sourcePageBody).toBeFocused();
    await expect
      .poll(() =>
        focusedSourceBlock.evaluate((block) => {
          const anchor = window.getSelection()?.anchorNode;
          return (
            anchor !== undefined && anchor !== null && block.contains(anchor)
          );
        }),
      )
      .toBe(true);
    await sourcePage.close();
    await expect(
      editor
        .locator('[aria-live="polite"]')
        .filter({ hasText: "Opened the source document block." }),
    ).toBeAttached();

    const undo = editor.getByRole("button", { name: "Undo", exact: true });
    await waitForSlideAutosaveAfter(page, () =>
      editor
        .getByRole("button", {
          name: "Dismiss source issue for Slide 1, fixture-title",
          exact: true,
        })
        .click(),
    );
    await expect(sourceReviewHeading).toHaveCount(0);
    await expect(
      inspector.getByText("Dismissed", { exact: true }),
    ).toBeVisible();
    await waitForSlideAutosaveAfter(page, () => undo.click());
    await expect(sourceReviewHeading).toBeVisible();
    await expect(inspector.getByText("Stale", { exact: true })).toBeVisible();

    await waitForSlideAutosaveAfter(page, () =>
      editor
        .getByRole("button", {
          name: "Mark source as unlinked for Slide 1, fixture-title",
          exact: true,
        })
        .click(),
    );
    await expect(sourceReviewHeading).toHaveCount(0);
    await expect(
      inspector.getByRole("checkbox", { name: "Unlinked", exact: true }),
    ).toBeChecked();
    await expect(sourceNode).not.toContainText("[source actions]");
    await waitForSlideAutosaveAfter(page, () => undo.click());
    await expect(sourceReviewHeading).toBeVisible();
    await expect(inspector.getByText("Stale", { exact: true })).toBeVisible();

    await waitForSlideAutosaveAfter(page, () =>
      editor
        .getByRole("combobox", {
          name: "Relink source for Slide 1, fixture-title",
          exact: true,
        })
        .selectOption(`text:${E2E_PROFILE_FIXTURE.documentBodyBlockId}`),
    );
    await expect(sourceReviewHeading).toHaveCount(0);
    await expect(sourceNode).toContainText(refreshedText);
    await expect(inspector.getByText("Fresh", { exact: true })).toBeVisible();

    await waitForSlideAutosaveAfter(page, () => undo.click());
    await expect(sourceReviewHeading).toBeVisible();
    await expect(sourceNode).not.toContainText("[source actions]");
    await waitForSlideAutosaveAfter(page, () =>
      editor.getByRole("button", { name: "Redo", exact: true }).click(),
    );
    await expect(sourceReviewHeading).toHaveCount(0);
    await expect(sourceNode).toContainText(refreshedText);

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(canvas);
    await expect(sourceNode).toContainText(refreshedText);
    await expect(
      editor.getByRole("button", {
        name: "Refresh all source links",
        exact: true,
      }),
    ).toBeVisible();

    const publicPage = await page.context().newPage();
    const response = await publicPage.goto(
      profilePresentPath(fixtureName, testInfo),
    );
    expect(response?.status()).toBe(200);
    await expect(
      publicPage
        .locator('[data-public-present-viewer] [data-node-id="fixture-title"]')
        .first(),
    ).toContainText(refreshedText, { timeout: 30_000 });
    await publicPage.close();
  });

  test("speaker notes preserve slide scope through history, reload, and presenter mode", async ({
    page,
  }, testInfo) => {
    const fixtureName = PRESENTATION_CONTROL_FIXTURES.speakerNotes;
    const documentPath = profileDocPath(fixtureName, testInfo);
    const updatedNotes =
      "Pause for the production readiness summary and invite questions.";
    const seededSecondSlideNotes =
      "Use this seeded slide to verify presentation navigation.";
    const { editor, canvas } = await openPresentationFixture(
      page,
      testInfo,
      "speakerNotes",
    );
    const notesButton = editor.getByRole("button", {
      name: "Notes",
      exact: true,
    });
    const speakerNotes = editor.getByRole("textbox", {
      name: "Speaker Notes",
      exact: true,
    });
    const undo = editor.getByRole("button", { name: "Undo", exact: true });
    const redo = editor.getByRole("button", { name: "Redo", exact: true });

    await notesButton.click();
    await expect(speakerNotes).toBeVisible();
    await expect(speakerNotes).toHaveValue("");
    await waitForSlideAutosaveAfter(page, () =>
      speakerNotes.fill(updatedNotes),
    );
    await expect(speakerNotes).toHaveValue(updatedNotes);
    await expect(undo).toBeEnabled();

    await waitForSlideAutosaveAfter(page, () => undo.click());
    await expect(speakerNotes).toHaveValue("");
    await waitForSlideAutosaveAfter(page, () => redo.click());
    await expect(speakerNotes).toHaveValue(updatedNotes);

    await editor
      .getByRole("button", {
        name: new RegExp(`^Slide 2: ${E2E_PROFILE_FIXTURE.slideTwoTitleText}`),
      })
      .click();
    await expect(speakerNotes).toHaveValue(seededSecondSlideNotes);
    await editor
      .getByRole("button", {
        name: new RegExp(`^Slide 1: ${E2E_PROFILE_FIXTURE.slideTitleText}`),
      })
      .click();
    await expect(speakerNotes).toHaveValue(updatedNotes);

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(canvas);
    await notesButton.click();
    await expect(speakerNotes).toHaveValue(updatedNotes);

    await page.goto(documentPath);
    await waitForDocumentEditorReady(page);
    const presentButton = page.getByRole("button", { name: /^Present / });
    const presentation = page.getByRole("region", { name: "Presentation" });
    await expect(async () => {
      await presentButton.click();
      await expect(presentation).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 45_000 });
    await presentation
      .getByRole("button", { name: "Show speaker notes" })
      .click();
    await expect(
      presentation.getByText(updatedNotes, { exact: true }),
    ).toBeVisible();
  });

  test("deck diagnostics review traps focus, navigates, repairs, and persists an empty state", async ({
    page,
  }, testInfo) => {
    const { editor, canvas } = await openPresentationFixture(
      page,
      testInfo,
      "deckDiagnostics",
    );
    const diagnosticsTrigger = editor.getByRole("button", {
      name: /open deck diagnostics review \(1 diagnostic\)/i,
    });
    const dialog = page.getByRole("dialog", {
      name: "Deck diagnostics review",
    });
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    const goToTarget = dialog.getByRole("button", {
      name: /^Go to target for missing-asset:/,
    });
    const openAssetRepair = dialog.getByRole("button", {
      name: /^Open asset panel for missing-asset:/,
    });
    const imageNode = canvas.locator(
      '[data-node-id="fixture-image"][role="button"]',
    );

    await expect(diagnosticsTrigger).toBeVisible();
    await diagnosticsTrigger.click();
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    await expect(
      dialog.getByText(
        'Image node "fixture-image" references missing asset "e2e-missing-diagnostic-asset"',
        { exact: true },
      ),
    ).toBeVisible();

    await page.keyboard.press("Shift+Tab");
    await expect(openAssetRepair).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(diagnosticsTrigger).toBeFocused();

    await diagnosticsTrigger.click();
    await expect(dialog).toBeVisible();
    await dialog.locator("..").click({ position: { x: 2, y: 2 } });
    await expect(dialog).toHaveCount(0);
    await expect(diagnosticsTrigger).toBeFocused();

    await diagnosticsTrigger.click();
    await goToTarget.click();
    await expect(dialog).toHaveCount(0);
    await expect(imageNode).toHaveAttribute("aria-pressed", "true");

    await diagnosticsTrigger.click();
    const chooserPromise = page.waitForEvent("filechooser");
    await openAssetRepair.click();
    const chooser = await chooserPromise;
    await expect(dialog).toHaveCount(0);
    await waitForSlideAutosaveAfter(page, () =>
      chooser.setFiles({
        name: "diagnostic-repair.png",
        mimeType: "image/png",
        buffer: fixturePngBuffer(),
      }),
    );
    await expect(
      page.locator('[role="alert"]:not(#__next-route-announcer__)'),
    ).toHaveCount(0, { timeout: 15_000 });
    await expect(diagnosticsTrigger).toHaveCount(0);

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(canvas);
    await expect(diagnosticsTrigger).toHaveCount(0);

    const more = editor.getByRole("button", {
      name: "Open more deck commands",
    });
    await more.click();
    const moreMenu = page.getByRole("menu", { name: "More deck commands" });
    await moreMenu.getByRole("menuitem", { name: "Diagnostics 0" }).click();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("No diagnostics found across this deck.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        "This deck has no validation, render, asset, theme, source, or export diagnostics to review.",
        { exact: true },
      ),
    ).toBeVisible();
    await close.click();
    await expect(dialog).toHaveCount(0);
    await expect(more).toBeFocused();
  });

  test("custom theme authoring saves, re-enters the picker, applies, and persists", async ({
    page,
  }, testInfo) => {
    const { canvas } = await openPresentationFixture(
      page,
      testInfo,
      "customThemeAuthoring",
    );
    const picker = await openThemePicker(page);
    await picker
      .getByRole("button", { name: "Customize theme", exact: true })
      .click();

    const authoring = page.getByRole("dialog", { name: "Customize theme" });
    await expect(authoring).toBeVisible();
    await authoring
      .getByLabel("Name", { exact: true })
      .fill(E2E_CUSTOM_THEME_FIXTURE.name);
    await authoring
      .getByLabel("Slug", { exact: true })
      .fill(E2E_CUSTOM_THEME_FIXTURE.slug);
    await authoring
      .getByLabel("Version", { exact: true })
      .fill(E2E_CUSTOM_THEME_FIXTURE.version);
    await authoring
      .getByRole("button", { name: "Save brand kit", exact: true })
      .click();
    await expect(
      authoring.getByText(
        new RegExp(
          `Saved .*${E2E_CUSTOM_THEME_FIXTURE.slug}.*${E2E_CUSTOM_THEME_FIXTURE.version}`,
        ),
      ),
    ).toBeVisible();
    await authoring.getByRole("button", { name: "Close", exact: true }).click();
    await expect(authoring).toHaveCount(0);

    const reopenedPicker = await openThemePicker(page);
    await reopenedPicker
      .getByRole("textbox", { name: "Search themes" })
      .fill(E2E_CUSTOM_THEME_FIXTURE.name);
    const customOption = reopenedPicker.getByRole("option", {
      name: new RegExp(E2E_CUSTOM_THEME_FIXTURE.name),
    });
    await expect(customOption).toBeVisible();
    await customOption.click();
    await expect(
      page.getByRole("button", { name: "Deck theme" }),
    ).toContainText(E2E_CUSTOM_THEME_FIXTURE.name);
    await waitForSlideAutosave(page);

    await page.reload();
    await waitForStableSlideStage(canvas);
    await expect(
      page.getByRole("button", { name: "Deck theme" }),
    ).toContainText(E2E_CUSTOM_THEME_FIXTURE.name);
  });

  test("latest same-id catalog snapshot applies over the active exact version and survives reload", async ({
    page,
  }, testInfo) => {
    const { canvas } = await openPresentationFixture(
      page,
      testInfo,
      "versionedCustomTheme",
    );
    const deckTheme = page.getByRole("button", { name: "Deck theme" });
    await expect(deckTheme).toContainText(
      E2E_VERSIONED_THEME_FIXTURE.activeName,
    );

    const picker = await openThemePicker(page);
    await picker.getByRole("button", { name: "Recent", exact: true }).click();
    const latest = picker.getByRole("option", {
      name: new RegExp(E2E_VERSIONED_THEME_FIXTURE.latestName),
    });
    await expect(latest).toBeVisible();
    await expect(latest).toHaveAttribute("aria-selected", "false");
    await expect(
      picker.getByRole("option", {
        name: new RegExp(E2E_VERSIONED_THEME_FIXTURE.activeName),
      }),
    ).toHaveCount(0);
    await latest.click();
    await expect(deckTheme).toContainText(
      E2E_VERSIONED_THEME_FIXTURE.latestName,
    );
    await waitForSlideAutosave(page);

    await page.reload();
    await waitForStableSlideStage(canvas);
    await expect(deckTheme).toContainText(
      E2E_VERSIONED_THEME_FIXTURE.latestName,
    );
  });

  test("theme customization and custom guides restore their stable triggers across close paths", async ({
    page,
  }, testInfo) => {
    const { editor, canvas } = await openPresentationFixture(
      page,
      testInfo,
      "builtInTheme",
    );
    const deckTheme = page.getByRole("button", { name: "Deck theme" });
    const customizeDialog = page.getByRole("dialog", {
      name: "Customize theme",
    });

    for (const [index, closeWith] of ["button", "escape", "button"].entries()) {
      await test.step(`theme authoring close ${index + 1} via ${closeWith}`, async () => {
        const picker = await openThemePicker(page);
        await picker
          .getByRole("button", { name: "Customize theme", exact: true })
          .click();
        await expect(customizeDialog).toBeVisible();
        if (closeWith === "escape") {
          await page.keyboard.press("Escape");
        } else {
          await customizeDialog
            .getByRole("button", { name: "Close", exact: true })
            .click();
        }
        await expect(customizeDialog).toHaveCount(0);
        await expect(deckTheme).toBeFocused();
      });
    }

    const guidesTrigger = editor.getByRole("button", {
      name: "Manage custom guides",
    });
    const guidesDialog = page.getByRole("dialog", { name: "Custom guides" });

    await guidesTrigger.click();
    await guidesDialog.getByRole("button", { name: "Close" }).click();
    await expect(guidesDialog).toHaveCount(0);
    await expect(guidesTrigger).toBeFocused();

    await guidesTrigger.click();
    await page.keyboard.press("Escape");
    await expect(guidesDialog).toHaveCount(0);
    await expect(guidesTrigger).toBeFocused();

    await guidesTrigger.click();
    await canvas.click({ position: { x: 5, y: 5 } });
    await expect(guidesDialog).toHaveCount(0);
    await expect(guidesTrigger).toBeFocused();

    await guidesTrigger.click();
    await guidesDialog.getByRole("button", { name: "Close" }).click();
    await expect(guidesTrigger).toBeFocused();
  });
});

async function dragNodeCenterNearXGuide({
  page,
  editor,
  canvas,
  node,
  guideCenterPct,
  expectSnapGuide,
}: {
  page: Page;
  editor: Locator;
  canvas: Locator;
  node: Locator;
  guideCenterPct: number;
  expectSnapGuide: boolean;
}): Promise<FramePercent> {
  const [nodeBox, canvasBox] = await waitForStableLocatorBoxes([node, canvas]);
  const initial = await framePercent(node, canvas);
  const initialCenterPct = initial.x + initial.width / 2;
  const targetX =
    nodeBox.x +
    nodeBox.width / 2 +
    ((guideCenterPct - initialCenterPct) / 100) * canvasBox.width;
  const targetY = nodeBox.y + nodeBox.height / 2;

  await page.mouse.move(
    nodeBox.x + nodeBox.width / 2,
    nodeBox.y + nodeBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 8 });
  const snapGuide = editor.locator(".tiq-stage-snap-guide");
  if (expectSnapGuide) {
    await expect(snapGuide).toBeVisible();
  } else {
    await expect(snapGuide).toHaveCount(0);
  }
  await page.mouse.up();
  return framePercent(node, canvas);
}

test.describe("presentation grouped layer controls", () => {
  test.describe.configure({ retries: 0 });
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed the deterministic profile",
  );
  test.setTimeout(120_000);

  test("creates, persists, nests, reorders, and recursively ungroups UI-authored groups", async ({
    page,
  }, testInfo) => {
    const { editor, canvas } = await openPresentationFixture(
      page,
      testInfo,
      "groupLayerOrder",
    );
    const groupBack = canvas.locator(
      '[data-node-id="group-back"][role="button"]',
    );
    const groupFront = canvas.locator(
      '[data-node-id="group-front"][role="button"]',
    );
    const rootFront = canvas.locator(
      '[data-node-id="group-root-front"][role="button"]',
    );
    const childStageOrder = () =>
      canvas
        .locator(
          '[data-node-id="group-back"][role="button"], [data-node-id="group-front"][role="button"]',
        )
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-node-id")),
        );
    const openInspectorPanel = async (panel: "arrange" | "layers") => {
      await page
        .getByRole("toolbar", { name: "Context toolbar" })
        .getByRole("button", { name: /Open .* inspector/ })
        .click();
      const inspector = editor.getByRole("region", { name: "Inspector" });
      await expect(inspector).toBeVisible();
      await inspector
        .getByRole("combobox", { name: "Inspector panel" })
        .selectOption(panel);
      return inspector;
    };

    const initialBackFrame = await framePercent(groupBack, canvas);
    const initialFrontFrame = await framePercent(groupFront, canvas);
    await groupBack.click();
    await groupFront.click({ modifiers: ["Shift"] });
    await expect(groupBack).toHaveAttribute("aria-pressed", "true");
    await expect(groupFront).toHaveAttribute("aria-pressed", "true");

    let inspector = await openInspectorPanel("arrange");
    await inspector.getByRole("button", { name: "Group", exact: true }).click();
    const selectedInnerGroup = canvas.locator(
      '[data-node-type="group"][aria-pressed="true"]',
    );
    await expect(selectedInnerGroup).toHaveCount(1);
    const innerGroupId = await selectedInnerGroup.getAttribute("data-node-id");
    expect(innerGroupId).toBeTruthy();

    await waitForSlideAutosave(page);
    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(canvas);
    const innerGroup = canvas.locator(
      `[data-node-id="${innerGroupId}"][role="button"]`,
    );
    await expect(innerGroup).toBeVisible();
    await expect(groupBack).toBeVisible();
    await expect(groupFront).toBeVisible();
    expectFrameEqual(await framePercent(groupBack, canvas), initialBackFrame);
    expectFrameEqual(await framePercent(groupFront, canvas), initialFrontFrame);

    await innerGroup.click();
    inspector = await openInspectorPanel("layers");
    for (const nodeId of [innerGroupId!, "group-back", "group-front"]) {
      await expect(
        inspector.locator(`[data-layer-id="${nodeId}"]`),
      ).toBeVisible();
    }
    const childLayerOrder = () =>
      inspector
        .locator('[data-layer-id="group-back"], [data-layer-id="group-front"]')
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute("data-layer-id")),
        );
    expect(await childLayerOrder()).toEqual(["group-front", "group-back"]);
    await inspector
      .locator('[data-layer-id="group-front"]')
      .getByRole("button", { name: "Move layer backward" })
      .click();
    expect(await childLayerOrder()).toEqual(["group-back", "group-front"]);
    expect(await childStageOrder()).toEqual(["group-front", "group-back"]);

    await waitForSlideAutosave(page);
    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(canvas);
    expect(await childStageOrder()).toEqual(["group-front", "group-back"]);

    await innerGroup.click();
    await rootFront.click({ modifiers: ["Shift"] });
    inspector = await openInspectorPanel("arrange");
    await inspector.getByRole("button", { name: "Group", exact: true }).click();
    const selectedOuterGroup = canvas.locator(
      '[data-node-type="group"][aria-pressed="true"]',
    );
    await expect(selectedOuterGroup).toHaveCount(1);
    const outerGroupId = await selectedOuterGroup.getAttribute("data-node-id");
    expect(outerGroupId).toBeTruthy();

    await waitForSlideAutosave(page);
    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(canvas);
    const outerGroup = canvas.locator(
      `[data-node-id="${outerGroupId}"][role="button"]`,
    );
    await expect(outerGroup).toBeVisible();
    await outerGroup.click();
    inspector = await openInspectorPanel("layers");
    for (const nodeId of [
      outerGroupId!,
      innerGroupId!,
      "group-back",
      "group-front",
      "group-root-front",
    ]) {
      await expect(
        inspector.locator(`[data-layer-id="${nodeId}"]`),
      ).toBeVisible();
    }

    await inspector
      .locator(`[data-layer-id="${innerGroupId}"]`)
      .locator("button")
      .first()
      .click();
    await innerGroup.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Ungroup", exact: true }).click();
    await expect(innerGroup).toHaveCount(0);
    await expect(outerGroup).toBeVisible();
    await expect(groupBack).toBeVisible();
    await expect(groupFront).toBeVisible();

    await editor.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(innerGroup).toBeVisible();
    await editor.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(innerGroup).toHaveCount(0);

    await waitForSlideAutosave(page);
    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(canvas);
    await expect(innerGroup).toHaveCount(0);
    await expect(outerGroup).toBeVisible();
    expect(await childStageOrder()).toEqual(["group-front", "group-back"]);
    expectFrameEqual(await framePercent(groupBack, canvas), initialBackFrame);
    expectFrameEqual(await framePercent(groupFront, canvas), initialFrontFrame);

    await outerGroup.click();
    inspector = await openInspectorPanel("layers");
    await expect(
      inspector.locator(`[data-layer-id="${innerGroupId}"]`),
    ).toHaveCount(0);
    expect(await childLayerOrder()).toEqual(["group-back", "group-front"]);

    const publicPage = await page.context().newPage();
    const response = await publicPage.goto(
      profilePresentPath(
        PRESENTATION_CONTROL_FIXTURES.groupLayerOrder,
        testInfo,
      ),
    );
    expect(response?.status()).toBe(200);
    const publicCanvas = publicPage
      .locator('[data-public-present-viewer] [data-slide-canvas="true"]')
      .first();
    await expect(publicCanvas).toBeVisible({ timeout: 30_000 });
    const publicOrder = await publicCanvas
      .locator(
        `[data-node-id="group-root-back"], [data-node-id="${outerGroupId}"], [data-node-id="group-front"], [data-node-id="group-back"], [data-node-id="group-root-front"]`,
      )
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-node-id")),
      );
    expect(publicOrder).toEqual([
      "group-root-back",
      outerGroupId,
      "group-front",
      "group-back",
      "group-root-front",
    ]);
    await publicPage.close();
  });
});
