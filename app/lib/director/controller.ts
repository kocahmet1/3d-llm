/**
 * Director controller — runs the whole competition-video flight as one
 * generator-based coroutine ticked by its own requestAnimationFrame loop:
 *
 *   machine-room orbit → dive into the orientation gallery → read the first
 *   placard, walk the hall and out into the data wing → zoom into the
 *   Transformer Tower and spotlight five of the attention hall's weight
 *   matrices by name → zoom into the Backprop Return and sprint to the last
 *   chamber → home, into the custom-training panel, out, end card.
 *
 * The controller only talks to the app through the director registry, so it
 * never leaks into the normal visitor experience.
 */

import {
  getDirectorCanvas,
  getDirectorExperience,
  getDirectorProcessOverride,
  setDirectorDriving,
  setDirectorProcessOverride,
  type DirectorBoundsSnapshot,
  type DirectorCanvasApi,
  type DirectorExperienceApi,
} from "./registry";
import { downloadRecording, startDemoRecorder, type DemoRecorder } from "./recorder";
import {
  DIVE_LEGS,
  OPENING_DIVE,
  OPENING_VISITS,
  ORIENTATION,
  PACING,
  ROOM_AIM,
  ROOM_ORBIT,
  ROOM_PAN,
  ROOM_SPAWN,
  clamp01,
  easeInOut,
  easeOut,
  lerp,
  type ChamberVisitSpec,
  type ChoreoId,
} from "./flightPlan";

export type DirectorPhase =
  | "idle"
  | "arming"
  | "flying"
  | "finale"
  | "saving"
  | "done"
  | "aborted";

/**
 * Frame-rate health of the take. The flight is driven by elapsed time, so a
 * dropped frame never desynchronizes it — it just shows up as a jump in the
 * camera. That makes smoothness the one thing you cannot verify by watching
 * the labels, hence these numbers: fly once without recording, read them, and
 * only roll when they are clean.
 */
export interface DirectorFrameStats {
  averageFps: number;
  /** Frames per second implied by the single worst frame of the flight. */
  worstFps: number;
  /** Frames that took longer than one and a half display refreshes. */
  droppedFrames: number;
  totalFrames: number;
}

export interface DirectorStatus {
  phase: DirectorPhase;
  label: string;
  elapsedSeconds: number;
  recording: boolean;
  frames: DirectorFrameStats;
  /** Set once a take finishes, e.g. "1920x1080 · h264/mp4". */
  captureSummary: string;
}

export interface DirectorHooks {
  onStatus(status: DirectorStatus): void;
  showEndCard(visible: boolean): void;
  /**
   * Play the site's own title sequence over the opening. The overlay is
   * transparent, so it runs concurrently with the machine-room move rather
   * than in front of it, and costs the film no extra seconds.
   */
  showTitleCard(visible: boolean): void;
  /** Client-side route change (Next router) so the recording survives it. */
  navigate(path: string): void;
}

interface Ctx {
  dt: number;
  time: number;
  label: string;
}

type Flight = Generator<void, void, unknown>;

let hooks: DirectorHooks | null = null;
let flight: Flight | null = null;
let recorder: DemoRecorder | null = null;
let frameHandle = 0;
let lastFrameAt = 0;
let running = false;
const ctx: Ctx = { dt: 0, time: 0, label: "" };

const emptyFrameStats = (): DirectorFrameStats => ({
  averageFps: 0,
  worstFps: 0,
  droppedFrames: 0,
  totalFrames: 0,
});

const status: DirectorStatus = {
  phase: "idle",
  label: "",
  elapsedSeconds: 0,
  recording: false,
  frames: emptyFrameStats(),
  captureSummary: "",
};

/* -- frame accounting -------------------------------------------------- */

/** One and a half refreshes at 60Hz: anything slower skipped a frame. */
const DROPPED_FRAME_SECONDS = 0.025;
let worstFrameSeconds = 0;
let droppedFrames = 0;
let totalFrames = 0;

function resetFrameStats(): void {
  worstFrameSeconds = 0;
  droppedFrames = 0;
  totalFrames = 0;
  status.frames = emptyFrameStats();
}

function recordFrame(dt: number): void {
  totalFrames += 1;
  if (dt > worstFrameSeconds) worstFrameSeconds = dt;
  if (dt > DROPPED_FRAME_SECONDS) droppedFrames += 1;
}

function frameStats(): DirectorFrameStats {
  return {
    averageFps: ctx.time > 0 ? totalFrames / ctx.time : 0,
    worstFps: worstFrameSeconds > 0 ? 1 / worstFrameSeconds : 0,
    droppedFrames,
    totalFrames,
  };
}

/**
 * Status goes to React, and React re-renders the panel. At sixty frames a
 * second that is sixty renders a second of a component nobody is looking at
 * during a take — cost charged directly against the thing being measured.
 * Four updates a second is plenty for a label and a clock.
 */
