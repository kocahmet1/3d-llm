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

export interface TrainingHUDProps extends TrainingWorldState {
  stations: TrainingStation[];
  navigationMode: NavigationMode;
  machineRoomCue: MachineRoomCue | null;
  movementDiscovered: boolean;
  introTour: IntroTourState;
  dataPrepProgress: number;
  dataPrepPlaying: boolean;
  onProgressChange: (progress: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onDataPrepProgressChange: (progress: number) => void;
  onDataPrepPlayingChange: (playing: boolean) => void;
  onDataPrepRestart: () => void;
  onRideModeChange: (mode: RideMode) => void;
  onDetailModeChange: (mode: DetailMode) => void;
  onBranchChange: (side: BranchSide) => void;
  onRestart: () => void;
}

export interface TrainingCanvasProps {
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
