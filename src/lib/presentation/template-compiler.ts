/**
 * Template compiler for the presentation system.
 *
 * Compiles a `SemanticSlideSpecV1` + `SemanticTemplateV1` into a `SlideNode` tree.
 * The compiler:
 * - Selects the best layout variant for the given controls.
 * - Materialises slot values into node content.
 * - Generates stable node ids (does NOT copy AI-generated ids).
 * - Records slot keys on nodes for future reapply/repair.
 * - Returns diagnostics for every issue.
 */

import type {
  SlideNode,
  SlideChildNode,
  TextNode,
  ImageNode,
  ShapeNode,
  TableNode,
  VisualNode,
  GroupNode,
  TextContent,
  Paragraph,
  TableContent,
  SlotKey,
  SemanticRole,
  SlideControls,
} from "./schema";
import type {
  SemanticSlideSpecV1,
  SlotValue,
  BulletSlotItem,
  TimelineSlotItem,
} from "./semantic-deck-plan";
import type {
  SemanticTemplateV1,
  TemplateNodeBlueprint,
} from "./template-registry";
import { selectLayout } from "./template-registry";
import { layeredZIndexForNodeType } from "./layer-bands";
import type { PresentationDiagnostic } from "./diagnostics";
import { DiagnosticCollector } from "./diagnostics";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _idCounter = 0;

/** Resets the id counter (only for tests). */
export function resetIdCounter(): void {
  _idCounter = 0;
}

function generateNodeId(prefix: string = "node"): string {
  return `${prefix}-${(++_idCounter).toString(36).padStart(4, "0")}`;
}

