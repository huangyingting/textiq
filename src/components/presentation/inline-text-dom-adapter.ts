import type { InlineTextCommandPayload } from "@/lib/presentation/inline-text-commands";
import type { Paragraph, TextRun } from "@/lib/presentation/schema";
import { mergeRuns, shouldStoreRuns } from "@/lib/presentation/rich-text";
import {
  normalizeInlineTextLink,
  sanitizeInlineTextColor,
  sanitizeInlineTextCssFontSize,
  sanitizeInlineTextFontFamily,
  sanitizeInlineTextFontSizePt,
} from "@/lib/presentation/rich-text-safety";

export type InlineTextAlign = "left" | "center" | "right";

type InlineRunStyle = Omit<TextRun, "text">;

export type InlineTextAdapterExit =
  | { kind: "none" }
  | { kind: "cancel" }
  | {
      kind: "commit";
      paragraphs: Paragraph[];
      textAlign?: InlineTextAlign;
    };

export interface InlineTextDomAdapterOptions {
  nodeId: string;
  initialParagraphs: Paragraph[];
}

export interface InlineTextDomAdapter {
  mountInitialHtml(container: HTMLElement): void;
  commit(container: HTMLElement | null): InlineTextAdapterExit;
  commitForTab(container: HTMLElement | null): InlineTextAdapterExit;
  commitOrCancelForEscape(container: HTMLElement | null): InlineTextAdapterExit;
  cancel(): InlineTextAdapterExit;
  startComposition(): void;
  endComposition(container: HTMLElement | null): InlineTextAdapterExit;
  applyCommand(container: HTMLElement, payload: InlineTextCommandPayload): void;
  isComposing(): boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function styleFromElement(
  element: HTMLElement,
  inherited: InlineRunStyle,
): InlineRunStyle {
  const tagName = element.tagName.toLowerCase();
  const next: InlineRunStyle = { ...inherited };
  if (tagName === "b" || tagName === "strong") next.bold = true;
  if (tagName === "i" || tagName === "em") next.italic = true;
  if (tagName === "u") next.underline = true;
  if (tagName === "s" || tagName === "strike" || tagName === "del") {
    next.strikethrough = true;
  }
  if (tagName === "code") next.code = true;
  if (tagName === "a") {
    const href = normalizeInlineTextLink(element.getAttribute("href"));
    if (href) next.link = href;
  }

  const fontWeight = element.style.fontWeight;
  if (fontWeight === "bold" || Number(fontWeight) >= 600) next.bold = true;
  if (element.style.fontStyle === "italic") next.italic = true;
  const textDecoration = [
    element.style.textDecorationLine,
    element.style.textDecoration,
  ].join(" ");
  if (textDecoration.includes("underline")) {
    next.underline = true;
  }
  if (textDecoration.includes("line-through")) {
    next.strikethrough = true;
  }

  const color = sanitizeInlineTextColor(
    element.style.color || element.getAttribute("color"),
  );
  const fontSize = element.style.fontSize;
  const fontFamily = sanitizeInlineTextFontFamily(element.style.fontFamily);
  if (color || fontSize || fontFamily) {
    next.localStyle = { ...next.localStyle };
    if (color) next.localStyle.color = color;
    if (fontSize.endsWith("pt")) {
      next.localStyle.fontSizePt = Number.parseFloat(fontSize);
    } else if (fontSize.endsWith("px")) {
      next.localStyle.fontSizePt = Number.parseFloat(fontSize) * 0.75;
    }
    if (fontFamily) next.localStyle.fontFamily = fontFamily;
  }
  return next;
}

function collectRuns(node: Node, inherited: InlineRunStyle = {}): TextRun[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    return text.length > 0 ? [{ text, ...inherited }] : [];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const element = node as HTMLElement;
  if (
    element.getAttribute("aria-hidden") === "true" ||
    element.getAttribute("contenteditable") === "false"
  ) {
    return [];
  }
  if (element.tagName.toLowerCase() === "br") return [{ text: "\n" }];
  const style = styleFromElement(element, inherited);
  return Array.from(element.childNodes).flatMap((child) =>
    collectRuns(child, style),
  );
}

function serializeParagraphNode(
  node: Node,
  fallbackId: string,
  listKind?: "bullet" | "number",
  listIndent?: number,
): Paragraph {
  const runs = mergeRuns(collectRuns(node)).filter((run) => run.text !== "\n");
  const text = runs.map((run) => run.text).join("");
  return {
    id: fallbackId,
    text,
    ...(shouldStoreRuns(runs) ? { runs } : {}),
    ...(listKind
      ? {
          list: {
            kind: listKind,
            ...(listIndent && listIndent > 0 ? { indent: listIndent } : {}),
          },
        }
      : {}),
  };
}

/* node:coverage ignore next 49 */
function listIndentFromElement(element: HTMLElement): number | undefined {
  const raw = element.dataset.listIndent;
  const indent = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(indent) && indent > 0 ? indent : undefined;
}

function editableParagraphNodes(
  container: HTMLElement,
): { node: Node; listKind?: "bullet" | "number"; listIndent?: number }[] {
  const nodes: {
    node: Node;
    listKind?: "bullet" | "number";
    listIndent?: number;
  }[] = [];
  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if ((child.textContent ?? "").length > 0) nodes.push({ node: child });
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as HTMLElement;
    const tagName = element.tagName.toLowerCase();
    if (tagName === "ul" || tagName === "ol") {
      const listKind = tagName === "ol" ? "number" : "bullet";
      for (const item of Array.from(element.children)) {
        if (item.tagName.toLowerCase() === "li") {
          nodes.push({
            node: item,
            listKind,
            listIndent: listIndentFromElement(item as HTMLElement),
          });
        }
      }
    } else if (tagName === "li") {
      const listKind =
        element.parentElement?.tagName.toLowerCase() === "ol"
          ? "number"
          : "bullet";
      nodes.push({
        node: element,
        listKind,
        listIndent: listIndentFromElement(element),
      });
    } else if (
      element.dataset.listKind === "bullet" ||
      element.dataset.listKind === "number"
    ) {
      nodes.push({
        node: element,
        listKind: element.dataset.listKind,
        listIndent: listIndentFromElement(element),
      });
    } else {
      nodes.push({ node: element });
    }
  }
  return nodes;
}

