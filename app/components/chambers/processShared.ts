import * as THREE from "three";

export interface ChamberPaletteLike {
  phaseBase: THREE.Color;
  bright: THREE.Color;
  dark: THREE.Color;
  structure: THREE.MeshStandardMaterial;
  active: THREE.MeshStandardMaterial;
  signal: THREE.MeshStandardMaterial;
  warm: THREE.MeshStandardMaterial;
  target: THREE.MeshStandardMaterial;
}

export interface ChamberProcessContext {
  stationId: string;
  index: number;
  group: THREE.Group;
  palette: ChamberPaletteLike;
}

export type ChamberProcessUpdater = (
  progress: number,
  elapsed: number,
  motionEnabled?: boolean,
) => void;

export interface ValueBoardOptions {
  width?: number;
  cellHeight?: number;
  color?: THREE.ColorRepresentation;
  accent?: THREE.ColorRepresentation;
  title?: string;
  subtitle?: string;
  fontScale?: number;
  highlightedIndices?: readonly number[];
  maskedIndices?: readonly number[];
  unknownIndices?: readonly number[];
}

export interface PanelOptions {
  width?: number;
  height?: number;
  color?: THREE.ColorRepresentation;
  borderColor?: THREE.ColorRepresentation;
  background?: string;
  fontScale?: number;
}

const tempVector = new THREE.Vector3();

/**
 * Shared soft radial glow sprite texture, built once per session.
 * Placed behind boards and panels it
 * makes every exhibit read as a self-lit hologram against the dark halls.
 */
let sharedGlowTexture: THREE.CanvasTexture | null = null;
function getGlowTexture(): THREE.CanvasTexture {
  if (sharedGlowTexture) return sharedGlowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const paint = canvas.getContext("2d");
  if (paint) {
    const gradient = paint.createRadialGradient(64, 64, 4, 64, 64, 63);
    gradient.addColorStop(0, "rgba(255,255,255,0.85)");
    gradient.addColorStop(0.28, "rgba(255,255,255,0.32)");
    gradient.addColorStop(0.62, "rgba(255,255,255,0.08)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    paint.fillStyle = gradient;
    paint.fillRect(0, 0, 128, 128);
  }
  sharedGlowTexture = new THREE.CanvasTexture(canvas);
  sharedGlowTexture.colorSpace = THREE.SRGBColorSpace;
  return sharedGlowTexture;
}

function traceRoundedRect(
  paint: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  paint.beginPath();
  paint.moveTo(x + r, y);
  paint.arcTo(x + width, y, x + width, y + height, r);
  paint.arcTo(x + width, y + height, x, y + height, r);
  paint.arcTo(x, y + height, x, y, r);
  paint.arcTo(x, y, x + width, y, r);
  paint.closePath();
}

/**
 * Bright additive trim bars hugging a board or panel outline — the neon
 * edge-lit frame from the reference aesthetic. Colors are pushed past 1 so
 * the bloom pass picks them up.
 */
export function createNeonFrame(
  width: number,
  height: number,
  color: THREE.ColorRepresentation,
  depth = 0.13,
) {
  const frame = new THREE.Group();
  frame.name = "neon-edge-frame";
  const accent = new THREE.Color(color);
  const barMaterial = new THREE.MeshBasicMaterial({
    color: accent.clone().multiplyScalar(0.92),
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const cornerMaterial = new THREE.MeshBasicMaterial({
    color: accent.clone().lerp(new THREE.Color("#ffffff"), 0.3).multiplyScalar(1.05),
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const bar = 0.052;
  const horizontal = new THREE.BoxGeometry(width + 0.26, bar, bar);
  const vertical = new THREE.BoxGeometry(bar, height + 0.26, bar);
  for (const side of [-1, 1]) {
    const beam = new THREE.Mesh(horizontal, barMaterial);
    beam.position.set(0, side * (height / 2 + 0.13), depth);
    frame.add(beam);
    const post = new THREE.Mesh(vertical, barMaterial);
    post.position.set(side * (width / 2 + 0.13), 0, depth);
    frame.add(post);
  }
  const cornerGeometry = new THREE.BoxGeometry(0.13, 0.13, bar * 1.4);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const corner = new THREE.Mesh(cornerGeometry, cornerMaterial);
      corner.position.set(
        sx * (width / 2 + 0.13),
        sy * (height / 2 + 0.13),
        depth,
      );
      frame.add(corner);
    }
  }
  return frame;
}

export function createGlowHalo(
  width: number,
  height: number,
  color: THREE.ColorRepresentation,
  opacity = 0.3,
) {
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: getGlowTexture(),
      color: new THREE.Color(color),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  halo.renderOrder = 9;
  return halo;
}

export function smoothStep(value: number, start: number, end: number) {
  const normalized = THREE.MathUtils.clamp(
    (value - start) / Math.max(0.0001, end - start),
    0,
    1,
  );
  return normalized * normalized * (3 - 2 * normalized);
}

export function windowPulse(
  progress: number,
  start: number,
  peak: number,
  end: number,
) {
  if (progress <= peak) return smoothStep(progress, start, peak);
  return 1 - smoothStep(progress, peak, end);
}

export function createProcessMaterial(
  color: THREE.ColorRepresentation,
  emissiveIntensity = 0.8,
  opacity = 1,
) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity,
    roughness: 0.28,
    metalness: 0.3,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 0.45,
  });
}

