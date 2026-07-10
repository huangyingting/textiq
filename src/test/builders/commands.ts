import { CURRENT_COMMAND_SCHEMA_VERSION } from "@/lib/commands/command-envelope";
import type {
  VisualCommand,
  VisualCommandPayload,
} from "@/lib/commands/visual-command-contracts";

/** Default actor used across command test fixtures. */
export const FIXTURE_COMMAND_ACTOR = {
  id: "user-1",
  sessionId: "session-1",
} as const;

let _commandCounter = 0;

/** Reset the command ID counter between test runs if needed. */
export function resetCommandCounter(): void {
  _commandCounter = 0;
}

/**
 * Builds a minimal valid {@link VisualCommand} for unit tests.
 *
 * Provides stable defaults for actor, target, timestamp, and schemaVersion so
 * test files only need to supply the payload (and optional overrides).
 */
export function makeVisualCommand(
  payload: VisualCommandPayload,
  overrides: Partial<VisualCommand> = {},
): VisualCommand {
  _commandCounter += 1;
  return {
    id: `10000000-0000-4000-8000-${String(_commandCounter).padStart(12, "0")}`,
    schemaVersion: CURRENT_COMMAND_SCHEMA_VERSION,
    type: payload.op,
    timestamp: "2026-06-23T00:00:00.000Z",
    actor: FIXTURE_COMMAND_ACTOR,
    target: {
      surface: "visual",
      documentId: "doc-1",
      visualId: "vis-1",
    },
    payload,
    source: "user",
    ...overrides,
  };
}
