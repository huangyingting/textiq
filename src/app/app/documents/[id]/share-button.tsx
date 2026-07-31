"use client";

import { Share2 } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { EditorToolbarButton } from "@/components/editor/toolbar-button";
import { Popover } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { SocialShareMenu } from "@/components/share/social-share-menu";
import {
  buildDocumentShareUrl,
  toEmbedShareUrl,
  toPresentShareUrl,
} from "@/lib/document/share-routes";
import {
  MAX_SHARE_PASSCODE_LENGTH,
  MIN_SHARE_PASSCODE_LENGTH,
} from "@/lib/share-passcode-policy";

import {
  regenerateShareLink,
  toggleDocumentSharing,
  updateSharePolicy,
} from "./actions";
import type { ShareSettings } from "@/lib/document/persistence-types";

type ShareState = {
  isShared: boolean;
  shareId: string | null;
  slug: string | null;
  shareUrl: string | null;
  expiresAt: string | null;
  embedEnabled: boolean;
  presentEnabled: boolean;
  metadataMode: "generic" | "title" | "title-excerpt";
  discoverable: boolean;
  passcodeEnabled: boolean;
};

type ShareMutationResult =
  { ok: true; data: ShareSettings } | { ok: false; error: string };

export async function resolveShareMutation(
  mutate: () => Promise<ShareMutationResult>,
  fallbackMessage: string,
): Promise<ShareMutationResult> {
  try {
    return await mutate();
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: fallbackMessage };
  }
}

/** Builds the displayed share URL from the current origin + shareId/slug. */
function shareUrlFor(
  shareId: string | null,
  slug: string | null,
): string | null {
  if (!shareId) {
    return null;
  }
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return buildDocumentShareUrl(origin, shareId, slug);
}

/** Maps the server {@link ShareSettings} into the client-rendered state. */
function toShareState(settings: ShareSettings): ShareState {
  return {
    isShared: settings.isShared,
    shareId: settings.shareId,
    slug: settings.slug,
    shareUrl: shareUrlFor(settings.shareId, settings.slug),
    expiresAt: settings.expiresAt,
    embedEnabled: settings.embedEnabled,
    presentEnabled: settings.presentEnabled,
    metadataMode: settings.metadataMode,
    discoverable: settings.discoverable,
    passcodeEnabled: settings.passcodeEnabled ?? false,
  };
}

/**
 * Converts an ISO-8601 instant to the `YYYY-MM-DDTHH:mm` value a
 * `datetime-local` input expects (in the visitor's local time zone).
 */