export function domToParagraphs(
  container: HTMLElement,
  idPrefix: string,
  initialParagraphs: Paragraph[],
): Paragraph[] {
  const paragraphNodes = editableParagraphNodes(container);
  const nodes =
    paragraphNodes.length > 0
      ? paragraphNodes
      : [{ node: document.createTextNode("") }];
  return nodes.map(({ node, listKind, listIndent }, index) =>
    serializeParagraphNode(
      node,
      initialParagraphs[index]?.id ?? `${idPrefix}-p-${index + 1}`,
      listKind,
      listIndent,
    ),
  );
}

function runToHtml(run: TextRun): string {
  const styles: string[] = [];
  if (run.bold) styles.push("font-weight:700");
  if (run.italic) styles.push("font-style:italic");
  if (run.underline || run.strikethrough) {
    styles.push(
      `text-decoration:${[
        run.underline ? "underline" : undefined,
        run.strikethrough ? "line-through" : undefined,
      ]
        .filter(Boolean)
        .join(" ")}`,
    );
  }
  const color = sanitizeInlineTextColor(run.localStyle?.color);
  if (color) {
    styles.push(`color:${color}`);
  }
  const fontSizePt = sanitizeInlineTextFontSizePt(run.localStyle?.fontSizePt);
  if (fontSizePt !== null) {
    styles.push(`font-size:${fontSizePt}pt`);
  }
  const fontFamily = sanitizeInlineTextFontFamily(run.localStyle?.fontFamily);
  if (fontFamily) {
    styles.push(`font-family:${fontFamily}`);
  }
  const styleAttr =
    styles.length > 0 ? ` style="${escapeAttribute(styles.join(";"))}"` : "";
  let html = escapeHtml(run.text);
  if (run.code) html = `<code>${html}</code>`;
  if (styleAttr) html = `<span${styleAttr}>${html}</span>`;
  const link = normalizeInlineTextLink(run.link);
  if (link) html = `<a href="${escapeAttribute(link)}">${html}</a>`;
  return html;
}

