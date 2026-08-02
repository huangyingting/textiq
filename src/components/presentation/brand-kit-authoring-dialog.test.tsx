import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { createReactRenderHarness } from "@/test/react-render-harness";
import { Dialog } from "@/components/ui";

import { BrandKitAuthoringDialog } from "./brand-kit-authoring-dialog";
import { BrandKitAuthoringPanel } from "./brand-kit-authoring-panel";

type ElementLike = ReactElement<Record<string, unknown>>;

function findElement(
  node: ReactNode,
  predicate: (element: ElementLike) => boolean,
): ElementLike | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate);
      if (match) return match;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  const element = node as ElementLike;
  if (predicate(element)) return element;
  return findElement(element.props.children as ReactNode, predicate);
}

test("BrandKitAuthoringDialog is modal, responsive, and wires save completion", () => {
  const harness = createReactRenderHarness();
  const saved: string[] = [];
  const tree = harness.run(() =>
    BrandKitAuthoringDialog({
      ownerId: "user-1",
      saveBrandKitDraft: async () => ({
        ok: false,
        diagnostics: [],
      }),
      onSaved: (result) => saved.push(result.packageId),
      onClose: () => undefined,
    }),
  );

  const dialog = findElement(tree, (element) => element.type === Dialog);
  assert.ok(dialog);
  assert.equal(dialog.props.open, true);
  assert.equal(dialog.props["aria-labelledby"], "brand-kit-authoring-title");
  assert.match(String(dialog.props.className), /max-w-6xl/);
  assert.match(String(dialog.props.className), /sm:max-h/);

  const panel = findElement(
    tree,
    (element) => element.type === BrandKitAuthoringPanel,
  );
  assert.ok(panel);
  assert.equal(panel.props.ownerId, "user-1");
  assert.equal(typeof panel.props.saveBrandKitDraft, "function");
  assert.equal(typeof panel.props.onSaved, "function");
  assert.deepEqual(saved, []);
  harness.cleanup();
});
