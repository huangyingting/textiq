import { actionError, actionOk } from "@/lib/action-result";
import {
  AuthEmailDeliveryError,
  buildEmailVerificationUrl,
  deliverVerificationEmail,
} from "@/lib/auth/email";
import type { VerifyEmailResult } from "@/lib/auth/form-state";
import { createPrismaVerificationTokenPort } from "@/lib/auth/verification-token-prisma-adapter";
import {
  VERIFICATION_TOKEN_REJECTION_MESSAGE,
  VERIFICATION_TOKEN_TTL_MS,
  buildVerificationTokenPersistenceInput,
  evaluateVerificationToken,
  generateVerificationTokenMaterial,
  hashVerificationToken,
  type VerificationTokenPersistenceInput,
} from "@/lib/auth/verification-token";
import type {
  VerificationTokenPort,
  VerificationTokenReconciliationState,
} from "@/lib/auth/verification-token-port";
import { singleUseTokenExpiresAt } from "@/lib/auth/single-use-token";
import { logError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { logSecurityAudit } from "@/lib/security-audit";

type PrismaClientLike = typeof prisma;
type EmailVerificationWriteClient = Pick<
  PrismaClientLike,
  "emailVerificationToken" | "user"
>;

export type VerifyOutcome =
  { status: "verified" } | { status: "error"; message: string };

const GENERIC_VERIFICATION_ERROR =
  "Could not send a verification email. Please try again.";

export const AUTH_EMAIL_VERIFICATION_ACTIVATION_ERROR_CODE =
  "AUTH_EMAIL_VERIFICATION_ACTIVATION_FAILED";
const AUTH_EMAIL_VERIFICATION_ACTIVATION_ERROR_MESSAGE =
  "Could not activate a delivered email verification token.";
export const AUTH_EMAIL_VERIFICATION_RECONCILIATION_ERROR_CODE =
  "AUTH_EMAIL_VERIFICATION_RECONCILIATION_FAILED";
const AUTH_EMAIL_VERIFICATION_RECONCILIATION_ERROR_MESSAGE =
  "Could not reconcile delivered email verification token activation.";

type VerificationTokenActivationStatus =
  | { status: "sent" }
  | { status: "activation_failed" }
  | { status: "reconciliation_failed" };

export async function requestEmailVerificationForUser(
  userId: string,
  client: PrismaClientLike = prisma,
): Promise<VerifyEmailResult> {
  try {
    const dbUser = await client.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    });
    if (!dbUser) {
      return actionError(GENERIC_VERIFICATION_ERROR);
    }
    if (dbUser.emailVerified) {
      logSecurityAudit("auth.email_verification.requested", {
        userId,
        outcome: "already_verified",
      });
      return actionOk({ status: "already_verified" });
    }

    const tokenMaterial = generateVerificationTokenMaterial();
    const expiresAt = singleUseTokenExpiresAt(VERIFICATION_TOKEN_TTL_MS);
    await deliverVerificationEmail({
      to: dbUser.email,
      verifyUrl: buildEmailVerificationUrl(tokenMaterial.rawToken),
    });

    const tokenActivationStatus = await activateDeliveredVerificationToken({
      tokenPort: createPrismaVerificationTokenPort(client),
      persistenceInput: buildVerificationTokenPersistenceInput({
        userId,
        material: tokenMaterial,
        expiresAt,
      }),
      now: new Date(),
    });

    if (tokenActivationStatus.status === "activation_failed") {
      logVerificationTokenActivationFailure(userId);
      return actionError(GENERIC_VERIFICATION_ERROR);
    }
    if (tokenActivationStatus.status === "reconciliation_failed") {
      logVerificationTokenReconciliationFailure(userId);
      return actionError(GENERIC_VERIFICATION_ERROR);
    }

    logSecurityAudit("auth.email_verification.requested", {
      userId,
      outcome: "sent",
    });
    return actionOk({ status: "sent" });
  } catch (error) {
    logError("email-verification", error, {
      ...(error instanceof AuthEmailDeliveryError
        ? {
            outcome: "delivery_failed",
            emailKind: error.emailKind,
            code: error.code,
          }
        : {}),
    });
    return actionError(GENERIC_VERIFICATION_ERROR);
  }
}

