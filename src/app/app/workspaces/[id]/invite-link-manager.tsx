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

import type {
  CreateInviteLinkOptions,
  InviteLink,
} from "@/lib/workspace/invite-types";
import {
  parsePersistedWorkspaceMemberRole,
  type InvitableWorkspaceRole,
} from "@/lib/workspace/roles";

import { createInviteLink, revokeInviteLink } from "./actions";

const roleLabels: Record<InvitableWorkspaceRole, string> = {
  EDITOR: "Editor",
  VIEWER: "Viewer",
};

const expiryOptions = [
  { value: "0", label: "Never expires" },
  { value: "1", label: "Expires in 1 day" },
  { value: "7", label: "Expires in 7 days" },
  { value: "30", label: "Expires in 30 days" },
] as const;

type InviteMutationAttempt =
  | {
      kind: "create";
      role: InvitableWorkspaceRole;
      options: CreateInviteLinkOptions;
    }
  | { kind: "revoke"; link: InviteLink };

type CopyFeedback = {
  linkId: string;
  kind: "success" | "error";
  message: string;
};

const CREATE_ERROR = "Could not create invite link. Please try again.";
const REVOKE_ERROR = "Could not revoke invite link. Please try again.";
const COPY_ERROR = "Could not copy the invite link. Please try again.";

function parseMaxUses(
  value: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return {
      ok: false,
      error: "Maximum uses must be a whole number of at least 1.",
    };
  }
  return { ok: true, value: parsed };
}

type InviteLinkManagerProps = {
  workspaceId: string;
  inviteLinks: InviteLink[];
};

export function InviteLinkManager(props: InviteLinkManagerProps) {
  return <InviteLinkManagerForWorkspace key={props.workspaceId} {...props} />;
}

