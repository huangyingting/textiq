"use client";

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  JSX,
  MouseEvent,
  ReactNode,
} from "react";

import { FOCUS_RING } from "@/components/ui/tokens";

type FieldMessage = ReactNode | undefined;

export type EditorActionDescriptor = {
  id: string;
  label: string;
  description?: string;
  disabledReason?: string;
  shortcut?: string;
  liveMessage?: string;
};

export type EditorActionGroup = {
  label?: string;
  actions: readonly EditorActionDescriptor[];
};

export const EDITOR_CONTROL_CLASS = `rounded-ds-md border border-ds-border-subtle bg-ds-surface px-2 py-1 text-xs text-ds-text-primary outline-none ${FOCUS_RING}`;
export const EDITOR_COLOR_CONTROL_CLASS = `h-8 rounded-ds-md border border-ds-border-subtle bg-ds-surface ${FOCUS_RING}`;

export function editorClassName(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}

export function editorControlClass(className?: string): string {
  return editorClassName(EDITOR_CONTROL_CLASS, className);
}

export function editorColorControlClass(className?: string): string {
  return editorClassName(EDITOR_COLOR_CONTROL_CLASS, className);
}

export function parseEditorNumberInput(value: string): number | undefined {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function fieldMessageIds({
  id,
  description,
  helpText,
  errorText,
}: {
  id: string;
  description?: FieldMessage;
  helpText?: FieldMessage;
  errorText?: FieldMessage;
}): string | undefined {
  return [
    description ? `${id}-description` : undefined,
    helpText ? `${id}-help` : undefined,
    errorText ? `${id}-error` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function actionTitle(action: EditorActionDescriptor): string | undefined {
  return [
    action.description,
    action.disabledReason ? `Disabled: ${action.disabledReason}` : undefined,
    action.shortcut ? `Shortcut: ${action.shortcut}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface EditorFieldProps {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  helpText?: ReactNode;
  errorText?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function EditorField({
  id,
  label,
  description,
  helpText,
  errorText,
  className,
  children,
}: EditorFieldProps): JSX.Element {
  return (
    <label
      htmlFor={id}
      className={editorClassName(
        "flex flex-col gap-1 text-xs text-ds-text-secondary",
        className,
      )}
      data-invalid={errorText ? "true" : undefined}
    >
      <span>{label}</span>
      {description ? (
        <span
          id={`${id}-description`}
          className="text-[11px] text-ds-text-muted"
        >
          {description}
        </span>
      ) : null}
      {children}
      {helpText ? (
        <span id={`${id}-help`} className="text-[11px] text-ds-text-muted">
          {helpText}
        </span>
      ) : null}
      {errorText ? (
        <span id={`${id}-error`} className="text-[11px] text-ds-danger-text">
          {errorText}
        </span>
      ) : null}
    </label>
  );
}

export interface EditorNumberFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "type" | "value" | "onChange" | "children"
> {
  id: string;
  label: ReactNode;
  value: number | undefined;
  description?: ReactNode;
  helpText?: ReactNode;
  errorText?: ReactNode;
  fieldClassName?: string;
  inputClassName?: string;
  onValueChange: (value: number | undefined) => void;
}

export function EditorNumberField({
  id,
  label,
  value,
  description,
  helpText,
  errorText,
  fieldClassName,
  inputClassName,
  onValueChange,
  ...inputProps
}: EditorNumberFieldProps): JSX.Element {
  const describedBy = fieldMessageIds({
    id,
    description,
    helpText,
    errorText,
  });
  return (
    <EditorField
      id={id}
      label={label}
      description={description}
      helpText={helpText}
      errorText={errorText}
      className={fieldClassName}
    >
      <input
        {...inputProps}
        id={id}
        type="number"
        value={value ?? ""}
        aria-describedby={describedBy || undefined}
        aria-invalid={errorText ? true : undefined}
        onChange={(event) =>
          onValueChange(parseEditorNumberInput(event.currentTarget.value))
        }
        className={editorControlClass(inputClassName)}
      />
    </EditorField>
  );
}

export interface EditorActionButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "children"
> {
  action: EditorActionDescriptor;
  children?: ReactNode;
  variant?: "secondary" | "ghost";
  onAnnounce?: (message: string) => void;
}

export function EditorActionButton({
  action,
  children,
  className,
  disabled,
  variant = "secondary",
  onAnnounce,
  onClick,
  ...buttonProps
}: EditorActionButtonProps): JSX.Element {
  const isDisabled = disabled === true || action.disabledReason !== undefined;

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    onClick?.(event);
    if (!event.defaultPrevented && action.liveMessage) {
      onAnnounce?.(action.liveMessage);
    }
  }

  return (
    <button
      {...buttonProps}
      type="button"
      disabled={isDisabled}
      aria-label={buttonProps["aria-label"] ?? action.label}
      data-command-id={action.id}
      data-disabled-reason={action.disabledReason}
      data-live-message={action.liveMessage}
      title={actionTitle(action)}
      onClick={handleClick}
      className={editorClassName(
        "inline-flex items-center justify-center gap-2 rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        variant === "ghost"
          ? "text-ds-text-secondary hover:bg-ds-state-hover"
          : "bg-ds-surface text-ds-text-secondary hover:bg-ds-state-hover",
        className,
      )}
    >
      <span>{children ?? action.label}</span>
      {action.shortcut ? (
        <kbd className="rounded-ds-sm bg-ds-surface-2 px-1 text-[10px] font-medium text-ds-text-muted">
          {action.shortcut}
        </kbd>
      ) : null}
    </button>
  );
}

export interface EditorActionMenuProps {
  label: string;
  groups: readonly EditorActionGroup[];
  className?: string;
  onAction: (action: EditorActionDescriptor) => void;
  onAnnounce?: (message: string) => void;
}

export function EditorActionMenu({
  label,
  groups,
  className,
  onAction,
  onAnnounce,
}: EditorActionMenuProps): JSX.Element {
  return (
    <div
      role="menu"
      aria-label={label}
      className={editorClassName(
        "flex min-w-44 flex-col gap-1 rounded-ds-md border border-ds-border-subtle bg-ds-surface p-1 shadow-ds-popover",
        className,
      )}
    >
      {groups.map((group, groupIndex) => (
        <div
          key={group.label ?? groupIndex}
          role="group"
          aria-label={group.label}
          className="flex flex-col gap-1"
        >
          {group.label ? (
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-ds-text-muted">
              {group.label}
            </div>
          ) : null}
          {group.actions.map((action) => (
            <EditorActionButton
              key={action.id}
              action={action}
              role="menuitem"
              variant="ghost"
              className="w-full justify-between text-left"
              onClick={() => onAction(action)}
              onAnnounce={onAnnounce}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
