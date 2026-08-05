"use client";

import type { JSX } from "react";

import type { NodeSourceMetadata, SlideNode } from "@/lib/presentation/schema";
import type { StylePatch } from "@/lib/presentation/style-schema";
import { FOCUS_RING } from "@/components/ui/tokens";
import { SelectMenu, type SelectMenuOption } from "@/components/ui/select-menu";

const BACKGROUND_TYPE_OPTIONS: readonly SelectMenuOption[] = [
  { value: "solid", label: "Solid" },
  { value: "linearGradient", label: "Linear gradient" },
  { value: "radialGradient", label: "Radial gradient" },
  { value: "image", label: "Image asset" },
];

export interface SlideSettingsPanelProps {
  slide: SlideNode;
  onUpdateSlide: (patch: { name?: string; notes?: string }) => void;
  onUpdateSource: (source: NodeSourceMetadata | undefined) => void;
  onUpdateLocalStyle: (patch: StylePatch) => void;
  onResetLocalStyle: () => void;
  assetResolver?: (assetId: string) => string | undefined;
  onUploadBackgroundImage?: () => void;
}

export function slideBackgroundColor(slide: SlideNode): string {
  const background = slide.localStyle?.slide?.background;
  return background?.type === "solid" && typeof background.color === "string"
    ? background.color
    : background?.type === "linearGradient" &&
        typeof background.from === "string"
      ? background.from
      : background?.type === "radialGradient" &&
          typeof background.inner === "string"
        ? background.inner
        : "#ffffff";
}

export function slideBackgroundSecondaryColor(slide: SlideNode): string {
  const background = slide.localStyle?.slide?.background;
  return background?.type === "linearGradient" &&
    typeof background.to === "string"
    ? background.to
    : background?.type === "radialGradient" &&
        typeof background.outer === "string"
      ? background.outer
      : "#f3f4f6";
}

export function slideBackgroundAssetId(slide: SlideNode): string {
  const background = slide.localStyle?.slide?.background;
  return background?.type === "image" ? (background.assetId ?? "") : "";
}

export function slideBackgroundPreviewAsset(
  slide: SlideNode,
  assetResolver?: (assetId: string) => string | undefined,
): string | undefined {
  const assetId = slideBackgroundAssetId(slide);
  if (!assetId || !assetResolver) return undefined;
  return assetResolver(assetId);
}

export function slideAccentColor(slide: SlideNode): string {
  return typeof slide.localStyle?.slide?.accent === "string"
    ? slide.localStyle.slide.accent
    : "#ffffff";
}

export function slideSourceWithPatch(
  slide: SlideNode,
  patch: Partial<NodeSourceMetadata>,
): NodeSourceMetadata {
  return {
    documentId: slide.source?.documentId ?? "",
    blockId: slide.source?.blockId ?? "",
    ...(slide.source?.blockKind ? { blockKind: slide.source.blockKind } : {}),
    ...(slide.source?.contentHash
      ? { contentHash: slide.source.contentHash }
      : {}),
    ...(slide.source?.blockRevision
      ? { blockRevision: slide.source.blockRevision }
      : {}),
    ...(slide.source?.linkedAt ? { linkedAt: slide.source.linkedAt } : {}),
    ...(slide.source?.display ? { display: slide.source.display } : {}),
    ...(slide.source?.refresh ? { refresh: slide.source.refresh } : {}),
    ...(slide.source?.unlinked ? { unlinked: slide.source.unlinked } : {}),
    ...patch,
  };
}

export function slideBackgroundPatchForType(
  slide: SlideNode,
  type: string,
): StylePatch {
  if (type === "linearGradient") {
    return {
      slide: {
        background: {
          type: "linearGradient",
          from: slideBackgroundColor(slide),
          to: slideBackgroundSecondaryColor(slide),
          angle: 135,
        },
      },
    };
  }
  if (type === "radialGradient") {
    return {
      slide: {
        background: {
          type: "radialGradient",
          inner: slideBackgroundColor(slide),
          outer: slideBackgroundSecondaryColor(slide),
        },
      },
    };
  }
  if (type === "image") {
    return {
      slide: {
        background: {
          type: "image",
          assetId: slideBackgroundAssetId(slide),
          opacity: 1,
        },
      },
    };
  }
  return {
    slide: {
      background: {
        type: "solid",
        color: slideBackgroundColor(slide),
      },
    },
  };
}

export function slideBackgroundColorPatch(
  slide: SlideNode,
  color: string,
): StylePatch {
  const background = slide.localStyle?.slide?.background;
  if (background?.type === "linearGradient") {
    return { slide: { background: { ...background, from: color } } };
  }
  if (background?.type === "radialGradient") {
    return { slide: { background: { ...background, inner: color } } };
  }
  return { slide: { background: { type: "solid", color } } };
}

export function slideBackgroundSecondaryColorPatch(
  slide: SlideNode,
  color: string,
): StylePatch {
  const background = slide.localStyle?.slide?.background;
  if (background?.type === "linearGradient") {
    return { slide: { background: { ...background, to: color } } };
  }
  if (background?.type === "radialGradient") {
    return { slide: { background: { ...background, outer: color } } };
  }
  return {};
}

