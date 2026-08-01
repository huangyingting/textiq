import type {
  AuthEmailDeliveryPort,
  AuthEmailMessage,
  PasswordResetEmail,
  VerificationEmail,
} from "@/lib/auth/auth-email-delivery";
import { app as appEnv } from "@/lib/env";
import { createRuntimeAuthEmailDeliveryPort } from "@/lib/auth/auth-email-runtime";

export type {
  AuthEmailDeliveryPort,
  AuthEmailMessage,
  PasswordResetEmail,
  PasswordResetEmailMessage,
  VerificationEmail,
  VerificationEmailMessage,
} from "@/lib/auth/auth-email-delivery";

export const AUTH_EMAIL_DELIVERY_ERROR_CODE = "AUTH_EMAIL_DELIVERY_FAILED";
export const AUTH_EMAIL_DELIVERY_ERROR_MESSAGE =
  "Could not deliver authentication email.";

export class AuthEmailDeliveryError extends Error {
  readonly code = AUTH_EMAIL_DELIVERY_ERROR_CODE;

  constructor(public readonly emailKind: AuthEmailMessage["kind"]) {
    super(AUTH_EMAIL_DELIVERY_ERROR_MESSAGE);
    this.name = "AuthEmailDeliveryError";
  }
}
function trimTrailingSlash(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

export function buildPasswordResetUrl(rawToken: string): string {
  return `${trimTrailingSlash(appEnv.url())}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

export function buildEmailVerificationUrl(rawToken: string): string {
  return `${trimTrailingSlash(appEnv.url())}/verify-email/${encodeURIComponent(rawToken)}`;
}

let configuredEmailDeliveryPort: AuthEmailDeliveryPort | null = null;

export function configureAuthEmailDeliveryPort(
  port: AuthEmailDeliveryPort | null,
): void {
  configuredEmailDeliveryPort = port;
}

function getAuthEmailDeliveryPort(): AuthEmailDeliveryPort {
  return configuredEmailDeliveryPort ?? createRuntimeAuthEmailDeliveryPort();
}

export async function deliverAuthEmail(
  message: AuthEmailMessage,
): Promise<void> {
  try {
    await getAuthEmailDeliveryPort().send(message);
  } catch {
    throw new AuthEmailDeliveryError(message.kind);
  }
}

/* node:coverage ignore next 4 -- Password-reset wrapper delegation is asserted; tsx maps the signature as uncovered. */
export async function deliverPasswordResetEmail(
  email: PasswordResetEmail,
): Promise<void> {
  await deliverAuthEmail({ kind: "password-reset", ...email });
}

export async function deliverVerificationEmail(
  email: VerificationEmail,
): Promise<void> {
  await deliverAuthEmail({ kind: "email-verification", ...email });
}
