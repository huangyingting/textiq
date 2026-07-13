import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";

import { loadBrandStudioViewModel } from "@/lib/brand-studio/loader";
import type { BrandStudioViewModel } from "@/lib/brand-studio/view-model";
import { requireUser } from "@/lib/session";
import { BrandStudio } from "./brand-studio";
import { BrandStudioTeaser } from "./brand-studio-teaser";

export const metadata: Metadata = {
  title: "Brand Studio — TextIQ",
};

/**
 * Pure view-model -> markup composition for {@link BrandsPage} (issue
 * #1956).
 *
 * Given the already-loaded Brand Studio view model, decides whether the
 * editable `BrandStudio` (with its initial brands/font-upload entitlement)
 * or the read-only `BrandStudioTeaser` renders. Extracted from the async
 * default export so the entitlement gating is unit-testable without
 * exercising `requireUser`/`loadBrandStudioViewModel`, which require a live
 * session and database.
 */
export function renderBrandsPageView(
  viewModel: BrandStudioViewModel,
): ReactNode {
  return (
    <main className="flex flex-1 flex-col items-center bg-ds-surface-sunken px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex w-full max-w-4xl flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-ds-text-primary">
              Brand Studio
            </h1>
            <p className="text-sm text-ds-text-secondary">
              Create and manage saved brand styles — colors, fonts, and logos.
            </p>
          </div>
          <Link
            href="/app"
            className="text-sm font-medium text-ds-text-secondary underline-offset-4 transition hover:text-ds-text-primary hover:underline"
          >
            ← Back to documents
          </Link>
        </header>

        {viewModel.canUseBrandStyles ? (
          <BrandStudio
            initialBrands={viewModel.brands}
            canFontUpload={viewModel.canUploadFont}
          />
        ) : (
          <BrandStudioTeaser />
        )}
      </div>
    </main>
  );
}

export default async function BrandsPage() {
  const user = await requireUser(redirect);
  const viewModel = await loadBrandStudioViewModel(user.id);

  return renderBrandsPageView(viewModel);
}
