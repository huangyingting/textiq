export const VISUAL_PICKER_FAILURE_MESSAGE =
  "Visual picker failed. Please try again.";

export type VisualPickerMutationResult = "picked" | "cancelled" | "failed";

export async function runVisualPickerMutation<TPick>({
  onPickVisual,
  onPicked,
}: {
  onPickVisual: () => Promise<TPick | undefined>;
  onPicked: (picked: TPick) => void;
}): Promise<VisualPickerMutationResult> {
  let picked: TPick | undefined;
  try {
    picked = await onPickVisual();
  } catch {
    return "failed";
  }

  if (picked === undefined) return "cancelled";
  onPicked(picked);
  return "picked";
}
