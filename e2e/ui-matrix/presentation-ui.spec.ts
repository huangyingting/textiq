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

  test("filmstrip exposes both seeded slides and their controls", async ({
    page,
  }) => {
    await loginAsProfileOwner(page, `${profileDocPath()}/slides`);
    const editor = page.locator('[data-slide-editor="true"]').first();
    await expect(editor).toBeVisible({ timeout: 30_000 });

    const filmstrip = editor.getByRole("list", { name: "Slides" });
    await expect(
      filmstrip.getByRole("button", { name: /^Go to slide \d+$/ }),
    ).toHaveCount(2);
    await expect(
      filmstrip.getByRole("button", { name: "Go to slide 1" }),
    ).toBeVisible();
    await expect(
      filmstrip.getByRole("button", { name: "Go to slide 2" }),
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
