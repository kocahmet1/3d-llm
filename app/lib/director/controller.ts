/**
 * Director controller — runs the whole competition-video flight as one
 * generator-based coroutine ticked by its own requestAnimationFrame loop:
 *
 *   machine-room orbit → dive into Data Preparation → tracked data-prep
 *   watch → every chamber with a compressed process (FPS move-arounds in
 *   four showcases, a live voice-guide spotlight in the Causal Mask) →
 *   client-side hop to the Custom Training chamber → auto-typed corpus →
 *   real local training run → end card.
 *
 * The controller only talks to the app through the director registry and
 * the DOM, so it survives the route change to /custom-training and never
 * leaks into the normal visitor experience.
 */

import {
  getDirectorCanvas,
  getDirectorExperience,
  setDirectorDriving,
  setDirectorProcessOverride,
  type DirectorBoundsSnapshot,
  type DirectorCanvasApi,
  type DirectorExperienceApi,
} from "./registry";
import { downloadRecording, startDemoRecorder, type DemoRecorder } from "./recorder";
import {
  DATA_PREP_STAGE_STARTS,
  DATA_PREP_TRACK,
  DIVE_LEGS,
  LEG_ONE_VISITS,
  PACING,
  ROOM_AIM,
  ROOM_ORBIT,
  ROOM_PAN,
  ROOM_SPAWN,
  FINALE_CORPUS,
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

export interface DirectorStatus {
  phase: DirectorPhase;
  label: string;
  elapsedSeconds: number;
  recording: boolean;
}

export interface DirectorHooks {
  onStatus(status: DirectorStatus): void;
  showEndCard(visible: boolean): void;
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

const status: DirectorStatus = {
  phase: "idle",
  label: "",
  elapsedSeconds: 0,
  recording: false,
};

function publish(phase?: DirectorPhase, label?: string): void {
  if (phase) status.phase = phase;
  if (label !== undefined) status.label = label;
  status.elapsedSeconds = ctx.time;
  hooks?.onStatus({ ...status });
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

  ctx.label = "Machine room · into Data Preparation";
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

  canvas.startDive(1);
  yield* waitUntil(() => {
    const state = getDirectorCanvas()?.getState();
    return Boolean(
      state &&
        state.region === "chamber" &&
        state.station === 1 &&
        !state.transitioning,
    );
  }, 6);
}

/* ------------------------------------------------------------------ *
 * Phase 2 — data preparation watch
 * ------------------------------------------------------------------ */

/**
 * Camera fraction across the data-prep boards: which stage is live plus how
 * far it has run, normalized — so the truck keeps pace with the exhibits
 * rather than with wall-clock progress.
 */
const dataPrepStageFraction = (prep: number): number => {
  const starts = DATA_PREP_STAGE_STARTS;
  let stage = starts.length - 1;
  while (stage > 0 && prep < starts[stage]) stage -= 1;
  const nextStart = stage < starts.length - 1 ? starts[stage + 1] : 1;
  const local = clamp01(
    (prep - starts[stage]) / Math.max(1e-5, nextStart - starts[stage]),
  );
  return (stage + local) / (starts.length - 1);
};

function* dataPrepWatch(
  canvas: DirectorCanvasApi,
  exp: DirectorExperienceApi,
): Flight {
  ctx.label = "Data Preparation · corpus to tokens";
  const bounds = canvas.getBounds(1);
  exp.setDataPrep(0, false);

  const xAt = (fraction: number) =>
    lerp(bounds.minX, bounds.maxX, fraction);
  const standZ = lerp(bounds.minZ, bounds.maxZ, DATA_PREP_TRACK.zFraction);

  // Watch only the first four stages (source → clean → split → lookup)…
  yield* tween(PACING.dataPrepSeconds, (_, raw) => {
    const prep = clamp01(raw) * PACING.dataPrepLeaveAt;
    exp.setDataPrep(prep, false);
    const stageBlend = easeInOut(dataPrepStageFraction(prep));
    writePose(canvas, 1, {
      x: lerp(
        xAt(DATA_PREP_TRACK.xStartFraction),
        xAt(DATA_PREP_TRACK.xEndFraction),
        stageBlend,
      ),
      y: bounds.walkY,
      z: standZ,
      yaw: lerp(DATA_PREP_TRACK.yawStart, DATA_PREP_TRACK.yawEnd, stageBlend),
      pitch: DATA_PREP_TRACK.pitch,
    });
  });

  // …then sprint the remaining stages and move on.
  ctx.label = "Data Preparation · and onward";
  yield* tween(PACING.dataPrepFinishSeconds, (eased) => {
    exp.setDataPrep(lerp(PACING.dataPrepLeaveAt, 1, eased), false);
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

const arrivalPose = (bounds: DirectorBoundsSnapshot): Pose => ({
  x: bounds.portalCenterX,
  y: bounds.walkY,
  z: bounds.maxZ - 1.4,
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

function* transitTo(destination: number): Flight {
  const canvas = getDirectorCanvas();
  if (!canvas) return;
  const state = canvas.getState();
  if (state.region === "chamber" && state.station === destination) return;

  ctx.label = `Tunnel · to chamber ${destination}`;
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

  let t = 0;
  while (t < PACING.transitTimeoutSeconds) {
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
 * Phase 4 — custom-training finale
 * ------------------------------------------------------------------ */

const setReactValue = (
  element: HTMLTextAreaElement,
  value: string,
): void => {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  );
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
};

function* finale(): Flight {
  ctx.label = "To the Custom Training chamber";
  publish("finale");
  setDirectorProcessOverride(null);

  // The HUD's own "Train your own model" link only exists while the HUD
  // shows station 0, so navigate through the Next router instead — a
  // client-side transition, which keeps the tab recording alive.
  const link = document.querySelector<HTMLAnchorElement>(
    'a[href="/custom-training"]',
  );
  if (link) {
    link.click();
  } else if (hooks) {
    hooks.navigate("/custom-training");
  } else {
    window.location.assign("/custom-training"); // last resort: hard nav
  }

  yield* waitUntil(
    () => Boolean(document.querySelector('[data-director="corpus"]')),
    10,
  );
  const corpus = document.querySelector<HTMLTextAreaElement>(
    '[data-director="corpus"]',
  );
  if (!corpus) {
    ctx.label = "Custom Training chamber not found";
    yield* wait(1.5);
    return;
  }

  // Prefer real text files from the local corpus folder (served by
  // /api/director/corpus); fall back to the built-in passage.
  ctx.label = "Collecting the corpus folder";
  let fetchedCorpus: string | null = null;
  let corpusFetchSettled = false;
  void fetch("/api/director/corpus")
    .then(async (response) => {
      if (response.ok) fetchedCorpus = await response.text();
    })
    .catch(() => undefined)
    .finally(() => {
      corpusFetchSettled = true;
    });
  yield* waitUntil(() => corpusFetchSettled, 5);
  const text =
    fetchedCorpus && fetchedCorpus.trim().length >= 300
      ? fetchedCorpus
      : FINALE_CORPUS;

  ctx.label = "Typing a fresh corpus";
  yield* wait(0.8);
  const typeSeconds = Math.min(
    PACING.finaleTypeMaxSeconds,
    Math.max(0.8, text.length / PACING.finaleTypeCharsPerSecond),
  );
  yield* tween(typeSeconds, (_, raw) => {
    setReactValue(corpus, text.slice(0, Math.ceil(text.length * raw)));
  });
  yield* wait(0.6);

  ctx.label = "Starting a real training run";
  const startButton = () =>
    document.querySelector<HTMLButtonElement>('[data-director="start"]');
  yield* waitUntil(() => {
    const button = startButton();
    return Boolean(button && !button.disabled);
  }, 12);
  const button = startButton();
  if (button && !button.disabled) {
    button.click();
    ctx.label = "Training · real optimizer steps";
    yield* wait(PACING.finaleWatchSeconds);
  } else {
    ctx.label = "Trainer offline — skipping the live run";
    yield* wait(2);
  }

  // Close the loop where it started: back to the machine room. The run
  // keeps training — the page says so itself — while the ending plays over
  // the desk.
  ctx.label = "Back to the machine room";
  if (hooks) {
    hooks.navigate("/");
  } else {
    window.location.assign("/");
    return;
  }
  yield* waitUntil(() => {
    const state = getDirectorCanvas()?.getState();
    return Boolean(state && state.region === "machine-room");
  }, 12);
  yield* wait(0.4); // let a dev-mode double-mount settle
  const home = getDirectorCanvas()?.getRoomPose();
  if (home) {
    yield* tween(PACING.endHomeSeconds, (eased) => {
      getDirectorCanvas()?.setRoomPose(
        home.x - 0.85 * eased,
        home.y - 0.06 * eased,
        home.z - 0.5 * eased,
        home.yaw,
        home.pitch,
      );
    });
  } else {
    yield* wait(PACING.endHomeSeconds);
  }
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
  canvas.releaseSpotlight();
  canvas.resetToRoom();
  yield* wait(PACING.preRollSeconds);

  yield* roomIntro(canvas);
  yield* dataPrepWatch(canvas, exp);

  // Leg one continues from Data Preparation through its neighbours.
  for (const spec of LEG_ONE_VISITS) {
    yield* transitTo(spec.station);
    yield* visitChamber(spec);
  }

  // Every further zoom re-enters through the machine room: rise, glance at
  // the next desk unit, dive, then walk that zoom's chambers. A leg whose
  // first visit is not the dive station (the Tower zoom) flies straight
  // through the landing chamber.
  for (const leg of DIVE_LEGS) {
    yield* riseAndDive(leg.diveStation, leg.label);
    let first = true;
    for (const spec of leg.visits) {
      const arrivedByDive = first && spec.station === leg.diveStation;
      if (!arrivedByDive) yield* transitTo(spec.station);
      yield* visitChamber(spec, arrivedByDive);
      first = false;
    }
  }

  setDirectorProcessOverride(null);
  yield* finale();

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

  const step = flight.next();
  publish(undefined, ctx.label);
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
  window.removeEventListener("keydown", onEscape, true);

  if (recorder) {
    publish("saving", "Saving the recording…");
    const blob = await recorder.stop();
    recorder = null;
    status.recording = false;
    if (blob) downloadRecording(blob);
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
  publish("arming", options.record ? "Choose this tab to record" : "Arming…");

  if (options.record) {
    recorder = await startDemoRecorder();
    if (recorder) {
      status.recording = true;
      recorder.onEnded(() => void abortFlight());
    } else {
      publish("arming", "Recording unavailable — flying without capture");
    }
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
