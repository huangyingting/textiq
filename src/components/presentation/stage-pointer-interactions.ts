export function isHTMLElementTarget(
  target: EventTarget | null,
): target is HTMLElement {
  return typeof HTMLElement !== "undefined" && target instanceof HTMLElement;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!isHTMLElementTarget(target)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, button, [contenteditable="true"], [role="textbox"]',
    ),
  );
}

export function isStageHandleTarget(target: EventTarget | null): boolean {
  if (!isHTMLElementTarget(target)) return false;
  return Boolean(
    target.closest(
      "[data-node-id],[data-resize-handle],[data-crop-handle],[data-rotation-handle],[data-connector-endpoint],[data-multi-selection-bounds]",
    ),
  );
}

export function isStageEditingHandleTarget(
  target: EventTarget | null,
): boolean {
  if (!isHTMLElementTarget(target)) return false;
  return Boolean(
    target.closest(
      "[data-resize-handle],[data-crop-handle],[data-rotation-handle],[data-connector-endpoint]",
    ),
  );
}

export function nextSemanticSelectUnderNodeId(
  candidateIds: readonly string[],
  selectedIds: ReadonlySet<string>,
): string | null {
  if (candidateIds.length === 0) return null;
  const selectedIndex = candidateIds.findIndex((id) => selectedIds.has(id));
  return candidateIds[(selectedIndex + 1) % candidateIds.length] ?? null;
}

export function canvasRectFromEvent(event: {
  currentTarget: EventTarget | null;
}): DOMRect | undefined {
  const target = event.currentTarget;
  if (!isHTMLElementTarget(target)) return undefined;
  return target.closest('[data-slide-canvas="true"]')?.getBoundingClientRect();
}

export function canvasElementFromTarget(
  target: EventTarget | null,
): HTMLElement | null {
  if (!isHTMLElementTarget(target)) return null;
  return target.closest('[data-slide-canvas="true"]');
}

export function pointPctFromEvent(
  event: { clientX: number; clientY: number },
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
): { x: number; y: number } {
  return {
    x: Math.max(
      0,
      Math.min(100, ((event.clientX - rect.left) / rect.width) * 100),
    ),
    y: Math.max(
      0,
      Math.min(100, ((event.clientY - rect.top) / rect.height) * 100),
    ),
  };
}

export function pointerMovedBeyondThreshold({
  startX,
  startY,
  nextX,
  nextY,
  thresholdPx,
}: {
  startX: number;
  startY: number;
  nextX: number;
  nextY: number;
  thresholdPx: number;
}): boolean {
  return (
    Math.abs(nextX - startX) > thresholdPx ||
    Math.abs(nextY - startY) > thresholdPx
  );
}

export function shouldEnterInlineNodeEditOnClick({
  mode,
  moved,
  wasPrimarySelected,
  selectedCount,
  isInlineEditable,
  locked,
}: {
  mode: string;
  moved: boolean;
  wasPrimarySelected: boolean;
  selectedCount: number;
  isInlineEditable: boolean;
  locked?: boolean;
}): boolean {
  return (
    mode === "move" &&
    !moved &&
    wasPrimarySelected &&
    selectedCount === 1 &&
    isInlineEditable &&
    locked !== true
  );
}
