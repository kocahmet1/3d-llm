"use client";

import { useEffect, useState } from "react";

/**
 * True while pointer lock owns the mouse (FPS look in the world canvas).
 *
 * While engaged, every mouse event goes to the locked canvas, so HUD buttons
 * cannot be hovered or clicked — the cursor is not even drawn. Panels that
 * still show clickable controls use this to explain themselves: "press Esc
 * first" beats a button that silently ignores the visitor.
 */
export function usePointerLockEngaged() {
  const [engaged, setEngaged] = useState(false);

  useEffect(() => {
    const sync = () => {
      setEngaged(document.pointerLockElement !== null);
    };
    // Lock may already be held when a panel mounts mid-walk.
    sync();
    document.addEventListener("pointerlockchange", sync);
    return () => document.removeEventListener("pointerlockchange", sync);
  }, []);

  return engaged;
}
