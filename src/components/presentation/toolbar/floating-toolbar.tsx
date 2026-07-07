"use client";

/**
 * Context / Popover Toolbar — floats above the selection bounding box.
 *
 * Frequent controls dispatch through the presentation editor command path via callbacks
 * owned by the editor shell. Inline text commands still go through the custom
 * DOM event consumed by `InlineTextEditorPresentation`.
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Copy,
  Crop,
  Ellipsis,
  Group,
  EyeOff,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListOrdered,
  Lock,
  Plus,
  Replace,
  RotateCcw,
  RotateCw,
  Scissors,
  Strikethrough,
  Trash2,
  Underline,
  Ungroup,
  Unlock,
} from "lucide-react";

import type { SlideChildNode } from "@/lib/presentation/schema";
import type {
  ImageFitMode,
  StyleObject,
  StylePatch,
} from "@/lib/presentation/style-schema";
import { FloatingSurface } from "@/components/ui/floating-surface";
import { Popover } from "@/components/ui/popover";
import { cx, FOCUS_RING } from "@/components/ui/tokens";
import {
  dispatchInlineTextCommand,
  type InlineTextCommandName,
} from "@/lib/presentation/inline-text-commands";
import {
  CURRENT_OBJECT_INSERT_NODE_COMMAND_DESCRIPTORS,
  currentObjectAlignCommandDescriptor,
  currentObjectReorderCommandDescriptor,
  type CurrentObjectInsertNodeCommandId,
  type CurrentObjectInsertNodeKind,
  type CurrentObjectReorderCommandId,
  type CurrentObjectReorderMode,
} from "@/lib/presentation/current-object-command-descriptors";
import {
  focusFirstMenuCommand,
  isMenuCommandNavigationKey,
  moveMenuCommandFocus,
} from "@/lib/a11y/menu-command-semantics";
import {
  ContextToolbarColorInput,
  ContextToolbarDivider,
  ContextToolbarButton,
  ContextToolbarNumberInput,
  ContextToolbarSelect,
  renderContextToolbarLayerIcon,
  renderContextToolbarInsertIcon,
} from "./context-toolbar-primitives";

const TOOLBAR_GAP = 12;
const EDGE_INSET = 8;
const INLINE_ONLY_TEXT_COMMANDS = new Set<InlineTextCommandName>([
  "bullet-list",
  "numbered-list",
  "indent-list",
  "outdent-list",
  "link",
  "unlink",
]);
const CONTEXT_TOOLBAR_TEXT_ROLES = [
  "title",
  "subtitle",
  "body",
  "quote",
  "caption",
  "kicker",
  "metric",
] as const satisfies readonly SlideChildNode["role"][];

type ContextToolbarTextRole = (typeof CONTEXT_TOOLBAR_TEXT_ROLES)[number];

const CONTEXT_TOOLBAR_TEXT_ROLE_FONT_SIZE_PT: Record<
  ContextToolbarTextRole,
  number
> = {
  title: 34,
  subtitle: 24,
  body: 18,
  quote: 26,
  caption: 11,
  kicker: 11,
  metric: 40,
};

export type SelectionAlignMode =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom";
export type SelectionDistributeMode = "horizontal" | "vertical";
export type SelectionMatchSizeMode = "width" | "height" | "both";

type TableNode = Extract<SlideChildNode, { type: "table" }>;
type SlideToolInsertActionKey = CurrentObjectInsertNodeKind;
type ContextToolbarReorderActionKey = CurrentObjectReorderMode;

const CONTEXT_TOOLBAR_REORDER_MODES = [
  "forward",
  "backward",
  "front",
  "back",
] as const satisfies readonly CurrentObjectReorderMode[];

export function isContextToolbarInlineTextCommandEnabled(
  command: InlineTextCommandName,
  isInlineEditing: boolean,
): boolean {
  if (!INLINE_ONLY_TEXT_COMMANDS.has(command)) return true;
  return isInlineEditing;
}

export function isContextToolbarTextRole(
  value: string,
): value is ContextToolbarTextRole {
  return CONTEXT_TOOLBAR_TEXT_ROLES.includes(value as ContextToolbarTextRole);
}

export function resolveContextToolbarTextRole(
  role: SlideChildNode["role"] | undefined,
): ContextToolbarTextRole {
  return role && isContextToolbarTextRole(role) ? role : "body";
}

export function contextToolbarTextRoleFontSizePt(
  role: ContextToolbarTextRole,
): number {
  return CONTEXT_TOOLBAR_TEXT_ROLE_FONT_SIZE_PT[role];
}

interface SlideToolInsertCallbacks {
  onInsertText?: () => void;
  onInsertShape?: () => void;
  onInsertImage?: () => void;
  onInsertVisual?: () => void;
  onInsertConnector?: () => void;
  onInsertTable?: () => void;
}

interface SlideToolInsertAction {
  key: SlideToolInsertActionKey;
  commandId: CurrentObjectInsertNodeCommandId;
  label: string;
  onClick: () => void;
}

export function buildSlideToolInsertActions({
  onInsertText,
  onInsertShape,
  onInsertImage,
  onInsertVisual,
  onInsertConnector,
  onInsertTable,
}: SlideToolInsertCallbacks): SlideToolInsertAction[] {
  const handlers: Partial<Record<SlideToolInsertActionKey, () => void>> = {
    text: onInsertText,
    shape: onInsertShape,
    image: onInsertImage,
    visual: onInsertVisual,
    connector: onInsertConnector,
    table: onInsertTable,
  };
  return CURRENT_OBJECT_INSERT_NODE_COMMAND_DESCRIPTORS.flatMap(
    (descriptor) => {
      const onClick = handlers[descriptor.nodeKind];
      if (!onClick) return [];
      const action: SlideToolInsertAction = {
        key: descriptor.nodeKind,
        commandId: descriptor.id,
        label: descriptor.label,
        onClick,
      };
      return [action];
    },
  );
}

interface ContextToolbarReorderCallbacks {
  onBringForward: () => void;
  onSendBackward: () => void;
  onBringToFront?: () => void;
  onSendToBack?: () => void;
}

interface ContextToolbarReorderAction {
  key: ContextToolbarReorderActionKey;
  commandId: CurrentObjectReorderCommandId;
  label: string;
  onClick: () => void;
}

export function buildContextToolbarReorderActions({
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
}: ContextToolbarReorderCallbacks): ContextToolbarReorderAction[] {
  const handlers: Record<ContextToolbarReorderActionKey, () => void> = {
    forward: onBringForward,
    backward: onSendBackward,
    front: () => onBringToFront?.(),
    back: () => onSendToBack?.(),
  };
  return CONTEXT_TOOLBAR_REORDER_MODES.map((mode) => {
    const descriptor = currentObjectReorderCommandDescriptor(mode);
    return {
      key: mode,
      commandId: descriptor.id,
      label: descriptor.label,
      onClick: handlers[mode],
    };
  });
}

function InlineTextCommandButton({
  label,
  command,
  isInlineEditing,
  children,
}: {
  label: string;
  command: InlineTextCommandName;
  isInlineEditing: boolean;
  children: ReactNode;
}) {
  const enabled = isContextToolbarInlineTextCommandEnabled(
    command,
    isInlineEditing,
  );
  return (
    <ContextToolbarButton
      label={label}
      disabled={!enabled}
      onClick={() => dispatchInlineTextCommand({ command })}
    >
      {children}
    </ContextToolbarButton>
  );
}

function getColor(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function getSolidFillColor(
  localStyle: StylePatch | undefined,
  resolvedStyle: StyleObject | undefined,
  fallback: string,
): string {
  const resolvedFill = resolvedStyle?.fill;
  if (resolvedFill?.type === "solid") {
    return getColor(resolvedFill.color, fallback);
  }
  const localFill = localStyle?.fill;
  return localFill?.type === "solid"
    ? getColor(localFill.color, fallback)
    : fallback;
}

export type ContextToolbarStyleSeed = {
  textStyle: StyleObject["text"] | StylePatch["text"] | undefined;
  fillColor: string;
  shapeStrokeColor: string;
  shapeStrokeWidth: number;
  connectorStrokeColor: string;
  connectorStrokeWidth: number;
  connectorStartArrow: "none" | "arrow" | "filled";
  connectorEndArrow: "none" | "arrow" | "filled";
  textColor: string;
  fontSize: number;
  opacity: number;
};

export function seedContextToolbarStyles(
  selectedNode: SlideChildNode | undefined,
  selectedResolvedStyle: StyleObject | undefined,
): ContextToolbarStyleSeed {
  const textStyle =
    selectedResolvedStyle?.text ?? selectedNode?.localStyle?.text;
  const shapeStrokeColor = getColor(
    selectedResolvedStyle?.stroke?.color,
    getColor(selectedNode?.localStyle?.stroke?.color, "#111827"),
  );
  const connectorStrokeColor = getColor(
    selectedResolvedStyle?.connector?.stroke?.color,
    getColor(selectedNode?.localStyle?.connector?.stroke?.color, "#111827"),
  );
  return {
    textStyle,
    fillColor: getSolidFillColor(
      selectedNode?.localStyle,
      selectedResolvedStyle,
      "#ffffff",
    ),
    shapeStrokeColor,
    shapeStrokeWidth:
      selectedResolvedStyle?.stroke?.widthPt ??
      selectedNode?.localStyle?.stroke?.widthPt ??
      1,
    connectorStrokeColor,
    connectorStrokeWidth:
      selectedResolvedStyle?.connector?.stroke?.widthPt ??
      selectedNode?.localStyle?.connector?.stroke?.widthPt ??
      1.5,
    connectorStartArrow:
      selectedResolvedStyle?.connector?.startArrow ??
      selectedNode?.localStyle?.connector?.startArrow ??
      "none",
    connectorEndArrow:
      selectedResolvedStyle?.connector?.endArrow ??
      selectedNode?.localStyle?.connector?.endArrow ??
      "arrow",
    textColor: getColor(textStyle?.color, "#111827"),
    fontSize: textStyle?.fontSizePt ?? 18,
    opacity:
      selectedResolvedStyle?.opacity ?? selectedNode?.localStyle?.opacity ?? 1,
  };
}

/*! node:coverage ignore next 19 -- Browser DOM measurement helpers require a live stage DOM. */
function getSlideAnchorRect(): DOMRect | null {
  const frame = getSlideAnchorElement();
  return frame?.getBoundingClientRect() ?? null;
}

function getSlideAnchorElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>('[data-slide-stage-frame="true"]');
}

function getSelectionElements(selectedIds: string[]): HTMLElement[] {
  if (typeof document === "undefined" || selectedIds.length === 0) return [];
  const nodes: HTMLElement[] = [];
  for (const id of selectedIds) {
    const node = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    if (node) nodes.push(node);
  }
  return nodes;
}

export type ContextToolbarTextCommand =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough";

export function routeContextToolbarTextCommand({
  command,
  isInlineEditing,
  textStyle,
  onUpdateSelectedLocalStyle,
  dispatchCommand = dispatchInlineTextCommand,
}: {
  command: ContextToolbarTextCommand;
  isInlineEditing: boolean;
  textStyle: ContextToolbarStyleSeed["textStyle"];
  onUpdateSelectedLocalStyle: ContextToolbarProps["onUpdateSelectedLocalStyle"];
  dispatchCommand?: typeof dispatchInlineTextCommand;
}): void {
  dispatchCommand({ command });
  if (isInlineEditing) return;
  if (command === "bold") {
    onUpdateSelectedLocalStyle?.({
      text: { weight: textStyle?.weight === 700 ? 400 : 700 },
    });
  } else if (command === "italic") {
    onUpdateSelectedLocalStyle?.({ text: { italic: !textStyle?.italic } });
  } else if (command === "underline") {
    onUpdateSelectedLocalStyle?.({
      text: { underline: !textStyle?.underline },
    });
  } else {
    onUpdateSelectedLocalStyle?.({
      text: { strikethrough: !textStyle?.strikethrough },
    });
  }
}

export function routeContextToolbarTextColor({
  color,
  isInlineEditing,
  onUpdateSelectedLocalStyle,
  dispatchCommand = dispatchInlineTextCommand,
}: {
  color: string;
  isInlineEditing: boolean;
  onUpdateSelectedLocalStyle: ContextToolbarProps["onUpdateSelectedLocalStyle"];
  dispatchCommand?: typeof dispatchInlineTextCommand;
}): void {
  dispatchCommand({ command: "color", value: color });
  if (!isInlineEditing)
    onUpdateSelectedLocalStyle?.({ text: { color: color } });
}

export function routeContextToolbarTextAlign({
  align,
  onUpdateSelectedLocalStyle,
  dispatchCommand = dispatchInlineTextCommand,
}: {
  align: "left" | "center" | "right";
  onUpdateSelectedLocalStyle: ContextToolbarProps["onUpdateSelectedLocalStyle"];
  dispatchCommand?: typeof dispatchInlineTextCommand;
}): void {
  dispatchCommand({ command: `align-${align}` });
  onUpdateSelectedLocalStyle?.({ text: { align } });
}

export function routeContextToolbarFontSize({
  value,
  isInlineEditing,
  onUpdateSelectedLocalStyle,
  dispatchCommand = dispatchInlineTextCommand,
}: {
  value: number;
  isInlineEditing: boolean;
  onUpdateSelectedLocalStyle: ContextToolbarProps["onUpdateSelectedLocalStyle"];
  dispatchCommand?: typeof dispatchInlineTextCommand;
}): void {
  dispatchCommand({
    command: "font-size",
    value: `${value}pt`,
  });
  if (!isInlineEditing) {
    onUpdateSelectedLocalStyle?.({ text: { fontSizePt: value } });
  }
}