function rememberOpacity(material: THREE.Material & { opacity?: number }) {
  if (material.userData.processBaseOpacity === undefined) {
    material.userData.processBaseOpacity = material.opacity ?? 1;
  }
  if (material.userData.processBaseDepthWrite === undefined) {
    material.userData.processBaseDepthWrite = material.depthWrite;
  }
}

export function setObjectOpacity(object: THREE.Object3D, opacity: number) {
  const safeOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
  object.traverse((child) => {
    const materialOwner = child as THREE.Mesh | THREE.Sprite;
    if (!materialOwner.material) return;
    const materials = Array.isArray(materialOwner.material)
      ? materialOwner.material
      : [materialOwner.material];
    materials.forEach((material) => {
      const transparentMaterial = material as THREE.Material & {
        opacity: number;
      };
      rememberOpacity(transparentMaterial);
      transparentMaterial.transparent = true;
      const effectiveOpacity =
        (transparentMaterial.userData.processBaseOpacity as number) * safeOpacity;
      transparentMaterial.opacity = effectiveOpacity;
      transparentMaterial.depthWrite =
        Boolean(transparentMaterial.userData.processBaseDepthWrite) &&
        effectiveOpacity > 0.48;
    });
  });
  object.visible = safeOpacity > 0.001;
}

export function revealObject(
  object: THREE.Object3D,
  amount: number,
  minimumScale = 0.001,
) {
  const safeAmount = THREE.MathUtils.clamp(amount, 0, 1);
  object.visible = safeAmount > 0.001;
  object.scale.setScalar(
    THREE.MathUtils.lerp(minimumScale, 1, 0.84 + safeAmount * 0.16),
  );
  setObjectOpacity(object, safeAmount);
}

export function setObjectEmissive(
  object: THREE.Object3D,
  intensity: number,
) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.material) return;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    materials.forEach((material) => {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissiveIntensity = intensity;
      }
    });
  });
}

export function moveObject(
  object: THREE.Object3D,
  from: THREE.Vector3,
  to: THREE.Vector3,
  amount: number,
  arcHeight = 0,
) {
  const safeAmount = THREE.MathUtils.clamp(amount, 0, 1);
  object.position.lerpVectors(from, to, safeAmount);
  object.position.y += Math.sin(safeAmount * Math.PI) * arcHeight;
}

export function samplePath(
  object: THREE.Object3D,
  points: readonly THREE.Vector3[],
  amount: number,
  arcHeight = 0,
) {
  if (points.length < 2) return;
  const scaled = THREE.MathUtils.clamp(amount, 0, 1) * (points.length - 1);
  const segment = Math.min(points.length - 2, Math.floor(scaled));
  const local = scaled - segment;
  moveObject(object, points[segment], points[segment + 1], local, arcHeight);
}

export function createPacket(
  color: THREE.ColorRepresentation,
  radius = 0.28,
) {
  const material = createProcessMaterial(color, 1.15);
  const packet = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 2),
    material,
  );
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.7, radius * 0.1, 8, 32),
    haloMaterial,
  );
  halo.rotation.x = Math.PI / 2;
  packet.add(halo);
  const aura = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  aura.scale.setScalar(radius * 4.5);
  packet.add(aura);
  return packet;
}

