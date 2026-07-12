import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BUILT_IN_SLIDE_TEMPLATES,
  buildTemplateSlide,
  getBuiltInSlideTemplate,
} from "./slide-templates";
import type { SlideTemplateKind } from "./slide-templates";
import type {
  ImageElement,
  SlideElement,
  TextElement,
  VisualElement,
} from "./deck-elements";
import type { Slide } from "./deck-core";

/** `buildTemplateSlide` always populates `elements`; narrow away `undefined` for callers. */
function elementsOf(slide: Slide): SlideElement[] {
  return slide.elements ?? [];
}

// ---------------------------------------------------------------------------
// getBuiltInSlideTemplate — canonical lookup and malformed-kind fallback
// ---------------------------------------------------------------------------

test("getBuiltInSlideTemplate returns the matching built-in template for every known kind", () => {
  for (const template of BUILT_IN_SLIDE_TEMPLATES) {
    assert.equal(
      getBuiltInSlideTemplate(template.id as SlideTemplateKind),
      template,
    );
  }
});

test("getBuiltInSlideTemplate throws for an unknown/malformed kind", () => {
  assert.throws(
    () => getBuiltInSlideTemplate("not-a-kind" as SlideTemplateKind),
    /Missing built-in slide template "not-a-kind"/,
  );
});

// ---------------------------------------------------------------------------
// buildTemplateSlide — blank template
// ---------------------------------------------------------------------------

test("buildTemplateSlide('blank') returns an empty slide with no elements", () => {
  const slide = buildTemplateSlide("blank", {});
  assert.equal(slide.title, "");
  assert.equal(slide.notes, "");
  assert.deepEqual(slide.elements, []);
  assert.equal(slide.templateId, undefined);
  assert.ok(slide.id.length > 0);
});

// ---------------------------------------------------------------------------
// buildTemplateSlide — non-blank templates: structure, ids, and templateId
// ---------------------------------------------------------------------------

test("buildTemplateSlide materializes the title template with fresh element ids and sequential zIndex", () => {
  const slide = buildTemplateSlide("title", {});
  assert.equal(slide.templateId, "title");
  assert.equal(elementsOf(slide).length, 2);
  const [titleEl, subtitleEl] = elementsOf(slide) as TextElement[];
  assert.equal(titleEl.role, "title");
  assert.equal(subtitleEl.role, "subtitle");
  assert.equal(titleEl.zIndex, 0);
  assert.equal(subtitleEl.zIndex, 1);
  // Materialized element ids are freshly generated, not the template's literal ids.
  assert.notEqual(titleEl.id, "title-title");
  assert.notEqual(subtitleEl.id, "title-subtitle");
  assert.notEqual(titleEl.id, subtitleEl.id);
});

test("buildTemplateSlide maps the 'visual' template kind to templateId 'media'", () => {
  const slide = buildTemplateSlide("visual", {});
  assert.equal(slide.templateId, "media");
});

test("buildTemplateSlide maps every other non-blank kind's templateId to its own kind", () => {
  for (const kind of ["title", "content", "two-column"] as const) {
    const slide = buildTemplateSlide(kind, {});
    assert.equal(slide.templateId, kind);
  }
});

test("buildTemplateSlide materializes the content template with title, body, and image elements", () => {
  const slide = buildTemplateSlide("content", {});
  assert.equal(elementsOf(slide).length, 3);
  const [titleEl, bodyEl, imageEl] = elementsOf(slide);
  assert.equal((titleEl as TextElement).role, "title");
  assert.equal((bodyEl as TextElement).role, "body");
  assert.equal(imageEl.kind, "image");
  assert.equal((imageEl as ImageElement).content.kind, "image");
});

test("buildTemplateSlide materializes the two-column template with a title and two body columns", () => {
  const slide = buildTemplateSlide("two-column", {});
  assert.equal(elementsOf(slide).length, 3);
  const roles = (elementsOf(slide) as TextElement[]).map((el) => el.role);
  assert.deepEqual(roles, ["title", "body", "body"]);
});

// ---------------------------------------------------------------------------
// buildTemplateSlide — visual-spotlight ctx.visualId branch
// ---------------------------------------------------------------------------

test("buildTemplateSlide('visual') without ctx.visualId materializes an image placeholder", () => {
  const slide = buildTemplateSlide("visual", {});
  const [mediaEl, captionEl] = elementsOf(slide);
  assert.equal(mediaEl.kind, "image");
  assert.equal((mediaEl as ImageElement).content.kind, "image");
  assert.equal((captionEl as TextElement).role, "caption");
});

test("buildTemplateSlide('visual') with ctx.visualId materializes a real visual element bound to that id", () => {
  const slide = buildTemplateSlide("visual", { visualId: "doc-visual-42" });
  const [mediaEl] = elementsOf(slide);
  assert.equal(mediaEl.kind, "visual");
  assert.equal((mediaEl as VisualElement).content.kind, "visual");
  assert.equal((mediaEl as VisualElement).content.visualId, "doc-visual-42");
  assert.equal(mediaEl.role, "visual");
});

test("buildTemplateSlide honors ctx.slideFormat presence without affecting element geometry (percent-based boxes)", () => {
  const slide = buildTemplateSlide("title", { slideFormat: "16:9" as never });
  assert.equal(elementsOf(slide).length, 2);
});

// ---------------------------------------------------------------------------
// Element content/design fidelity
// ---------------------------------------------------------------------------

test("buildTemplateSlide clones paragraph content so mutating one slide's text does not affect another", () => {
  const first = buildTemplateSlide("title", {});
  const second = buildTemplateSlide("title", {});
  const firstTitle = elementsOf(first)[0] as TextElement;
  const secondTitle = elementsOf(second)[0] as TextElement;
  assert.notEqual(firstTitle.content, secondTitle.content);
  if (firstTitle.content.kind === "text" && firstTitle.content.paragraphs) {
    firstTitle.content.paragraphs[0].text = "mutated";
  }
  assert.equal(
    secondTitle.content.kind === "text"
      ? secondTitle.content.paragraphs?.[0].text
      : undefined,
    "Title",
  );
});

test("buildTemplateSlide carries designOverrides.textStyle onto materialized text elements", () => {
  const slide = buildTemplateSlide("title", {});
  const titleEl = elementsOf(slide)[0] as TextElement;
  assert.equal(titleEl.designOverrides?.textStyle?.align, "center");
  assert.equal(titleEl.designOverrides?.textStyle?.bold, true);
});

// ---------------------------------------------------------------------------
// BUILT_IN_SLIDE_TEMPLATES — canonical registry sanity (genuine runtime data
// consumed by getBuiltInSlideTemplate/buildTemplateSlide, not UI-picker data)
// ---------------------------------------------------------------------------

test("BUILT_IN_SLIDE_TEMPLATES has exactly one entry per SlideTemplateKind with a system source", () => {
  const kinds = BUILT_IN_SLIDE_TEMPLATES.map((t) => t.id);
  assert.deepEqual(
    kinds.sort(),
    ["blank", "content", "title", "two-column", "visual"].sort(),
  );
  for (const template of BUILT_IN_SLIDE_TEMPLATES) {
    assert.equal(template.source, "system");
    assert.equal(template.styleMode, "fixed");
  }
});
