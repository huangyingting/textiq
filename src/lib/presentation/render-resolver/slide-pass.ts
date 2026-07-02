import type { Deck, SlideNode } from "../schema";
import type { ThemePackageV1 } from "../theme-package-schema";
import type {
  ResolvedRenderNode,
  ResolvedSlideBackground,
  ResolvedSlideRenderTree,
} from "../render-tree";
import { buildSlideRenderLists } from "../render-tree";
import { resolveNodeStyle } from "../style-resolver";
import { DiagnosticCollector } from "../diagnostics";
import { resolveDeckChromePass } from "./chrome-pass";
import { resolveDecorationsPass } from "./decoration-pass";
import { resolveUserNodesPass } from "./user-node-pass";

export function resolveSlideRenderTreePass(
  slide: SlideNode,
  deck: Deck,
  pkg: ThemePackageV1,
  dc: DiagnosticCollector,
  slideIndex: number,
  slideCount: number,
  canvasWidthPx = 960,
  canvasHeightPx = 540,
): ResolvedSlideRenderTree {
  let slideFill = undefined;
  if (slide.style) {
    const { style, diagnostics } = resolveNodeStyle(
      slide.style,
      deck.theme,
      pkg,
      slide.localStyle,
    );
    slideFill = style.slide?.background;
    for (const d of diagnostics) dc.add(d);
  }

  const background: ResolvedSlideBackground = {
    fill: slideFill,
    decorationLevel: slide.props?.decoration ?? "default",
  };

  const decorations = resolveDecorationsPass(
    slide,
    pkg,
    deck,
    dc,
    canvasWidthPx,
    canvasHeightPx,
  );
  const nodes: ResolvedRenderNode[] = resolveUserNodesPass(
    slide,
    deck,
    pkg,
    dc,
    canvasWidthPx,
    canvasHeightPx,
  );
  const chrome = resolveDeckChromePass(
    slide,
    deck,
    pkg,
    slideIndex,
    slideCount,
    dc,
    canvasWidthPx,
    canvasHeightPx,
  );
  const renderLists = buildSlideRenderLists({ decorations, chrome, nodes });

  return {
    id: slide.id,
    background,
    decorations,
    chrome,
    nodes,
    renderLists,
    ...(slide.notes ? { notes: slide.notes } : {}),
  };
}
