"use client";

import { useRef } from "react";

import { useFocusTrap } from "@/lib/a11y/use-focus-trap";
import type { BrandKitSavePort } from "@/lib/action-ports";

import { BrandKitAuthoringPanel } from "./brand-kit-authoring-panel";

export function BrandKitAuthoringDialog({
  ownerId,
  saveBrandKitDraft,
  onSaved,
  onClose,
}: {
  ownerId: string;
  saveBrandKitDraft: BrandKitSavePort["saveBrandKitDraft"];
  onSaved: NonNullable<Parameters<typeof BrandKitAuthoringPanel>[0]["onSaved"]>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useFocusTrap(dialogRef);

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-2 sm:p-6">
      <button
        type="button"
        aria-label="Close theme customization"
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="brand-kit-authoring-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="relative flex max-h-[calc(100vh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-ds-lg border border-ds-border-subtle bg-ds-surface shadow-ds-overlay sm:max-h-[calc(100vh-3rem)]"
      >
        <BrandKitAuthoringPanel
          ownerId={ownerId}
          saveBrandKitDraft={saveBrandKitDraft}
          onSaved={onSaved}
          onClose={onClose}
        />
      </section>
    </div>
  );
}
