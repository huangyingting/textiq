import { NextResponse, type NextRequest } from "next/server";

import { readFormData } from "@/lib/api/route-adapters";
import {
  IMPORT_ERROR_CODES,
  importFailure,
  type ImportRouteFailure,
  type ParsedImportUpload,
} from "@/lib/import/contract";
import {
  IMPORT_MULTIPART_MAX_PARTS,
  IMPORT_MULTIPART_TEXT_MAX_BYTES,
  IMPORT_MAX_UPLOAD_BYTES,
  IMPORT_MULTIPART_ENVELOPE_MAX_BYTES,
} from "@/lib/import/format-registry";

function importFailureResponse(
  failure: ImportRouteFailure,
): NextResponse<ImportRouteFailure> {
  return NextResponse.json(failure, { status: failure.error.status });
}

const FORM_FIELD_ALLOWLIST = new Set(["file", "target", "workspaceId"]);
const utf8Encoder = new TextEncoder();

function malformedResponse(message: string): NextResponse<ImportRouteFailure> {
  return importFailureResponse(
    importFailure(IMPORT_ERROR_CODES.MALFORMED, message, 422),
  );
}

function tooLargeResponse(message: string): NextResponse<ImportRouteFailure> {
  return importFailureResponse(
    importFailure(IMPORT_ERROR_CODES.TOO_LARGE, message),
  );
}

export async function parseImportUploadRequest(
  request: Pick<NextRequest, "formData"> &
    Partial<Pick<NextRequest, "headers">>,
): Promise<
  | { ok: true; parsed: ParsedImportUpload }
  | { ok: false; response: NextResponse<ImportRouteFailure> }
> {
  const form = await readFormData(
    request,
    "Request must be multipart/form-data.",
    (message) => malformedResponse(message),
    {
      maxBytes: IMPORT_MAX_UPLOAD_BYTES + IMPORT_MULTIPART_ENVELOPE_MAX_BYTES,
      tooLargeMessage: "Uploaded file is too large.",
    },
  );
  if (!form.ok) {
    if (form.response.status === 413) {
      return {
        ok: false,
        response: tooLargeResponse("Uploaded file is too large."),
      };
    }
    return {
      ok: false,
      response: malformedResponse("Request must be multipart/form-data."),
    };
  }

  const entries = Array.from(form.formData.entries());
  if (entries.length > IMPORT_MULTIPART_MAX_PARTS) {
    return {
      ok: false,
      response: malformedResponse("Too many form-data fields in upload."),
    };
  }

  let file: File | null = null;
  let targetRaw: string | null = null;
  let workspaceIdRaw: string | null = null;
  const seenFields = new Set<string>();

  for (const [key, value] of entries) {
    if (!FORM_FIELD_ALLOWLIST.has(key)) {
      return {
        ok: false,
        response: malformedResponse(`Unknown \`${key}\` field in form data.`),
      };
    }
    if (seenFields.has(key)) {
      return {
        ok: false,
        response: malformedResponse(`Duplicate \`${key}\` field in form data.`),
      };
    }
    seenFields.add(key);

    if (value instanceof File) {
      if (key !== "file") {
        return {
          ok: false,
          response: malformedResponse(`Field \`${key}\` must be a text value.`),
        };
      }
      file = value;
      continue;
    }

    const textSize = utf8Encoder.encode(value).byteLength;
    if (textSize > IMPORT_MULTIPART_TEXT_MAX_BYTES) {
      return {
        ok: false,
        response: malformedResponse(`Field \`${key}\` is too large.`),
      };
    }

    if (key === "file") {
      return {
        ok: false,
        response: malformedResponse("Invalid `file` field in form data."),
      };
    }
    if (key === "target") {
      targetRaw = value;
      continue;
    }
    if (key === "workspaceId") {
      workspaceIdRaw = value;
    }
  }

  if (!(file instanceof File)) {
    return {
      ok: false,
      response: malformedResponse("Missing `file` field in form data."),
    };
  }
  if (file.size > IMPORT_MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      response: tooLargeResponse("Uploaded file is too large."),
    };
  }

  if (targetRaw === null || targetRaw.trim().length === 0) {
    return {
      ok: false,
      response: malformedResponse("Missing `target` field in form data."),
    };
  }
  const target = targetRaw.trim();

  if (target === "personal") {
    if (workspaceIdRaw !== null && workspaceIdRaw.trim().length > 0) {
      return {
        ok: false,
        response: malformedResponse(
          "Unexpected `workspaceId` for personal import target.",
        ),
      };
    }
    return {
      ok: true,
      parsed: { file, target: { kind: "personal" } },
    };
  }
  if (target === "workspace") {
    if (workspaceIdRaw === null || workspaceIdRaw.trim().length === 0) {
      return {
        ok: false,
        response: malformedResponse(
          "Missing `workspaceId` for workspace import target.",
        ),
      };
    }
    return {
      ok: true,
      parsed: {
        file,
        target: { kind: "workspace", workspaceId: workspaceIdRaw.trim() },
      },
    };
  }

  return {
    ok: false,
    response: malformedResponse("Invalid `target` field in form data."),
  };
}
