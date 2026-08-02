"use client";

/**
 * Director panel — a tiny overlay that arms the competition-video flight.
 * It only appears with `?director=1` in the URL (or Ctrl+Shift+D), lives in
 * the root layout so it survives the hop to /custom-training, and hides
 * itself completely while the take is rolling so the recording stays clean.
 * It also renders the flight's title sequence and closing end card — both
 * belong here rather than in the experience, because the panel is the one
 * thing that survives the route change to /custom-training.
 */

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { IntroTitleCard } from "../IntroTitleCard";
import {
  abortFlight,
  setDirectorHooks,
  startFlight,
  type DirectorStatus,
} from "../../lib/director/controller";
import { END_CARD } from "../../lib/director/flightPlan";

const panelStyle: CSSProperties = {
  position: "fixed",
  right: "1rem",
  bottom: "1rem",
  zIndex: 210,
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  padding: "0.85rem 1rem",
  borderRadius: "0.75rem",
  background: "rgba(8, 12, 18, 0.92)",
  border: "1px solid rgba(126, 231, 196, 0.35)",
  color: "#dff3ea",
  font: "500 0.78rem/1.4 var(--font-geist-sans, ui-sans-serif, system-ui)",
  letterSpacing: "0.02em",
  maxWidth: "17rem",
  boxShadow: "0 1rem 2.4rem rgba(0,0,0,0.5)",
};

const buttonStyle: CSSProperties = {
  cursor: "pointer",
  borderRadius: "0.5rem",
  border: "1px solid rgba(126, 231, 196, 0.45)",
  background: "rgba(126, 231, 196, 0.12)",
  color: "#eafff6",
  padding: "0.5rem 0.7rem",
  font: "600 0.78rem/1 inherit",
  letterSpacing: "0.04em",
};

export function DirectorPanel() {
  const router = useRouter();
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<DirectorStatus | null>(null);
  const [endCard, setEndCard] = useState(false);
  /**
   * The site's own title sequence, replayed over the flight's opening. Keyed
   * by take so a second flight in the same session mounts a fresh card — the
   * component self-unmounts when its timers finish and would not replay
   * otherwise.
   */
  const [titleCard, setTitleCard] = useState(false);
  const [take, setTake] = useState(0);
  useEffect(() => {
    if (titleCard) setTake((current) => current + 1);
  }, [titleCard]);

  useEffect(() => {
    const check = () => {
      if (new URLSearchParams(window.location.search).has("director")) {
        setAvailable(true);
      }
    };
    check();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.code === "KeyD") {
        event.preventDefault();
        setAvailable((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!available) return undefined;
    setDirectorHooks({
      onStatus: setStatus,
      showEndCard: setEndCard,
      showTitleCard: setTitleCard,
      navigate: (path) => router.push(path),
    });
    return () => setDirectorHooks(null);
  }, [available, router]);

  const phase = status?.phase ?? "idle";
  const flying =
    phase === "flying" || phase === "finale" || phase === "arming";
  const minutes = Math.floor((status?.elapsedSeconds ?? 0) / 60);
  const seconds = Math.floor((status?.elapsedSeconds ?? 0) % 60)
    .toString()
    .padStart(2, "0");
  /**
   * A handful of slow frames across two minutes is a browser hiccup, not a
   * choppy take; the threshold is what a viewer would actually notice. The
   * worst-frame figure is the honest one — a single 200ms stall reads as a
   * jolt no matter how good the average is.
   */
  const smooth =
    !!status &&
    status.frames.totalFrames > 0 &&
    status.frames.droppedFrames <= 3 &&
    status.frames.worstFps >= 30;

  return (
    <>
      {titleCard ? (
        <IntroTitleCard key={`director-title-${take}`} interactive={false} />
      ) : null}

      {endCard ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            display: "grid",
            placeItems: "center",
            background:
              "radial-gradient(ellipse at center, rgba(9,13,19,0.9) 0%, rgba(5,7,11,0.98) 70%)",
            color: "#eef7f2",
            textAlign: "center",
            animation: "director-fade-in 0.9s ease both",
          }}
        >
          <style>{`@keyframes director-fade-in { from { opacity: 0 } to { opacity: 1 } }`}</style>
          <div style={{ display: "grid", gap: "0.9rem", padding: "2rem" }}>
            <p
              style={{
                margin: 0,
                font: "600 0.85rem/1 ui-monospace, monospace",
                letterSpacing: "0.34em",
                color: "#7ee7c4",
                textTransform: "uppercase",
              }}
            >
              {END_CARD.subtitle}
            </p>
            <h1
              style={{
                margin: 0,
                font: "700 clamp(2rem, 5vw, 3.4rem)/1.1 var(--font-geist-sans, ui-sans-serif)",
                letterSpacing: "0.01em",
              }}
            >
              {END_CARD.title}
            </h1>
            <p
              style={{
                margin: 0,
                font: "500 1rem/1.5 inherit",
                color: "rgba(238, 247, 242, 0.75)",
              }}
            >
              {END_CARD.credits}
            </p>
          </div>
        </div>
      ) : null}

      {available && !flying ? (
        <aside style={panelStyle} aria-label="Demo director">
          <strong style={{ letterSpacing: "0.1em", color: "#7ee7c4" }}>
            DEMO DIRECTOR
          </strong>
          {phase === "saving" ? (
            <span>Saving the recording…</span>
          ) : (
            <>
              <button
                type="button"
                style={buttonStyle}
                onClick={() => void startFlight({ record: true })}
              >
                ● Record &amp; fly (~2:00)
              </button>
              <button
                type="button"
                style={{ ...buttonStyle, background: "transparent" }}
                onClick={() => void startFlight({ record: false })}
              >
                ▶ Fly without recording
              </button>
              <span style={{ opacity: 0.7 }}>
                Runs entirely in the world — no trainer or mic needed. Esc
                aborts mid-flight. Fly once without recording first and check
                the frame numbers.
              </span>
              {status && status.frames.totalFrames > 0 ? (
                <span
                  style={{
                    font: "500 0.72rem/1.5 ui-monospace, monospace",
                    color: smooth ? "#7ee7c4" : "#ffc46b",
                  }}
                >
                  {smooth ? "SMOOTH" : "DROPPING FRAMES"} ·{" "}
                  {status.frames.averageFps.toFixed(0)} fps avg · worst{" "}
                  {status.frames.worstFps.toFixed(0)} · {status.frames.droppedFrames}{" "}
                  slow {status.frames.droppedFrames === 1 ? "frame" : "frames"}
                  {status.captureSummary ? ` · ${status.captureSummary}` : ""}
                </span>
              ) : null}
            </>
          )}
        </aside>
      ) : null}

      {available && flying ? (
        <button
          type="button"
          onClick={() => void abortFlight()}
          aria-label={`Abort flight (${status?.label ?? ""})`}
          title={`${minutes}:${seconds} · ${status?.label ?? ""} — click or press Esc to abort`}
          style={{
            position: "fixed",
            right: "0.6rem",
            bottom: "0.6rem",
            zIndex: 210,
            width: "0.6rem",
            height: "0.6rem",
            borderRadius: "50%",
            border: "none",
            cursor: "pointer",
            background: status?.recording ? "#ff5d5d" : "#7ee7c4",
            opacity: 0.45,
          }}
        />
      ) : null}
    </>
  );
}
