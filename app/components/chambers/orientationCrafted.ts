import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";

import {
  ORIENTATION_TOUR_STOPS,
  ORIENTATION_BAYS,
  ORIENTATION_PLACARD,
} from "./orientationGallery";
import { addInstancedBoxes } from "./roomKit";
import type { RoomPalette, OrientationRoomOptions } from "./orientationRoom";

/**
 * The crafted orientation room — a refined, tactile, high-craft hall.
 *
 * Direction (Ahmet): keep the clean use of space, but chase craftsmanship —
 * real soft shadows, tasteful reflections, rich warm/cool shading ("shades of
 * colours"), a pleasant physical 3-D feel. Free on palette (not the reference's
 * literal white+red), and far less haze. So: a calm mid-tone cool panelled hall
 * lit by a warm key (warm highlights, cool shadows), a polished reflective
 * floor, one restrained warm accent path, cool gem markers, only a whisper of
 * depth haze. Tour geometry/placards unchanged.
 */

export const ORIENTATION_ENVIRONMENT = {
  background: "#cfd9dc",
  fogColor: "#cfd9dc",
  fogDensity: 0.0045,
  exposure: 1.02,
} as const;

const WIDTH = 66;
const HEIGHT = 56;
const DEPTH = 84;
const DECK_Y = -4.7;
const FLOOR_Y = DECK_Y - 0.18;
const CEIL_Y = FLOOR_Y + HEIGHT;
const WALL_T = 0.4;

const SOFFIT_Y = 15.5;

const DOOR_W = Math.min(7.2, WIDTH - 3.2);
const DOOR_H = Math.min(9.2, HEIGHT - 2.4);
const DOOR_BOTTOM = DECK_Y;
const DOOR_TOP = DOOR_BOTTOM + DOOR_H;

type Adder = (m: THREE.Object3D) => void;

function box(
  add: Adder,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
  shadows = true,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  add(mesh);
  return mesh;
}

/** Cool panel with an embossed rivet-lattice — the craftsmanship cue. Each
 *  "+" is a rounded, bevelled plug with a soft top-left highlight and a
 *  bottom-right shadow so it reads as a moulded fixture, not a drawn line. */
let rivetTexture: THREE.CanvasTexture | null = null;
function makeRivetTexture(): THREE.CanvasTexture {
  if (rivetTexture) return rivetTexture;
  const S = 512;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const p = canvas.getContext("2d")!;
  // Base panel with a faint top-lit vertical gradient.
  const base = p.createLinearGradient(0, 0, 0, S);
  base.addColorStop(0, "#d3dce4");
  base.addColorStop(1, "#c2cdd7");
  p.fillStyle = base;
  p.fillRect(0, 0, S, S);
  // Recessed panel seam with engraved bevel (dark inner, light outer-lip).
  p.strokeStyle = "rgba(96,110,124,0.5)";
  p.lineWidth = 5;
  p.strokeRect(10, 10, S - 20, S - 20);
  p.strokeStyle = "rgba(255,255,255,0.6)";
  p.lineWidth = 2;
  p.strokeRect(13.5, 13.5, S - 27, S - 27);

  const roundBar = (x: number, y: number, w: number, h: number, r: number) => {
    p.beginPath();
    p.roundRect(x, y, w, h, r);
  };
  const drawPlus = (cx: number, cy: number, arm: number, thick: number) => {
    const r = thick / 2;
    const drawShape = (dx: number, dy: number) => {
      roundBar(cx - arm + dx, cy - r + dy, arm * 2, thick, r);
      p.fill();
      roundBar(cx - r + dx, cy - arm + dy, thick, arm * 2, r);
      p.fill();
    };
    // Drop shadow (offset down-right).
    p.fillStyle = "rgba(74,88,102,0.55)";
    drawShape(1.8, 2.2);
    // Domed body with a top-lit gradient.
    const g = p.createLinearGradient(0, cy - arm, 0, cy + arm);
    g.addColorStop(0, "#eef4f9");
    g.addColorStop(0.5, "#cdd8e1");
    g.addColorStop(1, "#aab8c6");
    p.fillStyle = g;
    drawShape(0, 0);
    // Top-left highlight rim.
    p.strokeStyle = "rgba(255,255,255,0.85)";
    p.lineWidth = 1.6;
    roundBar(cx - arm, cy - r, arm * 2, thick, r);
    p.stroke();
    roundBar(cx - r, cy - arm, thick, arm * 2, r);
    p.stroke();
    // Center pip for a bolt-like read.
    p.fillStyle = "rgba(120,136,150,0.5)";
    p.beginPath();
    p.arc(cx, cy, thick * 0.16, 0, Math.PI * 2);
    p.fill();
  };
  const cells = 3;
  const step = S / cells;
  for (let ix = 0; ix < cells; ix += 1)
    for (let iy = 0; iy < cells; iy += 1)
      drawPlus((ix + 0.5) * step, (iy + 0.5) * step, step * 0.26, step * 0.15);

  rivetTexture = new THREE.CanvasTexture(canvas);
  rivetTexture.colorSpace = THREE.SRGBColorSpace;
  rivetTexture.wrapS = THREE.RepeatWrapping;
  rivetTexture.wrapT = THREE.RepeatWrapping;
  rivetTexture.anisotropy = 8;
  return rivetTexture;
}

