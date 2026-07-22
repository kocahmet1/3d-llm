"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import {
  DATA_PREP_STAGES,
  DATA_PREP_TRACE,
  PHASE_COLORS,
  SELECTED_TRACE,
  TRAINING_STATIONS,
} from "../lib/trainingTrace";
import { resolveAssistantTarget } from "../lib/assistantContext";
import type {
  BranchSide,
  DetailMode,
  MachineRoomCue,
  NavigationMode,
  TrainingCanvasProps,
  TrainingPhase,
  TrainingStation,
} from "../lib/worldTypes";
import { buildDistinctChamberProcess } from "./chambers";
import {
  createNeonFrame,
  createPacket,
  createPanel as createProcessPanel,
  createPath,
  createValueBoard,
  setObjectEmissive,
  setObjectOpacity,
} from "./chambers/processShared";
import { createAssistantController } from "./assistant";
import {
  createMachineRoom,
  MACHINE_ROOM_PLAYER_CLEARANCE,
} from "./machineRoom";
import {
  getDirectorProcessOverride,
  isDirectorDriving,
  registerDirectorCanvas,
  unregisterDirectorCanvas,
  type DirectorCanvasApi,
} from "../lib/director/registry";
import styles from "./TrainingWorldCanvas.module.css";

const TAU = Math.PI * 2;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const STATION_SPACING = 100;
const PROCESS_CHAMBER_CYCLE_SECONDS = 15;
const CORRIDOR_WIDTH = 7.4;
const CORRIDOR_WALKABLE_HALF_WIDTH = CORRIDOR_WIDTH / 2 - 0.65;
const MIN_SPACIOUS_CHAMBER_SPAN = 48;
const MIN_SPACIOUS_CHAMBER_DEPTH = 54;
const DEFAULT_GUIDED_VIEW_DISTANCE = 23;
const CORPUS_ARENA_HEIGHT = 120;

/**
 * The machine room (the opening scene) lives far above the station route so
 * neither environment ever leaks into the other's sightlines.
 */
const MACHINE_ROOM_ORIGIN = new THREE.Vector3(0, 640, 260);
const MACHINE_ROOM_DIVE_SECONDS = 1.2;
const MACHINE_ROOM_RISE_SECONDS = 0.42;
const MACHINE_ROOM_REVEAL_SECONDS = 0.65;
const MACHINE_ROOM_FOV = 58;
const MACHINE_ROOM_CUE_RADIUS = 4;

const FALLBACK_PHASE_COLORS: Record<TrainingPhase, string> = {
  overview: "#72f5c3",
  data: "#4de5ff",
  forward: "#57a9ff",
  loss: "#ffd166",
  backward: "#ff765f",
  update: "#d8ff72",
};

type DetailTier = "structure" | "math";
type AnimationKind = "spin" | "pulse" | "bob" | "travel-x" | "travel-z";

interface AnimationRecord {
  object: THREE.Object3D;
  kind: AnimationKind;
  speed: number;
  offset: number;
  amplitude: number;
  basePosition: THREE.Vector3;
  baseScale: THREE.Vector3;
}

interface ChamberNavigationBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  walkY: number;
  spawn: THREE.Vector3;
  portalCenterX: number;
  portalHalfWidth: number;
  portalMinY: number;
  portalMaxY: number;
  guidedViewDistance: number;
  guidedFocusY: number;
  guidedFov: number;
  blockers?: ReadonlyArray<{
    minX: number;
    maxX: number;
    minY?: number;
    maxY?: number;
    minZ: number;
    maxZ: number;
  }>;
}

interface StationLightAnchors {
  spot: THREE.Vector3;
  spotTarget: THREE.Vector3;
  warmA: THREE.Vector3;
  warmB: THREE.Vector3;
}

interface StationRuntime {
  group: THREE.Group;
  phaseMaterials: THREE.MeshStandardMaterial[];
  navigationBounds: ChamberNavigationBounds;
  lightAnchors: StationLightAnchors;
  update?: (
    progress: number,
    elapsed: number,
    motionEnabled?: boolean,
  ) => void;
}

type StationUpdater = NonNullable<StationRuntime["update"]>;

interface BuildContext {
  station: TrainingStation;
  index: number;
  group: THREE.Group;
  palette: ReturnType<typeof createPalette>;
  animations: AnimationRecord[];
  phaseMaterials: THREE.MeshStandardMaterial[];
  detailObjects: Record<DetailTier, THREE.Object3D[]>;
  branchMaterials: Record<BranchSide, THREE.Material[]>;
  navigationBounds?: ChamberNavigationBounds;
}

interface WorldRefs {
  progress: number;
  stationIndex: number;
  playing: boolean;
  dataPrepProgress: number;
  branchSide: BranchSide;
  detailMode: DetailMode;
  rideMode: TrainingCanvasProps["rideMode"];
  assistantEnabled: TrainingCanvasProps["assistantEnabled"];
  assistantStatus: TrainingCanvasProps["assistantStatus"];
  assistantAudioActivity: TrainingCanvasProps["assistantAudioActivity"];
  assistantTargetId: TrainingCanvasProps["assistantTargetId"];
  assistantTargetLocked: TrainingCanvasProps["assistantTargetLocked"];
  onProgressChange: TrainingCanvasProps["onProgressChange"];
  onManualNavigation: TrainingCanvasProps["onManualNavigation"];
  onNavigationModeChange: TrainingCanvasProps["onNavigationModeChange"];
  onMachineRoomCueChange: TrainingCanvasProps["onMachineRoomCueChange"];
  onMovementDiscovered: TrainingCanvasProps["onMovementDiscovered"];
  onStationChange: TrainingCanvasProps["onStationChange"];
  onAssistantTargetChange: TrainingCanvasProps["onAssistantTargetChange"];
  onAssistantFocusChange: TrainingCanvasProps["onAssistantFocusChange"];
}

function phaseColor(phase: TrainingPhase): THREE.Color {
  const configured = (PHASE_COLORS as unknown as Record<string, string>)[phase];
  return new THREE.Color(configured ?? FALLBACK_PHASE_COLORS[phase]);
}

function createPalette(phase: TrainingPhase) {
  const phaseBase = phaseColor(phase);
  const bright = phaseBase.clone().lerp(new THREE.Color("#ffffff"), 0.14);
  const dark = phaseBase.clone().multiplyScalar(0.24);
  // Structure reads as dark machined slabs; lit materials stay restrained
  // so shading and form carry the look instead of glow. The base color is a
  // neutral graphite (not navy) so it sits comfortably in the warm halls.
  const structure = new THREE.MeshStandardMaterial({
    color: "#16171a",
    roughness: 0.36,
    metalness: 0.58,
    emissive: dark,
    emissiveIntensity: 0.22,
    transparent: true,
    opacity: 0.82,
  });
  const active = new THREE.MeshStandardMaterial({
    color: bright,
    roughness: 0.3,
    metalness: 0.24,
    emissive: phaseBase,
    emissiveIntensity: 0.66,
    transparent: true,
  });
  const signal = new THREE.MeshStandardMaterial({
    color: bright,
    roughness: 0.14,
    metalness: 0.1,
    emissive: phaseBase,
    emissiveIntensity: 1.0,
    transparent: true,
  });
  const warm = new THREE.MeshStandardMaterial({
    color: "#ffb071",
    roughness: 0.24,
    metalness: 0.24,
    emissive: "#ff5a3d",
    emissiveIntensity: 0.85,
    transparent: true,
  });
  const target = new THREE.MeshStandardMaterial({
    color: "#fff1a8",
    roughness: 0.16,
    metalness: 0.18,
    emissive: "#ffc83d",
    emissiveIntensity: 1.0,
    transparent: true,
  });
  return { phaseBase, bright, dark, structure, active, signal, warm, target };
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * Soft radial contact shadow shared by every pedestal, grounding exhibits on
 * the floor the way the reference pedestals sit in their own shade.
 */
let contactShadowTexture: THREE.CanvasTexture | null = null;
function getContactShadowTexture(): THREE.CanvasTexture {
  if (contactShadowTexture) return contactShadowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const paint = canvas.getContext("2d");
  if (paint) {
    const gradient = paint.createRadialGradient(64, 64, 6, 64, 64, 63);
    gradient.addColorStop(0, "rgba(0,0,0,0.72)");
    gradient.addColorStop(0.55, "rgba(0,0,0,0.34)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    paint.fillStyle = gradient;
    paint.fillRect(0, 0, 128, 128);
  }
  contactShadowTexture = new THREE.CanvasTexture(canvas);
  return contactShadowTexture;
}

/**
 * Deterministic cool-slate marble, drawn once and cloned per surface so each
 * floor can pick its own repeat. Pale veins over graphite-blue stone give the
 * halls the machine-room's crafted-floor feel in a color that suits them.
 */
let marbleTextureBase: THREE.CanvasTexture | null = null;
function getMarbleTexture(repeatX: number, repeatY: number): THREE.CanvasTexture {
  if (!marbleTextureBase) {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const paint = canvas.getContext("2d");
    if (paint) {
      const rand = (seed: number) => {
        const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
        return value - Math.floor(value);
      };
      paint.fillStyle = "#1d232c";
      paint.fillRect(0, 0, size, size);
      // Broad tonal mottling.
      for (let patch = 0; patch < 22; patch += 1) {
        const x = rand(patch * 3.7 + 1) * size;
        const y = rand(patch * 5.3 + 2) * size;
        const radius = 60 + rand(patch * 7.1 + 3) * 140;
        const lighten = rand(patch * 9.7 + 4) > 0.5;
        const gradient = paint.createRadialGradient(x, y, 4, x, y, radius);
        gradient.addColorStop(
          0,
          lighten ? "rgba(52, 62, 78, 0.20)" : "rgba(14, 18, 24, 0.22)",
        );
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
        paint.fillStyle = gradient;
        paint.fillRect(0, 0, size, size);
      }
      // Primary pale veins.
      for (let vein = 0; vein < 11; vein += 1) {
        let x = rand(vein * 13.3 + 5) * size;
        let y = rand(vein * 17.9 + 6) * size;
        let angle = rand(vein * 23.1 + 7) * Math.PI * 2;
        paint.strokeStyle = `rgba(206, 220, 238, ${
          0.09 + rand(vein * 29.7 + 8) * 0.15
        })`;
        paint.lineWidth = 1 + rand(vein * 31.3 + 9) * 1.9;
        paint.beginPath();
        paint.moveTo(x, y);
        for (let step = 0; step < 46; step += 1) {
          angle += (rand(vein * 37.7 + step * 1.31 + 10) - 0.5) * 0.92;
          x += Math.cos(angle) * 13;
          y += Math.sin(angle) * 13;
          paint.lineTo(x, y);
        }
        paint.stroke();
      }
      // Hairline branches and a few darker fissures.
      for (let vein = 0; vein < 14; vein += 1) {
        let x = rand(vein * 41.9 + 11) * size;
        let y = rand(vein * 43.3 + 12) * size;
        let angle = rand(vein * 47.7 + 13) * Math.PI * 2;
        const dark = vein % 4 === 0;
        paint.strokeStyle = dark
          ? "rgba(10, 13, 18, 0.20)"
          : `rgba(188, 204, 224, ${0.05 + rand(vein * 53.1 + 14) * 0.08})`;
        paint.lineWidth = 0.7;
        paint.beginPath();
        paint.moveTo(x, y);
        for (let step = 0; step < 30; step += 1) {
          angle += (rand(vein * 59.3 + step * 1.77 + 15) - 0.5) * 1.15;
          x += Math.cos(angle) * 9;
          y += Math.sin(angle) * 9;
          paint.lineTo(x, y);
        }
        paint.stroke();
      }
    }
    marbleTextureBase = new THREE.CanvasTexture(canvas);
    marbleTextureBase.colorSpace = THREE.SRGBColorSpace;
    marbleTextureBase.wrapS = THREE.RepeatWrapping;
    marbleTextureBase.wrapT = THREE.RepeatWrapping;
    marbleTextureBase.anisotropy = 4;
  }
  const texture = marbleTextureBase.clone();
  texture.needsUpdate = true;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}

type SurfaceReliefKind = "wall" | "floor";

const surfaceReliefTextures: Record<
  SurfaceReliefKind,
  THREE.CanvasTexture | null
> = {
  wall: null,
  floor: null,
};

/**
 * Tiny, deterministic height fields replace the architectural line overlays.
 * The map is generated once per surface type, then reused by every chamber;
 * broad light-reactive forms read as shallow dents and bulges without adding
 * geometry, requests, or meaningful load time.
 */
function getSurfaceReliefTexture(kind: SurfaceReliefKind): THREE.CanvasTexture {
  const cached = surfaceReliefTextures[kind];
  if (cached) return cached;

  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const paint = canvas.getContext("2d");

  if (paint) {
    const heights = new Float32Array(size * size);
    const pixels = paint.createImageData(size, size);
    const smoothBlend = (value: number) => value * value * (3 - 2 * value);
    const tileableValueNoise = (
      u: number,
      v: number,
      frequency: number,
      seed: number,
    ) => {
      const scaledX = u * frequency;
      const scaledY = v * frequency;
      const x0 = Math.floor(scaledX);
      const y0 = Math.floor(scaledY);
      const blendX = smoothBlend(scaledX - x0);
      const blendY = smoothBlend(scaledY - y0);
      const sample = (x: number, y: number) => {
        const wrappedX = positiveModulo(x, frequency);
        const wrappedY = positiveModulo(y, frequency);
        const raw =
          Math.sin(
            wrappedX * 127.1 + wrappedY * 311.7 + seed * 74.7,
          ) * 43758.5453;
        return raw - Math.floor(raw);
      };
      const top = THREE.MathUtils.lerp(
        sample(x0, y0),
        sample(x0 + 1, y0),
        blendX,
      );
      const bottom = THREE.MathUtils.lerp(
        sample(x0, y0 + 1),
        sample(x0 + 1, y0 + 1),
        blendX,
      );
      return THREE.MathUtils.lerp(top, bottom, blendY);
    };
    const features =
      kind === "floor"
        ? [
            [0.12, 0.18, 0.18, 0.13],
            [0.42, 0.72, 0.22, -0.1],
            [0.7, 0.28, 0.18, 0.12],
            [0.88, 0.82, 0.15, -0.09],
            [0.28, 0.45, 0.12, 0.07],
            [0.62, 0.9, 0.11, -0.06],
          ]
        : [
            [0.16, 0.22, 0.2, 0.1],
            [0.47, 0.62, 0.18, -0.08],
            [0.78, 0.3, 0.16, 0.09],
            [0.9, 0.84, 0.2, -0.07],
            [0.32, 0.88, 0.13, 0.06],
            [0.64, 0.08, 0.12, -0.05],
          ];

    for (let y = 0; y < size; y += 1) {
      const v = (y + 0.5) / size;
      for (let x = 0; x < size; x += 1) {
        const u = (x + 0.5) / size;
        let height =
          0.5 +
          (tileableValueNoise(u, v, 3, kind === "floor" ? 2 : 7) - 0.5) *
            (kind === "floor" ? 0.24 : 0.18) +
          (tileableValueNoise(u, v, 7, kind === "floor" ? 11 : 17) - 0.5) *
            (kind === "floor" ? 0.1 : 0.08) +
          (tileableValueNoise(u, v, 13, kind === "floor" ? 19 : 23) - 0.5) *
            0.025;

        for (const [centerX, centerY, radius, amplitude] of features) {
          const directX = Math.abs(u - centerX);
          const directY = Math.abs(v - centerY);
          const dx = Math.min(directX, 1 - directX);
          const dy = Math.min(directY, 1 - directY);
          const distanceSquared = dx * dx + dy * dy;
          height +=
            amplitude *
            Math.exp(-distanceSquared / Math.max(0.0001, 2 * radius * radius));
        }

        heights[y * size + x] = THREE.MathUtils.clamp(height, 0.08, 0.92);
      }
    }

    const sampleHeight = (x: number, y: number) =>
      heights[positiveModulo(y, size) * size + positiveModulo(x, size)];
    const normalStrength = kind === "wall" ? 14 : 12;
    const normal = new THREE.Vector3();
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = sampleHeight(x + 1, y) - sampleHeight(x - 1, y);
        const dy = sampleHeight(x, y + 1) - sampleHeight(x, y - 1);
        normal.set(-dx * normalStrength, -dy * normalStrength, 1).normalize();
        const pixel = (y * size + x) * 4;
        pixels.data[pixel] = Math.round((normal.x * 0.5 + 0.5) * 255);
        pixels.data[pixel + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
        pixels.data[pixel + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
        pixels.data[pixel + 3] = 255;
      }
    }
    paint.putImageData(pixels, 0, 0);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `procedural-${kind}-surface-normal-relief`;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    kind === "floor" ? 3.5 : 2.5,
    kind === "floor" ? 4.5 : 3.4,
  );
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  surfaceReliefTextures[kind] = texture;
  return texture;
}

function addAnimation(
  context: BuildContext,
  object: THREE.Object3D,
  kind: AnimationKind,
  speed = 1,
  amplitude = 1,
  offset = 0,
) {
  context.animations.push({
    object,
    kind,
    speed,
    offset,
    amplitude,
    basePosition: object.position.clone(),
    baseScale: object.scale.clone(),
  });
}

function createLabel(
  text: string,
  color: THREE.ColorRepresentation,
  width = 4.8,
  compact = false,
): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = compact ? 512 : 1024;
  canvas.height = compact ? 128 : 192;
  const paint = canvas.getContext("2d");
  if (paint) {
    paint.clearRect(0, 0, canvas.width, canvas.height);
    const labelAccent = new THREE.Color(color);
    const backdrop = paint.createLinearGradient(0, 0, 0, canvas.height);
    backdrop.addColorStop(0, "rgba(6, 15, 28, 0.88)");
    backdrop.addColorStop(1, "rgba(2, 6, 13, 0.88)");
    paint.fillStyle = backdrop;
    paint.strokeStyle = labelAccent.getStyle();
    paint.lineWidth = compact ? 4 : 5;
    const inset = 8;
    const radius = compact ? 24 : 34;
    paint.beginPath();
    paint.moveTo(inset + radius, inset);
    paint.lineTo(canvas.width - inset - radius, inset);
    paint.quadraticCurveTo(canvas.width - inset, inset, canvas.width - inset, inset + radius);
    paint.lineTo(canvas.width - inset, canvas.height - inset - radius);
    paint.quadraticCurveTo(
      canvas.width - inset,
      canvas.height - inset,
      canvas.width - inset - radius,
      canvas.height - inset,
    );
    paint.lineTo(inset + radius, canvas.height - inset);
    paint.quadraticCurveTo(inset, canvas.height - inset, inset, canvas.height - inset - radius);
    paint.lineTo(inset, inset + radius);
    paint.quadraticCurveTo(inset, inset, inset + radius, inset);
    paint.closePath();
    paint.fill();
    paint.shadowColor = labelAccent.getStyle();
    paint.shadowBlur = 5;
    paint.stroke();
    paint.shadowBlur = 0;
    paint.fillStyle = "#f4fbff";
    const fontWeight = compact ? 600 : 650;
    let fontSize = compact ? 46 : 58;
    const fontFamily = "ui-monospace, SFMono-Regular, Menlo, monospace";
    paint.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    paint.textAlign = "center";
    paint.textBaseline = "middle";
    const safeText = text.length > 42 ? `${text.slice(0, 39)}…` : text;
    const maximumTextWidth = canvas.width - (compact ? 44 : 68);
    const measuredTextWidth = paint.measureText(safeText).width;
    if (measuredTextWidth > maximumTextWidth) {
      fontSize = Math.max(
        compact ? 22 : 30,
        Math.floor(fontSize * (maximumTextWidth / measuredTextWidth)),
      );
      paint.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    }
    paint.fillText(safeText, canvas.width / 2, canvas.height / 2 + 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, width * (canvas.height / canvas.width), 1);
  sprite.renderOrder = 8;
  return sprite;
}

function createFacePanel(
  lines: readonly string[],
  options: {
    width?: number;
    height?: number;
    color?: THREE.ColorRepresentation;
    borderColor?: THREE.ColorRepresentation;
    background?: string;
    fontScale?: number;
  } = {},
): THREE.Mesh {
  const width = options.width ?? 3;
  const height = options.height ?? 1.2;
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = Math.max(192, Math.round((canvas.width * height) / width));
  const paint = canvas.getContext("2d");
  if (paint) {
    const accent = new THREE.Color(options.borderColor ?? options.color ?? "#a9c7ff");
    paint.clearRect(0, 0, canvas.width, canvas.height);
    const backdrop = paint.createLinearGradient(0, 0, 0, canvas.height);
    backdrop.addColorStop(0, "rgba(6, 15, 29, 0.95)");
    backdrop.addColorStop(1, "rgba(2, 6, 14, 0.95)");
    paint.fillStyle = options.background ?? backdrop;
    paint.fillRect(5, 5, canvas.width - 10, canvas.height - 10);
    paint.shadowColor = accent.getStyle();
    paint.shadowBlur = 4;
    paint.strokeStyle = accent.getStyle();
    paint.lineWidth = 5;
    paint.strokeRect(7.5, 7.5, canvas.width - 15, canvas.height - 15);
    paint.shadowBlur = 0;
    paint.strokeStyle = accent.clone().lerp(new THREE.Color("#ffffff"), 0.4).getStyle();
    paint.lineWidth = 1.5;
    paint.strokeRect(7.5, 7.5, canvas.width - 15, canvas.height - 15);
    paint.fillStyle = new THREE.Color(options.color ?? "#f4f8ff").getStyle();
    paint.textAlign = "center";
    paint.textBaseline = "middle";
    const longest = Math.max(1, ...lines.map((line) => line.length));
    const baseSize = Math.min(
      canvas.height / Math.max(2.2, lines.length * 1.28),
      canvas.width / Math.max(8, longest * 0.66),
    );
    const fontSize = Math.max(23, Math.floor(baseSize * (options.fontScale ?? 1)));
    paint.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    const lineHeight = fontSize * 1.24;
    const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => {
      paint.globalAlpha = index === 0 ? 1 : 0.82;
      paint.fillText(line, canvas.width / 2, startY + index * lineHeight);
    });
    paint.globalAlpha = 1;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  panel.renderOrder = 7;
  return panel;
}

function easedProgress(value: number, start: number, end: number) {
  const normalized = THREE.MathUtils.clamp((value - start) / Math.max(0.0001, end - start), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function label(
  context: BuildContext,
  text: string,
  position: THREE.Vector3,
  options: {
    color?: THREE.ColorRepresentation;
    width?: number;
    tier?: DetailTier;
    branch?: BranchSide;
    compact?: boolean;
  } = {},
): THREE.Sprite {
  const sprite = createLabel(
    text,
    options.color ?? context.palette.phaseBase,
    options.width ?? 4.8,
    options.compact,
  );
  sprite.position.copy(position);
  context.group.add(sprite);
  if (options.tier) context.detailObjects[options.tier].push(sprite);
  if (options.branch) {
    context.branchMaterials[options.branch].push(sprite.material);
    sprite.material.transparent = true;
  }
  return sprite;
}

/**
 * Height (above a chamber's route-centred origin) at which the visitor's eye
 * rests while free-roaming or dollying through a connecting tunnel. It mirrors
 * the guided tour's camera lift so walking a chamber frames its exhibits at the
 * same comfortable, near-level angle the guided ride uses — instead of craning
 * up from deck level. Kept below the door lintel (portalMaxY ~3.95) so the
 * visitor can still pass through every portal at rest height.
 */
function chamberEyeLift(cameraHint: TrainingStation["cameraHint"]): number {
  switch (cameraHint) {
    case "microscope":
      return 3.1;
    case "inside":
      return 1.9;
    case "wide":
      return 2.5;
    default:
      return 2.15;
  }
}

function addShell(
  context: BuildContext,
  size: THREE.Vector3,
  position = new THREE.Vector3(),
  rotation = new THREE.Euler(),
  guidedView = {
    distance: DEFAULT_GUIDED_VIEW_DISTANCE,
    focusY: 2.2,
    fov: 58,
  },
): THREE.Group {
  const chamber = new THREE.Group();
  chamber.name = `opaque-chamber-${String(context.index).padStart(2, "0")}`;
  chamber.position.copy(position);
  chamber.rotation.copy(rotation);

  const phaseTint = context.palette.phaseBase.clone();
  // Cool gallery palette: slate-blue masonry over veined marble, darker than
  // the machine room but pleasant rather than void-like. Phase color
  // survives only as a whisper of tint and in the door frames.
  const wallColor = new THREE.Color("#151a22").lerp(phaseTint, 0.035);
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: wallColor,
    roughness: 0.78,
    metalness: 0.08,
    normalMap: getSurfaceReliefTexture("wall"),
    normalScale: new THREE.Vector2(0.24, 0.24),
    emissive: "#131a26",
    emissiveIntensity: 0.06,
    side: THREE.DoubleSide,
  });
  // The end wall behind the exhibits stays the most matte surface in the
  // chamber so boards and matrices never fight a glow behind them.
  const backWallMaterial = wallMaterial.clone();
  backWallMaterial.normalScale.set(0.1, 0.1);
  backWallMaterial.roughness = 0.88;
  backWallMaterial.emissiveIntensity = 0.03;
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#b9c2cd").lerp(phaseTint, 0.03),
    map: getMarbleTexture(3.2, 3.4),
    roughness: 0.34,
    metalness: 0.08,
    normalMap: getSurfaceReliefTexture("floor"),
    normalScale: new THREE.Vector2(0.12, 0.12),
    emissive: "#0b0e13",
    emissiveIntensity: 0.04,
    side: THREE.DoubleSide,
  });
  const pilasterMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#252d3a").lerp(phaseTint, 0.05),
    roughness: 0.56,
    metalness: 0.2,
    normalMap: getSurfaceReliefTexture("wall"),
    normalScale: new THREE.Vector2(0.26, 0.26),
    emissive: "#111826",
    emissiveIntensity: 0.1,
  });
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: context.palette.bright,
    roughness: 0.3,
    metalness: 0.4,
    emissive: phaseTint,
    emissiveIntensity: 0.7,
  });
  // The exit door sits on the wall behind the exhibits (the visitor's
  // natural sightline), so its glow is kept to a quiet marker.
  const exitFrameMaterial = frameMaterial.clone();
  exitFrameMaterial.emissiveIntensity = 0.28;
  const panel = (
    panelSize: THREE.Vector3,
    panelPosition: THREE.Vector3,
    material: THREE.Material = wallMaterial,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(panelSize.x, panelSize.y, panelSize.z),
      material,
    );
    mesh.position.copy(panelPosition);
    chamber.add(mesh);
    return mesh;
  };

  const width = Math.max(size.x, MIN_SPACIOUS_CHAMBER_SPAN);
  const chamberHeight = Math.max(size.y, MIN_SPACIOUS_CHAMBER_SPAN);
  const depth = Math.max(size.z, MIN_SPACIOUS_CHAMBER_DEPTH);
  const navigationDeckY = -4.7;
  const floorY = navigationDeckY - 0.18;
  const ceilingY = floorY + chamberHeight;
  const verticalSpan = chamberHeight;
  const chamberCenterY = (floorY + ceilingY) / 2;
  const wallThickness = 0.38;
  const doorWidth = Math.min(7.2, width - 3.2);
  const doorHeight = Math.min(9.2, verticalSpan - 2.4);
  const doorBottom = navigationDeckY;
  const doorTop = doorBottom + doorHeight;
  const doorCenterY = (doorBottom + doorTop) / 2;
  const sideColumnWidth = (width - doorWidth) / 2;
  const bottomCapHeight = Math.max(0.2, doorBottom - floorY);
  const topCapHeight = Math.max(0.2, ceilingY - doorTop);

  panel(
    new THREE.Vector3(width, wallThickness, depth),
    new THREE.Vector3(0, floorY, 0),
    floorMaterial,
  );
  panel(
    new THREE.Vector3(width, wallThickness, depth),
    new THREE.Vector3(0, ceilingY, 0),
    wallMaterial,
  );
  panel(
    new THREE.Vector3(wallThickness, verticalSpan, depth),
    new THREE.Vector3(-width / 2, chamberCenterY, 0),
  );
  panel(
    new THREE.Vector3(wallThickness, verticalSpan, depth),
    new THREE.Vector3(width / 2, chamberCenterY, 0),
  );

  for (const endZ of [-depth / 2, depth / 2]) {
    const endWallMaterial = endZ < 0 ? backWallMaterial : wallMaterial;
    panel(
      new THREE.Vector3(sideColumnWidth, verticalSpan, wallThickness),
      new THREE.Vector3(
        -(doorWidth + sideColumnWidth) / 2,
        chamberCenterY,
        endZ,
      ),
      endWallMaterial,
    );
    panel(
      new THREE.Vector3(sideColumnWidth, verticalSpan, wallThickness),
      new THREE.Vector3(
        (doorWidth + sideColumnWidth) / 2,
        chamberCenterY,
        endZ,
      ),
      endWallMaterial,
    );
    panel(
      new THREE.Vector3(doorWidth, topCapHeight, wallThickness),
      new THREE.Vector3(0, doorTop + topCapHeight / 2, endZ),
      endWallMaterial,
    );
    panel(
      new THREE.Vector3(doorWidth, bottomCapHeight, wallThickness),
      new THREE.Vector3(0, floorY + bottomCapHeight / 2, endZ),
      endWallMaterial,
    );

    const trimZ = endZ + (endZ < 0 ? 0.23 : -0.23);
    const doorFrameMaterial = endZ < 0 ? exitFrameMaterial : frameMaterial;
    panel(
      new THREE.Vector3(0.16, doorHeight + 0.3, 0.16),
      new THREE.Vector3(-doorWidth / 2, doorCenterY, trimZ),
      doorFrameMaterial,
    );
    panel(
      new THREE.Vector3(0.16, doorHeight + 0.3, 0.16),
      new THREE.Vector3(doorWidth / 2, doorCenterY, trimZ),
      doorFrameMaterial,
    );
    panel(
      new THREE.Vector3(doorWidth + 0.3, 0.16, 0.16),
      new THREE.Vector3(0, doorTop, trimZ),
      doorFrameMaterial,
    );
    panel(
      new THREE.Vector3(doorWidth + 0.3, 0.16, 0.16),
      new THREE.Vector3(0, doorBottom, trimZ),
      doorFrameMaterial,
    );
  }

  // --- Machine-room echo: wainscot band with a steel rail ----------------
  // A low deep-slate band wraps the side walls and the segments beside the
  // doors, like the room's paneling recast for the cool halls. It sits below
  // eye level and is fully matte, so it never competes with the exhibits.
  const wainscotMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#12161d").lerp(phaseTint, 0.04),
    roughness: 0.7,
    metalness: 0.14,
    normalMap: getSurfaceReliefTexture("wall"),
    normalScale: new THREE.Vector2(0.14, 0.14),
  });
  const railMaterial = new THREE.MeshStandardMaterial({
    color: "#93a5ba",
    roughness: 0.34,
    metalness: 0.6,
  });
  const wainscotHeight = 2.6;
  const wainscotY = floorY + 0.19 + wainscotHeight / 2;
  const railY = floorY + 0.19 + wainscotHeight + 0.09;
  for (const side of [-1, 1]) {
    panel(
      new THREE.Vector3(0.2, wainscotHeight, depth - 1.4),
      new THREE.Vector3(side * (width / 2 - 0.3), wainscotY, 0),
      wainscotMaterial,
    );
    panel(
      new THREE.Vector3(0.24, 0.13, depth - 1.4),
      new THREE.Vector3(side * (width / 2 - 0.3), railY, 0),
      railMaterial,
    );
  }
  for (const endZ of [-depth / 2, depth / 2]) {
    const inward = endZ < 0 ? 0.3 : -0.3;
    for (const side of [-1, 1]) {
      panel(
        new THREE.Vector3(Math.max(1, sideColumnWidth - 1), wainscotHeight, 0.2),
        new THREE.Vector3(
          (side * (doorWidth + sideColumnWidth)) / 2,
          wainscotY,
          endZ + inward,
        ),
        wainscotMaterial,
      );
      panel(
        new THREE.Vector3(Math.max(1, sideColumnWidth - 1), 0.13, 0.24),
        new THREE.Vector3(
          (side * (doorWidth + sideColumnWidth)) / 2,
          railY,
          endZ + inward,
        ),
        railMaterial,
      );
    }
  }

  // --- Monumental architecture pass -------------------------------------
  // Shadow-casting pilaster relief and a few broad warm accents give the hall
  // depth without drawing luminous seams across its surfaces.
  const pilasterCount = Math.max(3, Math.round(depth / 12));
  const pilasterPositions: THREE.Vector3[] = [];
  const pilasterScales: THREE.Vector3[] = [];
  const trimPositions: THREE.Vector3[] = [];
  const trimScales: THREE.Vector3[] = [];
  const trimColors: THREE.Color[] = [];
  const emberColor = new THREE.Color("#9cc4ee").multiplyScalar(0.85);
  const windowColor = new THREE.Color("#31506e");

  const pushTrim = (
    position: THREE.Vector3,
    scale: THREE.Vector3,
    color: THREE.Color,
  ) => {
    trimPositions.push(position);
    trimScales.push(scale);
    trimColors.push(color);
  };

  for (let pilaster = 0; pilaster < pilasterCount; pilaster += 1) {
    const zSlot =
      pilasterCount === 1
        ? 0
        : -depth * 0.4 + (pilaster * depth * 0.8) / (pilasterCount - 1);
    for (const side of [-1, 1]) {
      const faceX = side * (width / 2 - 0.62);
      pilasterPositions.push(new THREE.Vector3(faceX, chamberCenterY, zSlot));
      pilasterScales.push(new THREE.Vector3(1.05, verticalSpan, 1.35));
      pushTrim(
        new THREE.Vector3(side * (width / 2 - 1.28), floorY + 0.62, zSlot),
        new THREE.Vector3(0.5, 0.32, 0.14),
        emberColor,
      );
    }
  }

  const galleryY = floorY + verticalSpan * 0.8;
  for (let bay = 0; bay < Math.max(2, pilasterCount - 1); bay += 1) {
    const bayCount = Math.max(2, pilasterCount - 1);
    const zSlot =
      -depth * 0.34 + (bay * depth * 0.68) / Math.max(1, bayCount - 1);
    for (const side of [-1, 1]) {
      pushTrim(
        new THREE.Vector3(side * (width / 2 - 0.34), galleryY, zSlot),
        new THREE.Vector3(0.1, 1.05, 1.5),
        windowColor,
      );
    }
  }

  // Cool ceiling cove along the side walls, echoing the machine room's
  // recessed strip. Deliberately kept off the end walls: nothing luminous
  // ever sits directly behind the exhibits from the visitor's sightline.
  const coveColor = new THREE.Color("#cfe2fa").multiplyScalar(0.42);
  for (const side of [-1, 1]) {
    pushTrim(
      new THREE.Vector3(side * (width / 2 - 0.52), ceilingY - 1.05, 0),
      new THREE.Vector3(0.12, 0.2, depth * 0.76),
      coveColor,
    );
  }

  addInstancedBoxes(
    chamber,
    pilasterPositions,
    new THREE.Vector3(1, 1, 1),
    pilasterMaterial,
    undefined,
    pilasterScales,
  );
  const trimMaterial = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  addInstancedBoxes(
    chamber,
    trimPositions,
    new THREE.Vector3(1, 1, 1),
    trimMaterial,
    undefined,
    trimScales,
    trimColors,
  );

  context.group.add(chamber);
  const spawnInset = Math.max(8, depth * 0.16);
  // Rest the eye at the guided tour's viewing height so free-roam frames the
  // exhibits head-on, level with their vertical centre, rather than looking up
  // from the deck. Vertical roam (scroll) still lets the visitor drop to the
  // floor; this only changes the grounded/entry height.
  const restEyeY = chamberEyeLift(context.station.cameraHint);
  context.navigationBounds = {
    minX: position.x - width / 2 + 0.85,
    maxX: position.x + width / 2 - 0.85,
    minY: navigationDeckY + 0.75,
    maxY: ceilingY - 1,
    minZ: position.z - depth / 2 + 0.65,
    maxZ: position.z + depth / 2 - 0.65,
    walkY: restEyeY,
    spawn: new THREE.Vector3(
      position.x,
      restEyeY,
      position.z + depth / 2 - spawnInset,
    ),
    portalCenterX: position.x,
    portalHalfWidth: Math.min(
      doorWidth / 2 - 0.45,
      CORRIDOR_WALKABLE_HALF_WIDTH,
    ),
    portalMinY: doorBottom + 0.55,
    portalMaxY: doorTop - 0.55,
    guidedViewDistance: guidedView.distance,
    guidedFocusY: guidedView.focusY,
    guidedFov: guidedView.fov,
  };
  return chamber;
}

