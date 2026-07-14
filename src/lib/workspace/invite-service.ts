import "server-only";

import { nanoid } from "nanoid";

import { Prisma } from "@/generated/prisma/client";
import { evaluateInviteAccess, toInviteAccessInput } from "@/lib/invite-access";
import { prisma } from "@/lib/prisma";
import {
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

const MAX_ACCEPT_INVITE_CAS_ATTEMPTS = 2;

const ACCEPT_INVITE_SELECT = {
  id: true,
  workspaceId: true,
  role: true,
  isRevoked: true,
  expiresAt: true,
  maxUses: true,
  useCount: true,
  workspace: { select: { ownerId: true } },
} satisfies Prisma.InviteLinkSelect;

type InviteAcceptanceTxClient = Pick<
  Prisma.TransactionClient,
  "inviteLink" | "workspaceMember" | "inviteLinkUse"
>;

type InviteForAcceptance = Prisma.InviteLinkGetPayload<{
  select: typeof ACCEPT_INVITE_SELECT;
}>;

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

function assertPersistedInvitableWorkspaceRole(role: unknown): WorkspaceRole {
  if (!isInvitableWorkspaceRole(role)) {
    throw new Error(`Invalid persisted invite role: ${String(role)}.`);
  }
  return role;
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

  return {
    ...inviteLink,
    role: assertPersistedInvitableWorkspaceRole(inviteLink.role),
  };
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

class AlreadyMemberSignal extends Error {
  constructor(readonly workspaceId: string) {
    super("User is already a workspace member.");
  }
}

class InviteAcceptanceConflictError extends Error {
  constructor(inviteLinkId: string) {
    super(
      `Invite acceptance conflicted for invite link ${inviteLinkId} after bounded retries.`,
    );
  }
}

function buildInviteConsumptionWhere(invite: InviteForAcceptance) {
  return {
    id: invite.id,
    workspaceId: invite.workspaceId,
    role: invite.role,
    isRevoked: false,
    expiresAt: invite.expiresAt,
    maxUses: invite.maxUses,
    useCount:
      invite.maxUses === null
        ? invite.useCount
        : { equals: invite.useCount, lt: invite.maxUses },
  } satisfies Prisma.InviteLinkWhereInput;
}

async function loadInviteForAcceptance(
  tx: InviteAcceptanceTxClient,
  inviteLinkId: string,
): Promise<InviteForAcceptance | null> {
  return tx.inviteLink.findUnique({
    where: { id: inviteLinkId },
    select: ACCEPT_INVITE_SELECT,
  });
}

async function hasWorkspaceMembership(
  tx: InviteAcceptanceTxClient,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const member = await tx.workspaceMember.findFirst({
    where: { workspaceId, userId },
    select: { id: true },
  });

  return member !== null;
}

async function acceptWorkspaceInviteInTransaction(
  tx: InviteAcceptanceTxClient,
  input: AcceptInviteInput,
  now: Date,
): Promise<AcceptInviteResult> {
  for (
    let attempt = 0;
    attempt < MAX_ACCEPT_INVITE_CAS_ATTEMPTS;
    attempt += 1
  ) {
    const invite = await loadInviteForAcceptance(tx, input.inviteLinkId);
    if (!invite) {
      return { outcome: "denied", reason: "revoked" };
    }

    const decision = evaluateInviteAccess(toInviteAccessInput(invite, now));
    if (!decision.allow) {
      return { outcome: "denied", reason: decision.reason };
    }

    if (invite.workspace.ownerId === input.userId) {
      return { outcome: "already-owner", workspaceId: invite.workspaceId };
    }

    const existingMember = await hasWorkspaceMembership(
      tx,
      invite.workspaceId,
      input.userId,
    );
    if (existingMember) {
      return { outcome: "already-member", workspaceId: invite.workspaceId };
    }

    const consumedInvite = await tx.inviteLink.updateMany({
      where: buildInviteConsumptionWhere(invite),
      data: { useCount: { increment: 1 } },
    });

    if (consumedInvite.count !== 1) {
      continue;
    }

    try {
      await tx.workspaceMember.create({
        data: {
          workspaceId: invite.workspaceId,
          userId: input.userId,
          role: decision.role,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AlreadyMemberSignal(invite.workspaceId);
      }
      throw error;
    }

    await tx.inviteLinkUse.create({
      data: {
        inviteLinkId: invite.id,
        userId: input.userId,
        role: decision.role,
      },
    });

    return { outcome: "joined", workspaceId: invite.workspaceId };
  }

  const latestInvite = await loadInviteForAcceptance(tx, input.inviteLinkId);
  if (!latestInvite) {
    return { outcome: "denied", reason: "revoked" };
  }

  const latestDecision = evaluateInviteAccess(
    toInviteAccessInput(latestInvite, now),
  );
  if (!latestDecision.allow) {
    return { outcome: "denied", reason: latestDecision.reason };
  }

  if (latestInvite.workspace.ownerId === input.userId) {
    return { outcome: "already-owner", workspaceId: latestInvite.workspaceId };
  }

  const latestMember = await hasWorkspaceMembership(
    tx,
    latestInvite.workspaceId,
    input.userId,
  );
  if (latestMember) {
    return { outcome: "already-member", workspaceId: latestInvite.workspaceId };
  }

  throw new InviteAcceptanceConflictError(input.inviteLinkId);
}

/**
 * Atomically accepts a workspace invite in one transaction. The persisted invite
 * row is the source of truth for grant facts (workspace, role, cap, expiry,
 * revocation), which are re-evaluated at mutation time before capacity is
 * consumed, membership is created, and audit is written.
 */
export async function acceptWorkspaceInvite(
  input: AcceptInviteInput,
): Promise<AcceptInviteResult> {
  const now = input.now ?? new Date();

  try {
    return await prisma.$transaction(async (tx) =>
      acceptWorkspaceInviteInTransaction(tx, input, now),
    );
  } catch (error) {
    if (error instanceof AlreadyMemberSignal) {
      return { outcome: "already-member", workspaceId: error.workspaceId };
    }
    throw error;
  }
}
