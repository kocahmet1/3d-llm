"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent } from "react";
import type {
  TrainingDevice,
  TrainingEffort,
  TrainingMetric,
  TrainingPreset,
  TrainingRunSnapshot,
} from "../../lib/customTrainingTypes";
import {
  controlTrainingRun,
  getCurrentTrainingRun,
  getTrainerHealth,
  getTrainingRun,
  resumeTrainingRunFromCheckpoint,
  startTrainingRun,
  TrainerBridgeError,
} from "../../lib/trainingClient";
import { ModelTestLab } from "./ModelTestLab";
import styles from "./CustomTrainingChamber.module.css";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const TERMINAL_STATUSES = new Set(["completed", "stopped", "failed"]);

const PRESETS: ReadonlyArray<{
  id: TrainingPreset;
  name: string;
  size: string;
  description: string;
}> = [
  {
    id: "micro",
    name: "Micro",
    size: "~137K parameters",
    description: "Fastest proof that the full pipeline works.",
  },
  {
    id: "small",
    name: "Small",
    size: "~876K parameters",
    description: "Recommended for a first narrow text generator.",
  },
  {
    id: "local",
    name: "Local",
    size: "~4.9M parameters",
    description: "A serious run; a GPU is strongly preferred.",
  },
];

const EFFORTS: ReadonlyArray<{
  id: TrainingEffort;
  name: string;
  description: string;
}> = [
  { id: "quick", name: "Quick", description: "One approximate corpus pass" },
  {
    id: "balanced",
    name: "Balanced",
    description: "Several passes with regular evaluation",
  },
  {
    id: "thorough",
    name: "Thorough",
    description: "More learning time and overfit monitoring",
  },
];

