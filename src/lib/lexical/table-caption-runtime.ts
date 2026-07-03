import { TableNode, type SerializedTableNode } from "@lexical/table";
import { $getNodeByKey, type LexicalEditor } from "lexical";

type SerializedTableNodeWithCaption = SerializedTableNode & {
  caption?: unknown;
};

type TableNodeWithCaption = TableNode & {
  __caption?: string;
  afterCloneFrom(prevNode: TableNodeWithCaption): void;
  createDOM(config: unknown, editor?: LexicalEditor): HTMLElement;
  exportJSON(): SerializedTableNode;
  getKey(): string;
  updateDOM(
    prevNode: TableNodeWithCaption,
    dom: HTMLElement,
    config: unknown,
  ): boolean;
  updateFromJSON(serializedNode: SerializedTableNode): TableNodeWithCaption;
};

type PatchableTableNodeClass = {
  prototype: TableNodeWithCaption;
};

const PATCH_FLAG = Symbol.for("textiq.table-caption.patch");
const TABLE_WRAPPER_SELECTOR = "[data-document-table-wrapper]";
const CAPTION_SELECTOR = "[data-document-table-caption]";
const CAPTION_INPUT_SELECTOR = "[data-document-table-caption-input]";
let supportInstalled = false;

export function normalizeDocumentTableCaption(caption: string): string {
  return caption.trim();
}

function serializedCaption(
  serializedNode: SerializedTableNodeWithCaption,
): string {
  return typeof serializedNode.caption === "string"
    ? normalizeDocumentTableCaption(serializedNode.caption)
    : "";
}

function patchTableNodeClass(klass: PatchableTableNodeClass): void {
  const proto = klass.prototype as TableNodeWithCaption & {
    [PATCH_FLAG]?: boolean;
  };
  if (proto[PATCH_FLAG]) return;

  const originalAfterCloneFrom = proto.afterCloneFrom;
  const originalCreateDOM = proto.createDOM;
  const originalExportJSON = proto.exportJSON;
  const originalUpdateDOM = proto.updateDOM;
  const originalUpdateFromJSON = proto.updateFromJSON;

  proto.afterCloneFrom = function afterCloneFromWithCaption(
    this: TableNodeWithCaption,
    prevNode: TableNodeWithCaption,
  ): void {
    originalAfterCloneFrom.call(this, prevNode);
    this.__caption = prevNode.__caption ?? "";
  };

  proto.updateFromJSON = function updateFromJSONWithCaption(
    this: TableNodeWithCaption,
    serializedNode: SerializedTableNode,
  ): TableNodeWithCaption {
    const self = originalUpdateFromJSON.call(this, serializedNode);
    self.__caption = serializedCaption(serializedNode);
    return self;
  };

  proto.createDOM = function createDOMWithCaption(
    this: TableNodeWithCaption,
    config: unknown,
    editor?: LexicalEditor,
  ): HTMLElement {
    const dom = originalCreateDOM.call(this, config, editor);
    const wrapper = ensureTableWrapper(dom);
    syncCaptionDOM(this, wrapper, editor);
    return wrapper;
  };

  proto.updateDOM = function updateDOMWithCaption(
    this: TableNodeWithCaption,
    prevNode: TableNodeWithCaption,
    dom: HTMLElement,
    config: unknown,
  ): boolean {
    const originalDOM = originalTableDOM(dom);
    const shouldReplace = originalDOM
      ? originalUpdateDOM.call(this, prevNode, originalDOM, config)
      : true;
    if (!shouldReplace) {
      syncCaptionDOM(this, dom);
    }
    return shouldReplace;
  };

  proto.exportJSON = function exportJSONWithCaption(
    this: TableNodeWithCaption,
  ): SerializedTableNode {
    const json = originalExportJSON.call(
      this,
    ) as SerializedTableNodeWithCaption;
    const caption = normalizeDocumentTableCaption(this.__caption ?? "");
    if (caption.length > 0) {
      json.caption = caption;
    } else {
      delete json.caption;
    }
    return json as SerializedTableNode;
  };

  proto[PATCH_FLAG] = true;
}

function findTableElement(dom: HTMLElement): HTMLTableElement | null {
  return dom instanceof HTMLTableElement ? dom : dom.querySelector("table");
}

function isTableWrapper(value: HTMLElement): boolean {
  return value.matches(TABLE_WRAPPER_SELECTOR);
}

function ensureTableWrapper(dom: HTMLElement): HTMLElement {
  if (isTableWrapper(dom)) return dom;
  const wrapper = document.createElement("figure");
  wrapper.dataset.documentTableWrapper = "true";
  wrapper.className = "my-4";
  wrapper.appendChild(dom);
  return wrapper;
}

function tableWrapperForDOM(dom: HTMLElement): HTMLElement {
  const wrapper = dom.closest<HTMLElement>(TABLE_WRAPPER_SELECTOR);
  return wrapper ?? dom;
}

function originalTableDOM(dom: HTMLElement): HTMLElement | null {
  if (!isTableWrapper(dom)) return dom;
  for (const child of Array.from(dom.children)) {
    if (child instanceof HTMLElement && !child.matches(CAPTION_SELECTOR)) {
      return child;
    }
  }
  return null;
}

