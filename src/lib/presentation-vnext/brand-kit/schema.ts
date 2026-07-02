import type { ThemePackageV1 } from "../theme-package-schema";

export type BrandKitScope =
  | { kind: "user"; ownerId: string; workspaceId?: never }
  | { kind: "workspace"; ownerId: string; workspaceId: string };

export type BrandKitRevision = {
  id: string;
  number: number;
  createdAt: string;
  updatedAt?: string;
};

export type BrandKitStatePalette = {
  fill: string;
  text: string;
};

export type BrandKitDraftV1 = {
  schemaVersion: 1;
  id: string;
  name: string;
  slug: string;
  scope: BrandKitScope;
  sourcePresetId?: string;
  version: string;
  revision: BrandKitRevision;
  palette: {
    backgrounds: {
      canvas: string;
      muted: string;
      inverse: string;
    };
    surfaces: {
      default: string;
      elevated: string;
      subtle: string;
    };
    text: {
      primary: string;
      secondary: string;
      inverse: string;
      accent: string;
    };
    accents: {
      primary: string;
      secondary: string;
    };
    borders: {
      default: string;
      strong: string;
    };
    charts: string[];
    states: {
      success: BrandKitStatePalette;
      warning: BrandKitStatePalette;
      danger: BrandKitStatePalette;
      info?: BrandKitStatePalette;
    };
  };
  typography: {
    display: BrandKitTypographyRole;
    heading: BrandKitTypographyRole;
    body: BrandKitTypographyRole;
    caption: BrandKitTypographyRole;
    mono: BrandKitTypographyRole;
    data: BrandKitTypographyRole;
  };
  assets?: {
    logo?: BrandKitImageAsset;
  };
  decorations?: {
    background?: "none" | "subtle" | "expressive";
    chrome?: "default" | "minimal";
  };
};

export type BrandKitTypographyRole = {
  family: string;
  sizePt: number;
  weight: number;
  lineHeight: number;
  letterSpacingEm?: number;
};

export type BrandKitImageAsset = {
  id: string;
  src: string;
  alt?: string;
  widthPx?: number;
  heightPx?: number;
  mimeType?:
    | "image/png"
    | "image/jpeg"
    | "image/gif"
    | "image/webp"
    | "image/svg+xml";
  contentHash?: string;
};

export type BrandKitDiagnosticSeverity = "warning" | "error";

export type BrandKitDiagnostic = {
  severity: BrandKitDiagnosticSeverity;
  code: string;
  message: string;
  path: string;
};

export type BrandKitCompileResult =
  | {
      ok: true;
      draft: BrandKitDraftV1;
      package: ThemePackageV1;
      diagnostics: BrandKitDiagnostic[];
    }
  | {
      ok: false;
      diagnostics: BrandKitDiagnostic[];
    };
