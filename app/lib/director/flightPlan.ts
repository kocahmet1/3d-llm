/**
 * The demo flight plan: every timing, waypoint, and per-chamber treatment
 * for the competition video lives here, so pacing tweaks never touch the
 * controller's machinery.
 *
 * Target running time ≈ 2:30 before the custom-training finale's live
 * segment, which depends on the local trainer.
 */

/* ------------------------------------------------------------------ *
 * Global pacing
 * ------------------------------------------------------------------ */

export const PACING = {
  /** Settle time after capture starts before the camera moves. */
  preRollSeconds: 1.0,
  /** Hold on the opening spawn view (screenshot-1 framing). */
  roomHoldSeconds: 1.2,
  /** Walk-around from behind the desk to front-center. */
  roomOrbitSeconds: 4.2,
  /** Slow pan across the seven desk units, left to right. */
  roomPanSeconds: 2.8,
  /** Aim + approach toward the Data Preparation unit before the dive. */
  roomAimSeconds: 1.1,
  /** Hold at a unit's overlook after rising back into the room. */
  roomReturnHoldSeconds: 0.5,
  /** Glance + drift from the risen overlook toward the next unit. */
  roomGlanceSeconds: 1.15,
  /**
   * Driven duration of the WATCHED part of data preparation — the first
   * four stages (source → clean → split → vocabulary lookup).
   */
  dataPrepSeconds: 13,
  /** Data-prep progress at which the camera stops watching stage by stage. */
  dataPrepLeaveAt: 0.8,
  /** Quick sprint of the remaining stages before walking out. */
  dataPrepFinishSeconds: 0.8,
  /** A chamber's full process is compressed to this many seconds. */
  processSeconds: 4,
  /** Standard visit: leave once the process reaches the halfway mark. */
  standardDwellSeconds: 1.4,
  /** Blend time from tunnel-arrival pose into the visit pose. */
  entryTweenSeconds: 0.5,
  /**
   * Safety cap for one transit before the controller bails out. Generous:
   * a transit may fly through an intermediate chamber (e.g. 22 → 24).
   */
  transitTimeoutSeconds: 9,
  /** Spotlight hold when the voice guide is live (ask + answer window). */
  spotlightLiveSeconds: 10,
  /** Spotlight hold when the guide is offline (visual-only). */
  spotlightVisualSeconds: 6,
  /** Typing speed for the finale corpus, characters per second. */
  finaleTypeCharsPerSecond: 1_800,
  /**
   * Hard cap on the typing animation regardless of corpus size (folder
   * corpora can be large; the fill accelerates to fit).
   */
  finaleTypeMaxSeconds: 3,
  /** How long to watch the live training run before heading home. */
  finaleWatchSeconds: 8,
  /** Drift-and-hold on the machine room after returning for the ending. */
  endHomeSeconds: 2.4,
  /** End card hold before the recorder stops. */
  endCardSeconds: 4.0,
} as const;

/* ------------------------------------------------------------------ *
 * Machine-room choreography (room-local coordinates; walk height 1.62)
 * ------------------------------------------------------------------ */

export interface RoomWaypoint {
  /** Normalized time inside the orbit segment, 0..1, ascending. */
  at: number;
  x: number;
  y: number;
  z: number;
  /** Point the camera looks at (room-local). */
  lookX: number;
  lookY: number;
  lookZ: number;
}

/** Matches the app's spawn pose so the take opens exactly like the app. */
export const ROOM_SPAWN = {
  x: 4.55,
  y: 1.62,
  z: 3.35,
  yaw: 0.94,
  pitch: -0.2,
} as const;

/**
 * Behind-the-desk corner → sweep around the front → settle close to the
 * desk edge, low enough that the unit name labels fill the frame.
 */
