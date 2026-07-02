import { validateDeckCommandPayload } from "@/lib/commands/deck-command-metadata";
import { validateVisualCommandPayload } from "./visual-command-metadata";
import {
  validateCommandEnvelopeStructure,
  type CommandEnvelope,
  type ValidationResult,
} from "./envelope-core";

export function validateCommandEnvelope(
  env: CommandEnvelope<unknown>,
): ValidationResult {
  const structural = validateCommandEnvelopeStructure(env);
  const errors = [...structural.errors];
  const envelopeType = typeof env?.type === "string" ? env.type : "";
  const looksVisual =
    envelopeType.startsWith("visual.") || structural.surface === "visual";

  if (looksVisual) {
    if (structural.surface !== "visual") {
      errors.push("Visual command envelopes must target the visual surface.");
    }
    validateVisualCommandPayload(envelopeType, env.payload, errors);
  } else if (structural.surface === "deck") {
    validateDeckCommandPayload(env.payload, env.target, errors);
  }

  return { valid: errors.length === 0, errors };
}
