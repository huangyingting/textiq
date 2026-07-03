"use client";

import {
  Brush,
  Check,
  ChevronDown,
  Copy,
  Download,
  Image,
  Info,
  LayoutGrid,
  Maximize2,
  Palette,
  RefreshCw,
  Sparkles,
  Trash2,
  Type,
  Wand2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { VisualRenderer } from "@/components/visual/visual-renderer";
import {
  ColorPicker,
  Divider,
  FloatingSurface,
  IconButton,
  SegmentedControl,
  Tooltip,
  cx,
  FOCUS_RING,
  type SegmentedOption,
} from "@/components/ui";
import { VISUAL_KIND_META } from "@/lib/lexical/tool-registry";
import {
  applyTheme,
  isThemeActive,
  isSourceStale,
  resetNodeStyle,
  resetNodeExtStyle,
  setNodeIcon,
  setNodeStyle,
  setNodeFillStyle,
  setNodeBorderStyle,
  setNodeBorderWidth,
  setNodeTextAlign,
  setNodeFontFamily,
  setVisualKind,
  setVisualStyle,
  clearNodeIcon,
  applyDisplayStyle,
  isDisplayStyleActive,
  setAllEdgesStyle,
  setAspectRatio,
  setCanvasStyle,
  setAutoLayout,
  setEffect,
  clearEffect,
} from "@/lib/visual/transforms";
import { STYLE_THEMES } from "@/lib/visual/themes";
import { VISUAL_DISPLAY_STYLES } from "@/lib/visual/display-styles";
import { isPositionedKind } from "@/lib/visual/layout";
import {
  VISUAL_KINDS,
  type Visual,
  type VisualKind,
  type ArrowStyle,
  type LineStyle,
  type FillStyle,
  type TextAlign,
  type AspectRatioPreset,
  type CanvasStyle,
  ASPECT_RATIO_PRESETS,
  type EffectKind,
} from "@/lib/visual/schema";
import { applyBrand, brandPreviewStyle } from "@/lib/brand/transforms";
import type { BrandStyle } from "@/lib/brand/schema";
import { BRAND_WEB_FONTS } from "@/lib/brand/schema";
import {
  useHydrateBrandFont,
  useHydrateVisualNodeFonts,
} from "@/lib/brand/font-hooks";
import type { VisualCommandPayload } from "@/lib/commands/visual-commands";
import type { VisualGenerationActionPort } from "@/lib/action-ports";
import { requestVisualCandidates } from "@/lib/visual/generate";

import { IconPicker } from "./icon-picker";
import {
  VisualExportPanel,
  VisualInfoPanel,
  VisualSyncPanel,
  VisualVariationsPanel,
} from "./visual-context-popover-panels";
import {
  useBrandContext,
  usePopoverGeneration,
  usePopoverPosition,
  useVisualSync,
  type MenuSection,
} from "./visual-context-popover-hooks";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const POPOVER_WIDTH = 400;
const COMPONENT_POPOVER_WIDTH = 300;

const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 28;
const LINE_WIDTH_MIN = 0.5;
const LINE_WIDTH_MAX = 6;

// ---------------------------------------------------------------------------
// Option arrays
// ---------------------------------------------------------------------------

const FONT_WEIGHTS: SegmentedOption<string>[] = [
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
  { value: "800", label: "Black" },
];

const ARROW_STYLE_OPTIONS: SegmentedOption<ArrowStyle>[] = [
  { value: "filled", label: "Filled" },
  { value: "open", label: "Open" },
  { value: "circle", label: "Circle" },
  { value: "diamond", label: "Diamond" },
];

const LINE_STYLE_OPTIONS: SegmentedOption<LineStyle>[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

const FILL_STYLE_OPTIONS: SegmentedOption<FillStyle>[] = [
  { value: "solid", label: "Flat" },
  { value: "gradient", label: "Gradient" },
];

const TEXT_ALIGN_OPTIONS: SegmentedOption<TextAlign>[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

const BORDER_STYLE_OPTIONS: SegmentedOption<LineStyle>[] = LINE_STYLE_OPTIONS;

const NODE_FONT_FAMILY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Default" },
  ...BRAND_WEB_FONTS.map((f) => ({ value: f.cssFamily, label: f.name })),
];

const ASPECT_RATIO_OPTIONS: SegmentedOption<AspectRatioPreset>[] =
  ASPECT_RATIO_PRESETS.map((preset) => ({
    value: preset,
    label: preset === "auto" ? "Auto" : preset,
  }));

const CANVAS_STYLE_OPTIONS: SegmentedOption<CanvasStyle>[] = [
  { value: "blank", label: "Blank" },
  { value: "ruled", label: "Ruled" },
  { value: "dot-grid", label: "Dots" },
];

const KIND_OPTIONS: SegmentedOption<VisualKind>[] = VISUAL_KINDS.map((kind) => {
  const meta = VISUAL_KIND_META[kind];
  const Icon = meta.icon;
  return {
    value: kind,
    label: meta.label,
    iconOnly: true,
    icon: <Icon aria-hidden="true" className="h-4 w-4" />,
  };
});

// ---------------------------------------------------------------------------
// Section navigation
// ---------------------------------------------------------------------------

// MenuSection is exported from ./visual-context-popover-hooks

interface MenuItemConfig {
  id: MenuSection;
  label: string;
  icon: React.ElementType;
  description?: string;
}

const MENU_ITEMS: MenuItemConfig[] = [
  {
    id: "export",
    label: "Export Visual",
    icon: Download,
    description: "PNG, SVG, PPTX",
  },
  {
    id: "effects",
    label: "Effects",
    icon: Wand2,
    description: "Shadow, sketch",
  },
  {
    id: "colors",
    label: "Colors",
    icon: Palette,
    description: "Theme & color overrides",
  },
  {
    id: "fonts",
    label: "Fonts",
    icon: Type,
    description: "Weight, size, family",
  },
  {
    id: "size",
    label: "Size",
    icon: Maximize2,
    description: "Aspect ratio & canvas",
  },
  {
    id: "layout",
    label: "Swap Layout",
    icon: LayoutGrid,
    description: "Kind & style gallery",
  },
  {
    id: "branding",
    label: "Swap Branding",
    icon: Brush,
    description: "Saved brand styles",
  },
  {
    id: "sync",
    label: "Sync with Text",
    icon: RefreshCw,
    description: "Regenerate from source",
  },
  { id: "info", label: "Info", icon: Info, description: "Visual metadata" },
];

const COMPONENT_MENU_ITEMS: MenuItemConfig[] = [
  {
    id: "colors",
    label: "Colors",
    icon: Palette,
    description: "Fill, stroke, text",
  },
  {
    id: "fonts",
    label: "Font",
    icon: Type,
    description: "Family override",
  },
  {
    id: "icon",
    label: "Icon",
    icon: Image,
    description: "Icon picker",
  },
];

// ---------------------------------------------------------------------------
// Shared small UI atoms
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ds-text-muted,#6f7d83)]">
      {children}
    </p>
  );
}

