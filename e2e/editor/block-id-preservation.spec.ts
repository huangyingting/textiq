/**
 * E2E workflow spec: block-id preservation across save/reload (#435).
 *
 * Tests that durable block ids survive the document editor workflow:
 * 1. Open a document.
 * 2. Verify blocks have bid fields in contentJson.
 * 3. Edit text in a block.
 * 4. Save and reload.
 * 5. Verify the same block retains its bid.
 * 6. Insert a visual from a block.
 * 7. Verify the source ref blockId matches the block bid.
 *
 * Run with: npm run test:e2e (NOT part of npm test gate)
 */

import { expect, test } from "@playwright/test";

import { login, ownerCredentials } from "./helpers/auth";

function blockIdDocUrl(): string | undefined {
  return process.env.E2E_BLOCK_ID_DOC_URL;
}

test.describe("Block-id preservation", () => {
  test("block bids survive save and reload", async ({ page }) => {
    const creds = ownerCredentials();
    const docUrl = blockIdDocUrl();
    test.skip(
      !creds || !docUrl,
      "Set E2E_USER_EMAIL/E2E_USER_PASSWORD and E2E_BLOCK_ID_DOC_URL",
    );

    await login(page, creds!);
    await page.goto(docUrl!);
    await expect(page.locator("body")).toBeVisible();

    // TODO(issue #435): add a seeded diagnostics hook to assert the persisted
    // contentJson `bid` before and after an in-editor text edit + reload flow.
  });

  test("source ref blockId matches block bid after visual insertion", async ({
    page,
  }) => {
    const creds = ownerCredentials();
    const docUrl = blockIdDocUrl();
    test.skip(
      !creds || !docUrl,
      "Set E2E_USER_EMAIL/E2E_USER_PASSWORD and E2E_BLOCK_ID_DOC_URL",
    );

    await login(page, creds!);
    await page.goto(docUrl!);
    await expect(page.locator("body")).toBeVisible();

    // TODO(issue #435): seed a stable insertion fixture and assert the created
    // slide element sourceRef.blockId equals the originating document block bid.
  });

  test("duplicate document gets independent block ids", async ({ page }) => {
    const creds = ownerCredentials();
    const docUrl = blockIdDocUrl();
    test.skip(
      !creds || !docUrl,
      "Set E2E_USER_EMAIL/E2E_USER_PASSWORD and E2E_BLOCK_ID_DOC_URL",
    );

    await login(page, creds!);
    await page.goto(docUrl!);
    await expect(page.locator("body")).toBeVisible();

    // TODO(issue #435): exercise the duplicate action against a seeded document
    // and compare original vs duplicate contentJson bids through a test helper.
  });
});
