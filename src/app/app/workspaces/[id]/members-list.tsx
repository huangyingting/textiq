"use client";

import { unstable_rethrow } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button, Dialog, PANEL_CHROME, cx } from "@/components/ui";
import type {
  EffectiveWorkspaceRole,
  PersistedWorkspaceMemberRole,
} from "@/lib/workspace/roles";
import { persistedMemberRoleToEffectiveRole } from "@/lib/workspace/roles";

import { removeMember, transferOwnership } from "./actions";

type Member = {
  id: string;
  userId: string;
  role: PersistedWorkspaceMemberRole;
  user: { email: string; name: string | null };
};

type DisplayMember = {
  id: string;
  userId: string;
  role: EffectiveWorkspaceRole;
  user: { email: string; name: string | null };
};

type Workspace = {
  id: string;
  ownerId: string;
  owner: { email: string; name: string | null };
  members: Member[];
};

type MemberActionKind = "remove" | "transfer";

const roleLabels: Record<EffectiveWorkspaceRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

const REMOVE_ERROR = "Could not remove the member. Please try again.";
const TRANSFER_ERROR = "Could not transfer ownership. Please try again.";

export function MembersList({
  workspace,
  isOwner,
  currentUserId,
}: {
  workspace: Workspace;
  isOwner: boolean;
  currentUserId: string;
}) {
  const [removeTarget, setRemoveTarget] = useState<DisplayMember | null>(null);
  const [transferTarget, setTransferTarget] = useState<DisplayMember | null>(
    null,
  );
  const [actionError, setActionError] = useState<MemberActionKind | null>(null);
  const [pendingKind, setPendingKind] = useState<MemberActionKind | null>(null);
  const [isPending, startTransition] = useTransition();
  const actionInFlightRef = useRef(false);
  const removeRestoreFocusRef = useRef<HTMLElement | null>(null);
  const transferRestoreFocusRef = useRef<HTMLElement | null>(null);
  const mutationBusy = isPending || pendingKind !== null;

  const allMembers: DisplayMember[] = [
    {
      id: "owner",
      userId: workspace.ownerId,
      role: "owner",
      user: workspace.owner,
    },
    ...workspace.members.map((member) => ({
      ...member,
      role: persistedMemberRoleToEffectiveRole(member.role),
    })),
  ];

  const runAction = (kind: MemberActionKind, action: () => Promise<void>) => {
    if (actionInFlightRef.current) return;

    actionInFlightRef.current = true;
    setActionError(null);
    setPendingKind(kind);
    startTransition(async () => {
      try {
        await action();
        if (kind === "remove") setRemoveTarget(null);
        else setTransferTarget(null);
        window.location.reload();
      } catch (error) {
        unstable_rethrow(error);
        setActionError(kind);
      } finally {
        actionInFlightRef.current = false;
        setPendingKind(null);
      }
    });
  };

  const handleRemove = () => {
    if (!removeTarget) return;
    runAction("remove", () => removeMember(removeTarget.id));
  };

  const handleTransfer = () => {
    if (!transferTarget) return;
    runAction("transfer", () =>
      transferOwnership(workspace.id, transferTarget.userId),
    );
  };

  const closeRemove = () => {
    if (actionInFlightRef.current) return;
    setActionError(null);
    setRemoveTarget(null);
  };

  const closeTransfer = () => {
    if (actionInFlightRef.current) return;
    setActionError(null);
    setTransferTarget(null);
  };

  return (
    <ul
      aria-busy={mutationBusy}
      className={cx("flex flex-col gap-2 p-4", PANEL_CHROME)}
    >
      {allMembers.map((member) => (
        <li
          key={member.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-ds-border-subtle bg-ds-surface-sunken p-3"
        >
          <div className="flex flex-col gap-0.5 overflow-hidden">
            <span className="truncate text-sm font-medium text-ds-text-primary">
              {member.user.name || member.user.email}
            </span>
            {member.user.name && (
              <span className="truncate text-xs text-ds-text-muted">
                {member.user.email}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-ds-state-selected px-2 py-0.5 text-xs font-medium text-ds-text-secondary">
              {roleLabels[member.role]}
            </span>
            {isOwner &&
              member.role !== "owner" &&
              member.userId !== currentUserId && (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      if (actionInFlightRef.current) return;
                      transferRestoreFocusRef.current = event.currentTarget;
                      setActionError(null);
                      setRemoveTarget(null);
                      setTransferTarget(member);
                    }}
                    disabled={mutationBusy}
                    className="text-xs text-ds-text-secondary transition hover:text-ds-text-primary disabled:opacity-60"
                    aria-label={`Make ${member.user.email} the owner`}
                  >
                    Make owner
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      if (actionInFlightRef.current) return;
                      removeRestoreFocusRef.current = event.currentTarget;
                      setActionError(null);
                      setTransferTarget(null);
                      setRemoveTarget(member);
                    }}
                    disabled={mutationBusy}
                    className="text-xs text-ds-text-secondary transition hover:text-ds-danger-text disabled:opacity-60"
                    aria-label={`Remove ${member.user.email}`}
                  >
                    Remove
                  </button>
                </>
              )}
          </div>
        </li>
      ))}

      <Dialog
        open={removeTarget !== null}
        onClose={closeRemove}
        restoreFocusRef={removeRestoreFocusRef}
        aria-labelledby="remove-member-title"
        aria-busy={pendingKind === "remove"}
        className="max-w-md"
      >
        <h2
          id="remove-member-title"
          className="text-base font-semibold text-ds-text-primary"
        >
          Remove member?
        </h2>
        <p className="mt-2 text-sm text-ds-text-secondary">
          {removeTarget?.user.name || removeTarget?.user.email} will lose access
          to this workspace. Documents they authored will move to their personal
          space.
        </p>
        {actionError === "remove" ? (
          <div
            role="alert"
            className="mt-4 rounded-ds-md border border-ds-danger-border bg-ds-danger-surface p-3 text-sm text-ds-danger-text"
          >
            <p>{REMOVE_ERROR}</p>
            <Button
              variant="plain"
              size="sm"
              disabled={mutationBusy}
              onClick={() => setActionError(null)}
              className="mt-2"
            >
              Dismiss error
            </Button>
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="plain"
            size="lg"
            onClick={closeRemove}
            disabled={mutationBusy}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="lg"
            onClick={handleRemove}
            disabled={mutationBusy}
          >
            {pendingKind === "remove"
              ? "Removing…"
              : actionError === "remove"
                ? "Try remove again"
                : "Remove member"}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={transferTarget !== null}
        onClose={closeTransfer}
        restoreFocusRef={transferRestoreFocusRef}
        aria-labelledby="transfer-ownership-title"
        aria-busy={pendingKind === "transfer"}
        className="max-w-md"
      >
        <h2
          id="transfer-ownership-title"
          className="text-base font-semibold text-ds-text-primary"
        >
          Transfer ownership?
        </h2>
        <p className="mt-2 text-sm text-ds-text-secondary">
          {transferTarget?.user.name || transferTarget?.user.email} will become
          the workspace owner. You will be demoted to an editor and can no
          longer rename, delete, or manage members.
        </p>
        {actionError === "transfer" ? (
          <div
            role="alert"
            className="mt-4 rounded-ds-md border border-ds-danger-border bg-ds-danger-surface p-3 text-sm text-ds-danger-text"
          >
            <p>{TRANSFER_ERROR}</p>
            <Button
              variant="plain"
              size="sm"
              disabled={mutationBusy}
              onClick={() => setActionError(null)}
              className="mt-2"
            >
              Dismiss error
            </Button>
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="plain"
            size="lg"
            onClick={closeTransfer}
            disabled={mutationBusy}
          >
            Cancel
          </Button>
          <Button
            variant="solid"
            size="lg"
            onClick={handleTransfer}
            disabled={mutationBusy}
          >
            {pendingKind === "transfer"
              ? "Transferring…"
              : actionError === "transfer"
                ? "Try transfer again"
                : "Transfer ownership"}
          </Button>
        </div>
      </Dialog>
    </ul>
  );
}
