"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";

import { Popover } from "@/components/ui/popover";
import { cx, FOCUS_RING } from "@/components/ui/tokens";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";

const VISIBLE_THEME_LIMIT = 24;

type ThemeFilter = "all" | "recent" | "editorial" | "dark" | "contrast";

const THEME_FILTERS: readonly { id: ThemeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "recent", label: "Recent" },
  { id: "editorial", label: "Editorial" },
  { id: "dark", label: "Dark" },
  { id: "contrast", label: "High contrast" },
];

type ThemePreviewStyle = CSSProperties & {
  "--theme-canvas": string;
  "--theme-text": string;
  "--theme-muted": string;
  "--theme-surface": string;
  "--theme-accent": string;
};

export interface ThemePreviewPickerProps {
  value: string;
  themes: readonly ThemePackageV1[];
  onChange: (packageId: string) => void;
  onOpenChange?: (open: boolean) => void;
  "aria-label": string;
}

function themePreviewStyle(themePackage: ThemePackageV1): ThemePreviewStyle {
  const colors = themePackage.tokens.colors;
  return {
    "--theme-canvas": colors.canvas.fill,
    "--theme-text": colors.canvas.text,
    "--theme-muted": colors.canvas.mutedText,
    "--theme-surface": colors.surface.fill,
    "--theme-accent": colors.accent.fill,
  };
}

function hexChannel(value: string, start: number): number | null {
  const parsed = Number.parseInt(value.slice(start, start + 2), 16);
  return Number.isFinite(parsed) ? parsed : null;
}

