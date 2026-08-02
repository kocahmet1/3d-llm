/**
 * The demo flight plan: every timing, waypoint, and per-chamber treatment
 * for the competition video lives here, so pacing tweaks never touch the
 * controller's machinery.
 *
 * The route, in four zooms and a closing beat:
 *
 *   1. Machine room overview → dive into the ORIENTATION gallery: read the
 *      first placard, then walk the length of the hall and out through the
 *      doorway on foot into the data wing — Corpus & Data Preparation, then
 *      Token Stream & Context.
 *   2. Transformer Tower → the tower hall, then Block 0, then the Multi-Head
 *      Attention Hall, where five of its weight matrices are spotlighted one
 *      at a time with the visitor's own right-click tool.
 *   3. Backprop Return → the output backprop hall, the tower backprop hall,
 *      then a sprint through everything remaining to the final chamber.
 *   4. Back in the machine room, straight to the custom-training console and
 *      into the panel itself, then out and done.
 *
 * Target running time ≈ 2:00.
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

  /* -- orientation gallery (the first zoom) -- */
  /** Walk from the dive landing to the first placard's reading mark. */
  orientationApproachSeconds: 2.2,
  /** Hold square-on to the first placard, reading it. */
  orientationPanelSeconds: 3,
  /**
   * Read the first placard, then walk the length of the hall and out.
   *
   * About 72 units from the reading mark to the threshold, so at the app's own
   * 12.75/s walk this is what a normal pace costs — no stopping, but no
   * skating either. The other four placards slide past on alternating sides on
   * the way, which is the tour: the room introduces itself while you leave it.
   * It ends slow and close to the door, which keeps transitTo's half-second
   * step to the portal from reading as a lurch.
   */
  orientationExitSeconds: 5.6,

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
  /**
   * Cap for an express transit, which deliberately runs through several
   * chambers without stopping. 20 → 24 crosses three halls of roughly 66
   * depth at the 22.5/s sprint plus four corridors at 39/s — about fourteen
   * seconds. The cap is loose on purpose: overrunning it snaps the camera.
   */
  expressTimeoutSeconds: 22,
  /** Spotlight hold when the voice guide is live (ask + answer window). */
  spotlightLiveSeconds: 10,
  /** Spotlight hold when the guide is offline (visual-only). */
  spotlightVisualSeconds: 6,

  /* -- named highlights (the right-click tool, driven by target id) -- *
   *
   * Paced like a person using it, not like a slideshow: the beam fires, the
   * exhibit rises and holds for a beat, it drops, the chamber comes back, and
   * only then does the beam pick the next one. Swapping straight from one to
   * the next is faster but reads as a machine cycling through a list.
   */
  /** Settle before the first exhibit is lifted onto the magnified stage. */
  highlightLeadSeconds: 0.6,
  /** How long each highlighted component holds the stage. */
  highlightSeconds: 1,
  /**
   * Gap after one drops before the beam picks the next. Matched to the
   * canvas's own 0.45s laser flash so the rhythm is the tool's, not ours.
   */
  highlightGapSeconds: 0.45,
  /** Beat after the last one is released, before walking on. */
  highlightReleaseSeconds: 0.5,

  /* -- closing beat at the custom-training console -- */
  /** Cross to the console. Brisk: the beat is the panel, not the walk. */
  consoleApproachSeconds: 1.4,
  /** Wait for the Custom Training chamber to mount after opening it. */
  consoleOpenTimeoutSeconds: 8,
  /** Hold on the real panel, open. */
  consolePanelSeconds: 2.5,
  /** Let the world rebuild after coming back before the closing hold. */
  consoleReturnSettleSeconds: 0.8,

  /** Hold on the machine room after returning, then the end card. */
  endHomeSeconds: 1,
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

/**
 * Where the camera drifts while aiming at the Data Preparation unit — the
 * leftmost desk unit, and the miniature the opening dive drops through on its
 * way to the orientation gallery.
 */
export const ROOM_AIM = {
  x: -1.35,
  y: 1.3,
  z: 2.25,
  lookX: -1.65,
  lookY: 0.85,
  lookZ: 0.35,
} as const;

/**
 * The gallery has no desk miniature of its own — it is the prologue to the
 * whole machine rather than one of its seven stages. The opening dive
 * therefore aims at this unit's station and lands in the hall instead.
 */
export const OPENING_DIVE = { aimStation: 1, landStation: 0 } as const;

/* ------------------------------------------------------------------ *
 * Orientation gallery (chamber-local coordinates)
 *
 * A processional hall, 64 x 84, five paper-white placards in bays that
 * alternate left and right down a wide central promenade. Everything below
 * mirrors the bay geometry in components/chambers/orientationGallery.ts:
 * bays sit at x = ∓23.5, y = 2.2, z = 27, 12.5, −2, −16.5, −31 (left first),
 * each with a reading mark 8.5 downstream and 8.5 off the centre line. The
 * doorway to the data wing is the far wall at z ≈ −41.
 * ------------------------------------------------------------------ */

