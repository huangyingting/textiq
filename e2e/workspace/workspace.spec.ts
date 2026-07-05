import { expect, test } from "@playwright/test";

import { login, ownerCredentials, viewerCredentials } from "./helpers/auth";

/**
 * Workspace E2E flows (issue #107): document create/import, the empty state,
 * and viewer restrictions.
 *
 * These require an authenticated session backed by a seeded database, so they
 * read credentials from the environment (see `e2e/helpers/auth.ts`) and skip
 * cleanly when those are absent — keeping the suite green in CI while remaining
 * executable against a seeded local/staging environment.
 */
test.describe("workspace dashboard", () => {
  test("create flow opens the template picker and creates a document", async ({
    page,
  }) => {
    const creds = ownerCredentials();
    test.skip(!creds, "Set E2E_USER_EMAIL/E2E_USER_PASSWORD to run this flow");
    await login(page, creds!);

    await page.goto("/app");

    // The "New document" CTA opens the template picker dialog.
    await page
      .getByRole("button", { name: /new document|create your first document/i })
      .first()
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Choosing a template creates a document and navigates into its editor.
    await dialog
      .getByRole("button", { name: /template/i })
      .first()
      .click();
    await page.waitForURL(/\/app\/documents\//);
    await expect(page).toHaveURL(/\/app\/documents\//);
  });

  test("import button accepts a file and creates a document", async ({
    page,
  }) => {
    const creds = ownerCredentials();
    test.skip(!creds, "Set E2E_USER_EMAIL/E2E_USER_PASSWORD to run this flow");
    await login(page, creds!);

    await page.goto("/app");

    // The import control wires a hidden <input type="file"> to the
    // createDocumentFromImport server action.
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);
    await fileInput.setInputFiles({
      name: "import.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Imported\n\nHello from Playwright.\n"),
    });

    await page.waitForURL(/\/app\/documents\//);
    await expect(page).toHaveURL(/\/app\/documents\//);
  });

  test("empty state invites the first document when none exist", async ({
    page,
  }) => {
    const creds = ownerCredentials();
    test.skip(!creds, "Set E2E_USER_EMAIL/E2E_USER_PASSWORD to run this flow");
    await login(page, creds!);

    await page.goto("/app");

    // The dashboard shows either documents or the empty state — both are valid
    // depending on seed data, so only assert the empty state when it is shown.
    const emptyHeading = page.getByRole("heading", {
      name: /no documents yet/i,
    });
    if ((await emptyHeading.count()) > 0) {
      await expect(emptyHeading).toBeVisible();
      await expect(
        page.getByRole("button", { name: /create your first document/i }),
      ).toBeVisible();
    } else {
      // Otherwise the grid is populated and the standard New document CTA shows.
      await expect(
        page.getByRole("button", { name: /new document/i }).first(),
      ).toBeVisible();
    }
  });

  test("viewer cannot mutate a read-only document", async ({ page }) => {
    const creds = viewerCredentials();
    const docUrl = process.env.E2E_VIEWER_DOC_URL;
    test.skip(
      !creds || !docUrl,
      "Set E2E_VIEWER_* and E2E_VIEWER_DOC_URL to run the viewer restriction flow",
    );
    await login(page, creds!);

    await page.goto(docUrl!);

    // A viewer's editor surface is read-only: edit-only affordances such as the
    // share/manage controls must not be actionable. We assert the title input,
    // when present, is not editable for a viewer.
    const titleInput = page.locator('input[name="title"], [data-doc-title]');
    if ((await titleInput.count()) > 0) {
      await expect(titleInput.first()).toBeDisabled();
    }

    // The share/manage control (owner-only) must be absent for a viewer.
    await expect(page.getByRole("button", { name: /share/i })).toHaveCount(0);
  });
});
