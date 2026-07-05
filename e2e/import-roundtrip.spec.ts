import { expect, test } from "@playwright/test";

import { login } from "./helpers/auth";
import { e2eProfileEnabled, profileOwnerCredentials } from "./helpers/profile";

/**
 * Document import round-trip E2E coverage (Epic #517, issue #519).
 *
 * Exercises the real import flow end to end:
 *   1. Import representative Markdown through the dashboard UI
 *      (`ImportDocumentButton` → `POST /api/import` → `createDocumentFromImport`
 *      → redirect to the editor).
 *   2. Verify the resulting document opens in the editor with the expected text
 *      and block structure (headings + bullet list).
 *   3. Edit the document, let it autosave, RELOAD, and verify durable
 *      persistence of the edit.
 *   4. Negative case: an unsupported/unreadable upload yields a graceful error
 *      (HTTP 415) rather than a crash.
 *
 * These specs run ONLY under the deterministic E2E profile (`E2E_PROFILE=1`,
 * `npm run test:e2e:profile` against `npm run db:seed:e2e`). Without the profile
 * they skip cleanly so the credential-less fast gate stays green.
 *
 * DOCX coverage note: binary `.docx` fixtures are impractical to maintain in
 * the repo and the import route's DOCX path (mammoth) is unit-tested at
 * `src/lib/import/docx.ts` / `validate.test.ts`. This spec therefore covers the
 * Markdown path fully through the UI and the unsupported-type path via the
 * route; the DOCX UI round-trip remains a documented gap (see `e2e/README.md`).
 */

/** Representative Markdown exercising headings, paragraph, and a bullet list. */
const SAMPLE_MARKDOWN = [
  "# Import Roundtrip Heading",
  "",
  "An imported paragraph of body text.",
  "",
  "- First imported bullet",
  "- Second imported bullet",
  "",
].join("\n");

test.describe("document import round-trip", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run import round-trip",
  );
  test.setTimeout(240_000);

  test("imports Markdown, renders blocks, and persists an edit across reload", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials());

    // --- Navigate (fail message distinguishes navigation) -----------------
    await page.goto("/app");
    await expect(page, "navigate: workspace did not load").toHaveURL(/\/app/);

    // --- Import (parse + create) ------------------------------------------
    // The hidden file input drives `ImportDocumentButton`; setting files on it
    // triggers the same POST /api/import → createDocumentFromImport flow a user
    // gets by clicking "Import document" and choosing a file.
    const fileInput = page.getByLabel("Import a document file");
    await expect(
      fileInput,
      "parse: import file input not found on dashboard",
    ).toHaveCount(1);

    await fileInput.setInputFiles({
      name: "import-roundtrip.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(SAMPLE_MARKDOWN, "utf8"),
    });

    // --- Create + navigate to the new editor ------------------------------
    await page.waitForURL(/\/app\/documents\/[^/]+/, { timeout: 30_000 });

    const editor = page.getByLabel("Document body");
    await expect(
      editor,
      "navigate: editor body not visible after import",
    ).toBeVisible({ timeout: 20_000 });

    // --- Verify imported text + block structure ---------------------------
    await expect(
      editor.getByText("Import Roundtrip Heading"),
      "parse: imported heading text missing",
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      editor.getByText("An imported paragraph of body text."),
      "parse: imported paragraph missing",
    ).toBeVisible();
    await expect(
      editor.locator("li", { hasText: "First imported bullet" }),
      "parse: imported bullet list item missing",
    ).toBeVisible();

    // --- Edit → autosave → reload → verify durable persistence ------------
    // The body is collaborative and becomes editable once the room is ready.
    await expect(
      editor,
      "persist: editor never became editable",
    ).toHaveAttribute("contenteditable", "true", { timeout: 20_000 });
    await expect(
      page.getByRole("status").filter({ hasText: "Live" }).first(),
      "persist: collaboration room did not become live before editing",
    ).toBeVisible({ timeout: 60_000 });

    const marker = "roundtrip-profile-marker";
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.type(` ${marker}`);
    await expect(editor.getByText(marker, { exact: false })).toBeVisible({
      timeout: 10_000,
    });

    // Wait for the debounced autosave to confirm before reloading.
    await page
      .getByText(/Unsaved changes|Saving/)
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => undefined);
    await expect(
      page.getByText("All changes saved"),
      "persist: save status never reached 'All changes saved'",
    ).toBeVisible({ timeout: 60_000 });

    await expect(async () => {
      await page.reload();
      const editorAfter = page.getByLabel("Document body");
      await expect(
        editorAfter,
        "persist: editor body missing after reload",
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByRole("status").filter({ hasText: "Live" }).first(),
        "persist: collaboration room did not become live after reload",
      ).toBeVisible({ timeout: 60_000 });
      await expect(
        editorAfter.getByText(marker, { exact: false }),
        "persist: edited marker did not survive reload",
      ).toBeVisible({ timeout: 60_000 });
    }).toPass({ timeout: 120_000 });
  });

  test("rejects an unsupported file type with a graceful error", async ({
    page,
  }) => {
    // The import route is public; exercise the unsupported-type branch directly
    // so the negative path is asserted deterministically (HTTP 415).
    const response = await page.request.post("/api/import", {
      multipart: {
        file: {
          name: "not-a-document.xyz",
          mimeType: "application/octet-stream",
          buffer: Buffer.from("nonsense-binary-content", "utf8"),
        },
      },
    });

    expect(
      response.status(),
      "parse: unsupported upload should be rejected with 415",
    ).toBe(415);
    const body = (await response.json()) as { error?: string };
    expect(
      body.error,
      "parse: unsupported upload should return an error message",
    ).toBeTruthy();
  });
});
