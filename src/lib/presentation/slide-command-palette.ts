import {
  CURRENT_OBJECT_COMMAND_DESCRIPTORS,
  CURRENT_OBJECT_DISABLED_REASON_LABELS,
  type CurrentObjectCommandDescriptor,
  type CurrentObjectCommandDisabledReason,
  type CurrentObjectCommandFamily,
  type CurrentObjectKind,
} from "./current-object-command-descriptors";
import type {
  InspectorPanelId,
  InspectorPanelOption,
} from "./inspector-panel-ui";
import type { SaveStatus } from "./save-status";
import type { SlideChildNode } from "./schema";

export type SlideCommandPaletteSection =
  | "Deck"
  | "Slide"
  | "Insert"
  | "Selection"
  | "Inspector"
  | "Source"
  | "Diagnostics"
  | "Export"
  | "Help";

export type SlideCommandPaletteIntent =
  | { kind: "current-object"; commandId: string }
  | { kind: "open-inspector-panel"; panel: InspectorPanelId }
  | { kind: "open-shortcuts" }
  | { kind: "save" }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "present" }
  | { kind: "share" }
  | { kind: "deck-chrome" }
  | { kind: "source-review" }
  | { kind: "diagnostics" }
  | { kind: "export"; format: "pptx" | "pdf" | "png" };

export type SlideCommandPaletteDisabledReason =
  | CurrentObjectCommandDisabledReason
  | "missing-capability"
  | "already-saving"
  | "requires-finished-editing";

export interface SlideCommandPaletteCommand {
  id: string;
  label: string;
  description: string;
  section: SlideCommandPaletteSection;
  shortcut?: string;
  keywords: readonly string[];
  intent: SlideCommandPaletteIntent;
  disabledReason?: string;
  disabledReasonCode?: SlideCommandPaletteDisabledReason;
  liveMessage: string;
}

export interface SlideCommandPaletteCapabilities {
  canSave?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  canPresent?: boolean;
  canShare?: boolean;
  canExportPptx?: boolean;
  canExportPdf?: boolean;
  canExportPng?: boolean;
  saveStatus?: SaveStatus;
}

export interface SlideCommandPaletteContext {
  hasActiveSlide: boolean;
  slideCount: number;
  selectedNode: SlideChildNode | null;
  selectedCount: number;
  isDecorationSelected?: boolean;
  isInlineEditing?: boolean;
  isTableEditing?: boolean;
  hasSelectedSource?: boolean;
  hasSourceReview?: boolean;
  hasDiagnostics?: boolean;
  availablePanels: readonly InspectorPanelOption[];
  capabilities?: SlideCommandPaletteCapabilities;
}

const CURRENT_OBJECT_SECTION: Record<
  CurrentObjectCommandFamily,
  SlideCommandPaletteSection
> = {
  "insert-slide": "Slide",
  "insert-node": "Insert",
  "duplicate-slide": "Slide",
  "delete-slide": "Slide",
  "update-slide-style": "Slide",
  "format-text": "Selection",
  "update-node-style": "Selection",
  "update-node-content": "Selection",
  "align-selection": "Selection",
  "distribute-selection": "Selection",
  "match-selection-size": "Selection",
  "reorder-selection": "Selection",
  "group-selection": "Selection",
  "ungroup-selection": "Selection",
  "duplicate-selection": "Selection",
  "delete-selection": "Selection",
  "cut-selection": "Selection",
  "update-node-attributes": "Selection",
  "stage-select": "Selection",
  "stage-transform": "Selection",
  "create-connector": "Selection",
  "review-source": "Source",
  "repair-diagnostic": "Diagnostics",
};

const PANEL_DESCRIPTIONS: Record<InspectorPanelId, string> = {
  slide: "Edit slide settings and background.",
  notes: "Edit speaker notes for the active slide.",
  text: "Edit text content and typography.",
  shape: "Edit shape appearance.",
  image: "Replace or adjust image content.",
  adjust: "Crop and adjust the selected image.",
  visual: "Edit visual data bindings.",
  line: "Edit connector line settings.",
  table: "Edit table rows, columns, and header state.",
  arrange: "Align, distribute, group, and reorder objects.",
  effects: "Edit effects and visual treatment.",
  source: "Review source links for the selected object.",
  layers: "Review slide layers and reading order.",
  style: "Review theme style bindings.",
  decoration: "Detach or inspect generated decoration layers.",
  diagnostics: "Review and repair presentation diagnostics.",
};