const STATUS_INTERVAL_SECONDS = 0.25;
let lastPublishAt = -1;

function publish(phase?: DirectorPhase, label?: string): void {
  if (phase) status.phase = phase;
  if (label !== undefined) status.label = label;
  status.elapsedSeconds = ctx.time;
  status.frames = frameStats();
  lastPublishAt = ctx.time;
  hooks?.onStatus({ ...status });
}

/** Per-frame status write, coalesced so it cannot cost what it measures. */
function publishThrottled(label: string): void {
  if (
    label === status.label &&
    ctx.time - lastPublishAt < STATUS_INTERVAL_SECONDS
  ) {
    return;
  }
  publish(undefined, label);
}

export function setDirectorHooks(next: DirectorHooks | null): void {
  hooks = next;
  hooks?.onStatus({ ...status });
}

export function getDirectorStatus(): DirectorStatus {
  return { ...status };
}

/* ------------------------------------------------------------------ *
 * Small coroutine helpers
 * ------------------------------------------------------------------ */

function* wait(seconds: number): Flight {
  let t = 0;
  while (t < seconds) {
    t += ctx.dt;
    yield;
  }
}

/** Runs `frame(eased, raw)` every frame for `seconds`, ending exactly at 1. */
function* tween(
  seconds: number,
  frame: (eased: number, raw: number) => void,
): Flight {
  let t = 0;
  while (t < seconds) {
    t += ctx.dt;
    const raw = clamp01(t / seconds);
    frame(easeInOut(raw), raw);
    yield;
  }
  frame(1, 1);
}

function* waitUntil(
  condition: () => boolean,
  timeoutSeconds: number,
): Flight {
  let t = 0;
  while (!condition() && t < timeoutSeconds) {
    t += ctx.dt;
    yield;
  }
}

const yawPitchTowards = (
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toY: number,
  toZ: number,
): { yaw: number; pitch: number } => {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dz = toZ - fromZ;
  const flat = Math.max(1e-5, Math.hypot(dx, dz));
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.atan2(dy, flat),
  };
};

/** Shortest-arc angle blend so yaw sweeps never take the long way around. */
const blendAngle = (from: number, to: number, t: number): number => {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * t;
};

/* ------------------------------------------------------------------ *
 * Phase 1 — machine room
 * ------------------------------------------------------------------ */

function* roomIntro(canvas: DirectorCanvasApi): Flight {
  ctx.label = "Machine room · overview";

  canvas.setRoomPose(
    ROOM_SPAWN.x,
    ROOM_SPAWN.y,
    ROOM_SPAWN.z,
    ROOM_SPAWN.yaw,
    ROOM_SPAWN.pitch,
    true,
  );
  yield* wait(PACING.roomHoldSeconds);

  ctx.label = "Machine room · around the desk";
  yield* tween(PACING.roomOrbitSeconds, (eased) => {
    const points = ROOM_ORBIT;
    let slot = 0;
    while (slot < points.length - 2 && eased > points[slot + 1].at) slot += 1;
    const a = points[slot];
    const b = points[slot + 1];
    const span = Math.max(1e-5, b.at - a.at);
    const local = easeInOut(clamp01((eased - a.at) / span));
    const x = lerp(a.x, b.x, local);
    const y = lerp(a.y, b.y, local);
    const z = lerp(a.z, b.z, local);
    const lookX = lerp(a.lookX, b.lookX, local);
    const lookY = lerp(a.lookY, b.lookY, local);
    const lookZ = lerp(a.lookZ, b.lookZ, local);
    const aim = yawPitchTowards(x, y, z, lookX, lookY, lookZ);
    canvas.setRoomPose(x, y, z, aim.yaw, aim.pitch);
  });

  ctx.label = "Machine room · the seven chambers";
  const anchor = ROOM_ORBIT[ROOM_ORBIT.length - 1];
  yield* tween(PACING.roomPanSeconds, (eased) => {
    const lookX = lerp(ROOM_PAN.from.lookX, ROOM_PAN.to.lookX, eased);
    const lookY = lerp(ROOM_PAN.from.lookY, ROOM_PAN.to.lookY, eased);
    const lookZ = lerp(ROOM_PAN.from.lookZ, ROOM_PAN.to.lookZ, eased);
    const aim = yawPitchTowards(
      anchor.x,
      anchor.y,
      anchor.z,
      lookX,
      lookY,
      lookZ,
    );
    canvas.setRoomPose(anchor.x, anchor.y, anchor.z, aim.yaw, aim.pitch);
  });

  ctx.label = "Machine room · into the model";
  yield* tween(PACING.roomAimSeconds, (eased) => {
    const x = lerp(anchor.x, ROOM_AIM.x, eased);
    const y = lerp(anchor.y, ROOM_AIM.y, eased);
    const z = lerp(anchor.z, ROOM_AIM.z, eased);
    const aim = yawPitchTowards(
      x,
      y,
      z,
      ROOM_AIM.lookX,
      ROOM_AIM.lookY,
      ROOM_AIM.lookZ,
    );
    canvas.setRoomPose(x, y, z, aim.yaw, aim.pitch);
  });

  // Dive at the Data Preparation miniature but surface in the orientation
  // gallery: the hall is the prologue to the whole machine and owns no
  // miniature of its own.
  canvas.startDive(OPENING_DIVE.aimStation, OPENING_DIVE.landStation);
  yield* waitUntil(() => {
    const state = getDirectorCanvas()?.getState();
    return Boolean(
      state &&
        state.region === "chamber" &&
        state.station === OPENING_DIVE.landStation &&
        !state.transitioning,
    );
  }, 6);
}