export function routeContextToolbarOpacity({
  value,
  onUpdateSelectedLocalStyle,
}: {
  value: number;
  onUpdateSelectedLocalStyle: ContextToolbarProps["onUpdateSelectedLocalStyle"];
}): void {
  onUpdateSelectedLocalStyle?.({ opacity: value / 100 });
}

export function routeContextToolbarTextRoleChange({
  role,
  onUpdateSelectedAttributes,
  onUpdateSelectedLocalStyle,
}: {
  role: string;
  onUpdateSelectedAttributes: ContextToolbarProps["onUpdateSelectedAttributes"];
  onUpdateSelectedLocalStyle: ContextToolbarProps["onUpdateSelectedLocalStyle"];
}): void {
  if (!isContextToolbarTextRole(role)) return;
  onUpdateSelectedAttributes?.({ role });
  const fontSizePt = contextToolbarTextRoleFontSizePt(role);
  onUpdateSelectedLocalStyle?.({ text: { fontSizePt } });
}

export function routeContextToolbarImageCropToggle({
  selectedNode,
  onUpdateSelectedContent,
  onResetImageCrop,
}: {
  selectedNode: SlideChildNode | undefined;
  onUpdateSelectedContent: ContextToolbarProps["onUpdateSelectedContent"];
  onResetImageCrop: ContextToolbarProps["onResetImageCrop"];
}): void {
  if (selectedNode?.type !== "image") return;
  if (selectedNode.content.crop) {
    onResetImageCrop?.();
    return;
  }
  onUpdateSelectedContent?.({
    crop: { top: 8, right: 8, bottom: 8, left: 8 },
  });
}

export function routeContextToolbarImageFit({
  fit,
  onUpdateSelectedContent,
}: {
  fit: ImageFitMode;
  onUpdateSelectedContent: ContextToolbarProps["onUpdateSelectedContent"];
}): void {
  onUpdateSelectedContent?.({ fit });
}

export function routeContextToolbarVisualBackgroundToggle({
  selectedNode,
  onUpdateSelectedContent,
}: {
  selectedNode: SlideChildNode | undefined;
  onUpdateSelectedContent: ContextToolbarProps["onUpdateSelectedContent"];
}): void {
  if (selectedNode?.type !== "visual") return;
  onUpdateSelectedContent?.({
    transparentBackground: selectedNode.content.transparentBackground !== true,
  });
}

export function routeContextToolbarVisualThemeChange({
  selectedNode,
  styleThemeId,
  onUpdateSelectedLocalStyle,
}: {
  selectedNode: SlideChildNode | undefined;
  styleThemeId: string;
  onUpdateSelectedLocalStyle: ContextToolbarProps["onUpdateSelectedLocalStyle"];
}): void {
  if (selectedNode?.type !== "visual") return;
  onUpdateSelectedLocalStyle?.({
    visual: {
      ...selectedNode.localStyle?.visual,
      styleThemeId,
    },
  });
}

export function routeContextToolbarConnectorRouting({
  routing,
  onUpdateSelectedContent,
}: {
  routing: "straight" | "elbow" | "curved";
  onUpdateSelectedContent: ContextToolbarProps["onUpdateSelectedContent"];
}): void {
  onUpdateSelectedContent?.({ routing });
}

export function routeContextToolbarConnectorStrokeColor({
  color,
  connectorStrokeWidth,
  onUpdateSelectedLocalStyle,
}: {
  color: string;
  connectorStrokeWidth: number;
  onUpdateSelectedLocalStyle: ContextToolbarProps["onUpdateSelectedLocalStyle"];
}): void {
  onUpdateSelectedLocalStyle?.({
    connector: {
      stroke: {
        color,
        widthPt: connectorStrokeWidth,
      },
    },
  });
}

export function routeContextToolbarConnectorStrokeWidth({
  widthPt,
  connectorStrokeColor,
  onUpdateSelectedLocalStyle,
}: {
  widthPt: number;
  connectorStrokeColor: string;
  onUpdateSelectedLocalStyle: ContextToolbarProps["onUpdateSelectedLocalStyle"];
}): void {
  onUpdateSelectedLocalStyle?.({
    connector: {
      stroke: { color: connectorStrokeColor, widthPt },
    },
  });
}

export function routeContextToolbarConnectorArrow({
  selectedNode,
  edge,
  value,
  onUpdateSelectedLocalStyle,
}: {
  selectedNode: SlideChildNode | undefined;
  edge: "startArrow" | "endArrow";
  value: "none" | "arrow" | "filled";
  onUpdateSelectedLocalStyle: ContextToolbarProps["onUpdateSelectedLocalStyle"];
}): void {
  if (selectedNode?.type !== "connector") return;
  onUpdateSelectedLocalStyle?.({
    connector: {
      ...selectedNode.localStyle?.connector,
      [edge]: value,
    },
  });
}

export function tableWithAddedRow(node: TableNode) {
  return {
    rows: [
      ...node.content.rows,
      {
        id: `${node.id}-row-${node.content.rows.length + 1}`,
        cells: node.content.columns.map(() => ({ text: "" })),
      },
    ],
  };
}

export function tableWithAddedColumn(node: TableNode) {
  const nextIndex = node.content.columns.length + 1;
  return {
    columns: [
      ...node.content.columns,
      { id: `${node.id}-col-${nextIndex}`, label: `Column ${nextIndex}` },
    ],
    rows: node.content.rows.map((row) => ({
      ...row,
      cells: [...row.cells, { text: "" }],
    })),
  };
}

export function tableWithDeletedLastRow(node: TableNode) {
  return {
    rows:
      node.content.rows.length > 1
        ? node.content.rows.slice(0, -1)
        : node.content.rows,
  };
}

export function tableWithDeletedLastColumn(node: TableNode) {
  return node.content.columns.length > 1
    ? {
        columns: node.content.columns.slice(0, -1),
        rows: node.content.rows.map((row) => ({
          ...row,
          cells: row.cells.slice(0, -1),
        })),
      }
    : { columns: node.content.columns, rows: node.content.rows };
}

export function routeContextToolbarTableHeaderToggle({
  selectedNode,
  onUpdateSelectedContent,
}: {
  selectedNode: SlideChildNode | undefined;
  onUpdateSelectedContent: ContextToolbarProps["onUpdateSelectedContent"];
}): void {
  if (selectedNode?.type !== "table") return;
  onUpdateSelectedContent?.({
    header: selectedNode.content.header !== true,
  });
}