function disabledReasonLabel(
  reason: SlideCommandPaletteDisabledReason,
): string {
  if (reason in CURRENT_OBJECT_DISABLED_REASON_LABELS) {
    return CURRENT_OBJECT_DISABLED_REASON_LABELS[
      reason as CurrentObjectCommandDisabledReason
    ];
  }
  switch (reason) {
    case "missing-capability":
      return "This command is not available in this editor session.";
    case "already-saving":
      return "Wait for the current save to finish.";
    case "requires-finished-editing":
      return "Finish text or table editing first.";
    default:
      return "This command is not available right now.";
  }
}

function selectedObjectKind({
  selectedNode,
  selectedCount,
  isDecorationSelected,
}: SlideCommandPaletteContext): CurrentObjectKind {
  if (isDecorationSelected) return "decoration";
  if (selectedCount > 1) return "multi-selection";
  if (!selectedNode) return "slide";
  return selectedNode.type;
}

function preferredDisabledReason(
  descriptor: CurrentObjectCommandDescriptor,
  context: SlideCommandPaletteContext,
): SlideCommandPaletteDisabledReason | undefined {
  if (!context.hasActiveSlide) return "missing-current-slide";

  const selectedKind = selectedObjectKind(context);
  const editingSelection =
    context.selectedCount > 0 &&
    (context.isInlineEditing === true || context.isTableEditing === true);

  if (
    editingSelection &&
    descriptor.family !== "format-text" &&
    descriptor.family !== "update-node-content" &&
    descriptor.family !== "review-source"
  ) {
    return "requires-finished-editing";
  }

  if (descriptor.id === "slide.delete" && context.slideCount <= 1) {
    return "minimum-slide-count";
  }
  if (
    descriptor.id === "diagnostics.repair" &&
    context.hasDiagnostics !== true
  ) {
    return "unsupported-current-object";
  }
  if (
    descriptor.id === "diagnostics.repair" &&
    context.hasDiagnostics === true
  ) {
    return undefined;
  }
  if (
    descriptor.id === "source.review" &&
    context.hasSourceReview !== true &&
    context.hasSelectedSource !== true
  ) {
    return "read-only-source";
  }
  if (descriptor.id === "source.review" && context.hasSourceReview === true) {
    return undefined;
  }
  if (
    (descriptor.family === "group-selection" ||
      descriptor.family === "distribute-selection" ||
      descriptor.family === "match-selection-size") &&
    context.selectedCount < 2
  ) {
    return "requires-multi-selection";
  }
  if (
    descriptor.family === "distribute-selection" &&
    context.selectedCount < 3
  ) {
    return "requires-three-selections";
  }
  if (descriptor.family === "ungroup-selection") {
    if (context.selectedCount !== 1) return "requires-single-selection";
    if (context.selectedNode?.type !== "group")
      return "unsupported-current-object";
  }
  if (
    context.selectedCount === 0 &&
    !descriptor.currentObjects.includes("slide")
  ) {
    return (
      descriptor.disabledReasons.find((reason) =>
        reason.startsWith("requires-"),
      ) ?? "missing-selection"
    );
  }
  if (descriptor.id === "connector.create") {
    return "missing-handler";
  }
  if (
    context.isDecorationSelected === true &&
    !descriptor.currentObjects.includes("decoration")
  ) {
    return "decoration-selection";
  }
  if (
    context.selectedCount > 0 &&
    !descriptor.currentObjects.includes(selectedKind)
  ) {
    return "unsupported-current-object";
  }
  if (
    context.selectedNode?.locked === true &&
    (descriptor.family === "stage-transform" ||
      descriptor.family === "update-node-style" ||
      descriptor.family === "update-node-content")
  ) {
    return "locked-selection";
  }
  return undefined;
}

