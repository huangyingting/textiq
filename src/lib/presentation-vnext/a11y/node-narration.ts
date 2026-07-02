import type { DeckAssetRegistry } from "@/lib/presentation-vnext/schema";
import type { ResolvedRenderNode } from "@/lib/presentation-vnext/render-tree";

export type DeckOutlineNodeRole =
  | "text"
  | "image"
  | "shape"
  | "table"
  | "visual"
  | "connector"
  | "group";

export type NodeNarrationWarning =
  | "decorative"
  | "missing-alt"
  | "missing-visual-description"
  | "unbound-connector"
  | "empty-text";

export type NodeNarration = {
  id: string;
  role: DeckOutlineNodeRole;
  label: string;
  decorative: boolean;
  warnings: NodeNarrationWarning[];
};

export type NodeNarrationOptions = {
  assets?: DeckAssetRegistry;
  maxTextPreviewLength?: number;
};

const DEFAULT_TEXT_PREVIEW_LENGTH = 120;

const ROLE_LABELS: Record<DeckOutlineNodeRole, string> = {
  text: "Text",
  image: "Image",
  shape: "Shape",
  table: "Table",
  visual: "Visual",
  connector: "Connector",
  group: "Group",
};

const SHAPE_LABELS: Record<string, string> = {
  circle: "circle",
  diamond: "diamond",
  ellipse: "ellipse",
  line: "line",
  path: "path",
  rect: "rectangle",
  square: "square",
  triangle: "triangle",
};

