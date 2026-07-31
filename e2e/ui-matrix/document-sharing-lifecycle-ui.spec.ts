import { expect, test, type Locator, type Page } from "@playwright/test";

import { login } from "../helpers/auth";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileOwnerCredentials,
} from "../helpers/profile";
import { waitForDocumentEditorReady } from "../helpers/readiness";

function shareDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Share this document" });
}

async function openShareDialog(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = shareDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function expectPublicDocument(
  page: Page,
  title: string,
  content: string,
): Promise<void> {
  await expect(page.getByRole("heading", { name: title })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(content)).toBeVisible();
  await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
}

test.describe("UI matrix: document sharing lifecycle", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run document sharing lifecycle coverage",
  );
  test.setTimeout(180_000);

  test("owner configures, protects, rotates, and disables a public share", async ({
    browser,
    page,
  }) => {
    const fixture = E2E_PROFILE_FIXTURE.documentShareLifecycle;
    const documentPath = `/app/documents/${fixture.id}`;
    const expiryValue = `${new Date().getUTCFullYear() + 2}-12-31T23:59`;

    await page.setViewportSize({ width: 1280, height: 720 });
    await login(page, profileOwnerCredentials(), documentPath);
    await waitForDocumentEditorReady(page);
    await expect(page.getByText(fixture.content)).toBeVisible();

    let dialog = await openShareDialog(page);
    await expect(dialog.getByText("Private", { exact: true })).toBeVisible();
    await expect(
      dialog.getByText("Enable sharing to create a public read-only link."),
    ).toBeVisible();

    await dialog.getByRole("switch", { name: "Private" }).click();
    await expect(
      dialog.getByText("Public link enabled", { exact: true }),
    ).toBeVisible();

    const shareLink = dialog.getByLabel("Public share link");
    await expect(shareLink).toBeVisible();
    const initialShareUrl = await shareLink.inputValue();
    expect(initialShareUrl).toMatch(/\/share\/.+/);

    const panelMetrics = await dialog.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: style.overflowY,
        viewportHeight: window.innerHeight,
      };
    });
    expect(panelMetrics.overflowY).toBe("auto");
    expect(panelMetrics.clientHeight).toBeLessThan(panelMetrics.scrollHeight);
    const panelBox = await dialog.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.y).toBeGreaterThanOrEqual(8);
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(
      panelMetrics.viewportHeight - 8,
    );

    const anonymousContext = await browser.newContext({
      baseURL: test.info().project.use.baseURL as string,
    });
    const publicPage = await anonymousContext.newPage();
    try {
      await publicPage.goto(initialShareUrl);
      await expectPublicDocument(publicPage, fixture.title, fixture.content);

      await dialog
        .getByLabel("Social preview metadata")
        .selectOption("title-excerpt");
      await expect(dialog.getByLabel("Social preview metadata")).toHaveValue(
        "title-excerpt",
      );
      await dialog
        .getByRole("switch", { name: "Allow search indexing" })
        .click();
      await expect(
        dialog.getByRole("switch", { name: "Allow search indexing" }),
      ).toHaveAttribute("aria-checked", "true");

      await dialog.getByRole("switch", { name: "Allow embedding" }).click();
      await dialog.getByRole("switch", { name: "Allow presentation" }).click();
      await expect(
        dialog.getByRole("switch", { name: "Allow embedding" }),
      ).toHaveAttribute("aria-checked", "false");
      await expect(
        dialog.getByRole("switch", { name: "Allow presentation" }),
      ).toHaveAttribute("aria-checked", "false");

      const expiry = dialog.getByLabel("Link expiry date and time");
      await expiry.fill(expiryValue);
      await expect(dialog.getByRole("button", { name: "Clear" })).toBeVisible();

      const passcode = dialog.getByLabel("Share passcode");
      const setPasscode = dialog.getByRole("button", { name: "Set" });
      await expect(setPasscode).toBeDisabled();
      await passcode.fill("123");
      await setPasscode.click();
      await expect(dialog.getByRole("alert")).toHaveText(
        "Passcode must be at least 4 characters.",
      );
      await expect(passcode).toHaveValue("123");
      await passcode.fill(fixture.passcode);
      await setPasscode.click();
      await expect(
        dialog.getByText(
          "A passcode is required before visitors can view this link.",
        ),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Update" }),
      ).toBeDisabled();
      await expect(
        dialog.getByRole("button", { name: "Remove passcode" }),
      ).toBeVisible();

      await page.reload();
      await waitForDocumentEditorReady(page);
      dialog = await openShareDialog(page);
      await expect(dialog.getByLabel("Public share link")).toHaveValue(
        initialShareUrl,
      );
      await expect(dialog.getByLabel("Social preview metadata")).toHaveValue(
        "title-excerpt",
      );
      await expect(
        dialog.getByRole("switch", { name: "Allow search indexing" }),
      ).toHaveAttribute("aria-checked", "true");
      await expect(
        dialog.getByRole("switch", { name: "Allow embedding" }),
      ).toHaveAttribute("aria-checked", "false");
      await expect(
        dialog.getByRole("switch", { name: "Allow presentation" }),
      ).toHaveAttribute("aria-checked", "false");
      await expect(dialog.getByLabel("Link expiry date and time")).toHaveValue(
        expiryValue,
      );
      await expect(
        dialog.getByRole("button", { name: "Update" }),
      ).toBeDisabled();

      await publicPage.goto(initialShareUrl);
      await expect(
        publicPage.getByRole("heading", { name: "Passcode required" }),
      ).toBeVisible();
      await publicPage.getByLabel("Passcode").fill("incorrect-passcode");
      await publicPage.getByRole("button", { name: "Unlock" }).click();
      await expect(publicPage.getByRole("alert")).toHaveText(
        "Incorrect passcode. Please try again.",
      );
      await publicPage.getByLabel("Passcode").fill(fixture.passcode);
      await publicPage.getByRole("button", { name: "Unlock" }).click();
      await expectPublicDocument(publicPage, fixture.title, fixture.content);

      const sharePath = new URL(initialShareUrl).pathname;
      const embedResponse = await publicPage.goto(
        sharePath.replace("/share/", "/embed/"),
      );
      expect(embedResponse?.status()).toBe(404);
      const presentResponse = await publicPage.goto(
        sharePath.replace("/share/", "/present/"),
      );
      expect(presentResponse?.status()).toBe(404);

      await dialog.getByRole("button", { name: "Clear" }).click();
      await expect(
        dialog.getByText(
          "No expiry — the link works until disabled or regenerated.",
        ),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Regenerate link" }).click();
      const rotatedShareLink = dialog.getByLabel("Public share link");
      await expect(rotatedShareLink).not.toHaveValue(initialShareUrl, {
        timeout: 20_000,
      });
      const rotatedShareUrl = await rotatedShareLink.inputValue();

      const oldLinkResponse = await publicPage.goto(initialShareUrl);
      expect(oldLinkResponse?.status()).toBe(404);
      await publicPage.goto(rotatedShareUrl);
      await expect(
        publicPage.getByRole("heading", { name: "Passcode required" }),
      ).toBeVisible();

      await dialog.getByRole("switch", { name: "Public link enabled" }).click();
      await expect(dialog.getByText("Private", { exact: true })).toBeVisible();
      const disabledLinkResponse = await publicPage.goto(rotatedShareUrl);
      expect(disabledLinkResponse?.status()).toBe(404);

      await page.reload();
      await waitForDocumentEditorReady(page);
      dialog = await openShareDialog(page);
      await expect(dialog.getByText("Private", { exact: true })).toBeVisible();
      await expect(dialog.getByLabel("Public share link")).toHaveCount(0);
    } finally {
      await anonymousContext.close();
    }
  });
});
