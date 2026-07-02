"use client";

import type { JSX } from "react";

import type {
  DeckChromeConfig,
  DeckChromeKind,
  SlideDeckChromeOverrides,
  SlideProps,
} from "@/lib/presentation/schema";
import {
  EditorActionButton,
  EditorField,
  editorColorControlClass,
  editorControlClass,
  parseEditorNumberInput,
} from "./editor-primitives";

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
        <select
          value={stringField(value, "placement", "top-right")}
          onChange={(event) =>
            onPatch({
              placement: event.currentTarget.value as NonNullable<
                DeckChromeConfig["logo"]
              >["placement"],
            })
          }
          className={editorControlClass()}
        >
          <option value="top-left">Top left</option>
          <option value="top-right">Top right</option>
          <option value="bottom-left">Bottom left</option>
          <option value="bottom-right">Bottom right</option>
        </select>
        <select
          value={stringField(value, "size", "medium")}
          onChange={(event) =>
            onPatch({
              size: event.currentTarget.value as NonNullable<
                DeckChromeConfig["logo"]
              >["size"],
            })
          }
          className={editorControlClass()}
        >
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
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
        <select
          value={stringField(value, "align", "center")}
          onChange={(event) =>
            onPatch({
              align: event.currentTarget.value as NonNullable<
                DeckChromeConfig["footer"]
              >["align"],
            })
          }
          className={editorControlClass()}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>
    );
  }

  if (kind === "pageNumber") {
    return (
      <div className="col-span-2 ml-2 grid grid-cols-2 gap-2 border-l border-ds-border-subtle pl-2">
        {enabledControl}
        <select
          value={stringField(value, "format", "number")}
          onChange={(event) =>
            onPatch({
              format: event.currentTarget.value as NonNullable<
                DeckChromeConfig["pageNumber"]
              >["format"],
            })
          }
          className={editorControlClass()}
        >
          <option value="number">1</option>
          <option value="number-total">1 / total</option>
        </select>
        <select
          value={stringField(value, "placement", "bottom-right")}
          onChange={(event) =>
            onPatch({
              placement: event.currentTarget.value as NonNullable<
                DeckChromeConfig["pageNumber"]
              >["placement"],
            })
          }
          className={editorControlClass()}
        >
          <option value="bottom-left">Bottom left</option>
          <option value="bottom-center">Bottom center</option>
          <option value="bottom-right">Bottom right</option>
        </select>
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
        <select
          value={stringField(value, "layoutMode", "diagonal")}
          onChange={(event) =>
            onPatch({
              layoutMode: event.currentTarget.value as NonNullable<
                DeckChromeConfig["watermark"]
              >["layoutMode"],
            })
          }
          className={editorControlClass()}
        >
          <option value="center">Center</option>
          <option value="diagonal">Diagonal</option>
        </select>
        <select
          value={stringField(value, "size", "medium")}
          onChange={(event) =>
            onPatch({
              size: event.currentTarget.value as NonNullable<
                DeckChromeConfig["watermark"]
              >["size"],
            })
          }
          className={editorControlClass()}
        >
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
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
            Deck chrome defaults
          </h4>
          <p className="text-[11px] text-ds-text-muted">
            Owned by deck settings; selected-slide overrides are below.
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
          <EditorField id={idFor("logo-placement")} label="Logo placement">
            <select
              id={idFor("logo-placement")}
              value={chrome?.logo?.placement ?? "top-right"}
              onChange={(event) =>
                onUpdateChrome({
                  logo: {
                    ...(chrome?.logo ?? {}),
                    placement: event.currentTarget.value as NonNullable<
                      DeckChromeConfig["logo"]
                    >["placement"],
                  },
                })
              }
              className={editorControlClass()}
            >
              <option value="top-left">Top left</option>
              <option value="top-right">Top right</option>
              <option value="bottom-left">Bottom left</option>
              <option value="bottom-right">Bottom right</option>
            </select>
          </EditorField>
          <EditorField id={idFor("logo-size")} label="Logo size">
            <select
              id={idFor("logo-size")}
              value={chrome?.logo?.size ?? "medium"}
              onChange={(event) =>
                onUpdateChrome({
                  logo: {
                    ...(chrome?.logo ?? {}),
                    size: event.currentTarget.value as NonNullable<
                      DeckChromeConfig["logo"]
                    >["size"],
                  },
                })
              }
              className={editorControlClass()}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </EditorField>
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
      <select
        value={chrome?.footer?.align ?? "center"}
        onChange={(event) =>
          onUpdateChrome({
            footer: {
              ...(chrome?.footer ?? {}),
              align: event.currentTarget.value as NonNullable<
                DeckChromeConfig["footer"]
              >["align"],
            },
          })
        }
        className={editorControlClass()}
      >
        <option value="left">Footer left</option>
        <option value="center">Footer centered</option>
        <option value="right">Footer right</option>
      </select>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Deck default page number
          <select
            value={isConfigured(chrome?.pageNumber) ? "on" : "off"}
            onChange={(event) =>
              onUpdateChrome({
                pageNumber: {
                  ...(chrome?.pageNumber ?? {}),
                  enabled: event.currentTarget.value === "on",
                },
              })
            }
            className={editorControlClass()}
          >
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Format
          <select
            value={chrome?.pageNumber?.format ?? "number"}
            onChange={(event) =>
              onUpdateChrome({
                pageNumber: {
                  ...(chrome?.pageNumber ?? {}),
                  format: event.currentTarget.value as NonNullable<
                    DeckChromeConfig["pageNumber"]
                  >["format"],
                },
              })
            }
            className={editorControlClass()}
          >
            <option value="number">1</option>
            <option value="number-total">1 / total</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Placement
          <select
            value={chrome?.pageNumber?.placement ?? "bottom-right"}
            onChange={(event) =>
              onUpdateChrome({
                pageNumber: {
                  ...(chrome?.pageNumber ?? {}),
                  placement: event.currentTarget.value as NonNullable<
                    DeckChromeConfig["pageNumber"]
                  >["placement"],
                },
              })
            }
            className={editorControlClass()}
          >
            <option value="bottom-left">Bottom left</option>
            <option value="bottom-center">Bottom center</option>
            <option value="bottom-right">Bottom right</option>
          </select>
        </label>
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
        <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Watermark layout
          <select
            value={chrome?.watermark?.layoutMode ?? "diagonal"}
            onChange={(event) =>
              onUpdateChrome({
                watermark: {
                  ...(chrome?.watermark ?? {}),
                  layoutMode: event.currentTarget.value as NonNullable<
                    DeckChromeConfig["watermark"]
                  >["layoutMode"],
                },
              })
            }
            className={editorControlClass()}
          >
            <option value="center">Center</option>
            <option value="diagonal">Diagonal</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Watermark size
          <select
            value={chrome?.watermark?.size ?? "medium"}
            onChange={(event) =>
              onUpdateChrome({
                watermark: {
                  ...(chrome?.watermark ?? {}),
                  size: event.currentTarget.value as NonNullable<
                    DeckChromeConfig["watermark"]
                  >["size"],
                },
              })
            }
            className={editorControlClass()}
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Deck default border
          <select
            value={isConfigured(chrome?.border) ? "on" : "off"}
            onChange={(event) =>
              onUpdateChrome({
                border: {
                  ...(chrome?.border ?? {}),
                  enabled: event.currentTarget.value === "on",
                },
              })
            }
            className={editorControlClass()}
          >
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </label>
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
        <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
          Deck default safe area
          <select
            value={isConfigured(chrome?.safeArea) ? "on" : "off"}
            onChange={(event) =>
              onUpdateChrome({
                safeArea: {
                  ...(chrome?.safeArea ?? {}),
                  enabled: event.currentTarget.value === "on",
                },
              })
            }
            className={editorControlClass()}
          >
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </label>
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
        return (
          <div
            key={kind}
            className="grid grid-cols-[1fr_auto] items-center gap-2 text-xs text-ds-text-secondary"
          >
            <label htmlFor={idFor(`override-${kind}`)}>{LABELS[kind]}</label>
            <select
              id={idFor(`override-${kind}`)}
              value={mode}
              onChange={(event) =>
                onUpdateSlideProps({
                  deckChrome: nextOverrides(
                    deckChromeOverrides,
                    kind,
                    event.currentTarget.value as ChromeOverrideMode,
                    chrome?.[kind],
                  ),
                })
              }
              className={editorControlClass("w-32")}
            >
              <option value="inherit">Use deck default</option>
              <option value="disabled">Disable on slide</option>
              <option value="override">Override on slide</option>
              {mode === "detached" ? (
                <option value="detached">Detached local copy</option>
              ) : null}
            </select>
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
