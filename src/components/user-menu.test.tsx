/**
 * Direct behavior coverage for `UserMenu` (#1964) — the header's user
 * dropdown (display name/avatar initial, Settings link, sign-out slot) and
 * its ref-containment "click outside to close" pattern (per AGENTS.md).
 *
 * Mounted directly with `react-test-renderer` (no portal — the dropdown is a
 * plain absolutely-positioned `<div>`, not a `createPortal`). A `document`
 * fake built from the shared `@/test/event-target-double` trackable
 * registry replaces `@/test/portal-dom`'s no-op listener stand-in (which
 * exists specifically so Escape/focus-trap mechanics stay owned by
 * `DrawerSurface`/`ModalSurface` — irrelevant here, since `UserMenu` never
 * renders either) so a real `click` event can be dispatched and the
 * open/close + listener-cleanup contract asserted directly. `createNodeMock`
 * supplies the `menuRef` div a minimal fake node whose `contains` method is
 * test-controlled, standing in for the real DOM containment check
 * `onDocClick` performs.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import {
  act,
  create,
  type ReactTestRenderer,
  type TestRendererOptions,
} from "react-test-renderer";

import { createBrowserGlobalInstaller } from "@/test/browser-globals";
import { createTrackedEventTarget } from "@/test/event-target-double";

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

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// `next/link`'s `<Link>` (the Settings item) mounts a `useIntersection`
// effect that calls the browser-only `self.setTimeout` (via
// `requestIdleCallback`); polyfill `globalThis.self` for this suite's
// duration so that effect resolves against Node's real `setTimeout` instead
// of throwing `ReferenceError: self is not defined` (same fix as
// `src/app/error.test.tsx`).
const globalForSelf = globalThis as unknown as Record<string, unknown>;
let hadSelf = false;
let previousSelf: unknown;
before(() => {
  hadSelf = "self" in globalForSelf;
  previousSelf = globalForSelf.self;
  globalForSelf.self = globalThis;
});
after(() => {
  if (hadSelf) {
    globalForSelf.self = previousSelf;
  } else {
    delete globalForSelf.self;
  }
});

let UserMenu: typeof import("./user-menu").UserMenu;
before(async () => {
  UserMenu = (await import("./user-menu")).UserMenu;
});

const INSIDE_TARGET = { marker: "inside" };
const OUTSIDE_TARGET = { marker: "outside" };

function setupDocument() {
  const installer = createBrowserGlobalInstaller(["document"]);
  const docTarget = createTrackedEventTarget();
  const documentDouble = {
    addEventListener: docTarget.addEventListener,
    removeEventListener: docTarget.removeEventListener,
    activeElement: null as unknown,
  };
  installer.define("document", documentDouble);
  return { installer, docTarget, documentDouble };
}

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function mount(
  dom: ReturnType<typeof setupDocument>,
  props: { name: string | null; email: string },
  focusCalls: string[] = [],
  children = <div data-testid="signout-slot">Sign out</div>,
  menuItemLabels = ["Settings"],
): ReactTestRenderer {
  const menuItemNodes = menuItemLabels.map((label) => {
    const node = {
      focus: () => {
        focusCalls.push(label);
        dom.documentDouble.activeElement = node;
      },
      hasAttribute: () => false,
      getAttribute: () => null,
    };
    return node;
  });
  let renderer!: ReactTestRenderer;
  const createNodeMock: TestRendererOptions["createNodeMock"] = (element) => {
    const elementProps = element.props as {
      role?: string;
      children?: unknown;
    };
    if (elementProps.role === "menu") {
      return { querySelectorAll: () => menuItemNodes };
    }
    if (elementProps.role === "menuitem") {
      const children = Array.isArray(elementProps.children)
        ? elementProps.children
        : [elementProps.children];
      const label = children
        .filter(
          (child: unknown): child is string | number =>
            typeof child === "string" || typeof child === "number",
        )
        .join("");
      return menuItemNodes.find((_, index) =>
        label.includes(menuItemLabels[index] ?? ""),
      );
    }
    return element.type === "button"
      ? {
          focus: () => {
            focusCalls.push("trigger");
            dom.documentDouble.activeElement = null;
          },
        }
      : { contains: (target: unknown) => target === INSIDE_TARGET };
  };
  act(() => {
    renderer = create(<UserMenu {...props}>{children}</UserMenu>, {
      createNodeMock,
    });
  });
  cleanup = () => {
    act(() => renderer.unmount());
    dom.installer.restore();
  };
  return renderer;
}

function toggleButton(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ "aria-label": "User menu" });
}

describe("UserMenu — display name and avatar", () => {
  test("uses the trimmed name and its uppercase initial when a name is present", () => {
    const dom = setupDocument();
    const renderer = mount(dom, { name: "  Jane Doe  ", email: "jane@x.com" });
    assert.match(JSON.stringify(renderer.toJSON()), /Jane Doe/);
    const avatar = renderer.root.find(
      (el) => el.props["aria-hidden"] === "true" && el.type === "span",
    );
    assert.equal(avatar.children.join(""), "J");
  });

  test("falls back to the email when name is null", () => {
    const dom = setupDocument();
    const renderer = mount(dom, { name: null, email: "avery@x.com" });
    assert.match(JSON.stringify(renderer.toJSON()), /avery@x\.com/);
  });

  test("falls back to the email when name is blank/whitespace-only", () => {
    const dom = setupDocument();
    const renderer = mount(dom, { name: "   ", email: "blank@x.com" });
    assert.match(JSON.stringify(renderer.toJSON()), /blank@x\.com/);
  });
});

describe("UserMenu — open/close", () => {
  test("starts closed: no menu role, aria-expanded=false, no document listener registered", () => {
    const dom = setupDocument();
    const renderer = mount(dom, { name: "Jane", email: "jane@x.com" });
    assert.equal(toggleButton(renderer).props["aria-expanded"], false);
    assert.throws(() => renderer.root.findByProps({ role: "menu" }));
    assert.equal(dom.docTarget.listenerCount("click"), 0);
  });

  test("clicking the toggle opens the menu, sets aria-expanded, renders Settings + children, and registers the document click listener", () => {
    const dom = setupDocument();
    const renderer = mount(dom, { name: "Jane", email: "jane@x.com" });

    act(() => {
      (toggleButton(renderer).props.onClick as () => void)();
    });

    assert.equal(toggleButton(renderer).props["aria-expanded"], true);
    assert.ok(renderer.root.findByProps({ role: "menu" }));
    assert.ok(renderer.root.findByProps({ "data-testid": "signout-slot" }));
    assert.equal(dom.docTarget.listenerCount("click"), 1);
  });

  test("opening the menu focuses its first item and Arrow/Home/End keys traverse menu items", () => {
    const dom = setupDocument();
    const focusCalls: string[] = [];
    const renderer = mount(
      dom,
      { name: "Jane", email: "jane@x.com" },
      focusCalls,
      <>
        <button role="menuitem">Billing &amp; Plan</button>
        <button role="menuitem">Sign out</button>
      </>,
      ["Settings", "Billing & Plan", "Sign out"],
    );

    act(() => {
      (toggleButton(renderer).props.onClick as () => void)();
    });
    assert.deepEqual(focusCalls, ["Settings"]);

    const container = renderer.root.find(
      (element) =>
        element.type === "div" && element.props.className === "relative",
    );
    const press = (key: string) => {
      let prevented = false;
      act(() => {
        container.props.onKeyDown({
          key,
          preventDefault: () => {
            prevented = true;
          },
          stopPropagation: () => {},
        });
      });
      assert.equal(prevented, true);
    };

    press("ArrowDown");
    press("End");
    press("ArrowDown");
    press("Home");
    press("ArrowUp");
    assert.deepEqual(focusCalls, [
      "Settings",
      "Billing & Plan",
      "Sign out",
      "Settings",
      "Settings",
      "Sign out",
    ]);
  });

  test("ArrowUp on the closed trigger opens at the last item, and Tab closes without trapping focus", () => {
    const dom = setupDocument();
    const focusCalls: string[] = [];
    const renderer = mount(
      dom,
      { name: "Jane", email: "jane@x.com" },
      focusCalls,
      <>
        <button role="menuitem">Billing &amp; Plan</button>
        <button role="menuitem">Sign out</button>
      </>,
      ["Settings", "Billing & Plan", "Sign out"],
    );
    let triggerPrevented = false;
    act(() => {
      toggleButton(renderer).props.onKeyDown({
        key: "ArrowUp",
        preventDefault: () => {
          triggerPrevented = true;
        },
        stopPropagation: () => {},
      });
    });
    assert.equal(triggerPrevented, true);
    assert.deepEqual(focusCalls, ["Sign out"]);

    const container = renderer.root.find(
      (element) =>
        element.type === "div" && element.props.className === "relative",
    );
    let tabPrevented = false;
    act(() => {
      container.props.onKeyDown({
        key: "Tab",
        preventDefault: () => {
          tabPrevented = true;
        },
        stopPropagation: () => {},
      });
    });
    assert.equal(tabPrevented, false);
    assert.equal(toggleButton(renderer).props["aria-expanded"], false);
  });

  test("selecting a child-supplied menu item closes the delegated popup", () => {
    const dom = setupDocument();
    const renderer = mount(dom, { name: "Jane", email: "jane@x.com" });
    act(() => {
      (toggleButton(renderer).props.onClick as () => void)();
    });
    const menu = renderer.root.findByProps({ role: "menu" });
    act(() => {
      menu.props.onClick({
        target: {
          closest: (selector: string) =>
            selector === '[role="menuitem"]' ? {} : null,
        },
      });
    });
    assert.equal(toggleButton(renderer).props["aria-expanded"], false);
  });

  test("clicking the toggle again closes the menu and removes the document listener", () => {
    const dom = setupDocument();
    const renderer = mount(dom, { name: "Jane", email: "jane@x.com" });

    act(() => {
      (toggleButton(renderer).props.onClick as () => void)();
    });
    act(() => {
      (toggleButton(renderer).props.onClick as () => void)();
    });

    assert.equal(toggleButton(renderer).props["aria-expanded"], false);
    assert.throws(() => renderer.root.findByProps({ role: "menu" }));
    assert.equal(dom.docTarget.listenerCount("click"), 0);
  });

  test("Escape closes the menu, stops the key event, and restores focus to the trigger", () => {
    const dom = setupDocument();
    const focusCalls: string[] = [];
    const renderer = mount(
      dom,
      { name: "Jane", email: "jane@x.com" },
      focusCalls,
    );
    act(() => {
      (toggleButton(renderer).props.onClick as () => void)();
    });

    const container = renderer.root.find(
      (element) =>
        element.type === "div" && element.props.className === "relative",
    );
    let prevented = false;
    let stopped = false;
    act(() => {
      container.props.onKeyDown({
        key: "Escape",
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation: () => {
          stopped = true;
        },
      });
    });

    assert.equal(toggleButton(renderer).props["aria-expanded"], false);
    assert.throws(() => renderer.root.findByProps({ role: "menu" }));
    assert.equal(dom.docTarget.listenerCount("click"), 0);
    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.deepEqual(focusCalls, ["Settings", "trigger"]);
  });

  test("a document click outside the menu closes it", () => {
    const dom = setupDocument();
    const renderer = mount(dom, { name: "Jane", email: "jane@x.com" });
    act(() => {
      (toggleButton(renderer).props.onClick as () => void)();
    });
    assert.equal(toggleButton(renderer).props["aria-expanded"], true);

    act(() => {
      dom.docTarget.dispatchEvent({ type: "click", target: OUTSIDE_TARGET });
    });

    assert.equal(toggleButton(renderer).props["aria-expanded"], false);
    assert.equal(dom.docTarget.listenerCount("click"), 0);
  });

  test("a document click inside the menu leaves it open", () => {
    const dom = setupDocument();
    const renderer = mount(dom, { name: "Jane", email: "jane@x.com" });
    act(() => {
      (toggleButton(renderer).props.onClick as () => void)();
    });

    act(() => {
      dom.docTarget.dispatchEvent({ type: "click", target: INSIDE_TARGET });
    });

    assert.equal(toggleButton(renderer).props["aria-expanded"], true);
    assert.equal(dom.docTarget.listenerCount("click"), 1);
  });

  test("clicking the Settings link closes the menu", () => {
    const dom = setupDocument();
    const renderer = mount(dom, { name: "Jane", email: "jane@x.com" });
    act(() => {
      (toggleButton(renderer).props.onClick as () => void)();
    });

    const settingsLink = renderer.root.findByProps({ role: "menuitem" });
    assert.equal(settingsLink.props.href, "/app/settings");
    act(() => {
      (settingsLink.props.onClick as () => void)();
    });

    assert.equal(toggleButton(renderer).props["aria-expanded"], false);
    assert.equal(dom.docTarget.listenerCount("click"), 0);
  });

  test("unmounting while open removes the document listener (no leak)", () => {
    const dom = setupDocument();
    const renderer = mount(dom, { name: "Jane", email: "jane@x.com" });
    act(() => {
      (toggleButton(renderer).props.onClick as () => void)();
    });
    assert.equal(dom.docTarget.listenerCount("click"), 1);

    act(() => renderer.unmount());

    assert.equal(dom.docTarget.listenerCount("click"), 0);
    cleanup = () => dom.installer.restore();
  });
});
