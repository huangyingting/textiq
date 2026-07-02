export type PointerDragEndReason = "up" | "cancel";

export interface PointerDragLifecycleStartEvent {
  pointerId: number;
  currentTarget: EventTarget | null;
}

export interface PointerDragListenerTarget {
  addEventListener: (
    type: "pointermove" | "pointerup" | "pointercancel",
    listener: (event: PointerEvent) => void,
  ) => void;
  removeEventListener: (
    type: "pointermove" | "pointerup" | "pointercancel",
    listener: (event: PointerEvent) => void,
  ) => void;
}

export interface PointerDragLifecycleOptions {
  onMove: (event: PointerEvent) => void;
  onEnd?: (event: PointerEvent, reason: PointerDragEndReason) => void;
  listenerTarget?: PointerDragListenerTarget;
  includePointerCancel?: boolean;
}

interface PointerCaptureTarget {
  setPointerCapture: (pointerId: number) => void;
  releasePointerCapture: (pointerId: number) => void;
}

function defaultPointerDragListenerTarget(): PointerDragListenerTarget | null {
  return typeof window === "undefined" ? null : window;
}

function isPointerCaptureTarget(value: unknown): value is PointerCaptureTarget {
  return (
    typeof value === "object" &&
    value !== null &&
    "setPointerCapture" in value &&
    typeof value.setPointerCapture === "function" &&
    "releasePointerCapture" in value &&
    typeof value.releasePointerCapture === "function"
  );
}

export function startPointerDragLifecycle(
  startEvent: PointerDragLifecycleStartEvent,
  {
    onMove,
    onEnd,
    listenerTarget: providedListenerTarget,
    includePointerCancel = true,
  }: PointerDragLifecycleOptions,
): () => void {
  const listenerTarget =
    providedListenerTarget ?? defaultPointerDragListenerTarget();
  if (!listenerTarget) return () => undefined;
  const activeListenerTarget: PointerDragListenerTarget = listenerTarget;
  const { pointerId } = startEvent;
  const captureTarget = isPointerCaptureTarget(startEvent.currentTarget)
    ? startEvent.currentTarget
    : null;
  if (captureTarget && Number.isFinite(pointerId)) {
    try {
      captureTarget.setPointerCapture(pointerId);
    } catch {
      // No-op: pointer capture can fail when the pointer already changed targets.
    }
  }

  let stopped = false;

  function releasePointerCapture() {
    if (captureTarget && Number.isFinite(pointerId)) {
      try {
        captureTarget.releasePointerCapture(pointerId);
      } catch {
        // No-op: capture can already be released by the browser.
      }
    }
  }

  function stop(event?: PointerEvent, reason?: PointerDragEndReason) {
    if (stopped) return;
    stopped = true;
    activeListenerTarget.removeEventListener("pointermove", handlePointerMove);
    activeListenerTarget.removeEventListener("pointerup", handlePointerUp);
    if (includePointerCancel) {
      activeListenerTarget.removeEventListener(
        "pointercancel",
        handlePointerCancel,
      );
    }
    releasePointerCapture();
    if (event && reason) {
      onEnd?.(event, reason);
    }
  }

  function handlePointerMove(event: PointerEvent) {
    if (stopped) return;
    onMove(event);
  }

  function handlePointerUp(event: PointerEvent) {
    stop(event, "up");
  }

  function handlePointerCancel(event: PointerEvent) {
    stop(event, "cancel");
  }

  activeListenerTarget.addEventListener("pointermove", handlePointerMove);
  activeListenerTarget.addEventListener("pointerup", handlePointerUp);
  if (includePointerCancel) {
    activeListenerTarget.addEventListener("pointercancel", handlePointerCancel);
  }

  return stop;
}
