import type { DiagnosticAction, DiagnosticActionType } from "./diagnostics";
import type { SourceReviewItem } from "./source-links";

export type ReviewActionSeverity = "neutral" | "accent" | "warning" | "danger";

export type ReviewActionRepairEligibility =
  "navigation-only" | "direct-repair" | "host-action" | "source-review";

export type ReviewActionSafety = "safe" | "safe-destructive";

export type ReviewActionDescriptor = {
  label: string;
  shortLabel?: string;
  severity: ReviewActionSeverity;
  repairEligibility: ReviewActionRepairEligibility;
  safety: ReviewActionSafety;
  disabledReason?: string;
};

export type SourceReviewActionType =
  | "go-to-target"
  | "go-to-source"
  | "refresh-source-link"
  | "relink-source"
  | "mark-source-unlinked"
  | "dismiss-source-issue"
  | "refresh-all-safe-stale";

export type SourceReviewActionDescriptorOptions = {
  item?: Pick<SourceReviewItem, "state">;
  sourceBlockCount?: number;
  staleCount?: number;
};

type ReviewActionDescriptorTemplate = Omit<
  ReviewActionDescriptor,
  "disabledReason"
>;

const DIAGNOSTIC_ACTION_DESCRIPTORS: Record<
  DiagnosticActionType,
  ReviewActionDescriptorTemplate
> = {
  "reset-to-theme": {
    label: "Reset to theme",
    severity: "accent",
    repairEligibility: "direct-repair",
    safety: "safe-destructive",
  },
  "choose-denser-layout": {
    label: "Use denser layout",
    severity: "accent",
    repairEligibility: "direct-repair",
    safety: "safe-destructive",
  },
  "split-slide": {
    label: "Split slide",
    severity: "warning",
    repairEligibility: "direct-repair",
    safety: "safe-destructive",
  },
  "open-asset-panel": {
    label: "Open asset panel",
    severity: "accent",
    repairEligibility: "host-action",
    safety: "safe",
  },
  "remove-override": {
    label: "Remove override",
    severity: "accent",
    repairEligibility: "direct-repair",
    safety: "safe-destructive",
  },
  "restore-decoration": {
    label: "Restore decoration",
    severity: "accent",
    repairEligibility: "direct-repair",
    safety: "safe-destructive",
  },
  "replace-style-ref": {
    label: "Replace style ref",
    severity: "warning",
    repairEligibility: "direct-repair",
    safety: "safe-destructive",
  },
  "refresh-source": {
    label: "Refresh source",
    severity: "accent",
    repairEligibility: "source-review",
    safety: "safe",
  },
  "unlink-source": {
    label: "Unlink source",
    severity: "warning",
    repairEligibility: "source-review",
    safety: "safe-destructive",
  },
  "relink-source": {
    label: "Relink source",
    severity: "warning",
    repairEligibility: "source-review",
    safety: "safe-destructive",
  },
  "open-source-review": {
    label: "Open Source Review",
    severity: "accent",
    repairEligibility: "source-review",
    safety: "safe",
  },
};

const SOURCE_REVIEW_ACTION_DESCRIPTORS: Record<
  SourceReviewActionType,
  ReviewActionDescriptorTemplate
> = {
  "go-to-target": {
    label: "Go to target",
    shortLabel: "Go",
    severity: "neutral",
    repairEligibility: "navigation-only",
    safety: "safe",
  },
  "go-to-source": {
    label: "Jump to source block",
    shortLabel: "Source",
    severity: "neutral",
    repairEligibility: "navigation-only",
    safety: "safe",
  },
  "refresh-source-link": {
    label: "Refresh source link",
    shortLabel: "Refresh",
    severity: "accent",
    repairEligibility: "source-review",
    safety: "safe",
  },
  "relink-source": {
    label: "Relink source",
    severity: "warning",
    repairEligibility: "source-review",
    safety: "safe-destructive",
  },
  "mark-source-unlinked": {
    label: "Mark source as unlinked",
    shortLabel: "Mark unlinked",
    severity: "warning",
    repairEligibility: "source-review",
    safety: "safe-destructive",
  },
  "dismiss-source-issue": {
    label: "Dismiss source issue",
    shortLabel: "Dismiss",
    severity: "neutral",
    repairEligibility: "source-review",
    safety: "safe-destructive",
  },
  "refresh-all-safe-stale": {
    label: "Refresh all safe stale",
    severity: "accent",
    repairEligibility: "source-review",
    safety: "safe",
  },
};

export function diagnosticActionDescriptor(
  action: DiagnosticAction | DiagnosticActionType,
): ReviewActionDescriptor {
  const type = typeof action === "string" ? action : action.type;
  return DIAGNOSTIC_ACTION_DESCRIPTORS[type];
}

function sourceReviewDisabledReason(
  actionType: SourceReviewActionType,
  options: SourceReviewActionDescriptorOptions,
): string | undefined {
  if (
    actionType === "refresh-source-link" &&
    options.item !== undefined &&
    options.item.state !== "stale"
  ) {
    return "Only stale source links can be refreshed safely.";
  }
  if (actionType === "relink-source" && options.sourceBlockCount === 0) {
    return "No source blocks are available to relink.";
  }
  if (actionType === "refresh-all-safe-stale" && options.staleCount === 0) {
    return "No stale source links are safe to refresh.";
  }
  return undefined;
}

export function sourceReviewActionDescriptor(
  actionType: SourceReviewActionType,
  options: SourceReviewActionDescriptorOptions = {},
): ReviewActionDescriptor {
  const template = SOURCE_REVIEW_ACTION_DESCRIPTORS[actionType];
  const disabledReason = sourceReviewDisabledReason(actionType, options);
  const label =
    actionType === "refresh-all-safe-stale" && options.staleCount !== undefined
      ? `${template.label} (${options.staleCount})`
      : template.label;
  return {
    ...template,
    label,
    ...(disabledReason ? { disabledReason } : {}),
  };
}
