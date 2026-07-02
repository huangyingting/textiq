import type {
  ConnectorEndpoint,
  Deck,
  SlideNode,
  SlideChildNode,
} from "../schema";
import type { ThemePackageV1 } from "../theme-package-schema";
import type { ResolvedRenderNode, ResolvedNodeContent } from "../render-tree";
import { resolveNodeStyle } from "../style-resolver";
import { DiagnosticCollector, retargetDiagnostic } from "../diagnostics";
import type { StyleObject } from "../style-schema";
import { normalizeVisualChannelColors } from "../visual-channel-colors";
import { resolveLayoutFramePass } from "./layout-pass";

// Child node resolver
// ---------------------------------------------------------------------------

function resolveChildNode(
  node: SlideChildNode,
  slide: SlideNode,
  deck: Deck,
  pkg: ThemePackageV1,
  dc: DiagnosticCollector,
  canvasWidthPx = 960,
  canvasHeightPx = 540,
): ResolvedRenderNode | null {
  if (node.hidden) return null;
  if (!node.layout) {
    dc.error("missing-node-layout", `Node "${node.id}" has no layout`, {
      nodeId: node.id,
      slideId: slide.id,
    });
    return null;
  }

  // Validate asset references
  if (node.type === "image") {
    const assetId = node.content.assetId;
    if (assetId !== "placeholder" && !deck.assets.images[assetId]) {
      dc.error(
        "missing-asset",
        `Image node "${node.id}" references missing asset "${assetId}"`,
        {
          nodeId: node.id,
          slideId: slide.id,
          action: { type: "open-asset-panel" },
          details: { assetId },
        },
      );
    }
    const crop = node.content.crop;
    if (crop) {
      const invalidSides = (["top", "right", "bottom", "left"] as const).filter(
        (side) => {
          const value = crop[side];
          return !Number.isFinite(value) || value < 0 || value > 95;
        },
      );
      if (
        invalidSides.length > 0 ||
        crop.left + crop.right >= 99 ||
        crop.top + crop.bottom >= 99
      ) {
        dc.warning(
          "unsupported-export-feature",
          `Image node "${node.id}" has crop values outside safe bounds; render clamps the crop UI and export may differ`,
          {
            nodeId: node.id,
            slideId: slide.id,
            path: `slides.${slide.id}.nodes.${node.id}.content.crop`,
            details: {
              invalidSides,
              horizontalCrop: crop.left + crop.right,
              verticalCrop: crop.top + crop.bottom,
            },
          },
        );
      }
    }
  }
  if (node.type === "visual") {
    const { assetId } = node.content;
    if (assetId && !deck.assets.visuals?.[assetId]) {
      dc.error(
        "missing-asset",
        `Visual node "${node.id}" references missing asset "${assetId}"`,
        {
          nodeId: node.id,
          slideId: slide.id,
          action: { type: "open-asset-panel" },
          details: { assetId },
        },
      );
    }
  }

  // Resolve style
  let resolvedStyle: StyleObject = {};
  if (node.style) {
    const { style: s, diagnostics } = resolveNodeStyle(
      node.style,
      deck.theme,
      pkg,
      node.localStyle,
    );
    resolvedStyle = s;
    for (const d of diagnostics) {
      dc.add(retargetDiagnostic(d, { nodeId: node.id, slideId: slide.id }));
    }
  }

  if (node.type === "visual") {
    const { unsupportedChannels } = normalizeVisualChannelColors(
      resolvedStyle.visual?.channelColors,
    );
    for (const channel of unsupportedChannels) {
      dc.warning(
        "unsupported-export-feature",
        `Visual node "${node.id}" uses unsupported channel color "${channel}"; render and export ignore it`,
        {
          nodeId: node.id,
          slideId: slide.id,
          path: `slides.${slide.id}.nodes.${node.id}.style.visual.channelColors.${channel}`,
          details: { channel },
        },
      );
    }
  }

  // Resolve layout
  const layout = node.layout;
  const resolvedLayout = resolveLayoutFramePass(
    layout,
    canvasWidthPx,
    canvasHeightPx,
  );

  // Build content
  let content: ResolvedNodeContent;
  if (node.type === "group") {
    const children: ResolvedRenderNode[] = [];
    // Sort by zIndex ascending, stable by tree order
    const sorted = [...(node.children ?? [])].sort(
      (a, b) => (a.layout?.zIndex ?? 0) - (b.layout?.zIndex ?? 0),
    );
    for (const child of sorted) {
      const resolved = resolveChildNode(
        child,
        slide,
        deck,
        pkg,
        dc,
        canvasWidthPx,
        canvasHeightPx,
      );
      if (resolved) children.push(resolved);
    }
    content = { type: "group" };
    return {
      id: node.id,
      type: "group",
      role: node.role,
      layout: resolvedLayout,
      style: resolvedStyle,
      content,
      children,
      source: "user",
      locked: node.locked,
      ...(node.name ? { name: node.name } : {}),
      ...(node.accessibility ? { accessibility: node.accessibility } : {}),
    };
  }

  switch (node.type) {
    case "text":
      content = { type: "text", content: node.content };
      break;
    case "image":
      content = { type: "image", content: node.content };
      break;
    case "shape":
      content = { type: "shape", content: node.content };
      break;
    case "connector":
      content = {
        type: "connector",
        content: {
          ...node.content,
          from: resolveConnectorEndpoint(
            node.content.from,
            node,
            slide,
            dc,
            "from",
          ),
          to: resolveConnectorEndpoint(node.content.to, node, slide, dc, "to"),
        },
      };
      break;
    case "table":
      content = { type: "table", content: node.content };
      break;
    case "visual":
      if (node.content.assetId) {
        const visualAsset = deck.assets.visuals?.[node.content.assetId];
        content = {
          type: "visual",
          content: {
            ...node.content,
            ...(visualAsset?.visualId && node.content.visualId === undefined
              ? { visualId: visualAsset.visualId }
              : {}),
            ...(visualAsset?.alt && node.content.alt === undefined
              ? { alt: visualAsset.alt }
              : {}),
          },
        };
      } else {
        content = { type: "visual", content: node.content };
      }
      break;
    default: {
      void (node as never);
      dc.warning(
        "unknown-template-kind",
        `Unknown node type encountered during render resolve`,
      );
      return null;
    }
  }
  return {
    id: node.id,
    type: node.type,
    role: node.role,
    layout: resolvedLayout,
    style: resolvedStyle,
    content,
    source: "user",
    locked: node.locked,
    ...(node.name ? { name: node.name } : {}),
    ...(node.accessibility ? { accessibility: node.accessibility } : {}),
  };
}

