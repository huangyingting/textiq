import { DECK_SCHEMA_VERSION, type Deck } from "./schema";

export function createBlankDeck(
  options: { documentId?: string; title?: string } = {},
): Deck {
  return {
    schemaVersion: DECK_SCHEMA_VERSION,
    ...(options.title ? { title: options.title } : {}),
    canvas: { format: "16:9", width: 100, height: 56.25, unit: "percent" },
    theme: { packageId: "neutral" },
    assets: { images: {} },
    slides: [
      {
        id: "slide-blank-1",
        type: "slide",
        template: { kind: "content" },
        style: { ref: "slide.content" },
        children: [],
      },
    ],
    ...(options.documentId
      ? { metadata: { sourceDocumentId: options.documentId } }
      : {}),
  };
}
