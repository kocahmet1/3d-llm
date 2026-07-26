/**
 * Scrub audit for the chamber process transport.
 *
 * Letting the visitor pause and scrub means every builder's updater is now
 * called with arbitrary progress values, in arbitrary order, instead of only
 * ever sweeping 0 → 1 with a live clock. This script drives each chamber's
 * updater through that abuse and checks the scene survives it:
 *
 *   - forward sweep, backward sweep, random jumps, and the exact stop
 *     boundaries the dial detents on,
 *   - every board still has finite position, rotation and scale afterwards,
 *   - paused frames are *stable*: calling the updater twice with the same
 *     progress but different wall-clock times must not move anything, or a
 *     paused chamber would drift instead of holding still,
 *   - scrubbing back to a progress value reproduces the same frame as
 *     reaching it forwards, so the animation is a function of progress rather
 *     than of history.
 *
 * Run:
 *   node --experimental-strip-types --import ./scripts/ts-extension-register.mjs \
 *     scripts/audit-process-scrub.mts [stationId ...]
 */
import * as THREE from "three";

function makeContext2D() {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  return new Proxy(
    {
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
      measureText: () => ({ width: 10 }),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      globalAlpha: 1,
      lineWidth: 1,
      font: "",
      fillStyle: "",
      strokeStyle: "",
      textAlign: "",
      textBaseline: "",
    },
    {
      get(target: Record<string, unknown>, key: string) {
        return key in target ? target[key] : noop;
      },
      set(target: Record<string, unknown>, key: string, value: unknown) {
        target[key] = value;
        return true;
      },
    },
  );
}

const documentStub = {
  createElement(tag: string) {
    if (tag === "canvas") {
      return {
        width: 300,
        height: 150,
        style: {},
        nodeType: 1,
        getContext: () => makeContext2D(),
        toDataURL: () => "",
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    }
    return { style: {}, nodeType: 1, appendChild: () => {}, setAttribute: () => {} };
  },
  createElementNS(_namespace: string, tag: string) {
    return documentStub.createElement(tag);
  },
};

(globalThis as Record<string, unknown>).document ??= documentStub;
(globalThis as Record<string, unknown>).window ??= globalThis;
(globalThis as Record<string, unknown>).self ??= globalThis;
(globalThis as Record<string, unknown>).HTMLCanvasElement ??= class {};
(globalThis as Record<string, unknown>).ImageData ??= class {};

const { buildDistinctChamberProcess } = await import(
  "../app/components/chambers/index.ts"
);
const { TRAINING_STATIONS, CHAMBER_PROCESS_STOPS, DEFAULT_CHAMBER_PROCESS_STOPS } =
  await import("../app/lib/trainingTrace.ts");

const PALETTE = {
  phaseBase: new THREE.Color("#47d7ff"),
  bright: new THREE.Color("#9fe8ff"),
  dark: new THREE.Color("#0b1622"),
  structure: new THREE.MeshStandardMaterial(),
  active: new THREE.MeshStandardMaterial(),
  signal: new THREE.MeshStandardMaterial(),
  warm: new THREE.MeshStandardMaterial(),
  target: new THREE.MeshStandardMaterial(),
};

interface NodeSample {
  name: string;
  shown: boolean;
  values: number[];
}

/** Per-node transform fingerprint for the whole chamber. */
function snapshot(root: THREE.Object3D): NodeSample[] {
  const samples: NodeSample[] = [];
  root.traverse((node) => {
    // An object is only really on screen if nothing above it is hidden.
    let shown = node.visible;
    for (let parent = node.parent; parent && shown; parent = parent.parent) {
      shown = parent.visible;
    }
    samples.push({
      name: node.name || node.type,
      shown,
      values: [
        node.position.x,
        node.position.y,
        node.position.z,
        node.rotation.x,
        node.rotation.y,
        node.rotation.z,
        node.scale.x,
        node.scale.y,
        node.scale.z,
      ],
    });
  });
  return samples;
}

function firstNonFinite(samples: readonly NodeSample[]) {
  return samples.find((sample) =>
    sample.values.some((value) => !Number.isFinite(value)),
  );
}

/**
 * Worst disagreement between two frames, counting only objects the visitor can
 * actually see. Packets parked off their path while inactive are hidden and
 * get re-placed before they are shown again, so where they wait is not a
 * difference anyone can observe.
 */
function maxDrift(a: readonly NodeSample[], b: readonly NodeSample[]) {
  let worst = { amount: 0, name: "" };
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index].shown !== b[index].shown) {
      return { amount: Number.POSITIVE_INFINITY, name: `${a[index].name} visibility` };
    }
    if (!a[index].shown) continue;
    for (let axis = 0; axis < a[index].values.length; axis += 1) {
      const amount = Math.abs(a[index].values[axis] - b[index].values[axis]);
      if (amount > worst.amount) worst = { amount, name: a[index].name };
    }
  }
  return worst;
}

