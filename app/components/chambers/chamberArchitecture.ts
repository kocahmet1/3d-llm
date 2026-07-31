import * as THREE from "three";

import {
  addInstancedBoxes,
  getSurfaceReliefTexture,
} from "./roomKit";

/**
 * Architecture palette and construction for the 25 training chambers.
 *
 * This module deliberately does not consume a chamber's exhibit palette. The
 * room and the teaching object therefore remain independently art-directable:
 * matrices, labels, animations, navigation, and process geometry are untouched.
 */

export const CHAMBER_STATION_IDS = [
  "training-complex",
  "corpus-data-preparation",
  "token-stream-context",
  "batch-shifted-targets",
  "embedding",
  "transformer-tower",
  "transformer-block",
  "multi-head-attention",
  "one-head-qkv",
  "attention-scores",
  "causal-mask",
  "softmax-weighted-v",
  "head-recombination",
  "mlp",
  "final-hidden-state",
  "vocabulary-projection",
  "logits",
  "target-comparison",
  "loss",
  "output-backprop",
  "backprop-through-tower",
  "parameter-matrix",
  "adamw-state",
  "weight-update",
  "model-changed-next-step",
] as const;

export type ChamberStationId = (typeof CHAMBER_STATION_IDS)[number];

export type ChamberSpatialStyle =
  | "panorama"
  | "rail-gantry"
  | "vertical-foundry"
  | "split-wing"
  | "microscope"
  | "observatory";

export type ChamberFloorPattern =
  | "dots"
  | "rails"
  | "grid"
  | "arcs"
  | "converge";

export type ChamberCrownStyle =
  | "stepped"
  | "broken"
  | "fins"
  | "monolith"
  | "lantern";

export type ChamberReliefStyle =
  | "blocks"
  | "ribs"
  | "recesses"
  | "pillars"
  | "facets";

type HexColor = `#${string}`;

export interface ChamberRoomProfile {
  wall: HexColor;
  floor: HexColor;
  trim: HexColor;
  accent: HexColor;
  /** The horizon color also serves as the scene background. */
  sky: HexColor;
  /** Upper stop of the open-sky gradient dome. */
  skyZenith: HexColor;
  fog: HexColor;
  fogDensity: number;
  exposure: number;
  floorPattern: ChamberFloorPattern;
  crown: ChamberCrownStyle;
  relief: ChamberReliefStyle;
}

/**
 * A station-keyed registry rather than a phase palette. Adjacent rooms can
 * change mood while retaining the orientation chamber's common vocabulary:
 * polished dark floors, tall modular walls, deep portals, and luminous inlays.
 */