type OrderedListNumberStyle = NonNullable<
  NonNullable<Paragraph["list"]>["numberStyle"]
>;

function toAlphabeticMarker(value: number, uppercase: boolean): string {
  if (value <= 0) return "0";
  let remaining = Math.floor(value);
  let marker = "";
  while (remaining > 0) {
    remaining -= 1;
    marker = String.fromCharCode(97 + (remaining % 26)) + marker;
    remaining = Math.floor(remaining / 26);
  }
  return uppercase ? marker.toUpperCase() : marker;
}

function toLowerRomanMarker(value: number): string {
  if (value <= 0) return "0";
  const numerals: Array<[number, string]> = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let remaining = Math.floor(value);
  let marker = "";
  for (const [amount, symbol] of numerals) {
    while (remaining >= amount) {
      marker += symbol;
      remaining -= amount;
    }
  }
  return marker;
}

function formatOrderedListMarker(
  value: number,
  style: OrderedListNumberStyle | undefined,
): string {
  switch (style) {
    case "lower-alpha":
      return `${toAlphabeticMarker(value, false)}.`;
    case "upper-alpha":
      return `${toAlphabeticMarker(value, true)}.`;
    case "lower-roman":
      return `${toLowerRomanMarker(value)}.`;
    default:
      return `${value}.`;
  }
}

function orderedListMarkers(paragraphs: readonly Paragraph[]): string[] {
  const counters = new Array(6).fill(0) as number[];
  return paragraphs.map((paragraph) => {
    if (paragraph.list?.kind !== "number") {
      counters.fill(0);
      return "1.";
    }
    const indent = Math.max(
      0,
      Math.min(counters.length - 1, paragraph.list.indent ?? 0),
    );
    for (let depth = indent + 1; depth < counters.length; depth += 1) {
      counters[depth] = 0;
    }
    counters[indent] += 1;
    return formatOrderedListMarker(
      counters[indent],
      paragraph.list.numberStyle,
    );
  });
}

export function paragraphsToHtml(paragraphs: Paragraph[]): string {
  const numberMarkers = orderedListMarkers(paragraphs);
  return paragraphs
    .map((paragraph, index) => {
      const text = paragraph.runs?.length
        ? paragraph.runs.map(runToHtml).join("")
        : escapeHtml(paragraph.text);
      if (!paragraph.list) return `<p style="margin:0">${text || "<br>"}</p>`;
      const indent = paragraph.list.indent ?? 0;
      const indentAttr = indent > 0 ? ` data-list-indent="${indent}"` : "";
      const indentStyle = indent > 0 ? `;padding-left:${indent * 1.5}em` : "";
      const marker =
        paragraph.list.kind === "number" ? numberMarkers[index] : "•";
      return `<p data-list-kind="${paragraph.list.kind}"${indentAttr} style="display:flex;gap:0.4em;margin:0${indentStyle}"><span aria-hidden="true" contenteditable="false" style="flex:0 0 auto">${marker}</span><span>${text || "<br>"}</span></p>`;
    })
    .join("");
}

function rangeInside(container: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const start = range.startContainer;
  const end = range.endContainer;
  if (!container.contains(start) || !container.contains(end)) return null;
  return range;
}

function restoreSelection(node: Node): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

