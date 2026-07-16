"use client";

import { useState } from "react";

import { Button, FIELD_CONTROL, PANEL_CHROME, cx } from "@/components/ui";

import type { InviteLink } from "@/lib/workspace/invite-types";
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

export function InviteLinkManager({
  workspaceId,
  inviteLinks,
}: {
  workspaceId: string;
  inviteLinks: InviteLink[];
}) {
  const [links, setLinks] = useState(inviteLinks);
  const [selectedRole, setSelectedRole] =
    useState<InvitableWorkspaceRole>("EDITOR");
  const [expiryDays, setExpiryDays] = useState<string>("0");
  const [maxUses, setMaxUses] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setError(null);
    try {
      const expiresInDays = Number(expiryDays) > 0 ? Number(expiryDays) : null;
      const parsedMaxUses = maxUses.trim() === "" ? null : Number(maxUses);
      const link = await createInviteLink(workspaceId, selectedRole, {
        expiresInDays,
        maxUses:
          parsedMaxUses !== null && Number.isFinite(parsedMaxUses)
            ? parsedMaxUses
            : null,
      });
      setLinks((prev) => [link, ...prev]);
      setMaxUses("");
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create invite link.",
      );
    }
  };

  const handleRevoke = async (linkId: string) => {
    setError(null);
    try {
      await revokeInviteLink(linkId);
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not revoke invite link.",
      );
    }
  };

  const getInviteUrl = (token: string) => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/app/join/${token}`;
  };

  return (
    <div className={cx("flex flex-col gap-4 p-6", PANEL_CHROME)}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedRole}
            onChange={(e) => {
              const parsedRole = parsePersistedWorkspaceMemberRole(
                e.target.value,
              );
              if (parsedRole.success) {
                setSelectedRole(parsedRole.value);
              }
            }}
            className={cx("h-10 flex-1 px-3", FIELD_CONTROL)}
          >
            <option value="EDITOR">Editor</option>
            <option value="VIEWER">Viewer</option>
          </select>
          <select
            value={expiryDays}
            onChange={(e) => setExpiryDays(e.target.value)}
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
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder="Max uses"
            aria-label="Maximum uses (leave blank for unlimited)"
            className={cx("h-10 w-28 px-3", FIELD_CONTROL)}
          />
          <Button variant="solid" size="lg" onClick={handleCreate}>
            Create invite link
          </Button>
        </div>
        <p className="text-xs text-ds-text-muted">
          Anyone with the link can join this workspace with the selected role,
          until it expires or reaches its usage limit.
        </p>
        {error && (
          <p role="alert" className="text-xs text-ds-danger-text">
            {error}
          </p>
        )}
      </div>

      {links.length > 0 && (
        <ul className="flex flex-col gap-2">
          {links.map((link) => (
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
                        {new Date(link.expiresAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    )}
                    <span className="text-xs text-ds-text-muted">
                      ·{" "}
                      {link.maxUses === null
                        ? `${link.useCount} use${link.useCount === 1 ? "" : "s"}`
                        : `${link.useCount}/${link.maxUses} used`}
                    </span>
                  </div>
                  <input
                    readOnly
                    value={getInviteUrl(link.token)}
                    onClick={(e) => {
                      e.currentTarget.select();
                      navigator.clipboard.writeText(e.currentTarget.value);
                    }}
                    className={cx(
                      "mt-2 h-8 w-full cursor-pointer truncate px-2 font-mono text-xs text-ds-text-secondary",
                      FIELD_CONTROL,
                    )}
                  />
                </div>
                <Button
                  variant="plain"
                  size="sm"
                  onClick={() => handleRevoke(link.id)}
                  className="shrink-0 text-sm text-ds-text-secondary transition hover:text-ds-danger-text"
                  aria-label="Revoke invite link"
                >
                  Revoke
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
