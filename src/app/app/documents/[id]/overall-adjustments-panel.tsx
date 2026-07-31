"use client";

/**
 * OverallAdjustmentsPanel — document-level styling controls rendered from the
 * top editor chrome.
 *
 * Controls:
 *  • Apply a theme to ALL visuals  (applyTheme + $nodesOfType)
 *  • Apply a brand to ALL visuals  (applyBrand + $nodesOfType)
 * Every mutation goes through editor.update() — never touches Yjs directly —
 * satisfying the collab-safe invariant from the architecture decision log.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $nodesOfType } from "lexical";
import { LayoutTemplate, Palette } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Divider, Surface, Tooltip } from "@/components/ui";
import { cx } from "@/components/ui/tokens";
import { FOCUS_RING } from "@/components/ui/tokens";
import type { BrandStyle } from "@/lib/brand/schema";
import { BRAND_WEB_FONTS } from "@/lib/brand/schema";
import { applyBrand, brandPreviewStyle } from "@/lib/brand/transforms";
import { injectBrandFontFace } from "@/lib/brand/font-face";
import { STYLE_THEMES } from "@/lib/visual/themes";
import { applyTheme } from "@/lib/visual/transforms";
import { applyElasticLayout } from "@/lib/visual/transforms";
import { applyVisualCommand } from "@/lib/commands/visual-command-adapter";
import {
  BRAND_LIST_LOAD_ERROR,
  loadBrandStyles,
} from "@/lib/brand/brand-list-client";

import { VisualNode } from "@/lib/lexical/visual-node";

// ---------------------------------------------------------------------------
// useBrands — fetches brands lazily from /api/brand
// ---------------------------------------------------------------------------

function useBrands() {
  const [brands, setBrands] = useState<BrandStyle[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("loading");
    try {
      const nextBrands = await loadBrandStyles(controller.signal);
      if (controller.signal.aborted) return;
      setBrands(nextBrands);
      setStatus("done");
    } catch {
      if (!controller.signal.aborted) {
        setStatus("error");
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, []);

  return { brands, status, load };
}

// ---------------------------------------------------------------------------
// SectionLabel
// ---------------------------------------------------------------------------

function SectionLabel({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ds-text-muted,#6f7d83)]">
      <span
        aria-hidden="true"
        className="h-3.5 w-3.5 [&>svg]:h-3.5 [&>svg]:w-3.5"
      >
        {icon}
      </span>
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// ThemeSection — apply a theme to all visuals
// ---------------------------------------------------------------------------

function ThemeSection() {
  const [editor] = useLexicalComposerContext();

  const applyThemeToAll = useCallback(
    (themeId: string) => {
      editor.update(() => {
        const nodes = $nodesOfType(VisualNode);
        for (const node of nodes) {
          const visual = node.getVisual();
          const visualId = node.getVisualId();
          // Route through visual command executor so edits carry command metadata
          // (patches, side effects, source staleness). Direct applyTheme fallback
          // is intentionally kept for safety.
          const result = applyVisualCommand(visual, visualId, {
            op: "visual.apply_theme",
            themeId,
          });
          node.setVisual(
            applyElasticLayout(
              result.ok ? result.visual : applyTheme(visual, themeId),
            ),
          );
        }
      });
    },
    [editor],
  );

  return (
    <div className="p-3">
      <SectionLabel icon={<Palette />}>Theme — all visuals</SectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {STYLE_THEMES.map((theme) => (
          <Tooltip
            key={theme.id}
            label={`Apply "${theme.name}" to all visuals`}
          >
            <button
              type="button"
              aria-label={`Apply ${theme.name} theme to all visuals`}
              onClick={() => applyThemeToAll(theme.id)}
              className={cx(
                "flex h-8 w-8 flex-col items-center justify-center gap-0.5 rounded-[var(--ds-radius-sm,8px)] border transition",
                "border-[var(--ds-border-subtle,rgba(0,0,0,0.1))] hover:border-[var(--ds-border-strong,rgba(0,0,0,0.2))]",
                FOCUS_RING,
              )}
              style={{ backgroundColor: theme.colors.nodeFill }}
            >
              <span
                aria-hidden="true"
                className="h-2 w-4 rounded-full"
                style={{ backgroundColor: theme.colors.nodeStroke }}
              />
              <span className="sr-only">{theme.name}</span>
            </button>
          </Tooltip>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-[var(--ds-text-muted,#6f7d83)]">
        One click re-themes every visual in the document.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BrandSection — apply a brand to all visuals
// ---------------------------------------------------------------------------

function BrandSection() {
  const [editor] = useLexicalComposerContext();
  const { brands, status, load } = useBrands();

  // Lazy-load brands when section is first rendered.
  useEffect(() => {
    void load();
  }, [load]);

  const applyBrandToAll = useCallback(
    (brand: BrandStyle) => {
      // Load the web font for the brand so text renders correctly.
      if (brand.fontFamily) {
        const match = BRAND_WEB_FONTS.find(
          (f) => f.cssFamily === brand.fontFamily,
        );
        if (match) {
          const id = `gfont-brand-${match.id}`;
          if (!document.getElementById(id)) {
            const link = document.createElement("link");
            link.id = id;
            link.rel = "stylesheet";
            link.href = match.url;
            document.head.appendChild(link);
          }
        } else if (brand.fontAssetUrl) {
          // Custom uploaded font: rehydrate @font-face from protected asset URL.
          injectBrandFontFace(brand.id, brand.fontFamily, brand.fontAssetUrl);
        }
      }
      editor.update(() => {
        const nodes = $nodesOfType(VisualNode);
        for (const node of nodes) {
          node.setVisual(
            applyElasticLayout(applyBrand(node.getVisual(), brand)),
          );
        }
      });
    },
    [editor],
  );

  if (status === "done" && brands.length === 0) return null;

  return (
    <div className="p-3" aria-busy={status === "loading"}>
      <SectionLabel icon={<LayoutTemplate />}>Brand — all visuals</SectionLabel>
      {status === "idle" || status === "loading" ? (
        <p className="text-[11px] text-[var(--ds-text-muted,#6f7d83)]">
          Loading brands…
        </p>
      ) : status === "error" ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-ds-sm border border-ds-danger-border bg-ds-danger-surface px-2 py-1.5 text-[11px] text-ds-danger-text"
        >
          <span>{BRAND_LIST_LOAD_ERROR}</span>
          <button
            type="button"
            onClick={() => void load()}
            className={cx(
              "tiq-touch-target rounded-ds-sm px-1.5 py-0.5 font-semibold hover:bg-ds-state-hover",
              FOCUS_RING,
            )}
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {brands.map((brand) => {
            const preview = brandPreviewStyle(brand);
            return (
              <Tooltip
                key={brand.id}
                label={`Apply brand "${brand.name}" to all visuals`}
              >
                <button
                  type="button"
                  aria-label={`Apply brand ${brand.name} to all visuals`}
                  onClick={() => applyBrandToAll(brand)}
                  className={cx(
                    "flex flex-col items-center gap-1 rounded-[var(--ds-radius-sm,8px)] border p-1.5 transition",
                    "border-[var(--ds-border-subtle,rgba(0,0,0,0.1))] hover:border-[var(--ds-border-strong,rgba(0,0,0,0.2))]",
                    FOCUS_RING,
                  )}
                >
                  <span
                    className="flex h-8 w-8 items-center justify-center gap-0.5 rounded-ds-sm border p-1"
                    style={{
                      backgroundColor: preview.nodeFill,
                      borderColor: preview.nodeStroke,
                    }}
                  >
                    {preview.palette.slice(0, 3).map((color, i) => (
                      <span
                        key={i}
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </span>
                  <span className="max-w-[56px] truncate text-[9px] font-medium text-[var(--ds-text-muted,#6f7d83)]">
                    {brand.name}
                  </span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OverallAdjustmentsPanel — the root component
// ---------------------------------------------------------------------------

/**
 * Document-level visual styling toolbox. Page layout and export remain separate
 * top-toolbar commands, so this popover does not duplicate them.
 *
 * Distinct from the +// insert menu (BlockSpark / InsertMenu), which handles
 * inserting new blocks.  This panel surfaces document-wide adjustments.
 */
export function OverallAdjustmentsPanel() {
  return (
    <Surface elevation="flat" radius="sm" bordered={false} className="flex-1">
      <div className="px-3 pb-1 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ds-text-muted,#6f7d83)]">
          Document adjustments
        </p>
      </div>
      <Divider />
      <ThemeSection />
      <Divider />
      <BrandSection />
    </Surface>
  );
}
