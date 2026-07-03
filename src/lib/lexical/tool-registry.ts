/**
 * Public registry facade for the editor's contextual surfaces.
 *
 * Responsibilities are intentionally split:
 * - `tool-metadata` owns labels, groups, shortcuts, and visual-kind metadata.
 * - `tool-predicates` owns pure `when` / `isActive` / value readers.
 * - `tool-mutations` is the only tool layer that mutates Lexical state.
 * - `tool-icons` resolves presentation metadata to icon components.
 */
import type { LexicalEditor } from "lexical";
import type { LucideIcon } from "lucide-react";

import { formatShortcut } from "@/lib/shortcuts/catalog";
import type { VisualKind } from "@/lib/visual/schema";
import { KIND_DISPLAY_METADATA } from "@/lib/visual/registry-display";

import { TOOL_METADATA, type ToolMetadata } from "./tool-metadata";
import {
  createVisualInsertRunner,
  TOOL_APPLIERS,
  TOOL_RUNNERS,
} from "./tool-mutations";
import { TOOL_ACTIVE, TOOL_VALUES, TOOL_VISIBILITY } from "./tool-predicates";
import { resolveToolIcon, type ToolIconName } from "./tool-icons";
import type { EditorContextSnapshot } from "./selection-snapshot";
import type { EditorTool, EditorToolGroup } from "./tool-types";

export { formatShortcut };
export type { EditorTool, EditorToolGroup } from "./tool-types";

export type VisualKindMeta = {
  label: string;
  icon: LucideIcon;
  description: string;
  keywords: readonly string[];
};

export const VISUAL_KIND_META = Object.entries(KIND_DISPLAY_METADATA).reduce<
  Record<VisualKind, VisualKindMeta>
>(
  (metadata, [kind, meta]) => ({
    ...metadata,
    [kind]: {
      label: meta.label,
      icon: resolveToolIcon(meta.icon as ToolIconName),
      description: meta.description,
      keywords: meta.keywords,
    },
  }),
  {} as Record<VisualKind, VisualKindMeta>,
);

const registry = new Map<string, EditorTool>();
const order: string[] = [];

function resolveRun(meta: ToolMetadata): EditorTool["run"] {
  if (meta.run) {
    const runner = TOOL_RUNNERS[meta.run] as (
      editor: LexicalEditor,
      ctx: EditorContextSnapshot,
    ) => void;
    return (editor, ctx) => runner(editor, ctx);
  }
  if (meta.visualKind) {
    return createVisualInsertRunner(meta.visualKind);
  }
  return undefined;
}

function toEditorTool(meta: ToolMetadata): EditorTool {
  return {
    id: meta.id,
    group: meta.group,
    label: meta.label,
    action: {
      id: meta.id,
      label: meta.label,
      description: meta.description,
      shortcutId: meta.shortcutId,
      tooltip: meta.description,
    },
    icon: meta.icon ? resolveToolIcon(meta.icon) : undefined,
    shortcut: meta.shortcut,
    shortcutId: meta.shortcutId,
    section: meta.section,
    control: meta.control,
    description: meta.description,
    keywords: meta.keywords,
    when: TOOL_VISIBILITY[meta.when],
    isActive: meta.isActive ? TOOL_ACTIVE[meta.isActive] : undefined,
    run: resolveRun(meta),
    value: meta.value ? TOOL_VALUES[meta.value] : undefined,
    apply: meta.apply ? TOOL_APPLIERS[meta.apply] : undefined,
  };
}

function registerTool(tool: EditorTool): void {
  if (!registry.has(tool.id)) {
    order.push(tool.id);
  }
  registry.set(tool.id, tool);
}

function registerTools(tools: readonly EditorTool[]): void {
  for (const tool of tools) {
    registerTool(tool);
  }
}

function getTools(): EditorTool[] {
  return order.map((id) => registry.get(id) as EditorTool);
}

registerTools(TOOL_METADATA.map(toEditorTool));

/* node:coverage ignore next 6 -- toolsFor filtering is asserted; tsx maps the exported signature as uncovered. */
export function toolsFor(
  group: EditorToolGroup,
  ctx: EditorContextSnapshot,
): EditorTool[] {
  return getTools().filter((tool) => tool.group === group && tool.when(ctx));
}

export function isToolActive(
  tool: EditorTool,
  ctx: EditorContextSnapshot,
): boolean {
  return tool.isActive ? tool.isActive(ctx) : false;
}