export function createPath(
  points: readonly THREE.Vector3[],
  color: THREE.ColorRepresentation,
  radius = 0.045,
  opacity = 0.34,
) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((point) => point.clone()),
    false,
    "centripetal",
    0.42,
  );
  // Additive blending turns every data path into a glowing light conduit,
  // matching the luminous wire bundles of the reference aesthetic.
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, 72, radius, 7, false),
    material,
  );
}

function colorForValue(
  rawValue: string | number,
  index: number,
  options: ValueBoardOptions,
) {
  if (options.maskedIndices?.includes(index)) return new THREE.Color("#ff4f86");
  if (options.unknownIndices?.includes(index)) return new THREE.Color("#586b80");
  if (options.highlightedIndices?.includes(index)) {
    return new THREE.Color(options.accent ?? "#ffd166");
  }
  if (typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue < 0) {
    return new THREE.Color("#ff765f");
  }
  if (rawValue === "-INF" || rawValue === "-∞" || rawValue === "−∞") {
    return new THREE.Color("#ff4f86");
  }
  return new THREE.Color(options.color ?? "#6fe9ff");
}

function formatValue(value: string | number) {
  if (typeof value === "string") return value === "-INF" ? "−∞" : value;
  if (Number.isNaN(value)) return "·";
  if (value === Number.NEGATIVE_INFINITY) return "−∞";
  if (Number.isInteger(value)) return String(value);
  const magnitude = Math.abs(value);
  if (magnitude >= 10) return value.toFixed(1);
  if (magnitude >= 1) return value.toFixed(2);
  return value.toFixed(magnitude >= 0.1 ? 3 : 4).replace(/^(-?)0/, "$1");
}

