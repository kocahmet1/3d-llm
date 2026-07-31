import * as THREE from "three";

import {
  addInstancedBoxes,
  getContactShadowTexture,
  getMarbleTexture,
  getSurfaceReliefTexture,
} from "./roomKit";
import { ORIENTATION_TOUR_STOPS } from "./orientationGallery";
import { buildCraftedRoom } from "./orientationCrafted";

/**
 * The orientation chamber's own room.
 *
 * Every other chamber shares the generic `addShell` in TrainingWorldCanvas.
 * The orientation hall is special — it is the visitor's first impression and a
 * gallery rather than a computation — so it gets a dedicated, freely-editable
 * room here. `variant: "legacy"` reproduces the shared shell exactly (the
 * baseline we measure against); the evolving default is the crafted version.
 *
 * Kept as pure geometry added to a group so the same code renders in the app
 * and in the standalone preview harness. Navigation bounds are applied by the
 * caller in the app; the preview does not walk.
 */

export interface RoomPalette {
  phaseBase: THREE.Color;
  bright: THREE.Color;
  dark: THREE.Color;
}

export interface OrientationRoomOptions {
  variant?: "legacy" | "crafted";
  /** Total station count; when index < total-1 a "next chamber" marquee hangs. */
  index?: number;
  totalStations?: number;
}

/** Fixed footprint of the orientation hall (matches the app's shell spec). */
export const ORIENTATION_ROOM_SIZE = { width: 66, height: 56, depth: 84 };

function createFacePanelLite(
  text: string,
  width: number,
  height: number,
  color: string,
  borderColor: THREE.Color,
): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = Math.max(160, Math.round((canvas.width * height) / width));
  const paint = canvas.getContext("2d");
  if (paint) {
    const backdrop = paint.createLinearGradient(0, 0, 0, canvas.height);
    backdrop.addColorStop(0, "rgba(6, 15, 29, 0.95)");
    backdrop.addColorStop(1, "rgba(2, 6, 14, 0.95)");
    paint.fillStyle = backdrop;
    paint.fillRect(5, 5, canvas.width - 10, canvas.height - 10);
    paint.strokeStyle = borderColor.getStyle();
    paint.lineWidth = 5;
    paint.strokeRect(7.5, 7.5, canvas.width - 15, canvas.height - 15);
    paint.fillStyle = color;
    paint.textAlign = "center";
    paint.textBaseline = "middle";
    paint.font = `800 ${Math.round(canvas.height * 0.42)}px ui-monospace, monospace`;
    paint.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 40);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  return mesh;
}

/**
 * Faithful reproduction of the shared `addShell` + `buildGalleryFloor` output
 * for the gallery, so the crafted version has a measured baseline to beat.
 */
