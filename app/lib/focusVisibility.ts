/**
 * Minimal shape shared by Three.js Object3D and the lightweight nodes used by
 * the focus-visibility contract tests.
 */
export interface FocusVisibilityNode {
  visible: boolean;
  parent: FocusVisibilityNode | null;
}

export interface FocusVisibilityLease<T extends FocusVisibilityNode> {
  readonly root: T;
  /** Hides the original chamber exhibit while its isolated stage is active. */
  hide(): void;
  /** Restores the exhibit root to its exact pre-focus visibility. */
  restore(): void;
}

/**
 * Creates a reversible visibility lease for a chamber's exhibit container.
 * Child visibility is deliberately untouched, so chamber updaters and Detail
 * Mode can keep changing the authored source state while the parent is hidden.
 */
export function createFocusVisibilityLease<T extends FocusVisibilityNode>(
  root: T,
): FocusVisibilityLease<T> {
  const initialVisibility = root.visible;
  let restored = false;

  return {
    root,
    hide() {
      if (restored) return;
      root.visible = false;
    },
    restore() {
      if (restored) return;
      restored = true;
      root.visible = initialVisibility;
    },
  };
}

/**
 * Three.js raycasting ignores `visible`, so picks need an explicit check.
 *
 * `leasedRoot` opts one node out of the check. Pass the active lease's root
 * when choosing what to magnify *next* while a focus is already up: the lease
 * has hidden the exhibit container, but the exhibit is still there as far as
 * picking a replacement target goes, and without this a spotlight could never
 * be swapped for another — only released and re-taken.
 */
export function isVisibleThroughAncestor(
  node: FocusVisibilityNode,
  ancestorBoundary: FocusVisibilityNode,
  leasedRoot?: FocusVisibilityNode | null,
): boolean {
  for (
    let cursor: FocusVisibilityNode | null = node;
    cursor;
    cursor = cursor.parent
  ) {
    if (!cursor.visible && cursor !== leasedRoot) return false;
    if (cursor === ancestorBoundary) return true;
  }
  return false;
}
