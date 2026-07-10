import "server-only";

import { nanoid } from "nanoid";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  asWorkspaceRole,
  isInvitableWorkspaceRole,
  type WorkspaceRole,
} from "@/lib/workspace/roles";
import type {
  AcceptInviteInput,
  AcceptInviteResult,
  CreateInviteLinkOptions,
  InviteLink,
  InviteLinkTarget,
} from "@/lib/workspace/invite-types";

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/** Largest accepted expiry window, guarding against overflow/typos. */
export const MAX_INVITE_EXPIRY_DAYS = 365;

/** Largest accepted usage cap. */
export const MAX_INVITE_USES_LIMIT = 10_000;

/** Converts an optional expiry window in days to an absolute timestamp. */
export function normalizeInviteExpiry(
  expiresInDays?: number | null,
  now: Date = new Date(),
): Date | null {
  if (expiresInDays === null || expiresInDays === undefined) {
    return null;
  }
  if (
    !Number.isFinite(expiresInDays) ||
    expiresInDays <= 0 ||
    expiresInDays > MAX_INVITE_EXPIRY_DAYS
  ) {
    throw new Error(`Invalid invite expiry: ${String(expiresInDays)} days.`);
  }
  return new Date(now.getTime() + expiresInDays * MILLIS_PER_DAY);
}

/** Validates an optional usage cap. */
export function normalizeInviteMaxUses(maxUses?: number | null): number | null {
  if (maxUses === null || maxUses === undefined) {
    return null;
  }
  if (
    !Number.isInteger(maxUses) ||
    maxUses <= 0 ||
    maxUses > MAX_INVITE_USES_LIMIT
  ) {
    throw new Error(`Invalid invite usage limit: ${String(maxUses)}.`);
  }
  return maxUses;
}

export function assertInvitableWorkspaceRole(role: WorkspaceRole): void {
  if (!isInvitableWorkspaceRole(role)) {
    throw new Error(`Invalid invite role: ${String(role)}.`);
  }
}

export async function createWorkspaceInviteLink({
  workspaceId,
  role,
  createdById,
  options = {},
}: {
  workspaceId: string;
  role: WorkspaceRole;
  createdById: string;
  options?: CreateInviteLinkOptions;
}): Promise<InviteLink> {
  assertInvitableWorkspaceRole(role);

  const inviteLink = await prisma.inviteLink.create({
    data: {
      workspaceId,
      token: nanoid(16),
      role,
      createdById,
      expiresAt: normalizeInviteExpiry(options.expiresInDays),
      maxUses: normalizeInviteMaxUses(options.maxUses),
    },
    select: {
      id: true,
      token: true,
      role: true,
      createdAt: true,
      expiresAt: true,
      maxUses: true,
      useCount: true,
    },
  });

  return { ...inviteLink, role: asWorkspaceRole(inviteLink.role) };
}

export async function getInviteLinkTarget(
  linkId: string,
): Promise<InviteLinkTarget | null> {
  return prisma.inviteLink.findFirst({
    where: { id: linkId },
    select: { workspaceId: true },
  });
}

export async function revokeWorkspaceInviteLink(linkId: string): Promise<void> {
  await prisma.inviteLink.update({
    where: { id: linkId },
    data: { isRevoked: true },
  });
}

/**
 * Private sentinel used to communicate cap-exhaustion out of the interactive
 * transaction callback. Never exported — callers receive a typed result.
 */
class CapExhaustedSignal extends Error {}

/**
 * Atomically accepts a workspace invite: re-verifies the usage cap with a
 * conditional `updateMany`, grants membership, and writes the audit row — all
 * in one transaction so a successful join is always fully recorded and races
 * cannot bypass `maxUses`.
 *
 * P2002 from the unique `(workspaceId, userId)` constraint on
 * `workspaceMember.create` escapes the transaction callback so the earlier
 * increment write is rolled back, then is converted outside the transaction
 * to the typed `already-member` outcome.
 */
export async function acceptWorkspaceInvite(
  input: AcceptInviteInput,
): Promise<AcceptInviteResult> {
  try {
    await prisma.$transaction(async (tx) => {
      const capUpdate = await tx.inviteLink.updateMany({
        where:
          input.maxUses === null
            ? { id: input.inviteLinkId }
            : {
                id: input.inviteLinkId,
                useCount: { lt: input.maxUses },
              },
        data: { useCount: { increment: 1 } },
      });

      if (capUpdate.count === 0) {
        throw new CapExhaustedSignal();
      }

      await tx.workspaceMember.create({
        data: {
          workspaceId: input.workspaceId,
          userId: input.userId,
          role: input.role,
        },
      });

      await tx.inviteLinkUse.create({
        data: {
          inviteLinkId: input.inviteLinkId,
          userId: input.userId,
          role: input.role,
        },
      });
    });

    return { outcome: "joined" };
  } catch (err) {
    if (err instanceof CapExhaustedSignal) {
      return { outcome: "cap-exhausted" };
    }
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { outcome: "already-member" };
    }
    throw err;
  }
}