export async function consumeEmailVerificationToken(
  rawToken: string,
  client: PrismaClientLike = prisma,
): Promise<VerifyOutcome> {
  if (!rawToken) {
    return {
      status: "error",
      message: VERIFICATION_TOKEN_REJECTION_MESSAGE.not_found,
    };
  }

  try {
    const tokenHash = hashVerificationToken(rawToken);
    const record = await client.emailVerificationToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });

    const evaluation = evaluateVerificationToken({
      exists: record !== null,
      expiresAt: record?.expiresAt ?? null,
      usedAt: record?.usedAt ?? null,
      now: new Date(),
    });

    if (!evaluation.valid || record === null) {
      return {
        status: "error",
        message: evaluation.valid
          ? VERIFICATION_TOKEN_REJECTION_MESSAGE.not_found
          : VERIFICATION_TOKEN_REJECTION_MESSAGE[evaluation.reason],
      };
    }

    const usedAt = new Date();
    const consumed = await client.$transaction(async (tx) =>
      consumeVerificationTokenAndVerifyEmail(tx, {
        tokenId: record.id,
        userId: record.userId,
        usedAt,
      }),
    );

    if (!consumed) {
      /* node:coverage ignore next 5 -- Verification race audit payload is asserted; tsx maps object rows as uncovered. */
      logSecurityAudit("auth.email_verification.consumed", {
        userId: record.userId,
        outcome: "rejected",
        reason: "used",
      });
      return {
        status: "error",
        message: VERIFICATION_TOKEN_REJECTION_MESSAGE.used,
      };
    }

    logSecurityAudit("auth.email_verification.consumed", {
      userId: record.userId,
      outcome: "success",
    });
    return { status: "verified" };
  } catch (error) {
    logError("email-verification", error);
    return {
      status: "error",
      message: "Could not verify your email. Please try again.",
    };
  }
}

async function consumeVerificationTokenAndVerifyEmail(
  client: EmailVerificationWriteClient,
  input: { tokenId: string; userId: string; usedAt: Date },
): Promise<boolean> {
  const consumed = await client.emailVerificationToken.updateMany({
    where: {
      id: input.tokenId,
      userId: input.userId,
      usedAt: null,
      expiresAt: { gt: input.usedAt },
    },
    data: { usedAt: input.usedAt },
  });

  if (consumed.count !== 1) {
    return false;
  }

  await client.user.update({
    where: { id: input.userId },
    data: { emailVerified: input.usedAt },
  });
  await client.emailVerificationToken.updateMany({
    where: { userId: input.userId, usedAt: null, id: { not: input.tokenId } },
    data: { usedAt: input.usedAt },
  });

  return true;
}

function logVerificationTokenActivationFailure(userId: string): void {
  logError(
    "email-verification",
    new Error(AUTH_EMAIL_VERIFICATION_ACTIVATION_ERROR_MESSAGE),
    {
      outcome: "activation_failed",
      code: AUTH_EMAIL_VERIFICATION_ACTIVATION_ERROR_CODE,
      userId,
    },
  );
}

function logVerificationTokenReconciliationFailure(userId: string): void {
  logError(
    "email-verification",
    new Error(AUTH_EMAIL_VERIFICATION_RECONCILIATION_ERROR_MESSAGE),
    {
      outcome: "reconciliation_failed",
      code: AUTH_EMAIL_VERIFICATION_RECONCILIATION_ERROR_CODE,
      userId,
    },
  );
}

async function activateDeliveredVerificationToken(input: {
  tokenPort: VerificationTokenPort;
  persistenceInput: VerificationTokenPersistenceInput;
  now: Date;
}): Promise<VerificationTokenActivationStatus> {
  try {
    await input.tokenPort.create(input.persistenceInput);
    return { status: "sent" };
  } catch {
    return reconcileDeliveredVerificationToken({
      tokenPort: input.tokenPort,
      tokenHash: input.persistenceInput.tokenHash,
      now: input.now,
    });
  }
}

async function reconcileDeliveredVerificationToken(input: {
  tokenPort: Pick<VerificationTokenPort, "reconcileByTokenHash">;
  tokenHash: string;
  now: Date;
}): Promise<VerificationTokenActivationStatus> {
  try {
    const reconciliation = await input.tokenPort.reconcileByTokenHash({
      tokenHash: input.tokenHash,
      now: input.now,
    });
    return mapReconciliationToActivationStatus(reconciliation);
  } catch {
    return { status: "reconciliation_failed" };
  }
}

function mapReconciliationToActivationStatus(
  reconciliation: VerificationTokenReconciliationState,
): VerificationTokenActivationStatus {
  if (reconciliation.status === "active") {
    return { status: "sent" };
  }
  if (reconciliation.status === "ambiguous") {
    return { status: "reconciliation_failed" };
  }
  return { status: "activation_failed" };
}