export const CHAMBER_ROOM_PROFILES = {
  "training-complex": {
    wall: "#8273aa",
    floor: "#18372f",
    trim: "#b9c7d2",
    accent: "#ff9bd5",
    sky: "#c4d2d6",
    skyZenith: "#39436d",
    fog: "#b8c9ce",
    fogDensity: 0.0028,
    exposure: 1.02,
    floorPattern: "dots",
    crown: "broken",
    relief: "blocks",
  },
  "corpus-data-preparation": {
    wall: "#526750",
    floor: "#17261e",
    trim: "#bac7a8",
    accent: "#ccef89",
    sky: "#d7dfb4",
    skyZenith: "#2a2139",
    fog: "#a9bc91",
    fogDensity: 0.003,
    exposure: 1.04,
    floorPattern: "arcs",
    crown: "monolith",
    relief: "ribs",
  },
  "token-stream-context": {
    wall: "#315966",
    floor: "#102a32",
    trim: "#9bcbd2",
    accent: "#5fe5df",
    sky: "#86ded9",
    skyZenith: "#241443",
    fog: "#66aaa8",
    fogDensity: 0.0032,
    exposure: 1.01,
    floorPattern: "rails",
    crown: "stepped",
    relief: "ribs",
  },
  "batch-shifted-targets": {
    wall: "#6e4f65",
    floor: "#281b29",
    trim: "#dcafbd",
    accent: "#ff785f",
    sky: "#ffc0aa",
    skyZenith: "#4b213f",
    fog: "#bd7889",
    fogDensity: 0.0032,
    exposure: 1.03,
    floorPattern: "converge",
    crown: "broken",
    relief: "blocks",
  },
  embedding: {
    wall: "#285474",
    floor: "#0d2738",
    trim: "#8fc5da",
    accent: "#5cddff",
    sky: "#73dfe8",
    skyZenith: "#17103f",
    fog: "#559cad",
    fogDensity: 0.0031,
    exposure: 1.03,
    floorPattern: "grid",
    crown: "fins",
    relief: "facets",
  },
  "transformer-tower": {
    wall: "#71679b",
    floor: "#24233a",
    trim: "#c6bde5",
    accent: "#f59add",
    sky: "#adc9f2",
    skyZenith: "#29193c",
    fog: "#8b83ad",
    fogDensity: 0.0028,
    exposure: 1.02,
    floorPattern: "converge",
    crown: "stepped",
    relief: "pillars",
  },
  "transformer-block": {
    wall: "#4a608a",
    floor: "#17243b",
    trim: "#aabbdc",
    accent: "#89c7ff",
    sky: "#98cdec",
    skyZenith: "#25204d",
    fog: "#768da9",
    fogDensity: 0.0029,
    exposure: 1.01,
    floorPattern: "rails",
    crown: "lantern",
    relief: "blocks",
  },
  "multi-head-attention": {
    wall: "#5d587f",
    floor: "#211d36",
    trim: "#c7bfdd",
    accent: "#8ce7ff",
    sky: "#a9d8e7",
    skyZenith: "#26163f",
    fog: "#85829c",
    fogDensity: 0.003,
    exposure: 1.03,
    floorPattern: "arcs",
    crown: "broken",
    relief: "facets",
  },
  "one-head-qkv": {
    wall: "#3f556f",
    floor: "#142330",
    trim: "#a8bfd0",
    accent: "#6fd6ff",
    sky: "#91d5e0",
    skyZenith: "#17183e",
    fog: "#668e9e",
    fogDensity: 0.003,
    exposure: 1.02,
    floorPattern: "grid",
    crown: "fins",
    relief: "recesses",
  },
  "attention-scores": {
    wall: "#4b6671",
    floor: "#15272d",
    trim: "#a9ccd1",
    accent: "#60eee0",
    sky: "#9be7d9",
    skyZenith: "#18333e",
    fog: "#6da9a2",
    fogDensity: 0.0032,
    exposure: 1.02,
    floorPattern: "grid",
    crown: "lantern",
    relief: "recesses",
  },
  "causal-mask": {
    wall: "#75464c",
    floor: "#2d171a",
    trim: "#d0a29d",
    accent: "#ff6d55",
    sky: "#efaca0",
    skyZenith: "#43151d",
    fog: "#b6706d",
    fogDensity: 0.0031,
    exposure: 0.99,
    floorPattern: "converge",
    crown: "monolith",
    relief: "ribs",
  },
  "softmax-weighted-v": {
    wall: "#3e6b67",
    floor: "#122a28",
    trim: "#9bcfc3",
    accent: "#78efc7",
    sky: "#a5ecd6",
    skyZenith: "#15323b",
    fog: "#6aa99d",
    fogDensity: 0.0032,
    exposure: 1.03,
    floorPattern: "arcs",
    crown: "stepped",
    relief: "facets",
  },
  "head-recombination": {
    wall: "#4d647a",
    floor: "#172630",
    trim: "#a8cad5",
    accent: "#70e4ef",
    sky: "#9fe2e4",
    skyZenith: "#1d2849",
    fog: "#709daa",
    fogDensity: 0.0029,
    exposure: 1.02,
    floorPattern: "rails",
    crown: "broken",
    relief: "blocks",
  },
  mlp: {
    wall: "#72566e",
    floor: "#281d2a",
    trim: "#d5b6cc",
    accent: "#ffa0cf",
    sky: "#edbfd5",
    skyZenith: "#401b3e",
    fog: "#aa7f9c",
    fogDensity: 0.003,
    exposure: 1.03,
    floorPattern: "dots",
    crown: "lantern",
    relief: "pillars",
  },
  "final-hidden-state": {
    wall: "#385f70",
    floor: "#112832",
    trim: "#9dc9d6",
    accent: "#65dcff",
    sky: "#96e0e8",
    skyZenith: "#172345",
    fog: "#6497aa",
    fogDensity: 0.0028,
    exposure: 1.02,
    floorPattern: "converge",
    crown: "fins",
    relief: "facets",
  },
  "vocabulary-projection": {
    wall: "#526b5c",
    floor: "#17291e",
    trim: "#b2ceb6",
    accent: "#80f0b0",
    sky: "#ace8c5",
    skyZenith: "#17383a",
    fog: "#78a58b",
    fogDensity: 0.0031,
    exposure: 1.03,
    floorPattern: "grid",
    crown: "stepped",
    relief: "recesses",
  },
  logits: {
    wall: "#66516f",
    floor: "#241b2b",
    trim: "#ccb4d5",
    accent: "#d49cff",
    sky: "#d4c2eb",
    skyZenith: "#28153e",
    fog: "#957da7",
    fogDensity: 0.0032,
    exposure: 1.02,
    floorPattern: "dots",
    crown: "broken",
    relief: "blocks",
  },
  "target-comparison": {
    wall: "#755854",
    floor: "#2b201d",
    trim: "#d6b7aa",
    accent: "#ffb06f",
    sky: "#efc7a9",
    skyZenith: "#3d242c",
    fog: "#a88677",
    fogDensity: 0.003,
    exposure: 1.03,
    floorPattern: "rails",
    crown: "lantern",
    relief: "ribs",
  },
  loss: {
    wall: "#784248",
    floor: "#2d151a",
    trim: "#d3a0a3",
    accent: "#ff655d",
    sky: "#efaaa2",
    skyZenith: "#3b1019",
    fog: "#ad6568",
    fogDensity: 0.0033,
    exposure: 0.98,
    floorPattern: "arcs",
    crown: "monolith",
    relief: "pillars",
  },
  "output-backprop": {
    wall: "#5e496c",
    floor: "#21182a",
    trim: "#c1acd1",
    accent: "#eb8fff",
    sky: "#d7b6e5",
    skyZenith: "#2d1740",
    fog: "#8e70a0",
    fogDensity: 0.0031,
    exposure: 1,
    floorPattern: "converge",
    crown: "broken",
    relief: "facets",
  },
  "backprop-through-tower": {
    wall: "#66445d",
    floor: "#251924",
    trim: "#c9a8bc",
    accent: "#ff8fc0",
    sky: "#e8b7ce",
    skyZenith: "#39152e",
    fog: "#9e6d89",
    fogDensity: 0.003,
    exposure: 1,
    floorPattern: "rails",
    crown: "stepped",
    relief: "pillars",
  },
  "parameter-matrix": {
    wall: "#365d65",
    floor: "#11272b",
    trim: "#9ac8c8",
    accent: "#5cf0d5",
    sky: "#99e6d4",
    skyZenith: "#16323a",
    fog: "#64a098",
    fogDensity: 0.0032,
    exposure: 1.02,
    floorPattern: "grid",
    crown: "fins",
    relief: "recesses",
  },
  "adamw-state": {
    wall: "#625b48",
    floor: "#262217",
    trim: "#c9c09c",
    accent: "#f0d96f",
    sky: "#e4d99f",
    skyZenith: "#333128",
    fog: "#999172",
    fogDensity: 0.003,
    exposure: 1.03,
    floorPattern: "dots",
    crown: "lantern",
    relief: "blocks",
  },
  "weight-update": {
    wall: "#6f4d46",
    floor: "#291b17",
    trim: "#d2ad9e",
    accent: "#ff8f62",
    sky: "#efb69d",
    skyZenith: "#3a1d25",
    fog: "#a77468",
    fogDensity: 0.0031,
    exposure: 1.01,
    floorPattern: "converge",
    crown: "monolith",
    relief: "ribs",
  },
  "model-changed-next-step": {
    wall: "#556b82",
    floor: "#162734",
    trim: "#b5cadb",
    accent: "#77ecff",
    sky: "#a8e5e9",
    skyZenith: "#26244d",
    fog: "#789eae",
    fogDensity: 0.0026,
    exposure: 1.05,
    floorPattern: "arcs",
    crown: "stepped",
    relief: "blocks",
  },
} as const satisfies Readonly<
  Record<ChamberStationId, Readonly<ChamberRoomProfile>>