export function createValueBoard(
  values: readonly (string | number)[],
  rows: number,
  columns: number,
  options: ValueBoardOptions = {},
) {
  const width = options.width ?? 6.2;
  const cellHeight = options.cellHeight ?? 0.68;
  const titleHeight = options.title ? 0.72 : 0;
  const subtitleHeight = options.subtitle ? 0.5 : 0;
  const gridHeight = rows * cellHeight;
  const height = gridHeight + titleHeight + subtitleHeight + 0.34;
  const group = new THREE.Group();
  group.name = `process-value-board-${(options.title ?? "values")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;

  const backingMaterial = new THREE.MeshStandardMaterial({
    color: "#040910",
    emissive: options.color ?? "#112c3e",
    emissiveIntensity: 0.1,
    roughness: 0.4,
    metalness: 0.55,
    transparent: true,
    opacity: 0.97,
  });
  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.24, height + 0.24, 0.34),
    backingMaterial,
  );
  backing.position.y = (titleHeight - subtitleHeight) * 0.08;
  group.add(backing);

  const canvas = document.createElement("canvas");
  // All chambers are authored eagerly, so resolution tracks information density
  // and stays capped. This keeps the complete 25-station world inside a modest
  // CPU/GPU texture budget without sacrificing per-cell legibility.
  canvas.width = THREE.MathUtils.clamp(
    Math.round(Math.max(width * 64, columns * 48)),
    320,
    512,
  );
  canvas.height = THREE.MathUtils.clamp(
    Math.round((height / width) * canvas.width),
    112,
    512,
  );
  const paint = canvas.getContext("2d");
  if (paint) {
    paint.clearRect(0, 0, canvas.width, canvas.height);
    // Deep glassy backdrop with a faint vertical sheen, so lit cells float on
    // near-black glass exactly like the reference tiles.
    const backdrop = paint.createLinearGradient(0, 0, 0, canvas.height);
    backdrop.addColorStop(0, "rgba(6, 14, 28, 0.98)");
    backdrop.addColorStop(0.5, "rgba(2, 6, 14, 0.98)");
    backdrop.addColorStop(1, "rgba(4, 10, 22, 0.98)");
    paint.fillStyle = backdrop;
    paint.fillRect(0, 0, canvas.width, canvas.height);
    const scaleY = canvas.height / height;
    let yCursor = 0;
    if (options.title) {
      paint.fillStyle = "rgba(255,255,255,0.95)";
      paint.font = `800 ${Math.floor(38 * (options.fontScale ?? 1))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      paint.textAlign = "center";
      paint.textBaseline = "middle";
      paint.fillText(
        options.title,
        canvas.width / 2,
        titleHeight * scaleY * 0.54,
        canvas.width - 24,
      );
      yCursor += titleHeight;
    }
    const cellWidthPx = canvas.width / columns;
    const cellHeightPx = cellHeight * scaleY;
    const fontSize = THREE.MathUtils.clamp(
      Math.floor(Math.min(cellWidthPx * 0.34, cellHeightPx * 0.44)),
      15,
      42,
    );
    paint.font = `800 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    paint.textAlign = "center";
    paint.textBaseline = "middle";
    for (let index = 0; index < rows * columns; index += 1) {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const value = values[index] ?? "·";
      const color = colorForValue(value, index, options);
      const highlighted = options.highlightedIndices?.includes(index) ?? false;
      const x = column * cellWidthPx;
      const y = yCursor * scaleY + row * cellHeightPx;
      const cornerRadius = Math.min(8, cellHeightPx * 0.16);
      // Glassy cell body with an inner glow gradient.
      traceRoundedRect(
        paint,
        x + 4,
        y + 4,
        cellWidthPx - 8,
        cellHeightPx - 8,
        cornerRadius,
      );
      const cellGlow = paint.createLinearGradient(x, y, x, y + cellHeightPx);
      const glassTop = color.clone().multiplyScalar(0.42);
      const glassBottom = color.clone().multiplyScalar(0.14);
      cellGlow.addColorStop(0, `rgba(${Math.round(glassTop.r * 255)}, ${Math.round(glassTop.g * 255)}, ${Math.round(glassTop.b * 255)}, ${highlighted ? 0.6 : 0.34})`);
      cellGlow.addColorStop(1, `rgba(${Math.round(glassBottom.r * 255)}, ${Math.round(glassBottom.g * 255)}, ${Math.round(glassBottom.b * 255)}, ${highlighted ? 0.44 : 0.2})`);
      paint.fillStyle = cellGlow;
      paint.fill();
      // Crisp lit edge; form comes from the tile shading itself.
      paint.strokeStyle = color
        .clone()
        .lerp(new THREE.Color("#ffffff"), highlighted ? 0.42 : 0.22)
        .getStyle();
      paint.lineWidth = highlighted ? 4.5 : 2.2;
      paint.stroke();
      // Beveled-tile shading: a bright top edge and a dark bottom edge give
      // every cell the solid, light-from-within slab look of the reference.
      paint.globalAlpha = highlighted ? 0.85 : 0.6;
      paint.strokeStyle = color.clone().lerp(new THREE.Color("#ffffff"), 0.55).getStyle();
      paint.lineWidth = 1.5;
      paint.beginPath();
      paint.moveTo(x + 8, y + 7);
      paint.lineTo(x + cellWidthPx - 8, y + 7);
      paint.stroke();
      paint.globalAlpha = 0.55;
      paint.strokeStyle = "rgba(0, 0, 0, 0.7)";
      paint.beginPath();
      paint.moveTo(x + 8, y + cellHeightPx - 7);
      paint.lineTo(x + cellWidthPx - 8, y + cellHeightPx - 7);
      paint.stroke();
      paint.globalAlpha = 1;
      // Bright crisp value so digits read from afar.
      paint.fillStyle = color.clone().lerp(new THREE.Color("#ffffff"), 0.72).getStyle();
      paint.fillText(
        formatValue(value),
        x + cellWidthPx / 2,
        y + cellHeightPx / 2 + 1,
      );
    }
    if (options.subtitle) {
      paint.fillStyle = "rgba(195,220,238,0.85)";
      paint.font = `700 ${Math.floor(26 * (options.fontScale ?? 1))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      paint.fillText(
        options.subtitle,
        canvas.width / 2,
        (yCursor + gridHeight + subtitleHeight * 0.54) * scaleY,
        canvas.width - 24,
      );
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const faceMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), faceMaterial);
  face.position.z = 0.2;
  face.renderOrder = 12;
  group.add(face);

  const edgeColor = new THREE.Color(options.accent ?? options.color ?? "#6fe9ff");
  const frame = createNeonFrame(width, height, edgeColor, 0.2);
  group.add(frame);
  return group;
}

