/**
 * Inspector sub-components for the presentation slide editor.
 *
 * - {@link StyleBindingPanel}  — semantic role + style ref / variant selector.
 * - {@link LocalOverrideBadge} — override count badge with reset-to-theme action.
 * - {@link DiagnosticsPanel}   — structured diagnostics with spec action buttons.
 * - {@link SlideControlsPanel} — tone, density, emphasis, decoration, chrome controls.
 * - {@link SlideSettingsPanel} — slide name, notes, background, source controls.
 * - {@link DeckChromePanel}    — deck chrome and slide override controls.
 * - {@link NodeGeometryPanel}  — frame, rotation, z-index, lock, hidden controls.
 * - {@link NodeContentPanel}   — basic type-specific node content controls.
 * - {@link LocalStylePanel}    — local style patch editing controls.
 * - {@link NodeSourcePanel}    — source metadata controls.
 * - {@link LayersPanel}        — slide layer list controls.
 * - {@link EditorField}        — shared field, number, action, and menu primitives.
 * - {@link InspectorShell}     — tab strip + panel router for the full inspector.
 */

export { StyleBindingPanel } from "./style-binding-panel";
export type { StyleBindingPanelProps } from "./style-binding-panel";

export { LocalOverrideBadge } from "./local-override-badge";
export type { LocalOverrideBadgeProps } from "./local-override-badge";

export { DiagnosticsPanel } from "./diagnostics-panel";
export type { DiagnosticsPanelProps } from "./diagnostics-panel";

export { SlideControlsPanel } from "./slide-controls-panel";
export type { SlideControlsPanelProps } from "./slide-controls-panel";

export { SlideSettingsPanel } from "./slide-settings-panel";
export type { SlideSettingsPanelProps } from "./slide-settings-panel";

export { DeckChromePanel } from "./deck-chrome-panel";
export type { DeckChromePanelProps } from "./deck-chrome-panel";

export { NodeGeometryPanel } from "./node-geometry-panel";
export type { NodeGeometryPanelProps } from "./node-geometry-panel";

export { NodeContentPanel } from "./node-content-panel";
export type { NodeContentPanelProps } from "./node-content-panel";

export { LocalStylePanel } from "./local-style-panel";
export type { LocalStylePanelProps } from "./local-style-panel";

export { NodeSourcePanel } from "./node-source-panel";
export type { NodeSourcePanelProps } from "./node-source-panel";

export { LayersPanel } from "./layers-panel";
export type { LayersPanelProps } from "./layers-panel";

export {
  EditorActionButton,
  EditorActionMenu,
  EditorField,
  EditorNumberField,
  editorColorControlClass,
  editorControlClass,
  parseEditorNumberInput,
} from "./editor-primitives";
export type {
  EditorActionButtonProps,
  EditorActionDescriptor,
  EditorActionGroup,
  EditorActionMenuProps,
  EditorFieldProps,
  EditorNumberFieldProps,
} from "./editor-primitives";

export { InspectorShell } from "./inspector-shell";
export type { InspectorShellProps } from "./inspector-shell";
