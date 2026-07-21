import type * as THREE from "three";

export type AssistantState =
  | "follow"
  | "travel"
  | "present"
  | "listen"
  | "speak"
  | "point";

export interface AssistantAvatarOptions {
  /** Uniform visual scale. The unscaled avatar is roughly 2.3 world units tall. */
  scale?: number;
  primaryColor?: THREE.ColorRepresentation;
  accentColor?: THREE.ColorRepresentation;
  warmColor?: THREE.ColorRepresentation;
  reducedMotion?: boolean;
  /** Optional render/raycast layer for every object in the avatar hierarchy. */
  layer?: number;
}

export interface AssistantAvatarUpdate {
  deltaSeconds: number;
  elapsedSeconds: number;
  state: AssistantState;
  audioActivity?: number;
  pointTarget?: THREE.Vector3 | null;
  reducedMotion?: boolean;
}

export interface AssistantControllerOptions extends AssistantAvatarOptions {
  parent: THREE.Object3D;
  camera?: THREE.Camera;
  initialState?: AssistantState;
  /** Camera-local offset used while the assistant is following the visitor. */
  followOffset?: THREE.Vector3 | readonly [number, number, number];
  /** Distance from the selected exhibit while presenting. */
  presentationDistance?: number;
  /** Sideways offset from the camera-to-target line while presenting. */
  presentationSideOffset?: number;
  /** Height added to the selected component's world-space anchor. */
  presentationHeight?: number;
  /** Position damping in inverse seconds. */
  followResponsiveness?: number;
  /** Travel damping in inverse seconds. */
  travelResponsiveness?: number;
  /** Called for explicit and automatic state transitions. */
  onStateChange?: (state: AssistantState, previous: AssistantState) => void;
}

export interface AssistantControllerUpdate {
  deltaSeconds: number;
  elapsedSeconds: number;
  camera?: THREE.Camera;
  /** When supplied, updates the current frozen target. Pass null to clear it. */
  targetWorldPosition?: THREE.Vector3 | null;
  /** Normalized voice activity, where 0 is silent and 1 is loud speech. */
  audioActivity?: number;
}

export interface AssistantTravelOptions {
  arriveAs?: Exclude<AssistantState, "travel">;
  presentationDistance?: number;
  presentationSideOffset?: number;
  presentationHeight?: number;
}
