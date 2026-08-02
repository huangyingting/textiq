"use client";

import type { RefObject } from "react";

import { Dialog } from "@/components/ui";
import type { BrandKitSavePort } from "@/lib/action-ports";

import { BrandKitAuthoringPanel } from "./brand-kit-authoring-panel";

export function BrandKitAuthoringDialog({
  ownerId,
  saveBrandKitDraft,
  onSaved,
  onClose,
  restoreFocusRef,
}: {
  ownerId: string;
  saveBrandKitDraft: BrandKitSavePort["saveBrandKitDraft"];
  onSaved: NonNullable<Parameters<typeof BrandKitAuthoringPanel>[0]["onSaved"]>;
  onClose: () => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      aria-labelledby="brand-kit-authoring-title"
      restoreFocusRef={restoreFocusRef}
      containerClassName="items-center p-2 sm:p-6"
      className="flex max-h-[calc(100vh-1rem)] max-w-6xl flex-col overflow-hidden p-0 sm:max-h-[calc(100vh-3rem)]"
    >
      <BrandKitAuthoringPanel
        ownerId={ownerId}
        saveBrandKitDraft={saveBrandKitDraft}
        onSaved={onSaved}
        onClose={onClose}
      />
    </Dialog>
  );
}