function addOpenCorpusArena(
  context: BuildContext,
  arenaSize: THREE.Vector2,
  arenaHeight: number,
) {
  const arenaCenterZ = 9;
  const halfWidth = arenaSize.x / 2;
  const halfDepth = arenaSize.y / 2;
  const floorY = -4.88;
  const navigationDeckY = -4.7;
  const arenaTopY = floorY + arenaHeight;
  const entranceZ = arenaCenterZ + halfDepth;
  const exitZ = arenaCenterZ - halfDepth;
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: "#97a2b0",
    map: getMarbleTexture(4.2, 4.2),
    roughness: 0.36,
    metalness: 0.12,
    emissive: context.palette.dark,
    emissiveIntensity: 0.07,
  });
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(arenaSize.x, 0.36, arenaSize.y),
    floorMaterial,
  );
  floor.name = "open-corpus-observation-ground";
  floor.position.set(0, floorY, arenaCenterZ);
  context.group.add(floor);

  // A wide neon ring inlaid at the arena's heart anchors the six tokenizer
  // stages the way the reference image anchors its exhibits.
  const arenaRing = new THREE.Mesh(
    new THREE.RingGeometry(17.6, 17.9, 96),
    new THREE.MeshBasicMaterial({
      color: context.palette.phaseBase.clone().multiplyScalar(0.8),
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  arenaRing.rotation.x = -Math.PI / 2;
  arenaRing.position.set(0, navigationDeckY + 0.02, arenaCenterZ - 8);
  context.group.add(arenaRing);

  context.palette.structure.transparent = false;
  context.palette.structure.opacity = 1;
  context.palette.structure.depthWrite = true;

  const edgeMaterial = new THREE.MeshBasicMaterial({
    color: context.palette.phaseBase,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const arenaOutlineAt = (y: number) => [
    new THREE.Vector3(-halfWidth, y, exitZ),
    new THREE.Vector3(halfWidth, y, exitZ),
    new THREE.Vector3(halfWidth, y, entranceZ),
    new THREE.Vector3(-halfWidth, y, entranceZ),
    new THREE.Vector3(-halfWidth, y, exitZ),
  ];
  addLine(
    context.group,
    arenaOutlineAt(navigationDeckY + 0.03),
    context.palette.phaseBase,
    0.2,
  );
  for (const level of [0.32, 0.64, 1]) {
    addLine(
      context.group,
      arenaOutlineAt(floorY + arenaHeight * level),
      context.palette.phaseBase,
      level === 1 ? 0.18 : 0.08,
    );
  }
  for (const [x, z] of [
    [-halfWidth, exitZ],
    [halfWidth, exitZ],
    [halfWidth, entranceZ],
    [-halfWidth, entranceZ],
  ] as const) {
    addLine(
      context.group,
      [new THREE.Vector3(x, navigationDeckY, z), new THREE.Vector3(x, arenaTopY, z)],
      context.palette.phaseBase,
      0.12,
    );
  }

  const addPortal = (z: number, facesIntoArena: boolean, text: string) => {
    const frame = new THREE.Group();
    const portalWidth = 10;
    const postGeometry = new THREE.BoxGeometry(0.22, 9.2, 0.28);
    const beamGeometry = new THREE.BoxGeometry(portalWidth, 0.22, 0.28);
    const leftPost = new THREE.Mesh(postGeometry, edgeMaterial);
    const rightPost = new THREE.Mesh(postGeometry, edgeMaterial);
    const topBeam = new THREE.Mesh(beamGeometry, edgeMaterial);
    leftPost.position.set(-portalWidth / 2, -0.1, 0);
    rightPost.position.set(portalWidth / 2, -0.1, 0);
    topBeam.position.set(0, 4.5, 0);
    frame.add(leftPost, rightPost, topBeam);
    frame.position.set(0, 0, z);
    context.group.add(frame);

    const sign = createFacePanel([text, "WALK THROUGH THE LINEAR TUNNEL"], {
      width: 8.4,
      height: 1.05,
      color: "#dceaff",
      borderColor: context.palette.phaseBase,
      fontScale: 0.72,
    });
    sign.position.set(0, 5.45, z + (facesIntoArena ? -0.18 : 0.18));
    if (facesIntoArena) sign.rotation.y = Math.PI;
    context.group.add(sign);
  };

  addPortal(entranceZ, true, "ENTRANCE / PREVIOUS CHAMBER");
  addPortal(exitZ, false, "EXIT / NEXT CHAMBER");

  context.navigationBounds = {
    minX: -halfWidth,
    maxX: halfWidth,
    minY: navigationDeckY + 0.75,
    maxY: arenaTopY - 1,
    minZ: exitZ,
    maxZ: entranceZ,
    walkY: -2.95,
    spawn: new THREE.Vector3(
      0,
      -2.95,
      arenaCenterZ + arenaSize.y * 0.35,
    ),
    portalCenterX: 0,
    portalHalfWidth: CORRIDOR_WALKABLE_HALF_WIDTH,
    portalMinY: -4.15,
    portalMaxY: 3.95,
    guidedViewDistance: 38,
    guidedFocusY: 1.5,
    guidedFov: 64,
  };
}

function addInstancedBoxes(
  group: THREE.Group,
  positions: THREE.Vector3[],
  size: THREE.Vector3,
  material: THREE.Material,
  rotations?: THREE.Euler[],
  scales?: THREE.Vector3[],
  colors?: THREE.Color[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size.x, size.y, size.z), material, positions.length);
  const dummy = new THREE.Object3D();
  positions.forEach((position, index) => {
    dummy.position.copy(position);
    if (rotations?.[index]) dummy.rotation.copy(rotations[index]);
    if (scales?.[index]) dummy.scale.copy(scales[index]);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    if (colors?.[index]) mesh.setColorAt(index, colors[index]);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  group.add(mesh);
  return mesh;
}

function addInstancedSpheres(
  group: THREE.Group,
  positions: THREE.Vector3[],
  radius: number,
  material: THREE.Material,
  scales?: THREE.Vector3[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(radius, 1), material, positions.length);
  const dummy = new THREE.Object3D();
  positions.forEach((position, index) => {
    dummy.position.copy(position);
    if (scales?.[index]) dummy.scale.copy(scales[index]);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  return mesh;
}

function addLine(
  group: THREE.Group,
  points: THREE.Vector3[],
  color: THREE.ColorRepresentation,
  opacity = 0.65,
): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const line = new THREE.Line(geometry, material);
  group.add(line);
  return line;
}

function addTube(
  group: THREE.Group,
  points: THREE.Vector3[],
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.45);
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(18, points.length * 8), radius, 7, false), material);
  group.add(tube);
  return tube;
}

function addMatrixGrid(
  context: BuildContext,
  rows: number,
  columns: number,
  origin: THREE.Vector3,
  spacing: number,
  cellSize: number,
  heightForCell: (row: number, column: number) => number,
  colorForCell?: (row: number, column: number, height: number) => THREE.Color,
): THREE.InstancedMesh {
  const positions: THREE.Vector3[] = [];
  const scales: THREE.Vector3[] = [];
  const colors: THREE.Color[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const height = Math.max(0.08, heightForCell(row, column));
      positions.push(
        new THREE.Vector3(
          origin.x + (column - (columns - 1) / 2) * spacing,
          origin.y + height / 2,
          origin.z + (row - (rows - 1) / 2) * spacing,
        ),
      );
      scales.push(new THREE.Vector3(1, height, 1));
      colors.push(
        colorForCell?.(row, column, height) ??
          context.palette.phaseBase.clone().offsetHSL((row + column) * 0.006, 0, 0.04),
      );
    }
  }
  const material = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.3,
    metalness: 0.35,
    emissive: context.palette.dark,
    emissiveIntensity: 0.95,
    vertexColors: true,
    transparent: true,
  });
  const mesh = addInstancedBoxes(
    context.group,
    positions,
    new THREE.Vector3(cellSize, 1, cellSize),
    material,
    undefined,
    scales,
    colors,
  );
  context.phaseMaterials.push(material);
  return mesh;
}

function addStationHeading(context: BuildContext, formula?: string) {
  const headingY = 7.5;
  const headingZ = 5;
  label(
    context,
    `${String(context.index + 1).padStart(2, "0")}  ${context.station.shortTitle.toUpperCase()}`,
    new THREE.Vector3(0, headingY, headingZ),
    { width: 7.2 },
  );
  if (formula) {
    label(context, formula, new THREE.Vector3(0, headingY - 2.8, headingZ - 0.25), {
      width: 6.1,
      tier: "math",
      compact: true,
      color: context.palette.bright,
    });
  }
}

function branchMaterial(
  context: BuildContext,
  side: BranchSide,
  source: THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
  const material = source.clone();
  material.transparent = true;
  material.userData.baseOpacity = source.opacity;
  context.branchMaterials[side].push(material);
  return material;
}

function makeTokenPositions(
  count: number,
  start: THREE.Vector3,
  step: THREE.Vector3,
): THREE.Vector3[] {
  return Array.from({ length: count }, (_, index) => start.clone().addScaledVector(step, index));
}

function buildTrainingComplex(context: BuildContext) {
  addStationHeading(context, "example → prediction → loss → adjustment");
  addShell(context, new THREE.Vector3(22, 17, 17), new THREE.Vector3(0, 0, -1));

  const towerPositions = [
    new THREE.Vector3(-4.8, 2.35, -1.6),
    new THREE.Vector3(-1.6, 2.35, -1.6),
    new THREE.Vector3(1.6, 2.35, -1.6),
    new THREE.Vector3(4.8, 2.35, -1.6),
    new THREE.Vector3(4.8, -2.35, -1.6),
    new THREE.Vector3(1.6, -2.35, -1.6),
    new THREE.Vector3(-1.6, -2.35, -1.6),
    new THREE.Vector3(-4.8, -2.35, -1.6),
  ];
  const towerScales: THREE.Vector3[] = [];
  for (let index = 0; index < 8; index += 1) {
    const height = 1 + (index % 3) * 0.16;
    towerScales.push(new THREE.Vector3(1, height, 1));
  }
  const moduleMaterial = context.palette.active.clone();
  moduleMaterial.opacity = 0.4;
  moduleMaterial.emissiveIntensity = 0.28;
  addInstancedBoxes(
    context.group,
    towerPositions,
    new THREE.Vector3(1.7, 1, 1.7),
    moduleMaterial,
    undefined,
    towerScales,
  );

  const stationNames = ["DATA", "BATCH", "MODEL", "LOGITS", "LOSS", "GRAD", "ADAMW", "NEXT"];
  stationNames.forEach((name, index) => {
    const modulePosition = towerPositions[index];
    label(context, name, new THREE.Vector3(modulePosition.x, index < 4 ? 4.1 : -4.1, -0.6), {
      width: 2.25,
      tier: "structure",
      compact: true,
    });
  });

  addLine(
    context.group,
    [
      new THREE.Vector3(-6.1, 3.65, -0.8),
      new THREE.Vector3(6.1, 3.65, -0.8),
      new THREE.Vector3(6.1, -3.65, -0.8),
      new THREE.Vector3(-6.1, -3.65, -0.8),
      new THREE.Vector3(-6.1, 3.65, -0.8),
    ],
    context.palette.phaseBase,
    0.38,
  );
  addInstancedSpheres(context.group, towerPositions, 0.21, context.palette.signal);

  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.58, 2), context.palette.signal);
  core.position.set(0, 0, -2.4);
  context.group.add(core);
  addAnimation(context, core, "pulse", 1.4, 0.12, 0.5);
}

function buildCorpus(context: BuildContext) {
  addStationHeading(context, "SOURCE TEXT  >  CLEAN  >  PIECES + SPECIALS  >  VOCABULARY  >  TOKEN IDs");
  const openObservationArenaSize = new THREE.Vector2(140, 90);
  addOpenCorpusArena(context, openObservationArenaSize, CORPUS_ARENA_HEIGHT);

  // Compact assembly-line arc: all six tokenizer stages sit inside a single
  // camera view (x spans ±27 instead of ±51) in a shallow smile so the flow
  // still reads left→right and no stage occludes another. See the projection
  // check in the layout notes — every stage lands on-screen from 3:2 to 2.2:1.
  const stageCenters = [
    new THREE.Vector3(-27, 0, 3.6),
    new THREE.Vector3(-16.2, 0, 1.4),
    new THREE.Vector3(-5.4, 0, 0.35),
    new THREE.Vector3(5.4, 0, 0.35),
    new THREE.Vector3(16.2, 0, 1.4),
    new THREE.Vector3(27, 0, 3.6),
  ];
  const stageSizes = [
    [8, 6],
    [8, 6],
    [10.5, 6],
    [9.6, 6],
    [11, 7],
    [8.5, 6],
  ] as const;
  const stageHeadings = ["SOURCE", "CLEAN", "SPLIT + SPECIALS", "VOCABULARY", "BUILD ID MATRIX", "READY"];
  const observationPoint = context.navigationBounds?.spawn.clone() ?? new THREE.Vector3();
  const stageYaws = stageCenters.map((center) =>
    Math.atan2(
      observationPoint.x - center.x,
      observationPoint.z - center.z,
    ),
  );
  if (context.navigationBounds) {
    // Keep a straight walkway down the arena centerline — aligned with the
    // entrance/exit tunnels (spawn and both portals sit at portalCenterX) —
    // clear of blockers, so visitors pass straight through the center stages
    // (including BUILD ID MATRIX) to reach the next tunnel instead of
    // detouring around them. The two center stages straddle x≈0 and overlap,
    // so carving each stage's own center wouldn't open this shared path;
    // subtracting the tunnel-aligned corridor from every blocker does.
    const gapMinX = context.navigationBounds.portalCenterX - CORRIDOR_WALKABLE_HALF_WIDTH;
    const gapMaxX = context.navigationBounds.portalCenterX + CORRIDOR_WALKABLE_HALF_WIDTH;
    context.navigationBounds.blockers = stageCenters.flatMap((center, index) => {
      const halfWidth = stageSizes[index][0] / 2 + 0.7;
      const halfDepth = stageSizes[index][1] / 2 + 0.7;
      const minY = -4.7;
      const maxY = 8.5;
      const minZ = center.z - halfDepth;
      const maxZ = center.z + halfDepth;
      const minX = center.x - halfWidth;
      const maxX = center.x + halfWidth;
      const pieces: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
        minZ: number;
        maxZ: number;
      }[] = [];
      if (minX < gapMinX) {
        pieces.push({ minX, maxX: Math.min(maxX, gapMinX), minY, maxY, minZ, maxZ });
      }
      if (maxX > gapMaxX) {
        pieces.push({ minX: Math.max(minX, gapMaxX), maxX, minY, maxY, minZ, maxZ });
      }
      return pieces;
    });
  }
  const stageMaterials = DATA_PREP_STAGES.map(() => {
    const material = context.palette.structure.clone();
    material.color = new THREE.Color("#13233a");
    material.emissive = context.palette.phaseBase.clone();
    material.emissiveIntensity = 0.12;
    material.transparent = false;
    material.opacity = 1;
    return material;
  });

  const stageTrimMaterial = new THREE.MeshBasicMaterial({
    color: context.palette.phaseBase.clone().multiplyScalar(0.95),
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  stageCenters.forEach((center, index) => {
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(stageSizes[index][0], 0.24, stageSizes[index][1]),
      stageMaterials[index],
    );
    platform.position.set(center.x, -4.58, center.z);
    context.group.add(platform);
    // Neon edge rails outline every tokenizer stage like a lit museum plinth.
    const [stageWidth, stageDepth] = stageSizes[index];
    for (const [sx, sz, lx, lz] of [
      [0, -stageDepth / 2, stageWidth + 0.2, 0.09],
      [0, stageDepth / 2, stageWidth + 0.2, 0.09],
      [-stageWidth / 2, 0, 0.09, stageDepth + 0.2],
      [stageWidth / 2, 0, 0.09, stageDepth + 0.2],
    ] as const) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(lx, 0.09, lz),
        stageTrimMaterial,
      );
      rail.position.set(center.x + sx, -4.45, center.z + sz);
      context.group.add(rail);
    }
    label(
      context,
      `${String(index + 1).padStart(2, "0")}  ${stageHeadings[index]}`,
      new THREE.Vector3(center.x, 5.3, center.z + 0.15),
      { width: Math.min(15, stageSizes[index][0] + 1), compact: true },
    );
  });

  stageCenters.slice(0, -1).forEach((center, index) => {
    const next = stageCenters[index + 1];
    const midpoint = center.clone().add(next).multiplyScalar(0.5);
    const dx = next.x - center.x;
    const dz = next.z - center.z;
    const ribbon = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.035, Math.hypot(dx, dz) - 2.2),
      context.palette.signal,
    );
    ribbon.position.set(midpoint.x, -4.665, midpoint.z);
    ribbon.rotation.y = Math.atan2(dx, dz);
    context.group.add(ribbon);
  });
  addTube(
    context.group,
    stageCenters.map((center) => new THREE.Vector3(center.x, -4.635, center.z)),
    0.035,
    context.palette.signal,
  );

  // Shared chamber palette — the same hues the bespoke process builders use,
  // so this chamber's boards, packets, and conduits match every other station.
  const CYAN = "#47d7ff";
  const BLUE = "#76a9ff";
  const GREEN = "#69efb6";
  const GOLD = "#ffd166";
  const WHITE = "#f4fbff";
  const stagePoint = (stageIndex: number, offset: THREE.Vector3) =>
    offset
      .clone()
      .applyAxisAngle(WORLD_UP, stageYaws[stageIndex])
      .add(stageCenters[stageIndex]);

  // Elevated glowing conduits link the six stages exactly like the data
  // paths that thread through every other chamber's exhibit.
  stageCenters.slice(0, -1).forEach((center, index) => {
    const next = stageCenters[index + 1];
    context.group.add(
      createPath(
        [
          new THREE.Vector3(center.x, 0.4, center.z),
          new THREE.Vector3(
            (center.x + next.x) / 2,
            2.6,
            (center.z + next.z) / 2,
          ),
          new THREE.Vector3(next.x, 0.4, next.z),
        ],
        CYAN,
        0.05,
        0.2,
      ),
    );
  });

  const sourcePanels = DATA_PREP_TRACE.sources.map((source, row) => {
    const panel = createProcessPanel([source.kind, ...source.raw.split("\n")], {
      width: 7.0,
      height: 2.45,
      color: "#f3e29c",
      borderColor: BLUE,
      fontScale: 0.8,
    });
    panel.position.copy(
      stagePoint(0, new THREE.Vector3(0, 1.5 - row * 2.95, 0)),
    );
    panel.rotation.y = stageYaws[0];
    context.group.add(panel);
    return panel;
  });
  const cleanPanels = DATA_PREP_TRACE.sources.map((source, row) => {
    const panel = createProcessPanel(["NORMALIZED", source.clean], {
      width: 7.0,
      height: 2.45,
      color: WHITE,
      borderColor: CYAN,
      fontScale: 0.8,
    });
    panel.position.copy(
      stagePoint(1, new THREE.Vector3(0, 1.5 - row * 2.95, 0)),
    );
    panel.rotation.y = stageYaws[1];
    context.group.add(panel);
    return panel;
  });

  const scanner = createNeonFrame(6.6, 6.1, CYAN);
  scanner.position.copy(stagePoint(1, new THREE.Vector3(0, 0.15, 0.38)));
  scanner.rotation.y = stageYaws[1];
  context.group.add(scanner);
  const scanLine = new THREE.Mesh(
    new THREE.BoxGeometry(6.8, 0.07, 0.09),
    new THREE.MeshBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  scanLine.position.copy(stagePoint(1, new THREE.Vector3(0, -3.05, 0.52)));
  scanLine.rotation.y = stageYaws[1];
  context.group.add(scanLine);

  const cleaningPackets = DATA_PREP_TRACE.sources.map(() => {
    const packet = createPacket(CYAN, 0.3);
    packet.visible = false;
    context.group.add(packet);
    return packet;
  });

  // The vocabulary is one glassy value board — the same board style every
  // other chamber uses for its matrices — with a roaming neon cell cursor.
  const vocabColumns = 4;
  const vocabCellHeight = 1.0;
  const vocabWidth = 7.36;
  const vocabBoard = createValueBoard(
    [...SELECTED_TRACE.vocabulary],
    4,
    vocabColumns,
    {
      width: vocabWidth,
      cellHeight: vocabCellHeight,
      title: "VOCABULARY [16 ENTRIES]",
      subtitle: "fixed table · piece → integer address (row·4 + column)",
      color: GOLD,
      accent: CYAN,
    },
  );
  const vocabHeight = 4 * vocabCellHeight + 0.72 + 0.5 + 0.34;
  vocabBoard.position.copy(stagePoint(3, new THREE.Vector3(0, 1.05, 0)));
  vocabBoard.rotation.y = stageYaws[3];
  context.group.add(vocabBoard);
  const vocabCursor = createNeonFrame(
    (vocabWidth / vocabColumns) * 0.82,
    vocabCellHeight * 0.82,
    CYAN,
  );
  vocabCursor.position.z = 0.25;
  vocabBoard.add(vocabCursor);
  const vocabCellOffset = (tokenId: number) =>
    new THREE.Vector3(
      ((tokenId % vocabColumns) - 1.5) * (vocabWidth / vocabColumns),
      vocabHeight / 2 -
        0.72 -
        (Math.floor(tokenId / vocabColumns) + 0.5) * vocabCellHeight,
      0,
    );
  const vocabularyPositions = SELECTED_TRACE.vocabulary.map((_, tokenId) =>
    stagePoint(
      3,
      vocabCellOffset(tokenId).setZ(0.55).add(new THREE.Vector3(0, 1.05, 0)),
    ),
  );

  // The ID matrix is likewise a value board: a dotted unknown board that
  // fills during lookup, then the exact integer board revealed at the end.
  const matrixWidth = 10.08;
  const matrixCellHeight = 1.0;
  const matrixHeight = 2 * matrixCellHeight + 0.72 + 0.5 + 0.34;
  const matrixOptions = {
    width: matrixWidth,
    cellHeight: matrixCellHeight,
    title: "S · SOURCE TOKEN-ID MATRIX [2 x 7]",
    subtitle: "integer addresses · not magnitudes",
    color: CYAN,
    accent: GOLD,
  };
  const matrixUnknown = createValueBoard(
    Array.from({ length: 14 }, () => "·"),
    2,
    7,
    {
      ...matrixOptions,
      unknownIndices: Array.from({ length: 14 }, (_, index) => index),
    },
  );
  const matrixBoard = createValueBoard(
    DATA_PREP_TRACE.tokenIds.flat(),
    2,
    7,
    matrixOptions,
  );
  for (const board of [matrixUnknown, matrixBoard]) {
    board.position.copy(stagePoint(4, new THREE.Vector3(0, 1.0, 0)));
    board.rotation.y = stageYaws[4];
    context.group.add(board);
  }
  const matrixCursor = createNeonFrame(
    (matrixWidth / 7) * 0.84,
    matrixCellHeight * 0.84,
    GOLD,
  );
  matrixCursor.position.z = 0.25;
  matrixUnknown.add(matrixCursor);
  const matrixCellOffset = (rowIndex: number, columnIndex: number) =>
    new THREE.Vector3(
      (columnIndex - 3) * (matrixWidth / 7),
      matrixHeight / 2 - 0.72 - (rowIndex + 0.5) * matrixCellHeight,
      0,
    );
  const outputPositions = DATA_PREP_TRACE.tokenIds.flatMap((row, rowIndex) =>
    row.map((_, columnIndex) =>
      stagePoint(
        4,
        matrixCellOffset(rowIndex, columnIndex)
          .setZ(0.55)
          .add(new THREE.Vector3(0, 1.0, 0)),
      ),
    ),
  );

  const flattenedTokens = DATA_PREP_TRACE.tokens.flatMap((row, rowIndex) =>
    row.map((token, columnIndex) => ({
      token,
      tokenId: DATA_PREP_TRACE.tokenIds[rowIndex][columnIndex],
      rowIndex,
      columnIndex,
    })),
  );

  // Split stage: the pieces live on two value boards (special tokens lit
  // gold) instead of loose tiles — the same grammar as every other chamber.
  const pieceWidth = 7.68;
  const pieceCellHeight = 0.78;
  const pieceHeight = pieceCellHeight + 0.72 + 0.5 + 0.34;
  const pieceBoards = DATA_PREP_TRACE.tokens.map((row, rowIndex) => {
    const board = createValueBoard([...row], 1, 7, {
      width: pieceWidth,
      cellHeight: pieceCellHeight,
      title: `ROW ${rowIndex} PIECES [7]`,
      subtitle:
        rowIndex === 0
          ? "split on spaces · gold cells inserted by the loader"
          : "<bos> opens the window · <eos> ends the document",
      color: BLUE,
      accent: GOLD,
      highlightedIndices: row
        .map((token, index) => (token.startsWith("<") ? index : -1))
        .filter((index) => index >= 0),
    });
    board.position.copy(
      stagePoint(2, new THREE.Vector3(0, 1.75 - rowIndex * 2.6, 0)),
    );
    board.rotation.y = stageYaws[2];
    context.group.add(board);
    return board;
  });
  const pieceCellPoint = (item: (typeof flattenedTokens)[number]) =>
    stagePoint(
      2,
      new THREE.Vector3(
        (item.columnIndex - 3) * (pieceWidth / 7),
        1.75 -
          item.rowIndex * 2.6 +
          pieceHeight / 2 -
          0.72 -
          pieceCellHeight / 2,
        0.55,
      ),
    );

  // Special tokens (<bos>, <eos>) are not pieces of the source text: they
  // are injected by the data loader, so the injector keeps its own gold
  // beacon and a glowing conduit into the split stage.
  const specialTokenSpawn = new THREE.Vector3(
    stageCenters[2].x - 5.4,
    5.4,
    stageCenters[2].z - 2.2,
  );
  const injectorYaw = Math.atan2(
    observationPoint.x - specialTokenSpawn.x,
    observationPoint.z - specialTokenSpawn.z,
  );
  const injectorPlaque = createProcessPanel(
    [
      "SPECIAL TOKEN INJECTOR",
      "<bos> opens each window · <eos> ends a document",
      "INSERTED BY THE LOADER — NOT FROM THE TEXT",
    ],
    {
      width: 9.0,
      height: 1.7,
      color: "#f3e29c",
      borderColor: GOLD,
      fontScale: 0.72,
    },
  );
  injectorPlaque.position
    .copy(specialTokenSpawn)
    .add(new THREE.Vector3(0, 2.15, 0));
  injectorPlaque.rotation.y = injectorYaw;
  context.group.add(injectorPlaque);
  const injectorBeacon = createPacket(GOLD, 0.4);
  injectorBeacon.position.copy(specialTokenSpawn);
  context.group.add(injectorBeacon);
  const injectorPath = [
    specialTokenSpawn.clone(),
    specialTokenSpawn.clone().lerp(stageCenters[2], 0.5).setY(4.2),
    stagePoint(2, new THREE.Vector3(0, 3.4, 0.4)),
  ];
  context.group.add(createPath(injectorPath, GOLD, 0.05, 0.3));
  const injectorPacket = createPacket(GOLD, 0.26);
  injectorPacket.visible = false;
  context.group.add(injectorPacket);

  const totalWordLookups = flattenedTokens.filter(
    (item) => !item.token.startsWith("<"),
  ).length;
  let wordLookupOrdinal = 0;

  const tokenRuntimes = flattenedTokens.map((item, index) => {
    const isSpecial = item.token.startsWith("<");
    const wordLookupNumber = isSpecial ? 0 : (wordLookupOrdinal += 1);
    const statusPanel = createProcessPanel(
      isSpecial
        ? [
            `INSERT  '${item.token}'  →  ID ${String(item.tokenId).padStart(2, "0")}`,
            "special token from the loader — not found in the text",
          ]
        : [
            `LOOKUP ${String(wordLookupNumber).padStart(2, "0")}/${String(totalWordLookups).padStart(2, "0")}`,
            `'${item.token}'  →  vocabulary address ${item.tokenId}`,
          ],
      {
        width: 7.6,
        height: 1.05,
        color: "#f3e29c",
        borderColor: isSpecial ? GOLD : BLUE,
        fontScale: 0.75,
      },
    );
    statusPanel.position.copy(stagePoint(3, new THREE.Vector3(0, 4.45, 0.16)));
    statusPanel.rotation.y = stageYaws[3];
    statusPanel.visible = false;
    context.group.add(statusPanel);

    return {
      ...item,
      isSpecial,
      statusPanel,
      splitPosition: pieceCellPoint(item),
      lookupPosition: vocabularyPositions[item.tokenId],
      outputPosition: outputPositions[index],
    };
  });
  const lookupPacket = createPacket(CYAN, 0.24);
  lookupPacket.visible = false;
  context.group.add(lookupPacket);

  const readyPanel = createProcessPanel(
    ["S [2 x 7] READY", "NEXT: SLICE X AND Y CONTEXT WINDOWS"],
    {
      width: 7.4,
      height: 1.15,
      color: GREEN,
      borderColor: GREEN,
      fontScale: 0.75,
    },
  );
  readyPanel.position.set(stageCenters[5].x, 3.9, stageCenters[5].z + 0.3);
  readyPanel.rotation.y = stageYaws[5];
  context.group.add(readyPanel);
  const readyBeacon = createPacket(GREEN, 0.5);
  readyBeacon.position.set(stageCenters[5].x, 0.4, stageCenters[5].z + 0.4);
  context.group.add(readyBeacon);

  const setFocus = (object: THREE.Object3D, reveal: number) => {
    setObjectOpacity(object, reveal);
    object.scale.setScalar(Math.max(0.001, 0.9 + reveal * 0.1));
  };
  const arcTravel = (
    object: THREE.Object3D,
    from: THREE.Vector3,
    to: THREE.Vector3,
    amount: number,
    arcHeight: number,
  ) => {
    object.position.lerpVectors(from, to, amount);
    object.position.y += Math.sin(amount * Math.PI) * arcHeight;
  };

  const update = (progress: number, elapsed: number) => {
    const safeProgress = THREE.MathUtils.clamp(progress, 0, 1);
    const stageIndex = DATA_PREP_STAGES.reduce(
      (current, stage, index) => (safeProgress >= stage.start ? index : current),
      0,
    );
    stageMaterials.forEach((material, index) => {
      material.emissiveIntensity =
        index === stageIndex ? 1.15 : index < stageIndex ? 0.42 : 0.1;
    });

    sourcePanels.forEach((panel, row) =>
      setFocus(panel, easedProgress(safeProgress, row * 0.015, 0.11 + row * 0.015)),
    );
    cleanPanels.forEach((panel, row) =>
      setFocus(
        panel,
        easedProgress(safeProgress, 0.16 + row * 0.015, 0.28 + row * 0.015),
      ),
    );

    const scanReveal =
      easedProgress(safeProgress, 0.11, 0.15) *
      (1 - easedProgress(safeProgress, 0.3, 0.34));
    setObjectOpacity(scanner, scanReveal);
    setObjectOpacity(scanLine, scanReveal);
    const scanProgress = easedProgress(safeProgress, 0.16, 0.3);
    scanLine.position.y = -3.0 + scanProgress * 6.25;

    cleaningPackets.forEach((packet, row) => {
      const travel = easedProgress(
        safeProgress,
        0.125 + row * 0.018,
        0.265 + row * 0.018,
      );
      packet.visible = safeProgress >= 0.115 && safeProgress < 0.31;
      if (!packet.visible) return;
      arcTravel(
        packet,
        new THREE.Vector3(
          stageCenters[0].x + 4.1,
          1.5 - row * 2.95,
          stageCenters[0].z,
        ),
        new THREE.Vector3(
          stageCenters[1].x - 4.1,
          1.5 - row * 2.95,
          stageCenters[1].z,
        ),
        travel,
        2.4,
      );
      packet.rotation.x = elapsed * 1.3;
      packet.rotation.y = elapsed * 0.9;
    });

    pieceBoards.forEach((board, row) =>
      setFocus(
        board,
        easedProgress(safeProgress, 0.3 + row * 0.02, 0.42 + row * 0.02),
      ),
    );
    setFocus(injectorPlaque, easedProgress(safeProgress, 0.3, 0.36));
    injectorBeacon.scale.setScalar(1 + Math.sin(elapsed * 3.4) * 0.08);
    injectorPacket.visible = safeProgress >= 0.32 && safeProgress < 0.47;
    if (injectorPacket.visible) {
      const injectorTravel = easedProgress(safeProgress, 0.33, 0.45);
      const scaled = injectorTravel * (injectorPath.length - 1);
      const segment = Math.min(injectorPath.length - 2, Math.floor(scaled));
      arcTravel(
        injectorPacket,
        injectorPath[segment],
        injectorPath[segment + 1],
        scaled - segment,
        0.3,
      );
      injectorPacket.rotation.y = elapsed * 1.1;
    }

    setFocus(vocabBoard, easedProgress(safeProgress, 0.42, 0.52));
    const lookupWindow = safeProgress >= 0.48 && safeProgress < 0.82;
    setObjectEmissive(
      vocabBoard,
      0.1 + (lookupWindow ? 0.5 + Math.sin(elapsed * 3) * 0.2 : 0),
    );
    setFocus(
      matrixUnknown,
      easedProgress(safeProgress, 0.46, 0.56) *
        (1 - easedProgress(safeProgress, 0.84, 0.9)),
    );
    setFocus(matrixBoard, easedProgress(safeProgress, 0.84, 0.92));

    tokenRuntimes.forEach((token) => {
      token.statusPanel.visible = false;
    });
    lookupPacket.visible = false;
    setObjectOpacity(vocabCursor, 0);
    setObjectOpacity(matrixCursor, 0);
    if (lookupWindow) {
      const local = (safeProgress - 0.48) / (0.82 - 0.48);
      const slot = Math.min(
        tokenRuntimes.length - 1,
        Math.floor(local * tokenRuntimes.length),
      );
      const within = local * tokenRuntimes.length - slot;
      const active = tokenRuntimes[slot];
      active.statusPanel.visible = true;
      setObjectOpacity(active.statusPanel, 1);
      active.statusPanel.scale.setScalar(1 + Math.sin(elapsed * 6) * 0.015);

      setObjectOpacity(vocabCursor, 1);
      vocabCursor.position.copy(vocabCellOffset(active.tokenId).setZ(0.25));
      vocabCursor.scale.setScalar(1 + Math.sin(elapsed * 6) * 0.05);
      setObjectOpacity(matrixCursor, 1);
      matrixCursor.position.copy(
        matrixCellOffset(active.rowIndex, active.columnIndex).setZ(0.25),
      );

      lookupPacket.visible = true;
      if (within < 0.42) {
        lookupPacket.scale.setScalar(1);
        arcTravel(
          lookupPacket,
          active.splitPosition,
          active.lookupPosition,
          easedProgress(within, 0, 0.42),
          2.6,
        );
      } else if (within < 0.58) {
        lookupPacket.position.copy(active.lookupPosition);
        lookupPacket.scale.setScalar(1.1 + Math.sin(elapsed * 8) * 0.06);
      } else {
        lookupPacket.scale.setScalar(1);
        arcTravel(
          lookupPacket,
          active.lookupPosition,
          active.outputPosition,
          easedProgress(within, 0.58, 1),
          2.6,
        );
      }
      lookupPacket.rotation.x = elapsed * 1.3;
      lookupPacket.rotation.y = elapsed * 0.9;
    }

    setFocus(readyPanel, easedProgress(safeProgress, 0.86, 0.95));
    const beaconReveal = easedProgress(safeProgress, 0.92, 0.97);
    setObjectOpacity(readyBeacon, beaconReveal);
    if (beaconReveal > 0.001) {
      readyBeacon.scale.setScalar(1 + Math.sin(elapsed * 4.6) * 0.12);
      readyBeacon.rotation.y = elapsed * 0.75;
    }
  };
  update(0, 0);
  return update;
}

