import { expect, test, type Page } from "@playwright/test";

import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileDocPath,
  profileViewerCredentials,
} from "../helpers/profile";
import { login } from "../helpers/auth";
import { openProfileDocument } from "./helpers";

async function selectSeededDocumentText(page: Page) {
  const body = page.getByRole("textbox", { name: "Document body" });
  await body.focus();
  await body
    .getByText(E2E_PROFILE_FIXTURE.documentBodyText, { exact: true })
    .evaluate((element) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
      // e2e-governance-allow dispatch-event: Range mutation does not emit selectionchange, so the editor must be notified explicitly.
      document.dispatchEvent(new Event("selectionchange"));
    });
}

async function placeCaretAtEndOfSeededDocumentText(page: Page) {
  const body = page.getByRole("textbox", { name: "Document body" });
  await body.focus();
  await body
    .getByText(E2E_PROFILE_FIXTURE.documentBodyText, { exact: true })
    .evaluate((element) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      // e2e-governance-allow dispatch-event: Range mutation does not emit selectionchange, so the editor must be notified explicitly.
      document.dispatchEvent(new Event("selectionchange"));
    });
}

test.describe("UI matrix: document editor contextual surfaces", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run document-editor UI matrix checks",
  );
  test.setTimeout(90_000);

  test("owner document editor renders the body surface and slide entry point", async ({
    page,
  }) => {
    await openProfileDocument(page);
    await expect(
      page.getByRole("textbox", { name: "Document body" }),
    ).toHaveAttribute("contenteditable", "true", { timeout: 20_000 });
    await expect(
      page.getByRole("link", { name: "Open slide editor" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Release Gate").first()).toBeVisible();
  });

  test("selected text exposes a keyboard-operable formatting toolbar and restores editor focus", async ({
    page,
  }) => {
    await openProfileDocument(page);
    await selectSeededDocumentText(page);

    const body = page.getByRole("textbox", { name: "Document body" });
    const toolbar = page.getByRole("toolbar", { name: "Text formatting" });
    const bold = toolbar.getByRole("button", { name: /^Bold/ });
    await expect(toolbar).toBeVisible();
    await expect(body).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(bold).toBeFocused();
    await expect(bold).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("End");
    await expect(
      toolbar.getByRole("button", { name: "Highlight color" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(body).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(
      toolbar.getByRole("button", { name: "Highlight color" }),
    ).toBeFocused();
    await page.keyboard.press("Home");
    await expect(bold).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(body).toBeFocused();
    await expect(
      body.locator("strong", {
        hasText: E2E_PROFILE_FIXTURE.documentBodyText,
      }),
    ).toBeVisible();

    await page.keyboard.press("Control+z");
    await expect(
      body.locator("strong", {
        hasText: E2E_PROFILE_FIXTURE.documentBodyText,
      }),
    ).toHaveCount(0);
  });

  test("slash insert filtering supports keyboard navigation and Escape dismissal", async ({
    page,
  }) => {
    await openProfileDocument(page);

    const body = page.getByRole("textbox", { name: "Document body" });
    await placeCaretAtEndOfSeededDocumentText(page);
    await page.keyboard.press("Enter");

    try {
      await page.keyboard.type("/head");
      const menu = page.getByRole("listbox", {
        name: "Insert block or visual",
      });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("option")).toHaveCount(3);
      await expect(
        menu.getByRole("option", { name: /Heading 1/ }),
      ).toHaveAttribute("aria-selected", "true");

      await page.keyboard.press("ArrowDown");
      await expect(
        menu.getByRole("option", { name: /Heading 2/ }),
      ).toHaveAttribute("aria-selected", "true");

      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(body).toBeFocused();
    } finally {
      await body.focus();
      await page.keyboard.press("Control+z");
      await page.keyboard.press("Control+z");
    }
  });

  test("visual editing transfers keyboard focus into its tools and restores the preview on Escape", async ({
    page,
  }) => {
    await openProfileDocument(page);

    const preview = page.getByRole("button", { name: "Edit visual" });
    await preview.focus();
    await page.keyboard.press("Enter");

    const controls = page.getByRole("region", { name: "Visual controls" });
    await expect(controls).toBeVisible();
    await expect(
      controls.getByRole("button", { name: "Show Export Visual" }),
    ).toBeFocused();

    await controls.getByRole("button", { name: "Show Info" }).click();
    await expect(
      controls.getByText("E2E profile flow", { exact: true }),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(controls).toHaveCount(0);
    await expect(preview).toBeFocused();
  });

  test("table controls mutate structure and require confirmation before deletion", async ({
    page,
  }) => {
    await openProfileDocument(page);

    const body = page.getByRole("textbox", { name: "Document body" });
    await placeCaretAtEndOfSeededDocumentText(page);
    await page.keyboard.press("Enter");

    try {
      await page.keyboard.type("/table");
      await expect(
        page
          .getByRole("listbox", { name: "Insert block or visual" })
          .getByRole("option", { name: /Table/ }),
      ).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Enter");

      const table = body.locator("table").first();
      await expect(table).toBeVisible();
      await table.locator("th, td").first().click();

      const toolbar = page.getByRole("toolbar", { name: "Table editing" });
      await expect(toolbar.getByLabel("2 rows by 2 columns")).toBeVisible();
      await toolbar.getByRole("button", { name: "Add row below" }).click();
      await expect(toolbar.getByLabel("3 rows by 2 columns")).toBeVisible();
      await expect(table.locator("tr")).toHaveCount(3);

      await toolbar.getByRole("button", { name: "More table actions" }).click();
      page.once("dialog", async (dialog) => {
        expect(dialog.message()).toBe("Delete table?");
        await dialog.dismiss();
      });
      await page.getByRole("button", { name: "Delete table" }).click();
      await expect(table).toBeVisible();

      await toolbar.getByRole("button", { name: "More table actions" }).click();
      page.once("dialog", async (dialog) => {
        expect(dialog.message()).toBe("Delete table?");
        await dialog.accept();
      });
      await page.getByRole("button", { name: "Delete table" }).click();
      await expect(table).toHaveCount(0);
    } finally {
      await body.focus();
      for (let index = 0; index < 6; index += 1) {
        await page.keyboard.press("Control+z");
      }
    }
  });

  test("open slide editor link reaches the canonical presentation route", async ({
    page,
  }) => {
    await openProfileDocument(page);
    await page.getByRole("link", { name: "Open slide editor" }).click();
    await expect(page).toHaveURL(new RegExp(`${profileDocPath()}/slides`), {
      timeout: 30_000,
    });
    const editor = page.locator('[data-slide-editor="true"]').first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(
      editor.locator('[data-slide-canvas="true"]').first(),
    ).toBeVisible();
  });

  test("viewer sees a read-only document with edit-only controls removed", async ({
    page,
  }) => {
    await login(page, profileViewerCredentials(), profileDocPath());
    const documentBody = page.getByRole("textbox", { name: "Document body" });
    await expect(documentBody).toBeVisible({ timeout: 60_000 });
    await expect(documentBody).toHaveAttribute("contenteditable", "false");
    await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open slide editor" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Style" })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(profileDocPath()));
  });

  test.describe("coarse-pointer editing surface", () => {
    test.use({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });

    test("selected text uses the mobile editing sheet and restores its trigger on Escape", async ({
      page,
    }) => {
      await openProfileDocument(page);
      await selectSeededDocumentText(page);

      await expect(
        page.getByRole("toolbar", { name: "Text formatting" }),
      ).toHaveCount(0);
      const trigger = page.getByRole("button", {
        name: "Open text formatting",
      });
      await expect(trigger).toBeVisible();
      await trigger.click();

      const sheet = page.getByRole("dialog", { name: "Editing panel" });
      await expect(sheet).toBeVisible();
      await expect(
        sheet.getByText("Text format", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        sheet.getByRole("toolbar", { name: "Text formatting" }),
      ).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  });
});
