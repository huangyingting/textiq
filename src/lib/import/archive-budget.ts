import JSZip from "jszip";
import { IMPORT_ARCHIVE_BUDGET } from "@/lib/import/format-registry";
import { throwIfAborted } from "@/lib/import/timeout";

export const IMPORT_ZIP_MAX_ENTRIES = IMPORT_ARCHIVE_BUDGET.maxEntries;
const IMPORT_ZIP_MAX_UNCOMPRESSED_BYTES =
  IMPORT_ARCHIVE_BUDGET.maxUncompressedBytes;
const IMPORT_ZIP_MAX_ENTRY_BYTES = IMPORT_ARCHIVE_BUDGET.maxEntryBytes;

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

export function disposeZip(zip: JSZip): void {
  for (const fileName of Object.keys(zip.files)) {
    delete zip.files[fileName];
  }
}

export async function loadZipWithinBudget(
  buffer: Buffer,
  signal?: AbortSignal,
): Promise<JSZip> {
  throwIfAborted(signal);
  const zip = await JSZip.loadAsync(buffer);
  throwIfAborted(signal);
  const entries = Object.values(zip.files);
  if (entries.length > IMPORT_ZIP_MAX_ENTRIES) {
    throw new ImportBudgetError("Archive contains too many files.");
  }

  let total = 0;
  for (const entry of entries) {
    throwIfAborted(signal);
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
