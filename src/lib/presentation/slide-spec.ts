import type { SemanticSlideSpecV1, SlotValue } from "./semantic-deck-plan";
import type { SemanticTemplateRegistry } from "./template-registry";
import type {
  SemanticTemplateKind,
  SlideChildNode,
  SlideNode,
  SlotKey,
} from "./schema";
import { createDefaultTemplateRegistry } from "./theme-packages";

const DEFAULT_TEMPLATE_REGISTRY = createDefaultTemplateRegistry();
const TEXT_SLOT_KEYS = new Set<SlotKey>([
  "kicker",
  "title",
  "subtitle",
  "body",
  "leftTitle",
  "leftBody",
  "rightTitle",
  "rightBody",
  "quote",
  "attribution",
  "stat",
  "statLabel",
  "caption",
]);

type TemplateRegistryLookup = Pick<SemanticTemplateRegistry, "get">;

function paragraphText(
  node: Extract<SlideChildNode, { type: "text" }>,
): string {
  return node.content.paragraphs
    .map((paragraph) => paragraph.text)
    .join("\n")
    .trim();
}

function slotKeyForNode(node: SlideChildNode): SlotKey | undefined {
  if (node.slot) return node.slot;
  if (node.role === "title") return "title";
  if (node.role === "subtitle") return "subtitle";
  if (node.role === "kicker") return "kicker";
  if (node.role === "body") return "body";
  if (node.role === "quote") return "quote";
  if (node.role === "attribution") return "attribution";
  if (node.role === "caption") return "caption";
  if (node.role === "metric") return "stat";
  if (node.role === "table") return "table";
  if (node.role === "visual") return "visualId";
  return undefined;
}

function collectSlideSlots(
  nodes: readonly SlideChildNode[],
  slots: Partial<Record<SlotKey, SlotValue>>,
): void {
  for (const node of nodes) {
    const slotKey = slotKeyForNode(node);
    if (slotKey && node.type === "text" && TEXT_SLOT_KEYS.has(slotKey)) {
      const text = paragraphText(node);
      if (text) {
        slots[slotKey] =
          slotKey === "body"
            ? { type: "paragraph", paragraphs: text.split("\n") }
            : { type: "shortText", text };
      }
    } else if (slotKey === "table" && node.type === "table") {
      slots.table = {
        type: "table",
        columns: node.content.columns.map((column) => column.label),
        rows: node.content.rows.map((row) =>
          row.cells.map((cell) => cell.text),
        ),
        ...(node.content.caption ? { caption: node.content.caption } : {}),
      };
    } else if (
      slotKey === "visualId" &&
      node.type === "visual" &&
      node.content.visualId
    ) {
      slots.visualId = { type: "visual", visualId: node.content.visualId };
    }
    if (node.type === "group") {
      collectSlideSlots(node.children, slots);
    }
  }
}

function layoutFor(
  kind: SemanticTemplateKind,
  layoutId: string | undefined,
  templateRegistry: TemplateRegistryLookup,
) {
  const template = templateRegistry.get(kind);
  return template?.layouts.find((candidate) => candidate.id === layoutId);
}

export function slideSpecFromSlide(
  slide: SlideNode,
  kind: SemanticTemplateKind,
  layoutId?: string,
  templateRegistry: TemplateRegistryLookup = DEFAULT_TEMPLATE_REGISTRY,
): SemanticSlideSpecV1 {
  const layout = layoutFor(kind, layoutId, templateRegistry);
  const slots: Partial<Record<SlotKey, SlotValue>> = {};
  collectSlideSlots(slide.children, slots);
  return {
    kind,
    ...(slide.controls?.tone ? { tone: slide.controls.tone } : {}),
    ...(layout?.density[0]
      ? { density: layout.density[0] }
      : slide.controls?.density
        ? { density: slide.controls.density }
        : {}),
    ...(layout?.emphasis[0]
      ? { emphasis: layout.emphasis[0] }
      : slide.controls?.emphasis
        ? { emphasis: slide.controls.emphasis }
        : {}),
    slots,
    ...(slide.notes ? { speakerNotes: slide.notes } : {}),
  };
}

export function emptySlideSpecFromLayout(
  kind: SemanticTemplateKind,
  layoutId?: string,
  templateRegistry: TemplateRegistryLookup = DEFAULT_TEMPLATE_REGISTRY,
): SemanticSlideSpecV1 {
  const layout = layoutFor(kind, layoutId, templateRegistry);
  return {
    kind,
    ...(layout?.density[0] ? { density: layout.density[0] } : {}),
    ...(layout?.emphasis[0] ? { emphasis: layout.emphasis[0] } : {}),
    slots: {},
  };
}
