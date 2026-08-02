import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import type { ThemePackageCatalogEntry } from "@/lib/presentation/theme-package-registry";
import { buildMinimalThemePackage } from "@/test/builders/presentation-deck";
import { createReactRenderHarness } from "@/test/react-render-harness";

import { ThemePreviewPicker } from "./theme-preview-picker";

type ElementLike = ReactElement<Record<string, unknown>>;

function collectElements(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
  collected: ElementLike[] = [],
): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, predicate, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  if (predicate(element)) collected.push(element);
  collectElements(element.props.children as ReactNode, predicate, collected);
  return collected;
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!isValidElement(node)) return "";
  return textContent((node as ElementLike).props.children as ReactNode);
}

function themePackage(
  id: string,
  name: string,
  colors: ThemePackageV1["tokens"]["colors"],
  tagline = "test theme",
): ThemePackageV1 {
  return buildMinimalThemePackage(id, {
    name,
    tagline,
    tokens: {
      colors,
      fonts: { heading: "Inter", body: "Inter" },
    },
  });
}

const neutralTheme = themePackage("neutral", "Neutral", {
  canvas: { fill: "#ffffff", text: "#111111", mutedText: "#666666" },
  surface: { fill: "#f5f5f5", text: "#111111", mutedText: "#666666" },
  accent: { fill: "#4f46e5", text: "#ffffff" },
});

const darkTheme = themePackage(
  "dark-aurora",
  "Dark Aurora Corporate",
  {
    canvas: { fill: "#101827", text: "#f8fafc", mutedText: "#7dd3fc" },
    surface: { fill: "#172033", text: "#f8fafc", mutedText: "#7dd3fc" },
    accent: { fill: "#38bdf8", text: "#082f49" },
  },
  "dark executive theme",
);

const editorialTheme = themePackage(
  "editorial",
  "Editorial Serif Luxe",
  {
    canvas: { fill: "#fbf7ef", text: "#261b12", mutedText: "#8b5e34" },
    surface: { fill: "#fffaf2", text: "#261b12", mutedText: "#8b5e34" },
    accent: { fill: "#8b5e34", text: "#fffaf2" },
  },
  "serif magazine theme",
);

function catalogEntry(
  themePackage: ThemePackageV1,
  createdAt: string | null = null,
): ThemePackageCatalogEntry {
  return {
    package: themePackage,
    source: createdAt ? "custom" : "built-in",
    createdAt,
  };
}