/* ------------------------------------------------------------------ *
 * Phase 2 — the orientation gallery
 * ------------------------------------------------------------------ */

/**
 * Walk the placard hall: read the first panel square-on, then turn down the
 * promenade and walk out through the doorway into the data wing.
 *
 * There is no second stop. The remaining four placards pass on alternating
 * sides during the walk, which shows the room off better than standing still
 * and turning to look at them would — and costs the film nothing.
 *
 * The hall's own guided walk is suppressed while a flight is driving (see
 * TrainingWorldCanvas's galleryTourActive), so these poses own the camera.
 */
function* orientationVisit(canvas: DirectorCanvasApi): Flight {
  const station = OPENING_DIVE.landStation;
  const bounds = canvas.getBounds(station);

  /** A chamber pose that faces a point in the hall. */
  const facing = (
    x: number,
    y: number,
    z: number,
    lookX: number,
    lookY: number,
    lookZ: number,
  ): Pose => ({ x, y, z, ...yawPitchTowards(x, y, z, lookX, lookY, lookZ) });

  const landed: Pose = {
    x: bounds.spawnX,
    y: bounds.spawnY,
    z: bounds.spawnZ,
    yaw: 0,
    pitch: 0,
  };
  const panel = facing(
    ORIENTATION.panel.x,
    ORIENTATION.panel.y,
    ORIENTATION.panel.z,
    ORIENTATION.panel.lookX,
    ORIENTATION.panel.lookY,
    ORIENTATION.panel.lookZ,
  );

  ctx.label = "Orientation · walking in";
  yield* tween(PACING.orientationApproachSeconds, (eased) => {
    writePose(canvas, station, mixPose(landed, panel, eased));
  });

  ctx.label = "Orientation · the first panel";
  writePose(canvas, station, panel);
  yield* wait(PACING.orientationPanelSeconds);

  // Turn down the hall and walk out; transitTo takes over at the portal and
  // the app's own tunnel carries the camera through.
  const exit = facing(
    ORIENTATION.exit.x,
    ORIENTATION.exit.y,
    ORIENTATION.exit.z,
    ORIENTATION.exit.lookX,
    ORIENTATION.exit.lookY,
    ORIENTATION.exit.lookZ,
  );
  const doorway = facing(
    ORIENTATION.doorway.x,
    ORIENTATION.exit.y,
    ORIENTATION.doorway.z,
    ORIENTATION.exit.lookX,
    ORIENTATION.exit.lookY,
    ORIENTATION.exit.lookZ,
  );
  ctx.label = "Orientation · down the hall";
  yield* tween(PACING.orientationExitSeconds, (eased) => {
    // One eased ramp, split in two: turn off the placard and walk down to the
    // framing mark, then close the last stretch to the threshold. Both aims
    // face down the hall, so lerping yaw directly is the short way round.
    const pose =
      eased < 0.82
        ? mixPose(panel, exit, eased / 0.82)
        : mixPose(exit, doorway, (eased - 0.82) / 0.18);
    writePose(canvas, station, pose);
  });
}

/* ------------------------------------------------------------------ *
 * Phase 3 — chamber visits
 * ------------------------------------------------------------------ */

interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/**
 * Last chamber-local pose the director wrote — every segment tweens away
 * from this, so hand-offs (data-prep outro → transit, spotlight → transit)
 * never snap.
 */
let lastPose: Pose | null = null;

const writePose = (
  canvas: DirectorCanvasApi,
  station: number,
  pose: Pose,
  immediate = false,
): void => {
  canvas.poseChamber(
    station,
    pose.x,
    pose.y,
    pose.z,
    pose.yaw,
    pose.pitch,
    immediate,
  );
  lastPose = pose;
};

/**
 * Exactly where a visitor walking in through the portal ends up — the same
 * mark the first-time tour lands on. `entryZ` is the chamber's own answer
 * rather than a recomputed one, so halls that seat arrivals further in (the
 * corpus deck) are honoured.
 */
const arrivalPose = (bounds: DirectorBoundsSnapshot): Pose => ({
  x: bounds.portalCenterX,
  y: bounds.walkY,
  z: bounds.entryZ,
  yaw: 0,
  pitch: 0,
});