export const ORIENTATION = {
  /**
   * Reading mark for the first placard, square-on and close enough that the
   * page fills the frame. Mirrors ORIENTATION_TOUR_STOPS[0].
   */
  panel: {
    x: -8.5,
    y: 1.9,
    z: 35.5,
    lookX: -23.5,
    lookY: 2.2,
    lookZ: 27,
  },
  /**
   * Facing the doorway from a little back, so the opening and the invitation
   * sign above it share the frame before the walk-out. Mirrors
   * ORIENTATION_EXIT_EYE_Z / ORIENTATION_EXIT_LOOK.
   */
  exit: {
    x: 0,
    y: 1.9,
    z: -27,
    lookX: 0,
    lookY: 1.5,
    lookZ: -40.5,
  },
  /**
   * The threshold itself. The walk-out carries on past the framing mark to
   * here and slows, so the camera is already at the door when the transit
   * hands over to the app's own portal and tunnel.
   */
  doorway: { x: 0, z: -36 },
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
  | "hold" // locked-off shot
  | "landing"; // rooted on the arrival mark, exactly where a visitor lands

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
  /** Trigger the aim-based spotlight + voice-guide demo here. */
  spotlight?: boolean;
  /** Cycle the HUD panel Story → Structure → Math → Code during the dwell. */
  detailTour?: boolean;
  /**
   * Assistant target ids to lift onto the magnified stage in turn once the
   * dwell is over — the same tool a visitor drives by right-clicking, but
   * addressed by name so the camera can stay put.
   */
  highlights?: readonly string[];
  /**
   * Drive the data-preparation transport across the dwell instead of the
   * generic chamber process. Only station 1 has one.
   */
  dataPrep?: boolean;
  /**
   * Reach this chamber by sprinting through every chamber in between rather
   * than stopping at each. Buys a longer transit budget.
   */
  express?: boolean;
}

/**
 * A rooted stop: land where a visitor walking in lands, and stay there. Used
 * for the beats whose whole point is the arrival itself.
 */
const stop = (station: number, dwell: number): ChamberVisitSpec => ({
  station,
  dwell,
  choreo: "landing",
  processCap: 1,
});

/**
 * The five exhibits lifted onto the magnified stage in the Multi-Head
 * Attention Hall, in the order attention computes them: the normalized input
 * that arrives, the three weight matrices it is multiplied by, and the split
 * that hands the results to the heads.
 *
 * The hall is the right room for this — these are the actual weight walls, so
 * "highlighting the matrices" means something literal here in a way it does
 * not one chamber earlier.
 */
export const ATTENTION_HIGHLIGHTS: readonly string[] = [
  "mha:normalized-input",
  "mha:query-projection",
  "mha:key-projection",
  "mha:value-projection",
  "mha:head-split",
];

export interface FlightLeg {
  /** Station whose desk unit receives the glance + dive. */
  diveStation: number;
  label: string;
  visits: readonly ChamberVisitSpec[];
}

/**
 * Zoom one continues on foot out of the gallery and down the data wing. The
 * camera walks these; it never rides the HUD.
 */
export const OPENING_VISITS: readonly ChamberVisitSpec[] = [
  // Corpus & Data Preparation — the exhibits run while the camera holds the
  // arrival mark, which is exactly where the first-time visitor tour lands.
  { ...stop(1, 4), dataPrep: true },
  // Token Stream & Context Windows.
  stop(2, 3),
];

export const DIVE_LEGS: readonly FlightLeg[] = [
  {
    diveStation: 5,
    label: "Transformer Tower",
    visits: [
      // The tower hall itself — the dive lands here.
      stop(5, 4),
      // Inside Transformer Block 0 — a look at the block's shape, no more.
      { station: 6, dwell: 3, choreo: "push", processCap: 1 },
      // Multi-Head Attention Hall. A short dwell to take the room in, then
      // the highlight sweep across its weight matrices, which is the beat.
      {
        station: 7,
        dwell: 2.5,
        choreo: "push",
        processCap: 1,
        highlights: ATTENTION_HIGHLIGHTS,
      },
    ],
  },
  {
    diveStation: 19,
    label: "Backprop Return",
    visits: [
      // Backpropagation Through the Output — the dive lands here.
      stop(19, 4),
      // Backprop Through the Tower.
      { station: 20, dwell: 3, choreo: "sweep-tilt", processCap: 1 },
      // Then straight on to the end of the line, sprinting through the
      // parameter matrix, the optimizer state, and the weight update without
      // stopping: the return leg accelerating to the finish.
      { ...stop(24, 2), express: true },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Finale
 * ------------------------------------------------------------------ */

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