export const ROOM_ORBIT: readonly RoomWaypoint[] = [
  { at: 0, x: 4.55, y: 1.62, z: 3.35, lookX: 0, lookY: 0.75, lookZ: 0 },
  { at: 0.32, x: 3.25, y: 1.5, z: 3.9, lookX: 0, lookY: 0.8, lookZ: 0 },
  { at: 0.64, x: 1.55, y: 1.4, z: 3.8, lookX: 0, lookY: 0.85, lookZ: -0.1 },
  { at: 1, x: 0, y: 1.32, z: 2.75, lookX: 0, lookY: 0.85, lookZ: -0.2 },
];

/** Pan across the desk units (front row runs x ≈ −1.65 … +1.6). */
export const ROOM_PAN = {
  from: { lookX: -1.9, lookY: 0.9, lookZ: 0 },
  to: { lookX: 1.9, lookY: 0.9, lookZ: 0 },
} as const;

/** Where the camera drifts while aiming at the Data Preparation unit. */
export const ROOM_AIM = {
  x: -1.35,
  y: 1.3,
  z: 2.25,
  lookX: -1.65,
  lookY: 0.85,
  lookZ: 0.35,
} as const;

/* ------------------------------------------------------------------ *
 * Data-preparation chamber watch (chamber-local coordinates)
 * ------------------------------------------------------------------ */

/** Stage anchor starts mirrored from DATA_PREP_STAGES in trainingTrace. */
export const DATA_PREP_STAGE_STARTS = [0, 0.16, 0.3, 0.48, 0.82, 0.94];

/**
 * The exhibits progress left → right; the camera trucks with them.
 * Positions are fractions of the chamber's half-extents so the same plan
 * survives future chamber resizing.
 */
export const DATA_PREP_TRACK = {
  /** Camera x as a fraction of (minX..maxX) mapped over stage progress. */
  xStartFraction: 0.24,
  xEndFraction: 0.76,
  /**
   * Standing depth as a fraction of (minZ..maxZ). 0.8 read too distant on
   * take 1, 0.55 too close on take 2 — 0.65 splits the difference.
   */
  zFraction: 0.65,
  yawStart: 0.32,
  yawEnd: -0.36,
  pitch: -0.02,
  /** Outro push-in toward the finished matrix, chamber units. */
  outroPush: 1.6,
} as const;

/* ------------------------------------------------------------------ *
 * Chamber visits
 * ------------------------------------------------------------------ */

export type ChoreoId =
  | "push" // slow forward drift, presenting look
  | "glide-left" // truck to the left flank, then close in on the exhibit
  | "arc-right" // push close, then a lateral arc to the right
  | "rise-overlook" // climb and tilt down over the exhibit landscape
  | "sweep-tilt" // side-to-side truck with a vertical look sweep
  | "orbit-behind" // circle all the way around and view the exhibits from behind
  | "extreme-close" // dolly all the way onto one matrix until it fills the frame
  | "hold"; // locked-off shot

export interface ChamberVisitSpec {
  station: number;
  /** Seconds spent inside before walking out. */
  dwell: number;
  choreo: ChoreoId;
  /**
   * Cap for the driven process during the visit. Standard stops feel like a
   * passing glance (leave mid-process); showcases run the full sequence.
   */
  processCap: number;
  /** Trigger the spotlight + voice-guide demo here. */
  spotlight?: boolean;
  /** Cycle the HUD panel Story → Structure → Math → Code during the dwell. */
  detailTour?: boolean;
}

const std = (station: number): ChamberVisitSpec => ({
  station,
  dwell: PACING.standardDwellSeconds,
  choreo: "push",
  processCap: 0.55,
});

const showcase = (
  station: number,
  choreo: ChoreoId,
  dwell = 4.8,
): ChamberVisitSpec => ({
  station,
  dwell,
  choreo,
  processCap: 1,
});

/**
 * The journey is four zooms (machine-room dives), two dwelled chambers
 * each — the video shows the desk-miniature ↔ full-size relationship four
 * times instead of walking all 25 stations:
 *
 *   1. Data Preparation → chambers 1 + 2
 *   2. Transformer Tower → chambers 6 + 7 (the dive lands in 5 and flies
 *      straight through — "into the tower's internals")
 *   3. Backprop Return  → chambers 19 + 20 (guide spotlight at 19)
 *   4. AdamW Optimizer  → chambers 22 + 24 (fly-through of 23)
 *
 * The two signature moves stay in the shown set: extreme-close in Block 0,
 * orbit-behind in the Multi-Head Attention Hall — back to back inside the
 * tower.
 */
