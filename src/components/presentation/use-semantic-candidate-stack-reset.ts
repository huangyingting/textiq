"use client";

import { useEffect } from "react";

export function useSemanticCandidateStackReset({
  candidateStackRef,
  activeSlideChildren,
  activeSlideId,
  contextMenu,
  sourceDocumentId,
  selection,
}: {
  candidateStackRef: { current: readonly string[] };
  activeSlideChildren: unknown;
  activeSlideId: unknown;
  contextMenu: unknown;
  sourceDocumentId: unknown;
  selection: unknown;
}): void {
  useEffect(() => {
    candidateStackRef.current = [];
  }, [
    activeSlideChildren,
    activeSlideId,
    candidateStackRef,
    contextMenu,
    sourceDocumentId,
    selection,
  ]);
}
