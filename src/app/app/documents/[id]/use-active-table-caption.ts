"use client";

import { useEffect, useState } from "react";

export const TABLE_CAPTION_INPUT_SELECTOR =
  "[data-document-table-caption-input]";

export function activeTableCaptionKey(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    return null;
  }
  const input = active.closest<HTMLElement>(TABLE_CAPTION_INPUT_SELECTOR);
  return input?.dataset.tableKey ?? null;
}

export function useActiveTableCaptionKey(): string | null {
  const [tableKey, setTableKey] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setTableKey(activeTableCaptionKey());
    const refreshAfterFocusChange = () => queueMicrotask(refresh);
    refresh();
    document.addEventListener("focusin", refreshAfterFocusChange);
    document.addEventListener("focusout", refreshAfterFocusChange);
    return () => {
      document.removeEventListener("focusin", refreshAfterFocusChange);
      document.removeEventListener("focusout", refreshAfterFocusChange);
    };
  }, []);

  return tableKey;
}
