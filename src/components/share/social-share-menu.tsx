"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, Copy, ExternalLink, Share2 } from "lucide-react";

import { FOCUS_RING } from "@/components/ui/tokens";
import { exportPNG } from "@/lib/visual/export";
import {
  applySocialPresetToOptions,
  DEFAULT_EXPORT_OPTIONS,
} from "@/lib/visual/export-options";
import {
  buildFacebookIntent,
  buildLinkedInIntent,
  buildTwitterIntent,
  canCopyImageToClipboard,
  canWebShare,
} from "@/lib/share/social-intents";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SocialShareMenuProps {
  /**
   * The public share URL for the document.
   * When `null` / `undefined`, link-based platform intents are disabled and
   * a prompt to enable sharing is shown in their place.
   */
  shareUrl?: string | null;
  /** Title used to pre-fill the Twitter/X compose text. */
  title: string;
  /**
   * Returns the SVG element to rasterize for image-based actions (copy image,
   * native share). When omitted those actions are hidden.
   */
  getSvgElement?: () => SVGSVGElement | null;
  /**
   * When `true`, render the menu contents inline (no trigger button). Useful
   * when embedding inside an existing dropdown like {@link ShareButton}.
   */
  inline?: boolean;
  /** Extra class names applied to the root trigger wrapper. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Small helper: open a new tab sized for a share popup
// ---------------------------------------------------------------------------

function openSharePopup(url: string, label: string): void {
  const w = 600;
  const h = 480;
  const left = Math.round((window.screen.width - w) / 2);
  const top = Math.round((window.screen.height - h) / 2);
  window.open(
    url,
    label,
    `width=${w},height=${h},left=${left},top=${top},toolbar=0,menubar=0,noopener,noreferrer`,
  );
}

// ---------------------------------------------------------------------------
// Inner menu content
// ---------------------------------------------------------------------------

interface MenuContentProps {
  shareUrl?: string | null;
  title: string;
  getSvgElement?: () => SVGSVGElement | null;
}

function MenuContent({ shareUrl, title, getSvgElement }: MenuContentProps) {
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "error"
  >("idle");
  const [nativeShareState, setNativeShareState] = useState<
    "idle" | "sharing" | "error"
  >("idle");
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // ── Copy image to clipboard ──────────────────────────────────────────────

  const handleCopyImage = useCallback(async () => {
    if (!getSvgElement) return;
    const svg = getSvgElement();
    if (!svg) return;

    setCopyState("copying");

    try {
      // Use the square social preset (1080×1080) for a crisp clipboard image
      const opts = applySocialPresetToOptions("square", DEFAULT_EXPORT_OPTIONS);
      const blob = await exportPNG(svg, opts);
      if (!blob) throw new Error("exportPNG returned null");

      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);

      setCopyState("copied");
      copyTimerRef.current = setTimeout(() => setCopyState("idle"), 2500);
    } catch {
      setCopyState("error");
      copyTimerRef.current = setTimeout(() => setCopyState("idle"), 2500);
    }
  }, [getSvgElement]);

  // ── Native Web Share ─────────────────────────────────────────────────────

  const handleNativeShare = useCallback(async () => {
    if (!getSvgElement) return;
    const svg = getSvgElement();
    if (!svg) return;

    setNativeShareState("sharing");

    try {
      const opts = applySocialPresetToOptions("square", DEFAULT_EXPORT_OPTIONS);
      const blob = await exportPNG(svg, opts);
      const shareData: ShareData = { title, url: shareUrl ?? undefined };

      if (blob) {
        const file = new File([blob], `${title || "visual"}.png`, {
          type: "image/png",
        });
        if (canWebShare(file)) {
          await navigator.share({ files: [file], ...shareData });
          setNativeShareState("idle");
          return;
        }
      }

      // File sharing not available — fall back to link/title only
      if (canWebShare()) {
        await navigator.share(shareData);
      }
      setNativeShareState("idle");
    } catch (err) {
      // AbortError is expected when the user dismisses the native share sheet
      if (err instanceof Error && err.name === "AbortError") {
        setNativeShareState("idle");
      } else {
        setNativeShareState("error");
        setTimeout(() => setNativeShareState("idle"), 2500);
      }
    }
  }, [getSvgElement, title, shareUrl]);

  const hasImage = Boolean(getSvgElement);
  const hasShareUrl = Boolean(shareUrl);
  const showNativeShare = hasImage && canWebShare();
  const showCopyImage = hasImage && canCopyImageToClipboard();

  return (
    <div className="space-y-1">
      {/* Native share — mobile / supported platforms only */}
      {showNativeShare && (
        <ActionButton
          icon={<Share2 className="h-4 w-4" />}
          label={nativeShareState === "error" ? "Share failed" : "Share via…"}
          onClick={() => void handleNativeShare()}
          disabled={nativeShareState === "sharing"}
        />
      )}

      {/* Copy image */}
      {showCopyImage && (
        <ActionButton
          icon={
            copyState === "copied" ? (
              <Check className="h-4 w-4 text-ds-success-text" />
            ) : (
              <Copy className="h-4 w-4" />
            )
          }
          label={
            copyState === "copying"
              ? "Copying…"
              : copyState === "copied"
                ? "Copied!"
                : copyState === "error"
                  ? "Copy failed"
                  : "Copy image"
          }
          onClick={() => void handleCopyImage()}
          disabled={copyState === "copying"}
        />
      )}

      {/* Platform intents — only when document is shared */}
      {hasShareUrl ? (
        <>
          <ActionButton
            icon={
              <span className="h-4 w-4 text-[10px] font-bold leading-none">
                𝕏
              </span>
            }
            label="Share on X / Twitter"
            trailingIcon={<ExternalLink className="h-3 w-3 opacity-40" />}
            onClick={() =>
              openSharePopup(
                buildTwitterIntent(shareUrl!, title),
                "share-twitter",
              )
            }
          />
          <ActionButton
            icon={
              <span className="h-4 w-4 text-[10px] font-bold leading-none">
                in
              </span>
            }
            label="Share on LinkedIn"
            trailingIcon={<ExternalLink className="h-3 w-3 opacity-40" />}
            onClick={() =>
              openSharePopup(buildLinkedInIntent(shareUrl!), "share-linkedin")
            }
          />
          <ActionButton
            icon={
              <span className="h-4 w-4 text-[10px] font-bold leading-none">
                f
              </span>
            }
            label="Share on Facebook"
            trailingIcon={<ExternalLink className="h-3 w-3 opacity-40" />}
            onClick={() =>
              openSharePopup(buildFacebookIntent(shareUrl!), "share-facebook")
            }
          />
        </>
      ) : (
        <p className="px-1 pt-1 text-xs text-ds-text-muted">
          Enable document sharing to post to social platforms.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational action button
// ---------------------------------------------------------------------------

interface ActionButtonProps {
  icon: ReactNode;
  label: string;
  trailingIcon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

function ActionButton({
  icon,
  label,
  trailingIcon,
  onClick,
  disabled = false,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm",
        "text-ds-text-secondary transition hover:bg-ds-state-hover hover:text-ds-text-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        FOCUS_RING,
      ].join(" ")}
    >
      <span className="shrink-0 text-ds-text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {trailingIcon && <span className="shrink-0">{trailingIcon}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Public component — standalone trigger with dropdown
// ---------------------------------------------------------------------------

/**
 * A self-contained "Share to social" button that opens a dropdown with:
 * - Native share sheet (Web Share API, when available)
 * - Copy image to clipboard
 * - Platform intent links: X/Twitter, LinkedIn, Facebook
 *
 * When `shareUrl` is not provided (document not shared), link-based options
 * are replaced with a prompt to enable sharing; image actions still work.
 *
 * Use `inline={true}` to suppress the trigger and render just the menu body
 * for embedding inside an existing dropdown.
 */
export function SocialShareMenu({
  shareUrl,
  title,
  getSvgElement,
  inline = false,
  className,
}: SocialShareMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click when the dropdown is open
  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  if (inline) {
    return (
      <MenuContent
        shareUrl={shareUrl}
        title={title}
        getSvgElement={getSvgElement}
      />
    );
  }

  return (
    <div ref={menuRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        aria-label="Share to social"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={[
          "flex items-center gap-1.5 rounded-full border border-ds-border-subtle px-3 py-1.5 text-sm font-medium",
          "text-ds-text-secondary transition hover:bg-ds-state-hover hover:text-ds-text-primary",
          FOCUS_RING,
        ].join(" ")}
      >
        <Share2 aria-hidden="true" className="h-3.5 w-3.5" />
        Share to social
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full z-dropdown mt-2 w-56 rounded-lg border border-ds-border-subtle bg-ds-surface-overlay p-2 shadow-ds-popover"
        >
          <MenuContent
            shareUrl={shareUrl}
            title={title}
            getSvgElement={getSvgElement}
          />
        </div>
      )}
    </div>
  );
}
