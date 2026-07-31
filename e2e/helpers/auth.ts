import { expect, type BrowserContext, type Page } from "@playwright/test";
import { assertProfileCredentialGate } from "./credential-gate";

/**
 * Shared auth helpers for the workspace E2E flows (issue #107).
 *
 * Authenticated flows need a real session. Rather than hard-code fixtures, the
 * specs read credentials from the environment so the same suite can run against
 * a locally seeded database or a staging environment:
 *
 *   E2E_USER_EMAIL    — email of a seeded user that owns/edits a workspace
 *   E2E_USER_PASSWORD — that user's password
 * When the required credentials are absent the calling spec should skip, so the
 * suite stays green in environments without seeded users.
 */
export type Credentials = { email: string; password: string };

const credentialGatedContexts = new WeakSet<BrowserContext>();

export function ownerCredentials(): Credentials | null {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) return null;
  return { email, password };
}

/**
 * Logs in via the credentials form and waits for the redirect into `/app`.
 */
export async function login(
  page: Page,
  { email, password }: Credentials,
  afterLoginPath?: string,
): Promise<void> {
  await assertProfileCredentialGate();
  await installCredentialRequestGate(page.context());
  await page.goto("/login");
  await assertProfileCredentialGate();
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await assertProfileCredentialGate();
  await Promise.all([
    page.waitForURL(/\/app(\/|$|\?)/, { waitUntil: "commit" }),
    page.getByRole("button", { name: /log in/i }).click(),
  ]);
  await expect(page).toHaveURL(/\/app/);
  if (afterLoginPath) {
    await page.goto(afterLoginPath);
  }
}

async function installCredentialRequestGate(
  context: BrowserContext,
): Promise<void> {
  if (process.env.E2E_PROFILE !== "1" || credentialGatedContexts.has(context)) {
    return;
  }
  credentialGatedContexts.add(context);
}
