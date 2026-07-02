import {
  type SemanticTemplateV1,
  type TemplateGroup,
} from "./template-registry";
import { createDefaultTemplateRegistry } from "./theme-packages";

const VISUAL_DERIVE_TEMPLATE: SemanticTemplateV1 = {
  schemaVersion: 1,
  kind: "visual-focus",
  label: "Deterministic Visual Focus",
  version: "1.0.0",
  group: "explain" satisfies TemplateGroup,
  intent: "Deterministic visual slide for derive-from-document.",
  slots: {
    title: {
      type: "shortText",
      required: false,
      maxChars: 120,
      overflow: "truncateWithNote",
    },
    visualId: {
      type: "visual",
      required: true,
      overflow: "repair",
    },
    caption: {
      type: "shortText",
      required: false,
      maxChars: 200,
      overflow: "truncateWithNote",
    },
  } as SemanticTemplateV1["slots"],
  supports: {
    tone: ["neutral", "confident", "warm", "premium"],
    density: ["normal"],
    emphasis: ["visual"],
  },
  layouts: [
    {
      id: "derive-visual-default",
      density: ["normal"],
      emphasis: ["visual"],
      root: {
        type: "slide",
        style: { ref: "slide.content" },
        children: [
          {
            type: "text",
            role: "title",
            slot: "title",
            style: { ref: "text.title" },
            layout: { frame: { x: 8, y: 6, w: 84, h: 12 }, zIndex: 1 },
          },
          {
            type: "visual",
            role: "visual",
            slot: "visualId",
            style: { ref: "media.inline" },
            layout: { frame: { x: 8, y: 22, w: 84, h: 62 }, zIndex: 2 },
          },
          {
            type: "text",
            role: "caption",
            slot: "caption",
            style: { ref: "text.caption" },
            layout: { frame: { x: 8, y: 86, w: 84, h: 6 }, zIndex: 3 },
          },
        ],
      },
    },
  ],
  selection: {
    priority: 1,
    bestFor: "Deterministic derive visual fallback",
    signals: ["derive", "visual"],
  },
};

export function createDocumentSlidePlanTemplateRegistry() {
  const registry = createDefaultTemplateRegistry();
  registry.register(VISUAL_DERIVE_TEMPLATE);
  return registry;
}
