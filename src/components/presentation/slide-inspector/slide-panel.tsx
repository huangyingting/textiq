"use client";

import { Check, Image as ImageIcon, Link, Upload } from "lucide-react";
import { useRef, useState } from "react";

import {
  slideAccentValue,
  slideBackgroundGradientValue,
  slideBackgroundImageValue,
  slideSolidBackgroundValue,
} from "@/components/presentation/v6-deck-ui";
import { FOCUS_RING } from "@/components/ui/tokens";
import { ColorPicker, Swatch, Tabs } from "@/components/ui";
import { assertNever } from "@/lib/assert-never";
import {
  FIELD_CLASS,
  PanelSection,
} from "@/components/presentation/slide-inspector/primitives";
import {
  GRADIENT_BACKGROUND_OPTIONS,
  SOLID_BACKGROUND_OPTIONS,
  gradientCss,
  sameGradient,
  type BackgroundGradient,
} from "@/components/presentation/slide-editor/use-slide-background-commands";
import type { SlideInspectorProps } from "@/components/presentation/slide-inspector/types";
import {
  inspectSlideDesignOrigins,
  type Deck,
  type Slide,
  type SlideDesignOriginLayer,
} from "@/lib/presentation/deck";
import { canAddImage, dataUrlByteSize } from "@/lib/visual/image-element";
import { allThemeTokenSets } from "@/lib/presentation/presentation-theme";
import { useImageUpload } from "@/lib/presentation/use-image-upload";
import { resolveSlideThemeColors } from "@/lib/presentation/style-cascade";
import {
  mergeSwatches,
  tokenSetSwatchColors,
} from "@/lib/presentation/text-style";

const BUILT_IN_THEME_TOKEN_SETS = allThemeTokenSets();
const THEME_ACCENT_SWATCHES = tokenSetSwatchColors(
  BUILT_IN_THEME_TOKEN_SETS,
  "accent",
);
const INSPECTOR_SOLID_BACKGROUND_OPTIONS = SOLID_BACKGROUND_OPTIONS.slice(
  0,
  14,
);
const INSPECTOR_GRADIENT_BACKGROUND_OPTIONS = GRADIENT_BACKGROUND_OPTIONS.slice(
  0,
  14,
);
type SlideStyleTab = "background" | "accent" | "image";
type BackgroundCustomizeMode = "solid" | "gradient";

function designOriginTag(layer: SlideDesignOriginLayer): string {
  switch (layer) {
    case "theme":
      return "Theme";
    case "master":
      return "Master";
    case "deck":
      return "Deck";
    case "slide":
      return "Override";
    default:
      return assertNever(layer);
  }
}

function sameHex(a: string | undefined, b: string): boolean {
  return a?.toLowerCase() === b.toLowerCase();
}

function BackgroundChoiceHeader({ title }: { title: string }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
      {title}
    </p>
  );
}

function SlideStyleTabs({
  activeTab,
  onChange,
}: {
  activeTab: SlideStyleTab;
  onChange: (tab: SlideStyleTab) => void;
}) {
  const tabs = [
    { value: "background" as const, label: "Background" },
    { value: "accent" as const, label: "Accent" },
    { value: "image" as const, label: "Image" },
  ];
  return (
    <Tabs
      aria-label="Slide style panel"
      options={tabs}
      value={activeTab}
      onChange={onChange}
    />
  );
}

