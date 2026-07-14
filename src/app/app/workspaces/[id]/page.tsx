import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { accessibleWorkspaceWhere } from "@/lib/access-query";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import {
  assertPersistedWorkspaceMemberRole,
  type EffectiveWorkspaceRole,
  type PersistedWorkspaceMemberRole,
} from "@/lib/workspace/roles";

import { InviteLinkManager } from "./invite-link-manager";
import { MembersList } from "./members-list";
import { WorkspaceDocuments } from "./workspace-documents";
import { WorkspaceSettings } from "./workspace-settings";

export const metadata: Metadata = {
  title: "Workspace — TextIQ",
};

function toEffectiveWorkspaceRole(
  role: PersistedWorkspaceMemberRole,
): Exclude<EffectiveWorkspaceRole, "owner"> {
  return role === "EDITOR" ? "editor" : "viewer";
}

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(redirect);

  // Check if user is owner or member
  const workspace = await prisma.workspace.findFirst({
    where: accessibleWorkspaceWhere(user.id, id),
    select: {
      id: true,
      name: true,
      ownerId: true,
      owner: { select: { email: true, name: true } },
      members: {
        select: {
          id: true,
          userId: true,
          role: true,
          createdAt: true,
          user: { select: { email: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      inviteLinks: {
        where: { isRevoked: false },
        select: {
          id: true,
          token: true,
          role: true,
          createdAt: true,
          expiresAt: true,
          maxUses: true,
          useCount: true,
        },
        orderBy: { createdAt: "desc" },
      },
      _count: { select: { documents: true } },
    },
  });

  if (!workspace) {
    notFound();
  }

  const isOwner = workspace.ownerId === user.id;
  const userMembership = workspace.members.find((m) => m.userId === user.id);
  const userRole: EffectiveWorkspaceRole | null = isOwner
    ? "owner"
    : userMembership
      ? toEffectiveWorkspaceRole(
          assertPersistedWorkspaceMemberRole(userMembership.role),
        )
      : null;

  if (!userRole) {
    notFound();
  }

  // The `role` columns are plain strings (portable schema); parse them at this
  // boundary so malformed persisted rows fail explicitly.
  const workspaceForMembers = {
    ...workspace,
    members: workspace.members.map((member) => ({
      ...member,
      role: assertPersistedWorkspaceMemberRole(member.role),
    })),
  };
  const inviteLinks = workspace.inviteLinks.map((link) => ({
    ...link,
    role: assertPersistedWorkspaceMemberRole(link.role),
  }));

  return (
    <main className="flex flex-1 flex-col items-center bg-ds-surface-sunken px-6 py-12">
      <div className="flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-4">
          <Link
            href="/app/workspaces"
            className="flex items-center gap-1.5 text-sm text-ds-text-secondary transition hover:text-ds-text-primary"
          >
            <svg
              viewBox="0 0 16 16"
              fill="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M11.707 3.293a1 1 0 0 1 0 1.414L7.414 9l4.293 4.293a1 1 0 0 1-1.414 1.414l-5-5a1 1 0 0 1 0-1.414l5-5a1 1 0 0 1 1.414 0z" />
            </svg>
            Back to workspaces
          </Link>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-ds-text-primary">
              {workspace.name}
            </h1>
            <p className="text-sm text-ds-text-secondary">
              {workspace._count.documents} document
              {workspace._count.documents !== 1 ? "s" : ""} ·{" "}
              {workspace.members.length + 1} member
              {workspace.members.length + 1 !== 1 ? "s" : ""}
            </p>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold text-ds-text-primary">
              Members
            </h2>
            <MembersList
              workspace={workspaceForMembers}
              isOwner={isOwner}
              currentUserId={user.id}
            />
          </section>

          {isOwner && (
            <section className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold text-ds-text-primary">
                Invite links
              </h2>
              <InviteLinkManager
                workspaceId={workspace.id}
                inviteLinks={inviteLinks}
              />
            </section>
          )}
        </div>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ds-text-primary">
            Documents
          </h2>
          <WorkspaceDocuments workspaceId={workspace.id} userRole={userRole} />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ds-text-primary">
            {isOwner ? "Workspace settings" : "Membership"}
          </h2>
          <WorkspaceSettings
            workspaceId={workspace.id}
            name={workspace.name}
            isOwner={isOwner}
          />
        </section>
      </div>
    </main>
  );
}
