import { expect, test, type Locator } from "@playwright/test";

import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileDocPath,
  profilePresentPath,
} from "../helpers/profile";
import {
  waitForSlideAutosaveAfter,
  waitForStableSlideStage,
} from "../helpers/readiness";
import { loginAsProfileOwner } from "./helpers";

async function textGeometry(node: Locator) {
  return node.evaluate((element) => {
    const paragraphs = element.querySelectorAll("p");
    const lastParagraph = paragraphs.item(paragraphs.length - 1);
    if (!lastParagraph) throw new Error("Slide text paragraph is missing.");
    const range = document.createRange();
    range.selectNodeContents(lastParagraph);
    const lastLineBottom = range.getBoundingClientRect().bottom;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const firstText = walker.nextNode();
    if (!firstText) throw new Error("Slide text is missing.");
    range.setStart(firstText, 0);
    range.setEnd(firstText, 1);
    return {
      bottom: element.getBoundingClientRect().bottom,
      lastLineBottom,
      glyphHeight: range.getBoundingClientRect().height,
    };
  });
}

test.describe("UI matrix: presentation shell, render, export, and status", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run presentation UI matrix checks",
  );
  test.setTimeout(90_000);

  test("canonical slide editor route renders shell, stage, and deck actions", async ({
    page,
  }) => {
    await loginAsProfileOwner(page, `${profileDocPath()}/slides`);

    const editor = page.locator('[data-slide-editor="true"]').first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );
    await expect(
      editor.getByRole("button", { name: "Present slides" }),
    ).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "Share slides" }),
    ).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "Export slides" }),
    ).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "Open more deck commands" }),
    ).toBeVisible();
  });

  test("command palette filters and runs insert and panel commands", async ({
    page,
  }) => {
    await loginAsProfileOwner(
      page,
      `${profileDocPath("uiCommandPalette", test.info())}/slides`,
    );

    const editor = page.locator('[data-slide-editor="true"]').first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(
      editor.locator('[data-slide-canvas="true"]').first(),
    );

    // Scope text-node counting to the main stage viewport only (excluding
    // filmstrip thumbnail canvases which also render text nodes).
    const stageViewport = editor.locator('[data-slide-stage-viewport="true"]');
    const textNodes = stageViewport.locator('[data-node-type="text"]');
    const textCountBefore = await textNodes.count();
    // Give the slide editor keyboard focus so the Ctrl/Meta+K shortcut reaches
    // its keydown handler without selecting a canvas element or triggering a
    // popover that would interfere with command-palette interaction.
    await editor.focus();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+K" : "Control+K",
    );
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    await palette
      .getByRole("combobox", { name: "Search commands" })
      .fill("insert text");
    const insertText = palette.getByRole("option", {
      name: /^Insert text\b/,
    });
    await expect(insertText).toBeVisible();
    await insertText.click();
    await expect(textNodes).toHaveCount(textCountBefore + 1);

    // The inserted text node is now selected. Deselect it (slide becomes
    // current object) before the next palette open: "Open Notes panel" is only
    // available when no node is selected (notes is a slide-level panel).
    await editor.focus();
    await page.keyboard.press("Escape");
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+K" : "Control+K",
    );
    await expect(palette).toBeVisible();
    await palette
      .getByRole("combobox", { name: "Search commands" })
      .fill("open notes");
    const openNotes = palette.getByRole("option", {
      name: /^Open Notes panel\b/,
    });
    await expect(openNotes).toBeVisible();
    await openNotes.click();
    await expect(
      editor.getByRole("textbox", { name: "Speaker Notes" }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("filmstrip exposes both seeded slides and their controls", async ({
    page,
  }) => {
    await loginAsProfileOwner(page, `${profileDocPath()}/slides`);
    const editor = page.locator('[data-slide-editor="true"]').first();
    await expect(editor).toBeVisible({ timeout: 30_000 });

    const filmstrip = editor.locator('[aria-label="Slide filmstrip"]');
    await expect(
      filmstrip.getByRole("button", { name: /^Slide \d+(: |$)/ }),
    ).toHaveCount(2);
    await expect(
      filmstrip.getByRole("button", {
        name: new RegExp(
          `^Slide 1: ${E2E_PROFILE_FIXTURE.slideTitleText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        ),
      }),
    ).toBeVisible();
    await expect(
      filmstrip.getByRole("button", {
        name: new RegExp(
          `^Slide 2: ${E2E_PROFILE_FIXTURE.slideTwoTitleText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        ),
      }),
    ).toBeVisible();
    await expect(
      filmstrip.getByRole("button", { name: "Add slide" }),
    ).toBeVisible();
  });

  test("bottom dock zoom controls change canvas geometry without entering deck history", async ({
    page,
  }) => {
    await loginAsProfileOwner(page, `${profileDocPath()}/slides`);
    const editor = page.locator('[data-slide-editor="true"]').first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    const canvas = editor.locator('[data-slide-canvas="true"]').first();
    const stageFrame = editor.locator('[data-slide-stage-frame="true"]');
    const stageFrameWidth = async () => {
      const box = await stageFrame.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.width).toBeGreaterThan(0);
      return box?.width ?? 0;
    };
    await waitForStableSlideStage(canvas);

    await expect(
      editor.getByRole("button", { name: "Hide slide thumbnails" }),
    ).toBeVisible();
    await expect(editor.getByRole("button", { name: "Notes" })).toBeVisible();
    const zoomSlider = editor.getByRole("slider", { name: "Slide zoom" });
    const zoomTrigger = editor.getByRole("button", {
      name: /^Set slide zoom \(\d+%\)$/,
    });
    const undo = editor.getByRole("button", { name: "Undo", exact: true });
    await expect(zoomSlider).toBeVisible();
    await expect(zoomSlider).toHaveValue("100");
    await expect(undo).toBeDisabled();
    const fitWidth = await stageFrameWidth();
    const bodyText = canvas
      .locator('[data-node-type="text"]')
      .filter({ hasText: "Second deterministic point" });
    const fitGlyphHeight = (await textGeometry(bodyText)).glyphHeight;

    await zoomSlider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(zoomSlider).toHaveValue("105");
    await expect(zoomTrigger).toHaveAccessibleName("Set slide zoom (105%)");
    await expect(undo).toBeDisabled();

    await zoomTrigger.click();
    const zoomMenu = page.getByRole("menu", { name: "Zoom presets" });
    await expect(zoomMenu).toBeVisible();
    const zoom200 = zoomMenu.getByRole("menuitemradio", { name: "200%" });
    const zoom150 = zoomMenu.getByRole("menuitemradio", { name: "150%" });
    await expect(zoom200).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(zoom150).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(zoomMenu).toHaveCount(0);
    await expect(zoomSlider).toHaveValue("150");
    await expect(zoomTrigger).toBeFocused();
    await waitForStableSlideStage(stageFrame);
    const zoomedWidth = await stageFrameWidth();
    expect(zoomedWidth / fitWidth).toBeCloseTo(1.5, 1);
    expect(
      (await textGeometry(bodyText)).glyphHeight / fitGlyphHeight,
    ).toBeCloseTo(1.5, 1);
    await expect(undo).toBeDisabled();

    await zoomTrigger.click();
    await zoomMenu
      .getByRole("menuitemradio", { name: "25%", exact: true })
      .click();
    await expect(zoomSlider).toHaveValue("25");
    await waitForStableSlideStage(stageFrame);
    const minimumWidth = await stageFrameWidth();
    expect(minimumWidth / fitWidth).toBeCloseTo(0.25, 1);
    expect(
      (await textGeometry(bodyText)).glyphHeight / fitGlyphHeight,
    ).toBeCloseTo(0.25, 1);
    await expect(undo).toBeDisabled();

    await zoomTrigger.click();
    await zoomMenu.getByRole("menuitem", { name: "Fit", exact: true }).click();
    await expect(zoomSlider).toHaveValue("100");
    await waitForStableSlideStage(stageFrame);
    const restoredWidth = await stageFrameWidth();
    expect(restoredWidth / fitWidth).toBeCloseTo(1, 2);
    await expect(undo).toBeDisabled();

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(canvas);
    await expect(zoomSlider).toHaveValue("100");
    await expect(undo).toBeDisabled();
  });

  test("public present route exposes first-slide content and navigation controls", async ({
    page,
  }) => {
    const response = await page.goto(profilePresentPath());
    expect(response?.status()).toBe(200);
    const region = page.getByRole("region", { name: /^Presentation/ });
    await expect(region).toBeVisible({ timeout: 20_000 });
    const progress = region.getByRole("progressbar", {
      name: "Presentation progress",
    });
    await expect(progress).toHaveAttribute("aria-valuemax", "2");
    await expect(progress).toHaveAttribute("aria-valuenow", "1");
    await expect(
      page
        .getByText(E2E_PROFILE_FIXTURE.slideTitleText, { exact: false })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: "Next slide" }).last(),
    ).toBeVisible();
  });

  test("public slide text remains inside its frame at desktop and narrow widths", async ({
    page,
  }) => {
    for (const width of [960, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(profilePresentPath());
      const canvas = page.locator('[data-slide-canvas="true"]:visible').first();
      await waitForStableSlideStage(canvas);
      await page.evaluate(() => document.fonts.ready);
      const body = canvas
        .locator('[data-node-type="text"]')
        .filter({ hasText: "Second deterministic point" });
      const geometry = await textGeometry(body);
      expect(geometry.lastLineBottom).toBeLessThanOrEqual(geometry.bottom + 1);
    }
  });

  test("responsive stage typography and inline editing use the same design scale", async ({
    page,
  }) => {
    await loginAsProfileOwner(
      page,
      `${profileDocPath("responsiveSlideText", test.info())}/slides`,
    );
    const editor = page.locator('[data-slide-editor="true"]').first();
    const canvas = editor
      .locator('[data-slide-stage-viewport="true"] [data-slide-canvas="true"]')
      .first();
    let normalizedGlyphHeight: number | undefined;
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await waitForStableSlideStage(canvas);
      await page.evaluate(() => document.fonts.ready);
      const body = canvas
        .locator('[data-node-type="text"]')
        .filter({ hasText: "Second deterministic point" });
      const geometry = await textGeometry(body);
      expect(geometry.lastLineBottom).toBeLessThanOrEqual(geometry.bottom + 1);
      const canvasBox = await canvas.boundingBox();
      if (!canvasBox) throw new Error("Slide canvas geometry is missing.");
      const normalized = geometry.glyphHeight / canvasBox.width;
      if (normalizedGlyphHeight !== undefined) {
        expect(normalized).toBeCloseTo(normalizedGlyphHeight, 3);
        await body.dblclick();
        const inline = editor.getByRole("textbox", {
          name: "Edit text",
          exact: true,
        });
        await expect(inline).toBeVisible();
        const editing = await textGeometry(inline);
        expect(editing.glyphHeight).toBeCloseTo(geometry.glyphHeight, 0);
        await inline.focus();
        await expect(inline).toBeFocused();
        const message =
          "Responsive slide editing persists at the authored font size";
        await waitForSlideAutosaveAfter(page, async () => {
          await inline.press("ControlOrMeta+A");
          await page.keyboard.insertText("Native keyboard replacement");
          await expect(inline).toHaveText("Native keyboard replacement");
          await inline.fill(message);
          await expect(inline).toHaveText(message);
          await page.keyboard.press("Escape");
        });
        await page.reload();
        await expect(canvas.getByText(message, { exact: true })).toBeVisible();
        const persisted = canvas
          .locator('[data-node-type="text"]')
          .filter({ hasText: message });
        expect((await textGeometry(persisted)).glyphHeight).toBeCloseTo(
          geometry.glyphHeight,
          0,
        );
      }
      normalizedGlyphHeight = normalized;
    }
  });
});
