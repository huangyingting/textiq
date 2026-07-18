import { expect, test } from "@playwright/test";

import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileDocPath,
  profilePresentPath,
} from "../helpers/profile";
import { waitForStableSlideStage } from "../helpers/readiness";
import { loginAsProfileOwner } from "./helpers";

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

    const filmstrip = editor.getByRole("list", { name: "Slides" });
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

  test("bottom dock exposes notes, rail, and zoom controls", async ({
    page,
  }) => {
    await loginAsProfileOwner(page, `${profileDocPath()}/slides`);
    const editor = page.locator('[data-slide-editor="true"]').first();
    await expect(editor).toBeVisible({ timeout: 30_000 });

    await expect(
      editor.getByRole("button", { name: "Hide slide thumbnails" }),
    ).toBeVisible();
    await expect(editor.getByRole("button", { name: "Notes" })).toBeVisible();
    await expect(
      editor.getByRole("slider", { name: "Slide zoom" }),
    ).toBeVisible();
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
});
