import {
  availablePanels,
  defaultPanelForNode,
  resolveInspectorPanelContinuity,
  type InspectorPanelId,
  type InspectorPanelOption,
} from "@/lib/presentation/inspector-panel-ui";
import type { SlideChildNode, SlideNode } from "@/lib/presentation/schema";

export interface MobileInspectorContext {
  targetLabel: string;
  actionLabel: string;
  dialogLabel: string;
  activePanel: InspectorPanelId;
  activePanelLabel: string;
  panels: readonly InspectorPanelOption[];
}

interface BuildMobileInspectorContextInput {
  activeSlide: SlideNode | undefined;
  selectedNode: SlideChildNode | undefined;
  selectedIds: readonly string[];
  isDecorationSelected: boolean;
  selectedGeneratedSource?: "themeDecoration" | "deckChrome";
  requestedPanel: InspectorPanelId | undefined;
  hasDiagnostics: boolean;
}

const PANEL_TARGET_LABELS: Partial<Record<InspectorPanelId, string>> = {
  layers: "Layers",
  notes: "Notes",
  source: "Source",
};

function nodeTargetLabel(node: SlideChildNode): string {
  switch (node.type) {
    case "connector":
      return "Connector";
    case "group":
      return "Group";
    case "image":
      return "Image";
    case "shape":
      return "Shape";
    case "table":
      return "Table";
    case "text":
      return "Text";
    case "visual":
      return "Visual";
    default:
      return "Selection";
  }
}

function fallbackPanelLabel(panel: InspectorPanelId): string {
  return panel.charAt(0).toUpperCase() + panel.slice(1);
}

function targetLabelForSelection({
  activePanel,
  selectedIds,
  selectedNode,
  isDecorationSelected,
  selectedGeneratedSource,
}: Pick<
  BuildMobileInspectorContextInput,
  | "selectedIds"
  | "selectedNode"
  | "isDecorationSelected"
  | "selectedGeneratedSource"
> & {
  activePanel: InspectorPanelId;
}): string {
  const panelTargetLabel = PANEL_TARGET_LABELS[activePanel];
  if (panelTargetLabel) return panelTargetLabel;

  if (selectedIds.length > 1) return `${selectedIds.length} selected`;

  if (isDecorationSelected) {
    return selectedGeneratedSource === "deckChrome"
      ? "Deck chrome"
      : "Decoration";
  }

  if (selectedNode) return nodeTargetLabel(selectedNode);

  return "Slide";
}

function actionLabelForTarget(targetLabel: string): string {
  if (/^\d+ selected$/.test(targetLabel)) return "Edit selected objects";
  return `Edit ${targetLabel.toLowerCase()}`;
}

function dialogLabelForTarget(targetLabel: string): string {
  if (/^\d+ selected$/.test(targetLabel)) return "Selection inspector";
  return `${targetLabel} inspector`;
}

export function buildMobileInspectorContext({
  activeSlide,
  selectedNode,
  selectedIds,
  isDecorationSelected,
  selectedGeneratedSource,
  requestedPanel,
  hasDiagnostics,
}: BuildMobileInspectorContextInput): MobileInspectorContext {
  const nodeForRouting = isDecorationSelected ? null : (selectedNode ?? null);
  const panels = availablePanels(nodeForRouting, {
    multiSelect: selectedIds.length > 1,
    isDecoration: isDecorationSelected,
    hasDiagnostics,
  });
  const defaultPanel = defaultPanelForNode(
    nodeForRouting,
    isDecorationSelected,
  );
  const activePanel = resolveInspectorPanelContinuity({
    activePanel: requestedPanel,
    panels,
    defaultPanel,
  });
  const activePanelLabel =
    panels.find((panel) => panel.id === activePanel)?.label ??
    fallbackPanelLabel(activePanel);
  const targetLabel = activeSlide
    ? targetLabelForSelection({
        activePanel,
        selectedIds,
        selectedNode,
        isDecorationSelected,
        selectedGeneratedSource,
      })
    : "Slide";

  return {
    targetLabel,
    actionLabel: actionLabelForTarget(targetLabel),
    dialogLabel: dialogLabelForTarget(targetLabel),
    activePanel,
    activePanelLabel,
    panels,
  };
}
