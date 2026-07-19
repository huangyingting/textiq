"use client";

import { useMemo, useState, type JSX } from "react";

import { Button } from "@/components/ui/button";
import { cx, FOCUS_RING } from "@/components/ui/tokens";
import type { BrandKitDraftV1 } from "@/lib/presentation/brand-kit/schema";
import type {
  BrandKitSavePort,
  SaveBrandKitDraftResult,
} from "@/lib/action-ports";

import {
  PALETTE_COLOR_FIELDS,
  TYPOGRAPHY_ROLE_FIELDS,
  createBrandKitAuthoringState,
  createDefaultBrandKitDraft,
  diagnosticsForPath,
  saveBrandKitAuthoringState,
  updateBrandKitDecoration,
  updateBrandKitIdentity,
  updateBrandKitLogo,
  updateBrandKitPaletteColor,
  updateBrandKitTypography,
  type BrandKitAssetField,
  type BrandKitAuthoringState,
  type BrandKitTypographyField,
} from "./brand-kit-authoring-controller";

export type BrandKitAuthoringPanelProps = {
  ownerId: string;
  initialDraft?: BrandKitDraftV1;
  saveBrandKitDraft?: BrandKitSavePort["saveBrandKitDraft"];
  onSaved?: (result: Extract<SaveBrandKitDraftResult, { ok: true }>) => void;
  onClose: () => void;
};

function readPathValue(draft: BrandKitDraftV1, path: string): string {
  const value = path
    .split(".")
    .reduce<unknown>(
      (cursor, key) => (cursor as Record<string, unknown>)?.[key],
      draft,
    );
  return typeof value === "string" ? value : "";
}

function fieldDiagnostics(
  state: BrandKitAuthoringState,
  path: string,
): JSX.Element | null {
  const diagnostics = diagnosticsForPath(state.compileResult.diagnostics, path);
  if (!diagnostics.length) return null;
  return (
    <ul className="mt-1 space-y-1 text-[11px] text-ds-danger">
      {diagnostics.map((diagnostic) => (
        <li key={`${diagnostic.code}:${diagnostic.message}`}>
          {diagnostic.message}
        </li>
      ))}
    </ul>
  );
}

function TextInput({
  label,
  value,
  onChange,
  diagnostics,
}: {
  label: string;
  value: string | number | undefined;
  onChange: (value: string) => void;
  diagnostics?: JSX.Element | null;
}): JSX.Element {
  return (
    <label className="block text-xs font-medium text-ds-text-secondary">
      {label}
      <input
        value={value ?? ""}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={cx(
          "mt-1 h-8 w-full rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-2 text-xs text-ds-text-primary",
          FOCUS_RING,
        )}
      />
      {diagnostics}
    </label>
  );
}

function ColorInput({
  label,
  value,
  onChange,
  diagnostics,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  diagnostics?: JSX.Element | null;
}): JSX.Element {
  const nativeColorValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <label className="block text-xs font-medium text-ds-text-secondary">
      {label}
      <span className="mt-1 flex items-center gap-2">
        <input
          type="color"
          value={nativeColorValue}
          onChange={(event) => onChange(event.currentTarget.value)}
          className={cx(
            "h-8 w-10 rounded-ds-sm border border-ds-border-subtle bg-ds-surface",
            FOCUS_RING,
          )}
          aria-label={`${label} color swatch`}
        />
        <input
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          className={cx(
            "h-8 min-w-0 flex-1 rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-2 font-mono text-xs text-ds-text-primary",
            FOCUS_RING,
          )}
          aria-label={`${label} hex color`}
        />
      </span>
      {diagnostics}
    </label>
  );
}

