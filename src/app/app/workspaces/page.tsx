import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";

import { EMPTY_STATE_CHROME, PANEL_CHROME, cx } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import {
  assertPersistedWorkspaceMemberRole,
  type EffectiveWorkspaceRole,
  type PersistedWorkspaceMemberRole,
} from "@/lib/workspace/roles";

import { CreateWorkspaceButton } from "./create-workspace-button";

export const metadata: Metadata = {
  title: "Workspaces — TextIQ",
};

function toEffectiveWorkspaceRole(
  role: PersistedWorkspaceMemberRole,
): Exclude<EffectiveWorkspaceRole, "owner"> {
  return role === "EDITOR" ? "editor" : "viewer";
}

const ROLE_BADGE_LABELS: Record<EffectiveWorkspaceRole, string> = {
  owner: "OWNER",
  editor: "EDITOR",
  viewer: "VIEWER",
};

export default async function WorkspacesPage() {
  const user = await requireUser(redirect);

  // Get workspaces where the user is owner or member
  const ownedWorkspaces = await prisma.workspace.findMany({
    where: { ownerId: user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      _count: { select: { members: true, documents: true } },
    },
  });

  const memberWorkspaces = await prisma.workspace.findMany({
    where: {
      members: {
        some: {
          userId: user.id,
        },
      },
      ownerId: { not: user.id },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      _count: { select: { members: true, documents: true } },
      members: {
        where: { userId: user.id },
        select: { role: true },
      },
    },
  });

  const allWorkspaces = [
    ...ownedWorkspaces.map((workspace) => ({
      ...workspace,
      userRole: "owner" as const,
    })),
    ...memberWorkspaces.map((w) => ({
      ...w,
      userRole: (() => {
        const membershipRole = w.members[0]?.role;
        if (!membershipRole) {
          throw new Error(
            `Workspace ${w.id} is missing the caller membership row.`,
          );
        }
        return toEffectiveWorkspaceRole(
          assertPersistedWorkspaceMemberRole(membershipRole),
        );
      })(),
      members: undefined,
    })),
  ];

  return (
    <main className="flex flex-1 flex-col items-center bg-ds-surface-sunken px-6 py-12">
      <div className="flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-ds-text-primary">
              Workspaces
            </h1>
            <p className="text-sm text-ds-text-secondary">
              Shared spaces for team collaboration
            </p>
          </div>
          <CreateWorkspaceButton />
        </header>

        {allWorkspaces.length === 0 ? (
          <div
            className={cx(
              "flex flex-col items-center gap-4 px-6 py-16",
              EMPTY_STATE_CHROME,
            )}
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-medium text-ds-text-primary">
                No workspaces yet
              </h2>
              <p className="text-sm text-ds-text-muted">
                Create a workspace to collaborate with your team.
              </p>
            </div>
            <CreateWorkspaceButton>
              Create your first workspace
            </CreateWorkspaceButton>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {allWorkspaces.map((workspace) => (
              <li key={workspace.id}>
                <Link
                  href={`/app/workspaces/${workspace.id}`}
                  className={cx(
                    "group flex flex-col p-6 transition hover:border-ds-border-strong hover:shadow-ds-raised",
                    PANEL_CHROME,
                  )}
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                      <h3 className="truncate text-base font-semibold text-ds-text-primary">
                        {workspace.name}
                      </h3>
                      <span className="shrink-0 rounded-full bg-ds-surface-sunken px-2 py-0.5 text-xs font-medium text-ds-text-secondary">
                        {ROLE_BADGE_LABELS[workspace.userRole]}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1 text-xs text-ds-text-muted">
                      <div>
                        {workspace._count.members + 1} member
                        {workspace._count.members + 1 !== 1 ? "s" : ""}
                      </div>
                      <div>
                        {workspace._count.documents} document
                        {workspace._count.documents !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
