import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Fragment, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ActionButton,
  Button,
  ColorPicker,
  IconButton,
  SegmentedControl,
  SelectMenu,
  Swatch,
  Tooltip,
} from ".";

test("shared UI primitives render labeled controls and selected states", () => {
  const changes: string[] = [];
  const tooltipProps: ComponentProps<typeof Tooltip> = {
    label: "Tooltip label",
    side: "bottom",
    delay: 0,
    children: createElement("button", null, "Hover me"),
  };
  const html = renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      createElement(Button, { variant: "solid", size: "lg" }, "Primary action"),
      createElement(IconButton, { "aria-label": "Icon action" }, "★"),
      createElement(ActionButton, {
        action: {
          id: "save",
          label: "Save",
          description: "Save changes",
          shortcutId: "global.help",
        },
      }),
      createElement(
        ActionButton,
        {
          iconOnly: true,
          action: {
            id: "disabled",
            label: "Disabled",
            disabledReason: "Unavailable",
          },
        },
        "×",
      ),
      createElement(ColorPicker, {
        color: "#0ea5e9",
        fallback: "#000000",
        "aria-label": "Pick accent color",
        active: true,
        icon: "A",
        presets: ["#0ea5e9", "#10b981"],
        onChange: (value) => changes.push(value),
      }),
      createElement(SelectMenu, {
        value: "second",
        "aria-label": "Select option",
        options: [
          { value: "first", label: "First", description: "First option" },
          { value: "second", label: "Second", icon: "✓" },
          { value: "disabled", label: "Disabled", disabled: true },
        ],
        onChange: (value) => changes.push(value),
        variant: "field",
        textSize: "sm",
        tooltipLabel: "Choose an option",
      }),
      createElement(SegmentedControl, {
        value: "grid",
        "aria-label": "View mode",
        stretch: true,
        size: "sm",
        options: [
          { value: "list", label: "List" },
          { value: "grid", label: "Grid", icon: "▦" },
          { value: "map", label: "Map", iconOnly: true, disabled: true },
        ],
        onChange: (value) => changes.push(value),
      }),
      createElement(Swatch, {
        color: "#10b981",
        selected: true,
        size: "lg",
        "aria-label": "Emerald",
      }),
      createElement(Tooltip, tooltipProps),
    ),
  );

  assert.match(html, /Primary action/);
  assert.match(html, /Pick accent color/);
  assert.match(html, /Second/);
  assert.match(html, /View mode/);
  assert.deepEqual(changes, []);
});