export function BrandKitAuthoringPanel({
  ownerId,
  initialDraft,
  saveBrandKitDraft,
  onSaved,
  onClose,
}: BrandKitAuthoringPanelProps): JSX.Element {
  const seedDraft = useMemo(
    () => initialDraft ?? createDefaultBrandKitDraft({ ownerId }),
    [initialDraft, ownerId],
  );
  const [state, setState] = useState(() =>
    createBrandKitAuthoringState(seedDraft),
  );
  const blockingErrors = state.compileResult.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  const compiledPackage = state.compileResult.ok
    ? state.compileResult.package
    : undefined;
  const saveError =
    state.saveResult && !state.saveResult.ok
      ? state.saveResult.diagnostics[0]?.message
      : undefined;

  async function handleSave() {
    if (!saveBrandKitDraft || !state.compileResult.ok) return;
    setState((current) => ({
      ...current,
      saving: true,
      saveResult: undefined,
    }));
    const nextState = await saveBrandKitAuthoringState(
      state,
      saveBrandKitDraft,
    );
    setState(nextState);
    if (nextState.saveResult?.ok) onSaved?.(nextState.saveResult);
  }

  return (
    <section
      aria-labelledby="brand-kit-authoring-title"
      className="flex max-h-full min-h-0 flex-col"
    >
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-ds-border-subtle px-4 py-3">
        <div>
          <h2
            id="brand-kit-authoring-title"
            className="text-sm font-semibold text-ds-text-primary"
          >
            Customize theme
          </h2>
          <p className="mt-1 text-xs text-ds-text-muted">
            Edit draft tokens, preview the compiler output, then save an
            immutable theme snapshot.
          </p>
        </div>
        <Button variant="plain" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section className="grid gap-3 rounded-ds-md border border-ds-border-subtle bg-ds-surface p-3 sm:grid-cols-3">
          <TextInput
            label="Name"
            value={state.draft.name}
            onChange={(value) =>
              setState((current) =>
                updateBrandKitIdentity(current, "name", value),
              )
            }
            diagnostics={fieldDiagnostics(state, "name")}
          />
          <TextInput
            label="Slug"
            value={state.draft.slug}
            onChange={(value) =>
              setState((current) =>
                updateBrandKitIdentity(current, "slug", value),
              )
            }
            diagnostics={fieldDiagnostics(state, "slug")}
          />
          <TextInput
            label="Version"
            value={state.draft.version}
            onChange={(value) =>
              setState((current) =>
                updateBrandKitIdentity(current, "version", value),
              )
            }
            diagnostics={fieldDiagnostics(state, "version")}
          />
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ds-text-muted">
            Palette roles
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PALETTE_COLOR_FIELDS.map((field) => (
              <ColorInput
                key={field.path}
                label={field.label}
                value={readPathValue(state.draft, field.path)}
                onChange={(value) =>
                  setState((current) =>
                    updateBrandKitPaletteColor(current, field.path, value),
                  )
                }
                diagnostics={fieldDiagnostics(state, field.path)}
              />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ds-text-muted">
            Typography roles
          </h3>
          <div className="space-y-2">
            {TYPOGRAPHY_ROLE_FIELDS.map(({ role, label }) => {
              const typography = state.draft.typography[role];
              const update =
                (field: BrandKitTypographyField) => (value: string) =>
                  setState((current) =>
                    updateBrandKitTypography(current, role, field, value),
                  );
              return (
                <div
                  key={role}
                  className="grid gap-2 rounded-ds-md border border-ds-border-subtle bg-ds-surface p-3 sm:grid-cols-5"
                >
                  <TextInput
                    label={`${label} family`}
                    value={typography.family}
                    onChange={update("family")}
                    diagnostics={fieldDiagnostics(
                      state,
                      `typography.${role}.family`,
                    )}
                  />
                  <TextInput
                    label="Size pt"
                    value={typography.sizePt}
                    onChange={update("sizePt")}
                    diagnostics={fieldDiagnostics(
                      state,
                      `typography.${role}.sizePt`,
                    )}
                  />
                  <TextInput
                    label="Weight"
                    value={typography.weight}
                    onChange={update("weight")}
                    diagnostics={fieldDiagnostics(
                      state,
                      `typography.${role}.weight`,
                    )}
                  />
                  <TextInput
                    label="Line height"
                    value={typography.lineHeight}
                    onChange={update("lineHeight")}
                    diagnostics={fieldDiagnostics(
                      state,
                      `typography.${role}.lineHeight`,
                    )}
                  />
                  <TextInput
                    label="Tracking em"
                    value={typography.letterSpacingEm}
                    onChange={update("letterSpacingEm")}
                    diagnostics={fieldDiagnostics(
                      state,
                      `typography.${role}.letterSpacingEm`,
                    )}
                  />
                </div>
              );
            })}
          </div>
        </section>

        <section className="grid gap-3 rounded-ds-md border border-ds-border-subtle bg-ds-surface p-3 sm:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ds-text-muted">
              Logo token
            </h3>
            {(
              [
                "id",
                "src",
                "alt",
                "widthPx",
                "heightPx",
              ] as BrandKitAssetField[]
            ).map((field) => (
              <TextInput
                key={field}
                label={`Logo ${field}`}
                value={state.draft.assets?.logo?.[field]}
                onChange={(value) =>
                  setState((current) =>
                    updateBrandKitLogo(current, field, value),
                  )
                }
                diagnostics={fieldDiagnostics(state, `assets.logo.${field}`)}
              />
            ))}
          </div>
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ds-text-muted">
              Decorations
            </h3>
            <label className="block text-xs font-medium text-ds-text-secondary">
              Background
              <select
                value={state.draft.decorations?.background ?? "subtle"}
                onChange={(event) =>
                  setState((current) =>
                    updateBrandKitDecoration(
                      current,
                      "background",
                      event.currentTarget.value as
                        "none" | "subtle" | "expressive",
                    ),
                  )
                }
                className={cx(
                  "mt-1 h-8 w-full rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-2 text-xs text-ds-text-primary",
                  FOCUS_RING,
                )}
              >
                <option value="none">None</option>
                <option value="subtle">Subtle</option>
                <option value="expressive">Expressive</option>
              </select>
              {fieldDiagnostics(state, "decorations.background")}
            </label>
            <label className="block text-xs font-medium text-ds-text-secondary">
              Chrome
              <select
                value={state.draft.decorations?.chrome ?? "default"}
                onChange={(event) =>
                  setState((current) =>
                    updateBrandKitDecoration(
                      current,
                      "chrome",
                      event.currentTarget.value as "default" | "minimal",
                    ),
                  )
                }
                className={cx(
                  "mt-1 h-8 w-full rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-2 text-xs text-ds-text-primary",
                  FOCUS_RING,
                )}
              >
                <option value="default">Default</option>
                <option value="minimal">Minimal</option>
              </select>
              {fieldDiagnostics(state, "decorations.chrome")}
            </label>
          </div>
        </section>

        <section className="rounded-ds-md border border-ds-border-subtle bg-ds-surface p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ds-text-muted">
            Compiler validation
          </h3>
          {state.compileResult.diagnostics.length ? (
            <ul className="mt-2 space-y-1 text-xs text-ds-text-secondary">
              {state.compileResult.diagnostics.map((diagnostic) => (
                <li
                  key={`${diagnostic.path}:${diagnostic.code}:${diagnostic.message}`}
                >
                  <span
                    className={
                      diagnostic.severity === "error"
                        ? "text-ds-danger"
                        : "text-ds-warning"
                    }
                  >
                    {diagnostic.severity}
                  </span>{" "}
                  {diagnostic.path}: {diagnostic.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-ds-text-secondary">
              Compiler accepted this draft.
            </p>
          )}
          {state.saveResult && !state.saveResult.ok ? (
            <ul className="mt-3 space-y-1 text-xs text-ds-danger">
              {state.saveResult.diagnostics.map((diagnostic) => (
                <li key={`${diagnostic.path}:${diagnostic.code}`}>
                  {diagnostic.message}
                </li>
              ))}
            </ul>
          ) : null}
          {compiledPackage ? (
            <div className="mt-3 rounded-ds-sm bg-ds-surface-muted p-2 text-xs text-ds-text-secondary">
              Preview package:{" "}
              <span className="font-mono text-ds-text-primary">
                {compiledPackage.id}
              </span>{" "}
              @ {compiledPackage.version}
            </div>
          ) : null}
        </section>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-ds-border-subtle px-4 py-3">
        <p
          role="status"
          aria-live="polite"
          className="text-xs text-ds-text-muted"
        >
          {state.saveResult?.ok
            ? `Saved ${state.saveResult.packageId} @ ${state.saveResult.packageVersion}`
            : saveError
              ? saveError
              : blockingErrors.length
                ? `${blockingErrors.length} compiler error${blockingErrors.length === 1 ? "" : "s"} must be fixed before save.`
                : saveBrandKitDraft
                  ? "Ready to save compiled snapshot."
                  : "Save action unavailable in this surface."}
        </p>
        <Button
          variant="solid"
          size="sm"
          disabled={
            !saveBrandKitDraft || !state.compileResult.ok || state.saving
          }
          onClick={handleSave}
        >
          {state.saving ? "Saving…" : "Save brand kit"}
        </Button>
      </div>
    </section>
  );
}
