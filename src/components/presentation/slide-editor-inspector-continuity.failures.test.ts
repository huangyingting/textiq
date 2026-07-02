import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ReactElement, ReactNode } from "react";

import { InspectorShell } from "./inspector";
import { SlideEditor, type SlideEditorImageUploadResult } from "./slide-editor";
import { SlideEditorInspectorRegion } from "./slide-editor-regions";
import {
  buildEditorDeck,
  collectElements,
  createHookRenderer,
  findRequiredElement,
  flattenText,
  flushAsyncWork,
  focusNode,
  withWindow,
} from "./slide-editor-failure-test-utils";

describe("SlideEditor inspector continuity failures", () => {
  test("covers image replacement invalid file, upload failure, and successful retry", async () => {
    await withWindow(async () => {
      const hookRenderer = createHookRenderer();
      let currentDeck = buildEditorDeck();
      let uploadAttempts = 0;

      const onUploadImage = async (): Promise<SlideEditorImageUploadResult> => {
        uploadAttempts += 1;
        if (uploadAttempts === 1) {
          throw new Error("upload failed");
        }
        return {
          src: "https://example.com/image-replacement.png",
          assetId: "img-replaced",
          alt: "Replaced image",
        };
      };

      const renderTree = () =>
        hookRenderer.run(() =>
          SlideEditor({
            documentId: "doc-1",
            deck: currentDeck,
            onDeckChange: (nextDeck) => {
              currentDeck = nextDeck;
            },
            onUploadImage,
          }),
        );

      let tree = renderTree();

      focusNode(tree, "image-primary");

      tree = renderTree();

      const hasReplaceImageAction = (element: ReactElement): boolean =>
        element.type === InspectorShell &&
        typeof (element.props as { onReplaceImage?: () => void })
          .onReplaceImage === "function";
      const resolveInspectorSurface = (root: ReactNode): ReactNode => {
        if (collectElements(root, hasReplaceImageAction).length > 0)
          return root;
        const inspectorRegion = findRequiredElement(
          root,
          (element) =>
            element.type === SlideEditorInspectorRegion &&
            typeof (element.props as { renderInspectorShell?: () => ReactNode })
              .renderInspectorShell === "function",
          "Expected inspector region shell renderer.",
        );
        return (
          inspectorRegion.props as { renderInspectorShell: () => ReactNode }
        ).renderInspectorShell();
      };
      const inspectorSurface = resolveInspectorSurface(tree);

      const inspectorShell = findRequiredElement(
        inspectorSurface,
        hasReplaceImageAction,
        "Expected inspector shell replace-image action.",
      );

      const triggerReplaceImage = (
        inspectorShell.props as {
          onReplaceImage?: () => void;
        }
      ).onReplaceImage;
      assert.ok(triggerReplaceImage);

      const fileInput = findRequiredElement(
        tree,
        (element) =>
          element.type === "input" &&
          (element.props as { type?: string }).type === "file",
        "Expected hidden file input for image replacement.",
      );

      const onImageFileChange = (
        fileInput.props as {
          onChange?: (event: {
            currentTarget: {
              files?: File[];
              value: string;
            };
          }) => void;
        }
      ).onChange;
      assert.ok(onImageFileChange);

      triggerReplaceImage?.();
      onImageFileChange?.({
        currentTarget: {
          files: [{ type: "text/plain", name: "not-image.txt" } as File],
          value: "dummy",
        },
      });

      tree = renderTree();
      const invalidTypeAlert = findRequiredElement(
        tree,
        (element) =>
          element.type === "div" &&
          (element.props as { role?: string }).role === "alert",
        "Expected invalid file type alert.",
      );
      assert.match(
        flattenText(invalidTypeAlert),
        /Choose an image file to replace the selected image\./,
      );

      triggerReplaceImage?.();
      onImageFileChange?.({
        currentTarget: {
          files: [{ type: "image/png", name: "upload-fails.png" } as File],
          value: "dummy",
        },
      });
      await flushAsyncWork();

      tree = renderTree();
      const failedUploadAlert = findRequiredElement(
        tree,
        (element) =>
          element.type === "div" &&
          (element.props as { role?: string }).role === "alert",
        "Expected upload failure alert.",
      );
      assert.match(
        flattenText(failedUploadAlert),
        /Image replacement failed\. Please try another file\./,
      );

      triggerReplaceImage?.();
      onImageFileChange?.({
        currentTarget: {
          files: [{ type: "image/png", name: "upload-succeeds.png" } as File],
          value: "dummy",
        },
      });
      await flushAsyncWork();

      tree = renderTree();
      const finalAlerts = collectElements(
        tree,
        (element) =>
          element.type === "div" &&
          (element.props as { role?: string }).role === "alert",
      );
      assert.equal(
        finalAlerts.length,
        0,
        "Expected successful retry to clear alert.",
      );

      const activeSlide = currentDeck.slides[0];
      const replacedNode = activeSlide.children.find(
        (node) => node.id === "image-primary",
      );
      assert.ok(replacedNode && replacedNode.type === "image");
      assert.equal(replacedNode.content.assetId, "img-replaced");

      const selectedInspectorShell = findRequiredElement(
        resolveInspectorSurface(tree),
        (element) => element.type === InspectorShell,
        "Expected inspector shell to remain rendered.",
      );
      assert.deepEqual(
        (selectedInspectorShell.props as { selectedIds?: string[] })
          .selectedIds,
        ["image-primary"],
        "Expected image replacement retry to preserve selected image node.",
      );
    });
  });
});
