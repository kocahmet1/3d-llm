"use client";

import { useMemo, useState } from "react";
import type {
  ModelGenerationResult,
  TrainingRunSnapshot,
} from "../../lib/customTrainingTypes";
import { generateFromTrainingRun } from "../../lib/trainingClient";
import styles from "./CustomTrainingChamber.module.css";

interface ModelTestLabProps {
  run: TrainingRunSnapshot;
  onBack: () => void;
  onNewRun: () => void;
}

function configuredContextLength(run: TrainingRunSnapshot) {
  const experiment = run.config?.experiment;
  if (experiment && typeof experiment === "object") {
    const model = (experiment as Record<string, unknown>).model;
    if (model && typeof model === "object") {
      const value = (model as Record<string, unknown>).context_length;
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  }
  const fallback = run.config?.contextLength;
  return typeof fallback === "number" && Number.isFinite(fallback)
    ? fallback
    : 128;
}

function randomSeed() {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return values[0] & 0x7fffffff;
}

function formatSeconds(value: number) {
  if (value < 1) return `${Math.max(1, Math.round(value * 1000))} ms`;
  return `${value.toFixed(2)} s`;
}

export function ModelTestLab({
  run,
  onBack,
  onNewRun,
}: ModelTestLabProps) {
  const contextLength = configuredContextLength(run);
  const initialPrompt =
    run.samples.at(-1)?.prompt?.trim() || "Once upon a time";
  const [prompt, setPrompt] = useState(initialPrompt);
  const [maxNewTokens, setMaxNewTokens] = useState(160);
  const [temperature, setTemperature] = useState(0.8);
  const [topK, setTopK] = useState(40);
  const [lockSeed, setLockSeed] = useState(true);
  const [seed, setSeed] = useState("1337");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<ModelGenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const promptBytes = useMemo(
    () => new TextEncoder().encode(prompt).length,
    [prompt],
  );
  const promptTooLong = promptBytes > contextLength;
  const parsedSeed = Number.parseInt(seed, 10);
  const seedIsValid =
    Number.isInteger(parsedSeed) &&
    parsedSeed >= 0 &&
    parsedSeed <= 2147483647;
  const checkpoint =
    run.checkpoints.find((item) => item.kind === "best") ??
    run.checkpoints.at(-1);

  const generate = async () => {
    if (
      !prompt.trim() ||
      promptTooLong ||
      generating ||
      (lockSeed && !seedIsValid)
    ) {
      return;
    }
    const generationSeed =
      lockSeed ? parsedSeed : randomSeed();

    setGenerating(true);
    setError(null);
    if (!lockSeed) setSeed(String(generationSeed));
    try {
      setResult(
        await generateFromTrainingRun(run.id, {
          prompt,
          maxNewTokens,
          temperature,
          topK,
          seed: generationSeed,
        }),
      );
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "The saved model could not generate a sample.",
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className={styles.modelTest} aria-labelledby="model-test-title">
      <header className={styles.modelTestHeading}>
        <button type="button" onClick={onBack}>
          <span aria-hidden="true">&larr;</span>
          Training report
        </button>
        <div>
          <p className={styles.eyebrow}>CHECKPOINT INFERENCE</p>
          <h1 id="model-test-title">Test your trained model.</h1>
          <p>
            Give the saved model a starting passage and sample a real
            continuation. Generation runs locally and never changes its
            weights.
          </p>
        </div>
        <div className={styles.checkpointBadge}>
          <span>Checkpoint policy</span>
          <strong>
            {checkpoint?.kind === "best" ? "Best validation first" : "Latest saved"}
          </strong>
          <small>
            {checkpoint
              ? `Saved at step ${checkpoint.step.toLocaleString()}`
              : "Checkpoint unavailable"}
          </small>
        </div>
      </header>

      {error ? (
        <div className={styles.inlineError} role="alert">
          {error}
        </div>
      ) : null}

      <div className={styles.inferenceGrid}>
        <section
          className={`${styles.panel} ${styles.inferenceComposer}`}
          aria-labelledby="inference-controls-title"
        >
          <header className={styles.panelHeader}>
            <div>
              <p>Sampling controls</p>
              <h2 id="inference-controls-title">Write the beginning</h2>
            </div>
            <span className={styles.stepChip}>LOCAL PYTORCH</span>
          </header>

          <label className={styles.inferencePrompt}>
            <span>Prompt</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              rows={8}
              maxLength={2048}
              spellCheck={false}
              placeholder="Begin a passage for the model to continue..."
            />
            <small className={promptTooLong ? styles.budgetExceeded : ""}>
              {promptBytes} / {contextLength} UTF-8 bytes available to this
              model
            </small>
          </label>

          <div className={styles.inferenceControls}>
            <label>
              <span>Maximum output length</span>
              <select
                value={maxNewTokens}
                onChange={(event) =>
                  setMaxNewTokens(Number(event.currentTarget.value))
                }
              >
                <option value={96}>96 byte tokens</option>
                <option value={160}>160 byte tokens</option>
                <option value={256}>256 byte tokens</option>
                <option value={512}>512 byte tokens</option>
              </select>
              <small>Generation may stop sooner if the model emits EOS.</small>
            </label>

            <label>
              <span>
                Temperature <output>{temperature.toFixed(1)}</output>
              </span>
              <input
                type="range"
                min={0.1}
                max={1.5}
                step={0.1}
                value={temperature}
                onChange={(event) =>
                  setTemperature(Number(event.currentTarget.value))
                }
              />
              <small>Lower is steadier; higher is more varied and risky.</small>
            </label>

            <label>
              <span>Top-k vocabulary</span>
              <select
                value={topK}
                onChange={(event) => setTopK(Number(event.currentTarget.value))}
              >
                <option value={10}>10 - narrow</option>
                <option value={20}>20</option>
                <option value={40}>40 - recommended</option>
                <option value={80}>80</option>
                <option value={257}>Off - all 257 tokens</option>
              </select>
              <small>Limits each next byte to the most likely candidates.</small>
            </label>
          </div>

          <div className={styles.seedControl}>
            <label>
              <input
                type="checkbox"
                checked={lockSeed}
                onChange={(event) => setLockSeed(event.currentTarget.checked)}
              />
              <span>Lock seed for repeatable samples</span>
            </label>
            <input
              type="number"
              min={0}
              max={2147483647}
              value={seed}
              disabled={!lockSeed}
              onChange={(event) => setSeed(event.currentTarget.value)}
              aria-label="Generation seed"
              aria-invalid={lockSeed && !seedIsValid}
            />
          </div>

          <div className={styles.inferenceRealityNote}>
            <strong>Experimental local model</strong>
            <p>
              It learned only from the supplied corpus. It may repeat passages,
              invent broken words, contradict itself, or stop abruptly.
              Novel-looking text is not proof of generalization.
            </p>
          </div>

          <button
            className={styles.generateButton}
            type="button"
            onClick={() => void generate()}
            disabled={
              generating ||
              !prompt.trim() ||
              promptTooLong ||
              (lockSeed && !seedIsValid) ||
              run.checkpoints.length === 0
            }
          >
            <span>{generating ? "Loading checkpoint and sampling..." : "Generate continuation"}</span>
            <span aria-hidden="true">&rarr;</span>
          </button>
        </section>

        <section
          className={`${styles.panel} ${styles.inferenceResult}`}
          aria-labelledby="inference-result-title"
          aria-live="polite"
          aria-busy={generating}
        >
          <header className={styles.panelHeader}>
            <div>
              <p>Model output</p>
              <h2 id="inference-result-title">Generated continuation</h2>
            </div>
            <span className={styles.recommendedChip}>
              {result ? `${result.generatedTokens} TOKENS` : "WAITING"}
            </span>
          </header>

          {result ? (
            <>
              <blockquote className={styles.generatedText}>
                <span>{result.prompt}</span>
                <strong>
                  {result.completion ||
                    "The model emitted an end-of-sequence token immediately."}
                </strong>
              </blockquote>
              <dl className={styles.generationMetadata}>
                <div className={styles.checkpointMetadata}>
                  <dt>Checkpoint file</dt>
                  <dd>{result.checkpoint}</dd>
                </div>
                <div>
                  <dt>Checkpoint type</dt>
                  <dd>{result.checkpointKind}</dd>
                </div>
                <div>
                  <dt>Step</dt>
                  <dd>{result.checkpointStep.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Device</dt>
                  <dd>{result.device}</dd>
                </div>
                <div>
                  <dt>Time</dt>
                  <dd>{formatSeconds(result.elapsedSeconds)}</dd>
                </div>
                <div>
                  <dt>Seed</dt>
                  <dd>{result.seed}</dd>
                </div>
                <div>
                  <dt>Settings</dt>
                  <dd>
                    T {result.temperature.toFixed(1)} / K {result.topK}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <div className={styles.generatedEmpty}>
              <span aria-hidden="true">Aa</span>
              <strong>No continuation generated yet</strong>
              <p>
                The first request loads the selected checkpoint, then samples
                one byte token at a time from the model.
              </p>
            </div>
          )}
        </section>
      </div>

      <footer className={styles.modelTestActions}>
        <button type="button" onClick={onBack}>
          Return to training report
        </button>
        <button type="button" onClick={onNewRun}>
          Train another model
        </button>
      </footer>
    </section>
  );
}
