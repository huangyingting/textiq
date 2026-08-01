import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ReactElement } from "react";

import {
  Card,
  FieldRow,
  FormField,
  Kbd,
  PanelSurface,
  PopoverSection,
  ToolbarButton,
} from "./chrome";
import {
  CONTROL_TRANSITION,
  ELEVATION,
  EMPTY_STATE_CHROME,
  FIELD_CONTROL,
  FOCUS_RING,
  GUTTER_BUTTON,
  MENU_CHROME,
  MENU_ITEM,
  PANEL_CHROME,
  RADIUS,
  SURFACE_BASE,
  TOOLBAR_BUTTON_CHROME,
  cx,
} from "./tokens";

type TestElementProps = {
  children?: unknown;
  className?: string;
  htmlFor?: string;
  role?: string;
  [key: string]: unknown;
};

function childrenOf(element: unknown): unknown[] {
  const children = (element as { props?: { children?: unknown } }).props
    ?.children;
  return Array.isArray(children) ? children : [];
}

function reactElement(value: unknown): ReactElement<TestElementProps> {
  assert.ok(value && typeof value === "object" && "props" in value);
  return value as ReactElement<TestElementProps>;
}

test("ToolbarButton: composes shared toolbar chrome", () => {
  const element = ToolbarButton({
    "aria-label": "Bold",
    active: true,
    className: "custom-toolbar",
    children: "B",
  });

  assert.match(element.props.className, /h-7/);
  assert.match(element.props.className, /bg-ds-accent-surface/);
  assert.match(element.props.className, /focus-visible:ring-ds-focus-ring/);
  assert.match(element.props.className, /custom-toolbar/);
  assert.equal(element.props["aria-pressed"], true);
});

test("ToolbarButton: active state owns aria-pressed over a conflicting caller attribute", () => {
  const element = ToolbarButton({
    active: true,
    "aria-label": "Bold",
    "aria-pressed": false,
    children: "B",
  });

  assert.equal(element.props["aria-pressed"], true);
});

