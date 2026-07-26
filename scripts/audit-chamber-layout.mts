/**
 * Headless layout audit for the bespoke chamber exhibits.
 *
 * Every chamber's process builder is executed against a stubbed DOM so the
 * resulting three.js graph can be measured without a browser. Because the
 * chambers are meant to be *walked*, the audit judges each readable surface by
 * the best view a free-roaming visitor can get of it:
 *
 *   - `collide`  surfaces that physically intersect (always a bug),
 *   - `buried`   surfaces with no viewpoint on the walking path where they are
 *                both mostly unobstructed and large enough to read,
 *   - `footprint` the space the exhibit actually occupies.
 *
 * Run:
 *   node --experimental-strip-types --import ./scripts/ts-extension-register.mjs \
 *     scripts/audit-chamber-layout.mts [stationId ...]
 *
 * Env: AUDIT_DUMP=1 per-surface table · AUDIT_VERBOSE=1 per-issue detail
 *      AUDIT_SVG=<dir> plan-view schematics
 */
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Minimal DOM stub: the builders only ever need a 2D canvas to paint textures.
// ---------------------------------------------------------------------------
function makeContext2D() {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  return new Proxy(
    {
      canvas: null as unknown,
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
        if (key in target) return target[key];
        return noop;
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

// ---------------------------------------------------------------------------

const { buildDistinctChamberProcess } = await import(
  "../app/components/chambers/index.ts"
);
const { TRAINING_STATIONS } = await import("../app/lib/trainingTrace.ts");

/** Reads DISTINCT_CHAMBER_SHELL_SPECS out of the canvas module. */
const SHELL = await (async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(
    new URL("../app/components/TrainingWorldCanvas.tsx", import.meta.url),
    "utf8",
  );
  const block = source.slice(
    source.indexOf("const DISTINCT_CHAMBER_SHELL_SPECS"),
    source.indexOf(
      "} as const satisfies Readonly<Record<string, DistinctChamberShellSpec>>",
    ),
  );
  const specs: Record<
    string,
    { size: number[]; exhibitScale: number; exhibitPosition: number[] }
  > = {};
  const entry =
    /"([a-z0-9-]+)":\s*\{(?:\s|\/\/[^\r\n]*(?:\r?\n))*size:\s*\[([^\]]+)\][\s\S]*?exhibitScale:\s*([\d.]+),\s*exhibitPosition:\s*\[([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(block))) {
    specs[match[1]] = {
      size: match[2].split(",").map(Number),
      exhibitScale: Number(match[3]),
      exhibitPosition: match[4].split(",").map(Number),
    };
  }
  return specs;
})();

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

interface Surface {
  name: string;
  box: THREE.Box3;
  center: THREE.Vector3;
  size: THREE.Vector3;
  /** Corners of the readable face, in world space, for preview rendering. */
  face: THREE.Vector3[];
}

/** A readable surface is anything built by createValueBoard / createPanel. */
function collectSurfaces(root: THREE.Object3D): Surface[] {
  const found: Surface[] = [];
  root.updateWorldMatrix(true, true);
  root.traverse((node) => {
    const kind = node.userData.processSurface;
    if (kind !== "board" && kind !== "panel") return;
    let parent = node.parent;
    while (parent) {
      if (parent.userData.processSurface === "board") return;
      parent = parent.parent;
    }
    const box = new THREE.Box3();
    node.traverse((child) => {
      if (child.name === "neon-edge-frame") return;
      // Painted light — beams, floor pools, glows — belongs to a surface but is
      // not part of it. Counting it would inflate the surface's box, so two
      // panels whose light spills overlap would report as physically clashing
      // and a pool of light on the floor would occlude whatever is behind it.
      if (child.userData.processDecal) return;
      const mesh = child as THREE.Mesh;
      if (!mesh.geometry) return;
      box.union(new THREE.Box3().setFromObject(mesh));
    });
    if (box.isEmpty()) return;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    // The readable face itself, so the first-person preview shows boards at the
    // angle they are actually hung rather than as axis-aligned blocks.
    const face = { width: 1, height: 1, ...(node.userData.processSurfaceSize ?? {}) };
    const half = new THREE.Vector2(face.width / 2, face.height / 2);
    const corners = [
      new THREE.Vector3(-half.x, half.y, 0),
      new THREE.Vector3(half.x, half.y, 0),
      new THREE.Vector3(half.x, -half.y, 0),
      new THREE.Vector3(-half.x, -half.y, 0),
    ].map((corner) => node.localToWorld(corner));

    found.push({
      name: String(node.userData.processLabel ?? node.name ?? "(surface)"),
      box,
      center,
      size,
      face: corners,
    });
  });
  return found;
}

interface Rect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  depth: number;
}

function screenRect(
  surface: Surface,
  camera: THREE.PerspectiveCamera,
  eye: THREE.Vector3,
): Rect | null {
  const corners: THREE.Vector3[] = [];
  for (const x of [surface.box.min.x, surface.box.max.x])
    for (const y of [surface.box.min.y, surface.box.max.y])
      for (const z of [surface.box.min.z, surface.box.max.z])
        corners.push(new THREE.Vector3(x, y, z).project(camera));
  if (corners.some((corner) => corner.z > 1 || corner.z < -1)) return null;
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    depth: eye.distanceTo(surface.center),
  };
}

function rectArea(rect: Rect) {
  return Math.max(0, rect.maxX - rect.minX) * Math.max(0, rect.maxY - rect.minY);
}

function intersectionArea(a: Rect, b: Rect) {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * How well a visitor standing at `eye` and looking down the avenue can read
 * `index`: 0 when fully hidden or too small, 1 when fully clear and comfortably
 * large. Occluders are only counted when they are actually nearer the eye.
 */
function readability(
  surfaces: Surface[],
  index: number,
  eye: THREE.Vector3,
  lookAt: THREE.Vector3,
) {
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 400);
  camera.position.copy(eye);
  camera.lookAt(lookAt);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const target = surfaces[index];
  const rect = screenRect(target, camera, eye);
  if (!rect) return 0;
  const area = rectArea(rect);
  if (area <= 0) return 0;
  // Must be inside the frame and big enough that the cells are legible.
  const insideX = Math.min(rect.maxX, 1) - Math.max(rect.minX, -1);
  const insideY = Math.min(rect.maxY, 1) - Math.max(rect.minY, -1);
  if (insideX <= 0 || insideY <= 0) return 0;
  const framed = (insideX * insideY) / area;
  // Angular size test. A wide banner carries far fewer glyphs per unit height
  // than a dense value grid, so width counts partly toward legibility too.
  const height = rect.maxY - rect.minY;
  const width = rect.maxX - rect.minX;
  const scale = THREE.MathUtils.clamp(
    Math.max(height, width * 0.22) / 0.16,
    0,
    1,
  );

  let covered = 0;
  for (let other = 0; other < surfaces.length; other += 1) {
    if (other === index) continue;
    const otherRect = screenRect(surfaces[other], camera, eye);
    if (!otherRect || otherRect.depth >= rect.depth) continue;
    covered += intersectionArea(rect, otherRect);
  }
  const clear = THREE.MathUtils.clamp(1 - covered / area, 0, 1);
  return clear * framed * scale;
}

const requested = process.argv.slice(2);
const stations = TRAINING_STATIONS.filter(
  (station: { id: string }) =>
    SHELL[station.id] &&
    (requested.length === 0 || requested.includes(station.id)),
);

interface Report {
  id: string;
  surfaces: number;
  footprint: number[];
  collisions: [string, string, number][];
  buried: [string, number][];
  outside: [string, string][];
  intrusions: string[];
  detail: { name: string; center: number[]; size: number[]; best: number }[];
  surfaceList: Surface[];
  depth: number;
  width: number;
}

/**
 * Painter-sorted first-person preview of a chamber, drawn straight from the
 * measured face quads. It is not a render of the finished scene — no materials,
 * no lighting — but it shows exactly which board covers which from a given
 * standing position, which is the thing this audit exists to check.
 */
function previewSvg(
  surfaces: readonly Surface[],
  eye: THREE.Vector3,
  lookAt: THREE.Vector3,
  caption: string,
  fov = 62,
) {
  const width = 1000;
  const height = 560;
  const camera = new THREE.PerspectiveCamera(fov, width / height, 0.1, 400);
  camera.position.copy(eye);
  camera.lookAt(lookAt);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const drawn = surfaces
    .map((surface) => ({
      surface,
      depth: eye.distanceTo(surface.center),
      points: surface.face.map((corner) => corner.clone().project(camera)),
    }))
    .filter((item) => item.points.every((point) => point.z < 1))
    .sort((a, b) => b.depth - a.depth);

  const toScreen = (point: THREE.Vector3) => [
    ((point.x + 1) / 2) * width,
    ((1 - point.y) / 2) * height,
  ];

  const parts = [
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#070c14"/>`,
    `<line x1="0" y1="${height * 0.5}" x2="${width}" y2="${height * 0.5}" stroke="#16222e" stroke-width="1"/>`,
  ];
  for (const item of drawn) {
    const polygon = item.points
      .map((point) => toScreen(point).map((value) => value.toFixed(1)).join(","))
      .join(" ");
    const fade = THREE.MathUtils.clamp(1 - item.depth / 46, 0.18, 1);
    const centre = toScreen(
      item.surface.center.clone().project(camera),
    );
    parts.push(
      `<polygon points="${polygon}" fill="rgba(71,215,255,${(fade * 0.16).toFixed(2)})" stroke="rgba(126,226,255,${fade.toFixed(2)})" stroke-width="2"/>`,
      `<text x="${centre[0].toFixed(1)}" y="${centre[1].toFixed(1)}" fill="rgba(200,236,255,${fade.toFixed(2)})" font-family="monospace" font-size="12" text-anchor="middle">${item.surface.name
        .replace(/[<>&]/g, "")
        .slice(0, 30)}</text>`,
    );
  }
  parts.push(
    `<text x="16" y="${height - 16}" fill="#5e7near" font-family="monospace" font-size="14">${caption}</text>`.replace(
      "#5e7near",
      "#5e7a90",
    ),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}

const reports: Report[] = [];

for (const station of stations) {
  const group = new THREE.Group();
  const updater = buildDistinctChamberProcess({
    stationId: station.id,
    index: TRAINING_STATIONS.indexOf(station),
    group,
    palette: PALETTE,
  });
  if (!updater) {
    console.log(`! ${station.id}: no bespoke process builder`);
    continue;
  }
  // Measure the authored layout: the animation reveals boards at different
  // times, but each board owns its slot for the whole cycle, so that is the
  // arrangement that has to be collision-free.
  group.traverse((node) => {
    node.visible = true;
  });

  const spec = SHELL[station.id];
  group.scale.setScalar(spec.exhibitScale);
  group.position.set(
    spec.exhibitPosition[0],
    spec.exhibitPosition[1],
    spec.exhibitPosition[2],
  );
  group.updateWorldMatrix(true, true);

  const surfaces = collectSurfaces(group);
  const whole = new THREE.Box3();
  surfaces.forEach((surface) => whole.union(surface.box));
  const size = new THREE.Vector3();
  whole.getSize(size);

  // Anything that pokes through a wall, floor or ceiling. Boards are hung by
  // hand, so a mistyped lane offset shows up here rather than in the browser.
  const halfWidth = spec.size[0] / 2 - 0.9;
  const halfDepth = spec.size[2] / 2 - 0.9;
  const ceiling = -4.88 + spec.size[1] - 1.2;
  const outside: [string, string][] = [];
  for (const surface of surfaces) {
    const escapes: string[] = [];
    if (surface.box.min.x < -halfWidth || surface.box.max.x > halfWidth)
      escapes.push("side wall");
    if (surface.box.min.z < -halfDepth || surface.box.max.z > halfDepth)
      escapes.push("end wall");
    if (surface.box.min.y < -4.7) escapes.push("floor");
    if (surface.box.max.y > ceiling) escapes.push("ceiling");
    if (escapes.length) outside.push([surface.name, escapes.join(" + ")]);
  }

  // Solid things standing in the walkway. Tested per vertex rather than per
  // bounding box, because a conduit that bows politely around the corridor
  // still has an axis-aligned box straddling it. Conduits and packets are
  // skipped outright: they are moving light, not obstacles.
  const CORRIDOR_HALF_WIDTH = 3.7;
  const CORRIDOR_CLEAR_Y = 3.1;
  const intrusions = new Map<string, string>();
  const vertex = new THREE.Vector3();
  group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (
      mesh.geometry instanceof THREE.TubeGeometry ||
      mesh.geometry instanceof THREE.IcosahedronGeometry ||
      mesh.geometry instanceof THREE.TorusGeometry
    ) {
      return;
    }
    // Light cast onto the floor or air is not something you can walk into.
    let decorative: THREE.Object3D | null = node;
    while (decorative) {
      if (decorative.userData.processDecal) return;
      decorative = decorative.parent;
    }
    const positions = mesh.geometry.getAttribute("position");
    if (!positions) return;
    mesh.updateWorldMatrix(true, false);
    for (let index = 0; index < positions.count; index += 1) {
      vertex.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
      if (vertex.y > CORRIDOR_CLEAR_Y) continue;
      if (Math.abs(vertex.x) > CORRIDOR_HALF_WIDTH) continue;
      if (Math.abs(vertex.z) > halfDepth) continue;
      let owner: THREE.Object3D | null = node;
      while (owner && !owner.userData.processLabel && owner !== group)
        owner = owner.parent;
      intrusions.set(
        String(owner?.userData.processLabel ?? (node.name || mesh.type)),
        `x ${vertex.x.toFixed(1)} y ${vertex.y.toFixed(1)} z ${vertex.z.toFixed(1)}`,
      );
      return;
    }
  });

  const collisions: [string, string, number][] = [];
  for (let i = 0; i < surfaces.length; i += 1) {
    for (let j = i + 1; j < surfaces.length; j += 1) {
      const overlap = surfaces[i].box.clone().intersect(surfaces[j].box);
      if (overlap.isEmpty()) continue;
      const overlapSize = new THREE.Vector3();
      overlap.getSize(overlapSize);
      // Two boards genuinely clash only when they share real area, not when
      // their bounding boxes graze along one axis.
      const axes = [overlapSize.x, overlapSize.y, overlapSize.z].filter(
        (value) => value > 0.12,
      );
      if (axes.length < 2) continue;
      collisions.push([
        surfaces[i].name,
        surfaces[j].name,
        Number(Math.min(...axes).toFixed(2)),
      ]);
    }
  }

  // Sample the positions a free-roaming visitor actually occupies: down the
  // middle of the avenue from the spawn point to the exit, plus a stroll along
  // each side.
  const depth = spec.size[2];
  const spawnZ = depth / 2 - Math.max(8, depth * 0.16);
  const eyeY = 2.15;
  const viewpoints: THREE.Vector3[] = [];
  for (let z = spawnZ; z > -depth / 2 + 4; z -= 2.5) {
    for (const x of [-3, 0, 3]) {
      viewpoints.push(new THREE.Vector3(x, eyeY, z));
    }
  }

  // Judge each board from a natural reading distance while approaching it —
  // close enough for the cells to resolve, far enough that walking around an
  // obstruction is not what saved it.
  const READ_NEAR = 6;
  const READ_FAR = 19;
  const best = surfaces.map((surface, index) => {
    let score = 0;
    for (const eye of viewpoints) {
      const along = eye.z - surface.center.z;
      if (along < READ_NEAR || along > READ_FAR) continue;
      const lookAt = new THREE.Vector3(
        surface.center.x * 0.55,
        surface.center.y,
        surface.center.z,
      );
      score = Math.max(score, readability(surfaces, index, eye, lookAt));
      if (score > 0.95) break;
    }
    return score;
  });

  const buried: [string, number][] = surfaces
    .map((surface, index) => [surface.name, Number(best[index].toFixed(2))] as [string, number])
    .filter(([, score]) => score < 0.62);

  reports.push({
    id: station.id,
    surfaces: surfaces.length,
    footprint: [size.x, size.y, size.z].map((value) => Number(value.toFixed(1))),
    collisions,
    buried,
    outside,
    intrusions: [...intrusions].map(([name, where]) => `${name}  @ ${where}`),
    detail: surfaces
      .map((surface, index) => ({
        name: surface.name,
        center: [surface.center.x, surface.center.y, surface.center.z],
        size: [surface.size.x, surface.size.y, surface.size.z],
        best: best[index],
      }))
      .sort((a, b) => b.center[2] - a.center[2]),
    surfaceList: surfaces,
    depth,
    width: spec.size[0],
  });
}

