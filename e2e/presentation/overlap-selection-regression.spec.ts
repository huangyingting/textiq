import { expect, test, type Locator, type Page } from "@playwright/test";

import { login } from "../helpers/auth";
import {
  e2eProfileEnabled,
  profileDocPath,
  profileOwnerCredentials,
} from "../helpers/profile";
import {
  waitForSlideAutosave,
  waitForStableSlideStage,
} from "../helpers/readiness";

async function openOverlapFixture(page: Page): Promise<Locator> {
  await login(page, profileOwnerCredentials());
  await page.goto(`${profileDocPath("overlapSelection")}/slides`);

  const editor = page.getByRole("dialog", { name: "Slide editor" }).first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await waitForStableSlideStage(
    editor.locator('[data-slide-canvas="true"]').first(),
  );
  return editor;
}

test.describe("overlapping stage selection regression", () => {
  test.setTimeout(120_000);
  // e2e-governance-allow test-skip: deterministic profile test skips when its seeded rooms are unavailable.
  test.skip(!e2eProfileEnabled(), "Requires the deterministic E2E profile");

  test("reorders, persists, cycles, groups, filters locked layers, edits, deletes, and matches Layers", async ({
    page,
  }) => {
    const editor = await openOverlapFixture(page);
    const stage = editor.locator('[data-slide-canvas="true"]').first();

    const covered = stage.getByRole("button", { name: "Earlier high z" });
    const coveredId = await covered.getAttribute("data-node-id");
    expect(coveredId).toBe("overlap-earlier-high-z");
    const covering = stage.getByRole("button", { name: "Later low z" });
    const coveringId = await covering.getAttribute("data-node-id");
    expect(coveringId).toBe("overlap-later-low-z");

    const coveredNode = stage.locator(
      `[data-node-id="${coveredId}"][role="button"]`,
    );
    const coveringNode = stage.locator(
      `[data-node-id="${coveringId}"][role="button"]`,
    );
    const clickOverlap = async (button: "left" | "right" = "left") => {
      const box = await coveringNode.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.click(
        box!.x + box!.width / 2,
        box!.y + box!.height / 2,
        { button },
      );
    };
    const clickStageBackground = async () => {
      const box = await stage.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.click(
        box!.x + box!.width * 0.95,
        box!.y + box!.height * 0.95,
      );
    };
    await clickStageBackground();
    await clickOverlap();
    await expect(
      coveredNode,
      "the earlier high-z node must initially render and hit in the foreground",
    ).toHaveAttribute("aria-pressed", "true");
    await expect(coveringNode).toHaveAttribute("aria-pressed", "false");

    const contextToolbar = page.getByRole("toolbar", {
      name: "Context toolbar",
    });
    await contextToolbar
      .getByRole("button", { name: "Open Text inspector" })
      .click();
    const inspector = editor.getByRole("region", { name: "Inspector" });
    await inspector
      .getByRole("combobox", { name: "Inspector panel" })
      .selectOption("layers");
    const overlapLayerLabels = () =>
      inspector
        .getByRole("button", {
          name: /^(Later low z|Earlier high z)$/,
        })
        .allTextContents()
        .then((labels) => labels.map((label) => label.trim()));
    expect(await overlapLayerLabels()).toEqual([
      "Earlier high z",
      "Later low z",
    ]);

    await contextToolbar.getByRole("button", { name: "Send backward" }).click();
    expect(await overlapLayerLabels()).toEqual([
      "Later low z",
      "Earlier high z",
    ]);
    await clickStageBackground();
    await clickOverlap();
    await expect(
      coveringNode,
      "Send backward must immediately change visual and hit order",
    ).toHaveAttribute("aria-pressed", "true");

    await editor.getByRole("button", { name: "Undo", exact: true }).click();
    await clickStageBackground();
    await clickOverlap();
    await expect(coveredNode).toHaveAttribute("aria-pressed", "true");
    await editor.getByRole("button", { name: "Redo", exact: true }).click();
    await clickStageBackground();
    await clickOverlap();
    await expect(coveringNode).toHaveAttribute("aria-pressed", "true");
    await waitForSlideAutosave(page);

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(stage);
    await clickOverlap();
    await expect(
      coveringNode,
      "the layer command must survive autosave and reload",
    ).toHaveAttribute("aria-pressed", "true");

    await coveringNode.press("Shift+F10");
    const nodeMenu = page.getByRole("menu", { name: "Node actions" });
    const nextOverlapCommand = nodeMenu.getByRole("menuitem", {
      name: "Select next overlapping element",
    });
    await expect(nextOverlapCommand).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(coveredNode).toHaveAttribute("aria-pressed", "true");
    await expect(coveredNode).toBeFocused();
    await expect(
      editor
        .locator('[aria-live="polite"][aria-atomic="true"]')
        .filter({ hasText: "Earlier high z selected" }),
    ).toHaveCount(1);

    await coveredNode.press("Shift+F10");
    await expect(nextOverlapCommand).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(coveringNode).toHaveAttribute("aria-pressed", "true");
    await expect(coveringNode).toBeFocused();
    await expect(
      editor
        .locator('[aria-live="polite"][aria-atomic="true"]')
        .filter({ hasText: "Later low z selected" }),
    ).toHaveCount(1);
    await clickStageBackground();
    await clickOverlap();
    await expect(
      coveringNode,
      "a point/context reset must restore normal topmost selection",
    ).toHaveAttribute("aria-pressed", "true");
    await clickOverlap("right");
    await clickOverlap("right");
    await nodeMenu
      .getByRole("menuitem", { name: "Select next overlapping element" })
      .click();
    await expect(coveredNode).toHaveAttribute("aria-pressed", "true");

    await page.keyboard.down("Shift");
    await clickOverlap();
    await page.keyboard.up("Shift");
    await page.keyboard.press("Control+g");
    const groupNode = stage.locator(
      '[data-node-type="group"][role="button"][aria-pressed="true"]',
    );
    await expect(groupNode).toBeVisible();
    await clickOverlap();
    await expect(
      coveringNode,
      "the rendered group child must win the equal-z hit tie after its parent context is active",
    ).toHaveAttribute("aria-pressed", "true");
    await clickStageBackground();
    await clickOverlap();
    await expect(groupNode).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Control+Shift+g");
    await expect(groupNode).toHaveCount(0);

    await clickStageBackground();
    await clickOverlap();
    await clickOverlap("right");
    await nodeMenu.getByRole("menuitem", { name: "Lock", exact: true }).click();
    await clickStageBackground();
    await clickOverlap();
    await expect(
      coveredNode,
      "locked foreground nodes must not intercept pointer selection",
    ).toHaveAttribute("aria-pressed", "true");
    await clickOverlap("right");
    await expect(
      nodeMenu.getByRole("menuitem", { name: "Later low z" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    await coveredNode.press("Enter");
    const inlineEditor = page.getByRole("textbox", { name: "Edit text" });
    await expect(inlineEditor).toBeVisible();
    await inlineEditor.fill("Earlier high z edited");
    await page.keyboard.press("Escape");
    await expect(inlineEditor).toHaveCount(0);

    await coveredNode.press("Delete");
    await expect(coveredNode).toHaveCount(0);
    await editor.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(coveredNode).toHaveCount(1);
    await waitForSlideAutosave(page);

    await page
      .getByRole("toolbar", { name: "Context toolbar" })
      .getByRole("button", { name: "Open Text inspector" })
      .click();
    await inspector
      .getByRole("combobox", { name: "Inspector panel" })
      .selectOption("layers");
    await inspector
      .getByRole("button", { name: "Earlier high z", exact: true })
      .click();
    await expect(coveredNode).toHaveAttribute("aria-pressed", "true");
    await inspector
      .getByRole("button", { name: "Later low z", exact: true })
      .click();
    await expect(coveringNode).toHaveAttribute("aria-pressed", "true");
    expect(await overlapLayerLabels()).toEqual([
      "Later low z",
      "Earlier high z",
    ]);

    await page.reload();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await waitForStableSlideStage(stage);
    await expect(
      stage.locator(`[data-node-id="${coveredId}"][role="button"]`),
    ).toContainText("Earlier high z edited");
    await expect(
      stage.locator(`[data-node-id="${coveringId}"][role="button"]`),
    ).toHaveCount(1);
  });
});