function currentObjectDescription(
  descriptor: CurrentObjectCommandDescriptor,
): string {
  const inspectorOwner = descriptor.owners.find(
    (owner) => owner.surface === "inspector" && owner.inspectorPanel,
  );
  if (inspectorOwner?.inspectorPanel) {
    return `Open the owning inspector panel. ${
      PANEL_DESCRIPTIONS[inspectorOwner.inspectorPanel]
    }`;
  }
  return `${descriptor.accessibilityLabel}.`;
}

function commandFromDescriptor(
  descriptor: CurrentObjectCommandDescriptor,
  context: SlideCommandPaletteContext,
): SlideCommandPaletteCommand {
  const disabledReasonCode = preferredDisabledReason(descriptor, context);
  return {
    id: descriptor.id,
    label: descriptor.label,
    description: currentObjectDescription(descriptor),
    section: CURRENT_OBJECT_SECTION[descriptor.family],
    shortcut: descriptor.shortcut,
    keywords: [
      descriptor.id,
      descriptor.family,
      ...descriptor.currentObjects,
      ...descriptor.owners.map((owner) => owner.ownerId),
    ],
    intent: { kind: "current-object", commandId: descriptor.id },
    disabledReasonCode,
    disabledReason: disabledReasonCode
      ? disabledReasonLabel(disabledReasonCode)
      : undefined,
    liveMessage: descriptor.liveMessage,
  };
}

function fixedCommand(
  command: Omit<SlideCommandPaletteCommand, "keywords" | "disabledReason"> & {
    keywords?: readonly string[];
    disabledReasonCode?: SlideCommandPaletteDisabledReason;
  },
): SlideCommandPaletteCommand {
  return {
    ...command,
    keywords: command.keywords ?? [],
    disabledReason: command.disabledReasonCode
      ? disabledReasonLabel(command.disabledReasonCode)
      : undefined,
  };
}

