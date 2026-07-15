import type { TargetAndTransition, Transition } from "framer-motion";

import { DURATION, EASE } from "./tokens";

export type MotionPreset = {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
};

const NO_MOTION: MotionPreset = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 1 },
  transition: { duration: DURATION.instant },
};

export function resolvePopMotion(reducedMotion: boolean): MotionPreset {
  return reducedMotion
    ? NO_MOTION
    : {
        initial: { opacity: 0, scale: 0.96 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.96 },
        transition: { duration: DURATION.pop, ease: EASE.out },
      };
}

export function resolveCardMotion(reducedMotion: boolean): MotionPreset {
  return reducedMotion
    ? NO_MOTION
    : {
        initial: { opacity: 0, scale: 0.97 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.97 },
        transition: { duration: DURATION.card, ease: EASE.out },
      };
}

export function resolveStatusMotion(reducedMotion: boolean): MotionPreset {
  return reducedMotion
    ? NO_MOTION
    : {
        initial: { opacity: 0, y: 2 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -2 },
        transition: { duration: DURATION.status },
      };
}

export function resolveVisualSkeletonMotion(
  reducedMotion: boolean,
): MotionPreset {
  return reducedMotion
    ? NO_MOTION
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0, scale: 0.97 },
        transition: { duration: DURATION.card },
      };
}

export type OverlayMotionPresets = {
  backdrop: MotionPreset;
  modal: MotionPreset;
  drawer: MotionPreset;
  sheet: MotionPreset;
};

export function resolveOverlayMotion(
  reducedMotion: boolean,
): OverlayMotionPresets {
  if (reducedMotion) {
    return {
      backdrop: NO_MOTION,
      modal: NO_MOTION,
      drawer: NO_MOTION,
      sheet: NO_MOTION,
    };
  }

  return {
    backdrop: {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: DURATION.backdrop },
    },
    modal: {
      initial: { opacity: 0, scale: 0.98 },
      animate: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: 0.98 },
      transition: { duration: DURATION.modal, ease: EASE.out },
    },
    drawer: {
      initial: { x: "100%" },
      animate: { x: 0 },
      exit: { x: "100%" },
      transition: { duration: DURATION.drawer, ease: EASE.out },
    },
    sheet: {
      initial: { y: "100%" },
      animate: { opacity: 1, y: 0 },
      exit: { y: "100%" },
      transition: { duration: DURATION.sheet, ease: EASE.out },
    },
  };
}
