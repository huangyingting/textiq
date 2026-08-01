import type {
  AuthEmailDeliveryPort,
  AuthEmailMessage,
} from "@/lib/auth/auth-email-delivery";
import { app, authEmail } from "@/lib/env";
import { logError } from "@/lib/log";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const AUTH_EMAIL_TIMEOUT_MS = 10_000;

type RuntimeAuthEmailConfig =
  | { mode: "console" }
  | { mode: "resend"; apiKey: string; from: string }
  | { mode: "invalid" };

type RuntimePortDependencies = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function canonicalAppOriginReady(): boolean {
  const rawUrl = app.url("");
  try {
    const url = new URL(rawUrl);
    const production = process.env.NODE_ENV === "production";
    return (
      (url.protocol === "https:" ||
        (!production && url.protocol === "http:")) &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function resendSenderReady(from: string): boolean {
  const displayAddress = /^([^<>]+)<([^<>]+)>$/.exec(from);
  if (from.includes("<") || from.includes(">")) {
    if (!displayAddress || displayAddress[1]?.trim().length === 0) return false;
  }
  const address = (displayAddress?.[2] ?? from).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
}

function resolveRuntimeAuthEmailConfig(): RuntimeAuthEmailConfig {
  const production = process.env.NODE_ENV === "production";
  const delivery = authEmail.delivery();

  if (delivery === undefined) {
    return production ? { mode: "invalid" } : { mode: "console" };
  }
  if (delivery === "console") {
    return production ? { mode: "invalid" } : { mode: "console" };
  }
  if (delivery !== "resend") {
    return { mode: "invalid" };
  }

  const apiKey = authEmail.resendApiKey();
  const from = authEmail.from();
  if (
    !apiKey?.startsWith("re_") ||
    /\s/.test(apiKey) ||
    !from ||
    /[\r\n]/.test(from) ||
    !resendSenderReady(from) ||
    !canonicalAppOriginReady()
  ) {
    return { mode: "invalid" };
  }

  return { mode: "resend", apiKey, from };
}

function emailContent(message: AuthEmailMessage): {
  subject: string;
  text: string;
  html: string;
} {
  const passwordReset = message.kind === "password-reset";
  const actionUrl = passwordReset ? message.resetUrl : message.verifyUrl;
  const subject = passwordReset
    ? "Reset your TextIQ password"
    : "Verify your TextIQ email";
  const introduction = passwordReset
    ? "Use the link below to reset your TextIQ password."
    : "Use the link below to verify your TextIQ email address.";
  const action = passwordReset ? "Reset password" : "Verify email";
  const escapedUrl = actionUrl
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  return {
    subject,
    text: `${introduction}\n\n${actionUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>${introduction}</p><p><a href="${escapedUrl}">${action}</a></p><p>If you did not request this, you can ignore this email.</p>`,
  };
}

function consoleDeliveryPort(): AuthEmailDeliveryPort {
  return {
    async send(message) {
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
}

function invalidDeliveryPort(): AuthEmailDeliveryPort {
  return {
    async send(message) {
      const error = new Error(
        "Authentication email delivery is not configured.",
      );
      logError(message.kind, error);
      throw error;
    },
  };
}

function resendDeliveryPort(
  config: Extract<RuntimeAuthEmailConfig, { mode: "resend" }>,
  {
    fetchImpl = fetch,
    timeoutMs = AUTH_EMAIL_TIMEOUT_MS,
  }: RuntimePortDependencies,
): AuthEmailDeliveryPort {
  return {
    async send(message) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const content = emailContent(message);
        const response = await fetchImpl(RESEND_EMAILS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.to],
            subject: content.subject,
            text: content.text,
            html: content.html,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Authentication email provider rejected delivery.");
        }
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/** True when the current runtime can safely deliver auth emails. */
export function isAuthEmailConfigurationReady(): boolean {
  return resolveRuntimeAuthEmailConfig().mode !== "invalid";
}

/**
 * Selects the development console or production Resend adapter.
 *
 * Invalid, partial, or production-console configuration always fails closed.
 */
export function createRuntimeAuthEmailDeliveryPort(
  dependencies: RuntimePortDependencies = {},
): AuthEmailDeliveryPort {
  const config = resolveRuntimeAuthEmailConfig();
  if (config.mode === "console") return consoleDeliveryPort();
  if (config.mode === "resend") {
    return resendDeliveryPort(config, dependencies);
  }
  return invalidDeliveryPort();
}
