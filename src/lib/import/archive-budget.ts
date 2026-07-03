import JSZip from "jszip";

export const IMPORT_ZIP_MAX_ENTRIES = 2_000;
const IMPORT_ZIP_MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;
const IMPORT_ZIP_MAX_ENTRY_BYTES = 20 * 1024 * 1024;

type ZipEntryWithSize = {
  _data?: {
    uncompressedSize?: unknown;
  };
};

export class ImportBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportBudgetError";
  }
}

export async function loadZipWithinBudget(buffer: Buffer): Promise<JSZip> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  if (entries.length > IMPORT_ZIP_MAX_ENTRIES) {
    throw new ImportBudgetError("Archive contains too many files.");
  }

  let total = 0;
  for (const entry of entries) {
    const data = (entry as ZipEntryWithSize)._data;
    const size =
      typeof data?.uncompressedSize === "number" ? data.uncompressedSize : 0;
    if (size > IMPORT_ZIP_MAX_ENTRY_BYTES) {
      throw new ImportBudgetError("Archive entry is too large.");
    }
    total += size;
    if (total > IMPORT_ZIP_MAX_UNCOMPRESSED_BYTES) {
      throw new ImportBudgetError("Archive expands to too much data.");
    }
  }

  return zip;
}
