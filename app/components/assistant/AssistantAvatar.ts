import * as THREE from "three";

import type {
  AssistantAvatarOptions,
  AssistantAvatarUpdate,
  AssistantState,
} from "./types";

const DOWN = new THREE.Vector3(0, -1, 0);
const TAU = Math.PI * 2;

interface WingRecord {
  pivot: THREE.Group;
  side: -1 | 1;
  layer: number;
  baseY: number;
  baseZ: number;
  phase: number;
}

interface ArmRig {
  root: THREE.Group;
  elbow: THREE.Group;
  hand: THREE.Mesh;
  side: -1 | 1;
}

function createPetalGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(-0.18, 0.18, -0.26, 0.58, 0, 1);
  shape.bezierCurveTo(0.26, 0.58, 0.18, 0.18, 0, 0);
  return new THREE.ShapeGeometry(shape, 24);
}

function createGlowMaterial(
  color: THREE.ColorRepresentation,
  opacity: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(color) },
      glowOpacity: { value: opacity },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float glowOpacity;
      varying vec2 vUv;

      void main() {
        float distanceFromCenter = length(vUv - vec2(0.5));
        float core = 1.0 - smoothstep(0.0, 0.5, distanceFromCenter);
        float halo = pow(max(core, 0.0), 2.35);
        gl_FragColor = vec4(glowColor, halo * glowOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

function createArm(
  side: -1 | 1,
  material: THREE.Material,
  jointMaterial: THREE.Material,
): ArmRig {
  const root = new THREE.Group();
  root.name = side === 1 ? "AssistantRightArm" : "AssistantLeftArm";
  root.position.set(side * 0.35, 0.39, 0.015);
  root.rotation.z = side * 0.27;

  const upperArm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.035, 0.25, 8, 20),
    material,
  );
  upperArm.position.y = -0.16;
  root.add(upperArm);

  const elbowJoint = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.052, 2),
    jointMaterial,
  );
  elbowJoint.position.y = -0.32;
  root.add(elbowJoint);

  const elbow = new THREE.Group();
  elbow.position.y = -0.32;
  elbow.rotation.z = side * 0.08;
  root.add(elbow);

  const forearm = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.029, 0.22, 8, 20),
    material,
  );
  forearm.position.y = -0.145;
  elbow.add(forearm);

  const hand = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.055, 2),
    jointMaterial,
  );
  hand.name = side === 1 ? "AssistantPointingHand" : "AssistantLeftHand";
  hand.scale.set(0.72, 1.15, 0.72);
  hand.position.y = -0.3;
  elbow.add(hand);

  return { root, elbow, hand, side };
}

/**
 * A renderer-agnostic, raw Three.js holographic guide.
 *
 * The public `group` can be inserted under any Object3D. Movement through the
 * world is intentionally left to AssistantController; this class owns only the
 * guide's visual pose, speech response, particles, and pointing beam.
 */
export class AssistantAvatar {
  readonly group = new THREE.Group();

  private readonly visualRoot = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly wings: WingRecord[] = [];
  private readonly earFins: THREE.Mesh[] = [];
  private readonly eyes: THREE.Mesh[] = [];
  private readonly leftArm: ArmRig;
  private readonly rightArm: ArmRig;
  private readonly chestCore: THREE.Mesh;
  private readonly crownCore: THREE.Mesh;
  private readonly mouth: THREE.Line;
  private readonly haloRings: THREE.Mesh[] = [];
  private readonly bodyGlowMaterial: THREE.ShaderMaterial;
  private readonly headGlowMaterial: THREE.ShaderMaterial;
  private readonly eyeMaterial: THREE.MeshBasicMaterial;
  private readonly coreMaterial: THREE.MeshStandardMaterial;
  private readonly particleMaterial: THREE.PointsMaterial;
  private readonly pointerMaterial: THREE.LineBasicMaterial;
  private readonly pointerTipMaterial: THREE.MeshBasicMaterial;
  private readonly pointerLine: THREE.Line;
  private readonly pointerTip: THREE.Mesh;
  private readonly pointerPositions = new Float32Array(6);
  private readonly particlePositions: Float32Array;
  private readonly particleBases: Float32Array;
  private readonly particlePhases: Float32Array;
  private readonly particlePositionAttribute: THREE.BufferAttribute;