export function createPanel(
  lines: readonly string[],
  options: PanelOptions = {},
) {
  const width = options.width ?? 5.5;
  const height = options.height ?? Math.max(1.05, 0.62 + lines.length * 0.54);
  const canvas = document.createElement("canvas");
  const longestLine = lines.reduce(
    (maximum, line) => Math.max(maximum, line.length),
    1,
  );
  canvas.width = THREE.MathUtils.clamp(
    Math.round(Math.max(width * 64, longestLine * 14)),
    256,
    512,
  );
  canvas.height = THREE.MathUtils.clamp(
    Math.round((height / width) * canvas.width),
    96,
    384,
  );
  const paint = canvas.getContext("2d");
  const color = new THREE.Color(options.color ?? "#eaf8ff");
  const border = new THREE.Color(options.borderColor ?? "#6fe9ff");
  if (paint) {
    const backdrop = paint.createLinearGradient(0, 0, 0, canvas.height);
    backdrop.addColorStop(0, "rgba(7, 16, 30, 0.96)");
    backdrop.addColorStop(1, "rgba(2, 6, 14, 0.96)");
    paint.fillStyle = options.background ?? backdrop;
    paint.fillRect(0, 0, canvas.width, canvas.height);
    // Understated double border: a dim outer band, then a crisp line.
    paint.strokeStyle = border.getStyle();
    paint.globalAlpha = 0.4;
    paint.lineWidth = 6;
    paint.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
    paint.globalAlpha = 1;
    paint.strokeStyle = border
      .clone()
      .lerp(new THREE.Color("#ffffff"), 0.35)
      .getStyle();
    paint.lineWidth = 2.5;
    paint.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
    // Corner ticks, echoing the instrument-panel framing of the reference.
    paint.strokeStyle = border.clone().lerp(new THREE.Color("#ffffff"), 0.55).getStyle();
    paint.lineWidth = 5;
    const tick = Math.min(26, canvas.width * 0.06);
    for (const [cx, cy, dx, dy] of [
      [6, 6, 1, 1],
      [canvas.width - 6, 6, -1, 1],
      [6, canvas.height - 6, 1, -1],
      [canvas.width - 6, canvas.height - 6, -1, -1],
    ] as const) {
      paint.beginPath();
      paint.moveTo(cx + dx * tick, cy);
      paint.lineTo(cx, cy);
      paint.lineTo(cx, cy + dy * tick);
      paint.stroke();
    }
    paint.fillStyle = color.getStyle();
    const fontSize = THREE.MathUtils.clamp(
      Math.floor((canvas.height / Math.max(2.2, lines.length + 0.7)) * (options.fontScale ?? 1)),
      18,
      64,
    );
    paint.font = `800 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    paint.textAlign = "center";
    paint.textBaseline = "middle";
    lines.forEach((line, index) => {
      paint.fillText(
        line,
        canvas.width / 2,
        ((index + 0.5) / lines.length) * canvas.height,
        canvas.width - 54,
      );
    });
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  panel.renderOrder = 13;
  return panel;
}

export function createGlyph(
  glyph: string,
  color: THREE.ColorRepresentation,
  size = 1.35,
) {
  return createPanel([glyph], {
    width: size,
    height: size,
    color,
    borderColor: color,
    background: "rgba(3,8,16,0.72)",
    fontScale: 1.2,
  });
}

export function faceCameraPlane(group: THREE.Object3D) {
  group.rotation.set(0, 0, 0);
}

export function orbitObject(
  object: THREE.Object3D,
  center: THREE.Vector3,
  radius: number,
  angle: number,
  verticalScale = 0.42,
) {
  object.position.set(
    center.x + Math.cos(angle) * radius,
    center.y + Math.sin(angle) * radius * verticalScale,
    center.z,
  );
}

export function pulseObject(
  object: THREE.Object3D,
  elapsed: number,
  speed = 4,
  amplitude = 0.08,
) {
  object.scale.setScalar(1 + Math.sin(elapsed * speed) * amplitude);
}

export function resetScale(object: THREE.Object3D) {
  object.scale.set(1, 1, 1);
}

export function copyPosition(object: THREE.Object3D, position: THREE.Vector3) {
  object.position.copy(position);
  return object;
}

export function vector(x: number, y: number, z: number) {
  return new THREE.Vector3(x, y, z);
}

export function lerpColor(
  material: THREE.MeshStandardMaterial,
  from: THREE.ColorRepresentation,
  to: THREE.ColorRepresentation,
  amount: number,
) {
  material.color.copy(new THREE.Color(from).lerp(new THREE.Color(to), amount));
  material.emissive.copy(material.color);
}

export function directionBetween(
  from: THREE.Vector3,
  to: THREE.Vector3,
) {
  return tempVector.copy(to).sub(from).normalize();
}
