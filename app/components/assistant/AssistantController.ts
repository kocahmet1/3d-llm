import * as THREE from "three";

import { AssistantAvatar } from "./AssistantAvatar";
import type {
  AssistantControllerOptions,
  AssistantControllerUpdate,
  AssistantState,
  AssistantTravelOptions,
} from "./types";

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Movement and state machine for AssistantAvatar.
 *
 * World-space inputs are copied immediately. This is deliberate: a target is
 * frozen for the voice turn even if the visitor looks at another component.
 */
export class AssistantController {
  readonly avatar: AssistantAvatar;
  readonly group: THREE.Group;

  private readonly parent: THREE.Object3D;
  private camera: THREE.Camera | null;
  private currentState: AssistantState;
  private targetAvailable = false;
  private readonly targetWorld = new THREE.Vector3();
  private readonly followOffset = new THREE.Vector3(1.28, -0.02, -2.15);
  private presentationDistance: number;
  private presentationSideOffset: number;
  private presentationHeight: number;
  private readonly defaultPresentationDistance: number;
  private readonly defaultPresentationSideOffset: number;
  private readonly defaultPresentationHeight: number;
  private readonly followResponsiveness: number;
  private readonly travelResponsiveness: number;
  private arrivalState: Exclude<AssistantState, "travel"> = "present";
  private readonly onStateChange?: (
    state: AssistantState,
    previous: AssistantState,
  ) => void;

  private reducedMotion: boolean;
  private motionQuery: MediaQueryList | null = null;
  private motionQueryListener: ((event: MediaQueryListEvent) => void) | null = null;
  private positionInitialized = false;
  private disposed = false;

  private readonly cameraWorld = new THREE.Vector3();
  private readonly desiredWorld = new THREE.Vector3();
  private readonly desiredLocal = new THREE.Vector3();
  private readonly towardCamera = new THREE.Vector3();
  private readonly presentationSide = new THREE.Vector3();
  private readonly facingDirection = new THREE.Vector3();
  private readonly cameraWorldQuaternion = new THREE.Quaternion();
  private readonly parentWorldQuaternion = new THREE.Quaternion();
  private readonly desiredWorldQuaternion = new THREE.Quaternion();
  private readonly desiredLocalQuaternion = new THREE.Quaternion();

  constructor(options: AssistantControllerOptions) {
    this.parent = options.parent;
    this.camera = options.camera ?? null;
    this.currentState = options.initialState ?? "follow";
    this.onStateChange = options.onStateChange;
    this.defaultPresentationDistance = Math.max(
      0.05,
      options.presentationDistance ?? 1.35,
    );
    this.defaultPresentationSideOffset = options.presentationSideOffset ?? 0.62;
    this.defaultPresentationHeight = options.presentationHeight ?? 0.12;
    this.presentationDistance = this.defaultPresentationDistance;
    this.presentationSideOffset = this.defaultPresentationSideOffset;
    this.presentationHeight = this.defaultPresentationHeight;
    this.followResponsiveness = Math.max(0.1, options.followResponsiveness ?? 7.5);
    this.travelResponsiveness = Math.max(0.1, options.travelResponsiveness ?? 3.8);

    const requestedOffset = options.followOffset;
    if (requestedOffset instanceof THREE.Vector3) {
      this.followOffset.copy(requestedOffset);
    } else if (requestedOffset) {
      this.followOffset.set(
        requestedOffset[0],
        requestedOffset[1],
        requestedOffset[2],
      );
    }

    this.reducedMotion = options.reducedMotion ?? this.detectReducedMotion();
    this.avatar = new AssistantAvatar({
      scale: options.scale,
      primaryColor: options.primaryColor,
      accentColor: options.accentColor,
      warmColor: options.warmColor,
      reducedMotion: this.reducedMotion,
      layer: options.layer,
    });
    this.group = this.avatar.group;
    this.group.userData.assistantState = this.currentState;
    this.parent.add(this.group);

    if (options.reducedMotion === undefined
      && typeof window !== "undefined"
      && typeof window.matchMedia === "function") {
      this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.motionQueryListener = (event) => this.setReducedMotion(event.matches);
      this.motionQuery.addEventListener("change", this.motionQueryListener);
    }
  }

  get state(): AssistantState {
    return this.currentState;
  }

  get hasTarget(): boolean {
    return this.targetAvailable;
  }

  private detectReducedMotion(): boolean {
    return typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
    this.avatar.setReducedMotion(enabled);
  }

  setState(next: AssistantState): void {
    if (this.disposed || next === this.currentState) return;
    if (next === "travel" && !this.targetAvailable) return;
    const previous = this.currentState;
    this.currentState = next;
    this.group.userData.assistantState = next;
    this.onStateChange?.(next, previous);
  }

  setTarget(targetWorldPosition: THREE.Vector3): void {
    this.targetWorld.copy(targetWorldPosition);
    this.targetAvailable = true;
    this.group.userData.assistantHasTarget = true;
  }

  clearTarget(): void {
    this.targetAvailable = false;
    this.group.userData.assistantHasTarget = false;
  }

  /** Copies the frozen target into `result` without exposing mutable state. */
  copyTarget(result: THREE.Vector3): boolean {
    if (!this.targetAvailable) return false;
    result.copy(this.targetWorld);
    return true;
  }

  follow(clearTarget = true): void {
    if (clearTarget) this.clearTarget();
    this.restorePresentationDefaults();
    this.setState("follow");
  }