>;

const SPATIAL_STYLE_FALLBACKS: Readonly<
  Record<ChamberSpatialStyle, Readonly<ChamberRoomProfile>>
> = {
  panorama: CHAMBER_ROOM_PROFILES["model-changed-next-step"],
  "rail-gantry": CHAMBER_ROOM_PROFILES["token-stream-context"],
  "vertical-foundry": CHAMBER_ROOM_PROFILES["transformer-tower"],
  "split-wing": CHAMBER_ROOM_PROFILES["transformer-block"],
  microscope: CHAMBER_ROOM_PROFILES["parameter-matrix"],
  observatory: CHAMBER_ROOM_PROFILES["final-hidden-state"],
};

function isStationId(stationId: string): stationId is ChamberStationId {
  return Object.prototype.hasOwnProperty.call(CHAMBER_ROOM_PROFILES, stationId);
}

function isSpatialStyle(style: string): style is ChamberSpatialStyle {
  return Object.prototype.hasOwnProperty.call(SPATIAL_STYLE_FALLBACKS, style);
}

export function getChamberRoomProfile(
  stationId: string,
  spatialStyle: ChamberSpatialStyle | string = "panorama",
): Readonly<ChamberRoomProfile> {
  if (isStationId(stationId)) return CHAMBER_ROOM_PROFILES[stationId];
  return isSpatialStyle(spatialStyle)
    ? SPATIAL_STYLE_FALLBACKS[spatialStyle]
    : SPATIAL_STYLE_FALLBACKS.panorama;
}

export interface ChamberEnvironment {
  background: HexColor;
  fogColor: HexColor;
  fogDensity: number;
  exposure: number;
}

export function getChamberEnvironment(stationId: string): ChamberEnvironment {
  const profile = getChamberRoomProfile(stationId, "panorama");
  return {
    background: profile.sky,
    fogColor: profile.fog,
    fogDensity: profile.fogDensity,
    exposure: profile.exposure,
  };
}

export interface CraftedChamberDetailsOptions {
  width: number;
  height: number;
  depth: number;
  /**
   * Centre of the existing structural floor slab. The visible walking surface
   * is placed 0.2 units above it, matching the chamber navigation deck.
   */
  floorY: number;
  doorWidth: number;
  doorHeight: number;
  doorBottom: number;
  stationId: string;
  stationIndex: number;
  spatialStyle: ChamberSpatialStyle | string;
}

interface BoxBatch {
  positions: THREE.Vector3[];
  scales: THREE.Vector3[];
  rotations: THREE.Euler[];
  colors: THREE.Color[];
}

function createBatch(): BoxBatch {
  return {
    positions: [],
    scales: [],
    rotations: [],
    colors: [],
  };
}

function pushBox(
  batch: BoxBatch,
  position: THREE.Vector3,
  scale: THREE.Vector3,
  color: THREE.Color,
  rotation = new THREE.Euler(),
): void {
  batch.positions.push(position);
  batch.scales.push(scale);
  batch.rotations.push(rotation);
  batch.colors.push(color);
}

function addBoxBatch(
  group: THREE.Group,
  name: string,
  batch: BoxBatch,
  material: THREE.Material,
  castsShadow: boolean,
  receivesShadow: boolean,
): THREE.InstancedMesh | null {
  if (batch.positions.length === 0) return null;
  const mesh = addInstancedBoxes(
    group,
    batch.positions,
    new THREE.Vector3(1, 1, 1),
    material,
    batch.rotations,
    batch.scales,
    batch.colors,
  );
  mesh.name = name;
  mesh.castShadow = castsShadow;
  mesh.receiveShadow = receivesShadow;
  // The world performs a later shadow pass over authored exhibit meshes. Keep
  // the architecture's deliberate shadow choices (especially transparent
  // glow/recess batches) from being overwritten by that pass.
  mesh.userData.preserveShadowSettings = true;
  group.add(mesh);
  return mesh;
}