test("ToolbarButton: supports text buttons, inactive tones, and custom type", () => {
  const element = ToolbarButton({
    children: "Save",
    iconOnly: false,
    size: "lg",
    tone: "surface",
    shape: "pill",
    type: "submit",
  });

  assert.equal(element.props.type, "submit");
  assert.equal(element.props["aria-pressed"], undefined);
  assert.match(element.props.className, /h-9/);
  assert.match(element.props.className, /px-4/);
  assert.match(element.props.className, /rounded-\[var\(--ds-radius-pill/);
  assert.match(element.props.className, /text-ds-text-primary/);
  assert.match(
    ToolbarButton({ shape: "md" }).props.className,
    /--ds-radius-md/,
  );
});

test("ToolbarButton: strips native title tooltips", () => {
  const element = ToolbarButton({
    "aria-label": "Bold",
    title: "Bold",
    children: "B",
  });

  assert.equal(element.props.title, undefined);
});

test("PopoverSection: renders a labelled section shell", () => {
  const element = PopoverSection({
    title: "Text",
    children: "items",
  });
  const [heading, children] = element.props.children;

  assert.match(element.props.className, /py-0\.5/);
  assert.equal(heading.props.children, "Text");
  assert.equal(children, "items");
});

test("FieldRow: uses label semantics when htmlFor is provided", () => {
  const element = FieldRow({
    label: "Background",
    htmlFor: "bg",
    hint: "Optional",
    className: "custom-row",
    "data-testid": "field-row",
    children: "control",
  } as Parameters<typeof FieldRow>[0] & { "data-testid": string });
  const [labelNode, control, hintNode] = childrenOf(element);
  const label = reactElement(labelNode);
  const hint = reactElement(hintNode);

  assert.equal(label.type, "label");
  assert.match(element.props.className, /custom-row/);
  assert.equal(
    (element.props as { "data-testid"?: string })["data-testid"],
    "field-row",
  );
  assert.equal(label.props.htmlFor, "bg");
  assert.equal(control, "control");
  assert.equal(hint.props.children, "Optional");
});

test("FieldRow: renders span labels, hint, and error for unbound rows", () => {
  const element = FieldRow({
    label: "Contrast",
    error: "Pick a value",
    children: "control",
  });
  const [labelNode, control, hint, errorNode] = childrenOf(element);
  const label = reactElement(labelNode);
  const error = reactElement(errorNode);

  assert.equal(label.type, "span");
  assert.equal(control, "control");
  assert.equal(hint, null);
  assert.equal(error.props.role, "alert");

  const withHintAndError = FieldRow({
    label: "Spacing",
    hint: "Optional",
    error: "Invalid",
    children: "control",
  });
  const withHintAndErrorChildren = childrenOf(withHintAndError);
  assert.equal(
    reactElement(withHintAndErrorChildren[2]).props.children,
    "Optional",
  );
  assert.equal(reactElement(withHintAndErrorChildren[3]).props.role, "alert");
});

test("FieldRow: omits optional hint and error nodes when unset", () => {
  const element = FieldRow({
    label: "Density",
    htmlFor: "density",
    children: "control",
  });
  const [labelNode, control, hint, error] = childrenOf(element);
  const label = reactElement(labelNode);

  assert.equal(label.type, "label");
  assert.equal(control, "control");
  assert.equal(hint, null);
  assert.equal(error, null);
});

test("GUTTER_BUTTON: lives in the owned UI token module", () => {
  assert.match(GUTTER_BUTTON, /h-9 w-9/);
  assert.match(GUTTER_BUTTON, /shadow-ds-raised/);
  assert.match(GUTTER_BUTTON, /focus-visible:ring-ds-focus-ring/);
});

test("global chrome tokens include forced-colors and contrast overrides", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  assert.match(css, /@media \(prefers-contrast: more\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /--ds-accent-fill: Highlight/);
  assert.match(css, /--ds-focus-ring: Highlight/);
  assert.match(css, /outline: 2px solid Highlight/);
  assert.match(css, /\[data-node-chrome-frame\]/);
  assert.match(css, /\.tiq-mobile-sheet/);
});

test("Card uses DS chrome tokens", () => {
  const card = Card({ children: "body" });

  assert.match(card.props.className, /bg-ds-surface-raised/);
  assert.match(card.props.className, /rounded-\[var\(--ds-radius-lg/);
});

test("Card and PanelSurface support optional chrome branches", () => {
  const card = Card({
    elevation: "flat",
    padding: "none",
    className: "custom",
  });
  const panel = PanelSurface({
    bordered: false,
    elevation: "overlay",
    radius: "xl",
    padding: "sm",
  });

  assert.match(card.props.className, /shadow-\[var\(--ds-shadow-flat/);
  assert.match(card.props.className, /custom/);
  assert.match(Card({ padding: "sm" }).props.className, /p-3/);
  assert.match(Card({ padding: "lg" }).props.className, /p-6/);
  assert.doesNotMatch(panel.props.className, /border-ds-border-subtle/);
  assert.match(panel.props.className, /rounded-\[var\(--ds-radius-xl/);
  assert.match(panel.props.className, /p-3/);
});

test("Kbd exposes keyboard chrome", () => {
  const kbd = Kbd({ children: "⌘K" });

  assert.equal(kbd.type, "kbd");
  assert.match(kbd.props.className, /bg-ds-surface-sunken/);
});

test("FormField renders label, hint, and error semantics", () => {
  const element = FormField({
    label: "Name",
    htmlFor: "name",
    hint: "Shown to collaborators",
    error: "Required",
    children: "control",
  });
  const [labelNode, control, hintNode, errorNode] = childrenOf(element);
  const label = reactElement(labelNode);
  const hint = reactElement(hintNode);
  const error = reactElement(errorNode);

  assert.equal(label.type, "label");
  assert.equal(label.props.htmlFor, "name");
  assert.equal(control, "control");
  assert.equal(hint.props.children, "Shown to collaborators");
  assert.equal(error.props.role, "alert");
});

test("FormField renders span labels and merges label props", () => {
  const labelled = FormField({
    label: "Email",
    htmlFor: "email",
    labelProps: { className: "tracking-wide", "aria-hidden": true },
    children: "control",
  });
  const unbound = FormField({ label: "Theme", children: "select" });

  assert.match(labelled.props.children[0].props.className, /tracking-wide/);
  assert.equal(labelled.props.children[0].props["aria-hidden"], true);
  assert.equal(unbound.props.children[0].type, "span");
});

test("UI token exports compose stable design-system classes", () => {
  assert.match(FOCUS_RING, /focus-visible:ring-ds-focus-ring/);
  assert.match(RADIUS.sm, /--ds-radius-sm/);
  assert.match(RADIUS.pill, /9999px/);
  assert.match(ELEVATION.overlay, /--ds-shadow-overlay/);
  assert.match(SURFACE_BASE, /--ds-surface-base/);
  assert.match(FIELD_CONTROL, /focus:ring-ds-focus-ring/);
  assert.match(PANEL_CHROME, /bg-ds-surface-raised/);
  assert.match(EMPTY_STATE_CHROME, /border-dashed/);
  assert.match(MENU_CHROME, /shadow-\[var\(--ds-shadow-popover/);
  assert.match(MENU_ITEM, /hover:bg-ds-state-hover/);
  assert.equal(CONTROL_TRANSITION, "transition-colors");
  assert.match(TOOLBAR_BUTTON_CHROME.active, /bg-ds-accent-surface/);
  assert.match(TOOLBAR_BUTTON_CHROME.subtle, /text-ds-text-secondary/);
  assert.match(TOOLBAR_BUTTON_CHROME.surface, /hover:bg-ds-state-hover/);
  assert.equal(cx("a", false, null, undefined, "b"), "a b");
  assert.equal(cx(), "");
});
