import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import {
  act,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

import { mountWithPortalDom, withPortalDom } from "@/test/portal-dom";
import { ColorPicker, type ColorPickerProps } from "./color-picker";

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const [message] = args;
  if (
    typeof message === "string" &&
    message.startsWith("react-test-renderer is deprecated")
  ) {
    return;
  }
  originalConsoleError(...args);
};

after(() => {
  console.error = originalConsoleError;
});

function renderPicker(
  overrides: Partial<ColorPickerProps> = {},
): ReturnType<typeof createElement> {
  return createElement(ColorPicker, {
    color: "#336699",
    "aria-label": "Accent color",
    onChange: () => undefined,
    ...overrides,
  });
}

function trigger(
  renderer: ReactTestRenderer,
  label = "Accent color",
): ReactTestInstance {
  const match = renderer.root
    .findAllByType("button")
    .find((button) => button.props["aria-label"] === label);
  assert.ok(match, `expected ${label} trigger`);
  return match;
}

function pickerDialogs(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(
    (node) =>
      node.type === "div" &&
      node.props.role === "dialog" &&
      node.props["aria-label"] === "Accent color picker",
  );
}

function textOf(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

test("disabling an open ColorPicker closes it without reopening when re-enabled", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(renderPicker());
    try {
      act(() => trigger(renderer).props.onClick());
      assert.equal(trigger(renderer).props["aria-expanded"], true);
      assert.equal(pickerDialogs(renderer).length, 1);

      act(() => renderer.update(renderPicker({ disabled: true })));
      assert.equal(trigger(renderer).props["aria-expanded"], false);
      assert.equal(pickerDialogs(renderer).length, 0);

      act(() => renderer.update(renderPicker({ disabled: false })));
      assert.equal(
        trigger(renderer).props["aria-expanded"],
        false,
        "clearing a parent busy state must not reopen a picker the user did not reactivate",
      );
      assert.equal(pickerDialogs(renderer).length, 0);
    } finally {
      act(() => renderer.unmount());
    }
  });
});

test("ColorPicker reserves tooltip layering and honors semantic nested-menu overrides", () => {
  withPortalDom(() => {
    const renderer = mountWithPortalDom(
      renderPicker({ triggerChrome: "toolbar" }),
    );
    try {
      act(() => trigger(renderer).props.onClick());
      const dialog = pickerDialogs(renderer)[0];
      assert.ok(dialog);
      assert.match(String(dialog.props.className), /\bz-dropdown\b/);
      assert.doesNotMatch(String(dialog.props.className), /\bz-tooltip\b/);

      act(() => renderer.update(renderPicker({ layer: "menu" })));
      const nestedDialog = pickerDialogs(renderer)[0];
      assert.ok(nestedDialog);
      assert.match(String(nestedDialog.props.className), /\bz-menu\b/);
    } finally {
      act(() => renderer.unmount());
    }
  });
});

test("closing ColorPicker during a custom-color drag removes global pointer listeners", () => {
  withPortalDom(() => {
    const listeners = new Map<string, Set<EventListener>>();
    window.addEventListener = ((type: string, listener: EventListener) => {
      const registered = listeners.get(type) ?? new Set<EventListener>();
      registered.add(listener);
      listeners.set(type, registered);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    }) as typeof window.removeEventListener;

    const renderer = mountWithPortalDom(renderPicker({ customOnly: true }));
    try {
      act(() => trigger(renderer).props.onClick());
      const saturationSlider = renderer.root.findByProps({
        role: "slider",
        "aria-label": "Accent color saturation and brightness",
      });
      act(() =>
        saturationSlider.props.onPointerDown({
          clientX: 10,
          clientY: 10,
          preventDefault: () => undefined,
          stopPropagation: () => undefined,
        }),
      );
      assert.equal(listeners.get("pointermove")?.size, 1);
      assert.equal(listeners.get("pointerup")?.size, 1);
      assert.equal(listeners.get("pointercancel")?.size, 1);

      act(() => trigger(renderer).props.onClick());
      assert.equal(trigger(renderer).props["aria-expanded"], false);
      assert.equal(
        listeners.get("pointermove")?.size ?? 0,
        0,
        "a closed picker must stop receiving global drag updates",
      );
      assert.equal(listeners.get("pointerup")?.size ?? 0, 0);
      assert.equal(listeners.get("pointercancel")?.size ?? 0, 0);
    } finally {
      act(() => renderer.unmount());
    }
  });
});

test("custom hex validation exposes invalid state and recovery to assistive technology", () => {
  withPortalDom(() => {
    const changes: string[] = [];
    const renderer = mountWithPortalDom(
      renderPicker({ onChange: (value) => changes.push(value) }),
    );
    try {
      act(() => trigger(renderer).props.onClick());
      const customTab = renderer.root
        .findAllByType("button")
        .find((button) => textOf(button).toLowerCase() === "custom");
      assert.ok(customTab);
      act(() => customTab.props.onClick());

      const hexInput = renderer.root.findByProps({
        "aria-label": "Accent color hex value",
      });
      act(() => hexInput.props.onChange({ target: { value: "not-a-color" } }));

      const invalidInput = renderer.root.findByProps({
        "aria-label": "Accent color hex value",
      });
      assert.equal(invalidInput.props["aria-invalid"], true);
      const errorId = invalidInput.props["aria-describedby"];
      assert.equal(typeof errorId, "string");
      assert.match(
        textOf(renderer.root.findByProps({ id: errorId })),
        /six-digit hex color/i,
      );
      assert.deepEqual(changes, []);

      act(() => invalidInput.props.onBlur());
      const recoveredInput = renderer.root.findByProps({
        "aria-label": "Accent color hex value",
      });
      assert.equal(recoveredInput.props.value, "#336699");
      assert.equal(recoveredInput.props["aria-invalid"], undefined);
      assert.equal(recoveredInput.props["aria-describedby"], undefined);
    } finally {
      act(() => renderer.unmount());
    }
  });
});