function textSeed(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** Stable [0, 1) noise used only for architectural cadence. */
function seededUnit(seed: number, index: number): number {
  let value = (seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function toward(
  color: THREE.ColorRepresentation,
  target: THREE.ColorRepresentation,
  amount: number,
): THREE.Color {
  return new THREE.Color(color).lerp(
    new THREE.Color(target),
    THREE.MathUtils.clamp(amount, 0, 1),
  );
}

function addSkyDome(
  group: THREE.Group,
  width: number,
  height: number,
  depth: number,
  floorY: number,
  profile: Readonly<ChamberRoomProfile>,
): void {
  const radius = Math.max(width, height, depth) * 1.55;
  const geometry = new THREE.SphereGeometry(radius, 32, 16);
  const position = geometry.getAttribute("position");
  const horizon = new THREE.Color(profile.sky);
  const zenith = new THREE.Color(profile.skyZenith);
  const colors = new Float32Array(position.count * 3);
  const mixed = new THREE.Color();

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const normalizedY = THREE.MathUtils.clamp(
      position.getY(vertex) / radius,
      -1,
      1,
    );
    const rawMix = THREE.MathUtils.clamp((normalizedY + 0.08) / 0.92, 0, 1);
    const mix = rawMix * rawMix * (3 - 2 * rawMix);
    mixed.copy(horizon).lerp(zenith, mix);
    colors[vertex * 3] = mixed.r;
    colors[vertex * 3 + 1] = mixed.g;
    colors[vertex * 3 + 2] = mixed.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const dome = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      transparent: true,
      opacity: 1,
    }),
  );
  dome.name = "chamber-architecture-open-sky-gradient";
  dome.position.y = floorY + height * 0.28;
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  group.add(dome);
}

