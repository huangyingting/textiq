import { actionError, actionOk } from "@/lib/action-result";
import {
  AuthEmailDeliveryError,
  buildEmailVerificationUrl,
  deliverVerificationEmail,
} from "@/lib/auth/email";
import type { VerifyEmailResult } from "@/lib/auth/form-state";
import {
  VERIFICATION_TOKEN_REJECTION_MESSAGE,
  VERIFICATION_TOKEN_TTL_MS,
  evaluateVerificationToken,
  generateVerificationToken,
  hashVerificationToken,
} from "@/lib/auth/verification-token";
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
  | { status: "verified" }
  | { status: "error"; message: string };

const GENERIC_VERIFICATION_ERROR =
  "Could not send a verification email. Please try again.";

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

    const rawToken = generateVerificationToken();
    const tokenHash = hashVerificationToken(rawToken);
    const expiresAt = singleUseTokenExpiresAt(VERIFICATION_TOKEN_TTL_MS);
    const createdToken = await client.emailVerificationToken.create({
      data: { userId, tokenHash, expiresAt },
      select: { id: true },
    });

    try {
      await deliverVerificationEmail({
        to: dbUser.email,
        verifyUrl: buildEmailVerificationUrl(rawToken),
      });
    } catch (deliveryError) {
      await cleanupUndeliveredVerificationToken(client, {
        userId,
        tokenId: createdToken.id,
      });
      throw deliveryError;
    }

    await client.emailVerificationToken.updateMany({
      where: { userId, usedAt: null, id: { not: createdToken.id } },
      data: { usedAt: new Date() },
    });

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

async function cleanupUndeliveredVerificationToken(
  client: PrismaClientLike,
  input: { userId: string; tokenId: string },
): Promise<void> {
  try {
    await client.emailVerificationToken.deleteMany({
      where: {
        id: input.tokenId,
        userId: input.userId,
        usedAt: null,
      },
    });
  } catch (cleanupError) {
    logError("email-verification", cleanupError, {
      outcome: "delivery_cleanup_failed",
      userId: input.userId,
      tokenId: input.tokenId,
    });
  }
}