export function SlideSettingsPanel({
  slide,
  onUpdateSlide,
  onUpdateSource,
  onUpdateLocalStyle,
  onResetLocalStyle,
  assetResolver,
  onUploadBackgroundImage,
}: SlideSettingsPanelProps): JSX.Element {
  const backgroundAssetId = slideBackgroundAssetId(slide);
  const backgroundPreviewAsset = slideBackgroundPreviewAsset(
    slide,
    assetResolver,
  );
  const hasBackgroundAssetId = backgroundAssetId.trim().length > 0;

  function updateSource(patch: Partial<NodeSourceMetadata>) {
    onUpdateSource(slideSourceWithPatch(slide, patch));
  }

  return (
    <section className="flex flex-col gap-2 px-3 py-2.5">
      <h4 className="text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
        Slide
      </h4>
      <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
        Name
        <input
          value={slide.name ?? ""}
          onChange={(event) =>
            onUpdateSlide({ name: event.currentTarget.value })
          }
          className={`rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
        Notes
        <textarea
          value={slide.notes ?? ""}
          rows={4}
          onChange={(event) =>
            onUpdateSlide({ notes: event.currentTarget.value })
          }
          className={`min-h-20 resize-y rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
        />
      </label>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Background type
            <SelectMenu
              aria-label="Background type"
              variant="field"
              value={slide.localStyle?.slide?.background?.type ?? "solid"}
              options={BACKGROUND_TYPE_OPTIONS}
              onChange={(next) => {
                onUpdateLocalStyle(slideBackgroundPatchForType(slide, next));
              }}
            />
          </div>
          {slide.localStyle?.slide?.background?.type === "image" ? (
            <>
              <div className="overflow-hidden rounded-ds-sm border border-ds-border-subtle bg-ds-surface-raised">
                {backgroundPreviewAsset ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={backgroundPreviewAsset}
                    alt={`${slide.name ?? "Slide"} background preview`}
                    className="h-24 w-full object-cover"
                  />
                ) : (
                  <div className="flex h-24 items-center justify-center px-2 text-center text-xs text-ds-text-muted">
                    {hasBackgroundAssetId
                      ? "Missing image asset"
                      : "No background image selected"}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onUploadBackgroundImage}
                  disabled={onUploadBackgroundImage === undefined}
                  className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover disabled:opacity-40"
                >
                  {hasBackgroundAssetId ? "Replace image" : "Upload image"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateLocalStyle({
                      slide: {
                        background: {
                          type: "solid",
                          color: slideBackgroundColor(slide),
                        },
                      },
                    })
                  }
                  disabled={!hasBackgroundAssetId}
                  className="rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover disabled:opacity-40"
                >
                  Clear image
                </button>
              </div>
              <label className="flex flex-col gap-1 text-[11px] text-ds-text-muted">
                Asset id (advanced)
                <input
                  value={backgroundAssetId}
                  onChange={(event) =>
                    onUpdateLocalStyle({
                      slide: {
                        background: {
                          type: "image",
                          assetId: event.currentTarget.value,
                          opacity: 1,
                        },
                      },
                    })
                  }
                  className={`rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 font-mono text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
                />
              </label>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
                Background
                <input
                  type="color"
                  value={slideBackgroundColor(slide)}
                  onChange={(event) => {
                    onUpdateLocalStyle(
                      slideBackgroundColorPatch(
                        slide,
                        event.currentTarget.value,
                      ),
                    );
                  }}
                  className={`h-8 w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface ${FOCUS_RING}`}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
                Gradient end
                <input
                  type="color"
                  value={slideBackgroundSecondaryColor(slide)}
                  disabled={
                    slide.localStyle?.slide?.background?.type === "solid"
                  }
                  onChange={(event) => {
                    onUpdateLocalStyle(
                      slideBackgroundSecondaryColorPatch(
                        slide,
                        event.currentTarget.value,
                      ),
                    );
                  }}
                  className={`h-8 w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface disabled:opacity-40 ${FOCUS_RING}`}
                />
              </label>
            </div>
          )}
          <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            Accent override
            <input
              type="color"
              value={slideAccentColor(slide)}
              onChange={(event) =>
                onUpdateLocalStyle({
                  slide: { accent: event.currentTarget.value },
                })
              }
              className={`h-8 w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface ${FOCUS_RING}`}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={onResetLocalStyle}
          className="h-8 rounded-ds-sm border border-ds-border-subtle px-2 text-xs text-ds-text-secondary hover:bg-ds-state-hover"
        >
          Reset
        </button>
      </div>
      <div className="my-1 h-px bg-ds-border-subtle" aria-hidden="true" />
      <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
        Source document
        <input
          value={slide.source?.documentId ?? ""}
          onChange={(event) =>
            updateSource({ documentId: event.currentTarget.value })
          }
          className={`rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 font-mono text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
        Source block
        <input
          value={slide.source?.blockId ?? ""}
          onChange={(event) =>
            updateSource({ blockId: event.currentTarget.value })
          }
          className={`rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1.5 font-mono text-xs text-ds-text-primary outline-none ${FOCUS_RING}`}
        />
      </label>
      {slide.source ? (
        <button
          type="button"
          onClick={() => onUpdateSource(undefined)}
          className="self-start rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs text-ds-text-secondary hover:bg-ds-state-hover"
        >
          Clear source
        </button>
      ) : null}
    </section>
  );
}
