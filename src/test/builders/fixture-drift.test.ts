import assert from "node:assert/strict";
import { test } from "node:test";

import * as builders from "@/test/builders";
import {
  commentAnchorFromRecord,
  commentAnchorToRecord,
  validateAnchorGeometry,
} from "@/lib/comments/anchors";
import { buildDeckSource } from "@/lib/ai/deck-source";
import { safeParseDeck as safeParseLegacyDeck } from "@/lib/document/deck-schema";
import { openDeckFromJson } from "@/lib/presentation/open-deck";
import { safeParseDeck as safeParsePresentationDeck } from "@/lib/presentation/validation";
import { createBlankVisual } from "@/lib/visual/blank";
import { FIXTURE_LIST } from "@/lib/visual/fixtures";
import {
  VISUAL_KINDS,
  safeParseVisual,
  validateVisual,
} from "@/lib/visual/schema";
import {
  buildAssetPolicyMeta as buildFixtureAssetMeta,
  fixturePngBuffer,
} from "@/test/builders/assets";
import * as e2eProfile from "@/test/builders/e2e-profile";
import { skipIf } from "@/test/skip";
import {
  buildCommentAnchor,
  buildSlideCommentAnchor,
} from "@/test/builders/comments";
import {
  buildE2EProfileContentJson,
  buildE2EProfileDeck,
  buildE2EProfileVisual,
  buildE2ESourceLinkedDeck,
  e2eProfileAssetChecksum,
} from "@/test/builders/e2e-profile";
import type { TextNode } from "@/lib/presentation/schema";
import {
  buildContentJson,
  buildHeadingNode,
  buildListItemNode,
  buildListNode,
  buildParagraphNode,
  buildVisualLexicalNode,
} from "@/test/builders/lexical";
import { buildDeck } from "@/test/builders/deck";
import { buildVisual, buildVisualMap } from "@/test/builders/visual";
import { SLIDE_ASSET_UPLOAD_POLICY } from "@/lib/slides/asset-policy";
import { validateAssetUploadPolicy } from "@/lib/assets/upload-policy";
import { deriveStorageKey } from "@/lib/slides/asset-storage";

test("deck builder default is current-schema valid", () => {
  const result = safeParseLegacyDeck(buildDeck());
  assert.equal(result.success, true);
  if (result.success) {
    assert.ok(result.data.schemaVersion, "schemaVersion is required");
    assert.ok(result.data.slides[0].elements?.length);
  }
});

test("visual builders and separated visual fixtures stay schema-valid", () => {
  assert.equal(safeParseVisual(buildVisual()).success, true);

  for (const visual of FIXTURE_LIST) {
    assert.equal(safeParseVisual(visual).success, true, visual.type);
  }

  for (const kind of VISUAL_KINDS) {
    assert.doesNotThrow(() => validateVisual(createBlankVisual(kind)), kind);
  }
});

test("lexical content builder feeds current deck-source parsing", () => {
  const visual = buildVisual({ title: "Embedded drift visual" });
  const contentJson = buildContentJson([
    buildHeadingNode(1, "Fixture title"),
    buildParagraphNode("Fixture paragraph."),
    buildListNode(["One", "Two"]),
    buildVisualLexicalNode("visual-fixture", visual),
  ]);

  const result = buildDeckSource(
    contentJson,
    buildVisualMap(["visual-fixture", visual]),
  );

  assert.equal(
    result.outline,
    "# Fixture title\nFixture paragraph.\n- One\n- Two\n[visual: visual-fixture]",
  );
  assert.deepEqual(
    result.visualInventory.map((item) => item.id),
    ["visual-fixture"],
  );
  assert.equal(result.truncated, false);
});

