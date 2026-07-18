import { expect, test, type Locator, type Page } from "@playwright/test";

import { login } from "../helpers/auth";
import { PRESENTATION_CONTROL_FIXTURES } from "../helpers/presentation-fixtures";
import {
  e2eProfileEnabled,
  profileDocPath,
  profileOwnerCredentials,
} from "../helpers/profile";
import { waitForStableSlideStage } from "../helpers/readiness";

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
});

test.describe("presentation touch controls", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed the deterministic profile",
  );
  test.setTimeout(90_000);

  test("Chromium touch taps select text and navigate the mobile text inspector", async ({
    browserName,
    page,
  }) => {
    expect(browserName).toBe("chromium");
    const editor = await openTouchFixture(page);
    const textNode = editor.getByRole("button", {
      name: "Touch text",
    });

    await textNode.tap();
    await expect(textNode).toHaveAttribute("aria-pressed", "true");

    const editText = editor.getByRole("button", {
      name: "Edit text",
      exact: true,
    });
    await expect(editText).toBeVisible();
    await editText.tap();

    const textInspector = page.getByRole("dialog", {
      name: "Text inspector",
    });
    await expect(textInspector).toBeVisible();
    await textInspector
      .getByRole("button", { name: "Show Arrange inspector panel" })
      .tap();
    await expect(
      textInspector.getByRole("heading", { name: "Geometry" }),
    ).toBeVisible();
    await textInspector
      .getByRole("button", { name: "Close text inspector" })
      .tap();
    await expect(textInspector).toHaveCount(0);
    await expect(textNode).toHaveAttribute("aria-pressed", "true");
  });
});

async function openTouchFixture(page: Page): Promise<Locator> {
  await login(
    page,
    profileOwnerCredentials(),
    `${profileDocPath(PRESENTATION_CONTROL_FIXTURES.touchControls, test.info())}/slides`,
  );
  const editor = page.locator('[data-slide-editor="true"]').first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await waitForStableSlideStage(
    editor.locator('[data-slide-canvas="true"]').first(),
  );
  return editor;
}
