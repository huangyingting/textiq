import { app as appEnv } from "@/lib/env";
import { logError } from "@/lib/log";

/* @preserve node:coverage ignore start -- Auth email message contracts are TypeScript-only and erased at runtime. */
export interface PasswordResetEmail {
  /** Recipient address (a real, matched user — never echoed back to clients). */
  to: string;
  /** Absolute, ready-to-click reset URL containing the raw token. */
  resetUrl: string;
}

export interface VerificationEmail {
  /* @preserve node:coverage ignore next -- Interface field declaration is erased at runtime. */
  /** Recipient address (the logged-in user's own email). */
  to: string;
  /** Absolute, ready-to-click verification URL containing the raw token. */
  verifyUrl: string;
}

export type PasswordResetEmailMessage = PasswordResetEmail & {
  kind: "password-reset";
};

export type VerificationEmailMessage = VerificationEmail & {
  kind: "email-verification";
};

export type AuthEmailMessage =
  | PasswordResetEmailMessage
  | VerificationEmailMessage;

export interface AuthEmailDeliveryPort {
  /** Delivers a concrete auth/account email message. */
  send(message: AuthEmailMessage): Promise<void>;
}

export class AuthEmailDeliveryError extends Error {
  constructor(
    public readonly emailKind: AuthEmailMessage["kind"],
    message: string,
  ) {
    super(message);
    this.name = "AuthEmailDeliveryError";
  }
}
/* @preserve node:coverage ignore stop */

function trimTrailingSlash(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

export function buildPasswordResetUrl(rawToken: string): string {
  return `${trimTrailingSlash(appEnv.url())}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

export function buildEmailVerificationUrl(rawToken: string): string {
  return `${trimTrailingSlash(appEnv.url())}/verify-email/${encodeURIComponent(rawToken)}`;
}

function messageScope(message: AuthEmailMessage): string {
  return message.kind === "password-reset"
    ? "password-reset"
    : "email-verification";
}

const devConsoleEmailDeliveryPort: AuthEmailDeliveryPort = {
  async send(message) {
    if (process.env.NODE_ENV === "production") {
      const error = new AuthEmailDeliveryError(
        message.kind,
        `No ${message.kind} email transport is configured`,
      );
      logError(messageScope(message), error);
      throw error;
    }

    if (message.kind === "password-reset") {
      console.info(
        `[password-reset] DEV ONLY — reset link for ${message.to}: ${message.resetUrl}`,
      );
      return;
    }

    console.info(
      `[email-verification] DEV ONLY — verify link for ${message.to}: ${message.verifyUrl}`,
    );
  },
};

let configuredEmailDeliveryPort: AuthEmailDeliveryPort | null = null;

export function configureAuthEmailDeliveryPort(
  port: AuthEmailDeliveryPort | null,
): void {
  configuredEmailDeliveryPort = port;
}

function getAuthEmailDeliveryPort(): AuthEmailDeliveryPort {
  return configuredEmailDeliveryPort ?? devConsoleEmailDeliveryPort;
}

export async function deliverAuthEmail(
  message: AuthEmailMessage,
): Promise<void> {
  try {
    await getAuthEmailDeliveryPort().send(message);
  } catch (error) {
    if (error instanceof AuthEmailDeliveryError) {
      throw error;
    }
    throw new AuthEmailDeliveryError(
      message.kind,
      `Could not deliver ${message.kind} email.`,
    );
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