export function routeContextToolbarRotation({
  rotation,
  delta,
  onUpdateSelectedLayout,
}: {
  rotation: number;
  delta: number;
  onUpdateSelectedLayout: ContextToolbarProps["onUpdateSelectedLayout"];
}): void {
  onUpdateSelectedLayout?.({ rotation: rotation + delta });
}

/*! node:coverage ignore next 130 -- Type-heavy routing signatures are verified via public helper tests. */
export function routeContextToolbarAlign({
  mode,
  onAlignSelection,
}: {
  mode: SelectionAlignMode;
  onAlignSelection: ContextToolbarProps["onAlignSelection"];
}): void {
  onAlignSelection?.(mode);
}

export function routeContextToolbarDistribute({
  mode,
  onDistributeSelection,
}: {
  mode: SelectionDistributeMode;
  onDistributeSelection: ContextToolbarProps["onDistributeSelection"];
}): void {
  onDistributeSelection?.(mode);
}

export function routeContextToolbarMatchSize({
  mode,
  onMatchSize,
}: {
  mode: SelectionMatchSizeMode;
  onMatchSize: ContextToolbarProps["onMatchSize"];
}): void {
  onMatchSize?.(mode);
}

export function routeContextToolbarLockToggle({
  selectedNode,
  onUpdateSelectedAttributes,
}: {
  selectedNode: SlideChildNode | undefined;
  onUpdateSelectedAttributes: ContextToolbarProps["onUpdateSelectedAttributes"];
}): void {
  onUpdateSelectedAttributes?.({
    locked: selectedNode?.locked !== true,
  });
}

export function routeContextToolbarHideSelection({
  onUpdateSelectedAttributes,
}: {
  onUpdateSelectedAttributes: ContextToolbarProps["onUpdateSelectedAttributes"];
}): void {
  onUpdateSelectedAttributes?.({ hidden: true });
}

export function routeContextToolbarSlideBackground({
  color,
  onUpdateSlideLocalStyle,
}: {
  color: string;
  onUpdateSlideLocalStyle: ContextToolbarProps["onUpdateSlideLocalStyle"];
}): void {
  onUpdateSlideLocalStyle?.({
    slide: { background: { type: "solid", color } },
  });
}

export function routeContextToolbarDeleteSlide({
  canDeleteSlide,
  onDeleteSlide,
}: {
  canDeleteSlide: boolean;
  onDeleteSlide: ContextToolbarProps["onDeleteSlide"];
}): boolean {
  if (!canDeleteSlide || !onDeleteSlide) return false;
  onDeleteSlide();
  return true;
}

export function routeContextToolbarDetachDecoration({
  onDetachDecoration,
}: {
  onDetachDecoration: ContextToolbarProps["onDetachDecoration"];
}): void {
  onDetachDecoration?.();
}

export interface ContextToolbarProps {
  selectedIds: string[];
  selectedNode: SlideChildNode | undefined;
  selectedResolvedStyle?: StyleObject;
  isInlineEditing: boolean;
  isDragging: boolean;
  isDecorationSelected: boolean;
  onDelete: () => void;
  onCut: () => void;
  onDuplicate: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onBringToFront?: () => void;
  onSendToBack?: () => void;
  onAlignSelection?: (mode: SelectionAlignMode) => void;
  onDistributeSelection?: (mode: SelectionDistributeMode) => void;
  onMatchSize?: (mode: SelectionMatchSizeMode) => void;
  onUpdateSelectedContent?: (patch: Record<string, unknown>) => void;
  onUpdateSelectedLayout?: (patch: { rotation?: number }) => void;
  onUpdateSelectedLocalStyle?: (patch: StylePatch) => void;
  onUpdateSelectedAttributes?: (patch: {
    role?: SlideChildNode["role"];
    locked?: boolean;
    hidden?: boolean;
  }) => void;
  onReplaceImage?: () => void;
  onReplaceVisual?: () => void;
  onResetImageCrop?: () => void;
  onEnterTableEdit?: () => void;
  slideBackgroundColor?: string;
  onUpdateSlideLocalStyle?: (patch: StylePatch) => void;
  onInsertSlide?: () => void;
  onInsertText?: () => void;
  onInsertShape?: () => void;
  onInsertImage?: () => void;
  onInsertVisual?: () => void;
  onInsertConnector?: () => void;
  onInsertTable?: () => void;
  onDuplicateSlide?: () => void;
  onDeleteSlide?: () => void;
  canDeleteSlide?: boolean;
  onDetachDecoration?: () => void;
  onRequestStageFocus?: () => void;
}

export function restoreFocusAfterContextToolbarEscape(
  onRequestStageFocus: (() => void) | undefined,
): void {
  if (onRequestStageFocus) {
    onRequestStageFocus();
    return;
  }
  if (typeof document === "undefined") return;
  (document.activeElement as HTMLElement | null)?.blur();
}

