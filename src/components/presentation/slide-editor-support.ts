"use client";

import { useEffect, useState } from "react";

import {
  diagnosticTargetKey,
  type PresentationDiagnostic,
} from "@/lib/presentation/diagnostics";

const DESKTOP_INSPECTOR_MEDIA_QUERY = "(min-width: 1024px)";

export function isDesktopInspectorViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(DESKTOP_INSPECTOR_MEDIA_QUERY).matches
  );
}

export function isMobileInspectorViewport(): boolean {
  return !isDesktopInspectorViewport();
}

export function scheduleEffectStateUpdate(callback: () => void): () => void {
  let canceled = false;
  const timeoutId = globalThis.setTimeout(() => {
    if (!canceled) callback();
  }, 0);
  return () => {
    canceled = true;
    globalThis.clearTimeout(timeoutId);
  };
}

export function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === "string" ? reader.result : "";
      if (src) {
        resolve(src);
      } else {
        reject(new Error("empty image data"));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("image read failed"));
    };
    reader.readAsDataURL(file);
  });
}

export function useDesktopInspectorViewport(): boolean {
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(DESKTOP_INSPECTOR_MEDIA_QUERY);
    const syncViewport = () => {
      setIsDesktopViewport(mediaQuery.matches);
    };
    syncViewport();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewport);
      return () => mediaQuery.removeEventListener("change", syncViewport);
    }
    mediaQuery.addListener(syncViewport);
    return () => mediaQuery.removeListener(syncViewport);
  }, []);

  return isDesktopViewport;
}

export function dedupeDiagnostics(
  diagnostics: readonly PresentationDiagnostic[],
): PresentationDiagnostic[] {
  const seen = new Set<string>();
  const result: PresentationDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}:${diagnosticTargetKey(diagnostic.target)}:${diagnostic.path ?? ""}:${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(diagnostic);
  }
  return result;
}
