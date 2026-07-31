import {
  expect,
  test,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";

import { login, type Credentials } from "../helpers/auth";
import {
  E2E_PROFILE_FIXTURE,
  e2eProfileEnabled,
  profileEditorCredentials,
  profileOwnerCredentials,
  profileViewerCredentials,
} from "../helpers/profile";
import { waitForDocumentEditorReady } from "../helpers/readiness";

const DASHBOARD_PATH = "/app";
const WORKSPACE_PATH = `/app/workspaces/${E2E_PROFILE_FIXTURE.workspaceId}`;

function isServerActionRequest(request: Request, pathname: string): boolean {
  return (
    request.method() === "POST" &&
    new URL(request.url()).pathname === pathname &&
    typeof request.headers()["next-action"] === "string"
  );
}

async function continueUnlessServerAction(
  route: Route,
  pathname: string,
  onAction: () => Promise<void>,
): Promise<void> {
  if (!isServerActionRequest(route.request(), pathname)) {
    await route.continue();
    return;
  }
  await onAction();
}

async function expectTemplateContentPersists(
  page: Page,
  expectedText: string,
): Promise<void> {
  const body = await waitForDocumentEditorReady(page);
  await expect(body.getByText(expectedText, { exact: true })).toBeVisible();
  await page.reload();
  const reloadedBody = await waitForDocumentEditorReady(page);
  await expect(
    reloadedBody.getByText(expectedText, { exact: true }),
  ).toBeVisible();
}

async function clickBackdrop(page: Page): Promise<void> {
  const backdrop = page.locator('[aria-hidden="true"].bg-ds-backdrop');
  const box = await backdrop.boundingBox();
  expect(
    box,
    "template picker backdrop must have clickable geometry",
  ).not.toBeNull();
  await page.mouse.click(box!.x + 2, box!.y + 2);
}

async function createWorkspaceTemplate({
  page,
  credentials,
  templateName,
  expectedText,
}: {
  page: Page;
  credentials: Credentials;
  templateName: string;
  expectedText: string;
}): Promise<void> {
  await login(page, credentials, WORKSPACE_PATH);
  await expect(
    page.getByRole("heading", { name: "E2E Fixture Workspace" }),
  ).toBeVisible({ timeout: 60_000 });

  const trigger = page.getByRole("button", { name: "New document" });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Start a new document" });
  await expect(dialog).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/app\/documents\/[^/]+$/),
    dialog.getByRole("button", { name: `${templateName} template` }).click(),
  ]);
  await expectTemplateContentPersists(page, expectedText);
}

test.describe("template document creation", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);
  test.skip(
    !e2eProfileEnabled(),
    "Set E2E_PROFILE=1 and seed (npm run db:seed:e2e) to run template creation coverage",
  );

  test("dashboard picker contains failures, retries once, suppresses duplicate creation, and persists the selected template @required-profile", async ({
    page,
  }) => {
    await login(page, profileOwnerCredentials(), DASHBOARD_PATH);
    await expect(
      page.getByRole("heading", { name: "Your documents" }),
    ).toBeVisible({ timeout: 60_000 });

    const trigger = page.getByRole("button", { name: "New document" }).first();
    await trigger.focus();
    await trigger.click();
    let dialog = page.getByRole("dialog", { name: "Start a new document" });
    const close = dialog.getByRole("button", { name: "Close" });
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe("hidden");

    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe("");

    await trigger.click();
    dialog = page.getByRole("dialog", { name: "Start a new document" });
    await clickBackdrop(page);
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await trigger.click();
    dialog = page.getByRole("dialog", { name: "Start a new document" });
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1280, height: 720 });

    let actionCount = 0;
    let releaseSuccessfulCreate!: () => void;
    const successfulCreateGate = new Promise<void>((resolve) => {
      releaseSuccessfulCreate = resolve;
    });
    const routePattern = "**/app*";
    await page.route(routePattern, async (route) => {
      await continueUnlessServerAction(route, DASHBOARD_PATH, async () => {
        actionCount += 1;
        if (actionCount === 1) {
          await route.abort("failed");
          return;
        }
        if (actionCount === 2) {
          await successfulCreateGate;
        }
        await route.continue();
      });
    });

    await trigger.click();
    dialog = page.getByRole("dialog", { name: "Start a new document" });
    await dialog
      .getByRole("button", { name: "Process / Flowchart template" })
      .click();
    const alert = dialog.getByRole("alert");
    await expect(alert).toContainText(
      "Could not create the document. Please try again.",
    );
    await expect(
      page.getByRole("heading", { name: "Your documents" }),
    ).toBeVisible();
    expect(actionCount).toBe(1);

    const retry = alert.getByRole("button", { name: "Try again" });
    await retry.dblclick();
    await expect.poll(() => actionCount).toBe(2);
    await expect(dialog).toHaveAttribute("aria-busy", "true");
    await expect(
      dialog.getByRole("button", { name: "Process / Flowchart template" }),
    ).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await clickBackdrop(page);
    await expect(dialog).toBeVisible();

    releaseSuccessfulCreate();
    await page.waitForURL(/\/app\/documents\/[^/]+$/);
    await page.unroute(routePattern);
    expect(actionCount).toBe(2);
    await expectTemplateContentPersists(page, "Process overview");
  });

  test("workspace owner creates a template document that survives reload @required-profile", async ({
    page,
  }) => {
    await createWorkspaceTemplate({
      page,
      credentials: profileOwnerCredentials(),
      templateName: "Mind Map",
      expectedText: "Central idea",
    });
  });

  test("workspace editor creates a template document that survives reload @required-profile", async ({
    page,
  }) => {
    await createWorkspaceTemplate({
      page,
      credentials: profileEditorCredentials(),
      templateName: "Comparison",
      expectedText: "Comparison",
    });
  });

  test("workspace viewer cannot reach create or import actions @required-profile", async ({
    page,
  }) => {
    await login(page, profileViewerCredentials(), WORKSPACE_PATH);
    await expect(
      page.getByRole("heading", { name: "E2E Fixture Workspace" }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole("button", { name: "New document" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Import document" }),
    ).toHaveCount(0);
  });
});
