"use client";

import { useState } from "react";

import {
  BulletGapControl,
  BulletIndentControl,
  FitModeControl,
  InheritedFontControl,
  LineHeightControl,
  ListTypeControl,
  ParagraphSpacingControl,
  RichTextBox,
  RoleSelectControl,
  VerticalAlignControl,
  defaultPresentationRole,
  presentationRoleValue,
} from "./controls";
import { PanelSection } from "./primitives";
import {
  HorizontalAlignControl,
  TextAdvancedStyleControl,
  TextEmphasisControl,
  TextInspectorTabs,
  TextPanelCardHeader,
  TextSizeColorControl,
  type TextInspectorTab,
} from "./text-style-controls";
import type { SlideInspectorProps } from "./types";
import {
  elementDesignOverrides,
  textContent,
  textDesign,
} from "@/components/presentation/slide-canvas/v6-model";
import type {
  Deck,
  Paragraph,
  Slide,
  SlideElement,
  TextElementStyle,
  TextRun,
} from "@/lib/presentation/deck";
import type { ElementPatch } from "@/lib/presentation/deck-mutations";
import { resolveRoleToken } from "@/lib/presentation/presentation-theme";
import {
  mergeRuns,
  runsToHtml,
  shouldStoreRuns,
  splitRunsIntoLines,
} from "@/lib/presentation/rich-text-html";
import { matchSlideFont } from "@/lib/presentation-shared/slide-fonts";
import { resolveSlideTokenSet } from "@/lib/presentation/style-cascade";
import { SLIDE_TEXT_FONT_SIZE } from "@/lib/presentation/text-defaults";

