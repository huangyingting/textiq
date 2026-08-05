"use client";

import type { JSX } from "react";

import type {
  DeckChromeConfig,
  DeckChromeKind,
  SlideDeckChromeOverrides,
  SlideProps,
} from "@/lib/presentation/schema";
import { SelectMenu, type SelectMenuOption } from "@/components/ui/select-menu";
import {
  EditorActionButton,
  EditorField,
  editorColorControlClass,
  editorControlClass,
  parseEditorNumberInput,
} from "./editor-primitives";

const LOGO_PLACEMENT_OPTIONS: readonly SelectMenuOption[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
];

const CHROME_SIZE_OPTIONS: readonly SelectMenuOption[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

const OVERRIDE_ALIGN_OPTIONS: readonly SelectMenuOption[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

const FOOTER_ALIGN_OPTIONS: readonly SelectMenuOption[] = [
  { value: "left", label: "Footer left" },
  { value: "center", label: "Footer centered" },
  { value: "right", label: "Footer right" },
];

const PAGE_NUMBER_FORMAT_OPTIONS: readonly SelectMenuOption[] = [
  { value: "number", label: "1" },
  { value: "number-total", label: "1 / total" },
];

const PAGE_NUMBER_PLACEMENT_OPTIONS: readonly SelectMenuOption[] = [
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right", label: "Bottom right" },
];

const WATERMARK_LAYOUT_OPTIONS: readonly SelectMenuOption[] = [
  { value: "center", label: "Center" },
  { value: "diagonal", label: "Diagonal" },
];

const ON_OFF_OPTIONS: readonly SelectMenuOption[] = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
];

const CHROME_KINDS: DeckChromeKind[] = [
  "logo",
  "footer",
  "pageNumber",
  "watermark",
  "border",
  "safeArea",
];

const LABELS: Record<DeckChromeKind, string> = {
  logo: "Logo",
  footer: "Footer",
  pageNumber: "Page number",
  watermark: "Watermark",
  border: "Border",
  safeArea: "Safe area",
};

type ChromeOverrideMode = "inherit" | "disabled" | "detached" | "override";
type ChromeValuePatch = Partial<NonNullable<DeckChromeConfig[DeckChromeKind]>>;

export interface DeckChromePanelProps {
  chrome?: DeckChromeConfig;
  slideProps?: SlideProps;
  idPrefix?: string;
  onUpdateChrome: (patch: Partial<DeckChromeConfig>) => void;
  onUpdateSlideProps: (patch: Partial<SlideProps>) => void;
}

function nextOverrides(
  current: SlideDeckChromeOverrides | undefined,
  kind: DeckChromeKind,
  mode: ChromeOverrideMode,
  inheritedValue?: ChromeValuePatch,
): SlideDeckChromeOverrides {
  const existing = current?.[kind];
  const existingValue = existing?.mode === "override" ? existing.value : {};
  return {
    ...(current ?? {}),
    [kind]:
      mode === "override"
        ? { mode, value: { ...(inheritedValue ?? {}), ...existingValue } }
        : mode === "detached"
          ? { mode }
          : { mode },
  };
}

function updateOverrideValue(
  current: SlideDeckChromeOverrides | undefined,
  kind: DeckChromeKind,
  patch: ChromeValuePatch,
): SlideDeckChromeOverrides {
  const existing = current?.[kind];
  const existingValue = existing?.mode === "override" ? existing.value : {};
  return {
    ...(current ?? {}),
    [kind]: { mode: "override", value: { ...existingValue, ...patch } },
  };
}

function valueRecord(value: ChromeValuePatch): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function stringField(value: ChromeValuePatch, key: string, fallback = "") {
  const candidate = valueRecord(value)[key];
  return typeof candidate === "string" ? candidate : fallback;
}

function numberField(value: ChromeValuePatch, key: string, fallback: number) {
  const candidate = valueRecord(value)[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : fallback;
}

function enabledField(value: ChromeValuePatch) {
  const candidate = valueRecord(value).enabled;
  return typeof candidate === "boolean" ? candidate : true;
}

function isConfigured(item: { enabled?: boolean } | undefined): boolean {
  return item !== undefined && item.enabled !== false;
}

function renderOverrideFields(
  kind: DeckChromeKind,
  value: ChromeValuePatch,
  onPatch: (patch: ChromeValuePatch) => void,
): JSX.Element {
  const enabledControl = (
    <label className="grid grid-cols-[auto_1fr] items-center gap-2 text-[11px] text-ds-text-secondary">
      <input
        type="checkbox"
        checked={enabledField(value)}
        onChange={(event) => onPatch({ enabled: event.currentTarget.checked })}
      />
      Enabled in this slide override
    </label>
  );

  if (kind === "logo") {
    return (
      <div className="col-span-2 ml-2 grid grid-cols-2 gap-2 border-l border-ds-border-subtle pl-2">
        {enabledControl}
        <input
          value={stringField(value, "assetId")}
          placeholder="Logo asset id"
          onChange={(event) => onPatch({ assetId: event.currentTarget.value })}
          className={editorControlClass("col-span-2 font-mono")}
        />
        <SelectMenu
          aria-label="Logo placement"
          variant="field"
          value={stringField(value, "placement", "top-right")}
          options={LOGO_PLACEMENT_OPTIONS}
          onChange={(next) =>
            onPatch({
              placement: next as NonNullable<
                DeckChromeConfig["logo"]
              >["placement"],
            })
          }
        />
        <SelectMenu
          aria-label="Logo size"
          variant="field"
          value={stringField(value, "size", "medium")}
          options={CHROME_SIZE_OPTIONS}
          onChange={(next) =>
            onPatch({
              size: next as NonNullable<DeckChromeConfig["logo"]>["size"],
            })
          }
        />
      </div>
    );
  }

  if (kind === "footer") {
    return (
      <div className="col-span-2 ml-2 grid grid-cols-2 gap-2 border-l border-ds-border-subtle pl-2">
        {enabledControl}
        <input
          value={stringField(value, "text")}
          placeholder="Footer text"
          onChange={(event) => onPatch({ text: event.currentTarget.value })}
          className={editorControlClass("col-span-2")}
        />
        <SelectMenu
          aria-label="Footer align"
          variant="field"
          value={stringField(value, "align", "center")}
          options={OVERRIDE_ALIGN_OPTIONS}
          onChange={(next) =>
            onPatch({
              align: next as NonNullable<DeckChromeConfig["footer"]>["align"],
            })
          }
        />
      </div>
    );
  }

  if (kind === "pageNumber") {
    return (
      <div className="col-span-2 ml-2 grid grid-cols-2 gap-2 border-l border-ds-border-subtle pl-2">
        {enabledControl}
        <SelectMenu
          aria-label="Page number format"
          variant="field"
          value={stringField(value, "format", "number")}
          options={PAGE_NUMBER_FORMAT_OPTIONS}
          onChange={(next) =>
            onPatch({
              format: next as NonNullable<
                DeckChromeConfig["pageNumber"]
              >["format"],
            })
          }
        />
        <SelectMenu
          aria-label="Page number placement"
          variant="field"
          value={stringField(value, "placement", "bottom-right")}
          options={PAGE_NUMBER_PLACEMENT_OPTIONS}
          onChange={(next) =>
            onPatch({
              placement: next as NonNullable<
                DeckChromeConfig["pageNumber"]
              >["placement"],
            })
          }
        />
      </div>
    );
  }

  if (kind === "watermark") {
    return (
      <div className="col-span-2 ml-2 grid grid-cols-2 gap-2 border-l border-ds-border-subtle pl-2">
        {enabledControl}
        <input
          value={stringField(value, "text")}
          placeholder="Watermark text"
          onChange={(event) => onPatch({ text: event.currentTarget.value })}
          className={editorControlClass("col-span-2")}
        />
        <SelectMenu
          aria-label="Watermark layout"
          variant="field"
          value={stringField(value, "layoutMode", "diagonal")}
          options={WATERMARK_LAYOUT_OPTIONS}
          onChange={(next) =>
            onPatch({
              layoutMode: next as NonNullable<
                DeckChromeConfig["watermark"]
              >["layoutMode"],
            })
          }
        />
        <SelectMenu
          aria-label="Watermark size"
          variant="field"
          value={stringField(value, "size", "medium")}
          options={CHROME_SIZE_OPTIONS}
          onChange={(next) =>
            onPatch({
              size: next as NonNullable<DeckChromeConfig["watermark"]>["size"],
            })
          }
        />
      </div>
    );
  }

  return (
    <div className="col-span-2 ml-2 grid grid-cols-2 gap-2 border-l border-ds-border-subtle pl-2">
      {enabledControl}
      <input
        type="color"
        value={stringField(
          value,
          "color",
          kind === "border" ? "#cbd5e1" : "#94a3b8",
        )}
        onChange={(event) => onPatch({ color: event.currentTarget.value })}
        className={editorColorControlClass()}
      />
      <input
        type="number"
        min="0"
        step="0.25"
        value={numberField(value, "widthPt", kind === "border" ? 1 : 0.75)}
        onChange={(event) =>
          onPatch({
            widthPt: parseEditorNumberInput(event.currentTarget.value),
          })
        }
        className={editorControlClass()}
      />
    </div>
  );
}

export function DeckChromePanel({
  chrome,
  slideProps,
  idPrefix = "deck-chrome",
  onUpdateChrome,
  onUpdateSlideProps,
}: DeckChromePanelProps): JSX.Element {
  const deckChromeOverrides = slideProps?.deckChrome;
  const idFor = (suffix: string) => `${idPrefix}-${suffix}`;

  return (
    <section className="flex flex-col gap-3 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h4 className="text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
            Slide master defaults
          </h4>
          <p className="text-[11px] text-ds-text-muted">
            Logo, footer, page number, watermark, and other deck-wide defaults.
          </p>
        </div>
        <EditorActionButton
          action={{
            id: "reset-slide-chrome-overrides",
            label: "Reset slide overrides",
            description:
              "Remove chrome override state from the selected slide.",
          }}
          onClick={() => onUpdateSlideProps({ deckChrome: undefined })}
          className="shrink-0 text-[11px]"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="grid grid-cols-[auto_1fr] items-center gap-2 text-xs text-ds-text-secondary">
          <input
            type="checkbox"
            checked={isConfigured(chrome?.logo)}
            onChange={(event) =>
              onUpdateChrome({
                logo: {
                  ...(chrome?.logo ?? {}),
                  enabled: event.currentTarget.checked,
                },
              })
            }
          />
          Deck default logo
        </label>
        <EditorField
          id={idFor("logo-asset-id")}
          label="Logo asset id"
          description="Deck default shown unless a slide override replaces it."
        >
          <input
            id={idFor("logo-asset-id")}
            value={chrome?.logo?.assetId ?? ""}
            placeholder="Image asset id"
            onChange={(event) =>
              onUpdateChrome({
                logo: {
                  ...(chrome?.logo ?? {}),
                  assetId: event.currentTarget.value,
                },
              })
            }
            className={editorControlClass("font-mono")}
          />
        </EditorField>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            <span>Logo placement</span>
            <SelectMenu
              aria-label="Logo placement"
              variant="field"
              value={chrome?.logo?.placement ?? "top-right"}
              options={LOGO_PLACEMENT_OPTIONS}
              onChange={(next) =>
                onUpdateChrome({
                  logo: {
                    ...(chrome?.logo ?? {}),
                    placement: next as NonNullable<
                      DeckChromeConfig["logo"]
                    >["placement"],
                  },
                })
              }
            />
          </div>
          <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
            <span>Logo size</span>
            <SelectMenu
              aria-label="Logo size"
              variant="field"
              value={chrome?.logo?.size ?? "medium"}
              options={CHROME_SIZE_OPTIONS}
              onChange={(next) =>
                onUpdateChrome({
                  logo: {
                    ...(chrome?.logo ?? {}),
                    size: next as NonNullable<DeckChromeConfig["logo"]>["size"],
                  },
                })
              }
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[auto_1fr] items-center gap-2 text-xs text-ds-text-secondary">
        <input
          id={idFor("footer-enabled")}
          type="checkbox"
          checked={isConfigured(chrome?.footer)}
          onChange={(event) =>
            onUpdateChrome({
              footer: {
                ...(chrome?.footer ?? {}),
                enabled: event.currentTarget.checked,
              },
            })
          }
        />
        <label htmlFor={idFor("footer-enabled")}>Deck default footer</label>
      </div>
      <EditorField
        id={idFor("footer-text")}
        label="Footer text"
        description="Deck-level footer copied into slides that inherit chrome."
      >
        <input
          id={idFor("footer-text")}
          value={chrome?.footer?.text ?? ""}
          placeholder="Footer text"
          onChange={(event) =>
            onUpdateChrome({
              footer: {
                ...(chrome?.footer ?? {}),
                text: event.currentTarget.value,
              },
            })
          }
          className={editorControlClass()}
        />
      </EditorField>
      <SelectMenu
        aria-label="Footer align"
        variant="field"
        value={chrome?.footer?.align ?? "center"}
        options={FOOTER_ALIGN_OPTIONS}
        onChange={(next) =>
          onUpdateChrome({
            footer: {
              ...(chrome?.footer ?? {}),
              align: next as NonNullable<DeckChromeConfig["footer"]>["align"],
            },
          })
        }
      />

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Deck default page number
          <SelectMenu
            aria-label="Deck default page number"
            variant="field"
            value={isConfigured(chrome?.pageNumber) ? "on" : "off"}
            options={ON_OFF_OPTIONS}
            onChange={(next) =>
              onUpdateChrome({
                pageNumber: {
                  ...(chrome?.pageNumber ?? {}),
                  enabled: next === "on",
                },
              })
            }
          />
        </div>
        <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Format
          <SelectMenu
            aria-label="Format"
            variant="field"
            value={chrome?.pageNumber?.format ?? "number"}
            options={PAGE_NUMBER_FORMAT_OPTIONS}
            onChange={(next) =>
              onUpdateChrome({
                pageNumber: {
                  ...(chrome?.pageNumber ?? {}),
                  format: next as NonNullable<
                    DeckChromeConfig["pageNumber"]
                  >["format"],
                },
              })
            }
          />
        </div>
        <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Placement
          <SelectMenu
            aria-label="Placement"
            variant="field"
            value={chrome?.pageNumber?.placement ?? "bottom-right"}
            options={PAGE_NUMBER_PLACEMENT_OPTIONS}
            onChange={(next) =>
              onUpdateChrome({
                pageNumber: {
                  ...(chrome?.pageNumber ?? {}),
                  placement: next as NonNullable<
                    DeckChromeConfig["pageNumber"]
                  >["placement"],
                },
              })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-[auto_1fr] items-center gap-2 text-xs text-ds-text-secondary">
        <input
          id={idFor("watermark-enabled")}
          type="checkbox"
          checked={isConfigured(chrome?.watermark)}
          onChange={(event) =>
            onUpdateChrome({
              watermark: {
                ...(chrome?.watermark ?? {}),
                enabled: event.currentTarget.checked,
              },
            })
          }
        />
        <label htmlFor={idFor("watermark-enabled")}>
          Deck default watermark
        </label>
      </div>
      <EditorField
        id={idFor("watermark-text")}
        label="Watermark text"
        description="Deck-level watermark copied into slides that inherit chrome."
      >
        <input
          id={idFor("watermark-text")}
          value={chrome?.watermark?.text ?? ""}
          placeholder="Watermark text"
          onChange={(event) =>
            onUpdateChrome({
              watermark: {
                ...(chrome?.watermark ?? {}),
                text: event.currentTarget.value,
              },
            })
          }
          className={editorControlClass()}
        />
      </EditorField>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Watermark layout
          <SelectMenu
            aria-label="Watermark layout"
            variant="field"
            value={chrome?.watermark?.layoutMode ?? "diagonal"}
            options={WATERMARK_LAYOUT_OPTIONS}
            onChange={(next) =>
              onUpdateChrome({
                watermark: {
                  ...(chrome?.watermark ?? {}),
                  layoutMode: next as NonNullable<
                    DeckChromeConfig["watermark"]
                  >["layoutMode"],
                },
              })
            }
          />
        </div>
        <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Watermark size
          <SelectMenu
            aria-label="Watermark size"
            variant="field"
            value={chrome?.watermark?.size ?? "medium"}
            options={CHROME_SIZE_OPTIONS}
            onChange={(next) =>
              onUpdateChrome({
                watermark: {
                  ...(chrome?.watermark ?? {}),
                  size: next as NonNullable<
                    DeckChromeConfig["watermark"]
                  >["size"],
                },
              })
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Deck default border
          <SelectMenu
            aria-label="Deck default border"
            variant="field"
            value={isConfigured(chrome?.border) ? "on" : "off"}
            options={ON_OFF_OPTIONS}
            onChange={(next) =>
              onUpdateChrome({
                border: {
                  ...(chrome?.border ?? {}),
                  enabled: next === "on",
                },
              })
            }
          />
        </div>
        <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Border color
          <input
            type="color"
            value={chrome?.border?.color ?? "#cbd5e1"}
            onChange={(event) =>
              onUpdateChrome({
                border: {
                  ...(chrome?.border ?? {}),
                  color: event.currentTarget.value,
                },
              })
            }
            className={editorColorControlClass()}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Border width
          <input
            type="number"
            min="0"
            step="0.25"
            value={chrome?.border?.widthPt ?? 1}
            onChange={(event) =>
              onUpdateChrome({
                border: {
                  ...(chrome?.border ?? {}),
                  widthPt: parseEditorNumberInput(event.currentTarget.value),
                },
              })
            }
            className={editorControlClass()}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Deck default safe area
          <SelectMenu
            aria-label="Deck default safe area"
            variant="field"
            value={isConfigured(chrome?.safeArea) ? "on" : "off"}
            options={ON_OFF_OPTIONS}
            onChange={(next) =>
              onUpdateChrome({
                safeArea: {
                  ...(chrome?.safeArea ?? {}),
                  enabled: next === "on",
                },
              })
            }
          />
        </div>
        <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Safe area color
          <input
            type="color"
            value={chrome?.safeArea?.color ?? "#94a3b8"}
            onChange={(event) =>
              onUpdateChrome({
                safeArea: {
                  ...(chrome?.safeArea ?? {}),
                  color: event.currentTarget.value,
                },
              })
            }
            className={editorColorControlClass()}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Safe area width
          <input
            type="number"
            min="0"
            step="0.25"
            value={chrome?.safeArea?.widthPt ?? 0.75}
            onChange={(event) =>
              onUpdateChrome({
                safeArea: {
                  ...(chrome?.safeArea ?? {}),
                  widthPt: parseEditorNumberInput(event.currentTarget.value),
                },
              })
            }
            className={editorControlClass()}
          />
        </label>
      </div>

      <div className="my-1 h-px bg-ds-border-subtle" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <h5 className="text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
          Selected slide overrides
        </h5>
        <p className="text-[11px] text-ds-text-muted">
          These controls only affect the selected slide. Use deck default to
          inherit the settings above.
        </p>
      </div>
      {CHROME_KINDS.map((kind) => {
        const override = deckChromeOverrides?.[kind];
        const mode = override?.mode ?? "inherit";
        const overrideValue =
          override?.mode === "override" && override.value ? override.value : {};
        const modeOptions: SelectMenuOption[] = [
          { value: "inherit", label: "Use deck default" },
          { value: "disabled", label: "Disable on slide" },
          { value: "override", label: "Override on slide" },
          ...(mode === "detached"
            ? [{ value: "detached", label: "Detached local copy" }]
            : []),
        ];
        return (
          <div
            key={kind}
            className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs text-ds-text-secondary"
          >
            <label htmlFor={idFor(`override-${kind}`)}>{LABELS[kind]}</label>
            <SelectMenu
              aria-label={`${LABELS[kind]} override mode`}
              variant="field"
              buttonClassName="w-32"
              value={mode}
              options={modeOptions}
              onChange={(next) =>
                onUpdateSlideProps({
                  deckChrome: nextOverrides(
                    deckChromeOverrides,
                    kind,
                    next as ChromeOverrideMode,
                    chrome?.[kind],
                  ),
                })
              }
            />
            {mode === "override"
              ? renderOverrideFields(kind, overrideValue, (patch) =>
                  onUpdateSlideProps({
                    deckChrome: updateOverrideValue(
                      deckChromeOverrides,
                      kind,
                      patch,
                    ),
                  }),
                )
              : null}
          </div>
        );
      })}
    </section>
  );
}