function generateParagraphId(): string {
  return `para-${(++_idCounter).toString(36).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Content builders
// ---------------------------------------------------------------------------

function buildTextContent(value: SlotValue): TextContent | null {
  if (value.type === "shortText") {
    return {
      paragraphs: [{ id: generateParagraphId(), text: value.text }],
    };
  }
  if (value.type === "paragraph") {
    return {
      paragraphs: value.paragraphs.map((p) => ({
        id: generateParagraphId(),
        text: p,
      })),
    };
  }
  if (value.type === "bullets") {
    const paragraphs: Paragraph[] = [];
    const addItems = (items: BulletSlotItem[], indent = 0) => {
      for (const item of items) {
        paragraphs.push({
          id: generateParagraphId(),
          text: item.text,
          list: { kind: "bullet", indent },
        });
        if (item.children) {
          addItems(item.children, indent + 1);
        }
      }
    };
    addItems(value.items);
    return { paragraphs };
  }
  if (value.type === "metric") {
    return {
      paragraphs: [{ id: generateParagraphId(), text: value.value }],
    };
  }
  return null;
}

function buildTableContent(value: SlotValue): TableContent | null {
  if (value.type !== "table") return null;
  return {
    columns: value.columns.map((label, i) => ({
      id: `col-${i}`,
      label,
    })),
    rows: value.rows.map((cells, ri) => ({
      id: `row-${ri}`,
      cells: cells.map((text) => ({ text })),
    })),
    ...(value.caption ? { caption: value.caption } : {}),
    header: true,
  };
}

function buildTimelineRoleContent(
  items: TimelineSlotItem[],
  role: TemplateNodeBlueprint["role"],
): TextContent | null {
  const texts = items
    .map((item) => {
      if (role === "label") return item.label;
      if (role === "title") return item.title;
      if (role === "body") return item.body;
      return undefined;
    })
    .filter(
      (text): text is string => typeof text === "string" && text.length > 0,
    );

  if (texts.length === 0) return null;
  return {
    paragraphs: texts.map((text) => ({ id: generateParagraphId(), text })),
  };
}

const SLOT_FALLBACK_TEXT: Partial<Record<SlotKey, string>> = {
  kicker: "Kicker",
  title: "Title",
  subtitle: "Subtitle",
  body: "Body text",
  bullets: "Bullet item",
  leftTitle: "Left title",
  leftBody: "Left body",
  leftBullets: "Left bullet item",
  rightTitle: "Right title",
  rightBody: "Right body",
  rightBullets: "Right bullet item",
  cards: "Card text",
  steps: "Step text",
  quote: "Quote",
  attribution: "Attribution",
  stat: "Metric value",
  statLabel: "Metric label",
  metrics: "Metric",
  caption: "Caption",
  table: "Table label",
  visualId: "Visual label",
  imagePrompt: "Image caption",
};

const ROLE_FALLBACK_TEXT: Partial<Record<SemanticRole, string>> = {
  title: "Title",
  subtitle: "Subtitle",
  kicker: "Kicker",
  body: "Body text",
  bullet: "Bullet item",
  caption: "Caption",
  quote: "Quote",
  attribution: "Attribution",
  metric: "Metric value",
  label: "Label",
  card: "Card text",
  callout: "Callout",
};

function humanizeIdentifier(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!spaced) return "Text";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function fallbackTextForBlueprint(blueprint: TemplateNodeBlueprint): string {
  if (blueprint.slot) {
    return (
      SLOT_FALLBACK_TEXT[blueprint.slot] ?? humanizeIdentifier(blueprint.slot)
    );
  }
  if (blueprint.role) {
    return (
      ROLE_FALLBACK_TEXT[blueprint.role] ?? humanizeIdentifier(blueprint.role)
    );
  }
  return "Text";
}

// ---------------------------------------------------------------------------
// Blueprint materialisation
// ---------------------------------------------------------------------------

function materialiseBlueprintNode(
  blueprint: TemplateNodeBlueprint,
  slots: Partial<Record<SlotKey, SlotValue>>,
  dc: DiagnosticCollector,
  slideIndex: number,
): SlideChildNode | null {
  const nodeType = blueprint.type;
  const nodeId = generateNodeId(blueprint.role ?? blueprint.type ?? "node");
  const slotKey = blueprint.slot;
  const slotValue = slotKey ? slots[slotKey] : undefined;
  const layout = blueprint.layout
    ? {
        ...blueprint.layout,
        zIndex: layeredZIndexForNodeType(nodeType, blueprint.layout.zIndex),
      }
    : undefined;

  const baseNode = {
    id: nodeId,
    ...(blueprint.role !== undefined ? { role: blueprint.role } : {}),
    ...(slotKey !== undefined ? { slot: slotKey } : {}),
    ...(layout !== undefined ? { layout } : {}),
    style: blueprint.style,
  };

  if (nodeType === "text") {
    let content: TextContent | null = null;
    if (slotValue) {
      content = buildTextContent(slotValue);
    }
    if (!content) {
      const staticText =
        blueprint.content?.type === "text" ? blueprint.content.text : "";
      content = {
        paragraphs: [
          {
            id: generateParagraphId(),
            text: staticText.trim()
              ? staticText
              : fallbackTextForBlueprint(blueprint),
          },
        ],
      };
    }
    return { ...baseNode, type: "text", content } as TextNode;
  }

  if (nodeType === "image") {
    if (slotValue?.type === "image") {
      return {
        ...baseNode,
        type: "image",
        content: {
          assetId: slotValue.assetId ?? "placeholder",
          ...(slotValue.alt ? { alt: slotValue.alt } : {}),
        },
      } as ImageNode;
    }
    // Placeholder image
    return {
      ...baseNode,
      type: "image",
      content: { assetId: "placeholder" },
    } as ImageNode;
  }

  if (nodeType === "shape") {
    return {
      ...baseNode,
      type: "shape",
      content: { shape: "rect" },
    } as ShapeNode;
  }

  if (nodeType === "table") {
    let content: TableContent | null = slotValue
      ? buildTableContent(slotValue)
      : null;
    if (!content) {
      content = {
        columns: [{ id: "col-0", label: "Column 1" }],
        rows: [{ id: "row-0", cells: [{ text: "" }] }],
      };
    }
    return { ...baseNode, type: "table", content } as TableNode;
  }

  if (nodeType === "visual") {
    const visualId =
      slotValue?.type === "visual" ? slotValue.visualId : undefined;
    const assetId = slotValue?.type === "image" ? slotValue.assetId : undefined;
    return {
      ...baseNode,
      type: "visual",
      content: {
        ...(assetId ? { assetId } : {}),
        ...(visualId ? { visualId } : {}),
      },
    } as VisualNode;
  }

  if (nodeType === "group") {
    const children: SlideChildNode[] = [];
    if (slotValue?.type === "timeline") {
      for (const childBp of blueprint.children ?? []) {
        const child = materialiseBlueprintNode(childBp, slots, dc, slideIndex);
        if (!child) continue;
        if (child.type === "text") {
          const timelineContent = buildTimelineRoleContent(
            slotValue.items,
            childBp.role,
          );
          if (timelineContent) {
            children.push({
              ...child,
              content: timelineContent,
            });
            continue;
          }
        }
        children.push(child);
      }
    } else {
      for (const childBp of blueprint.children ?? []) {
        const child = materialiseBlueprintNode(childBp, slots, dc, slideIndex);
        if (child) children.push(child);
      }
    }
    if (children.length === 0) {
      // Add a placeholder child so group invariant holds
      children.push({
        id: generateNodeId("placeholder"),
        type: "shape",
        content: { shape: "rect" },
        style: blueprint.style,
      } as ShapeNode);
    }
    return {
      ...baseNode,
      type: "group",
      component: blueprint.component ?? "custom",
      children,
    } as GroupNode;
  }

  dc.warning(
    "unknown-template-kind",
    `Blueprint node type "${nodeType}" is not supported; skipping`,
    { path: `slides[${slideIndex}]` },
  );
  return null;
}

// ---------------------------------------------------------------------------
// Public compiler
// ---------------------------------------------------------------------------

export type TemplateCompileResult = {
  slide: SlideNode;
  diagnostics: PresentationDiagnostic[];
};

/**
 * Compiles a `SemanticSlideSpecV1` and a `SemanticTemplateV1` into a `SlideNode`.
 *
 * Rules:
 * - Layout selection is deterministic: exact match -> density -> emphasis -> default.
 * - Node ids are generated; AI-provided ids are never used.
 * - Slot keys are stamped on nodes for reapply/repair.
 * - Diagnostics are returned alongside the compiled node.
 */
export function compileSlide(
  spec: SemanticSlideSpecV1,
  template: SemanticTemplateV1,
  slideIndex: number = 0,
): TemplateCompileResult {
  const dc = new DiagnosticCollector();

  // Select layout
  const layout = selectLayout(template, spec.density, spec.emphasis);

  // Materialise children from layout blueprints
  const rootBlueprint = layout.root;
  const children: SlideChildNode[] = [];

  for (const childBp of rootBlueprint.children ?? []) {
    const child = materialiseBlueprintNode(childBp, spec.slots, dc, slideIndex);
    if (child) {
      children.push(child);
    }
  }

  const controls: SlideControls = {};
  if (spec.tone) controls.tone = spec.tone;
  if (spec.density) controls.density = spec.density;
  if (spec.emphasis) controls.emphasis = spec.emphasis;

  const slide: SlideNode = {
    id: generateNodeId("slide"),
    type: "slide",
    template: {
      kind: spec.kind,
      layoutId: layout.id,
    },
    style: rootBlueprint.style,
    ...(Object.keys(controls).length > 0 ? { controls } : {}),
    children,
    ...(spec.speakerNotes ? { notes: spec.speakerNotes } : {}),
  };

  return { slide, diagnostics: dc.diagnostics };
}
