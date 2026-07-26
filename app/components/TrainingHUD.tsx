"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type {
  CSSProperties,
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import {
  FULL_TRAINING_LOOP,
  TRAINING_CODE_EXCERPTS,
} from "../lib/generatedTrainingCode";
import type {
  DetailMode,
  RideMode,
  TrainingHUDProps,
  TrainingPhase,
} from "../lib/worldTypes";
import {
  chamberProcessDurationSeconds,
  chamberProcessLoops,
} from "../lib/trainingTrace";
import styles from "./TrainingHUD.module.css";

const PHASES: ReadonlyArray<{
  id: TrainingPhase;
  label: string;
  verb: string;
}> = [
  { id: "overview", label: "Overview", verb: "Orient" },
  { id: "data", label: "Data", verb: "Prepare" },
  { id: "forward", label: "Forward", verb: "Predict" },
  { id: "loss", label: "Loss", verb: "Measure" },
  { id: "backward", label: "Backward", verb: "Trace" },
  { id: "update", label: "Update", verb: "Adjust" },
];

const RIDE_MODES: ReadonlyArray<{ id: RideMode; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "explore", label: "Explore" },
];

/**
 * Space is reserved for the chamber process dial, world-wide. A button that
 * still has focus after a click would otherwise fire its own activation on the
 * same press — either stealing the key or double-toggling and cancelling out.
 * Buttons that opt into this keep Enter, and give up Space.
 */
function swallowSpaceActivation(event: ReactKeyboardEvent<HTMLButtonElement>) {
  if (event.code !== "Space" && event.key !== " ") return;
  event.preventDefault();
}

const DETAIL_MODES: ReadonlyArray<{
  id: DetailMode;
  label: string;
  shortLabel: string;
  explainerLabel: string;
}> = [
  {
    id: "story",
    label: "Story view",
    shortLabel: "Story",
    explainerLabel: "What is happening",
  },
  {
    id: "structure",
    label: "Structure view",
    shortLabel: "Structure",
    explainerLabel: "How it is built",
  },
  {
    id: "math",
    label: "Math view",
    shortLabel: "Math",
    explainerLabel: "What it computes",
  },
  {
    id: "code",
    label: "Code view",
    shortLabel: "Code",
    explainerLabel: "Where it runs",
  },
];

const LEGEND = [
  { label: "Data", className: styles.dataSwatch },
  { label: "Activations", className: styles.activationSwatch },
  { label: "Parameters", className: styles.parameterSwatch },
  { label: "Gradients", className: styles.gradientSwatch },
  { label: "Updates", className: styles.updateSwatch },
];

/** One whole turn of the jog dial is one whole pass of the chamber animation. */
const DIAL_TURN_RADIANS = Math.PI * 2;
/** Below this radius the pointer angle is mostly noise, so it is ignored. */
const DIAL_HUB_RADIUS_PX = 11;
/** A wheel notch (~100px on most mice) moves the process about a tenth of a pass. */
const WHEEL_PROGRESS_PER_PIXEL = 1 / 900;
const DIAL_KEY_STEP = 0.02;
const DETENT_FLASH_MS = 380;
/**
 * How long a scrub gesture keeps owning the position. Several pointer or wheel
 * events can land before React commits `processProgress` back down, so within a
 * gesture the deltas accumulate against the last value this component sent
 * rather than against the prop — otherwise a fast spin silently drops moves.
 */
const SCRUB_GESTURE_MS = 260;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/**
 * The chamber animation loops, so scrubbing off either end has to come back
 * round rather than pile up against a clamp.
 */
function wrapProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return ((value % 1) + 1) % 1;
}