function wallTex(rx: number, ry: number) {
  const t = makeRivetTexture().clone();
  t.needsUpdate = true;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}

export function buildCraftedRoom(
  group: THREE.Group,
  _palette: RoomPalette,
  _opts: OrientationRoomOptions,
): void {
  void _palette;
  void _opts;
  const add: Adder = (m) => group.add(m);
  // Lights are tagged so the app can gate their intensity to the orientation
  // chamber only (they live in the chamber group but hemisphere/ambient/
  // directional are scene-global, so without gating they could tint the
  // opening scene or an adjacent chamber during a transit).
  const addLight = (l: THREE.Light) => {
    l.userData.orientationGated = true;
    l.userData.baseIntensity = l.intensity;
    add(l);
  };

  // --- Materials: refined mid-tone cool, matte with tactile relief --------
  const wallMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#9fb0bf"),
    map: wallTex(6, 4),
    roughness: 0.82,
    metalness: 0.1,
  });
  const endWallMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#93a3b2"),
    map: wallTex(3, 4),
    roughness: 0.86,
    metalness: 0.08,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#8492a1"),
    roughness: 0.5,
    metalness: 0.45,
  });
  // --- Floor: polished cool graphite with a real, tasteful reflection -----
  const floor = new Reflector(new THREE.PlaneGeometry(WIDTH - WALL_T, DEPTH - WALL_T), {
    textureWidth: 1024,
    textureHeight: 1024,
    color: new THREE.Color("#46693a"),
  });
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y + WALL_T / 2 + 0.001;
  add(floor);
  const floorVeil = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH - WALL_T, DEPTH - WALL_T),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color("#425e37"),
      transparent: true,
      opacity: 0.62,
      roughness: 0.28,
      metalness: 0.22,
      depthWrite: false,
    }),
  );
  floorVeil.rotation.x = -Math.PI / 2;
  floorVeil.position.y = FLOOR_Y + WALL_T / 2 + 0.006;
  floorVeil.receiveShadow = true;
  add(floorVeil);

  // No ceiling: the hall opens to a gradient sky (added below). The walls are
  // capped just above the cube towers so the top edge is ragged blocks, not a
  // hard rim.
  const WALL_TOP = 44;
  const wallH = WALL_TOP - FLOOR_Y;
  const wallCenterY = FLOOR_Y + wallH / 2;
  box(add, WALL_T, wallH, DEPTH, -WIDTH / 2, wallCenterY, 0, wallMat);
  box(add, WALL_T, wallH, DEPTH, WIDTH / 2, wallCenterY, 0, wallMat);

  // Cube-built side walls: a lattice of shaded blocks at varied depths, tinted
  // by height for a soft vertical gradient — a tactile 3-D structure rather
  // than a flat panel. Instanced for cost; each block catches the warm key and
  // drops a little shadow on its neighbours. The flat wall above stays as a
  // dark backing so gaps read as recessed grout, not void.
  {
    const cell = 5;
    const positions: THREE.Vector3[] = [];
    const scales: THREE.Vector3[] = [];
    const colors: THREE.Color[] = [];
    const pinkPos: THREE.Vector3[] = [];
    const pinkScale: THREE.Vector3[] = [];
    const botTone = new THREE.Color("#bfa6ea");
    const topTone = new THREE.Color("#9a7fd6");
    const tint = new THREE.Color();
    const zStart = -DEPTH / 2 + cell / 2;
    const zEnd = DEPTH / 2 - cell / 2;
    const yStart = FLOOR_Y + cell / 2;
    const yEnd = Math.min(CEIL_Y - cell / 2, 44);
    for (const side of [-1, 1]) {
      for (let z = zStart; z <= zEnd; z += cell) {
        for (let y = yStart; y <= yEnd; y += cell) {
          const hash = Math.sin(z * 12.9898 + y * 78.233 + side * 37.719) * 43758.5453;
          const r = hash - Math.floor(hash);
          const t = THREE.MathUtils.clamp((y - yStart) / (yEnd - yStart), 0, 1);
          const blockDepth = 1.5 + r * 1.4;
          const protrude = 0.1 + r * 1.7;
          positions.push(
            new THREE.Vector3(side * (WIDTH / 2 - blockDepth / 2 - protrude), y, z),
          );
          scales.push(new THREE.Vector3(blockDepth, cell - 0.35, cell - 0.35));
          tint.copy(botTone).lerp(topTone, t).multiplyScalar(0.86 + r * 0.26);
          colors.push(tint.clone());
          if (r > 0.4) {
            pinkPos.push(
              new THREE.Vector3(
                side * (WIDTH / 2 - protrude - blockDepth) - side * 0.15,
                y - (cell - 0.35) / 2 - 0.06,
                z,
              ),
            );
            pinkScale.push(new THREE.Vector3(0.62, 0.22, cell - 0.35));
          }
        }
      }
    }
    // End walls too, so the exit end reads as 3-D structure rather than a flat
    // panel — skipping the central door + invitation region so nothing is
    // occluded.
    const xStart = -WIDTH / 2 + cell / 2;
    const xEnd = WIDTH / 2 - cell / 2;
    for (const endZ of [-DEPTH / 2, DEPTH / 2]) {
      const dir = endZ < 0 ? 1 : -1;
      for (let x = xStart; x <= xEnd; x += cell) {
        for (let y = yStart; y <= yEnd; y += cell) {
          if (Math.abs(x) < 7.6 && y < 9) continue;
          const hash = Math.sin(x * 26.51 + y * 78.233 + endZ * 0.137) * 43758.5453;
          const r = hash - Math.floor(hash);
          const t = THREE.MathUtils.clamp((y - yStart) / (yEnd - yStart), 0, 1);
          const blockDepth = 1.5 + r * 1.4;
          const protrude = 0.1 + r * 1.7;
          positions.push(
            new THREE.Vector3(x, y, endZ + dir * (blockDepth / 2 + protrude)),
          );
          scales.push(new THREE.Vector3(cell - 0.35, cell - 0.35, blockDepth));
          tint.copy(botTone).lerp(topTone, t).multiplyScalar(0.86 + r * 0.26);
          colors.push(tint.clone());
          if (r > 0.4) {
            pinkPos.push(
              new THREE.Vector3(
                x,
                y - (cell - 0.35) / 2 - 0.06,
                endZ + dir * (protrude + blockDepth) + dir * 0.15,
              ),
            );
            pinkScale.push(new THREE.Vector3(cell - 0.35, 0.22, 0.62));
          }
        }
      }
    }
    const cubeMat = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.74,
      metalness: 0.08,
    });
    const cubes = addInstancedBoxes(
      group,
      positions,
      new THREE.Vector3(1, 1, 1),
      cubeMat,
      undefined,
      scales,
      colors,
    );
    cubes.castShadow = true;
    cubes.receiveShadow = true;
    add(cubes);

    // A small pink glow tucked under every protruding block — many tiny sources
    // rather than a couple of strips. Emissive + bloom reads as light.
    const pinkGlowMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#1a0812"),
      emissive: new THREE.Color("#ff5db0"),
      emissiveIntensity: 2.3,
      roughness: 0.5,
    });
    add(
      addInstancedBoxes(group, pinkPos, new THREE.Vector3(1, 1, 1), pinkGlowMat, undefined, pinkScale),
    );
  }

  const sideCol = (WIDTH - DOOR_W) / 2;
  const topCap = WALL_TOP - DOOR_TOP;
  const botCap = Math.max(0.2, DOOR_BOTTOM - FLOOR_Y);
  for (const endZ of [-DEPTH / 2, DEPTH / 2]) {
    box(add, sideCol, wallH, WALL_T, -(DOOR_W + sideCol) / 2, wallCenterY, endZ, endWallMat);
    box(add, sideCol, wallH, WALL_T, (DOOR_W + sideCol) / 2, wallCenterY, endZ, endWallMat);
    box(add, DOOR_W, topCap, WALL_T, 0, DOOR_TOP + topCap / 2, endZ, endWallMat);
    box(add, DOOR_W, botCap, WALL_T, 0, FLOOR_Y + botCap / 2, endZ, endWallMat);
    const fz = endZ + (endZ < 0 ? 0.3 : -0.3);
    box(add, 0.6, DOOR_H + 1.0, 0.55, -DOOR_W / 2 - 0.2, (DOOR_BOTTOM + DOOR_TOP) / 2, fz, trimMat);
    box(add, 0.6, DOOR_H + 1.0, 0.55, DOOR_W / 2 + 0.2, (DOOR_BOTTOM + DOOR_TOP) / 2, fz, trimMat);
    box(add, DOOR_W + 1.0, 0.6, 0.55, 0, DOOR_TOP + 0.3, fz, trimMat);
  }

  // --- Open-sky gradient dome (there is no ceiling) -----------------------
  {
    const sky = document.createElement("canvas");
    sky.width = 8;
    sky.height = 256;
    const sp = sky.getContext("2d");
    if (sp) {
      const g = sp.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, "#9fb4bb"); // zenith: soft grey-blue
      g.addColorStop(0.45, "#bccbcf");
      g.addColorStop(0.8, "#d8e1e3");
      g.addColorStop(1, "#ecf1f2"); // horizon: near white
      sp.fillStyle = g;
      sp.fillRect(0, 0, 8, 256);
    }
    const skyTex = new THREE.CanvasTexture(sky);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(240, 24, 16),
      new THREE.MeshBasicMaterial({
        map: skyTex,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
        transparent: true,
        opacity: 1,
      }),
    );
    dome.name = "chamber-architecture-open-sky-gradient";
    dome.position.set(0, FLOOR_Y, 0);
    dome.renderOrder = -1;
    add(dome);
  }

  // --- Glowing dot lattice on the shiny uniform floor (no cube tiles) -----
  {
    const dPos: THREE.Vector3[] = [];
    const dScale: THREE.Vector3[] = [];
    for (let x = -WIDTH / 2 + 3; x < WIDTH / 2; x += 3.4) {
      for (let z = -DEPTH / 2 + 3; z < DEPTH / 2; z += 3.4) {
        dPos.push(new THREE.Vector3(x, FLOOR_Y + WALL_T / 2 + 0.05, z));
        dScale.push(new THREE.Vector3(0.28, 0.04, 0.28));
      }
    }
    const dotMat = new THREE.MeshStandardMaterial({
      color: "#0a1418",
      emissive: new THREE.Color("#5fe6ff"),
      emissiveIntensity: 1.5,
      roughness: 0.5,
      metalness: 0,
    });
    add(addInstancedBoxes(group, dPos, new THREE.Vector3(1, 1, 1), dotMat, undefined, dScale));
  }

  // --- Purpose-built cyberpunk alcoves behind each screen -----------------
  // Each screen is seated in an angled housing aligned to its bay: a recessed
  // backing with a metal surround, side fins for niche depth, a canopy hood and
  // a solid base — plus a soft back-lit rim in that screen's accent, so the
  // colour lives in the alcove while the hall stays neutral.
  const W = ORIENTATION_PLACARD.width;
  const H = ORIENTATION_PLACARD.height;
  const housingMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#0d131b"),
    roughness: 0.5,
    metalness: 0.6,
  });
  const surroundMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#8b98a7"),
    roughness: 0.38,
    metalness: 0.64,
  });
  for (const bay of ORIENTATION_BAYS) {
    const floorLocal = -4.7 - bay.y;
    const accent = new THREE.Color(bay.accent);
    const g = new THREE.Group();
    g.position.set(bay.x, bay.y, bay.z);
    g.rotation.y = bay.yaw;
    const bb = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    // Recessed backing slab.
    bb(W + 2.8, H + 2.8, 0.5, 0, 0, -0.66, housingMat);
    // Back-lit accent rim glowing around the screen.
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 1.8, H + 1.8),
      new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.position.set(0, 0, -0.52);
    glow.renderOrder = 6;
    g.add(glow);
    // Metal surround frame.
    const t = 0.5;
    bb(W + t * 2, t, 0.62, 0, H / 2 + t / 2, 0.06, surroundMat);
    bb(W + t * 2, t, 0.62, 0, -H / 2 - t / 2, 0.06, surroundMat);
    bb(t, H + t * 2, 0.62, -W / 2 - t / 2, 0, 0.06, surroundMat);
    bb(t, H + t * 2, 0.62, W / 2 + t / 2, 0, 0.06, surroundMat);
    // Side fins give the niche real depth.
    bb(0.34, H + 2.4, 1.3, -(W / 2 + 1.05), 0, -0.2, housingMat);
    bb(0.34, H + 2.4, 1.3, W / 2 + 1.05, 0, -0.2, housingMat);
    // Canopy hood, tilted down over the screen.
    const hood = bb(W + 1.6, 0.55, 1.6, 0, H / 2 + 1.0, 0.35, surroundMat);
    hood.rotation.x = -0.18;
    // Solid base wrapping the screen's pylon down to the floor.
    const baseTop = -H / 2 - 0.25;
    const baseH = baseTop - floorLocal;
    bb(W * 0.82, baseH, 2.1, 0, floorLocal + baseH / 2, -0.05, housingMat);
    add(g);
  }

  // --- Exit: a proper two-leaf sci-fi door filling the opening -------------
  {
    const pz = -DEPTH / 2;
    const dwh = DOOR_W / 2;
    const dtop = DOOR_TOP;
    const dbot = DOOR_BOTTOM;
    const midY = (dtop + dbot) / 2;
    const dh = dtop - dbot;
    const z = pz + 0.5;
    const frameMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#232c3c"),
      roughness: 0.45,
      metalness: 0.55,
    });
    const doorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#2b3450"),
      roughness: 0.42,
      metalness: 0.6,
    });
    const seamMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#0a0f1a"),
      emissive: new THREE.Color("#8fdcff"),
      emissiveIntensity: 1.6,
      roughness: 0.5,
    });
    // Frame around the opening.
    const fm = 0.55;
    const ft = 0.7;
    box(add, ft, dh + fm * 2, 0.7, -(dwh + fm), midY, z, frameMat);
    box(add, ft, dh + fm * 2, 0.7, dwh + fm, midY, z, frameMat);
    box(add, (dwh + fm) * 2 + ft, ft, 0.7, 0, dtop + fm, z, frameMat);
    box(add, (dwh + fm) * 2 + ft, ft, 0.7, 0, dbot - 0.1, z, frameMat);
    // Two leaves meeting at the centre, filling the opening.
    const leafW = dwh - 0.06;
    for (const s of [-1, 1]) {
      box(add, leafW, dh - 0.1, 0.3, s * (leafW / 2 + 0.06), midY, z + 0.06, doorMat);
      box(add, leafW - 0.7, 0.14, 0.34, s * (leafW / 2 + 0.06), midY + 1.7, z + 0.14, seamMat);
      box(add, leafW - 0.7, 0.14, 0.34, s * (leafW / 2 + 0.06), midY - 1.7, z + 0.14, seamMat);
    }
    // Bright centre seam where the leaves meet.
    box(add, 0.12, dh - 0.4, 0.36, 0, midY, z + 0.16, seamMat);
  }

  // --- Cool gem markers on plinths (complementary pop) --------------------
  const gemMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#8fe9ff"),
    emissive: new THREE.Color("#37c4ee"),
    emissiveIntensity: 0.8,
    roughness: 0.12,
    metalness: 0.1,
    flatShading: true,
  });
  for (const [z, side] of [[23.5, -1], [23.5, 1]] as const) {
    const gx = side * (WIDTH / 2 - 3.6);
    box(add, 2.2, 3.0, 2.2, gx, FLOOR_Y + 1.5, z, trimMat);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(1.15, 0), gemMat);
    gem.scale.set(0.82, 1.4, 0.82);
    gem.position.set(gx, FLOOR_Y + 4.5, z);
    gem.castShadow = true;
    add(gem);
    const gemGlow = new THREE.PointLight("#6fe0ff", 3.4, 13, 2);
    gemGlow.position.set(gx, FLOOR_Y + 4.5, z);
    add(gemGlow);
  }

  // --- Viewing marks ------------------------------------------------------
  for (const stop of ORIENTATION_TOUR_STOPS) {
    const mark = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.08, 40),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color("#ffce8f"),
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(stop.eye[0], FLOOR_Y + WALL_T / 2 + 0.05, stop.eye[2]);
    add(mark);
  }

  // --- Lighting: warm key with soft shadows + cool fill -------------------
  addLight(new THREE.HemisphereLight("#ccd2e2", "#3a3444", 0.3));
  addLight(new THREE.AmbientLight("#6f809a", 0.14));
  const key = new THREE.DirectionalLight("#eef4ff", 0.9);
  key.position.set(12, 30, 20);
  key.target.position.set(-2, 0, -6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 96;
  key.shadow.camera.left = -32;
  key.shadow.camera.right = 32;
  key.shadow.camera.top = 42;
  key.shadow.camera.bottom = -12;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.5;
  addLight(key);
  add(key.target);
  // Cool rim fill from the far end for depth separation.
  const rim = new THREE.DirectionalLight("#a9c2e6", 0.32);
  rim.position.set(-10, 12, -30);
  addLight(rim);
  // Soft cool wash to keep the length luminous without haze.
  const wash = new THREE.PointLight("#dbe8f6", 3.2, 46, 1.8);
  wash.position.set(0, SOFFIT_Y - 2, -6);
  addLight(wash);

}