test("comment builders round-trip through comment anchor schema helpers", () => {
  const anchor = buildCommentAnchor({
    kind: "slide-element",
    slideId: "slide-fixture",
    elementId: "element-fixture",
    geometry: { x: 25, y: 75 },
  });
  const record = commentAnchorToRecord(anchor);

  assert.deepEqual(commentAnchorFromRecord(record), anchor);
  assert.deepEqual(validateAnchorGeometry(buildSlideCommentAnchor().geometry), {
    x: 25,
    y: 75,
  });
});

test("comment builders expose each supported anchor shape with clear defaults", () => {
  assert.deepEqual(buildCommentAnchor({ kind: "text" }), {
    kind: "text",
    text: "Selected text",
    nodeId: "node-fixture",
  });
  assert.deepEqual(buildCommentAnchor({ kind: "document-block" }), {
    kind: "document-block",
    blockKind: "visual",
    text: "Fixture visual",
    nodeId: "visual-fixture",
  });
  assert.deepEqual(buildCommentAnchor({ kind: "slide" }), {
    kind: "slide",
    slideId: "slide-fixture",
    geometry: { x: 25, y: 75 },
  });
  assert.deepEqual(buildCommentAnchor(), { kind: "deck" });

  const thread = builders.buildCommentThread({
    id: "comment-thread-fixture",
    anchorType: "visual",
    anchorText: "Slide selection",
    anchorNodeId: "slide-fixture",
    replies: [builders.buildCommentNode({ id: "reply-fixture" })],
  });

  assert.equal(thread.id, "comment-thread-fixture");
  assert.equal(thread.anchorType, "visual");
  assert.equal(thread.anchorText, "Slide selection");
  assert.equal(thread.anchorNodeId, "slide-fixture");
  assert.equal(thread.replies[0]?.id, "reply-fixture");
});

test("asset builders satisfy slide asset policy and storage key schema", () => {
  const bytes = fixturePngBuffer();
  const meta = buildFixtureAssetMeta();
  const policyResult = validateAssetUploadPolicy(
    SLIDE_ASSET_UPLOAD_POLICY,
    meta.mimeType,
    meta.originalName ?? "fixture.png",
    bytes.byteLength,
  );

  assert.equal(policyResult.ok, true);
  assert.equal(
    deriveStorageKey("doc-fixture", meta.checksum, meta.mimeType),
    `doc-fixture/${meta.checksum}.png`,
  );
});

