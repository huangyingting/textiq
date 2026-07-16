// Re-export aggregator — domain implementations live in the *-actions.ts siblings.
export { saveDocumentLexical, rebuildVisualMirror } from "./lexical-actions";
export {
  toggleDocumentSharing,
  regenerateShareLink,
  updateSharePolicy,
} from "./sharing-actions";
export { fetchDeckJson, saveDeckJson } from "./deck-actions";
export {
  listDocumentVersions,
  restoreDocumentVersion,
} from "./versioning-actions";
export { parseDocumentImportForEditor } from "./import-actions";
