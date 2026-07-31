import * as THREE from "three";

/**
 * Shared room-construction kit for the orientation chamber.
 *
 * These are self-contained, deterministic helpers (procedural marble, surface
 * relief normal maps, soft contact shadows, instanced boxes) factored out so
 * the dedicated orientation room module and its standalone preview harness both
 * build from exactly the same code. They intentionally mirror the private
 * helpers inside `TrainingWorldCanvas.tsx` so the other 24 chambers keep their
 * proven path untouched while the gallery gets its own, freely-editable home.
 */

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

let contactShadowTexture: THREE.CanvasTexture | null = null;
export function getContactShadowTexture(): THREE.CanvasTexture {
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

let marbleTextureBase: THREE.CanvasTexture | null = null;
/**
 * Deterministic cool-slate marble. Pale veins over graphite-blue stone; drawn
 * once and cloned per surface so each floor picks its own repeat.
 */
export function getMarbleTexture(
  repeatX: number,
  repeatY: number,
): THREE.CanvasTexture {
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

export type SurfaceReliefKind = "wall" | "floor";

const surfaceReliefTextures: Record<
  SurfaceReliefKind,
  THREE.CanvasTexture | null
> = { wall: null, floor: null };

/** Tiny deterministic height fields baked to normal maps for shallow relief. */
export function getSurfaceReliefTexture(
  kind: SurfaceReliefKind,
): THREE.CanvasTexture {
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
          Math.sin(wrappedX * 127.1 + wrappedY * 311.7 + seed * 74.7) *
          43758.5453;
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
  texture.repeat.set(kind === "floor" ? 3.5 : 2.5, kind === "floor" ? 4.5 : 3.4);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  surfaceReliefTextures[kind] = texture;
  return texture;
}

export function addInstancedBoxes(
  group: THREE.Group,
  positions: THREE.Vector3[],
  size: THREE.Vector3,
  material: THREE.Material,
  rotations?: THREE.Euler[],
  scales?: THREE.Vector3[],
  colors?: THREE.Color[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    material,
    positions.length,
  );
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
  return mesh;
}

export function addLine(
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