const mixPose = (a: Pose, b: Pose, t: number): Pose => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
  yaw: lerp(a.yaw, b.yaw, t),
  pitch: lerp(a.pitch, b.pitch, t),
});

/** Per-choreography camera path, normalized over the dwell. */
function choreoPose(
  choreo: ChoreoId,
  bounds: DirectorBoundsSnapshot,
  t: number,
): Pose {
  const spawn: Pose = {
    x: bounds.spawnX,
    y: bounds.walkY,
    z: bounds.spawnZ,
    yaw: 0,
    pitch: -0.02,
  };
  const eased = easeInOut(t);
  switch (choreo) {
    case "push":
      return {
        ...spawn,
        z: spawn.z - 1.15 * eased,
        yaw: Math.sin(t * Math.PI) * 0.06,
      };
    case "hold":
      return {
        ...spawn,
        z: spawn.z - 0.25 * eased,
        yaw: Math.sin(t * Math.PI * 2) * 0.02,
      };
    case "landing":
      // Rooted on the arrival mark. Nothing but a breath of head movement, so
      // the shot is the chamber as a visitor first meets it.
      return {
        x: bounds.portalCenterX,
        y: bounds.walkY,
        z: bounds.entryZ,
        yaw: Math.sin(t * Math.PI * 2) * 0.018,
        pitch: Math.sin(t * Math.PI) * 0.012,
      };
    case "glide-left": {
      // Truck to the left flank, then close in low over the exhibits.
      if (t < 0.5) {
        const local = easeInOut(t / 0.5);
        return mixPose(
          spawn,
          {
            x: bounds.minX + 1.7,
            y: bounds.walkY,
            z: spawn.z - 2.1,
            yaw: 0.52,
            pitch: -0.05,
          },
          local,
        );
      }
      const local = easeInOut((t - 0.5) / 0.5);
      return mixPose(
        {
          x: bounds.minX + 1.7,
          y: bounds.walkY,
          z: spawn.z - 2.1,
          yaw: 0.52,
          pitch: -0.05,
        },
        {
          x: bounds.minX * 0.3,
          y: bounds.walkY + 0.5,
          z: spawn.z - 3.3,
          yaw: 0.12,
          pitch: -0.16,
        },
        local,
      );
    }
    case "arc-right": {
      // Push close to the exhibit, then a lateral arc to the right.
      if (t < 0.42) {
        const local = easeInOut(t / 0.42);
        return mixPose(
          spawn,
          {
            x: spawn.x,
            y: bounds.walkY + 0.25,
            z: spawn.z - 3.1,
            yaw: 0,
            pitch: -0.08,
          },
          local,
        );
      }
      const local = easeInOut((t - 0.42) / 0.58);
      const x = lerp(spawn.x, spawn.x + 2.5, local);
      return {
        x,
        y: bounds.walkY + 0.25,
        z: spawn.z - 3.1 + 0.5 * local,
        yaw: lerp(0, -0.5, local),
        pitch: -0.08,
      };
    }
    case "rise-overlook": {
      // Climb above the floor and tilt down across the whole landscape.
      const riseY = lerp(bounds.walkY, bounds.walkY + 2.1, easeOut(t));
      return {
        x: lerp(spawn.x, spawn.x * 0.4, eased),
        y: riseY,
        z: spawn.z - 2.4 * eased,
        yaw: Math.sin(t * Math.PI) * 0.1,
        pitch: lerp(-0.02, -0.46, eased),
      };
    }
    case "sweep-tilt": {
      // Side-to-side truck while the look sweeps up the tower and back down.
      const sweep = Math.sin(t * Math.PI * 2 * 0.75);
      return {
        x: spawn.x + sweep * 2.1,
        y: bounds.walkY,
        z: spawn.z - 1.6 * eased,
        yaw: -sweep * 0.3,
        pitch: Math.sin(t * Math.PI) * 0.34,
      };
    }
    case "extreme-close": {
      // Dolly all the way onto one matrix until it fills the frame.
      const drive = easeInOut(t);
      return {
        x: lerp(spawn.x, spawn.x * 0.25, drive),
        y: bounds.walkY + 0.2 * drive,
        z: lerp(spawn.z, bounds.minZ + 2.2, drive),
        yaw: Math.sin(t * Math.PI) * 0.05,
        pitch: -0.02 - 0.05 * drive,
      };
    }
    case "orbit-behind": {
      // Circle around the exhibits and end looking at them from behind.
      const center = (bounds.minX + bounds.maxX) / 2;
      const keys: ReadonlyArray<{ at: number; pose: Pose }> = [
        { at: 0, pose: spawn },
        {
          at: 0.3,
          pose: {
            x: bounds.maxX - 1.9,
            y: bounds.walkY,
            z: spawn.z - 2.6,
            yaw: 0.5,
            pitch: -0.03,
          },
        },
        {
          at: 0.68,
          pose: {
            x: bounds.maxX - 2.1,
            y: bounds.walkY + 0.25,
            z: bounds.minZ + 3.4,
            yaw: 2.15,
            pitch: -0.04,
          },
        },
        {
          at: 1,
          pose: {
            x: center + 0.6,
            y: bounds.walkY + 0.15,
            z: bounds.minZ + 2.6,
            yaw: Math.PI,
            pitch: -0.05,
          },
        },
      ];
      let slot = 0;
      while (slot < keys.length - 2 && t > keys[slot + 1].at) slot += 1;
      const a = keys[slot];
      const b = keys[slot + 1];
      const local = easeInOut(
        clamp01((t - a.at) / Math.max(1e-5, b.at - a.at)),
      );
      return mixPose(a.pose, b.pose, local);
    }
  }
}

