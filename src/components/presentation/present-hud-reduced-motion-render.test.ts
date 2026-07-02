import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildMinimalDeck } from "@/test/builders/presentation-deck";
import { PresentMode } from "./present-mode";
import { PublicPresentViewer } from "./public-present-viewer";

function countOccurrences(value: string, token: string): number {
  return value.split(token).length - 1;
}

describe("presentation present/public reduced-motion classes", () => {
  test("present mode HUD and nav affordances include reduced-motion transition guards", () => {
    const html = renderToStaticMarkup(
      createElement(PresentMode, {
        deck: buildMinimalDeck(),
        onClose: () => undefined,
      }),
    );

    assert.equal(
      countOccurrences(
        html,
        "transition-opacity duration-300 motion-reduce:transition-none",
      ) >= 2,
      true,
    );
    assert.ok(
      html.includes(
        "transition-all duration-300 motion-reduce:transition-none",
      ),
    );
    assert.equal(
      countOccurrences(
        html,
        "transition-opacity motion-reduce:transition-none group-hover:opacity-100 group-focus-visible:opacity-100",
      ) >= 2,
      true,
    );
  });

  test("public viewer HUD and nav affordances include reduced-motion transition guards", () => {
    const html = renderToStaticMarkup(
      createElement(PublicPresentViewer, {
        deck: buildMinimalDeck(),
        title: "Reduced motion check",
      }),
    );

    assert.equal(
      countOccurrences(
        html,
        "transition-opacity duration-300 motion-reduce:transition-none",
      ) >= 2,
      true,
    );
    assert.ok(
      html.includes(
        "transition-all duration-300 motion-reduce:transition-none",
      ),
    );
    assert.equal(
      countOccurrences(
        html,
        "transition-opacity motion-reduce:transition-none group-hover:opacity-100 group-focus-visible:opacity-100",
      ) >= 2,
      true,
    );
  });
});