  travelTo(
    targetWorldPosition: THREE.Vector3,
    options: AssistantTravelOptions = {},
  ): void {
    this.setTarget(targetWorldPosition);
    this.arrivalState = options.arriveAs ?? "present";
    this.presentationDistance = Math.max(
      0.05,
      options.presentationDistance ?? this.defaultPresentationDistance,
    );
    this.presentationSideOffset = options.presentationSideOffset
      ?? this.defaultPresentationSideOffset;
    this.presentationHeight = options.presentationHeight
      ?? this.defaultPresentationHeight;
    this.setState("travel");
  }

  present(targetWorldPosition?: THREE.Vector3): void {
    if (targetWorldPosition) this.setTarget(targetWorldPosition);
    this.setState("present");
  }

  listen(targetWorldPosition?: THREE.Vector3): void {
    if (targetWorldPosition) this.setTarget(targetWorldPosition);
    this.setState("listen");
  }

  speak(targetWorldPosition?: THREE.Vector3): void {
    if (targetWorldPosition) this.setTarget(targetWorldPosition);
    this.setState("speak");
  }

  pointAt(targetWorldPosition: THREE.Vector3): void {
    this.setTarget(targetWorldPosition);
    this.setState("point");
  }

  update({
    deltaSeconds,
    elapsedSeconds,
    camera,
    targetWorldPosition,
    audioActivity = 0,
  }: AssistantControllerUpdate): void {
    if (this.disposed) return;
    if (camera) this.camera = camera;
    if (targetWorldPosition === null) this.clearTarget();
    else if (targetWorldPosition !== undefined) this.setTarget(targetWorldPosition);

    const delta = THREE.MathUtils.clamp(
      Number.isFinite(deltaSeconds) ? deltaSeconds : 0,
      0,
      0.1,
    );
    this.computeDesiredPosition();
    this.moveTowardDesired(delta);
    this.faceVisitor(delta);

    if (this.currentState === "travel" && this.positionInitialized) {
      const arrivalRadius = Math.max(0.035, 0.075 * this.avatar.group.scale.x);
      if (this.group.position.distanceToSquared(this.desiredLocal)
        <= arrivalRadius * arrivalRadius) {
        this.setState(this.arrivalState);
      }
    }

    this.avatar.update({
      deltaSeconds: delta,
      elapsedSeconds,
      state: this.currentState,
      audioActivity,
      pointTarget: (this.currentState === "point" || this.currentState === "speak") && this.targetAvailable
        ? this.targetWorld
        : null,
      reducedMotion: this.reducedMotion,
    });
  }

  private computeDesiredPosition(): void {
    if (this.camera) {
      this.camera.getWorldPosition(this.cameraWorld);
    }

    const shouldPresent = this.targetAvailable && this.currentState !== "follow";
    if (!shouldPresent) {
      if (this.camera) {
        this.camera.getWorldQuaternion(this.cameraWorldQuaternion);
        this.desiredWorld
          .copy(this.followOffset)
          .applyQuaternion(this.cameraWorldQuaternion)
          .add(this.cameraWorld);
      } else {
        this.group.getWorldPosition(this.desiredWorld);
      }
    } else {
      if (this.camera) {
        this.towardCamera.copy(this.cameraWorld).sub(this.targetWorld);
        this.towardCamera.y = 0;
        if (this.towardCamera.lengthSq() < 0.000001) {
          this.towardCamera.set(0, 0, 1);
        } else {
          this.towardCamera.normalize();
        }
      } else {
        this.towardCamera.set(0, 0, 1);
      }
      this.presentationSide.crossVectors(WORLD_UP, this.towardCamera).normalize();
      this.desiredWorld
        .copy(this.targetWorld)
        .addScaledVector(this.towardCamera, this.presentationDistance)
        .addScaledVector(this.presentationSide, this.presentationSideOffset);
      this.desiredWorld.y += this.presentationHeight;
    }

    this.parent.updateWorldMatrix(true, false);
    this.desiredLocal.copy(this.desiredWorld);
    this.parent.worldToLocal(this.desiredLocal);
  }

  private moveTowardDesired(delta: number): void {
    if (!this.positionInitialized) {
      this.group.position.copy(this.desiredLocal);
      this.positionInitialized = true;
      return;
    }
    const responsiveness = this.currentState === "travel"
      ? this.travelResponsiveness
      : this.followResponsiveness;
    const alpha = this.reducedMotion ? 1 : 1 - Math.exp(-responsiveness * delta);
    this.group.position.lerp(this.desiredLocal, alpha);
  }

  private faceVisitor(delta: number): void {
    if (!this.camera) return;
    this.group.getWorldPosition(this.desiredWorld);
    this.facingDirection.copy(this.cameraWorld).sub(this.desiredWorld);
    this.facingDirection.y = 0;
    if (this.facingDirection.lengthSq() < 0.000001) return;

    const yaw = Math.atan2(this.facingDirection.x, this.facingDirection.z);
    this.desiredWorldQuaternion.setFromAxisAngle(WORLD_UP, yaw);
    this.parent.getWorldQuaternion(this.parentWorldQuaternion).invert();
    this.desiredLocalQuaternion
      .copy(this.parentWorldQuaternion)
      .multiply(this.desiredWorldQuaternion);
    const alpha = this.reducedMotion ? 1 : 1 - Math.exp(-10 * delta);
    this.group.quaternion.slerp(this.desiredLocalQuaternion, alpha);
  }

  private restorePresentationDefaults(): void {
    this.presentationDistance = this.defaultPresentationDistance;
    this.presentationSideOffset = this.defaultPresentationSideOffset;
    this.presentationHeight = this.defaultPresentationHeight;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.motionQuery && this.motionQueryListener) {
      this.motionQuery.removeEventListener("change", this.motionQueryListener);
    }
    this.motionQuery = null;
    this.motionQueryListener = null;
    this.avatar.dispose();
  }
}

export function createAssistantController(
  options: AssistantControllerOptions,
): AssistantController {
  return new AssistantController(options);
}
