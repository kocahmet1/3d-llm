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
  /**
   * Depth a visitor walking in through the portal actually lands on. Normally
   * `chamberEntranceZ(maxZ)`, but a chamber may override it (the corpus hall
   * seats arrivals further in, at CORPUS_VIEW_Z). The director needs the real
   * value to reproduce the intro tour's landing spot exactly.
   */
  entryZ: number;
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

/** Room-local anchors of the custom-training console in the machine room. */
export interface DirectorConsoleAnchor {
  /** Standing spot in front of the cabinet — inside the proximity radius, so
   *  the "Train your own LLM" prompt wakes up while the camera holds here. */
  approachX: number;
  approachY: number;
  approachZ: number;
  /** Center of the console's screen face, i.e. what the camera should aim at. */
  screenX: number;
  screenY: number;
  screenZ: number;
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
  /**
   * Begin the zoom dive from the room into the unit that owns `station`.
   *
   * `landStation` lets the dive finish somewhere other than the unit's own
   * chamber. The orientation hall (station 0) is the reason it exists: it is
   * the prologue to the whole pipeline and owns no desk unit, so the camera
   * dives at the Data Preparation miniature and surfaces in the gallery.
   */
  startDive(station: number, landStation?: number): boolean;
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
  /**
   * Same spotlight, addressed by name instead of by aim: magnify the exhibit
   * registered as `targetId` in the current chamber. Lets the flight plan
   * highlight a specific matrix without having to park the camera so that the
   * crosshair happens to land on it. Returns false if the exhibit is not in
   * the chamber or is currently hidden.
   */
  spotlightTarget(targetId: string): boolean;
  releaseSpotlight(): void;
  /** Return to the machine-room spawn under manual control (flight reset). */
  resetToRoom(): void;
  /** Cinematic M-key equivalent: veil the chamber and rise to the room. */
  riseToRoom(): void;
  /** Current manual room pose, or null outside the machine room. */
  getRoomPose(): DirectorRoomPose | null;
  /** Anchors of the desk unit that owns `station` (for the glance + dive). */
  getUnitAnchor(station: number): DirectorUnitAnchor;
  /** Anchors of the custom-training console (for the closing panel beat). */
  getConsoleAnchor(): DirectorConsoleAnchor;
  /**
   * Open the custom-training panel, exactly as clicking the console screen
   * does — the same hidden link the in-world click drives, so the flight takes
   * the visitor's route rather than a private one. Returns false if the link
   * is not mounted.
   */
  openTrainingConsole(): boolean;
  /**
   * Compile every shader program and upload every texture in the world before
   * the camera moves.
   *
   * Only the chamber you are standing in is visible, so three.js never
   * compiles a chamber's programs until the frame it first appears. That is
   * invisible to a visitor — one hitch as you walk through a door — but a
   * flight crosses a dozen chambers, and each first sight would cost a stall
   * in the middle of a take. Paying for all of it up front, while the panel
   * still says "arming", is what keeps the recording at frame rate.
   */
  prewarm(): Promise<void>;
  /**
   * Render one device pixel per CSS pixel instead of following the display's
   * pixel ratio, and report the backing-store size so the recorder can capture
   * at exactly that resolution.
   *
   * A 2x display otherwise renders four times the pixels that end up in the
   * file. Matching the two makes the video a 1:1 read of the framebuffer —
   * sharper than an upscaled capture, for a quarter of the fragment work.
   */
  setCaptureSizing(active: boolean): DirectorSurfaceSize;
  getSurfaceSize(): DirectorSurfaceSize;
}

/** Canvas backing-store size in device pixels. */
export interface DirectorSurfaceSize {
  width: number;
  height: number;
}

export interface DirectorExperienceApi {
  setProgress(value: number): void;
  setPlaying(playing: boolean): void;
  setDataPrep(progress: number, playing: boolean): void;
  setDetailMode(mode: DetailMode): void;
  getVoice(): { enabled: boolean; status: AssistantCanvasStatus };
  /**
   * Presentation mode: hide the HUD's coaching cues for the duration of a
   * flight.
   *
   * "Left-click, then walk with WASD", "Aim at any station and scroll to move
   * in" and the machine-room prompts all exist to teach a visitor who has just
   * arrived. A flight arrives in ten chambers, so they fire over and over —
   * and in a demo video they are wrong anyway: nobody watching is about to
   * press anything.
   */
  setPresenting(active: boolean): void;
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
