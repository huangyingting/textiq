import type { Paragraph, TextContent } from "../schema";
import type { VnextPptxTextOp } from "../pptx-export-adapter";
import { effectToPptxShadow, type PptxSlide } from "./shared";

export type PptxTextRun = { text: string; options?: Record<string, unknown> };

const NUMBER_STYLE_TO_PPTX = {
  decimal: "arabicPeriod",
  "lower-alpha": "alphaLcPeriod",
  "upper-alpha": "alphaUcPeriod",
  "lower-roman": "romanLcPeriod",
} as const;

function clampIndentLevel(indent: number): number {
  return Math.max(0, Math.min(8, Math.trunc(indent)));
}

function applyParagraphOptions(
  para: Paragraph,
  runOptions: Record<string, unknown>,
): void {
  const { list } = para;
  if (!list) return;

  if (list.kind === "bullet") {
    runOptions.bullet = true;
  } else {
    runOptions.bullet = {
      type: "number",
      ...(list.numberStyle !== undefined
        ? { style: NUMBER_STYLE_TO_PPTX[list.numberStyle] }
        : {}),
    };
  }

  if (list.indent !== undefined) {
    runOptions.indentLevel = clampIndentLevel(list.indent);
  }
}

/**
 * Converts a v7 `TextContent` into PptxGenJS text runs.
 * Each paragraph maps to one or more runs; paragraphs are separated by
 * breakLine markers so PptxGenJS renders them as separate lines in one text box.
 */
export function textContentToPptxRuns(content: TextContent): PptxTextRun[] {
  const runs: PptxTextRun[] = [];
  const { paragraphs } = content;

  for (let i = 0; i < paragraphs.length; i++) {
    const para: Paragraph = paragraphs[i];
    const isLastPara = i === paragraphs.length - 1;

    if (para.runs && para.runs.length > 0) {
      for (let j = 0; j < para.runs.length; j++) {
        const run = para.runs[j];
        const isLastRunInPara = j === para.runs.length - 1;
        const runOptions: Record<string, unknown> = {};
        if (j === 0) applyParagraphOptions(para, runOptions);
        if (run.bold) runOptions.bold = true;
        if (run.italic) runOptions.italic = true;
        if (run.underline) runOptions.underline = { style: "sng" };
        if (run.strikethrough) runOptions.strike = true;
        if (run.localStyle?.color && typeof run.localStyle.color === "string") {
          const c = run.localStyle.color.startsWith("#")
            ? run.localStyle.color.slice(1).toUpperCase()
            : run.localStyle.color.toUpperCase();
          runOptions.color = c;
        }
        if (run.localStyle?.fontSizePt !== undefined) {
          runOptions.fontSize = run.localStyle.fontSizePt;
        }
        if (run.link) runOptions.hyperlink = { url: run.link };
        if (isLastRunInPara && !isLastPara) runOptions.breakLine = true;
        runs.push({
          text: run.text === "\n" ? "" : run.text,
          options: runOptions,
        });
      }
    } else {
      const runOptions: Record<string, unknown> = {};
      applyParagraphOptions(para, runOptions);
      if (!isLastPara) runOptions.breakLine = true;
      runs.push({ text: para.text, options: runOptions });
    }
  }
  return runs;
}

export function applyVnextTextOp(slide: PptxSlide, op: VnextPptxTextOp): void {
  const { x, y, w, h, content, textStyle, rotation } = op;
  const runs = textContentToPptxRuns(content);
  const shadow = effectToPptxShadow(op.effect);
  const shared: Record<string, unknown> = {
    x,
    y,
    w,
    h,
    wrap: true,
    ...(textStyle.color !== undefined ? { color: textStyle.color } : {}),
    ...(textStyle.fontSize !== undefined
      ? { fontSize: textStyle.fontSize }
      : {}),
    ...(textStyle.fontFace !== undefined
      ? { fontFace: textStyle.fontFace }
      : {}),
    ...(textStyle.bold ? { bold: true } : {}),
    ...(textStyle.italic ? { italic: true } : {}),
    ...(textStyle.underline ? { underline: { style: "sng" } } : {}),
    ...(textStyle.strikethrough ? { strike: true } : {}),
    ...(textStyle.align ? { align: textStyle.align } : {}),
    ...(textStyle.valign ? { valign: textStyle.valign } : {}),
    ...(textStyle.lineHeightMultiple !== undefined
      ? { lineSpacingMultiple: textStyle.lineHeightMultiple }
      : {}),
    ...(textStyle.paragraphSpacePt !== undefined
      ? { paraSpaceAfter: textStyle.paragraphSpacePt }
      : {}),
    ...(rotation !== undefined ? { rotate: rotation } : {}),
    ...(shadow !== undefined ? { shadow } : {}),
  };

  if (runs.length === 1 && Object.keys(runs[0].options ?? {}).length === 0) {
    slide.addText(runs[0].text, shared as Parameters<PptxSlide["addText"]>[1]);
  } else {
    slide.addText(
      runs as Parameters<PptxSlide["addText"]>[0],
      shared as Parameters<PptxSlide["addText"]>[1],
    );
  }
}
