import type { PublicRenderResult } from "./resolver-core";

export type PublicRouteProjection = "document" | "presentation";
export type PublicRoutePasscodeError = "invalid" | "limited" | undefined;

export interface PublicRoutePasscodeGate {
  shareId: string;
  error: PublicRoutePasscodeError;
}

export type PublicRouteOutcome<TProjection extends PublicRouteProjection> =
  | {
      kind: "resolved";
      result: Extract<
        PublicRenderResult,
        { ok: true; projection: TProjection; shareId: string }
      >;
    }
  | {
      kind: "passcode-required";
      gate: PublicRoutePasscodeGate;
    }
  | {
      kind: "not-found";
    };

export function publicRoutePasscodeErrorFromParam(
  passcodeStatus: string | undefined,
): PublicRoutePasscodeError {
  return passcodeStatus === "invalid" || passcodeStatus === "limited"
    ? passcodeStatus
    : undefined;
}

function isResolvedPublicRouteResult<TProjection extends PublicRouteProjection>(
  result: PublicRenderResult,
  projection: TProjection,
): result is Extract<
  PublicRenderResult,
  { ok: true; projection: TProjection; shareId: string }
> {
  return result.ok && result.projection === projection;
}

export function adaptPublicRouteOutcome<
  TProjection extends PublicRouteProjection,
>(
  result: PublicRenderResult,
  projection: TProjection,
  requestedShareId: string,
  passcodeStatus: string | undefined,
): PublicRouteOutcome<TProjection> {
  if (isResolvedPublicRouteResult(result, projection)) {
    return { kind: "resolved", result };
  }

  if (
    !result.decision.allow &&
    result.decision.reason === "passcode-required"
  ) {
    return {
      kind: "passcode-required",
      gate: {
        shareId: result.shareId || requestedShareId,
        error: publicRoutePasscodeErrorFromParam(passcodeStatus),
      },
    };
  }

  return { kind: "not-found" };
}