if (process.env.AUDIT_SVG) {
  const fs = await import("node:fs/promises");
  const outDir = new URL(`../${process.env.AUDIT_SVG}/`, import.meta.url);
  await fs.mkdir(outDir, { recursive: true });
  for (const report of reports) {
    const spec = SHELL[report.id];
    const [width, , depth] = spec.size;
    const scale = 9;
    const svgWidth = width * scale;
    const svgHeight = depth * scale;
    const px = (x: number) => (x + width / 2) * scale;
    const pz = (z: number) => (depth / 2 - z) * scale;
    const spawnZ = depth / 2 - Math.max(8, depth * 0.16);
    const parts = [
      `<rect x="0" y="0" width="${svgWidth}" height="${svgHeight}" fill="#0b1018" stroke="#4a6076" stroke-width="3"/>`,
      `<line x1="${px(0)}" y1="${pz(spawnZ)}" x2="${px(0)}" y2="${pz(-depth / 2)}" stroke="#2a4a5e" stroke-width="2" stroke-dasharray="9 9"/>`,
      `<circle cx="${px(0)}" cy="${pz(spawnZ)}" r="7" fill="#69efb6"/>`,
      `<text x="${px(0) + 12}" y="${pz(spawnZ) + 5}" fill="#69efb6" font-family="monospace" font-size="14">spawn · walks this way ↓</text>`,
      `<text x="${px(0) - 18}" y="${pz(-depth / 2) + 26}" fill="#7a90a4" font-family="monospace" font-size="14">EXIT</text>`,
    ];
    for (const surface of report.detail) {
      const [cx, , cz] = surface.center;
      const [sx, , sz] = surface.size;
      const tone = surface.best < 0.62 ? "#ff6b8a" : "#47d7ff";
      parts.push(
        `<rect x="${px(cx - sx / 2)}" y="${pz(cz + sz / 2)}" width="${sx * scale}" height="${Math.max(3, sz * scale)}" fill="${tone}22" stroke="${tone}" stroke-width="2"/>`,
        `<text x="${px(cx)}" y="${pz(cz) - 7}" fill="${tone}" font-family="monospace" font-size="11" text-anchor="middle">${surface.name
          .replace(/[<>&]/g, "")
          .slice(0, 28)}</text>`,
      );
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}"><title>${report.id} plan view</title>${parts.join("")}</svg>`;
    await fs.writeFile(new URL(`${report.id}-plan.svg`, outDir), svg);

    // Two standing positions: just inside the door, and halfway down the walk.
    const eyeY = 2.15;
    for (const [label, eyeZ] of [
      ["from the entrance", spawnZ],
      ["halfway down the avenue", 2],
    ] as const) {
      await fs.writeFile(
        new URL(`${report.id}-view-${label.split(" ").pop()}.svg`, outDir),
        previewSvg(
          report.surfaceList,
          new THREE.Vector3(0, eyeY, eyeZ),
          new THREE.Vector3(0, eyeY + 0.6, eyeZ - 20),
          `${report.id} · ${label} (z=${eyeZ.toFixed(0)})`,
        ),
      );
    }
  }
  console.log(`\nplan-view schematics written to ${process.env.AUDIT_SVG}/`);
}