test("ThemePreviewPicker opens, searches previews, and applies a theme", () => {
  const changes: string[] = [];
  const openChanges: boolean[] = [];
  const harness = createReactRenderHarness();
  const render = () =>
    ThemePreviewPicker({
      value: {
        packageId: neutralTheme.id,
        packageVersion: neutralTheme.version,
      },
      activeThemePackage: neutralTheme,
      themes: [
        catalogEntry(neutralTheme),
        catalogEntry(darkTheme),
        catalogEntry(editorialTheme),
      ],
      onChange: (selection) =>
        changes.push(`${selection.packageId}@${selection.packageVersion}`),
      onOpenChange: (open) => openChanges.push(open),
      "aria-label": "Deck theme",
    }) as ElementLike;

  let tree = harness.run(render);
  const trigger = tree.props.trigger as ElementLike;
  assert.equal(trigger.props["aria-label"], "Deck theme");
  assert.equal(trigger.props["aria-expanded"], false);
  assert.equal(textContent(trigger).includes("Neutral"), true);

  (trigger.props.onClick as () => void)();
  tree = harness.run(render);
  assert.equal(tree.props.open, true);
  assert.equal(tree.props.restoreFocusOnClose, true);
  assert.ok(tree.props.initialFocusRef);
  assert.match(String(tree.props.className), /w-\[min\(460px/);

  const listbox = collectElements(
    tree.props.children as ReactNode,
    (element) => element.props.role === "listbox",
  )[0];
  assert.match(String(listbox.props.className), /sm:grid-cols-2/);
  assert.doesNotMatch(String(listbox.props.className), /lg:grid-cols-3/);

  const search = collectElements(
    tree.props.children as ReactNode,
    (element) => element.type === "input",
  )[0];
  (search.props.onChange as (event: unknown) => void)({
    currentTarget: { value: "dark" },
  });
  tree = harness.run(render);
  const darkOption = collectElements(
    tree.props.children as ReactNode,
    (element) =>
      element.type === "button" &&
      element.props.role === "option" &&
      textContent(element).includes("Dark Aurora Corporate"),
  )[0];
  assert.ok(darkOption);
  assert.equal(
    textContent(tree.props.children as ReactNode).includes("Neutral"),
    false,
  );

  (darkOption.props.onClick as () => void)();
  tree = harness.run(render);
  assert.equal(tree.props.open, false);
  assert.deepEqual(changes, [`${darkTheme.id}@${darkTheme.version}`]);
  assert.deepEqual(openChanges, [true, false]);

  harness.cleanup();
});

test("ThemePreviewPicker exposes pressed filters and searches custom metadata", () => {
  const harness = createReactRenderHarness();
  const customTheme = {
    ...themePackage(
      "brand-kit:user-user-1:executive",
      "Executive Custom",
      {
        canvas: { fill: "#123456", text: "#ffffff", mutedText: "#cbd5e1" },
        surface: { fill: "#234567", text: "#ffffff", mutedText: "#cbd5e1" },
        accent: { fill: "#ff8800", text: "#111111" },
      },
      "Boardroom identity",
    ),
    tokens: {
      ...neutralTheme.tokens,
      colors: {
        canvas: { fill: "#123456", text: "#ffffff", mutedText: "#cbd5e1" },
        surface: { fill: "#234567", text: "#ffffff", mutedText: "#cbd5e1" },
        accent: { fill: "#ff8800", text: "#111111" },
      },
      fonts: { heading: "Aptos Display", body: "Aptos" },
    },
  };
  const render = () =>
    ThemePreviewPicker({
      value: {
        packageId: neutralTheme.id,
        packageVersion: neutralTheme.version,
      },
      activeThemePackage: neutralTheme,
      themes: [
        catalogEntry(neutralTheme),
        catalogEntry(darkTheme),
        catalogEntry(editorialTheme),
        catalogEntry(customTheme, "2026-02-03T04:05:06.000Z"),
      ],
      onChange: () => undefined,
      "aria-label": "Deck theme",
    }) as ElementLike;

  let tree = harness.run(render);
  const filterButtons = collectElements(
    tree.props.children as ReactNode,
    (element) =>
      element.type === "button" &&
      ["All", "Recent", "Editorial", "Dark", "High contrast"].includes(
        textContent(element),
      ),
  );
  assert.equal(filterButtons[0]?.props["aria-pressed"], true);
  assert.equal(filterButtons[1]?.props["aria-pressed"], false);

  (filterButtons[1]?.props.onClick as () => void)();
  tree = harness.run(render);
  assert.equal(
    textContent(tree.props.children as ReactNode).includes("Executive Custom"),
    true,
  );
  assert.equal(
    textContent(tree.props.children as ReactNode).includes(
      "Dark Aurora Corporate",
    ),
    false,
  );

  const filtersAfterRecent = collectElements(
    tree.props.children as ReactNode,
    (element) =>
      element.type === "button" &&
      ["All", "Recent", "Editorial", "Dark", "High contrast"].includes(
        textContent(element),
      ),
  );
  (filtersAfterRecent[3]?.props.onClick as () => void)();
  tree = harness.run(render);
  const toggledFilters = collectElements(
    tree.props.children as ReactNode,
    (element) =>
      element.type === "button" &&
      ["All", "Recent", "Editorial", "Dark", "High contrast"].includes(
        textContent(element),
      ),
  );
  assert.equal(toggledFilters[0]?.props["aria-pressed"], false);
  assert.equal(toggledFilters[3]?.props["aria-pressed"], true);

  (toggledFilters[0]?.props.onClick as () => void)();
  tree = harness.run(render);
  const search = collectElements(
    tree.props.children as ReactNode,
    (element) => element.type === "input",
  )[0];
  (search.props.onChange as (event: unknown) => void)({
    currentTarget: { value: "aptos" },
  });
  tree = harness.run(render);
  assert.equal(
    textContent(tree.props.children as ReactNode).includes("Executive Custom"),
    true,
  );
  assert.equal(
    textContent(tree.props.children as ReactNode).includes("custom"),
    true,
  );
  assert.doesNotMatch(String(search.props.placeholder), /owner/i);
  harness.cleanup();
});

test("ThemePreviewPicker labels unavailable values and opens customization after closing", () => {
  const openChanges: boolean[] = [];
  let customizeCalls = 0;
  const harness = createReactRenderHarness();
  const render = () =>
    ThemePreviewPicker({
      value: { packageId: "missing-theme", packageVersion: "1.0.0" },
      activeThemePackage: {
        ...neutralTheme,
        id: "missing-theme",
        name: "Unavailable theme (missing-theme)",
      },
      themes: [catalogEntry(neutralTheme), catalogEntry(darkTheme)],
      onChange: () => undefined,
      onOpenChange: (open) => openChanges.push(open),
      onCustomize: () => {
        customizeCalls += 1;
      },
      "aria-label": "Deck theme",
    }) as ElementLike;

  let tree = harness.run(render);
  assert.equal(
    textContent(tree.props.trigger as ReactNode).includes(
      "Unavailable theme (missing-theme)",
    ),
    true,
  );
  ((tree.props.trigger as ElementLike).props.onClick as () => void)();
  tree = harness.run(render);
  const customize = collectElements(
    tree.props.children as ReactNode,
    (element) => element.props.children === "Customize theme",
  )[0];
  (customize.props.onClick as () => void)();

  assert.equal(customizeCalls, 0);
  tree = harness.run(render);
  assert.equal(customizeCalls, 1);
  assert.deepEqual(openChanges, [true, false]);
  harness.cleanup();
});

test("ThemePreviewPicker selects a newer catalog version even when its package id matches the active exact version", () => {
  const active = {
    ...neutralTheme,
    id: "brand-kit:user-1:shared",
    version: "1.0.0",
  };
  const latest = {
    ...active,
    version: "2.0.0",
    name: "Shared brand latest",
  };
  const changes: unknown[] = [];
  const harness = createReactRenderHarness();
  const render = () =>
    ThemePreviewPicker({
      value: { packageId: active.id, packageVersion: active.version },
      activeThemePackage: active,
      themes: [catalogEntry(latest, "2026-04-01T00:00:00.000Z")],
      onChange: (selection) => changes.push(selection),
      "aria-label": "Deck theme",
    }) as ElementLike;

  let tree = harness.run(render);
  ((tree.props.trigger as ElementLike).props.onClick as () => void)();
  tree = harness.run(render);
  const latestOption = collectElements(
    tree.props.children as ReactNode,
    (element) => element.props.role === "option",
  )[0];
  assert.equal(latestOption.props["aria-selected"], false);
  (latestOption.props.onClick as () => void)();
  assert.deepEqual(changes, [
    { packageId: latest.id, packageVersion: latest.version },
  ]);
  harness.cleanup();
});