function* spotlightHold(
  canvas: DirectorCanvasApi,
  exp: DirectorExperienceApi,
  station: number,
): Flight {
  ctx.label = "Spotlight · lifting the exhibit";
  yield* wait(0.5);
  let engaged = canvas.spotlightCenter();
  if (!engaged) {
    // Nudge closer and retry once — the pick needs an exhibit at the
    // crosshair.
    const bounds = canvas.getBounds(station);
    writePose(canvas, station, {
      x: bounds.spawnX,
      y: bounds.walkY,
      z: bounds.spawnZ - 1.6,
      yaw: 0,
      pitch: -0.04,
    });
    yield* wait(0.35);
    engaged = canvas.spotlightCenter();
  }
  const live = exp.getVoice().enabled;
  const holdSeconds = engaged
    ? live
      ? PACING.spotlightLiveSeconds
      : PACING.spotlightVisualSeconds
    : 1.2;
  ctx.label = live
    ? "Spotlight · ask the guide out loud"
    : "Spotlight · visual tour";
  yield* wait(holdSeconds);
  canvas.releaseSpotlight();
  yield* wait(0.4);
}

/**
 * Lift a named list of exhibits onto the magnified stage one at a time — the
 * right-click highlight tool, driven by target id so the camera can hold its
 * framing instead of having to aim at each one.
 *
 * Paced as a person would use it, and deliberately not swapped straight from
 * one target to the next. Each pass is a full gesture: the red beam fires and
 * the exhibit rises, it holds, it drops and the chamber comes back, and only
 * then does the beam pick the next one. Swapping directly is a second quicker
 * across five exhibits and looks like software cycling a list — the release is
 * what makes it read as someone pointing at things.
 */
function* highlightSweep(
  canvas: DirectorCanvasApi,
  targetIds: readonly string[],
): Flight {
  if (targetIds.length === 0) return;

  // Run the chamber's process out to the end before pointing at anything.
  // Highlighting is a look at finished objects, and an exhibit the process has
  // not revealed yet is not visible — the pick would find nothing and the beat
  // would pass in silence. This also settles the room, so the sweep starts
  // from a still frame.
  const processFrom = getDirectorProcessOverride() ?? 1;
  yield* tween(PACING.highlightLeadSeconds, (eased) => {
    setDirectorProcessOverride(lerp(processFrom, 1, eased));
  });

  for (let index = 0; index < targetIds.length; index += 1) {
    const targetId = targetIds[index];
    ctx.label = `Highlight · ${targetId}`;
    const lifted = canvas.spotlightTarget(targetId);
    // Hold whether or not this one resolved: a missing exhibit should cost a
    // beat, not desynchronize everything after it. The canvas's own 0.45s
    // laser flash plays over the front of this hold, exactly as it would for
    // a visitor who had just right-clicked.
    yield* wait(PACING.highlightSeconds);
    if (lifted) canvas.releaseSpotlight();
    const last = index === targetIds.length - 1;
    yield* wait(
      last ? PACING.highlightReleaseSeconds : PACING.highlightGapSeconds,
    );
  }
}

