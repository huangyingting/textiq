import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createDefaultBrandKitDraft } from "./brand-kit-authoring-controller";
import { BrandKitAuthoringPanel } from "./brand-kit-authoring-panel";
import { createHookRenderer } from "./slide-editor-failure-test-utils";

type ElementLike = ReactElement<Record<string, unknown>>;

function collectExpandedElements(
  node: ReactNode,
  collected: ElementLike[] = [],
): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) collectExpandedElements(child, collected);
    return collected;
  }
  if (!isValidElement(node)) return collected;
  const element = node as ElementLike;
  collected.push(element);
  if (
    typeof element.type === "function" &&
    ["TextInput", "ColorInput"].includes(element.type.name)
  ) {
    collectExpandedElements(
      (element.type as (props: Record<string, unknown>) => ReactNode)(
        element.props,
      ),
      collected,
    );
  }
  collectExpandedElements(
    (element.props as { children?: ReactNode }).children,
    collected,
  );
  return collected;
}

function firstElement(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
): ElementLike {
  const element = collectExpandedElements(node).find(predicate);
  assert.ok(element);
  return element;
}

function changeValue(element: ElementLike, value: string): void {
  const onChange = element.props.onChange as
    | ((event: { currentTarget: { value: string } }) => void)
    | undefined;
  assert.equal(typeof onChange, "function");
  onChange?.({ currentTarget: { value } });
}

test("BrandKitAuthoringPanel renders authoring controls and compiler diagnostics", () => {
  const invalidDraft = {
    ...createDefaultBrandKitDraft({
      ownerId: "user-1",
      now: "2026-01-01T00:00:00.000Z",
    }),
    slug: "Invalid Slug",
  };

  const html = renderToStaticMarkup(
    createElement(BrandKitAuthoringPanel, {
      ownerId: "user-1",
      initialDraft: invalidDraft,
      onClose: () => undefined,
    }),
  );

  assert.match(html, /Author brand kit/);
  assert.match(html, /Palette roles/);
  assert.match(html, /Typography roles/);
  assert.match(html, /Logo token/);
  assert.match(html, /Decorations/);
  assert.match(html, /slug must be lower-case kebab-case/);
  assert.match(html, /Save action unavailable|compiler error/);
});

test("BrandKitAuthoringPanel updates editable fields and saves valid drafts", async () => {
  const harness = createHookRenderer();
  const saved: string[] = [];
  let closeCalls = 0;
  const saveBrandKitDraft = async (
    draft: ReturnType<typeof createDefaultBrandKitDraft>,
  ) => {
    saved.push(draft.name);
    return {
      ok: true as const,
      draftId: draft.id,
      packageId: `pkg-${draft.slug}`,
      packageVersion: draft.version,
      package: {} as Awaited<
        ReturnType<
          NonNullable<
            Parameters<typeof BrandKitAuthoringPanel>[0]["saveBrandKitDraft"]
          >
        >
      > extends { ok: true; package: infer ThemePackage }
        ? ThemePackage
        : never,
      diagnostics: [],
      draft,
    };
  };
  const render = () =>
    harness.run(() =>
      BrandKitAuthoringPanel({
        ownerId: "user-1",
        saveBrandKitDraft,
        onSaved: (result) => saved.push(result.packageId),
        onClose: () => {
          closeCalls += 1;
        },
      }),
    );

  let tree = render();
  changeValue(
    firstElement(
      tree,
      (element) =>
        element.type === "input" && element.props.value === "Custom Brand Kit",
    ),
    "Executive Kit",
  );
  tree = render();
  changeValue(
    firstElement(
      tree,
      (element) =>
        element.type === "input" && element.props.value === "custom-brand-kit",
    ),
    "executive-kit",
  );
  tree = render();
  changeValue(
    firstElement(
      tree,
      (element) => element.type === "input" && element.props.value === "1.0.0",
    ),
    "2.0.0",
  );
  tree = render();
  changeValue(
    firstElement(
      tree,
      (element) =>
        element.type === "input" &&
        element.props["aria-label"] === "Primary accent hex color",
    ),
    "#123456",
  );
  tree = render();
  changeValue(
    firstElement(
      tree,
      (element) => element.type === "input" && element.props.value === "Inter",
    ),
    "Aptos",
  );
  tree = render();
  changeValue(
    firstElement(
      tree,
      (element) =>
        element.type === "select" && element.props.value === "subtle",
    ),
    "expressive",
  );
  tree = render();
  changeValue(
    firstElement(
      tree,
      (element) =>
        element.type === "select" && element.props.value === "default",
    ),
    "minimal",
  );
  tree = render();

  const onClick = firstElement(
    tree,
    (element) => element.props.children === "Save brand kit",
  ).props.onClick as () => Promise<void>;
  await onClick();
  tree = render();

  assert.match(renderToStaticMarkup(tree), /Saved pkg-executive-kit @ 2.0.0/);
  assert.deepEqual(saved, ["Executive Kit", "pkg-executive-kit"]);
  assert.equal(closeCalls, 0);
});
