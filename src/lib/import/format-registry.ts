/**
 * Shared import format/resource registry.
 *
 * Pure constants + helpers only (no server-only dependencies) so both client
 * and server can use one authoritative source for extensions, MIME aliases,
 * telemetry labels, and budgets.
 */

export const IMPORT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const IMPORT_TEXT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const IMPORT_MULTIPART_ENVELOPE_MAX_BYTES = 256 * 1024;
export const IMPORT_PARSE_TIMEOUT_MS = 15_000;

export const IMPORT_ARCHIVE_BUDGET = {
  maxEntries: 2_000,
  maxUncompressedBytes: 80 * 1024 * 1024,
  maxEntryBytes: 20 * 1024 * 1024,
} as const;

export const IMPORT_ACCEPT = ".md,.html,.htm,.docx,.pptx,.pdf";
export const IMPORT_ACCEPT_LABEL = ".md, .html, .docx, .pptx, .pdf";
export const IMPORT_MAX_SIZE_LABEL = "20 MB";

export const IMPORT_ACCEPTED_MIME_TYPES = [
  "text/markdown",
  "text/x-markdown",
  "text/plain",
  "text/html",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/pdf",
] as const;

export type ImportAcceptedMimeType =
  (typeof IMPORT_ACCEPTED_MIME_TYPES)[number];

export const IMPORT_MAX_BYTES_BY_MIME: Record<ImportAcceptedMimeType, number> =
  {
    "text/markdown": IMPORT_TEXT_MAX_UPLOAD_BYTES,
    "text/x-markdown": IMPORT_TEXT_MAX_UPLOAD_BYTES,
    "text/plain": IMPORT_TEXT_MAX_UPLOAD_BYTES,
    "text/html": IMPORT_TEXT_MAX_UPLOAD_BYTES,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      IMPORT_MAX_UPLOAD_BYTES,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      IMPORT_MAX_UPLOAD_BYTES,
    "application/pdf": IMPORT_MAX_UPLOAD_BYTES,
  };

type ImportResourceId = "markdown" | "html" | "docx" | "pptx" | "pdf" | "text";

export type ImportTelemetryFileType = "md" | "html" | "docx" | "pptx" | "pdf";

export type ImportResource = {
  id: ImportResourceId;
  telemetryFileType: ImportTelemetryFileType;
  mimes: readonly ImportAcceptedMimeType[];
  extensions: readonly string[];
  maxFileBytes: number;
  archiveBudget?: typeof IMPORT_ARCHIVE_BUDGET;
};

const IMPORT_RESOURCES: readonly ImportResource[] = [
  {
    id: "markdown",
    telemetryFileType: "md",
    mimes: ["text/markdown", "text/x-markdown"],
    extensions: [".md", ".markdown"],
    maxFileBytes: IMPORT_TEXT_MAX_UPLOAD_BYTES,
  },
  {
    id: "text",
    telemetryFileType: "md",
    mimes: ["text/plain"],
    extensions: [],
    maxFileBytes: IMPORT_TEXT_MAX_UPLOAD_BYTES,
  },
  {
    id: "html",
    telemetryFileType: "html",
    mimes: ["text/html"],
    extensions: [".html", ".htm"],
    maxFileBytes: IMPORT_TEXT_MAX_UPLOAD_BYTES,
  },
  {
    id: "docx",
    telemetryFileType: "docx",
    mimes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    extensions: [".docx"],
    maxFileBytes: IMPORT_MAX_UPLOAD_BYTES,
    archiveBudget: IMPORT_ARCHIVE_BUDGET,
  },
  {
    id: "pptx",
    telemetryFileType: "pptx",
    mimes: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    extensions: [".pptx"],
    maxFileBytes: IMPORT_MAX_UPLOAD_BYTES,
    archiveBudget: IMPORT_ARCHIVE_BUDGET,
  },
  {
    id: "pdf",
    telemetryFileType: "pdf",
    mimes: ["application/pdf"],
    extensions: [".pdf"],
    maxFileBytes: IMPORT_MAX_UPLOAD_BYTES,
  },
] as const;

const RESOURCE_BY_MIME: Record<ImportAcceptedMimeType, ImportResource> =
  IMPORT_RESOURCES.reduce(
    (map, resource) => {
      for (const mime of resource.mimes) {
        map[mime] = resource;
      }
      return map;
    },
    {} as Record<ImportAcceptedMimeType, ImportResource>,
  );

const RESOURCE_BY_EXTENSION: Record<string, ImportResource> =
  IMPORT_RESOURCES.reduce(
    (map, resource) => {
      for (const extension of resource.extensions) {
        map[extension] = resource;
      }
      return map;
    },
    {} as Record<string, ImportResource>,
  );

function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
}

function extensionFromFileName(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  if (index < 0) return "";
  return fileName.slice(index).toLowerCase();
}

export function importResourceForMime(
  mimeType: string,
): ImportResource | null {
  const normalized = normalizeMimeType(mimeType);
  if (!normalized) return null;
  if (!IMPORT_ACCEPTED_MIME_TYPES.includes(normalized as ImportAcceptedMimeType)) {
    return null;
  }
  return RESOURCE_BY_MIME[normalized as ImportAcceptedMimeType] ?? null;
}

export function importResourceForExtension(fileName: string): ImportResource | null {
  const extension = extensionFromFileName(fileName);
  if (!extension) return null;
  return RESOURCE_BY_EXTENSION[extension] ?? null;
}

export function resolveImportResource(
  mimeType: string,
  fileName: string,
): ImportResource | null {
  const byMime = importResourceForMime(mimeType);
  if (byMime) {
    return byMime;
  }
  return importResourceForExtension(fileName);
}

export function telemetryFileTypeForImport(
  input: Pick<File, "name" | "type">,
): ImportTelemetryFileType | "unknown" {
  const byMime = importResourceForMime(input.type);
  if (byMime) {
    return byMime.telemetryFileType;
  }

  const byExtension = importResourceForExtension(input.name);
  if (byExtension) {
    return byExtension.telemetryFileType;
  }

  return "unknown";
}
