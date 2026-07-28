import type { ComponentSpotlightPhase } from "./worldTypes";

export interface ComponentSpotlightSequence {
  targetId: string | null;
  focusToken: number;
  phase: ComponentSpotlightPhase | null;
}

export const EMPTY_COMPONENT_SPOTLIGHT: ComponentSpotlightSequence =
  Object.freeze({
    targetId: null,
    focusToken: 0,
    phase: null,
  });

/** Every spotlight instance starts with only the selected component visible. */
export function beginComponentSpotlight(
  targetId: string,
  focusToken: number,
): ComponentSpotlightSequence {
  return {
    targetId,
    focusToken,
    phase: "solo-introduction",
  };
}

/**
 * Advances only the exact spotlight instance that requested the narration.
 * A delayed completion from A therefore cannot advance B, or a reopened A.
 */
export function advanceComponentSpotlight(
  current: ComponentSpotlightSequence,
  targetId: string,
  focusToken: number,
): ComponentSpotlightSequence {
  if (
    current.targetId !== targetId ||
    current.focusToken !== focusToken ||
    current.phase !== "solo-introduction"
  ) {
    return current;
  }
  return {
    ...current,
    phase: "interaction-replay",
  };
}

export function dismissComponentSpotlight(
  current: ComponentSpotlightSequence,
): ComponentSpotlightSequence {
  if (current.targetId === null) return current;
  return {
    targetId: null,
    focusToken: current.focusToken,
    phase: null,
  };
}