export interface FlightLeg {
  /** Station whose desk unit receives the glance + dive. */
  diveStation: number;
  label: string;
  visits: readonly ChamberVisitSpec[];
}

/** Tunnel continuation inside zoom one (the dive into 1 is the intro's). */
export const LEG_ONE_VISITS: readonly ChamberVisitSpec[] = [
  std(2), // Token Stream & Context Windows
];

export const DIVE_LEGS: readonly FlightLeg[] = [
  {
    diveStation: 5,
    label: "Transformer Tower",
    visits: [
      // Lands in the tower hall (5) and immediately flies on — reads as
      // diving into the tower and descending into its internals.
      showcase(6, "extreme-close", 4.6), // Block 0 — dolly onto one matrix
      showcase(7, "orbit-behind", 5.6), // Multi-Head Attention — circle to behind
    ],
  },
  {
    diveStation: 19,
    label: "Backprop Return",
    visits: [
      {
        // Backpropagation Through the Output — spotlight + ask-the-guide demo
        station: 19,
        dwell: PACING.standardDwellSeconds,
        choreo: "hold",
        processCap: 1,
        spotlight: true,
      },
      showcase(20, "sweep-tilt", 4.4), // Backprop Through the Tower
    ],
  },
  {
    diveStation: 22,
    label: "AdamW Optimizer",
    visits: [
      {
        // AdamW Optimizer State — the HUD cycles Story → Structure → Math →
        // Code here (the voiceover's "synchronized from the runnable
        // PyTorch trainer" beat).
        ...std(22),
        dwell: 3.8,
        processCap: 1,
        detailTour: true,
      },
      {
        // The Model Has Changed — closing beat (flies through 23 to get here)
        station: 24,
        dwell: 2.6,
        choreo: "hold",
        processCap: 1,
      },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Finale
 * ------------------------------------------------------------------ */

const FINALE_PASSAGE = `The little model started with random weights and no idea what a sentence was.
Every training step it read a small window of tokens and guessed the next one.
Every guess was scored, every error flowed backward, and every weight moved a tiny bit.
Step by step the guesses sharpened. That is all training is: one honest step, repeated.`;

/**
 * Fallback corpus only: the finale first fetches real text files from the
 * local folder served by /api/director/corpus and uses this passage when
 * that folder is unavailable.
 *
 * The local trainer holds out five percent of a one-document corpus for
 * validation, and both splits must contain at least contextLength + 1 bytes.
 * Repeating the short passage keeps the default 128-byte context valid.
 */
export const FINALE_CORPUS = Array.from(
  { length: 16 },
  () => FINALE_PASSAGE,
).join("\n\n");

export const END_CARD = {
  title: "Inside One Training Step",
  subtitle: "An explorable 3D world for how LLMs learn",
  credits: "Built with Codex · GPT-5.6 · a real local trainer",
} as const;

/* ------------------------------------------------------------------ *
 * Easing helpers shared by the controller
 * ------------------------------------------------------------------ */

export const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, value));

export const easeInOut = (t: number): number => {
  const clamped = clamp01(t);
  return clamped * clamped * (3 - 2 * clamped);
};

export const easeOut = (t: number): number => {
  const clamped = clamp01(t);
  return 1 - (1 - clamped) * (1 - clamped);
};

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

/** Piecewise progress through ascending stage anchors, eased per stage. */
export function stagedProgress(anchors: readonly number[], t: number): number {
  const clamped = clamp01(t);
  if (anchors.length < 2) return clamped;
  const span = 1 / (anchors.length - 1);
  const slot = Math.min(
    anchors.length - 2,
    Math.floor(clamped / span),
  );
  const local = (clamped - slot * span) / span;
  return lerp(anchors[slot], anchors[slot + 1], local);
}
