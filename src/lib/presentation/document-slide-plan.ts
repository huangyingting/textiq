export type {
  DocumentSourceVisualInventoryItem,
  DocumentSourceBlockV1,
  DocumentSourceSectionV1,
  DocumentSourcePlanV1,
  DocumentSourcePlanBuildResult,
} from "./document-source-plan";
export { buildDocumentSourcePlanV1 } from "./document-source-plan";

export type {
  DocumentSlidePlanner,
  DocumentSlideMode,
  DocumentPlannedSlideV1,
  DocumentSlidePlanV1,
} from "./document-slide-planner";
export {
  deriveDocumentSlidePlanDeterministic,
  documentSlidePlanToSemanticDeckPlan,
  semanticDeckPlanToDocumentSlidePlan,
} from "./document-slide-planner";

export type { DocumentSlidePlanRepairResult } from "./document-slide-plan-repair";
export { repairDocumentSlidePlan } from "./document-slide-plan-repair";

export type { CompileDocumentSlidePlanResult } from "./document-slide-plan-compiler";
export { compileDocumentSlidePlanToDeck } from "./document-slide-plan-compiler";
