/** Follows a portaled listbox's labelled trigger back into its owning surface. */
export function containsFloatingTarget(
  container: HTMLElement | null,
  target: Node | null,
): boolean {
  if (!container) return false;
  const visited = new Set<Node>();
  let current = target;
  while (current && !visited.has(current)) {
    if (container.contains(current)) return true;
    visited.add(current);
    const element =
      current.nodeType === 1 ? (current as Element) : current.parentElement;
    const panel = element?.closest('[data-floating-panel="true"]');
    const triggerId = panel?.getAttribute("aria-labelledby");
    current = triggerId ? panel!.ownerDocument.getElementById(triggerId) : null;
  }
  return false;
}
