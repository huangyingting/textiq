import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { login } from "../helpers/auth";
import { POINTER_INTERACTION_FIXTURES } from "../helpers/presentation-fixtures";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileDocPath,
  profileOwnerCredentials,
} from "../helpers/profile";
import {
  waitForSlideAutosave,
  waitForSlideAutosaveAfter,
  waitForStableLocatorBox,
  waitForStableLocatorBoxes,
  waitForStableSlideStage,
} from "../helpers/readiness";

const STAGE_NODE_SELECTOR =
  '[data-slide-stage-viewport="true"] [data-slide-canvas="true"] [data-node-id][role="button"]';

async function openPointerFixture(
  page: Page,
  testInfo: TestInfo,
  fixtureName: (typeof POINTER_INTERACTION_FIXTURES)[keyof typeof POINTER_INTERACTION_FIXTURES],
): Promise<Locator> {
  await login(
    page,
    profileOwnerCredentials(),
    `${profileDocPath(fixtureName, testInfo)}/slides`,
  );
  const editor = page.locator('[data-slide-editor="true"]').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await waitForStableSlideStage(
    editor.locator('[data-slide-canvas="true"]').first(),
  );
  return editor;
}

async function dragFromCenter(
  page: Page,
  source: Locator,
  target: { x: number; y: number },
): Promise<void> {
  const box = await waitForStableLocatorBox(source);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
}

async function slideLabels(filmstrip: Locator): Promise<string[]> {
  const buttons = filmstrip.getByRole("button", {
    name: /^Slide \d+(: |$)/,
  });
  const labels: string[] = [];
  for (let index = 0; index < (await buttons.count()); index += 1) {
    labels.push((await buttons.nth(index).getAttribute("aria-label")) ?? "");
  }
  return labels;
}

async function selectInspectorPanel(
  page: Page,
  editor: Locator,
  panel: "arrange" | "image" | "line",
): Promise<Locator> {
  const inspector = editor.getByRole("region", { name: "Inspector" });
  if ((await inspector.count()) === 0) {
    await page
      .getByRole("toolbar", { name: "Context toolbar" })
      .getByRole("button", { name: /^Open .+ inspector$/ })
      .click();
  }
  await expect(inspector).toBeVisible();
  await inspector
    .getByRole("combobox", { name: "Inspector panel" })
    .selectOption(panel);
  return inspector;
}

async function readCrop(inspector: Locator): Promise<{
  top: number;
  right: number;
  bottom: number;
  left: number;
}> {
  return {
    top: Number(await inspector.getByLabel("Crop top").inputValue()),
    right: Number(await inspector.getByLabel("Crop right").inputValue()),
    bottom: Number(await inspector.getByLabel("Crop bottom").inputValue()),
    left: Number(await inspector.getByLabel("Crop left").inputValue()),
  };
}

async function readGeometry(inspector: Locator): Promise<{
  width: number;
  height: number;
  rotation: number;
}> {
  return {
    width: Number(
      await inspector.getByLabel("W", { exact: true }).inputValue(),
    ),
    height: Number(
      await inspector.getByLabel("H", { exact: true }).inputValue(),
    ),
    rotation: Number(
      await inspector.getByLabel("Rotation", { exact: true }).inputValue(),
    ),
  };
}