export function TextPanel({
  element,
  deck,
  slide,
  onUpdateElement,
}: {
  element: SlideElement | null;
  deck: Deck;
  slide: Slide;
  onUpdateElement: SlideInspectorProps["onUpdateElement"];
}) {
  const [activeTab, setActiveTab] = useState<TextInspectorTab>("style");
  if (!element) {
    return (
      <PanelSection>
        <p className="text-xs text-ds-text-muted">
          Select a text element to edit it.
        </p>
      </PanelSection>
    );
  }

  if (element.kind !== "text") {
    return (
      <PanelSection>
        <p className="text-xs text-ds-text-muted">
          Text settings are available for text elements.
        </p>
      </PanelSection>
    );
  }

  const textElement = element;
  const currentText = textContent(textElement);
  const style = {
    fontSize: SLIDE_TEXT_FONT_SIZE.text,
    bold: false,
    italic: false,
    align: "left" as const,
    ...textDesign(textElement),
  };
  const updateStyle = (next: TextElementStyle) => {
    onUpdateElement(textElement.id, {
      designOverrides: {
        ...elementDesignOverrides(textElement),
        textStyle: next,
      },
    } as ElementPatch);
  };
  const resetStyle = () => {
    const currentFontSize = textDesign(textElement).fontSize;
    const { textStyle: _discarded, ...nextDesign } =
      elementDesignOverrides(textElement);
    onUpdateElement(textElement.id, {
      designOverrides:
        currentFontSize === undefined
          ? nextDesign
          : { ...nextDesign, textStyle: { fontSize: currentFontSize } },
    } as ElementPatch);
  };
  const resetParagraph = () => {
    const nextStyle = { ...textDesign(textElement) };
    delete nextStyle.align;
    delete nextStyle.lineHeight;
    delete nextStyle.verticalAlign;
    delete nextStyle.paragraphSpacing;
    const { textStyle: _discarded, ...baseDesign } =
      elementDesignOverrides(textElement);
    onUpdateElement(textElement.id, {
      designOverrides:
        Object.keys(nextStyle).length > 0
          ? { ...baseDesign, textStyle: nextStyle }
          : baseDesign,
      content: {
        ...currentText,
        kind: "text",
        fitMode: undefined,
        bulletGap: undefined,
        bulletIndent: undefined,
      },
    } as ElementPatch);
  };

  const role = defaultPresentationRole(textElement);
  const tokenSet = resolveSlideTokenSet(deck, slide);
  const roleToken = resolveRoleToken(tokenSet, role);
  const inheritedColor = roleToken.color;
  const inheritedFontLabel =
    matchSlideFont(roleToken.fontFamily ?? tokenSet.typography.fontFamily)
      ?.label ?? "theme font";

  const hasList = currentText.paragraphs.some(
    (paragraph) => paragraph.listType !== undefined,
  );
  const contentHtml = hasList
    ? currentText.paragraphs
        .map(
          (paragraph) =>
            `<div>${runsToHtml(paragraph.runs, paragraph.text)}</div>`,
        )
        .join("")
    : runsToHtml(currentText.runs, currentText.text);

  function updateTextContent(
    { text, runs }: { text: string; runs: TextRun[] },
    coalesceKey?: string,
  ) {
    if (hasList) {
      const lines = splitRunsIntoLines(runs)
        .map((line) => ({
          text: line.text.replace(/\s+$/, ""),
          runs: mergeRuns(line.runs),
        }))
        .filter((line) => line.text.length > 0);
      const paragraphs: Paragraph[] = lines.map((line, index) => {
        const previous =
          currentText.paragraphs[index] ??
          currentText.paragraphs[currentText.paragraphs.length - 1];
        return {
          text: line.text,
          ...(shouldStoreRuns(line.runs) ? { runs: line.runs } : {}),
          indent: previous?.indent ?? 0,
          listType: previous?.listType ?? "bullet",
        };
      });
      onUpdateElement(
        textElement.id,
        {
          content: {
            ...currentText,
            kind: "text",
            text: paragraphs.map((paragraph) => paragraph.text).join("\n"),
            runs: undefined,
            paragraphs,
          },
        } as ElementPatch,
        coalesceKey,
      );
      return;
    }

    onUpdateElement(
      textElement.id,
      {
        content: {
          ...currentText,
          kind: "text",
          text,
          runs: shouldStoreRuns(runs) ? runs : undefined,
          paragraphs: [
            {
              text,
              ...(shouldStoreRuns(runs) ? { runs } : {}),
            },
          ],
        },
      } as ElementPatch,
      coalesceKey,
    );
  }

  function resetContentStyles() {
    onUpdateElement(textElement.id, {
      content: {
        ...currentText,
        kind: "text",
        runs: undefined,
        paragraphs: currentText.paragraphs.map((paragraph) => ({
          text: paragraph.text,
          ...(paragraph.indent !== undefined
            ? { indent: paragraph.indent }
            : {}),
          ...(paragraph.listType !== undefined
            ? { listType: paragraph.listType }
            : {}),
        })),
      },
    } as ElementPatch);
  }

  return (
    <PanelSection
      className={activeTab === "content" ? "min-h-0 flex-1 gap-1" : "gap-1"}
    >
      <TextInspectorTabs activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "content" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-ds-md bg-ds-surface-raised/60 p-2 ring-1 ring-ds-border-subtle">
          <div className="flex justify-end">
            <TextPanelCardHeader
              resetLabel="Reset content"
              onReset={resetContentStyles}
            />
          </div>
          <RichTextBox
            label="Text"
            placeholder="Add text"
            html={contentHtml}
            listMode={hasList}
            hideLabel
            fill
            onChange={updateTextContent}
          />
        </div>
      ) : null}

      {activeTab === "style" ? (
        <div className="flex flex-col gap-2 rounded-ds-md bg-ds-surface-raised/60 p-2 ring-1 ring-ds-border-subtle">
          <div className="flex justify-end">
            <TextPanelCardHeader
              resetLabel="Reset style"
              onReset={resetStyle}
            />
          </div>
          <RoleSelectControl
            element={element}
            onChange={(nextRole) =>
              onUpdateElement(element.id, {
                role: presentationRoleValue(nextRole),
              } as ElementPatch)
            }
          />
          <TextEmphasisControl style={style} onChange={updateStyle} />
          <TextSizeColorControl
            style={style}
            inheritedColor={inheritedColor}
            onChange={updateStyle}
          />
          <TextAdvancedStyleControl style={style} onChange={updateStyle} />
          <InheritedFontControl
            style={style}
            inheritedLabel={inheritedFontLabel}
            showReset={false}
            onChange={updateStyle}
          />
        </div>
      ) : null}

      {activeTab === "paragraph" ? (
        <div className="flex flex-col gap-2 rounded-ds-md bg-ds-surface-raised/60 p-2 ring-1 ring-ds-border-subtle">
          <div className="flex justify-end">
            <TextPanelCardHeader
              resetLabel="Reset paragraph"
              onReset={resetParagraph}
            />
          </div>
          <HorizontalAlignControl style={style} onChange={updateStyle} />
          <LineHeightControl style={style} onChange={updateStyle} />
          <ParagraphSpacingControl style={style} onChange={updateStyle} />
          <VerticalAlignControl style={style} onChange={updateStyle} />
          <FitModeControl
            fitMode={currentText.fitMode}
            onChange={(fitMode) =>
              onUpdateElement(element.id, {
                content: {
                  ...currentText,
                  kind: "text",
                  fitMode,
                },
              } as ElementPatch)
            }
          />
          {hasList ? (
            <>
              <ListTypeControl
                element={element}
                onChange={(patch) => onUpdateElement(element.id, patch)}
              />
              <BulletIndentControl
                element={element}
                onChange={(patch) => onUpdateElement(element.id, patch)}
              />
              <BulletGapControl
                element={element}
                onChange={(patch) => onUpdateElement(element.id, patch)}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </PanelSection>
  );
}