function normalizeText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function truncateNarrationText(
  value: string,
  maxLength = DEFAULT_TEXT_PREVIEW_LENGTH,
): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  if (maxLength <= 1) {
    return "…";
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function explicitAccessibleLabel(node: ResolvedRenderNode): string | undefined {
  const label = normalizeText(node.accessibility?.label);
  if (label) return label;
  const alt = normalizeText(node.accessibility?.alt);
  if (alt) return alt;
  const name = normalizeText(node.name);
  return name || undefined;
}

function roleForNode(node: ResolvedRenderNode): DeckOutlineNodeRole {
  switch (node.content.type) {
    case "text":
      return "text";
    case "image":
      return "image";
    case "shape":
      return "shape";
    case "table":
      return "table";
    case "visual":
      return "visual";
    case "connector":
      return "connector";
    case "group":
      return "group";
  }
}

function textContentPreview(
  node: ResolvedRenderNode,
  maxTextPreviewLength: number,
): string {
  if (node.content.type !== "text") return "";
  return truncateNarrationText(
    node.content.content.paragraphs
      .map((paragraph) => paragraph.text)
      .join(" "),
    maxTextPreviewLength,
  );
}

function semanticTextPrefix(node: ResolvedRenderNode): string {
  if (!node.role) return ROLE_LABELS.text;
  return node.role
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function imageAltText(
  node: ResolvedRenderNode,
  assets: DeckAssetRegistry | undefined,
): string {
  if (node.content.type !== "image") return "";
  const contentAlt = normalizeText(node.content.content.alt);
  if (contentAlt) return contentAlt;
  const assetAlt = normalizeText(
    assets?.images[node.content.content.assetId]?.alt,
  );
  return assetAlt;
}

function visualDescription(
  node: ResolvedRenderNode,
  assets: DeckAssetRegistry | undefined,
): string {
  if (node.content.type !== "visual") return "";
  const contentAlt = normalizeText(node.content.content.alt);
  if (contentAlt) return contentAlt;
  const asset = node.content.content.assetId
    ? assets?.visuals?.[node.content.content.assetId]
    : undefined;
  const assetAlt = normalizeText(asset?.alt);
  if (assetAlt) return assetAlt;
  const assetTitle = normalizeText(asset?.title);
  if (assetTitle) return assetTitle;
  return normalizeText(node.content.content.visualId ?? asset?.visualId);
}

function shapeLabel(node: ResolvedRenderNode): string {
  if (node.content.type !== "shape") return ROLE_LABELS.shape;
  const shape =
    SHAPE_LABELS[node.content.content.shape] ?? node.content.content.shape;
  const semanticRole = normalizeText(node.role);
  if (semanticRole && semanticRole !== "background") {
    return `${semanticRole} ${shape} shape`;
  }
  return `${shape} shape`;
}

function tableLabel(node: ResolvedRenderNode): string {
  if (node.content.type !== "table") return ROLE_LABELS.table;
  const { caption, columns, rows, header } = node.content.content;
  const parts = [
    normalizeText(caption) || "Table",
    `${columns.length} columns`,
    `${rows.length} rows`,
  ];
  const headerLabels = header
    ? columns.map((column) => normalizeText(column.label)).filter(Boolean)
    : [];
  if (headerLabels.length > 0) {
    parts.push(`headers: ${headerLabels.join(", ")}`);
  }
  return `Table: ${parts.join(", ")}`;
}

function endpointLabel(endpoint: { kind: string }): string {
  return endpoint.kind === "point" ? "point" : "unbound endpoint";
}

function connectorLabel(node: ResolvedRenderNode): {
  label: string;
  unbound: boolean;
} {
  if (node.content.type !== "connector") {
    return { label: ROLE_LABELS.connector, unbound: false };
  }
  const { from, routing, to } = node.content.content;
  const unbound = from.kind !== "point" || to.kind !== "point";
  const routingLabel = routing ?? "straight";
  return {
    label: `Connector: ${routingLabel} from ${endpointLabel(from)} to ${endpointLabel(to)}`,
    unbound,
  };
}

function groupLabel(
  node: ResolvedRenderNode,
  options: Required<Pick<NodeNarrationOptions, "maxTextPreviewLength">> &
    Pick<NodeNarrationOptions, "assets">,
): string {
  const children = (node.children ?? [])
    .map((child) => narrateNode(child, options))
    .filter((child) => !child.decorative);
  const roleSummary = children.length
    ? ` (${children.map((child) => child.role).join(", ")})`
    : "";
  return `Group: ${children.length} children${roleSummary}`;
}

export function narrateNode(
  node: ResolvedRenderNode,
  options: NodeNarrationOptions = {},
): NodeNarration {
  const role = roleForNode(node);
  const maxTextPreviewLength =
    options.maxTextPreviewLength ?? DEFAULT_TEXT_PREVIEW_LENGTH;
  const warnings: NodeNarrationWarning[] = [];
  const decorative = node.accessibility?.decorative === true;
  if (decorative) warnings.push("decorative");

  const explicitLabel = explicitAccessibleLabel(node);
  let label = explicitLabel;

  if (!label) {
    switch (role) {
      case "text": {
        const preview = textContentPreview(node, maxTextPreviewLength);
        if (!preview) warnings.push("empty-text");
        label = preview
          ? `${semanticTextPrefix(node)}: ${preview}`
          : "Text: Empty text";
        break;
      }
      case "image": {
        const alt = imageAltText(node, options.assets);
        if (!alt) warnings.push("missing-alt");
        label = alt ? `Image: ${alt}` : "Image: Missing alt text";
        break;
      }
      case "shape":
        label = decorative
          ? `Decorative ${shapeLabel(node)}`
          : `Shape: ${shapeLabel(node)}`;
        break;
      case "table":
        label = tableLabel(node);
        break;
      case "visual": {
        const description = visualDescription(node, options.assets);
        if (!description) warnings.push("missing-visual-description");
        label = description
          ? `Visual: ${description}`
          : "Visual: Missing description";
        break;
      }
      case "connector": {
        const connector = connectorLabel(node);
        if (connector.unbound) warnings.push("unbound-connector");
        label = connector.label;
        break;
      }
      case "group":
        label = groupLabel(node, { ...options, maxTextPreviewLength });
        break;
    }
  }

  return {
    id: node.id,
    role,
    label,
    decorative,
    warnings,
  };
}
