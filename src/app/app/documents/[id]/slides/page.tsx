import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { loadDocumentEditorViewModel } from "@/lib/document-editor/loader";
import { requireUser } from "@/lib/session";

import { requireDocumentActionContext } from "../document-context";
import { saveBrandKitDraft } from "../brand-kit-actions";
import { SlideEditorRouteClient } from "./slide-editor-route-client";

export const metadata: Metadata = {
  title: "Slides — TextIQ",
};

export default async function DocumentSlidesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser(redirect);
  const { id } = await params;
  const viewModel = await loadDocumentEditorViewModel({
    documentId: id,
    userId: user.id,
    userName: user.name ?? user.email ?? "Anonymous",
    requireDocumentContext: requireDocumentActionContext,
  });

  if (!viewModel || !viewModel.canEdit) {
    notFound();
  }

  return (
    <SlideEditorRouteClient
      documentId={viewModel.documentId}
      documentTitle={viewModel.initialTitle}
      initialDeckJson={viewModel.initialDeckJson}
      initialDeckRevisionToken={viewModel.initialDeckRevisionToken}
      initialContentJson={viewModel.initialStateJson}
      initialIsShared={viewModel.initialIsShared}
      initialShareId={viewModel.initialShareId}
      initialSlug={viewModel.initialSlug}
      initialSharePresentEnabled={viewModel.initialSharePresentEnabled}
      canManage={viewModel.canManage}
      userId={viewModel.userId}
      userName={viewModel.userName}
      activeCustomThemePackage={viewModel.activeCustomThemePackage}
      customThemeCatalogEntries={viewModel.customThemeCatalogEntries}
      saveBrandKitDraftAction={saveBrandKitDraft}
    />
  );
}
