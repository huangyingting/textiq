import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
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

test("ThemePreviewPicker opens, searches previews, and applies a theme", () => {
  const changes: string[] = [];
  const openChanges: boolean[] = [];
  const harness = createReactRenderHarness();
  const render = () =>
    ThemePreviewPicker({
      value: neutralTheme.id,
      themes: [neutralTheme, darkTheme, editorialTheme],
      onChange: (packageId) => changes.push(packageId),
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
  assert.deepEqual(changes, [darkTheme.id]);
  assert.deepEqual(openChanges, [true, false]);

  harness.cleanup();
});
