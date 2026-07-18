/**
 * Inspector panel routing for the presentation slide editor.
 *
 * `availablePanels` maps a selection context (node type or slide) to the
 * ordered list of inspector panel tabs available for that context. Panel ids
 * match the `InspectorPanelId` union type.
 */

import type { SlideChildNode } from "./schema";

export type InspectorPanelId =
  | "slide"
  | "notes"
  | "text"
  | "shape"
  | "image"
  | "adjust"
  | "visual"
  | "line"
  | "table"
  | "arrange"
  | "effects"
  | "source"
  | "layers"
  | "style"
  | "decoration"
  | "diagnostics";

export type InspectorPanelOption = {
  id: InspectorPanelId;
  label: string;
};

export type InspectorPanelContinuityInput = {
  activePanel: InspectorPanelId | null | undefined;
  panels: readonly InspectorPanelOption[];
  defaultPanel: InspectorPanelId;
};

const PANEL: Record<InspectorPanelId, InspectorPanelOption> = {
  slide: { id: "slide", label: "Slide" },
  notes: { id: "notes", label: "Notes" },
  text: { id: "text", label: "Text" },
  shape: { id: "shape", label: "Shape" },
  image: { id: "image", label: "Image" },
  adjust: { id: "adjust", label: "Adjust" },
  visual: { id: "visual", label: "Visual" },
  line: { id: "line", label: "Line" },
  table: { id: "table", label: "Table" },
  arrange: { id: "arrange", label: "Arrange" },
  effects: { id: "effects", label: "Effects" },
  source: { id: "source", label: "Source" },
  layers: { id: "layers", label: "Layers" },
  style: { id: "style", label: "Style" },
  decoration: { id: "decoration", label: "Decoration" },
  diagnostics: { id: "diagnostics", label: "Diagnostics" },
};

/** Returns the default/first panel for a given node type. */
export function defaultPanelForNode(
  node: SlideChildNode | null,
  isDecoration: boolean,
): InspectorPanelId {
  if (isDecoration) return "decoration";
  if (!node) return "slide";
  switch (node.type) {
    case "text":
      return "text";
    case "shape":
      return "shape";
    case "image":
      return "image";
    case "visual":
      return "visual";
    case "connector":
      return "line";
    case "table":
      return "table";
    case "group":
      return "arrange";
    default:
      return "arrange";
  }
}

/**
 * Returns the ordered list of inspector panel tabs available for the current
 * selection context.
 *
 * @param node - The selected node, or null when no node is selected (slide is
 *   the current object).
 * @param multiSelect - Whether more than one node is selected.
 * @param isDecoration - Whether the selected node is a theme decoration.
 * @param hasDiagnostics - Whether there are active diagnostics to surface.
 */
export function availablePanels(
  node: SlideChildNode | null,
  {
    multiSelect = false,
    isDecoration = false,
    hasDiagnostics = false,
  }: {
    multiSelect?: boolean;
    isDecoration?: boolean;
    hasDiagnostics?: boolean;
  } = {},
): InspectorPanelOption[] {
  const panels: InspectorPanelId[] = [];

  if (isDecoration) {
    panels.push("decoration", "arrange", "layers");
  } else if (multiSelect) {
    panels.push("arrange", "effects", "layers");
  } else if (!node) {
    // Slide is the current object
    panels.push("slide", "notes", "layers");
  } else {
    switch (node.type) {
      case "text":
        panels.push("text", "arrange", "style", "effects", "source", "layers");
        break;
      case "shape":
        panels.push("shape", "arrange", "style", "effects", "source", "layers");
        break;
      case "image":
        panels.push(
          "image",
          "adjust",
          "arrange",
          "effects",
          "source",
          "layers",
        );
        break;
      case "visual":
        panels.push("visual", "arrange", "style", "source", "layers");
        break;
      case "connector":
        panels.push("line", "arrange", "style", "effects", "layers");
        break;
      case "table":
        panels.push("table", "arrange", "style", "effects", "source", "layers");
        break;
      case "group":
        panels.push("arrange", "layers");
        break;
      default:
        panels.push("arrange", "layers");
        break;
    }
  }

  if (hasDiagnostics && !panels.includes("diagnostics")) {
    panels.push("diagnostics");
  }

  return panels.map((id) => PANEL[id]);
}

/**
 * Preserves the active inspector panel when the next selection still exposes
 * that panel, otherwise replaces it with the next selection's default panel.
 */
export function resolveInspectorPanelContinuity({
  activePanel,
  panels,
  defaultPanel,
}: InspectorPanelContinuityInput): InspectorPanelId {
  if (activePanel && panels.some((panel) => panel.id === activePanel)) {
    return activePanel;
  }

  return panels[0]?.id ?? defaultPanel;
}