  private readonly desiredArmQuaternion = new THREE.Quaternion();
  private readonly pointDirection = new THREE.Vector3();
  private readonly pointInArmSpace = new THREE.Vector3();
  private readonly pointerStartWorld = new THREE.Vector3();
  private readonly pointerStartLocal = new THREE.Vector3();
  private readonly pointerEndLocal = new THREE.Vector3();
  private readonly tempEuler = new THREE.Euler();

  private audioActivity = 0;
  private reducedMotion: boolean;
  private disposed = false;

  constructor(options: AssistantAvatarOptions = {}) {
    const primary = options.primaryColor ?? "#66efff";
    const accent = options.accentColor ?? "#9fffe6";
    const warm = options.warmColor ?? "#ffd776";
    const scale = options.scale ?? 1;

    this.reducedMotion = options.reducedMotion ?? false;
    this.group.name = "RealtimeAssistantAvatar";
    this.group.userData.assistantAvatar = true;
    this.group.userData.assistantNonInteractive = true;
    this.visualRoot.name = "AssistantVisualRoot";
    this.visualRoot.scale.setScalar(scale);
    this.group.add(this.visualRoot);

    const petalGeometry = createPetalGeometry();
    const shellMaterial = new THREE.MeshPhysicalMaterial({
      color: primary,
      emissive: new THREE.Color(primary).multiplyScalar(0.32),
      emissiveIntensity: 1.65,
      roughness: 0.17,
      metalness: 0.08,
      transmission: 0.18,
      transparent: true,
      opacity: 0.43,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const veilMaterial = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.19,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const warmVeilMaterial = new THREE.MeshBasicMaterial({
      color: warm,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const darkFaceMaterial = new THREE.MeshBasicMaterial({
      color: "#06131f",
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const limbMaterial = new THREE.MeshPhysicalMaterial({
      color: primary,
      emissive: new THREE.Color(primary).multiplyScalar(0.45),
      emissiveIntensity: 1.45,
      roughness: 0.18,
      metalness: 0.18,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
    });

    this.eyeMaterial = new THREE.MeshBasicMaterial({
      color: "#e8ffff",
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      depthWrite: false,
    });
    this.coreMaterial = new THREE.MeshStandardMaterial({
      color: warm,
      emissive: warm,
      emissiveIntensity: 2.5,
      roughness: 0.18,
      metalness: 0.3,
      transparent: true,
      opacity: 0.95,
      toneMapped: false,
    });

    this.bodyGlowMaterial = createGlowMaterial(primary, 0.34);
    this.headGlowMaterial = createGlowMaterial(accent, 0.34);
    const bodyGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      this.bodyGlowMaterial,
    );
    bodyGlow.name = "AssistantBodyAura";
    bodyGlow.position.set(0, 0.04, -0.26);
    bodyGlow.scale.set(2.35, 2.55, 1);
    this.visualRoot.add(bodyGlow);

    const headGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      this.headGlowMaterial,
    );
    headGlow.name = "AssistantFaceAura";
    headGlow.position.set(0, 0.68, -0.04);
    headGlow.scale.set(0.96, 0.96, 1);
    this.visualRoot.add(headGlow);

    const rearHalo = new THREE.Mesh(
      new THREE.TorusGeometry(0.43, 0.009, 12, 96),
      warmVeilMaterial,
    );
    rearHalo.name = "AssistantHeadHalo";
    rearHalo.position.set(0, 0.7, -0.13);
    this.visualRoot.add(rearHalo);
    this.haloRings.push(rearHalo);

    const orbitHalo = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.008, 12, 112),
      veilMaterial,
    );
    orbitHalo.name = "AssistantOrbitHalo";
    orbitHalo.position.y = -0.52;
    orbitHalo.rotation.x = Math.PI / 2;
    orbitHalo.scale.z = 0.62;
    this.visualRoot.add(orbitHalo);
    this.haloRings.push(orbitHalo);

    this.buildWings(petalGeometry, veilMaterial, warmVeilMaterial);
    this.buildBody(petalGeometry, shellMaterial, veilMaterial, warmVeilMaterial);
    this.buildHead(petalGeometry, shellMaterial, veilMaterial, darkFaceMaterial);

    this.leftArm = createArm(-1, limbMaterial, this.coreMaterial);
    this.rightArm = createArm(1, limbMaterial, this.coreMaterial);
    this.torso.add(this.leftArm.root, this.rightArm.root);

    this.chestCore = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.105, 0),
      this.coreMaterial,
    );
    this.chestCore.name = "AssistantVoiceCore";
    this.chestCore.position.set(0, 0.23, 0.29);
    this.chestCore.scale.set(0.72, 1.16, 0.5);
    this.torso.add(this.chestCore);

    this.crownCore = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.095, 0),
      this.coreMaterial,
    );
    this.crownCore.name = "AssistantCrownCore";
    this.crownCore.position.set(0, 1.06, 0.01);
    this.crownCore.scale.set(0.74, 1.35, 0.6);
    this.visualRoot.add(this.crownCore);

    const mouthCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.09, -0.005, 0),
      new THREE.Vector3(-0.06, -0.026, 0),
      new THREE.Vector3(-0.025, -0.038, 0),
      new THREE.Vector3(0.025, -0.038, 0),
      new THREE.Vector3(0.06, -0.026, 0),
      new THREE.Vector3(0.09, -0.005, 0),
    ]);
    const mouthGeometry = new THREE.BufferGeometry().setFromPoints(
      mouthCurve.getPoints(32),
    );
    this.mouth = new THREE.Line(
      mouthGeometry,
      new THREE.LineBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.mouth.name = "AssistantMouth";
    this.mouth.position.set(0, 0.62, 0.292);
    this.visualRoot.add(this.mouth);

    const particleCount = 42;
    this.particlePositions = new Float32Array(particleCount * 3);
    this.particleBases = new Float32Array(particleCount * 3);
    this.particlePhases = new Float32Array(particleCount);
    for (let index = 0; index < particleCount; index += 1) {
      const phase = (index * 2.399963229728653) % TAU;
      const band = (index % 7) / 6;
      const radius = 0.38 + 0.3 * ((index * 17) % 11) / 10;
      const offset = index * 3;
      this.particleBases[offset] = Math.cos(phase) * radius;
      this.particleBases[offset + 1] = -0.86 + band * 1.73;
      this.particleBases[offset + 2] = Math.sin(phase) * radius * 0.55;
      this.particlePositions[offset] = this.particleBases[offset];
      this.particlePositions[offset + 1] = this.particleBases[offset + 1];
      this.particlePositions[offset + 2] = this.particleBases[offset + 2];
      this.particlePhases[index] = phase;
    }
    const particleGeometry = new THREE.BufferGeometry();
    this.particlePositionAttribute = new THREE.BufferAttribute(
      this.particlePositions,
      3,
    );
    particleGeometry.setAttribute("position", this.particlePositionAttribute);
    this.particleMaterial = new THREE.PointsMaterial({
      color: primary,
      size: 0.035,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const particles = new THREE.Points(particleGeometry, this.particleMaterial);
    particles.name = "AssistantSparkles";
    this.visualRoot.add(particles);

    const pointerGeometry = new THREE.BufferGeometry();
    pointerGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.pointerPositions, 3),
    );
    this.pointerMaterial = new THREE.LineBasicMaterial({
      color: warm,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.pointerLine = new THREE.Line(pointerGeometry, this.pointerMaterial);
    this.pointerLine.name = "AssistantPointerBeam";
    this.pointerLine.frustumCulled = false;
    this.pointerLine.visible = false;
    this.group.add(this.pointerLine);

    this.pointerTipMaterial = new THREE.MeshBasicMaterial({
      color: warm,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.pointerTip = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.055 * Math.max(0.8, scale), 2),
      this.pointerTipMaterial,
    );
    this.pointerTip.name = "AssistantPointerTarget";
    this.pointerTip.visible = false;
    this.group.add(this.pointerTip);

    this.visualRoot.add(this.torso, this.head);

    this.group.traverse((object) => {
      object.userData.assistantNonInteractive = true;
      if (options.layer !== undefined) object.layers.set(options.layer);
    });
  }

  private buildWings(
    petalGeometry: THREE.ShapeGeometry,
    veilMaterial: THREE.Material,
    warmVeilMaterial: THREE.Material,
  ): void {
    const wingRoot = new THREE.Group();
    wingRoot.name = "AssistantWingCrown";
    wingRoot.position.set(0, 0.31, -0.13);
    this.visualRoot.add(wingRoot);

    for (const side of [-1, 1] as const) {
      for (let layer = 0; layer < 4; layer += 1) {
        const pivot = new THREE.Group();
        const spread = 0.47 + layer * 0.23;
        const baseZ = side * (0.46 + layer * 0.19);
        const baseY = side * (0.06 + layer * 0.025);
        pivot.position.set(side * 0.13, 0.05 - layer * 0.055, -layer * 0.018);
        pivot.rotation.set(0, baseY, baseZ);

        const petal = new THREE.Mesh(
          petalGeometry,
          layer === 1 ? warmVeilMaterial : veilMaterial,
        );
        petal.name = `Assistant${side === 1 ? "Right" : "Left"}WingPetal${layer}`;
        petal.scale.set(spread * (side === 1 ? 1 : -1), 0.76 - layer * 0.055, 1);
        pivot.add(petal);
        wingRoot.add(pivot);
        this.wings.push({
          pivot,
          side,
          layer,
          baseY,
          baseZ,
          phase: layer * 0.83 + (side === 1 ? 0 : Math.PI),
        });
      }
    }

    const tailPetal = new THREE.Mesh(petalGeometry, veilMaterial);
    tailPetal.name = "AssistantTrailingVeil";
    tailPetal.position.set(0, 0.06, -0.06);
    tailPetal.rotation.z = Math.PI;
    tailPetal.scale.set(0.34, 1.12, 1);
    wingRoot.add(tailPetal);
  }

  private buildBody(
    petalGeometry: THREE.ShapeGeometry,
    shellMaterial: THREE.Material,
    veilMaterial: THREE.Material,
    warmVeilMaterial: THREE.Material,
  ): void {
    this.torso.name = "AssistantTorso";

    const chest = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.36, 3),
      shellMaterial,
    );
    chest.name = "AssistantCrystalTorso";
    chest.position.y = 0.13;
    chest.scale.set(0.75, 1.26, 0.62);
    this.torso.add(chest);

    const waistRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.018, 12, 64),
      warmVeilMaterial,
    );
    waistRing.name = "AssistantWaistRing";
    waistRing.position.y = -0.18;
    waistRing.rotation.x = Math.PI / 2;
    waistRing.scale.z = 0.62;
    this.torso.add(waistRing);

    for (let index = 0; index < 8; index += 1) {
      const angle = index / 8 * TAU;
      const material = index % 3 === 0 ? warmVeilMaterial : veilMaterial;
      const petal = new THREE.Mesh(petalGeometry, material);
      petal.name = `AssistantSkirtPetal${index}`;
      petal.position.set(
        Math.sin(angle) * 0.055,
        -0.16,
        Math.cos(angle) * 0.055,
      );
      petal.rotation.set(0, angle, Math.PI + Math.sin(angle) * 0.14);
      petal.scale.set(0.24, 0.7 + (index % 2) * 0.1, 1);
      this.torso.add(petal);
    }

    for (const side of [-1, 1] as const) {
      const collar = new THREE.Mesh(petalGeometry, veilMaterial);
      collar.name = `Assistant${side === 1 ? "Right" : "Left"}CollarPetal`;
      collar.position.set(side * 0.1, 0.38, 0.01);
      collar.rotation.z = side * -1.06;
      collar.scale.set(side * 0.22, 0.42, 1);
      this.torso.add(collar);
    }
  }

  private buildHead(
    petalGeometry: THREE.ShapeGeometry,
    shellMaterial: THREE.Material,
    veilMaterial: THREE.Material,
    darkFaceMaterial: THREE.Material,
  ): void {
    this.head.name = "AssistantHead";

    const headShell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.32, 3),
      shellMaterial,
    );
    headShell.name = "AssistantHeadShell";
    headShell.position.y = 0.71;
    headShell.scale.set(0.9, 1.08, 0.82);
    this.head.add(headShell);

    const face = new THREE.Mesh(
      new THREE.CircleGeometry(0.226, 48),
      darkFaceMaterial,
    );
    face.name = "AssistantFace";
    face.position.set(0, 0.69, 0.262);
    face.scale.set(0.91, 1.03, 1);
    this.head.add(face);

    for (const side of [-1, 1] as const) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.057, 24, 16),
        this.eyeMaterial,
      );
      eye.name = `Assistant${side === 1 ? "Right" : "Left"}Eye`;
      eye.position.set(side * 0.092, 0.73, 0.285);
      eye.scale.set(1.08, 0.66, 0.28);
      this.head.add(eye);
      this.eyes.push(eye);

      const earPivot = new THREE.Group();
      earPivot.position.set(side * 0.245, 0.72, 0.01);
      earPivot.rotation.z = side * -0.64;
      const ear = new THREE.Mesh(petalGeometry, veilMaterial);
      ear.name = `Assistant${side === 1 ? "Right" : "Left"}ListeningFin`;
      ear.scale.set(side * 0.21, 0.48, 1);
      earPivot.add(ear);
      this.head.add(earPivot);
      this.earFins.push(ear);
    }
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  update({
    deltaSeconds,
    elapsedSeconds,
    state,
    audioActivity = 0,
    pointTarget = null,
    reducedMotion = this.reducedMotion,
  }: AssistantAvatarUpdate): void {
    if (this.disposed) return;

    const delta = THREE.MathUtils.clamp(
      Number.isFinite(deltaSeconds) ? deltaSeconds : 0,
      0,
      0.1,
    );
    const elapsed = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
    const requestedActivity = THREE.MathUtils.clamp(
      Number.isFinite(audioActivity) ? audioActivity : 0,
      0,
      1,
    );
    const activityDamping = reducedMotion ? 1 : 1 - Math.exp(-12 * delta);
    this.audioActivity += (requestedActivity - this.audioActivity) * activityDamping;
    const activeSpeech = state === "speak" || state === "point";
    const voice = activeSpeech ? this.audioActivity : this.audioActivity * 0.2;
    const listening = state === "listen" ? 1 : 0;
    const travel = state === "travel" ? 1 : 0;
    const motion = !reducedMotion;

    this.group.userData.assistantState = state;
    this.visualRoot.position.y = motion
      ? Math.sin(elapsed * (travel ? 3.1 : 1.65)) * (travel ? 0.038 : 0.026)
      : 0;
    this.visualRoot.rotation.z = motion && travel
      ? Math.sin(elapsed * 2.4) * 0.035
      : 0;

    this.head.rotation.z = motion
      ? listening * -0.085 + Math.sin(elapsed * 1.05) * 0.012
      : listening * -0.045;
    this.head.rotation.y = motion
      ? Math.sin(elapsed * 0.73) * 0.026
      : 0;

    const ringMotion = motion ? elapsed : 0;
    this.haloRings[0].rotation.z = ringMotion * 0.13;
    this.haloRings[1].rotation.z = ringMotion * -0.23;

    const flutterSpeed = travel ? 7.5 : activeSpeech ? 4.4 : listening ? 2.2 : 1.55;
    const flutterAmount = motion
      ? travel ? 0.15 : activeSpeech ? 0.09 + voice * 0.06 : 0.045
      : 0;
    for (const wing of this.wings) {
      const wave = Math.sin(elapsed * flutterSpeed + wing.phase);
      wing.pivot.rotation.y = wing.baseY + wing.side * wave * flutterAmount;
      wing.pivot.rotation.z = wing.baseZ
        + wing.side * wave * flutterAmount * (0.42 + wing.layer * 0.08);
    }

    const corePulse = 1 + voice * 0.36
      + (motion ? Math.sin(elapsed * 3.4) * 0.035 : 0);
    this.chestCore.scale.set(0.72 * corePulse, 1.16 * corePulse, 0.5 * corePulse);
    const crownPulse = 1 + (listening * 0.12 + voice * 0.12)
      + (motion ? Math.sin(elapsed * 2.3 + 0.8) * 0.025 : 0);
    this.crownCore.scale.set(0.74 * crownPulse, 1.35 * crownPulse, 0.6 * crownPulse);
    this.coreMaterial.emissiveIntensity = 2.3 + voice * 3.4 + listening * 0.55;

    this.eyeMaterial.opacity = THREE.MathUtils.clamp(
      0.88 + listening * 0.1 + voice * 0.12,
      0,
      1,
    );
    const eyeHeight = 0.66 + listening * 0.18 + voice * 0.12;
    for (const eye of this.eyes) eye.scale.y = eyeHeight;
    this.mouth.scale.y = activeSpeech ? 0.85 + voice * 2.15 : 0.72;
    this.mouth.visible = state !== "travel";

    const finScale = 1 + listening * 0.28;
    for (const fin of this.earFins) fin.scale.y = 0.48 * finScale;

    this.bodyGlowMaterial.uniforms.glowOpacity.value = 0.27
      + voice * 0.18
      + travel * 0.08;
    this.headGlowMaterial.uniforms.glowOpacity.value = 0.3
      + listening * 0.14
      + voice * 0.2;

    this.animateParticles(elapsed, state, voice, motion);
    this.animateArms(delta, elapsed, state, pointTarget, motion);
    this.updatePointer(elapsed, state, pointTarget, motion);
  }

  private animateParticles(
    elapsed: number,
    state: AssistantState,
    voice: number,
    motion: boolean,
  ): void {
    const speed = state === "travel" ? 0.48 : state === "speak" ? 0.31 : 0.2;
    for (let index = 0; index < this.particlePhases.length; index += 1) {
      const offset = index * 3;
      if (!motion) {
        this.particlePositions[offset] = this.particleBases[offset];
        this.particlePositions[offset + 1] = this.particleBases[offset + 1];
        this.particlePositions[offset + 2] = this.particleBases[offset + 2];
        continue;
      }

      const phase = this.particlePhases[index];
      const verticalTravel = (elapsed * speed + phase / TAU) % 1.74;
      this.particlePositions[offset] = this.particleBases[offset]
        + Math.sin(elapsed * 1.5 + phase) * (0.025 + voice * 0.035);
      this.particlePositions[offset + 1] = -0.87 + verticalTravel;
      this.particlePositions[offset + 2] = this.particleBases[offset + 2]
        + Math.cos(elapsed * 1.1 + phase) * 0.025;
    }

    this.particlePositionAttribute.needsUpdate = true;
    this.particleMaterial.opacity = motion ? 0.56 + voice * 0.32 : 0.34;
    this.particleMaterial.size = 0.033 + voice * 0.015;
  }

  private animateArms(
    delta: number,
    elapsed: number,
    state: AssistantState,
    pointTarget: THREE.Vector3 | null,
    motion: boolean,
  ): void {
    const armDamping = motion ? 1 - Math.exp(-11 * delta) : 1;
    const isPointing = (state === "point" || state === "speak") && pointTarget !== null;

    this.group.updateWorldMatrix(true, true);
    if (isPointing && this.rightArm.root.parent) {
      this.pointInArmSpace.copy(pointTarget);
      this.rightArm.root.parent.worldToLocal(this.pointInArmSpace);
      this.pointDirection
        .copy(this.pointInArmSpace)
        .sub(this.rightArm.root.position);
      if (this.pointDirection.lengthSq() > 0.000001) {
        this.pointDirection.normalize();
        this.desiredArmQuaternion.setFromUnitVectors(DOWN, this.pointDirection);
        this.rightArm.root.quaternion.slerp(
          this.desiredArmQuaternion,
          armDamping,
        );
      }
      this.rightArm.elbow.rotation.z *= 1 - armDamping;
    } else {
      const speechGesture = state === "speak" && motion
        ? Math.sin(elapsed * 2.7) * 0.12
        : 0;
      this.tempEuler.set(
        state === "speak" ? -0.08 - Math.abs(speechGesture) * 0.7 : 0,
        0,
        this.rightArm.side * (0.27 + speechGesture),
      );
      this.desiredArmQuaternion.setFromEuler(this.tempEuler);
      this.rightArm.root.quaternion.slerp(this.desiredArmQuaternion, armDamping);
      this.rightArm.elbow.rotation.z = this.rightArm.side
        * (0.08 + (state === "speak" ? 0.12 : 0));
    }

    const leftGesture = state === "speak" && motion
      ? Math.sin(elapsed * 2.7 + 1.4) * 0.16
      : state === "listen" ? -0.08 : 0;
    this.tempEuler.set(
      state === "speak" ? -0.12 : 0,
      0,
      this.leftArm.side * (0.27 + leftGesture),
    );
    this.desiredArmQuaternion.setFromEuler(this.tempEuler);
    this.leftArm.root.quaternion.slerp(this.desiredArmQuaternion, armDamping);
    this.leftArm.elbow.rotation.z = this.leftArm.side
      * (0.08 + (state === "speak" ? 0.16 : 0));
  }

  private updatePointer(
    elapsed: number,
    state: AssistantState,
    pointTarget: THREE.Vector3 | null,
    motion: boolean,
  ): void {
    const visible = (state === "point" || state === "speak") && pointTarget !== null;
    this.pointerLine.visible = visible;
    this.pointerTip.visible = visible;
    if (!visible || pointTarget === null) {
      this.pointerMaterial.opacity = 0;
      this.pointerTipMaterial.opacity = 0;
      return;
    }

    this.group.updateWorldMatrix(true, true);
    this.rightArm.hand.getWorldPosition(this.pointerStartWorld);
    this.pointerStartLocal.copy(this.pointerStartWorld);
    this.group.worldToLocal(this.pointerStartLocal);
    this.pointerEndLocal.copy(pointTarget);
    this.group.worldToLocal(this.pointerEndLocal);

    this.pointerPositions[0] = this.pointerStartLocal.x;
    this.pointerPositions[1] = this.pointerStartLocal.y;
    this.pointerPositions[2] = this.pointerStartLocal.z;
    this.pointerPositions[3] = this.pointerEndLocal.x;
    this.pointerPositions[4] = this.pointerEndLocal.y;
    this.pointerPositions[5] = this.pointerEndLocal.z;
    const attribute = this.pointerLine.geometry.getAttribute("position") as THREE.BufferAttribute;
    attribute.needsUpdate = true;
    this.pointerTip.position.copy(this.pointerEndLocal);
    const pulse = motion ? 0.82 + Math.sin(elapsed * 7.2) * 0.18 : 0.9;
    this.pointerTip.scale.setScalar(pulse);
    this.pointerMaterial.opacity = 0.64 + pulse * 0.18;
    this.pointerTipMaterial.opacity = 0.72 + pulse * 0.2;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)
        && !(object instanceof THREE.Line)
        && !(object instanceof THREE.Points)
        && !(object instanceof THREE.Sprite)) return;

      if ("geometry" in object && object.geometry instanceof THREE.BufferGeometry) {
        geometries.add(object.geometry);
      }
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of objectMaterials) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    });
    textures.forEach((texture) => texture.dispose());
    materials.forEach((material) => material.dispose());
    geometries.forEach((geometry) => geometry.dispose());
    this.group.clear();
  }
}

export function createAssistantAvatar(
  options: AssistantAvatarOptions = {},
): AssistantAvatar {
  return new AssistantAvatar(options);
}