function resolveConnectorEndpoint(
  endpoint: ConnectorEndpoint,
  connector: SlideChildNode,
  slide: SlideNode,
  dc: DiagnosticCollector,
  endpointKey: "from" | "to",
): ConnectorEndpoint {
  if (endpoint.kind === "point") return endpoint;
  if (!connector.layout) return endpoint;
  const target = findSlideChildNode(slide.children, endpoint.nodeId);
  if (!target?.layout) {
    dc.warning(
      "unsupported-export-feature",
      `Connector "${connector.id}" ${endpointKey} endpoint references missing node "${endpoint.nodeId}"`,
      {
        nodeId: connector.id,
        slideId: slide.id,
        path: `slides.${slide.id}.nodes.${connector.id}.content.${endpointKey}`,
        details: { targetNodeId: endpoint.nodeId, anchor: endpoint.anchor },
      },
    );
    return endpoint;
  }
  const anchor = targetAnchorPoint(target.layout.frame, endpoint.anchor);
  const frame = connector.layout.frame;
  if (frame.w <= 0 || frame.h <= 0) return endpoint;
  return {
    kind: "point",
    point: {
      x: ((anchor.x - frame.x) / frame.w) * 100,
      y: ((anchor.y - frame.y) / frame.h) * 100,
    },
  };
}

function findSlideChildNode(
  nodes: readonly SlideChildNode[],
  id: string,
): SlideChildNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === "group") {
      const found = findSlideChildNode(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

function targetAnchorPoint(
  frame: { x: number; y: number; w: number; h: number },
  anchor: Extract<ConnectorEndpoint, { kind: "node" }>["anchor"],
): { x: number; y: number } {
  switch (anchor) {
    case "top":
      return { x: frame.x + frame.w / 2, y: frame.y };
    case "right":
      return { x: frame.x + frame.w, y: frame.y + frame.h / 2 };
    case "bottom":
      return { x: frame.x + frame.w / 2, y: frame.y + frame.h };
    case "left":
      return { x: frame.x, y: frame.y + frame.h / 2 };
    case "center":
    default:
      return { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
  }
}

export function resolveUserNodesPass(
  slide: SlideNode,
  deck: Deck,
  pkg: ThemePackageV1,
  dc: DiagnosticCollector,
  canvasWidthPx = 960,
  canvasHeightPx = 540,
): ResolvedRenderNode[] {
  const visibleChildren = slide.children.filter((n) => !n.hidden);
  const sortedChildren = [...visibleChildren].sort(
    (a, b) => (a.layout?.zIndex ?? 0) - (b.layout?.zIndex ?? 0),
  );

  const nodes: ResolvedRenderNode[] = [];
  for (const child of sortedChildren) {
    const resolved = resolveChildNode(
      child,
      slide,
      deck,
      pkg,
      dc,
      canvasWidthPx,
      canvasHeightPx,
    );
    if (resolved) nodes.push(resolved);
  }

  return nodes;
}
