/**
 * Compact, typed deck/slide/element fixture builders shared by the
 * deck-elements.ts and deck-mutation-*.ts kernel test suites (issue #1897).
 *
 * Every builder returns the smallest object that satisfies its type, with
 * caller overrides layered on top via a shallow spread, so each test states
 * only the fields it cares about. Not a `.test.ts` file itself — it carries no
 * `test()` calls and is never picked up by the test runner globs.
 */

import type { Deck, Slide } from "./deck-core";
import type {
  ConnectorElement,
  ConnectorPoint,
  ElementBox,
  ShapeElement,
} from "./deck-elements";

/** A small, deterministic box — 20×20 percent, inset from the slide edges. */
export function makeBox(overrides: Partial<ElementBox> = {}): ElementBox {
  return { x: 10, y: 10, w: 20, h: 20, ...overrides };
}

/** A minimal rectangle {@link ShapeElement} with a deterministic box/zIndex. */
export function makeShape(
  id: string,
  overrides: Partial<Omit<ShapeElement, "id" | "kind">> = {},
): ShapeElement {
  return {
    id,
    kind: "shape",
    box: makeBox(),
    zIndex: 0,
    content: { kind: "shape", shape: "rect" },
    ...overrides,
  };
}

/** A minimal {@link ConnectorElement} between two endpoints. */
export function makeConnector(
  id: string,
  start: ConnectorPoint,
  end: ConnectorPoint,
  overrides: Partial<Omit<ConnectorElement, "id" | "kind">> = {},
): ConnectorElement {
  return {
    id,
    kind: "connector",
    box: makeBox(),
    zIndex: 0,
    content: { kind: "connector", start, end },
    ...overrides,
  };
}

/** A minimal blank {@link Slide}. */
export function makeSlide(overrides: Partial<Slide> = {}): Slide {
  return {
    id: "sl-1",
    index: 0,
    title: "",
    notes: "",
    elements: [],
    ...overrides,
  };
}

/** A minimal single-slide {@link Deck} (unless `slides` is overridden). */
export function makeDeck(
  slides: Slide[] = [makeSlide()],
  overrides: Partial<Deck> = {},
): Deck {
  return { slides, ...overrides };
}
