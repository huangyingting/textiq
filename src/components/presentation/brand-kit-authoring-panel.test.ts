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
import { SelectMenu } from "@/components/ui/select-menu";
import { createReactRenderHarness } from "@/test/react-render-harness";
import type { SaveBrandKitDraftResult } from "@/lib/action-ports";

type ElementLike = ReactElement<Record<string, unknown>>;

function createHookRenderer() {
  return createReactRenderHarness();
}

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
    ((event: { currentTarget: { value: string } }) => void) | undefined;
  assert.equal(typeof onChange, "function");
  onChange?.({ currentTarget: { value } });
}

function changeSelectValue(element: ElementLike, value: string): void {
  const onChange = element.props.onChange as
    ((value: string) => void) | undefined;
  assert.equal(typeof onChange, "function");
  onChange?.(value);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
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

  assert.match(html, /Customize theme/);
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
      catalogEntry: {
        package: {} as Awaited<
          ReturnType<
            NonNullable<
              Parameters<typeof BrandKitAuthoringPanel>[0]["saveBrandKitDraft"]
            >
          >
        > extends { ok: true; package: infer ThemePackage }
          ? ThemePackage
          : never,
        source: "custom" as const,
        createdAt: "2026-02-03T04:05:06.000Z",
      },
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
  changeSelectValue(
    firstElement(
      tree,
      (element) =>
        element.type === SelectMenu && element.props.value === "subtle",
    ),
    "expressive",
  );
  tree = render();
  changeSelectValue(
    firstElement(
      tree,
      (element) =>
        element.type === SelectMenu && element.props.value === "default",
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

  const savedHtml = renderToStaticMarkup(tree);
  assert.match(savedHtml, /Saved pkg-executive-kit @ 2.0.0/);
  assert.match(savedHtml, /role="status"/);
  assert.match(savedHtml, /aria-live="polite"/);
  assert.deepEqual(saved, ["Executive Kit", "pkg-executive-kit"]);
  assert.equal(closeCalls, 0);
});

test("BrandKitAuthoringPanel surfaces immutable version conflicts", async () => {
  const harness = createHookRenderer();
  const render = () =>
    harness.run(() =>
      BrandKitAuthoringPanel({
        ownerId: "user-1",
        saveBrandKitDraft: async () => ({
          ok: false,
          diagnostics: [
            {
              severity: "error",
              code: "package-version-exists",
              message:
                "This theme package version already exists with different content. Increment Version before saving.",
              path: "version",
            },
          ],
        }),
        onClose: () => undefined,
      }),
    );

  let tree = render();
  const onClick = firstElement(
    tree,
    (element) => element.props.children === "Save brand kit",
  ).props.onClick as () => Promise<void>;
  await onClick();
  tree = render();

  assert.match(renderToStaticMarkup(tree), /Increment Version before saving/);
  harness.cleanup();
});

test("BrandKitAuthoringPanel serializes duplicate saves and locks editing until settlement", async () => {
  const harness = createHookRenderer();
  const gate = deferred<SaveBrandKitDraftResult>();
  let calls = 0;
  let savedPackageId = "";
  const render = () =>
    harness.run(() =>
      BrandKitAuthoringPanel({
        ownerId: "user-1",
        saveBrandKitDraft: async () => {
          calls += 1;
          return gate.promise;
        },
        onSaved: (result) => {
          savedPackageId = result.packageId;
        },
        onClose: () => undefined,
      }),
    );

  try {
    let tree = render();
    const save = firstElement(
      tree,
      (element) => element.props.children === "Save brand kit",
    ).props.onClick as () => Promise<void>;
    const first = save();
    const duplicate = save();

    assert.equal(calls, 1);
    tree = render();
    const savingButton = firstElement(
      tree,
      (element) => element.props.children === "Saving…",
    );
    assert.equal(savingButton.props.disabled, true);
    assert.equal(
      firstElement(tree, (element) => element.props.children === "Close").props
        .disabled,
      true,
    );
    assert.equal(
      firstElement(tree, (element) => element.type === "input").props.disabled,
      true,
    );

    const draft = createDefaultBrandKitDraft({ ownerId: "user-1" });
    const packageId = "brand-kit:user-user-1:custom-brand-kit";
    gate.resolve({
      ok: true,
      draftId: draft.id,
      packageId,
      packageVersion: draft.version,
      package: {} as Extract<SaveBrandKitDraftResult, { ok: true }>["package"],
      catalogEntry: {
        package: {} as Extract<
          SaveBrandKitDraftResult,
          { ok: true }
        >["package"],
        source: "custom",
        createdAt: "2026-02-03T04:05:06.000Z",
      },
      diagnostics: [],
    });
    await Promise.all([first, duplicate]);
    assert.equal(savedPackageId, packageId);
  } finally {
    harness.cleanup();
  }
});

test("BrandKitAuthoringPanel turns a rejected save into visible retryable feedback", async () => {
  const harness = createHookRenderer();
  const draft = createDefaultBrandKitDraft({ ownerId: "user-1" });
  const packageId = "brand-kit:user-user-1:custom-brand-kit";
  let calls = 0;
  let savedPackageId = "";
  const render = () =>
    harness.run(() =>
      BrandKitAuthoringPanel({
        ownerId: "user-1",
        saveBrandKitDraft: async () => {
          calls += 1;
          if (calls === 1) throw new Error("connection reset");
          return {
            ok: true,
            draftId: draft.id,
            packageId,
            packageVersion: draft.version,
            package: {} as Extract<
              SaveBrandKitDraftResult,
              { ok: true }
            >["package"],
            catalogEntry: {
              package: {} as Extract<
                SaveBrandKitDraftResult,
                { ok: true }
              >["package"],
              source: "custom",
              createdAt: "2026-02-03T04:05:06.000Z",
            },
            diagnostics: [],
          };
        },
        onSaved: (result) => {
          savedPackageId = result.packageId;
        },
        onClose: () => undefined,
      }),
    );

  try {
    let tree = render();
    const save = firstElement(
      tree,
      (element) => element.props.children === "Save brand kit",
    ).props.onClick as () => Promise<void>;
    await assert.doesNotReject(save());

    tree = render();
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Could not save the brand kit\. Please try again\./);
    assert.match(html, /role="alert"/);
    assert.match(html, /Try save again/);
    assert.doesNotMatch(html, /Saving…/);

    const retry = firstElement(
      tree,
      (element) => element.props.children === "Try save again",
    ).props.onClick as () => Promise<void>;
    await retry();

    tree = render();
    assert.equal(calls, 2);
    assert.equal(savedPackageId, packageId);
    assert.match(renderToStaticMarkup(tree), /Saved .*custom-brand-kit/);
  } finally {
    harness.cleanup();
  }
});