function formatDuration(value?: number | null) {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  const total = Math.round(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatCount(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

function formatLoss(value?: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(4);
}

function statusLabel(run: TrainingRunSnapshot) {
  if (run.phase === "interrupted") return "Training interrupted";
  if (run.phase === "resuming") return "Resuming from checkpoint";
  return {
    preparing: "Preparing corpus",
    training: "Training",
    pausing: "Pausing after this step",
    paused: "Paused safely",
    stopping: "Saving before stop",
    stopped: "Stopped with checkpoint",
    completed: "Training complete",
    failed: "Run failed",
  }[run.status];
}

function phaseIndexFor(run: TrainingRunSnapshot) {
  if (run.status === "completed" || run.status === "stopped") return 3;
  if (run.phase === "preparing" || run.phase === "queued") return 0;
  if (run.phase === "evaluating" || run.phase === "sampling") return 2;
  if (run.phase === "checkpointing") return 3;
  return 1;
}

function LossChart({ metrics }: { metrics: TrainingMetric[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = metrics.at(-1);
  const validationPoints = metrics.filter(
    (metric) => metric.validationLoss != null && Number.isFinite(metric.validationLoss),
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container) return;

    const draw = () => {
      const width = Math.max(280, container.clientWidth);
      const height = Math.max(220, container.clientHeight);
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const left = 42;
      const right = 18;
      const top = 18;
      const bottom = 30;
      const plotWidth = width - left - right;
      const plotHeight = height - top - bottom;
      const usable = metrics.filter(
        (metric) => Number.isFinite(metric.loss) && Number.isFinite(metric.step),
      );
      const values = usable.flatMap((metric) =>
        metric.validationLoss == null
          ? [metric.loss]
          : [metric.loss, metric.validationLoss],
      );

      context.font = '10px "Cascadia Code", Consolas, monospace';
      context.fillStyle = "rgba(174, 202, 194, 0.62)";
      context.strokeStyle = "rgba(181, 255, 225, 0.09)";
      context.lineWidth = 1;

      if (usable.length < 2 || values.length < 2) {
        context.textAlign = "center";
        context.fillText(
          "Loss points will appear after the first logged updates",
          width / 2,
          height / 2,
        );
        return;
      }

      let minimum = Math.min(...values);
      let maximum = Math.max(...values);
      const padding = Math.max(0.08, (maximum - minimum) * 0.12);
      minimum -= padding;
      maximum += padding;
      const firstStep = usable[0].step;
      const lastStep = Math.max(firstStep + 1, usable.at(-1)?.step ?? firstStep + 1);
      const xFor = (step: number) =>
        left + ((step - firstStep) / (lastStep - firstStep)) * plotWidth;
      const yFor = (loss: number) =>
        top + ((maximum - loss) / (maximum - minimum)) * plotHeight;

      for (let line = 0; line <= 4; line += 1) {
        const y = top + (plotHeight * line) / 4;
        context.beginPath();
        context.moveTo(left, y);
        context.lineTo(width - right, y);
        context.stroke();
        const label = (maximum - ((maximum - minimum) * line) / 4).toFixed(2);
        context.textAlign = "right";
        context.fillText(label, left - 8, y + 3);
      }

      context.textAlign = "left";
      context.fillText(String(firstStep), left, height - 9);
      context.textAlign = "right";
      context.fillText(String(lastStep), width - right, height - 9);

      const gradient = context.createLinearGradient(left, 0, width - right, 0);
      gradient.addColorStop(0, "#4cc9a2");
      gradient.addColorStop(1, "#79f7bd");
      context.strokeStyle = gradient;
      context.lineWidth = 2;
      context.beginPath();
      usable.forEach((metric, index) => {
        const x = xFor(metric.step);
        const y = yFor(metric.loss);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();

      context.fillStyle = "#ffc95c";
      for (const metric of validationPoints) {
        context.beginPath();
        context.arc(
          xFor(metric.step),
          yFor(metric.validationLoss as number),
          3,
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [metrics, validationPoints]);

  return (
    <canvas
      className={styles.lossCanvas}
      ref={canvasRef}
      role="img"
      aria-label={`Training loss chart with ${metrics.length} points. Latest training loss ${formatLoss(latest?.loss)} and validation loss ${formatLoss(latest?.validationLoss)}.`}
    />
  );
}

export function CustomTrainingChamber() {
  const [bridge, setBridge] = useState<"checking" | "online" | "offline">(
    "checking",
  );
  const [run, setRun] = useState<TrainingRunSnapshot | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [preset, setPreset] = useState<TrainingPreset>("small");
  const [contextLength, setContextLength] = useState<64 | 128 | 256>(128);
  const [effort, setEffort] = useState<TrainingEffort>("balanced");
  const [device, setDevice] = useState<TrainingDevice>("auto");
  const [samplePrompt, setSamplePrompt] = useState("Once upon a time");
  const [message, setMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [surface, setSurface] = useState<"monitor" | "test">("monitor");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const connect = useCallback(async () => {
    setBridge("checking");
    setMessage(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2_500);
    try {
      await getTrainerHealth(controller.signal);
      setBridge("online");
      try {
        const current = await getCurrentTrainingRun(controller.signal);
        setRun(current);
        setSurface("monitor");
      } catch (error) {
        if (!(error instanceof TrainerBridgeError) || error.status !== 404) {
          throw error;
        }
      }
    } catch (error) {
      setBridge("offline");
      if (error instanceof Error && error.name !== "AbortError") {
        setMessage(error.message);
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void connect(), 0);
    return () => window.clearTimeout(timer);
  }, [connect]);

  const activeRunId = run?.id;
  const activeRunStatus = run?.status;

  useEffect(() => {
    if (!activeRunId || !activeRunStatus || TERMINAL_STATUSES.has(activeRunStatus)) return;
    let disposed = false;
    let timer = 0;
    const poll = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 3_500);
      try {
        const next = await getTrainingRun(activeRunId, controller.signal);
        if (!disposed) {
          setRun(next);
          setBridge("online");
        }
      } catch {
        if (!disposed) setBridge("offline");
      } finally {
        window.clearTimeout(timeout);
        if (!disposed) timer = window.setTimeout(poll, 900);
      }
    };
    timer = window.setTimeout(poll, 400);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [activeRunId, activeRunStatus]);

  const totalUploadBytes = useMemo(
    () =>
      files.reduce((sum, file) => sum + file.size, 0) +
      new TextEncoder().encode(pastedText).length,
    [files, pastedText],
  );
  const documentCount = files.length + (pastedText.trim() ? 1 : 0);
  const latestSample = run?.samples.at(-1);
  const currentPreset = PRESETS.find((candidate) => candidate.id === preset)!;

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.currentTarget.files ?? []);
    const selected = chosen.filter((file) =>
      /\.(?:txt|md)$/i.test(file.name),
    );
    const next = [...files, ...selected];
    const unique = next.filter(
      (file, index) =>
        next.findIndex(
          (candidate) =>
            candidate.name === file.name &&
            candidate.size === file.size &&
            candidate.lastModified === file.lastModified,
        ) === index,
    );
    setFiles(unique);
    event.currentTarget.value = "";
    setMessage(
      selected.length === chosen.length
        ? null
        : "Only plain .txt and .md files are accepted.",
    );
  };

  const beginTraining = async () => {
    if (bridge !== "online" || documentCount === 0) return;
    if (totalUploadBytes > MAX_UPLOAD_BYTES) {
      setMessage("This first local version accepts up to 50 MB per run.");
      return;
    }
    setStarting(true);
    setMessage(null);
    try {
      const uploaded = await Promise.all(
        files.map(async (file) => ({ name: file.name, content: await file.text() })),
      );
      if (pastedText.trim()) {
        uploaded.push({ name: "pasted-text.txt", content: pastedText });
      }
      const created = await startTrainingRun({
        documents: uploaded,
        preset,
        contextLength,
        effort,
        device,
        samplePrompt: samplePrompt.trim() || "The",
      });
      setSurface("monitor");
      setRun(created);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Training could not start.");
    } finally {
      setStarting(false);
    }
  };

  const control = async (action: "pause" | "resume" | "stop") => {
    if (!run) return;
    setControlBusy(true);
    setMessage(null);
    try {
      setRun(await controlTrainingRun(run.id, action));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The control request failed.");
    } finally {
      setControlBusy(false);
    }
  };

  const resumeFromCheckpoint = async () => {
    if (!run) return;
    setControlBusy(true);
    setMessage(null);
    try {
      setRun(await resumeTrainingRunFromCheckpoint(run.id));
      setBridge("online");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Training could not resume from the checkpoint.",
      );
    } finally {
      setControlBusy(false);
    }
  };

  const resetSetup = () => {
    setSurface("monitor");
    setRun(null);
    setMessage(null);
  };

  return (
    <main className={styles.chamber}>
      <div className={styles.ambientGrid} aria-hidden="true" />
      <header className={styles.topbar}>
        <Link className={styles.backLink} href="/">
          <span aria-hidden="true">←</span>
          Training world
        </Link>
        <div className={styles.wordmark}>
          <span className={styles.wordmarkDot} aria-hidden="true" />
          Custom Training Chamber
        </div>
        <div className={`${styles.bridgeBadge} ${styles[bridge]}`} role="status">
          <span aria-hidden="true" />
          {bridge === "online"
            ? "Local trainer connected"
            : bridge === "checking"
              ? "Finding local trainer"
              : "Local trainer offline"}
        </div>
      </header>

      {run ? (
        surface === "test" ? (
          <ModelTestLab
            run={run}
            onBack={() => setSurface("monitor")}
            onNewRun={resetSetup}
          />
        ) : (
          <section className={styles.monitor} aria-labelledby="run-title">
          <div className={styles.runHeading}>
            <div>
              <p className={styles.eyebrow}>RUN {run.id.slice(-8).toUpperCase()}</p>
              <h1 id="run-title">{statusLabel(run)}</h1>
              <p>
                The graph, sample, and activity stream below all come from this
                durable local training run.
              </p>
            </div>
            <div className={styles.runStatusBlock}>
              <span className={`${styles.runPulse} ${styles[run.status]}`} />
              <strong>{Math.round(Math.min(1, Math.max(0, run.progress)) * 100)}%</strong>
              <small>
                STEP {run.step.toLocaleString()} / {run.maxSteps.toLocaleString()}
              </small>
            </div>
          </div>

          <div className={styles.phaseStrip} aria-label="Training phases">
            {[
              ["prepare", "Prepare corpus"],
              ["train", "Train model"],
              ["evaluate", "Evaluate"],
              ["complete", "Save result"],
            ].map(([id, label], index) => {
              const phaseIndex = phaseIndexFor(run);
              return (
                <div
                  className={index < phaseIndex ? styles.phaseComplete : index === phaseIndex ? styles.phaseCurrent : ""}
                  key={id}
                >
                  <span>{index < phaseIndex ? "✓" : index + 1}</span>
                  {label}
                </div>
              );
            })}
          </div>

          <div className={styles.progressTrack} aria-label="Run progress">
            <span style={{ width: `${Math.min(100, Math.max(0, run.progress * 100))}%` }} />
          </div>

          {bridge === "offline" ? (
            <div className={styles.inlineWarning} role="status">
              <span>
                Live connection was interrupted. If the local launcher stopped,
                run <code>npm run dev:training</code> once from the project root,
                leave it open, and use the Local URL it prints. The last received
                run state remains safe here.
              </span>
              <button type="button" onClick={() => void connect()}>
                Reconnect
              </button>
            </div>
          ) : null}
          {message ? <div className={styles.inlineError}>{message}</div> : null}

          {run.canResumeFromCheckpoint && run.resumeCheckpointStep != null ? (
            <aside
              className={styles.recoveryGuide}
              aria-labelledby="checkpoint-recovery-title"
            >
              <div>
                <span>Checkpoint recovery</span>
                <strong id="checkpoint-recovery-title">
                  Before resuming from checkpoint
                </strong>
              </div>
              {bridge === "online" ? (
                <p>
                  One local trainer is connected. Keep the PowerShell window
                  running <code>npm run dev:training</code> open, and do not run
                  a second copy.
                </p>
              ) : (
                <p>
                  Open any PowerShell in this project folder and run{" "}
                  <code>npm run dev:training</code> once. Leave it open and open
                  the Local URL it prints.
                </p>
              )}
              <p>
                The original PowerShell window is not required. If the command
                is already running, use its Local URL instead of starting it
                again. Then click Resume from checkpoint; the saved corpus does
                not need to be uploaded again.
              </p>
            </aside>
          ) : null}

          <div className={styles.metricRail}>
            <div><span>Train loss</span><strong>{formatLoss(run.currentLoss)}</strong></div>
            <div><span>Validation</span><strong>{formatLoss(run.validationLoss)}</strong></div>
            <div><span>Throughput</span><strong>{formatCount(run.tokensPerSecond)} <small>tok/s</small></strong></div>
            <div><span>Elapsed</span><strong>{formatDuration(run.elapsedSeconds)}</strong></div>
            <div><span>ETA</span><strong>{formatDuration(run.etaSeconds)}</strong></div>
          </div>

          <div className={styles.dashboardGrid}>
            <section className={`${styles.panel} ${styles.graphPanel}`} aria-labelledby="loss-title">
              <header className={styles.panelHeader}>
                <div>
                  <p>Optimization signal</p>
                  <h2 id="loss-title">Loss over time</h2>
                </div>
                <div className={styles.legendKeys}>
                  <span><i className={styles.trainKey} />Train</span>
                  <span><i className={styles.validationKey} />Validation</span>
                </div>
              </header>
              <div className={styles.chartArea}>
                <LossChart metrics={run.metrics} />
              </div>
            </section>

            <section className={`${styles.panel} ${styles.samplePanel}`} aria-labelledby="sample-title">
              <header className={styles.panelHeader}>
                <div>
                  <p>Fixed prompt · fixed seed</p>
                  <h2 id="sample-title">Evolving model sample</h2>
                </div>
                <span className={styles.stepChip}>
                  {latestSample ? `STEP ${latestSample.step}` : "WAITING"}
                </span>
              </header>
              {latestSample ? (
                <blockquote className={styles.sampleText}>
                  <span>{latestSample.prompt}</span>
                  {latestSample.completion ?? latestSample.text}
                </blockquote>
              ) : (
                <div className={styles.sampleEmpty}>
                  The first authentic completion will appear at the next
                  evaluation interval.
                </div>
              )}
              <footer className={styles.sampleFooter}>
                Preview settings affect this sample only; they do not alter the run.
              </footer>
            </section>

            <section className={`${styles.panel} ${styles.logPanel}`} aria-labelledby="log-title">
              <header className={styles.panelHeader}>
                <div>
                  <p>Read-only process output</p>
                  <h2 id="log-title">Live activity log</h2>
                </div>
                <span className={styles.liveLabel}><i />LIVE</span>
              </header>
              <div className={styles.terminal} role="log" aria-live="off" tabIndex={0}>
                {run.logs.length ? (
                  run.logs.slice(-180).map((entry) => (
                    <div className={styles[entry.level]} key={entry.seq}>
                      <time>{new Date(entry.timestamp).toLocaleTimeString([], { hour12: false })}</time>
                      <span>{entry.message}</span>
                    </div>
                  ))
                ) : (
                  <div><time>--:--:--</time><span>Waiting for the first trainer event…</span></div>
                )}
              </div>
            </section>

            <aside className={`${styles.panel} ${styles.healthPanel}`} aria-label="Run details">
              <header className={styles.panelHeader}>
                <div><p>Run health</p><h2>System &amp; model</h2></div>
              </header>
              <dl className={styles.healthList}>
                <div><dt>Device</dt><dd>{run.device ?? "Detecting"}</dd></div>
                <div><dt>Precision</dt><dd>{run.precision?.toUpperCase() ?? "—"}</dd></div>
                <div><dt>Parameters</dt><dd>{formatCount(run.parameters)}</dd></div>
                <div><dt>Training tokens</dt><dd>{formatCount(run.trainTokens)}</dd></div>
                <div><dt>Best validation</dt><dd>{formatLoss(run.bestValidationLoss)}</dd></div>
                <div><dt>Checkpoints</dt><dd>{run.checkpoints.length}</dd></div>
              </dl>
            </aside>
          </div>

          <div className={styles.controlBar}>
            <div>
              <span className={`${styles.controlState} ${styles[run.status]}`} />
              <div role="status" aria-live="polite">
                <strong>{statusLabel(run)}</strong>
                <small>
                  {run.canResumeFromCheckpoint && run.resumeCheckpointStep != null
                    ? `Checkpoint step ${run.resumeCheckpointStep.toLocaleString()} is ready. Keep the one connected trainer terminal open; resuming will reuse this run's prepared corpus.`
                    : TERMINAL_STATUSES.has(run.status)
                    ? run.checkpoints.length
                      ? "A saved checkpoint is ready for local sampling."
                      : "This run ended without a testable checkpoint."
                    : "Changes take effect after the current optimizer step."}
                </small>
              </div>
            </div>
            <div className={styles.controlButtons} aria-busy={controlBusy}>
              {run.status === "training" || run.status === "preparing" ? (
                <button type="button" onClick={() => void control("pause")} disabled={controlBusy || run.status === "preparing"}>Pause safely</button>
              ) : null}
              {run.status === "paused" ? (
                <button type="button" className={styles.primaryControl} onClick={() => void control("resume")} disabled={controlBusy}>Resume</button>
              ) : null}
              {!TERMINAL_STATUSES.has(run.status) ? (
                <button type="button" className={styles.stopControl} onClick={() => void control("stop")} disabled={controlBusy || run.status === "stopping"}>Stop &amp; save</button>
              ) : (
                <>
                  {run.canResumeFromCheckpoint && run.resumeCheckpointStep != null ? (
                    <button
                      type="button"
                      className={styles.primaryControl}
                      onClick={() => void resumeFromCheckpoint()}
                      disabled={controlBusy || bridge !== "online"}
                      aria-label={`Resume training from checkpoint step ${run.resumeCheckpointStep.toLocaleString()}`}
                    >
                      Resume from checkpoint
                    </button>
                  ) : null}
                  {run.checkpoints.length ? (
                    <button type="button" className={run.canResumeFromCheckpoint ? undefined : styles.primaryControl} onClick={() => setSurface("test")} disabled={controlBusy}>Test your model</button>
                  ) : null}
                  <button type="button" onClick={resetSetup} disabled={controlBusy}>New training run</button>
                </>
              )}
            </div>
          </div>
          </section>
        )
      ) : (
        <section className={styles.setup} aria-labelledby="setup-title">
          <div className={styles.setupIntro}>
            <p className={styles.eyebrow}>SIDE FEATURE · REAL LOCAL PYTORCH</p>
            <h1 id="setup-title">Train a model on your own text.</h1>
            <p className={styles.lede}>
              Supply plain text, choose a safe model preset, and watch the same
              loss, samples, logs, and checkpoints a researcher would inspect.
              Your corpus stays on this computer.
            </p>
            <div className={styles.promiseRow}>
              <span><strong>01</strong> Supply text</span>
              <span><strong>02</strong> Choose scale</span>
              <span><strong>03</strong> Monitor training</span>
            </div>
          </div>

          <aside
            className={styles.localRequirement}
            aria-labelledby="local-training-required-title"
            data-status={bridge}
          >
            <div className={styles.localRequirementCopy}>
              <span className={styles.localRequirementKicker}>
                Required for real training
              </span>
              <h2 id="local-training-required-title">
                Run this site on your local machine.
              </h2>
              <p>
                Training is unavailable on the hosted site because it cannot
                reach the loopback-only PyTorch trainer. Clone or open this
                project on the same computer, install its Node and trainer
                dependencies, then start both pieces with this command.
              </p>
            </div>
            <div className={styles.localCommandCard}>
              <span>From the project root</span>
              <code>npm run dev:training</code>
              <small>
                Run it once, leave that terminal open, then open the <strong>Local URL</strong> it prints.
              </small>
            </div>
            <div className={styles.localConnectionState} role="status">
              <span aria-hidden="true" />
              <strong>
                {bridge === "online"
                  ? "Local trainer connected"
                  : bridge === "checking"
                    ? "Checking this machine"
                    : "No local trainer detected"}
              </strong>
              {bridge === "offline" ? (
                <button type="button" onClick={() => void connect()}>
                  Try connection again
                </button>
              ) : null}
            </div>
          </aside>
          {message ? <div className={styles.inlineError}>{message}</div> : null}

          <div className={styles.setupGrid}>
            <section className={`${styles.panel} ${styles.corpusPanel}`} aria-labelledby="corpus-title">
              <header className={styles.panelHeader}>
                <div><p>Required input</p><h2 id="corpus-title">Your training corpus</h2></div>
                <span className={styles.stepChip}>TXT · MD</span>
              </header>
              <label className={styles.dropZone}>
                <input ref={fileInputRef} type="file" multiple accept=".txt,.md,text/plain,text/markdown" onChange={handleFiles} />
                <span className={styles.uploadMark} aria-hidden="true">＋</span>
                <strong>Choose plain-text files</strong>
                <small>Multiple .txt or .md documents · up to 50 MB total</small>
              </label>
              {files.length ? (
                <ul className={styles.fileList}>
                  {files.map((file, index) => (
                    <li key={`${file.name}-${file.lastModified}`}><span><strong>{file.name}</strong><small>{formatCount(file.size)}B</small></span><button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}>×</button></li>
                  ))}
                </ul>
              ) : null}
              <div className={styles.orDivider}><span>or paste text</span></div>
              <label className={styles.textLabel}>
                <span>Plain text</span>
                <textarea data-director="corpus" value={pastedText} onChange={(event) => setPastedText(event.currentTarget.value)} placeholder="Paste your corpus here…" rows={7} spellCheck={false} />
              </label>
              <div className={styles.corpusSummary}><span>{documentCount} source{documentCount === 1 ? "" : "s"}</span><span>{formatCount(totalUploadBytes)} bytes</span></div>
            </section>

            <section className={`${styles.panel} ${styles.configurationPanel}`} aria-labelledby="configuration-title">
              <header className={styles.panelHeader}>
                <div><p>Safe controls</p><h2 id="configuration-title">Training choices</h2></div>
                <span className={styles.recommendedChip}>GUIDED</span>
              </header>
              <fieldset className={styles.presetFieldset}>
                <legend>Model size</legend>
                <div className={styles.presetGrid}>
                  {PRESETS.map((option) => (
                    <button type="button" key={option.id} className={preset === option.id ? styles.choiceSelected : ""} onClick={() => setPreset(option.id)} aria-pressed={preset === option.id}>
                      <span>{option.name}{option.id === "small" ? <em>Recommended</em> : null}</span><strong>{option.size}</strong><small>{option.description}</small>
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className={styles.selectGrid}>
                <label><span>Context length</span><select value={contextLength} onChange={(event) => setContextLength(Number(event.currentTarget.value) as 64 | 128 | 256)}><option value={64}>64 byte tokens</option><option value={128}>128 byte tokens</option><option value={256}>256 byte tokens</option></select><small>128 is the practical first choice.</small></label>
                <label><span>Compute device</span><select value={device} onChange={(event) => setDevice(event.currentTarget.value as TrainingDevice)}><option value="auto">Automatic</option><option value="cpu">CPU</option><option value="cuda">NVIDIA GPU</option></select><small>Automatic uses a GPU when available.</small></label>
              </div>
              <fieldset className={styles.effortFieldset}>
                <legend>Training effort</legend>
                <div className={styles.effortGrid}>
                  {EFFORTS.map((option) => (
                    <button type="button" key={option.id} className={effort === option.id ? styles.choiceSelected : ""} onClick={() => setEffort(option.id)} aria-pressed={effort === option.id}><strong>{option.name}</strong><small>{option.description}</small></button>
                  ))}
                </div>
              </fieldset>
              <label className={styles.promptLabel}><span>Monitoring sample prompt</span><input value={samplePrompt} onChange={(event) => setSamplePrompt(event.currentTarget.value)} maxLength={160} placeholder="Once upon a time" /><small>The same prompt and seed are reused so progress is comparable.</small></label>
            </section>

            <aside className={`${styles.panel} ${styles.launchPanel}`} aria-label="Training summary">
              <p className={styles.eyebrow}>READY CHECK</p>
              <h2>{currentPreset.name} model</h2>
              <dl>
                <div><dt>Corpus</dt><dd>{documentCount ? `${documentCount} source${documentCount === 1 ? "" : "s"}` : "Required"}</dd></div>
                <div><dt>Capacity</dt><dd>{currentPreset.size}</dd></div>
                <div><dt>Context</dt><dd>{contextLength} bytes</dd></div>
                <div><dt>Effort</dt><dd>{effort}</dd></div>
                <div><dt>Device</dt><dd>{device}</dd></div>
              </dl>
              <div className={styles.realityNote}><strong>What to expect</strong><p>This creates a narrow byte-level language model, not a general chatbot. Validation loss and repeated samples will reveal whether it is learning or memorizing.</p></div>
              <button data-director="start" className={styles.startButton} type="button" onClick={() => void beginTraining()} disabled={starting || bridge !== "online" || documentCount === 0 || totalUploadBytes > MAX_UPLOAD_BYTES}>
                <span>{starting ? "Preparing run…" : "Start real training"}</span><span aria-hidden="true">→</span>
              </button>
              <small className={styles.localNote}>
                Requires the locally launched site and trainer. Leaving this
                page does not stop the trainer.
              </small>
            </aside>
          </div>
        </section>
      )}
    </main>
  );
}