function InviteLinkManagerForWorkspace({
  workspaceId,
  inviteLinks,
}: InviteLinkManagerProps) {
  const [links, setLinks] = useState(inviteLinks);
  const [selectedRole, setSelectedRole] =
    useState<InvitableWorkspaceRole>("EDITOR");
  const [expiryDays, setExpiryDays] = useState<string>("0");
  const [maxUses, setMaxUses] = useState<string>("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [mutationError, setMutationError] =
    useState<InviteMutationAttempt | null>(null);
  const [pendingKind, setPendingKind] = useState<
    InviteMutationAttempt["kind"] | null
  >(null);
  const [revokeTarget, setRevokeTarget] = useState<InviteLink | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const [pendingCopyLinkId, setPendingCopyLinkId] = useState<string | null>(
    null,
  );
  const mountedRef = useRef(true);
  const mutationIdRef = useRef(0);
  const mutationInFlightRef = useRef(false);
  const copyRequestSeqRef = useRef(0);
  const copyInFlightRef = useRef(false);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const revokeRestoreFocusRef = useRef<HTMLElement | null>(null);
  const mutationBusy = pendingKind !== null;
  const copyBusy = pendingCopyLinkId !== null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      mutationIdRef.current += 1;
      mutationInFlightRef.current = false;
      copyRequestSeqRef.current += 1;
      copyInFlightRef.current = false;
    };
  }, []);

  const clearCreateFeedback = () => {
    setValidationError(null);
    setMutationError((current) =>
      current?.kind === "create" ? null : current,
    );
  };

  const runMutation = (attempt: InviteMutationAttempt) => {
    if (mutationInFlightRef.current) return;

    mutationInFlightRef.current = true;
    const mutationId = ++mutationIdRef.current;
    setValidationError(null);
    setMutationError(null);
    setPendingKind(attempt.kind);
    return (async () => {
      try {
        if (attempt.kind === "create") {
          const link = await createInviteLink(
            workspaceId,
            attempt.role,
            attempt.options,
          );
          if (!mountedRef.current || mutationIdRef.current !== mutationId) {
            return;
          }
          setLinks((current) =>
            current.some((existing) => existing.id === link.id)
              ? current
              : [link, ...current],
          );
          setMaxUses("");
        } else {
          await revokeInviteLink(attempt.link.id);
          if (!mountedRef.current || mutationIdRef.current !== mutationId) {
            return;
          }
          revokeRestoreFocusRef.current = createButtonRef.current;
          setLinks((current) =>
            current.filter((link) => link.id !== attempt.link.id),
          );
          setCopyFeedback((current) =>
            current?.linkId === attempt.link.id ? null : current,
          );
          setRevokeTarget(null);
        }
      } catch (error) {
        unstable_rethrow(error);
        if (!mountedRef.current || mutationIdRef.current !== mutationId) {
          return;
        }
        setMutationError(attempt);
      } finally {
        if (mountedRef.current && mutationIdRef.current === mutationId) {
          mutationInFlightRef.current = false;
          setPendingKind(null);
        }
      }
    })();
  };

  const handleCreate = () => {
    const parsedMaxUses = parseMaxUses(maxUses);
    if (!parsedMaxUses.ok) {
      setMutationError(null);
      setValidationError(parsedMaxUses.error);
      return;
    }

    return runMutation({
      kind: "create",
      role: selectedRole,
      options: {
        expiresInDays: Number(expiryDays) > 0 ? Number(expiryDays) : null,
        maxUses: parsedMaxUses.value,
      },
    });
  };

  const openRevokeDialog = (link: InviteLink, trigger: HTMLButtonElement) => {
    if (mutationInFlightRef.current) return;
    revokeRestoreFocusRef.current = trigger;
    setValidationError(null);
    setMutationError(null);
    setRevokeTarget(link);
  };

  const closeRevokeDialog = () => {
    if (mutationInFlightRef.current) return;
    setMutationError(null);
    setRevokeTarget(null);
  };

  const getInviteUrl = (token: string) => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/app/join/${token}`;
  };

  const handleCopy = async (link: InviteLink) => {
    if (copyInFlightRef.current) return;

    copyInFlightRef.current = true;
    const requestSeq = copyRequestSeqRef.current + 1;
    copyRequestSeqRef.current = requestSeq;
    setCopyFeedback(null);
    setPendingCopyLinkId(link.id);
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(getInviteUrl(link.token));
      if (!mountedRef.current || copyRequestSeqRef.current !== requestSeq)
        return;
      setCopyFeedback({
        linkId: link.id,
        kind: "success",
        message: "Invite link copied.",
      });
    } catch {
      if (!mountedRef.current || copyRequestSeqRef.current !== requestSeq)
        return;
      setCopyFeedback({ linkId: link.id, kind: "error", message: COPY_ERROR });
    } finally {
      if (mountedRef.current && copyRequestSeqRef.current === requestSeq) {
        copyInFlightRef.current = false;
        setPendingCopyLinkId(null);
      }
    }
  };

  const createFailure = mutationError?.kind === "create";
  const revokeFailure = mutationError?.kind === "revoke";

  return (
    <div
      aria-busy={mutationBusy || copyBusy}
      className={cx("flex flex-col gap-4 p-6", PANEL_CHROME)}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedRole}
            disabled={mutationBusy}
            onChange={(event) => {
              const parsedRole = parsePersistedWorkspaceMemberRole(
                event.target.value,
              );
              if (parsedRole.success) {
                clearCreateFeedback();
                setSelectedRole(parsedRole.value);
              }
            }}
            className={cx("h-10 flex-1 px-3", FIELD_CONTROL)}
            aria-label="Invite member role"
          >
            <option value="EDITOR">Editor</option>
            <option value="VIEWER">Viewer</option>
          </select>
          <select
            value={expiryDays}
            disabled={mutationBusy}
            onChange={(event) => {
              clearCreateFeedback();
              setExpiryDays(event.target.value);
            }}
            className={cx("h-10 flex-1 px-3", FIELD_CONTROL)}
            aria-label="Invite link expiry"
          >
            {expiryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            step={1}
            value={maxUses}
            disabled={mutationBusy}
            onChange={(event) => {
              clearCreateFeedback();
              setMaxUses(event.target.value);
            }}
            placeholder="Max uses"
            aria-label="Maximum uses (leave blank for unlimited)"
            className={cx("h-10 w-28 px-3", FIELD_CONTROL)}
          />
          <Button
            ref={createButtonRef}
            variant="solid"
            size="lg"
            onClick={handleCreate}
            disabled={mutationBusy}
          >
            {pendingKind === "create" ? "Creating…" : "Create invite link"}
          </Button>
        </div>
        <p className="text-xs text-ds-text-muted">
          Anyone with the link can join this workspace with the selected role,
          until it expires or reaches its usage limit.
        </p>
        {validationError || createFailure ? (
          <div
            role="alert"
            className="rounded-ds-md border border-ds-danger-border bg-ds-danger-surface p-3 text-sm text-ds-danger-text"
          >
            <p>{validationError ?? CREATE_ERROR}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {createFailure ? (
                <Button
                  variant="subtle"
                  size="sm"
                  disabled={mutationBusy}
                  onClick={() =>
                    mutationError?.kind === "create"
                      ? runMutation(mutationError)
                      : undefined
                  }
                >
                  Try create again
                </Button>
              ) : null}
              <Button
                variant="plain"
                size="sm"
                disabled={mutationBusy}
                onClick={clearCreateFeedback}
              >
                Dismiss error
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {links.length > 0 && (
        <ul className="flex flex-col gap-2">
          {links.map((link) => {
            const inviteUrl = getInviteUrl(link.token);
            const linkCopyFeedback =
              copyFeedback?.linkId === link.id ? copyFeedback : null;
            return (
              <li
                key={link.id}
                className="flex flex-col gap-2 rounded-lg border border-ds-border-subtle bg-ds-surface-sunken p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 overflow-hidden">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-ds-state-selected px-2 py-0.5 text-xs font-medium text-ds-text-secondary">
                        {roleLabels[link.role]}
                      </span>
                      <span className="text-xs text-ds-text-muted">
                        Created{" "}
                        {new Date(link.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      {link.expiresAt && (
                        <span className="text-xs text-ds-text-muted">
                          · Expires{" "}
                          {new Date(link.expiresAt).toLocaleDateString(
                            "en-US",
                            {
                              month: "short",
                              day: "numeric",
                            },
                          )}
                        </span>
                      )}
                      <span className="text-xs text-ds-text-muted">
                        ·{" "}
                        {link.maxUses === null
                          ? `${link.useCount} use${link.useCount === 1 ? "" : "s"}`
                          : `${link.useCount}/${link.maxUses} used`}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        readOnly
                        disabled={copyBusy}
                        value={inviteUrl}
                        aria-label={`Invite link for ${roleLabels[link.role]}`}
                        onClick={(event) => {
                          event.currentTarget.select();
                          void handleCopy(link);
                        }}
                        className={cx(
                          "h-8 min-w-0 flex-1 cursor-pointer truncate px-2 font-mono text-xs text-ds-text-secondary",
                          FIELD_CONTROL,
                        )}
                      />
                      <Button
                        variant="subtle"
                        size="sm"
                        onClick={() => void handleCopy(link)}
                        disabled={copyBusy}
                        aria-label={`Copy ${roleLabels[link.role]} invite link`}
                      >
                        {pendingCopyLinkId === link.id ? "Copying…" : "Copy"}
                      </Button>
                    </div>
                    {linkCopyFeedback ? (
                      linkCopyFeedback.kind === "success" ? (
                        <p
                          role="status"
                          aria-live="polite"
                          className="mt-2 text-xs text-ds-success-text"
                        >
                          {linkCopyFeedback.message}
                        </p>
                      ) : (
                        <div
                          role="alert"
                          className="mt-2 rounded-ds-md border border-ds-danger-border bg-ds-danger-surface p-2 text-xs text-ds-danger-text"
                        >
                          <p>{linkCopyFeedback.message}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              variant="subtle"
                              size="sm"
                              disabled={copyBusy}
                              onClick={() => void handleCopy(link)}
                            >
                              Try copy again
                            </Button>
                            <Button
                              variant="plain"
                              size="sm"
                              disabled={copyBusy}
                              onClick={() => setCopyFeedback(null)}
                            >
                              Dismiss error
                            </Button>
                          </div>
                        </div>
                      )
                    ) : null}
                  </div>
                  <Button
                    variant="plain"
                    size="sm"
                    disabled={mutationBusy}
                    onClick={(event) =>
                      openRevokeDialog(link, event.currentTarget)
                    }
                    className="shrink-0 text-sm text-ds-text-secondary transition hover:text-ds-danger-text"
                    aria-label="Revoke invite link"
                  >
                    Revoke
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {revokeTarget ? (
        <Dialog
          open
          onClose={closeRevokeDialog}
          restoreFocusRef={revokeRestoreFocusRef}
          aria-labelledby="revoke-invite-title"
          aria-busy={pendingKind === "revoke"}
          className="max-w-md"
        >
          <h2
            id="revoke-invite-title"
            className="text-base font-semibold text-ds-text-primary"
          >
            Revoke invite link?
          </h2>
          <p className="mt-2 text-sm text-ds-text-secondary">
            This {roleLabels[revokeTarget.role].toLowerCase()} invite will stop
            working immediately. People who already joined will keep their
            access.
          </p>
          {revokeFailure ? (
            <div
              role="alert"
              className="mt-4 rounded-ds-md border border-ds-danger-border bg-ds-danger-surface p-3 text-sm text-ds-danger-text"
            >
              <p>{REVOKE_ERROR}</p>
              <Button
                variant="plain"
                size="sm"
                disabled={mutationBusy}
                onClick={() => setMutationError(null)}
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
              onClick={closeRevokeDialog}
              disabled={mutationBusy}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="lg"
              onClick={() =>
                runMutation({ kind: "revoke", link: revokeTarget })
              }
              disabled={mutationBusy}
            >
              {pendingKind === "revoke"
                ? "Revoking…"
                : revokeFailure
                  ? "Try revoke again"
                  : "Revoke invite link"}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