function findCaptionElement(wrapper: HTMLElement): HTMLElement | null {
  for (const child of Array.from(wrapper.children)) {
    if (child instanceof HTMLElement && child.matches(CAPTION_SELECTOR)) {
      return child;
    }
  }
  return null;
}

function captionInput(captionElement: HTMLElement): HTMLInputElement | null {
  return captionElement.querySelector<HTMLInputElement>(CAPTION_INPUT_SELECTOR);
}

function sanitizeCaptionInput(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

function refreshCaptionVisibility(
  tableElement: HTMLTableElement,
  captionElement: HTMLElement,
  input: HTMLInputElement,
): void {
  const hasCaption = input.value.trim().length > 0;
  const active =
    tableElement.dataset.tableEditingActive === "true" ||
    document.activeElement === input;
  captionElement.hidden = !hasCaption && !active;
}

function ensureCaptionElement(wrapper: HTMLElement): HTMLElement {
  const existing = findCaptionElement(wrapper);
  if (existing) return existing;
  const captionElement = document.createElement("figcaption");
  captionElement.dataset.documentTableCaption = "true";
  captionElement.className =
    "px-0 pb-2 text-left text-sm font-medium text-ds-text-secondary";
  const input = document.createElement("input");
  input.type = "text";
  input.dataset.documentTableCaptionInput = "true";
  input.placeholder = "Add table caption";
  input.setAttribute("aria-label", "Table caption");
  input.className =
    "w-full rounded-ds-sm bg-transparent px-1 py-0.5 text-sm font-medium text-ds-text-secondary placeholder:text-ds-text-muted focus:bg-ds-surface-raised focus:outline-none focus:ring-2 focus:ring-ds-focus-ring";
  captionElement.appendChild(input);
  wrapper.insertBefore(captionElement, wrapper.firstChild);
  return captionElement;
}

function bindCaptionInput(
  tableKey: string,
  tableElement: HTMLTableElement,
  captionElement: HTMLElement,
  input: HTMLInputElement,
  editor?: LexicalEditor,
): void {
  input.dataset.tableKey = tableKey;
  captionElement.dataset.tableKey = tableKey;
  if (!editor || input.dataset.documentTableCaptionBound === "true") {
    return;
  }
  input.dataset.documentTableCaptionBound = "true";
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
  input.addEventListener("mousedown", (event) => event.stopPropagation());
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("focus", () => {
    tableElement.dataset.tableEditingActive = "true";
    refreshCaptionVisibility(tableElement, captionElement, input);
  });
  input.addEventListener("blur", () => {
    refreshCaptionVisibility(tableElement, captionElement, input);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    input.blur();
    editor.focus();
  });
  input.addEventListener("input", () => {
    const next = sanitizeCaptionInput(input.value);
    if (next !== input.value) {
      input.value = next;
    }
    editor.update(() => {
      const node = $getNodeByKey(input.dataset.tableKey ?? "");
      if (node instanceof TableNode) {
        $setDocumentTableCaption(node, next);
      }
    });
    refreshCaptionVisibility(tableElement, captionElement, input);
  });
}

function syncCaptionDOM(
  tableNode: TableNodeWithCaption,
  dom: HTMLElement,
  editor?: LexicalEditor,
): void {
  const wrapper = tableWrapperForDOM(dom);
  const tableElement = findTableElement(dom);
  if (!tableElement) return;
  const captionElement = ensureCaptionElement(wrapper);
  const input = captionInput(captionElement);
  if (!input) return;
  const caption = normalizeDocumentTableCaption(tableNode.__caption ?? "");
  bindCaptionInput(
    tableNode.getKey(),
    tableElement,
    captionElement,
    input,
    editor,
  );
  if (document.activeElement !== input && input.value !== caption) {
    input.value = caption;
  }
  refreshCaptionVisibility(tableElement, captionElement, input);
}

export function refreshDocumentTableCaptionDOM(
  dom: HTMLElement | null | undefined,
): void {
  if (!dom) return;
  const wrapper = tableWrapperForDOM(dom);
  const tableElement = findTableElement(dom);
  if (!tableElement) return;
  const captionElement = findCaptionElement(wrapper);
  if (!captionElement) return;
  const input = captionInput(captionElement);
  if (!input) return;
  refreshCaptionVisibility(tableElement, captionElement, input);
}

export function ensureLexicalTableCaptionSupport(): void {
  if (supportInstalled) return;
  supportInstalled = true;
  patchTableNodeClass(TableNode as unknown as PatchableTableNodeClass);
}

export function $getDocumentTableCaption(table: TableNode): string {
  ensureLexicalTableCaptionSupport();
  const latest = table.getLatest() as TableNodeWithCaption;
  return latest.__caption ?? "";
}

export function $setDocumentTableCaption(
  table: TableNode,
  caption: string,
): TableNode {
  ensureLexicalTableCaptionSupport();
  const writable = table.getWritable() as TableNodeWithCaption;
  writable.__caption = normalizeDocumentTableCaption(caption);
  return writable;
}