function buildLegacyRoom(
  group: THREE.Group,
  palette: RoomPalette,
  opts: OrientationRoomOptions,
) {
  const phaseTint = palette.phaseBase.clone();
  const width = ORIENTATION_ROOM_SIZE.width;
  const chamberHeight = ORIENTATION_ROOM_SIZE.height;
  const depth = ORIENTATION_ROOM_SIZE.depth;

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
    color: palette.bright,
    roughness: 0.3,
    metalness: 0.4,
    emissive: phaseTint,
    emissiveIntensity: 0.7,
  });
  const exitFrameMaterial = frameMaterial.clone();
  exitFrameMaterial.emissiveIntensity = 0.28;

  const panel = (
    size: THREE.Vector3,
    position: THREE.Vector3,
    material: THREE.Material = wallMaterial,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      material,
    );
    mesh.position.copy(position);
    group.add(mesh);
    return mesh;
  };

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

  panel(new THREE.Vector3(width, wallThickness, depth), new THREE.Vector3(0, floorY, 0), floorMaterial);
  panel(new THREE.Vector3(width, wallThickness, depth), new THREE.Vector3(0, ceilingY, 0), wallMaterial);
  panel(new THREE.Vector3(wallThickness, verticalSpan, depth), new THREE.Vector3(-width / 2, chamberCenterY, 0));
  panel(new THREE.Vector3(wallThickness, verticalSpan, depth), new THREE.Vector3(width / 2, chamberCenterY, 0));

  for (const endZ of [-depth / 2, depth / 2]) {
    const endWallMaterial = endZ < 0 ? backWallMaterial : wallMaterial;
    panel(new THREE.Vector3(sideColumnWidth, verticalSpan, wallThickness), new THREE.Vector3(-(doorWidth + sideColumnWidth) / 2, chamberCenterY, endZ), endWallMaterial);
    panel(new THREE.Vector3(sideColumnWidth, verticalSpan, wallThickness), new THREE.Vector3((doorWidth + sideColumnWidth) / 2, chamberCenterY, endZ), endWallMaterial);
    panel(new THREE.Vector3(doorWidth, topCapHeight, wallThickness), new THREE.Vector3(0, doorTop + topCapHeight / 2, endZ), endWallMaterial);
    panel(new THREE.Vector3(doorWidth, bottomCapHeight, wallThickness), new THREE.Vector3(0, floorY + bottomCapHeight / 2, endZ), endWallMaterial);

    const trimZ = endZ + (endZ < 0 ? 0.23 : -0.23);
    const doorFrameMaterial = endZ < 0 ? exitFrameMaterial : frameMaterial;
    panel(new THREE.Vector3(0.16, doorHeight + 0.3, 0.16), new THREE.Vector3(-doorWidth / 2, doorCenterY, trimZ), doorFrameMaterial);
    panel(new THREE.Vector3(0.16, doorHeight + 0.3, 0.16), new THREE.Vector3(doorWidth / 2, doorCenterY, trimZ), doorFrameMaterial);
    panel(new THREE.Vector3(doorWidth + 0.3, 0.16, 0.16), new THREE.Vector3(0, doorTop, trimZ), doorFrameMaterial);
    panel(new THREE.Vector3(doorWidth + 0.3, 0.16, 0.16), new THREE.Vector3(0, doorBottom, trimZ), doorFrameMaterial);
  }

  // Wainscot band + steel rail.
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
    panel(new THREE.Vector3(0.2, wainscotHeight, depth - 1.4), new THREE.Vector3(side * (width / 2 - 0.3), wainscotY, 0), wainscotMaterial);
    panel(new THREE.Vector3(0.24, 0.13, depth - 1.4), new THREE.Vector3(side * (width / 2 - 0.3), railY, 0), railMaterial);
  }
  for (const endZ of [-depth / 2, depth / 2]) {
    const inward = endZ < 0 ? 0.3 : -0.3;
    for (const side of [-1, 1]) {
      panel(new THREE.Vector3(Math.max(1, sideColumnWidth - 1), wainscotHeight, 0.2), new THREE.Vector3((side * (doorWidth + sideColumnWidth)) / 2, wainscotY, endZ + inward), wainscotMaterial);
      panel(new THREE.Vector3(Math.max(1, sideColumnWidth - 1), 0.13, 0.24), new THREE.Vector3((side * (doorWidth + sideColumnWidth)) / 2, railY, endZ + inward), railMaterial);
    }
  }

  // Pilaster relief + broad accents + cove.
  const pilasterCount = Math.max(3, Math.round(depth / 12));
  const pilasterPositions: THREE.Vector3[] = [];
  const pilasterScales: THREE.Vector3[] = [];
  const trimPositions: THREE.Vector3[] = [];
  const trimScales: THREE.Vector3[] = [];
  const trimColors: THREE.Color[] = [];
  const emberColor = new THREE.Color("#9cc4ee").multiplyScalar(0.85);
  const windowColor = new THREE.Color("#31506e");
  const pushTrim = (position: THREE.Vector3, scale: THREE.Vector3, color: THREE.Color) => {
    trimPositions.push(position);
    trimScales.push(scale);
    trimColors.push(color);
  };
  for (let pilaster = 0; pilaster < pilasterCount; pilaster += 1) {
    const zSlot = pilasterCount === 1 ? 0 : -depth * 0.4 + (pilaster * depth * 0.8) / (pilasterCount - 1);
    for (const side of [-1, 1]) {
      const faceX = side * (width / 2 - 0.62);
      pilasterPositions.push(new THREE.Vector3(faceX, chamberCenterY, zSlot));
      pilasterScales.push(new THREE.Vector3(1.05, verticalSpan, 1.35));
      pushTrim(new THREE.Vector3(side * (width / 2 - 1.28), floorY + 0.62, zSlot), new THREE.Vector3(0.5, 0.32, 0.14), emberColor);
    }
  }
  const galleryY = floorY + verticalSpan * 0.8;
  for (let bay = 0; bay < Math.max(2, pilasterCount - 1); bay += 1) {
    const bayCount = Math.max(2, pilasterCount - 1);
    const zSlot = -depth * 0.34 + (bay * depth * 0.68) / Math.max(1, bayCount - 1);
    for (const side of [-1, 1]) {
      pushTrim(new THREE.Vector3(side * (width / 2 - 0.34), galleryY, zSlot), new THREE.Vector3(0.1, 1.05, 1.5), windowColor);
    }
  }
  const coveColor = new THREE.Color("#cfe2fa").multiplyScalar(0.42);
  for (const side of [-1, 1]) {
    pushTrim(new THREE.Vector3(side * (width / 2 - 0.52), ceilingY - 1.05, 0), new THREE.Vector3(0.12, 0.2, depth * 0.76), coveColor);
  }

  group.add(addInstancedBoxes(group, pilasterPositions, new THREE.Vector3(1, 1, 1), pilasterMaterial, undefined, pilasterScales));
  const trimMaterial = new THREE.MeshBasicMaterial({
    color: "#ffffff",
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  group.add(addInstancedBoxes(group, trimPositions, new THREE.Vector3(1, 1, 1), trimMaterial, undefined, trimScales, trimColors));

  // "NEXT CHAMBER" marquee over the exit (back, -z).
  const index = opts.index ?? 0;
  const totalStations = opts.totalStations ?? 25;
  if (index < totalStations - 1) {
    const marquee = new THREE.Group();
    const signZ = -depth / 2 + 0.34;
    const neonColor = palette.phaseBase.clone().lerp(new THREE.Color("#ffffff"), 0.34);
    const neonMaterial = new THREE.MeshBasicMaterial({
      color: neonColor,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const chevronWidth = Math.min(2.4, doorWidth * 0.5);
    const chevronHalfWidth = chevronWidth / 2;
    const chevronHeight = 0.32;
    const barThickness = 0.12;
    const barLength = Math.hypot(chevronHalfWidth, chevronHeight);
    const chevronTilt = Math.atan2(chevronHalfWidth, chevronHeight);
    const chevronGap = 0.4;
    const chevronRows = 3;
    for (let row = 0; row < chevronRows; row += 1) {
      const apexY = row * chevronGap;
      for (const side of [-1, 1] as const) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(barThickness, barLength, barThickness), neonMaterial);
        bar.position.set((side * chevronHalfWidth) / 2, apexY + chevronHeight / 2, 0);
        bar.rotation.z = -side * chevronTilt;
        marquee.add(bar);
      }
    }
    const plateHeight = 0.85;
    const plateWidth = Math.min(doorWidth + 1.2, width - 1.2);
    const plate = createFacePanelLite("NEXT CHAMBER", plateWidth, plateHeight, "#eaf4ff", neonColor);
    const chevronStackTop = (chevronRows - 1) * chevronGap + chevronHeight;
    plate.position.set(0, chevronStackTop + 0.14 + plateHeight / 2, 0.02);
    marquee.add(plate);
    marquee.position.set(0, doorTop + 0.3, signZ);
    group.add(marquee);
  }

  // Gallery floor: polished runway, rims, viewing marks, contact shadow.
  const nearZ = ORIENTATION_TOUR_STOPS[0].eye[2] + 6;
  const farZ = ORIENTATION_TOUR_STOPS[ORIENTATION_TOUR_STOPS.length - 1].look[2] - 7;
  const runwayDepth = nearZ - farZ;
  const runwayCenterZ = (nearZ + farZ) / 2;
  const runwayHalfWidth = 4.4;
  const stoneMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#a7b2c0").lerp(palette.phaseBase, 0.05),
    map: getMarbleTexture(1.5, 1.5),
    roughness: 0.28,
    metalness: 0.12,
    normalMap: getSurfaceReliefTexture("floor"),
    normalScale: new THREE.Vector2(0.1, 0.1),
    emissive: palette.dark,
    emissiveIntensity: 0.08,
  });
  const runway = new THREE.Mesh(new THREE.BoxGeometry(runwayHalfWidth * 2, 0.16, runwayDepth), stoneMaterial);
  runway.position.set(0, -4.66, runwayCenterZ);
  group.add(runway);
  for (const side of [-1, 1]) {
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.09, runwayDepth),
      new THREE.MeshBasicMaterial({ color: palette.bright, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    rim.position.set(side * runwayHalfWidth, -4.5, runwayCenterZ);
    group.add(rim);
  }
  for (const stop of ORIENTATION_TOUR_STOPS) {
    const mark = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.06, 36),
      new THREE.MeshBasicMaterial({ color: palette.phaseBase, transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(stop.eye[0], -4.56, stop.eye[2]);
    group.add(mark);
  }
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.8, runwayDepth * 1.05),
    new THREE.MeshBasicMaterial({ map: getContactShadowTexture(), color: "#000000", transparent: true, opacity: 0.5, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, -4.674, runwayCenterZ);
  group.add(shadow);
}

export function buildOrientationRoom(
  group: THREE.Group,
  palette: RoomPalette,
  opts: OrientationRoomOptions = {},
): void {
  const variant = opts.variant ?? "legacy";
  if (variant === "legacy") {
    buildLegacyRoom(group, palette, opts);
    return;
  }
  buildCraftedRoom(group, palette, opts);
}
