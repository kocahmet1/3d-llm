export type TrainingRunStatus =
  | "preparing"
  | "training"
  | "pausing"
  | "paused"
  | "stopping"
  | "stopped"
  | "completed"
  | "failed";

export type TrainingPreset = "micro" | "small" | "local";
export type TrainingEffort = "quick" | "balanced" | "thorough";
export type TrainingDevice = "auto" | "cpu" | "cuda";

export interface TrainingDocument {
  name: string;
  content: string;
}

export interface StartTrainingRunRequest {
  documents: TrainingDocument[];
  preset: TrainingPreset;
  contextLength: 64 | 128 | 256;
  effort: TrainingEffort;
  device: TrainingDevice;
  samplePrompt: string;
}

export interface TrainingMetric {
  step: number;
  loss: number;
  validationLoss?: number | null;
  learningRate?: number | null;
  gradientNorm?: number | null;
  tokensPerSecond?: number | null;
  elapsedSeconds?: number | null;
}

export interface TrainingSample {
  step: number;
  prompt: string;
  text: string;
  completion?: string;
}

export interface TrainingLogEntry {
  seq: number;
  timestamp: string;
  level: "info" | "warning" | "error";
  message: string;
}

export interface TrainingCheckpoint {
  step: number;
  kind: "latest" | "best" | "stopped";
  name: string;
}

export interface TrainingRunSnapshot {
  id: string;
  status: TrainingRunStatus;
  phase: string;
  step: number;
  maxSteps: number;
  progress: number;
  startedAt?: string | null;
  updatedAt?: string | null;
  elapsedSeconds?: number | null;
  etaSeconds?: number | null;
  device?: string | null;
  precision?: string | null;
  parameters?: number | null;
  trainTokens?: number | null;
  validationTokens?: number | null;
  tokensPerSecond?: number | null;
  currentLoss?: number | null;
  validationLoss?: number | null;
  bestValidationLoss?: number | null;
  metrics: TrainingMetric[];
  samples: TrainingSample[];
  logs: TrainingLogEntry[];
  checkpoints: TrainingCheckpoint[];
  canResumeFromCheckpoint: boolean;
  resumeCheckpointStep: number | null;
  config?: Record<string, unknown> | null;
  error?: string | null;
}

export interface TrainerHealth {
  ok: boolean;
  service?: string;
  version?: string;
}

export interface ModelGenerationRequest {
  prompt: string;
  maxNewTokens: number;
  temperature: number;
  topK: number;
  seed: number;
}

export interface ModelGenerationResult {
  runId: string;
  checkpoint: string;
  checkpointKind: string;
  checkpointStep: number;
  device: string;
  contextLength: number;
  prompt: string;
  completion: string;
  text: string;
  generatedTokens: number;
  seed: number;
  temperature: number;
  topK: number;
  elapsedSeconds: number;
}