function hexLuminance(value: string): number | null {
  const normalized = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const channels = [
    hexChannel(normalized, 1),
    hexChannel(normalized, 3),
    hexChannel(normalized, 5),
  ];
  if (channels.some((channel) => channel === null)) return null;
  const [red, green, blue] = channels.map((channel) => {
    const scaled = (channel ?? 0) / 255;
    return scaled <= 0.03928
      ? scaled / 12.92
      : Math.pow((scaled + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number | null {
  const firstLuminance = hexLuminance(first);
  const secondLuminance = hexLuminance(second);
  if (firstLuminance === null || secondLuminance === null) return null;
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function isDarkTheme(themePackage: ThemePackageV1): boolean {
  const luminance = hexLuminance(themePackage.tokens.colors.canvas.fill);
  return luminance !== null && luminance < 0.22;
}

function isHighContrastTheme(themePackage: ThemePackageV1): boolean {
  const ratio = contrastRatio(
    themePackage.tokens.colors.canvas.fill,
    themePackage.tokens.colors.canvas.text,
  );
  return ratio !== null && ratio >= 7;
}

function searchableThemeText(themePackage: ThemePackageV1): string {
  return [
    themePackage.id,
    themePackage.name,
    themePackage.tagline,
    themePackage.tokens.fonts.heading,
    themePackage.tokens.fonts.body,
    themePackage.tokens.colors.canvas.fill,
    themePackage.tokens.colors.accent.fill,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function themeMatchesFilter(
  themePackage: ThemePackageV1,
  filter: ThemeFilter,
  recentIds: ReadonlySet<string>,
): boolean {
  if (filter === "all") return true;
  if (filter === "recent") return recentIds.has(themePackage.id);
  if (filter === "dark") return isDarkTheme(themePackage);
  if (filter === "contrast") return isHighContrastTheme(themePackage);
  const haystack = searchableThemeText(themePackage);
  return (
    haystack.includes("editorial") ||
    haystack.includes("serif") ||
    haystack.includes("magazine") ||
    haystack.includes("luxe")
  );
}

function themeKindLabel(
  themePackage: ThemePackageV1,
  selected: boolean,
): string {
  if (selected) return "current";
  if (isDarkTheme(themePackage)) return "dark";
  if (isHighContrastTheme(themePackage)) return "AA+";
  return themePackage.tagline ? "theme" : "built-in";
}

export function ThemePreviewPicker({
  value,
  themes,
  onChange,
  onOpenChange,
  "aria-label": ariaLabel,
}: ThemePreviewPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ThemeFilter>("all");
  const selectedTheme =
    themes.find((themePackage) => themePackage.id === value) ?? themes[0];
  const recentIds = useMemo(
    () => new Set([value, ...themes.slice(0, 5).map((theme) => theme.id)]),
    [themes, value],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const matchingThemes = useMemo(
    () =>
      themes.filter(
        (themePackage) =>
          themeMatchesFilter(themePackage, filter, recentIds) &&
          (normalizedQuery.length === 0 ||
            searchableThemeText(themePackage).includes(normalizedQuery)),
      ),
    [filter, normalizedQuery, recentIds, themes],
  );
  const visibleThemes = matchingThemes.slice(0, VISIBLE_THEME_LIMIT);

  const setPickerOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const closePicker = () => setPickerOpen(false);

  const selectTheme = (packageId: string) => {
    onChange(packageId);
    closePicker();
  };

  return (
    <Popover
      open={open}
      onClose={closePicker}
      aria-label="Theme picker"
      portal
      align="start"
      className="w-[min(460px,calc(100vw-1rem))] overflow-hidden p-0"
      trigger={
        <button
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setPickerOpen(!open)}
          className={cx(
            "inline-flex h-7 max-w-44 items-center gap-1.5 rounded-ds-sm px-2 text-xs font-medium text-ds-text-primary outline-none transition-colors hover:bg-ds-state-hover",
            open ? "bg-ds-state-active" : undefined,
          )}
        >
          <span className="min-w-0 truncate">
            {selectedTheme?.name ?? "Theme"}
          </span>
          <ChevronDown
            size={13}
            aria-hidden="true"
            className="shrink-0 text-ds-text-muted"
          />
        </button>
      }
    >
      <div className="border-b border-ds-border-subtle p-3">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <label className="relative min-w-0">
            <span className="sr-only">Search themes</span>
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ds-text-muted"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={`Search ${themes.length} themes by name, style, color, or owner`}
              className={cx(
                "h-8 w-full rounded-ds-md border border-ds-border-subtle bg-ds-surface pl-8 pr-2 text-xs text-ds-text-primary placeholder:text-ds-text-muted outline-none",
                FOCUS_RING,
              )}
            />
          </label>
          <span className="self-center whitespace-nowrap text-[11px] text-ds-text-muted">
            {visibleThemes.length} visible · {matchingThemes.length} matched ·{" "}
            {themes.length} total
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {THEME_FILTERS.map((themeFilter) => (
            <button
              key={themeFilter.id}
              type="button"
              onClick={() => setFilter(themeFilter.id)}
              className={cx(
                "rounded-ds-pill border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                filter === themeFilter.id
                  ? "border-ds-accent-border bg-ds-accent-surface text-ds-accent-text"
                  : "border-ds-border-subtle bg-ds-surface text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary",
                FOCUS_RING,
              )}
            >
              {themeFilter.label}
            </button>
          ))}
        </div>
      </div>

      <div
        role="listbox"
        aria-label="Presentation themes"
        className="grid max-h-[min(420px,calc(100vh-12rem))] grid-cols-1 gap-2 overflow-y-auto p-3 sm:grid-cols-2"
      >
        {visibleThemes.length === 0 ? (
          <p className="col-span-full rounded-ds-md border border-dashed border-ds-border-subtle p-4 text-center text-xs text-ds-text-muted">
            No themes match your search.
          </p>
        ) : (
          visibleThemes.map((themePackage) => {
            const selected = themePackage.id === value;
            const colors = themePackage.tokens.colors;
            return (
              <button
                key={themePackage.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => selectTheme(themePackage.id)}
                className={cx(
                  "min-w-0 rounded-ds-lg border bg-ds-surface p-2 text-left transition-colors hover:bg-ds-state-hover",
                  selected
                    ? "border-ds-accent-border bg-ds-accent-subtle"
                    : "border-ds-border-subtle",
                  FOCUS_RING,
                )}
              >
                <div
                  className="overflow-hidden rounded-ds-md border border-ds-border-subtle p-1.5"
                  style={themePreviewStyle(themePackage)}
                >
                  <div className="h-16 bg-[var(--theme-canvas)] text-[var(--theme-text)]">
                    <div className="h-2.5 w-3/5 rounded-ds-pill bg-[var(--theme-text)]" />
                    <div className="mt-1.5 h-1 w-5/6 rounded-ds-pill bg-[var(--theme-muted)]" />
                    <div className="mt-2.5 grid grid-cols-3 gap-1">
                      <span className="h-5 rounded-ds-sm bg-[var(--theme-accent)]" />
                      <span className="h-5 rounded-ds-sm bg-[var(--theme-surface)] opacity-80" />
                      <span className="h-5 rounded-ds-sm bg-[var(--theme-accent)] opacity-35" />
                    </div>
                  </div>
                </div>
                <span className="mt-2 flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-bold text-ds-text-primary">
                    {themePackage.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-ds-text-muted">
                    {themeKindLabel(themePackage, selected)}
                  </span>
                </span>
                <span className="mt-1 flex items-center gap-1">
                  <i
                    aria-hidden="true"
                    className="h-3.5 w-3.5 rounded-full border border-ds-border-subtle"
                    style={{ background: colors.canvas.text }}
                  />
                  <i
                    aria-hidden="true"
                    className="h-3.5 w-3.5 rounded-full border border-ds-border-subtle"
                    style={{ background: colors.canvas.fill }}
                  />
                  <i
                    aria-hidden="true"
                    className="h-3.5 w-3.5 rounded-full border border-ds-border-subtle"
                    style={{ background: colors.accent.fill }}
                  />
                  {selected ? (
                    <Check
                      size={13}
                      aria-hidden="true"
                      className="ml-auto text-ds-accent"
                    />
                  ) : null}
                </span>
              </button>
            );
          })
        )}
      </div>
    </Popover>
  );
}
