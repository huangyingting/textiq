import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDeck, buildImageElement, buildSlide } from "@/test/builders/deck";
import {
  canAddImage,
  dataUrlByteSize,
  isEmptyImageSrc,
  MAX_IMAGE_UPLOAD_BYTES,
  TOTAL_IMAGE_BUDGET_BYTES,
  totalInlineImageBytes,
  validateImageFile,
} from "./image-element";

test("isEmptyImageSrc treats nullish and whitespace sources as empty", () => {
  assert.equal(isEmptyImageSrc(undefined), true);
  assert.equal(isEmptyImageSrc(null), true);
  assert.equal(isEmptyImageSrc("   \n"), true);
  assert.equal(isEmptyImageSrc("data:image/png;base64,abc"), false);
});

test("validateImageFile accepts images within budget and explains rejections", () => {
  assert.equal(MAX_IMAGE_UPLOAD_BYTES > 0, true);
  assert.equal(TOTAL_IMAGE_BUDGET_BYTES > MAX_IMAGE_UPLOAD_BYTES, true);
  assert.deepEqual(validateImageFile({ type: "image/png", size: 10 }, 100), {
    ok: true,
  });
  assert.deepEqual(validateImageFile({ type: "text/plain", size: 10 }, 100), {
    ok: false,
    reason: "Please choose an image file.",
  });
  assert.deepEqual(validateImageFile({ type: "image/jpeg", size: 101 }, 100), {
    ok: false,
    reason: "Image must be smaller than 0 MB.",
  });
});

test("dataUrlByteSize only counts inline data urls", () => {
  assert.equal(dataUrlByteSize(undefined), 0);
  assert.equal(dataUrlByteSize(null), 0);
  assert.equal(dataUrlByteSize("https://example.test/image.png"), 0);
  assert.equal(dataUrlByteSize("/asset/image.png"), 0);
  assert.equal(dataUrlByteSize("data:image/png;base64,abc"), 25);
});

test("totalInlineImageBytes counts master, slide background, and slide image data urls only", () => {
  const masterSrc = "data:image/png;base64,master";
  const backgroundSrc = "data:image/png;base64,bg";
  const slideSrc = "data:image/png;base64,slide";
  const deck = buildDeck({
    masters: [
      {
        id: "master-1",
        name: "Master",
        elements: [
          {
            ...buildImageElement({ src: masterSrc }),
            layer: "background",
            locked: true,
            masterChromeKind: "logo",
          },
          {
            ...buildImageElement({ src: "https://example.test/logo.png" }),
            layer: "foreground",
            locked: true,
            masterChromeKind: "footer",
          },
        ],
      },
    ],
    slides: [
      buildSlide({
        designOverrides: { background: { type: "image", url: backgroundSrc } },
        elements: [
          buildImageElement({ src: slideSrc }),
          buildImageElement({ src: "https://example.test/remote.png" }),
          buildImageElement({ content: { kind: "image" } }),
        ],
      }),
      buildSlide({
        designOverrides: {
          background: { type: "solid", color: { value: "#fff" } },
        },
        elements: [],
      }),
    ],
  });

  assert.equal(
    totalInlineImageBytes(deck),
    masterSrc.length + backgroundSrc.length + slideSrc.length,
  );
});

test("canAddImage reports projected totals against the provided budget", () => {
  const deck = buildDeck({
    slides: [
      buildSlide({
        elements: [buildImageElement({ src: "data:image/png;base64,abc" })],
      }),
    ],
  });
  assert.deepEqual(canAddImage(deck, 5, 40), {
    ok: true,
    totalBytes: 30,
    budget: 40,
  });
  assert.deepEqual(canAddImage(deck, 20, 40), {
    ok: false,
    totalBytes: 45,
    budget: 40,
  });
});
