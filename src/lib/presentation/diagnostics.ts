/**
 * Diagnostic types and codes for the presentation system.
 *
 * Diagnostics are produced at every validation/compile/render/export boundary
 * and are stable enough for test assertions and UI grouping.
 */

import type {
  AssetId,
  NodeId,
  SlideId,
  ThemePackageId,
  JsonValue,
} from "./types";

export type PresentationDiagnosticCode =
  | "invalid-schema-version"
  | "unknown-field"
  | "duplicate-id"
  | "unknown-template-kind"
  | "unknown-template-layout"
  | "unknown-theme-package"
  | "unknown-style-ref"
  | "missing-style-default"
  | "missing-style-variant"
  | "missing-decoration"
  | "missing-token"
  | "invalid-node-layout"
  | "missing-node-layout"
  | "missing-asset"
  | "invalid-asset-reference"
  | "invalid-text-runs"
  | "invalid-table-shape"
  | "slot-over-capacity"
  | "missing-required-slot"
  | "unsupported-template-control"
  | "theme-decoration-export-fallback"
  | "unsupported-export-feature"
  | "local-style-overrides"
  | "stale-source"
  | "orphaned-source"
  | "missing-source-block"
  | "unlinked-source"
  | "source-refresh-failed";

export type DiagnosticSeverity = "info" | "warning" | "error" | "fatal";

/** Stable subsystem vocabulary used for filtering and summary counts. */
export type DiagnosticCategory =
  "validation" | "source" | "asset" | "theme" | "render" | "export";

/** Stable target scopes used by inspector and deck-level review grouping. */
export type DiagnosticTargetScope =
  "deck" | "slide" | "node" | "asset" | "source" | "style" | "theme" | "export";

export const DIAGNOSTIC_CATEGORIES: readonly DiagnosticCategory[] = [
  "validation",
  "source",
  "asset",
  "theme",
  "render",
  "export",
] as const;

export const DIAGNOSTIC_TARGET_SCOPES: readonly DiagnosticTargetScope[] = [
  "deck",
  "slide",
  "node",
  "asset",
  "source",
  "style",
  "theme",
  "export",
] as const;

export const DIAGNOSTIC_SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
  fatal: 0,
  error: 1,
  warning: 2,
  info: 3,
};

export type DiagnosticTargetBase = {
  path?: string;
  label?: string;
};

export type DiagnosticTarget =
  | ({ scope: "deck" } & DiagnosticTargetBase)
  | ({ scope: "slide"; slideId: SlideId } & DiagnosticTargetBase)
  | ({
      scope: "node";
      nodeId: NodeId;
      slideId?: SlideId;
    } & DiagnosticTargetBase)
  | ({
      scope: "asset";
      assetId?: AssetId;
      slideId?: SlideId;
      nodeId?: NodeId;
    } & DiagnosticTargetBase)
  | ({
      scope: "source";
      documentId?: string;
      blockId?: string;
      slideId?: SlideId;
      nodeId?: NodeId;
    } & DiagnosticTargetBase)
  | ({
      scope: "style";
      styleRef?: string;
      slideId?: SlideId;
      nodeId?: NodeId;
    } & DiagnosticTargetBase)
  | ({
      scope: "theme";
      themePackageId?: ThemePackageId;
      slideId?: SlideId;
    } & DiagnosticTargetBase)
  | ({
      scope: "export";
      exportFeature?: string;
      slideId?: SlideId;
      nodeId?: NodeId;
    } & DiagnosticTargetBase);

export type DiagnosticActionType =
  | "reset-to-theme"
  | "choose-denser-layout"
  | "split-slide"
  | "open-asset-panel"
  | "remove-override"
  | "restore-decoration"
  | "replace-style-ref"
  | "refresh-source"
  | "unlink-source"
  | "relink-source"
  | "open-source-review";

export type DiagnosticAction =
  | {
      type: "reset-to-theme";
      target?: DiagnosticTarget;
      payload?: { styleKeys?: string[] };
    }
  | {
      type: "choose-denser-layout";
      target?: DiagnosticTarget;
      payload?: { density?: "dense" };
    }
  | { type: "split-slide"; target?: DiagnosticTarget }
  | {
      type: "open-asset-panel";
      target?: DiagnosticTarget;
      payload?: { assetId?: AssetId };
    }
  | {
      type: "remove-override";
      target?: DiagnosticTarget;
      payload?: { styleKeys?: string[] };
    }
  | {
      type: "restore-decoration";
      target?: DiagnosticTarget;
      payload?: { decorationId?: string };
    }
  | {
      type: "replace-style-ref";
      target?: DiagnosticTarget;
      payload?: { styleRef?: string };
    }
  | {
      type: "refresh-source";
      target?: DiagnosticTarget;
      payload?: { documentId?: string; blockId?: string };
    }
  | {
      type: "unlink-source";
      target?: DiagnosticTarget;
      payload?: { documentId?: string; blockId?: string };
    }
  | {
      type: "relink-source";
      target?: DiagnosticTarget;
      payload?: { documentId?: string; blockId?: string };
    }
  | {
      type: "open-source-review";
      target?: DiagnosticTarget;
      payload?: { documentId?: string; blockId?: string };
    };

