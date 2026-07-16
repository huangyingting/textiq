/**
 * Shared import format/resource registry.
 *
 * Pure constants + helpers only (no server-only dependencies) so both client
 * and server can derive MIME allowlists, picker accept strings, telemetry
 * labels, and budgets from one authoritative readonly list.
 */

export const IMPORT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const IMPORT_TEXT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const IMPORT_MULTIPART_ENVELOPE_MAX_BYTES = 256 * 1024;
export const IMPORT_MULTIPART_MAX_PARTS = 4;
export const IMPORT_MULTIPART_TEXT_MAX_BYTES = 4 * 1024;
export const IMPORT_PARSE_TIMEOUT_MS = 15_000;

export const IMPORT_ARCHIVE_BUDGET = {
  maxEntries: 2_000,
  maxUncompressedBytes: 80 * 1024 * 1024,
  maxEntryBytes: 20 * 1024 * 1024,
} as const;

type ImportResourceId = "markdown" | "html" | "docx" | "pptx" | "pdf" | "text";

export type ImportTelemetryFileType = "md" | "html" | "docx" | "pptx" | "pdf";

type ImportResourceDefinition = {
  id: ImportResourceId;
  telemetryFileType: ImportTelemetryFileType;
  mimes: readonly string[];
  extensions: readonly string[];
  pickerExtensions?: readonly string[];
  maxFileBytes: number;
  archiveBudget?: typeof IMPORT_ARCHIVE_BUDGET;
};

export const IMPORT_RESOURCES = [
  {
    id: "markdown",
    telemetryFileType: "md",
    mimes: ["text/markdown", "text/x-markdown"],
    extensions: [".md", ".markdown"],
    pickerExtensions: [".md"],
    maxFileBytes: IMPORT_TEXT_MAX_UPLOAD_BYTES,
  },
  {
    id: "text",
    telemetryFileType: "md",
    mimes: ["text/plain"],
    extensions: [],
    pickerExtensions: [],
    maxFileBytes: IMPORT_TEXT_MAX_UPLOAD_BYTES,
  },
  {
    id: "html",
    telemetryFileType: "html",
    mimes: ["text/html"],
    extensions: [".html", ".htm"],
    pickerExtensions: [".html", ".htm"],
    maxFileBytes: IMPORT_TEXT_MAX_UPLOAD_BYTES,
  },
  {
    id: "docx",
    telemetryFileType: "docx",
    mimes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    extensions: [".docx"],
    pickerExtensions: [".docx"],
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
    pickerExtensions: [".pptx"],
    maxFileBytes: IMPORT_MAX_UPLOAD_BYTES,
    archiveBudget: IMPORT_ARCHIVE_BUDGET,
  },
  {
    id: "pdf",
    telemetryFileType: "pdf",
    mimes: ["application/pdf"],
    extensions: [".pdf"],
    pickerExtensions: [".pdf"],
    maxFileBytes: IMPORT_MAX_UPLOAD_BYTES,
  },
] as const satisfies readonly ImportResourceDefinition[];

export type ImportAcceptedMimeType =
  (typeof IMPORT_RESOURCES)[number]["mimes"][number];

export type ImportResource = (typeof IMPORT_RESOURCES)[number];

function collectUniqueValues<T extends string>(
  groups: readonly (readonly T[])[],
): readonly T[] {
  const seen = new Set<T>();
  const values: T[] = [];
  for (const group of groups) {
    for (const value of group) {
      if (seen.has(value)) continue;
      seen.add(value);
      values.push(value);
    }
  }
  return values;
}

function pickerExtensions(resource: ImportResource): readonly string[] {
  return resource.pickerExtensions ?? resource.extensions;
}

export const IMPORT_ACCEPTED_MIME_TYPES = collectUniqueValues(
  IMPORT_RESOURCES.map((resource) => resource.mimes),
);

const IMPORT_PICKER_EXTENSIONS = collectUniqueValues(
  IMPORT_RESOURCES.map((resource) => pickerExtensions(resource)),
);

export const IMPORT_ACCEPT = IMPORT_PICKER_EXTENSIONS.join(",");
export const IMPORT_ACCEPT_LABEL = IMPORT_PICKER_EXTENSIONS.join(", ");
export const IMPORT_MAX_SIZE_LABEL = `${Math.floor(IMPORT_MAX_UPLOAD_BYTES / (1024 * 1024))} MB`;

const RESOURCE_BY_MIME = new Map<string, ImportResource>();
const RESOURCE_BY_EXTENSION = new Map<string, ImportResource>();

for (const resource of IMPORT_RESOURCES) {
  for (const mime of resource.mimes) {
    RESOURCE_BY_MIME.set(mime, resource);
  }
  for (const extension of resource.extensions) {
    RESOURCE_BY_EXTENSION.set(extension, resource);
  }
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
}

function extensionFromFileName(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  if (index < 0) return "";
  return fileName.slice(index).toLowerCase();
}

export function importResourceForMime(mimeType: string): ImportResource | null {
  const normalized = normalizeMimeType(mimeType);
  if (!normalized) return null;
  return RESOURCE_BY_MIME.get(normalized) ?? null;
}

export function importResourceForExtension(
  fileName: string,
): ImportResource | null {
  const extension = extensionFromFileName(fileName);
  if (!extension) return null;
  return RESOURCE_BY_EXTENSION.get(extension) ?? null;
}

export function resolveImportResource(
  mimeType: string,
  fileName: string,
): ImportResource | null {
  const byMime = importResourceForMime(mimeType);
  if (byMime) return byMime;
  return importResourceForExtension(fileName);
}

export function maxBytesForImportMime(
  mimeType: ImportAcceptedMimeType,
): number {
  const resource = importResourceForMime(mimeType);
  if (!resource) {
    throw new Error(`Unsupported MIME type: ${mimeType}`);
  }
  return resource.maxFileBytes;
}

export const IMPORT_MAX_BYTES_BY_MIME = Object.freeze(
  Object.fromEntries(
    IMPORT_ACCEPTED_MIME_TYPES.map((mimeType) => [
      mimeType,
      maxBytesForImportMime(mimeType),
    ]),
  ),
);

export function telemetryFileTypeForImport(
  input: Pick<File, "name" | "type">,
): ImportTelemetryFileType | "unknown" {
  const byMime = importResourceForMime(input.type);
  if (byMime) return byMime.telemetryFileType;

  const byExtension = importResourceForExtension(input.name);
  if (byExtension) return byExtension.telemetryFileType;

  return "unknown";
}