function wrapRange(
  container: HTMLElement,
  configure: (element: HTMLElement) => void,
  tagName = "span",
): void {
  const range = rangeInside(container);
  if (!range || range.collapsed) return;
  const wrapper = document.createElement(tagName);
  configure(wrapper);
  const fragment = range.extractContents();
  wrapper.appendChild(fragment);
  range.insertNode(wrapper);
  restoreSelection(wrapper);
}

/* node:coverage ignore next 39 */
function unwrapElement(element: HTMLElement) {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
}

function unlinkRange(container: HTMLElement) {
  const range = rangeInside(container);
  if (!range) return;
  const anchors = new Set<HTMLAnchorElement>();
  const addClosestAnchor = (node: Node | null) => {
    const element =
      node instanceof Element ? node : (node?.parentElement ?? null);
    const anchor = element?.closest("a");
    if (anchor instanceof HTMLAnchorElement && container.contains(anchor)) {
      anchors.add(anchor);
    }
  };
  const selection = window.getSelection();
  addClosestAnchor(selection?.anchorNode ?? null);
  addClosestAnchor(selection?.focusNode ?? null);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (!(node instanceof HTMLAnchorElement)) return NodeFilter.FILTER_SKIP;
      return range.intersectsNode(node)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });
  let current = walker.nextNode();
  while (current) {
    if (current instanceof HTMLAnchorElement) anchors.add(current);
    current = walker.nextNode();
  }
  anchors.forEach(unwrapElement);
}

function blockForRange(container: HTMLElement, range: Range): HTMLElement {
  const node =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as HTMLElement)
      : range.startContainer.parentElement;
  return node?.closest("p,div,li") ?? container;
}

function applyBlockAlign(container: HTMLElement, align: InlineTextAlign) {
  const range = rangeInside(container);
  if (!range) return;
  blockForRange(container, range).style.textAlign = align;
}

export function inlineTextAlignForCommand(
  command: InlineTextCommandPayload["command"],
): InlineTextAlign | undefined {
  switch (command) {
    case "align-left":
      return "left";
    case "align-center":
      return "center";
    case "align-right":
      return "right";
    default:
      return undefined;
  }
}

function toggleList(container: HTMLElement, kind: "bullet" | "number") {
  const range = rangeInside(container);
  if (!range) return;
  const block = blockForRange(container, range);
  const currentList = block.closest("ul,ol");
  const targetTag = kind === "number" ? "ol" : "ul";
  if (currentList) {
    if (currentList.tagName.toLowerCase() === targetTag) {
      const replacement = document.createDocumentFragment();
      for (const item of Array.from(currentList.children)) {
        const div = document.createElement("div");
        div.innerHTML = item.innerHTML || "<br>";
        replacement.appendChild(div);
      }
      currentList.replaceWith(replacement);
    } else {
      const nextList = document.createElement(targetTag);
      nextList.innerHTML = currentList.innerHTML;
      currentList.replaceWith(nextList);
      restoreSelection(nextList);
    }
    return;
  }
  const list = document.createElement(targetTag);
  const item = document.createElement("li");
  item.innerHTML = block.innerHTML || "<br>";
  list.appendChild(item);
  block.replaceWith(list);
  restoreSelection(item);
}

/* node:coverage ignore next 23 */
function adjustListIndent(container: HTMLElement, direction: 1 | -1) {
  const range = rangeInside(container);
  if (!range) return;
  const block = blockForRange(container, range);
  const listItem = block.closest("li") as HTMLElement | null;
  const editableBlock = listItem ?? block;
  const listKind =
    editableBlock.dataset.listKind ??
    (listItem
      ? listItem.parentElement?.tagName.toLowerCase() === "ol"
        ? "number"
        : "bullet"
      : undefined);
  if (listKind !== "bullet" && listKind !== "number") return;
  const current = listIndentFromElement(editableBlock) ?? 0;
  const next = Math.max(0, Math.min(6, current + direction));
  if (next > 0) {
    editableBlock.dataset.listIndent = String(next);
    editableBlock.style.paddingLeft = `${next * 1.5}em`;
  } else {
    delete editableBlock.dataset.listIndent;
    editableBlock.style.paddingLeft = "";
  }
}

