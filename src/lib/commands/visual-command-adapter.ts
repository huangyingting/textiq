/**
 * Visual command adapter — bridges UI surface callbacks to the typed
 * `executeVisualCommand` executor (issue #471).
 *
 * Provides a lightweight envelope builder so UI surfaces can dispatch
 * intent-typed commands without duplicating envelope wiring. The final
 * write (`node.setVisual`) stays in the adapter layer inside
 * `visual-card.tsx`; this module is pure and DOM-free.
 */

import { CURRENT_COMMAND_SCHEMA_VERSION } from "./envelope-core";
import { executeVisualCommand } from "@/lib/commands/visual-commands";
import type {
  VisualCommand,
  VisualCommandPayload,
  VisualCommandResult,
} from "@/lib/commands/visual-command-contracts";
import type { Visual } from "@/lib/visual/schema";

/**
 * Builds a minimal but valid {@link VisualCommand} envelope for a
 * UI-dispatched visual edit.
 *
 * @param payload      The typed command payload.
 * @param visualId     The stable id of the target visual.
 * @param documentId   Optional document id for metadata / audit.
 * @param coalesceKey  Optional coalescing key for gesture-driven edits.
 */
export function buildVisualCommand(
  payload: VisualCommandPayload,
  visualId: string,
  documentId?: string,
  coalesceKey?: string,
): VisualCommand {
  return {
    id: crypto.randomUUID(),
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    type: payload.op,
    timestamp: new Date().toISOString(),
    actor: { id: "ui" },
    target: {
      surface: "visual",
      ...(documentId ? { documentId } : {}),
      visualId,
    },
    payload,
    source: "user",
    ...(coalesceKey ? { coalesceKey } : {}),
  };
}

/**
 * Executes a typed visual command against `visual` and returns the full
 * {@link VisualCommandResult} (including `patches`, `sideEffects`, and
 * `affectedNodeIds`).
 *
 * This is the single routing point for UI-initiated visual edits:
 *
 * ```ts
 * const result = applyVisualCommand(
 *   visual, visualId, { op: "visual.apply_theme", themeId }
 * );
 * if (result.ok) node.setVisual(result.visual);
 * ```
 *
 * The `node.setVisual` call stays in the caller so the Lexical/Yjs write path
 * is never bypassed. This adapter only adds the command-metadata layer
 * (affected ids, patches, side effects, coalescing key).
 */
export function applyVisualCommand(
  visual: Visual,
  visualId: string,
  payload: VisualCommandPayload,
  documentId?: string,
  coalesceKey?: string,
): VisualCommandResult {
  const cmd = buildVisualCommand(payload, visualId, documentId, coalesceKey);
  return executeVisualCommand(visual, cmd);
}