function* visitChamber(
  spec: ChamberVisitSpec,
  enteredByDive = false,
): Flight {
  const canvas = getDirectorCanvas();
  const exp = getDirectorExperience();
  if (!canvas || !exp) return;

  const bounds = canvas.getBounds(spec.station);
  ctx.label = `Chamber ${spec.station}`;
  // A previous visit's detail tour may have left the panel on Code.
  if (!spec.detailTour) exp.setDetailMode("story");
  if (spec.dataPrep) exp.setDataPrep(0, false);

  // Blend from the entry pose (tunnel arrival, or the free-roam spawn a
  // machine-room dive lands on) into the visit's opening pose while the
  // compressed process starts from zero.
  let processTime = 0;
  const from: Pose = enteredByDive
    ? { x: bounds.spawnX, y: bounds.spawnY, z: bounds.spawnZ, yaw: 0, pitch: 0 }
    : arrivalPose(bounds);
  setDirectorProcessOverride(0);
  yield* tween(PACING.entryTweenSeconds, (eased) => {
    processTime += ctx.dt;
    setDirectorProcessOverride(
      Math.min(spec.processCap, processTime / PACING.processSeconds),
    );
    const target = choreoPose(spec.choreo, bounds, 0);
    writePose(canvas, spec.station, mixPose(from, target, eased));
  });

  let shownDetailMode: "story" | "structure" | "math" | "code" = "story";
  yield* tween(spec.dwell, (_, raw) => {
    processTime += ctx.dt;
    setDirectorProcessOverride(
      Math.min(spec.processCap, processTime / PACING.processSeconds),
    );
    // The corpus hall runs its own transport rather than the generic chamber
    // process, so its boards actually move during the hold.
    if (spec.dataPrep) exp.setDataPrep(clamp01(raw), false);
    if (spec.detailTour) {
      // Walk the HUD through its four explanation depths while the camera
      // holds the exhibit — ending on Code for the trainer-sync beat.
      const mode =
        raw < 0.28
          ? "story"
          : raw < 0.52
            ? "structure"
            : raw < 0.76
              ? "math"
              : "code";
      if (mode !== shownDetailMode) {
        shownDetailMode = mode;
        exp.setDetailMode(mode);
      }
    }
    writePose(canvas, spec.station, choreoPose(spec.choreo, bounds, raw));
  });

  if (spec.spotlight) {
    yield* spotlightHold(canvas, exp, spec.station);
  }
  if (spec.highlights) {
    yield* highlightSweep(canvas, spec.highlights);
  }
}

/**
 * Rise out of the current chamber into the machine room (the M-key
 * cinematic), glance from the risen overlook toward the desk unit that owns
 * `station`, then dive into it. This is what stitches the legs together and
 * keeps reminding the viewer that every chamber lives inside the desk
 * miniature.
 */
function* riseAndDive(station: number, label: string): Flight {
  const canvas = getDirectorCanvas();
  if (!canvas) return;

  ctx.label = "Back to the machine room";
  setDirectorProcessOverride(null);
  canvas.riseToRoom();
  yield* waitUntil(() => {
    const state = getDirectorCanvas()?.getState();
    return Boolean(
      state && state.region === "machine-room" && !state.transitioning,
    );
  }, 6);
  yield* wait(PACING.roomReturnHoldSeconds);

  const room = getDirectorCanvas();
  if (!room) return;
  const from = room.getRoomPose();
  const anchor = room.getUnitAnchor(station);
  if (from) {
    ctx.label = `Machine room · to ${label}`;
    // Drift a little more than halfway toward the next unit's overlook
    // while the look swings onto the unit itself.
    const targetX = lerp(from.x, anchor.overlookX, 0.6);
    const targetY = lerp(from.y, anchor.overlookY, 0.6);
    const targetZ = lerp(from.z, anchor.overlookZ, 0.6);
    yield* tween(PACING.roomGlanceSeconds, (eased) => {
      const x = lerp(from.x, targetX, eased);
      const y = lerp(from.y, targetY, eased);
      const z = lerp(from.z, targetZ, eased);
      const aim = yawPitchTowards(
        x,
        y,
        z,
        anchor.focusX,
        anchor.focusY,
        anchor.focusZ,
      );
      room.setRoomPose(
        x,
        y,
        z,
        blendAngle(from.yaw, aim.yaw, eased),
        lerp(from.pitch, aim.pitch, eased),
      );
    });
  }

  ctx.label = `Diving into ${label}`;
  room.startDive(station);
  yield* waitUntil(() => {
    const state = getDirectorCanvas()?.getState();
    return Boolean(
      state &&
        state.region === "chamber" &&
        state.station === station &&
        !state.transitioning,
    );
  }, 6);

  // The dive lands on the chamber's free-roam spawn; seed pose continuity
  // from there so a follow-up transit or visit never snaps.
  const landed = getDirectorCanvas();
  if (landed) {
    const bounds = landed.getBounds(station);
    lastPose = {
      x: bounds.spawnX,
      y: bounds.spawnY,
      z: bounds.spawnZ,
      yaw: 0,
      pitch: 0,
    };
  }
}