function buildTokenStream(context: BuildContext) {
  addStationHeading(context, "continuous stream → sampled context windows");
  addShell(context, new THREE.Vector3(20, 13, 22), new THREE.Vector3(0, 0, -2));

  const rails = [-1.45, 1.45].map((x) =>
    addTube(
      context.group,
      [new THREE.Vector3(x, -2.1, 8), new THREE.Vector3(x, -2.1, -10)],
      0.06,
      context.palette.structure,
    ),
  );
  rails.forEach((rail) => addAnimation(context, rail, "pulse", 0.7, 0.02));
  const tiles = makeTokenPositions(28, new THREE.Vector3(0, -1.65, 8), new THREE.Vector3(0, 0, -0.66));
  const colors = tiles.map((_, index) => context.palette.phaseBase.clone().offsetHSL((index % 7) * 0.025, 0, 0.05));
  const tokenMaterial = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    emissive: context.palette.dark,
    emissiveIntensity: 1.1,
    vertexColors: true,
    roughness: 0.3,
    metalness: 0.35,
  });
  const tokenMesh = addInstancedBoxes(
    context.group,
    tiles,
    new THREE.Vector3(2.45, 0.4, 0.52),
    tokenMaterial,
    undefined,
    undefined,
    colors,
  );
  context.phaseMaterials.push(tokenMaterial);
  addAnimation(context, tokenMesh, "travel-z", 0.75, 0.66, 0);

  const contextWindowMaterial = new THREE.MeshBasicMaterial({
    color: context.palette.phaseBase,
    wireframe: true,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
  });
  const windowPositions = [3.4, -5.4] as const;
  windowPositions.forEach((windowZ, windowIndex) => {
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(4.4, 1.7, 4.25),
      contextWindowMaterial,
    );
    frame.position.set(0, -1.6, windowZ);
    context.group.add(frame);
    label(context, `SOURCE WINDOW ${windowIndex + 1}  [T+1=7]`, new THREE.Vector3(0, 0.1, windowZ), {
      width: 3.7,
      tier: "structure",
      compact: true,
    });
  });
}

function buildBatchPlatform(context: BuildContext) {
  addStationHeading(context, "inputs [B,T]  |  targets shifted by one");
  addShell(context, new THREE.Vector3(21, 15, 20), new THREE.Vector3(0, 0, -1));

  const buildTray = (y: number, z: number, material: THREE.Material, target = false) => {
    const positions: THREE.Vector3[] = [];
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 6; column += 1) {
        positions.push(
          new THREE.Vector3(
            (column - 2.5) * 1.12,
            y,
            z + (row - 0.5) * 1.12,
          ),
        );
      }
    }
    const tray = addInstancedBoxes(
      context.group,
      positions,
      new THREE.Vector3(0.94, 0.32, 0.94),
      material,
    );
    addAnimation(context, tray, "pulse", target ? 0.82 : 0.65, 0.025, target ? 1.2 : 0);
    return tray;
  };
  buildTray(-0.65, 0.9, context.palette.active);
  buildTray(-3.1, 0.9, context.palette.target, true);
  addTube(
    context.group,
    [new THREE.Vector3(-7.5, -3.1, 0.9), new THREE.Vector3(-5.2, -3.1, 0.9), new THREE.Vector3(-5.2, -3.1, -8)],
    0.12,
    context.palette.target,
  );
  label(context, "INPUTS → MODEL", new THREE.Vector3(0, 2.1, 1.2), { width: 3.4, compact: true });
  label(context, "TARGETS → LOSS (separate)", new THREE.Vector3(0, -5.0, 1.2), {
    width: 4.7,
    compact: true,
    color: "#ffc83d",
  });
  label(context, "<bos>  the  cat  sat  on  the", new THREE.Vector3(0, 0.65, -1.1), {
    width: 5.4,
    tier: "structure",
    compact: true,
  });
  label(context, "the  cat  sat  on  the  mat", new THREE.Vector3(0, -2.0, -1.1), {
    width: 5.1,
    tier: "structure",
    compact: true,
    color: "#ffc83d",
  });
}

function buildEmbeddingHall(context: BuildContext) {
  addStationHeading(context, "E[token id] + position → hidden vector");
  addShell(context, new THREE.Vector3(22, 16, 21), new THREE.Vector3(0, 0, -1));

  const cells = addMatrixGrid(
    context,
    16,
    8,
    new THREE.Vector3(0, -5.2, -2.2),
    0.55,
    0.42,
    (row) => (row === 4 ? 0.85 : 0.22),
    (row, column) =>
      row === 4
        ? context.palette.bright.clone()
        : context.palette.dark.clone().lerp(context.palette.phaseBase, ((row + column) % 5) * 0.05),
  );
  cells.rotation.x = Math.PI / 2;
  cells.position.y = 1.1;
  label(context, "EMBEDDING MATRIX  E [V,d_model]", new THREE.Vector3(0, 5.3, -2), {
    width: 5.4,
    tier: "structure",
    compact: true,
  });

  const selected = new THREE.Mesh(
    new THREE.BoxGeometry(4.45, 0.14, 0.48),
    context.palette.signal,
  );
  selected.position.set(0, 0.45, -1.85);
  context.group.add(selected);
  addAnimation(context, selected, "pulse", 1.1, 0.09, 0.4);
  const fiberPoints: THREE.Vector3[] = [];
  for (let channel = 0; channel < 8; channel += 1) {
    const x = (channel - 3.5) * 0.52;
    fiberPoints.push(new THREE.Vector3(x, 0.45, -1.8));
    addTube(
      context.group,
      [new THREE.Vector3(x, 0.45, -1.8), new THREE.Vector3(x * 1.35, 0.2, -7.4)],
      0.035,
      channel % 3 === 0 ? context.palette.signal : context.palette.active,
    );
  }
  addInstancedSpheres(context.group, fiberPoints, 0.09, context.palette.signal);
  label(context, "ID IS AN ADDRESS · CELL HEIGHTS SCHEMATIC", new THREE.Vector3(0, -2.6, 1.9), {
    width: 6.1,
    tier: "structure",
    compact: true,
  });
}

function buildTransformerTower(context: BuildContext) {
  addStationHeading(context, "embeddings → transformer blocks × N → final norm");
  addShell(context, new THREE.Vector3(22, 18, 22), new THREE.Vector3(0, 0, -1));

  const floorPositions: THREE.Vector3[] = [];
  const floorScales: THREE.Vector3[] = [];
  const floorColors: THREE.Color[] = [];
  for (let layer = 0; layer < 2; layer += 1) {
    floorPositions.push(new THREE.Vector3(0, -2 + layer * 6, 0.5));
    floorScales.push(new THREE.Vector3(3.8, 0.34, 2.8));
    floorColors.push(
      layer === 0
        ? context.palette.bright.clone()
        : context.palette.dark.clone().lerp(context.palette.phaseBase, 0.48),
    );
  }
  const material = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.28,
    metalness: 0.7,
    emissive: context.palette.dark,
    emissiveIntensity: 0.7,
    vertexColors: true,
  });
  const floors = addInstancedBoxes(
    context.group,
    floorPositions,
    new THREE.Vector3(3.0, 1, 3.0),
    material,
    undefined,
    floorScales,
    floorColors,
  );
  context.phaseMaterials.push(material);
  addAnimation(context, floors, "pulse", 0.32, 0.018, 0.7);

  const spine = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 10.5, 16),
    context.palette.signal,
  );
  spine.position.y = 1;
  context.group.add(spine);
  const packets = Array.from({ length: 24 }, (_, index) => {
    const block = Math.floor(index / 12);
    const tokenIndex = index % 12;
    const row = Math.floor(tokenIndex / 6);
    const column = tokenIndex % 6;
    return new THREE.Vector3(
      (column - 2.5) * 0.85,
      -1.25 + block * 6,
      0.5 + (row - 0.5) * 0.9,
    );
  });
  const packetMesh = addInstancedSpheres(context.group, packets, 0.13, context.palette.signal);
  addAnimation(context, packetMesh, "bob", 0.72, 0.18, 0.2);

  label(context, "2 VISIBLE FLOORS = 2 TRANSFORMER BLOCKS", new THREE.Vector3(0, -5.5, 2.3), {
    width: 6.1,
    tier: "structure",
    compact: true,
  });
  label(context, "SELECTED BLOCK 0", new THREE.Vector3(7.2, -1.4, 1.0), {
    width: 3.7,
    compact: true,
  });
}

function buildTransformerBlock(context: BuildContext) {
  addStationHeading(context, "x + Attention(Norm(x))  →  x + MLP(Norm(x))");
  addShell(context, new THREE.Vector3(22, 16, 23), new THREE.Vector3(0, 0, -1));
  const attentionMaterial = branchMaterial(context, "left", context.palette.active);
  const mlpMaterial = branchMaterial(context, "right", context.palette.warm);

  const residual = addTube(
    context.group,
    [
      new THREE.Vector3(0, -2.8, 8.5),
      new THREE.Vector3(0, -2.8, 4),
      new THREE.Vector3(0, -2.8, 0),
      new THREE.Vector3(0, -2.8, -4),
      new THREE.Vector3(0, -2.8, -9),
    ],
    0.34,
    context.palette.signal,
  );
  addAnimation(context, residual, "pulse", 0.9, 0.026, 0.4);

  const normPositions = [new THREE.Vector3(0, -1.15, 4.7), new THREE.Vector3(0, -1.15, -2.9)];
  normPositions.forEach((position, index) => {
    const norm = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.23, 10, 48), context.palette.target);
    norm.rotation.x = Math.PI / 2;
    norm.position.copy(position);
    context.group.add(norm);
    addAnimation(context, norm, "spin", index ? -0.32 : 0.32, 1, index * 0.7);
  });

  const attention = new THREE.Mesh(new THREE.BoxGeometry(7.1, 3.5, 3.9), attentionMaterial);
  attention.position.set(-4.4, 0.1, 1.8);
  context.group.add(attention);
  const mlp = new THREE.Mesh(new THREE.BoxGeometry(7.1, 3.5, 3.9), mlpMaterial);
  mlp.position.set(4.4, 0.1, -5.3);
  context.group.add(mlp);
  addAnimation(context, attention, "pulse", 0.62, 0.028, 0);
  addAnimation(context, mlp, "pulse", 0.62, 0.028, Math.PI);

  addTube(
    context.group,
    [
      new THREE.Vector3(0, -2.8, 4.7),
      new THREE.Vector3(-4.4, -1.7, 4.2),
      new THREE.Vector3(-4.4, 0.1, 1.8),
      new THREE.Vector3(0, -2.8, -0.1),
    ],
    0.16,
    attentionMaterial,
  );
  addTube(
    context.group,
    [
      new THREE.Vector3(0, -2.8, -2.9),
      new THREE.Vector3(4.4, -1.7, -3.4),
      new THREE.Vector3(4.4, 0.1, -5.3),
      new THREE.Vector3(0, -2.8, -7.2),
    ],
    0.16,
    mlpMaterial,
  );

  [-0.1, -7.2].forEach((z) => {
    const addRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.17, 8, 30), context.palette.target);
    addRing.rotation.x = Math.PI / 2;
    addRing.position.set(0, -2.8, z);
    context.group.add(addRing);
    addAnimation(context, addRing, "spin", 0.8, 1, z);
  });
  label(context, "RESIDUAL HIGHWAY", new THREE.Vector3(0, -4.8, 2.9), {
    width: 3.7,
    tier: "structure",
    compact: true,
  });
  label(context, "ATTENTION · positions communicate", new THREE.Vector3(-4.4, 2.6, 1.8), {
    branch: "left",
    width: 5.0,
    compact: true,
  });
  label(context, "MLP · each position independently", new THREE.Vector3(4.4, 2.6, -5.3), {
    branch: "right",
    width: 5.0,
    compact: true,
    color: "#ff8b66",
  });
}

function buildMultiHeadHall(context: BuildContext) {
  addStationHeading(context, "N=LN₁(H) · NW_Q, NW_K, NW_V → reshape [B,H,T,d_head]");
  addShell(context, new THREE.Vector3(22, 17, 22), new THREE.Vector3(0, 0, -1));

  const projectionZ = 4.4;
  ["Q", "K", "V"].forEach((name, index) => {
    const color = ["#5defff", "#a999ff", "#62f2b5"][index];
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.3,
      metalness: 0.42,
      roughness: 0.24,
    });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(5.4, 8.4, 0.35), material);
    wall.position.set((index - 1) * 6.1, 0, projectionZ);
    context.group.add(wall);
    label(context, `W${name}`, new THREE.Vector3((index - 1) * 6.1, 5.1, projectionZ), {
      width: 1.7,
      tier: "structure",
      compact: true,
      color,
    });
  });

  const heads = [
    new THREE.Vector3(-3.2, 0, -3.8),
    new THREE.Vector3(3.2, 0, -3.8),
  ];
  const headMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.62, 0.62, 2.8, 12),
    context.palette.active,
    heads.length,
  );
  const dummy = new THREE.Object3D();
  heads.forEach((position, index) => {
    dummy.position.copy(position);
    dummy.rotation.x = Math.PI / 2;
    dummy.scale.set(1.7, 1.35, 1.7);
    dummy.updateMatrix();
    headMesh.setMatrixAt(index, dummy.matrix);
  });
  headMesh.instanceMatrix.needsUpdate = true;
  context.group.add(headMesh);
  addAnimation(context, headMesh, "pulse", 0.56, 0.018, 0.2);

  for (let index = 0; index < 8; index += 1) {
    const startX = (index - 3.5) * 1.4;
    addTube(
      context.group,
      [new THREE.Vector3(startX, 0, 3.9), new THREE.Vector3(startX * 0.8, 0, 0), new THREE.Vector3(startX, 0, -3.0)],
      0.045,
      index % 3 === 0 ? context.palette.signal : context.palette.active,
    );
  }
  label(context, "2 HEAD LANES · 4 FEATURES EACH", new THREE.Vector3(0, -5.35, -3.8), {
    width: 5.6,
    tier: "structure",
    compact: true,
  });
}

function buildAttentionHead(context: BuildContext) {
  addStationHeading(context, "query, key, value derived from the same hidden states");
  addShell(context, new THREE.Vector3(21, 16, 22), new THREE.Vector3(0, 0, -1));
  const queryKeyMaterial = branchMaterial(context, "left", context.palette.active);
  const valueMaterial = branchMaterial(context, "right", context.palette.signal);

  const lanes = [
    { x: -5.0, name: "QUERY", color: "#5defff", material: queryKeyMaterial },
    { x: 0, name: "KEY", color: "#a999ff", material: queryKeyMaterial },
    { x: 5.0, name: "VALUE", color: "#62f2b5", material: valueMaterial },
  ];
  lanes.forEach((lane, laneIndex) => {
    const chamber = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 8.6, 18, 1, true), lane.material);
    chamber.rotation.x = Math.PI / 2;
    chamber.position.set(lane.x, 0, 1.5);
    context.group.add(chamber);
    label(context, lane.name, new THREE.Vector3(lane.x, 3.8, 2.0), {
      branch: laneIndex === 2 ? "right" : "left",
      width: 2.35,
      compact: true,
      color: lane.color,
    });
    const packets = makeTokenPositions(
      6,
      new THREE.Vector3(lane.x, 0, 5.0),
      new THREE.Vector3(0, 0, -1.16),
    );
    const mesh = addInstancedSpheres(context.group, packets, 0.18, lane.material);
    addAnimation(context, mesh, "travel-z", 0.9 + laneIndex * 0.14, 0.82, laneIndex * 0.5);
  });

  const queryBeam = addTube(
    context.group,
    [new THREE.Vector3(-5, 0, -3), new THREE.Vector3(-2.2, 0, -5.4), new THREE.Vector3(0, 0, -5.4)],
    0.12,
    queryKeyMaterial,
  );
  addAnimation(context, queryBeam, "pulse", 1.2, 0.05, 0.3);
  addTube(
    context.group,
    [new THREE.Vector3(5, 0, -3), new THREE.Vector3(3.5, -1.1, -5.4), new THREE.Vector3(0.5, -1.1, -7.5)],
    0.14,
    valueMaterial,
  );
  label(context, "Q: Q·K INTERACTION", new THREE.Vector3(-4.1, -4.3, -4.6), {
    branch: "left",
    width: 4.0,
    compact: true,
  });
  label(context, "E: VALUE AGGREGATION", new THREE.Vector3(4.1, -4.3, -4.6), {
    branch: "right",
    width: 4.2,
    compact: true,
  });
}

function buildScoreArena(context: BuildContext) {
  addStationHeading(context, "score[i,j] = q_i · k_j / √d_head");
  addShell(context, new THREE.Vector3(21, 15, 22), new THREE.Vector3(0, 0, -1));
  const grid = addMatrixGrid(
    context,
    6,
    6,
    new THREE.Vector3(0, -4.1, -1.8),
    1.12,
    0.9,
    (row, column) =>
      row === 2
        ? 0.3 + Math.abs(SELECTED_TRACE.attention.scaledScoresBeforeMask[column]) * 0.72
        : 0.34,
    (row, column) => {
      if (row === 2 && column === 0) return new THREE.Color("#ffffff");
      if (row === 2) {
        return SELECTED_TRACE.attention.scaledScoresBeforeMask[column] < 0
          ? new THREE.Color("#ff765f")
          : context.palette.bright.clone();
      }
      return new THREE.Color("#59697b");
    },
  );
  addAnimation(context, grid, "pulse", 0.68, 0.016, 0.4);

  const rowBeam = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 0.08, 0.1),
    context.palette.signal,
  );
  rowBeam.position.set(0, -2.4, -1.8 + (2 - 2.5) * 1.12);
  context.group.add(rowBeam);
  const columnBeam = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.08, 7.2),
    context.palette.target,
  );
  columnBeam.position.set((0 - 2.5) * 1.12, -2.4, -1.8);
  context.group.add(columnBeam);
  addAnimation(context, rowBeam, "pulse", 1.0, 0.12, 0);
  addAnimation(context, columnBeam, "pulse", 1.0, 0.12, 1.4);

  label(context, "ROWS: WHICH POSITION IS LOOKING?", new THREE.Vector3(-6.3, 3.2, -2), {
    width: 5.2,
    tier: "structure",
    compact: true,
  });
  label(context, "COLUMNS: WHICH POSITION IS EXAMINED?", new THREE.Vector3(5.7, 1.8, -4.7), {
    width: 5.5,
    tier: "structure",
    compact: true,
  });
  label(context, "q₂ · k₀ = Σc q₂,c k₀,c = 4.2", new THREE.Vector3(0, 4.6, -0.5), {
    width: 4.4,
    tier: "math",
    compact: true,
  });
  label(context, "ROW 2 EXACT · OTHER ROWS SCHEMATIC", new THREE.Vector3(0, -5.0, 3.1), {
    width: 5.2,
    tier: "structure",
    compact: true,
  });
}

function buildCausalMask(context: BuildContext) {
  addStationHeading(context, "future scores → −∞  |  after softmax → 0");
  addShell(context, new THREE.Vector3(21, 15, 22), new THREE.Vector3(0, 0, -1));
  const grid = addMatrixGrid(
    context,
    6,
    6,
    new THREE.Vector3(0, -4.2, -1.6),
    1.12,
    0.9,
    (row, column) => (column > row ? 1.55 : 0.32 + Math.abs(Math.sin(row + column)) * 0.45),
    (row, column) =>
      column > row
        ? new THREE.Color("#ff523d").multiplyScalar(0.72)
        : context.palette.dark.clone().lerp(context.palette.phaseBase, 0.5),
  );
  addAnimation(context, grid, "pulse", 0.72, 0.018, 0.2);

  const boundary = addLine(
    context.group,
    Array.from({ length: 6 }, (_, index) =>
      new THREE.Vector3(
        (index - 2.5) * 1.12 + 0.56,
        -2.35,
        -1.6 + (index - 2.5) * 1.12 - 0.56,
      ),
    ),
    "#fff1a8",
    0.95,
  );
  addAnimation(context, boundary, "pulse", 1.25, 0.08, 0.4);
  label(context, "PAST + CURRENT: ALLOWED", new THREE.Vector3(-4.2, 2.6, 0.7), {
    width: 4.3,
    tier: "structure",
    compact: true,
  });
  label(context, "FUTURE: MASKED (temporary scores)", new THREE.Vector3(4.4, 2.6, -3.4), {
    width: 5.1,
    tier: "structure",
    compact: true,
    color: "#ff765f",
  });
  const shutters: THREE.Vector3[] = [];
  for (let row = 0; row < 6; row += 1) {
    for (let column = row + 1; column < 6; column += 1) {
      shutters.push(
        new THREE.Vector3(
          (column - 2.5) * 1.12,
          -1.9,
          -1.6 + (row - 2.5) * 1.12,
        ),
      );
    }
  }
  const shutterMesh = addInstancedBoxes(
    context.group,
    shutters,
    new THREE.Vector3(0.84, 0.12, 0.84),
    context.palette.warm,
  );
  addAnimation(context, shutterMesh, "bob", 0.85, 0.18, 0.4);
}

function buildSoftmaxValueMix(context: BuildContext) {
  addStationHeading(context, "softmax(scores) · V → head output");
  addShell(context, new THREE.Vector3(21, 15, 22), new THREE.Vector3(0, 0, -1));
  const weights = [...SELECTED_TRACE.attention.attentionWeights];
  const bars: THREE.Vector3[] = [];
  const scales: THREE.Vector3[] = [];
  weights.forEach((weight, index) => {
    bars.push(new THREE.Vector3((index - 2.5) * 1.65, -3.7 + weight * 6, 3.8));
    scales.push(new THREE.Vector3(1, Math.max(0.06, weight * 12), 1));
  });
  const barMesh = addInstancedBoxes(
    context.group,
    bars,
    new THREE.Vector3(1.0, 0.5, 0.65),
    context.palette.active,
    undefined,
    scales,
  );
  addAnimation(context, barMesh, "pulse", 0.8, 0.025, 0.2);

  weights.forEach((weight, index) => {
    const x = (index - 2.5) * 1.65;
    const valve = new THREE.Mesh(
      new THREE.TorusGeometry(0.35 + weight * 0.55, 0.1, 8, 24),
      index === 0 ? context.palette.signal : context.palette.active,
    );
    valve.position.set(x, 0, 0.2);
    context.group.add(valve);
    addAnimation(context, valve, "spin", (index % 2 ? -1 : 1) * (0.3 + weight), 1, index);
    addTube(
      context.group,
      [
        new THREE.Vector3(x, 0, 2.8),
        new THREE.Vector3(x, 0, 0.2),
        new THREE.Vector3(x * 0.35, -0.2, -3.0),
        new THREE.Vector3(0, 0, -6.6),
      ],
      0.045 + weight * 0.2,
      index === 0 ? context.palette.signal : context.palette.active,
    );
  });
  const output = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 2), context.palette.signal);
  output.position.set(0, 0, -7.3);
  context.group.add(output);
  addAnimation(context, output, "pulse", 1.35, 0.13, 0);
  label(context, "WEIGHTS SUM TO 1.00", new THREE.Vector3(0, 4.5, 3.8), {
    width: 4.1,
    tier: "structure",
    compact: true,
  });
  label(context, "0.7853V₀ + 0.1435V₁ + 0.0712V₂", new THREE.Vector3(0, 3.1, -3.6), {
    width: 4.1,
    tier: "math",
    compact: true,
  });
}

function buildHeadRecombination(context: BuildContext) {
  addStationHeading(context, "concat(head₁…head_H) · W_O + residual");
  addShell(context, new THREE.Vector3(22, 16, 22), new THREE.Vector3(0, 0, -1));
  const headPositions: THREE.Vector3[] = [];
  for (let head = 0; head < 2; head += 1) {
    for (let channel = 0; channel < 4; channel += 1) {
      headPositions.push(
        new THREE.Vector3(
          (channel - 1.5) * 1.35,
          (head - 0.5) * 1.65,
          5.8,
        ),
      );
    }
  }
  const headMesh = addInstancedBoxes(
    context.group,
    headPositions,
    new THREE.Vector3(1.25, 1.02, 0.45),
    context.palette.active,
  );
  addAnimation(context, headMesh, "pulse", 0.66, 0.025, 0.4);
  for (let lane = 0; lane < 8; lane += 1) {
    const x = (lane - 3.5) * 0.78;
    addTube(
      context.group,
      [new THREE.Vector3(x * 1.35, 0, 5.0), new THREE.Vector3(x, 0, 2), new THREE.Vector3(x, 0, -1.4)],
      0.045,
      lane % 4 === 0 ? context.palette.signal : context.palette.active,
    );
  }
  const outputWall = new THREE.Mesh(
    new THREE.BoxGeometry(8.8, 8.4, 0.5),
    context.palette.structure,
  );
  outputWall.position.set(0, 0, -1.8);
  context.group.add(outputWall);
  const outputBands = makeTokenPositions(
    8,
    new THREE.Vector3(-3.5, 0, -1.45),
    new THREE.Vector3(1, 0, 0),
  );
  addInstancedBoxes(
    context.group,
    outputBands,
    new THREE.Vector3(0.46, 7.2, 0.15),
    context.palette.active,
  );
  label(context, "OUTPUT PROJECTION  W_O", new THREE.Vector3(0, 5.15, -1.8), {
    width: 4.2,
    tier: "structure",
    compact: true,
  });

  const residualA = addTube(
    context.group,
    [new THREE.Vector3(-7.5, -4.2, 5), new THREE.Vector3(-7.5, -4.2, -4.8), new THREE.Vector3(0, -2.7, -7.0)],
    0.25,
    context.palette.signal,
  );
  const transformed = addTube(
    context.group,
    [new THREE.Vector3(0, 0, -2.2), new THREE.Vector3(0, -1.5, -4.8), new THREE.Vector3(0, -2.7, -7.0)],
    0.25,
    context.palette.active,
  );
  addAnimation(context, residualA, "pulse", 0.82, 0.025, 0);
  addAnimation(context, transformed, "pulse", 0.82, 0.025, 1.4);
}

