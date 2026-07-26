export type TrainingPhase =
  | "overview"
  | "data"
  | "forward"
  | "loss"
  | "backward"
  | "update";

export type DetailMode = "story" | "structure" | "math" | "code";
export type RideMode = "overview" | "explore";
export type BranchSide = "left" | "right";
export type NavigationMode =
  | "guided-ride"
  | "free-roam"
  | "tunnel"
  | "machine-room";
export type AssistantCanvasStatus =
  | "off"
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export interface MachineRoomCue {
  unitId: string;
  label: string;
  approaching: boolean;
}

/**
 * First-visit guided tour: "touring" while the scripted flow drives the
 * camera (any input hands control back), "handoff" right after the tour
 * releases the visitor, null otherwise.
 */
export type IntroTourState = "touring" | "handoff" | null;

export interface BranchChoice {
  left: string;
  right: string;
  default: BranchSide;
}

export interface TrainingStation {
  id: string;
  title: string;
  shortTitle: string;
  phase: TrainingPhase;
  zoomBand: number;
  breadcrumb: string[];
  story: string;
  structure: string;
  math: string;
  formula?: string;
  shape?: string;
  scaleLabel: string;
  branch?: BranchChoice;
  cameraHint: "wide" | "approach" | "inside" | "microscope" | "return";
}

export interface TrainingWorldState {
  progress: number;
  stationIndex: number;
  playing: boolean;
  rideMode: RideMode;
  detailMode: DetailMode;
  branchSide: BranchSide;
}

/**
 * Transport for the animation playing inside the chamber the visitor is
 * standing in — the matrices selecting rows, sliding together and summing.
 *
 * It used to run off the render loop's own wall clock, which meant it could
 * only ever loop: there was no way to hold a step still or step back to the
 * moment before two tensors merged. Owning the clock as state instead lets the
 * HUD scrub it, and lets the canvas freeze ambient motion while paused.
 */
export interface ChamberProcessTransport {
  /** Position through the current chamber's process animation, 0..1. */
  processProgress: number;
  processPlaying: boolean;
  onProcessProgressChange: (progress: number) => void;
  onProcessPlayingChange: (playing: boolean) => void;
}

export interface TrainingHUDProps
  extends TrainingWorldState,
    ChamberProcessTransport {
  stations: TrainingStation[];
  /**
   * Notches on the process dial: the number of steps the current chamber's
   * walk is divided into. Also how many lit thresholds the visitor crosses on
   * the runway, so the detents match the room.
   */
  processStops: number;
  /**
   * False where there is no chamber process to scrub — the machine room, the
   * connecting tunnels, and the guided ride, which drives the animation from
   * the camera's own position along the route.
   */
  processAvailable: boolean;
  navigationMode: NavigationMode;
  machineRoomCue: MachineRoomCue | null;
  movementDiscovered: boolean;
  introTour: IntroTourState;
  /**
   * Still read, though the corpus chamber no longer has a transport of its own:
   * the journey button waits for data preparation to finish before it will
   * carry the visitor onward. The dial drives that sequence now.
   */
  dataPrepProgress: number;
  onProgressChange: (progress: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onRideModeChange: (mode: RideMode) => void;
  onDetailModeChange: (mode: DetailMode) => void;
  onBranchChange: (side: BranchSide) => void;
  onRestart: () => void;
}

export interface TrainingCanvasProps extends ChamberProcessTransport {
  progress: number;
  stationIndex: number;
  playing: boolean;
  dataPrepProgress: number;
  branchSide: BranchSide;
  detailMode: DetailMode;
  rideMode: RideMode;
  assistantEnabled: boolean;
  assistantStatus: AssistantCanvasStatus;
  assistantAudioActivity: number;
  assistantTargetId: string | null;
  assistantTargetLocked: boolean;
  onProgressChange: (progress: number) => void;
  onManualNavigation: () => void;
  onNavigationModeChange: (mode: NavigationMode) => void;
  onMachineRoomCueChange: (cue: MachineRoomCue | null) => void;
  onMovementDiscovered: () => void;
  /** First-visit guided tour lifecycle (see IntroTourState). */
  onIntroTourChange?: (state: IntroTourState) => void;
  onStationChange: (index: number) => void;
  onAssistantTargetChange: (targetId: string | null) => void;
  /**
   * Fired when the visitor spotlights a component with the laser pointer
   * (left click while holding right click), or releases the spotlight (null).
   */
  onAssistantFocusChange?: (targetId: string | null) => void;
}
