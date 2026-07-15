import { expect, type Page } from "@playwright/test";

/**
 * Shared auth helpers for the workspace E2E flows (issue #107).
 *
 * Authenticated flows need a real session. Rather than hard-code fixtures, the
 * specs read credentials from the environment so the same suite can run against
 * a locally seeded database or a staging environment:
 *
 *   E2E_USER_EMAIL    — email of a seeded user that owns/edits a workspace
 *   E2E_USER_PASSWORD — that user's password
 *   E2E_VIEWER_EMAIL  — (optional) a user with VIEWER-only access to a doc
 *   E2E_VIEWER_PASSWORD
 *   E2E_VIEWER_DOC_URL — (optional) a document URL the viewer can open read-only
 *
 * When the required credentials are absent the calling spec should skip, so the
 * suite stays green in environments without seeded users.
 */
export type Credentials = { email: string; password: string };

export function ownerCredentials(): Credentials | null {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  return email && password ? { email, password } : null;
}

export function viewerCredentials(): Credentials | null {
  const email = process.env.E2E_VIEWER_EMAIL;
  const password = process.env.E2E_VIEWER_PASSWORD;
  return email && password ? { email, password } : null;
}

/**
 * Logs in via the credentials form and waits for the redirect into `/app`.
 */
export async function login(
  page: Page,
  { email, password }: Credentials,
  afterLoginPath?: string,
): Promise<void> {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/app(\/|$|\?)/, { waitUntil: "commit" }),
    page.getByRole("button", { name: /log in/i }).click(),
  ]);
  await expect(page).toHaveURL(/\/app/);
  if (afterLoginPath) {
    await page.goto(afterLoginPath);
  }
}
