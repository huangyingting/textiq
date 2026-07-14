import {
  evaluateVerificationToken,
  type VerificationTokenRejection,
} from "@/lib/auth/verification-token";
import type {
  VerificationTokenInactiveReason,
  VerificationTokenPort,
  VerificationTokenReconciliationState,
} from "@/lib/auth/verification-token-port";
import type { prisma } from "@/lib/prisma";

type PrismaClientLike = typeof prisma;
type VerificationTokenClient = Pick<PrismaClientLike, "emailVerificationToken">;

type VerificationTokenReconciliationRow = Readonly<{
  expiresAt: Date;
  usedAt: Date | null;
}>;

function toInactiveReason(
  reason: VerificationTokenRejection,
): VerificationTokenInactiveReason {
  if (reason === "used" || reason === "expired") {
    return reason;
  }
  return "missing";
}

function toReconciliationState(input: {
  row: VerificationTokenReconciliationRow;
  now: Date;
}): VerificationTokenReconciliationState {
  const evaluation = evaluateVerificationToken({
    exists: true,
    expiresAt: input.row.expiresAt,
    usedAt: input.row.usedAt,
    now: input.now,
  });
  if (evaluation.valid) {
    return { status: "active" };
  }
  return {
    status: "inactive",
    reason: toInactiveReason(evaluation.reason),
  };
}

export function createPrismaVerificationTokenPort(
  client: VerificationTokenClient,
): VerificationTokenPort {
  return {
    async create(input) {
      await client.emailVerificationToken.create({
        data: input,
      });
    },
    async reconcileByTokenHash(input) {
      const matches = await client.emailVerificationToken.findMany({
        where: { tokenHash: input.tokenHash },
        select: { expiresAt: true, usedAt: true },
        take: 2,
      });

      if (matches.length === 0) {
        return { status: "inactive", reason: "missing" };
      }
      if (matches.length > 1) {
        return { status: "ambiguous" };
      }

      const row = matches[0];
      if (!row) {
        return { status: "inactive", reason: "missing" };
      }
      return toReconciliationState({
        row,
        now: input.now,
      });
    },
  };
}
