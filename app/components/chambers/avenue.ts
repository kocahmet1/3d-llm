import * as THREE from "three";

/**
 * The walkable avenue layout grammar.
 *
 * Chambers used to compose their exhibits as one framed tableau: every board
 * was pushed into a single shallow slab of space around the dais, so near
 * boards sat on top of far ones and the order of the computation was lost. The
 * avenue replaces that with a processional arrangement the visitor moves
 * through.
 *
 * The visitor spawns near the entrance at +z and walks toward the exit at −z.
 * Each step of the computation owns a *stop* — a band of the avenue — and
 * three rules keep the walk legible:
 *
 *  1. **Sequential steps advance.** Consecutive steps take consecutive stops on
 *     alternating sides, so no board is ever directly behind the one before it.
 *  2. **Parallel operands stack.** Things that happen at the same time (E and
 *     P, W_Q/W_K/W_V, the two heads) share one stop, either as a left/right
 *     pair or as a vertical triptych in one lane. Their symmetry becomes
 *     visible instead of being flattened into a row of look-alike boards.
 *  3. **The corridor stays empty.** Nothing hangs inside `corridorHalfWidth`
 *     below `corridorClearY`; anything centred on the avenue is lifted into the
 *     arch tier and the visitor simply walks under it.
 *
 * All coordinates are chamber world units: avenue chambers are authored at
 * `exhibitScale: 1` with no exhibit offset, so what is written here is exactly
 * what gets measured by `scripts/audit-chamber-layout.mts`.
 */
export const AVENUE = {
  /** Deck height every chamber shell walks on. */
  deckY: -4.7,
  /** Eye height while free-roaming a chamber. */
  eyeY: 2.15,
  /** Half-width of the walking corridor down the middle of the avenue. */
  corridorHalfWidth: 3.7,
  /** Nothing may hang inside the corridor below this height. */
  corridorClearY: 3.1,
  /** Board centre height for the main reading row. */
  standY: 1.9,
  /** Vertical gap between stacked rows in one lane. */
  rowPitch: 4.6,
  /** Centre height for exhibits that span the corridor. */
  archY: 5.9,
  /**
   * Centre height for the banner that names the chamber. Banners are hung a
   * little way *into* the avenue rather than over the threshold: directly above
   * the spawn point they would sit outside the top of the visitor's view.
   */
  bannerY: 8.0,
  /** How far past the first stop a banner hangs. */
  bannerZShift: -4,
  /** z of the first stop the visitor reaches after spawning. */
  firstStopZ: 13.2,
  /** Distance between consecutive stops. */
  stopSpacing: 6.4,
  /** Lane offset from the centre line at the first stop. */
  laneX: 6.9,
  /**
   * How much further out each successive lane sits. Kept small on purpose: a
   * near-constant lane offset lets ordinary one-point perspective do the
   * separating, so successive boards step visibly toward the centre line as
   * they recede. Fanning the lanes out as fast as the distance grows would
   * cancel that and pile every board onto the same sightline.
   */
  laneSpread: 0.45,
  /** Extra offset for a board in the outer lane. */
  outerLaneGap: 6.4,
  /** Inward yaw for lane boards, radians (~21°). */
  laneYaw: 0.37,
  /** Inward yaw for outer-lane boards, radians (~31°). */
  outerLaneYaw: 0.54,
} as const;

export type AvenueSlot =
  | "left"
  | "right"
  | "outer-left"
  | "outer-right"
  | "centre"
  | "banner";

export interface AvenuePlacement {
  /** Flow position along the walk; 0 is the stop nearest the entrance. */
  stop: number;
  slot: AvenueSlot;
  /**
   * Vertical row within the slot, in units of `rowPitch`. Use +1/0/−1 for a
   * triptych of parallel operands; fractional values are fine for captions.
   */
  row?: number;
  /** Fine adjustment applied after the grammar has picked the slot. */
  offset?: readonly [number, number, number];
  /** Extra yaw on top of the slot's inward angle, radians. */
  yaw?: number;
  /** Nudge along the avenue without changing which stop the board belongs to. */
  zShift?: number;
  /** Pull the board in or out of its lane without changing slots. */
  xShift?: number;
}