function formatProcessClock(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function TrainingHUD({
  stations,
  progress,
  stationIndex,
  playing,
  rideMode,
  navigationMode,
  machineRoomCue,
  movementDiscovered,
  introTour,
  detailMode,
  branchSide,
  dataPrepProgress,
  processProgress,
  processPlaying,
  processLocked,
  processStops,
  processAvailable,
  onProgressChange,
  onPlayingChange,
  onProcessProgressChange,
  onProcessPlayingChange,
  onRideModeChange,
  onDetailModeChange,
  onBranchChange,
  onRestart,
}: TrainingHUDProps) {
  const [fullCodeOpen, setFullCodeOpen] = useState(false);
  const [hudMinimized, setHudMinimized] = useState(false);
  // As soon as the visitor lands in a chamber (free roam), surface a short
  // prompt reminding them to left-click for mouse look before walking. It
  // auto-dismisses so it never lingers once they're moving.
  const [chamberEntryHint, setChamberEntryHint] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      const enteringChamber = navigationMode === "free-roam";
      setChamberEntryHint(enteringChamber);
      if (enteringChamber) {
        timer = window.setTimeout(() => setChamberEntryHint(false), 7000);
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [navigationMode]);
  const fullCodeDialogId = useId();
  const fullCodeDialogTitleId = useId();
  const fullCodeDialogDescriptionId = useId();
  const fullCodeDialogRef = useRef<HTMLDivElement>(null);
  const fullCodeCloseRef = useRef<HTMLButtonElement>(null);
  const fullCodeVisible = fullCodeOpen && detailMode === "code";

  useEffect(() => {
    if (!fullCodeVisible) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    fullCodeCloseRef.current?.focus();

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setFullCodeOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = fullCodeDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], pre[tabindex="0"]',
        ),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleDialogKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleDialogKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [fullCodeVisible]);

  const processDialTitleId = useId();
  const dialRef = useRef<HTMLDivElement>(null);
  const dialPointerRef = useRef<number | null>(null);
  const dialAngleRef = useRef<number | null>(null);
  const dialGestureRef = useRef<{ position: number; at: number } | null>(null);
  const scrubByRef = useRef<(delta: number) => void>(() => {});
  const [dialGrabbed, setDialGrabbed] = useState(false);
  // Which dial tick is flashing after the process crossed a step boundary
  // under the visitor's hand — the detent they would feel on a real wheel.
  const [processDetent, setProcessDetent] = useState<{ tick: number } | null>(
    null,
  );

  const safeProcessProgress = clamp01(processProgress);
  const processStopCount = Math.max(1, Math.round(processStops));
  const processPercent = Math.round(safeProcessProgress * 100);
  // The epsilon absorbs the float error in `index / stops * stops`, so a
  // position sitting exactly on a boundary reads as the step starting there.
  const stopIndexAt = (value: number) =>
    Math.min(
      processStopCount - 1,
      Math.max(0, Math.floor(clamp01(value) * processStopCount + 1e-6)),
    );
  const currentProcessStop = stopIndexAt(safeProcessProgress);

  const readScrubBase = () => {
    const gesture = dialGestureRef.current;
    if (!gesture) return safeProcessProgress;
    // A held drag owns the position for as long as the hand is down. A wheel
    // has no release, so it lapses instead and hands the process back.
    return dialPointerRef.current !== null ||
      Date.now() - gesture.at < SCRUB_GESTURE_MS
      ? gesture.position
      : safeProcessProgress;
  };

  // The scrub handlers are declared above the component's main station lookup,
  // so the one fact they need — whether this chamber's transport loops — is
  // resolved here. An empty station list falls back to looping, the default.
  const scrubStation =
    stations[Math.min(stations.length - 1, Math.max(0, Math.round(stationIndex)))];
  const processLoops = chamberProcessLoops(scrubStation?.id ?? "");

  const commitScrub = (from: number, to: number, direction: number) => {
    if (processLocked) return;
    dialGestureRef.current = { position: to, at: Date.now() };
    const fromStop = stopIndexAt(from);
    const toStop = stopIndexAt(to);
    if (fromStop !== toStop) {
      // The boundary that just passed under the index mark: going forward it is
      // the step being entered, going back it is the one being left. Wrapping
      // falls out of this too — step 0's tick is the seam at the top of the loop.
      setProcessDetent({ tick: direction >= 0 ? toStop : fromStop });
    }
    onProcessProgressChange(to);
  };

  const scrubProcessBy = (delta: number) => {
    if (processLocked) return;
    if (!Number.isFinite(delta) || delta === 0) return;
    // The running clock would otherwise fight the hand for the same value.
    onProcessPlayingChange(false);
    const base = readScrubBase();
    // A looping chamber comes back round off either end. A run-once chamber
    // must not: wrapping the orientation walk would throw the visitor from the
    // entrance to the exit mid-drag.
    const next = processLoops ? wrapProgress(base + delta) : clamp01(base + delta);
    commitScrub(base, next, delta);
  };

  const scrubProcessTo = (value: number) => {
    if (processLocked) return;
    onProcessPlayingChange(false);
    const base = readScrubBase();
    const next = clamp01(value);
    commitScrub(base, next, next - base);
  };

  const dialPointFrom = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    return { angle: Math.atan2(y, x), radius: Math.hypot(x, y) };
  };

  const handleDialPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (processLocked) {
      event.preventDefault();
      return;
    }
    // Suppressing the default also suppresses the focus it would have given us.
    event.preventDefault();
    event.currentTarget.focus();
    // Capture keeps the spin alive once the hand wanders off the dial face,
    // which it always does on a circular drag.
    event.currentTarget.setPointerCapture(event.pointerId);
    dialPointerRef.current = event.pointerId;
    dialAngleRef.current = dialPointFrom(event).angle;
    dialGestureRef.current = { position: safeProcessProgress, at: Date.now() };
    setDialGrabbed(true);
    onProcessPlayingChange(false);
  };

  const handleDialPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dialPointerRef.current !== event.pointerId) return;
    const previous = dialAngleRef.current;
    const { angle, radius } = dialPointFrom(event);
    dialAngleRef.current = angle;
    if (previous === null) return;
    // atan2 flips sign across the ±π seam. Folding the raw difference back into
    // a half turn keeps a continuous spin continuous, instead of hurling the
    // process a whole pass backwards the moment the hand passes 9 o'clock.
    let delta = angle - previous;
    if (delta > Math.PI) delta -= DIAL_TURN_RADIANS;
    else if (delta < -Math.PI) delta += DIAL_TURN_RADIANS;
    if (radius < DIAL_HUB_RADIUS_PX) return;
    scrubProcessBy(delta / DIAL_TURN_RADIANS);
  };

  const endDialDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dialPointerRef.current !== event.pointerId) return;
    dialPointerRef.current = null;
    dialAngleRef.current = null;
    setDialGrabbed(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleDialKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (processLocked) {
      if (
        [
          "ArrowRight",
          "ArrowUp",
          "ArrowLeft",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
        ].includes(event.key)
      ) {
        event.preventDefault();
      }
      return;
    }
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        scrubProcessBy(DIAL_KEY_STEP);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        scrubProcessBy(-DIAL_KEY_STEP);
        break;
      case "PageUp":
        scrubProcessBy(1 / processStopCount);
        break;
      case "PageDown":
        scrubProcessBy(-1 / processStopCount);
        break;
      case "Home":
        scrubProcessTo(0);
        break;
      case "End":
        scrubProcessTo(1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  // The wheel listener is bound once per mount and reaches the live scrub
  // through this, so a playing clock does not rebind it sixty times a second.
  useEffect(() => {
    scrubByRef.current = scrubProcessBy;
  });

  useEffect(() => {
    if (!processDetent) return;
    const timer = window.setTimeout(
      () => setProcessDetent(null),
      DETENT_FLASH_MS,
    );
    return () => window.clearTimeout(timer);
  }, [processDetent]);

  useEffect(() => {
    const dial = dialRef.current;
    if (!dial) return;
    // React's onWheel is passive, so the page and the scene would scroll along
    // with the scrub unless the listener is bound by hand.
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const scale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const raw =
        Math.abs(event.deltaY) >= Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX;
      scrubByRef.current(raw * scale * WHEEL_PROGRESS_PER_PIXEL);
    };
    dial.addEventListener("wheel", handleWheel, { passive: false });
    return () => dial.removeEventListener("wheel", handleWheel);
  }, [processAvailable]);

  if (stations.length === 0) {
    return null;
  }

  const safeStationIndex = Math.min(
    stations.length - 1,
    Math.max(0, Math.round(stationIndex)),
  );
  const station = stations[safeStationIndex];
  const safeProgress = clamp01(progress);
  const stationDenominator = Math.max(1, stations.length - 1);
  const currentPhaseIndex = Math.max(
    0,
    PHASES.findIndex((phase) => phase.id === station.phase),
  );
  const currentPhase = PHASES[currentPhaseIndex];
  const activeDetailMode =
    DETAIL_MODES.find((mode) => mode.id === detailMode) ?? DETAIL_MODES[0];
  const proseDetailMode = detailMode === "code" ? "structure" : detailMode;
  const detailCopy = station[proseDetailMode];
  const codeExcerpt = TRAINING_CODE_EXCERPTS.find(
    (excerpt) => excerpt.stationId === station.id,
  );
  const detailAnnouncement =
    detailMode === "code"
      ? codeExcerpt
        ? `${codeExcerpt.file}, ${codeExcerpt.symbol}. ${codeExcerpt.note}`
        : `No code excerpt is available for ${station.title}.`
      : detailCopy;
  const progressPercent = Math.round(safeProgress * 100);
  const safeDataPrepProgress = clamp01(dataPrepProgress);
  const journeyHoldingForData =
    station.id === "corpus-data-preparation" && safeDataPrepProgress < 1;
  // The dial reads out the chamber it is actually driving, so a chamber with
  // its own pacing (the orientation gallery) shows its own clock.
  const processDurationSeconds = chamberProcessDurationSeconds(station.id);
  const processElapsedLabel = formatProcessClock(
    safeProcessProgress * processDurationSeconds,
  );
  const processTotalLabel = formatProcessClock(processDurationSeconds);
  const navigationStatus =
    navigationMode === "machine-room"
      ? {
          label: "Machine room",
          hint: "WASD to move · mouse to look · aim at any station and scroll to move in · Esc frees the mouse to use this panel · M returns here",
        }
      : navigationMode === "free-roam"
        ? {
            label: "Free roam",
            hint: "Click scene · WASD move · Wheel follows your view · Space holds the process · M machine room · Esc releases mouse",
          }
        : navigationMode === "tunnel"
          ? {
              label: "Tunnel travel",
              hint: "Follow the lit tunnel · W / S or wheel move",
            }
          : {
              label: "Guided ride",
              hint: "Click to take control · Wheel moves along your view",
            };

  const handleRangeChange = (event: ChangeEvent<HTMLInputElement>) => {
    onProgressChange(Number(event.currentTarget.value));
  };

  const jumpToStation = (index: number) => {
    onProgressChange(index / stationDenominator);
  };

  const jumpToPhase = (phase: TrainingPhase) => {
    const index = stations.findIndex((candidate) => candidate.phase === phase);
    if (index >= 0) {
      jumpToStation(index);
    }
  };

  return (
    <div
      className={`${styles.root} ${
        detailMode === "code" ? styles.rootCode : ""
      } ${hudMinimized ? styles.rootMinimized : ""}`}
      aria-label="Inside one training step controls"
    >
      <nav
        className={`${styles.phaseRail} ${styles.interactive}`}
        aria-label="Training step phases"
      >
        <span className={styles.phaseRailLine} aria-hidden="true" />
        {PHASES.map((phase, index) => {
          const isCurrent = phase.id === station.phase;
          const isComplete = index < currentPhaseIndex;
          const exists = stations.some((candidate) => candidate.phase === phase.id);

          return (
            <button
              className={`${styles.phaseStep} ${
                isCurrent ? styles.phaseStepCurrent : ""
              } ${isComplete ? styles.phaseStepComplete : ""}`}
              key={phase.id}
              type="button"
              onClick={() => jumpToPhase(phase.id)}
              disabled={!exists}
              aria-current={isCurrent ? "step" : undefined}
              aria-label={`Go to ${phase.label} phase: ${phase.verb}`}
            >
              <span className={styles.phaseDot} aria-hidden="true">
                {isComplete ? "✓" : index + 1}
              </span>
              <span className={styles.phaseWords}>
                <span>{phase.label}</span>
                <small>{phase.verb}</small>
              </span>
            </button>
          );
        })}
      </nav>

      {navigationMode === "machine-room" && machineRoomCue ? (
        <div
          className={styles.machineRoomCue}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-approaching={machineRoomCue.approaching}
          data-touring={introTour === "touring"}
        >
          {introTour !== "touring" ? (
            <span className={styles.scrollMouse} aria-hidden="true">
              <span className={styles.scrollWheel} />
            </span>
          ) : null}
          <span className={styles.machineRoomCueCopy}>
            <strong>
              {introTour === "touring"
                ? machineRoomCue.label
                : machineRoomCue.approaching
                  ? "Keep scrolling to move in"
                  : "Choose a station and scroll to move in"}
            </strong>
            <span>
              {introTour === "touring"
                ? "One of the machine's 7 stations"
                : `Enter ${machineRoomCue.label}`}
            </span>
          </span>
        </div>
      ) : null}

      {introTour === "touring" ? (
        <div className={styles.tourCue} role="status" aria-live="polite">
          <span className={styles.machineRoomCueCopy}>
            <strong>Guided tour</strong>
            <span>Press any key or click to take control at any time</span>
          </span>
        </div>
      ) : null}

      {introTour === "handoff" ? (
        <div
          className={`${styles.tourCue} ${styles.tourCueHandoff}`}
          role="status"
          aria-live="polite"
        >
          <span className={styles.machineRoomCueCopy}>
            <strong>You have the control now</strong>
            <span>
              Move around with WASD and the mouse — or aim at one of the 7
              stations and scroll in to zoom into it
            </span>
          </span>
        </div>
      ) : null}

      {navigationMode === "machine-room" &&
      !movementDiscovered &&
      introTour === null &&
      !machineRoomCue ? (
        <div className={styles.movementCue} role="status" aria-live="polite">
          <span className={styles.movementKeys} aria-label="W A S D keys">
            <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd>
          </span>
          <span>Aim at any station and scroll to move in</span>
        </div>
      ) : null}

      {chamberEntryHint && introTour !== "touring" ? (
        <div
          className={styles.chamberEntryCue}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className={styles.scrollMouse} aria-hidden="true">
            <span className={styles.scrollWheel} />
          </span>
          <span className={styles.machineRoomCueCopy}>
            <strong>Left-click, then walk with WASD</strong>
            <span>Esc frees the mouse · M returns to the machine room</span>
          </span>
        </div>
      ) : null}

      <section
        className={`${styles.stationPanel} ${
          detailMode === "code" ? styles.stationPanelCode : ""
        }`}
        aria-labelledby="station-title"
      >
        <button
          type="button"
          className={`${styles.hudToggle} ${styles.interactive}`}
          onClick={() => {
            setFullCodeOpen(false);
            setHudMinimized((current) => !current);
          }}
          aria-label={hudMinimized ? "Show interface panels" : "Hide interface panels"}
          aria-expanded={!hudMinimized}
          title={hudMinimized ? "Show interface panels" : "Hide interface panels"}
        >
          <span className={styles.hudToggleChevron} aria-hidden="true" />
        </button>

        <div className={styles.stationEyebrow}>
          <span className={styles.phaseBadge} data-phase={station.phase}>
            <span className={styles.pulseDot} aria-hidden="true" />
            {currentPhase.label}
          </span>
          <span className={styles.zoomBadge}>ZOOM Z{station.zoomBand}</span>
          <span className={styles.stationCount}>
            {String(safeStationIndex + 1).padStart(2, "0")}
            <span aria-hidden="true"> / </span>
            <span className={styles.visuallyHidden}>of</span>
            {String(stations.length).padStart(2, "0")}
          </span>
        </div>

        <h1 className={styles.stationTitle} id="station-title">
          {station.title}
        </h1>

        <nav className={styles.breadcrumbs} aria-label="Current zoom location">
          <ol>
            {station.breadcrumb.map((crumb, index) => (
              <li key={`${crumb}-${index}`}>
                <span>{crumb}</span>
                {index < station.breadcrumb.length - 1 ? (
                  <span className={styles.crumbArrow} aria-hidden="true">
                    ›
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </nav>

        {station.id === "training-complex" && detailMode !== "code" ? (
          <Link
            className={`${styles.customTrainingCta} ${styles.interactive}`}
            href="/custom-training"
          >
            <span>
              <small>Side feature</small>
              <strong>Train your own model</strong>
            </span>
            <span aria-hidden="true">→</span>
          </Link>
        ) : null}

        <div
          className={`${styles.detailTabs} ${styles.interactive}`}
          role="group"
          aria-label="Explanation detail"
        >
          {DETAIL_MODES.map((mode) => (
            <button
              type="button"
              key={mode.id}
              className={detailMode === mode.id ? styles.detailTabCurrent : ""}
              onClick={() => {
                setFullCodeOpen(false);
                onDetailModeChange(mode.id);
              }}
              aria-pressed={detailMode === mode.id}
              aria-label={mode.label}
            >
              {mode.shortLabel}
            </button>
          ))}
        </div>

        {detailMode === "code" ? (
          <div
            className={styles.codeExplainer}
            aria-live="polite"
            aria-atomic="true"
          >
            <div className={styles.codeHeadingRow}>
              <span className={styles.explainerTier} aria-hidden="true">
                04
              </span>
              <div className={styles.codeHeadingCopy}>
                <p className={styles.explainerLabel}>
                  {activeDetailMode.explainerLabel}
                </p>
                {codeExcerpt ? (
                  <div className={styles.codeMeta}>
                    <span>Python</span>
                    <code title={codeExcerpt.file}>{codeExcerpt.file}</code>
                    <span aria-hidden="true">/</span>
                    <code title={codeExcerpt.symbol}>{codeExcerpt.symbol}</code>
                  </div>
                ) : null}
              </div>
            </div>

            {codeExcerpt ? (
              <>
                <pre
                  className={styles.codeBlock}
                  tabIndex={0}
                  aria-label={`Runnable Python excerpt for ${station.title}`}
                >
                  <code>{codeExcerpt.code}</code>
                </pre>
                <div className={styles.codeFooter}>
                  <p className={styles.codeNote}>
                    <span>Context</span>
                    {codeExcerpt.note}
                  </p>
                  <button
                    type="button"
                    className={`${styles.fullCodeButton} ${styles.interactive}`}
                    onClick={() => setFullCodeOpen(true)}
                    aria-haspopup="dialog"
                    aria-expanded={fullCodeVisible}
                    aria-controls={fullCodeDialogId}
                  >
                    Full training loop
                  </button>
                </div>
              </>
            ) : (
              <div className={styles.codeUnavailable} role="status">
                This chamber does not have a generated code excerpt yet.
              </div>
            )}
          </div>
        ) : (
          <>
            <div className={styles.explainer} aria-live="polite" aria-atomic="true">
              <span className={styles.explainerTier} aria-hidden="true">
                {String(DETAIL_MODES.indexOf(activeDetailMode) + 1).padStart(2, "0")}
              </span>
              <div>
                <p className={styles.explainerLabel}>
                  {activeDetailMode.explainerLabel}
                </p>
                <p className={styles.explainerCopy}>{detailCopy}</p>
              </div>
            </div>

            <div className={styles.stationMeta}>
              <div className={styles.scaleReadout}>
                <span>VIEW</span>
                <strong>{station.scaleLabel}</strong>
              </div>
              {detailMode !== "story" && station.shape ? (
                <div className={styles.shapeReadout}>
                  <span>SHAPE</span>
                  <code>{station.shape}</code>
                </div>
              ) : null}
            </div>

            {detailMode === "math" && station.formula ? (
              <div className={styles.formula}>
                <span>FORMULA</span>
                <code>{station.formula}</code>
              </div>
            ) : null}
          </>
        )}
      </section>

      {fullCodeVisible ? (
        <div
          className={styles.codeModal}
          id={fullCodeDialogId}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setFullCodeOpen(false);
            }
          }}
        >
          <div
            className={styles.codeModalPanel}
            ref={fullCodeDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={fullCodeDialogTitleId}
            aria-describedby={fullCodeDialogDescriptionId}
          >
            <header className={styles.codeModalHeader}>
              <div>
                <p>Canonical runnable reference</p>
                <h2 id={fullCodeDialogTitleId}>Full training loop</h2>
              </div>
              <button
                type="button"
                ref={fullCodeCloseRef}
                className={styles.codeModalClose}
                onClick={() => setFullCodeOpen(false)}
                aria-label="Close full training loop"
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </header>
            <div className={styles.codeModalMeta}>
              <span>Python</span>
              <code>{FULL_TRAINING_LOOP.file}</code>
              <span aria-hidden="true">/</span>
              <code>{FULL_TRAINING_LOOP.symbol}</code>
            </div>
            <pre
              className={`${styles.codeBlock} ${styles.fullCodeBlock}`}
              tabIndex={0}
              aria-label="Full runnable Python training loop"
            >
              <code>{FULL_TRAINING_LOOP.code}</code>
            </pre>
            <p
              className={styles.codeModalNote}
              id={fullCodeDialogDescriptionId}
            >
              {FULL_TRAINING_LOOP.note}
            </p>
          </div>
        </div>
      ) : null}

      <aside className={styles.legend} aria-label="Visual legend">
        <p>Signal key</p>
        <ul>
          {LEGEND.map((item) => (
            <li key={item.label}>
              <span
                className={`${styles.legendSwatch} ${item.className}`}
                aria-hidden="true"
              />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      </aside>

      <details className={`${styles.keyHelp} ${styles.interactive}`}>
        <summary aria-label="Show first-person navigation controls">
          <span className={styles.helpGlyph} aria-hidden="true">
            ?
          </span>
          <span>Controls</span>
        </summary>
        <div className={styles.keySheet}>
          <p>First-person navigation</p>
          <dl>
            <div>
              <dt>
                <kbd>W</kbd> / <span className={styles.clickKey}>Click</span>
              </dt>
              <dd>Take control · capture mouse</dd>
            </div>
            <div>
              <dt className={styles.mouseKey}>Mouse</dt>
              <dd>Look around</dd>
            </div>
            <div>
              <dt className={styles.mouseKey}>Wheel</dt>
              <dd>Move toward / away</dd>
            </div>
            <div>
              <dt>
                <kbd>W</kbd> <kbd>S</kbd>
              </dt>
              <dd>Forward / back</dd>
            </div>
            <div>
              <dt>
                <kbd>A</kbd> <kbd>D</kbd>
              </dt>
              <dd>Strafe left / right</dd>
            </div>
            <div>
              <dt>
                <kbd>Shift</kbd>
              </dt>
              <dd>Sprint</dd>
            </div>
            <div>
              <dt>
                <kbd>Esc</kbd>
              </dt>
              <dd>Free mouse · use the panel</dd>
            </div>
            <div>
              <dt>
                <kbd>R</kbd>
              </dt>
              <dd>Return to overlook</dd>
            </div>
            <div>
              <dt>
                <kbd>Q</kbd> <kbd>E</kbd>
              </dt>
              <dd>Choose a branch</dd>
            </div>
            <div>
              <dt>
                <kbd>Space</kbd>
              </dt>
              <dd>Play / pause</dd>
            </div>
          </dl>
        </div>
      </details>

      <div
        className={styles.navigationStatus}
        data-mode={navigationMode}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className={styles.navigationStatusDot} aria-hidden="true" />
        <strong>{navigationStatus.label}</strong>
        <span className={styles.navigationStatusHint}>{navigationStatus.hint}</span>
      </div>

      {station.branch ? (
        <div
          className={styles.branchLayer}
          role="group"
          aria-label="Branch selection"
        >
          <button
            type="button"
            className={`${styles.branchButton} ${styles.branchLeft} ${
              branchSide === "left" ? styles.branchSelected : ""
            }`}
            onClick={() => onBranchChange("left")}
            aria-pressed={branchSide === "left"}
            aria-keyshortcuts="Q"
            aria-label={`Choose left branch: ${station.branch.left}`}
          >
            <span className={styles.branchArrow} aria-hidden="true">
              ‹
            </span>
            <span className={styles.branchKey}>Q</span>
            <span className={styles.branchName}>{station.branch.left}</span>
          </button>
          <button
            type="button"
            className={`${styles.branchButton} ${styles.branchRight} ${
              branchSide === "right" ? styles.branchSelected : ""
            }`}
            onClick={() => onBranchChange("right")}
            aria-pressed={branchSide === "right"}
            aria-keyshortcuts="E"
            aria-label={`Choose right branch: ${station.branch.right}`}
          >
            <span className={styles.branchArrow} aria-hidden="true">
              ›
            </span>
            <span className={styles.branchKey}>E</span>
            <span className={styles.branchName}>{station.branch.right}</span>
          </button>
        </div>
      ) : null}

      {processAvailable ? (
        <section
          className={`${styles.processDock} ${styles.dialDock} ${styles.interactive}`}
          aria-labelledby={processDialTitleId}
        >
          {/* The step and time readings are spoken but not shown. On screen the
           * dial already carries its position, and the one line of type above
           * it is better spent saying what to do with it. */}
          <h2
            id={processDialTitleId}
            className={styles.visuallyHidden}
            aria-live="polite"
            aria-atomic="true"
          >
            Chamber process, step {currentProcessStop + 1} of {processStopCount},{" "}
            {processElapsedLabel} of {processTotalLabel},{" "}
            {processLocked
              ? "held while the isolated component replay plays"
              : processPlaying
                ? "playing"
                : "held"}
          </h2>
          <p
            className={`${styles.dialHint} ${
              processPlaying ? "" : styles.dialHintLive
            }`}
          >
            {processLocked
              ? "The isolated component replay owns this dial"
              : processPlaying
                ? "Space pauses · then turn the dial"
                : "Turn the dial to move through the animation"}
          </p>
          <div className={styles.dialRow}>
            {/* A dial reads as an ornament until something shows which way it
             * turns, so it sits between two arrows that curl the way it goes.
             * They are cues, not controls — the hand belongs on the dial. */}
            <div className={styles.dialCluster}>
              {/* Two arcs struck on the same centre as the knob, riding just
               * outside its rim, so they read as the wheel's own travel rather
               * than as glyphs parked beside it. They appear only once the
               * process is held: while it is running there is nothing to scrub
               * and the movement would just compete with the chamber. */}
              <span
                className={`${styles.dialCurls} ${
                  processPlaying ? "" : styles.dialCurlsLive
                }`}
                aria-hidden="true"
              >
                <svg className={styles.dialCurlSvg} viewBox="0 0 100 100">
                  <g className={styles.dialCurlBack}>
                    <path
                      className={styles.dialCurlArc}
                      d="M32.7 12.8 A41 41 0 0 0 9.2 46.4"
                    />
                    <path d="M5.6 39.1 L9.2 46.4 L14 39.8" />
                  </g>
                  <g
                    className={styles.dialCurlForward}
                    transform="translate(100,0) scale(-1,1)"
                  >
                    <path
                      className={styles.dialCurlArc}
                      d="M32.7 12.8 A41 41 0 0 0 9.2 46.4"
                    />
                    <path d="M5.6 39.1 L9.2 46.4 L14 39.8" />
                  </g>
                </svg>
                <small className={styles.dialCurlLabelBack}>Rewind</small>
                <small className={styles.dialCurlLabelForward}>Forward</small>
              </span>
              <div
                ref={dialRef}
                className={`${styles.dial} ${dialGrabbed ? styles.dialGrabbed : ""} ${
                  processPlaying ? styles.dialRunning : ""
                }`}
                style={
                  {
                    "--dial-angle": `${safeProcessProgress * 360}deg`,
                    "--dial-sweep": `${processPercent}%`,
                  } as CSSProperties
                }
                data-testid="chamber-process-dial"
                data-detent={processDetent ? "true" : undefined}
                role="slider"
                tabIndex={processLocked ? -1 : 0}
                aria-label="Scrub the chamber process"
                aria-disabled={processLocked}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={processPercent}
                aria-valuetext={`${processPercent} percent, step ${
                  currentProcessStop + 1
                } of ${processStopCount}, ${processElapsedLabel} of ${processTotalLabel}`}
                aria-keyshortcuts="ArrowLeft ArrowRight PageUp PageDown Home End"
                title="Drag or scroll the dial to scrub"
                onPointerDown={handleDialPointerDown}
                onPointerMove={handleDialPointerMove}
                onPointerUp={endDialDrag}
                onPointerCancel={endDialDrag}
                onKeyDown={handleDialKeyDown}
              >
                <span className={styles.dialFace} aria-hidden="true">
                  {Array.from({ length: processStopCount }, (_, index) => (
                    <span
                      key={index}
                      className={styles.dialTick}
                      data-detent={processDetent?.tick === index ? "true" : undefined}
                      style={
                        {
                          // Marks on the wheel, not the bezel: they run backwards
                          // so the one for a step arrives under the index mark as
                          // the dial turns forward into it.
                          "--tick": `${(-index / processStopCount) * 360}deg`,
                        } as CSSProperties
                      }
                    />
                  ))}
                </span>
                <span className={styles.dialArc} aria-hidden="true" />
                <span className={styles.dialIndex} aria-hidden="true" />
                <span className={styles.dialReadout} aria-hidden="true">
                  {processPercent}
                  <small>%</small>
                </span>
              </div>
            </div>

            <button
              type="button"
              className={`${styles.processPlay} ${styles.dialPlay}`}
              data-testid="chamber-process-play"
              onClick={() => onProcessPlayingChange(!processPlaying)}
              disabled={processLocked}
              // The world's global Space binding already toggles this dial, so
              // the focused button must not fire a second time and cancel it.
              onKeyDown={swallowSpaceActivation}
              onKeyUp={swallowSpaceActivation}
              aria-label={
                processPlaying
                  ? "Pause the chamber process"
                  : "Play the chamber process"
              }
              aria-pressed={processPlaying}
            >
              <span aria-hidden="true">{processPlaying ? "Ⅱ" : "▶"}</span>
              <span className={styles.dialPlayLabel}>
                {processPlaying ? "Pause" : "Play"}
              </span>
            </button>
          </div>
        </section>
      ) : null}

      <footer className={`${styles.transport} ${styles.interactive}`}>
        <div className={styles.timelineHeader}>
          <span>
            Training step journey
            <strong>{progressPercent}%</strong>
          </span>
          <span className={styles.timelineStation}>{station.shortTitle}</span>
        </div>

        <div
          className={styles.timeline}
          style={{ "--progress": `${progressPercent}%` } as CSSProperties}
        >
          <input
            className={styles.timelineRange}
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={safeProgress}
            onChange={handleRangeChange}
            aria-label={`Training step progress, ${progressPercent} percent`}
          />
          <div
            className={styles.stationMarkers}
            role="group"
            aria-label="Journey stations"
          >
            {stations.map((candidate, index) => {
              const position = (index / stationDenominator) * 100;
              const isCurrent = index === safeStationIndex;
              const isPassed = index < safeStationIndex;
              return (
                <button
                  type="button"
                  key={candidate.id}
                  className={`${styles.stationMarker} ${
                    isCurrent ? styles.markerCurrent : ""
                  } ${isPassed ? styles.markerPassed : ""}`}
                  style={{ "--position": `${position}%` } as CSSProperties}
                  onClick={() => jumpToStation(index)}
                  aria-label={`Go to ${candidate.title}`}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  <span className={styles.markerDot} aria-hidden="true" />
                  <span className={styles.markerLabel}>{candidate.shortTitle}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.controlRow}>
          <div className={styles.playControls}>
            <button
              type="button"
              className={styles.playButton}
              onClick={() => onPlayingChange(!playing)}
              // The ride is driven by the mouse alone. Space is spoken for by
              // the chamber process dial, so a focused play button must not
              // also answer to it; Enter still activates for keyboard users.
              onKeyDown={swallowSpaceActivation}
              onKeyUp={swallowSpaceActivation}
              aria-label={playing ? "Pause training journey" : "Play training journey"}
              aria-pressed={playing}
            >
              <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
            </button>
            <button
              type="button"
              className={styles.restartButton}
              onClick={onRestart}
              aria-label="Restart training journey"
            >
              <span aria-hidden="true">↺</span>
            </button>
          </div>

          <div className={styles.rideSelector} role="group" aria-label="Ride mode">
            {RIDE_MODES.map((mode) => (
              <button
                type="button"
                key={mode.id}
                onClick={() => onRideModeChange(mode.id)}
                className={rideMode === mode.id ? styles.rideModeCurrent : ""}
                aria-pressed={rideMode === mode.id}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <div className={styles.nowPlaying} aria-live="polite">
            <span
              className={
                playing && !journeyHoldingForData
                  ? styles.nowPlayingPulse
                  : styles.nowPaused
              }
            />
            <span>
              {journeyHoldingForData
                ? "Ride holding for chamber"
                : playing
                  ? "Ride running"
                  : "Ride paused"}
            </span>
          </div>
        </div>
      </footer>

      <p className={styles.visuallyHidden} role="status" aria-live="polite">
        {currentPhase.label} phase. {station.title}. {detailAnnouncement}
      </p>
    </div>
  );
}

export default TrainingHUD;
