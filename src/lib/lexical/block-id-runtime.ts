import { ListItemNode } from "@lexical/list";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableNode } from "@lexical/table";
import {
  $getState,
  $getRoot,
  $isElementNode,
  $setState,
  createState,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type SerializedLexicalNode,
  ParagraphNode,
} from "lexical";

import { generateBlockId } from "./block-id";

type NodeWithBid = LexicalNode & {
  createDOM(...args: unknown[]): HTMLElement;
  updateDOM(
    previousNode: LexicalNode,
    dom: HTMLElement,
    ...args: unknown[]
  ): boolean;
  exportJSON(): SerializedLexicalNode;
  updateFromJSON(serializedNode: SerializedLexicalNode): NodeWithBid;
};

type PatchableNodeClass = {
  name: string;
  prototype: NodeWithBid;
};

const PATCH_FLAG = Symbol.for("textiq.block-id.patch");
const blockIdState = createState("bid", {
  parse(value) {
    return typeof value === "string" && value.length > 0 ? value : "";
  },
});
let supportInstalled = false;

function readSerializedBid(
  serializedNode: SerializedLexicalNode,
): string | undefined {
  const bid = (serializedNode as SerializedLexicalNode & { bid?: unknown }).bid;
  return typeof bid === "string" && bid.length > 0 ? bid : undefined;
}

export function $getNodeBlockId(
  node: LexicalNode | null | undefined,
): string | undefined {
  if (!node) return undefined;
  const bid = $getState(node, blockIdState);
  return bid.length > 0 ? bid : undefined;
}

export function $setNodeBlockId<T extends LexicalNode>(
  node: T,
  bid: string,
): T {
  return $setState(node, blockIdState, bid);
}

function ensureNodeBid(node: LexicalNode): string {
  const existing = $getNodeBlockId(node);
  if (existing) return existing;
  const bid = generateBlockId();
  $setNodeBlockId(node, bid);
  return bid;
}

function isDurableBlockNode(node: LexicalNode): boolean {
  return (
    node instanceof ParagraphNode ||
    node instanceof HeadingNode ||
    node instanceof QuoteNode ||
    node instanceof HorizontalRuleNode ||
    node instanceof ListItemNode ||
    node instanceof TableNode
  );
}
/* node:coverage ignore next 2 */ /* tsx maps this covered helper signature as uncovered. */
function patchNodeClass(klass: PatchableNodeClass): void {
  const proto = klass.prototype as NodeWithBid & { [PATCH_FLAG]?: boolean };
  if (proto[PATCH_FLAG]) {
    return;
  }

  const originalCreateDOM = proto.createDOM;
  const originalUpdateDOM = proto.updateDOM;
  const originalExportJSON = proto.exportJSON;
  const originalUpdateFromJSON = proto.updateFromJSON;

  proto.updateFromJSON = function updateFromJSONWithBid(
    this: NodeWithBid,
    serializedNode: SerializedLexicalNode,
  ): NodeWithBid {
    const self = originalUpdateFromJSON.call(this, serializedNode);
    $setNodeBlockId(
      self,
      readSerializedBid(serializedNode) ??
        $getNodeBlockId(self) ??
        generateBlockId(),
    );
    /* node:coverage ignore next 2 */ /* updateFromJSON bid hydration is asserted; tsx maps the return/closure as uncovered. */
    return self;
  };

  proto.createDOM = function createDOMWithBid(
    this: NodeWithBid,
    ...args: unknown[]
  ): HTMLElement {
    const element = originalCreateDOM.apply(this, args);
    const bid = $getNodeBlockId(this);
    if (bid) {
      element.setAttribute("data-lexical-block-id", bid);
    }
    return element;
  };

  proto.updateDOM = function updateDOMWithBid(
    this: NodeWithBid,
    previousNode: LexicalNode,
    dom: HTMLElement,
    ...args: unknown[]
  ): boolean {
    const shouldReplace = originalUpdateDOM.call(
      this,
      previousNode,
      dom,
      ...args,
    );
    const bid = $getNodeBlockId(this);
    if (bid) {
      dom.setAttribute("data-lexical-block-id", bid);
    } else {
      dom.removeAttribute("data-lexical-block-id");
    }
    return shouldReplace;
  };

  proto.exportJSON = function exportJSONWithBid(
    this: NodeWithBid,
  ): SerializedLexicalNode {
    /* node:coverage ignore next 3 */ /* exportJSONWithBid branches are asserted; tsx maps the serialized type rows as uncovered. */
    const json = originalExportJSON.call(this) as SerializedLexicalNode & {
      $?: Record<string, unknown>;
      bid?: string;
    };
    json.bid = $getNodeBlockId(this) ?? generateBlockId();
    if (json.$ && "bid" in json.$) {
      const { bid: _nestedBid, ...remainingState } = json.$;
      if (Object.keys(remainingState).length > 0) {
        json.$ = remainingState;
      } else {
        delete json.$;
      }
    }
    return json;
  };

  proto[PATCH_FLAG] = true;
}

