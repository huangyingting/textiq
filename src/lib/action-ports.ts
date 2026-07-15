import type { ActionResult } from "@/lib/action-result";
import type { BrandStyle } from "@/lib/brand/schema";
import type {
  CommentThread,
  CreateCommentInput,
  ListCommentsOptions,
} from "@/lib/comments";
import type {
  FetchDeckResult,
  SaveDeckResult,
} from "@/lib/document/persistence-types";
import type { SearchResults } from "@/lib/document/list";
import type { Deck } from "@/lib/document/deck-model";
import type { GenerateOptions, GenerateResult } from "@/lib/visual/generate";
import type { Visual } from "@/lib/visual/schema";
import type {
  BrandKitDiagnostic,
  BrandKitDraftV1,
} from "@/lib/presentation/brand-kit/schema";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import type { ImportCreationTarget } from "@/lib/import/contract";

export interface DeckFetchPort {
  fetchDeckJson: (documentId: string) => Promise<FetchDeckResult>;
}

export interface DeckSavePort {
  saveDeckJson: (
    documentId: string,
    deckJson: unknown,
    clientToken?: string | null,
  ) => Promise<SaveDeckResult>;
}

export type DeckActionPort = DeckFetchPort & DeckSavePort;

export interface BrandListPort {
  listBrands: () => Promise<BrandStyle[]>;
}

export interface BrandApplyPort {
  applyBrand: (visual: Visual, brand: BrandStyle) => Visual;
  applyBrandToDeck?: (deck: Deck, brand: BrandStyle) => Deck;
}

export type BrandActionPort = BrandListPort & Partial<BrandApplyPort>;

export type SaveBrandKitDraftResult =
  | {
      ok: true;
      draftId: string;
      packageId: string;
      packageVersion: string;
      package: ThemePackageV1;
      diagnostics: BrandKitDiagnostic[];
    }
  | { ok: false; diagnostics: BrandKitDiagnostic[] };

export interface BrandKitSavePort {
  saveBrandKitDraft: (
    draft: BrandKitDraftV1,
    compiledPackage: ThemePackageV1,
  ) => Promise<SaveBrandKitDraftResult>;
}

export interface VisualGenerationActionPort {
  requestVisualCandidates: (
    text: string,
    options?: GenerateOptions,
  ) => Promise<GenerateResult>;
}

export interface UploadSlideAssetResult {
  assetId: string;
  url: string;
  widthPx?: number;
  heightPx?: number;
  mimeType?: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  contentHash?: string;
}

export type UploadSlideAssetPort = (
  documentId: string,
  formData: FormData,
) => Promise<ActionResult<UploadSlideAssetResult>>;

export interface SlideAssetActionPort {
  uploadSlideAsset: UploadSlideAssetPort;
}

export interface DocumentListActionPort {
  searchDocuments: (query: string) => Promise<SearchResults>;
  renameDocument: (
    documentId: string,
    rawTitle: string,
  ) => Promise<{ title: string }>;
  duplicateDocument: (documentId: string) => Promise<void>;
  toggleFavorite: (documentId: string) => Promise<{ favorite: boolean }>;
  deleteDocument: (documentId: string) => Promise<void>;
  restoreDocument: (documentId: string) => Promise<void>;
}

export interface ImportedDocumentCreationPayload {
  documentId: string;
  documentPath: string;
}

export interface ImportActionError {
  code: string;
  status: number;
  message: string;
}

export type ImportActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ImportActionError };

export interface DocumentImportCreateActionPort {
  importFile: (
    file: File,
    target: ImportCreationTarget,
  ) => Promise<ImportActionResult<ImportedDocumentCreationPayload>>;
}

export interface CommentsActionPort {
  listComments: (
    documentId: string,
    options?: ListCommentsOptions,
  ) => Promise<CommentThread[]>;
  createComment: (
    documentId: string,
    input: CreateCommentInput,
  ) => Promise<CommentThread[]>;
  editComment: (commentId: string, newBody: string) => Promise<CommentThread[]>;
  deleteComment: (commentId: string) => Promise<CommentThread[]>;
  setCommentResolved: (
    commentId: string,
    resolved: boolean,
  ) => Promise<CommentThread[]>;
}
