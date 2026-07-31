"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./IntroTitleCard.module.css";

type IntroPhase = "enter" | "title" | "credit" | "closing" | "done";

// Visible durations requested for the movie-title sequence.
const TITLE_MS = 4_000; // "Inside One Training Step"
const CREDIT_MS = 3_500; // "Built with GPT 5.6 Ultra & Codex"
const CLOSE_MS = 950; // backdrop fade-out (matches the CSS transition)

/**
 * A one-shot cinematic intro that plays on first page load: a beat of black,
 * the app title held for ~4s, the build credit for ~2s, then the backdrop
 * dissolves to reveal the 3D scene. Self-unmounts when finished; clicking or
 * pressing Esc/Enter skips ahead. Starts in "enter" (hidden) so the reveal
 * transition actually plays on the frame after mount.
 */
export function IntroTitleCard() {
  const [phase, setPhase] = useState<IntroPhase>("enter");
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  // Jump straight to the closing fade, then unmount.
  const skip = useCallback(() => {
    setPhase((current) => {
      if (current === "closing" || current === "done") return current;
      clearTimers();
      timers.current.push(window.setTimeout(() => setPhase("done"), CLOSE_MS));
      return "closing";
    });
  }, [clearTimers]);

  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    const at = (fn: () => void, ms: number) => {
      timers.current.push(window.setTimeout(fn, ms));
    };
    // Flip out of "enter" on the next painted frame so the title's fade/blur
    // reveal transitions from its hidden state rather than mounting visible.
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        setPhase("title");
        at(() => setPhase("credit"), TITLE_MS);
        at(() => setPhase("closing"), TITLE_MS + CREDIT_MS);
        at(() => setPhase("done"), TITLE_MS + CREDIT_MS + CLOSE_MS);
      });
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      clearTimers();
    };
  }, [clearTimers]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [skip]);

  if (phase === "done") return null;

  return (
    <div className={styles.root} data-phase={phase} aria-hidden="true">
      <div className={styles.stage}>
        <div className={styles.titleGroup}>
          <span className={styles.kicker}>An interactive journey</span>
          <h1 className={styles.title} data-text="Inside One Training Step">
            Inside One Training Step
          </h1>
          <span className={styles.rule} />
        </div>
        <div className={styles.creditGroup}>
          <span className={styles.creditLabel}>Built with</span>
          <span className={styles.creditName}>
            <em>GPT 5.6 Ultra</em> &amp; <em>Codex</em>
          </span>
        </div>
      </div>
      <button
        type="button"
        className={styles.skip}
        tabIndex={-1}
        onClick={skip}
      >
        Skip
      </button>
    </div>
  );
}
