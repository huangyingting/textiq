/**
 * `src/components/ui/` — the shared design-system primitives consumed by the
 * editor's contextual surfaces. All consume the `--ds-*` token layer.
 */
export { Button, IconButton } from "./button";
export { ActionButton } from "./action-button";
export type { ActionButtonProps, ActionIconButtonProps } from "./action-button";

export {
  Card,
  EmptyState,
  FieldRow,
  FormField,
  IconActionCluster,
  Kbd,
  MenuItem,
  PanelSurface,
  PopoverSection,
  StatusPill,
  ToolbarButton,
  ToolbarMenuItem,
} from "./chrome";
export type {
  CardProps,
  EmptyStateProps,
  FieldRowProps,
  FormFieldProps,
  IconActionClusterProps,
  MenuItemProps,
  PanelSurfaceProps,
  PopoverSectionProps,
  StatusPillProps,
  StatusPillTone,
  ToolbarButtonProps,
  ToolbarButtonShape,
  ToolbarButtonSize,
  ToolbarButtonTone,
  ToolbarMenuItemProps,
} from "./chrome";

export { ColorPicker, DEFAULT_SWATCH_PRESETS } from "./color-picker";

export { Divider } from "./divider";

export { Dialog } from "./dialog";
export {
  BottomSheetSurface,
  DrawerSurface,
  ModalSurface,
  OverlayProvider,
} from "./overlay-stack";

export { FloatingSurface } from "./floating-surface";

export { SegmentedControl } from "./segmented-control";
export type { SegmentedOption } from "./segmented-control";

export { SelectMenu } from "./select-menu";
export type { SelectMenuOption } from "./select-menu";

export { Surface } from "./surface";

export { Tabs } from "./tabs";
export type { TabOption } from "./tabs";

export { Swatch } from "./swatch";
export type { SwatchSize } from "./swatch";

export { Tooltip } from "./tooltip";

export { Popover } from "./popover";

export {
  cx,
  CONTROL_TRANSITION,
  EMPTY_STATE_CHROME,
  FIELD_CONTROL,
  FOCUS_RING,
  GUTTER_BUTTON,
  MENU_CHROME,
  MENU_ITEM,
  PANEL_CHROME,
  TOOLBAR_BUTTON_CHROME,
  UI_LAYER,
} from "./tokens";
export type { UILayer } from "./tokens";
