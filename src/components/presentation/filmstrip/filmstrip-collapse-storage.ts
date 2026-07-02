const FILMSTRIP_COLLAPSED_KEY_PREFIX = "slide-filmstrip-collapsed";

type FilmstripCollapseStorage = Pick<Storage, "getItem" | "setItem">;

function getBrowserStorage(): FilmstripCollapseStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function filmstripCollapsedStorageKey(documentId: string): string {
  return `${FILMSTRIP_COLLAPSED_KEY_PREFIX}:${encodeURIComponent(documentId)}`;
}

export function readFilmstripCollapsed(
  documentId: string,
  storage: FilmstripCollapseStorage | undefined = getBrowserStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(filmstripCollapsedStorageKey(documentId)) === "true";
  } catch {
    return false;
  }
}

export function writeFilmstripCollapsed(
  documentId: string,
  collapsed: boolean,
  storage: FilmstripCollapseStorage | undefined = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      filmstripCollapsedStorageKey(documentId),
      String(collapsed),
    );
  } catch {
    return;
  }
}
