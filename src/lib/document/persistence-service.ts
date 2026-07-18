/**
 * Document persistence/domain service (#474, #470).
 *
 * Thin barrel — implementation is split by concern under ./persistence/:
 *  - sharing.ts    — share enable/disable, link regeneration, policy, cache revalidation
 *  - visual.ts     — Lexical save + Visual mirror rebuild (atomic), standalone rebuild,
 *                    post-mirror deck reconciliation
 *  - versioning.ts — version snapshot restore (sanitizeRestoredDeck, restoreVersion)
 *  - deck.ts       — deck save / patch / command with optimistic revision tokens
 *
 * Importers continue to `import … from ".../persistence-service"` unchanged.
 */

export {
  setDocumentSharing,
  regenerateDocumentShareLink,
  updateDocumentSharePolicyData,
  revalidateSharePaths,
} from "./persistence/sharing";

export type { VisualMirrorOutcome } from "./persistence/visual";
export {
  mirrorVisualNodesInTx,
  atomicSaveDocumentLexical,
  rebuildMirror,
  reconcileDeckAfterMirror,
} from "./persistence/visual";

export type { RestoredDocumentVersion } from "./persistence/versioning";
export {
  RestoredDeckValidationError,
  isRestoredDeckValidationError,
  sanitizeRestoredDeck,
  restoreVersion,
} from "./persistence/versioning";

export type { SaveDeckResult } from "./persistence/deck";
export { persistDeck } from "./persistence/deck";
