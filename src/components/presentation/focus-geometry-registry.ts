export type FocusGeometryKey = string;

export interface FocusGeometryRegistry {
  register: <T extends HTMLElement>(
    key: FocusGeometryKey,
    element: T | null,
  ) => void;
  createRef: <T extends HTMLElement>(
    key: FocusGeometryKey,
  ) => (element: T | null) => void;
  unregister: (key: FocusGeometryKey) => void;
  getElement: <T extends HTMLElement = HTMLElement>(
    key: FocusGeometryKey,
  ) => T | null;
  focus: (key: FocusGeometryKey, options?: FocusOptions) => boolean;
  measure: (key: FocusGeometryKey) => DOMRectReadOnly | null;
  keys: () => FocusGeometryKey[];
}

export const focusGeometryTargets = {
  filmstripSlideButton: (slideIndex: number): FocusGeometryKey =>
    `filmstrip:slide-button:${slideIndex}`,
  stageNode: (nodeId: string): FocusGeometryKey => `stage:node:${nodeId}`,
};

export function createFocusGeometryRegistry(): FocusGeometryRegistry {
  const elements = new Map<FocusGeometryKey, HTMLElement>();

  return {
    register(key, element) {
      if (element) {
        elements.set(key, element);
        return;
      }
      elements.delete(key);
    },
    createRef(key) {
      return (element) => {
        if (element) {
          elements.set(key, element);
          return;
        }
        elements.delete(key);
      };
    },
    unregister(key) {
      elements.delete(key);
    },
    getElement<T extends HTMLElement = HTMLElement>(key: FocusGeometryKey) {
      return (elements.get(key) as T | undefined) ?? null;
    },
    focus(key, options) {
      const element = elements.get(key);
      if (!element) return false;
      element.focus(options);
      return true;
    },
    measure(key) {
      return elements.get(key)?.getBoundingClientRect() ?? null;
    },
    keys() {
      return Array.from(elements.keys());
    },
  };
}