if (process.env.AUDIT_DUMP === "1") {
  for (const report of reports) {
    console.log(`\n### ${report.id}`);
    for (const surface of report.detail) {
      console.log(
        `  ${surface.name.slice(0, 40).padEnd(42)}` +
          `pos ${surface.center.map((v) => v.toFixed(1).padStart(6)).join(",")}` +
          `   size ${surface.size.map((v) => v.toFixed(1).padStart(5)).join(",")}` +
          `   view ${surface.best.toFixed(2)}`,
      );
    }
  }
}

const verbose = process.env.AUDIT_VERBOSE === "1";
const score = (report: Report) =>
  report.buried.length +
  report.collisions.length +
  report.outside.length +
  report.intrusions.length;
reports.sort((a, b) => score(b) - score(a));

console.log(
  "\nchamber".padEnd(28) +
    "surf".padStart(5) +
    "collide".padStart(9) +
    "buried".padStart(8) +
    "outside".padStart(9) +
    "blocks".padStart(8) +
    "   footprint (x,y,z)",
);
console.log("-".repeat(96));
for (const report of reports) {
  console.log(
    report.id.padEnd(28) +
      String(report.surfaces).padStart(5) +
      String(report.collisions.length).padStart(9) +
      String(report.buried.length).padStart(8) +
      String(report.outside.length).padStart(9) +
      String(report.intrusions.length).padStart(8) +
      `    ${report.footprint.join(" x ")}`,
  );
  if (verbose) {
    for (const [a, b, amount] of report.collisions)
      console.log(`      collide ${amount}m   ${a}  ×  ${b}`);
    for (const [name, best] of report.buried)
      console.log(`      buried  ${best.toFixed(2)}   ${name}`);
    for (const [name, where] of report.outside)
      console.log(`      outside ${where}   ${name}`);
    for (const name of report.intrusions)
      console.log(`      blocks the walkway   ${name}`);
  }
}
const totals = reports.reduce(
  (acc, report) => ({
    collisions: acc.collisions + report.collisions.length,
    buried: acc.buried + report.buried.length,
    outside: acc.outside + report.outside.length,
    intrusions: acc.intrusions + report.intrusions.length,
  }),
  { collisions: 0, buried: 0, outside: 0, intrusions: 0 },
);
console.log("-".repeat(96));
console.log(
  "TOTAL".padEnd(28) +
    "".padStart(5) +
    String(totals.collisions).padStart(9) +
    String(totals.buried).padStart(8) +
    String(totals.outside).padStart(9) +
    String(totals.intrusions).padStart(8) +
    "\n",
);
