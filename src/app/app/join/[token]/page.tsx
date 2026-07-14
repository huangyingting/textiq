import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  evaluateInviteAccess,
  INVITE_ACCESS_SELECT,
  INVITE_DENY_MESSAGES,
  toInviteAccessInput,
  type InviteDenyReason,
} from "@/lib/invite-access";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { acceptWorkspaceInvite } from "@/lib/workspace/invite-service";

export const metadata: Metadata = {
  title: "Join Workspace — TextIQ",
};

/** Safe, clear failure state shown when an invite link can no longer be used. */
function InviteInvalid({ reason }: { reason: InviteDenyReason }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-ds-surface-sunken px-6 py-12">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-ds-border-subtle bg-ds-surface-raised p-8 text-center">
        <h1 className="text-lg font-semibold text-ds-text-primary">
          Invite no longer valid
        </h1>
        <p className="text-sm text-ds-text-secondary">
          {INVITE_DENY_MESSAGES[reason]}
        </p>
        <p className="text-xs text-ds-text-muted">
          Ask a workspace owner for a new invite link.
        </p>
        <Link
          href="/app"
          className="mt-2 self-center rounded-full bg-ds-control px-4 py-2 text-sm font-medium text-ds-control-text transition hover:bg-ds-control-hover"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}

export default async function JoinWorkspacePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await requireUser(redirect);

  // Resolve the link by token only (not filtered by revocation) so the access
  // policy can produce a precise, safe failure state instead of a bare 404.
  const inviteLink = await prisma.inviteLink.findUnique({
    where: { token },
    select: {
      id: true,
      workspaceId: true,
      ...INVITE_ACCESS_SELECT,
      workspace: { select: { ownerId: true } },
    },
  });

  if (!inviteLink) {
    notFound();
  }

  // Owners short-circuit straight to the workspace.
  if (inviteLink.workspace.ownerId === user.id) {
    redirect(`/app/workspaces/${inviteLink.workspaceId}`);
  }

  // Validate the link (revocation, expiry, usage cap) AND the role server-side
  // via the pure policy. A deny never silently joins — it renders a clear state.
  const decision = evaluateInviteAccess(toInviteAccessInput(inviteLink));

  if (!decision.allow) {
    return <InviteInvalid reason={decision.reason} />;
  }

  const result = await acceptWorkspaceInvite({
    inviteLinkId: inviteLink.id,
    userId: user.id,
  });

  if (result.outcome === "denied") {
    return <InviteInvalid reason={result.reason} />;
  }

  redirect(`/app/workspaces/${result.workspaceId}`);
}
