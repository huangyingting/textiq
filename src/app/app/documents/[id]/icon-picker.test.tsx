/**
 * Direct behavior coverage for `IconPicker` (#1958).
 *
 * `IconPicker` is a plain client component with no Lexical dependency: it
 * reads the offline icon catalog (`searchIcons`/`suggestIconsForLabel`,
 * already exhaustively pinned by `catalog.test.ts`) and renders a
 * search/suggestions/results UI purely from its own `open`/`query` state and
 * the `value`/`onSelect`/`onRemove`/`expanded` props. This file exercises the
 * component itself: the collapsed/expanded toggle, search-driven result
 * filtering (including the "no matches" empty state), suggestion and result
 * selection calling `onSelect` with the right icon name, the Remove action
 * calling `onRemove` only when a value is set, and the `expanded` prop's
 * "compact panel" mode (no header/search input, no Remove button gating on
 * search results).
 *
 * Mounted directly with `react-test-renderer` (no Lexical composer needed).
 * `Tooltip` (wrapping every result button) portals into `document.body` once
 * open, so every test installs the shared portal-safe fake DOM.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createElement } from "react";
import { act, type ReactTestRenderer } from "react-test-renderer";

import {
  installFakeDom,
  mount,
  textOf,
  unmount,
} from "@/test/lexical-component-harness";

import { IconPicker } from "./icon-picker";

type Props = Parameters<typeof IconPicker>[0];

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    nodeLabel: "Start",
    onSelect: () => undefined,
    onRemove: () => undefined,
    ...overrides,
  };
}

function findToggleButton(renderer: ReactTestRenderer) {
  return renderer.root.find(
    (instance) =>
      instance.type === "button" &&
      typeof instance.props["aria-expanded"] === "boolean",
  );
}

function findSearchInput(renderer: ReactTestRenderer) {
  return renderer.root.find(
    (instance) => instance.props["aria-label"] === "Search icons",
  );
}

function findResultOptions(renderer: ReactTestRenderer) {
  return renderer.root.findAll((instance) => instance.props.role === "option");
}

function findRemoveButton(renderer: ReactTestRenderer) {
  return renderer.root.findAll(
    (instance) => instance.props["aria-label"] === "Remove icon",
  );
}

describe("IconPicker", () => {
  let restoreDom: (() => void) | null = null;
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    if (renderer) {
      unmount(renderer);
      renderer = null;
    }
    if (restoreDom) {
      restoreDom();
      restoreDom = null;
    }
  });

  test("collapsed by default: shows 'None' and an Add toggle, no picker panel", () => {
    restoreDom = installFakeDom();
    renderer = mount(createElement(IconPicker, baseProps()));

    const toggle = findToggleButton(renderer);
    assert.equal(toggle.props["aria-expanded"], false);
    assert.equal(textOf(toggle), "Add");
    assert.equal(
      renderer.root.findAll((i) => i.props.role === "listbox").length,
      0,
    );
  });

  test("a set value renders its icon/name and flips the toggle label to Change", () => {
    restoreDom = installFakeDom();
    renderer = mount(createElement(IconPicker, baseProps({ value: "Star" })));

    const toggle = findToggleButton(renderer);
    assert.equal(textOf(toggle), "Change");
    assert.ok(
      textOf(renderer.root).includes("Star"),
      "expected the current icon name to render",
    );
  });

  test("an unrecognized value falls back to the 'None' label (resolveIconComponent misses)", () => {
    restoreDom = installFakeDom();
    renderer = mount(
      createElement(IconPicker, baseProps({ value: "not-a-real-icon" })),
    );
    // resolveIconComponent returns undefined for unknown names, so the header
    // falls back to "None" even though `value` is set — the toggle label
    // (which only checks truthiness of `value`) still reads "Change".
    assert.ok(textOf(renderer.root).includes("None"));
    assert.equal(textOf(findToggleButton(renderer)), "Change");
  });

  test("clicking Add opens the picker with a search input, suggestions, and a result grid", () => {
    restoreDom = installFakeDom();
    renderer = mount(createElement(IconPicker, baseProps()));

    act(() => {
      findToggleButton(renderer as ReactTestRenderer).props.onClick();
    });

    const toggle = findToggleButton(renderer);
    assert.equal(toggle.props["aria-expanded"], true);
    assert.equal(textOf(toggle), "Close");
    assert.ok(findSearchInput(renderer), "expected a search input");
    assert.ok(
      renderer.root.find((i) => i.props.role === "listbox"),
      "expected a results listbox",
    );
    assert.ok(
      textOf(renderer.root).includes("Suggestions"),
      "expected suggestions derived from nodeLabel",
    );
  });

  test("typing a query that matches nothing shows the empty state with the query echoed", () => {
    restoreDom = installFakeDom();
    renderer = mount(createElement(IconPicker, baseProps()));
    act(() => {
      findToggleButton(renderer as ReactTestRenderer).props.onClick();
    });

    act(() => {
      findSearchInput(renderer as ReactTestRenderer).props.onChange({
        target: { value: "zzzzzznotarealicon" },
      });
    });

    assert.equal(findResultOptions(renderer as ReactTestRenderer).length, 0);
    assert.ok(
      textOf(renderer.root).includes(
        "No icons match \u201Czzzzzznotarealicon\u201D.",
      ),
    );
  });

  test("selecting a result option calls onSelect with that icon's name", () => {
    restoreDom = installFakeDom();
    const selected: string[] = [];
    renderer = mount(
      createElement(
        IconPicker,
        baseProps({ onSelect: (name) => selected.push(name) }),
      ),
    );
    act(() => {
      findToggleButton(renderer as ReactTestRenderer).props.onClick();
    });

    const options = findResultOptions(renderer as ReactTestRenderer);
    assert.ok(options.length > 0, "expected at least one result option");
    act(() => {
      options[0]?.props.onClick();
    });

    assert.equal(selected.length, 1);
    assert.equal(typeof selected[0], "string");
  });

  test("selecting a suggestion chip calls onSelect with that suggestion's name", () => {
    restoreDom = installFakeDom();
    const selected: string[] = [];
    renderer = mount(
      createElement(
        IconPicker,
        baseProps({
          nodeLabel: "Decision",
          onSelect: (name) => selected.push(name),
        }),
      ),
    );
    act(() => {
      findToggleButton(renderer as ReactTestRenderer).props.onClick();
    });

    const suggestionButtons = renderer.root.findAll(
      (i) =>
        i.type === "button" &&
        typeof i.props["aria-label"] === "string" &&
        (i.props["aria-label"] as string).startsWith("Icon: "),
    );
    assert.ok(suggestionButtons.length > 0, "expected suggestion buttons");
    act(() => {
      suggestionButtons[0]?.props.onClick();
    });
    assert.equal(selected.length, 1);
  });

  test("Remove icon only renders and fires onRemove when a value is set", () => {
    restoreDom = installFakeDom();
    let removed = 0;
    renderer = mount(createElement(IconPicker, baseProps()));
    act(() => {
      findToggleButton(renderer as ReactTestRenderer).props.onClick();
    });
    assert.equal(findRemoveButton(renderer as ReactTestRenderer).length, 0);
    unmount(renderer);

    renderer = mount(
      createElement(
        IconPicker,
        baseProps({ value: "Star", onRemove: () => removed++ }),
      ),
    );
    act(() => {
      findToggleButton(renderer as ReactTestRenderer).props.onClick();
    });
    const removeButtons = findRemoveButton(renderer as ReactTestRenderer);
    assert.equal(removeButtons.length, 1);
    act(() => {
      removeButtons[0]?.props.onClick();
    });
    assert.equal(removed, 1);
  });

  test("expanded mode renders the compact panel directly with no header/toggle/search input", () => {
    restoreDom = installFakeDom();
    renderer = mount(
      createElement(IconPicker, baseProps({ expanded: true, value: "Star" })),
    );

    assert.equal(
      renderer.root.findAll(
        (i) => typeof i.props["aria-expanded"] === "boolean",
      ).length,
      0,
      "expanded mode has no collapse toggle",
    );
    assert.equal(
      renderer.root.findAll((i) => i.props["aria-label"] === "Search icons")
        .length,
      0,
      "expanded mode has no search input",
    );
    assert.ok(
      renderer.root.find((i) => i.props["aria-label"] === "Remove icon"),
      "expanded mode still shows Remove when a value is set",
    );
  });
});