test("shared builder entry point re-exports stable fixture helpers", () => {
  builders.resetCommandCounter();
  const command = builders.makeVisualCommand(
    { op: "visual.set_style", patch: { background: "#101010" } },
    { id: "visual-command-fixture" },
  );

  assert.equal(command.id, "visual-command-fixture");
  assert.equal(command.actor, builders.FIXTURE_COMMAND_ACTOR);
  assert.equal(command.target.documentId, "doc-1");

  assert.equal(
    builders.buildAssetRecord({
      id: "asset-record-fixture",
      workspaceId: "workspace-fixture",
      brandId: "brand-fixture",
      byteSize: 123,
      widthPx: 10,
      heightPx: 20,
      checksum: "checksum-fixture",
      mimeType: "image/png",
      originalName: "asset-fixture.png",
      createdAt: new Date("2026-06-26T00:00:00.000Z"),
      deletedAt: new Date("2026-06-27T00:00:00.000Z"),
    }).storageKey,
    "doc-fixture/checksum-fixture.png",
  );

  assert.equal(builders.buildCommentAuthor().name, "Fixture Author");
  assert.equal(builders.buildCommentAnchorRecord().anchorType, null);
  assert.equal(builders.buildElementBox({ w: 10 }).w, 10);
  assert.equal(builders.buildTextStyle({ color: "#ffffff" }).color, "#ffffff");
  assert.equal(builders.buildTextNode("Fixture").text, "Fixture");
  assert.equal(builders.FORMAT_BOLD, 1);
  assert.equal(builders.FORMAT_ITALIC, 2);
  assert.equal(builders.FORMAT_CODE, 16);
  assert.equal(
    builders.buildVisualStyle({ background: "#ffffff" }).background,
    "#ffffff",
  );
  assert.equal(builders.buildVisualNode({ value: 42 }).value, 42);
  assert.equal(builders.buildQuoteNode("Fixture quote").type, "quote");
  assert.equal(builders.buildHorizontalRuleNode().type, "horizontalrule");
  assert.equal(
    builders.buildListNode(["One"], { listType: "number" }).tag,
    "ol",
  );
  assert.equal(
    builders.buildContentJson().includes("Fixture paragraph."),
    true,
  );
  assert.equal(builders.buildEditorState().root.children.length, 1);
  assert.equal(builders.buildE2EProfileContentJson().root.children.length, 2);
  assert.equal(
    builders.buildE2EProfileFixtureDescriptor({
      assetId: "asset-fixture",
      assetPath: "/api/slide-assets/asset-fixture.png",
      privateAssetPath: "/api/slide-assets/private-asset-fixture.png",
      seededAt: "2026-06-25T00:00:00.000Z",
    }).assetId,
    "asset-fixture",
  );
  assert.equal(builders.E2E_PROFILE_FIXTURE.viewer.name, "E2E Viewer");
  assert.equal(builders.E2E_PROFILE_FIXTURE.owner.plan, "free");
  assert.equal(builders.E2E_PROFILE_FIXTURE.editor.plan, "pro");
  assert.equal(builders.E2E_PROFILE_FIXTURE.viewer.plan, "free");
  assert.equal(builders.E2E_PROFILE_FIXTURE.billingLifecycle.plan, "free");
  assert.equal(
    builders.E2E_PROFILE_FIXTURE.brandWorkflow.fontFamily,
    "'source-sans-3-latin-400-normal', sans-serif",
  );
  assert.equal(builders.e2eProfileAssetChecksum(), e2eProfileAssetChecksum());
  assert.equal(
    e2eProfile.fixtureAssetChecksum(e2eProfile.fixturePngBuffer()),
    e2eProfile.e2eProfileAssetChecksum(),
  );
  assert.equal(
    e2eProfile.E2E_PROFILE_FIXTURE.viewer.password,
    "e2e-viewer-pw-2026",
  );
  assert.equal(
    builders
      .buildVisualMap(["visual-fixture", builders.buildVisual()])
      .has("visual-fixture"),
    true,
  );
  assert.equal(typeof builders.deckExportTestHelpers.applyDeckOp, "function");
});

