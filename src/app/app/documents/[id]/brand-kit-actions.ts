"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/session";
import { compileBrandKitDraft } from "@/lib/presentation/brand-kit/compiler";
import { persistCompiledBrandKitDraft } from "@/lib/presentation/brand-kit/persistence";
import type { BrandKitDraftV1 } from "@/lib/presentation/brand-kit/schema";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";

export async function saveBrandKitDraft(
  draft: BrandKitDraftV1,
  compiledPackage: ThemePackageV1,
) {
  const compiled = compileBrandKitDraft(draft);
  if (!compiled.ok) return compiled;
  if (
    compiled.package.id !== compiledPackage.id ||
    compiled.package.version !== compiledPackage.version
  ) {
    return {
      ok: false as const,
      diagnostics: [
        {
          severity: "error" as const,
          code: "stale-compiled-package",
          message:
            "Compiled preview is stale. Revalidate the draft before saving.",
          path: "draft",
        },
      ],
    };
  }

  const user = await requireUser(redirect);
  return persistCompiledBrandKitDraft({ draftInput: draft, userId: user.id });
}
