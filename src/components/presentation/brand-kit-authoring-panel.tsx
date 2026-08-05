"use client";

import { unstable_rethrow } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";

import { Button } from "@/components/ui/button";
import { SelectMenu, type SelectMenuOption } from "@/components/ui/select-menu";
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

const DECORATION_BACKGROUND_OPTIONS: readonly SelectMenuOption[] = [
  { value: "none", label: "None" },
  { value: "subtle", label: "Subtle" },
  { value: "expressive", label: "Expressive" },
];

const DECORATION_CHROME_OPTIONS: readonly SelectMenuOption[] = [
  { value: "default", label: "Default" },
  { value: "minimal", label: "Minimal" },
];

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
  disabled = false,
}: {
  label: string;
  value: string | number | undefined;
  onChange: (value: string) => void;
  diagnostics?: JSX.Element | null;
  disabled?: boolean;
}): JSX.Element {
  return (
    <label className="block text-xs font-medium text-ds-text-secondary">
      {label}
      <input
        value={value ?? ""}
        disabled={disabled}
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
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  diagnostics?: JSX.Element | null;
  disabled?: boolean;
}): JSX.Element {
  const nativeColorValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <label className="block text-xs font-medium text-ds-text-secondary">
      {label}
      <span className="mt-1 flex items-center gap-2">
        <input
          type="color"
          value={nativeColorValue}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
          className={cx(
            "h-8 w-10 rounded-ds-sm border border-ds-border-subtle bg-ds-surface",
            FOCUS_RING,
          )}
          aria-label={`${label} color swatch`}
        />
        <input
          value={value}
          disabled={disabled}
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

const BRAND_KIT_SAVE_ERROR = "Could not save the brand kit. Please try again.";
const BRAND_KIT_SAVE_FAILURE: Extract<SaveBrandKitDraftResult, { ok: false }> =
  {
    ok: false,
    diagnostics: [
      {
        severity: "error",
        code: "brand-kit-save-failed",
        message: BRAND_KIT_SAVE_ERROR,
        path: "save",
      },
    ],
  };

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
  const saveOperationRef = useRef<object | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      saveOperationRef.current = null;
    };
  }, []);
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
    if (
      saveOperationRef.current ||
      !saveBrandKitDraft ||
      !state.compileResult.ok
    ) {
      return;
    }
    const operation = {};
    const saveState = state;
    saveOperationRef.current = operation;
    setState({
      ...saveState,
      saving: true,
      saveResult: undefined,
    });
    try {
      let nextState: BrandKitAuthoringState;
      try {
        nextState = await saveBrandKitAuthoringState(
          saveState,
          saveBrandKitDraft,
        );
      } catch (error) {
        unstable_rethrow(error);
        nextState = {
          ...saveState,
          saving: false,
          saveResult: BRAND_KIT_SAVE_FAILURE,
        };
      }
      if (!mountedRef.current || saveOperationRef.current !== operation) {
        return;
      }
      setState(nextState);
      if (nextState.saveResult?.ok) onSaved?.(nextState.saveResult);
    } finally {
      if (saveOperationRef.current === operation) {
        saveOperationRef.current = null;
      }
    }
  }

  function handleClose() {
    if (saveOperationRef.current) return;
    onClose();
  }

  function dismissSaveError() {
    setState((current) => ({ ...current, saveResult: undefined }));
  }

  return (
    <section
      aria-labelledby="brand-kit-authoring-title"
      aria-busy={state.saving}
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
        <Button
          variant="plain"
          size="sm"
          disabled={state.saving}
          onClick={handleClose}
        >
          Close
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section className="grid gap-3 rounded-ds-md border border-ds-border-subtle bg-ds-surface p-3 sm:grid-cols-3">
          <TextInput
            label="Name"
            value={state.draft.name}
            disabled={state.saving}
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
            disabled={state.saving}
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
            disabled={state.saving}
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
                disabled={state.saving}
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
                    disabled={state.saving}
                    onChange={update("family")}
                    diagnostics={fieldDiagnostics(
                      state,
                      `typography.${role}.family`,
                    )}
                  />
                  <TextInput
                    label="Size pt"
                    value={typography.sizePt}
                    disabled={state.saving}
                    onChange={update("sizePt")}
                    diagnostics={fieldDiagnostics(
                      state,
                      `typography.${role}.sizePt`,
                    )}
                  />
                  <TextInput
                    label="Weight"
                    value={typography.weight}
                    disabled={state.saving}
                    onChange={update("weight")}
                    diagnostics={fieldDiagnostics(
                      state,
                      `typography.${role}.weight`,
                    )}
                  />
                  <TextInput
                    label="Line height"
                    value={typography.lineHeight}
                    disabled={state.saving}
                    onChange={update("lineHeight")}
                    diagnostics={fieldDiagnostics(
                      state,
                      `typography.${role}.lineHeight`,
                    )}
                  />
                  <TextInput
                    label="Tracking em"
                    value={typography.letterSpacingEm}
                    disabled={state.saving}
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
                disabled={state.saving}
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
            <div className="block text-xs font-medium text-ds-text-secondary">
              Background
              <div className="mt-1">
                <SelectMenu
                  aria-label="Background"
                  variant="field"
                  value={state.draft.decorations?.background ?? "subtle"}
                  options={DECORATION_BACKGROUND_OPTIONS}
                  onChange={(next) =>
                    setState((current) =>
                      updateBrandKitDecoration(
                        current,
                        "background",
                        next as "none" | "subtle" | "expressive",
                      ),
                    )
                  }
                  buttonClassName={
                    state.saving ? "pointer-events-none opacity-40" : undefined
                  }
                />
              </div>
              {fieldDiagnostics(state, "decorations.background")}
            </div>
            <div className="block text-xs font-medium text-ds-text-secondary">
              Chrome
              <div className="mt-1">
                <SelectMenu
                  aria-label="Chrome"
                  variant="field"
                  value={state.draft.decorations?.chrome ?? "default"}
                  options={DECORATION_CHROME_OPTIONS}
                  onChange={(next) =>
                    setState((current) =>
                      updateBrandKitDecoration(
                        current,
                        "chrome",
                        next as "default" | "minimal",
                      ),
                    )
                  }
                  buttonClassName={
                    state.saving ? "pointer-events-none opacity-40" : undefined
                  }
                />
              </div>
              {fieldDiagnostics(state, "decorations.chrome")}
            </div>
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
            <div
              role="alert"
              className="mt-3 rounded-ds-md border border-ds-danger-border bg-ds-danger-surface p-3 text-xs text-ds-danger-text"
            >
              <ul className="space-y-1">
                {state.saveResult.diagnostics.map((diagnostic) => (
                  <li key={`${diagnostic.path}:${diagnostic.code}`}>
                    {diagnostic.message}
                  </li>
                ))}
              </ul>
              <Button
                variant="plain"
                size="sm"
                disabled={state.saving}
                onClick={dismissSaveError}
                className="mt-2"
              >
                Dismiss error
              </Button>
            </div>
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
          {state.saving
            ? "Saving…"
            : state.saveResult && !state.saveResult.ok
              ? "Try save again"
              : "Save brand kit"}
        </Button>
      </div>
    </section>
  );
}
