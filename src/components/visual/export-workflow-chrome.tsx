"use client";

import { motion } from "framer-motion";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { usePopMotion } from "@/components/motion/reveal";
import { IconButton, PanelSurface } from "@/components/ui";
import type { BackgroundMode } from "@/lib/visual/export-options";

export function VisualExportDialogShell({
  title,
  onClose,
  busy = false,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const popMotion = usePopMotion();
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-overlay bg-ds-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={busy}
        {...popMotion}
        className="tiq-full-viewport fixed inset-0 z-modal flex items-center justify-center p-4"
      >
        <PanelSurface
          elevation="popover"
          radius="xl"
          className="relative flex max-h-[calc(var(--tiq-viewport-height)-var(--ds-space-6))] w-full max-w-2xl flex-col overflow-hidden"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-ds-border-subtle px-5 py-4">
            <h2 className="text-sm font-semibold text-ds-text-primary">
              {title}
            </h2>
            <IconButton
              aria-label="Close export dialog"
              variant="plain"
              size="sm"
              disabled={busy}
              onClick={onClose}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
          {children}
        </PanelSurface>
      </motion.div>
    </>
  );
}

export function ExportPreviewThumbnail({
  dataUrl,
  background,
  customBackground,
}: {
  dataUrl: string | undefined;
  background: BackgroundMode;
  customBackground?: string;
}) {
  const isTransparent = background === "transparent";
  const customFill =
    background === "custom" ? (customBackground ?? "#ffffff") : undefined;

  return (
    <div
      className="relative flex max-h-[220px] max-w-[320px] items-center justify-center overflow-hidden rounded-ds-md border border-ds-border-subtle"
      style={
        isTransparent
          ? {
              backgroundImage:
                "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)",
              backgroundSize: "12px 12px",
              backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0px",
            }
          : customFill
            ? { backgroundColor: customFill }
            : { backgroundColor: "#ffffff" }
      }
    >
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl}
          alt="Export preview"
          className="max-h-[220px] max-w-[320px] object-contain"
          draggable={false}
        />
      ) : (
        <div className="flex h-32 w-48 items-center justify-center">
          <span
            aria-hidden="true"
            className="h-5 w-5 animate-spin rounded-full border-2 border-ds-border-strong border-t-ds-text-muted"
          />
        </div>
      )}
    </div>
  );
}

export function ExportWorkflowMessage({
  kind,
  children,
}: {
  kind: "error" | "warning" | "status";
  children: ReactNode;
}) {
  const role = kind === "error" ? "alert" : "status";
  const classes =
    kind === "error"
      ? "text-ds-danger-text"
      : kind === "warning"
        ? "text-ds-warning-text"
        : "text-ds-text-muted";
  return (
    <p role={role} className={`mt-1 text-xs ${classes}`}>
      {children}
    </p>
  );
}
