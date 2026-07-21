import type {
  ModelGenerationRequest,
  ModelGenerationResult,
  StartTrainingRunRequest,
  TrainerHealth,
  TrainingCheckpoint,
  TrainingLogEntry,
  TrainingMetric,
  TrainingRunSnapshot,
  TrainingRunStatus,
  TrainingSample,
} from "./customTrainingTypes";

export const TRAINER_BRIDGE_URL =
  process.env.NEXT_PUBLIC_CHAMBER_TRAINER_URL ?? "http://127.0.0.1:8765";

class TrainerBridgeError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "TrainerBridgeError";
    this.status = status;
  }
}

async function bridgeRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${TRAINER_BRIDGE_URL}${path}`, {
      cache: "no-store",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new TrainerBridgeError(
      "The local trainer is not reachable. Start the Training Chamber locally and try again.",
    );
  }

  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : `The local trainer returned ${response.status}.`;
    throw new TrainerBridgeError(message, response.status);
  }
  return payload as T;
}

export function getTrainerHealth(signal?: AbortSignal) {
  return bridgeRequest<TrainerHealth>("/health", { signal });
}

export function startTrainingRun(request: StartTrainingRunRequest) {
  return bridgeRequest<Record<string, unknown>>("/runs", {
    method: "POST",
    body: JSON.stringify(request),
  }).then(normalizeSnapshot);
}

export async function getCurrentTrainingRun(signal?: AbortSignal) {
  const value = await bridgeRequest<Record<string, unknown>>("/runs/current", {
    signal,
  });
  if (typeof value.id !== "string" || !value.id) {
    throw new TrainerBridgeError("No local training run exists yet.", 404);
  }
  return normalizeSnapshot(value);
}

export function getTrainingRun(id: string, signal?: AbortSignal) {
  return bridgeRequest<Record<string, unknown>>(
    `/runs/${encodeURIComponent(id)}`,
    { signal },
  ).then(normalizeSnapshot);
}

export function controlTrainingRun(
  id: string,
  action: "pause" | "resume" | "stop",
) {
  return bridgeRequest<Record<string, unknown>>(
    `/runs/${encodeURIComponent(id)}/${action}`,
    { method: "POST", body: "{}" },
  ).then(normalizeSnapshot);
}

export function resumeTrainingRunFromCheckpoint(id: string) {
  return bridgeRequest<Record<string, unknown>>(
    `/runs/${encodeURIComponent(id)}/resume-from-checkpoint`,
    { method: "POST", body: "{}" },
  ).then(normalizeSnapshot);
}

export function generateFromTrainingRun(
  id: string,
  request: ModelGenerationRequest,
) {
  return bridgeRequest<Record<string, unknown>>(
    `/runs/${encodeURIComponent(id)}/generate`,
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  ).then(normalizeGeneration);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeStatus(value: unknown): TrainingRunStatus {
  const status = typeof value === "string" ? value : "preparing";
  if (status === "queued") return "preparing";
  if (status === "running") return "training";
  if (
    status === "preparing" ||
    status === "training" ||
    status === "pausing" ||
    status === "paused" ||
    status === "stopping" ||
    status === "stopped" ||
    status === "completed" ||
    status === "failed"
  ) {
    return status;
  }
  return "failed";
}

function normalizeMetrics(value: unknown): TrainingMetric[] {
  if (!Array.isArray(value)) return [];
  const metrics: TrainingMetric[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const step = finiteNumber(raw.step);
    const loss = finiteNumber(raw.loss ?? raw.trainLoss);
    const validationLoss = finiteNumber(raw.validationLoss);
    if (step == null) continue;
    if (loss != null) {
      metrics.push({
        step,
        loss,
        validationLoss,
        learningRate: finiteNumber(raw.learningRate),
        gradientNorm: finiteNumber(raw.gradientNorm),
        tokensPerSecond: finiteNumber(raw.tokensPerSecond),
        elapsedSeconds: finiteNumber(raw.elapsedSeconds),
      });
      continue;
    }
    if (validationLoss != null) {
      const sameStep = [...metrics].reverse().find((metric) => metric.step === step);
      if (sameStep) {
        sameStep.validationLoss = validationLoss;
      } else if (metrics.length) {
        metrics.push({ ...metrics.at(-1)!, step, validationLoss });
      }
    }
  }
  return metrics;
}

function normalizeLogs(value: unknown): TrainingLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (typeof item === "string") {
      return [{
        seq: index + 1,
        timestamp: new Date(0).toISOString(),
        level: "info" as const,
        message: item.replace(/^\[[^\]]+\]\s*/, ""),
      }];
    }
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    return [{
      seq: finiteNumber(raw.seq) ?? index + 1,
      timestamp:
        typeof raw.timestamp === "string" ? raw.timestamp : new Date(0).toISOString(),
      level:
        raw.level === "warning" || raw.level === "error" ? raw.level : "info",
      message: typeof raw.message === "string" ? raw.message : "Trainer event",
    }];
  });
}

function normalizeSamples(value: unknown): TrainingSample[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const step = finiteNumber(raw.step);
    if (step == null) return [];
    const prompt = typeof raw.prompt === "string" ? raw.prompt : "";
    const completion = typeof raw.completion === "string" ? raw.completion : undefined;
    const text = typeof raw.text === "string" ? raw.text : `${prompt}${completion ?? ""}`;
    return [{ step, prompt, completion, text }];
  });
}

function normalizeCheckpoints(value: unknown): TrainingCheckpoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const step = finiteNumber(raw.step);
    if (step == null) return [];
    const path = typeof raw.path === "string" ? raw.path : "checkpoint.pt";
    const rawKind = raw.kind;
    const kind: TrainingCheckpoint["kind"] =
      rawKind === "best" || rawKind === "stopped" ? rawKind : "latest";
    return [{ step, kind, name: path.split(/[\\/]/).at(-1) ?? path }];
  });
}

function normalizeSnapshot(value: Record<string, unknown>): TrainingRunSnapshot {
  const id = typeof value.id === "string" ? value.id : "unknown";
  const step = finiteNumber(value.step) ?? 0;
  const maxSteps = finiteNumber(value.maxSteps) ?? 0;
  const reportedProgress = finiteNumber(value.progress);
  return {
    id,
    status: normalizeStatus(value.status),
    phase: typeof value.phase === "string" ? value.phase : "preparing",
    step,
    maxSteps,
    progress:
      reportedProgress ?? (maxSteps > 0 ? Math.min(1, step / maxSteps) : 0),
    startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    elapsedSeconds: finiteNumber(value.elapsedSeconds),
    etaSeconds: finiteNumber(value.etaSeconds),
    device: typeof value.device === "string" ? value.device : null,
    precision: typeof value.precision === "string" ? value.precision : null,
    parameters: finiteNumber(value.parameters),
    trainTokens: finiteNumber(value.trainTokens),
    validationTokens: finiteNumber(value.validationTokens),
    tokensPerSecond: finiteNumber(value.tokensPerSecond),
    currentLoss: finiteNumber(value.currentLoss),
    validationLoss: finiteNumber(value.validationLoss),
    bestValidationLoss: finiteNumber(value.bestValidationLoss),
    metrics: normalizeMetrics(value.metrics),
    samples: normalizeSamples(value.samples),
    logs: normalizeLogs(value.logs),
    checkpoints: normalizeCheckpoints(value.checkpoints),
    canResumeFromCheckpoint: value.canResumeFromCheckpoint === true,
    resumeCheckpointStep: finiteNumber(value.resumeCheckpointStep),
    config:
      value.config && typeof value.config === "object"
        ? (value.config as Record<string, unknown>)
        : null,
    error: typeof value.error === "string" ? value.error : null,
  };
}

function normalizeGeneration(
  value: Record<string, unknown>,
): ModelGenerationResult {
  const prompt = typeof value.prompt === "string" ? value.prompt : "";
  const completion =
    typeof value.completion === "string" ? value.completion : "";
  return {
    runId: typeof value.runId === "string" ? value.runId : "unknown",
    checkpoint:
      typeof value.checkpoint === "string" ? value.checkpoint : "checkpoint.pt",
    checkpointKind:
      typeof value.checkpointKind === "string" ? value.checkpointKind : "saved",
    checkpointStep: finiteNumber(value.checkpointStep) ?? 0,
    device: typeof value.device === "string" ? value.device : "cpu",
    contextLength: finiteNumber(value.contextLength) ?? 0,
    prompt,
    completion,
    text:
      typeof value.text === "string" ? value.text : `${prompt}${completion}`,
    generatedTokens: finiteNumber(value.generatedTokens) ?? 0,
    seed: finiteNumber(value.seed) ?? 0,
    temperature: finiteNumber(value.temperature) ?? 0.8,
    topK: finiteNumber(value.topK) ?? 40,
    elapsedSeconds: finiteNumber(value.elapsedSeconds) ?? 0,
  };
}

export { TrainerBridgeError };