function GradientPresetButton({
  label,
  gradient,
  active,
  onClick,
}: {
  label: string;
  gradient: BackgroundGradient;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${label} gradient background`}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`relative h-7 w-7 rounded-full border transition-transform hover:scale-110 ${
        active
          ? "border-transparent ring-2 ring-ds-accent ring-offset-1 ring-offset-ds-surface-base"
          : "border-ds-border-subtle"
      } ${FOCUS_RING}`}
      style={{ background: gradientCss(gradient) }}
    >
      {active ? (
        <Check
          size={14}
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow-sm"
        />
      ) : null}
    </button>
  );
}

function SlideBackgroundControl({
  backgroundColor,
  backgroundGradient,
  backgroundImage,
  fallbackColor,
  originHint,
  onBackgroundChange,
  onBackgroundGradientChange,
}: {
  backgroundColor: string | undefined;
  backgroundGradient: BackgroundGradient | undefined;
  backgroundImage: string | undefined;
  fallbackColor: string;
  originHint: string;
  onBackgroundChange: SlideInspectorProps["onBackgroundChange"];
  onBackgroundGradientChange: SlideInspectorProps["onBackgroundGradientChange"];
}) {
  const [customMode, setCustomMode] = useState<BackgroundCustomizeMode>(
    backgroundGradient ? "gradient" : "solid",
  );
  const [customSolid, setCustomSolid] = useState(
    backgroundColor ?? fallbackColor,
  );
  const [customGradientFrom, setCustomGradientFrom] = useState(
    backgroundGradient?.from ?? "#6366f1",
  );
  const [customGradientTo, setCustomGradientTo] = useState(
    backgroundGradient?.to ?? "#ec4899",
  );
  const [customGradientAngle, setCustomGradientAngle] = useState(
    backgroundGradient?.angle ?? 135,
  );
  const activeSolid = !backgroundImage && !backgroundGradient;
  const activeSolidPreset = activeSolid
    ? SOLID_BACKGROUND_OPTIONS.find((option) =>
        sameHex(backgroundColor, option.color),
      )
    : undefined;
  const activeGradientPreset =
    !backgroundImage && backgroundGradient
      ? GRADIENT_BACKGROUND_OPTIONS.find((option) =>
          sameGradient(backgroundGradient, option.gradient),
        )
      : undefined;
  const status = backgroundImage
    ? "Image"
    : backgroundGradient
      ? activeGradientPreset
        ? "Preset gradient"
        : "Custom gradient"
      : backgroundColor
        ? activeSolidPreset
          ? "Preset solid"
          : "Custom solid"
        : originHint;
  const previewStyle = backgroundImage
    ? {
        backgroundImage: `url(${backgroundImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : backgroundGradient
      ? { background: gradientCss(backgroundGradient) }
      : { backgroundColor: backgroundColor ?? fallbackColor };

  function resetBackground() {
    if (backgroundGradient) {
      onBackgroundGradientChange(undefined);
      return;
    }
    onBackgroundChange(undefined);
  }

  return (
    <div className="flex flex-col gap-2 rounded-ds-md bg-ds-surface-raised/60 p-2 ring-1 ring-ds-border-subtle">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-8 w-10 shrink-0 rounded-ds-md border border-ds-border-subtle"
          style={previewStyle}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-end gap-2">
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="rounded-full bg-ds-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ds-text-muted ring-1 ring-ds-border-subtle">
                {status}
              </span>
              {backgroundImage || backgroundGradient || backgroundColor ? (
                <button
                  type="button"
                  onClick={resetBackground}
                  className={`rounded-full bg-ds-accent-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ds-accent-text ring-1 ring-ds-accent-border transition-colors hover:bg-ds-accent hover:text-ds-text-on-accent ${FOCUS_RING}`}
                >
                  Reset
                </button>
              ) : null}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <BackgroundChoiceHeader title="Solid presets" />
        <div className="grid grid-cols-7 gap-1.5">
          {INSPECTOR_SOLID_BACKGROUND_OPTIONS.map((option) => (
            <Swatch
              key={option.id}
              color={option.color}
              size="lg"
              selected={activeSolid && sameHex(backgroundColor, option.color)}
              aria-label={`${option.label} solid background`}
              className="rounded-full transition-transform hover:scale-110"
              onClick={() => onBackgroundChange(option.color)}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <BackgroundChoiceHeader title="Gradient presets" />
        <div className="grid grid-cols-7 gap-1.5">
          {INSPECTOR_GRADIENT_BACKGROUND_OPTIONS.map((option) => (
            <GradientPresetButton
              key={option.id}
              label={option.label}
              gradient={option.gradient}
              active={
                !backgroundImage &&
                backgroundGradient !== undefined &&
                sameGradient(backgroundGradient, option.gradient)
              }
              onClick={() => onBackgroundGradientChange(option.gradient)}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <BackgroundChoiceHeader title="Customize" />
          <Tabs
            aria-label="Custom background type"
            options={[
              { value: "solid", label: "Solid" },
              { value: "gradient", label: "Gradient" },
            ]}
            value={customMode}
            onChange={setCustomMode}
            size="sm"
            className="w-32"
          />
        </div>

        {customMode === "solid" ? (
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
            <ColorPicker
              color={customSolid}
              fallback={fallbackColor}
              aria-label="Custom solid background color"
              layer="tooltip"
              customOnly
              onChange={setCustomSolid}
            />
            <span className="truncate font-mono text-xs tabular-nums text-ds-text-secondary">
              {customSolid.toLowerCase()}
            </span>
            <button
              type="button"
              onClick={() => onBackgroundChange(customSolid)}
              className={`h-7 rounded-ds-md bg-ds-accent px-2.5 text-xs font-semibold text-ds-text-on-accent transition-colors hover:bg-ds-accent-hover ${FOCUS_RING}`}
            >
              Apply
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span
              aria-hidden="true"
              className="block h-8 rounded-ds-md border border-ds-border-subtle"
              style={{
                background: gradientCss({
                  from: customGradientFrom,
                  to: customGradientTo,
                  angle: customGradientAngle,
                }),
              }}
            />
            <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-1.5">
              <ColorPicker
                color={customGradientFrom}
                fallback="#6366f1"
                aria-label="Custom gradient start color"
                layer="tooltip"
                customOnly
                onChange={setCustomGradientFrom}
              />
              <ColorPicker
                color={customGradientTo}
                fallback="#ec4899"
                aria-label="Custom gradient end color"
                layer="tooltip"
                customOnly
                onChange={setCustomGradientTo}
              />
              <input
                type="range"
                min={0}
                max={360}
                step={5}
                value={customGradientAngle}
                onChange={(event) =>
                  setCustomGradientAngle(Number(event.target.value))
                }
                className="min-w-0 accent-ds-accent"
                aria-label="Custom gradient angle"
              />
              <button
                type="button"
                onClick={() =>
                  onBackgroundGradientChange({
                    from: customGradientFrom,
                    to: customGradientTo,
                    angle: customGradientAngle,
                  })
                }
                className={`h-7 rounded-ds-md bg-ds-accent px-2.5 text-xs font-semibold text-ds-text-on-accent transition-colors hover:bg-ds-accent-hover ${FOCUS_RING}`}
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SlideAccentControl({
  accentColor,
  fallbackColor,
  presets,
  originHint,
  onAccentChange,
}: {
  accentColor: string | undefined;
  fallbackColor: string;
  presets: readonly string[];
  originHint: string;
  onAccentChange: SlideInspectorProps["onAccentChange"];
}) {
  const currentColor = accentColor ?? fallbackColor;
  const inlinePresets = presets.slice(0, 14);
  const activePreset = accentColor
    ? presets.find((preset) => sameHex(accentColor, preset))
    : undefined;
  const status = accentColor
    ? activePreset
      ? "Preset accent"
      : "Custom accent"
    : originHint;

  return (
    <div className="flex flex-col gap-2 rounded-ds-md bg-ds-surface-raised/60 p-2 ring-1 ring-ds-border-subtle">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-8 w-10 shrink-0 rounded-ds-md border border-ds-border-subtle"
          style={{ backgroundColor: currentColor }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-end gap-2">
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="rounded-full bg-ds-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ds-text-muted ring-1 ring-ds-border-subtle">
                {status}
              </span>
              {accentColor ? (
                <button
                  type="button"
                  onClick={() => onAccentChange(undefined)}
                  className={`rounded-full bg-ds-accent-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ds-accent-text ring-1 ring-ds-accent-border transition-colors hover:bg-ds-accent hover:text-ds-text-on-accent ${FOCUS_RING}`}
                >
                  Reset
                </button>
              ) : null}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <BackgroundChoiceHeader title="Accent presets" />
        <div className="grid grid-cols-7 gap-1.5">
          {inlinePresets.map((preset) => (
            <Swatch
              key={preset}
              color={preset}
              size="lg"
              selected={sameHex(accentColor, preset)}
              aria-label={`Accent ${preset}`}
              className="rounded-full transition-transform hover:scale-110"
              onClick={() => onAccentChange(preset)}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <BackgroundChoiceHeader title="Customize" />
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
          <ColorPicker
            color={currentColor}
            fallback={fallbackColor}
            aria-label="Custom accent color"
            layer="tooltip"
            customOnly
            onChange={onAccentChange}
          />
          <span className="truncate font-mono text-xs tabular-nums text-ds-text-secondary">
            {currentColor.toLowerCase()}
          </span>
        </div>
      </div>
    </div>
  );
}

function SlideImageControl({
  backgroundImage,
  bgImageError,
  fileInputRef,
  onPickFile,
  onBackgroundImageChange,
  onBackgroundAssetChange,
}: {
  backgroundImage: string | undefined;
  bgImageError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPickFile: (file: File | undefined) => void;
  onBackgroundImageChange: SlideInspectorProps["onBackgroundImageChange"];
  onBackgroundAssetChange?: SlideInspectorProps["onBackgroundAssetChange"];
}) {
  function resetImage() {
    onBackgroundAssetChange?.(undefined);
    onBackgroundImageChange(undefined);
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-ds-md bg-ds-surface-raised/60 p-2 ring-1 ring-ds-border-subtle">
      <div className="flex items-center justify-end gap-2">
        {backgroundImage ? (
          <button
            type="button"
            onClick={resetImage}
            className={`rounded-full bg-ds-accent-surface px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ds-accent-text ring-1 ring-ds-accent-border transition-colors hover:bg-ds-accent hover:text-ds-text-on-accent ${FOCUS_RING}`}
          >
            Reset
          </button>
        ) : (
          <span className="rounded-full bg-ds-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ds-text-muted ring-1 ring-ds-border-subtle">
            Empty
          </span>
        )}
      </div>

      <div className="relative aspect-video overflow-hidden rounded-ds-md border border-ds-border-subtle bg-ds-surface">
        {backgroundImage ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${backgroundImage})` }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-ds-text-muted">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ds-accent-surface text-ds-accent-text ring-1 ring-ds-accent-border">
              <ImageIcon size={17} aria-hidden="true" />
            </span>
            <span className="text-xs font-medium">No image selected</span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className={`flex w-full items-center justify-center gap-2 rounded-ds-md border border-dashed border-ds-border-subtle bg-ds-surface px-2 py-2.5 text-[13px] font-semibold text-ds-text-secondary transition-colors hover:border-ds-border-strong hover:bg-ds-state-hover hover:text-ds-text-primary ${FOCUS_RING}`}
      >
        <Upload size={14} aria-hidden="true" />
        {backgroundImage ? "Replace image" : "Upload image"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          onPickFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
          <Link size={12} aria-hidden="true" />
          Image URL
        </span>
        <input
          type="text"
          value={backgroundImage ?? ""}
          onChange={(event) =>
            onBackgroundImageChange(
              event.target.value.trim() === ""
                ? undefined
                : event.target.value.trim(),
            )
          }
          placeholder="https://… or data:image/…"
          className={`${FIELD_CLASS} bg-ds-surface py-2 placeholder:text-ds-text-muted ${FOCUS_RING}`}
          aria-label="Background image URL"
        />
      </label>
      {bgImageError ? (
        <p role="alert" className="text-xs text-ds-danger-text">
          {bgImageError}
        </p>
      ) : null}
    </div>
  );
}

export function SlidePanelBody({
  slide,
  deck,
  brandSwatches,
  documentId,
  slideAssetPort,
  onBackgroundChange,
  onBackgroundGradientChange,
  onBackgroundImageChange,
  onBackgroundAssetChange,
  onAccentChange,
}: {
  slide: Slide;
  deck: Deck;
  brandSwatches: readonly string[];
  showAdvanced: boolean;
  documentId?: string;
  slideAssetPort?: SlideInspectorProps["slideAssetPort"];
  onBackgroundChange: SlideInspectorProps["onBackgroundChange"];
  onBackgroundGradientChange: SlideInspectorProps["onBackgroundGradientChange"];
  onBackgroundImageChange: SlideInspectorProps["onBackgroundImageChange"];
  onBackgroundAssetChange?: SlideInspectorProps["onBackgroundAssetChange"];
  onAccentChange: SlideInspectorProps["onAccentChange"];
}) {
  const [bgImageError, setBgImageError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SlideStyleTab>("background");
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const backgroundImage = slideBackgroundImageValue(slide);
  const backgroundGradient = slideBackgroundGradientValue(slide);
  const backgroundColor = slideSolidBackgroundValue(slide);
  const accentColor = slideAccentValue(slide);
  const designOrigins = inspectSlideDesignOrigins(deck, slide);
  const themeColors = resolveSlideThemeColors(deck, slide);

  function handleBackgroundImageChange(value: string | undefined) {
    if (value?.startsWith("data:")) {
      if (!value.startsWith("data:image/")) {
        setBgImageError("Please enter an image data URL (data:image/…).");
        return;
      }
      const addedBytes = value.length - dataUrlByteSize(backgroundImage);
      if (addedBytes > 0) {
        const budget = canAddImage(deck, addedBytes);
        if (!budget.ok) {
          const usedMb = (budget.totalBytes / (1024 * 1024)).toFixed(1);
          setBgImageError(
            `Deck image storage is full (${usedMb} MB). Remove an image or use a smaller file.`,
          );
          return;
        }
      }
    }
    setBgImageError(null);
    onBackgroundImageChange(value);
  }

  const { handleFile: handleBgImageFile } = useImageUpload({
    deck,
    currentSrc: backgroundImage,
    onAccept: (src, assetId) => {
      setBgImageError(null);
      if (assetId && onBackgroundAssetChange) {
        onBackgroundAssetChange({ url: src, assetId });
      } else {
        handleBackgroundImageChange(src);
      }
    },
    onError: (message) => setBgImageError(message),
    documentId: documentId ?? undefined,
    uploadFn: documentId ? slideAssetPort?.uploadSlideAsset : undefined,
  });

  return (
    <>
      <PanelSection>
        <SlideStyleTabs activeTab={activeTab} onChange={setActiveTab} />
        {activeTab === "background" ? (
          <SlideBackgroundControl
            backgroundColor={backgroundColor}
            backgroundGradient={backgroundGradient}
            backgroundImage={backgroundImage}
            fallbackColor={themeColors.bgColor}
            originHint={designOriginTag(designOrigins.background.layer)}
            onBackgroundChange={onBackgroundChange}
            onBackgroundGradientChange={onBackgroundGradientChange}
          />
        ) : null}
        {activeTab === "accent" ? (
          <SlideAccentControl
            accentColor={accentColor}
            fallbackColor={themeColors.accentColor}
            presets={mergeSwatches(brandSwatches, THEME_ACCENT_SWATCHES)}
            originHint={designOriginTag(designOrigins.accent.layer)}
            onAccentChange={onAccentChange}
          />
        ) : null}
        {activeTab === "image" ? (
          <SlideImageControl
            backgroundImage={backgroundImage}
            bgImageError={bgImageError}
            fileInputRef={bgFileInputRef}
            onPickFile={handleBgImageFile}
            onBackgroundImageChange={handleBackgroundImageChange}
            onBackgroundAssetChange={onBackgroundAssetChange}
          />
        ) : null}
      </PanelSection>
    </>
  );
}
