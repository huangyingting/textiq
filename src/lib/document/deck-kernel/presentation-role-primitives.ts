/** Leaf theme-token primitive roles shared by elements and token schema. */

export const PRESENTATION_ROLES = [
  "title",
  "subtitle",
  "sectionTitle",
  "body",
  "bullet",
  "quote",
  "caption",
  "footer",
  "label",
  "media",
  "visual",
  "image",
  "table",
  "logo",
  "pageNumber",
  "background",
] as const;

export type PresentationRole = (typeof PRESENTATION_ROLES)[number];