test("deck builders honor explicit optional overrides", () => {
  const source = builders.buildSourceRef({
    contentHash: undefined,
    unlinked: true,
  });
  assert.equal("contentHash" in source, false);
  assert.equal(source.unlinked, true);

  const text = builders.buildTextElement({
    id: "text-with-overrides",
    runs: [{ text: "Styled", bold: true }],
    content: {
      kind: "text",
      text: "Styled",
      paragraphs: [{ text: "Styled" }],
      runs: [{ text: "Styled", bold: true }],
      fitMode: "shrink-to-fit",
      bulletGap: 1,
      bulletIndent: 2,
    },
    style: {
      underline: true,
      verticalAlign: "middle",
      lineHeight: 1.2,
      paragraphSpacing: 0.5,
      color: "#abcdef",
      fontId: "font-fixture",
    },
    source,
    opacity: 0.8,
    rotation: 15,
    shadow: true,
    locked: true,
    hidden: true,
    name: "Text with overrides",
    groupId: "group-fixture",
  });
  assert.equal(text.id, "text-with-overrides");
  assert.equal(text.content.fitMode, "shrink-to-fit");
  assert.equal(text.designOverrides?.textStyle?.underline, true);

  const bullets = builders.buildBulletsElement({
    bullets: ["Alpha", "Beta"],
    itemRuns: [[{ text: "Alpha", italic: true }]],
    content: { kind: "text", text: "Alpha\nBeta", fitMode: "shrink-to-fit" },
    opacity: 0.9,
    rotation: 5,
    locked: true,
    hidden: true,
    name: "Bullet overrides",
    groupId: "group-fixture",
  });
  assert.equal(bullets.content.paragraphs?.[0]?.runs?.[0]?.italic, true);
  assert.equal(bullets.content.fitMode, "shrink-to-fit");
  assert.equal(builders.buildBulletsElement().kind, "text");

  const visualElement = builders.buildVisualElement({
    styleThemeId: "theme-fixture",
    alt: "Visual description",
    source,
    opacity: 0.7,
    rotation: 10,
    locked: true,
    hidden: true,
    name: "Visual overrides",
    groupId: "group-fixture",
  });
  assert.equal(visualElement.content.styleThemeId, "theme-fixture");
  assert.equal(visualElement.content.alt, "Visual description");

  const image = builders.buildImageElement({
    assetId: "asset-fixture",
    alt: "Image description",
    crop: { top: 0.1, right: 0.2, bottom: 0.3, left: 0.4 },
    fitMode: "cover",
    maskShape: "circle",
    radius: 8,
    source,
    opacity: 0.6,
    rotation: 20,
    shadow: true,
    locked: true,
    hidden: true,
    name: "Image overrides",
    groupId: "group-fixture",
  });
  assert.equal(image.content.assetId, "asset-fixture");
  assert.equal(image.designOverrides?.fitMode, "cover");

  const shape = builders.buildShapeElement({
    text: "Shape label",
    textRuns: [{ text: "Shape label", bold: true }],
    textStyle: { bold: true },
    stroke: { color: "#222222", width: 2 },
    radius: 4,
    source,
    opacity: 0.5,
    rotation: 30,
    shadow: true,
    locked: true,
    hidden: true,
    name: "Shape overrides",
    groupId: "group-fixture",
  });
  assert.equal(shape.content.text, "Shape label");
  assert.equal(shape.designOverrides?.radius, 4);

  const connector = builders.buildConnectorElement({
    routing: "elbow",
    stroke: { color: "#333333", width: 2 },
    arrowStart: "arrow",
    arrowEnd: "arrow",
    dash: true,
    opacity: 0.4,
    source,
  });
  assert.equal(connector.content.routing, "elbow");
  assert.equal(connector.designOverrides?.dash, true);
  assert.deepEqual(builders.buildConnectorElement().content.start, {
    x: 10,
    y: 20,
  });

  assert.equal(
    builders.buildPlaceholderElement({ label: "Title placeholder" }).label,
    "Title placeholder",
  );
  const deckWithElement = builders.buildDeck({
    design: { themeId: "indigo" },
    slides: [
      builders.buildSlide({
        designOverrides: { accent: { value: "#abcdef" } },
        elements: [text],
      }),
    ],
  });
  assert.equal(
    "value" in (deckWithElement.slides[0]?.designOverrides?.accent ?? {}),
    true,
  );
  assert.equal(
    builders.makeSlideWithElementIds("slide-minimal", ["text-1"]).elements?.[0]
      ?.id,
    "text-1",
  );
  assert.equal(builders.makeMinimalSlide("slide-empty", 2, "Empty").index, 2);
  assert.equal(
    builders.makeMinimalDeck([builders.makeMinimalSlide("slide-a", 0, "A")])
      .slides.length,
    1,
  );
  assert.deepEqual(
    builders
      .makeDeckFromIds(["slide-a", "slide-b"])
      .slides.map((slide) => slide.title),
    ["Slide 1", "Slide 2"],
  );
});