test("BrandKitAuthoringPanel ignores a successful save after unmount", async () => {
  const harness = createHookRenderer();
  const gate = deferred<SaveBrandKitDraftResult>();
  let onSavedCalls = 0;
  const tree = harness.run(() =>
    BrandKitAuthoringPanel({
      ownerId: "user-1",
      saveBrandKitDraft: async () => gate.promise,
      onSaved: () => {
        onSavedCalls += 1;
      },
      onClose: () => undefined,
    }),
  );
  const save = firstElement(
    tree,
    (element) => element.props.children === "Save brand kit",
  ).props.onClick as () => Promise<void>;
  const request = save();
  harness.cleanup();

  const draft = createDefaultBrandKitDraft({ ownerId: "user-1" });
  gate.resolve({
    ok: true,
    draftId: draft.id,
    packageId: "brand-kit:user-user-1:custom-brand-kit",
    packageVersion: draft.version,
    package: {} as Extract<SaveBrandKitDraftResult, { ok: true }>["package"],
    catalogEntry: {
      package: {} as Extract<SaveBrandKitDraftResult, { ok: true }>["package"],
      source: "custom",
      createdAt: "2026-02-03T04:05:06.000Z",
    },
    diagnostics: [],
  });
  await request;

  assert.equal(onSavedCalls, 0);
});
