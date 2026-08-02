import { expect, test, type Locator, type Page } from "@playwright/test";

import { login } from "../helpers/auth";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileOwnerCredentials,
} from "../helpers/profile";
import { waitForDocumentEditorReady } from "../helpers/readiness";

interface ShareBrowserCapture {
  clipboardWrites: string[];
  popupCalls: Array<{
    url: string;
    target: string;
    features: string;
  }>;
}

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

async function unlockPasscodeRoute({
  page,
  path,
  passcode,
  mode,
}: {
  page: Page;
  path: string;
  passcode: string;
  mode: "view" | "embed" | "present";
}): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Passcode required" }),
  ).toBeVisible();
  await expect(page.locator('input[name="mode"]')).toHaveValue(mode);
  await page.getByLabel("Passcode").fill(passcode);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === path && url.search === "",
  );
}

async function installShareBrowserCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const browserWindow = window as typeof window & {
      __e2eShareCapture?: ShareBrowserCapture;
      __e2eResolveClipboardWrite?: (() => void) | null;
    };
    browserWindow.__e2eShareCapture = {
      clipboardWrites: [],
      popupCalls: [],
    };
    browserWindow.__e2eResolveClipboardWrite = null;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(value: string) {
          browserWindow.__e2eShareCapture?.clipboardWrites.push(value);
          return new Promise<void>((resolve) => {
            browserWindow.__e2eResolveClipboardWrite = resolve;
          });
        },
      },
    });

    window.open = ((url?: string | URL, target?: string, features?: string) => {
      browserWindow.__e2eShareCapture?.popupCalls.push({
        url: String(url ?? ""),
        target: target ?? "",
        features: features ?? "",
      });
      return null;
    }) as typeof window.open;
  });
}

async function resolveClipboardWrite(page: Page): Promise<void> {
  await page.evaluate(() => {
    const browserWindow = window as typeof window & {
      __e2eResolveClipboardWrite?: (() => void) | null;
    };
    const resolve = browserWindow.__e2eResolveClipboardWrite;
    browserWindow.__e2eResolveClipboardWrite = null;
    resolve?.();
  });
}

async function shareBrowserCapture(page: Page): Promise<ShareBrowserCapture> {
  return page.evaluate(() => {
    const browserWindow = window as typeof window & {
      __e2eShareCapture?: ShareBrowserCapture;
    };
    if (!browserWindow.__e2eShareCapture) {
      throw new Error("Share browser capture is not installed.");
    }
    return browserWindow.__e2eShareCapture;
  });
}