function buildMLP(context: BuildContext) {
  addStationHeading(context, "d_model → d_ff → GELU → d_model");
  addShell(context, new THREE.Vector3(22, 16, 23), new THREE.Vector3(0, 0, -1));

  const tokens = [0];
  tokens.forEach((x, tokenIndex) => {
    addTube(
      context.group,
      [
        new THREE.Vector3(x, -0.1, 8),
        new THREE.Vector3(x, -0.1, 3.5),
        new THREE.Vector3(x * 1.75, 0, 0),
        new THREE.Vector3(x * 1.75, 0, -3.2),
        new THREE.Vector3(x, -0.1, -7.8),
      ],
      0.13,
      tokenIndex % 2 ? context.palette.active : context.palette.signal,
    );
    const gates: THREE.Vector3[] = [];
    for (let channel = 0; channel < 32; channel += 1) {
      const row = Math.floor(channel / 8);
      const column = channel % 8;
      gates.push(
        new THREE.Vector3(
          x * 1.75 + (column - 3.5) * 0.52,
          (row - 1.5) * 0.72,
          -1.3,
        ),
      );
    }
    const gateMesh = addInstancedSpheres(context.group, gates, 0.13, context.palette.warm);
    addAnimation(context, gateMesh, "pulse", 0.9, 0.035, tokenIndex * 0.5);
  });
  const upWall = new THREE.Mesh(new THREE.BoxGeometry(15.8, 8.5, 0.4), context.palette.structure);
  upWall.position.z = 3.1;
  context.group.add(upWall);
  const downWall = new THREE.Mesh(new THREE.BoxGeometry(15.8, 8.5, 0.4), context.palette.structure);
  downWall.position.z = -4.1;
  context.group.add(downWall);
  label(context, "EXPANSION  W_up", new THREE.Vector3(0, 5.2, 3.1), {
    width: 3.6,
    tier: "structure",
    compact: true,
  });
  label(context, "GELU NONLINEARITY", new THREE.Vector3(0, 4.4, -1.1), {
    width: 3.8,
    tier: "structure",
    compact: true,
    color: "#ff765f",
  });
  label(context, "CONTRACTION  W_down", new THREE.Vector3(0, 5.2, -4.1), {
    width: 4.1,
    tier: "structure",
    compact: true,
  });
  label(context, "1 SELECTED OF 12 · SHARED 8→32→8 MLP", new THREE.Vector3(0, -5.0, -0.5), {
    width: 5.0,
    tier: "structure",
    compact: true,
  });
}

function buildFinalHidden(context: BuildContext) {
  addStationHeading(context, "contextual hidden states — not probabilities yet");
  addShell(context, new THREE.Vector3(21, 15, 22), new THREE.Vector3(0, 0, -1));
  const capsulePositions: THREE.Vector3[] = [];
  for (let row = 0; row < 2; row += 1) {
    for (let token = 0; token < 6; token += 1) {
      capsulePositions.push(new THREE.Vector3((token - 2.5) * 2.3, row ? -2.2 : 2.2, 1.5 - token * 0.52));
    }
  }
  const capsules = new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(0.62, 1.25, 5, 12),
    context.palette.structure,
    capsulePositions.length,
  );
  const dummy = new THREE.Object3D();
  capsulePositions.forEach((position, index) => {
    dummy.position.copy(position);
    dummy.rotation.x = Math.PI / 2;
    dummy.rotation.z = (index % 3 - 1) * 0.12;
    dummy.updateMatrix();
    capsules.setMatrixAt(index, dummy.matrix);
  });
  capsules.instanceMatrix.needsUpdate = true;
  context.group.add(capsules);
  addAnimation(context, capsules, "pulse", 0.62, 0.022, 0.4);

  const fibers: THREE.Vector3[] = [];
  capsulePositions.forEach((position, tokenIndex) => {
    for (let feature = 0; feature < 8; feature += 1) {
      fibers.push(
        position
          .clone()
          .add(new THREE.Vector3((feature - 3.5) * 0.12, Math.sin(feature + tokenIndex) * 0.38, 0.45)),
      );
    }
  });
  addInstancedSpheres(context.group, fibers, 0.09, context.palette.signal);
  const causalConnections: THREE.Vector3[] = [];
  for (let index = 0; index < 6; index += 1) {
    for (let earlier = 0; earlier <= index; earlier += 1) {
      if ((index + earlier) % 2 === 0) {
        causalConnections.push(new THREE.Vector3((index - 2.5) * 2.3, 0, -3.7 - earlier * 0.17));
      }
    }
  }
  addInstancedSpheres(context.group, causalConnections, 0.1, context.palette.active);
  label(context, "H_final [B=2, T=6, d_model=8]", new THREE.Vector3(0, 5.0, 1.4), {
    width: 5.2,
    tier: "structure",
    compact: true,
  });
  label(context, "SAME OUTER SHAPE · RICHER INTERNAL STATE", new THREE.Vector3(0, -5.0, -0.8), {
    width: 6.3,
    tier: "structure",
    compact: true,
  });
}

function buildVocabularyProjection(context: BuildContext) {
  addStationHeading(context, "[B,T,d_model] × W_vocab → [B,T,V]");
  addShell(context, new THREE.Vector3(22, 16, 23), new THREE.Vector3(0, 0, -1));

  const inputPositions = makeTokenPositions(8, new THREE.Vector3(-4.2, 0, 6.8), new THREE.Vector3(1.2, 0, 0));
  addInstancedSpheres(context.group, inputPositions, 0.19, context.palette.signal);
  inputPositions.forEach((position, index) => {
    addTube(
      context.group,
      [position, new THREE.Vector3(position.x * 1.25, (index - 3.5) * 0.35, 2.2)],
      0.04,
      context.palette.active,
    );
  });

  const matrix = addMatrixGrid(
    context,
    8,
    16,
    new THREE.Vector3(0, -4.1, 0),
    0.58,
    0.45,
    (row, column) => 0.18 + Math.abs(Math.sin(row * 0.8 + column * 0.47)) * 0.52,
  );
  matrix.rotation.x = Math.PI / 2;
  matrix.position.y = 0.6;
  label(context, "W_vocab  [8,16] · STATIONARY PARAMETERS", new THREE.Vector3(0, 5.1, 0), {
    width: 6.0,
    tier: "structure",
    compact: true,
  });

  const candidates: THREE.Vector3[] = [];
  for (let candidate = 0; candidate < 16; candidate += 1) {
    candidates.push(new THREE.Vector3((candidate - 7.5) * 0.72, Math.sin(candidate) * 1.2, -6.2));
  }
  const candidateMesh = addInstancedBoxes(
    context.group,
    candidates,
    new THREE.Vector3(0.46, 0.46, 0.46),
    context.palette.active,
  );
  addAnimation(context, candidateMesh, "pulse", 0.9, 0.035, 0.2);
  for (let index = 0; index < 16; index += 2) {
    addTube(
      context.group,
      [new THREE.Vector3((index - 7.5) * 0.55, 0, -0.4), candidates[index]],
      0.035,
      index === SELECTED_TRACE.batch.selectedTargetTokenId ? context.palette.target : context.palette.active,
    );
  }
}

function buildLogitsLandscape(context: BuildContext) {
  addStationHeading(context, "all 16 candidate scores → softmax probabilities");
  addShell(context, new THREE.Vector3(22, 16, 22), new THREE.Vector3(0, 0, -1));
  const exploreMaterial = branchMaterial(context, "left", context.palette.active);
  const targetMaterial = branchMaterial(context, "right", context.palette.target);
  const probabilities = SELECTED_TRACE.output.selectedProbabilities;
  const positions: THREE.Vector3[] = [];
  const scales: THREE.Vector3[] = [];
  const colors: THREE.Color[] = [];
  probabilities.forEach((probability, index) => {
    const row = Math.floor(index / 8);
    const column = index % 8;
    const height = 0.5 + probability * 24;
    positions.push(new THREE.Vector3((column - 3.5) * 1.45, -4.2 + height / 2, 1.6 - row * 3.0));
    scales.push(new THREE.Vector3(1, height, 1));
    colors.push(
      index === SELECTED_TRACE.batch.selectedTargetTokenId
        ? new THREE.Color("#ffd166")
        : context.palette.dark.clone().lerp(context.palette.phaseBase, 0.35 + probability * 1.8),
    );
  });
  const material = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    emissive: context.palette.dark,
    emissiveIntensity: 1.15,
    vertexColors: true,
    roughness: 0.25,
    metalness: 0.38,
    transparent: true,
  });
  context.branchMaterials.left.push(material);
  const towers = addInstancedBoxes(
    context.group,
    positions,
    new THREE.Vector3(0.9, 1, 0.9),
    material,
    undefined,
    scales,
    colors,
  );
  addAnimation(context, towers, "pulse", 0.64, 0.026, 0);

  SELECTED_TRACE.vocabulary.forEach((token, index) => {
    if (index % 2 === 0 || index === SELECTED_TRACE.batch.selectedTargetTokenId) {
      const row = Math.floor(index / 8);
      const column = index % 8;
      const probability = probabilities[index];
      label(context, `${token} ${(probability * 100).toFixed(0)}%`, new THREE.Vector3((column - 3.5) * 1.45, -3.35, 1.6 - row * 3.0), {
        width: 1.55,
        tier: "structure",
        compact: true,
        color: index === SELECTED_TRACE.batch.selectedTargetTokenId ? "#ffd166" : context.palette.phaseBase,
      });
    }
  });

  const targetIndex = SELECTED_TRACE.batch.selectedTargetTokenId;
  const targetRow = Math.floor(targetIndex / 8);
  const targetColumn = targetIndex % 8;
  const targetBeacon = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.12, 10, 40), targetMaterial);
  targetBeacon.rotation.x = Math.PI / 2;
  targetBeacon.position.set((targetColumn - 3.5) * 1.45, 4.4, 1.6 - targetRow * 3.0);
  context.group.add(targetBeacon);
  addAnimation(context, targetBeacon, "spin", 0.7, 1, 0);
  label(context, "E: FOLLOW CORRECT TARGET", new THREE.Vector3(4.8, 5.2, -3.2), {
    branch: "right",
    width: 4.4,
    compact: true,
    color: "#ffd166",
  });
  label(context, "Q: EXPLORE ALL CANDIDATES", new THREE.Vector3(-4.8, 5.2, -3.2), {
    branch: "left",
    width: 4.6,
    compact: true,
  });
  void exploreMaterial;
}

function buildTargetComparison(context: BuildContext) {
  addStationHeading(context, "gather probability at each correct target ID");
  addShell(context, new THREE.Vector3(21, 15, 22), new THREE.Vector3(0, 0, -1));
  const probabilities = SELECTED_TRACE.output.selectedProbabilities;
  const candidates: THREE.Vector3[] = [];
  probabilities.forEach((probability, index) => {
    const angle = (index / probabilities.length) * TAU;
    const radius = 5.4;
    candidates.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.7, 1.5));
  });
  addInstancedSpheres(context.group, candidates, 0.3, context.palette.active);
  const targetIndex = SELECTED_TRACE.batch.selectedTargetTokenId;
  const targetPosition = candidates[targetIndex];
  const targetOrb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 2), context.palette.target);
  targetOrb.position.copy(targetPosition);
  context.group.add(targetOrb);
  addAnimation(context, targetOrb, "pulse", 1.5, 0.16, 0);

  const targetTray = addTube(
    context.group,
    [new THREE.Vector3(-8.5, -5.0, 7.0), new THREE.Vector3(-7.3, -2.8, 3.8), targetPosition],
    0.15,
    context.palette.target,
  );
  addAnimation(context, targetTray, "pulse", 1.05, 0.04, 0.4);
  addTube(
    context.group,
    [targetPosition, new THREE.Vector3(0, 0, -3.2), new THREE.Vector3(0, 0, -7.2)],
    0.18,
    context.palette.target,
  );
  label(context, "TARGET: sat (ID 5)", targetPosition.clone().add(new THREE.Vector3(0, 1.4, 0)), {
    width: 3.1,
    compact: true,
    color: "#ffd166",
  });
  label(context, "p(sat) = 0.28", new THREE.Vector3(0, 3.8, -3.2), {
    width: 3.0,
    tier: "math",
    compact: true,
    color: "#ffd166",
  });
  label(context, "ANSWERS ARRIVE ONLY AFTER PREDICTIONS", new THREE.Vector3(0, -5.0, -2.4), {
    width: 6.2,
    tier: "structure",
    compact: true,
  });
}

function buildLossChamber(context: BuildContext) {
  addStationHeading(context, `−mean(log p_correct) = ${SELECTED_TRACE.output.meanLoss.toFixed(9)}`);
  addShell(context, new THREE.Vector3(20, 15, 21), new THREE.Vector3(0, 0, -1));
  const losses = SELECTED_TRACE.output.perTokenLosses.flat();
  const pillars: THREE.Vector3[] = [];
  const scales: THREE.Vector3[] = [];
  losses.forEach((loss, index) => {
    const row = Math.floor(index / 6);
    const column = index % 6;
    pillars.push(new THREE.Vector3((column - 2.5) * 1.55, -4.4 + loss, 3.8 - row * 2.4));
    scales.push(new THREE.Vector3(1, loss * 2, 1));
  });
  const lossMesh = addInstancedBoxes(
    context.group,
    pillars,
    new THREE.Vector3(0.92, 1, 0.92),
    context.palette.target,
    undefined,
    scales,
  );
  addAnimation(context, lossMesh, "pulse", 0.7, 0.028, 0.2);
  pillars.forEach((position) => {
    addTube(
      context.group,
      [position.clone().setY(-2.4), new THREE.Vector3(position.x * 0.3, -1.0, 0), new THREE.Vector3(0, 0, -4.5)],
      0.045,
      context.palette.target,
    );
  });
  const lossCore = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 3), context.palette.target);
  lossCore.position.set(0, 0, -5.2);
  context.group.add(lossCore);
  addAnimation(context, lossCore, "pulse", 1.8, 0.22, 0);
  const rings = [1.65, 2.2, 2.8].map((radius, index) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.055, 8, 56), context.palette.target);
    ring.position.copy(lossCore.position);
    ring.rotation.set(index * 0.62, index * 0.88, 0);
    context.group.add(ring);
    addAnimation(context, ring, "spin", (index % 2 ? -1 : 1) * (0.22 + index * 0.08), 1, index);
    return ring;
  });
  void rings;
  label(context, "12 TOKEN LOSSES", new THREE.Vector3(0, 4.8, 3.2), {
    width: 3.5,
    tier: "structure",
    compact: true,
  });
  label(context, `SCALAR L = ${SELECTED_TRACE.output.meanLoss.toFixed(9)}`, new THREE.Vector3(0, 3.3, -5.2), {
    width: 4.5,
    compact: true,
    color: "#ffd166",
  });
  label(context, "PARAMETERS STILL UNCHANGED", new THREE.Vector3(0, -4.8, -5.0), {
    width: 4.9,
    tier: "structure",
    compact: true,
  });
}

function buildOutputBackprop(context: BuildContext) {
  addStationHeading(context, "dlogits → dH_final  +  dW_vocab");
  addShell(context, new THREE.Vector3(22, 16, 22), new THREE.Vector3(0, 0, -1));
  const backward = context.palette.warm;
  const gradientPositions: THREE.Vector3[] = [];
  for (let index = 0; index < 32; index += 1) {
    gradientPositions.push(
      new THREE.Vector3(
        ((index % 8) - 3.5) * 1.15,
        (Math.floor(index / 8) - 1.5) * 1.25,
        -6.0 + (index % 3) * 0.3,
      ),
    );
  }
  const gradientMesh = addInstancedSpheres(context.group, gradientPositions, 0.16, backward);
  addAnimation(context, gradientMesh, "travel-z", -1.0, 0.8, 0.2);

  const wall = new THREE.Mesh(new THREE.BoxGeometry(12.5, 9.2, 0.45), context.palette.structure);
  wall.position.z = -1.4;
  context.group.add(wall);
  const activationPath = addTube(
    context.group,
    [new THREE.Vector3(0, 0, -5.8), new THREE.Vector3(0, 0, -1.1), new THREE.Vector3(-5.8, 2.3, 6.5)],
    0.22,
    backward,
  );
  const parameterPath = addTube(
    context.group,
    [new THREE.Vector3(0, 0, -1.1), new THREE.Vector3(5.8, -2.3, 3.5), new THREE.Vector3(7.6, -2.3, 6.5)],
    0.22,
    context.palette.target,
  );
  addAnimation(context, activationPath, "pulse", 1.0, 0.04, 0);
  addAnimation(context, parameterPath, "pulse", 1.0, 0.04, Math.PI);
  label(context, "INPUT GRADIENT  dH", new THREE.Vector3(-5.5, 4.5, 4.5), {
    width: 3.6,
    tier: "structure",
    compact: true,
    color: "#ff765f",
  });
  label(context, "PARAMETER GRADIENT  dW_vocab", new THREE.Vector3(5.5, -4.3, 4.5), {
    width: 5.0,
    tier: "structure",
    compact: true,
    color: "#ffd166",
  });
  label(context, "GRADIENT ≠ UPDATE", new THREE.Vector3(0, 5.1, -1.4), {
    width: 3.6,
    compact: true,
    color: "#ff765f",
  });
}

function buildBackpropTower(context: BuildContext) {
  addStationHeading(context, "same graph · reverse-mode chain rule");
  addShell(context, new THREE.Vector3(22, 18, 22), new THREE.Vector3(0, 0, -1));
  const activationMaterial = branchMaterial(context, "left", context.palette.warm);
  const parameterMaterial = branchMaterial(context, "right", context.palette.target);
  const floors: THREE.Vector3[] = [];
  for (let layer = 0; layer < 20; layer += 1) {
    floors.push(new THREE.Vector3(Math.sin(layer * 0.63) * 3.0, -6.5 + layer * 0.68, Math.cos(layer * 0.63) * 1.4));
  }
  const floorMaterial = context.palette.structure.clone();
  floorMaterial.color.set("#29131d");
  floorMaterial.emissive.set("#ff486f");
  floorMaterial.emissiveIntensity = 0.3;
  floorMaterial.opacity = 0.42;
  floorMaterial.depthWrite = false;
  context.phaseMaterials.push(floorMaterial);
  addInstancedBoxes(
    context.group,
    floors,
    new THREE.Vector3(4.8, 0.18, 2.7),
    floorMaterial,
  );
  const reversePackets = addInstancedSpheres(context.group, floors.map((point) => point.clone().add(new THREE.Vector3(0, 0.45, 0))), 0.19, activationMaterial);
  addAnimation(context, reversePackets, "bob", 1.15, 0.24, 0.5);
  for (let branch = 0; branch < 9; branch += 1) {
    const y = 5.2 - branch * 1.4;
    addTube(
      context.group,
      [new THREE.Vector3(0, y, 0), new THREE.Vector3(-4.5, y - 0.3, 2.3), new THREE.Vector3(-6.5, y - 0.3, 4.3)],
      0.075,
      activationMaterial,
    );
    addTube(
      context.group,
      [new THREE.Vector3(0, y, 0), new THREE.Vector3(4.5, y - 0.3, 2.3), new THREE.Vector3(6.5, y - 0.3, 4.3)],
      0.075,
      parameterMaterial,
    );
  }
  label(context, "Q: ACTIVATION GRADIENTS CONTINUE", new THREE.Vector3(-4.8, -5.0, 4.4), {
    branch: "left",
    width: 5.3,
    compact: true,
    color: "#ff765f",
  });
  label(context, "E: PARAMETER GRADIENTS COLLECT", new THREE.Vector3(4.8, -5.0, 4.4), {
    branch: "right",
    width: 5.3,
    compact: true,
    color: "#ffd166",
  });
  label(context, "RESIDUAL ADD SENDS FULL dL TO BOTH INPUTS", new THREE.Vector3(0, 6.2, -2.3), {
    width: 6.7,
    tier: "structure",
    compact: true,
  });
}

function buildParameterMatrix(context: BuildContext) {
  const optimizer = SELECTED_TRACE.optimizer;
  addStationHeading(context, `w=${optimizer.weightBefore.toFixed(4)} · ∂L/∂w=${optimizer.gradient.toFixed(4)}`);
  addShell(context, new THREE.Vector3(20, 15, 21), new THREE.Vector3(0, 0, -1));
  const grid = addMatrixGrid(
    context,
    8,
    8,
    new THREE.Vector3(0, -4.0, -1.0),
    1.05,
    0.88,
    (row, column) => (row === 3 && column === 6 ? 1.65 : 0.25 + Math.abs(Math.sin(row * 2.1 + column * 0.7)) * 0.42),
    (row, column) =>
      row === 3 && column === 6
        ? new THREE.Color("#ffd166")
        : context.palette.dark.clone().lerp(context.palette.phaseBase, 0.34 + ((row + column) % 4) * 0.1),
  );
  addAnimation(context, grid, "pulse", 0.58, 0.02, 0.4);
  const selectedX = (6 - 3.5) * 1.05;
  const selectedZ = -1.0 + (3 - 3.5) * 1.05;
  const selector = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.11, 10, 40), context.palette.target);
  selector.rotation.x = Math.PI / 2;
  selector.position.set(selectedX, -2.0, selectedZ);
  context.group.add(selector);
  addAnimation(context, selector, "spin", 0.75, 1, 0);
  const magnified = new THREE.Mesh(new THREE.BoxGeometry(4.3, 4.3, 0.65), context.palette.structure);
  magnified.position.set(-5.5, 2.1, 1.4);
  context.group.add(magnified);
  addTube(
    context.group,
    [new THREE.Vector3(selectedX, -2.0, selectedZ), new THREE.Vector3(-1.0, 0, 0), magnified.position],
    0.07,
    context.palette.target,
  );
  label(context, optimizer.parameterName, new THREE.Vector3(-5.5, 5.0, 1.4), {
    width: 5.1,
    tier: "structure",
    compact: true,
  });
  label(context, `weight  ${optimizer.weightBefore.toFixed(4)}`, new THREE.Vector3(-5.5, 2.8, 1.75), {
    width: 3.1,
    tier: "math",
    compact: true,
  });
  label(context, `gradient  ${optimizer.gradient.toFixed(4)}`, new THREE.Vector3(-5.5, 1.3, 1.75), {
    width: 3.3,
    tier: "math",
    compact: true,
    color: "#ff765f",
  });
  label(context, "THE GRADIENT IS LOCAL SENSITIVITY", new THREE.Vector3(2.0, 5.2, -3.2), {
    width: 5.6,
    tier: "structure",
    compact: true,
  });
}

function buildAdamW(context: BuildContext) {
  const optimizer = SELECTED_TRACE.optimizer;
  addStationHeading(context, "gradient + history + learning rate + decay → Δw");
  addShell(context, new THREE.Vector3(20, 16, 21), new THREE.Vector3(0, 0, -1));
  const simpleMaterial = branchMaterial(context, "left", context.palette.active);
  const fullMaterial = branchMaterial(context, "right", context.palette.signal);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 2), context.palette.active);
  context.group.add(core);
  addAnimation(context, core, "pulse", 1.35, 0.13, 0);
  const orbitValues = [
    { name: "g", value: optimizer.gradient.toFixed(4), radius: 2.4, speed: 0.72 },
    { name: "m", value: optimizer.momentAfter.toExponential(2), radius: 3.6, speed: -0.48 },
    { name: "v", value: optimizer.varianceAfter.toExponential(2), radius: 4.8, speed: 0.3 },
  ];
  orbitValues.forEach((entry, index) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(entry.radius, 0.055, 8, 72), fullMaterial);
    ring.rotation.set(index * 0.7, index * 0.45, 0);
    context.group.add(ring);
    addAnimation(context, ring, "spin", entry.speed, 1, index);
    const satellite = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), fullMaterial);
    satellite.position.set(entry.radius, 0, 0);
    ring.add(satellite);
    label(context, `${entry.name} = ${entry.value}`, new THREE.Vector3(5.9, 3.8 - index * 1.4, 0.6), {
      branch: "right",
      width: 3.6,
      tier: "math",
      compact: true,
    });
  });
  const controls: THREE.Vector3[] = [
    new THREE.Vector3(-6.2, 3.0, 0),
    new THREE.Vector3(-6.2, 0, 0),
    new THREE.Vector3(-6.2, -3.0, 0),
  ];
  const knobs = addInstancedSpheres(context.group, controls, 0.65, simpleMaterial);
  addAnimation(context, knobs, "pulse", 0.9, 0.06, 0.3);
  label(context, "gradient", controls[0].clone().add(new THREE.Vector3(0, 1.1, 0)), {
    branch: "left",
    width: 2.5,
    compact: true,
  });
  label(context, `lr ${optimizer.learningRate}`, controls[1].clone().add(new THREE.Vector3(0, 1.1, 0)), {
    branch: "left",
    width: 2.5,
    compact: true,
  });
  label(context, `decay ${optimizer.weightDecay}`, controls[2].clone().add(new THREE.Vector3(0, 1.1, 0)), {
    branch: "left",
    width: 2.7,
    compact: true,
  });
  const output = new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 1), context.palette.target);
  output.position.set(0, 0, -7.0);
  context.group.add(output);
  addAnimation(context, output, "pulse", 1.6, 0.16, 0);
  addTube(context.group, [new THREE.Vector3(0, 0, -1), output.position], 0.16, context.palette.target);
  label(context, `Δw = +${optimizer.deltaWeight.toFixed(12)}`, new THREE.Vector3(0, 2.0, -7.0), {
    width: 4.4,
    compact: true,
    color: "#b8ff75",
  });
}

function buildWeightUpdate(context: BuildContext) {
  const optimizer = SELECTED_TRACE.optimizer;
  addStationHeading(context, `${optimizer.weightBefore.toFixed(6)} → ${optimizer.weightAfter.toFixed(12)}`);
  addShell(context, new THREE.Vector3(20, 15, 21), new THREE.Vector3(0, 0, -1));
  const oldMaterial = context.palette.structure.clone();
  oldMaterial.opacity = 0.46;
  oldMaterial.depthWrite = false;
  const newMaterial = context.palette.active.clone();
  newMaterial.opacity = 0.48;
  newMaterial.depthWrite = false;
  newMaterial.emissiveIntensity = 0.22;
  const oldCell = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.2, 0.85), oldMaterial);
  oldCell.position.set(-3.2, 0, 1.2);
  context.group.add(oldCell);
  const newCell = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.2, 0.85), newMaterial);
  newCell.position.set(3.2, 0, -1.6);
  context.group.add(newCell);
  addAnimation(context, newCell, "pulse", 1.35, 0.14, 0);
  const updatedCore = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 1.05, 1.0),
    context.palette.signal,
  );
  updatedCore.position.copy(newCell.position).add(new THREE.Vector3(0, 0, 0.12));
  context.group.add(updatedCore);
  addAnimation(context, updatedCore, "pulse", 1.8, 0.12, 0.4);
  const updateFlow = addTube(
    context.group,
    [oldCell.position, new THREE.Vector3(0, 0, -0.3), newCell.position],
    0.14,
    context.palette.signal,
  );
  addAnimation(context, updateFlow, "pulse", 1.5, 0.06, 0);
  for (let ringIndex = 0; ringIndex < 5; ringIndex += 1) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.85 + ringIndex * 0.42, 0.04, 8, 48),
      context.palette.signal,
    );
    ring.position.copy(newCell.position).add(new THREE.Vector3(0, 0, 0.7));
    ring.rotation.set(ringIndex * 0.22, ringIndex * 0.31, 0);
    context.group.add(ring);
    addAnimation(context, ring, "spin", (ringIndex % 2 ? -1 : 1) * (0.22 + ringIndex * 0.04), 1, ringIndex);
  }
  label(context, `OLD  ${optimizer.weightBefore.toFixed(6)}`, new THREE.Vector3(-3.2, 2.55, 1.2), {
    width: 3.4,
    compact: true,
  });
  label(context, `NEW  ${optimizer.weightAfter.toFixed(12)}`, new THREE.Vector3(3.2, 2.55, -1.6), {
    width: 4.4,
    compact: true,
    color: "#b8ff75",
  });
  label(context, "ONLY NOW DOES A PARAMETER CHANGE", new THREE.Vector3(0, -3.55, -0.4), {
    width: 5.7,
    tier: "structure",
    compact: true,
  });
}

function buildNextStep(context: BuildContext) {
  addStationHeading(context, "updated model → next batch → repeat");
  addShell(context, new THREE.Vector3(22, 17, 22), new THREE.Vector3(0, 0, -1));
  const model = new THREE.Group();
  const floors: THREE.Vector3[] = [];
  for (let index = 0; index < 24; index += 1) {
    floors.push(new THREE.Vector3(0, -5.8 + index * 0.5, 0));
  }
  addInstancedBoxes(model, floors, new THREE.Vector3(7.2, 0.18, 5.0), context.palette.structure);
  const updateBands = Array.from({ length: 32 }, (_, index) =>
    new THREE.Vector3((index % 8 - 3.5) * 0.65, (Math.floor(index / 8) - 1.5) * 1.1, 2.65),
  );
  const bands = addInstancedBoxes(model, updateBands, new THREE.Vector3(0.42, 0.7, 0.12), context.palette.signal);
  addAnimation(context, bands, "pulse", 0.72, 0.05, 0.3);
  model.position.set(2.5, 0, -1.0);
  context.group.add(model);

  const nextBatch = makeTokenPositions(12, new THREE.Vector3(-8.0, -3.2, 6.0), new THREE.Vector3(0.55, 0.4, -0.62));
  const batchMesh = addInstancedBoxes(
    context.group,
    nextBatch,
    new THREE.Vector3(0.5, 0.5, 0.5),
    context.palette.active,
  );
  addAnimation(context, batchMesh, "travel-z", 0.7, 0.62, 0.1);
  addTube(
    context.group,
    [new THREE.Vector3(-8.0, -3.2, 6.0), new THREE.Vector3(-5.0, -1.2, 2.0), new THREE.Vector3(0, 0, -1.0)],
    0.13,
    context.palette.active,
  );
  const loop = new THREE.Mesh(new THREE.TorusGeometry(7.2, 0.1, 10, 96), context.palette.signal);
  loop.rotation.x = Math.PI / 2;
  loop.position.z = -1.0;
  context.group.add(loop);
  addAnimation(context, loop, "spin", 0.1, 1, 0);
  label(context, "STEP 1 COMPLETE", new THREE.Vector3(2.5, 6.7, -1.0), {
    width: 3.7,
    compact: true,
    color: "#b8ff75",
  });
  label(context, "SAME ARCHITECTURE · SLIGHTLY DIFFERENT PARAMETERS", new THREE.Vector3(0, -6.7, -2.0), {
    width: 7.1,
    tier: "structure",
    compact: true,
  });
}

const STATION_BUILDERS: Array<
  (context: BuildContext) => void | StationUpdater
> = [
  buildTrainingComplex,
  buildCorpus,
  buildTokenStream,
  buildBatchPlatform,
  buildEmbeddingHall,
  buildTransformerTower,
  buildTransformerBlock,
  buildMultiHeadHall,
  buildAttentionHead,
  buildScoreArena,
  buildCausalMask,
  buildSoftmaxValueMix,
  buildHeadRecombination,
  buildMLP,
  buildFinalHidden,
  buildVocabularyProjection,
  buildLogitsLandscape,
  buildTargetComparison,
  buildLossChamber,
  buildOutputBackprop,
  buildBackpropTower,
  buildParameterMatrix,
  buildAdamW,
  buildWeightUpdate,
  buildNextStep,
];

type DistinctChamberShellSpec = {
  size: readonly [number, number, number];
  position: readonly [number, number, number];
  spatialStyle:
    | "panorama"
    | "rail-gantry"
    | "vertical-foundry"
    | "split-wing"
    | "microscope"
    | "observatory";
  exhibitScale: number;
  exhibitPosition: readonly [number, number, number];
  guidedView: {
    distance: number;
    focusY: number;
    fov: number;
  };
};

/**
 * The bespoke process builders own every non-Corpus chamber interior. These
 * specs give every process a large, volumetric room while preserving its own
 * spatial grammar. The process itself lives in a separately transformed group,
 * so shell and navigation geometry never inherit exhibit scaling.
 */