function addFloor(
  group: THREE.Group,
  width: number,
  depth: number,
  floorY: number,
  profile: Readonly<ChamberRoomProfile>,
): number {
  const floorThickness = 0.4;
  const surfaceY = floorY + floorThickness / 2;
  const reliefMap = getSurfaceReliefTexture("floor");

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(width, floorThickness, depth),
    new THREE.MeshStandardMaterial({
      color: profile.floor,
      roughness: 0.34,
      metalness: 0.2,
      normalMap: reliefMap,
      normalScale: new THREE.Vector2(0.09, 0.09),
      emissive: profile.floor,
      emissiveIntensity: 0.12,
    }),
  );
  slab.name = "chamber-architecture-floor-slab";
  slab.position.y = floorY;
  slab.receiveShadow = true;
  slab.userData.preserveShadowSettings = true;
  group.add(slab);

  // A light-weight polished veil gives controlled highlights without a
  // Reflector, render target, or duplicate scene pass.
  const veil = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.36, depth - 0.36),
    new THREE.MeshStandardMaterial({
      color: toward(profile.floor, "#05080d", 0.2),
      roughness: 0.2,
      metalness: 0.42,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
  veil.name = "chamber-architecture-polished-floor-veil";
  veil.rotation.x = -Math.PI / 2;
  veil.position.y = surfaceY + 0.006;
  veil.receiveShadow = true;
  veil.userData.preserveShadowSettings = true;
  veil.renderOrder = 2;
  group.add(veil);
  return surfaceY;
}

function addFloorInlays(
  group: THREE.Group,
  width: number,
  depth: number,
  surfaceY: number,
  seed: number,
  profile: Readonly<ChamberRoomProfile>,
): void {
  const inlayMaterial = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    vertexColors: true,
    transparent: true,
    opacity: 0.68,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const accent = new THREE.Color(profile.accent);
  const trim = new THREE.Color(profile.trim);
  const batch = createBatch();
  const y = surfaceY + 0.028;
  const usableWidth = Math.max(6, width - 6);
  const usableDepth = Math.max(8, depth - 5);

  switch (profile.floorPattern) {
    case "dots": {
      const xCount = Math.max(5, Math.min(9, Math.round(usableWidth / 5)));
      const zCount = Math.max(8, Math.min(18, Math.round(usableDepth / 4.6)));
      for (let row = 0; row < zCount; row += 1) {
        const z =
          -usableDepth / 2 + ((row + 0.5) * usableDepth) / zCount;
        for (let column = 0; column < xCount; column += 1) {
          const x =
            -usableWidth / 2 +
            ((column + 0.5) * usableWidth) / xCount;
          const jitter = seededUnit(seed, row * xCount + column);
          const size = 0.13 + jitter * 0.09;
          pushBox(
            batch,
            new THREE.Vector3(x, y, z),
            new THREE.Vector3(size, 0.026, size),
            accent.clone().lerp(trim, jitter * 0.42),
          );
        }
      }
      break;
    }
    case "rails": {
      const railX = [-usableWidth * 0.31, 0, usableWidth * 0.31];
      railX.forEach((x, index) => {
        pushBox(
          batch,
          new THREE.Vector3(x, y, 0),
          new THREE.Vector3(index === 1 ? 0.09 : 0.065, 0.026, usableDepth),
          index === 1 ? accent : trim.clone().lerp(accent, 0.52),
        );
      });
      const thresholdCount = Math.max(6, Math.round(usableDepth / 8));
      for (let index = 0; index < thresholdCount; index += 1) {
        const z =
          -usableDepth / 2 +
          ((index + 0.5) * usableDepth) / thresholdCount;
        pushBox(
          batch,
          new THREE.Vector3(0, y, z),
          new THREE.Vector3(usableWidth * 0.68, 0.02, 0.045),
          accent.clone().lerp(trim, index % 2 ? 0.6 : 0.2),
        );
      }
      break;
    }
    case "grid": {
      const longitudinalCount = 5;
      for (let index = 0; index < longitudinalCount; index += 1) {
        const x =
          -usableWidth * 0.36 +
          (index * usableWidth * 0.72) / (longitudinalCount - 1);
        pushBox(
          batch,
          new THREE.Vector3(x, y, 0),
          new THREE.Vector3(0.045, 0.022, usableDepth),
          index === 2 ? accent : trim.clone().lerp(accent, 0.38),
        );
      }
      const crossCount = Math.max(7, Math.min(13, Math.round(depth / 6)));
      for (let index = 0; index < crossCount; index += 1) {
        const z =
          -usableDepth / 2 +
          (index * usableDepth) / Math.max(1, crossCount - 1);
        pushBox(
          batch,
          new THREE.Vector3(0, y, z),
          new THREE.Vector3(usableWidth * 0.72, 0.022, 0.045),
          trim.clone().lerp(accent, index % 3 === 0 ? 0.7 : 0.26),
        );
      }
      break;
    }
    case "converge": {
      const addRailBetween = (
        x0: number,
        z0: number,
        x1: number,
        z1: number,
        color: THREE.Color,
      ) => {
        const dx = x1 - x0;
        const dz = z1 - z0;
        pushBox(
          batch,
          new THREE.Vector3((x0 + x1) / 2, y, (z0 + z1) / 2),
          new THREE.Vector3(0.075, 0.026, Math.hypot(dx, dz)),
          color,
          new THREE.Euler(0, Math.atan2(dx, dz), 0),
        );
      };
      for (const side of [-1, 1]) {
        addRailBetween(
          side * usableWidth * 0.42,
          usableDepth / 2,
          side * usableWidth * 0.12,
          -usableDepth / 2,
          accent.clone().lerp(trim, side < 0 ? 0.18 : 0.46),
        );
        addRailBetween(
          side * usableWidth * 0.22,
          usableDepth / 2,
          side * usableWidth * 0.035,
          -usableDepth / 2,
          trim.clone().lerp(accent, 0.56),
        );
      }
      const markerCount = Math.max(7, Math.round(usableDepth / 7));
      for (let index = 0; index < markerCount; index += 1) {
        const z =
          usableDepth / 2 -
          ((index + 0.5) * usableDepth) / markerCount;
        const taper = (z + usableDepth / 2) / usableDepth;
        pushBox(
          batch,
          new THREE.Vector3(0, y, z),
          new THREE.Vector3(
            0.5 + taper * usableWidth * 0.12,
            0.022,
            0.045,
          ),
          accent.clone().lerp(trim, 0.3 + taper * 0.35),
        );
      }
      break;
    }
    case "arcs":
      break;
  }

  addBoxBatch(
    group,
    `chamber-architecture-floor-inlay-${profile.floorPattern}`,
    batch,
    inlayMaterial,
    false,
    false,
  );

  if (profile.floorPattern !== "arcs") return;

  const ringCount = Math.max(4, Math.min(7, Math.round(depth / 13)));
  const geometry = new THREE.RingGeometry(
    0.97,
    1,
    48,
    1,
    -Math.PI * 0.72,
    Math.PI * 1.44,
  );
  const arcs = new THREE.InstancedMesh(geometry, inlayMaterial, ringCount);
  const dummy = new THREE.Object3D();
  for (let index = 0; index < ringCount; index += 1) {
    const radius =
      Math.min(width * 0.37, 2.8 + (index % 3) * 1.55);
    const z =
      -usableDepth / 2 +
      ((index + 0.5) * usableDepth) / ringCount;
    dummy.position.set(0, y, z);
    dummy.rotation.set(-Math.PI / 2, 0, index % 2 ? Math.PI : 0);
    dummy.scale.set(radius, radius, 1);
    dummy.updateMatrix();
    arcs.setMatrixAt(index, dummy.matrix);
    arcs.setColorAt(
      index,
      accent.clone().lerp(trim, 0.18 + seededUnit(seed, index) * 0.48),
    );
  }
  arcs.instanceMatrix.needsUpdate = true;
  if (arcs.instanceColor) arcs.instanceColor.needsUpdate = true;
  arcs.name = "chamber-architecture-floor-inlay-arcs";
  arcs.renderOrder = 3;
  group.add(arcs);
}

function addWallArchitecture(
  group: THREE.Group,
  options: {
    width: number;
    height: number;
    depth: number;
    floorY: number;
    doorWidth: number;
    doorHeight: number;
    doorBottom: number;
    seed: number;
    spatialStyle: ChamberSpatialStyle;
    profile: Readonly<ChamberRoomProfile>;
  },
): void {
  const {
    width,
    height,
    depth,
    floorY,
    doorWidth,
    doorHeight,
    doorBottom,
    seed,
    spatialStyle,
    profile,
  } = options;
  const wallThickness = 0.46;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const wallTop = floorY + height;
  const wallCenterY = floorY + height / 2;
  const doorTop = Math.min(doorBottom + doorHeight, wallTop - 1);
  const doorCenterY = (doorBottom + doorTop) / 2;
  const clearDoorHeight = doorTop - doorBottom;
  const sideColumnWidth = Math.max(0.8, (width - doorWidth) / 2);
  const wallNormal = getSurfaceReliefTexture("wall");

  const wallMaterial = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    vertexColors: true,
    roughness: 0.76,
    metalness: 0.1,
    normalMap: wallNormal,
    normalScale: new THREE.Vector2(0.2, 0.2),
    // A restrained self-light keeps the room palette legible even when the
    // teaching exhibit is intentionally lit as the brightest object.
    emissive: profile.wall,
    emissiveIntensity: 0.24,
  });
  const wallBatch = createBatch();
  const wallColor = new THREE.Color(profile.wall);
  const endColor = toward(profile.wall, "#10131a", 0.12);

  for (const side of [-1, 1]) {
    pushBox(
      wallBatch,
      new THREE.Vector3(side * halfWidth, wallCenterY, 0),
      new THREE.Vector3(wallThickness, height, depth),
      side < 0 ? wallColor : toward(profile.wall, profile.trim, 0.035),
    );
  }

  for (const end of [-1, 1]) {
    const z = end * halfDepth;
    for (const side of [-1, 1]) {
      pushBox(
        wallBatch,
        new THREE.Vector3(
          side * (doorWidth + sideColumnWidth) / 2,
          wallCenterY,
          z,
        ),
        new THREE.Vector3(sideColumnWidth, height, wallThickness),
        end < 0 ? endColor : wallColor,
      );
    }
    const capHeight = Math.max(0.4, wallTop - doorTop);
    pushBox(
      wallBatch,
      new THREE.Vector3(0, doorTop + capHeight / 2, z),
      new THREE.Vector3(doorWidth, capHeight, wallThickness),
      end < 0 ? endColor : wallColor,
    );
    const sillHeight = Math.max(0, doorBottom - floorY);
    if (sillHeight > 0.035) {
      pushBox(
        wallBatch,
        new THREE.Vector3(0, floorY + sillHeight / 2, z),
        new THREE.Vector3(doorWidth, sillHeight, wallThickness),
        end < 0 ? endColor : wallColor,
      );
    }
  }
  addBoxBatch(
    group,
    "chamber-architecture-open-top-wall-backing",
    wallBatch,
    wallMaterial,
    true,
    true,
  );

  const darkMaterial = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.04,
    emissive: toward(profile.floor, "#000000", 0.52),
    emissiveIntensity: 0.08,
  });
  const reliefMaterial = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    vertexColors: true,
    roughness: 0.57,
    metalness: 0.18,
    normalMap: wallNormal,
    normalScale: new THREE.Vector2(0.24, 0.24),
    emissive: toward(profile.wall, profile.accent, 0.16),
    emissiveIntensity: 0.18,
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    vertexColors: true,
    roughness: 0.36,
    metalness: 0.52,
    emissive: toward(profile.trim, profile.accent, 0.18),
    emissiveIntensity: 0.17,
  });
  const glowMaterial = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    vertexColors: true,
    roughness: 0.38,
    metalness: 0.06,
    emissive: profile.accent,
    emissiveIntensity: 1.15,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  const recessBatch = createBatch();
  const reliefBatch = createBatch();
  const trimBatch = createBatch();
  const glowBatch = createBatch();

  const targetBaySpacing: Record<ChamberSpatialStyle, number> = {
    panorama: 10.5,
    "rail-gantry": 7.8,
    "vertical-foundry": 9.8,
    "split-wing": 8.7,
    microscope: 7.4,
    observatory: 10.8,
  };
  const bayCount = Math.max(
    4,
    Math.min(11, Math.round(depth / targetBaySpacing[spatialStyle])),
  );
  const baySpan = (depth - 4.4) / bayCount;
  const usableReliefHeight = Math.max(12, height - 8);
  const reliefBottom = floorY + 3.1;
  const reliefTop = wallTop - 3.2;
  const reliefCenterY = (reliefBottom + reliefTop) / 2;
  const innerWallFace = halfWidth - wallThickness / 2;
  const darkColor = toward(profile.wall, profile.floor, 0.66);
  const trimColor = new THREE.Color(profile.trim);
  const accentColor = new THREE.Color(profile.accent);

  for (let bay = 0; bay < bayCount; bay += 1) {
    const z = -depth / 2 + 2.2 + baySpan * (bay + 0.5);
    const variation = seededUnit(seed, bay);
    for (const side of [-1, 1]) {
      const recessDepth = 0.13;
      pushBox(
        recessBatch,
        new THREE.Vector3(
          side * (innerWallFace - recessDepth / 2 - 0.012),
          reliefCenterY,
          z,
        ),
        new THREE.Vector3(
          recessDepth,
          usableReliefHeight * (profile.relief === "recesses" ? 0.7 : 0.48),
          baySpan * 0.68,
        ),
        darkColor
          .clone()
          .lerp(new THREE.Color(profile.wall), variation * 0.08),
      );

      // Keep every relief outside the unchanged navigation envelope. The
      // modules still read as dimensional wall craft without becoming
      // collision geometry that the visitor can enter.
      const reliefDepth =
        profile.relief === "facets" ? 0.5 : profile.relief === "pillars" ? 0.48 : 0.38;
      const x = side * (innerWallFace - reliefDepth / 2 - 0.05);
      if (profile.relief === "ribs") {
        for (const offset of [-0.26, 0.26]) {
          pushBox(
            reliefBatch,
            new THREE.Vector3(
              x,
              reliefCenterY,
              z + offset * baySpan,
            ),
            new THREE.Vector3(
              reliefDepth,
              usableReliefHeight * (0.65 + variation * 0.12),
              Math.max(0.22, baySpan * 0.12),
            ),
            toward(profile.wall, profile.trim, 0.13 + variation * 0.12),
          );
        }
      } else if (profile.relief === "pillars") {
        pushBox(
          reliefBatch,
          new THREE.Vector3(x, reliefCenterY, z),
          new THREE.Vector3(
            reliefDepth,
            usableReliefHeight * 0.82,
            baySpan * 0.26,
          ),
          toward(profile.wall, profile.trim, 0.15 + variation * 0.12),
        );
        for (const y of [reliefBottom + 0.8, reliefTop - 0.8]) {
          pushBox(
            trimBatch,
            new THREE.Vector3(
              side * (innerWallFace - reliefDepth * 0.62),
              y,
              z,
            ),
            new THREE.Vector3(
              reliefDepth * 1.4,
              0.42,
              baySpan * 0.44,
            ),
            trimColor.clone().lerp(accentColor, variation * 0.18),
          );
        }
      } else {
        const tierCount = profile.relief === "blocks" ? 3 : 2;
        for (let tier = 0; tier < tierCount; tier += 1) {
          const tierVariation = seededUnit(seed, bay * 7 + tier + side * 31);
          const tierHeight =
            usableReliefHeight *
            (profile.relief === "recesses" ? 0.17 : 0.2 + tierVariation * 0.08);
          const tierY =
            reliefBottom +
            usableReliefHeight * (tier + 0.72) / (tierCount + 0.42);
          const rotation =
            profile.relief === "facets"
              ? new THREE.Euler(
                  (tierVariation - 0.5) * 0.08,
                  0,
                  0,
                )
              : new THREE.Euler();
          pushBox(
            reliefBatch,
            new THREE.Vector3(
              x,
              tierY,
              z + (tierVariation - 0.5) * baySpan * 0.16,
            ),
            new THREE.Vector3(
              reliefDepth,
              tierHeight,
              baySpan *
                (profile.relief === "recesses"
                  ? 0.54
                  : 0.62 + tierVariation * 0.18),
            ),
            toward(
              profile.wall,
              tier % 2 ? profile.trim : profile.accent,
              0.07 + tierVariation * 0.12,
            ),
            rotation,
          );
        }
      }

      // A low, quiet datum keeps the architecture legible at walking height.
      pushBox(
        trimBatch,
        new THREE.Vector3(
          side * (innerWallFace - 0.24),
          floorY + 2.2,
          z,
        ),
        new THREE.Vector3(0.24, 0.16, baySpan * 0.7),
        trimColor.clone().lerp(accentColor, 0.16 + variation * 0.16),
      );
    }
  }

  // End-wall relief remains entirely in the solid columns beside each portal.
  const endModuleWidth = Math.max(1.1, sideColumnWidth * 0.58);
  for (const end of [-1, 1]) {
    const inward = -end;
    const z = end * halfDepth + inward * (wallThickness / 2 + 0.24);
    for (const side of [-1, 1]) {
      const x = side * (doorWidth / 2 + sideColumnWidth / 2);
      const moduleHeight =
        Math.min(height * 0.38, Math.max(6, clearDoorHeight * 0.9));
      pushBox(
        recessBatch,
        new THREE.Vector3(x, doorCenterY + moduleHeight * 0.2, z),
        new THREE.Vector3(endModuleWidth, moduleHeight, 0.14),
        darkColor,
      );
      for (const offset of [-0.28, 0.28]) {
        pushBox(
          reliefBatch,
          new THREE.Vector3(
            x + offset * endModuleWidth,
            doorCenterY + moduleHeight * 0.2,
            z + inward * 0.26,
          ),
          new THREE.Vector3(
            Math.max(0.3, endModuleWidth * 0.18),
            moduleHeight * 0.86,
            0.5,
          ),
          toward(profile.wall, profile.trim, 0.16 + Math.abs(offset) * 0.2),
        );
      }
    }
  }

  // Ragged parapet modules and their glowing undersides: wall crowns, never a
  // horizontal roof plane, so the sky stays open across the full chamber.
  const crownSpan =
    profile.crown === "fins"
      ? 3.5
      : profile.crown === "monolith"
        ? 8.5
        : 6.2;
  const crownCount = Math.max(4, Math.min(14, Math.ceil(depth / crownSpan)));
  const crownCell = (depth - 1.4) / crownCount;
  for (let index = 0; index < crownCount; index += 1) {
    const z = -depth / 2 + 0.7 + crownCell * (index + 0.5);
    const variation = seededUnit(seed + 97, index);
    const keep =
      profile.crown !== "broken" || variation > 0.2 || index % 3 === 0;
    if (!keep) continue;
    let crownHeight = 2.5 + variation * 2.1;
    let moduleSpan = crownCell * 0.82;
    let crownDepth = 0.95;
    if (profile.crown === "fins") {
      crownHeight = 5.2 + variation * 2.2;
      moduleSpan = Math.max(0.46, crownCell * 0.28);
      crownDepth = 1.15;
    } else if (profile.crown === "monolith") {
      crownHeight = 6.2 + variation * 1.5;
      moduleSpan = crownCell * 0.92;
      crownDepth = 1.05;
    } else if (profile.crown === "stepped") {
      crownHeight = 2.8 + (index % 3) * 1.25;
    } else if (profile.crown === "lantern") {
      crownHeight = index % 2 ? 4.8 : 2.7;
      moduleSpan = crownCell * 0.72;
    }
    const crownY = wallTop - crownHeight / 2;
    for (const side of [-1, 1]) {
      const x = side * (innerWallFace - crownDepth / 2 - 0.1);
      pushBox(
        trimBatch,
        new THREE.Vector3(x, crownY, z),
        new THREE.Vector3(crownDepth, crownHeight, moduleSpan),
        toward(profile.wall, profile.trim, 0.2 + variation * 0.18),
      );
      pushBox(
        glowBatch,
        new THREE.Vector3(
          side * (innerWallFace - crownDepth - 0.13),
          crownY - crownHeight / 2 - 0.075,
          z,
        ),
        new THREE.Vector3(0.1, 0.09, moduleSpan * 0.72),
        accentColor.clone().lerp(trimColor, variation * 0.42),
      );
    }
  }

  const endCrownCount = Math.max(5, Math.min(11, Math.round(width / 5.5)));
  const endCrownCell = (width - 1.4) / endCrownCount;
  for (const end of [-1, 1]) {
    const inward = -end;
    for (let index = 0; index < endCrownCount; index += 1) {
      const x = -width / 2 + 0.7 + endCrownCell * (index + 0.5);
      const variation = seededUnit(seed + end * 113, index);
      if (profile.crown === "broken" && variation < 0.22) continue;
      const crownHeight =
        profile.crown === "fins"
          ? 5 + variation * 1.7
          : profile.crown === "stepped"
            ? 2.6 + (index % 3) * 1.05
            : 3.2 + variation * 2.2;
      const moduleWidth =
        profile.crown === "fins"
          ? Math.max(0.5, endCrownCell * 0.3)
          : endCrownCell * 0.8;
      const z =
        end * halfDepth + inward * (wallThickness / 2 + 0.48);
      pushBox(
        trimBatch,
        new THREE.Vector3(x, wallTop - crownHeight / 2, z),
        new THREE.Vector3(moduleWidth, crownHeight, 0.92),
        toward(profile.wall, profile.trim, 0.19 + variation * 0.2),
      );
      if (index % 2 === 0 || profile.crown === "lantern") {
        pushBox(
          glowBatch,
          new THREE.Vector3(
            x,
            wallTop - crownHeight - 0.07,
            z + inward * 0.52,
          ),
          new THREE.Vector3(moduleWidth * 0.68, 0.08, 0.09),
          accentColor.clone().lerp(trimColor, variation * 0.36),
        );
      }
    }
  }

  // Deep two-step portal surrounds. Posts stay outside the clear door width;
  // lintels stay above doorTop, and the flush threshold does not block travel.
  for (const end of [-1, 1]) {
    const inward = -end;
    const outerZ =
      end * halfDepth + inward * (wallThickness / 2 + 0.48);
    const innerZ = outerZ + inward * 0.54;
    const outerPostWidth = 0.58;
    const outerFrameColor =
      end < 0
        ? trimColor.clone().lerp(new THREE.Color(profile.floor), 0.16)
        : trimColor.clone();
    for (const side of [-1, 1]) {
      pushBox(
        trimBatch,
        new THREE.Vector3(
          side * (doorWidth / 2 + outerPostWidth / 2 + 0.12),
          doorCenterY,
          outerZ,
        ),
        new THREE.Vector3(
          outerPostWidth,
          clearDoorHeight + 1.12,
          1.25,
        ),
        outerFrameColor,
      );
      pushBox(
        glowBatch,
        new THREE.Vector3(
          side * (doorWidth / 2 + 0.1),
          doorCenterY,
          innerZ,
        ),
        new THREE.Vector3(0.11, clearDoorHeight - 0.25, 0.16),
        accentColor.clone().lerp(trimColor, end < 0 ? 0.48 : 0.2),
      );
    }
    pushBox(
      trimBatch,
      new THREE.Vector3(0, doorTop + 0.38, outerZ),
      new THREE.Vector3(doorWidth + 1.42, 0.76, 1.25),
      outerFrameColor,
    );
    pushBox(
      glowBatch,
      new THREE.Vector3(0, doorTop + 0.1, innerZ),
      new THREE.Vector3(doorWidth + 0.1, 0.11, 0.16),
      accentColor.clone().lerp(trimColor, end < 0 ? 0.48 : 0.2),
    );
    pushBox(
      glowBatch,
      new THREE.Vector3(0, doorBottom + 0.025, innerZ),
      new THREE.Vector3(doorWidth - 0.18, 0.035, 0.19),
      accentColor.clone().lerp(trimColor, 0.42),
    );
  }

  addBoxBatch(
    group,
    "chamber-architecture-wall-recesses",
    recessBatch,
    darkMaterial,
    false,
    true,
  );
  addBoxBatch(
    group,
    `chamber-architecture-${profile.relief}-relief`,
    reliefBatch,
    reliefMaterial,
    true,
    true,
  );
  addBoxBatch(
    group,
    `chamber-architecture-${profile.crown}-crown-and-portal-trim`,
    trimBatch,
    trimMaterial,
    true,
    true,
  );
  addBoxBatch(
    group,
    "chamber-architecture-emissive-undersides-and-recesses",
    glowBatch,
    glowMaterial,
    false,
    false,
  );
}