test.describe("UI matrix: document sharing lifecycle", () => {
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run document sharing lifecycle coverage",
  );
  test.setTimeout(180_000);

  test("owner configures, expires, protects, rotates, and disables a public share", async ({
    browser,
    page,
  }) => {
    const mutationExpect = expect.configure({ timeout: 20_000 });
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

    const documentActionRoute = `**${documentPath}`;
    let shareActionCount = 0;
    await page.route(documentActionRoute, async (route) => {
      const request = route.request();
      const isDocumentAction =
        request.method() === "POST" &&
        new URL(request.url()).pathname === documentPath &&
        typeof request.headers()["next-action"] === "string";
      if (!isDocumentAction) {
        await route.continue();
        return;
      }
      shareActionCount += 1;
      if (shareActionCount === 1) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });
    const sharingSwitch = dialog.getByRole("switch", { name: "Private" });
    await sharingSwitch.click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Couldn't update document sharing. Please try again.",
    );
    await expect(dialog.getByText("Private", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Dismiss sharing error" }).click();
    await expect(dialog.getByRole("alert")).toHaveCount(0);

    const enableResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === documentPath,
    );
    await sharingSwitch.dblclick();
    expect((await enableResponse).ok()).toBe(true);
    await expect.poll(() => shareActionCount).toBe(2);
    await page.unroute(documentActionRoute);
    await mutationExpect(
      dialog.getByText("Public link enabled", { exact: true }),
    ).toBeVisible();

    const shareLink = dialog.getByLabel("Public share link");
    await expect(shareLink).toBeVisible();
    const initialShareUrl = await shareLink.inputValue();
    expect(initialShareUrl).toMatch(/\/share\/.+/);

    await installShareBrowserCapture(page);
    const shareCopyButton = shareLink.locator("..").getByRole("button");
    await shareCopyButton.click();
    await expect(shareCopyButton).toHaveText("Copying…");
    await expect(
      dialog.getByRole("status").filter({
        hasText: "Copying public share link.",
      }),
    ).toBeVisible();
    expect((await shareBrowserCapture(page)).clipboardWrites).toEqual([
      initialShareUrl,
    ]);
    await resolveClipboardWrite(page);
    await expect(shareCopyButton).toHaveText("Copied!");
    await expect(
      dialog.getByRole("status").filter({
        hasText: "Public share link copied.",
      }),
    ).toBeVisible();

    const embedCode = dialog.getByLabel("Embed code");
    const embedSnippet = await embedCode.inputValue();
    await embedCode
      .locator("..")
      .getByRole("button", { name: "Copy", exact: true })
      .click();
    await resolveClipboardWrite(page);
    await expect(
      dialog.getByRole("status").filter({
        hasText: "Embed code copied to clipboard.",
      }),
    ).toBeVisible();

    const presentationLink = dialog.getByLabel("Presentation link");
    const presentationUrl = await presentationLink.inputValue();
    await presentationLink
      .locator("..")
      .getByRole("button", { name: "Copy", exact: true })
      .click();
    await resolveClipboardWrite(page);
    await expect(
      dialog.getByRole("status").filter({
        hasText: "Presentation link copied.",
      }),
    ).toBeVisible();

    const socialButtons = [
      "Share on X / Twitter",
      "Share on LinkedIn",
      "Share on Facebook",
    ];
    for (const name of socialButtons) {
      await dialog.getByRole("button", { name }).click();
    }

    const capture = await shareBrowserCapture(page);
    expect(capture.clipboardWrites).toEqual([
      initialShareUrl,
      embedSnippet,
      presentationUrl,
    ]);
    expect(capture.popupCalls).toHaveLength(3);
    expect(capture.popupCalls.map((call) => call.target)).toEqual([
      "share-twitter",
      "share-linkedin",
      "share-facebook",
    ]);
    expect(
      capture.popupCalls.map((call) => new URL(call.url).hostname),
    ).toEqual(["twitter.com", "www.linkedin.com", "www.facebook.com"]);
    for (const popup of capture.popupCalls) {
      expect(popup.features).toContain("noopener");
      expect(popup.features).toContain("noreferrer");
      expect(popup.url).toContain(encodeURIComponent(initialShareUrl));
    }

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
      await mutationExpect(
        dialog.getByLabel("Social preview metadata"),
      ).toHaveValue("title-excerpt");
      await dialog
        .getByRole("switch", { name: "Allow search indexing" })
        .click();
      await mutationExpect(
        dialog.getByRole("switch", { name: "Allow search indexing" }),
      ).toHaveAttribute("aria-checked", "true");

      await dialog.getByRole("switch", { name: "Allow embedding" }).click();
      await dialog.getByRole("switch", { name: "Allow presentation" }).click();
      await mutationExpect(
        dialog.getByRole("switch", { name: "Allow embedding" }),
      ).toHaveAttribute("aria-checked", "false");
      await mutationExpect(
        dialog.getByRole("switch", { name: "Allow presentation" }),
      ).toHaveAttribute("aria-checked", "false");

      const expiry = dialog.getByLabel("Link expiry date and time");
      await expiry.fill(expiryValue);
      await mutationExpect(
        dialog.getByRole("button", { name: "Clear" }),
      ).toBeVisible();

      const passcode = dialog.getByLabel("Share passcode");
      const setPasscode = dialog.getByRole("button", { name: "Set" });
      await expect(setPasscode).toBeDisabled();
      await passcode.fill("123");
      await setPasscode.click();
      await expect(dialog.getByRole("alert")).toContainText(
        "Passcode must be at least 4 characters.",
      );
      await expect(passcode).toHaveValue("123");
      await passcode.fill(fixture.passcode);
      await setPasscode.click();
      await mutationExpect(
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
      await expect(
        publicPage.getByRole("alert").filter({
          hasText: "Incorrect passcode. Please try again.",
        }),
      ).toHaveText("Incorrect passcode. Please try again.");
      await publicPage.getByLabel("Passcode").fill(fixture.passcode);
      await publicPage.getByRole("button", { name: "Unlock" }).click();
      await expectPublicDocument(publicPage, fixture.title, fixture.content);

      const sharePath = new URL(initialShareUrl).pathname;
      const embedPath = sharePath.replace("/share/", "/embed/");
      const presentPath = sharePath.replace("/share/", "/present/");
      const presentEmbedPath = `${presentPath}/embed`;
      const embedResponse = await publicPage.goto(embedPath);
      expect(embedResponse?.status()).toBe(404);
      const presentResponse = await publicPage.goto(presentPath);
      expect(presentResponse?.status()).toBe(404);
      const presentEmbedResponse = await publicPage.goto(presentEmbedPath);
      expect(presentEmbedResponse?.status()).toBe(404);

      await dialog.getByRole("switch", { name: "Allow presentation" }).click();
      await mutationExpect(
        dialog.getByRole("switch", { name: "Allow presentation" }),
      ).toHaveAttribute("aria-checked", "true");

      await anonymousContext.clearCookies();
      await unlockPasscodeRoute({
        page: publicPage,
        path: presentPath,
        passcode: fixture.passcode,
        mode: "present",
      });
      const presentRegion = publicPage.getByRole("region", {
        name: new RegExp(`^Presentation: ${fixture.title}$`),
      });
      await expect(presentRegion).toBeVisible({ timeout: 20_000 });
      await expect(presentRegion.getByText(fixture.content)).toBeVisible();

      await anonymousContext.clearCookies();
      const independentlyDeniedEmbed = await publicPage.goto(presentEmbedPath);
      expect(independentlyDeniedEmbed?.status()).toBe(404);

      await dialog.getByRole("switch", { name: "Allow embedding" }).click();
      await mutationExpect(
        dialog.getByRole("switch", { name: "Allow embedding" }),
      ).toHaveAttribute("aria-checked", "true");

      await anonymousContext.clearCookies();
      await unlockPasscodeRoute({
        page: publicPage,
        path: presentEmbedPath,
        passcode: fixture.passcode,
        mode: "embed",
      });
      const presentEmbedRegion = publicPage.getByRole("region", {
        name: new RegExp(`^Presentation: ${fixture.title}$`),
      });
      await expect(presentEmbedRegion).toBeVisible({ timeout: 20_000 });
      await expect(presentEmbedRegion.getByText(fixture.content)).toBeVisible();
      await expect(publicPage.getByLabel("Presentation controls")).toHaveCount(
        0,
      );

      await anonymousContext.clearCookies();
      await unlockPasscodeRoute({
        page: publicPage,
        path: embedPath,
        passcode: fixture.passcode,
        mode: "embed",
      });
      await expect(publicPage.getByText(fixture.content)).toBeVisible();
      await expect(
        publicPage.getByRole("heading", { name: fixture.title }),
      ).toHaveCount(0);
      await expect(
        publicPage.getByText("Read-only", { exact: true }),
      ).toHaveCount(0);

      const expiredValue = "2000-01-01T00:00";
      await dialog.getByLabel("Link expiry date and time").fill(expiredValue);
      await mutationExpect(
        dialog.getByLabel("Link expiry date and time"),
      ).toHaveValue(expiredValue);

      await anonymousContext.clearCookies();
      for (const expiredPath of [
        sharePath,
        embedPath,
        presentPath,
        presentEmbedPath,
      ]) {
        const expiredResponse = await publicPage.goto(expiredPath);
        expect(expiredResponse?.status(), expiredPath).toBe(404);
        const expiredBody = await publicPage.locator("body").innerText();
        expect(
          expiredBody,
          `${expiredPath} leaked the document title`,
        ).not.toContain(fixture.title);
        expect(
          expiredBody,
          `${expiredPath} leaked the document content`,
        ).not.toContain(fixture.content);
      }

      await dialog.getByRole("button", { name: "Clear" }).click();
      await mutationExpect(
        dialog.getByText(
          "No expiry — the link works until disabled or regenerated.",
        ),
      ).toBeVisible();

      await anonymousContext.clearCookies();
      await publicPage.goto(initialShareUrl);
      await expect(
        publicPage.getByRole("heading", { name: "Passcode required" }),
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
      await mutationExpect(
        dialog.getByText("Private", { exact: true }),
      ).toBeVisible();
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