const requested = process.argv.slice(2);
const stations = TRAINING_STATIONS.filter(
  (station: { id: string }) =>
    requested.length === 0 || requested.includes(station.id),
);

let failures = 0;
const rows: string[] = [];

for (const station of stations) {
  const group = new THREE.Group();
  const updater = buildDistinctChamberProcess({
    stationId: station.id,
    index: TRAINING_STATIONS.indexOf(station),
    group,
    palette: PALETTE,
  });
  if (!updater) continue;

  const stops =
    CHAMBER_PROCESS_STOPS[station.id] ?? DEFAULT_CHAMBER_PROCESS_STOPS;
  const problems: string[] = [];

  // A deterministic pseudo-random walk, so a failure is reproducible.
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const sweep: number[] = [];
  for (let index = 0; index <= 60; index += 1) sweep.push(index / 60);
  for (let index = 60; index >= 0; index -= 1) sweep.push(index / 60);
  for (let index = 0; index < stops; index += 1) sweep.push(index / stops);
  for (let index = 0; index < 40; index += 1) sweep.push(random());

  let clock = 0;
  for (const progress of sweep) {
    clock += 0.7;
    updater(progress, clock, false);
    const bad = firstNonFinite(snapshot(group));
    if (bad) {
      problems.push(
        `non-finite transform on ${bad.name} at progress ${progress.toFixed(3)}`,
      );
      break;
    }
  }

  // Paused frames must hold still: same progress, later wall clock, no motion.
  updater(0.42, 100, false);
  const held = snapshot(group);
  updater(0.42, 400, false);
  const pausedDrift = maxDrift(held, snapshot(group));
  if (pausedDrift.amount > 1e-9) {
    problems.push(
      `paused frame drifts by ${pausedDrift.amount.toFixed(4)} on ${pausedDrift.name}`,
    );
  }

  // Reaching a progress value by scrubbing backwards must look identical to
  // reaching it by playing forwards.
  updater(0, 10, false);
  for (let index = 1; index <= 30; index += 1) updater(index / 30, 10, false);
  updater(0.6, 10, false);
  const forwards = snapshot(group);
  for (let index = 30; index >= 0; index -= 1) updater(index / 30, 10, false);
  updater(0.6, 10, false);
  const pathDrift = maxDrift(forwards, snapshot(group));
  if (pathDrift.amount > 1e-6) {
    problems.push(
      `frame depends on scrub direction, drift ${pathDrift.amount.toFixed(4)} on ${pathDrift.name}`,
    );
  }

  if (problems.length) failures += problems.length;
  rows.push(
    `${station.id.padEnd(28)}${String(stops).padStart(5)}` +
      `${(problems.length ? "FAIL" : "ok").padStart(8)}` +
      (problems.length ? `   ${problems.join("; ")}` : ""),
  );
}

console.log(
  "\nchamber".padEnd(28) + "stops".padStart(5) + "scrub".padStart(8) + "\n" + "-".repeat(70),
);
rows.forEach((row) => console.log(row));
console.log("-".repeat(70));
console.log(
  failures === 0
    ? `all ${rows.length} chambers scrub cleanly\n`
    : `${failures} problem(s) across ${rows.length} chambers\n`,
);
process.exitCode = failures === 0 ? 0 : 1;
