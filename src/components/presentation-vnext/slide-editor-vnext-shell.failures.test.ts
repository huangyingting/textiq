import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ReactNode } from "react";

import {
  SlideEditorVNext,
  type SlideEditorVNextProps,
} from "./slide-editor-vnext";
import {
  buildEditorDeck,
  collectElements,
  createHookRenderer,
  findRequiredElement,
  flattenText,
  flushAsyncWork,
} from "./slide-editor-vnext-failure-test-utils";

describe("SlideEditorVNext shell failures", () => {
  test("shows role=alert export failures and clears the banner on retry", async () => {
    const hookRenderer = createHookRenderer();
    let exportAttempts = 0;

    const props: SlideEditorVNextProps = {
      documentId: "doc-1",
      deck: buildEditorDeck(),
      onDeckChange: () => undefined,
      onExportPptx: async () => {
        exportAttempts += 1;
        if (exportAttempts === 1) throw new Error("export failed");
      },
    };

    let tree = hookRenderer.run(() => SlideEditorVNext(props));
    const exportButton = findRequiredElement(
      tree,
      (element) => {
        const buttonProps = element.props as {
          "aria-label"?: string;
          label?: string;
          role?: string;
          children?: ReactNode;
        };
        return (
          buttonProps.label === "Export as PPTX" ||
          buttonProps["aria-label"] === "Export as PPTX" ||
          (element.type === "button" &&
            buttonProps.role === "menuitem" &&
            flattenText(buttonProps.children).includes("Export PPTX"))
        );
      },
      "Expected export command to render.",
    );

    const clickExport = (exportButton.props as { onClick?: () => void })
      .onClick;
    assert.equal(typeof clickExport, "function");
    clickExport?.();
    await flushAsyncWork();

    tree = hookRenderer.run(() => SlideEditorVNext(props));
    const exportAlert = findRequiredElement(
      tree,
      (element) =>
        element.type === "div" &&
        (element.props as { role?: string }).role === "alert",
      "Expected export failure alert banner.",
    );
    assert.match(
      flattenText(exportAlert),
      /PPTX export failed\. Please try again\./,
    );

    clickExport?.();
    await flushAsyncWork();

    tree = hookRenderer.run(() => SlideEditorVNext(props));
    const lingeringAlerts = collectElements(
      tree,
      (element) =>
        element.type === "div" &&
        (element.props as { role?: string }).role === "alert",
    );
    assert.equal(
      lingeringAlerts.length,
      0,
      "Expected export retry to clear the alert banner.",
    );
  });

  test("gates present/share roundtrip callbacks behind save success", async () => {
    const hookRenderer = createHookRenderer();
    let saveAttempts = 0;
    let presentAttempts = 0;
    let shareAttempts = 0;

    const props: SlideEditorVNextProps = {
      documentId: "doc-1",
      deck: buildEditorDeck(),
      onDeckChange: () => undefined,
      onSave: async () => {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          return { ok: false, error: "Save failed before routing." };
        }
        return { ok: true, data: undefined };
      },
      onPresent: async () => {
        presentAttempts += 1;
        return { ok: true, data: undefined };
      },
      onShare: async () => {
        shareAttempts += 1;
        return { ok: true, data: undefined };
      },
    };

    let tree = hookRenderer.run(() => SlideEditorVNext(props));
    const presentButton = findRequiredElement(
      tree,
      (element) =>
        (element.props as { "aria-label"?: string; label?: string })[
          "aria-label"
        ] === "Present slides" ||
        (element.props as { label?: string }).label === "Present slides",
      "Expected present roundtrip button.",
    );
    const shareButton = findRequiredElement(
      tree,
      (element) =>
        (element.props as { "aria-label"?: string; label?: string })[
          "aria-label"
        ] === "Share slides" ||
        (element.props as { label?: string }).label === "Share slides",
      "Expected share roundtrip button.",
    );

    const clickPresent = (presentButton.props as { onClick?: () => void })
      .onClick;
    const clickShare = (shareButton.props as { onClick?: () => void }).onClick;
    assert.equal(typeof clickPresent, "function");
    assert.equal(typeof clickShare, "function");

    clickPresent?.();
    await flushAsyncWork();
    assert.equal(
      presentAttempts,
      0,
      "Present callback should not run when save fails.",
    );

    tree = hookRenderer.run(() => SlideEditorVNext(props));
    const firstAlert = findRequiredElement(
      tree,
      (element) =>
        element.type === "div" &&
        (element.props as { role?: string }).role === "alert",
      "Expected toolbar failure alert after failed save.",
    );
    assert.match(flattenText(firstAlert), /Save failed before routing\./);

    clickShare?.();
    await flushAsyncWork();
    assert.equal(shareAttempts, 1);
    assert.equal(presentAttempts, 0);
  });
});