export type PresentationDiagnostic = {
  code: PresentationDiagnosticCode;
  category: DiagnosticCategory;
  severity: DiagnosticSeverity;
  target: DiagnosticTarget;
  path?: string;
  message: string;
  nodeId?: NodeId;
  slideId?: SlideId;
  action?: DiagnosticAction;
  details?: Record<string, JsonValue>;
};

type DiagnosticBuildOptions = {
  path?: string;
  nodeId?: NodeId;
  slideId?: SlideId;
  target?: DiagnosticTarget;
  category?: DiagnosticCategory;
  action?: DiagnosticAction;
  details?: Record<string, JsonValue>;
};

export type DiagnosticGroup = {
  key: string;
  scope: DiagnosticTargetScope;
  label: string;
  target: DiagnosticTarget;
  severity: DiagnosticSeverity;
  diagnostics: PresentationDiagnostic[];
};

function detailString(
  details: Record<string, JsonValue> | undefined,
  key: string,
): string | undefined {
  const value = details?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function categoryForDiagnosticCode(
  code: PresentationDiagnosticCode,
): DiagnosticCategory {
  if (
    code === "stale-source" ||
    code === "orphaned-source" ||
    code === "missing-source-block" ||
    code === "unlinked-source" ||
    code === "source-refresh-failed"
  ) {
    return "source";
  }
  if (code === "missing-asset" || code === "invalid-asset-reference") {
    return "asset";
  }
  if (
    code === "unknown-theme-package" ||
    code === "unknown-style-ref" ||
    code === "missing-style-default" ||
    code === "missing-style-variant" ||
    code === "missing-decoration" ||
    code === "missing-token" ||
    code === "local-style-overrides"
  ) {
    return "theme";
  }
  if (
    code === "theme-decoration-export-fallback" ||
    code === "unsupported-export-feature"
  ) {
    return "export";
  }
  if (
    code === "invalid-node-layout" ||
    code === "missing-node-layout" ||
    code === "invalid-text-runs" ||
    code === "invalid-table-shape"
  ) {
    return "render";
  }
  return "validation";
}

function inferDiagnosticTarget(
  code: PresentationDiagnosticCode,
  category: DiagnosticCategory,
  opts: DiagnosticBuildOptions,
): DiagnosticTarget {
  const path = opts.path;
  const details = opts.details;
  const nodeId = opts.nodeId;
  const slideId = opts.slideId;

  if (category === "source") {
    return {
      scope: "source",
      ...(detailString(details, "documentId")
        ? { documentId: detailString(details, "documentId") }
        : {}),
      ...(detailString(details, "blockId")
        ? { blockId: detailString(details, "blockId") }
        : {}),
      ...(slideId !== undefined ? { slideId } : {}),
      ...(nodeId !== undefined ? { nodeId } : {}),
      ...(path !== undefined ? { path } : {}),
    };
  }

  if (category === "asset") {
    return {
      scope: "asset",
      ...(detailString(details, "assetId")
        ? { assetId: detailString(details, "assetId") }
        : {}),
      ...(slideId !== undefined ? { slideId } : {}),
      ...(nodeId !== undefined ? { nodeId } : {}),
      ...(path !== undefined ? { path } : {}),
    };
  }

  if (code === "unknown-theme-package") {
    return {
      scope: "theme",
      ...(detailString(details, "themePackageId")
        ? { themePackageId: detailString(details, "themePackageId") }
        : {}),
      ...(slideId !== undefined ? { slideId } : {}),
      ...(path !== undefined ? { path } : {}),
    };
  }

  if (code === "missing-decoration") {
    return {
      scope: "theme",
      ...(detailString(details, "themePackageId")
        ? { themePackageId: detailString(details, "themePackageId") }
        : {}),
      ...(slideId !== undefined ? { slideId } : {}),
      ...(path !== undefined ? { path } : {}),
    };
  }

  if (
    code === "unknown-style-ref" ||
    code === "missing-style-default" ||
    code === "missing-style-variant" ||
    code === "missing-token" ||
    code === "local-style-overrides"
  ) {
    return {
      scope: "style",
      ...(detailString(details, "styleRef")
        ? { styleRef: detailString(details, "styleRef") }
        : {}),
      ...(slideId !== undefined ? { slideId } : {}),
      ...(nodeId !== undefined ? { nodeId } : {}),
      ...(path !== undefined ? { path } : {}),
    };
  }

  if (category === "export") {
    return {
      scope: "export",
      ...(detailString(details, "exportFeature")
        ? { exportFeature: detailString(details, "exportFeature") }
        : {}),
      ...(slideId !== undefined ? { slideId } : {}),
      ...(nodeId !== undefined ? { nodeId } : {}),
      ...(path !== undefined ? { path } : {}),
    };
  }

  if (nodeId !== undefined) {
    return {
      scope: "node",
      nodeId,
      ...(slideId !== undefined ? { slideId } : {}),
      ...(path !== undefined ? { path } : {}),
    };
  }

  if (slideId !== undefined) {
    return {
      scope: "slide",
      slideId,
      ...(path !== undefined ? { path } : {}),
    };
  }

  return { scope: "deck", ...(path !== undefined ? { path } : {}) };
}

function actionWithTarget(
  action: DiagnosticAction | undefined,
  target: DiagnosticTarget,
): DiagnosticAction | undefined {
  if (!action) return undefined;
  if (action.target) return action;
  return { ...action, target } as DiagnosticAction;
}

/** Convenience builder for diagnostics. */
export function makeDiagnostic(
  code: PresentationDiagnosticCode,
  severity: DiagnosticSeverity,
  message: string,
  opts?: DiagnosticBuildOptions,
): PresentationDiagnostic {
  const category = opts?.category ?? categoryForDiagnosticCode(code);
  const target =
    opts?.target ?? inferDiagnosticTarget(code, category, opts ?? {});
  const action = actionWithTarget(opts?.action, target);
  return {
    code,
    category,
    severity,
    target,
    message,
    ...(opts?.path !== undefined ? { path: opts.path } : {}),
    ...(opts?.nodeId !== undefined ? { nodeId: opts.nodeId } : {}),
    ...(opts?.slideId !== undefined ? { slideId: opts.slideId } : {}),
    ...(action !== undefined ? { action } : {}),
    ...(opts?.details !== undefined ? { details: opts.details } : {}),
  };
}

export function retargetDiagnostic(
  diagnostic: PresentationDiagnostic,
  opts: Omit<DiagnosticBuildOptions, "action" | "details">,
): PresentationDiagnostic {
  const details = diagnostic.details;
  const path = opts.path ?? diagnostic.path;
  const nodeId = opts.nodeId ?? diagnostic.nodeId;
  const slideId = opts.slideId ?? diagnostic.slideId;
  const category = opts.category ?? diagnostic.category;
  const target =
    opts.target ??
    inferDiagnosticTarget(diagnostic.code, category, {
      path,
      nodeId,
      slideId,
      details,
    });
  return {
    ...diagnostic,
    category,
    target,
    ...(path !== undefined ? { path } : {}),
    ...(nodeId !== undefined ? { nodeId } : {}),
    ...(slideId !== undefined ? { slideId } : {}),
    ...(diagnostic.action
      ? { action: actionWithTarget(diagnostic.action, target) }
      : {}),
  };
}

export function getDiagnosticTarget(
  diagnostic: PresentationDiagnostic,
): DiagnosticTarget {
  return diagnostic.target;
}

export function getDiagnosticNodeId(
  diagnostic: PresentationDiagnostic,
): NodeId | undefined {
  const target = getDiagnosticTarget(diagnostic);
  if ("nodeId" in target && target.nodeId) return target.nodeId;
  return diagnostic.nodeId;
}

export function getDiagnosticSlideId(
  diagnostic: PresentationDiagnostic,
): SlideId | undefined {
  const target = getDiagnosticTarget(diagnostic);
  if ("slideId" in target && target.slideId) return target.slideId;
  return diagnostic.slideId;
}

export function diagnosticTargetKey(target: DiagnosticTarget): string {
  switch (target.scope) {
    case "deck":
      return "deck";
    case "slide":
      return `slide:${target.slideId}`;
    case "node":
      return `node:${target.slideId ?? ""}:${target.nodeId}`;
    case "asset":
      return `asset:${target.assetId ?? target.nodeId ?? target.path ?? "deck"}`;
    case "source":
      return `source:${target.documentId ?? ""}:${target.blockId ?? target.nodeId ?? target.slideId ?? target.path ?? "deck"}`;
    case "style":
      return `style:${target.styleRef ?? target.nodeId ?? target.path ?? "deck"}`;
    case "theme":
      return `theme:${target.themePackageId ?? target.slideId ?? target.path ?? "deck"}`;
    case "export":
      return `export:${target.exportFeature ?? target.nodeId ?? target.slideId ?? target.path ?? "deck"}`;
  }
}

export function diagnosticTargetLabel(target: DiagnosticTarget): string {
  if (target.label) return target.label;
  switch (target.scope) {
    case "deck":
      return "Deck";
    case "slide":
      return `Slide ${target.slideId}`;
    case "node":
      return `Node ${target.nodeId}`;
    case "asset":
      return target.assetId ? `Asset ${target.assetId}` : "Asset";
    case "source":
      return target.blockId ? `Source block ${target.blockId}` : "Source";
    case "style":
      return target.styleRef ? `Style ${target.styleRef}` : "Style";
    case "theme":
      return target.themePackageId
        ? `Theme ${target.themePackageId}`
        : "Theme package";
    case "export":
      return target.exportFeature ? `Export ${target.exportFeature}` : "Export";
  }
}

function compareDiagnostics(
  a: PresentationDiagnostic,
  b: PresentationDiagnostic,
): number {
  const severityDelta =
    DIAGNOSTIC_SEVERITY_RANK[a.severity] - DIAGNOSTIC_SEVERITY_RANK[b.severity];
  if (severityDelta !== 0) return severityDelta;
  const aSlide = getDiagnosticSlideId(a) ?? "";
  const bSlide = getDiagnosticSlideId(b) ?? "";
  if (aSlide !== bSlide) return aSlide.localeCompare(bSlide);
  const aNode = getDiagnosticNodeId(a) ?? "";
  const bNode = getDiagnosticNodeId(b) ?? "";
  if (aNode !== bNode) return aNode.localeCompare(bNode);
  return a.code.localeCompare(b.code);
}

export function groupDiagnostics(
  diagnostics: readonly PresentationDiagnostic[],
): DiagnosticGroup[] {
  const groups = new Map<string, DiagnosticGroup>();
  for (const diagnostic of diagnostics) {
    const target = getDiagnosticTarget(diagnostic);
    const key = diagnosticTargetKey(target);
    const existing = groups.get(key);
    if (existing) {
      existing.diagnostics.push(diagnostic);
      if (
        DIAGNOSTIC_SEVERITY_RANK[diagnostic.severity] <
        DIAGNOSTIC_SEVERITY_RANK[existing.severity]
      ) {
        existing.severity = diagnostic.severity;
      }
      continue;
    }
    groups.set(key, {
      key,
      scope: target.scope,
      label: diagnosticTargetLabel(target),
      target,
      severity: diagnostic.severity,
      diagnostics: [diagnostic],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      diagnostics: [...group.diagnostics].sort(compareDiagnostics),
    }))
    .sort((a, b) => {
      const severityDelta =
        DIAGNOSTIC_SEVERITY_RANK[a.severity] -
        DIAGNOSTIC_SEVERITY_RANK[b.severity];
      if (severityDelta !== 0) return severityDelta;
      const scopeDelta =
        DIAGNOSTIC_TARGET_SCOPES.indexOf(a.scope) -
        DIAGNOSTIC_TARGET_SCOPES.indexOf(b.scope);
      if (scopeDelta !== 0) return scopeDelta;
      return a.label.localeCompare(b.label);
    });
}

/** Collects diagnostics during a validation pass. */
export class DiagnosticCollector {
  readonly diagnostics: PresentationDiagnostic[] = [];

  add(d: PresentationDiagnostic): void {
    this.diagnostics.push(d);
  }

  error(
    code: PresentationDiagnosticCode,
    message: string,
    opts?: Parameters<typeof makeDiagnostic>[3],
  ): void {
    this.add(makeDiagnostic(code, "error", message, opts));
  }

  warning(
    code: PresentationDiagnosticCode,
    message: string,
    opts?: Parameters<typeof makeDiagnostic>[3],
  ): void {
    this.add(makeDiagnostic(code, "warning", message, opts));
  }

  info(
    code: PresentationDiagnosticCode,
    message: string,
    opts?: Parameters<typeof makeDiagnostic>[3],
  ): void {
    this.add(makeDiagnostic(code, "info", message, opts));
  }

  fatal(
    code: PresentationDiagnosticCode,
    message: string,
    opts?: Parameters<typeof makeDiagnostic>[3],
  ): void {
    this.add(makeDiagnostic(code, "fatal", message, opts));
  }

  hasFatal(): boolean {
    return this.diagnostics.some((d) => d.severity === "fatal");
  }

  hasErrors(): boolean {
    return this.diagnostics.some(
      (d) => d.severity === "error" || d.severity === "fatal",
    );
  }
}
