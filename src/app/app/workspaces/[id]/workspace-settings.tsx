"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  Button,
  Dialog,
  FIELD_CONTROL,
  PANEL_CHROME,
  cx,
} from "@/components/ui";
import { WORKSPACE_NAME_MAX_LENGTH } from "@/lib/limits";

import { deleteWorkspace, leaveWorkspace, renameWorkspace } from "./actions";

type WorkspaceActionKind = "rename" | "destructive";

const RENAME_ERROR = "Could not rename the workspace. Please try again.";
const DELETE_ERROR = "Could not delete the workspace. Please try again.";
const LEAVE_ERROR = "Could not leave the workspace. Please try again.";

/**
 * Per-role workspace lifecycle controls.
 *
 * Owners can rename/delete and non-owner members can leave. One synchronous
 * in-flight guard serializes every mutation before React commits disabled
 * state. Ordinary failures remain local with generic retry/dismiss recovery;
 * Next navigation control flow is always rethrown.
 */
type WorkspaceSettingsProps = {
  workspaceId: string;
  name: string;
  isOwner: boolean;
};

export function WorkspaceSettings(props: WorkspaceSettingsProps) {
  return <WorkspaceSettingsForWorkspace key={props.workspaceId} {...props} />;
}

function WorkspaceSettingsForWorkspace({
  workspaceId,
  name,
  isOwner,
}: WorkspaceSettingsProps) {
  const [nameValue, setNameValue] = useState(name);
  const [actionError, setActionError] = useState<WorkspaceActionKind | null>(
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingKind, setPendingKind] = useState<WorkspaceActionKind | null>(
    null,
  );
  const mountedRef = useRef(true);
  const actionIdRef = useRef(0);
  const actionInFlightRef = useRef(false);
  const destructiveTriggerRef = useRef<HTMLButtonElement>(null);
  const mutationBusy = pendingKind !== null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      actionIdRef.current += 1;
      actionInFlightRef.current = false;
    };
  }, []);

  const trimmed = nameValue.trim();
  const renameDisabled = mutationBusy || trimmed === "" || trimmed === name;

  const runAction = (
    kind: WorkspaceActionKind,
    action: () => Promise<void>,
    onSuccess?: () => void,
  ) => {
    if (actionInFlightRef.current) return;

    actionInFlightRef.current = true;
    const actionId = ++actionIdRef.current;
    setActionError(null);
    setPendingKind(kind);
    return (async () => {
      try {
        await action();
        if (!mountedRef.current || actionIdRef.current !== actionId) return;
        onSuccess?.();
      } catch (error) {
        unstable_rethrow(error);
        if (!mountedRef.current || actionIdRef.current !== actionId) return;
        setActionError(kind);
      } finally {
        if (mountedRef.current && actionIdRef.current === actionId) {
          actionInFlightRef.current = false;
          setPendingKind(null);
        }
      }
    })();
  };

  const handleRename = () => {
    if (!trimmed || trimmed === name) return;
    return runAction(
      "rename",
      () => renameWorkspace(workspaceId, trimmed),
      () => window.location.reload(),
    );
  };

  const handleDestructive = () => {
    return runAction("destructive", () =>
      isOwner ? deleteWorkspace(workspaceId) : leaveWorkspace(workspaceId),
    );
  };

  const closeConfirm = () => {
    if (actionInFlightRef.current) return;
    setActionError(null);
    setConfirmOpen(false);
  };

  const destructiveError = isOwner ? DELETE_ERROR : LEAVE_ERROR;

  return (
    <div
      aria-busy={mutationBusy}
      className={cx("flex flex-col gap-4 p-6", PANEL_CHROME)}
    >
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
              maxLength={WORKSPACE_NAME_MAX_LENGTH}
              disabled={mutationBusy}
              onChange={(event) => {
                setNameValue(event.target.value);
                if (actionError === "rename") setActionError(null);
              }}
              className={cx("h-10 min-w-0 flex-1 px-3", FIELD_CONTROL)}
            />
            <Button
              variant="solid"
              size="lg"
              onClick={handleRename}
              disabled={renameDisabled}
            >
              {pendingKind === "rename" ? "Saving…" : "Save"}
            </Button>
          </div>
          {actionError === "rename" ? (
            <div
              role="alert"
              className="rounded-ds-md border border-ds-danger-border bg-ds-danger-surface p-3 text-sm text-ds-danger-text"
            >
              <p>{RENAME_ERROR}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="subtle"
                  size="sm"
                  disabled={mutationBusy}
                  onClick={handleRename}
                >
                  Try rename again
                </Button>
                <Button
                  variant="plain"
                  size="sm"
                  disabled={mutationBusy}
                  onClick={() => setActionError(null)}
                >
                  Dismiss error
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

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
          ref={destructiveTriggerRef}
          variant="danger"
          size="lg"
          disabled={mutationBusy}
          onClick={() => {
            if (actionInFlightRef.current) return;
            setActionError(null);
            setConfirmOpen(true);
          }}
          className="shrink-0"
        >
          {isOwner ? "Delete" : "Leave"}
        </Button>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={closeConfirm}
        restoreFocusRef={destructiveTriggerRef}
        aria-labelledby="workspace-destructive-title"
        aria-busy={pendingKind === "destructive"}
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
        {actionError === "destructive" ? (
          <div
            role="alert"
            className="mt-4 rounded-ds-md border border-ds-danger-border bg-ds-danger-surface p-3 text-sm text-ds-danger-text"
          >
            <p>{destructiveError}</p>
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
            onClick={closeConfirm}
            disabled={mutationBusy}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="lg"
            onClick={handleDestructive}
            disabled={mutationBusy}
          >
            {pendingKind === "destructive"
              ? isOwner
                ? "Deleting…"
                : "Leaving…"
              : actionError === "destructive"
                ? isOwner
                  ? "Try delete again"
                  : "Try leave again"
                : isOwner
                  ? "Delete workspace"
                  : "Leave workspace"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