export function resolveSlideCommandPaletteCommands(
  context: SlideCommandPaletteContext,
): SlideCommandPaletteCommand[] {
  const capabilities = context.capabilities ?? {};
  const commands: SlideCommandPaletteCommand[] = [
    fixedCommand({
      id: "palette.shortcuts",
      label: "Keyboard shortcuts",
      description: "Open the slide editor shortcut reference.",
      section: "Help",
      shortcut: "Shift+?",
      keywords: ["help", "keys", "reference"],
      intent: { kind: "open-shortcuts" },
      liveMessage: "Keyboard shortcuts opened.",
    }),
    fixedCommand({
      id: "deck.save",
      label: "Save now",
      description: "Save the current slide deck.",
      section: "Deck",
      shortcut: "Ctrl+S",
      keywords: ["persist", "autosave"],
      intent: { kind: "save" },
      disabledReasonCode:
        capabilities.canSave === true
          ? capabilities.saveStatus === "saving"
            ? "already-saving"
            : undefined
          : "missing-capability",
      liveMessage: "Slide deck saved.",
    }),
    fixedCommand({
      id: "deck.undo",
      label: "Undo",
      description: "Undo the last editor change.",
      section: "Deck",
      shortcut: "Ctrl+Z",
      keywords: ["history"],
      intent: { kind: "undo" },
      disabledReasonCode:
        capabilities.canUndo === true ? undefined : "missing-capability",
      liveMessage: "Undo applied.",
    }),
    fixedCommand({
      id: "deck.redo",
      label: "Redo",
      description: "Redo the last reverted editor change.",
      section: "Deck",
      shortcut: "Ctrl+Shift+Z",
      keywords: ["history"],
      intent: { kind: "redo" },
      disabledReasonCode:
        capabilities.canRedo === true ? undefined : "missing-capability",
      liveMessage: "Redo applied.",
    }),
    fixedCommand({
      id: "deck.present",
      label: "Present slides",
      description: "Open the presenter view for this deck.",
      section: "Deck",
      keywords: ["play", "slideshow"],
      intent: { kind: "present" },
      disabledReasonCode:
        capabilities.canPresent === true
          ? capabilities.saveStatus === "saving"
            ? "already-saving"
            : undefined
          : "missing-capability",
      liveMessage: "Presentation opened.",
    }),
    fixedCommand({
      id: "deck.share",
      label: "Share slides",
      description: "Open the public sharing flow for this deck.",
      section: "Deck",
      keywords: ["public", "link"],
      intent: { kind: "share" },
      disabledReasonCode:
        capabilities.canShare === true
          ? capabilities.saveStatus === "saving"
            ? "already-saving"
            : undefined
          : "missing-capability",
      liveMessage: "Share flow opened.",
    }),
    fixedCommand({
      id: "deck.chrome",
      label: "Slide master",
      description:
        "Open logo, footer, page number, watermark, and other deck-wide defaults.",
      section: "Deck",
      keywords: ["header", "footer", "brand", "logo", "watermark"],
      intent: { kind: "deck-chrome" },
      liveMessage: "Slide master controls opened.",
    }),
    fixedCommand({
      id: "source.review-all",
      label: "Review source links",
      description: "Open source-review results for linked slide content.",
      section: "Source",
      keywords: ["document", "linked", "citations"],
      intent: { kind: "source-review" },
      disabledReasonCode:
        context.hasSourceReview === true || context.hasSelectedSource === true
          ? undefined
          : "read-only-source",
      liveMessage: "Source review opened.",
    }),
    fixedCommand({
      id: "diagnostics.open",
      label: "Diagnostics",
      description: "Open presentation diagnostics and available repairs.",
      section: "Diagnostics",
      keywords: ["errors", "warnings", "repair"],
      intent: { kind: "diagnostics" },
      disabledReasonCode:
        context.hasDiagnostics === true
          ? undefined
          : "unsupported-current-object",
      liveMessage: "Diagnostics opened.",
    }),
    fixedCommand({
      id: "export.pptx",
      label: "Export PPTX",
      description: "Download this deck as a PowerPoint file.",
      section: "Export",
      keywords: ["download", "powerpoint"],
      intent: { kind: "export", format: "pptx" },
      disabledReasonCode:
        capabilities.canExportPptx === true ? undefined : "missing-capability",
      liveMessage: "PPTX export started.",
    }),
    fixedCommand({
      id: "export.pdf",
      label: "Export PDF",
      description: "Download this deck as a PDF file.",
      section: "Export",
      keywords: ["download"],
      intent: { kind: "export", format: "pdf" },
      disabledReasonCode:
        capabilities.canExportPdf === true ? undefined : "missing-capability",
      liveMessage: "PDF export started.",
    }),
    fixedCommand({
      id: "export.png",
      label: "Export PNGs",
      description: "Download slide images as PNG files.",
      section: "Export",
      keywords: ["download", "images"],
      intent: { kind: "export", format: "png" },
      disabledReasonCode:
        capabilities.canExportPng === true ? undefined : "missing-capability",
      liveMessage: "PNG export started.",
    }),
    ...context.availablePanels.map((panel) =>
      fixedCommand({
        id: `inspector.${panel.id}`,
        label: `Open ${panel.label} panel`,
        description: PANEL_DESCRIPTIONS[panel.id],
        section: "Inspector",
        keywords: ["panel", "inspector", panel.id],
        intent: { kind: "open-inspector-panel", panel: panel.id },
        liveMessage: `${panel.label} panel opened.`,
      }),
    ),
    ...CURRENT_OBJECT_COMMAND_DESCRIPTORS.map((descriptor) =>
      commandFromDescriptor(descriptor, context),
    ),
  ];

  return commands.sort((a, b) => {
    if (a.disabledReason && !b.disabledReason) return 1;
    if (!a.disabledReason && b.disabledReason) return -1;
    return a.section.localeCompare(b.section) || a.label.localeCompare(b.label);
  });
}

function normalizeQuery(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function filterSlideCommandPaletteCommands(
  commands: readonly SlideCommandPaletteCommand[],
  query: string,
): SlideCommandPaletteCommand[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return [...commands];
  const terms = normalized.split(/\s+/).filter(Boolean);
  return commands.filter((command) => {
    const haystack = [
      command.label,
      command.description,
      command.section,
      command.shortcut ?? "",
      ...command.keywords,
    ]
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