/**
 * Adds architecture only. It intentionally creates no ceiling, exhibit,
 * matrix, label, gameplay object, navigation blocker, or animation.
 */
export function buildCraftedChamberDetails(
  group: THREE.Group,
  options: CraftedChamberDetailsOptions,
): void {
  const width = Math.max(12, options.width);
  const height = Math.max(14, options.height);
  const depth = Math.max(16, options.depth);
  const floorY = Number.isFinite(options.floorY) ? options.floorY : -4.88;
  const doorWidth = THREE.MathUtils.clamp(
    options.doorWidth,
    3.2,
    width - 2.4,
  );
  const doorBottom = THREE.MathUtils.clamp(
    options.doorBottom,
    floorY,
    floorY + height - 4,
  );
  const doorHeight = THREE.MathUtils.clamp(
    options.doorHeight,
    3.2,
    floorY + height - doorBottom - 1,
  );
  const spatialStyle = isSpatialStyle(options.spatialStyle)
    ? options.spatialStyle
    : "panorama";
  const profile = getChamberRoomProfile(options.stationId, spatialStyle);
  const stationIndex = Number.isFinite(options.stationIndex)
    ? Math.trunc(options.stationIndex)
    : 0;
  const seed =
    (textSeed(options.stationId) ^
      Math.imul(stationIndex + 1, 0x45d9f3b)) >>>
    0;

  addSkyDome(group, width, height, depth, floorY, profile);
  const surfaceY = addFloor(group, width, depth, floorY, profile);
  addFloorInlays(group, width, depth, surfaceY, seed, profile);
  addWallArchitecture(group, {
    width,
    height,
    depth,
    floorY,
    doorWidth,
    doorHeight,
    doorBottom,
    seed,
    spatialStyle,
    profile,
  });

  const fill = new THREE.PointLight(
    toward(profile.sky, profile.accent, 0.12),
    1.55,
    Math.max(width, height, depth) * 1.05,
    2,
  );
  fill.name = "chamber-architecture-restrained-fill";
  fill.position.set(
    width * (stationIndex % 2 === 0 ? -0.16 : 0.16),
    floorY + height * 0.7,
    depth * 0.12,
  );
  fill.userData.chamberArchitectureLight = true;
  fill.userData.baseIntensity = fill.intensity;
  group.add(fill);
}