function isoToLocalInput(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function ShareButton({
  id,
  initialIsShared,
  initialShareId,
  initialSlug = null,
  initialExpiresAt = null,
  initialEmbedEnabled = true,
  initialPresentEnabled = true,
  initialMetadataMode = "generic",
  initialDiscoverable = false,
  initialPasscodeEnabled = false,
  documentTitle = "Untitled",
  iconOnly = false,
}: {
  id: string;
  initialIsShared: boolean;
  initialShareId: string | null;
  initialSlug?: string | null;
  initialExpiresAt?: string | null;
  initialEmbedEnabled?: boolean;
  initialPresentEnabled?: boolean;
  initialMetadataMode?: "generic" | "title" | "title-excerpt";
  initialDiscoverable?: boolean;
  initialPasscodeEnabled?: boolean;
  documentTitle?: string;
  iconOnly?: boolean;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [shareState, setShareState] = useState<ShareState>({
    isShared: initialIsShared,
    shareId: initialShareId,
    slug: initialSlug,
    shareUrl: initialIsShared ? shareUrlFor(initialShareId, initialSlug) : null,
    expiresAt: initialExpiresAt,
    embedEnabled: initialEmbedEnabled,
    presentEnabled: initialPresentEnabled,
    metadataMode: initialMetadataMode,
    discoverable: initialDiscoverable,
    passcodeEnabled: initialPasscodeEnabled,
  });
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied">(
    "idle",
  );
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [presentCopied, setPresentCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const mutationInFlightRef = useRef(false);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  // The embed URL points at the chrome-free /embed/[shareId] route. Derive it
  // from shareUrl so it shares the same origin as the displayed share link.
  const embedUrl = shareState.shareUrl
    ? toEmbedShareUrl(shareState.shareUrl)
    : null;
  const embedSnippet = embedUrl
    ? `<iframe src="${embedUrl}" width="800" height="600" style="border:0" title="TextIQ embed" loading="lazy"></iframe>`
    : null;

  // The presentation URL points at the /present/[shareId] route.
  const presentUrl = shareState.shareUrl
    ? toPresentShareUrl(shareState.shareUrl)
    : null;

  const runMutation = async (
    mutate: () => Promise<ShareMutationResult>,
    fallbackMessage: string,
  ): Promise<ShareSettings | null> => {
    if (mutationInFlightRef.current) {
      return null;
    }
    mutationInFlightRef.current = true;
    setIsMutating(true);
    setError(null);
    try {
      const result = await resolveShareMutation(mutate, fallbackMessage);
      if (!result.ok) {
        setError(result.error);
        return null;
      }
      setShareState(toShareState(result.data));
      return result.data;
    } finally {
      mutationInFlightRef.current = false;
      setIsMutating(false);
    }
  };

  const handleToggle = async (enable: boolean) => {
    await runMutation(
      () => toggleDocumentSharing(id, enable),
      "Couldn't update document sharing. Please try again.",
    );
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await runMutation(
        () => regenerateShareLink(id),
        "Couldn't regenerate the share link. Please try again.",
      );
    } finally {
      setRegenerating(false);
    }
  };

  const handleExpiryChange = async (value: string) => {
    // datetime-local gives a local wall-clock string; convert to an ISO instant
    // (or null when cleared) for the server policy.
    let expiresAt: string | null = null;
    if (value) {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        setError("Invalid expiry date.");
        return;
      }
      expiresAt = parsed.toISOString();
    }
    await runMutation(
      () => updateSharePolicy(id, { expiresAt }),
      "Couldn't update the link expiry. Please try again.",
    );
  };

  const handleEmbedEnabledChange = async (enabled: boolean) => {
    await runMutation(
      () => updateSharePolicy(id, { embedEnabled: enabled }),
      "Couldn't update embedding access. Please try again.",
    );
  };

  const handlePresentEnabledChange = async (enabled: boolean) => {
    await runMutation(
      () => updateSharePolicy(id, { presentEnabled: enabled }),
      "Couldn't update presentation access. Please try again.",
    );
  };

  const handleMetadataModeChange = async (
    mode: "generic" | "title" | "title-excerpt",
  ) => {
    await runMutation(
      () => updateSharePolicy(id, { metadataMode: mode }),
      "Couldn't update public preview metadata. Please try again.",
    );
  };

  const handleDiscoverableChange = async (discoverable: boolean) => {
    await runMutation(
      () => updateSharePolicy(id, { discoverable }),
      "Couldn't update search indexing. Please try again.",
    );
  };

  const handlePasscodeSave = async () => {
    if (!passcode.trim()) {
      return;
    }
    const settings = await runMutation(
      () => updateSharePolicy(id, { passcode }),
      "Couldn't update the share passcode. Please try again.",
    );
    if (settings) {
      setPasscode("");
    }
  };

  const handlePasscodeClear = async () => {
    const settings = await runMutation(
      () => updateSharePolicy(id, { passcode: null }),
      "Couldn't remove the share passcode. Please try again.",
    );
    if (settings) {
      setPasscode("");
    }
  };

  const copyLink = async () => {
    if (!shareState.shareUrl) {
      return;
    }
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    setCopyState("copying");
    setError(null);
    try {
      await navigator.clipboard.writeText(shareState.shareUrl);
      setCopyState("copied");
      copyTimerRef.current = setTimeout(() => {
        setCopyState("idle");
        copyTimerRef.current = null;
      }, 2000);
    } catch {
      setCopyState("idle");
      setError("Couldn't copy the share link. Please copy it manually.");
    }
  };

  const copyEmbed = async () => {
    if (!embedSnippet) {
      return;
    }
    setError(null);
    try {
      await navigator.clipboard.writeText(embedSnippet);
      setEmbedCopied(true);
      setTimeout(() => setEmbedCopied(false), 2000);
    } catch {
      setEmbedCopied(false);
      setError("Couldn't copy the embed code. Please copy it manually.");
    }
  };

  const copyPresentLink = async () => {
    if (!presentUrl) {
      return;
    }
    setError(null);
    try {
      await navigator.clipboard.writeText(presentUrl);
      setPresentCopied(true);
      setTimeout(() => setPresentCopied(false), 2000);
    } catch {
      setPresentCopied(false);
      setError("Couldn't copy the presentation link. Please copy it manually.");
    }
  };

  return (
    <Popover
      open={showMenu}
      onClose={() => setShowMenu(false)}
      aria-label="Share this document"
      constrainHeight
      portal
      className="w-80 overflow-y-auto p-4"
      trigger={
        <EditorToolbarButton
          label="Share"
          tooltip="Share document"
          icon={<Share2 aria-hidden="true" className="h-3.5 w-3.5" />}
          iconOnly={iconOnly}
          onClick={() => setShowMenu(!showMenu)}
          aria-label="Share"
        />
      }
    >
      <h3 className="mb-3 text-sm font-semibold text-ds-text-primary">
        Share this document
      </h3>

      <div className="mb-3 flex items-center justify-between">
        <span
          className="text-sm text-ds-text-secondary"
          id="share-toggle-label"
        >
          {shareState.isShared ? "Public link enabled" : "Private"}
        </span>
        <Switch
          checked={shareState.isShared}
          onCheckedChange={handleToggle}
          disabled={isMutating}
          aria-labelledby="share-toggle-label"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="mb-3 flex items-start justify-between gap-2 text-xs text-ds-danger"
        >
          <span>{error}</span>
          <button
            type="button"
            aria-label="Dismiss sharing error"
            onClick={() => setError(null)}
            className="shrink-0 rounded px-1 font-medium hover:bg-ds-danger-surface"
          >
            Dismiss
          </button>
        </div>
      )}

      {shareState.isShared && shareState.shareUrl && (
        <div>
          <div className="mb-2 flex items-center gap-2 rounded-md border border-ds-border-subtle bg-ds-surface-sunken px-3 py-2">
            <input
              readOnly
              value={shareState.shareUrl}
              aria-label="Public share link"
              className="flex-1 bg-transparent text-xs text-ds-text-secondary outline-none"
            />
            <button
              type="button"
              onClick={copyLink}
              disabled={copyState !== "idle"}
              className="shrink-0 rounded px-2 py-1 text-xs font-medium text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copyState === "copying"
                ? "Copying…"
                : copyState === "copied"
                  ? "Copied!"
                  : "Copy"}
            </button>
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {copyState === "copying"
              ? "Copying public share link."
              : copyState === "copied"
                ? "Public share link copied."
                : ""}
          </p>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs text-ds-text-muted">
              Anyone with this link can view your document (read-only).
            </p>
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={isMutating || regenerating}
              className="shrink-0 rounded px-2 py-1 text-xs font-medium text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary disabled:opacity-50"
            >
              {regenerating ? "Regenerating…" : "Regenerate link"}
            </button>
          </div>
          <p className="text-xs text-ds-text-muted">
            Regenerating creates a new link and immediately disables the old
            one.
          </p>
        </div>
      )}

      {shareState.isShared && (
        <div className="mt-4 border-t border-ds-border-subtle pt-3">
          <h4 className="mb-2 text-xs font-semibold text-ds-text-primary">
            Link expiry
          </h4>
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              aria-label="Link expiry date and time"
              value={isoToLocalInput(shareState.expiresAt)}
              onChange={(event) => handleExpiryChange(event.target.value)}
              disabled={isMutating}
              className="flex-1 rounded-md border border-ds-border-subtle bg-ds-surface-sunken px-2 py-1 text-xs text-ds-text-secondary outline-none"
            />
            {shareState.expiresAt && (
              <button
                type="button"
                onClick={() => handleExpiryChange("")}
                disabled={isMutating}
                className="shrink-0 rounded px-2 py-1 text-xs font-medium text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-ds-text-muted">
            {shareState.expiresAt
              ? "After this time the link stops working everywhere."
              : "No expiry — the link works until disabled or regenerated."}
          </p>
        </div>
      )}

      {shareState.isShared && (
        <div className="mt-4 border-t border-ds-border-subtle pt-3">
          <h4 className="mb-2 text-xs font-semibold text-ds-text-primary">
            Passcode
          </h4>
          <p className="mb-2 text-xs text-ds-text-muted">
            {shareState.passcodeEnabled
              ? "A passcode is required before visitors can view this link."
              : "Optional — require visitors to enter a short passcode."}
          </p>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={passcode}
              onChange={(event) => setPasscode(event.target.value)}
              minLength={MIN_SHARE_PASSCODE_LENGTH}
              maxLength={MAX_SHARE_PASSCODE_LENGTH}
              disabled={isMutating}
              placeholder={
                shareState.passcodeEnabled ? "New passcode" : "Set passcode"
              }
              aria-label="Share passcode"
              className="flex-1 rounded-md border border-ds-border-subtle bg-ds-surface-sunken px-2 py-1 text-xs text-ds-text-secondary outline-none"
            />
            <button
              type="button"
              onClick={handlePasscodeSave}
              disabled={isMutating || passcode.trim().length === 0}
              className="shrink-0 rounded px-2 py-1 text-xs font-medium text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {shareState.passcodeEnabled ? "Update" : "Set"}
            </button>
          </div>
          {shareState.passcodeEnabled && (
            <button
              type="button"
              onClick={handlePasscodeClear}
              disabled={isMutating}
              className="mt-2 rounded px-2 py-1 text-xs font-medium text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Remove passcode
            </button>
          )}
        </div>
      )}

      {shareState.isShared && (
        <div className="mt-4 border-t border-ds-border-subtle pt-3">
          <h4 className="mb-2 text-xs font-semibold text-ds-text-primary">
            Public preview privacy
          </h4>
          <label className="mb-2 flex flex-col gap-1 text-xs text-ds-text-secondary">
            Social preview metadata
            <select
              value={shareState.metadataMode}
              onChange={(event) =>
                handleMetadataModeChange(
                  event.target.value as "generic" | "title" | "title-excerpt",
                )
              }
              disabled={isMutating}
              className="rounded-md border border-ds-border-subtle bg-ds-surface-sunken px-2 py-1 text-xs outline-none"
            >
              <option value="generic">Generic TextIQ preview</option>
              <option value="title">Document title only</option>
              <option value="title-excerpt">Title and excerpt</option>
            </select>
          </label>
          <div className="mt-2 flex items-center justify-between">
            <span
              className="text-xs text-ds-text-secondary"
              id="share-discoverable-label"
            >
              Allow search indexing
            </span>
            <Switch
              checked={shareState.discoverable}
              onCheckedChange={handleDiscoverableChange}
              disabled={isMutating}
              aria-labelledby="share-discoverable-label"
            />
          </div>
          <p className="mt-1 text-xs text-ds-text-muted">
            Links default to noindex/nofollow and generic social previews.
          </p>
        </div>
      )}

      {shareState.isShared && (
        <div className="mt-4 border-t border-ds-border-subtle pt-3">
          <h4 className="mb-2 text-xs font-semibold text-ds-text-primary">
            Access
          </h4>
          <div className="mb-2 flex items-center justify-between">
            <span
              className="text-xs text-ds-text-secondary"
              id="share-embed-allow-label"
            >
              Allow embedding
            </span>
            <Switch
              checked={shareState.embedEnabled}
              onCheckedChange={handleEmbedEnabledChange}
              disabled={isMutating}
              aria-labelledby="share-embed-allow-label"
            />
          </div>
          <div className="flex items-center justify-between">
            <span
              className="text-xs text-ds-text-secondary"
              id="share-present-allow-label"
            >
              Allow presentation
            </span>
            <Switch
              checked={shareState.presentEnabled}
              onCheckedChange={handlePresentEnabledChange}
              disabled={isMutating}
              aria-labelledby="share-present-allow-label"
            />
          </div>
        </div>
      )}

      {shareState.isShared && shareState.embedEnabled && embedSnippet && (
        <div className="mt-4 border-t border-ds-border-subtle pt-3">
          <h4 className="mb-2 text-xs font-semibold text-ds-text-primary">
            Embed
          </h4>
          <div className="mb-2 flex items-start gap-2 rounded-md border border-ds-border-subtle bg-ds-surface-sunken px-3 py-2">
            <textarea
              readOnly
              rows={3}
              value={embedSnippet}
              aria-label="Embed code"
              className="flex-1 resize-none bg-transparent font-mono text-xs text-ds-text-secondary outline-none"
            />
            <button
              type="button"
              onClick={copyEmbed}
              className="shrink-0 rounded px-2 py-1 text-xs font-medium text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary"
            >
              {embedCopied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p
            role="status"
            aria-live="polite"
            className="text-xs text-ds-text-muted"
          >
            {embedCopied
              ? "Embed code copied to clipboard."
              : "Paste this snippet into any webpage to embed the read-only visual."}
          </p>
        </div>
      )}

      {shareState.isShared && shareState.presentEnabled && presentUrl && (
        <div className="mt-4 border-t border-ds-border-subtle pt-3">
          <h4 className="mb-2 text-xs font-semibold text-ds-text-primary">
            Presentation link
          </h4>
          <div className="mb-2 flex items-center gap-2 rounded-md border border-ds-border-subtle bg-ds-surface-sunken px-3 py-2">
            <input
              readOnly
              value={presentUrl}
              aria-label="Presentation link"
              className="flex-1 bg-transparent text-xs text-ds-text-secondary outline-none"
            />
            <button
              type="button"
              onClick={copyPresentLink}
              className="shrink-0 rounded px-2 py-1 text-xs font-medium text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary"
            >
              {presentCopied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p
            role="status"
            aria-live="polite"
            className="text-xs text-ds-text-muted"
          >
            {presentCopied
              ? "Presentation link copied."
              : "Share a full-screen slideshow of this document."}
          </p>
        </div>
      )}

      {!shareState.isShared && (
        <p className="text-xs text-ds-text-muted">
          Enable sharing to create a public read-only link.
        </p>
      )}

      {/* Social share — always visible; link-based options gated on isShared */}
      <div className="mt-4 border-t border-ds-border-subtle pt-3">
        <h4 className="mb-2 text-xs font-semibold text-ds-text-primary">
          Share to social
        </h4>
        <SocialShareMenu
          inline
          shareUrl={shareState.shareUrl}
          title={documentTitle}
        />
      </div>
    </Popover>
  );
}
