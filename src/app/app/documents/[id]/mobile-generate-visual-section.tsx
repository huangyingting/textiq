"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey, $isElementNode } from "lexical";
import { Sparkles } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { GeneratedCandidatesPanel } from "@/components/visual/generated-candidates-panel";
import { useEditorContext } from "@/lib/lexical/editor-context";
import { generateTargetForContext } from "@/lib/visual/generate";
import type { Visual } from "@/lib/visual/schema";

import { $createVisualNode } from "@/lib/lexical/visual-node";
import { useVisualGeneration } from "./use-visual-generation";

export function GenerateVisualSection() {
  const [editor] = useLexicalComposerContext();
  const ctx = useEditorContext();
  const target = useMemo(() => generateTargetForContext(ctx), [ctx]);
  const {
    status,
    error,
    creditError,
    generatedVisualsBySection,
    generate,
    setGeneratedVisualsBySection,
    stampGeneratedVisual,
  } = useVisualGeneration();
  const candidates = generatedVisualsBySection.ai ?? [];
  const generatedTargetRef = useRef<typeof target>(null);
  const [insertError, setInsertError] = useState<string | null>(null);

  const runGenerate = useCallback(async () => {
    if (!target) return;
    const requestTarget = target;
    generatedTargetRef.current = null;
    setInsertError(null);
    const result = await generate(requestTarget, { append: false });
    if (result.ok) {
      generatedTargetRef.current = requestTarget;
    }
  }, [generate, target]);

  const insertVisual = useCallback(
    (visual: Visual) => {
      const generatedTarget = generatedTargetRef.current;
      if (!generatedTarget) return;
      const toInsert = stampGeneratedVisual(visual);
      let inserted = false;
      editor.update(() => {
        const top = $getNodeByKey(generatedTarget.blockKey);
        if (top === null || !$isElementNode(top)) {
          return;
        }
        top.insertAfter($createVisualNode(toInsert));
        inserted = true;
      });
      if (!inserted) {
        setInsertError(
          "The source block changed. Generate the visual again to insert it.",
        );
        return;
      }
      generatedTargetRef.current = null;
      setInsertError(null);
      setGeneratedVisualsBySection({});
      editor.focus();
    },
    [editor, setGeneratedVisualsBySection, stampGeneratedVisual],
  );

  if (!target) return null;

  return (
    <div className="border-b border-[var(--ds-border-subtle,rgba(0,0,0,0.08))] p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ds-text-muted,#6f7d83)]">
        Turn text into a visual
      </p>

      <Button
        size="sm"
        variant="solid"
        leadingIcon={<Sparkles aria-hidden="true" className="h-3.5 w-3.5" />}
        onClick={() => void runGenerate()}
        disabled={status === "loading"}
        className="w-full"
      >
        {status === "loading"
          ? "Generating…"
          : candidates.length > 0
            ? "Regenerate"
            : "Generate visual"}
      </Button>

      <GeneratedCandidatesPanel
        candidates={candidates}
        status={status}
        error={insertError ?? error}
        creditError={insertError ? false : creditError}
        onRetry={() => void runGenerate()}
        onChooseCandidate={insertVisual}
      />
    </div>
  );
}