const DISTINCT_CHAMBER_SHELL_SPECS = {
  "training-complex": {
    size: [58, 56, 60], position: [0, 0, 0], spatialStyle: "panorama",
    exhibitScale: 1.2, exhibitPosition: [0, 1.2, -2.5],
    guidedView: { distance: 24, focusY: 5, fov: 62 },
  },
  "token-stream-context": {
    size: [52, 50, 62], position: [0, 0, 0], spatialStyle: "rail-gantry",
    exhibitScale: 1.22, exhibitPosition: [0, 1.1, -2.5],
    guidedView: { distance: 23, focusY: 2.5, fov: 58 },
  },
  "batch-shifted-targets": {
    size: [52, 50, 58], position: [0, 0, 0], spatialStyle: "rail-gantry",
    exhibitScale: 1.22, exhibitPosition: [0, 1.1, -2],
    guidedView: { distance: 23, focusY: 2.5, fov: 58 },
  },
  "embedding": {
    size: [56, 54, 60], position: [0, 0, 0], spatialStyle: "rail-gantry",
    exhibitScale: 1.2, exhibitPosition: [0, 1.2, -2.4],
    guidedView: { distance: 24, focusY: 3, fov: 59 },
  },
  "transformer-tower": {
    size: [50, 68, 58], position: [0, 0, 0], spatialStyle: "vertical-foundry",
    exhibitScale: 1.2, exhibitPosition: [0, 3, -2],
    guidedView: { distance: 24, focusY: 7, fov: 62 },
  },
  "transformer-block": {
    size: [58, 56, 60], position: [0, 0, 0], spatialStyle: "split-wing",
    exhibitScale: 1.2, exhibitPosition: [0, 1.5, -2.4],
    guidedView: { distance: 24, focusY: 3.5, fov: 60 },
  },
  "multi-head-attention": {
    size: [60, 56, 60], position: [0, 0, 0], spatialStyle: "split-wing",
    exhibitScale: 1.2, exhibitPosition: [0, 1.5, -2.4],
    guidedView: { distance: 24, focusY: 3.5, fov: 60 },
  },
  "one-head-qkv": {
    size: [52, 52, 58], position: [0, 0, 0], spatialStyle: "observatory",
    exhibitScale: 1.22, exhibitPosition: [0, 1.2, -2],
    guidedView: { distance: 23, focusY: 3, fov: 58 },
  },
  "attention-scores": {
    size: [50, 52, 58], position: [0, 0, 0], spatialStyle: "microscope",
    exhibitScale: 1.24, exhibitPosition: [0, 1.2, -2],
    guidedView: { distance: 22, focusY: 2, fov: 54 },
  },
  "causal-mask": {
    size: [50, 52, 58], position: [0, 0, 0], spatialStyle: "microscope",
    exhibitScale: 1.24, exhibitPosition: [0, 1.2, -2],
    guidedView: { distance: 22, focusY: 2, fov: 54 },
  },
  "softmax-weighted-v": {
    size: [54, 54, 60], position: [0, 0, 0], spatialStyle: "observatory",
    exhibitScale: 1.2, exhibitPosition: [0, 1.3, -2.2],
    guidedView: { distance: 23, focusY: 3, fov: 58 },
  },
  "head-recombination": {
    size: [56, 56, 60], position: [0, 0, 0], spatialStyle: "split-wing",
    exhibitScale: 1.2, exhibitPosition: [0, 1.5, -2.3],
    guidedView: { distance: 24, focusY: 3.5, fov: 60 },
  },
  "mlp": {
    size: [54, 54, 64], position: [0, 0, 0], spatialStyle: "rail-gantry",
    exhibitScale: 1.2, exhibitPosition: [0, 1.2, -3],
    guidedView: { distance: 24, focusY: 3, fov: 58 },
  },
  "final-hidden-state": {
    size: [52, 52, 58], position: [0, 0, 0], spatialStyle: "observatory",
    exhibitScale: 1.22, exhibitPosition: [0, 1.2, -2],
    guidedView: { distance: 23, focusY: 3, fov: 58 },
  },
  "vocabulary-projection": {
    size: [56, 56, 60], position: [0, 0, 0], spatialStyle: "observatory",
    exhibitScale: 1.2, exhibitPosition: [0, 1.5, -2.4],
    guidedView: { distance: 24, focusY: 3.5, fov: 59 },
  },
  "logits": {
    size: [56, 56, 58], position: [0, 0, 0], spatialStyle: "observatory",
    exhibitScale: 1.2, exhibitPosition: [0, 1.4, -2],
    guidedView: { distance: 23, focusY: 3.2, fov: 59 },
  },
  "target-comparison": {
    size: [52, 54, 60], position: [0, 0, 0], spatialStyle: "observatory",
    exhibitScale: 1.22, exhibitPosition: [0, 1.4, -2.4],
    guidedView: { distance: 23, focusY: 3.2, fov: 58 },
  },
  "loss": {
    size: [54, 66, 60], position: [0, 0, 0], spatialStyle: "vertical-foundry",
    exhibitScale: 1.2, exhibitPosition: [0, 2.2, -2.4],
    guidedView: { distance: 24, focusY: 6, fov: 62 },
  },
  "output-backprop": {
    size: [56, 58, 60], position: [0, 0, 0], spatialStyle: "split-wing",
    exhibitScale: 1.2, exhibitPosition: [0, 1.7, -2.4],
    guidedView: { distance: 24, focusY: 4, fov: 60 },
  },
  "backprop-through-tower": {
    size: [52, 70, 58], position: [0, 0, 0], spatialStyle: "vertical-foundry",
    exhibitScale: 1.18, exhibitPosition: [0, 3.2, -2],
    guidedView: { distance: 24, focusY: 7.5, fov: 62 },
  },
  "parameter-matrix": {
    size: [50, 52, 56], position: [0, 0, 0], spatialStyle: "microscope",
    exhibitScale: 1.26, exhibitPosition: [0, 1.2, -1.8],
    guidedView: { distance: 22, focusY: 2.2, fov: 54 },
  },
  "adamw-state": {
    size: [52, 56, 62], position: [0, 0, 0], spatialStyle: "rail-gantry",
    exhibitScale: 1.22, exhibitPosition: [0, 1.5, -2.8],
    guidedView: { distance: 23, focusY: 3.5, fov: 58 },
  },
  "weight-update": {
    size: [50, 52, 56], position: [0, 0, 0], spatialStyle: "microscope",
    exhibitScale: 1.26, exhibitPosition: [0, 1.2, -1.8],
    guidedView: { distance: 22, focusY: 2.2, fov: 54 },
  },
  "model-changed-next-step": {
    size: [58, 66, 60], position: [0, 0, 0], spatialStyle: "panorama",
    exhibitScale: 1.2, exhibitPosition: [0, 2.5, -2.5],
    guidedView: { distance: 24, focusY: 6, fov: 62 },
  },
} as const satisfies Readonly<Record<string, DistinctChamberShellSpec>>;

function buildDistinctChamberShell(context: BuildContext) {
  const spec =
    DISTINCT_CHAMBER_SHELL_SPECS[
      context.station.id as keyof typeof DISTINCT_CHAMBER_SHELL_SPECS
    ];
  if (!spec) {
    throw new Error(`Missing distinct chamber shell spec for ${context.station.id}`);
  }
  addShell(
    context,
    new THREE.Vector3(...spec.size),
    new THREE.Vector3(...spec.position),
    new THREE.Euler(),
    spec.guidedView,
  );

  // Every exhibit stands on a museum dais: a low polished cylinder with a
  // bright neon rim, so components present like the pedestal displays in the
  // reference image.
  const daisRadius = 9.6 * spec.exhibitScale * 0.92;
  const daisCenter = new THREE.Vector3(
    spec.exhibitPosition[0],
    -4.62,
    spec.exhibitPosition[2],
  );
  const dais = new THREE.Mesh(
    new THREE.CylinderGeometry(daisRadius, daisRadius * 1.045, 0.3, 64),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color("#aab4c1").lerp(context.palette.phaseBase, 0.04),
      map: getMarbleTexture(1.5, 1.5),
      roughness: 0.3,
      metalness: 0.1,
      normalMap: getSurfaceReliefTexture("floor"),
      normalScale: new THREE.Vector2(0.1, 0.1),
      emissive: context.palette.dark,
      emissiveIntensity: 0.07,
    }),
  );
  dais.position.copy(daisCenter);
  context.group.add(dais);
  const daisShadow = new THREE.Mesh(
    new THREE.CircleGeometry(daisRadius * 1.55, 48),
    new THREE.MeshBasicMaterial({
      map: getContactShadowTexture(),
      color: "#000000",
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    }),
  );
  daisShadow.rotation.x = -Math.PI / 2;
  daisShadow.position.set(daisCenter.x, -4.672, daisCenter.z);
  daisShadow.renderOrder = 1;
  context.group.add(daisShadow);

  if (context.navigationBounds) {
    const blockerHalfWidth = 9.6 * spec.exhibitScale + 0.8;
    const blockerHalfDepth = 8.8 * spec.exhibitScale + 0.8;
    const blockerMaxY = spec.exhibitPosition[1] + 7.2 * spec.exhibitScale + 0.8;
    // Leave a central walkway straight through the exhibit, matching the
    // corpus-data-prep chamber's gap between its stage platforms: visitors
    // can pass right through the matrix display instead of detouring
    // around the whole dais to reach the far tunnel.
    const passageHalfWidth = Math.min(
      CORRIDOR_WALKABLE_HALF_WIDTH,
      blockerHalfWidth - 1.2,
    );
    const gapMinX = spec.exhibitPosition[0] - passageHalfWidth;
    const gapMaxX = spec.exhibitPosition[0] + passageHalfWidth;
    context.navigationBounds.blockers = [
      {
        minX: spec.exhibitPosition[0] - blockerHalfWidth,
        maxX: gapMinX,
        minY: -4.7,
        maxY: blockerMaxY,
        minZ: spec.exhibitPosition[2] - blockerHalfDepth,
        maxZ: spec.exhibitPosition[2] + blockerHalfDepth,
      },
      {
        minX: gapMaxX,
        maxX: spec.exhibitPosition[0] + blockerHalfWidth,
        minY: -4.7,
        maxY: blockerMaxY,
        minZ: spec.exhibitPosition[2] - blockerHalfDepth,
        maxZ: spec.exhibitPosition[2] + blockerHalfDepth,
      },
    ];
  }
  return spec;
}

function createCameraRoute(stationCount: number): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = [];
  let x = 0;
  let y = 0;
  let z = 16;
  for (let index = 0; index < stationCount; index += 1) {
    if (index > 0) {
      const direction = index * 0.61;
      x += Math.sin(direction) * 11.5 + Math.sin(index * 1.37) * 2.2;
      y += Math.cos(direction * 0.79) * 5.8 + Math.sin(index * 0.43) * 1.4;
      z -= STATION_SPACING;
    }
    points.push(new THREE.Vector3(x, y, z));
  }
  return new THREE.CatmullRomCurve3(points, false, "centripetal", 0.42);
}

function createCorridorSystem(
  route: THREE.CatmullRomCurve3,
  stationRuntimes: readonly StationRuntime[],
): THREE.Group {
  const corridor = new THREE.Group();
  corridor.name = "enclosed-station-corridors";
  const gapCount = Math.max(0, stationRuntimes.length - 1);
  const modulesPerGap = 6;
  const moduleCount = gapCount * modulesPerGap;
  const corridorWidth = CORRIDOR_WIDTH;
  const corridorHeight = 9.4;
  const slabThickness = 0.34;
  const baseGeometry = new THREE.BoxGeometry(1, 1, 1);
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: "#141820",
    roughness: 0.64,
    metalness: 0.28,
    normalMap: getSurfaceReliefTexture("wall"),
    normalScale: new THREE.Vector2(0.2, 0.2),
    emissive: "#16202e",
    emissiveIntensity: 0.24,
    side: THREE.DoubleSide,
  });
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: "#0e1116",
    roughness: 0.44,
    metalness: 0.5,
    normalMap: getSurfaceReliefTexture("floor"),
    normalScale: new THREE.Vector2(0.12, 0.12),
    emissive: "#141c28",
    emissiveIntensity: 0.2,
    side: THREE.DoubleSide,
  });
  const stripMaterial = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const floors = new THREE.InstancedMesh(baseGeometry, floorMaterial, moduleCount);
  const ceilings = new THREE.InstancedMesh(baseGeometry, wallMaterial, moduleCount);
  const leftWalls = new THREE.InstancedMesh(baseGeometry, wallMaterial, moduleCount);
  const rightWalls = new THREE.InstancedMesh(baseGeometry, wallMaterial, moduleCount);
  const strips = new THREE.InstancedMesh(baseGeometry, stripMaterial, moduleCount * 3);
  floors.name = "corridor-floors";
  ceilings.name = "corridor-ceilings";
  leftWalls.name = "corridor-left-walls";
  rightWalls.name = "corridor-right-walls";
  strips.name = "corridor-guide-lights";

  const stationDenominator = Math.max(1, stationRuntimes.length - 1);
  const routeLength = route.getLength();
  const pointA = new THREE.Vector3();
  const pointB = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const surfacePosition = new THREE.Vector3();
  const lookMatrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const dummy = new THREE.Object3D();

  const setInstance = (
    mesh: THREE.InstancedMesh,
    index: number,
    worldPosition: THREE.Vector3,
    scale: THREE.Vector3,
  ) => {
    dummy.position.copy(worldPosition);
    dummy.quaternion.copy(quaternion);
    dummy.scale.copy(scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  };

  let moduleIndex = 0;
  let stripIndex = 0;
  for (let gapIndex = 0; gapIndex < gapCount; gapIndex += 1) {
    const destinationColor = phaseColor(TRAINING_STATIONS[gapIndex + 1].phase);
    const fromBounds = stationRuntimes[gapIndex].navigationBounds;
    const toBounds = stationRuntimes[gapIndex + 1].navigationBounds;
    const corridorStartProgress =
      gapIndex / stationDenominator + -fromBounds.minZ / routeLength;
    const corridorEndProgress =
      (gapIndex + 1) / stationDenominator - toBounds.maxZ / routeLength;
    if (corridorEndProgress <= corridorStartProgress) {
      throw new Error(
        `Chambers ${gapIndex} and ${gapIndex + 1} overlap the connecting corridor`,
      );
    }
    for (let segment = 0; segment < modulesPerGap; segment += 1) {
      const startProgress = THREE.MathUtils.lerp(
        corridorStartProgress,
        corridorEndProgress,
        segment / modulesPerGap,
      );
      const endProgress = THREE.MathUtils.lerp(
        corridorStartProgress,
        corridorEndProgress,
        (segment + 1) / modulesPerGap,
      );
      const middleProgress = (startProgress + endProgress) / 2;
      route.getPointAt(startProgress, pointA);
      route.getPointAt(endProgress, pointB);
      midpoint.copy(pointA).add(pointB).multiplyScalar(0.5);
      route.getTangentAt(middleProgress, tangent).normalize();
      right.crossVectors(tangent, WORLD_UP).normalize();
      up.crossVectors(right, tangent).normalize();
      lookMatrix.lookAt(midpoint, midpoint.clone().add(tangent), WORLD_UP);
      quaternion.setFromRotationMatrix(lookMatrix);
      const segmentLength = pointA.distanceTo(pointB) + 0.9;

      surfacePosition.copy(midpoint).addScaledVector(up, -corridorHeight / 2);
      setInstance(
        floors,
        moduleIndex,
        surfacePosition,
        new THREE.Vector3(corridorWidth, slabThickness, segmentLength),
      );
      surfacePosition.copy(midpoint).addScaledVector(up, corridorHeight / 2);
      setInstance(
        ceilings,
        moduleIndex,
        surfacePosition,
        new THREE.Vector3(corridorWidth, slabThickness, segmentLength),
      );
      surfacePosition.copy(midpoint).addScaledVector(right, -corridorWidth / 2);
      setInstance(
        leftWalls,
        moduleIndex,
        surfacePosition,
        new THREE.Vector3(slabThickness, corridorHeight, segmentLength),
      );
      surfacePosition.copy(midpoint).addScaledVector(right, corridorWidth / 2);
      setInstance(
        rightWalls,
        moduleIndex,
        surfacePosition,
        new THREE.Vector3(slabThickness, corridorHeight, segmentLength),
      );

      for (const side of [-1, 1]) {
        surfacePosition
          .copy(midpoint)
          .addScaledVector(up, -corridorHeight / 2 + 0.2)
          .addScaledVector(right, side * (corridorWidth / 2 - 0.58));
        setInstance(
          strips,
          stripIndex,
          surfacePosition,
          new THREE.Vector3(0.09, 0.07, segmentLength),
        );
        strips.setColorAt(stripIndex, destinationColor);
        stripIndex += 1;
      }
      surfacePosition
        .copy(midpoint)
        .addScaledVector(up, corridorHeight / 2 - 0.2);
      setInstance(
        strips,
        stripIndex,
        surfacePosition,
        new THREE.Vector3(corridorWidth - 1.0, 0.06, 0.15),
      );
      strips.setColorAt(stripIndex, destinationColor);
      stripIndex += 1;
      moduleIndex += 1;
    }
  }

  for (const mesh of [floors, ceilings, leftWalls, rightWalls, strips]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    corridor.add(mesh);
  }
  if (strips.instanceColor) strips.instanceColor.needsUpdate = true;
  return corridor;
}

function createRouteBeacon() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const paint = canvas.getContext("2d");
  if (paint) {
    const gradient = paint.createRadialGradient(32, 32, 0, 32, 32, 31);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.18, "rgba(255,255,255,0.72)");
    gradient.addColorStop(0.52, "rgba(255,255,255,0.16)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    paint.fillStyle = gradient;
    paint.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: FALLBACK_PHASE_COLORS.forward,
    transparent: true,
    opacity: 0.34,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(0.5);
  const light = new THREE.PointLight(FALLBACK_PHASE_COLORS.forward, 0.7, 8, 2);
  const group = new THREE.Group();
  group.name = "single-route-beacon";
  group.add(sprite, light);
  return { group, sprite, material, light };
}

function createAssistantTargetReticle() {
  const group = new THREE.Group();
  group.name = "assistant-target-reticle";
  group.userData.assistantNonInteractive = true;

  const material = new THREE.MeshBasicMaterial({
    color: "#6effe9",
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.27, 48), material);
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(0.045, 24),
    material.clone(),
  );
  core.position.z = 0.004;
  group.add(ring, core);
  group.visible = false;
  return { group, material };
}

/** Render-order bands that keep spotlight content above the dimming veil. */
const FOCUS_VEIL_RENDER_ORDER = 8000;
const FOCUS_STAGE_RENDER_ORDER = 8100;
const FOCUS_AVATAR_RENDER_ORDER = 8200;
const FOCUS_LASER_RENDER_ORDER = 8300;
const FOCUS_STAGE_DISTANCE = 2.7;
const FOCUS_VEIL_DISTANCE = 0.7;

/**
 * The visitor's laser pointer: a thin additive beam from a hand-height offset
 * below the camera to the aimed point, with a pulsing dot on the hit surface.
 */
function createLaserPointer() {
  const group = new THREE.Group();
  group.name = "visitor-laser-pointer";
  group.userData.assistantNonInteractive = true;
  group.visible = false;

  const beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: "#ff5f7c",
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: "#ffe3ea",
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const beam = new THREE.Mesh(beamGeometry, beamMaterial);
  const core = new THREE.Mesh(beamGeometry, coreMaterial);
  const dotMaterial = new THREE.MeshBasicMaterial({
    color: "#ff8ba0",
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.032, 20, 14), dotMaterial);
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.055, 0.082, 40),
    dotMaterial.clone(),
  );
  group.add(beam, core, dot, halo);
  group.traverse((object) => {
    object.userData.assistantNonInteractive = true;
    object.renderOrder = FOCUS_LASER_RENDER_ORDER;
    object.frustumCulled = false;
  });

  const baseBeamOpacity = beamMaterial.opacity;
  const baseCoreOpacity = coreMaterial.opacity;
  const baseDotOpacity = dotMaterial.opacity;
  const haloMaterial = halo.material as THREE.MeshBasicMaterial;
  const baseHaloOpacity = haloMaterial.opacity;
  /** Scales all beam opacities; used to fade the click flash out. */
  const setIntensity = (intensity: number) => {
    const t = THREE.MathUtils.clamp(intensity, 0, 1);
    beamMaterial.opacity = baseBeamOpacity * t;
    coreMaterial.opacity = baseCoreOpacity * t;
    dotMaterial.opacity = baseDotOpacity * t;
    haloMaterial.opacity = baseHaloOpacity * t;
  };

  const direction = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const alignment = new THREE.Quaternion();
  const setBeam = (
    startWorld: THREE.Vector3,
    endWorld: THREE.Vector3,
    hit: boolean,
    elapsedSeconds: number,
    motionEnabled: boolean,
    cameraQuaternion: THREE.Quaternion,
  ) => {
    direction.copy(endWorld).sub(startWorld);
    const length = Math.max(0.001, direction.length());
    direction.normalize();
    alignment.setFromUnitVectors(WORLD_UP, direction);
    midpoint.copy(startWorld).addScaledVector(direction, length / 2);
    beam.position.copy(midpoint);
    beam.quaternion.copy(alignment);
    beam.scale.set(0.0075, length, 0.0075);
    core.position.copy(midpoint);
    core.quaternion.copy(alignment);
    core.scale.set(0.0028, length, 0.0028);

    const pulse = motionEnabled
      ? 1 + Math.sin(elapsedSeconds * 9.5) * 0.16
      : 1;
    dot.visible = hit;
    halo.visible = hit;
    if (hit) {
      dot.position.copy(endWorld);
      dot.scale.setScalar(pulse);
      halo.position.copy(endWorld);
      halo.quaternion.copy(cameraQuaternion);
      halo.scale.setScalar(pulse);
    }
  };

  return { group, setBeam, setIntensity };
}

/**
 * Full-view dimming plane parented to the camera. It sits in the transparent
 * pass at FOCUS_VEIL_RENDER_ORDER, so spotlighted content with a higher
 * render order stays bright while the rest of the chamber falls back.
 */
function createFocusVeil() {
  const material = new THREE.MeshBasicMaterial({
    color: "#01050c",
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.name = "assistant-focus-veil";
  mesh.userData.assistantNonInteractive = true;
  mesh.position.z = -FOCUS_VEIL_DISTANCE;
  mesh.renderOrder = FOCUS_VEIL_RENDER_ORDER;
  mesh.visible = false;
  mesh.frustumCulled = false;
  return { mesh, material };
}

/** Glowing ring-and-disc pedestal under the spotlighted replica. */
function createFocusPedestal() {
  const group = new THREE.Group();
  group.name = "assistant-focus-pedestal";
  group.userData.assistantNonInteractive = true;
  group.visible = false;

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: "#6effe9",
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.014, 12, 96),
    ringMaterial,
  );
  ring.rotation.x = Math.PI / 2;
  const discMaterial = ringMaterial.clone();
  discMaterial.opacity = 0.09;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.97, 48), discMaterial);
  disc.rotation.x = -Math.PI / 2;
  group.add(ring, disc);
  group.traverse((object) => {
    object.userData.assistantNonInteractive = true;
    object.renderOrder = FOCUS_STAGE_RENDER_ORDER;
  });
  return { group };
}

function orientStationToRoute(
  group: THREE.Group,
  route: THREE.CatmullRomCurve3,
  stationProgress: number,
) {
  const point = route.getPointAt(stationProgress);
  const tangent = route.getTangentAt(stationProgress).normalize();
  const lookMatrix = new THREE.Matrix4().lookAt(point, point.clone().add(tangent), WORLD_UP);
  group.position.copy(point);
  group.quaternion.setFromRotationMatrix(lookMatrix);
}

function buildSemanticWorld(
  scene: THREE.Scene,
  route: THREE.CatmullRomCurve3,
  animations: AnimationRecord[],
  detailObjects: Record<DetailTier, THREE.Object3D[]>,
  branchMaterials: Record<BranchSide, THREE.Material[]>,
): StationRuntime[] {
  if (STATION_BUILDERS.length !== TRAINING_STATIONS.length) {
    throw new Error(
      "Legacy station-builder catalog is out of sync with the training trace",
    );
  }
  return TRAINING_STATIONS.map((station, index) => {
    const group = new THREE.Group();
    group.name = `station-${String(index).padStart(2, "0")}-${station.id}`;
    group.visible = index === 0;
    orientStationToRoute(group, route, index / Math.max(1, TRAINING_STATIONS.length - 1));
    const palette = createPalette(station.phase);
    const phaseMaterials = [palette.active, palette.signal, palette.warm, palette.target];
    const context: BuildContext = {
      station,
      index,
      group,
      palette,
      animations,
      phaseMaterials,
      detailObjects,
      branchMaterials,
    };
    const distinctShellSpec =
      station.id === "corpus-data-preparation"
        ? undefined
        : buildDistinctChamberShell(context);
    const authoredUpdate =
      station.id === "corpus-data-preparation" ? buildCorpus(context) : undefined;
    const processGroup = new THREE.Group();
    processGroup.name = distinctShellSpec
      ? `spacious-${distinctShellSpec.spatialStyle}-exhibit`
      : "corpus-authored-process";
    if (distinctShellSpec) {
      const [exhibitX, exhibitY, exhibitZ] = distinctShellSpec.exhibitPosition;
      processGroup.position.set(exhibitX, exhibitY, exhibitZ);
      processGroup.scale.setScalar(distinctShellSpec.exhibitScale);
      group.add(processGroup);
    }
    const processUpdate = buildDistinctChamberProcess({
      stationId: station.id,
      index,
      group: distinctShellSpec ? processGroup : group,
      palette,
    });
    const update: StationUpdater | undefined =
      typeof authoredUpdate === "function" || processUpdate
        ? (processProgress, elapsed, motionEnabled) => {
            if (typeof authoredUpdate === "function") {
              authoredUpdate(processProgress, elapsed);
            }
            processUpdate?.(processProgress, elapsed, motionEnabled);
          }
        : undefined;
    // Solid standard-material meshes participate in the chamber shadow pass;
    // sprites, lines, and additive glow elements stay excluded.
    group.traverse((child) => {
      const solid = child as THREE.Mesh;
      if (!solid.isMesh) return;
      if (solid.material instanceof THREE.MeshStandardMaterial) {
        solid.castShadow = true;
        solid.receiveShadow = true;
      }
    });
    const lightAnchors: StationLightAnchors = distinctShellSpec
      ? {
          spot: new THREE.Vector3(
            distinctShellSpec.exhibitPosition[0],
            -4.88 + Math.min(distinctShellSpec.size[1] * 0.6, 30),
            distinctShellSpec.exhibitPosition[2] + 6,
          ),
          spotTarget: new THREE.Vector3(
            distinctShellSpec.exhibitPosition[0],
            -4.4,
            distinctShellSpec.exhibitPosition[2],
          ),
          warmA: new THREE.Vector3(
            -distinctShellSpec.size[0] / 2 + 2.4,
            -2.4,
            distinctShellSpec.exhibitPosition[2] +
              distinctShellSpec.size[2] * 0.22,
          ),
          warmB: new THREE.Vector3(
            distinctShellSpec.size[0] / 2 - 2.4,
            -2.4,
            distinctShellSpec.exhibitPosition[2] -
              distinctShellSpec.size[2] * 0.14,
          ),
        }
      : {
          spot: new THREE.Vector3(0, 34, 4),
          spotTarget: new THREE.Vector3(0, -4.5, 4),
          warmA: new THREE.Vector3(-32, -2.4, 24),
          warmB: new THREE.Vector3(32, -2.4, 24),
        };
    scene.add(group);
    return {
      group,
      phaseMaterials,
      lightAnchors,
      navigationBounds: context.navigationBounds ?? {
        minX: -9,
        maxX: 9,
        minY: -3.95,
        maxY: 15,
        minZ: -9,
        maxZ: 9,
        walkY: -2.95,
        spawn: new THREE.Vector3(0, -2.95, 7),
        portalCenterX: 0,
        portalHalfWidth: 3,
        portalMinY: -4.15,
        portalMaxY: 3.95,
        guidedViewDistance: DEFAULT_GUIDED_VIEW_DISTANCE,
        guidedFocusY: 2.2,
        guidedFov: 58,
      },
      update,
    };
  });
}

function applyAnimation(record: AnimationRecord, motionTime: number) {
  const phase = motionTime * record.speed + record.offset;
  switch (record.kind) {
    case "spin":
      record.object.rotation.z = phase;
      break;
    case "pulse": {
      const scalar = 1 + Math.sin(phase * TAU) * record.amplitude;
      record.object.scale.copy(record.baseScale).multiplyScalar(scalar);
      break;
    }
    case "bob":
      record.object.position.y = record.basePosition.y + Math.sin(phase * TAU) * record.amplitude;
      break;
    case "travel-x":
      record.object.position.x = record.basePosition.x + Math.sin(phase * TAU) * record.amplitude;
      break;
    case "travel-z":
      record.object.position.z = record.basePosition.z + Math.sin(phase * TAU) * record.amplitude;
      break;
    default:
      break;
  }
}

function updateDetailVisibility(
  detailObjects: Record<DetailTier, THREE.Object3D[]>,
  mode: DetailMode,
) {
  const showStructure = mode !== "story";
  const showMath = mode === "math";
  detailObjects.structure.forEach((object) => {
    object.visible = showStructure;
  });
  detailObjects.math.forEach((object) => {
    object.visible = showMath;
  });
}

function disposeScene(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (renderable.geometry) geometries.add(renderable.geometry);
    const objectMaterials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : [];
    objectMaterials.forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) textures.add(value);
      });
    });
  });
  textures.forEach((texture) => texture.dispose());
  if (
    contactShadowTexture &&
    textures.has(contactShadowTexture)
  ) {
    contactShadowTexture = null;
  }
  for (const kind of ["wall", "floor"] as const) {
    const texture = surfaceReliefTextures[kind];
    if (texture && textures.has(texture)) surfaceReliefTextures[kind] = null;
  }
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  scene.clear();
}

