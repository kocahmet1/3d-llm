import * as THREE from "three";
import { PHASE_COLORS } from "../lib/trainingTrace";

/**
 * The machine room is the opening scene of the experience: a calm, present-day
 * study with a single pedestal table at its center. On the table sits a
 * desktop-scale "training machine" whose seven visible chambers are the major
 * units of one pretraining step. The visitor aims at a chamber and scrolls to
 * lean in; past a threshold the camera dives through the miniature wall and
 * the visitor is standing inside the corresponding full-size chamber.
 *
 * Everything here is room-local: the canvas positions `group` far away from
 * the station route and translates the player position by the group origin.
 * No numeric training values are displayed in this scene, so nothing here can
 * drift from the deterministic trace.
 */

export interface MachineRoomUnitRuntime {
  id: string;
  label: string;
  sublabel: string;
  /** Station the dive lands in (free-roam spawn of that chamber). */
  stationIndex: number;
  accent: THREE.Color;
  /** Room-local point the camera dives toward. */
  focusLocal: THREE.Vector3;
  /** Distance from focus at which the dive begins. */
  approachRadius: number;
  /** Room-local standing point used when returning from this unit's chambers. */
  overlookLocal: THREE.Vector3;
  /**
   * Room-local points the aim test measures against (long units expose
   * several). Hover goes to the unit whose silhouette cone is nearest the
   * visitor's view direction, so labels always follow the actual gaze.
   */
  aimLocals: THREE.Vector3[];
  /** Approximate world radius of the unit around each aim point. */
  aimRadius: number;
  /** Root group of the unit's visible meshes and pick proxies. */
  pickGroup: THREE.Group;
  highlight: number;
}

export interface MachineRoomBlocker {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MachineRoomBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Free-flight vertical clamp while the visitor zooms over the table. */
  minY: number;
  maxY: number;
  /** Grounded eye height while walking. */
  walkY: number;
  spawn: THREE.Vector3;
  spawnYaw: number;
  spawnPitch: number;
  blockers: MachineRoomBlocker[];
}

export interface MachineRoomTrainingConsoleRuntime {
  /** Point in front of the cabinet used for the visitor proximity check. */
  approachLocal: THREE.Vector3;
  /** Wake radius for the DOM call to action. */
  activationRadius: number;
}

export interface MachineRoomRuntime {
  group: THREE.Group;
  units: MachineRoomUnitRuntime[];
  /** Raycast target containing every unit's meshes and pick proxies. */
  pickRoot: THREE.Group;
  bounds: MachineRoomBounds;
  trainingConsole: MachineRoomTrainingConsoleRuntime;
  unitIndexForStation(stationIndex: number): number;
  update(
    elapsed: number,
    delta: number,
    hoveredIndex: number,
    motionEnabled: boolean,
    trainingConsoleNearby: boolean,
  ): void;
}

const TAU = Math.PI * 2;

/** Horizontal breathing room kept between the visitor and room furniture. */
export const MACHINE_ROOM_PLAYER_CLEARANCE = 0.28;

/**
 * Platform top surface: the "ground" every machine unit stands on. Lowered
 * from the old 1.08 so the standing camera looks down onto the machine for a
 * more top-down, tabletop-menu read. Everything on the machine is keyed to
 * this constant (or shifted by the same delta), so the whole assembly and the
 * pedestal beneath it drop together.
 */
const PLATFORM_TOP_Y = 0.74;

/**
 * The two rear units — the backprop conduit (index 5) and the AdamW optimizer
 * (index 6) — sit behind the front row and the tower, so they read poorly from
 * the standing overlook. They are raised by this amount onto slender metal
 * stands, which both lifts them into view and gives the machine a busier,
 * more mechanical silhouette. Every rear coordinate (unit transform, focus,
 * aim cones, label, and the plumbing that meets them) adds this same lift.
 */
const BACK_ROW_LIFT = 0.52;

interface UnitSpec {
  id: string;
  label: string;
  sublabel: string;
  stationIndex: number;
  accent: string;
  focus: [number, number, number];
  approachRadius: number;
  overlook: [number, number, number];
  ringCenter: [number, number];
  ringRadius: number;
  /** Radius of the aim cone around each aim point (defaults per unit). */
  aimRadius: number;
  /** Extra aim points for tall or elongated units; focus is always included. */
  aimPoints?: Array<[number, number, number]>;
}

/**
 * Seven major chambers, each mapped to the first full-size chamber of the
 * machinery it summarizes. Order follows the forward pass, then the return.
 */
const UNIT_SPECS: UnitSpec[] = [
  {
    id: "data-prep",
    label: "Data Preparation",
    sublabel: "corpus → tokens → batches",
    stationIndex: 1,
    accent: PHASE_COLORS.data,
    focus: [-1.3, 1.02, 0.1],
    approachRadius: 0.68,
    overlook: [-1.65, 1.58, 2.55],
    ringCenter: [-1.3, 0.1],
    ringRadius: 0.27,
    aimRadius: 0.28,
  },
  {
    id: "embedding",
    label: "Embedding Lookup",
    sublabel: "token IDs become vectors",
    stationIndex: 4,
    accent: "#6fb7ff",
    focus: [-0.72, 0.94, 0.1],
    approachRadius: 0.6,
    overlook: [-0.9, 1.58, 2.5],
    ringCenter: [-0.72, 0.1],
    ringRadius: 0.24,
    aimRadius: 0.24,
  },
  {
    id: "transformer-tower",
    label: "Transformer Tower",
    sublabel: "2 blocks · attention + MLP",
    stationIndex: 5,
    accent: PHASE_COLORS.forward,
    focus: [0, 1.36, -0.06],
    approachRadius: 0.95,
    overlook: [0, 1.62, 2.8],
    ringCenter: [0, -0.06],
    ringRadius: 0.4,
    aimRadius: 0.42,
    aimPoints: [
      [0, 0.98, -0.06],
      [0, 1.78, -0.06],
    ],
  },
  {
    id: "vocabulary-head",
    label: "Vocabulary Head",
    sublabel: "hidden state → 16 logits",
    stationIndex: 15,
    accent: "#7ce8ff",
    focus: [0.7, 0.96, 0.1],
    approachRadius: 0.6,
    overlook: [0.88, 1.58, 2.5],
    ringCenter: [0.7, 0.1],
    ringRadius: 0.24,
    aimRadius: 0.24,
  },
  {
    id: "loss-meter",
    label: "Loss Meter",
    sublabel: "prediction meets target",
    stationIndex: 17,
    accent: PHASE_COLORS.loss,
    focus: [1.3, 1.02, 0.1],
    approachRadius: 0.62,
    overlook: [1.58, 1.58, 2.55],
    ringCenter: [1.3, 0.1],
    ringRadius: 0.26,
    aimRadius: 0.26,
  },
  {
    id: "backprop-return",
    label: "Backprop Return",
    sublabel: "gradients flow backward",
    stationIndex: 19,
    accent: PHASE_COLORS.backward,
    focus: [0.34, 1.16, -0.44],
    approachRadius: 0.75,
    overlook: [0.55, 1.7, -2.7],
    ringCenter: [0.34, -0.44],
    ringRadius: 0.3,
    aimRadius: 0.22,
    aimPoints: [
      [1.1, 1.16, -0.4],
      [-0.4, 1.16, -0.45],
    ],
  },
  {
    id: "adamw-optimizer",
    label: "AdamW Optimizer",
    sublabel: "moments steer the update",
    stationIndex: 22,
    accent: PHASE_COLORS.update,
    focus: [-0.66, 1.0, -0.44],
    approachRadius: 0.62,
    overlook: [-2.85, 1.6, -1.95],
    ringCenter: [-0.66, -0.44],
    ringRadius: 0.26,
    aimRadius: 0.26,
  },
];

