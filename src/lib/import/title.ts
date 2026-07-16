export function deriveImportedDocumentTitle(fileName: string): string {
  return (
    fileName.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ") ||
    "Imported document"
  );
}