function editableText(container: HTMLElement): string {
  return container.innerText ?? container.textContent ?? "";
}

export function createInlineTextDomAdapter({
  nodeId,
  initialParagraphs,
}: InlineTextDomAdapterOptions): InlineTextDomAdapter {
  let committed = false;
  let composing = false;
  let pendingCommitAfterComposition = false;
  let committedTextAlign: InlineTextAlign | undefined;

  const commitNow = (container: HTMLElement | null): InlineTextAdapterExit => {
    if (committed) return { kind: "none" };
    if (!container) return cancel();
    if (composing) {
      pendingCommitAfterComposition = true;
      return { kind: "none" };
    }
    committed = true;
    return {
      kind: "commit",
      paragraphs: domToParagraphs(container, nodeId, initialParagraphs),
      textAlign: committedTextAlign,
    };
  };

  const cancel = (): InlineTextAdapterExit => {
    if (committed) return { kind: "none" };
    committed = true;
    pendingCommitAfterComposition = false;
    return { kind: "cancel" };
  };

  return {
    mountInitialHtml(container) {
      container.innerHTML = paragraphsToHtml(
        initialParagraphs.length > 0
          ? initialParagraphs
          : [{ id: `${nodeId}-p-1`, text: "" }],
      );
    },
    commit: commitNow,
    commitForTab(container) {
      if (composing) return { kind: "none" };
      return commitNow(container);
    },
    commitOrCancelForEscape(container) {
      if (composing) return { kind: "none" };
      if (!container) return cancel();
      if (!editableText(container).trim()) return cancel();
      return commitNow(container);
    },
    cancel,
    startComposition() {
      composing = true;
      pendingCommitAfterComposition = false;
    },
    endComposition(container) {
      composing = false;
      if (!pendingCommitAfterComposition) return { kind: "none" };
      pendingCommitAfterComposition = false;
      return commitNow(container);
    },
    applyCommand(container, { command, value }) {
      container.focus();
      const textAlign = inlineTextAlignForCommand(command);
      if (textAlign) {
        committedTextAlign = textAlign;
        applyBlockAlign(container, textAlign);
        return;
      }
      switch (command) {
        case "bold":
          wrapRange(container, (span) => {
            span.style.fontWeight = "700";
          });
          break;
        case "italic":
          wrapRange(container, (span) => {
            span.style.fontStyle = "italic";
          });
          break;
        case "underline":
          wrapRange(container, (span) => {
            span.style.textDecoration = "underline";
          });
          break;
        case "strikethrough":
          wrapRange(container, (span) => {
            span.style.textDecoration = "line-through";
          });
          break;
        case "bullet-list":
          toggleList(container, "bullet");
          break;
        case "numbered-list":
          toggleList(container, "number");
          break;
        case "indent-list":
          adjustListIndent(container, 1);
          break;
        case "outdent-list":
          adjustListIndent(container, -1);
          break;
        case "link":
          {
            const href = normalizeInlineTextLink(value);
            if (!href) return;
            wrapRange(
              container,
              (anchor) => {
                anchor.setAttribute("href", href);
              },
              "a",
            );
          }
          break;
        case "unlink":
          unlinkRange(container);
          break;
        case "color":
          {
            const color = sanitizeInlineTextColor(value);
            if (!color) return;
            wrapRange(container, (span) => {
              span.style.color = color;
            });
          }
          break;
        case "font-size":
          {
            const fontSize = sanitizeInlineTextCssFontSize(value);
            if (!fontSize) return;
            wrapRange(container, (span) => {
              span.style.fontSize = fontSize;
            });
          }
          break;
      }
    },
    isComposing() {
      return composing;
    },
  };
}