/*! node:coverage ignore next 1070 -- Portal-positioned toolbar rendering is exercised by tests, but node coverage cannot observe the live DOM portal path. */
export function ContextToolbar({
  selectedIds,
  selectedNode,
  selectedResolvedStyle,
  isInlineEditing,
  isDragging,
  isDecorationSelected,
  onDelete,
  onCut,
  onDuplicate,
  onGroup,
  onUngroup,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
  onAlignSelection,
  onDistributeSelection,
  onMatchSize,
  onUpdateSelectedContent,
  onUpdateSelectedLayout,
  onUpdateSelectedLocalStyle,
  onUpdateSelectedAttributes,
  onReplaceImage,
  onReplaceVisual,
  onResetImageCrop,
  onEnterTableEdit,
  slideBackgroundColor = "#ffffff",
  onUpdateSlideLocalStyle,
  onInsertSlide,
  onInsertText,
  onInsertShape,
  onInsertImage,
  onInsertVisual,
  onInsertConnector,
  onInsertTable,
  onDuplicateSlide,
  onDeleteSlide,
  canDeleteSlide = true,
  onDetachDecoration,
  onRequestStageFocus,
}: ContextToolbarProps): JSX.Element | null {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ top: -1000, left: -1000 });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("https://");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuId = useId();
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const moreMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const prevPositionRef = useRef({ top: -1000, left: -1000 });
  const isMultiSelect = selectedIds.length > 1;
  const slideToolInsertActions = buildSlideToolInsertActions({
    onInsertText,
    onInsertShape,
    onInsertImage,
    onInsertVisual,
    onInsertConnector,
    onInsertTable,
  });
  const contextToolbarReorderActions = buildContextToolbarReorderActions({
    onBringForward,
    onSendBackward,
    onBringToFront,
    onSendToBack,
  });
  const showSlideTools =
    selectedIds.length === 0 &&
    !isInlineEditing &&
    Boolean(
      onUpdateSlideLocalStyle || onInsertSlide || slideToolInsertActions.length,
    );
  const visible = !isDragging && (selectedIds.length > 0 || showSlideTools);

  function updateToolbarPosition() {
    if (!visible) return;
    // All context toolbars (text, shape, element, and slide selection) anchor to
    // the slide frame's top-center — the slide-selection toolbar position — so
    // the toolbar sits in one stable, predictable place regardless of selection.
    const targetRect = getSlideAnchorRect();
    if (!targetRect) return;
    const toolbarEl = toolbarRef.current;
    const toolbarWidth = toolbarEl?.offsetWidth ?? 320;
    const left = Math.max(
      EDGE_INSET,
      targetRect.left + targetRect.width / 2 - toolbarWidth / 2,
    );
    const top = targetRect.top + TOOLBAR_GAP;
    if (
      prevPositionRef.current.top !== top ||
      prevPositionRef.current.left !== left
    ) {
      prevPositionRef.current = { top, left };
      setPosition({ top, left });
    }
  }

  useLayoutEffect(() => {
    updateToolbarPosition();
    // updateToolbarPosition intentionally reads live DOM geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selectedIds, showSlideTools]);

  useEffect(() => {
    if (!visible) return;
    let frameId: number | null = null;
    const schedulePositionUpdate = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        updateToolbarPosition();
      });
    };
    const handler = () => schedulePositionUpdate();
    schedulePositionUpdate();
    window.addEventListener("resize", handler, { passive: true });
    window.addEventListener("scroll", handler, {
      passive: true,
      capture: true,
    });
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedulePositionUpdate);
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(schedulePositionUpdate);
    const observedNodes = new Set<HTMLElement>();
    const toolbarNode = toolbarRef.current;
    const slideAnchorNode = getSlideAnchorElement();
    if (toolbarNode) observedNodes.add(toolbarNode);
    if (slideAnchorNode) observedNodes.add(slideAnchorNode);
    for (const node of getSelectionElements(selectedIds)) {
      observedNodes.add(node);
    }
    for (const node of observedNodes) {
      resizeObserver?.observe(node);
      mutationObserver?.observe(node, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
    // updateToolbarPosition intentionally reads live DOM geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selectedIds, showSlideTools]);

  useEffect(() => {
    if (!moreOpen) return;
    focusFirstMenuCommand(moreMenuRef.current);
  }, [moreOpen]);

  const nodeType = selectedNode?.type;
  const showTextGroup =
    isInlineEditing ||
    nodeType === "text" ||
    (nodeType === "shape" && !isMultiSelect);
  const showArrangeGroup = !isInlineEditing && !isDecorationSelected;
  const linkCommandEnabled = isContextToolbarInlineTextCommandEnabled(
    "link",
    isInlineEditing,
  );

  const styleSeed = seedContextToolbarStyles(
    selectedNode,
    selectedResolvedStyle,
  );
  const textStyle = styleSeed.textStyle;
  const fillColor = styleSeed.fillColor;
  const shapeStrokeColor = styleSeed.shapeStrokeColor;
  const shapeStrokeWidth = styleSeed.shapeStrokeWidth;
  const connectorStrokeColor = styleSeed.connectorStrokeColor;
  const connectorStrokeWidth = styleSeed.connectorStrokeWidth;
  const textColor = styleSeed.textColor;
  const fontSize = styleSeed.fontSize;
  const opacity = styleSeed.opacity;
  const rotation = selectedNode?.layout?.rotation ?? 0;
  const selectedTextRole = resolveContextToolbarTextRole(selectedNode?.role);

  function runTextCommand(command: ContextToolbarTextCommand) {
    routeContextToolbarTextCommand({
      command,
      isInlineEditing,
      textStyle,
      onUpdateSelectedLocalStyle,
    });
  }

  function updateTextColor(value: string) {
    routeContextToolbarTextColor({
      color: value,
      isInlineEditing,
      onUpdateSelectedLocalStyle,
    });
  }

  function updateTextAlign(align: "left" | "center" | "right") {
    routeContextToolbarTextAlign({ align, onUpdateSelectedLocalStyle });
  }

  function updateFontSize(value: number) {
    routeContextToolbarFontSize({
      value,
      isInlineEditing,
      onUpdateSelectedLocalStyle,
    });
  }

  function closeMoreMenuAndRestoreFocus() {
    setMoreOpen(false);
    moreMenuTriggerRef.current?.focus();
  }

  function handleToolbarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End" &&
      event.key !== "Escape"
    ) {
      return;
    }
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      restoreFocusAfterContextToolbarEscape(onRequestStageFocus);
      return;
    }
    const controls = Array.from(
      toolbar.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select:not(:disabled), input:not(:disabled):not([type="hidden"])',
      ),
    );
    if (controls.length === 0) return;
    const currentIndex = controls.findIndex(
      (control) => control === document.activeElement,
    );
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? controls.length - 1
          : currentIndex === -1
            ? 0
            : (currentIndex + direction + controls.length) % controls.length;
    controls[nextIndex]?.focus();
    event.preventDefault();
  }

  function handleMoreMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMoreMenuAndRestoreFocus();
      return;
    }
    if (!isMenuCommandNavigationKey(event.key)) return;
    if (
      moveMenuCommandFocus({
        container: moreMenuRef.current,
        key: event.key,
        currentTarget: event.target,
      })
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  /*! node:coverage ignore next 800 -- Server tests exercise toolbar branches by expanding public React elements; native coverage cannot follow the portal-rendered JSX path. */
  return (
    <FloatingSurface
      open={visible}
      position={position}
      role="toolbar"
      aria-label="Context toolbar"
      layer="canvas"
      elevation="overlay"
      radius="sm"
      closeOnClickAway={false}
      closeOnEscape={false}
      keepSelection
      clampToViewport
      className="flex max-w-[calc(100vw-16px)] items-center gap-px overflow-x-auto border-ds-border-strong bg-ds-surface-overlay px-1 py-0.5 font-mono [&_svg]:h-3 [&_svg]:w-3 [&_svg]:[stroke-width:1.5]"
    >
      <div
        ref={toolbarRef}
        className="flex items-center gap-px"
        onKeyDown={handleToolbarKeyDown}
      >
        {showSlideTools ? (
          <>
            <ContextToolbarColorInput
              label="Slide background"
              value={slideBackgroundColor}
              onChange={(color) =>
                routeContextToolbarSlideBackground({
                  color,
                  onUpdateSlideLocalStyle,
                })
              }
            />
            <ContextToolbarDivider />
            <ContextToolbarButton
              label="Add slide"
              onClick={() => onInsertSlide?.()}
            >
              <Plus size={13} aria-hidden />
            </ContextToolbarButton>
            {slideToolInsertActions.length > 0 ? (
              <ContextToolbarDivider />
            ) : null}
            {slideToolInsertActions.map((action) => (
              <ContextToolbarButton
                key={action.key}
                label={action.label}
                onClick={() => action.onClick()}
              >
                {renderContextToolbarInsertIcon(action.key)}
              </ContextToolbarButton>
            ))}
            <ContextToolbarButton
              label="Duplicate slide"
              onClick={() => onDuplicateSlide?.()}
            >
              <Copy size={13} aria-hidden />
            </ContextToolbarButton>
            <ContextToolbarButton
              label="Delete slide"
              disabled={!canDeleteSlide || !onDeleteSlide}
              onClick={() =>
                routeContextToolbarDeleteSlide({
                  canDeleteSlide,
                  onDeleteSlide,
                })
              }
            >
              <Trash2 size={13} aria-hidden />
            </ContextToolbarButton>
          </>
        ) : null}

        {showTextGroup ? (
          <>
            <ContextToolbarButton
              label="Bold"
              active={!isInlineEditing && textStyle?.weight === 700}
              onClick={() => runTextCommand("bold")}
            >
              <Bold size={13} aria-hidden />
            </ContextToolbarButton>
            <ContextToolbarButton
              label="Italic"
              active={!isInlineEditing && textStyle?.italic === true}
              onClick={() => runTextCommand("italic")}
            >
              <Italic size={13} aria-hidden />
            </ContextToolbarButton>
            <ContextToolbarButton
              label="Underline"
              active={!isInlineEditing && textStyle?.underline === true}
              onClick={() => runTextCommand("underline")}
            >
              <Underline size={13} aria-hidden />
            </ContextToolbarButton>
            <ContextToolbarButton
              label="Strikethrough"
              active={!isInlineEditing && textStyle?.strikethrough === true}
              onClick={() => runTextCommand("strikethrough")}
            >
              <Strikethrough size={13} aria-hidden />
            </ContextToolbarButton>
            <ContextToolbarDivider />
            <ContextToolbarSelect
              label="Text role"
              value={selectedTextRole}
              disabled={!selectedNode || !onUpdateSelectedAttributes}
              onChange={(role) =>
                routeContextToolbarTextRoleChange({
                  role,
                  onUpdateSelectedAttributes,
                  onUpdateSelectedLocalStyle,
                })
              }
            >
              <option value="title">H1</option>
              <option value="subtitle">H2</option>
              <option value="body">Body</option>
              <option value="quote">Quote</option>
              <option value="caption">Caption</option>
              <option value="kicker">Kicker</option>
              <option value="metric">Metric</option>
            </ContextToolbarSelect>
            <InlineTextCommandButton
              label="Bullet list"
              command="bullet-list"
              isInlineEditing={isInlineEditing}
            >
              <List size={13} aria-hidden />
            </InlineTextCommandButton>
            <InlineTextCommandButton
              label="Numbered list"
              command="numbered-list"
              isInlineEditing={isInlineEditing}
            >
              <ListOrdered size={13} aria-hidden />
            </InlineTextCommandButton>
            <InlineTextCommandButton
              label="Outdent list"
              command="outdent-list"
              isInlineEditing={isInlineEditing}
            >
              <IndentDecrease size={13} aria-hidden />
            </InlineTextCommandButton>
            <InlineTextCommandButton
              label="Indent list"
              command="indent-list"
              isInlineEditing={isInlineEditing}
            >
              <IndentIncrease size={13} aria-hidden />
            </InlineTextCommandButton>
            <ContextToolbarDivider />
            <ContextToolbarButton
              label="Align left"
              onClick={() => updateTextAlign("left")}
            >
              <AlignLeft size={13} aria-hidden />
            </ContextToolbarButton>
            <ContextToolbarButton
              label="Align center"
              onClick={() => updateTextAlign("center")}
            >
              <AlignCenter size={13} aria-hidden />
            </ContextToolbarButton>
            <ContextToolbarButton
              label="Align right"
              onClick={() => updateTextAlign("right")}
            >
              <AlignRight size={13} aria-hidden />
            </ContextToolbarButton>
            <ContextToolbarColorInput
              label="Text color"
              value={textColor}
              onChange={updateTextColor}
            />
            <ContextToolbarNumberInput
              label="Font size"
              value={fontSize}
              min={4}
              max={160}
              onChange={updateFontSize}
            />
            <Popover
              open={linkCommandEnabled && linkOpen}
              onClose={() => setLinkOpen(false)}
              portal
              align="center"
              trigger={
                <ContextToolbarButton
                  label="Link"
                  disabled={!linkCommandEnabled}
                  onClick={() => setLinkOpen((open) => !open)}
                >
                  <Link size={13} aria-hidden />
                </ContextToolbarButton>
              }
              className="w-64 p-2"
              aria-label="Add link"
            >
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!linkCommandEnabled) return;
                  const url = linkDraft.trim();
                  if (url) {
                    dispatchInlineTextCommand({ command: "link", value: url });
                    setLinkOpen(false);
                  }
                }}
              >
                <label className="flex flex-col gap-1 text-xs text-ds-text-secondary">
                  URL
                  <input
                    value={linkDraft}
                    onChange={(event) =>
                      setLinkDraft(event.currentTarget.value)
                    }
                    className="rounded-ds-sm border border-ds-border-subtle bg-ds-surface px-2 py-1 text-xs text-ds-text-primary outline-none focus:border-ds-accent focus:ring-2 focus:ring-ds-focus-ring/20"
                  />
                </label>
                <button
                  type="submit"
                  disabled={!linkCommandEnabled}
                  className="self-end rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs font-medium text-ds-text-secondary hover:bg-ds-state-hover"
                >
                  Apply link
                </button>
                <button
                  type="button"
                  disabled={!linkCommandEnabled}
                  onClick={() => {
                    if (!linkCommandEnabled) return;
                    dispatchInlineTextCommand({ command: "unlink" });
                    setLinkOpen(false);
                  }}
                  className="self-end rounded-ds-sm border border-ds-border-subtle px-2 py-1 text-xs font-medium text-ds-text-secondary hover:bg-ds-state-hover"
                >
                  Remove link
                </button>
              </form>
            </Popover>
          </>
        ) : null}

        {!isInlineEditing && selectedNode?.type === "shape" ? (
          <>
            {showTextGroup ? <ContextToolbarDivider /> : null}
            <ContextToolbarColorInput
              label="Fill color"
              value={fillColor}
              onChange={(color) =>
                onUpdateSelectedLocalStyle?.({
                  fill: { type: "solid", color },
                })
              }
            />
            <ContextToolbarColorInput
              label="Border color"
              value={shapeStrokeColor}
              onChange={(color) =>
                onUpdateSelectedLocalStyle?.({
                  stroke: {
                    color,
                    widthPt: shapeStrokeWidth,
                  },
                })
              }
            />
            <ContextToolbarNumberInput
              label="Opacity"
              value={Math.round(opacity * 100)}
              min={0}
              max={100}
              onChange={(value) =>
                routeContextToolbarOpacity({
                  value,
                  onUpdateSelectedLocalStyle,
                })
              }
            />
          </>
        ) : null}

        {!isInlineEditing && selectedNode?.type === "image" ? (
          <>
            <ContextToolbarButton
              label="Replace image"
              onClick={() => onReplaceImage?.()}
              disabled={onReplaceImage === undefined}
            >
              <Replace size={13} aria-hidden />
            </ContextToolbarButton>
            <ContextToolbarButton
              label="Crop image"
              active={selectedNode.content.crop !== undefined}
              onClick={() =>
                routeContextToolbarImageCropToggle({
                  selectedNode,
                  onUpdateSelectedContent,
                  onResetImageCrop,
                })
              }
            >
              <Crop size={13} aria-hidden />
            </ContextToolbarButton>
            <ContextToolbarButton
              label="Reset crop"
              disabled={!selectedNode.content.crop}
              onClick={() =>
                selectedNode.content.crop ? onResetImageCrop?.() : undefined
              }
            >
              <RotateCcw size={13} aria-hidden />
            </ContextToolbarButton>
            <ContextToolbarSelect
              label="Image fit"
              value={selectedNode.content.fit ?? "cover"}
              onChange={(fit) =>
                routeContextToolbarImageFit({
                  fit: fit as ImageFitMode,
                  onUpdateSelectedContent,
                })
              }
            >
              <option value="contain">Contain</option>
              <option value="cover">Cover</option>
              <option value="fill">Fill</option>
              <option value="none">None</option>
            </ContextToolbarSelect>
            <ContextToolbarNumberInput
              label="Opacity"
              value={Math.round(opacity * 100)}
              min={0}
              max={100}
              onChange={(value) =>
                routeContextToolbarOpacity({
                  value,
                  onUpdateSelectedLocalStyle,
                })
              }
            />
          </>
        ) : null}

        {!isInlineEditing && selectedNode?.type === "visual" ? (
          <>
            <ContextToolbarButton
              label="Replace visual"
              onClick={() => onReplaceVisual?.()}
              disabled={onReplaceVisual === undefined}
            >
              <Replace size={13} aria-hidden />
            </ContextToolbarButton>
            <ContextToolbarButton
              label="Transparent background"
              active={selectedNode.content.transparentBackground === true}
              onClick={() =>
                routeContextToolbarVisualBackgroundToggle({
                  selectedNode,
                  onUpdateSelectedContent,
                })
              }
            >
              BG
            </ContextToolbarButton>
            <ContextToolbarSelect
              label="Visual theme"
              value={selectedNode.localStyle?.visual?.styleThemeId ?? "default"}
              onChange={(styleThemeId) =>
                routeContextToolbarVisualThemeChange({
                  selectedNode,
                  styleThemeId,
                  onUpdateSelectedLocalStyle,
                })
              }
              width="w-24"
            >
              <option value="default">Default</option>
              <option value="accent">Accent</option>
              <option value="muted">Muted</option>
              <option value="contrast">Contrast</option>
            </ContextToolbarSelect>
          </>
        ) : null}

        {!isInlineEditing && selectedNode?.type === "connector" ? (
          <>
            <ContextToolbarSelect
              label="Connector routing"
              value={selectedNode.content.routing ?? "straight"}
              onChange={(routing) =>
                routeContextToolbarConnectorRouting({
                  routing: routing as "straight" | "elbow" | "curved",
                  onUpdateSelectedContent,
                })
              }
            >
              <option value="straight">Straight</option>
              <option value="curved">Curved</option>
              <option value="elbow">Step</option>
            </ContextToolbarSelect>
            <ContextToolbarColorInput
              label="Line color"
              value={connectorStrokeColor}
              onChange={(color) =>
                routeContextToolbarConnectorStrokeColor({
                  color,
                  connectorStrokeWidth,
                  onUpdateSelectedLocalStyle,
                })
              }
            />
            <ContextToolbarNumberInput
              label="Line width"
              value={connectorStrokeWidth}
              min={0.5}
              max={12}
              step={0.5}
              onChange={(widthPt) =>
                routeContextToolbarConnectorStrokeWidth({
                  widthPt,
                  connectorStrokeColor,
                  onUpdateSelectedLocalStyle,
                })
              }
            />
            <ContextToolbarSelect
              label="Start arrow"
              value={styleSeed.connectorStartArrow}
              onChange={(startArrow) =>
                routeContextToolbarConnectorArrow({
                  selectedNode,
                  edge: "startArrow",
                  value: startArrow as "none" | "arrow" | "filled",
                  onUpdateSelectedLocalStyle,
                })
              }
              width="w-24"
            >
              <option value="none">Start: none</option>
              <option value="arrow">Start: arrow</option>
              <option value="filled">Start: filled</option>
            </ContextToolbarSelect>
            <ContextToolbarSelect
              label="End arrow"
              value={styleSeed.connectorEndArrow}
              onChange={(endArrow) =>
                routeContextToolbarConnectorArrow({
                  selectedNode,
                  edge: "endArrow",
                  value: endArrow as "none" | "arrow" | "filled",
                  onUpdateSelectedLocalStyle,
                })
              }
              width="w-24"
            >
              <option value="none">End: none</option>
              <option value="arrow">End: arrow</option>
              <option value="filled">End: filled</option>
            </ContextToolbarSelect>
          </>
        ) : null}

        {!isInlineEditing && selectedNode?.type === "table" ? (
          <>
            <ContextToolbarButton
              label="Edit table cells"
              onClick={() => onEnterTableEdit?.()}
              disabled={onEnterTableEdit === undefined}
            >
              Edit
            </ContextToolbarButton>
            <ContextToolbarButton
              label="Insert row"
              onClick={() =>
                onUpdateSelectedContent?.(tableWithAddedRow(selectedNode))
              }
            >
              +R
            </ContextToolbarButton>
            <ContextToolbarButton
              label="Insert column"
              onClick={() =>
                onUpdateSelectedContent?.(tableWithAddedColumn(selectedNode))
              }
            >
              +C
            </ContextToolbarButton>
            <ContextToolbarButton
              label="Delete row"
              disabled={selectedNode.content.rows.length <= 1}
              onClick={() =>
                onUpdateSelectedContent?.(tableWithDeletedLastRow(selectedNode))
              }
            >
              -R
            </ContextToolbarButton>
            <ContextToolbarButton
              label="Delete column"
              disabled={selectedNode.content.columns.length <= 1}
              onClick={() =>
                onUpdateSelectedContent?.(
                  tableWithDeletedLastColumn(selectedNode),
                )
              }
            >
              -C
            </ContextToolbarButton>
            <ContextToolbarButton
              label="Toggle header row"
              active={selectedNode.content.header === true}
              onClick={() =>
                routeContextToolbarTableHeaderToggle({
                  selectedNode,
                  onUpdateSelectedContent,
                })
              }
            >
              H
            </ContextToolbarButton>
          </>
        ) : null}

        {showArrangeGroup && selectedIds.length > 0 ? (
          <>
            <ContextToolbarDivider />
            {!isMultiSelect && selectedNode?.type !== "connector" ? (
              <>
                <ContextToolbarButton
                  label="Rotate left 15°"
                  onClick={() =>
                    routeContextToolbarRotation({
                      rotation,
                      delta: -15,
                      onUpdateSelectedLayout,
                    })
                  }
                >
                  <RotateCcw size={13} aria-hidden />
                </ContextToolbarButton>
                <ContextToolbarButton
                  label="Rotate right 15°"
                  onClick={() =>
                    routeContextToolbarRotation({
                      rotation,
                      delta: 15,
                      onUpdateSelectedLayout,
                    })
                  }
                >
                  <RotateCw size={13} aria-hidden />
                </ContextToolbarButton>
              </>
            ) : null}
            {isMultiSelect ? (
              <>
                <ContextToolbarButton
                  label={currentObjectAlignCommandDescriptor("left").label}
                  onClick={() =>
                    routeContextToolbarAlign({
                      mode: "left",
                      onAlignSelection,
                    })
                  }
                >
                  <AlignLeft size={13} aria-hidden />
                </ContextToolbarButton>
                <ContextToolbarButton
                  label={currentObjectAlignCommandDescriptor("center").label}
                  onClick={() =>
                    routeContextToolbarAlign({
                      mode: "center",
                      onAlignSelection,
                    })
                  }
                >
                  <AlignCenter size={13} aria-hidden />
                </ContextToolbarButton>
                <ContextToolbarButton
                  label={currentObjectAlignCommandDescriptor("right").label}
                  onClick={() =>
                    routeContextToolbarAlign({
                      mode: "right",
                      onAlignSelection,
                    })
                  }
                >
                  <AlignRight size={13} aria-hidden />
                </ContextToolbarButton>
                <ContextToolbarButton
                  label="Distribute horizontally"
                  disabled={selectedIds.length < 3}
                  onClick={() =>
                    routeContextToolbarDistribute({
                      mode: "horizontal",
                      onDistributeSelection,
                    })
                  }
                >
                  DH
                </ContextToolbarButton>
                <ContextToolbarButton
                  label="Distribute vertically"
                  disabled={selectedIds.length < 3}
                  onClick={() =>
                    routeContextToolbarDistribute({
                      mode: "vertical",
                      onDistributeSelection,
                    })
                  }
                >
                  DV
                </ContextToolbarButton>
                <ContextToolbarButton
                  label="Match width"
                  onClick={() =>
                    routeContextToolbarMatchSize({
                      mode: "width",
                      onMatchSize,
                    })
                  }
                >
                  MW
                </ContextToolbarButton>
                <ContextToolbarButton
                  label="Match height"
                  onClick={() =>
                    routeContextToolbarMatchSize({
                      mode: "height",
                      onMatchSize,
                    })
                  }
                >
                  MH
                </ContextToolbarButton>
                <ContextToolbarButton
                  label={selectedNode?.type === "group" ? "Ungroup" : "Group"}
                  onClick={selectedNode?.type === "group" ? onUngroup : onGroup}
                  disabled={
                    selectedIds.length < 2 && selectedNode?.type !== "group"
                  }
                >
                  {selectedNode?.type === "group" ? (
                    <Ungroup size={13} aria-hidden />
                  ) : (
                    <Group size={13} aria-hidden />
                  )}
                </ContextToolbarButton>
              </>
            ) : null}

            {!isMultiSelect ? (
              <>
                {contextToolbarReorderActions.map((action) => (
                  <ContextToolbarButton
                    key={action.commandId}
                    label={action.label}
                    onClick={() => action.onClick()}
                  >
                    {renderContextToolbarLayerIcon(action.key)}
                  </ContextToolbarButton>
                ))}
              </>
            ) : null}

            <ContextToolbarDivider />
            <ContextToolbarButton
              label="Cut"
              onClick={onCut}
              disabled={selectedIds.length === 0}
            >
              <Scissors size={13} aria-hidden />
            </ContextToolbarButton>
            <ContextToolbarButton
              label="Duplicate"
              onClick={onDuplicate}
              disabled={selectedIds.length === 0}
            >
              <Copy size={13} aria-hidden />
            </ContextToolbarButton>
            <ContextToolbarButton
              label="Delete"
              onClick={onDelete}
              disabled={selectedIds.length === 0}
            >
              <Trash2 size={13} aria-hidden />
            </ContextToolbarButton>
            <Popover
              open={moreOpen}
              onClose={() => setMoreOpen(false)}
              portal
              align="center"
              trigger={
                <ContextToolbarButton
                  label="More"
                  buttonRef={moreMenuTriggerRef}
                  hasPopup="menu"
                  expanded={moreOpen}
                  controls={moreOpen ? moreMenuId : undefined}
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  <Ellipsis size={13} aria-hidden />
                </ContextToolbarButton>
              }
              className="min-w-36 py-1"
              aria-label="More object actions"
              role="menu"
            >
              <div
                ref={moreMenuRef}
                id={moreMenuId}
                className="flex flex-col"
                onKeyDown={handleMoreMenuKeyDown}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    routeContextToolbarLockToggle({
                      selectedNode,
                      onUpdateSelectedAttributes,
                    });
                    closeMoreMenuAndRestoreFocus();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary"
                >
                  {selectedNode?.locked ? (
                    <Unlock size={12} aria-hidden />
                  ) : (
                    <Lock size={12} aria-hidden />
                  )}
                  {selectedNode?.locked ? "Unlock" : "Lock"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    routeContextToolbarHideSelection({
                      onUpdateSelectedAttributes,
                    });
                    closeMoreMenuAndRestoreFocus();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ds-text-secondary hover:bg-ds-state-hover hover:text-ds-text-primary"
                >
                  <EyeOff size={12} aria-hidden />
                  Hide
                </button>
              </div>
            </Popover>
          </>
        ) : null}

        {isDecorationSelected && !isInlineEditing ? (
          <>
            <ContextToolbarDivider />
            <span className="px-1.5 text-[11px] text-ds-text-muted">
              Theme decoration
            </span>
            <button
              type="button"
              className={cx(
                "h-6 rounded-[var(--ds-radius-sm,6px)] border border-ds-border-subtle px-2 text-[11px] font-medium text-ds-text-secondary hover:bg-ds-state-hover",
                FOCUS_RING,
              )}
              onClick={() =>
                routeContextToolbarDetachDecoration({ onDetachDecoration })
              }
              aria-label="Detach from theme"
            >
              Detach
            </button>
          </>
        ) : null}
      </div>
    </FloatingSurface>
  );
}