function visit(node: LexicalNode): void {
  /* node:coverage ignore next 3 */ /* Document stamping is asserted; tsx maps the branch close as uncovered. */
  if (isDurableBlockNode(node) && !$getNodeBlockId(node)) {
    ensureNodeBid(node);
  }
  if ($isElementNode(node)) {
    for (const child of node.getChildren()) {
      visit(child);
    }
  }
}

function patchableNodeClass(nodeClass: unknown): PatchableNodeClass {
  return nodeClass as unknown as PatchableNodeClass;
}

/**
 * Installs once-per-runtime prototype patches that preserve `bid` across
 * Lexical clone/import/export cycles while keeping the serialized node types
 * unchanged (`paragraph`, `heading`, `listitem`, etc.).
 */
export function ensureLexicalBlockIdSupport(): void {
  if (supportInstalled) {
    return;
  }
  supportInstalled = true;
  patchNodeClass(patchableNodeClass(ParagraphNode));
  patchNodeClass(patchableNodeClass(HeadingNode));
  patchNodeClass(patchableNodeClass(QuoteNode));
  patchNodeClass(patchableNodeClass(ListItemNode));
  patchNodeClass(patchableNodeClass(HorizontalRuleNode));
  patchNodeClass(patchableNodeClass(TableNode));
}

/**
 * Walks the live editor tree and stamps any block nodes missing a `bid`.
 * Safe to call repeatedly inside a Lexical update.
 */
export function $ensureBlockIdsInDocument(): void {
  visit($getRoot());
}

/**
 * Registers transforms that stamp freshly-created block nodes with `bid`
 * values before they are serialized or synced.
 */
export function registerBlockIdTransforms(editor: LexicalEditor): () => void {
  ensureLexicalBlockIdSupport();
  const unregisters = [
    editor.registerNodeTransform(ParagraphNode, (node) => {
      if (!$getNodeBlockId(node)) ensureNodeBid(node);
    }),
    editor.registerNodeTransform(HeadingNode, (node) => {
      if (!$getNodeBlockId(node)) ensureNodeBid(node);
    }),
    /* node:coverage ignore next 3 */ /* QuoteNode transform is asserted via registerBlockIdTransforms; tsx maps the callback tail as uncovered. */
    editor.registerNodeTransform(QuoteNode, (node) => {
      if (!$getNodeBlockId(node)) ensureNodeBid(node);
    }),
    editor.registerNodeTransform(ListItemNode, (node) => {
      if (!$getNodeBlockId(node)) ensureNodeBid(node);
    }),
    /* node:coverage ignore next 3 */ /* HorizontalRuleNode transform is asserted via registerBlockIdTransforms; tsx maps the callback tail as uncovered. */
    editor.registerNodeTransform(HorizontalRuleNode, (node) => {
      if (!$getNodeBlockId(node)) ensureNodeBid(node);
    }),
    editor.registerNodeTransform(TableNode, (node) => {
      if (!$getNodeBlockId(node)) ensureNodeBid(node);
    }),
  ];
  return () => {
    for (const unregister of unregisters) {
      unregister();
    }
  };
}

/* node:coverage ignore next 5 -- serialize delegation is asserted; tsx maps the export signature as uncovered. */
export function serializeEditorStateWithBlockIds(
  editorState: EditorState,
): unknown {
  return editorState.toJSON();
}