test.describe("presentation pointer interactions", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed the deterministic profile",
  );
  test.setTimeout(120_000);

  test("filmstrip pointer drag reorders slides and persists without a post-drag click rollback", async ({
    page,
  }, testInfo) => {
    const editor = await openPointerFixture(
      page,
      testInfo,
      POINTER_INTERACTION_FIXTURES.filmstripReorder,
    );
    const filmstrip = editor.locator('[aria-label="Slide filmstrip"]');
    const firstTitle = E2E_PROFILE_FIXTURE.slideTitleText;
    const secondTitle = E2E_PROFILE_FIXTURE.slideTwoTitleText;
    await expect(filmstrip).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => slideLabels(filmstrip), { timeout: 15_000 })
      .toEqual([`Slide 1: ${firstTitle}`, `Slide 2: ${secondTitle}`]);

    const firstSlide = filmstrip.getByRole("button", {
      name: `Slide 1: ${firstTitle}`,
    });
    const firstBox = await firstSlide.boundingBox();
    expect(firstBox).not.toBeNull();

    await page.mouse.move(
      firstBox!.x + firstBox!.width / 2,
      firstBox!.y + firstBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      firstBox!.x + firstBox!.width / 2 + 2,
      firstBox!.y + firstBox!.height / 2,
    );
    await page.mouse.up();
    await expect
      .poll(() => slideLabels(filmstrip))
      .toEqual([`Slide 1: ${firstTitle}`, `Slide 2: ${secondTitle}`]);
    await expect(firstSlide).toHaveAttribute("aria-current", "true");

    const secondSlide = filmstrip.getByRole("button", {
      name: `Slide 2: ${secondTitle}`,
    });
    const secondBox = await secondSlide.boundingBox();
    expect(secondBox).not.toBeNull();
    await dragFromCenter(page, firstSlide, {
      x: secondBox!.x + secondBox!.width - 4,
      y: secondBox!.y + secondBox!.height / 2,
    });

    await expect
      .poll(() => slideLabels(filmstrip))
      .toEqual([`Slide 1: ${secondTitle}`, `Slide 2: ${firstTitle}`]);
    await expect(
      filmstrip.getByRole("button", { name: `Slide 2: ${firstTitle}` }),
    ).toHaveAttribute("aria-current", "true");
    await waitForSlideAutosave(page);

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );
    await expect
      .poll(() => slideLabels(filmstrip))
      .toEqual([`Slide 1: ${secondTitle}`, `Slide 2: ${firstTitle}`]);
  });

  test("resize and rotation handles update geometry, undo, and persist committed pointer changes", async ({
    page,
  }, testInfo) => {
    const editor = await openPointerFixture(
      page,
      testInfo,
      POINTER_INTERACTION_FIXTURES.nodeGeometry,
    );
    const bodyNode = editor
      .locator(`${STAGE_NODE_SELECTOR}[data-node-id="fixture-bullets"]`)
      .first();
    await bodyNode.click();
    await expect(bodyNode).toHaveAttribute("aria-pressed", "true");

    let inspector = await selectInspectorPanel(page, editor, "arrange");
    const initial = await readGeometry(inspector);
    const resizeHandle = editor.locator(
      '[data-node-chrome-overlay="resize"][data-node-id="fixture-bullets"] [data-resize-handle="se"]',
    );
    await expect(resizeHandle).toBeVisible();
    const resizeBox = await resizeHandle.boundingBox();
    expect(resizeBox).not.toBeNull();
    await dragFromCenter(page, resizeHandle, {
      x: resizeBox!.x + resizeBox!.width / 2 + 48,
      y: resizeBox!.y + resizeBox!.height / 2 + 28,
    });

    await expect
      .poll(async () => (await readGeometry(inspector)).width)
      .toBeGreaterThan(initial.width);
    await expect
      .poll(async () => (await readGeometry(inspector)).height)
      .toBeGreaterThan(initial.height);
    await expect(bodyNode).toHaveAttribute("aria-pressed", "true");

    const undo = editor.getByRole("button", { name: "Undo", exact: true });
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect.poll(() => readGeometry(inspector)).toEqual(initial);

    const rotationHandle = editor.locator(
      '[data-node-chrome-overlay="rotation"][data-node-id="fixture-bullets"] [data-rotation-handle="true"]',
    );
    await expect(rotationHandle).toBeVisible();
    const nodeBox = await bodyNode.boundingBox();
    expect(nodeBox).not.toBeNull();
    await dragFromCenter(page, rotationHandle, {
      x: nodeBox!.x + nodeBox!.width + 36,
      y: nodeBox!.y + nodeBox!.height / 2,
    });
    await expect
      .poll(async () => (await readGeometry(inspector)).rotation)
      .not.toBe(initial.rotation);
    await expect(bodyNode).toHaveAttribute("aria-pressed", "true");

    await undo.click();
    await expect.poll(() => readGeometry(inspector)).toEqual(initial);

    const committedResizeBox = await resizeHandle.boundingBox();
    expect(committedResizeBox).not.toBeNull();
    await dragFromCenter(page, resizeHandle, {
      x: committedResizeBox!.x + committedResizeBox!.width / 2 + 36,
      y: committedResizeBox!.y + committedResizeBox!.height / 2 + 20,
    });
    await expect
      .poll(async () => (await readGeometry(inspector)).width)
      .toBeGreaterThan(initial.width);
    await expect
      .poll(async () => (await readGeometry(inspector)).height)
      .toBeGreaterThan(initial.height);
    await waitForSlideAutosave(page);

    const committedNodeBox = await bodyNode.boundingBox();
    expect(committedNodeBox).not.toBeNull();
    await dragFromCenter(page, rotationHandle, {
      x: committedNodeBox!.x + committedNodeBox!.width + 28,
      y: committedNodeBox!.y + committedNodeBox!.height / 2,
    });
    await expect
      .poll(async () => (await readGeometry(inspector)).rotation)
      .not.toBe(initial.rotation);
    const committed = await readGeometry(inspector);
    expect(committed.width).toBeGreaterThan(initial.width);
    expect(committed.height).toBeGreaterThan(initial.height);
    expect(committed.rotation).not.toBe(initial.rotation);
    await waitForSlideAutosave(page);

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );
    await bodyNode.click();
    inspector = await selectInspectorPanel(page, editor, "arrange");
    await expect.poll(() => readGeometry(inspector)).toEqual(committed);
    await expect(bodyNode).toHaveAttribute("aria-pressed", "true");
    await expect(resizeHandle).toBeVisible();
  });

  test("connector endpoint pointer drag snaps to a node and persists the binding", async ({
    page,
  }, testInfo) => {
    const editor = await openPointerFixture(
      page,
      testInfo,
      POINTER_INTERACTION_FIXTURES.connectorSnap,
    );
    const insertConnector = page
      .getByRole("toolbar", { name: "Context toolbar" })
      .getByRole("button", { name: "Insert connector", exact: true })
      .first();
    await expect(insertConnector).toBeVisible();
    await insertConnector.click();

    const connector = editor
      .locator(`${STAGE_NODE_SELECTOR}[data-node-type="connector"]`)
      .first();
    await expect(connector).toBeVisible();
    await expect(connector).toHaveAttribute("aria-pressed", "true");
    await waitForSlideAutosave(page);
    let inspector = await selectInspectorPanel(page, editor, "line");
    await expect(
      inspector.getByRole("combobox", { name: "to endpoint kind" }),
    ).toHaveValue("point");

    const targetNode = editor
      .locator(`${STAGE_NODE_SELECTOR}[data-node-id="fixture-image"]`)
      .first();
    await expect(targetNode).toBeVisible();
    const endpointHandle = editor.locator(
      '[data-node-chrome-overlay="connector-endpoints"] [data-connector-endpoint="to"]',
    );
    await expect(endpointHandle).toBeVisible();
    const [endpointBox, settledTargetBox] = await waitForStableLocatorBoxes([
      endpointHandle,
      targetNode,
    ]);
    await page.mouse.move(
      endpointBox.x + endpointBox.width / 2,
      endpointBox.y + endpointBox.height / 2,
    );
    await page.mouse.down();
    const target = {
      x: settledTargetBox.x + settledTargetBox.width / 2,
      y: settledTargetBox.y + settledTargetBox.height / 2,
    };
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.move(target.x + 1, target.y);
    await page.mouse.move(target.x, target.y);
    await page.mouse.up();

    await expect(
      inspector.getByRole("combobox", { name: "to endpoint kind" }),
    ).toHaveValue("node");
    await expect(inspector.getByLabel("to node id")).toHaveValue(
      "fixture-image",
    );
    await expect(
      inspector.getByRole("combobox", { name: "to anchor" }),
    ).toHaveValue("center");
    await waitForSlideAutosave(page);

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );
    await connector.click();
    inspector = await selectInspectorPanel(page, editor, "line");
    await expect(
      inspector.getByRole("combobox", { name: "to endpoint kind" }),
    ).toHaveValue("node");
    await expect(inspector.getByLabel("to node id")).toHaveValue(
      "fixture-image",
    );
  });

  test("keyboard connector endpoint editing free-draws both ends and persists", async ({
    page,
  }, testInfo) => {
    const editor = await openPointerFixture(
      page,
      testInfo,
      POINTER_INTERACTION_FIXTURES.connectorSnap,
    );
    const insertConnector = page
      .getByRole("toolbar", { name: "Context toolbar" })
      .getByRole("button", { name: "Insert connector", exact: true })
      .first();
    await expect(insertConnector).toBeVisible();
    await insertConnector.click();

    const connector = editor
      .locator(`${STAGE_NODE_SELECTOR}[data-node-type="connector"]`)
      .first();
    await expect(connector).toBeVisible();
    await expect(connector).toHaveAttribute("aria-pressed", "true");

    let inspector = await selectInspectorPanel(page, editor, "arrange");
    const initialGeometry = await readGeometry(inspector);
    const liveRegion = editor
      .locator('.sr-only[aria-live="polite"][aria-atomic="true"]')
      .first();

    await connector.focus();
    await page.keyboard.press("Enter");
    await expect(liveRegion).toHaveText(
      "Editing connector end endpoint. Use Arrow keys to move, Shift+Arrow for 5%, Tab to switch endpoints, Enter or Escape to finish.",
    );

    await waitForSlideAutosaveAfter(page, async () => {
      await page.keyboard.press("Shift+ArrowRight");
      await expect(liveRegion).toHaveText(
        "Moved connector end endpoint right by 5%",
      );
      await page.keyboard.press("Tab");
      await expect(liveRegion).toHaveText("Editing connector start endpoint");
      await page.keyboard.press("Shift+ArrowUp");
      await expect(liveRegion).toHaveText(
        "Moved connector start endpoint up by 5%",
      );
      await page.keyboard.press("Enter");
      await expect(liveRegion).toHaveText(
        "Connector endpoint editing finished",
      );
    });

    const committedGeometry = await readGeometry(inspector);
    expect(committedGeometry.width).toBeGreaterThan(initialGeometry.width);
    expect(committedGeometry.height).not.toBe(initialGeometry.height);
    inspector = await selectInspectorPanel(page, editor, "line");
    await expect(
      inspector.getByRole("combobox", { name: "from endpoint kind" }),
    ).toHaveValue("point");
    await expect(
      inspector.getByRole("combobox", { name: "to endpoint kind" }),
    ).toHaveValue("point");

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );
    await connector.click();
    inspector = await selectInspectorPanel(page, editor, "arrange");
    await expect.poll(() => readGeometry(inspector)).toEqual(committedGeometry);
  });

  test("image crop handles, inspector values, history, reset, and reload stay in sync", async ({
    page,
  }, testInfo) => {
    const editor = await openPointerFixture(
      page,
      testInfo,
      POINTER_INTERACTION_FIXTURES.imageCrop,
    );
    const canvas = editor.locator('[data-slide-canvas="true"]').first();
    const imageNode = editor
      .locator(`${STAGE_NODE_SELECTOR}[data-node-id="fixture-image"]`)
      .first();
    await imageNode.click();
    await expect(imageNode).toHaveAttribute("aria-pressed", "true");

    let inspector = await selectInspectorPanel(page, editor, "image");
    const initialCrop = { top: 0, right: 0, bottom: 0, left: 0 };
    await expect.poll(() => readCrop(inspector)).toEqual(initialCrop);

    const toolbar = page.getByRole("toolbar", { name: "Context toolbar" });
    const cropToggle = toolbar.getByRole("button", { name: "Crop image" });
    const resetCrop = toolbar.getByRole("button", { name: "Reset crop" });
    const undo = editor.getByRole("button", { name: "Undo", exact: true });
    const redo = editor.getByRole("button", { name: "Redo", exact: true });
    await expect(cropToggle).toHaveAttribute("aria-pressed", "false");
    await expect(resetCrop).toBeDisabled();

    const rightHandle = editor.locator(
      '[data-node-chrome-overlay="crop"][data-node-id="fixture-image"] [data-crop-handle="right"]',
    );
    await expect(rightHandle).toBeVisible();
    const handleBox = await waitForStableLocatorBox(rightHandle);
    await waitForSlideAutosaveAfter(page, () =>
      dragFromCenter(page, rightHandle, {
        x: handleBox.x + handleBox.width / 2 - 32,
        y: handleBox.y + handleBox.height / 2,
      }),
    );
    const pointerCrop = await readCrop(inspector);
    expect(pointerCrop.right).toBeGreaterThan(5);
    expect(pointerCrop.top).toBe(0);
    expect(pointerCrop.bottom).toBe(0);
    expect(pointerCrop.left).toBe(0);
    await expect(cropToggle).toHaveAttribute("aria-pressed", "true");
    await expect(resetCrop).toBeEnabled();
    const croppedImage = imageNode.locator("img");
    await expect(croppedImage).toHaveCSS("position", "absolute");
    expect(
      await croppedImage.evaluate((node) =>
        Number.parseFloat(node.style.width),
      ),
    ).toBeGreaterThan(100);

    await waitForSlideAutosaveAfter(page, () => undo.click());
    await expect.poll(() => readCrop(inspector)).toEqual(initialCrop);
    await expect(resetCrop).toBeDisabled();
    await waitForSlideAutosaveAfter(page, () => redo.click());
    await expect.poll(() => readCrop(inspector)).toEqual(pointerCrop);

    await waitForSlideAutosaveAfter(page, () => cropToggle.click());
    await expect.poll(() => readCrop(inspector)).toEqual(initialCrop);
    await waitForSlideAutosaveAfter(page, () => cropToggle.click());
    const defaultCrop = { top: 8, right: 8, bottom: 8, left: 8 };
    await expect.poll(() => readCrop(inspector)).toEqual(defaultCrop);

    await waitForSlideAutosaveAfter(page, () =>
      inspector.getByLabel("Crop top").fill("12"),
    );
    await waitForSlideAutosaveAfter(page, () =>
      inspector.getByLabel("Crop right").fill("0"),
    );
    await waitForSlideAutosaveAfter(page, () =>
      inspector.getByLabel("Crop left").fill("95"),
    );
    await waitForSlideAutosaveAfter(page, () =>
      inspector.getByLabel("Crop right").fill("95"),
    );
    const persistedCrop = {
      ...defaultCrop,
      top: 12,
      right: 3,
      left: 95,
    };
    await expect.poll(() => readCrop(inspector)).toEqual(persistedCrop);

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(canvas);
    await imageNode.click();
    inspector = await selectInspectorPanel(page, editor, "image");
    await expect.poll(() => readCrop(inspector)).toEqual(persistedCrop);
    await expect(resetCrop).toBeEnabled();

    await waitForSlideAutosaveAfter(page, () => resetCrop.click());
    await expect.poll(() => readCrop(inspector)).toEqual(initialCrop);
    await waitForSlideAutosaveAfter(page, () => undo.click());
    await expect.poll(() => readCrop(inspector)).toEqual(persistedCrop);
    await waitForSlideAutosaveAfter(page, () => redo.click());
    await expect.poll(() => readCrop(inspector)).toEqual(initialCrop);

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(canvas);
    await imageNode.click();
    inspector = await selectInspectorPanel(page, editor, "image");
    await expect.poll(() => readCrop(inspector)).toEqual(initialCrop);
    await expect(resetCrop).toBeDisabled();
  });
});
