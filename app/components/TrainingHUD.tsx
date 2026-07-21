"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent } from "react";

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
import { DATA_PREP_STAGES } from "../lib/trainingTrace";
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
  { id: "learn", label: "Learn" },
  { id: "explore", label: "Explore" },
];

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

function clamp01(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function TrainingHUD({
  stations,
  progress,
  stationIndex,
  playing,
  rideMode,
  navigationMode,
  detailMode,
  branchSide,
  dataPrepProgress,
  dataPrepPlaying,
  onProgressChange,
  onPlayingChange,
  onDataPrepProgressChange,
  onDataPrepPlayingChange,
  onDataPrepRestart,
  onRideModeChange,
  onDetailModeChange,
  onBranchChange,
  onRestart,
}: TrainingHUDProps) {
  const [fullCodeOpen, setFullCodeOpen] = useState(false);
  const [hudMinimized, setHudMinimized] = useState(false);
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
  const dataPrepPercent = Math.round(safeDataPrepProgress * 100);
  const currentDataPrepStageIndex = DATA_PREP_STAGES.reduce(
    (current, stage, index) =>
      safeDataPrepProgress >= stage.start ? index : current,
    0,
  );
  const journeyHoldingForData =
    station.id === "corpus-data-preparation" && safeDataPrepProgress < 1;
  const navigationStatus =
    navigationMode === "machine-room"
      ? {
          label: "Machine room",
          hint: "Aim at a chamber · scroll to lean in and enter · WASD walk · M returns here",
        }
      : navigationMode === "free-roam"
        ? {
            label: "Free roam",
            hint: "Click scene · WASD move · Wheel follows your view · M machine room · Esc releases mouse",
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
              <dt className={styles.clickKey}>Click scene</dt>
              <dd>Capture mouse</dd>
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
              <dd>Release mouse</dd>
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

      {station.id === "corpus-data-preparation" ? (
        <section
          className={`${styles.processDock} ${styles.interactive}`}
          aria-labelledby="data-prep-stage-title"
        >
          <div className={styles.processHeader}>
            <span className={styles.processKicker}>Inside this chamber</span>
            <h2 id="data-prep-stage-title" aria-live="polite" aria-atomic="true">
              {String(currentDataPrepStageIndex + 1).padStart(2, "0")} / {" "}
              {DATA_PREP_STAGES[currentDataPrepStageIndex].label}
            </h2>
            <span className={styles.processPercent}>{dataPrepPercent}%</span>
          </div>
          <div className={styles.processControls}>
            <button
              type="button"
              className={styles.processPlay}
              data-testid="data-prep-play"
              onClick={() => {
                if (safeDataPrepProgress >= 0.999) {
                  onDataPrepRestart();
                } else {
                  onDataPrepPlayingChange(!dataPrepPlaying);
                }
              }}
              aria-label={
                dataPrepPlaying
                  ? "Pause data preparation animation"
                  : "Play data preparation animation"
              }
            >
              <span aria-hidden="true">{dataPrepPlaying ? "II" : "▶"}</span>
            </button>
            <button
              type="button"
              className={styles.processReplay}
              onClick={onDataPrepRestart}
              aria-label="Replay data preparation animation"
            >
              Replay
            </button>
            <div className={styles.processStages} role="group" aria-label="Process stages">
              {DATA_PREP_STAGES.map((stage, index) => (
                <button
                  type="button"
                  key={stage.id}
                  className={
                    index === currentDataPrepStageIndex
                      ? styles.processStageCurrent
                      : index < currentDataPrepStageIndex
                        ? styles.processStageComplete
                        : ""
                  }
                  onClick={() => {
                    const nextStageStart = DATA_PREP_STAGES[index + 1]?.start ?? 1;
                    const representativeProgress = Math.min(
                      1,
                      stage.start + Math.max(0.012, (nextStageStart - stage.start) * 0.16),
                    );
                    onDataPrepProgressChange(representativeProgress);
                  }}
                  aria-pressed={index === currentDataPrepStageIndex}
                  aria-label={`Show stage ${index + 1}: ${stage.label}`}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <small>{stage.label}</small>
                </button>
              ))}
            </div>
          </div>
          <input
            className={styles.processRange}
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={safeDataPrepProgress}
            onChange={(event) =>
              onDataPrepProgressChange(Number(event.currentTarget.value))
            }
            aria-label={`Data preparation animation progress, ${dataPrepPercent} percent`}
          />
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
