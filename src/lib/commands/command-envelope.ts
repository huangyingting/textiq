export {
  CURRENT_COMMAND_SCHEMA_VERSION,
  isPositiveNumber,
  isInteger,
  isNonNegativeNumber,
  isOneOf,
  isStringArray,
  uniqueStrings,
  pushUnknownKeyErrors,
  validateTarget,
  validateCommandEnvelopeStructure,
} from "./envelope-core";
export type {
  CommandSource,
  CommandTargetSurface,
  CommandActor,
  CommandTarget,
  CommandEnvelope,
  ValidationResult,
} from "./envelope-core";

/* node:coverage ignore start -- Barrel re-export facade is type/runtime wiring asserted through command tests. */
export {
  makeAffectedIds,
  makeSideEffects,
  adaptSlideCommandResult,
} from "./command-result-helpers";
/* node:coverage ignore stop */
export type {
  CommandAffectedIds,
  CrossSurfaceCommandResult,
} from "./command-result-helpers";

export { validateCommandEnvelope } from "./command-envelope-validation";

export { acceptDeckCommandEnvelope } from "./deck-command-acceptance";
export type {
  EnvelopeRejectionCode,
  EnvelopeAcceptance,
} from "./deck-command-acceptance";
