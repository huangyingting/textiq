import {
  createElement,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
} from "react";

import {
  cx,
  ELEVATION,
  FOCUS_RING,
  RADIUS,
  TOOLBAR_BUTTON_CHROME,
  type Elevation,
  type Radius,
} from "./tokens";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  elevation?: Elevation;
  padding?: "none" | "sm" | "md" | "lg";
};

const CARD_PADDING: Record<NonNullable<CardProps["padding"]>, string> = {
  none: "",
  sm: "p-3",
  md: "p-5",
  lg: "p-6",
};
export function Card(props: CardProps) {
  const { elevation = "raised", padding = "md", className, ...rest } = props;
  return (
    <div
      className={cx(
        "border border-ds-border-subtle bg-ds-surface-raised text-ds-text-primary",
        RADIUS.lg,
        ELEVATION[elevation],
        CARD_PADDING[padding],
        className,
      )}
      {...rest}
    />
  );
}

export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cx(
        "inline-flex min-w-5 items-center justify-center rounded-ds-sm border border-ds-border-subtle bg-ds-surface-sunken px-1.5 py-0.5 font-sans text-[0.6875rem] font-medium text-ds-text-muted shadow-ds-flat",
        className,
      )}
      {...rest}
    />
  );
}

export type ToolbarMenuItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
};

export function ToolbarMenuItem({
  icon,
  type,
  className,
  children,
  ...rest
}: ToolbarMenuItemProps) {
  return (
    <button
      type={type ?? "button"}
      className={cx(
        "flex w-full items-center gap-2 whitespace-nowrap rounded-ds-sm px-2 py-1.5 text-left text-xs font-medium text-ds-text-secondary transition-colors hover:bg-ds-state-hover hover:text-ds-text-primary",
        FOCUS_RING,
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export type FormFieldProps = HTMLAttributes<HTMLDivElement> & {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  labelProps?: LabelHTMLAttributes<HTMLLabelElement>;
};

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  labelProps,
  className,
  children,
  ...rest
}: FormFieldProps) {
  const labelClass = "text-sm font-medium text-ds-text-primary";
  return (
    <div className={cx("flex flex-col gap-1.5", className)} {...rest}>
      {htmlFor ? (
        <label
          {...labelProps}
          htmlFor={htmlFor}
          className={cx(labelClass, labelProps?.className)}
        >
          {label}
        </label>
      ) : (
        <span className={labelClass}>{label}</span>
      )}
      {children}
      {hint ? <p className="text-xs text-ds-text-muted">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-ds-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type ToolbarButtonSize = "sm" | "md" | "lg";
export type ToolbarButtonTone = "subtle" | "surface";
export type ToolbarButtonShape = "sm" | "md" | "pill";

const TOOLBAR_SIZE: Record<ToolbarButtonSize, string> = {
  sm: "h-7 min-w-7 text-xs",
  md: "h-8 min-w-8 text-sm",
  lg: "h-9 min-w-9 text-sm",
};

const TOOLBAR_ICON_WIDTH: Record<ToolbarButtonSize, string> = {
  sm: "w-7",
  md: "w-8",
  lg: "w-9",
};

const TOOLBAR_TEXT_PADDING: Record<ToolbarButtonSize, string> = {
  sm: "px-2.5",
  md: "px-3",
  lg: "px-4",
};

const TOOLBAR_SHAPE: Record<ToolbarButtonShape, string> = {
  sm: RADIUS.sm,
  md: RADIUS.md,
  pill: RADIUS.pill,
};

export type ToolbarButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  iconOnly?: boolean;
  size?: ToolbarButtonSize;
  tone?: ToolbarButtonTone;
  shape?: ToolbarButtonShape;
};

export function ToolbarButton({
  active,
  iconOnly = true,
  size = "sm",
  tone = "subtle",
  shape = "sm",
  type,
  title: _title,
  "aria-pressed": ariaPressed,
  className,
  children,
  ...rest
}: ToolbarButtonProps) {
  const widthClass = iconOnly
    ? TOOLBAR_ICON_WIDTH[size]
    : TOOLBAR_TEXT_PADDING[size];
  const chromeClass =
    active === true
      ? TOOLBAR_BUTTON_CHROME.active
      : TOOLBAR_BUTTON_CHROME[tone];
  const buttonClassName = cx(
    "inline-flex items-center justify-center transition-colors disabled:pointer-events-none disabled:opacity-50",
    TOOLBAR_SIZE[size],
    widthClass,
    TOOLBAR_SHAPE[shape],
    chromeClass,
    FOCUS_RING,
    className,
  );

  return (
    <button
      type={type ?? "button"}
      aria-pressed={active ?? ariaPressed}
      className={buttonClassName}
      {...rest}
    >
      {children}
    </button>
  );
}

export type PanelSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  elevation?: Elevation;
  radius?: Radius;
  bordered?: boolean;
  padding?: "none" | "sm" | "md";
};

const PANEL_PADDING: Record<
  NonNullable<PanelSurfaceProps["padding"]>,
  string
> = {
  none: "",
  sm: "p-3",
  md: "p-5",
};

export function PanelSurface({
  elevation = "raised",
  radius = "lg",
  bordered = true,
  padding = "none",
  className,
  ...rest
}: PanelSurfaceProps) {
  return (
    <div
      className={cx(
        bordered && "border border-ds-border-subtle",
        "bg-ds-surface-raised text-ds-text-primary",
        RADIUS[radius],
        ELEVATION[elevation],
        PANEL_PADDING[padding],
        className,
      )}
      {...rest}
    />
  );
}

export type PopoverSectionProps = HTMLAttributes<HTMLDivElement> & {
  title: ReactNode;
  headingClassName?: string;
};

export function PopoverSection({
  title,
  headingClassName,
  className,
  children,
  ...rest
}: PopoverSectionProps) {
  return (
    <div className={cx("py-0.5", className)} {...rest}>
      <div
        className={cx(
          "px-2 pb-1 pt-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-ds-text-muted",
          headingClassName,
        )}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

export type FieldRowProps = HTMLAttributes<HTMLDivElement> & {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
};

export function FieldRow({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
  ...rest
}: FieldRowProps) {
  const labelClass = "text-xs font-medium text-ds-text-secondary";
  const labelNode = htmlFor ? (
    <label className={labelClass} htmlFor={htmlFor}>
      {label}
    </label>
  ) : (
    <span className={labelClass}>{label}</span>
  );
  const hintNode = hint ? (
    <p className="text-xs text-ds-text-muted">{hint}</p>
  ) : null;
  const errorNode = error ? (
    <p role="alert" className="text-xs text-ds-danger">
      {error}
    </p>
  ) : null;

  return createElement(
    "div",
    { className: cx("flex flex-col gap-1.5", className), ...rest },
    labelNode,
    children,
    hintNode,
    errorNode,
  );
}
