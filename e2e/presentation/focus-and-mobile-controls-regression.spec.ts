import { expect, test, type Locator, type Page } from "@playwright/test";

import { login } from "../helpers/auth";
import {
  e2eProfileEnabled,
  profileDocPath,
  profileOwnerCredentials,
} from "../helpers/profile";
import { waitForStableSlideStage } from "../helpers/readiness";

const FIXTURE_NAME = "focusAndMobileControls";

test.describe("presentation focus and mobile control regressions", () => {
  test.skip(!e2eProfileEnabled(), "Seed the E2E profile and set E2E_PROFILE=1");
  test.describe.configure({ mode: "serial" });
  test.setTimeout(90_000);

  test("shortcut help restores the current opener across Escape, Close, and reopen cycles", async ({
    page,
  }) => {
    const editor = await openSeededSlideEditor(page, 1280, 900);
    const shortcutDialog = page.getByRole("dialog", {
      name: "Keyboard shortcuts",
    });

    await editor.focus();
    await page.keyboard.press("?");
    await expect(shortcutDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(shortcutDialog).toHaveCount(0);
    await expect(editor).toBeFocused();

    await page.keyboard.press("?");
    await expect(shortcutDialog).toBeVisible();
    await shortcutDialog.getByRole("button", { name: "Close" }).click();
    await expect(shortcutDialog).toHaveCount(0);
    await expect(editor).toBeFocused();

    const moreButton = editor.getByRole("button", {
      name: "Open more deck commands",
    });
    await moreButton.click();
    await page.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
    await expect(shortcutDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(shortcutDialog).toHaveCount(0);
    await expect(moreButton).toBeFocused();

    await moreButton.click();
    await page.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
    await expect(shortcutDialog).toBeVisible();
    await shortcutDialog.getByRole("button", { name: "Close" }).click();
    await expect(shortcutDialog).toHaveCount(0);
    await expect(moreButton).toBeFocused();
  });

  test("closing the full slide editor restores focus to the document toolbar opener", async ({
    page,
  }) => {
    const documentPath = profileDocPath(FIXTURE_NAME, test.info());
    await login(page, profileOwnerCredentials(), documentPath);

    const opener = page.getByRole("link", { name: "Open slide editor" });
    await expect(opener).toBeVisible({ timeout: 30_000 });
    await opener.focus();
    await opener.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${documentPath}/slides$`));

    const editor = page.locator('[data-slide-editor="true"]').first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await editor.getByRole("button", { name: "Close slide editor" }).click();

    await expect(page).toHaveURL(new RegExp(`${documentPath}$`), {
      timeout: 30_000,
    });
    const returnedOpener = page.getByRole("link", {
      name: "Open slide editor",
    });
    await expect(returnedOpener).toBeVisible({ timeout: 30_000 });
    await expect(returnedOpener).toBeFocused();
  });

  test("forced-colors keeps the focused stage node visibly outlined", async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ forcedColors: "active" });
    const editor = await openSeededSlideEditor(page, 1280, 900);
    const stageNode = editor
      .locator(
        '[data-slide-stage-viewport="true"] [data-node-id][role="button"]',
      )
      .first();

    await stageNode.focus();
    await expect(stageNode).toBeFocused();
    await expect(stageNode).toHaveCSS("outline-style", "solid");
    await expect(stageNode).toHaveCSS("outline-width", "2px");
    await expect(stageNode).toHaveCSS("outline-offset", "2px");

    const outlineColor = await stageNode.evaluate(
      (node) => getComputedStyle(node).outlineColor,
    );
    expect(outlineColor).not.toBe("transparent");
    expect(outlineColor).not.toBe("rgba(0, 0, 0, 0)");

    await stageNode.screenshot({
      path: testInfo.outputPath("forced-colors-focused-stage-node.png"),
    });
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 412, height: 915 },
  ]) {
    test(`mobile Edit slide and Add slide controls stay independently actionable at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      const editor = await openSeededSlideEditor(
        page,
        viewport.width,
        viewport.height,
      );
      const editSlide = editor.getByRole("button", { name: "Edit slide" });
      const addSlide = editor.getByRole("button", { name: "Add slide" });

      await expect(editSlide).toBeVisible();
      await expect(addSlide).toBeVisible();
      const editBox = await requiredBox(editSlide);
      const addBox = await requiredBox(addSlide);
      expect(rectanglesOverlap(editBox, addBox)).toBe(false);
      await expectCenterHit(editSlide);
      await expectCenterHit(addSlide);

      await editSlide.click();
      const slideInspector = page.getByRole("dialog", {
        name: "Slide inspector",
      });
      await expect(slideInspector).toBeVisible();
      await slideInspector
        .getByRole("button", { name: "Close slide inspector" })
        .click();
      await expect(slideInspector).toHaveCount(0);

      await addSlide.click();
      const addSlideDialog = page.getByRole("dialog", {
        name: "Add semantic slide",
      });
      await expect(addSlideDialog).toBeVisible();
      await addSlideDialog.getByRole("button", { name: "Close" }).click();
      await expect(addSlideDialog).toHaveCount(0);

      const firstStageNode = editor
        .locator(
          '[data-slide-stage-viewport="true"] [data-node-id][role="button"]',
        )
        .first();
      await firstStageNode.focus();
      await firstStageNode.press("Enter");
      const editText = editor.getByRole("button", { name: "Edit text" });
      await expect(editText).toBeVisible();
      await editText.click();
      const textInspector = page.getByRole("dialog", {
        name: "Text inspector",
      });
      await expect(textInspector).toBeVisible();
      await textInspector
        .getByRole("button", { name: "Show Arrange inspector panel" })
        .click();
      await expect(
        textInspector.getByRole("heading", { name: "Geometry" }),
      ).toBeVisible();
    });
  }

  test("desktop keeps Add slide actionable without rendering the mobile Edit slide control", async ({
    page,
  }) => {
    const editor = await openSeededSlideEditor(page, 1280, 900);
    await expect(
      editor.getByRole("button", { name: "Edit slide" }),
    ).toHaveCount(0);

    const addSlide = editor.getByRole("button", { name: "Add slide" });
    await expect(addSlide).toBeVisible();
    await expectCenterHit(addSlide);
    await addSlide.click();
    await expect(
      page.getByRole("dialog", { name: "Add semantic slide" }),
    ).toBeVisible();
  });
});

async function openSeededSlideEditor(
  page: Page,
  width: number,
  height: number,
): Promise<Locator> {
  await page.setViewportSize({ width, height });
  await login(
    page,
    profileOwnerCredentials(),
    `${profileDocPath(FIXTURE_NAME, test.info())}/slides`,
  );
  const editor = page.locator('[data-slide-editor="true"]').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await waitForStableSlideStage(
    editor.locator('[data-slide-canvas="true"]').first(),
  );
  return editor;
}

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

function rectanglesOverlap(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}

async function expectCenterHit(locator: Locator): Promise<void> {
  const hit = await locator.evaluate((control) => {
    const rect = control.getBoundingClientRect();
    const target = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return {
      actionable: Boolean(target && control.contains(target)),
      targetTag: target?.tagName ?? null,
    };
  });
  expect(hit.actionable, `center hit resolved to ${hit.targetTag}`).toBe(true);
}
