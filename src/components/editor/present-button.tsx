"use client";

/**
 * Present button rendered in the document editor toolbar.
 *
 * Fetches the freshest saved Deck and renders it through PresentMode.
 * Missing deck JSON starts a native blank Deck; invalid non-empty deck JSON
 * renders recovery diagnostics instead of silently presenting a blank deck.
 *
 * The present mode is read-only; it never mutates Lexical/Yjs state.
 */

import { MonitorPlay } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { PresentMode } from "@/components/presentation/present-mode";
import { EditorToolbarButton } from "@/components/editor/toolbar-button";
import { Dialog } from "@/components/ui/dialog";
import type { DeckFetchPort } from "@/lib/action-ports";
import { logInfo } from "@/lib/log";
import type { PresentationDiagnostic } from "@/lib/presentation/diagnostics";
import { createBlankDeck } from "@/lib/presentation/empty-deck";
import { prepareDeckForOpen } from "@/lib/presentation/deck-open-preparation";
import type { Deck } from "@/lib/presentation/schema";
import type { ThemePackageV1 } from "@/lib/presentation/theme-package-schema";
import { resolveThemePackageForDeck } from "@/lib/presentation/theme-package-registry";
import type { Visual } from "@/lib/visual/schema";

interface PresentButtonProps {
  documentId: string;
  deckPort: DeckFetchPort;
  documentTitle?: string;
  getVisuals?: () => Record<string, Visual>;
  iconOnly?: boolean;
}

type PresentData =
  | {
      ownerDocumentId: string;
      mode: "deck";
      deck: Deck;
      themePackage: ThemePackageV1;
      visuals: Record<string, Visual>;
    }
  | PresentRecoveryData;

type PresentRecoveryData = {
  ownerDocumentId: string;
  mode: "recovery";
  error: string;
  diagnostics: PresentationDiagnostic[];
  validationErrors?: string[];
};

function PresentOpenRecovery({
  recovery,
  onClose,
}: {
  recovery: PresentRecoveryData;
  onClose: () => void;
}) {
  const details = [
    ...recovery.diagnostics.map((diagnostic) => diagnostic.message),
    ...(recovery.validationErrors ?? []),
  ];
  return (
    <Dialog
      open={true}
      onClose={onClose}
      aria-labelledby="present-recovery-title"
      className="max-w-xl rounded-ds-lg border border-ds-border-subtle bg-ds-surface-overlay p-5 shadow-ds-overlay"
    >
      <h2
        id="present-recovery-title"
        className="text-lg font-semibold text-ds-text-primary"
      >
        Presentation deck could not be opened
      </h2>
      <p className="mt-2 text-sm text-ds-text-secondary">{recovery.error}</p>
      {details.length > 0 ? (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ds-text-secondary">
          {details.slice(0, 6).map((detail, index) => (
            <li key={`${detail}-${index}`}>{detail}</li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        className="mt-5 rounded-ds-sm bg-ds-accent px-3 py-2 text-sm font-medium text-ds-text-on-accent"
      >
        Close
      </button>
    </Dialog>
  );
}

/**
 * A toolbar button that opens the in-app Present mode for the current document.
 *
 * Placed in the editor header alongside Export and Share. On click it prefers
 * the saved Deck before rendering {@link PresentMode}.
 */
export function PresentButton({
  documentId,
  deckPort,
  documentTitle,
  getVisuals,
  iconOnly = false,
}: PresentButtonProps) {
  const [presentData, setPresentData] = useState<PresentData | null>(null);
  const [loadingDocumentId, setLoadingDocumentId] = useState<string | null>(
    null,
  );
  const mountedRef = useRef(true);
  const presentOperationIdRef = useRef(0);
  const presentInFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      presentOperationIdRef.current += 1;
      presentInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      presentOperationIdRef.current += 1;
      presentInFlightRef.current = false;
    };
  }, [documentId]);

  const isLoading = loadingDocumentId === documentId;
  const visiblePresentData =
    presentData?.ownerDocumentId === documentId ? presentData : null;

  const handlePresent = useCallback(async () => {
    if (presentInFlightRef.current) return;
    presentInFlightRef.current = true;
    const operationId = ++presentOperationIdRef.current;
    const ownsOperation = () =>
      mountedRef.current && presentOperationIdRef.current === operationId;
    setLoadingDocumentId(documentId);
    try {
      const prepared = await prepareDeckForOpen({
        documentId,
        deckPort,
        fallbackDeck: () =>
          createBlankDeck({ documentId, title: documentTitle }),
        onFetchFailure: ({ reason, error }) => {
          if (!ownsOperation()) return;
          logInfo("editor.present", "presentation-open-fetch-failed", {
            documentId,
            reason,
            error,
          });
        },
      });
      if (!ownsOperation()) return;

      if (!prepared.ok) {
        setPresentData({
          ownerDocumentId: documentId,
          mode: "recovery",
          error: prepared.error,
          diagnostics: prepared.diagnostics,
          validationErrors: prepared.validationErrors,
        });
        return;
      }

      const themeResolution = resolveThemePackageForDeck(prepared.deck);
      setPresentData({
        ownerDocumentId: documentId,
        mode: "deck",
        deck: prepared.deck,
        themePackage: themeResolution.package,
        visuals: getVisuals?.() ?? {},
      });
    } finally {
      if (ownsOperation()) {
        presentInFlightRef.current = false;
        setLoadingDocumentId(null);
      }
    }
  }, [deckPort, documentId, documentTitle, getVisuals]);

  const handleClose = useCallback(() => {
    setPresentData(null);
  }, []);

  return (
    <>
      <EditorToolbarButton
        label="Present"
        tooltip="Present fullscreen"
        icon={<MonitorPlay size={15} aria-hidden="true" />}
        iconOnly={iconOnly}
        onClick={handlePresent}
        disabled={isLoading}
        aria-label={`Present ${documentTitle ?? "document"}`}
      />

      {visiblePresentData?.mode === "deck" ? (
        <PresentMode
          deck={visiblePresentData.deck}
          themePackage={visiblePresentData.themePackage}
          visuals={visiblePresentData.visuals}
          onClose={handleClose}
        />
      ) : null}

      {visiblePresentData?.mode === "recovery" ? (
        <PresentOpenRecovery
          recovery={visiblePresentData}
          onClose={handleClose}
        />
      ) : null}
    </>
  );
}
