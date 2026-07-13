"use client";

import { useState, useTransition } from "react";

import {
  Button,
  Dialog,
  FIELD_CONTROL,
  PANEL_CHROME,
  cx,
} from "@/components/ui";

import { deleteWorkspace, leaveWorkspace, renameWorkspace } from "./actions";

/**
 * Per-role workspace lifecycle controls.
 *
 * - Owners see a rename field and a delete button (confirmed via Dialog).
 * - Non-owner members see a leave button (confirmed via Dialog).
 *
 * Every control calls a server action that re-enforces authorization
 * server-side; the role-gated rendering here is purely a UX affordance.
 */
export function WorkspaceSettings({
  workspaceId,
  name,
  isOwner,
}: {
  workspaceId: string;
  name: string;
  isOwner: boolean;
}) {
  const [nameValue, setNameValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const trimmed = nameValue.trim();
  const renameDisabled = isPending || trimmed === "" || trimmed === name;

  const handleRename = () => {
    setError(null);
    startTransition(async () => {
      try {
        await renameWorkspace(workspaceId, trimmed);
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not rename.");
      }
    });
  };

  const handleDestructive = () => {
    setError(null);
    startTransition(async () => {
      try {
        if (isOwner) {
          await deleteWorkspace(workspaceId);
        } else {
          await leaveWorkspace(workspaceId);
        }
      } catch (err) {
        // `deleteWorkspace`/`leaveWorkspace` redirect to /app/workspaces on
        // success, and Next.js implements `redirect()` by throwing a
        // NEXT_REDIRECT control-flow signal that must propagate uncaught so
        // the router can navigate (same pattern as google-sign-in-button.tsx).
        // Swallowing it here would both block the redirect and misreport a
        // successful action as a failure, so only genuine mutation failures
        // are turned into an error message below.
        if (
          err instanceof Error &&
          (err as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")
        ) {
          throw err;
        }
        setConfirmOpen(false);
        setError(err instanceof Error ? err.message : "Action failed.");
      }
    });
  };

  return (
    <div className={cx("flex flex-col gap-4 p-6", PANEL_CHROME)}>
      {isOwner && (
        <div className="flex flex-col gap-2">
          <label
            htmlFor="workspace-name"
            className="text-sm font-medium text-ds-text-primary"
          >
            Workspace name
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="workspace-name"
              value={nameValue}
              maxLength={100}
              onChange={(e) => setNameValue(e.target.value)}
              className={cx("h-10 min-w-0 flex-1 px-3", FIELD_CONTROL)}
            />
            <Button
              variant="solid"
              size="lg"
              onClick={handleRename}
              disabled={renameDisabled}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-ds-danger-text">{error}</p>}

      <div className="flex items-center justify-between gap-3 border-t border-ds-border-subtle pt-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-ds-text-primary">
            {isOwner ? "Delete workspace" : "Leave workspace"}
          </span>
          <span className="text-xs text-ds-text-muted">
            {isOwner
              ? "Documents move to their owners' personal spaces. This cannot be undone."
              : "You'll lose access. Documents you authored stay with you."}
          </span>
        </div>
        <Button
          variant="danger"
          size="lg"
          onClick={() => {
            setError(null);
            setConfirmOpen(true);
          }}
          className="shrink-0"
        >
          {isOwner ? "Delete" : "Leave"}
        </Button>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        aria-labelledby="workspace-destructive-title"
        className="max-w-md"
      >
        <h2
          id="workspace-destructive-title"
          className="text-base font-semibold text-ds-text-primary"
        >
          {isOwner ? "Delete this workspace?" : "Leave this workspace?"}
        </h2>
        <p className="mt-2 text-sm text-ds-text-secondary">
          {isOwner
            ? "All members and invite links will be removed. Documents are moved to their owners' personal spaces — nothing is deleted."
            : "You'll be removed from this workspace and lose access to its shared documents. Documents you authored remain yours."}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="plain"
            size="lg"
            onClick={() => setConfirmOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="lg"
            onClick={handleDestructive}
            disabled={isPending}
          >
            {isOwner ? "Delete workspace" : "Leave workspace"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