/** World z of a stop index. */
export function avenueZ(stop: number) {
  return AVENUE.firstStopZ - stop * AVENUE.stopSpacing;
}

/** Lane offset at a stop; later stops sit wider so the avenue fans open. */
export function avenueLaneX(stop: number, outer = false) {
  const base = AVENUE.laneX + Math.max(0, stop) * AVENUE.laneSpread;
  return outer ? base + AVENUE.outerLaneGap : base;
}

/** Resolved transform for a placement, before any object is touched. */
export function avenueTransform(placement: AvenuePlacement) {
  const { stop, slot } = placement;
  const outer = slot === "outer-left" || slot === "outer-right";
  const left = slot === "left" || slot === "outer-left";
  const right = slot === "right" || slot === "outer-right";
  const row = placement.row ?? 0;

  let x = 0;
  let yaw = 0;
  if (left || right) {
    const side = left ? -1 : 1;
    x = side * (avenueLaneX(stop, outer) + (placement.xShift ?? 0));
    // A positive rotation about Y swings a plane's +z normal toward +x, so the
    // left lane takes a positive yaw and the right lane a negative one for both
    // to turn in toward the walker.
    yaw = -side * (outer ? AVENUE.outerLaneYaw : AVENUE.laneYaw);
  }

  let y: number;
  let z = avenueZ(stop) + (placement.zShift ?? 0);
  if (slot === "banner") {
    y = AVENUE.bannerY + row * AVENUE.rowPitch;
    if (placement.zShift === undefined) z += AVENUE.bannerZShift;
  } else if (slot === "centre") y = AVENUE.archY + row * AVENUE.rowPitch;
  else y = AVENUE.standY + row * AVENUE.rowPitch;

  const [dx, dy, dz] = placement.offset ?? [0, 0, 0];
  return {
    position: new THREE.Vector3(x + dx, y + dy, z + dz),
    yaw: yaw + (placement.yaw ?? 0),
  };
}

/**
 * Positions and orients one exhibit in the avenue, returning it so calls can be
 * threaded straight into `process.add(...)`.
 */
export function placeOnAvenue<T extends THREE.Object3D>(
  object: T,
  placement: AvenuePlacement,
): T {
  const { position, yaw } = avenueTransform(placement);
  object.position.copy(position);
  object.rotation.set(0, yaw, 0);
  return object;
}

/** Anchor point of a slot, for routing conduits without repeating the maths. */
export function avenueAnchor(placement: AvenuePlacement) {
  return avenueTransform(placement).position;
}

/**
 * Depth of chamber shell an avenue of `stops` stops needs, including the
 * approach from the spawn point and clearance in front of the exit door.
 */
export function avenueShellDepth(stops: number) {
  const last = avenueZ(stops - 1);
  return Math.ceil((AVENUE.firstStopZ + 11 + (-last + 11)) / 2) * 2;
}

/**
 * A conduit between two exhibits that keeps out of the walkway: it leaves the
 * first board sideways, bows outward past the corridor, and comes back in to
 * the second. Data paths therefore never sweep through the visitor's face.
 */
export function avenueRoute(
  from: THREE.Vector3,
  to: THREE.Vector3,
  lift = 0.9,
) {
  const mid = from.clone().lerp(to, 0.5);
  const outward = Math.sign(from.x + to.x) || 1;
  const bulge = Math.max(
    AVENUE.corridorHalfWidth + 1.4,
    Math.abs(mid.x) + 0.8,
  );
  return [
    from.clone(),
    from.clone().lerp(mid, 0.4).setY(from.y + lift * 0.45),
    new THREE.Vector3(outward * bulge, mid.y + lift, mid.z),
    to.clone().lerp(mid, 0.4).setY(to.y + lift * 0.45),
    to.clone(),
  ];
}
