export type SlideEditorButtonView = {
  showOpenDialog: boolean;
  showAiPreview: boolean;
  showEditor: boolean;
  showRecovery: boolean;
};

export function resolveSlideEditorButtonView({
  aiEnabled,
  pendingJson,
  aiPreview,
  open,
  deck,
  deckOpenError,
}: {
  aiEnabled: boolean;
  pendingJson: string | null;
  aiPreview: unknown | null;
  open: boolean;
  deck: unknown | null;
  deckOpenError: unknown | null;
}): SlideEditorButtonView {
  return {
    showOpenDialog: aiEnabled && Boolean(pendingJson) && !open,
    showAiPreview: aiPreview !== null && !open,
    showEditor: open && deck !== null,
    showRecovery: open && deck === null && deckOpenError !== null,
  };
}