/** Station ranges owned by each unit, used when returning to the room. */
const UNIT_STATION_RANGES: Array<[number, number]> = [
  [1, 3],
  [4, 4],
  [5, 14],
  [15, 16],
  [17, 18],
  [19, 21],
  [22, 24],
];

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Wide-plank oak floor, drawn once and repeated. */
function createFloorTexture(): THREE.CanvasTexture {
  const canvas = makeCanvas(512, 512);
  const paint = canvas.getContext("2d");
  if (paint) {
    paint.fillStyle = "#8a6746";
    paint.fillRect(0, 0, 512, 512);
    const plankWidth = 128;
    for (let column = 0; column < 4; column += 1) {
      const stagger = (column % 2) * 170;
      for (let row = -1; row < 4; row += 1) {
        const tint = 0.9 + ((column * 7 + row * 13) % 5) * 0.045;
        paint.fillStyle = `rgb(${Math.round(138 * tint)}, ${Math.round(
          103 * tint,
        )}, ${Math.round(70 * tint)})`;
        paint.fillRect(column * plankWidth + 2, stagger + row * 170 + 2, plankWidth - 4, 166);
      }
      paint.fillStyle = "rgba(66, 47, 32, 0.85)";
      paint.fillRect(column * plankWidth - 1, 0, 2, 512);
    }
    paint.strokeStyle = "rgba(66, 47, 32, 0.35)";
    for (let grain = 0; grain < 90; grain += 1) {
      const x = (grain * 37) % 512;
      const y = (grain * 101) % 512;
      paint.beginPath();
      paint.moveTo(x, y);
      paint.lineTo(x + 3 + ((grain * 11) % 7), y + 34 + ((grain * 17) % 40));
      paint.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3.2, 2.6);
  texture.anisotropy = 4;
  return texture;
}

/** Dusk sky seen through the two windows. */
function createWindowTexture(): THREE.CanvasTexture {
  const canvas = makeCanvas(256, 256);
  const paint = canvas.getContext("2d");
  if (paint) {
    const sky = paint.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, "#0b1a34");
    sky.addColorStop(0.52, "#20447a");
    sky.addColorStop(0.8, "#7a6a8c");
    sky.addColorStop(1, "#d99060");
    paint.fillStyle = sky;
    paint.fillRect(0, 0, 256, 256);
    paint.fillStyle = "rgba(255, 236, 200, 0.85)";
    for (let star = 0; star < 26; star += 1) {
      const x = (star * 53) % 256;
      const y = (star * 29) % 96;
      paint.fillRect(x, y, 1.6, 1.6);
    }
    paint.fillStyle = "rgba(10, 16, 30, 0.9)";
    for (let building = 0; building < 9; building += 1) {
      const width = 18 + ((building * 13) % 20);
      const height = 26 + ((building * 31) % 52);
      paint.fillRect(building * 30 - 4, 256 - height, width, height);
    }
    paint.fillStyle = "rgba(255, 209, 130, 0.8)";
    for (let window = 0; window < 40; window += 1) {
      const x = (window * 19) % 250;
      const y = 208 + ((window * 11) % 42);
      paint.fillRect(x, y, 2.4, 3.2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Muted abstract print for the framed wall art. */
function createPrintTexture(seed: number): THREE.CanvasTexture {
  const canvas = makeCanvas(256, 320);
  const paint = canvas.getContext("2d");
  if (paint) {
    paint.fillStyle = seed === 0 ? "#e6ddcc" : "#dfe3da";
    paint.fillRect(0, 0, 256, 320);
    const palette =
      seed === 0
        ? ["#31445f", "#c98d54", "#7a8d7f", "#20242b"]
        : ["#5d7386", "#b8a06a", "#3d5147", "#8a5d4e"];
    palette.forEach((color, index) => {
      paint.fillStyle = color;
      paint.globalAlpha = 0.82;
      const angle = (seed * 1.3 + index) * 0.9;
      paint.save();
      paint.translate(128, 160);
      paint.rotate(angle);
      paint.fillRect(-150 + index * 34, -30 + index * 26, 300, 26 + index * 6);
      paint.restore();
    });
    paint.globalAlpha = 1;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Desk-style nameplate face: a brushed dark plate with the unit's name in
 * caps over an accent underline. Always on, like the little name signs on
 * office desks, so every chamber is identifiable without hovering.
 */
function createNameplateTexture(spec: UnitSpec): THREE.CanvasTexture {
  const width = 360;
  const height = 132;
  const canvas = makeCanvas(width, height);
  const paint = canvas.getContext("2d");
  if (paint) {
    paint.clearRect(0, 0, width, height);
    // Brushed metal backing.
    const brushed = paint.createLinearGradient(0, 0, 0, height);
    brushed.addColorStop(0, "#243043");
    brushed.addColorStop(0.5, "#141c28");
    brushed.addColorStop(1, "#0b111b");
    paint.fillStyle = brushed;
    const radius = 20;
    paint.beginPath();
    paint.moveTo(radius, 6);
    paint.lineTo(width - radius, 6);
    paint.quadraticCurveTo(width - 6, 6, width - 6, 6 + radius);
    paint.lineTo(width - 6, height - 6 - radius);
    paint.quadraticCurveTo(width - 6, height - 6, width - radius, height - 6);
    paint.lineTo(radius, height - 6);
    paint.quadraticCurveTo(6, height - 6, 6, height - 6 - radius);
    paint.lineTo(6, 6 + radius);
    paint.quadraticCurveTo(6, 6, radius, 6);
    paint.closePath();
    paint.fill();
    paint.strokeStyle = "rgba(190, 210, 235, 0.35)";
    paint.lineWidth = 2;
    paint.stroke();
    // Name, auto-fit so long labels ("AdamW Optimizer") stay on one line.
    const name = spec.label.toUpperCase();
    let fontSize = 52;
    paint.textAlign = "center";
    paint.textBaseline = "middle";
    do {
      paint.font = `700 ${fontSize}px system-ui, "Segoe UI", sans-serif`;
      if (paint.measureText(name).width <= width - 54) break;
      fontSize -= 2;
    } while (fontSize > 22);
    paint.fillStyle = "#f4f8fc";
    paint.fillText(name, width / 2, height / 2 - 6);
    // Accent underline.
    paint.fillStyle = spec.accent;
    const barWidth = Math.min(width - 70, paint.measureText(name).width + 24);
    paint.fillRect((width - barWidth) / 2, height - 30, barWidth, 5);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Hover label floated above a machine unit. */
function createUnitLabelTexture(spec: UnitSpec): THREE.CanvasTexture {
  const canvas = makeCanvas(512, 192);
  const paint = canvas.getContext("2d");
  if (paint) {
    paint.clearRect(0, 0, 512, 192);
    paint.fillStyle = "rgba(6, 12, 20, 0.82)";
    const radius = 26;
    paint.beginPath();
    paint.moveTo(radius, 10);
    paint.lineTo(512 - radius, 10);
    paint.quadraticCurveTo(512 - 6, 10, 512 - 6, 10 + radius);
    paint.lineTo(512 - 6, 182 - radius);
    paint.quadraticCurveTo(512 - 6, 182, 512 - radius, 182);
    paint.lineTo(radius, 182);
    paint.quadraticCurveTo(6, 182, 6, 182 - radius);
    paint.lineTo(6, 10 + radius);
    paint.quadraticCurveTo(6, 10, radius, 10);
    paint.closePath();
    paint.fill();
    paint.strokeStyle = spec.accent;
    paint.lineWidth = 3;
    paint.stroke();
    paint.textAlign = "center";
    paint.fillStyle = "#f3f7fa";
    paint.font = "600 44px system-ui, sans-serif";
    paint.fillText(spec.label.toUpperCase(), 256, 78);
    paint.fillStyle = spec.accent;
    paint.font = "500 30px system-ui, sans-serif";
    paint.fillText(spec.sublabel, 256, 122);
    paint.fillStyle = "rgba(224, 233, 240, 0.78)";
    paint.font = "500 26px system-ui, sans-serif";
    paint.fillText("scroll to step inside", 256, 160);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Etched plaque on the pedestal apron. */
function createPlaqueTexture(): THREE.CanvasTexture {
  const canvas = makeCanvas(512, 128);
  const paint = canvas.getContext("2d");
  if (paint) {
    paint.fillStyle = "#20242a";
    paint.fillRect(0, 0, 512, 128);
    paint.strokeStyle = "rgba(214, 187, 148, 0.9)";
    paint.lineWidth = 4;
    paint.strokeRect(8, 8, 496, 112);
    paint.textAlign = "center";
    paint.fillStyle = "#e8d9bd";
    paint.font = "600 46px Georgia, serif";
    paint.fillText("ONE TRAINING STEP", 256, 62);
    paint.fillStyle = "rgba(216, 202, 175, 0.75)";
    paint.font = "500 26px Georgia, serif";
    paint.fillText("lean in to enter a chamber", 256, 100);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** High-contrast marquee above the room's custom-training console. */
function createTrainingConsoleSignTexture(): THREE.CanvasTexture {
  const canvas = makeCanvas(1024, 256);
  const paint = canvas.getContext("2d");
  if (paint) {
    // Bright cartoon marquee — candy letters with a glow.
    const background = paint.createLinearGradient(0, 0, 0, 256);
    background.addColorStop(0, "#1b2c6e");
    background.addColorStop(1, "#0d1330");
    paint.fillStyle = background;
    paint.fillRect(0, 0, 1024, 256);
    const bloom = paint.createRadialGradient(512, 128, 30, 512, 128, 560);
    bloom.addColorStop(0, "rgba(90, 220, 255, 0.28)");
    bloom.addColorStop(1, "rgba(0, 0, 0, 0)");
    paint.fillStyle = bloom;
    paint.fillRect(0, 0, 1024, 256);

    paint.textAlign = "center";
    paint.textBaseline = "middle";

    // Chunky faux-3D extruded title: an outline, a stack of offset copies that
    // read as extrusion depth, a candy-gradient face, and a top gloss highlight.
    const title = "TRAIN YOUR OWN LLM HERE";
    paint.font = '900 62px "Trebuchet MS", "Segoe UI", sans-serif';
    paint.lineJoin = "round";
    paint.strokeStyle = "#08112c";
    paint.lineWidth = 13;
    paint.strokeText(title, 512, 92);
    for (let d = 9; d >= 1; d -= 1) {
      paint.fillStyle = d > 4 ? "#0a2352" : "#0e2f6e";
      paint.fillText(title, 512 + d * 0.5, 92 + d * 1.3);
    }
    paint.shadowColor = "rgba(90, 220, 255, 0.85)";
    paint.shadowBlur = 22;
    const titleFill = paint.createLinearGradient(0, 56, 0, 128);
    titleFill.addColorStop(0, "#a9ff86");
    titleFill.addColorStop(1, "#39d0ff");
    paint.fillStyle = titleFill;
    paint.fillText(title, 512, 92);
    paint.shadowBlur = 0;
    // Glossy highlight across the top of the letter faces.
    paint.save();
    paint.beginPath();
    paint.rect(0, 60, 1024, 26);
    paint.clip();
    paint.fillStyle = "rgba(255, 255, 255, 0.4)";
    paint.fillText(title, 512, 92);
    paint.restore();

    // Subtitle with a warm pop and playful stars.
    paint.fillStyle = "#ffb43a";
    paint.font = '800 28px "Trebuchet MS", sans-serif';
    paint.fillText("★  CUSTOM TRAINING PLAYGROUND  ★", 512, 188);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** CRT-style status screen set into the training console cabinet. */
function createTrainingConsoleScreenTexture(): THREE.CanvasTexture {
  const canvas = makeCanvas(640, 400);
  const paint = canvas.getContext("2d");
  if (paint) {
    // Playful cartoon UI on a dark navy panel so the candy colors pop.
    const bg = paint.createLinearGradient(0, 0, 0, 400);
    bg.addColorStop(0, "#141a3a");
    bg.addColorStop(1, "#0a0e24");
    paint.fillStyle = bg;
    paint.fillRect(0, 0, 640, 400);

    const rrect = (x: number, y: number, w: number, h: number, r: number) => {
      paint.beginPath();
      paint.moveTo(x + r, y);
      paint.arcTo(x + w, y, x + w, y + h, r);
      paint.arcTo(x + w, y + h, x, y + h, r);
      paint.arcTo(x, y + h, x, y, r);
      paint.arcTo(x, y, x + w, y, r);
      paint.closePath();
    };

    paint.textAlign = "left";
    paint.textBaseline = "alphabetic";

    // Chunky title with a soft drop shadow.
    paint.fillStyle = "rgba(0, 0, 0, 0.35)";
    paint.font = '800 60px "Trebuchet MS", "Segoe UI", sans-serif';
    paint.fillText("MODEL LAB", 40, 88);
    paint.fillStyle = "#7bff6a";
    paint.fillText("MODEL LAB", 37, 85);

    // Rounded status pill with a warm fill.
    paint.fillStyle = "#ff8a34";
    rrect(38, 104, 214, 34, 17);
    paint.fill();
    paint.fillStyle = "#20143a";
    paint.font = '800 20px "Trebuchet MS", sans-serif';
    paint.fillText("READY TO TRAIN", 56, 128);

    // Step chips with colored number bubbles.
    const chips: Array<[string, string, string]> = [
      ["01", "Add your text", "#3fd0ff"],
      ["02", "Choose a model", "#7bff5a"],
      ["03", "Start training", "#ffd23f"],
    ];
    chips.forEach((chip, index) => {
      const y = 172 + index * 58;
      paint.fillStyle = "rgba(255, 255, 255, 0.06)";
      rrect(38, y, 564, 46, 14);
      paint.fill();
      paint.fillStyle = chip[2];
      paint.beginPath();
      paint.arc(70, y + 23, 13, 0, Math.PI * 2);
      paint.fill();
      paint.fillStyle = "#0a0e24";
      paint.textAlign = "center";
      paint.font = '800 15px "Trebuchet MS", sans-serif';
      paint.fillText(chip[0], 70, y + 28);
      paint.textAlign = "left";
      paint.fillStyle = "#eaf6ff";
      paint.font = '700 26px "Trebuchet MS", sans-serif';
      paint.fillText(chip[1], 100, y + 31);
    });

    // Rainbow progress bar.
    const bx = 38;
    const by = 356;
    const bw = 564;
    const bh = 16;
    paint.fillStyle = "rgba(255, 255, 255, 0.08)";
    rrect(bx, by, bw, bh, 8);
    paint.fill();
    const grad = paint.createLinearGradient(bx, 0, bx + bw, 0);
    grad.addColorStop(0, "#7bff5a");
    grad.addColorStop(0.5, "#3fd0ff");
    grad.addColorStop(1, "#ffd23f");
    paint.save();
    rrect(bx, by, bw * 0.66, bh, 8);
    paint.clip();
    paint.fillStyle = grad;
    paint.fillRect(bx, by, bw, bh);
    paint.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

interface PulseLane {
  curve: THREE.CatmullRomCurve3;
  pulses: THREE.Mesh[];
  speed: number;
  reverse: boolean;
}

interface UnitBuildResult {
  group: THREE.Group;
  accentMaterials: THREE.MeshStandardMaterial[];
  spinners: Array<{ object: THREE.Object3D; axis: "x" | "y" | "z"; speed: number }>;
  needle?: THREE.Object3D;
  pages?: THREE.Object3D[];
}

const invisiblePickMaterial = () =>
  new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false,
  });

export function createMachineRoom(): MachineRoomRuntime {
  const group = new THREE.Group();
  group.name = "machine-room";

  const bounds: MachineRoomBounds = {
    minX: -6.1,
    maxX: 6.1,
    minZ: -4.7,
    maxZ: 4.7,
    minY: 0.45,
    maxY: 3.7,
    walkY: 1.62,
    // Resting pose: centered in front of the machine table, looking straight
    // at the Transformer Tower. The opening fly-in settles here and R / M
    // return the visitor here. Clear of the table collision footprint, so
    // WASD works on the first keypress without requiring a wheel escape.
    spawn: new THREE.Vector3(0, 1.62, 2.8),
    spawnYaw: 0,
    spawnPitch: -0.09,
    blockers: [
      { minX: -2.25, maxX: 2.25, minZ: -1.28, maxZ: 1.28 },
      { minX: 3.85, maxX: 5.65, minZ: 3.25, maxZ: 4.7 },
      // Potted plant relocated to the north-wall bay the console vacated.
      { minX: -0.45, maxX: 0.45, minZ: -4.95, maxZ: -4.2 },
      // North-west corner plant (unchanged).
      { minX: -6.1, maxX: -5.2, minZ: -4.7, maxZ: -3.9 },
      // Custom-training console, now angled into the north-east corner.
      { minX: 5.4, maxX: 6.1, minZ: -5.3, maxZ: -4.05 },
    ],
  };

  /* ------------------------------------------------------------------ *
   * Shared materials
   * ------------------------------------------------------------------ */
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: "#e9e2d3",
    roughness: 0.94,
    metalness: 0,
  });
  const wainscotMaterial = new THREE.MeshStandardMaterial({
    color: "#39424e",
    roughness: 0.72,
    metalness: 0.08,
  });
  const railMaterial = new THREE.MeshStandardMaterial({
    color: "#a8845d",
    roughness: 0.55,
    metalness: 0.12,
  });
  const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: "#f1eadd",
    roughness: 0.96,
    metalness: 0,
  });
  const walnutMaterial = new THREE.MeshStandardMaterial({
    color: "#6b4f38",
    roughness: 0.52,
    metalness: 0.05,
  });
  const darkWoodMaterial = new THREE.MeshStandardMaterial({
    color: "#4a3b2e",
    roughness: 0.6,
    metalness: 0.05,
  });
  const steelMaterial = new THREE.MeshStandardMaterial({
    color: "#8c99ac",
    roughness: 0.24,
    metalness: 0.92,
    envMapIntensity: 1.6,
  });
  const alloyMaterial = new THREE.MeshStandardMaterial({
    color: "#c6d2e2",
    roughness: 0.16,
    metalness: 0.95,
    envMapIntensity: 1.9,
  });
  const anodizeMaterial = new THREE.MeshStandardMaterial({
    color: "#1c2330",
    roughness: 0.3,
    metalness: 0.85,
    envMapIntensity: 1.25,
  });
  /** Polished cold-blue conduit metal (was warm copper). */
  const chromePipeMaterial = new THREE.MeshStandardMaterial({
    color: "#9db8d6",
    roughness: 0.18,
    metalness: 1,
    envMapIntensity: 2.1,
  });
  /**
   * Forward-pass connector pipes: a bright brass/amber that gives the plumbing
   * a distinct, warm color (clearly not the tower's cyan) and, being purely
   * diffuse with no emissive, does not glow. The colored signal pulses still
   * travel along it.
   */
  const laneTubeMaterial = new THREE.MeshStandardMaterial({
    color: "#e6b24c",
    roughness: 0.36,
    metalness: 0.6,
    envMapIntensity: 1.1,
  });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: "#a9dcff",
    roughness: 0.1,
    metalness: 0.08,
    transparent: true,
    opacity: 0.12,
    // Reflections were so hot the glass itself read as a white glow; keep them
    // gentle so the cyan core is what shows through.
    envMapIntensity: 0.8,
    side: THREE.DoubleSide,
  });

  /* ------------------------------------------------------------------ *
   * Room shell
   * ------------------------------------------------------------------ */
  const halfX = 6.8;
  const halfZ = 5.4;
  const roomHeight = 4.05;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(halfX * 2, halfZ * 2),
    new THREE.MeshStandardMaterial({
      map: createFloorTexture(),
      roughness: 0.78,
      metalness: 0.04,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const rug = new THREE.Mesh(
    new THREE.CircleGeometry(2.75, 48),
    new THREE.MeshStandardMaterial({ color: "#2f3a52", roughness: 1 }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.012;
  rug.receiveShadow = true;
  group.add(rug);
  const rugRing = new THREE.Mesh(
    new THREE.RingGeometry(2.42, 2.52, 48),
    new THREE.MeshStandardMaterial({ color: "#54627f", roughness: 1 }),
  );
  rugRing.rotation.x = -Math.PI / 2;
  rugRing.position.y = 0.016;
  group.add(rugRing);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(halfX * 2, halfZ * 2),
    ceilingMaterial,
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = roomHeight;
  group.add(ceiling);

  const wallGeometryX = new THREE.PlaneGeometry(halfX * 2, roomHeight);
  const wallGeometryZ = new THREE.PlaneGeometry(halfZ * 2, roomHeight);
  const wallNorth = new THREE.Mesh(wallGeometryX, wallMaterial);
  wallNorth.position.set(0, roomHeight / 2, -halfZ);
  const wallSouth = new THREE.Mesh(wallGeometryX, wallMaterial);
  wallSouth.position.set(0, roomHeight / 2, halfZ);
  wallSouth.rotation.y = Math.PI;
  const wallEast = new THREE.Mesh(wallGeometryZ, wallMaterial);
  wallEast.position.set(halfX, roomHeight / 2, 0);
  wallEast.rotation.y = -Math.PI / 2;
  const wallWest = new THREE.Mesh(wallGeometryZ, wallMaterial);
  wallWest.position.set(-halfX, roomHeight / 2, 0);
  wallWest.rotation.y = Math.PI / 2;
  [wallNorth, wallSouth, wallEast, wallWest].forEach((wall) => {
    wall.receiveShadow = true;
    group.add(wall);
  });

  const wainscotHeight = 1.08;
  const wainscotSpecs: Array<[number, number, number, number, number]> = [
    // [x, z, rotationY, length, offset toward room]
    [0, -halfZ + 0.028, 0, halfX * 2, 0],
    [0, halfZ - 0.028, Math.PI, halfX * 2, 0],
    [halfX - 0.028, 0, -Math.PI / 2, halfZ * 2, 0],
    [-halfX + 0.028, 0, Math.PI / 2, halfZ * 2, 0],
  ];
  wainscotSpecs.forEach(([x, z, rotationY, length]) => {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(length, wainscotHeight, 0.05),
      wainscotMaterial,
    );
    panel.position.set(x, wainscotHeight / 2, z);
    panel.rotation.y = rotationY;
    group.add(panel);
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.045, 0.065),
      railMaterial,
    );
    rail.position.set(x, wainscotHeight + 0.02, z);
    rail.rotation.y = rotationY;
    group.add(rail);
  });

  // Ceiling cove: a warm recessed strip around the perimeter.
  const coveMaterial = new THREE.MeshStandardMaterial({
    color: "#3c3427",
    emissive: "#ffd9a4",
    emissiveIntensity: 0.78,
    roughness: 0.6,
  });
  const coveInset = 0.55;
  const coveSpecs: Array<[number, number, number, number]> = [
    [0, -halfZ + coveInset, 0, halfX * 2 - coveInset * 2],
    [0, halfZ - coveInset, 0, halfX * 2 - coveInset * 2],
    [halfX - coveInset, 0, Math.PI / 2, halfZ * 2 - coveInset * 2],
    [-halfX + coveInset, 0, Math.PI / 2, halfZ * 2 - coveInset * 2],
  ];
  coveSpecs.forEach(([x, z, rotationY, length]) => {
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.035, 0.09),
      coveMaterial,
    );
    strip.position.set(x, roomHeight - 0.05, z);
    strip.rotation.y = rotationY;
    group.add(strip);
  });

  // Downlight fixtures over the table.
  const downlightShellMaterial = new THREE.MeshStandardMaterial({
    color: "#2c2f35",
    roughness: 0.4,
    metalness: 0.6,
  });
  const downlightGlowMaterial = new THREE.MeshStandardMaterial({
    color: "#fff3dd",
    emissive: "#ffe6bd",
    emissiveIntensity: 1.15,
    roughness: 0.5,
  });
  [-1.35, 0, 1.35].forEach((x) => {
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.12, 0.1, 20),
      downlightShellMaterial,
    );
    shell.position.set(x, roomHeight - 0.05, 0);
    group.add(shell);
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.085, 20),
      downlightGlowMaterial,
    );
    glow.rotation.x = Math.PI / 2;
    glow.position.set(x, roomHeight - 0.104, 0);
    group.add(glow);
  });

  /* ------------------------------------------------------------------ *
   * Windows (north wall), door, prints, furniture
   * ------------------------------------------------------------------ */
  const windowTexture = createWindowTexture();
  const windowFrameMaterial = new THREE.MeshStandardMaterial({
    color: "#2c3138",
    roughness: 0.45,
    metalness: 0.35,
  });
  [-2.15, 2.15].forEach((x) => {
    const windowGroup = new THREE.Group();
    windowGroup.position.set(x, 0, -halfZ + 0.02);
    const width = 2.0;
    const height = 1.85;
    const sillY = 1.14;
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(width - 0.14, height - 0.14),
      new THREE.MeshStandardMaterial({
        color: "#0a1424",
        emissive: "#ffffff",
        emissiveMap: windowTexture,
        emissiveIntensity: 0.62,
        roughness: 0.3,
      }),
    );
    pane.position.set(0, sillY + height / 2, 0.0);
    windowGroup.add(pane);
    const frameSpecs: Array<[number, number, number, number]> = [
      [0, sillY + height - 0.035, width, 0.07],
      [0, sillY + 0.035, width, 0.07],
      [-width / 2 + 0.035, sillY + height / 2, 0.07, height],
      [width / 2 - 0.035, sillY + height / 2, 0.07, height],
      [0, sillY + height / 2, 0.05, height], // center mullion
    ];
    frameSpecs.forEach(([fx, fy, fw, fh]) => {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(fw, fh, 0.07),
        windowFrameMaterial,
      );
      bar.position.set(fx, fy, 0.02);
      windowGroup.add(bar);
    });
    const crossBar = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.05, 0.07),
      windowFrameMaterial,
    );
    crossBar.position.set(0, sillY + height * 0.55, 0.02);
    windowGroup.add(crossBar);
    const sill = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.24, 0.05, 0.16),
      railMaterial,
    );
    sill.position.set(0, sillY - 0.01, 0.07);
    windowGroup.add(sill);
    group.add(windowGroup);
  });

  /* ------------------------------------------------------------------ *
   * Custom-training console (north-wall window bay)
   * ------------------------------------------------------------------ */
  const trainingConsoleGroup = new THREE.Group();
  trainingConsoleGroup.name = "custom-training-console";
  // Tucked diagonally into the north-east corner — its flat back spans the two
  // walls like the hypotenuse across the corner, front angled into the room.
  // (Swapped with the potted plant that used to stand here.)
  trainingConsoleGroup.position.set(6.1, 0, -4.7);
  trainingConsoleGroup.rotation.y = -Math.PI / 4;

  // A friendly, glossy "cartoon toy" terminal: saturated plastics in greens and
  // blues with warm candy pops, rounded shapes, and lots of blinking lights.
  const shellMain = new THREE.MeshStandardMaterial({
    color: "#1fbcd6",
    roughness: 0.22,
    metalness: 0.0,
    envMapIntensity: 1.1,
  });
  const shellDeep = new THREE.MeshStandardMaterial({
    color: "#1b64d8",
    roughness: 0.26,
    metalness: 0.0,
    envMapIntensity: 1.0,
  });
  const shellLime = new THREE.MeshStandardMaterial({
    color: "#7be23f",
    roughness: 0.24,
    metalness: 0.0,
    envMapIntensity: 1.0,
  });
  const glossDark = new THREE.MeshStandardMaterial({
    color: "#0e1738",
    roughness: 0.3,
    metalness: 0.1,
    envMapIntensity: 1.0,
  });
  const glossWhite = new THREE.MeshStandardMaterial({
    color: "#eaf6ff",
    roughness: 0.28,
    metalness: 0.0,
    envMapIntensity: 0.9,
  });
  const candyOrange = new THREE.MeshStandardMaterial({
    color: "#ff8a34",
    emissive: "#ff7a1e",
    emissiveIntensity: 0.25,
    roughness: 0.3,
    metalness: 0.0,
  });
  // Bright accent that pulses with the visitor (emissive is animated below).
  const consoleArchMaterial = new THREE.MeshStandardMaterial({
    color: "#0f6f5a",
    emissive: "#54ffc6",
    emissiveIntensity: 0.9,
    roughness: 0.24,
    metalness: 0.2,
  });

  // Chunky rounded base on four candy feet.
  const consolePlinth = new THREE.Mesh(
    new THREE.BoxGeometry(1.16, 0.1, 0.5),
    shellDeep,
  );
  consolePlinth.position.y = 0.16;
  consolePlinth.castShadow = true;
  trainingConsoleGroup.add(consolePlinth);
  const baseTrim = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.04, 0.54),
    shellLime,
  );
  baseTrim.position.y = 0.225;
  trainingConsoleGroup.add(baseTrim);
  const footColors = [shellLime, candyOrange, shellLime, candyOrange];
  [
    [-0.5, 0.2],
    [0.5, 0.2],
    [-0.5, -0.2],
    [0.5, -0.2],
  ].forEach(([x, z], index) => {
    const foot = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 18, 14),
      footColors[index],
    );
    foot.scale.set(1, 0.7, 1);
    foot.position.set(x, 0.05, z);
    trainingConsoleGroup.add(foot);
  });

  // Glossy teal body with a rounded lime crown and blue corner bumpers.
  const consoleBody = new THREE.Mesh(
    new THREE.BoxGeometry(1.14, 1.4, 0.42),
    shellMain,
  );
  consoleBody.position.y = 0.95;
  consoleBody.castShadow = true;
  trainingConsoleGroup.add(consoleBody);
  const crown = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 1.14, 24),
    shellLime,
  );
  crown.rotation.z = Math.PI / 2;
  crown.position.set(0, 1.62, 0);
  trainingConsoleGroup.add(crown);
  [
    [-0.57, 0.3],
    [0.57, 0.3],
    [-0.57, 1.58],
    [0.57, 1.58],
  ].forEach(([x, y]) => {
    const bumper = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 16, 14),
      shellDeep,
    );
    bumper.position.set(x, y, 0.14);
    trainingConsoleGroup.add(bumper);
  });

  // Two antennae; their globes blink with the light bank (added below).
  [-0.34, 0.34].forEach((x) => {
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.017, 0.32, 10),
      glossWhite,
    );
    stalk.position.set(x, 1.9, 0);
    trainingConsoleGroup.add(stalk);
  });

  // Dark screen well with a bright rounded bezel so the UI colors pop.
  const fasciaBezel = new THREE.Mesh(
    new THREE.BoxGeometry(0.98, 0.66, 0.06),
    shellDeep,
  );
  fasciaBezel.position.set(0, 1.28, 0.2);
  trainingConsoleGroup.add(fasciaBezel);
  const fascia = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.58, 0.04),
    glossDark,
  );
  fascia.position.set(0, 1.28, 0.216);
  trainingConsoleGroup.add(fascia);

  const consoleScreenTexture = createTrainingConsoleScreenTexture();
  const consoleScreenMaterial = new THREE.MeshStandardMaterial({
    color: "#bfe9ff",
    map: consoleScreenTexture,
    emissive: "#8fdcff",
    emissiveMap: consoleScreenTexture,
    emissiveIntensity: 0.75,
    roughness: 0.3,
    metalness: 0.0,
  });
  const consoleScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.84, 0.52),
    consoleScreenMaterial,
  );
  consoleScreen.position.set(0, 1.28, 0.237);
  trainingConsoleGroup.add(consoleScreen);

  // A big bank of blinking candy lights — greens, blues, cyans, warm pops.
  const consoleLedColors = [
    "#54ffd0",
    "#3fd0ff",
    "#7bff5a",
    "#2f9bff",
    "#ffd23f",
    "#54ffd0",
    "#3fd0ff",
    "#7bff5a",
    "#ff8a34",
    "#2f9bff",
    "#54ffd0",
    "#3fd0ff",
  ];
  const consoleLedMaterials: THREE.MeshStandardMaterial[] = [];
  consoleLedColors.forEach((color) => {
    consoleLedMaterials.push(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).multiplyScalar(0.45),
        emissive: color,
        emissiveIntensity: 0.5,
        roughness: 0.2,
        metalness: 0.0,
      }),
    );
  });
  const ledMat = (i: number) =>
    consoleLedMaterials[i % consoleLedMaterials.length];

  // Indicator row just beneath the screen.
  for (let i = 0; i < 9; i += 1) {
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 16, 12),
      ledMat(i),
    );
    led.position.set(-0.36 + i * 0.09, 0.92, 0.226);
    trainingConsoleGroup.add(led);
  }
  // Glowing globes on the antennae.
  [-0.34, 0.34].forEach((x, index) => {
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 18, 16),
      ledMat(index),
    );
    globe.position.set(x, 2.1, 0);
    trainingConsoleGroup.add(globe);
  });

  // Chunky candy knobs with white caps.
  const knobColors = [shellLime, candyOrange, shellDeep];
  [-0.3, 0, 0.3].forEach((x, index) => {
    const knob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.08, 0.06, 24),
      knobColors[index],
    );
    knob.rotation.x = Math.PI / 2;
    knob.position.set(x, 0.72, 0.235);
    knob.castShadow = true;
    trainingConsoleGroup.add(knob);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.03, 20),
      glossWhite,
    );
    cap.rotation.x = Math.PI / 2;
    cap.position.set(x, 0.72, 0.265);
    trainingConsoleGroup.add(cap);
    const pointer = new THREE.Mesh(
      new THREE.BoxGeometry(0.01, 0.05, 0.01),
      consoleArchMaterial,
    );
    pointer.position.set(x, 0.75, 0.272);
    pointer.rotation.z = (index - 1) * 0.5;
    trainingConsoleGroup.add(pointer);
  });

  // Playful round dial with a live red needle.
  const gauge = new THREE.Mesh(
    new THREE.CircleGeometry(0.13, 36),
    glossWhite,
  );
  gauge.position.set(-0.26, 0.46, 0.226);
  trainingConsoleGroup.add(gauge);
  const gaugeBezel = new THREE.Mesh(
    new THREE.TorusGeometry(0.14, 0.02, 14, 32),
    shellLime,
  );
  gaugeBezel.position.set(-0.26, 0.46, 0.23);
  trainingConsoleGroup.add(gaugeBezel);
  const consoleNeedlePivot = new THREE.Group();
  consoleNeedlePivot.position.set(-0.26, 0.46, 0.234);
  const consoleNeedle = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.11, 0.01),
    new THREE.MeshStandardMaterial({ color: "#ff5d5d", roughness: 0.4 }),
  );
  consoleNeedle.position.y = 0.045;
  consoleNeedlePivot.add(consoleNeedle);
  trainingConsoleGroup.add(consoleNeedlePivot);

  // Big glowing candy START button (the warm pop among the greens and blues).
  const consoleStartMaterial = new THREE.MeshStandardMaterial({
    color: "#ff6a2b",
    emissive: "#ff8a34",
    emissiveIntensity: 1.1,
    roughness: 0.28,
    metalness: 0.0,
  });
  const consoleStartRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.15, 0.028, 16, 32),
    glossWhite,
  );
  consoleStartRing.position.set(0.28, 0.46, 0.234);
  trainingConsoleGroup.add(consoleStartRing);
  const consoleStartButton = new THREE.Mesh(
    new THREE.CylinderGeometry(0.125, 0.13, 0.07, 32),
    consoleStartMaterial,
  );
  consoleStartButton.rotation.x = Math.PI / 2;
  consoleStartButton.position.set(0.28, 0.46, 0.25);
  trainingConsoleGroup.add(consoleStartButton);

  // Cheerful speaker dots.
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.016, 12),
        col % 2 === 0 ? shellDeep : shellLime,
      );
      dot.position.set(-0.3 + col * 0.1, 0.3 + row * 0.06, 0.221);
      trainingConsoleGroup.add(dot);
    }
  }

  // Bright floating sign on candy posts, ringed with blinking bulbs.
  const consoleSignTexture = createTrainingConsoleSignTexture();
  const consoleMarqueeMaterial = new THREE.MeshStandardMaterial({
    color: "#bfe9ff",
    map: consoleSignTexture,
    emissive: "#9fe0ff",
    emissiveMap: consoleSignTexture,
    emissiveIntensity: 0.85,
    roughness: 0.3,
    metalness: 0.0,
  });
  [-0.42, 0.42].forEach((x) => {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.5, 12),
      shellLime,
    );
    post.position.set(x, 1.95, 0.04);
    trainingConsoleGroup.add(post);
  });
  // Chunky 3D nameplate: a thick body with a raised bezel, corner knobs, a
  // recessed text panel, and a slight backward tilt so it reads dimensional.
  const signGroup = new THREE.Group();
  signGroup.position.set(0, 2.36, 0.06);
  signGroup.rotation.x = -0.1;
  trainingConsoleGroup.add(signGroup);
  const consoleSignFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.52, 0.46, 0.2),
    shellDeep,
  );
  consoleSignFrame.castShadow = true;
  signGroup.add(consoleSignFrame);
  const railLR = new THREE.BoxGeometry(0.06, 0.46, 0.06);
  const railTB = new THREE.BoxGeometry(1.52, 0.06, 0.06);
  [-0.73, 0.73].forEach((x) => {
    const rail = new THREE.Mesh(railLR, shellLime);
    rail.position.set(x, 0, 0.12);
    signGroup.add(rail);
  });
  [0.2, -0.2].forEach((y) => {
    const rail = new THREE.Mesh(railTB, shellLime);
    rail.position.set(0, y, 0.12);
    signGroup.add(rail);
  });
  [
    [-0.73, 0.2],
    [0.73, 0.2],
    [-0.73, -0.2],
    [0.73, -0.2],
  ].forEach(([x, y]) => {
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 16, 14),
      glossWhite,
    );
    knob.position.set(x, y, 0.12);
    signGroup.add(knob);
  });
  const consoleSign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.36, 0.34),
    consoleMarqueeMaterial,
  );
  consoleSign.position.set(0, 0, 0.105);
  signGroup.add(consoleSign);
  for (let i = 0; i < 12; i += 1) {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 14, 12),
      ledMat(i + 3),
    );
    const t = i / 11;
    bulb.position.set(-0.74 + t * 1.48, i % 2 === 0 ? 0.29 : -0.29, 0.11);
    signGroup.add(bulb);
  }

  trainingConsoleGroup.traverse((child) => {
    if (child instanceof THREE.Mesh) child.castShadow = true;
  });
  group.add(trainingConsoleGroup);

  const trainingConsole: MachineRoomTrainingConsoleRuntime = {
    approachLocal: new THREE.Vector3(5.05, bounds.walkY, -3.65),
    activationRadius: 2.55,
  };
  let trainingConsoleWake = 0;

  // Door on the east wall.
  const doorGroup = new THREE.Group();
  doorGroup.position.set(halfX - 0.03, 0, 1.9);
  const doorPanel = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 2.16, 1.02),
    darkWoodMaterial,
  );
  doorPanel.position.y = 1.08;
  doorGroup.add(doorPanel);
  const doorFrame = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 2.28, 1.16),
    new THREE.MeshStandardMaterial({ color: "#d9d2c2", roughness: 0.8 }),
  );
  doorFrame.position.set(0.015, 1.14, 0);
  doorGroup.add(doorFrame);
  doorPanel.position.x = -0.035;
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.16, 10),
    steelMaterial,
  );
  handle.rotation.x = Math.PI / 2;
  handle.position.set(-0.085, 1.05, -0.38);
  doorGroup.add(handle);
  group.add(doorGroup);

  // Framed prints on the south wall.
  [-1.7, 1.7].forEach((x, index) => {
    const printGroup = new THREE.Group();
    printGroup.position.set(x, 1.92, halfZ - 0.05);
    printGroup.rotation.y = Math.PI;
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 1.14, 0.045),
      new THREE.MeshStandardMaterial({ color: "#20242b", roughness: 0.5 }),
    );
    printGroup.add(frame);
    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 1.02),
      new THREE.MeshStandardMaterial({
        map: createPrintTexture(index),
        roughness: 0.9,
        emissive: "#ffffff",
        emissiveMap: createPrintTexture(index),
        emissiveIntensity: 0.05,
      }),
    );
    art.position.z = 0.026;
    printGroup.add(art);
    group.add(printGroup);
  });

  // Sideboard with a small lamp against the west wall.
  const sideboard = new THREE.Group();
  sideboard.position.set(-halfX + 0.24, 0, 0);
  const sideboardBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.66, 1.72),
    walnutMaterial,
  );
  sideboardBody.position.y = 0.37;
  sideboardBody.castShadow = true;
  sideboard.add(sideboardBody);
  const sideboardTop = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.04, 1.8),
    darkWoodMaterial,
  );
  sideboardTop.position.y = 0.72;
  sideboard.add(sideboardTop);
  [-0.42, 0.44].forEach((z) => {
    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.5, 0.012),
      new THREE.MeshStandardMaterial({ color: "#3c2f24", roughness: 0.8 }),
    );
    seam.position.set(0.21, 0.4, z);
    sideboard.add(seam);
  });
  const lampBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 0.045, 16),
    steelMaterial,
  );
  lampBase.position.set(0, 0.765, -0.5);
  sideboard.add(lampBase);
  const lampStem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.014, 0.3, 8),
    steelMaterial,
  );
  lampStem.position.set(0, 0.93, -0.5);
  sideboard.add(lampStem);
  const lampShade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.145, 0.17, 20, 1, true),
    new THREE.MeshStandardMaterial({
      color: "#f5e2c4",
      emissive: "#ffcf9b",
      emissiveIntensity: 0.7,
      roughness: 0.8,
      side: THREE.DoubleSide,
    }),
  );
  lampShade.position.set(0, 1.12, -0.5);
  sideboard.add(lampShade);
  const books = new THREE.Group();
  const bookColors = ["#7d4b3a", "#3f5d70", "#8f8257"];
  bookColors.forEach((color, index) => {
    const book = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.045, 0.14),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85 }),
    );
    book.position.set(0, 0.765 + index * 0.047, 0.42);
    book.rotation.y = index * 0.22 - 0.2;
    books.add(book);
  });
  sideboard.add(books);
  group.add(sideboard);

  // Reading chair and side table in the south-east corner.
  const chairGroup = new THREE.Group();
  chairGroup.position.set(4.72, 0, 3.95);
  chairGroup.rotation.y = Math.PI * 0.78;
  const chairMaterial = new THREE.MeshStandardMaterial({
    color: "#59616d",
    roughness: 0.92,
  });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.2, 0.66), chairMaterial);
  seat.position.y = 0.36;
  seat.castShadow = true;
  chairGroup.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.62, 0.14), chairMaterial);
  back.position.set(0, 0.72, -0.3);
  back.rotation.x = -0.16;
  chairGroup.add(back);
  [-0.31, 0.31].forEach((x) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.6), chairMaterial);
    arm.position.set(x, 0.52, 0);
    chairGroup.add(arm);
  });
  const chairBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.66, 0.26, 0.6),
    darkWoodMaterial,
  );
  chairBase.position.y = 0.13;
  chairGroup.add(chairBase);
  const cushion = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.09, 0.52),
    new THREE.MeshStandardMaterial({ color: "#c8b592", roughness: 1 }),
  );
  cushion.position.y = 0.5;
  cushion.position.z = 0.02;
  chairGroup.add(cushion);
  group.add(chairGroup);

  const sideTable = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.2, 0.5, 20),
    walnutMaterial,
  );
  sideTable.position.set(3.85, 0.25, 4.15);
  sideTable.castShadow = true;
  group.add(sideTable);

  // North-west corner keeps its plant; the north-east one moves to the
  // north-wall bay the console vacated (they traded places).
  [
    [-5.85, -4.5],
    [0, -4.6],
  ].forEach(([px, pz]) => {
    const plant = new THREE.Group();
    plant.position.set(px, 0, pz);
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.2, 0.42, 18),
      new THREE.MeshStandardMaterial({ color: "#4b423b", roughness: 0.85 }),
    );
    pot.position.y = 0.21;
    pot.castShadow = true;
    plant.add(pot);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.05, 0.7, 8),
      new THREE.MeshStandardMaterial({ color: "#5d4a35", roughness: 0.9 }),
    );
    trunk.position.y = 0.75;
    plant.add(trunk);
    const foliageMaterial = new THREE.MeshStandardMaterial({
      color: "#3c6a44",
      roughness: 1,
    });
    const foliageDeep = new THREE.MeshStandardMaterial({
      color: "#2f5637",
      roughness: 1,
    });
    [
      [0, 1.32, 0, 0.42, foliageMaterial],
      [0.22, 1.12, 0.1, 0.3, foliageDeep],
      [-0.2, 1.18, -0.12, 0.28, foliageMaterial],
    ].forEach(([fx, fy, fz, radius, material]) => {
      const tuft = new THREE.Mesh(
        new THREE.IcosahedronGeometry(radius as number, 1),
        material as THREE.MeshStandardMaterial,
      );
      tuft.position.set(fx as number, fy as number, fz as number);
      tuft.castShadow = true;
      plant.add(tuft);
    });
    group.add(plant);
  });

  /* ------------------------------------------------------------------ *
   * Pedestal table
   * ------------------------------------------------------------------ */
  const pedestal = new THREE.Group();
  pedestal.name = "machine-pedestal";
  const tableTop = new THREE.Mesh(
    new THREE.BoxGeometry(3.95, 0.07, 1.9),
    walnutMaterial,
  );
  // Table top lowered to 0.635 (was 0.975) so the machine deck sits low and
  // the visitor looks down onto it. Legs are shortened to match rather than
  // sinking the feet through the floor.
  tableTop.position.y = 0.635;
  tableTop.castShadow = true;
  tableTop.receiveShadow = true;
  pedestal.add(tableTop);
  const tableApron = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 0.12, 1.6),
    anodizeMaterial,
  );
  tableApron.position.y = 0.545;
  pedestal.add(tableApron);
  [-1.55, 1.55].forEach((x) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.49, 1.35), steelMaterial);
    leg.position.set(x, 0.245, 0);
    leg.castShadow = true;
    pedestal.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.045, 1.5), anodizeMaterial);
    foot.position.set(x, 0.024, 0);
    pedestal.add(foot);
  });
  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(0.56, 0.14),
    new THREE.MeshStandardMaterial({
      map: createPlaqueTexture(),
      roughness: 0.5,
      metalness: 0.3,
    }),
  );
  plaque.position.set(0, 0.545, 0.802);
  pedestal.add(plaque);
  group.add(pedestal);

  // Machine platform on the table: a chunky two-tier gunmetal deck with a
  // chrome band and bolted corner caps, rimmed by a cool accent glow.
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 0.07, 1.52),
    anodizeMaterial,
  );
  platform.position.y = PLATFORM_TOP_Y - 0.035;
  platform.castShadow = true;
  platform.receiveShadow = true;
  group.add(platform);
  const platformSkirt = new THREE.Mesh(
    new THREE.BoxGeometry(3.52, 0.05, 1.64),
    steelMaterial,
  );
  platformSkirt.position.y = PLATFORM_TOP_Y - 0.088;
  platformSkirt.castShadow = true;
  group.add(platformSkirt);
  const platformBand = new THREE.Mesh(
    new THREE.BoxGeometry(3.44, 0.016, 1.56),
    chromePipeMaterial,
  );
  platformBand.position.y = PLATFORM_TOP_Y - 0.066;
  group.add(platformBand);
  [-1.62, 1.62].forEach((cornerX) => {
    [-0.68, 0.68].forEach((cornerZ) => {
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.065, 0.03, 10),
        alloyMaterial,
      );
      cap.position.set(cornerX, PLATFORM_TOP_Y + 0.012, cornerZ);
      group.add(cap);
      const capBolt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.016, 0.02, 6),
        anodizeMaterial,
      );
      capBolt.position.set(cornerX, PLATFORM_TOP_Y + 0.032, cornerZ);
      group.add(capBolt);
    });
  });
  const underGlowMaterial = new THREE.MeshStandardMaterial({
    color: "#101a26",
    emissive: "#8fc6ff",
    emissiveIntensity: 0.7,
    roughness: 0.4,
    metalness: 0.3,
  });
  const underGlowSpecs: Array<[number, number, number, number]> = [
    [0, 0.79, 3.44, 0],
    [0, -0.79, 3.44, 0],
    [1.72, 0, 1.56, Math.PI / 2],
    [-1.72, 0, 1.56, Math.PI / 2],
  ];
  underGlowSpecs.forEach(([x, z, length, rotationY]) => {
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.018, 0.02),
      underGlowMaterial,
    );
    strip.position.set(x, PLATFORM_TOP_Y - 0.065, z);
    strip.rotation.y = rotationY;
    group.add(strip);
  });

  /* ------------------------------------------------------------------ *
   * Machine units
   * ------------------------------------------------------------------ */
  const pickRoot = new THREE.Group();
  pickRoot.name = "machine-units";
  group.add(pickRoot);

  const accentMaterialFor = (spec: UnitSpec, intensity = 0.55) =>
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(spec.accent).multiplyScalar(0.35),
      emissive: spec.accent,
      emissiveIntensity: intensity,
      roughness: 0.24,
      metalness: 0.5,
      envMapIntensity: 1.5,
    });

  // The tower core is animated separately (a slow fade/strengthen cyan pulse)
  // instead of a constant glow, so it stays a prominent cyan without blooming
  // out to white. Captured here so update() can breathe it each frame.
  let towerCoreMaterial: THREE.MeshStandardMaterial | null = null;

  const buildDataPrep = (spec: UnitSpec): UnitBuildResult => {
    const unit = new THREE.Group();
    const accent = accentMaterialFor(spec);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.32), alloyMaterial);
    base.position.y = PLATFORM_TOP_Y + 0.05;
    unit.add(base);
    const funnel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.055, 0.24, 20, 1, true),
      alloyMaterial,
    );
    funnel.position.y = PLATFORM_TOP_Y + 0.3;
    unit.add(funnel);
    const funnelRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.18, 0.014, 10, 28),
      accent,
    );
    funnelRim.rotation.x = Math.PI / 2;
    funnelRim.position.y = PLATFORM_TOP_Y + 0.42;
    unit.add(funnelRim);
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.1, 14),
      chromePipeMaterial,
    );
    neck.position.y = PLATFORM_TOP_Y + 0.14;
    unit.add(neck);
    const pages: THREE.Object3D[] = [];
    const pageMaterial = new THREE.MeshStandardMaterial({
      color: "#f2efe4",
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    for (let page = 0; page < 3; page += 1) {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.12), pageMaterial);
      sheet.position.set(
        (page - 1) * 0.05,
        PLATFORM_TOP_Y + 0.52 + page * 0.055,
        (page % 2) * 0.04 - 0.02,
      );
      sheet.rotation.set(0.4 + page * 0.5, page * 1.1, 0.2);
      unit.add(sheet);
      pages.push(sheet);
    }
    return { group: unit, accentMaterials: [accent], spinners: [], pages };
  };

  const buildEmbedding = (spec: UnitSpec): UnitBuildResult => {
    const unit = new THREE.Group();
    const accent = accentMaterialFor(spec);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.32), alloyMaterial);
    slab.position.y = PLATFORM_TOP_Y + 0.05;
    unit.add(slab);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.28), anodizeMaterial);
    bed.position.y = PLATFORM_TOP_Y + 0.11;
    unit.add(bed);
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const height = 0.05 + ((row * 5 + column * 3) % 4) * 0.028;
        const column3d = new THREE.Mesh(
          new THREE.BoxGeometry(0.038, height, 0.038),
          accent,
        );
        column3d.position.set(
          -0.105 + column * 0.07,
          PLATFORM_TOP_Y + 0.125 + height / 2,
          -0.105 + row * 0.07,
        );
        unit.add(column3d);
      }
    }
    return { group: unit, accentMaterials: [accent], spinners: [] };
  };

  const buildTower = (spec: UnitSpec): UnitBuildResult => {
    const unit = new THREE.Group();
    const accent = accentMaterialFor(spec, 0.3);
    // A saturated cyan rod: the diffuse color is a strong cyan so it reads as
    // cyan even when lit, and the emissive is low and animated (breathing in
    // update()) rather than a constant bloom.
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#22c3ee"),
      emissive: new THREE.Color("#31d4ff"),
      emissiveIntensity: 0.16,
      roughness: 0.34,
      metalness: 0.15,
      envMapIntensity: 0.8,
    });
    towerCoreMaterial = coreMaterial;
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.31, 0.34, 0.12, 24),
      anodizeMaterial,
    );
    drum.position.y = PLATFORM_TOP_Y + 0.06;
    drum.castShadow = true;
    unit.add(drum);
    // Bolt ring around the drum: reads as machined, load-bearing.
    for (let bolt = 0; bolt < 8; bolt += 1) {
      const stud = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.016, 0.02, 6),
        chromePipeMaterial,
      );
      const angle = (bolt / 8) * TAU;
      stud.position.set(
        Math.cos(angle) * 0.315,
        PLATFORM_TOP_Y + 0.06,
        Math.sin(angle) * 0.315,
      );
      stud.rotation.z = Math.PI / 2;
      stud.rotation.y = -angle;
      unit.add(stud);
    }
    const spinners: UnitBuildResult["spinners"] = [];
    [0, 1].forEach((block) => {
      const segmentY = PLATFORM_TOP_Y + 0.34 + block * 0.5;
      const glass = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.26, 0.42, 8, 1, true),
        glassMaterial,
      );
      glass.position.y = segmentY;
      unit.add(glass);
      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(0.085, 0.085, 0.38, 12),
        coreMaterial,
      );
      core.position.y = segmentY;
      unit.add(core);
      spinners.push({ object: core, axis: "y", speed: 0.5 + block * 0.22 });
      const fins = new THREE.Group();
      for (let fin = 0; fin < 4; fin += 1) {
        const blade = new THREE.Mesh(
          new THREE.BoxGeometry(0.13, 0.05, 0.02),
          alloyMaterial,
        );
        blade.position.x = 0.13;
        const holder = new THREE.Group();
        holder.rotation.y = (fin / 4) * TAU;
        holder.add(blade);
        fins.add(holder);
      }
      fins.position.y = segmentY;
      unit.add(fins);
      spinners.push({ object: fins, axis: "y", speed: -0.34 });
      const separator = new THREE.Mesh(
        new THREE.CylinderGeometry(0.29, 0.29, 0.055, 24),
        anodizeMaterial,
      );
      separator.position.y = segmentY + 0.25;
      separator.castShadow = true;
      unit.add(separator);
      const separatorRim = new THREE.Mesh(
        new THREE.TorusGeometry(0.285, 0.011, 8, 30),
        chromePipeMaterial,
      );
      separatorRim.rotation.x = Math.PI / 2;
      separatorRim.position.y = segmentY + 0.25;
      unit.add(separatorRim);
    });
    // Four exterior struts clamp the glass segments to the frame.
    for (let strut = 0; strut < 4; strut += 1) {
      const angle = (strut / 4) * TAU + Math.PI / 4;
      const rail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.014, 1.28, 8),
        steelMaterial,
      );
      rail.position.set(
        Math.cos(angle) * 0.295,
        PLATFORM_TOP_Y + 0.74,
        Math.sin(angle) * 0.295,
      );
      unit.add(rail);
    }
    // Low-profile anodized cap: deliberately not a lampshade — the old
    // bright flared crown read as a glowing pendant and washed out the view.
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.27, 0.09, 24),
      anodizeMaterial,
    );
    cap.position.y = PLATFORM_TOP_Y + 1.36;
    cap.castShadow = true;
    unit.add(cap);
    const capRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.255, 0.012, 8, 30),
      chromePipeMaterial,
    );
    capRim.rotation.x = Math.PI / 2;
    capRim.position.y = PLATFORM_TOP_Y + 1.4;
    unit.add(capRim);
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.018, 0.14, 8),
      steelMaterial,
    );
    mast.position.y = PLATFORM_TOP_Y + 1.47;
    unit.add(mast);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), accent);
    beacon.position.y = PLATFORM_TOP_Y + 1.55;
    unit.add(beacon);
    return { group: unit, accentMaterials: [accent, coreMaterial], spinners };
  };

  const buildVocabularyHead = (spec: UnitSpec): UnitBuildResult => {
    const unit = new THREE.Group();
    const accent = accentMaterialFor(spec);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.24), alloyMaterial);
    body.position.y = PLATFORM_TOP_Y + 0.13;
    body.castShadow = true;
    unit.add(body);
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.075, 0.05, 18),
      accent,
    );
    lens.rotation.z = Math.PI / 2;
    lens.position.set(0.145, PLATFORM_TOP_Y + 0.15, 0);
    unit.add(lens);
    // A fan of 16 vocabulary bars rising from the projector.
    const fan = new THREE.Group();
    for (let bar = 0; bar < 16; bar += 1) {
      const spread = (bar / 15 - 0.5) * 0.9;
      const height = 0.1 + Math.abs(Math.sin(bar * 1.7)) * 0.13;
      const column = new THREE.Mesh(
        new THREE.BoxGeometry(0.022, height, 0.022),
        bar % 5 === 0 ? accent : alloyMaterial,
      );
      column.position.set(0.05 + Math.abs(spread) * 0.08, height / 2, spread * 0.24);
      fan.add(column);
    }
    fan.position.set(0.12, PLATFORM_TOP_Y + 0.22, 0);
    unit.add(fan);
    return { group: unit, accentMaterials: [accent], spinners: [] };
  };

  const buildLossMeter = (spec: UnitSpec): UnitBuildResult => {
    const unit = new THREE.Group();
    const accent = accentMaterialFor(spec, 0.75);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.26), alloyMaterial);
    stand.position.y = PLATFORM_TOP_Y + 0.06;
    unit.add(stand);
    const dialGroup = new THREE.Group();
    dialGroup.position.set(0, PLATFORM_TOP_Y + 0.32, 0.02);
    dialGroup.rotation.x = -0.28;
    const dial = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.17, 0.05, 28),
      anodizeMaterial,
    );
    dial.rotation.x = Math.PI / 2;
    dialGroup.add(dial);
    const dialFace = new THREE.Mesh(new THREE.CircleGeometry(0.15, 28), accent);
    dialFace.position.z = 0.027;
    dialGroup.add(dialFace);
    const needle = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.13, 0.012),
      new THREE.MeshStandardMaterial({
        color: "#2b2b2b",
        emissive: "#ffffff",
        emissiveIntensity: 0.4,
        roughness: 0.4,
      }),
    );
    needle.position.set(0, 0.055, 0.036);
    const needlePivot = new THREE.Group();
    needlePivot.add(needle);
    needlePivot.position.z = 0.002;
    dialGroup.add(needlePivot);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.016, 10, 30), chromePipeMaterial);
    bezel.position.z = 0.027;
    dialGroup.add(bezel);
    unit.add(dialGroup);
    return { group: unit, accentMaterials: [accent], spinners: [], needle: needlePivot };
  };

  const buildBackpropReturn = (spec: UnitSpec): UnitBuildResult => {
    const unit = new THREE.Group();
    const accent = accentMaterialFor(spec, 0.32);
    const conduitCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(1.28, PLATFORM_TOP_Y + 0.34, -0.34),
      new THREE.Vector3(0.9, PLATFORM_TOP_Y + 0.44, -0.44),
      new THREE.Vector3(0.34, PLATFORM_TOP_Y + 0.46, -0.46),
      new THREE.Vector3(-0.24, PLATFORM_TOP_Y + 0.44, -0.46),
      new THREE.Vector3(-0.6, PLATFORM_TOP_Y + 0.34, -0.44),
    ]);
    // Bright solid red pipe (a distinct color from the tower and the amber
    // forward pipes) with only a faint sheen sleeve — no strong glow.
    const conduit = new THREE.Mesh(
      new THREE.TubeGeometry(conduitCurve, 40, 0.036, 10),
      new THREE.MeshStandardMaterial({
        color: "#ff5f52",
        roughness: 0.42,
        metalness: 0.35,
        envMapIntensity: 1,
      }),
    );
    unit.add(conduit);
    const sleeve = new THREE.Mesh(
      new THREE.TubeGeometry(conduitCurve, 40, 0.044, 10),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(spec.accent).multiplyScalar(0.4),
        emissive: spec.accent,
        emissiveIntensity: 0.1,
        transparent: true,
        opacity: 0.16,
        roughness: 0.4,
      }),
    );
    unit.add(sleeve);
    [0.28, 0.52, 0.76].forEach((t) => {
      const finPosition = conduitCurve.getPointAt(t);
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.11, 10), accent);
      fin.rotation.z = Math.PI / 2;
      fin.position.copy(finPosition);
      fin.position.y += 0.005;
      unit.add(fin);
    });
    unit.userData.conduitCurve = conduitCurve;
    return { group: unit, accentMaterials: [accent], spinners: [] };
  };

  const buildOptimizer = (spec: UnitSpec): UnitBuildResult => {
    const unit = new THREE.Group();
    const accent = accentMaterialFor(spec, 0.8);
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.12, 0.3),
      alloyMaterial,
    );
    housing.position.y = PLATFORM_TOP_Y + 0.06;
    housing.castShadow = true;
    unit.add(housing);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 14), accent);
    core.position.y = PLATFORM_TOP_Y + 0.28;
    unit.add(core);
    const ringOuter = new THREE.Mesh(
      new THREE.TorusGeometry(0.14, 0.018, 10, 30),
      chromePipeMaterial,
    );
    const ringInner = new THREE.Mesh(
      new THREE.TorusGeometry(0.1, 0.015, 10, 26),
      accent,
    );
    const ringOuterPivot = new THREE.Group();
    ringOuterPivot.add(ringOuter);
    ringOuterPivot.position.y = PLATFORM_TOP_Y + 0.28;
    ringOuterPivot.rotation.x = 0.6;
    const ringInnerPivot = new THREE.Group();
    ringInnerPivot.add(ringInner);
    ringInnerPivot.position.y = PLATFORM_TOP_Y + 0.28;
    ringInnerPivot.rotation.z = 0.7;
    unit.add(ringOuterPivot, ringInnerPivot);
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.12, 10),
      steelMaterial,
    );
    post.position.y = PLATFORM_TOP_Y + 0.16;
    unit.add(post);
    return {
      group: unit,
      accentMaterials: [accent],
      spinners: [
        { object: ringOuterPivot, axis: "y", speed: 0.9 },
        { object: ringInnerPivot, axis: "x", speed: -1.15 },
      ],
    };
  };

  const builders = [
    buildDataPrep,
    buildEmbedding,
    buildTower,
    buildVocabularyHead,
    buildLossMeter,
    buildBackpropReturn,
    buildOptimizer,
  ];

  interface UnitInternals {
    accentMaterials: THREE.MeshStandardMaterial[];
    baseIntensities: number[];
    spinners: UnitBuildResult["spinners"];
    needle?: THREE.Object3D;
    pages?: THREE.Object3D[];
    labelMaterial: THREE.SpriteMaterial;
    label: THREE.Sprite;
    ringMaterial: THREE.MeshBasicMaterial;
  }

  const units: MachineRoomUnitRuntime[] = [];
  const unitInternals: UnitInternals[] = [];

  // Deck nameplates for the front-row units, in machine-local coords, each
  // plate just south of its unit. The two elevated rear units (backprop
  // conduit, optimizer) are NOT here — their signs are mounted up in front of
  // them at their raised height instead, so they aren't hidden on the deck
  // behind the front row.
  const nameplateLocalByField: Record<string, [number, number]> = {
    "data-prep": [-1.3, 0.44],
    embedding: [-0.72, 0.42],
    "transformer-tower": [0, 0.52],
    "vocabulary-head": [0.7, 0.42],
    "loss-meter": [1.3, 0.44],
  };

  /** Little desk-sign: brushed base plus an angled, always-on name face. */
  const buildNameplate = (spec: UnitSpec): THREE.Group => {
    const plateGroup = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.022, 0.075),
      steelMaterial,
    );
    base.position.y = 0.011;
    base.castShadow = true;
    plateGroup.add(base);
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.12, 0.014),
      anodizeMaterial,
    );
    plate.castShadow = true;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.288, 0.108),
      new THREE.MeshBasicMaterial({
        map: createNameplateTexture(spec),
        transparent: true,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    face.position.z = 0.009;
    plate.add(face);
    plate.position.set(0, 0.082, 0.012);
    plate.rotation.x = -0.34; // lean back so it reads from standing height
    plateGroup.add(plate);
    return plateGroup;
  };

  /**
   * Nameplate mounted on the front of an elevated unit's stand: a bolted
   * plate on a short boss, facing the room and tipped up slightly. Used for
   * the two raised rear units so their names ride up with them instead of
   * sitting on the deck.
   */
  const buildMountedNameplate = (spec: UnitSpec): THREE.Group => {
    const signGroup = new THREE.Group();
    const boss = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.055, 0.08),
      anodizeMaterial,
    );
    boss.position.z = -0.04;
    signGroup.add(boss);
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.13, 0.016),
      anodizeMaterial,
    );
    plate.castShadow = true;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.115),
      new THREE.MeshBasicMaterial({
        map: createNameplateTexture(spec),
        transparent: true,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    face.position.z = 0.01;
    plate.add(face);
    [-0.135, 0.135].forEach((bx) => {
      const bolt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.02, 6),
        chromePipeMaterial,
      );
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(bx, 0, 0.012);
      plate.add(bolt);
    });
    plate.rotation.x = -0.12; // tip up toward the viewer
    signGroup.add(plate);
    return signGroup;
  };

  /**
   * Slender machined stand that raises a rear unit off the deck: a bolted
   * base flange, a tapered column with chrome collars, optional guy struts,
   * and either a saddle (for a pipe to rest in) or a flat cap (for a unit to
   * sit on). Placed in machine-local coords like the rest of the deck.
   */
  const buildSupportPost = (
    x: number,
    z: number,
    topY: number,
    options: { radius?: number; struts?: boolean; saddle?: boolean } = {},
  ): THREE.Group => {
    const { radius = 0.03, struts = false, saddle = false } = options;
    const stand = new THREE.Group();
    stand.position.set(x, 0, z);
    const baseY = PLATFORM_TOP_Y + 0.006;
    const height = Math.max(0.08, topY - baseY);
    const flange = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 3, radius * 3.6, 0.028, 18),
      steelMaterial,
    );
    flange.position.y = baseY + 0.014;
    flange.castShadow = true;
    stand.add(flange);
    for (let bolt = 0; bolt < 5; bolt += 1) {
      const stud = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, 0.016, 6),
        chromePipeMaterial,
      );
      const angle = (bolt / 5) * TAU;
      stud.position.set(
        Math.cos(angle) * radius * 2.5,
        baseY + 0.03,
        Math.sin(angle) * radius * 2.5,
      );
      stand.add(stud);
    }
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 1.25, height, 14),
      alloyMaterial,
    );
    column.position.y = baseY + height / 2;
    column.castShadow = true;
    stand.add(column);
    [0.34, 0.7].forEach((frac) => {
      const collar = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 1.35, radius * 0.34, 8, 20),
        chromePipeMaterial,
      );
      collar.rotation.x = Math.PI / 2;
      collar.position.y = baseY + height * frac;
      stand.add(collar);
    });
    if (struts) {
      for (let s = 0; s < 3; s += 1) {
        const angle = (s / 3) * TAU;
        const strut = new THREE.Mesh(
          new THREE.CylinderGeometry(0.008, 0.008, height * 0.66, 6),
          steelMaterial,
        );
        strut.position.set(
          Math.cos(angle) * radius * 1.8,
          baseY + height * 0.36,
          Math.sin(angle) * radius * 1.8,
        );
        strut.rotation.z = -Math.cos(angle) * 0.3;
        strut.rotation.x = Math.sin(angle) * 0.3;
        strut.castShadow = true;
        stand.add(strut);
      }
    }
    if (saddle) {
      const cradle = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.024, 0.06),
        steelMaterial,
      );
      cradle.position.y = topY - 0.004;
      cradle.castShadow = true;
      stand.add(cradle);
    } else {
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 2.3, radius * 1.7, 0.03, 16),
        alloyMaterial,
      );
      cap.position.y = topY - 0.015;
      cap.castShadow = true;
      stand.add(cap);
    }
    return stand;
  };

  UNIT_SPECS.forEach((spec, index) => {
    const builder = builders[index];
    const built = builder(spec);
    const unitGroup = built.group;
    unitGroup.name = `machine-unit-${spec.id}`;
    unitGroup.userData.machineUnitIndex = index;
    // Rear units (backprop conduit 5, optimizer 6) are lifted onto stands.
    const unitLift = index === 5 || index === 6 ? BACK_ROW_LIFT : 0;
    // Units are authored around their own origin at platform height, except
    // the backprop conduit (index 5), which is authored in machine
    // coordinates directly because it spans several units.
    if (index === 5) {
      unitGroup.position.set(0, unitLift, 0);
    } else {
      unitGroup.position.set(spec.focus[0], unitLift, spec.focus[2]);
    }
    unitGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true;
    });

    // Generous invisible pick proxy so aiming is forgiving.
    const proxySize =
      index === 2
        ? new THREE.Vector3(0.75, 1.6, 0.75)
        : index === 5
          ? new THREE.Vector3(2.05, 0.4, 0.4)
          : new THREE.Vector3(0.5, 0.62, 0.5);
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(proxySize.x, proxySize.y, proxySize.z),
      invisiblePickMaterial(),
    );
    if (index === 5) {
      proxy.position.set(0.34, PLATFORM_TOP_Y + 0.42, -0.44);
    } else {
      proxy.position.set(
        0,
        index === 2 ? PLATFORM_TOP_Y + 0.78 : PLATFORM_TOP_Y + 0.3,
        0,
      );
    }
    proxy.userData.machinePickProxy = true;
    unitGroup.add(proxy);

    // Accent glow ring on the platform under the unit.
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: spec.accent,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(spec.ringRadius * 0.82, spec.ringRadius, 36),
      ringMaterial,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(spec.ringCenter[0], PLATFORM_TOP_Y + 0.006, spec.ringCenter[1]);
    group.add(ring);

    // Hover label.
    const labelMaterial = new THREE.SpriteMaterial({
      map: createUnitLabelTexture(spec),
      transparent: true,
      opacity: 0,
      depthTest: false,
      toneMapped: false,
    });
    const label = new THREE.Sprite(labelMaterial);
    label.scale.set(1.06, 0.4, 1);
    const labelY =
      index === 2 ? PLATFORM_TOP_Y + 1.78 : spec.focus[1] + unitLift + 0.42;
    label.position.set(spec.focus[0], labelY, spec.focus[2]);
    label.renderOrder = 40;
    label.visible = false;
    group.add(label);

    // Always-on desk nameplate in front of the unit.
    const nameplateSpot = nameplateLocalByField[spec.id];
    if (nameplateSpot) {
      const nameplate = buildNameplate(spec);
      nameplate.position.set(
        nameplateSpot[0],
        PLATFORM_TOP_Y + 0.012,
        nameplateSpot[1],
      );
      group.add(nameplate);
    }

    pickRoot.add(unitGroup);

    units.push({
      id: spec.id,
      label: spec.label,
      sublabel: spec.sublabel,
      stationIndex: spec.stationIndex,
      accent: new THREE.Color(spec.accent),
      focusLocal: new THREE.Vector3(
        spec.focus[0],
        spec.focus[1] + unitLift,
        spec.focus[2],
      ),
      approachRadius: spec.approachRadius,
      overlookLocal: new THREE.Vector3(...spec.overlook),
      aimLocals: [
        new THREE.Vector3(spec.focus[0], spec.focus[1] + unitLift, spec.focus[2]),
        ...(spec.aimPoints ?? []).map(
          (point) => new THREE.Vector3(point[0], point[1] + unitLift, point[2]),
        ),
      ],
      aimRadius: spec.aimRadius,
      pickGroup: unitGroup,
      highlight: 0,
    });
    unitInternals.push({
      accentMaterials: built.accentMaterials,
      baseIntensities: built.accentMaterials.map(
        (material) => material.emissiveIntensity,
      ),
      spinners: built.spinners,
      needle: built.needle,
      pages: built.pages,
      labelMaterial,
      label,
      ringMaterial,
    });
  });

  /* ------------------------------------------------------------------ *
   * Plumbing between units, with flowing pulses
   * ------------------------------------------------------------------ */
  const plumbing = new THREE.Group();
  plumbing.name = "machine-plumbing";
  const lanes: PulseLane[] = [];
  const pulseParent = new THREE.Group();
  group.add(pulseParent);

  const addLane = (
    points: THREE.Vector3[],
    color: string,
    pulseCount: number,
    speed: number,
    reverse: boolean,
    tubeRadius = 0.018,
    tubeMaterial: THREE.Material = laneTubeMaterial,
  ) => {
    const curve = new THREE.CatmullRomCurve3(points);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 32, tubeRadius, 8),
      tubeMaterial,
    );
    plumbing.add(tube);
    const pulses: THREE.Mesh[] = [];
    // Tone-mapped (not full-bright) so the signal dots read as colored beads
    // rather than blooming light.
    const pulseMaterial = new THREE.MeshBasicMaterial({
      color,
      toneMapped: true,
      transparent: true,
      opacity: 0.92,
    });
    for (let pulse = 0; pulse < pulseCount; pulse += 1) {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), pulseMaterial);
      pulseParent.add(orb);
      pulses.push(orb);
    }
    lanes.push({ curve, pulses, speed, reverse });
  };

  const forwardY = PLATFORM_TOP_Y + 0.16;
  addLane(
    [
      new THREE.Vector3(-1.3, PLATFORM_TOP_Y + 0.1, 0.1),
      new THREE.Vector3(-1.0, forwardY, 0.16),
      new THREE.Vector3(-0.74, forwardY, 0.12),
    ],
    PHASE_COLORS.data,
    2,
    0.16,
    false,
  );
  addLane(
    [
      new THREE.Vector3(-0.7, forwardY, 0.12),
      new THREE.Vector3(-0.36, forwardY + 0.04, 0.1),
      new THREE.Vector3(-0.1, PLATFORM_TOP_Y + 0.3, 0.02),
    ],
    "#6fb7ff",
    2,
    0.18,
    false,
  );
  addLane(
    [
      new THREE.Vector3(0.1, PLATFORM_TOP_Y + 0.3, 0.02),
      new THREE.Vector3(0.4, forwardY + 0.04, 0.1),
      new THREE.Vector3(0.68, forwardY, 0.12),
    ],
    PHASE_COLORS.forward,
    2,
    0.18,
    false,
  );
  addLane(
    [
      new THREE.Vector3(0.72, forwardY, 0.12),
      new THREE.Vector3(1.02, forwardY, 0.16),
      new THREE.Vector3(1.3, PLATFORM_TOP_Y + 0.14, 0.1),
    ],
    "#9adcff",
    2,
    0.16,
    false,
  );
  // Loss climbs up a riser to meet the elevated backprop conduit.
  addLane(
    [
      new THREE.Vector3(1.32, PLATFORM_TOP_Y + 0.3, 0.06),
      new THREE.Vector3(1.42, PLATFORM_TOP_Y + 0.62, -0.18),
      new THREE.Vector3(1.3, PLATFORM_TOP_Y + 0.32 + BACK_ROW_LIFT, -0.34),
    ],
    PHASE_COLORS.loss,
    1,
    0.2,
    false,
  );
  // Backprop conduit pulses run right-to-left along the lifted conduit, so
  // every point carries the same rear lift as the conduit geometry.
  addLane(
    [
      new THREE.Vector3(1.28, PLATFORM_TOP_Y + 0.34 + BACK_ROW_LIFT, -0.34),
      new THREE.Vector3(0.9, PLATFORM_TOP_Y + 0.44 + BACK_ROW_LIFT, -0.44),
      new THREE.Vector3(0.34, PLATFORM_TOP_Y + 0.46 + BACK_ROW_LIFT, -0.46),
      new THREE.Vector3(-0.24, PLATFORM_TOP_Y + 0.44 + BACK_ROW_LIFT, -0.46),
      new THREE.Vector3(-0.6, PLATFORM_TOP_Y + 0.34 + BACK_ROW_LIFT, -0.44),
    ],
    PHASE_COLORS.backward,
    3,
    0.14,
    false,
    0.006,
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  // Optimizer feedback drops from the elevated optimizer down into the tower
  // base, so the update stream reads as flowing back down into the stack.
  addLane(
    [
      new THREE.Vector3(-0.62, PLATFORM_TOP_Y + 0.2 + BACK_ROW_LIFT, -0.42),
      new THREE.Vector3(-0.42, PLATFORM_TOP_Y + 0.34, -0.28),
      new THREE.Vector3(-0.16, PLATFORM_TOP_Y + 0.16, -0.14),
    ],
    PHASE_COLORS.update,
    2,
    0.2,
    false,
  );
  group.add(plumbing);

  /* ------------------------------------------------------------------ *
   * Rear support stands
   *
   * The optimizer sits on a braced central column; the elevated conduit
   * rests in two saddle stanchions that flank the tower. The glow rings and
   * nameplates stay on the deck at each unit's footprint, so the stand reads
   * as rising out of its marked spot.
   * ------------------------------------------------------------------ */
  group.add(
    buildSupportPost(-0.66, -0.44, PLATFORM_TOP_Y + BACK_ROW_LIFT, {
      radius: 0.05,
      struts: true,
    }),
  );
  group.add(
    buildSupportPost(0.9, -0.44, PLATFORM_TOP_Y + 0.44 + BACK_ROW_LIFT - 0.05, {
      radius: 0.028,
      saddle: true,
    }),
  );
  group.add(
    buildSupportPost(-0.42, -0.46, PLATFORM_TOP_Y + 0.4 + BACK_ROW_LIFT - 0.05, {
      radius: 0.028,
      saddle: true,
    }),
  );

  // Elevated nameplates: mounted in front of each raised rear unit, at its
  // height, so the names travel up with the units.
  const specById = (id: string) =>
    UNIT_SPECS.find((candidate) => candidate.id === id) as UnitSpec;
  const optimizerSign = buildMountedNameplate(specById("adamw-optimizer"));
  optimizerSign.position.set(-0.66, PLATFORM_TOP_Y + BACK_ROW_LIFT - 0.08, -0.32);
  group.add(optimizerSign);
  const backpropSign = buildMountedNameplate(specById("backprop-return"));
  backpropSign.position.set(0.9, PLATFORM_TOP_Y + 0.44 + BACK_ROW_LIFT - 0.26, -0.32);
  group.add(backpropSign);

  /* ------------------------------------------------------------------ *
   * Room lighting
   * ------------------------------------------------------------------ */
  const roomHemisphere = new THREE.HemisphereLight("#ffe8cd", "#3a3129", 0.5);
  group.add(roomHemisphere);

  // Cool key light over the machine: bright enough for crisp metal
  // highlights, dim enough that emissives and bloom stay legible.
  const machineSpot = new THREE.SpotLight("#e8f0fc", 38, 24, 0.66, 0.7, 1.5);
  machineSpot.position.set(0, roomHeight - 0.1, 1.35);
  machineSpot.castShadow = true;
  machineSpot.shadow.mapSize.set(1024, 1024);
  machineSpot.shadow.camera.near = 0.4;
  machineSpot.shadow.camera.far = 26;
  machineSpot.shadow.bias = -0.0003;
  machineSpot.shadow.normalBias = 0.05;
  machineSpot.target.position.set(0, 0.86, 0);
  group.add(machineSpot, machineSpot.target);

  // Small warm reading lamp on the sideboard, kept low so it reads as a
  // detail rather than a light source that washes the back wall.
  const lampLight = new THREE.PointLight("#ffb877", 2.6, 5, 2);
  lampLight.position.set(-halfX + 0.24, 1.02, -0.5);
  group.add(lampLight);

  // The previous cool point light near the north wall bloomed into a bright
  // patch that distracted from the machine. The emissive window panes already
  // supply the dusk-window look, so no extra back light is needed.

  /* ------------------------------------------------------------------ *
   * Runtime
   * ------------------------------------------------------------------ */
  const unitIndexForStation = (stationIndex: number): number => {
    for (let index = 0; index < UNIT_STATION_RANGES.length; index += 1) {
      const [from, to] = UNIT_STATION_RANGES[index];
      if (stationIndex >= from && stationIndex <= to) return index;
    }
    return 2; // Overview chambers fall back to the tower vantage.
  };

  const update = (
    elapsed: number,
    delta: number,
    hoveredIndex: number,
    motionEnabled: boolean,
    trainingConsoleNearby: boolean,
  ) => {
    units.forEach((unit, index) => {
      const internals = unitInternals[index];
      const target = index === hoveredIndex ? 1 : 0;
      unit.highlight = THREE.MathUtils.damp(unit.highlight, target, 9, delta);
      const highlight = unit.highlight;
      internals.accentMaterials.forEach((material, materialIndex) => {
        material.emissiveIntensity =
          internals.baseIntensities[materialIndex] *
          (1 + highlight * 1.7 + (motionEnabled ? Math.sin(elapsed * 1.4 + index) * 0.07 : 0));
      });
      internals.labelMaterial.opacity = highlight;
      internals.label.visible = highlight > 0.02;
      internals.ringMaterial.opacity = 0.14 + highlight * 0.5;

      // Tower core breathes a prominent cyan: a slow fade up and down that
      // overrides the generic emissive set above, kept below the bloom
      // whiteout point so it stays cyan.
      if (index === 2 && towerCoreMaterial) {
        const breathe = motionEnabled ? 0.5 + 0.5 * Math.sin(elapsed * 1.05) : 0.5;
        towerCoreMaterial.emissiveIntensity = 0.14 + breathe * 0.46;
      }

      if (motionEnabled) {
        internals.spinners.forEach((spinner) => {
          spinner.object.rotation[spinner.axis] += spinner.speed * delta;
        });
        if (internals.needle) {
          internals.needle.rotation.z =
            Math.sin(elapsed * 0.9) * 0.55 - 0.2;
        }
        internals.pages?.forEach((page, pageIndex) => {
          page.position.y =
            PLATFORM_TOP_Y + 0.52 + pageIndex * 0.055 +
            Math.sin(elapsed * 1.6 + pageIndex * 2.1) * 0.02;
          page.rotation.y += delta * (0.4 + pageIndex * 0.16);
        });
      }
    });

    if (motionEnabled) {
      lanes.forEach((lane, laneIndex) => {
        lane.pulses.forEach((pulse, pulseIndex) => {
          const t =
            (elapsed * lane.speed + pulseIndex / lane.pulses.length + laneIndex * 0.13) % 1;
          lane.curve.getPointAt(lane.reverse ? 1 - t : t, pulse.position);
        });
      });
      underGlowMaterial.emissiveIntensity = 0.66 + Math.sin(elapsed * 0.8) * 0.12;
    } else {
      lanes.forEach((lane) => {
        lane.pulses.forEach((pulse, pulseIndex) => {
          lane.curve.getPointAt(
            (pulseIndex + 0.5) / lane.pulses.length,
            pulse.position,
          );
        });
      });
    }

    trainingConsoleWake = THREE.MathUtils.damp(
      trainingConsoleWake,
      trainingConsoleNearby ? 1 : 0,
      6,
      delta,
    );
    consoleLedMaterials.forEach((material, index) => {
      const chase = motionEnabled
        ? Math.pow(0.5 + 0.5 * Math.sin(elapsed * 2.1 - index * 0.82), 5)
        : index === 0
          ? 1
          : 0.18;
      material.emissiveIntensity =
        0.2 + chase * (0.72 + trainingConsoleWake * 1.15);
    });
    const consolePulse = motionEnabled
      ? 0.5 + 0.5 * Math.sin(elapsed * (trainingConsoleNearby ? 3.2 : 1.6))
      : 0.6;
    consoleStartMaterial.emissiveIntensity =
      0.72 + consolePulse * (0.55 + trainingConsoleWake * 1.25);
    consoleArchMaterial.emissiveIntensity =
      0.46 + trainingConsoleWake * 0.58 + consolePulse * 0.12;
    consoleScreenMaterial.emissiveIntensity = 0.62 + trainingConsoleWake * 0.44;
    consoleMarqueeMaterial.emissiveIntensity = 0.76 + trainingConsoleWake * 0.52;
    const buttonScale = motionEnabled
      ? 1 + consolePulse * (0.025 + trainingConsoleWake * 0.055)
      : 1;
    consoleStartButton.scale.setScalar(buttonScale);
    consoleNeedlePivot.rotation.z = motionEnabled
      ? -0.72 + (0.5 + 0.5 * Math.sin(elapsed * 0.78)) * 1.35
      : -0.08;
  };

  return {
    group,
    units,
    pickRoot,
    bounds,
    trainingConsole,
    unitIndexForStation,
    update,
  };
}