test("visual builders preserve optional metadata overrides", () => {
  const edge = builders.buildVisualEdge({
    directed: true,
    label: "Edge label",
    style: "curved",
  });
  const visual = builders.buildVisual({
    aspectRatio: "16:9",
    canvasStyle: "dot-grid",
    sourceText: "source fixture",
    sourceTextHash: "hash-fixture",
    autoLayout: true,
    effects: [{ kind: "shadow", dx: 1 }],
    edges: [edge],
  });

  assert.equal(visual.edges[0]?.directed, true);
  assert.equal(visual.aspectRatio, "16:9");
  assert.equal(visual.canvasStyle, "dot-grid");
  assert.equal(visual.sourceTextHash, "hash-fixture");
  assert.equal(visual.autoLayout, true);
  assert.equal(visual.effects?.[0]?.kind, "shadow");
});

test("lexical list builder preserves explicit container overrides", () => {
  const item = buildListItemNode("Custom item", {
    bid: "item-block",
    direction: null,
    format: "",
    indent: 2,
    value: 3,
  });
  const list = buildListNode(["Ignored"], {
    bid: "list-block",
    children: [item],
    direction: null,
    format: "",
    indent: 1,
    listType: "number",
    start: 3,
    tag: "ol",
    version: 2,
  });

  assert.equal(list.bid, "list-block");
  assert.equal(list.children[0], item);
  assert.equal(list.indent, 1);
  assert.equal(list.start, 3);
  assert.equal(list.version, 2);
});

test("skip helper delegates conditional skips to the node test context", () => {
  const skipped: Array<string | undefined> = [];
  const fakeContext = {
    skip: (message?: string) => skipped.push(message),
  };

  skipIf(fakeContext as never, false, "not skipped");
  skipIf(fakeContext as never, true, "fixture unavailable");

  assert.deepEqual(skipped, ["fixture unavailable"]);
});

test("E2E profile builders are the seed/spec single source of truth", () => {
  const visual = buildE2EProfileVisual();
  assert.equal(safeParseVisual(visual).success, true);

  const contentJson = buildE2EProfileContentJson(visual);
  assert.equal(contentJson.root.children.length, 2);
  const profileBody = contentJson.root.children[0];
  assert.equal(profileBody?.type, "paragraph");
  if (profileBody?.type === "paragraph") {
    assert.equal(
      profileBody.bid,
      e2eProfile.E2E_PROFILE_FIXTURE.documentBodyBlockId,
    );
  }

  const storageKey = deriveStorageKey(
    "e2efixturedocument0000001",
    e2eProfileAssetChecksum(),
    "image/png",
  );
  const deck = buildE2EProfileDeck(
    `/api/slide-assets/${storageKey}`,
    "asset-1",
  );
  assert.equal(safeParsePresentationDeck(deck).success, true);
  const opened = openDeckFromJson(deck);
  assert.equal(opened.ok, true);
  assert.equal(deck.slides.length, 2);

  const sourceLinkedDeck = buildE2ESourceLinkedDeck(
    `/api/slide-assets/${storageKey}`,
    "asset-1",
    "document-source-1",
  );
  assert.equal(safeParsePresentationDeck(sourceLinkedDeck).success, true);
  assert.deepEqual(sourceLinkedDeck.slides[0]?.children[0]?.source, {
    documentId: "document-source-1",
    blockId: e2eProfile.E2E_PROFILE_FIXTURE.documentBodyBlockId,
    blockKind: "text",
    linkedAt: "2026-01-01T00:00:00.000Z",
    display: {
      documentTitle: e2eProfile.E2E_PROFILE_FIXTURE.documentTitle,
      blockLabel: e2eProfile.E2E_PROFILE_FIXTURE.documentBodyText,
      blockKindLabel: "Text",
    },
  });

  const slideTwoTitleNode = deck.slides[1].children.find(
    (child): child is TextNode =>
      child.type === "text" && child.role === "title",
  );
  const slideTwoTitle = slideTwoTitleNode?.content.paragraphs[0]?.text ?? "";
  assert.equal(slideTwoTitle, e2eProfile.E2E_PROFILE_FIXTURE.slideTwoTitleText);
});
