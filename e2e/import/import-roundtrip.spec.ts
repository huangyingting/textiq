import { expect, type Page, test } from "@playwright/test";

import { login } from "../helpers/auth";
import {
  createDocxRoundtripFixture,
  DOCX_ROUNDTRIP_FIXTURE,
} from "../helpers/docx-fixture";
import { e2eProfileEnabled, profileOwnerCredentials } from "../helpers/profile";

/**
 * Document import round-trip E2E coverage (Epic #517, issue #519).
 *
 * Exercises the real import flow end to end:
 *   1. Import representative Markdown through the dashboard UI
 *      (`ImportDocumentButton` → `POST /api/import` → `createDocumentFromImport`
 *      → redirect to the editor).
 *   2. Verify the resulting document opens in the editor with the expected text
 *      and block structure (headings + bullet list).
 *   3. Reload the editor and verify durable persistence of the imported
 *      content.
 *   4. Negative case: an unsupported/unreadable upload yields a graceful error
 *      (HTTP 415) rather than a crash.
 *
 * These specs run ONLY under the deterministic E2E profile (`E2E_PROFILE=1`,
 * `npm run test:e2e:profile` against `npm run db:seed:e2e`). Without the profile
 * they skip cleanly so the credential-less fast gate stays green.
 *
 * DOCX coverage uses a deterministic in-test OOXML fixture generated from
 * stable XML parts so the browser path is covered without committing an opaque
 * binary blob.
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
const IMPORT_NAVIGATION_TIMEOUT_MS = 120_000;
const EDITOR_READY_TIMEOUT_MS = 60_000;

async function verifyImportedContentSurvivesReload({
  page,
  heading,
  paragraph,
  firstBullet,
  label,
}: {
  page: Page;
  heading: string;
  paragraph: string;
  firstBullet: string;
  label: string;
}): Promise<void> {
  await page.reload();
  const editor = page.getByLabel("Document body");
  await expect(
    editor,
    `persist: editor body missing after ${label} reload`,
  ).toBeVisible({ timeout: EDITOR_READY_TIMEOUT_MS });
  await expect(
    editor.getByText(heading),
    `persist: ${label} heading missing after reload`,
  ).toBeVisible({ timeout: EDITOR_READY_TIMEOUT_MS });
  await expect(
    editor.getByText(paragraph),
    `persist: ${label} paragraph missing after reload`,
  ).toBeVisible();
  await expect(
    editor.locator("li", { hasText: firstBullet }),
    `persist: ${label} bullet list item missing after reload`,
  ).toBeVisible();
}

test.describe("document import round-trip", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(360_000);

  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run import round-trip",
  );

  test("imports Markdown, renders blocks, and persists content across reload @required-profile", async ({
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
    await page.waitForURL(/\/app\/documents\/[^/]+/, {
      timeout: IMPORT_NAVIGATION_TIMEOUT_MS,
    });

    const editor = page.getByLabel("Document body");
    await expect(
      editor,
      "navigate: editor body not visible after import",
    ).toBeVisible({ timeout: EDITOR_READY_TIMEOUT_MS });

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

    await verifyImportedContentSurvivesReload({
      page,
      label: "Markdown import",
      heading: "Import Roundtrip Heading",
      paragraph: "An imported paragraph of body text.",
      firstBullet: "First imported bullet",
    });
  });

  test("imports DOCX, renders blocks, and persists content across reload @required-profile", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials());

    await page.goto("/app");
    await expect(page, "navigate: workspace did not load").toHaveURL(/\/app/);

    const fileInput = page.getByLabel("Import a document file");
    await expect(
      fileInput,
      "parse: import file input not found on dashboard",
    ).toHaveCount(1);

    await fileInput.setInputFiles({
      name: DOCX_ROUNDTRIP_FIXTURE.fileName,
      mimeType: DOCX_ROUNDTRIP_FIXTURE.mimeType,
      buffer: await createDocxRoundtripFixture(),
    });

    await page.waitForURL(/\/app\/documents\/[^/]+/, {
      timeout: IMPORT_NAVIGATION_TIMEOUT_MS,
    });

    const editor = page.getByLabel("Document body");
    await expect(
      editor,
      "navigate: editor body not visible after DOCX import",
    ).toBeVisible({ timeout: EDITOR_READY_TIMEOUT_MS });

    await expect(
      editor.getByText(DOCX_ROUNDTRIP_FIXTURE.heading),
      "parse: imported DOCX heading text missing",
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      editor.getByText(DOCX_ROUNDTRIP_FIXTURE.paragraph),
      "parse: imported DOCX paragraph missing",
    ).toBeVisible();
    await expect(
      editor.locator("li", { hasText: DOCX_ROUNDTRIP_FIXTURE.bullets[0] }),
      "parse: imported DOCX bullet list item missing",
    ).toBeVisible();

    await verifyImportedContentSurvivesReload({
      page,
      label: "DOCX import",
      heading: DOCX_ROUNDTRIP_FIXTURE.heading,
      paragraph: DOCX_ROUNDTRIP_FIXTURE.paragraph,
      firstBullet: DOCX_ROUNDTRIP_FIXTURE.bullets[0],
    });
  });

  test("rejects an unsupported file type with a graceful error", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials());

    // The create-only import route validates unsupported payloads for signed-in
    // users before persistence.
    const response = await page.request.post("/api/import", {
      multipart: {
        target: "personal",
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
    const body = (await response.json()) as {
      error?: { message?: string };
    };
    expect(
      body.error?.message,
      "parse: unsupported upload should return an error message",
    ).toBeTruthy();
  });
});
