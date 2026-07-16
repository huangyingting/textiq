"use client";

import { AnimatePresence, motion } from "framer-motion";

import { useGenerationStatus } from "@/lib/ai/use-generation-status";

import { resolveStatusMotion, resolveVisualSkeletonMotion } from "./presets";
import { ThinkingIndicator } from "./thinking-indicator";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * Drop-in replacement for `<ThinkingIndicator label="Generating…" />` that
 * cycles through descriptive stage labels and surfaces an ETA hint on the
 * first generation of the session.
 *
 * Reused across both call sites (block-spark + visual-context-popover) so
 * the staged-label behaviour stays consistent without duplication.
 */
export function GeneratingIndicator({
  isLoading,
  className = "",
}: {
  isLoading: boolean;
  className?: string;
}) {
  const { stageLabel, showEta, etaHint } = useGenerationStatus(isLoading);
  const motionPreset = resolveStatusMotion(Boolean(useReducedMotion()));

  return (
    <AnimatePresence>
      {isLoading ? (
        <motion.div
          key="generating"
          initial={motionPreset.initial}
          animate={motionPreset.animate}
          exit={motionPreset.exit}
          transition={motionPreset.transition}
          className={className}
        >
          <ThinkingIndicator label={stageLabel} />
          {showEta ? (
            <span className="mt-1.5 block text-[0.625rem] text-[var(--ds-text-muted,#a1a1aa)]">
              ETA {etaHint}
            </span>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * Visual-sized skeleton placeholder shown at the insert point while generation
 * is in flight.  Renders as a shimmer card matching the typical visual-card
 * aspect ratio so the document layout stabilises as soon as generation starts.
 *
 * Wrap in `<AnimatePresence>` at the call site if you need an exit animation.
 */
export function VisualSkeleton({ className = "" }: { className?: string }) {
  const motionPreset = resolveVisualSkeletonMotion(Boolean(useReducedMotion()));

  return (
    <motion.div
      key="visual-skeleton"
      initial={motionPreset.initial}
      animate={motionPreset.animate}
      exit={motionPreset.exit}
      transition={motionPreset.transition}
      aria-hidden="true"
      className={[
        "relative w-full overflow-hidden",
        "rounded-[var(--ds-radius-lg,14px)]",
        "border border-[var(--ds-border-subtle,rgba(0,0,0,0.06))]",
        "bg-[var(--ds-surface-raised,#f4f4f5)]",
        className,
      ].join(" ")}
      style={{ minHeight: 140 }}
    >
      {/* Shimmer rows that approximate a real visual card layout */}
      <div className="absolute inset-0 flex flex-col gap-3 p-4">
        <div className="h-3 w-2/3 animate-pulse rounded-full bg-[var(--ds-border-strong,rgba(0,0,0,0.10))] motion-reduce:animate-none" />
        <div className="h-2.5 w-1/2 animate-pulse rounded-full bg-[var(--ds-border-subtle,rgba(0,0,0,0.07))] motion-reduce:animate-none" />
        <div className="mt-2 flex flex-1 gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex-1 animate-pulse rounded-[var(--ds-radius-md,10px)] bg-[var(--ds-border-subtle,rgba(0,0,0,0.07))] motion-reduce:animate-none"
            />
          ))}
        </div>
        <div className="h-2 w-3/4 animate-pulse rounded-full bg-[var(--ds-border-subtle,rgba(0,0,0,0.07))] motion-reduce:animate-none" />
      </div>
    </motion.div>
  );
}