function* transitTo(destination: number, express = false): Flight {
  const canvas = getDirectorCanvas();
  if (!canvas) return;
  const state = canvas.getState();
  if (state.region === "chamber" && state.station === destination) return;

  ctx.label = express
    ? `Tunnel · express to chamber ${destination}`
    : `Tunnel · to chamber ${destination}`;
  const bounds = canvas.getBounds(state.station);

  // Step to the exit portal, then sprint forward; the app's own portal and
  // tunnel logic does the actual travel, exactly like a visitor holding
  // W + Shift.
  const from = lastPose ?? choreoPose("push", bounds, 1);
  const portal: Pose = {
    x: bounds.portalCenterX,
    y: bounds.walkY,
    z: bounds.minZ + 1.25,
    yaw: 0,
    pitch: 0,
  };
  yield* tween(0.5, (eased) => {
    writePose(canvas, state.station, mixPose(from, portal, eased));
  });

  const budget = express
    ? PACING.expressTimeoutSeconds
    : PACING.transitTimeoutSeconds;
  let t = 0;
  while (t < budget) {
    const now = getDirectorCanvas()?.getState();
    if (now && now.region === "chamber" && now.station === destination) {
      break;
    }
    getDirectorCanvas()?.press(["KeyW", "ShiftLeft"]);
    t += ctx.dt;
    yield;
  }
  getDirectorCanvas()?.release(["KeyW", "ShiftLeft"]);

  // Timeout fallback: veil-less snap keeps the take going rather than
  // stranding the camera in a corridor.
  const settled = getDirectorCanvas()?.getState();
  if (!settled || settled.region !== "chamber" || settled.station !== destination) {
    const dest = getDirectorCanvas();
    if (dest) {
      const destBounds = dest.getBounds(destination);
      writePose(
        dest,
        destination,
        {
          x: destBounds.spawnX,
          y: destBounds.walkY,
          z: destBounds.spawnZ,
          yaw: 0,
          pitch: 0,
        },
        true,
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * Phase 4 — the custom-training console
 * ------------------------------------------------------------------ */

/**
 * The closing beat: home to the machine room, straight across to the
 * custom-training console, into the panel itself, then back out and done.
 *
 * The panel is a real route, not an overlay, so opening it unmounts the world
 * and coming back rebuilds it. That is why the walk over is brisk and the hold
 * afterwards is short — the interesting part is the panel, and everything
 * around it is transition. Opening goes through the same hidden link the
 * in-world screen click uses, so what is on film is the visitor's route.
 */
function* trainingConsoleBeat(): Flight {
  publish("finale");
  setDirectorProcessOverride(null);

  ctx.label = "Back to the machine room";
  const chamber = getDirectorCanvas();
  if (!chamber) return;
  chamber.riseToRoom();
  yield* waitUntil(() => {
    const state = getDirectorCanvas()?.getState();
    return Boolean(
      state && state.region === "machine-room" && !state.transitioning,
    );
  }, 8);
  yield* wait(PACING.roomReturnHoldSeconds);

  const room = getDirectorCanvas();
  if (!room) return;
  const from = room.getRoomPose();
  const deck = room.getConsoleAnchor();

  if (from) {
    ctx.label = "Machine room · to the training console";
    yield* tween(PACING.consoleApproachSeconds, (eased) => {
      const x = lerp(from.x, deck.approachX, eased);
      const y = lerp(from.y, deck.approachY, eased);
      const z = lerp(from.z, deck.approachZ, eased);
      const aim = yawPitchTowards(
        x,
        y,
        z,
        deck.screenX,
        deck.screenY,
        deck.screenZ,
      );
      getDirectorCanvas()?.setRoomPose(
        x,
        y,
        z,
        blendAngle(from.yaw, aim.yaw, eased),
        lerp(from.pitch, aim.pitch, eased),
      );
    });
  }

  ctx.label = "Opening the training panel";
  const opened = getDirectorCanvas()?.openTrainingConsole() ?? false;
  if (!opened) hooks?.navigate("/custom-training");

  // The Custom Training chamber marks its corpus field for the director; it
  // is the last thing to mount, so it is the honest signal that the panel is
  // on screen rather than half-drawn.
  yield* waitUntil(
    () => Boolean(document.querySelector('[data-director="corpus"]')),
    PACING.consoleOpenTimeoutSeconds,
  );

  ctx.label = "Train your own model";
  yield* wait(PACING.consolePanelSeconds);

  ctx.label = "Back to the machine room";
  hooks?.navigate("/");
  yield* waitUntil(() => {
    const state = getDirectorCanvas()?.getState();
    return Boolean(state && state.region === "machine-room");
  }, 12);

  // The world was torn down and rebuilt by the route change; give it a moment
  // to settle, and put capture sizing back on the new canvas instance — it
  // registered fresh and knows nothing about the take in progress.
  yield* wait(PACING.consoleReturnSettleSeconds);
  getDirectorCanvas()?.setCaptureSizing(true);
  yield* wait(PACING.endHomeSeconds);
}

/* ------------------------------------------------------------------ *
 * Master flight
 * ------------------------------------------------------------------ */

function* masterFlight(): Flight {
  const canvas = getDirectorCanvas();
  const exp = getDirectorExperience();
  if (!canvas || !exp) {
    ctx.label = "Open the main experience first";
    return;
  }

  publish("flying", "Lights, camera…");
  exp.setPlaying(false);
  exp.setProgress(0);
  exp.setDetailMode("story");
  exp.setPresenting(true);
  canvas.releaseSpotlight();
  canvas.resetToRoom();

  // The site's own title sequence, over the opening rather than before it.
  // The overlay is transparent, so "Inside One Training Step" and the build
  // credit play across the pre-roll and the machine-room move — roughly 8.5
  // seconds of titles inside 9.2 seconds of camera that was happening anyway.
  hooks?.showTitleCard(true);
  yield* wait(PACING.preRollSeconds);

  // Zoom one: the machine-room overview, then down into the orientation
  // gallery and out through its doorway on foot into the data wing.
  yield* roomIntro(canvas);
  // The titles have dissolved by now (see INTRO_TITLE_TOTAL_MS); drop the
  // card so a second take in this session mounts a fresh one.
  hooks?.showTitleCard(false);
  yield* orientationVisit(canvas);
  for (const spec of OPENING_VISITS) {
    yield* transitTo(spec.station, spec.express);
    yield* visitChamber(spec);
  }

  // Every further zoom re-enters through the machine room: rise, glance at
  // the next desk unit, dive, then walk that zoom's chambers. A leg whose
  // first visit is not the dive station flies straight through the landing
  // chamber instead of stopping in it.
  for (const leg of DIVE_LEGS) {
    yield* riseAndDive(leg.diveStation, leg.label);
    let first = true;
    for (const spec of leg.visits) {
      const arrivedByDive = first && spec.station === leg.diveStation;
      if (!arrivedByDive) yield* transitTo(spec.station, spec.express);
      yield* visitChamber(spec, arrivedByDive);
      first = false;
    }
  }

  setDirectorProcessOverride(null);
  yield* trainingConsoleBeat();

  ctx.label = "End card";
  hooks?.showEndCard(true);
  yield* wait(PACING.endCardSeconds);
}

/* ------------------------------------------------------------------ *
 * Loop + public controls
 * ------------------------------------------------------------------ */

function frame(now: number): void {
  if (!running || !flight) return;
  ctx.dt = Math.min(0.05, Math.max(0.001, (now - lastFrameAt) / 1000));
  lastFrameAt = now;
  ctx.time += ctx.dt;
  recordFrame(ctx.dt);

  const step = flight.next();
  publishThrottled(ctx.label);
  if (step.done) {
    void finishFlight("done");
    return;
  }
  frameHandle = window.requestAnimationFrame(frame);
}

async function finishFlight(phase: DirectorPhase): Promise<void> {
  running = false;
  setDirectorDriving(false);
  window.cancelAnimationFrame(frameHandle);
  flight = null;
  setDirectorProcessOverride(null);
  getDirectorCanvas()?.release();
  getDirectorCanvas()?.releaseSpotlight();
  getDirectorExperience()?.setPresenting(false);
  hooks?.showTitleCard(false);
  window.removeEventListener("keydown", onEscape, true);

  getDirectorCanvas()?.setCaptureSizing(false);

  if (recorder) {
    publish("saving", "Saving the recording…");
    const takeExtension = recorder.extension;
    const blob = await recorder.stop();
    recorder = null;
    status.recording = false;
    if (blob) downloadRecording(blob, undefined, takeExtension);
  }
  hooks?.showEndCard(false);
  publish(phase, phase === "done" ? "Flight complete" : "Flight aborted");
}

function onEscape(event: KeyboardEvent): void {
  if (event.code !== "Escape") return;
  event.stopPropagation();
  void abortFlight();
}

export async function startFlight(options: { record: boolean }): Promise<void> {
  if (running) return;
  ctx.time = 0;
  ctx.dt = 1 / 60;
  ctx.label = "";
  status.recording = false;
  status.captureSummary = "";
  resetFrameStats();

  // Everything expensive happens here, before a single frame is filmed:
  // render at capture resolution, then compile every shader in the world.
  // A dry run pays the same costs so its frame numbers mean something.
  const canvas = getDirectorCanvas();
  const surface = canvas?.setCaptureSizing(true) ?? { width: 0, height: 0 };

  publish("arming", "Warming up the world…");
  await canvas?.prewarm();

  if (options.record) {
    publish("arming", "Choose this tab to record");
    recorder = await startDemoRecorder({
      width: surface.width || undefined,
      height: surface.height || undefined,
    });
    if (recorder) {
      status.recording = true;
      status.captureSummary = `${surface.width}×${surface.height} · ${
        recorder.hardwareFriendly ? "h264/mp4" : recorder.extension
      }`;
      recorder.onEnded(() => void abortFlight());
    } else {
      // Capture sizing deliberately stays on: this is now a dry run, and a dry
      // run is only worth its frame numbers if it costs what a take costs.
      status.captureSummary = `${surface.width}×${surface.height} · dry run`;
      publish("arming", "Recording unavailable — flying without capture");
    }
  } else {
    status.captureSummary = `${surface.width}×${surface.height} · dry run`;
  }

  flight = masterFlight();
  running = true;
  setDirectorDriving(true);
  lastFrameAt = performance.now();
  window.addEventListener("keydown", onEscape, true);
  publish("flying", "Rolling");
  frameHandle = window.requestAnimationFrame(frame);
}

export async function abortFlight(): Promise<void> {
  if (!running) return;
  await finishFlight("aborted");
}

export function isFlightRunning(): boolean {
  return running;
}
