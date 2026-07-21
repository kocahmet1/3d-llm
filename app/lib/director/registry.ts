/**
 * Director registry — the meeting point between the demo-flight controller
 * and the two React surfaces it drives.
 *
 * The 3D canvas registers a small imperative API (camera poses, dives,
 * tunnel keys, spotlight) from inside its render effect; the experience
 * component registers HUD-level setters (journey progress, data-prep
 * playback, voice status). The controller consumes both without either
 * component knowing the flight plan exists. Everything here is inert unless
 * the director panel arms a flight, so normal visitors never pay for it.
 */

import type { AssistantCanvasStatus, DetailMode } from "../worldTypes";

export interface DirectorBoundsSnapshot {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  walkY: number;
  spawnX: number;
  spawnY: number;
  spawnZ: number;
  portalCenterX: number;
}

export interface DirectorCanvasState {
  region: "machine-room" | "chamber" | "tunnel";
  station: number;
  /** True while a machine-room dive/rise/reveal owns the veil or camera. */
  transitioning: boolean;
  focusActive: boolean;
}

export interface DirectorRoomPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** Room-local anchors of the desk unit that owns a station. */
export interface DirectorUnitAnchor {
  focusX: number;
  focusY: number;
  focusZ: number;
  overlookX: number;
  overlookY: number;
  overlookZ: number;
}

export interface DirectorCanvasApi {
  getState(): DirectorCanvasState;
  getBounds(station: number): DirectorBoundsSnapshot;
  /** Manual machine-room pose (local room coordinates). */
  setRoomPose(
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    immediate?: boolean,
  ): void;
  /** Begin the zoom dive from the room into the unit that owns `station`. */
  startDive(station: number): boolean;
  /** Absolute free-roam pose in a chamber's local coordinates. */
  poseChamber(
    station: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    immediate?: boolean,
  ): void;
  /** Hold or release movement keys exactly like the visitor would. */
  press(codes: string[]): void;
  release(codes?: string[]): void;
  /** Right-click-at-crosshair equivalent: magnify whatever is centered. */
  spotlightCenter(): boolean;
  releaseSpotlight(): void;
  /** Return to the machine-room spawn under manual control (flight reset). */
  resetToRoom(): void;
  /** Cinematic M-key equivalent: veil the chamber and rise to the room. */
  riseToRoom(): void;
  /** Current manual room pose, or null outside the machine room. */
  getRoomPose(): DirectorRoomPose | null;
  /** Anchors of the desk unit that owns `station` (for the glance + dive). */
  getUnitAnchor(station: number): DirectorUnitAnchor;
}

export interface DirectorExperienceApi {
  setProgress(value: number): void;
  setPlaying(playing: boolean): void;
  setDataPrep(progress: number, playing: boolean): void;
  setDetailMode(mode: DetailMode): void;
  getVoice(): { enabled: boolean; status: AssistantCanvasStatus };
}

let canvasApi: DirectorCanvasApi | null = null;
let experienceApi: DirectorExperienceApi | null = null;
/** True while a flight owns the camera; guards the app's auto-behaviors. */
let driving = false;
/**
 * When non-null, the current chamber's process playback progress (0..1) is
 * pinned to this value instead of the free-running ambient cycle. The value
 * survives tunnel transits on purpose: the chamber behind the camera keeps
 * its frozen state instead of snapping to unrelated cycle timing.
 */
let processOverride: number | null = null;

export function registerDirectorCanvas(api: DirectorCanvasApi): void {
  canvasApi = api;
}

export function unregisterDirectorCanvas(api: DirectorCanvasApi): void {
  if (canvasApi === api) canvasApi = null;
}

export function registerDirectorExperience(api: DirectorExperienceApi): void {
  experienceApi = api;
}

export function unregisterDirectorExperience(
  api: DirectorExperienceApi,
): void {
  if (experienceApi === api) experienceApi = null;
}

export function getDirectorCanvas(): DirectorCanvasApi | null {
  return canvasApi;
}

export function getDirectorExperience(): DirectorExperienceApi | null {
  return experienceApi;
}

export function setDirectorDriving(value: boolean): void {
  driving = value;
}

export function isDirectorDriving(): boolean {
  return driving;
}

export function setDirectorProcessOverride(value: number | null): void {
  processOverride =
    value === null ? null : Math.min(1, Math.max(0, value));
}

export function getDirectorProcessOverride(): number | null {
  return processOverride;
}
