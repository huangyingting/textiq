import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

test("editor forced-colors contract covers stage chrome selectors", () => {
  const css = readSource("src/app/globals.css");

  assert.match(css, /\[data-slide-chrome-frame\]/);
  assert.match(css, /\[data-multi-selection-bounds\]/);
  assert.match(css, /\[data-resize-handle\]/);
  assert.match(css, /\[data-crop-handle\]/);
  assert.match(css, /\[data-connector-endpoint\]/);
  assert.match(css, /\.tiq-stage-snap-guide/);
  assert.match(css, /\.tiq-filmstrip-thumbnail-frame/);
  assert.match(css, /\[aria-current="true"\] \.tiq-filmstrip-thumbnail-frame/);
});

test("editor forced-colors hooks are present on critical affordances", () => {
  const slideEditor = readSource(
    "src/components/presentation/slide-editor.tsx",
  );
  const filmstripSlide = readSource(
    "src/components/presentation/filmstrip/filmstrip-slide.tsx",
  );
  const presentMode = readSource(
    "src/components/presentation/present-mode.tsx",
  );
  const presenterTools = readSource(
    "src/components/presentation/present-mode/presenter-tools.tsx",
  );

  assert.match(slideEditor, /tiq-stage-snap-guide/);
  assert.match(filmstripSlide, /tiq-filmstrip-thumbnail-frame/);
  assert.match(presentMode, /bg-ds-inverse-subtle/);
  assert.match(presentMode, /bg-ds-danger/);
  assert.match(presenterTools, /bg-ds-backdrop-strong/);
  assert.doesNotMatch(presentMode, /bg-red-500|bg-white\/60|amber-400/);
  assert.doesNotMatch(presenterTools, /bg-black\/60|bg-red-400/);
});