export function TrainingWorldCanvas({
  progress,
  stationIndex,
  playing,
  dataPrepProgress,
  branchSide,
  detailMode,
  rideMode,
  assistantEnabled,
  assistantStatus,
  assistantAudioActivity,
  assistantTargetId,
  assistantTargetLocked,
  onProgressChange,
  onManualNavigation,
  onNavigationModeChange,
  onMachineRoomCueChange,
  onMovementDiscovered,
  onStationChange,
  onAssistantTargetChange,
  onAssistantFocusChange,
}: TrainingCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);
  const trainingConsoleLinkRef = useRef<HTMLAnchorElement>(null);
  const [interactionHint, setInteractionHint] = useState<"focus" | null>(
    null,
  );
  const [trainingConsoleNearby, setTrainingConsoleNearby] = useState(false);
  const latest = useRef<WorldRefs>({
    progress,
    stationIndex,
    playing,
    dataPrepProgress,
    branchSide,
    detailMode,
    rideMode,
    assistantEnabled,
    assistantStatus,
    assistantAudioActivity,
    assistantTargetId,
    assistantTargetLocked,
    onProgressChange,
    onManualNavigation,
    onNavigationModeChange,
    onMachineRoomCueChange,
    onMovementDiscovered,
    onStationChange,
    onAssistantTargetChange,
    onAssistantFocusChange,
  });

  useEffect(() => {
    latest.current = {
      progress,
      stationIndex,
      playing,
      dataPrepProgress,
      branchSide,
      detailMode,
      rideMode,
      assistantEnabled,
      assistantStatus,
      assistantAudioActivity,
      assistantTargetId,
      assistantTargetLocked,
      onProgressChange,
      onManualNavigation,
      onNavigationModeChange,
      onMachineRoomCueChange,
      onMovementDiscovered,
      onStationChange,
      onAssistantTargetChange,
      onAssistantFocusChange,
    };
  }, [
    assistantAudioActivity,
    assistantEnabled,
    assistantStatus,
    assistantTargetId,
    assistantTargetLocked,
    branchSide,
    detailMode,
    onStationChange,
    onAssistantTargetChange,
    onAssistantFocusChange,
    onProgressChange,
    onManualNavigation,
    onNavigationModeChange,
    onMachineRoomCueChange,
    onMovementDiscovered,
    playing,
    progress,
    rideMode,
    stationIndex,
    dataPrepProgress,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return undefined;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch {
      if (fallbackRef.current) {
        fallbackRef.current.style.clip = "auto";
        fallbackRef.current.style.clipPath = "none";
        fallbackRef.current.style.width = "min(34rem, calc(100% - 2rem))";
        fallbackRef.current.style.height = "auto";
        fallbackRef.current.style.padding = "1rem";
        fallbackRef.current.style.margin = "1rem";
        fallbackRef.current.style.overflow = "visible";
      }
      return undefined;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor("#090b10", 1);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#090b10");
    scene.fog = new THREE.FogExp2("#090b10", 0.006);
    const camera = new THREE.PerspectiveCamera(58, 1, 0.045, 3200);
    camera.rotation.order = "YXZ";

    // Cool, gallery-like base lighting: soft slate-blue ambience with a
    // near-white key. The halls stay darker than the machine room but read
    // as calm stone rather than neon void, and small warm sconce pools keep
    // the coolness pleasant instead of sterile.
    const hemisphere = new THREE.HemisphereLight("#dbe7f4", "#0c0e13", 0.32);
    const keyLight = new THREE.DirectionalLight("#e8eef8", 0.55);
    keyLight.position.set(14, 22, 12);
    const fillLight = new THREE.DirectionalLight("#6d7ea3", 0.22);
    fillLight.position.set(-11, 8, -14);
    const cameraLight = new THREE.PointLight("#cfe0ee", 2.1, 30, 1.9);
    scene.add(hemisphere, keyLight, fillLight, cameraLight);

    // One shadow-casting overhead spot plus two soft sconces follow the
    // active chamber. Real cast shadows under the exhibits give the halls
    // shaded, physical depth; the sconces stay gently warm as an accent.
    const chamberSpot = new THREE.SpotLight("#e9f1fb", 180, 68, 0.72, 0.68, 1.7);
    chamberSpot.castShadow = true;
    chamberSpot.shadow.mapSize.set(1024, 1024);
    chamberSpot.shadow.camera.near = 2;
    chamberSpot.shadow.camera.far = 72;
    chamberSpot.shadow.bias = -0.0002;
    chamberSpot.shadow.normalBias = 0.05;
    const warmSconceA = new THREE.PointLight("#edd3b8", 9, 15, 1.9);
    const warmSconceB = new THREE.PointLight("#edd3b8", 9, 15, 1.9);
    scene.add(chamberSpot, chamberSpot.target, warmSconceA, warmSconceB);

    // Image-based lighting gives the dark slabs and pedestals soft studio
    // shading, so form reads from light falloff rather than from glow.
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const environmentTexture = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    pmremGenerator.dispose();
    scene.environment = environmentTexture;
    scene.environmentIntensity = 0.13;

    // Post-processing: an HDR render target plus UnrealBloom gives every
    // emissive surface, neon strip, and glowing cell the halo glow of the
    // reference aesthetic. OutputPass applies tone mapping and color space.
    const composerTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    const composer = new EffectComposer(renderer, composerTarget);
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      0.18,
      0.25,
      0.9,
    );
    const outputPass = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);

    const route = createCameraRoute(TRAINING_STATIONS.length);
    const routeLength = route.getLength();
    const routeBeacon = createRouteBeacon();
    scene.add(routeBeacon.group);

    const animations: AnimationRecord[] = [];
    const detailObjects: Record<DetailTier, THREE.Object3D[]> = { structure: [], math: [] };
    const branchMaterials: Record<BranchSide, THREE.Material[]> = { left: [], right: [] };
    const stationRuntimes = buildSemanticWorld(
      scene,
      route,
      animations,
      detailObjects,
      branchMaterials,
    );
    const corridorSystem = createCorridorSystem(route, stationRuntimes);
    scene.add(corridorSystem);
    updateDetailVisibility(detailObjects, latest.current.detailMode);

    // The opening scene: a quiet room with the training machine on a
    // pedestal. Aiming at a chamber and scrolling past its approach radius
    // dives the camera through the miniature into the full-size chamber.
    const machineRoom = createMachineRoom();
    machineRoom.group.position.copy(MACHINE_ROOM_ORIGIN);
    scene.add(machineRoom.group);
    // Aim selection is angular (nearest silhouette cone to the view
    // direction) rather than raycast-based: the old generous pick proxies
    // overlapped along grazing rays, so the closest box kept the hover even
    // while the visitor was clearly looking at a different chamber.
    const machineAimForward = new THREE.Vector3();
    const machineAimToUnit = new THREE.Vector3();
    /** How far outside a unit's silhouette the free-aim hover still catches. */
    const MACHINE_AIM_HOVER_MARGIN = 0.07;
    /** Wider capture used only when a scroll starts and wants a lock target. */
    const MACHINE_AIM_LOCK_MARGIN = 0.3;
    /** Looking this far away from a locked unit releases the lock. */
    const MACHINE_AIM_RELEASE_ANGLE = 0.55;
    /** Seconds after the last inward scroll before a zoom lock lets go. */
    const MACHINE_ZOOM_LOCK_GRACE = 0.55;

    const assistantController = createAssistantController({
      parent: scene,
      camera,
      scale: 0.72,
      followOffset: [1.32, -0.42, -2.65],
      presentationDistance: 2.25,
      presentationSideOffset: 0.72,
      presentationHeight: 0.35,
    });
    assistantController.group.visible = latest.current.assistantEnabled;
    const assistantReticle = createAssistantTargetReticle();
    scene.add(assistantReticle.group);
    const assistantRaycaster = new THREE.Raycaster();
    assistantRaycaster.near = 0.08;
    assistantRaycaster.far = 120;
    const assistantCenterNdc = new THREE.Vector2(0, 0);
    const assistantTargetWorld = new THREE.Vector3();
    const assistantTargetBounds = new THREE.Box3();
    let hasAssistantTargetWorld = false;
    let assistantTargetWasHit = false;
    let reportedAssistantTargetId: string | null = null;
    let lastAssistantTravelTargetId: string | null = null;
    let nextAssistantSelectionAt = 0;

    // Visitor laser pointer (hold right mouse) and spotlight focus stage
    // (left click while aiming). The camera joins the scene graph so the
    // dimming veil parented to it renders.
    scene.add(camera);
    const laserPointer = createLaserPointer();
    scene.add(laserPointer.group);
    const focusVeil = createFocusVeil();
    camera.add(focusVeil.mesh);
    // Second veil dedicated to machine-room dive/rise transitions so the
    // cut between miniature and full-size chamber happens under cover.
    const transitionVeil = createFocusVeil();
    transitionVeil.mesh.renderOrder += 1;
    camera.add(transitionVeil.mesh);
    const focusPedestal = createFocusPedestal();
    scene.add(focusPedestal.group);
    const focusStage = new THREE.Group();
    focusStage.name = "assistant-focus-stage";
    focusStage.userData.assistantNonInteractive = true;
    focusStage.visible = false;
    scene.add(focusStage);

    // Right-click feedback: the beam flashes from hand height to the picked
    // point and fades out. It is a receipt for the click, not an aiming mode.
    const LASER_FLASH_SECONDS = 0.45;
    const pickNdc = new THREE.Vector2();
    let laserFlashUntil = -1;
    let laserFlashHit = false;
    const laserFlashEnd = new THREE.Vector3();
    const laserOrigin = new THREE.Vector3();
    const laserHandOffset = new THREE.Vector3(0.34, -0.27, -0.6);

    let focusActive = false;
    let focusTargetId: string | null = null;
    let focusStationIndex = -1;
    let focusTravelPending = false;
    let focusRadius = 1;
    let focusVeilOpacity = 0;
    const focusCenter = new THREE.Vector3();
    const focusForward = new THREE.Vector3();
    const focusCameraWorld = new THREE.Vector3();
    const focusSphere = new THREE.Sphere();
    const focusStageMaterials: THREE.Material[] = [];
    const focusMaterialCache = new Map<THREE.Material, THREE.Material>();
    let lastRenderedStation = THREE.MathUtils.clamp(
      latest.current.stationIndex,
      0,
      TRAINING_STATIONS.length - 1,
    );

    let width = 1;
    let height = 1;
    const resize = () => {
      const bounds = container.getBoundingClientRect();
      width = Math.max(1, Math.floor(bounds.width || window.innerWidth));
      height = Math.max(1, Math.floor(bounds.height || window.innerHeight));
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    window.addEventListener("resize", resize, { passive: true });

    type NavigationRegion =
      | { kind: "chamber" }
      | { kind: "machine-room" }
      | {
          kind: "tunnel";
          from: number;
          to: number;
          startProgress: number;
          endProgress: number;
          progress: number;
          eyeOffset: number;
          lateralOffset: number;
        };

    /**
     * Machine-room transition phases. "dive" owns the camera while it flies
     * into the aimed miniature; "reveal" fades the veil away inside the
     * full-size chamber; "rise" veils the chamber before the cut back to the
     * room; "room-reveal" fades the veil away in the room.
     */
    type RoomTransition =
      | {
          mode: "dive";
          targetStation: number;
          t: number;
          fromPosition: THREE.Vector3;
          fromQuaternion: THREE.Quaternion;
          toPosition: THREE.Vector3;
          toQuaternion: THREE.Quaternion;
          fromFov: number;
        }
      | { mode: "reveal"; t: number }
      | { mode: "rise"; t: number; targetUnitIndex: number }
      | { mode: "room-reveal"; t: number };

    const stationDenominator = Math.max(1, TRAINING_STATIONS.length - 1);
    const stationAnchor = (index: number) => index / stationDenominator;
    const isBlocked = (
      bounds: ChamberNavigationBounds,
      x: number,
      y: number,
      z: number,
    ) =>
      bounds.blockers?.some(
        (blocker) =>
          x > blocker.minX &&
          x < blocker.maxX &&
          y > (blocker.minY ?? Number.NEGATIVE_INFINITY) &&
          y < (blocker.maxY ?? Number.POSITIVE_INFINITY) &&
          z > blocker.minZ &&
          z < blocker.maxZ,
      ) ?? false;
    const pressedKeys = new Set<string>();
    let activeStationIndex = THREE.MathUtils.clamp(
      latest.current.stationIndex,
      0,
      stationRuntimes.length - 1,
    );
    // The experience opens standing in the machine room, looking at the
    // training machine on its pedestal.
    let navigationRegion: NavigationRegion = { kind: "machine-room" };
    let roomTransition: RoomTransition | null = null;
    let roomVeilOpacity = 0;
    let roomHoveredIndex = -1;
    /** Unit captured by an inward scroll; -1 while freely looking around. */
    let roomZoomLockIndex = -1;
    /** Time left before an idle zoom lock releases. */
    let roomZoomLockCooldown = 0;
    let roomReferenceStationIndex = latest.current.stationIndex;
    const roomPlayerPosition = machineRoom.bounds.spawn.clone();
    const localPlayerPosition = stationRuntimes[
      activeStationIndex
    ].navigationBounds.spawn.clone();
    let dragging = false;
    let pointerId = -1;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let targetYaw = machineRoom.bounds.spawnYaw;
    let targetPitch = machineRoom.bounds.spawnPitch;
    let glanceYaw = targetYaw;
    let glancePitch = targetPitch;
    let pendingDollyDistance = 0;
    let verticalRoamEnabled = false;
    let cameraProgress = THREE.MathUtils.clamp(latest.current.progress, 0, 1);
    let renderedRouteProgress = cameraProgress;
    let manualOverride = true;
    let wasPlaying = latest.current.playing;
    let reportedNavigationMode: NavigationMode | null = null;
    let reportedMachineRoomCueKey: string | null = null;
    let reportedTrainingConsoleNearby = false;
    let movementDiscoveryReported = false;
    cameraLight.intensity = 1.0;

    /* ---------------------------------------------------------------- *
     * Opening fly-in. On first load the camera opens on a wide
     * establishing view of the room, then eases forward over a few
     * seconds to the resting pose facing the Transformer Tower. Any
     * manual input (WASD, click, or scroll) cancels it instantly and
     * hands control to the visitor from wherever the camera currently
     * sits — no snap. Tweak the START constants below to reframe the
     * opening shot; the END pose tracks the machine-room spawn.
     * ---------------------------------------------------------------- */
    const INTRO_START_POSITION = new THREE.Vector3(2.6, 2.35, 4.15);
    const INTRO_START_YAW = 0.58;
    const INTRO_START_PITCH = -0.22;
    const INTRO_START_FOV = 64;
    const INTRO_END_POSITION = machineRoom.bounds.spawn.clone();
    const INTRO_END_YAW = machineRoom.bounds.spawnYaw;
    const INTRO_END_PITCH = machineRoom.bounds.spawnPitch;
    const INTRO_DURATION = 5; // seconds — cinematic glide
    let introActive = true;
    let introElapsed = 0;
    // Seed the pose so the very first rendered frame already sits at the
    // wide establishing shot rather than at the resting spawn.
    roomPlayerPosition.copy(INTRO_START_POSITION);
    targetYaw = INTRO_START_YAW;
    targetPitch = INTRO_START_PITCH;
    glanceYaw = INTRO_START_YAW;
    glancePitch = INTRO_START_PITCH;

    /** Cancel the opening fly-in and hand control over with no snap. */
    const cancelIntro = () => {
      if (!introActive) return;
      introActive = false;
      // glance* / roomPlayerPosition already hold the last interpolated
      // frame; lock the free-roam targets onto them so nothing jumps.
      targetYaw = glanceYaw;
      targetPitch = glancePitch;
    };

    /**
     * Grab the pointer for FPS look. Called from the first movement key so
     * the visitor starts looking with the mouse without a separate click.
     * Skipped near the training console, where the cursor is handed back on
     * purpose so its call-to-action stays clickable.
     */
    const requestRoomPointerLock = () => {
      if (
        navigationRegion.kind === "machine-room" &&
        !reportedTrainingConsoleNearby &&
        document.pointerLockElement !== canvas &&
        typeof canvas.requestPointerLock === "function"
      ) {
        try {
          const result = canvas.requestPointerLock() as unknown;
          if (
            result &&
            typeof (result as Promise<void>).then === "function"
          ) {
            (result as Promise<void>).catch(() => {});
          }
        } catch {
          // Pointer lock can reject if requested too soon after an exit;
          // the next keypress simply tries again.
        }
      }
    };

    const reportNavigationMode = (mode: NavigationMode) => {
      if (reportedNavigationMode === mode) return;
      reportedNavigationMode = mode;
      latest.current.onNavigationModeChange(mode);
    };

    const reportMachineRoomCue = (cue: MachineRoomCue | null) => {
      const cueKey = cue
        ? `${cue.unitId}:${cue.approaching ? "approaching" : "ready"}`
        : null;
      if (reportedMachineRoomCueKey === cueKey) return;
      reportedMachineRoomCueKey = cueKey;
      latest.current.onMachineRoomCueChange(cue);
    };

    const reportTrainingConsoleProximity = (nearby: boolean) => {
      if (reportedTrainingConsoleNearby === nearby) return;
      reportedTrainingConsoleNearby = nearby;
      setTrainingConsoleNearby(nearby);
      if (nearby && document.pointerLockElement === canvas) {
        // Give the cursor back as the call to action appears so the visitor
        // can click it immediately after walking into the wake radius.
        document.exitPointerLock();
        pressedKeys.clear();
        pendingDollyDistance = 0;
      }
    };

    const reportMovementDiscovered = () => {
      if (movementDiscoveryReported) return;
      movementDiscoveryReported = true;
      latest.current.onMovementDiscovered();
    };

    const reportAssistantTarget = (targetId: string | null) => {
      if (reportedAssistantTargetId === targetId) return;
      reportedAssistantTargetId = targetId;
      latest.current.onAssistantTargetChange(targetId);
    };

    interface AssistantPick {
      hitPoint: THREE.Vector3;
      hitObject: THREE.Object3D;
      targetId: string;
      anchorObject: THREE.Object3D | null;
      anchorCenter: THREE.Vector3;
    }
    const pickHitPoint = new THREE.Vector3();
    const pickAnchorCenter = new THREE.Vector3();

    /**
     * Raycasts through `ndc` into the current chamber and resolves the
     * assistant target. The returned vectors are shared scratch space; copy
     * them before the next pick.
     */
    const pickAssistantTarget = (
      currentStation: number,
      ndc: THREE.Vector2,
    ): AssistantPick | null => {
      const runtime = stationRuntimes[currentStation];
      const station = TRAINING_STATIONS[currentStation];
      runtime.group.updateMatrixWorld(true);
      assistantRaycaster.setFromCamera(ndc, camera);
      const hit = assistantRaycaster
        .intersectObject(runtime.group, true)
        .find((intersection) => {
          let object: THREE.Object3D | null = intersection.object;
          while (object) {
            if (object.userData.assistantNonInteractive) return false;
            if (object === runtime.group) break;
            object = object.parent;
          }
          return true;
        });
      if (!hit) return null;

      const ancestryNames: string[] = [];
      let cursor: THREE.Object3D | null = hit.object;
      while (cursor) {
        if (cursor.name) ancestryNames.push(cursor.name);
        if (cursor === runtime.group) break;
        cursor = cursor.parent;
      }
      const resolution = resolveAssistantTarget({
        stationId: station.id,
        objectAncestryNames: ancestryNames,
      });

      let anchorObject: THREE.Object3D | null = null;
      if (resolution.matchedObjectName) {
        cursor = hit.object;
        while (cursor) {
          if (cursor.name === resolution.matchedObjectName) {
            anchorObject = cursor;
            break;
          }
          if (cursor === runtime.group) break;
          cursor = cursor.parent;
        }
      }

      if (anchorObject) {
        assistantTargetBounds.setFromObject(anchorObject, true);
        if (assistantTargetBounds.isEmpty()) {
          pickAnchorCenter.copy(hit.point);
        } else {
          assistantTargetBounds.getCenter(pickAnchorCenter);
        }
      } else {
        pickAnchorCenter.copy(hit.point);
      }
      pickHitPoint.copy(hit.point);
      return {
        hitPoint: pickHitPoint,
        hitObject: hit.object,
        targetId: resolution.target.id,
        anchorObject,
        anchorCenter: pickAnchorCenter,
      };
    };

    const updateAssistantSelection = (currentStation: number) => {
      const pick = pickAssistantTarget(currentStation, assistantCenterNdc);
      if (!pick) {
        const fallback = resolveAssistantTarget({
          stationId: TRAINING_STATIONS[currentStation].id,
        });
        reportAssistantTarget(fallback.target.id);
        hasAssistantTargetWorld = false;
        assistantTargetWasHit = false;
        return;
      }
      reportAssistantTarget(pick.targetId);
      assistantTargetWorld.copy(pick.anchorCenter);
      hasAssistantTargetWorld = true;
      assistantTargetWasHit = true;
    };

    /**
     * Deep-copies an exhibit subtree for the spotlight stage, sharing
     * geometry and materials with the originals so nothing extra needs
     * disposal. Opaque materials are swapped for transparent clones so the
     * replica renders after the dimming veil and stays bright.
     */
    const stageMaterialFor = (material: THREE.Material): THREE.Material => {
      if (material.transparent) return material;
      let staged = focusMaterialCache.get(material);
      if (!staged) {
        staged = material.clone();
        staged.transparent = true;
        focusMaterialCache.set(material, staged);
        focusStageMaterials.push(staged);
      }
      return staged;
    };
    const stageMaterialSlot = (
      material: THREE.Material | THREE.Material[],
    ): THREE.Material | THREE.Material[] =>
      Array.isArray(material)
        ? material.map(stageMaterialFor)
        : stageMaterialFor(material);

    const cloneForStage = (source: THREE.Object3D): THREE.Object3D | null => {
      if (source.userData.assistantNonInteractive === true) return null;
      if (!source.visible) return null;

      let copy: THREE.Object3D | null = null;
      if ((source as THREE.Mesh).isMesh) {
        const mesh = source as THREE.Mesh;
        copy = new THREE.Mesh(mesh.geometry, stageMaterialSlot(mesh.material));
      } else if ((source as THREE.LineSegments).isLineSegments) {
        const line = source as THREE.LineSegments;
        copy = new THREE.LineSegments(line.geometry, stageMaterialSlot(line.material));
      } else if ((source as THREE.Line).isLine) {
        const line = source as THREE.Line;
        copy = new THREE.Line(line.geometry, stageMaterialSlot(line.material));
      } else if ((source as THREE.Points).isPoints) {
        const points = source as THREE.Points;
        copy = new THREE.Points(points.geometry, stageMaterialSlot(points.material));
      } else if ((source as THREE.Sprite).isSprite) {
        copy = new THREE.Sprite((source as THREE.Sprite).material);
      } else if ((source as THREE.Group).isGroup || source.type === "Object3D") {
        copy = new THREE.Group();
      } else {
        return null; // lights, cameras, and helpers stay out of the replica
      }

      copy.name = source.name;
      copy.position.copy(source.position);
      copy.quaternion.copy(source.quaternion);
      copy.scale.copy(source.scale);
      copy.renderOrder = FOCUS_STAGE_RENDER_ORDER;
      for (const child of source.children) {
        const childCopy = cloneForStage(child);
        if (childCopy) copy.add(childCopy);
      }
      return copy;
    };

    const setAvatarRenderOrder = (renderOrder: number) => {
      assistantController.group.traverse((object) => {
        object.renderOrder = renderOrder;
      });
    };

    const clearFocusStage = () => {
      for (const child of [...focusStage.children]) focusStage.remove(child);
      for (const material of focusStageMaterials) material.dispose();
      focusStageMaterials.length = 0;
      focusMaterialCache.clear();
      focusStage.visible = false;
      focusStage.rotation.set(0, 0, 0);
      focusStage.scale.setScalar(1);
      focusStage.position.set(0, 0, 0);
      focusPedestal.group.visible = false;
    };

    const exitFocus = () => {
      if (!focusActive) return;
      focusActive = false;
      focusTargetId = null;
      focusStationIndex = -1;
      focusTravelPending = false;
      clearFocusStage();
      setAvatarRenderOrder(0);
      lastAssistantTravelTargetId = null;
      latest.current.onAssistantFocusChange?.(null);
      setInteractionHint(null);
    };

    /**
     * Right click on a component: replicate it on a magnified center stage
     * in front of the visitor, dim the chamber, and send the guide to stand
     * beside it.
     */
    const enterFocus = (currentStation: number, pick: AssistantPick): boolean => {
      const anchor = pick.anchorObject ?? pick.hitObject;
      if (!anchor) return false;
      const pickedTargetId = pick.targetId;

      const wasActive = focusActive;
      focusActive = false;
      clearFocusStage();
      const abortFocus = () => {
        clearFocusStage();
        focusTargetId = null;
        focusStationIndex = -1;
        focusTravelPending = false;
        if (wasActive) {
          setAvatarRenderOrder(0);
          lastAssistantTravelTargetId = null;
          latest.current.onAssistantFocusChange?.(null);
          setInteractionHint(null);
        }
        return false;
      };

      anchor.updateWorldMatrix(true, false);
      const staged = cloneForStage(anchor);
      if (!staged) return abortFocus();
      anchor.matrixWorld.decompose(
        staged.position,
        staged.quaternion,
        staged.scale,
      );
      focusStage.add(staged);
      assistantTargetBounds.setFromObject(staged, true);
      if (assistantTargetBounds.isEmpty()) return abortFocus();
      assistantTargetBounds.getBoundingSphere(focusSphere);
      staged.position.sub(focusSphere.center);

      const fovRadians = THREE.MathUtils.degToRad(camera.fov);
      const viewHeight = 2 * Math.tan(fovRadians / 2) * FOCUS_STAGE_DISTANCE;
      const stageScale = THREE.MathUtils.clamp(
        (viewHeight * 0.4) / Math.max(0.001, focusSphere.radius * 2),
        0.02,
        60,
      );
      focusStage.scale.setScalar(stageScale);
      focusRadius = focusSphere.radius * stageScale;

      camera.updateMatrixWorld();
      camera.getWorldPosition(focusCameraWorld);
      camera.getWorldDirection(focusForward);
      focusCenter
        .copy(focusCameraWorld)
        .addScaledVector(focusForward, FOCUS_STAGE_DISTANCE);
      focusStage.position.copy(focusCenter);
      focusStage.visible = true;

      focusPedestal.group.visible = true;
      focusPedestal.group.position.copy(focusCenter);
      focusPedestal.group.position.y -= focusRadius * 1.18;
      focusPedestal.group.scale.setScalar(
        THREE.MathUtils.clamp(focusRadius * 1.05, 0.3, 3.2),
      );

      focusActive = true;
      focusTargetId = pickedTargetId;
      focusStationIndex = currentStation;
      focusTravelPending = true;
      setAvatarRenderOrder(FOCUS_AVATAR_RENDER_ORDER);
      reportAssistantTarget(focusTargetId);
      assistantTargetWorld.copy(focusCenter);
      hasAssistantTargetWorld = true;
      assistantTargetWasHit = true;
      lastAssistantTravelTargetId = null;
      latest.current.onAssistantFocusChange?.(focusTargetId);
      setInteractionHint("focus");
      return true;
    };

    /** Starts the short beam flash that acknowledges a right click. */
    const flashLaser = (endWorld: THREE.Vector3, hit: boolean) => {
      laserFlashEnd.copy(endWorld);
      laserFlashHit = hit;
      laserFlashUntil = -2; // armed; the render loop stamps the deadline
    };

    /** Per-frame fade-out of the right-click beam flash. */
    const updateLaserFlash = (
      elapsedSeconds: number,
      motionEnabled: boolean,
    ) => {
      if (laserFlashUntil === -2) {
        laserFlashUntil = elapsedSeconds + LASER_FLASH_SECONDS;
      }
      if (elapsedSeconds >= laserFlashUntil) {
        laserPointer.group.visible = false;
        return;
      }
      const intensity = THREE.MathUtils.clamp(
        (laserFlashUntil - elapsedSeconds) / LASER_FLASH_SECONDS,
        0,
        1,
      );
      camera.updateMatrixWorld();
      laserOrigin.copy(laserHandOffset).applyMatrix4(camera.matrixWorld);
      laserPointer.group.visible = true;
      laserPointer.setBeam(
        laserOrigin,
        laserFlashEnd,
        laserFlashHit,
        elapsedSeconds,
        motionEnabled,
        camera.quaternion,
      );
      laserPointer.setIntensity(intensity);
    };

    const resetManualPose = (station = activeStationIndex) => {
      activeStationIndex = THREE.MathUtils.clamp(
        station,
        0,
        stationRuntimes.length - 1,
      );
      navigationRegion = { kind: "chamber" };
      localPlayerPosition.copy(
        stationRuntimes[activeStationIndex].navigationBounds.spawn,
      );
      targetYaw = 0;
      targetPitch = 0;
      glanceYaw = 0;
      glancePitch = 0;
      pendingDollyDistance = 0;
      verticalRoamEnabled = false;
    };

    const seedManualPoseFromCamera = () => {
      let chamberIndex = -1;
      const stationLocalCamera = new THREE.Vector3();
      for (let index = 0; index < stationRuntimes.length; index += 1) {
        const runtime = stationRuntimes[index];
        const bounds = runtime.navigationBounds;
        runtime.group.updateMatrixWorld(true);
        stationLocalCamera.copy(camera.position);
        runtime.group.worldToLocal(stationLocalCamera);
        if (
          stationLocalCamera.x >= bounds.minX &&
          stationLocalCamera.x <= bounds.maxX &&
          stationLocalCamera.y >= bounds.minY &&
          stationLocalCamera.y <= bounds.maxY &&
          stationLocalCamera.z >= bounds.minZ &&
          stationLocalCamera.z <= bounds.maxZ
        ) {
          chamberIndex = index;
          break;
        }
      }

      const beforeFirstStation = renderedRouteProgress <= 0;
      const afterLastStation = renderedRouteProgress >= 1;
      let localCameraQuaternion: THREE.Quaternion;

      if (chamberIndex >= 0 || beforeFirstStation || afterLastStation) {
        activeStationIndex =
          chamberIndex >= 0
            ? chamberIndex
            : beforeFirstStation
              ? 0
              : stationRuntimes.length - 1;
        navigationRegion = { kind: "chamber" };
        const runtime = stationRuntimes[activeStationIndex];
        runtime.group.updateMatrixWorld(true);
        localPlayerPosition.copy(camera.position);
        runtime.group.worldToLocal(localPlayerPosition);
        localPlayerPosition.x = THREE.MathUtils.clamp(
          localPlayerPosition.x,
          runtime.navigationBounds.minX + 0.45,
          runtime.navigationBounds.maxX - 0.45,
        );
        localPlayerPosition.y = THREE.MathUtils.clamp(
          localPlayerPosition.y,
          runtime.navigationBounds.minY,
          runtime.navigationBounds.maxY,
        );
        localPlayerPosition.z = THREE.MathUtils.clamp(
          localPlayerPosition.z,
          runtime.navigationBounds.minZ + 0.45,
          runtime.navigationBounds.maxZ - 0.45,
        );
        localCameraQuaternion = runtime.group.quaternion
          .clone()
          .invert()
          .multiply(camera.quaternion);
        cameraProgress = stationAnchor(activeStationIndex);
      } else {
        const from = THREE.MathUtils.clamp(
          Math.floor(renderedRouteProgress * stationDenominator),
          0,
          stationRuntimes.length - 2,
        );
        const to = from + 1;
        const fromBounds = stationRuntimes[from].navigationBounds;
        const toBounds = stationRuntimes[to].navigationBounds;
        const startProgress = stationAnchor(from) + -fromBounds.minZ / routeLength;
        const endProgress = stationAnchor(to) - toBounds.maxZ / routeLength;
        const tunnelProgress = THREE.MathUtils.clamp(
          renderedRouteProgress,
          Math.min(startProgress, endProgress),
          Math.max(startProgress, endProgress),
        );
        const tunnelPoint = route.getPointAt(tunnelProgress);
        const tunnelTangent = route.getTangentAt(tunnelProgress).normalize();
        const tunnelRight = new THREE.Vector3()
          .crossVectors(tunnelTangent, WORLD_UP)
          .normalize();
        const tunnelUp = new THREE.Vector3()
          .crossVectors(tunnelRight, tunnelTangent)
          .normalize();
        const tunnelCameraMatrix = new THREE.Matrix4().lookAt(
          camera.position,
          camera.position.clone().add(tunnelTangent),
          tunnelUp,
        );
        const tunnelBaseQuaternion = new THREE.Quaternion().setFromRotationMatrix(
          tunnelCameraMatrix,
        );
        localCameraQuaternion = tunnelBaseQuaternion
          .invert()
          .multiply(camera.quaternion);
        navigationRegion = {
          kind: "tunnel",
          from,
          to,
          startProgress,
          endProgress,
          progress: tunnelProgress,
          eyeOffset: camera.position.clone().sub(tunnelPoint).dot(tunnelUp),
          lateralOffset: THREE.MathUtils.clamp(
            camera.position.clone().sub(tunnelPoint).dot(tunnelRight),
            -CORRIDOR_WALKABLE_HALF_WIDTH,
            CORRIDOR_WALKABLE_HALF_WIDTH,
          ),
        };
        activeStationIndex = from;
        cameraProgress = tunnelProgress;
      }

      const localCameraEuler = new THREE.Euler().setFromQuaternion(
        localCameraQuaternion,
        "YXZ",
      );
      targetYaw = localCameraEuler.y;
      targetPitch = THREE.MathUtils.clamp(
        localCameraEuler.x,
        -Math.PI * 0.485,
        Math.PI * 0.485,
      );
      glanceYaw = targetYaw;
      glancePitch = targetPitch;
      pendingDollyDistance = 0;
      verticalRoamEnabled = false;
    };

    const beginManualControl = () => {
      // Inside the machine room the visitor already has manual control and
      // has no pose to seed from the route.
      if (navigationRegion.kind === "machine-room") {
        manualOverride = true;
        return;
      }
      if (!manualOverride) seedManualPoseFromCamera();
      manualOverride = true;
      latest.current.onManualNavigation();
    };

    const startTunnelFromChamber = (
      destination: number,
      bounds: ChamberNavigationBounds,
    ) => {
      const travelingForward = destination > activeStationIndex;
      const destinationBounds = stationRuntimes[destination].navigationBounds;
      const startProgress = travelingForward
        ? stationAnchor(activeStationIndex) + -bounds.minZ / routeLength
        : stationAnchor(activeStationIndex) - bounds.maxZ / routeLength;
      const endProgress = travelingForward
        ? stationAnchor(destination) - destinationBounds.maxZ / routeLength
        : stationAnchor(destination) + -destinationBounds.minZ / routeLength;
      const chamberRuntime = stationRuntimes[activeStationIndex];
      chamberRuntime.group.updateMatrixWorld(true);
      const chamberWorldPosition = localPlayerPosition.clone();
      chamberRuntime.group.localToWorld(chamberWorldPosition);
      const tunnelRoutePoint = route.getPointAt(
        THREE.MathUtils.clamp(startProgress, 0, 1),
      );
      const tunnelTangent = route
        .getTangentAt(THREE.MathUtils.clamp(startProgress, 0, 1))
        .normalize();
      const tunnelRight = new THREE.Vector3()
        .crossVectors(tunnelTangent, WORLD_UP)
        .normalize();
      const tunnelUp = new THREE.Vector3()
        .crossVectors(tunnelRight, tunnelTangent)
        .normalize();
      const tunnelOffset = chamberWorldPosition.sub(tunnelRoutePoint);
      navigationRegion = {
        kind: "tunnel",
        from: activeStationIndex,
        to: destination,
        startProgress,
        endProgress,
        progress: startProgress,
        eyeOffset: tunnelOffset.dot(tunnelUp),
        lateralOffset: THREE.MathUtils.clamp(
          tunnelOffset.dot(tunnelRight),
          -CORRIDOR_WALKABLE_HALF_WIDTH,
          CORRIDOR_WALKABLE_HALF_WIDTH,
        ),
      };
      targetYaw = 0;
      targetPitch = 0;
      glanceYaw = 0;
      glancePitch = 0;
      pendingDollyDistance = 0;
      verticalRoamEnabled = false;
    };

    /* ---------------------------------------------------------------- *
     * Machine-room helpers
     * ---------------------------------------------------------------- */

    /** Snap into a chamber's free-roam spawn (always performed under veil). */
    const placeIntoChamber = (station: number) => {
      manualOverride = true;
      resetManualPose(station);
      cameraProgress = stationAnchor(activeStationIndex);
      renderedRouteProgress = cameraProgress;
      camera.fov = 60;
      cameraLight.intensity = 2.1;
      roomHoveredIndex = -1;
      roomZoomLockIndex = -1;
      roomZoomLockCooldown = 0;
      latest.current.onProgressChange(cameraProgress);
      latest.current.onManualNavigation();
    };

    /** Place the visitor back in the room, overlooking the given unit. */
    const enterRoomAt = (unitIndex: number) => {
      const unit = machineRoom.units[
        THREE.MathUtils.clamp(unitIndex, 0, machineRoom.units.length - 1)
      ];
      navigationRegion = { kind: "machine-room" };
      manualOverride = true;
      roomPlayerPosition.copy(unit.overlookLocal);
      const forward = unit.focusLocal.clone().sub(unit.overlookLocal).normalize();
      targetYaw = Math.atan2(-forward.x, -forward.z);
      targetPitch = THREE.MathUtils.clamp(
        Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)),
        -Math.PI * 0.485,
        Math.PI * 0.485,
      );
      glanceYaw = targetYaw;
      glancePitch = targetPitch;
      pendingDollyDistance = 0;
      verticalRoamEnabled = false;
      roomHoveredIndex = -1;
      roomZoomLockIndex = -1;
      roomZoomLockCooldown = 0;
      roomReferenceStationIndex = latest.current.stationIndex;
      camera.fov = MACHINE_ROOM_FOV;
      cameraLight.intensity = 1.0;
    };

    /** Begin the zoom dive from the room into the aimed miniature chamber. */
    const startRoomDive = (unitIndex: number) => {
      if (roomTransition) return;
      const unit = machineRoom.units[unitIndex];
      clearPressedKeys();
      reportMachineRoomCue(null);
      exitFocus();
      if (reduceProcessMotion) {
        roomVeilOpacity = 1;
        placeIntoChamber(unit.stationIndex);
        roomTransition = { mode: "reveal", t: 0 };
        return;
      }
      const toPosition = unit.focusLocal
        .clone()
        .add(MACHINE_ROOM_ORIGIN);
      const lookMatrix = new THREE.Matrix4().lookAt(
        camera.position,
        toPosition,
        WORLD_UP,
      );
      roomTransition = {
        mode: "dive",
        targetStation: unit.stationIndex,
        t: 0,
        fromPosition: camera.position.clone(),
        fromQuaternion: camera.quaternion.clone(),
        toPosition,
        toQuaternion: new THREE.Quaternion().setFromRotationMatrix(lookMatrix),
        fromFov: camera.fov,
      };
    };

    /** M key: veil the chamber, then step back out to the machine room. */
    const beginReturnToRoom = () => {
      if (roomTransition || navigationRegion.kind === "machine-room") return;
      const stationForUnit =
        navigationRegion.kind === "tunnel"
          ? navigationRegion.from
          : activeStationIndex;
      const unitIndex = machineRoom.unitIndexForStation(stationForUnit);
      beginManualControl();
      exitFocus();
      clearPressedKeys();
      if (reduceProcessMotion) {
        roomVeilOpacity = 1;
        enterRoomAt(unitIndex);
        roomTransition = { mode: "room-reveal", t: 0 };
        return;
      }
      roomTransition = { mode: "rise", t: 0, targetUnitIndex: unitIndex };
    };

    const moveWithinChamber = (
      deltaX: number,
      deltaY: number,
      deltaZ: number,
    ) => {
      if (navigationRegion.kind !== "chamber") return;
      const bounds = stationRuntimes[activeStationIndex].navigationBounds;
      const insidePortal = (x: number, y: number) =>
        Math.abs(x - bounds.portalCenterX) <= bounds.portalHalfWidth &&
        y >= bounds.portalMinY &&
        y <= bounds.portalMaxY;
      const movementDistance = Math.hypot(deltaX, deltaY, deltaZ);
      const stepCount = Math.max(1, Math.ceil(movementDistance / 0.32));
      const stepX = deltaX / stepCount;
      const stepY = deltaY / stepCount;
      const stepZ = deltaZ / stepCount;

      for (let step = 0; step < stepCount; step += 1) {
        if (navigationRegion.kind !== "chamber") return;
        const startX = localPlayerPosition.x;
        const startY = localPlayerPosition.y;
        const startZ = localPlayerPosition.z;
        const nextY = THREE.MathUtils.clamp(
          startY + stepY,
          bounds.minY,
          bounds.maxY,
        );
        if (!isBlocked(bounds, startX, nextY, startZ)) {
          localPlayerPosition.y = nextY;
        }

        const nextX = THREE.MathUtils.clamp(
          startX + stepX,
          bounds.minX + 0.45,
          bounds.maxX - 0.45,
        );
        if (!isBlocked(bounds, nextX, localPlayerPosition.y, startZ)) {
          localPlayerPosition.x = nextX;
        }

        const nextZ = startZ + stepZ;
        const crossingZ =
          nextZ < bounds.minZ
            ? bounds.minZ
            : nextZ > bounds.maxZ
              ? bounds.maxZ
              : null;
        if (crossingZ !== null) {
          const crossingRatio = THREE.MathUtils.clamp(
            (crossingZ - startZ) / (nextZ - startZ),
            0,
            1,
          );
          const crossingX = THREE.MathUtils.lerp(
            startX,
            localPlayerPosition.x,
            crossingRatio,
          );
          const crossingY = THREE.MathUtils.lerp(
            startY,
            localPlayerPosition.y,
            crossingRatio,
          );
          if (insidePortal(crossingX, crossingY)) {
            if (
              crossingZ === bounds.minZ &&
              activeStationIndex < stationRuntimes.length - 1
            ) {
              startTunnelFromChamber(activeStationIndex + 1, bounds);
              return;
            }
            if (crossingZ === bounds.maxZ && activeStationIndex > 0) {
              startTunnelFromChamber(activeStationIndex - 1, bounds);
              return;
            }
          }
        }

        const endpointInsidePortal = insidePortal(
          localPlayerPosition.x,
          localPlayerPosition.y,
        );
        const resolvedZ = THREE.MathUtils.clamp(
          nextZ,
          endpointInsidePortal ? bounds.minZ : bounds.minZ + 0.45,
          endpointInsidePortal ? bounds.maxZ : bounds.maxZ - 0.45,
        );
        if (
          !isBlocked(
            bounds,
            localPlayerPosition.x,
            localPlayerPosition.y,
            resolvedZ,
          )
        ) {
          localPlayerPosition.z = resolvedZ;
        }
      }
    };

    const applyLookDelta = (deltaX: number, deltaY: number) => {
      targetYaw -= deltaX * 0.00235;
      targetPitch = THREE.MathUtils.clamp(
        targetPitch - deltaY * 0.0021,
        -Math.PI * 0.485,
        Math.PI * 0.485,
      );
    };

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      cancelIntro();
      beginManualControl();
      verticalRoamEnabled = true;
      const pixelDelta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * Math.max(1, height)
            : event.deltaY;
      const dollyImpulse = THREE.MathUtils.clamp(
        -pixelDelta * 0.022,
        -7,
        7,
      );
      pendingDollyDistance = THREE.MathUtils.clamp(
        pendingDollyDistance + dollyImpulse,
        -18,
        18,
      );
    };

    const clientToNdc = (
      clientX: number,
      clientY: number,
      out: THREE.Vector2,
    ) => {
      const rect = canvas.getBoundingClientRect();
      out.set(
        THREE.MathUtils.clamp(
          ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
          -1,
          1,
        ),
        THREE.MathUtils.clamp(
          -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
          -1,
          1,
        ),
      );
    };

    /**
     * Right click spotlights whatever the pointer rests on: the cursor
     * position normally, or the center crosshair while the mouse is
     * captured. Right-clicking empty space releases an active spotlight.
     */
    const spotlightUnderPointer = (event: PointerEvent) => {
      // The spotlight stage belongs to the chambers; in the machine room the
      // right mouse button stays free for future use and mis-clicks.
      if (navigationRegion.kind === "machine-room" || roomTransition) return;
      if (document.pointerLockElement === canvas) {
        pickNdc.set(0, 0);
      } else {
        clientToNdc(event.clientX, event.clientY, pickNdc);
      }
      const pick = pickAssistantTarget(lastRenderedStation, pickNdc);
      if (pick) {
        flashLaser(pick.hitPoint, true);
        enterFocus(lastRenderedStation, pick);
        return;
      }
      // Nothing under the pointer: flash into the distance as feedback and
      // release any active spotlight.
      assistantRaycaster.setFromCamera(pickNdc, camera);
      laserFlashEnd
        .copy(assistantRaycaster.ray.origin)
        .addScaledVector(assistantRaycaster.ray.direction, 40);
      flashLaser(laserFlashEnd, false);
      exitFocus();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 2) {
        event.preventDefault();
        canvas.focus();
        spotlightUnderPointer(event);
        return;
      }
      if (event.button !== 0) return;
      canvas.focus();
      cancelIntro();
      beginManualControl();
      if (
        event.pointerType === "mouse" &&
        document.pointerLockElement !== canvas &&
        typeof canvas.requestPointerLock === "function"
      ) {
        canvas.requestPointerLock();
        return;
      }
      // Already pointer-locked (FPS mode): look is driven by the pointer-lock
      // mousemove path, and setPointerCapture would throw InvalidStateError
      // because there is no active pointer to capture while locked.
      if (document.pointerLockElement === canvas) return;
      dragging = true;
      pointerId = event.pointerId;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Ignore: pointer may already be captured/released or invalid.
      }
      canvas.style.cursor = "grabbing";
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== pointerId) return;
      const deltaX = event.clientX - lastPointerX;
      const deltaY = event.clientY - lastPointerY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      applyLookDelta(deltaX, deltaY);
    };
    const releasePointer = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      pointerId = -1;
      canvas.style.cursor = "crosshair";
    };
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    const onDocumentMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      applyLookDelta(event.movementX, event.movementY);
    };
    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === canvas;
      canvas.style.cursor = locked ? "none" : "crosshair";
      if (locked) dragging = false;
    };
    const clearPressedKeys = () => {
      pressedKeys.clear();
      pendingDollyDistance = 0;
    };
    const isTextEntryTarget = (target: EventTarget | null) => {
      const element = target instanceof HTMLElement ? target : null;
      return Boolean(
        element?.closest(
          "input:not([type]), input[type='text'], input[type='search'], input[type='email'], input[type='url'], input[type='tel'], input[type='password'], input[type='number'], select, textarea, [contenteditable='true']",
        ),
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;
      if (
        event.code === "KeyE" &&
        !event.repeat &&
        reportedTrainingConsoleNearby
      ) {
        event.preventDefault();
        trainingConsoleLinkRef.current?.click();
      } else if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
        event.preventDefault();
        pressedKeys.add(event.code);
        if (!event.repeat) {
          cancelIntro();
          beginManualControl();
          // The first movement key also captures the mouse for FPS look, so
          // the visitor never has to click the scene first. Esc frees it.
          requestRoomPointerLock();
        }
      } else if (["ShiftLeft", "ShiftRight"].includes(event.code)) {
        pressedKeys.add(event.code);
      } else if (event.code === "KeyM" && !event.repeat) {
        event.preventDefault();
        beginReturnToRoom();
      } else if (event.code === "KeyR" && !event.repeat) {
        event.preventDefault();
        pendingDollyDistance = 0;
        verticalRoamEnabled = false;
        if (navigationRegion.kind === "machine-room") {
          if (!roomTransition) {
            roomPlayerPosition.copy(machineRoom.bounds.spawn);
            targetYaw = machineRoom.bounds.spawnYaw;
            targetPitch = machineRoom.bounds.spawnPitch;
          }
        } else if (manualOverride) {
          const returnStation =
            navigationRegion.kind === "tunnel"
              ? navigationRegion.from
              : activeStationIndex;
          resetManualPose(returnStation);
          latest.current.onProgressChange(stationAnchor(returnStation));
        } else {
          targetYaw = 0;
          targetPitch = 0;
        }
      } else if (event.code === "Escape" && !event.repeat) {
        // With pointer lock engaged the browser consumes the first Escape
        // to release the lock; the next one releases the spotlight.
        if (focusActive && document.pointerLockElement !== canvas) {
          exitFocus();
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      pressedKeys.delete(event.code);
    };
    const onVisibilityChange = () => {
      if (document.hidden) clearPressedKeys();
    };
    canvas.style.cursor = "crosshair";
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", releasePointer);
    canvas.addEventListener("pointercancel", releasePointer);
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("mousemove", onDocumentMouseMove);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearPressedKeys);

    /* ---------------------------------------------------------------- *
     * Demo-director API: a thin imperative surface over the existing
     * navigation helpers so the scripted competition flight can drive the
     * camera exactly like a visitor would. Inert unless a flight is armed.
     * ---------------------------------------------------------------- */
    const directorApi: DirectorCanvasApi = {
      getState: () => ({
        region: navigationRegion.kind,
        station:
          navigationRegion.kind === "tunnel"
            ? navigationRegion.from
            : activeStationIndex,
        transitioning: roomTransition !== null,
        focusActive,
      }),
      getBounds: (station) => {
        const runtime =
          stationRuntimes[
            THREE.MathUtils.clamp(station, 0, stationRuntimes.length - 1)
          ];
        const bounds = runtime.navigationBounds;
        return {
          minX: bounds.minX,
          maxX: bounds.maxX,
          minY: bounds.minY,
          maxY: bounds.maxY,
          minZ: bounds.minZ,
          maxZ: bounds.maxZ,
          walkY: bounds.walkY,
          spawnX: bounds.spawn.x,
          spawnY: bounds.spawn.y,
          spawnZ: bounds.spawn.z,
          portalCenterX: bounds.portalCenterX,
        };
      },
      setRoomPose: (x, y, z, yaw, pitch, immediate = false) => {
        if (navigationRegion.kind !== "machine-room" || roomTransition) return;
        manualOverride = true;
        roomPlayerPosition.set(
          THREE.MathUtils.clamp(x, machineRoom.bounds.minX, machineRoom.bounds.maxX),
          THREE.MathUtils.clamp(y, machineRoom.bounds.minY, machineRoom.bounds.maxY),
          THREE.MathUtils.clamp(z, machineRoom.bounds.minZ, machineRoom.bounds.maxZ),
        );
        targetYaw = yaw;
        targetPitch = THREE.MathUtils.clamp(
          pitch,
          -Math.PI * 0.485,
          Math.PI * 0.485,
        );
        if (immediate) {
          glanceYaw = targetYaw;
          glancePitch = targetPitch;
        }
        pendingDollyDistance = 0;
        verticalRoamEnabled = true;
      },
      startDive: (station) => {
        if (navigationRegion.kind !== "machine-room" || roomTransition) {
          return false;
        }
        startRoomDive(machineRoom.unitIndexForStation(station));
        return true;
      },
      poseChamber: (station, x, y, z, yaw, pitch, immediate = false) => {
        const index = THREE.MathUtils.clamp(
          station,
          0,
          stationRuntimes.length - 1,
        );
        const bounds = stationRuntimes[index].navigationBounds;
        if (
          navigationRegion.kind !== "chamber" ||
          activeStationIndex !== index
        ) {
          navigationRegion = { kind: "chamber" };
          activeStationIndex = index;
          cameraProgress = stationAnchor(index);
          renderedRouteProgress = cameraProgress;
          cameraLight.intensity = 2.1;
          latest.current.onProgressChange(cameraProgress);
        }
        manualOverride = true;
        localPlayerPosition.set(
          THREE.MathUtils.clamp(x, bounds.minX + 0.45, bounds.maxX - 0.45),
          THREE.MathUtils.clamp(y, bounds.minY, bounds.maxY),
          THREE.MathUtils.clamp(z, bounds.minZ + 0.45, bounds.maxZ - 0.45),
        );
        targetYaw = yaw;
        targetPitch = THREE.MathUtils.clamp(
          pitch,
          -Math.PI * 0.485,
          Math.PI * 0.485,
        );
        if (immediate) {
          glanceYaw = targetYaw;
          glancePitch = targetPitch;
        }
        pendingDollyDistance = 0;
        verticalRoamEnabled = true;
      },
      press: (codes) => {
        for (const code of codes) pressedKeys.add(code);
      },
      release: (codes) => {
        if (!codes) {
          clearPressedKeys();
          return;
        }
        for (const code of codes) pressedKeys.delete(code);
      },
      spotlightCenter: () => {
        const pick = pickAssistantTarget(lastRenderedStation, assistantCenterNdc);
        if (!pick) return false;
        flashLaser(pick.hitPoint, true);
        return enterFocus(lastRenderedStation, pick);
      },
      releaseSpotlight: () => {
        exitFocus();
      },
      resetToRoom: () => {
        roomTransition = null;
        roomVeilOpacity = 0;
        exitFocus();
        clearPressedKeys();
        enterRoomAt(0);
        roomPlayerPosition.copy(machineRoom.bounds.spawn);
        targetYaw = machineRoom.bounds.spawnYaw;
        targetPitch = machineRoom.bounds.spawnPitch;
        glanceYaw = targetYaw;
        glancePitch = targetPitch;
        roomReferenceStationIndex = 0;
      },
      riseToRoom: () => {
        beginReturnToRoom();
      },
      getRoomPose: () =>
        navigationRegion.kind === "machine-room"
          ? {
              x: roomPlayerPosition.x,
              y: roomPlayerPosition.y,
              z: roomPlayerPosition.z,
              yaw: targetYaw,
              pitch: targetPitch,
            }
          : null,
      getUnitAnchor: (station) => {
        const unit =
          machineRoom.units[machineRoom.unitIndexForStation(station)];
        return {
          focusX: unit.focusLocal.x,
          focusY: unit.focusLocal.y,
          focusZ: unit.focusLocal.z,
          overlookX: unit.overlookLocal.x,
          overlookY: unit.overlookLocal.y,
          overlookZ: unit.overlookLocal.z,
        };
      },
    };
    registerDirectorCanvas(directorApi);

    let disposed = false;
    let frameHandle = 0;
    let lastTime = performance.now();
    let elapsed = 0;
    let processStationIndex = activeStationIndex;
    let processStationStartedAt = 0;
    const reduceProcessMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let announcedStation = latest.current.stationIndex;
    let previousDetailMode = latest.current.detailMode;
    // Phase-colored head light, pulled toward a soft neutral so phase
    // identity reads on nearby surfaces without over-saturating the halls.
    const cameraWarmTint = new THREE.Color("#d9e6f2");
    const routePoint = new THREE.Vector3();
    const lookPoint = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const cameraPosition = new THREE.Vector3();
    const cameraMatrix = new THREE.Matrix4();
    const baseQuaternion = new THREE.Quaternion();
    const glanceQuaternion = new THREE.Quaternion();
    const glanceEuler = new THREE.Euler(0, 0, 0, "YXZ");
    const localForward = new THREE.Vector3();
    const localRight = new THREE.Vector3();
    const localMove = new THREE.Vector3();
    const dollyDirection = new THREE.Vector3();

    const renderFrame = (now: number) => {
      if (disposed) return;
      const delta = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      elapsed += delta;
      const state = latest.current;
      const targetProgress = THREE.MathUtils.clamp(state.progress, 0, 1);

      if (
        state.playing &&
        !wasPlaying &&
        state.rideMode !== "explore"
      ) {
        // Starting the guided ride always leaves the machine room (and
        // cancels any half-finished dive) so playback can take the camera.
        if (navigationRegion.kind === "machine-room" || roomTransition) {
          roomTransition = null;
          roomVeilOpacity = 0;
          camera.fov = 60;
          cameraLight.intensity = 2.1;
        }
        manualOverride = false;
        navigationRegion = { kind: "chamber" };
        clearPressedKeys();
        verticalRoamEnabled = false;
      } else if (
        navigationRegion.kind !== "machine-room" &&
        state.rideMode === "explore" &&
        !manualOverride
      ) {
        seedManualPoseFromCamera();
        manualOverride = true;
      }
      wasPlaying = state.playing;

      const inMachineRoom = navigationRegion.kind === "machine-room";
      if (!inMachineRoom || roomTransition) reportMachineRoomCue(null);
      // The fly-in only owns the opening moment in the room; any path that
      // leaves the room (guided ride, a dive) retires it for good so it can
      // never replay on a later return.
      if (!inMachineRoom) introActive = false;
      const guidedRide = !manualOverride && !inMachineRoom;
      let stationFloat = cameraProgress * stationDenominator;
      let currentStation = activeStationIndex;

      if (inMachineRoom && roomTransition && roomTransition.mode === "dive") {
        // The dive owns the camera: fly into the aimed miniature while the
        // veil closes, then cut to the full-size chamber underneath it.
        reportNavigationMode("machine-room");
        const dive = roomTransition;
        dive.t = Math.min(1, dive.t + delta / MACHINE_ROOM_DIVE_SECONDS);
        const eased = dive.t * dive.t * (3 - 2 * dive.t);
        camera.position.lerpVectors(dive.fromPosition, dive.toPosition, eased);
        camera.quaternion
          .copy(dive.fromQuaternion)
          .slerp(dive.toQuaternion, eased * 0.85);
        camera.fov = THREE.MathUtils.lerp(
          dive.fromFov,
          dive.fromFov * 0.7,
          eased,
        );
        roomVeilOpacity = THREE.MathUtils.clamp((dive.t - 0.58) / 0.32, 0, 1);
        cameraLight.position.copy(camera.position);
        currentStation = activeStationIndex;
        stationFloat = currentStation;
        if (dive.t >= 1) {
          roomVeilOpacity = 1;
          placeIntoChamber(dive.targetStation);
          roomTransition = { mode: "reveal", t: 0 };
        }
      } else if (inMachineRoom && introActive && !roomTransition) {
        // Opening fly-in: glide from the wide establishing shot to the
        // resting pose facing the machine. Fully owns the camera until it
        // finishes or cancelIntro() is called from a manual input.
        reportNavigationMode("machine-room");
        introElapsed += delta;
        const introT = Math.min(1, introElapsed / INTRO_DURATION);
        const introEased = introT * introT * (3 - 2 * introT);
        roomPlayerPosition.lerpVectors(
          INTRO_START_POSITION,
          INTRO_END_POSITION,
          introEased,
        );
        glanceYaw = THREE.MathUtils.lerp(
          INTRO_START_YAW,
          INTRO_END_YAW,
          introEased,
        );
        glancePitch = THREE.MathUtils.lerp(
          INTRO_START_PITCH,
          INTRO_END_PITCH,
          introEased,
        );
        // Keep the free-roam targets in lock-step so a mid-fly cancel is seamless.
        targetYaw = glanceYaw;
        targetPitch = glancePitch;
        glanceEuler.set(glancePitch, glanceYaw, 0, "YXZ");
        glanceQuaternion.setFromEuler(glanceEuler);
        roomHoveredIndex = -1;
        reportMachineRoomCue(null);
        currentStation = activeStationIndex;
        stationFloat = currentStation;
        cameraPosition.copy(roomPlayerPosition).add(MACHINE_ROOM_ORIGIN);
        camera.position.copy(cameraPosition);
        camera.quaternion.copy(glanceQuaternion);
        camera.fov = THREE.MathUtils.lerp(
          INTRO_START_FOV,
          MACHINE_ROOM_FOV,
          introEased,
        );
        cameraLight.position
          .copy(cameraPosition)
          .addScaledVector(WORLD_UP, 0.8);
        cameraLight.color.set("#ffd9b0");
        if (introT >= 1) introActive = false;
      } else if (inMachineRoom) {
        reportNavigationMode("machine-room");
        glanceYaw = THREE.MathUtils.damp(glanceYaw, targetYaw, 18, delta);
        glancePitch = THREE.MathUtils.damp(glancePitch, targetPitch, 18, delta);

        let frameDollyDistance = 0;
        if (Math.abs(pendingDollyDistance) > 0.001) {
          frameDollyDistance =
            pendingDollyDistance * (1 - Math.exp(-14 * delta));
          pendingDollyDistance -= frameDollyDistance;
        } else {
          pendingDollyDistance = 0;
        }
        // The chamber dolly impulse is tuned for 50 m halls; the room is
        // domestic scale, so soften it into a lean.
        frameDollyDistance *= 0.38;

        const bounds = machineRoom.bounds;

        glanceEuler.set(glancePitch, glanceYaw, 0, "YXZ");
        glanceQuaternion.setFromEuler(glanceEuler);

        // Free-aim selection: measure how far the view direction sits
        // outside each unit's silhouette cone and take the nearest. This
        // follows the gaze exactly — no proxy boxes, so no sticky labels —
        // and switching units is instant.
        machineAimForward.set(0, 0, -1).applyQuaternion(glanceQuaternion);
        let aimBestIndex = -1;
        let aimBestScore = Infinity;
        machineRoom.units.forEach((unit, unitIndex) => {
          let unitScore = Infinity;
          for (const aimPoint of unit.aimLocals) {
            machineAimToUnit.copy(aimPoint).sub(roomPlayerPosition);
            const aimDistance = Math.max(machineAimToUnit.length(), 1e-4);
            machineAimToUnit.multiplyScalar(1 / aimDistance);
            const aimAngle = Math.acos(
              THREE.MathUtils.clamp(
                machineAimForward.dot(machineAimToUnit),
                -1,
                1,
              ),
            );
            const silhouette = Math.atan2(unit.aimRadius, aimDistance);
            unitScore = Math.min(unitScore, aimAngle - silhouette);
          }
          if (unitScore < aimBestScore) {
            aimBestScore = unitScore;
            aimBestIndex = unitIndex;
          }
        });
        const aimHoverIndex =
          aimBestScore <= MACHINE_AIM_HOVER_MARGIN ? aimBestIndex : -1;

        // Zoom lock: the label and dive never latch while merely looking
        // around. Only an inward scroll locks onto whatever chamber is
        // nearest the crosshair; scrolling out, glancing well away, or a
        // short idle releases it.
        if (frameDollyDistance > 0.0001) {
          if (roomZoomLockIndex < 0 && aimBestScore <= MACHINE_AIM_LOCK_MARGIN) {
            roomZoomLockIndex = aimBestIndex;
          }
          if (roomZoomLockIndex >= 0) roomZoomLockCooldown = MACHINE_ZOOM_LOCK_GRACE;
        } else if (frameDollyDistance < -0.0001) {
          roomZoomLockIndex = -1;
          roomZoomLockCooldown = 0;
        } else if (roomZoomLockIndex >= 0) {
          roomZoomLockCooldown -= delta;
          if (roomZoomLockCooldown <= 0) roomZoomLockIndex = -1;
        }
        if (roomZoomLockIndex >= 0) {
          const lockedUnit = machineRoom.units[roomZoomLockIndex];
          machineAimToUnit
            .copy(lockedUnit.focusLocal)
            .sub(roomPlayerPosition)
            .normalize();
          const lockedAngle = Math.acos(
            THREE.MathUtils.clamp(
              machineAimForward.dot(machineAimToUnit),
              -1,
              1,
            ),
          );
          if (lockedAngle > MACHINE_AIM_RELEASE_ANGLE) {
            roomZoomLockIndex = -1;
            roomZoomLockCooldown = 0;
          }
        }
        roomHoveredIndex =
          roomZoomLockIndex >= 0 ? roomZoomLockIndex : aimHoverIndex;

        const nearMachineTable =
          Math.hypot(roomPlayerPosition.x, roomPlayerPosition.z) <=
          MACHINE_ROOM_CUE_RADIUS;
        if (!roomTransition && nearMachineTable && roomHoveredIndex >= 0) {
          const hoveredUnit = machineRoom.units[roomHoveredIndex];
          reportMachineRoomCue({
            unitId: hoveredUnit.id,
            label: hoveredUnit.label,
            approaching: roomZoomLockIndex === roomHoveredIndex,
          });
        } else {
          reportMachineRoomCue(null);
        }

        if (frameDollyDistance !== 0) {
          dollyDirection
            .set(0, 0, -1)
            .applyQuaternion(glanceQuaternion)
            .normalize();
          if (roomZoomLockIndex >= 0 && frameDollyDistance > 0) {
            // A locked zoom bends the path onto the unit itself, so
            // "scroll into the chamber" works from any angle.
            const lockedUnit = machineRoom.units[roomZoomLockIndex];
            localMove
              .copy(lockedUnit.focusLocal)
              .sub(roomPlayerPosition)
              .normalize();
            dollyDirection.lerp(localMove, 0.75).normalize();
          }
          roomPlayerPosition.addScaledVector(
            dollyDirection,
            frameDollyDistance,
          );
          roomPlayerPosition.x = THREE.MathUtils.clamp(
            roomPlayerPosition.x,
            -6.5,
            6.5,
          );
          roomPlayerPosition.z = THREE.MathUtils.clamp(
            roomPlayerPosition.z,
            -5.1,
            5.1,
          );
          roomPlayerPosition.y = THREE.MathUtils.clamp(
            roomPlayerPosition.y,
            bounds.minY,
            bounds.maxY,
          );
        }

        const movementStartX = roomPlayerPosition.x;
        const movementStartZ = roomPlayerPosition.z;
        const forwardIntent =
          (pressedKeys.has("KeyW") ? 1 : 0) -
          (pressedKeys.has("KeyS") ? 1 : 0);
        const strafeIntent =
          (pressedKeys.has("KeyD") ? 1 : 0) -
          (pressedKeys.has("KeyA") ? 1 : 0);
        if (forwardIntent !== 0 || strafeIntent !== 0) {
          verticalRoamEnabled = false;
          localForward.set(-Math.sin(glanceYaw), 0, -Math.cos(glanceYaw));
          localRight.set(Math.cos(glanceYaw), 0, -Math.sin(glanceYaw));
          localMove
            .copy(localForward)
            .multiplyScalar(forwardIntent)
            .addScaledVector(localRight, strafeIntent)
            .normalize();
          const sprinting =
            pressedKeys.has("ShiftLeft") || pressedKeys.has("ShiftRight");
          const walkSpeed = sprinting ? 7.4 : 4.4;
          const blockedAt = (x: number, z: number) =>
            bounds.blockers.some(
              (blocker) =>
                x > blocker.minX - MACHINE_ROOM_PLAYER_CLEARANCE &&
                x < blocker.maxX + MACHINE_ROOM_PLAYER_CLEARANCE &&
                z > blocker.minZ - MACHINE_ROOM_PLAYER_CLEARANCE &&
                z < blocker.maxZ + MACHINE_ROOM_PLAYER_CLEARANCE,
            );
          const nextX = THREE.MathUtils.clamp(
            roomPlayerPosition.x + localMove.x * walkSpeed * delta,
            bounds.minX,
            bounds.maxX,
          );
          if (!blockedAt(nextX, roomPlayerPosition.z)) {
            roomPlayerPosition.x = nextX;
          }
          const nextZ = THREE.MathUtils.clamp(
            roomPlayerPosition.z + localMove.z * walkSpeed * delta,
            bounds.minZ,
            bounds.maxZ,
          );
          if (!blockedAt(roomPlayerPosition.x, nextZ)) {
            roomPlayerPosition.z = nextZ;
          }
          if (
            roomPlayerPosition.x !== movementStartX ||
            roomPlayerPosition.z !== movementStartZ
          ) {
            reportMovementDiscovered();
          }
        }

        if (!verticalRoamEnabled) {
          roomPlayerPosition.y = THREE.MathUtils.damp(
            roomPlayerPosition.y,
            bounds.walkY,
            5,
            delta,
          );
        }

        currentStation = activeStationIndex;
        stationFloat = currentStation;
        cameraPosition.copy(roomPlayerPosition).add(MACHINE_ROOM_ORIGIN);
        camera.position.copy(cameraPosition);
        camera.quaternion.copy(glanceQuaternion);
        cameraLight.position
          .copy(cameraPosition)
          .addScaledVector(WORLD_UP, 0.8);
        cameraLight.color.set("#ffd9b0");
        camera.fov = THREE.MathUtils.damp(
          camera.fov,
          MACHINE_ROOM_FOV,
          8,
          delta,
        );

        // Entry checks run after the camera is composed so a region change
        // never renders one frame of mismatched coordinates. Only a
        // scroll-locked approach can dive — walking or glancing never does.
        if (!roomTransition && roomZoomLockIndex >= 0) {
          const lockedUnit = machineRoom.units[roomZoomLockIndex];
          if (
            roomPlayerPosition.distanceTo(lockedUnit.focusLocal) <
            lockedUnit.approachRadius
          ) {
            startRoomDive(roomZoomLockIndex);
          }
        }
        if (
          !roomTransition &&
          state.stationIndex !== roomReferenceStationIndex &&
          !isDirectorDriving()
        ) {
          // HUD scrubbing or voice navigation while standing in the room
          // jumps straight into the requested chamber under a veiled cut.
          // (The demo director resets progress while composing its opening
          // shot, so its flights must not trigger this veiled jump.)
          roomVeilOpacity = 1;
          placeIntoChamber(state.stationIndex);
          roomTransition = { mode: "reveal", t: 0 };
        }
      } else if (guidedRide) {
        reportNavigationMode("guided-ride");
        cameraProgress = THREE.MathUtils.damp(cameraProgress, targetProgress, 10, delta);
        stationFloat = cameraProgress * stationDenominator;
        currentStation = THREE.MathUtils.clamp(
          Math.round(stationFloat),
          0,
          TRAINING_STATIONS.length - 1,
        );
        activeStationIndex = currentStation;
        localPlayerPosition.copy(
          stationRuntimes[currentStation].navigationBounds.spawn,
        );

        const currentStationData = TRAINING_STATIONS[currentStation];
        const isCorpusChamber = currentStation === 1;
        const isCorpusOverlook =
          isCorpusChamber && state.dataPrepProgress < 0.999;
        if (isCorpusOverlook) {
          const corpusRuntime = stationRuntimes[currentStation];
          corpusRuntime.group.updateMatrixWorld(true);
          const arrivalProgress = easedProgress(
            state.dataPrepProgress,
            0,
            0.07,
          );
          const routeArrivalProgress = THREE.MathUtils.clamp(
            cameraProgress - DEFAULT_GUIDED_VIEW_DISTANCE / routeLength,
            0,
            1,
          );
          route.getPointAt(routeArrivalProgress, routePoint);
          route.getTangentAt(routeArrivalProgress, tangent).normalize();
          right.crossVectors(tangent, WORLD_UP).normalize();
          up.crossVectors(right, tangent).normalize();
          cameraPosition.copy(routePoint).addScaledVector(up, 2.5);
          lookPoint.copy(corpusRuntime.navigationBounds.spawn);
          corpusRuntime.group.localToWorld(lookPoint);
          cameraPosition.lerp(lookPoint, arrivalProgress);
          const corpusEntranceProgress =
            stationAnchor(currentStation) -
            corpusRuntime.navigationBounds.maxZ / routeLength;
          renderedRouteProgress = THREE.MathUtils.lerp(
            routeArrivalProgress,
            corpusEntranceProgress,
            arrivalProgress,
          );
          lookPoint.set(0, -0.8, 1);
          corpusRuntime.group.localToWorld(lookPoint);
          up.copy(WORLD_UP).applyQuaternion(corpusRuntime.group.quaternion).normalize();
          cameraMatrix.lookAt(cameraPosition, lookPoint, up);
          baseQuaternion.setFromRotationMatrix(cameraMatrix);
        } else {
          const guidedView =
            stationRuntimes[currentStation].navigationBounds;
          const routeCameraProgress =
            cameraProgress - guidedView.guidedViewDistance / routeLength;
          renderedRouteProgress = routeCameraProgress;
          if (routeCameraProgress < 0) {
            route.getPointAt(0, routePoint);
            route.getTangentAt(0, tangent).normalize();
            routePoint.addScaledVector(tangent, routeCameraProgress * routeLength);
          } else {
            route.getPointAt(routeCameraProgress, routePoint);
            route.getTangentAt(routeCameraProgress, tangent).normalize();
          }
          right.crossVectors(tangent, WORLD_UP).normalize();
          up.crossVectors(right, tangent).normalize();
          const cameraLift = isCorpusChamber
            ? -2.95
            : chamberEyeLift(currentStationData.cameraHint);
          const branchOffset =
            !isCorpusChamber && currentStationData.branch
              ? state.branchSide === "left"
                ? -0.52
                : 0.52
              : 0;
          cameraPosition
            .copy(routePoint)
            .addScaledVector(up, cameraLift)
            .addScaledVector(
              right,
              isCorpusChamber ? 0 : 0.32 + branchOffset,
            );
          const lookProgress = THREE.MathUtils.clamp(cameraProgress, 0, 1);
          route.getPointAt(lookProgress, lookPoint);
          if (lookProgress === routeCameraProgress) {
            lookPoint.copy(routePoint).add(tangent);
          }
          lookPoint.addScaledVector(up, guidedView.guidedFocusY);
          cameraMatrix.lookAt(cameraPosition, lookPoint, up);
          baseQuaternion.setFromRotationMatrix(cameraMatrix);
        }

        glanceYaw = THREE.MathUtils.damp(glanceYaw, targetYaw, 14, delta);
        glancePitch = THREE.MathUtils.damp(glancePitch, targetPitch, 14, delta);
        glanceEuler.set(glancePitch, glanceYaw, 0, "YXZ");
        glanceQuaternion.setFromEuler(glanceEuler);
        camera.position.copy(cameraPosition);
        camera.quaternion.copy(baseQuaternion).multiply(glanceQuaternion);
        cameraLight.position.copy(cameraPosition).addScaledVector(up, 2.2);
        cameraLight.color
          .copy(phaseColor(currentStationData.phase))
          .lerp(cameraWarmTint, 0.38);
        const targetFov =
          stationRuntimes[currentStation].navigationBounds.guidedFov;
        camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 6, delta);
      } else {
        if (
          navigationRegion.kind === "chamber" &&
          state.stationIndex !== activeStationIndex &&
          !isDirectorDriving()
        ) {
          // HUD/voice navigation while free-roaming. Skipped for director
          // flights: the director moves stations imperatively and React's
          // stationIndex may lag a frame behind, which would otherwise
          // yank the camera back to the previous chamber's spawn.
          resetManualPose(state.stationIndex);
        }

        glanceYaw = THREE.MathUtils.damp(glanceYaw, targetYaw, 18, delta);
        glancePitch = THREE.MathUtils.damp(glancePitch, targetPitch, 18, delta);
        let frameDollyDistance = 0;
        if (Math.abs(pendingDollyDistance) > 0.001) {
          frameDollyDistance =
            pendingDollyDistance * (1 - Math.exp(-14 * delta));
          pendingDollyDistance -= frameDollyDistance;
        } else {
          pendingDollyDistance = 0;
        }

        if (navigationRegion.kind === "chamber") {
          reportNavigationMode("free-roam");
          const bounds = stationRuntimes[activeStationIndex].navigationBounds;
          if (!verticalRoamEnabled) {
            const groundedY = THREE.MathUtils.damp(
              localPlayerPosition.y,
              bounds.walkY,
              4,
              delta,
            );
            moveWithinChamber(0, groundedY - localPlayerPosition.y, 0);
          }

          if (frameDollyDistance !== 0) {
            glanceEuler.set(glancePitch, glanceYaw, 0, "YXZ");
            glanceQuaternion.setFromEuler(glanceEuler);
            dollyDirection
              .set(0, 0, -1)
              .applyQuaternion(glanceQuaternion)
              .normalize();
            moveWithinChamber(
              dollyDirection.x * frameDollyDistance,
              dollyDirection.y * frameDollyDistance,
              dollyDirection.z * frameDollyDistance,
            );
            if (navigationRegion.kind !== "chamber") {
              frameDollyDistance = 0;
            }
          }

          const forwardIntent =
            (pressedKeys.has("KeyW") ? 1 : 0) -
            (pressedKeys.has("KeyS") ? 1 : 0);
          const strafeIntent =
            (pressedKeys.has("KeyD") ? 1 : 0) -
            (pressedKeys.has("KeyA") ? 1 : 0);

          if (
            navigationRegion.kind === "chamber" &&
            (forwardIntent !== 0 || strafeIntent !== 0)
          ) {
            localForward.set(-Math.sin(glanceYaw), 0, -Math.cos(glanceYaw));
            localRight.set(Math.cos(glanceYaw), 0, -Math.sin(glanceYaw));
            localMove
              .copy(localForward)
              .multiplyScalar(forwardIntent)
              .addScaledVector(localRight, strafeIntent)
              .normalize();
            const sprinting =
              pressedKeys.has("ShiftLeft") || pressedKeys.has("ShiftRight");
            const movementSpeed = sprinting ? 22.5 : 12.75;
            moveWithinChamber(
              localMove.x * movementSpeed * delta,
              0,
              localMove.z * movementSpeed * delta,
            );
          }
        }

        if (navigationRegion.kind === "tunnel") {
          reportNavigationMode("tunnel");
          const tunnel = navigationRegion;
          // Carry the eye at the raised chamber viewing height through the
          // tunnel: blend from the origin chamber's rest height to the
          // destination's across the run, so the corridor is travelled level
          // with the exhibits (not along its floor) and arrival at either end
          // lands already at the chamber's rest height.
          const fromEyeY = stationRuntimes[tunnel.from].navigationBounds.walkY;
          const toEyeY = stationRuntimes[tunnel.to].navigationBounds.walkY;
          const tunnelSpan = tunnel.endProgress - tunnel.startProgress;
          const tunnelBlend =
            Math.abs(tunnelSpan) > 1e-6
              ? THREE.MathUtils.clamp(
                  (tunnel.progress - tunnel.startProgress) / tunnelSpan,
                  0,
                  1,
                )
              : 0;
          tunnel.eyeOffset = THREE.MathUtils.damp(
            tunnel.eyeOffset,
            THREE.MathUtils.lerp(fromEyeY, toEyeY, tunnelBlend),
            4,
            delta,
          );
          const travelDirection = Math.sign(
            tunnel.endProgress - tunnel.startProgress,
          );
          const tunnelIntent =
            (pressedKeys.has("KeyW") ? 1 : 0) -
            (pressedKeys.has("KeyS") ? 1 : 0);
          const sprinting =
            pressedKeys.has("ShiftLeft") || pressedKeys.has("ShiftRight");
          const tunnelSpeed = sprinting ? 39 : 24;
          glanceEuler.set(glancePitch, glanceYaw, 0, "YXZ");
          glanceQuaternion.setFromEuler(glanceEuler);
          dollyDirection
            .set(0, 0, -1)
            .applyQuaternion(glanceQuaternion)
            .normalize();
          const dollyDistanceAlongTunnel =
            frameDollyDistance * -dollyDirection.z;
          const commandedDistance =
            tunnelIntent * tunnelSpeed * delta + dollyDistanceAlongTunnel;
          if (Math.abs(commandedDistance) > 0.0001) {
            tunnel.progress +=
              (travelDirection * commandedDistance) / routeLength;
            const routeDistance =
              (tunnel.progress - tunnel.startProgress) * travelDirection;
            const totalDistance = Math.abs(
              tunnel.endProgress - tunnel.startProgress,
            );
            const arrivingAtDestination =
              commandedDistance > 0 && routeDistance >= totalDistance;
            const returningToOrigin =
              commandedDistance < 0 && routeDistance <= 0;
            if (arrivingAtDestination || returningToOrigin) {
              const destination = arrivingAtDestination ? tunnel.to : tunnel.from;
              const travelingForward = tunnel.to > tunnel.from;
              const arrivalProgress = arrivingAtDestination
                ? tunnel.endProgress
                : tunnel.startProgress;
              route.getPointAt(
                THREE.MathUtils.clamp(arrivalProgress, 0, 1),
                routePoint,
              );
              route
                .getTangentAt(
                  THREE.MathUtils.clamp(arrivalProgress, 0, 1),
                  tangent,
                )
                .normalize();
              right.crossVectors(tangent, WORLD_UP).normalize();
              up.crossVectors(right, tangent).normalize();
              const arrivalLocalPosition = routePoint
                .clone()
                .addScaledVector(up, tunnel.eyeOffset)
                .addScaledVector(right, tunnel.lateralOffset);
              const destinationRuntime = stationRuntimes[destination];
              destinationRuntime.group.updateMatrixWorld(true);
              destinationRuntime.group.worldToLocal(arrivalLocalPosition);
              activeStationIndex = destination;
              navigationRegion = { kind: "chamber" };
              const destinationBounds = destinationRuntime.navigationBounds;
              localPlayerPosition.copy(arrivalLocalPosition);
              localPlayerPosition.x = THREE.MathUtils.clamp(
                localPlayerPosition.x,
                destinationBounds.minX + 0.45,
                destinationBounds.maxX - 0.45,
              );
              if (arrivingAtDestination) {
                localPlayerPosition.z = travelingForward
                  ? destinationBounds.maxZ - 1.4
                  : destinationBounds.minZ + 1.4;
                targetYaw = travelingForward ? 0 : Math.PI;
              } else {
                localPlayerPosition.z = travelingForward
                  ? destinationBounds.minZ + 1.4
                  : destinationBounds.maxZ - 1.4;
                targetYaw = travelingForward ? Math.PI : 0;
              }
              localPlayerPosition.y = THREE.MathUtils.clamp(
                localPlayerPosition.y,
                destinationBounds.minY,
                destinationBounds.maxY,
              );
              targetPitch = 0;
              glanceYaw = targetYaw;
              glancePitch = 0;
              pendingDollyDistance = 0;
              verticalRoamEnabled = false;
              cameraProgress = stationAnchor(destination);
              state.onProgressChange(cameraProgress);
            } else {
              tunnel.progress = THREE.MathUtils.clamp(
                tunnel.progress,
                Math.min(tunnel.startProgress, tunnel.endProgress),
                Math.max(tunnel.startProgress, tunnel.endProgress),
              );
            }
          }
        }

        if (navigationRegion.kind === "chamber") {
          reportNavigationMode("free-roam");
          currentStation = activeStationIndex;
          stationFloat = currentStation;
          cameraProgress = stationAnchor(currentStation);
          renderedRouteProgress = cameraProgress;
          const runtime = stationRuntimes[currentStation];
          runtime.group.updateMatrixWorld(true);
          cameraPosition.copy(localPlayerPosition);
          runtime.group.localToWorld(cameraPosition);
          baseQuaternion.copy(runtime.group.quaternion);
          glanceEuler.set(glancePitch, glanceYaw, 0, "YXZ");
          glanceQuaternion.setFromEuler(glanceEuler);
          camera.position.copy(cameraPosition);
          camera.quaternion.copy(baseQuaternion).multiply(glanceQuaternion);
          up.copy(WORLD_UP).applyQuaternion(runtime.group.quaternion).normalize();
          cameraLight.position.copy(cameraPosition).addScaledVector(up, 1.1);
          cameraLight.color
            .copy(phaseColor(TRAINING_STATIONS[currentStation].phase))
            .lerp(cameraWarmTint, 0.38);
          const targetFov = currentStation === 1 ? 70 : 60;
          camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 8, delta);
        } else if (navigationRegion.kind === "tunnel") {
          const tunnel = navigationRegion;
          cameraProgress = tunnel.progress;
          renderedRouteProgress = cameraProgress;
          stationFloat = cameraProgress * stationDenominator;
          currentStation = tunnel.from;
          route.getPointAt(THREE.MathUtils.clamp(cameraProgress, 0, 1), routePoint);
          route
            .getTangentAt(THREE.MathUtils.clamp(cameraProgress, 0, 1), tangent)
            .normalize();
          const travelDirection = Math.sign(
            tunnel.endProgress - tunnel.startProgress,
          );
          right.crossVectors(tangent, WORLD_UP).normalize();
          up.crossVectors(right, tangent).normalize();
          cameraPosition
            .copy(routePoint)
            .addScaledVector(up, tunnel.eyeOffset)
            .addScaledVector(right, tunnel.lateralOffset);
          lookPoint.copy(cameraPosition).addScaledVector(tangent, travelDirection);
          cameraMatrix.lookAt(cameraPosition, lookPoint, up);
          baseQuaternion.setFromRotationMatrix(cameraMatrix);
          glanceEuler.set(glancePitch, glanceYaw, 0, "YXZ");
          glanceQuaternion.setFromEuler(glanceEuler);
          camera.position.copy(cameraPosition);
          camera.quaternion.copy(baseQuaternion).multiply(glanceQuaternion);
          cameraLight.position.copy(cameraPosition).addScaledVector(up, 1.1);
          cameraLight.color
            .copy(phaseColor(TRAINING_STATIONS[tunnel.to].phase))
            .lerp(cameraWarmTint, 0.38);
          camera.fov = THREE.MathUtils.damp(camera.fov, 62, 8, delta);
        }
      }

      const currentStationData = TRAINING_STATIONS[currentStation];
      if (currentStation !== processStationIndex) {
        processStationIndex = currentStation;
        processStationStartedAt = elapsed;
      }
      const chamberProcessElapsed = positiveModulo(
        elapsed - processStationStartedAt,
        PROCESS_CHAMBER_CYCLE_SECONDS,
      );
      const chamberProcessProgress = reduceProcessMotion
        ? 1
        : Math.min(
            1,
            chamberProcessElapsed / (PROCESS_CHAMBER_CYCLE_SECONDS - 3),
          );
      const guidedProcessProgress = reduceProcessMotion
        ? 1
        : THREE.MathUtils.clamp(
            currentStation === 0
              ? stationFloat * 2
              : stationFloat - currentStation + 0.5,
            0,
            1,
          );
      if (currentStation !== announcedStation) {
        announcedStation = currentStation;
        state.onStationChange(currentStation);
      }

      if (state.detailMode !== previousDetailMode) {
        updateDetailVisibility(detailObjects, state.detailMode);
        previousDetailMode = state.detailMode;
      }
      camera.updateProjectionMatrix();

      // Region may have changed mid-frame (dive completion, veiled jump), so
      // recompute room visibility here rather than reusing `inMachineRoom`.
      const roomVisible = navigationRegion.kind === "machine-room";
      const trainingConsoleDistance = roomPlayerPosition.distanceTo(
        machineRoom.trainingConsole.approachLocal,
      );
      const trainingConsoleWakeRadius =
        machineRoom.trainingConsole.activationRadius +
        (reportedTrainingConsoleNearby ? 0.35 : 0);
      const trainingConsoleIsNearby =
        roomVisible &&
        !roomTransition &&
        trainingConsoleDistance <= trainingConsoleWakeRadius;
      reportTrainingConsoleProximity(trainingConsoleIsNearby);
      machineRoom.group.visible = roomVisible;
      corridorSystem.visible = !roomVisible;
      routeBeacon.group.visible = !roomVisible;
      if (roomVisible) {
        machineRoom.update(
          elapsed,
          delta,
          roomTransition ? -1 : roomHoveredIndex,
          !reduceProcessMotion,
          trainingConsoleIsNearby,
        );
      }

      const motionTime = cameraProgress * 76 + elapsed * 0.12;
      animations.forEach((record) => applyAnimation(record, motionTime));
      stationRuntimes.forEach((runtime, index) => {
        const stationDistance = Math.abs(stationFloat - index);
        runtime.group.visible = roomVisible
          ? false
          : guidedRide
            ? stationDistance < 0.94
            : navigationRegion.kind === "tunnel"
              ? index === navigationRegion.from || index === navigationRegion.to
              : index === activeStationIndex;
        const localPulse = Math.exp(-stationDistance * 1.65);
        runtime.phaseMaterials.forEach((material, materialIndex) => {
          material.emissiveIntensity =
            (materialIndex === 2 ? 0.68 : 0.46) +
            localPulse * (0.34 + Math.sin(motionTime * 0.8 + materialIndex) * 0.08);
        });
        const directorProcess = getDirectorProcessOverride();
        const runtimeProgress =
          index === 1
            ? state.dataPrepProgress
            : index === currentStation
              ? directorProcess !== null
                ? directorProcess
                : guidedRide && state.playing
                  ? guidedProcessProgress
                  : chamberProcessProgress
              : 0;
        if (index === currentStation && !roomVisible) {
          runtime.update?.(runtimeProgress, elapsed, !reduceProcessMotion);
        }
      });

      (Object.keys(branchMaterials) as BranchSide[]).forEach((side) => {
        const selected = side === state.branchSide;
        branchMaterials[side].forEach((material) => {
          const branchMaterialInstance = material as THREE.Material & { opacity: number };
          const baseOpacity = (material.userData.baseOpacity as number | undefined) ?? 1;
          const targetOpacity = baseOpacity * (selected ? 1 : 0.42);
          branchMaterialInstance.opacity = THREE.MathUtils.damp(
            branchMaterialInstance.opacity,
            targetOpacity,
            9,
            delta,
          );
          material.depthWrite = selected;
        });
      });

      // Visitor laser pointer + spotlight stage run regardless of whether
      // the voice guide is connected: aiming and magnifying are always
      // available, speech simply requires the guide.
      lastRenderedStation = currentStation;
      if (focusActive && currentStation !== focusStationIndex) exitFocus();
      updateLaserFlash(elapsed, !reduceProcessMotion);

      focusVeilOpacity = THREE.MathUtils.damp(
        focusVeilOpacity,
        focusActive ? 0.55 : 0,
        7,
        delta,
      );
      focusVeil.material.opacity = focusVeilOpacity;
      focusVeil.mesh.visible = focusVeilOpacity > 0.01;
      if (focusVeil.mesh.visible) {
        const veilHeight =
          2 *
          Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) *
          FOCUS_VEIL_DISTANCE *
          1.3;
        focusVeil.mesh.scale.set(veilHeight * camera.aspect, veilHeight, 1);
      }

      // Machine-room transition phases that do not own the camera: "rise"
      // veils the chamber before the cut back to the room, and the two
      // reveal phases fade the veil away after a cut.
      if (roomTransition && roomTransition.mode !== "dive") {
        if (roomTransition.mode === "rise") {
          roomTransition.t = Math.min(
            1,
            roomTransition.t + delta / MACHINE_ROOM_RISE_SECONDS,
          );
          roomVeilOpacity = roomTransition.t;
          if (roomTransition.t >= 1) {
            enterRoomAt(roomTransition.targetUnitIndex);
            roomVeilOpacity = 1;
            roomTransition = { mode: "room-reveal", t: 0 };
          }
        } else {
          roomTransition.t = Math.min(
            1,
            roomTransition.t + delta / MACHINE_ROOM_REVEAL_SECONDS,
          );
          roomVeilOpacity = 1 - roomTransition.t;
          if (roomTransition.t >= 1) {
            roomVeilOpacity = 0;
            roomTransition = null;
          }
        }
      }
      transitionVeil.material.opacity = roomVeilOpacity;
      transitionVeil.mesh.visible = roomVeilOpacity > 0.01;
      if (transitionVeil.mesh.visible) {
        const veilHeight =
          2 *
          Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) *
          FOCUS_VEIL_DISTANCE *
          1.3;
        transitionVeil.mesh.scale.set(veilHeight * camera.aspect, veilHeight, 1);
      }
      if (focusActive) {
        // Gentle sway instead of a full turntable so flat exhibits such as
        // matrices never turn edge-on to the visitor.
        if (!reduceProcessMotion) {
          focusStage.rotation.y = Math.sin(elapsed * 0.45) * 0.22;
          focusStage.position.y =
            focusCenter.y + Math.sin(elapsed * 1.3) * 0.03;
          focusPedestal.group.rotation.y = elapsed * 0.4;
        }
        assistantTargetWorld.copy(focusStage.position);
        hasAssistantTargetWorld = true;
        assistantTargetWasHit = true;
      }

      if (!state.assistantEnabled) {
        assistantController.group.visible = false;
        assistantReticle.group.visible = false;
        assistantController.follow();
        if (!focusActive) {
          hasAssistantTargetWorld = false;
          assistantTargetWasHit = false;
          reportAssistantTarget(null);
        }
        lastAssistantTravelTargetId = null;
      } else {
        // The guide and its reticle belong to the chambers; both stay hidden
        // while the visitor is in the machine room.
        assistantController.group.visible = !roomVisible;
        if (
          !roomVisible &&
          !state.assistantTargetLocked &&
          !focusActive &&
          elapsed >= nextAssistantSelectionAt
        ) {
          nextAssistantSelectionAt = elapsed + 0.08;
          updateAssistantSelection(currentStation);
        }

        assistantReticle.group.visible =
          !roomVisible &&
          assistantTargetWasHit &&
          hasAssistantTargetWorld &&
          !focusActive;
        if (assistantReticle.group.visible) {
          assistantReticle.group.position.copy(assistantTargetWorld);
          assistantReticle.group.quaternion.copy(camera.quaternion);
          const reticlePulse = reduceProcessMotion
            ? 1
            : 1 + Math.sin(elapsed * 4.8) * 0.12;
          assistantReticle.group.scale.setScalar(reticlePulse);
          assistantReticle.material.opacity =
            state.assistantTargetLocked ? 0.98 : 0.74;
        }

        const selectedTargetId =
          state.assistantTargetId ?? reportedAssistantTargetId;
        if (!hasAssistantTargetWorld) {
          assistantController.follow();
          lastAssistantTravelTargetId = null;
        } else if (state.assistantStatus === "listening") {
          assistantController.listen(assistantTargetWorld);
        } else if (state.assistantStatus === "thinking") {
          assistantController.pointAt(assistantTargetWorld);
        } else if (state.assistantStatus === "speaking") {
          assistantController.speak(assistantTargetWorld);
        } else if (focusActive && focusTravelPending) {
          // Fly to the spotlighted replica and hover beside it, offset by
          // its magnified size so the guide never overlaps the exhibit.
          focusTravelPending = false;
          lastAssistantTravelTargetId = focusTargetId;
          assistantController.travelTo(assistantTargetWorld, {
            arriveAs: "present",
            presentationDistance: Math.max(1.1, focusRadius * 1.35 + 0.45),
            presentationSideOffset: Math.max(0.55, focusRadius * 0.95 + 0.25),
            presentationHeight: 0.08,
          });
        } else if (state.assistantStatus === "ready") {
          if (!focusActive && selectedTargetId !== lastAssistantTravelTargetId) {
            assistantController.travelTo(assistantTargetWorld, {
              arriveAs: "present",
            });
            lastAssistantTravelTargetId = selectedTargetId;
          } else if (
            assistantController.state !== "travel" &&
            assistantController.state !== "present"
          ) {
            assistantController.present(assistantTargetWorld);
          }
        } else {
          assistantController.follow(false);
        }

        assistantController.update({
          deltaSeconds: delta,
          elapsedSeconds: elapsed,
          camera,
          targetWorldPosition: hasAssistantTargetWorld
            ? assistantTargetWorld
            : null,
          audioActivity: state.assistantAudioActivity,
        });
      }

      const litRuntime = stationRuntimes[currentStation];
      litRuntime.group.updateMatrixWorld(true);
      chamberSpot.position
        .copy(litRuntime.lightAnchors.spot)
        .applyMatrix4(litRuntime.group.matrixWorld);
      chamberSpot.target.position
        .copy(litRuntime.lightAnchors.spotTarget)
        .applyMatrix4(litRuntime.group.matrixWorld);
      chamberSpot.target.updateMatrixWorld();
      warmSconceA.position
        .copy(litRuntime.lightAnchors.warmA)
        .applyMatrix4(litRuntime.group.matrixWorld);
      warmSconceB.position
        .copy(litRuntime.lightAnchors.warmB)
        .applyMatrix4(litRuntime.group.matrixWorld);

      const beaconPhase = currentStationData.phase;
      const beaconColor = phaseColor(beaconPhase);
      const beaconSpan = 0.014;
      const beaconSweep = positiveModulo(elapsed * 0.0034, beaconSpan);
      const beaconLead =
        0.007 + (beaconPhase === "backward" ? beaconSpan - beaconSweep : beaconSweep);
      const beaconProgress = THREE.MathUtils.clamp(cameraProgress + beaconLead, 0, 1);
      route.getPointAt(beaconProgress, routePoint);
      route.getTangentAt(beaconProgress, tangent).normalize();
      right.crossVectors(tangent, WORLD_UP).normalize();
      up.crossVectors(right, tangent).normalize();
      routeBeacon.group.position.copy(routePoint).addScaledVector(up, 0.22);
      routeBeacon.material.color.copy(beaconColor);
      routeBeacon.light.color.copy(beaconColor);
      const flicker =
        0.5 + 0.5 * Math.sin(elapsed * 7.4 + Math.sin(elapsed * 2.1) * 0.8);
      routeBeacon.sprite.scale.setScalar(0.34 + flicker * 0.1);
      routeBeacon.material.opacity = 0.14 + flicker * 0.16;
      routeBeacon.light.intensity = 0.2 + flicker * 0.42;

      composer.render();
      frameHandle = window.requestAnimationFrame(renderFrame);
    };
    frameHandle = window.requestAnimationFrame(renderFrame);

    return () => {
      disposed = true;
      unregisterDirectorCanvas(directorApi);
      window.cancelAnimationFrame(frameHandle);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearPressedKeys);
      document.removeEventListener("mousemove", onDocumentMouseMove);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", releasePointer);
      canvas.removeEventListener("pointercancel", releasePointer);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("wheel", onWheel);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      assistantController.dispose();
      disposeScene(scene);
      environmentTexture.dispose();
      chamberSpot.dispose();
      warmSconceA.dispose();
      warmSconceB.dispose();
      bloomPass.dispose();
      composer.dispose();
      composerTarget.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-label="Interactive three-dimensional journey through one complete language-model training step"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background:
          "radial-gradient(circle at 50% 45%, rgba(24, 32, 44, 0.72), #090b10 62%, #07090d)",
      }}
    >
      <canvas
        ref={canvasRef}
        role="application"
        tabIndex={0}
        aria-label="First-person 3D training world. You begin in a room with the training machine on a pedestal and a custom-training console between the windows. Walk close to that console to open the Train your own LLM link, or aim at one of the machine chambers and scroll toward it to step inside. Press M at any time to return to the room. Click to capture the mouse, look with the mouse, move with W A S D, move toward or away along the current view with the mouse wheel, sprint with Shift, hold V to ask the voice guide about the centered target, right-click a component under the pointer or the center crosshair to spotlight it center stage and start the guide listening for your question, right-click empty space or press Escape to release the spotlight, and return to the chamber overlook with R."
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          touchAction: "none",
          outline: "none",
        }}
      />
      {trainingConsoleNearby ? (
        <div className={styles.trainingConsolePrompt} aria-live="polite">
          <span className={styles.trainingConsoleNotice} aria-hidden="true">
            CLICK HERE TO BEGIN <span>↓</span>
          </span>
          <Link
            ref={trainingConsoleLinkRef}
            href="/custom-training"
            className={styles.trainingConsoleLink}
            aria-label="Open the custom training panel to train your own LLM"
          >
            <span className={styles.trainingConsoleStatus}>LOCAL MODEL LAB</span>
            <strong>Train your own LLM</strong>
            <span>Bring your text. Build a tiny model.</span>
          </Link>
          <span className={styles.trainingConsoleKey}>or press E</span>
        </div>
      ) : null}
      {!playing || assistantEnabled ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 8,
            height: 8,
            border: "1px solid rgba(219, 250, 242, 0.72)",
            borderRadius: "50%",
            boxShadow: "0 0 10px rgba(121, 248, 207, 0.4)",
            pointerEvents: "none",
            transform: "translate(-50%, -50%)",
          }}
        />
      ) : null}
      {interactionHint ? (
        <div
          aria-live="polite"
          style={{
            position: "absolute",
            left: "50%",
            bottom: "4.6rem",
            transform: "translateX(-50%)",
            padding: "0.42rem 0.9rem",
            borderRadius: 999,
            background: "rgba(2, 12, 22, 0.78)",
            border: "1px solid rgba(110, 255, 233, 0.35)",
            color: "#dbfaf2",
            font: "500 0.78rem/1.4 system-ui, sans-serif",
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {assistantEnabled
            ? "Spotlight active — just ask your question aloud · right-click empty space or Esc to release"
            : "Spotlight active — right-click empty space or press Esc to release"}
        </div>
      ) : null}
      <div
        ref={fallbackRef}
        role="img"
        aria-label="A semantic infinite-zoom training world: prepared tokens enter embeddings and Transformer blocks, become logits and a scalar loss, then gradients travel backward before AdamW updates one weight and the next step begins."
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap",
          border: 0,
          color: "#dff7ff",
          background: "rgba(3, 10, 20, 0.94)",
          font: "500 0.95rem/1.5 system-ui, sans-serif",
        }}
      >
        This interactive 3D world follows one complete LLM training step: data preparation,
        embeddings, Transformer attention and MLP computation, logits, cross-entropy loss,
        backpropagation, AdamW state, a weight update, and the next batch. It opens in a room
        where the whole machine sits on a pedestal; aim at a chamber and scroll toward it to
        step inside, or walk to the labeled console between the windows to train your own
        model. Press M to return to the room. Click to capture the mouse, use
        W A S D to move freely inside a chamber, use the wheel to move toward or away
        along the current view, and press R to return to its overlook.
      </div>
    </div>
  );
}

export default TrainingWorldCanvas;
