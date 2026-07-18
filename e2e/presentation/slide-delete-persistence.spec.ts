import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

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
import type { PresentationTestFixtureName } from "../helpers/presentation-fixtures";

async function openDeleteFixture(
  page: Page,
  testInfo: TestInfo,
  fixtureName: PresentationTestFixtureName,
  entry: "slides-route" | "document-route",
): Promise<Locator> {
  const documentPath = profileDocPath(fixtureName, testInfo);
  await login(
    page,
    profileOwnerCredentials(),
    entry === "slides-route" ? `${documentPath}/slides` : documentPath,
  );
  if (entry === "document-route") {
    await expect(
      page.getByRole("status").filter({ hasText: /^Live$/ }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(
        "Revenue grew 24% year-over-year from real document content.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    const opener = page.getByRole("link", { name: "Open slide editor" });
    await expect(opener).toHaveAttribute("href", `${documentPath}/slides`);
    await opener.click();
    await page.waitForURL(`${documentPath}/slides`);
  }
  const editor = page.getByRole("dialog", { name: "Slide editor" }).first();
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await waitForStableSlideStage(
    editor.locator('[data-slide-canvas="true"]').first(),
  );
  return editor;
}

async function deleteLastSlideAndAssertReload(
  page: Page,
  editor: Locator,
  options: { proveSubsequentCasSave?: boolean } = {},
): Promise<void> {
  const filmstrip = editor.getByRole("list", { name: "Slides" });
  const slideButtons = filmstrip.getByRole("button", {
    name: /^Slide \d+(: |$)/,
  });
  const initialCount = await slideButtons.count();
  expect(initialCount).toBeGreaterThan(1);

  await filmstrip.locator(`[data-slide-index="${initialCount - 1}"]`).hover();
  await filmstrip
    .getByRole("button", { name: `Delete slide ${initialCount}` })
    .click();
  await expect(slideButtons).toHaveCount(initialCount - 1);
  await waitForSlideAutosave(page);

  await page.reload();
  const reopenedEditor = page
    .getByRole("dialog", { name: "Slide editor" })
    .first();
  await expect(reopenedEditor).toBeVisible({ timeout: 30_000 });
  await waitForStableSlideStage(
    reopenedEditor.locator('[data-slide-canvas="true"]').first(),
  );
  await expect(
    reopenedEditor
      .getByRole("list", { name: "Slides" })
      .getByRole("button", { name: /^Slide \d+(: |$)/ }),
  ).toHaveCount(initialCount - 1);

  if (options.proveSubsequentCasSave) {
    const titleNode = reopenedEditor
      .locator(
        '[data-slide-canvas="true"] [data-node-type="text"][role="button"]',
      )
      .first();
    await titleNode.dblclick();
    const inlineEditor = page.getByRole("textbox", { name: "Edit text" });
    await expect(inlineEditor).toBeVisible();
    await inlineEditor.fill("Generated deck saved with rotated revision");
    await page.keyboard.press("Escape");
    await waitForSlideAutosave(page);
    await page.reload();
    await expect(
      page
        .getByRole("dialog", { name: "Slide editor" })
        .locator(
          '[data-slide-canvas="true"] [data-node-type="text"][role="button"]',
        )
        .first(),
    ).toHaveAttribute(
      "aria-label",
      "Text: Generated deck saved with rotated revision",
    );
  }
}

test.describe("slide deletion persistence", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed the deterministic profile",
  );

  test("canonical seeded deck delete autosaves and survives a direct slides-route reload", async ({
    page,
  }, testInfo) => {
    const editor = await openDeleteFixture(
      page,
      testInfo,
      "slideDeleteCanonical",
      "slides-route",
    );
    await deleteLastSlideAndAssertReload(page, editor);
  });

  test("generated first-save deck delete rotates its null token and survives reload", async ({
    page,
  }, testInfo) => {
    const editor = await openDeleteFixture(
      page,
      testInfo,
      "slideDeleteGenerated",
      "document-route",
    );
    await deleteLastSlideAndAssertReload(page, editor, {
      proveSubsequentCasSave: true,
    });
  });
});
