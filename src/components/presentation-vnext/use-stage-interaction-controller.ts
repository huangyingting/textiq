import {
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { StageGuide } from "@/lib/presentation-vnext/stage-guides";
import type { SelectionFrame } from "@/lib/presentation-vnext/selection-geometry";

import type {
  ConnectorEndpointHandle,
  CropHandlePosition,
  ResizeHandlePosition,
  SlideCanvasNodeGestureDraft,
} from "./slide-canvas";
import type {
  ConnectorGestureDraft,
  CropGestureDraft,
  ResizeGestureDraft,
  RotationGestureDraft,
} from "./stage-gesture-feedback";
import type { KeyboardConnectorModeVNext } from "./stage-keyboard-interactions";

export type NodeMoveGestureDraft = ReadonlyMap<
  string,
  SlideCanvasNodeGestureDraft
>;

export interface ActiveResizeHandle {
  nodeId: string;
  handle: ResizeHandlePosition;
}

export interface ActiveCropHandle {
  nodeId: string;
  handle: CropHandlePosition;
}

export interface ActiveConnectorEndpoint {
  nodeId: string;
  endpoint: ConnectorEndpointHandle;
}

export interface StageInteractionState {
  stageGuides: StageGuide[];
  marqueeFrame: SelectionFrame | null;
  stageAnnouncement: string;
  keyboardConnectorMode: KeyboardConnectorModeVNext | null;
  hoveredNodeId: string | null;
  slideHovered: boolean;
  focusedNodeId: string | null;
  draggingStage: boolean;
  moveGestureDraft: NodeMoveGestureDraft | null;
  activeResizeHandle: ActiveResizeHandle | null;
  resizeGestureDraft: ResizeGestureDraft | null;
  activeCropHandle: ActiveCropHandle | null;
  cropGestureDraft: CropGestureDraft | null;
  activeRotationNodeId: string | null;
  rotationGestureDraft: RotationGestureDraft | null;
  activeConnectorEndpoint: ActiveConnectorEndpoint | null;
  connectorGestureDraft: ConnectorGestureDraft | null;
}

type StageInteractionSetter<K extends keyof StageInteractionState> = (
  value: SetStateAction<StageInteractionState[K]>,
) => void;

export interface StageInteractionController extends StageInteractionState {
  setStageGuides: StageInteractionSetter<"stageGuides">;
  setMarqueeFrame: StageInteractionSetter<"marqueeFrame">;
  setStageAnnouncement: StageInteractionSetter<"stageAnnouncement">;
  setKeyboardConnectorMode: StageInteractionSetter<"keyboardConnectorMode">;
  setHoveredNodeId: StageInteractionSetter<"hoveredNodeId">;
  setSlideHovered: StageInteractionSetter<"slideHovered">;
  setFocusedNodeId: StageInteractionSetter<"focusedNodeId">;
  setDraggingStage: StageInteractionSetter<"draggingStage">;
  setMoveGestureDraft: StageInteractionSetter<"moveGestureDraft">;
  setActiveResizeHandle: StageInteractionSetter<"activeResizeHandle">;
  setResizeGestureDraft: StageInteractionSetter<"resizeGestureDraft">;
  setActiveCropHandle: StageInteractionSetter<"activeCropHandle">;
  setCropGestureDraft: StageInteractionSetter<"cropGestureDraft">;
  setActiveRotationNodeId: StageInteractionSetter<"activeRotationNodeId">;
  setRotationGestureDraft: StageInteractionSetter<"rotationGestureDraft">;
  setActiveConnectorEndpoint: StageInteractionSetter<"activeConnectorEndpoint">;
  setConnectorGestureDraft: StageInteractionSetter<"connectorGestureDraft">;
  clearGestureDrafts: () => void;
  suppressNextStageClick: () => void;
  shouldSuppressStageClick: () => boolean;
}

type StageInteractionActions = Omit<
  StageInteractionController,
  | keyof StageInteractionState
  | "suppressNextStageClick"
  | "shouldSuppressStageClick"
>;

export const initialStageInteractionState: StageInteractionState = {
  stageGuides: [],
  marqueeFrame: null,
  stageAnnouncement: "",
  keyboardConnectorMode: null,
  hoveredNodeId: null,
  slideHovered: false,
  focusedNodeId: null,
  draggingStage: false,
  moveGestureDraft: null,
  activeResizeHandle: null,
  resizeGestureDraft: null,
  activeCropHandle: null,
  cropGestureDraft: null,
  activeRotationNodeId: null,
  rotationGestureDraft: null,
  activeConnectorEndpoint: null,
  connectorGestureDraft: null,
};

export type StageInteractionAction =
  | { type: "setStageGuides"; value: SetStateAction<StageGuide[]> }
  | {
      type: "setMarqueeFrame";
      value: SetStateAction<SelectionFrame | null>;
    }
  | { type: "setStageAnnouncement"; value: SetStateAction<string> }
  | {
      type: "setKeyboardConnectorMode";
      value: SetStateAction<KeyboardConnectorModeVNext | null>;
    }
  | { type: "setHoveredNodeId"; value: SetStateAction<string | null> }
  | { type: "setSlideHovered"; value: SetStateAction<boolean> }
  | { type: "setFocusedNodeId"; value: SetStateAction<string | null> }
  | { type: "setDraggingStage"; value: SetStateAction<boolean> }
  | {
      type: "setMoveGestureDraft";
      value: SetStateAction<NodeMoveGestureDraft | null>;
    }
  | {
      type: "setActiveResizeHandle";
      value: SetStateAction<ActiveResizeHandle | null>;
    }
  | {
      type: "setResizeGestureDraft";
      value: SetStateAction<ResizeGestureDraft | null>;
    }
  | {
      type: "setActiveCropHandle";
      value: SetStateAction<ActiveCropHandle | null>;
    }
  | {
      type: "setCropGestureDraft";
      value: SetStateAction<CropGestureDraft | null>;
    }
  | {
      type: "setActiveRotationNodeId";
      value: SetStateAction<string | null>;
    }
  | {
      type: "setRotationGestureDraft";
      value: SetStateAction<RotationGestureDraft | null>;
    }
  | {
      type: "setActiveConnectorEndpoint";
      value: SetStateAction<ActiveConnectorEndpoint | null>;
    }
  | {
      type: "setConnectorGestureDraft";
      value: SetStateAction<ConnectorGestureDraft | null>;
    }
  | { type: "clearGestureDrafts" };

function resolveSetStateAction<T>(current: T, value: SetStateAction<T>): T {
  return typeof value === "function"
    ? (value as (current: T) => T)(current)
    : value;
}

function applyStateValue<K extends keyof StageInteractionState>(
  state: StageInteractionState,
  key: K,
  value: SetStateAction<StageInteractionState[K]>,
): StageInteractionState {
  const nextValue = resolveSetStateAction(state[key], value);
  if (Object.is(nextValue, state[key])) return state;
  return { ...state, [key]: nextValue };
}

function clearGestureDrafts(
  state: StageInteractionState,
): StageInteractionState {
  if (
    state.moveGestureDraft === null &&
    state.resizeGestureDraft === null &&
    state.cropGestureDraft === null &&
    state.rotationGestureDraft === null &&
    state.connectorGestureDraft === null
  ) {
    return state;
  }
  return {
    ...state,
    moveGestureDraft: null,
    resizeGestureDraft: null,
    cropGestureDraft: null,
    rotationGestureDraft: null,
    connectorGestureDraft: null,
  };
}

export function stageInteractionReducer(
  state: StageInteractionState,
  action: StageInteractionAction,
): StageInteractionState {
  switch (action.type) {
    case "setStageGuides":
      return applyStateValue(state, "stageGuides", action.value);
    case "setMarqueeFrame":
      return applyStateValue(state, "marqueeFrame", action.value);
    case "setStageAnnouncement":
      return applyStateValue(state, "stageAnnouncement", action.value);
    case "setKeyboardConnectorMode":
      return applyStateValue(state, "keyboardConnectorMode", action.value);
    case "setHoveredNodeId":
      return applyStateValue(state, "hoveredNodeId", action.value);
    case "setSlideHovered":
      return applyStateValue(state, "slideHovered", action.value);
    case "setFocusedNodeId":
      return applyStateValue(state, "focusedNodeId", action.value);
    case "setDraggingStage":
      return applyStateValue(state, "draggingStage", action.value);
    case "setMoveGestureDraft":
      return applyStateValue(state, "moveGestureDraft", action.value);
    case "setActiveResizeHandle":
      return applyStateValue(state, "activeResizeHandle", action.value);
    case "setResizeGestureDraft":
      return applyStateValue(state, "resizeGestureDraft", action.value);
    case "setActiveCropHandle":
      return applyStateValue(state, "activeCropHandle", action.value);
    case "setCropGestureDraft":
      return applyStateValue(state, "cropGestureDraft", action.value);
    case "setActiveRotationNodeId":
      return applyStateValue(state, "activeRotationNodeId", action.value);
    case "setRotationGestureDraft":
      return applyStateValue(state, "rotationGestureDraft", action.value);
    case "setActiveConnectorEndpoint":
      return applyStateValue(state, "activeConnectorEndpoint", action.value);
    case "setConnectorGestureDraft":
      return applyStateValue(state, "connectorGestureDraft", action.value);
    case "clearGestureDrafts":
      return clearGestureDrafts(state);
  }
}

function buildStageInteractionActions(
  dispatch: Dispatch<StageInteractionAction>,
): StageInteractionActions {
  return {
    setStageGuides: (value) => dispatch({ type: "setStageGuides", value }),
    setMarqueeFrame: (value) => dispatch({ type: "setMarqueeFrame", value }),
    setStageAnnouncement: (value) =>
      dispatch({ type: "setStageAnnouncement", value }),
    setKeyboardConnectorMode: (value) =>
      dispatch({ type: "setKeyboardConnectorMode", value }),
    setHoveredNodeId: (value) => dispatch({ type: "setHoveredNodeId", value }),
    setSlideHovered: (value) => dispatch({ type: "setSlideHovered", value }),
    setFocusedNodeId: (value) => dispatch({ type: "setFocusedNodeId", value }),
    setDraggingStage: (value) => dispatch({ type: "setDraggingStage", value }),
    setMoveGestureDraft: (value) =>
      dispatch({ type: "setMoveGestureDraft", value }),
    setActiveResizeHandle: (value) =>
      dispatch({ type: "setActiveResizeHandle", value }),
    setResizeGestureDraft: (value) =>
      dispatch({ type: "setResizeGestureDraft", value }),
    setActiveCropHandle: (value) =>
      dispatch({ type: "setActiveCropHandle", value }),
    setCropGestureDraft: (value) =>
      dispatch({ type: "setCropGestureDraft", value }),
    setActiveRotationNodeId: (value) =>
      dispatch({ type: "setActiveRotationNodeId", value }),
    setRotationGestureDraft: (value) =>
      dispatch({ type: "setRotationGestureDraft", value }),
    setActiveConnectorEndpoint: (value) =>
      dispatch({ type: "setActiveConnectorEndpoint", value }),
    setConnectorGestureDraft: (value) =>
      dispatch({ type: "setConnectorGestureDraft", value }),
    clearGestureDrafts: () => dispatch({ type: "clearGestureDrafts" }),
  };
}

export function useStageInteractionController(): StageInteractionController {
  const suppressStageClickRef = useRef(false);
  const [state, dispatch] = useReducer(
    stageInteractionReducer,
    initialStageInteractionState,
  );
  const actions = useMemo(
    () => buildStageInteractionActions(dispatch),
    [dispatch],
  );

  const clickSuppressionActions = useMemo(
    () => ({
      suppressNextStageClick: () => {
        suppressStageClickRef.current = true;
        window.setTimeout(() => {
          suppressStageClickRef.current = false;
        }, 0);
      },
      shouldSuppressStageClick: () => suppressStageClickRef.current,
    }),
    [],
  );

  return useMemo(
    () => ({ ...state, ...actions, ...clickSuppressionActions }),
    [actions, clickSuppressionActions, state],
  );
}