/** A labelled row pairing a field name with a {@link ColorPicker}. */
function ColorField({
  label,
  color,
  onChange,
}: {
  label: string;
  color: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-[var(--ds-text-primary,#18181b)]">
      <span className="text-[var(--ds-text-muted,#6f7d83)]">{label}</span>
      <ColorPicker color={color} aria-label={label} onChange={onChange} />
    </div>
  );
}

function CompactColorField({
  label,
  color,
  onChange,
}: {
  label: string;
  color: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <ColorPicker
        color={color}
        aria-label={label}
        onChange={onChange}
        size="sm"
      />
      <span className="max-w-full truncate text-[10px] text-[var(--ds-text-muted,#6f7d83)]">
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-section control components
// ---------------------------------------------------------------------------

/** A theme preview chip: node-fill tile, stroke border, 3-dot palette strip. */
function ThemeChip({
  themeName,
  colors,
  active,
  onSelect,
}: {
  themeName: string;
  colors: (typeof STYLE_THEMES)[number]["colors"];
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <Tooltip label={themeName} side="bottom">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        aria-label={`Theme ${themeName}`}
        className={cx(
          "flex flex-col items-stretch gap-1 rounded-[var(--ds-radius-md,10px)] border p-1.5 transition",
          active
            ? "border-transparent ring-2 ring-[var(--ds-accent,#6366f1)]"
            : "border-[var(--ds-border-subtle,rgba(0,0,0,0.1))] hover:border-[var(--ds-border-strong,rgba(0,0,0,0.2))]",
          FOCUS_RING,
        )}
      >
        <span
          className="flex h-8 items-end justify-center gap-1 rounded-[var(--ds-radius-sm,8px)] border p-1.5"
          style={{
            backgroundColor: colors.nodeFill,
            borderColor: colors.nodeStroke,
          }}
        >
          {colors.palette.slice(0, 3).map((color, index) => (
            <span
              key={`${color}-${index}`}
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: color }}
            />
          ))}
        </span>
        <span className="truncate text-center text-[10px] font-medium text-[var(--ds-text-muted,#6f7d83)]">
          {themeName}
        </span>
      </button>
    </Tooltip>
  );
}

/**
 * Style gallery: renders the current visual content as thumbnails in each
 * named display style so the user can pick a clearly-distinct presentation
 * with a single click (non-destructive — content is preserved).
 */
function StyleGallery({
  visual,
  onSelect,
}: {
  visual: Visual;
  onSelect: (styleId: string) => void;
}) {
  const activeId = useMemo(() => {
    const match = VISUAL_DISPLAY_STYLES.find((s) =>
      isDisplayStyleActive(visual, s.id),
    );
    return match?.id ?? null;
  }, [visual]);

  const variants = useMemo(
    () =>
      VISUAL_DISPLAY_STYLES.map((preset) => ({
        preset,
        styled: applyDisplayStyle(visual, preset.id),
      })),
    [visual],
  );

  return (
    <ul
      role="group"
      aria-label="Style gallery"
      className="mt-1.5 grid grid-cols-2 gap-2"
    >
      {variants.map(({ preset, styled }) => {
        const active = activeId === preset.id;
        return (
          <li key={preset.id}>
            <Tooltip label={preset.description} side="bottom">
              <button
                type="button"
                aria-label={`Apply ${preset.name} style`}
                aria-pressed={active}
                onClick={() => onSelect(preset.id)}
                className={cx(
                  "group flex w-full flex-col overflow-hidden rounded-[var(--ds-radius-md,10px)] border p-1.5 text-left transition",
                  active
                    ? "border-transparent ring-2 ring-[var(--ds-accent,#6366f1)]"
                    : "border-[var(--ds-border-subtle,rgba(0,0,0,0.08))] hover:border-[var(--ds-border-strong,rgba(0,0,0,0.2))]",
                  FOCUS_RING,
                )}
              >
                <VisualRenderer visual={styled} className="h-auto w-full" />
                <span className="mt-1 block truncate text-center text-[10px] font-medium text-[var(--ds-text-muted,#6f7d83)]">
                  {preset.name}
                </span>
              </button>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

/** Preset metadata for the effects picker. */
const EFFECT_PRESETS: {
  kind: EffectKind;
  label: string;
  description: string;
}[] = [
  {
    kind: "shadow",
    label: "Shadow",
    description: "Soft drop shadow beneath the visual content",
  },
  {
    kind: "sketch",
    label: "Sketch",
    description: "Hand-drawn / rough-stroke appearance",
  },
];

function EffectsPicker({
  visual,
  onChange,
  onCommand,
}: {
  visual: Visual;
  onChange: (next: Visual) => void;
  onCommand?: (payload: VisualCommandPayload) => void;
}) {
  const activeKinds = new Set((visual.effects ?? []).map((e) => e.kind));
  return (
    <div
      role="group"
      aria-label="Visual effects"
      className="grid grid-cols-2 gap-2"
    >
      {EFFECT_PRESETS.map(({ kind, label, description }) => {
        const active = activeKinds.has(kind);
        return (
          <Tooltip key={kind} label={description} side="bottom">
            <button
              type="button"
              aria-label={`${active ? "Remove" : "Apply"} ${label} effect`}
              aria-pressed={active}
              onClick={() => {
                if (active) {
                  if (onCommand) onCommand({ op: "visual.clear_effect", kind });
                  else onChange(clearEffect(visual, kind));
                } else {
                  if (onCommand)
                    onCommand({ op: "visual.set_effect", effect: { kind } });
                  else onChange(setEffect(visual, { kind }));
                }
              }}
              className={cx(
                "flex items-center justify-center gap-1.5 rounded-[var(--ds-radius-md,10px)] border px-3 py-2 text-[11px] font-medium transition",
                active
                  ? "border-transparent bg-[var(--ds-accent,#6366f1)]/10 text-[var(--ds-accent,#6366f1)] ring-2 ring-[var(--ds-accent,#6366f1)]"
                  : "border-[var(--ds-border-subtle,rgba(0,0,0,0.1))] text-[var(--ds-text-muted,#6f7d83)] hover:border-[var(--ds-border-strong,rgba(0,0,0,0.2))] hover:text-[var(--ds-text-primary,#18181b)]",
                FOCUS_RING,
              )}
            >
              <Wand2 aria-hidden="true" className="h-3 w-3 flex-shrink-0" />
              {label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brand chip
// ---------------------------------------------------------------------------

function BrandChip({
  brand,
  active,
  onApply,
  onApplyAll,
}: {
  brand: BrandStyle;
  active: boolean;
  onApply: () => void;
  onApplyAll: () => void;
}) {
  useHydrateBrandFont(brand);
  const preview = brandPreviewStyle(brand);
  return (
    <div
      className={cx(
        "group flex flex-col gap-1 rounded-[var(--ds-radius-md,10px)] border p-1.5 transition",
        active
          ? "border-transparent ring-2 ring-[var(--ds-accent,#6366f1)]"
          : "border-[var(--ds-border-subtle,rgba(0,0,0,0.1))] hover:border-[var(--ds-border-strong,rgba(0,0,0,0.2))]",
        FOCUS_RING,
      )}
    >
      <Tooltip label={brand.name} side="bottom">
        <button
          type="button"
          aria-label={`Apply brand ${brand.name}`}
          aria-pressed={active}
          onClick={onApply}
          className="flex flex-col gap-1"
        >
          <span
            className="flex h-8 items-end justify-center gap-1 rounded-[var(--ds-radius-sm,8px)] border p-1.5"
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
          <span className="truncate text-center text-[10px] font-medium text-[var(--ds-text-muted,#6f7d83)]">
            {brand.name}
          </span>
        </button>
      </Tooltip>
      <Tooltip label="Apply to all visuals" side="bottom">
        <button
          type="button"
          aria-label={`Apply brand ${brand.name} to all visuals`}
          onClick={onApplyAll}
          className={cx(
            "hidden w-full rounded-[var(--ds-radius-sm,8px)] px-1 py-0.5 text-[9px] font-medium text-[var(--ds-text-muted)] hover:text-[var(--ds-accent)] group-hover:flex",
            FOCUS_RING,
          )}
        >
          Apply to all
        </button>
      </Tooltip>
    </div>
  );
}

function ToolbarMenuItemButton({
  item,
  active,
  showSourceChangedIndicator = false,
  onToggle,
}: {
  item: MenuItemConfig;
  active: boolean;
  showSourceChangedIndicator?: boolean;
  onToggle: () => void;
}) {
  const Icon = item.icon;
  return (
    <Tooltip label={item.label}>
      <span className="relative inline-flex">
        <IconButton
          aria-label={`${active ? "Hide" : "Show"} ${item.label}`}
          size="sm"
          active={active}
          onClick={onToggle}
        >
          <Icon aria-hidden="true" className="h-4 w-4" />
        </IconButton>
        {showSourceChangedIndicator ? (
          <span
            aria-label="Source changed"
            className="pointer-events-none absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-ds-warning"
          />
        ) : null}
      </span>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// PopoverShell — float vs panel wrapper
// ---------------------------------------------------------------------------

export type VisualContextPopoverProps = {
  visualId: string;
  visual: Visual;
  selectedNodeId: string | null;
  /** Applies a transformed visual back to the document (via `node.setVisual`). */
  onChange: (next: Visual) => void;
  /**
   * Routes a typed visual command payload through `executeVisualCommand`
   * (issue #471/#507). When provided, visual-level intent edits (theme, display
   * style, effects, kind, canvas, aspect ratio, auto-layout, node/visual style,
   * node ext style, node icon, edge style) are dispatched here instead of
   * calling `onChange` directly, so edits flow through command metadata
   * (patches, side effects, render invalidation, source staleness) and are
   * validated before persistence. When omitted, the popover applies edits
   * directly through `onChange`.
   */
  onCommand?: (payload: VisualCommandPayload, coalesceKey?: string) => void;
  onRemove: () => void;
  onRemoveSelectedNode?: () => void;
  onClose: () => void;
  /** The selected SVG canvas, for exports. */
  getSvgElement: () => SVGSVGElement | null;
  /** The visual card element the popover anchors to (positioning + click-away). */
  anchorRef: React.RefObject<HTMLElement | null>;
  /**
   * The current text of the preceding document block (the visual's anchor).
   * When present and different from `visual.sourceText`, the out-of-date
   * indicator is shown and "Sync to text" uses this text for re-generation.
   */
  currentSourceText?: string;
  /**
   * Applies a brand to ALL visuals in the document via `editor.update()`.
   * Provided by `VisualCard` which owns the Lexical editor context.
   */
  onApplyBrandToAll?: (brand: BrandStyle) => void;
  /**
   * Rendering mode:
   * - `"float"` (default) — wrapped in a {@link FloatingSurface} anchored to
   *   `anchorRef`; positioning and click-away are active.
   * - `"panel"` — renders the content directly as a plain `<div>` without any
   *   overlay/portal, suitable for hosting inside sheets or other embedded
   *   toolbox surfaces.
   */
  mode?: "float" | "panel";
  /** Duplicate this visual node (shown in the toolbar header). */
  onDuplicate?: () => void;
  /** Route-owned AI visual generation port. Defaults to the document route API. */
  visualGenerationPort?: VisualGenerationActionPort;
};

const routeVisualGenerationPort: VisualGenerationActionPort = {
  requestVisualCandidates,
};

function PopoverShell({
  mode,
  coords,
  onClose,
  width,
  freezePosition,
  children,
}: {
  mode: "float" | "panel";
  coords: { top: number; left: number };
  onClose: () => void;
  width: CSSProperties["width"];
  freezePosition?: boolean;
  children: ReactNode;
}) {
  if (mode === "panel") return <>{children}</>;
  return (
    <FloatingSurface
      open
      position={coords}
      role="region"
      aria-label="Visual controls"
      elevation="popover"
      radius="lg"
      closeOnEscape
      closeOnClickAway={false}
      clampToViewport={!freezePosition}
      onClose={onClose}
      style={{ width }}
    >
      {children}
    </FloatingSurface>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * The context-aware visual editing surface (Phase 4 / Issue #45).
 *
 * Replaces the old flat scrollable popover with a CATEGORIZED MENU where each
 * row opens a focused submenu (drill-down navigation). A compact bottom
 * quick-toolbar exposes the four highest-frequency actions. Works in both
 * "float" (anchored overlay) and "panel" (embedded toolbox) modes.
 *
 * Every mutation flows through `onChange(transform(visual, …))` → `node.setVisual()`
 * → `editor.update()` — never Yjs directly.
 */
export function VisualContextPopover({
  visualId,
  visual,
  selectedNodeId,
  onChange,
  onCommand,
  onRemove,
  onRemoveSelectedNode,
  onClose,
  getSvgElement,
  anchorRef,
  currentSourceText,
  onApplyBrandToAll,
  mode = "float",
  onDuplicate,
  visualGenerationPort = routeVisualGenerationPort,
}: VisualContextPopoverProps) {
  const measureRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  // Drill-down navigation: null = main menu, string = active submenu section
  const [activeSection, setActiveSection] = useState<MenuSection | null>(null);
  const [selectionContextKey, setSelectionContextKey] = useState(
    `${visualId}:${selectedNodeId ?? "visual"}`,
  );
  const [nodeFontPickerOpen, setNodeFontPickerOpen] = useState(false);

  // Colors submenu: progressive disclosure for per-color overrides
  const [customizeOpen, setCustomizeOpen] = useState(false);

  // The most recently chosen theme this session, for "Reset to theme".
  const [lastThemeId, setLastThemeId] = useState<string | null>(null);

  // Keep the latest visual available to async generate callbacks.
  const visualRef = useRef<Visual>(visual);
  useEffect(() => {
    visualRef.current = visual;
  });

  // Load any Google Fonts used as per-node font family overrides.
  useHydrateVisualNodeFonts(visual);

  const stale = isSourceStale(visual, currentSourceText ?? "");
  const { style } = visual;

  const activeThemeId = useMemo(() => {
    const match = STYLE_THEMES.find((theme) => isThemeActive(visual, theme.id));
    return match?.id ?? null;
  }, [visual]);

  const resetThemeId = activeThemeId ?? lastThemeId;

  const selectedNode = useMemo(
    () =>
      selectedNodeId
        ? (visual.nodes.find((node) => node.id === selectedNodeId) ?? null)
        : null,
    [visual.nodes, selectedNodeId],
  );
  const componentContext = selectedNode !== null;
  const effectiveActiveSection: MenuSection | null =
    componentContext &&
    activeSection !== "colors" &&
    activeSection !== "fonts" &&
    activeSection !== "icon"
      ? null
      : activeSection;
  const popoverExpanded = effectiveActiveSection !== null;

  // Brands — lazy-loaded when the branding section opens
  const { brands, status: brandsStatus } = useBrandContext(activeSection);

  // AI variations generation
  const {
    genStatus,
    genError,
    genCreditError,
    candidates,
    runGenerate,
    chooseCandidate,
    reset: resetGeneration,
  } = usePopoverGeneration({
    visualRef,
    visualGenerationPort,
    visual,
    onChange,
    onCommand,
    onSectionChange: setActiveSection,
  });

  // Sync-to-text
  const {
    syncStatus,
    syncError,
    runSync,
    reset: resetSync,
  } = useVisualSync({
    visualRef,
    visualGenerationPort,
    currentSourceText,
    onChange,
    onCommand,
    onSectionChange: setActiveSection,
  });

  // Popover positioning: coords + scroll/click-away effects delegated to hook
  const { coords } = usePopoverPosition({
    mode,
    anchorRef,
    measureRef,
    toolbarRef,
    componentContext,
    selectedNodeId,
    popoverExpanded,
    onClose,
  });

  // Synchronous derived-state reset when the selection context changes so the
  // popover doesn't briefly show stale candidates or errors for the new selection.
  const nextSelectionContextKey = `${visualId}:${selectedNodeId ?? "visual"}`;
  if (nextSelectionContextKey !== selectionContextKey) {
    setSelectionContextKey(nextSelectionContextKey);
    setActiveSection(null);
    setNodeFontPickerOpen(false);
    setCustomizeOpen(false);
    resetGeneration();
    resetSync();
  }

  const applyThemeById = useCallback(
    (themeId: string) => {
      setLastThemeId(themeId);
      if (onCommand) {
        onCommand({ op: "visual.apply_theme", themeId });
      } else {
        onChange(applyTheme(visual, themeId));
      }
    },
    [onChange, onCommand, visual],
  );

  const applyDisplayStyleById = useCallback(
    (styleId: string) => {
      if (onCommand) {
        onCommand({ op: "visual.apply_display_style", styleId });
      } else {
        onChange(applyDisplayStyle(visual, styleId));
      }
    },
    [onChange, onCommand, visual],
  );

  const applyBrandToThis = useCallback(
    // #507 exemption: `applyBrand` is a composite styling preset with no single
    // `visual.*` command op. Themes (the command-backed equivalent) route through
    // `applyThemeById`; brand presets remain a direct transform.
    (brand: BrandStyle) => {
      onChange(applyBrand(visual, brand));
    },
    [onChange, visual],
  );

  // #507: routes a discrete user-intent style edit through the visual command
  // executor when a command sink (`onCommand`) is available, so the edit is
  // validated and carries command metadata before `node.setVisual`. Callers
  // without a command sink fall back to the identical direct transform, so
  // externally observable behavior is unchanged.
  const runVisualEdit = useCallback(
    (payload: VisualCommandPayload, fallback: () => Visual) => {
      if (onCommand) {
        onCommand(payload);
      } else {
        onChange(fallback());
      }
    },
    [onChange, onCommand],
  );

  // ---------------------------------------------------------------------------
  // Submenu content renderers
  // ---------------------------------------------------------------------------

  function renderEffectsSection() {
    return (
      <div className="py-1">
        <EffectsPicker
          visual={visual}
          onChange={onChange}
          onCommand={onCommand}
        />
      </div>
    );
  }

  function renderColorsSection() {
    if (selectedNode) {
      return (
        <div className="space-y-2 py-0.5">
          <div className="space-y-1.5 rounded-[var(--ds-radius-md,10px)] bg-[var(--ds-surface-raised,#f4f4f5)] px-2 py-1.5">
            <div className="grid grid-cols-3 gap-2">
              <CompactColorField
                label="Fill"
                color={selectedNode.color ?? style.nodeFill}
                onChange={(v) =>
                  runVisualEdit(
                    {
                      op: "visual.set_node_style",
                      nodeId: selectedNode.id,
                      field: "color",
                      value: v,
                    },
                    () => setNodeStyle(visual, selectedNode.id, "color", v),
                  )
                }
              />
              <CompactColorField
                label="Stroke"
                color={selectedNode.stroke ?? style.nodeStroke}
                onChange={(v) =>
                  runVisualEdit(
                    {
                      op: "visual.set_node_style",
                      nodeId: selectedNode.id,
                      field: "stroke",
                      value: v,
                    },
                    () => setNodeStyle(visual, selectedNode.id, "stroke", v),
                  )
                }
              />
              <CompactColorField
                label="Text"
                color={selectedNode.textColor ?? style.nodeText}
                onChange={(v) =>
                  runVisualEdit(
                    {
                      op: "visual.set_node_style",
                      nodeId: selectedNode.id,
                      field: "textColor",
                      value: v,
                    },
                    () => setNodeStyle(visual, selectedNode.id, "textColor", v),
                  )
                }
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="shrink-0 text-[var(--ds-text-muted,#6f7d83)]">
              Fill
            </span>
            <SegmentedControl<FillStyle>
              aria-label="Fill style"
              size="sm"
              options={FILL_STYLE_OPTIONS}
              value={selectedNode.fillStyle ?? "solid"}
              onChange={(v) =>
                runVisualEdit(
                  {
                    op: "visual.set_node_ext_style",
                    nodeId: selectedNode.id,
                    patch: { fillStyle: v },
                  },
                  () => setNodeFillStyle(visual, selectedNode.id, v),
                )
              }
            />
          </div>

          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="shrink-0 text-[var(--ds-text-muted,#6f7d83)]">
              Border
            </span>
            <SegmentedControl<LineStyle>
              aria-label="Border style"
              size="sm"
              options={BORDER_STYLE_OPTIONS}
              value={selectedNode.borderStyle ?? "solid"}
              onChange={(v) =>
                runVisualEdit(
                  {
                    op: "visual.set_node_ext_style",
                    nodeId: selectedNode.id,
                    patch: { borderStyle: v },
                  },
                  () => setNodeBorderStyle(visual, selectedNode.id, v),
                )
              }
            />
          </div>

          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-[var(--ds-text-muted,#6f7d83)]">Width</span>
            <div className="flex items-center gap-1">
              <IconButton
                aria-label="Decrease border width"
                size="sm"
                variant="subtle"
                disabled={(selectedNode.borderWidth ?? 1.5) <= 0.5}
                onClick={() => {
                  const nextWidth = Math.max(
                    0.5,
                    Math.round(((selectedNode.borderWidth ?? 1.5) - 0.5) * 2) /
                      2,
                  );
                  runVisualEdit(
                    {
                      op: "visual.set_node_ext_style",
                      nodeId: selectedNode.id,
                      patch: { borderWidth: nextWidth },
                    },
                    () =>
                      setNodeBorderWidth(visual, selectedNode.id, nextWidth),
                  );
                }}
              >
                <span aria-hidden="true">−</span>
              </IconButton>
              <span className="w-10 text-center tabular-nums text-[var(--ds-text-muted,#6f7d83)]">
                {(selectedNode.borderWidth ?? 1.5).toFixed(1)}px
              </span>
              <IconButton
                aria-label="Increase border width"
                size="sm"
                variant="subtle"
                disabled={(selectedNode.borderWidth ?? 1.5) >= 8}
                onClick={() => {
                  const nextWidth = Math.min(
                    8,
                    Math.round(((selectedNode.borderWidth ?? 1.5) + 0.5) * 2) /
                      2,
                  );
                  runVisualEdit(
                    {
                      op: "visual.set_node_ext_style",
                      nodeId: selectedNode.id,
                      patch: { borderWidth: nextWidth },
                    },
                    () =>
                      setNodeBorderWidth(visual, selectedNode.id, nextWidth),
                  );
                }}
              >
                <span aria-hidden="true">+</span>
              </IconButton>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="shrink-0 text-[var(--ds-text-muted,#6f7d83)]">
              Align
            </span>
            <SegmentedControl<TextAlign>
              aria-label="Text alignment"
              size="sm"
              options={TEXT_ALIGN_OPTIONS}
              value={selectedNode.textAlign ?? "center"}
              onChange={(v) =>
                runVisualEdit(
                  {
                    op: "visual.set_node_ext_style",
                    nodeId: selectedNode.id,
                    patch: { textAlign: v },
                  },
                  () => setNodeTextAlign(visual, selectedNode.id, v),
                )
              }
            />
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3 py-1">
        {/* Theme grid — primary path */}
        <div className="space-y-1.5">
          <SectionLabel>Theme</SectionLabel>
          <div
            role="group"
            aria-label="Color theme"
            className="grid grid-cols-4 gap-1.5"
          >
            {STYLE_THEMES.map((theme) => (
              <ThemeChip
                key={theme.id}
                themeName={theme.name}
                colors={theme.colors}
                active={activeThemeId === theme.id}
                onSelect={() => applyThemeById(theme.id)}
              />
            ))}
          </div>
        </div>

        {/* Customize colors — progressive disclosure */}
        <div>
          <button
            type="button"
            aria-expanded={customizeOpen}
            onClick={() => setCustomizeOpen((o) => !o)}
            className={cx(
              "flex w-full items-center justify-between rounded-[var(--ds-radius-md,10px)] px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ds-text-muted,#6f7d83)] transition hover:text-[var(--ds-text-primary,#18181b)]",
              FOCUS_RING,
            )}
          >
            <span>Customize colors</span>
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className={cx(
                "h-3.5 w-3.5 transition-transform",
                customizeOpen ? "rotate-180" : "",
              )}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>
          {customizeOpen ? (
            <div className="mt-2 space-y-2">
              <ColorField
                label="Background"
                color={style.background}
                onChange={(v) =>
                  runVisualEdit(
                    { op: "visual.set_style", patch: { background: v } },
                    () => setVisualStyle(visual, { background: v }),
                  )
                }
              />
              <ColorField
                label="Node fill"
                color={style.nodeFill}
                onChange={(v) =>
                  runVisualEdit(
                    { op: "visual.set_style", patch: { nodeFill: v } },
                    () => setVisualStyle(visual, { nodeFill: v }),
                  )
                }
              />
              <ColorField
                label="Node stroke"
                color={style.nodeStroke}
                onChange={(v) =>
                  runVisualEdit(
                    { op: "visual.set_style", patch: { nodeStroke: v } },
                    () => setVisualStyle(visual, { nodeStroke: v }),
                  )
                }
              />
              <ColorField
                label="Text"
                color={style.nodeText}
                onChange={(v) =>
                  runVisualEdit(
                    { op: "visual.set_style", patch: { nodeText: v } },
                    () => setVisualStyle(visual, { nodeText: v }),
                  )
                }
              />
              <ColorField
                label="Edge"
                color={style.edgeColor}
                onChange={(v) =>
                  runVisualEdit(
                    { op: "visual.set_style", patch: { edgeColor: v } },
                    () => setVisualStyle(visual, { edgeColor: v }),
                  )
                }
              />
              {resetThemeId && activeThemeId === null ? (
                <button
                  type="button"
                  onClick={() => applyThemeById(resetThemeId)}
                  className={cx(
                    "rounded-md px-1 py-0.5 text-[11px] font-medium text-[var(--ds-text-muted,#6f7d83)] transition hover:text-[var(--ds-text-primary,#18181b)]",
                    FOCUS_RING,
                  )}
                >
                  Reset to theme
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function renderFontsSection() {
    if (selectedNode) {
      const currentFont =
        NODE_FONT_FAMILY_OPTIONS.find(
          (option) => option.value === (selectedNode.fontFamily ?? ""),
        ) ?? NODE_FONT_FAMILY_OPTIONS[0];
      return (
        <div className="space-y-1.5 py-0.5">
          <SectionLabel>Font family</SectionLabel>
          <button
            type="button"
            aria-label="Element font family"
            aria-expanded={nodeFontPickerOpen}
            onClick={() => setNodeFontPickerOpen((open) => !open)}
            className={cx(
              "flex h-8 w-full items-center justify-between gap-2 rounded-[var(--ds-radius-md,8px)] border border-[var(--ds-border-subtle,rgba(0,0,0,0.08))] bg-[var(--ds-surface-base,#ffffff)] px-2 text-xs font-medium text-[var(--ds-text-primary,#15171a)] transition hover:bg-[var(--ds-state-hover,rgba(0,0,0,0.06))]",
              FOCUS_RING,
            )}
          >
            <span className="truncate">{currentFont.label}</span>
            <ChevronDown
              aria-hidden="true"
              className={cx(
                "h-3.5 w-3.5 shrink-0 text-[var(--ds-text-muted,#6f7d83)] transition-transform",
                nodeFontPickerOpen ? "rotate-180" : "",
              )}
            />
          </button>

          {nodeFontPickerOpen ? (
            <div
              role="listbox"
              aria-label="Font families"
              className="max-h-48 overflow-y-auto rounded-[var(--ds-radius-md,8px)] border border-[var(--ds-border-subtle,rgba(0,0,0,0.08))] bg-[var(--ds-surface-base,#ffffff)] p-1 shadow-[var(--ds-shadow-raised,0_10px_30px_rgba(15,23,42,0.12))]"
            >
              {NODE_FONT_FAMILY_OPTIONS.map((option) => {
                const active = option.value === (selectedNode.fontFamily ?? "");
                return (
                  <button
                    key={option.value || "default"}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      runVisualEdit(
                        {
                          op: "visual.set_node_ext_style",
                          nodeId: selectedNode.id,
                          patch: { fontFamily: option.value },
                        },
                        () =>
                          setNodeFontFamily(
                            visual,
                            selectedNode.id,
                            option.value,
                          ),
                      );
                      setNodeFontPickerOpen(false);
                    }}
                    className={cx(
                      "flex w-full items-center justify-between gap-2 rounded-[var(--ds-radius-sm,6px)] px-2 py-1.5 text-left text-xs transition",
                      active
                        ? "bg-[var(--ds-accent,#6366f1)] text-[var(--ds-text-on-accent,#ffffff)]"
                        : "text-[var(--ds-text-secondary,#52525b)] hover:bg-[var(--ds-state-hover,rgba(0,0,0,0.06))] hover:text-[var(--ds-text-primary,#15171a)]",
                      FOCUS_RING,
                    )}
                    style={
                      option.value ? { fontFamily: option.value } : undefined
                    }
                  >
                    <span className="truncate">{option.label}</span>
                    {active ? (
                      <Check aria-hidden="true" className="h-3.5 w-3.5" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div className="space-y-3 py-1">
        <div className="space-y-2">
          <SectionLabel>Type size &amp; weight</SectionLabel>
          <div className="flex items-center justify-between gap-2 text-xs text-[var(--ds-text-primary,#18181b)]">
            <span className="text-[var(--ds-text-muted,#6f7d83)]">
              Font size
            </span>
            <div className="flex items-center gap-1">
              <IconButton
                aria-label="Decrease font size"
                size="sm"
                variant="subtle"
                disabled={style.fontSize <= FONT_SIZE_MIN}
                onClick={() =>
                  runVisualEdit(
                    {
                      op: "visual.set_style",
                      patch: {
                        fontSize: Math.max(FONT_SIZE_MIN, style.fontSize - 1),
                      },
                    },
                    () =>
                      setVisualStyle(visual, {
                        fontSize: Math.max(FONT_SIZE_MIN, style.fontSize - 1),
                      }),
                  )
                }
              >
                <span aria-hidden="true">−</span>
              </IconButton>
              <span className="w-10 text-center tabular-nums text-[var(--ds-text-muted,#6f7d83)]">
                {style.fontSize}px
              </span>
              <IconButton
                aria-label="Increase font size"
                size="sm"
                variant="subtle"
                disabled={style.fontSize >= FONT_SIZE_MAX}
                onClick={() =>
                  runVisualEdit(
                    {
                      op: "visual.set_style",
                      patch: {
                        fontSize: Math.min(FONT_SIZE_MAX, style.fontSize + 1),
                      },
                    },
                    () =>
                      setVisualStyle(visual, {
                        fontSize: Math.min(FONT_SIZE_MAX, style.fontSize + 1),
                      }),
                  )
                }
              >
                <span aria-hidden="true">+</span>
              </IconButton>
            </div>
          </div>
          <div className="overflow-x-auto">
            <SegmentedControl<string>
              aria-label="Font weight"
              size="sm"
              options={FONT_WEIGHTS}
              value={String(style.fontWeight)}
              onChange={(v) =>
                runVisualEdit(
                  { op: "visual.set_style", patch: { fontWeight: Number(v) } },
                  () => setVisualStyle(visual, { fontWeight: Number(v) }),
                )
              }
            />
          </div>
        </div>
      </div>
    );
  }

  function renderIconSection() {
    if (!selectedNode) {
      return null;
    }
    return (
      <div className="py-0.5">
        <IconPicker
          key={selectedNode.id}
          expanded
          nodeLabel={selectedNode.label}
          value={selectedNode.icon}
          onSelect={(name) =>
            runVisualEdit(
              {
                op: "visual.set_node_icon",
                nodeId: selectedNode.id,
                icon: name,
              },
              () => setNodeIcon(visual, selectedNode.id, name),
            )
          }
          onRemove={() =>
            runVisualEdit(
              { op: "visual.clear_node_icon", nodeId: selectedNode.id },
              () => clearNodeIcon(visual, selectedNode.id),
            )
          }
        />
      </div>
    );
  }

  function renderSizeSection() {
    return (
      <div className="space-y-3 py-1">
        <div className="space-y-1">
          <SectionLabel>Export ratio</SectionLabel>
          <div className="overflow-x-auto">
            <SegmentedControl<AspectRatioPreset>
              aria-label="Export aspect ratio"
              size="sm"
              options={ASPECT_RATIO_OPTIONS}
              value={visual.aspectRatio ?? "auto"}
              onChange={(preset) =>
                onCommand
                  ? onCommand({ op: "visual.set_aspect_ratio", preset })
                  : onChange(setAspectRatio(visual, preset))
              }
            />
          </div>
        </div>
        <div className="space-y-1">
          <SectionLabel>Canvas style</SectionLabel>
          <div className="overflow-x-auto">
            <SegmentedControl<CanvasStyle>
              aria-label="Canvas style"
              size="sm"
              options={CANVAS_STYLE_OPTIONS}
              value={visual.canvasStyle ?? "blank"}
              onChange={(cs) =>
                onCommand
                  ? onCommand({
                      op: "visual.set_canvas_style",
                      canvasStyle: cs,
                    })
                  : onChange(setCanvasStyle(visual, cs))
              }
            />
          </div>
        </div>
        {isPositionedKind(visual.type) ? (
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-[11px] text-[var(--ds-text-muted,#6f7d83)]">
              Auto layout
            </span>
            <Tooltip
              label={
                visual.autoLayout
                  ? "Auto layout on — canvas grows to fit labels"
                  : "Enable to auto-size nodes and grow canvas"
              }
            >
              <button
                type="button"
                role="switch"
                aria-checked={visual.autoLayout ?? false}
                aria-label="Toggle auto layout"
                onClick={() => {
                  const enabled = !(visual.autoLayout ?? false);
                  if (onCommand) {
                    onCommand({ op: "visual.set_auto_layout", enabled });
                  } else {
                    onChange(setAutoLayout(visual, enabled));
                  }
                }}
                className={cx(
                  "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-accent,#6366f1)] focus-visible:ring-offset-1",
                  visual.autoLayout
                    ? "bg-[var(--ds-accent,#6366f1)]"
                    : "bg-[var(--ds-border-strong,rgba(0,0,0,0.2))]",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                    visual.autoLayout ? "translate-x-4" : "translate-x-0",
                  )}
                />
              </button>
            </Tooltip>
          </div>
        ) : null}
      </div>
    );
  }

  function renderLayoutSection() {
    return (
      <div className="space-y-3 py-1">
        {/* Kind selector */}
        <div className="space-y-1.5">
          <SectionLabel>Visual type</SectionLabel>
          <div className="overflow-x-auto">
            <SegmentedControl<VisualKind>
              aria-label="Visual type"
              size="sm"
              options={KIND_OPTIONS}
              value={visual.type}
              onChange={(kind) =>
                onCommand
                  ? onCommand({ op: "visual.set_kind", kind })
                  : onChange(setVisualKind(visual, kind))
              }
            />
          </div>
        </div>

        <Divider orientation="horizontal" />

        {/* Style gallery */}
        <div className="space-y-1.5">
          <SectionLabel>Style</SectionLabel>
          <StyleGallery visual={visual} onSelect={applyDisplayStyleById} />
        </div>

        {/* Connectors — only when edges exist */}
        {visual.edges.length > 0 ? (
          <>
            <Divider orientation="horizontal" />
            <div className="space-y-2">
              <SectionLabel>Connectors</SectionLabel>
              <div className="space-y-1">
                <span className="text-[11px] text-[var(--ds-text-muted,#6f7d83)]">
                  Arrow style
                </span>
                <div className="overflow-x-auto">
                  <SegmentedControl<ArrowStyle>
                    aria-label="Arrow style"
                    size="sm"
                    options={ARROW_STYLE_OPTIONS}
                    value={visual.edges[0]?.arrowStyle ?? "filled"}
                    onChange={(v) =>
                      runVisualEdit(
                        {
                          op: "visual.set_all_edges_style",
                          patch: { arrowStyle: v },
                        },
                        () => setAllEdgesStyle(visual, { arrowStyle: v }),
                      )
                    }
                  />
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] text-[var(--ds-text-muted,#6f7d83)]">
                  Line style
                </span>
                <SegmentedControl<LineStyle>
                  aria-label="Line style"
                  size="sm"
                  options={LINE_STYLE_OPTIONS}
                  value={visual.edges[0]?.lineStyle ?? "solid"}
                  onChange={(v) =>
                    runVisualEdit(
                      {
                        op: "visual.set_all_edges_style",
                        patch: { lineStyle: v },
                      },
                      () => setAllEdgesStyle(visual, { lineStyle: v }),
                    )
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-[var(--ds-text-muted,#6f7d83)]">
                  Line width
                </span>
                <div className="flex items-center gap-1">
                  <IconButton
                    aria-label="Decrease line width"
                    size="sm"
                    variant="subtle"
                    disabled={
                      (visual.edges[0]?.lineWidth ?? 1.6) <= LINE_WIDTH_MIN
                    }
                    onClick={() => {
                      const nextWidth = Math.max(
                        LINE_WIDTH_MIN,
                        Math.round(
                          ((visual.edges[0]?.lineWidth ?? 1.6) - 0.5) * 2,
                        ) / 2,
                      );
                      runVisualEdit(
                        {
                          op: "visual.set_all_edges_style",
                          patch: { lineWidth: nextWidth },
                        },
                        () =>
                          setAllEdgesStyle(visual, { lineWidth: nextWidth }),
                      );
                    }}
                  >
                    <span aria-hidden="true">−</span>
                  </IconButton>
                  <span className="w-10 text-center tabular-nums text-[var(--ds-text-muted,#6f7d83)]">
                    {(visual.edges[0]?.lineWidth ?? 1.6).toFixed(1)}px
                  </span>
                  <IconButton
                    aria-label="Increase line width"
                    size="sm"
                    variant="subtle"
                    disabled={
                      (visual.edges[0]?.lineWidth ?? 1.6) >= LINE_WIDTH_MAX
                    }
                    onClick={() => {
                      const nextWidth = Math.min(
                        LINE_WIDTH_MAX,
                        Math.round(
                          ((visual.edges[0]?.lineWidth ?? 1.6) + 0.5) * 2,
                        ) / 2,
                      );
                      runVisualEdit(
                        {
                          op: "visual.set_all_edges_style",
                          patch: { lineWidth: nextWidth },
                        },
                        () =>
                          setAllEdgesStyle(visual, { lineWidth: nextWidth }),
                      );
                    }}
                  >
                    <span aria-hidden="true">+</span>
                  </IconButton>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  function renderBrandingSection() {
    return (
      <div className="py-1">
        {brandsStatus === "loading" ? (
          <p className="text-[11px] text-[var(--ds-text-muted)]">Loading…</p>
        ) : brands.length === 0 ? (
          <p className="text-[11px] text-[var(--ds-text-muted)]">
            No brands yet.{" "}
            <a
              href="/app/brands"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[var(--ds-accent)]"
            >
              Create one in Brand Studio
            </a>
            .
          </p>
        ) : (
          <div
            role="group"
            aria-label="Brand styles"
            className="grid grid-cols-3 gap-1.5"
          >
            {brands.map((brand) => (
              <BrandChip
                key={brand.id}
                brand={brand}
                active={false}
                onApply={() => applyBrandToThis(brand)}
                onApplyAll={() => onApplyBrandToAll?.(brand)}
              />
            ))}
          </div>
        )}
        <a
          href="/app/brands"
          target="_blank"
          rel="noopener noreferrer"
          className={cx(
            "mt-3 block rounded-[var(--ds-radius-sm)] px-1 py-0.5 text-[10px] font-medium text-[var(--ds-text-muted)] underline-offset-2 hover:text-[var(--ds-accent)] hover:underline",
            FOCUS_RING,
          )}
        >
          Manage brands →
        </a>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const visibleMenuItems = componentContext ? COMPONENT_MENU_ITEMS : MENU_ITEMS;
  const popoverWidth = componentContext
    ? effectiveActiveSection
      ? COMPONENT_POPOVER_WIDTH
      : "max-content"
    : POPOVER_WIDTH;
  const contentClassName =
    mode === "panel" ? "overflow-y-auto p-3" : componentContext ? "p-1" : "p-2";
  const sectionContent = (
    <>
      {effectiveActiveSection === "export" && (
        <VisualExportPanel visual={visual} getSvgElement={getSvgElement} />
      )}
      {effectiveActiveSection === "effects" && renderEffectsSection()}
      {effectiveActiveSection === "colors" && renderColorsSection()}
      {effectiveActiveSection === "fonts" && renderFontsSection()}
      {effectiveActiveSection === "icon" && renderIconSection()}
      {effectiveActiveSection === "size" && renderSizeSection()}
      {effectiveActiveSection === "layout" && renderLayoutSection()}
      {effectiveActiveSection === "branding" && renderBrandingSection()}
      {effectiveActiveSection === "sync" && (
        <VisualSyncPanel
          visual={visual}
          currentSourceText={currentSourceText}
          stale={stale}
          syncStatus={syncStatus}
          syncError={syncError}
          onSync={() => void runSync()}
        />
      )}
      {effectiveActiveSection === "info" && (
        <VisualInfoPanel visual={visual} stale={stale} />
      )}
      {effectiveActiveSection === "variations" && (
        <VisualVariationsPanel
          candidates={candidates}
          genStatus={genStatus}
          genError={genError}
          creditError={genCreditError}
          onGenerate={() => void runGenerate()}
          onChooseCandidate={chooseCandidate}
        />
      )}
    </>
  );

  return (
    <PopoverShell
      mode={mode}
      coords={coords}
      onClose={onClose}
      width={popoverWidth}
      freezePosition={popoverExpanded}
    >
      <div ref={measureRef} data-visual-chrome className={contentClassName}>
        {componentContext ? (
          <div className="flex items-start gap-1.5">
            <div
              ref={toolbarRef}
              role="toolbar"
              aria-label="Element tools"
              aria-orientation="vertical"
              className="flex w-max flex-col items-center gap-0.5"
            >
              {visibleMenuItems.map((item) => {
                const active = effectiveActiveSection === item.id;
                return (
                  <ToolbarMenuItemButton
                    key={item.id}
                    item={item}
                    active={active}
                    onToggle={() => setActiveSection(active ? null : item.id)}
                  />
                );
              })}
              <Divider orientation="horizontal" className="my-0.5 w-6" />
              <Tooltip label="Reset element style">
                <IconButton
                  aria-label="Reset element style"
                  size="sm"
                  onClick={() => {
                    if (!selectedNode) return;
                    if (onCommand) {
                      const coalesceKey = `reset-node:${selectedNode.id}`;
                      onCommand(
                        {
                          op: "visual.reset_node_style",
                          nodeId: selectedNode.id,
                        },
                        coalesceKey,
                      );
                      onCommand(
                        {
                          op: "visual.reset_node_ext_style",
                          nodeId: selectedNode.id,
                        },
                        coalesceKey,
                      );
                    } else {
                      const r1 = resetNodeStyle(visual, selectedNode.id);
                      onChange(resetNodeExtStyle(r1, selectedNode.id));
                    }
                  }}
                >
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                </IconButton>
              </Tooltip>
              {onRemoveSelectedNode ? (
                <Tooltip label="Delete element">
                  <IconButton
                    aria-label="Delete element"
                    size="sm"
                    variant="danger"
                    onClick={onRemoveSelectedNode}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </IconButton>
                </Tooltip>
              ) : null}
            </div>

            {effectiveActiveSection !== null ? (
              <>
                <Divider
                  orientation="vertical"
                  className="mx-0 h-auto self-stretch"
                />
                <div className="max-h-[22rem] min-w-0 flex-1 overflow-y-auto pr-1">
                  {sectionContent}
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <>
            {/* ── One-line toolbox: every tool as an icon; clicking loads its config below ── */}
            <div
              ref={toolbarRef}
              role="toolbar"
              aria-label="Visual tools"
              className="flex items-center gap-0.5"
            >
              {visibleMenuItems.map((item) => {
                const active = effectiveActiveSection === item.id;
                return (
                  <ToolbarMenuItemButton
                    key={item.id}
                    item={item}
                    active={active}
                    showSourceChangedIndicator={item.id === "sync" && stale}
                    onToggle={() => setActiveSection(active ? null : item.id)}
                  />
                );
              })}

              <Tooltip label="AI Variations">
                <IconButton
                  aria-label="Generate AI variations"
                  size="sm"
                  active={effectiveActiveSection === "variations"}
                  onClick={() => void runGenerate()}
                  disabled={genStatus === "loading"}
                >
                  <Sparkles
                    aria-hidden="true"
                    className={cx(
                      "h-4 w-4",
                      genStatus === "loading" ? "animate-pulse" : "",
                    )}
                  />
                </IconButton>
              </Tooltip>

              <span
                className="mx-0.5 h-5 w-px shrink-0 bg-[var(--ds-border-subtle,rgba(0,0,0,0.1))]"
                aria-hidden="true"
              />

              {onDuplicate ? (
                <Tooltip label="Duplicate visual">
                  <IconButton
                    aria-label="Duplicate visual"
                    size="sm"
                    onClick={onDuplicate}
                  >
                    <Copy aria-hidden="true" className="h-4 w-4" />
                  </IconButton>
                </Tooltip>
              ) : null}
              <Tooltip label="Remove visual">
                <IconButton
                  aria-label="Remove visual"
                  size="sm"
                  variant="danger"
                  onClick={onRemove}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </IconButton>
              </Tooltip>
            </div>

            {/* ── Config: dynamically loaded below the toolbar ── */}
            {effectiveActiveSection !== null ? (
              <div className="mt-2 max-h-[26rem] overflow-y-auto">
                <Divider orientation="horizontal" />
                <div className="mt-2">{sectionContent}</div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </PopoverShell>
  );
}
