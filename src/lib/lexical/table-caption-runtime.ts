import { TableNode, type SerializedTableNode } from "@lexical/table";

type SerializedTableNodeWithCaption = SerializedTableNode & {
  caption?: unknown;
};

type TableNodeWithCaption = TableNode & {
  __caption?: string;
  afterCloneFrom(prevNode: TableNodeWithCaption): void;
  exportJSON(): SerializedTableNode;
  updateFromJSON(serializedNode: SerializedTableNode): TableNodeWithCaption;
};

type PatchableTableNodeClass = {
  prototype: TableNodeWithCaption;
};

const PATCH_FLAG = Symbol.for("textiq.table-caption.patch");
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
  const originalExportJSON = proto.exportJSON;
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
