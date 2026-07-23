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
  e2eProfileEnabled,
  profileDocPath,
  profileOwnerCredentials,
  profilePresentPath,
} from "../helpers/profile";
import {
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
    | "groupLayerOrder",
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

    await page.reload();
    await waitForStableSlideStage(canvas);
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

    for (const closeWith of ["button", "escape", "button"] as const) {
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
