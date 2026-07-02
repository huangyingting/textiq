/**
 * Stable style cascade facade.
 *
 * R39 keeps the public resolver names stable while splitting layer and text
 * resolvers into focused pure modules.
 */

export {
  STYLE_CASCADE_LAYERS,
  resolveDeckTokenSet,
  resolveMaster,
  resolveSlideStyle,
  resolveSlideTokenSet,
  resolveSlideThemeColors,
} from "./style-cascade-layers";
export type {
  ResolvedSlideStyle,
  SlideThemeColors,
} from "./style-cascade-layers";

export {
  resolveRoleTextStyle,
  resolveTextElementStyle,
  resolveShapeLabelStyle,
} from "./style-cascade-text";
export type {
  StyleOrigin,
  TextStyleField,
  ResolvedTextStyle,
} from "./style-cascade-text";
