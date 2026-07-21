"""Loopback-only HTTP companion for real, locally executed training runs."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, fields
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import re
import socket
from threading import Lock, Thread
import time
from typing import Any
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

from .config import DataConfig, ExperimentConfig, ModelConfig, TrainingConfig
from .corpus import prepare_corpus
from .runtime import TrainingController
from .tokenizer import VOCAB_SIZE


MAX_REQUEST_BYTES = 50 * 1024 * 1024
MAX_DOCUMENTS = 128
MAX_SAMPLE_PROMPT_CHARACTERS = 2_048
RUN_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
CHECKPOINT_FILE_PATTERN = re.compile(r"^checkpoint_([0-9]{8})\.pt$")
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
ACTIVE_STATES = {
    "queued",
    "preparing",
    "running",
    "training",
    "pausing",
    "paused",
    "stopping",
}
INFERENCE_STATES = {"completed", "stopped", "failed"}
GENERATION_REQUEST_BYTES = 32 * 1024

PRESETS: dict[str, dict[str, Any]] = {
    "micro": {
        "d_model": 64,
        "n_heads": 4,
        "n_layers": 2,
        "micro_batch_size": 8,
        "gradient_accumulation_steps": 1,
        "tie_embeddings": True,
    },
    "small": {
        "d_model": 128,
        "n_heads": 4,
        "n_layers": 4,
        "micro_batch_size": 4,
        "gradient_accumulation_steps": 2,
        "tie_embeddings": True,
    },
    "local": {
        "d_model": 256,
        "n_heads": 8,
        "n_layers": 6,
        "micro_batch_size": 1,
        "gradient_accumulation_steps": 8,
        "tie_embeddings": False,
    },
}
EFFORT_PASSES = {"quick": 1, "balanced": 3, "thorough": 8}
DEFAULT_CONTEXTS = {"micro": 64, "small": 128, "local": 256}
ATOMIC_REPLACE_RETRY_DELAYS = (0.02, 0.04, 0.08, 0.16, 0.32, 0.5)


class ServiceError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        temporary.write_text(
            json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
            encoding="utf-8",
        )
        for attempt in range(len(ATOMIC_REPLACE_RETRY_DELAYS) + 1):
            try:
                os.replace(temporary, path)
                return
            except OSError as error:
                retryable = isinstance(error, PermissionError) or getattr(
                    error, "winerror", None
                ) in {5, 32, 33}
                if not retryable or attempt == len(ATOMIC_REPLACE_RETRY_DELAYS):
                    raise
                time.sleep(ATOMIC_REPLACE_RETRY_DELAYS[attempt])
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            # A scanner may still have the abandoned temporary open. It is
            # hidden, uniquely named, and safe to leave for later cleanup.
            pass


def _validate_run_request(payload: object) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ServiceError(HTTPStatus.BAD_REQUEST, "request body must be a JSON object")
    documents = payload.get("documents")
    if not isinstance(documents, list) or not documents:
        raise ServiceError(HTTPStatus.BAD_REQUEST, "documents must be a non-empty array")
    if len(documents) > MAX_DOCUMENTS:
        raise ServiceError(
            HTTPStatus.BAD_REQUEST,
            f"at most {MAX_DOCUMENTS} documents may be submitted in one run",
        )

    normalized_documents: list[dict[str, str]] = []
    content_bytes = 0
    for index, document in enumerate(documents):
        if not isinstance(document, dict):
            raise ServiceError(HTTPStatus.BAD_REQUEST, f"documents[{index}] must be an object")
        name = document.get("name", f"document-{index + 1}.txt")
        content = document.get("content")
        if not isinstance(name, str) or not name.strip():
            raise ServiceError(HTTPStatus.BAD_REQUEST, f"documents[{index}].name is invalid")
        if not isinstance(content, str) or not content:
            raise ServiceError(
                HTTPStatus.BAD_REQUEST,
                f"documents[{index}].content must be non-empty text",
            )
        try:
            content_bytes += len(content.encode("utf-8"))
        except UnicodeEncodeError as error:
            raise ServiceError(
                HTTPStatus.BAD_REQUEST,
                f"documents[{index}].content is not valid Unicode text",
            ) from error
        normalized_documents.append({"name": name[:256], "content": content})
    if content_bytes > MAX_REQUEST_BYTES:
        raise ServiceError(
            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            f"document text exceeds the {MAX_REQUEST_BYTES // (1024 * 1024)} MiB limit",
        )

    preset = payload.get("preset", "small")
    effort = payload.get("effort", "standard")
    device = payload.get("device", "auto")
    if preset not in PRESETS:
        raise ServiceError(HTTPStatus.BAD_REQUEST, f"unknown preset: {preset}")
    if effort not in EFFORT_PASSES:
        raise ServiceError(HTTPStatus.BAD_REQUEST, f"unknown effort: {effort}")
    if device not in {"auto", "cpu", "cuda", "mps"}:
        raise ServiceError(HTTPStatus.BAD_REQUEST, f"unsupported device: {device}")

    context_length = payload.get("contextLength", DEFAULT_CONTEXTS[preset])
    if isinstance(context_length, bool) or not isinstance(context_length, int):
        raise ServiceError(HTTPStatus.BAD_REQUEST, "contextLength must be an integer")
    if not 16 <= context_length <= 512:
        raise ServiceError(HTTPStatus.BAD_REQUEST, "contextLength must be between 16 and 512")

    sample_prompt = payload.get("samplePrompt", "Once upon a time")
    if not isinstance(sample_prompt, str) or not sample_prompt.strip():
        raise ServiceError(HTTPStatus.BAD_REQUEST, "samplePrompt must be non-empty text")
    if len(sample_prompt) > MAX_SAMPLE_PROMPT_CHARACTERS:
        raise ServiceError(
            HTTPStatus.BAD_REQUEST,
            f"samplePrompt may contain at most {MAX_SAMPLE_PROMPT_CHARACTERS} characters",
        )

    return {
        "documents": normalized_documents,
        "preset": preset,
        "contextLength": context_length,
        "effort": effort,
        "device": device,
        "samplePrompt": sample_prompt,
        "contentBytes": content_bytes,
    }


def _validate_generation_request(payload: object) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ServiceError(HTTPStatus.BAD_REQUEST, "request body must be a JSON object")
    expected = {"prompt", "maxNewTokens", "temperature", "topK", "seed"}
    missing = expected - set(payload)
    unknown = set(payload) - expected
    if missing or unknown:
        details = []
        if missing:
            details.append(f"missing fields: {', '.join(sorted(missing))}")
        if unknown:
            details.append(f"unknown fields: {', '.join(sorted(unknown))}")
        raise ServiceError(HTTPStatus.BAD_REQUEST, "; ".join(details))

    prompt = payload["prompt"]
    if not isinstance(prompt, str) or not prompt.strip():
        raise ServiceError(HTTPStatus.BAD_REQUEST, "prompt must be non-empty text")
    if len(prompt) > MAX_SAMPLE_PROMPT_CHARACTERS:
        raise ServiceError(
            HTTPStatus.BAD_REQUEST,
            f"prompt may contain at most {MAX_SAMPLE_PROMPT_CHARACTERS} characters",
        )
    try:
        prompt.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ServiceError(HTTPStatus.BAD_REQUEST, "prompt is not valid Unicode text") from error

    max_new_tokens = payload["maxNewTokens"]
    if isinstance(max_new_tokens, bool) or not isinstance(max_new_tokens, int):
        raise ServiceError(HTTPStatus.BAD_REQUEST, "maxNewTokens must be an integer")
    if not 16 <= max_new_tokens <= 512:
        raise ServiceError(HTTPStatus.BAD_REQUEST, "maxNewTokens must be between 16 and 512")

    temperature = payload["temperature"]
    if (
        isinstance(temperature, bool)
        or not isinstance(temperature, (int, float))
        or not math.isfinite(float(temperature))
    ):
        raise ServiceError(HTTPStatus.BAD_REQUEST, "temperature must be a finite number")
    temperature = float(temperature)
    if not 0.1 <= temperature <= 1.5:
        raise ServiceError(HTTPStatus.BAD_REQUEST, "temperature must be between 0.1 and 1.5")

    top_k = payload["topK"]
    if isinstance(top_k, bool) or not isinstance(top_k, int):
        raise ServiceError(HTTPStatus.BAD_REQUEST, "topK must be an integer")
    if not 1 <= top_k <= VOCAB_SIZE:
        raise ServiceError(
            HTTPStatus.BAD_REQUEST,
            f"topK must be between 1 and {VOCAB_SIZE}",
        )

    seed = payload["seed"]
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise ServiceError(HTTPStatus.BAD_REQUEST, "seed must be an integer")
    if not 0 <= seed <= 2_147_483_647:
        raise ServiceError(HTTPStatus.BAD_REQUEST, "seed must be between 0 and 2147483647")

    return {
        "prompt": prompt,
        "max_new_tokens": max_new_tokens,
        "temperature": temperature,
        "top_k": top_k,
        "seed": seed,
    }


def _config_for_request(
    request: dict[str, Any],
    *,
    run_dir: Path,
    train_tokens: int,
    validation_tokens: int,
) -> ExperimentConfig:
    preset = PRESETS[request["preset"]]
    context_length = request["contextLength"]
    minimum_tokens = context_length + 1
    if train_tokens < minimum_tokens or validation_tokens < minimum_tokens:
        raise ValueError(
            "the prepared train and validation splits must each contain at least "
            f"{minimum_tokens} byte tokens for contextLength={context_length}; "
            f"got train={train_tokens} validation={validation_tokens}"
        )

    tokens_per_update = (
        preset["micro_batch_size"]
        * context_length
        * preset["gradient_accumulation_steps"]
    )
    updates_per_pass = math.ceil(max(1, train_tokens - 1) / tokens_per_update)
    max_steps = max(20, updates_per_pass * EFFORT_PASSES[request["effort"]])
    max_steps = min(max_steps, 250_000)
    eval_interval = max(1, min(max_steps, max(10, max_steps // 20)))
    checkpoint_interval = max(1, min(max_steps, max(25, max_steps // 10)))
    sample_interval = max(1, min(max_steps, max(50, max_steps // 5)))
    log_interval = max(1, min(10, max_steps // 100 or 1))

    model = ModelConfig(
        vocab_size=VOCAB_SIZE,
        context_length=context_length,
        d_model=preset["d_model"],
        n_heads=preset["n_heads"],
        n_layers=preset["n_layers"],
        mlp_ratio=4,
        dropout=0.1,
        bias=True,
        tie_embeddings=preset["tie_embeddings"],
    )
    training = TrainingConfig(
        output_dir=run_dir / "checkpoints",
        device=request["device"],
        precision="auto",
        micro_batch_size=preset["micro_batch_size"],
        gradient_accumulation_steps=preset["gradient_accumulation_steps"],
        max_steps=max_steps,
        learning_rate=3e-4,
        min_learning_rate=3e-5,
        warmup_steps=min(200, max_steps // 20),
        weight_decay=0.1,
        beta1=0.9,
        beta2=0.95,
        grad_clip=1.0,
        eval_interval=eval_interval,
        eval_batches=5 if request["preset"] == "micro" else 8,
        checkpoint_interval=checkpoint_interval,
        log_interval=log_interval,
        sample_interval=sample_interval,
        sample_max_new_tokens=96,
        sample_temperature=0.8,
        sample_top_k=40,
        sample_prompt=request["samplePrompt"],
        deterministic=False,
    )
    config = ExperimentConfig(
        seed=1337,
        data=DataConfig(
            source="bin",
            train_bin=run_dir / "data" / "train.bin",
            val_bin=run_dir / "data" / "val.bin",
        ),
        model=model,
        training=training,
    )
    config.validate()
    return config


def _saved_section(
    section_type: type[DataConfig] | type[ModelConfig] | type[TrainingConfig],
    raw: object,
    name: str,
) -> DataConfig | ModelConfig | TrainingConfig:
    if not isinstance(raw, dict):
        raise ValueError(f"saved [{name}] configuration is not an object")
    allowed = {item.name for item in fields(section_type)}
    unknown = set(raw) - allowed
    if unknown:
        names = ", ".join(sorted(unknown))
        raise ValueError(f"saved [{name}] configuration has unknown keys: {names}")
    return section_type(**raw)


def _owned_run_file(run_dir: Path, *parts: str) -> Path:
    root = run_dir.resolve()
    candidate = root.joinpath(*parts)
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as error:
        raise ServiceError(
            HTTPStatus.CONFLICT,
            f"resume artifact is missing: {candidate.name}",
        ) from error
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise ServiceError(
            HTTPStatus.CONFLICT,
            f"resume artifact is not a regular run file: {candidate.name}",
        )
    return resolved


def _load_resume_config(
    run_dir: Path,
) -> tuple[ExperimentConfig, int, float]:
    config_path = _owned_run_file(run_dir, "config.json")
    manifest_path = _owned_run_file(run_dir, "data", "manifest.json")
    train_path = _owned_run_file(run_dir, "data", "train.bin")
    validation_path = _owned_run_file(run_dir, "data", "val.bin")
    checkpoint_path = _owned_run_file(run_dir, "checkpoints", "latest.pt")

    try:
        raw_config = json.loads(config_path.read_text(encoding="utf-8"))
        if not isinstance(raw_config, dict):
            raise ValueError("saved experiment configuration is not an object")
        unknown = set(raw_config) - {"seed", "data", "model", "training"}
        if unknown:
            names = ", ".join(sorted(unknown))
            raise ValueError(f"saved experiment configuration has unknown keys: {names}")

        raw_data = dict(raw_config["data"])
        raw_training = dict(raw_config["training"])
        raw_data.update(
            {
                "source": "bin",
                "train_bin": train_path,
                "val_bin": validation_path,
            }
        )
        raw_training.update(
            {
                "output_dir": (run_dir / "checkpoints").resolve(),
                "resume": checkpoint_path,
            }
        )
        data = _saved_section(DataConfig, raw_data, "data")
        model = _saved_section(ModelConfig, raw_config["model"], "model")
        training = _saved_section(TrainingConfig, raw_training, "training")
        if not isinstance(data, DataConfig):
            raise TypeError("saved data configuration has the wrong type")
        if not isinstance(model, ModelConfig):
            raise TypeError("saved model configuration has the wrong type")
        if not isinstance(training, TrainingConfig):
            raise TypeError("saved training configuration has the wrong type")
        config = ExperimentConfig(
            seed=int(raw_config.get("seed", 1337)),
            data=data,
            model=model,
            training=training,
        )
        config.validate()

        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            raise ValueError("saved corpus manifest is not an object")
        if manifest.get("format") != "little-endian-int32":
            raise ValueError("saved corpus format is not supported")
        if manifest.get("tokenizer") != "byte-level+eos":
            raise ValueError("saved corpus tokenizer is not supported")
        if manifest.get("vocab_size") != config.model.vocab_size:
            raise ValueError("saved corpus vocabulary does not match the model")
        for split, path in (
            ("train", train_path),
            ("validation", validation_path),
        ):
            details = manifest.get(split)
            if not isinstance(details, dict):
                raise ValueError(f"saved corpus manifest is missing {split}")
            token_count = details.get("tokens")
            if (
                isinstance(token_count, bool)
                or not isinstance(token_count, int)
                or token_count < 2
            ):
                raise ValueError(f"saved {split} token count is invalid")
            if path.stat().st_size != token_count * 4:
                raise ValueError(f"saved {split} token file size does not match its manifest")

        import torch

        from .checkpoint import load_checkpoint

        payload = load_checkpoint(checkpoint_path, map_location=torch.device("cpu"))
        checkpoint_step = payload.get("step")
        if (
            isinstance(checkpoint_step, bool)
            or not isinstance(checkpoint_step, int)
            or checkpoint_step < 0
        ):
            raise ValueError("saved checkpoint step is invalid")
        if checkpoint_step >= config.training.max_steps:
            raise ValueError("saved checkpoint is already at the configured final step")
        if "optimizer" not in payload:
            raise ValueError("saved checkpoint does not contain optimizer state")
        checkpoint_config = payload.get("config")
        if (
            not isinstance(checkpoint_config, dict)
            or checkpoint_config.get("model")
            != config.as_serializable_dict()["model"]
        ):
            raise ValueError("saved checkpoint model does not match the run configuration")
        best_validation = float(payload.get("best_validation", math.inf))
    except ServiceError:
        raise
    except Exception as error:
        raise ServiceError(
            HTTPStatus.UNPROCESSABLE_ENTITY,
            f"the saved run cannot be resumed ({type(error).__name__})",
        ) from error

    return config, checkpoint_step, best_validation


def _event_log_message(event: dict[str, Any], previous: tuple[Any, Any]) -> str | None:
    event_type = event["type"]
    if event_type == "status":
        current = (event.get("state"), event.get("phase"))
        if current == previous and event.get("seq") != 1:
            return None
        if event.get("error"):
            return f"Training failed: {event['error']}"
        return f"Status: {event.get('phase', event.get('state', 'unknown'))}"
    if event_type == "corpus_prepared":
        return (
            f"Corpus prepared: {event['train_tokens']:,} training tokens, "
            f"{event['validation_tokens']:,} validation tokens"
        )
    if event_type == "run_started":
        return (
            f"Model created: {event['parameters']:,} parameters on "
            f"{event['device']} ({event['precision']})"
        )
    if event_type == "train_metrics":
        return (
            f"Step {event['step']}/{event['max_steps']} - loss {event['loss']:.4f} - "
            f"{event['tokens_per_second']:.0f} tok/s"
        )
    if event_type == "validation_metrics":
        suffix = " - new best" if event.get("improved") else ""
        return f"Validation at step {event['step']} - loss {event['loss']:.4f}{suffix}"
    if event_type == "sample":
        return f"Generated a fixed-seed preview at step {event['step']}"
    if event_type == "checkpoint_saved":
        return f"Checkpoint saved at step {event['step']} ({event['kind']})"
    if event_type == "control_requested":
        return f"{str(event['action']).capitalize()} requested"
    if event_type == "resume_requested":
        return f"Resume from checkpoint requested at step {event['step']}"
    if event_type == "resumed":
        return f"Resumed checkpoint at step {event['step']}"
    return None


@dataclass
class RunRecord:
    run_id: str
    run_dir: Path
    snapshot_data: dict[str, Any]

    def __post_init__(self) -> None:
        self.lock = Lock()
        self.controller = TrainingController()
        self.thread: Thread | None = None
        self.event_seq = int(self.snapshot_data.get("lastEventSeq", 0))
        self.log_seq = max(
            (
                int(item.get("seq", 0))
                for item in self.snapshot_data.get("logs", [])
                if isinstance(item, dict)
            ),
            default=0,
        )
        self.events_path = self.run_dir / "events.jsonl"
        self.status_path = self.run_dir / "status.json"

    @classmethod
    def create(cls, run_id: str, run_dir: Path, request: dict[str, Any]) -> "RunRecord":
        created = _utc_now()
        snapshot = {
            "id": run_id,
            "status": "preparing",
            "phase": "preparing",
            "step": 0,
            "maxSteps": None,
            "progress": 0.0,
            "createdAt": created,
            "startedAt": None,
            "updatedAt": created,
            "elapsedSeconds": 0.0,
            "etaSeconds": None,
            "device": request["device"],
            "precision": None,
            "parameters": None,
            "trainTokens": None,
            "validationTokens": None,
            "tokensPerSecond": None,
            "currentLoss": None,
            "validationLoss": None,
            "bestValidationLoss": None,
            "metrics": [],
            "samples": [],
            "logs": [],
            "checkpoints": [],
            "config": {
                "preset": request["preset"],
                "contextLength": request["contextLength"],
                "effort": request["effort"],
                "device": request["device"],
                "samplePrompt": request["samplePrompt"],
                "contentBytes": request["contentBytes"],
                "documentCount": len(request["documents"]),
            },
            "error": None,
            "checkpoint": None,
            "lastEventSeq": 0,
        }
        run_dir.mkdir(parents=True, exist_ok=False)
        record = cls(run_id, run_dir, snapshot)
        record._persist_locked(required=True)
        return record

    @classmethod
    def load(cls, run_dir: Path) -> "RunRecord":
        snapshot = json.loads((run_dir / "status.json").read_text(encoding="utf-8"))
        return cls(str(snapshot["id"]), run_dir, snapshot)

    def _append_log_locked(self, *, timestamp: str, level: str, message: str) -> None:
        self.log_seq += 1
        self.snapshot_data["logs"].append(
            {
                "seq": self.log_seq,
                "timestamp": timestamp,
                "level": level,
                "message": message,
            }
        )
        self.snapshot_data["logs"] = self.snapshot_data["logs"][-500:]

    def _persist_locked(self, *, required: bool = False) -> bool:
        previous_warning = self.snapshot_data.pop("persistenceWarning", None)
        try:
            _atomic_json(self.status_path, self.snapshot_data)
        except OSError as error:
            if required:
                if previous_warning is not None:
                    self.snapshot_data["persistenceWarning"] = previous_warning
                raise

            failures = (
                int(previous_warning.get("failures", 0)) + 1
                if isinstance(previous_warning, dict)
                else 1
            )
            warning = {
                "message": f"{type(error).__name__}: {error}",
                "failures": failures,
                "updatedAt": _utc_now(),
            }
            self.snapshot_data["persistenceWarning"] = warning
            if previous_warning is None:
                self._append_log_locked(
                    timestamp=warning["updatedAt"],
                    level="warning",
                    message=(
                        "The durable monitoring snapshot is temporarily locked. "
                        "Training is continuing and the companion will retry."
                    ),
                )
            if failures == 1 or failures % 10 == 0:
                print(
                    "warning: status.json could not be replaced after retries; "
                    f"training continues in memory ({warning['message']})",
                    flush=True,
                )
            return False

        if previous_warning is not None:
            print("status.json persistence recovered", flush=True)
        return True

    def emit(self, raw_event: dict[str, Any]) -> None:
        with self.lock:
            self._emit_locked(raw_event)

    def _emit_locked(self, raw_event: dict[str, Any]) -> None:
        previous = (self.snapshot_data.get("status"), self.snapshot_data.get("phase"))
        self.event_seq += 1
        event = {
            **raw_event,
            "seq": self.event_seq,
            "runId": self.run_id,
            "timestamp": _utc_now(),
        }
        with self.events_path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n")
            handle.flush()
        self._apply_event_locked(event)
        message = _event_log_message(event, previous)
        if message is not None:
            level = "error" if event.get("state") == "failed" else "info"
            self._append_log_locked(
                timestamp=event["timestamp"],
                level=level,
                message=message,
            )
        self.snapshot_data["lastEventSeq"] = self.event_seq
        self.snapshot_data["updatedAt"] = event["timestamp"]
        self._persist_locked()

    def _apply_event_locked(self, event: dict[str, Any]) -> None:
        event_type = event["type"]
        if "step" in event:
            self.snapshot_data["step"] = event["step"]
        if event_type == "status":
            state = event.get("state", self.snapshot_data["status"])
            self.snapshot_data["status"] = "training" if state == "running" else state
            self.snapshot_data["phase"] = event.get("phase", self.snapshot_data["phase"])
            if event.get("error"):
                self.snapshot_data["error"] = event["error"]
            if event.get("checkpoint"):
                self.snapshot_data["checkpoint"] = event["checkpoint"]
            if event.get("state") == "completed":
                self.snapshot_data["progress"] = 1.0
                self.snapshot_data["etaSeconds"] = 0.0
        elif event_type == "corpus_prepared":
            self.snapshot_data["trainTokens"] = event["train_tokens"]
            self.snapshot_data["validationTokens"] = event["validation_tokens"]
        elif event_type == "config_ready":
            self.snapshot_data["config"]["experiment"] = event["config"]
            self.snapshot_data["maxSteps"] = event["config"]["training"]["max_steps"]
        elif event_type == "run_started":
            self.snapshot_data.update(
                {
                    "status": "training",
                    "phase": "training",
                    "startedAt": self.snapshot_data.get("startedAt")
                    or event["timestamp"],
                    "step": event["step"],
                    "maxSteps": event["max_steps"],
                    "device": event["device"],
                    "precision": event["precision"],
                    "parameters": event["parameters"],
                    "trainTokens": event["train_tokens"],
                    "validationTokens": event["validation_tokens"],
                }
            )
        elif event_type == "train_metrics":
            metric = {
                "step": event["step"],
                "loss": event["loss"],
                "validationLoss": None,
                "learningRate": event["learning_rate"],
                "gradientNorm": event["gradient_norm"],
                "tokensPerSecond": event["tokens_per_second"],
                "elapsedSeconds": event["elapsed_seconds"],
            }
            self.snapshot_data["metrics"].append(metric)
            self.snapshot_data["metrics"] = self.snapshot_data["metrics"][-2_000:]
            self.snapshot_data.update(
                {
                    "progress": event["progress"],
                    "elapsedSeconds": event["elapsed_seconds"],
                    "etaSeconds": event["eta_seconds"],
                    "tokensPerSecond": event["tokens_per_second"],
                    "currentLoss": event["loss"],
                }
            )
        elif event_type == "validation_metrics":
            matching_metric = next(
                (
                    metric
                    for metric in reversed(self.snapshot_data["metrics"])
                    if metric["step"] == event["step"]
                ),
                None,
            )
            if matching_metric is None:
                matching_metric = {
                    "step": event["step"],
                    "loss": self.snapshot_data.get("currentLoss"),
                }
                self.snapshot_data["metrics"].append(matching_metric)
            matching_metric["validationLoss"] = event["loss"]
            matching_metric["bestValidationLoss"] = event["best_loss"]
            self.snapshot_data["metrics"] = self.snapshot_data["metrics"][-2_000:]
            self.snapshot_data["validationLoss"] = event["loss"]
            self.snapshot_data["bestValidationLoss"] = event["best_loss"]
        elif event_type == "sample":
            self.snapshot_data["samples"].append(
                {
                    "step": event["step"],
                    "prompt": event["prompt"],
                    "completion": event["completion"],
                    "text": event["text"],
                    "generatedTokens": event["generated_tokens"],
                }
            )
            self.snapshot_data["samples"] = self.snapshot_data["samples"][-50:]
        elif event_type == "checkpoint_saved":
            checkpoint = {
                "step": event["step"],
                "kind": event["kind"],
                "name": Path(event["path"]).name,
                "path": event["path"],
            }
            self.snapshot_data["checkpoints"].append(checkpoint)
            self.snapshot_data["checkpoints"] = self.snapshot_data["checkpoints"][-100:]
            self.snapshot_data["checkpoint"] = event["latest_path"]
        elif event_type == "control_requested":
            action = event["action"]
            if action == "pause":
                self.snapshot_data["status"] = "training"
                self.snapshot_data["phase"] = "pausing"
            elif action == "resume":
                self.snapshot_data["status"] = "training"
                self.snapshot_data["phase"] = "training"
            elif action == "stop":
                self.snapshot_data["status"] = "stopping"
        elif event_type == "resume_requested":
            self.snapshot_data["status"] = "training"
            self.snapshot_data["phase"] = "resuming"
            self.snapshot_data["error"] = None
            self.snapshot_data["checkpoint"] = event["checkpoint"]
            max_steps = self.snapshot_data.get("maxSteps")
            self.snapshot_data["progress"] = (
                event["step"] / max_steps
                if isinstance(max_steps, int) and max_steps > 0
                else 0.0
            )
            self.snapshot_data["etaSeconds"] = None
            self.snapshot_data["resumedFromStep"] = event["step"]
            self.snapshot_data["resumedAt"] = event["timestamp"]
            self.snapshot_data["resumeCount"] = (
                int(self.snapshot_data.get("resumeCount", 0)) + 1
            )

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            snapshot = deepcopy(self.snapshot_data)
            checkpoint_step = self._resume_checkpoint_step_locked()
            snapshot["canResumeFromCheckpoint"] = checkpoint_step is not None
            snapshot["resumeCheckpointStep"] = checkpoint_step
            return snapshot

    def _resume_checkpoint_step_locked(self) -> int | None:
        status = self.snapshot_data.get("status")
        if status not in {"stopped", "failed"}:
            return None
        checkpoint_dir = self.run_dir / "checkpoints"
        required = (
            self.run_dir / "config.json",
            self.run_dir / "data" / "manifest.json",
            self.run_dir / "data" / "train.bin",
            self.run_dir / "data" / "val.bin",
            checkpoint_dir / "latest.pt",
        )
        if not all(path.is_file() for path in required):
            return None
        try:
            steps = [
                int(match.group(1))
                for path in checkpoint_dir.iterdir()
                if path.is_file()
                and (match := CHECKPOINT_FILE_PATTERN.fullmatch(path.name))
                is not None
            ]
        except OSError:
            return None
        if not steps:
            return None
        checkpoint_step = max(steps)
        max_steps = self.snapshot_data.get("maxSteps")
        if (
            not isinstance(max_steps, int)
            or isinstance(max_steps, bool)
            or checkpoint_step < 0
            or checkpoint_step >= max_steps
        ):
            return None
        return checkpoint_step

    def events_after(self, sequence: int) -> list[dict[str, Any]]:
        if not self.events_path.is_file():
            return []
        events: list[dict[str, Any]] = []
        with self.events_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if int(event.get("seq", 0)) > sequence:
                    events.append(event)
                    if len(events) >= 1_000:
                        break
        return events


class RunManager:
    def __init__(self, runs_dir: str | Path) -> None:
        self.runs_dir = Path(runs_dir).expanduser().resolve()
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        self.lock = Lock()
        self.compute_lock = Lock()
        self.runs: dict[str, RunRecord] = {}
        self.current_id: str | None = None
        self._load_existing()

    def _load_existing(self) -> None:
        candidates: list[RunRecord] = []
        for path in self.runs_dir.iterdir():
            if not path.is_dir() or not RUN_ID_PATTERN.fullmatch(path.name):
                continue
            try:
                record = RunRecord.load(path)
            except (OSError, ValueError, KeyError, json.JSONDecodeError):
                continue
            if record.snapshot_data.get("status") in ACTIVE_STATES:
                record.snapshot_data["status"] = "failed"
                record.snapshot_data["phase"] = "interrupted"
                record.snapshot_data["error"] = (
                    "The local companion stopped before this run finished. "
                    "The most recent checkpoint, if any, remains available."
                )
                record.snapshot_data["updatedAt"] = _utc_now()
                record._persist_locked()
            self.runs[record.run_id] = record
            candidates.append(record)
        if candidates:
            candidates.sort(key=lambda item: item.snapshot_data.get("updatedAt", ""))
            self.current_id = candidates[-1].run_id

    def create(self, payload: object) -> RunRecord:
        request = _validate_run_request(payload)
        with self.lock:
            active = next(
                (
                    record
                    for record in self.runs.values()
                    if record.snapshot().get("status") in ACTIVE_STATES
                ),
                None,
            )
            if active is not None:
                raise ServiceError(HTTPStatus.CONFLICT, "another training run is already active")
            run_id = uuid4().hex
            record = RunRecord.create(run_id, self.runs_dir / run_id, request)
            self.runs[run_id] = record
            self.current_id = run_id
            record.emit({"type": "status", "state": "preparing", "phase": "preparing"})
            thread = Thread(
                target=self._execute,
                args=(record, request),
                name=f"chamber-training-{run_id[:8]}",
                daemon=True,
            )
            record.thread = thread
            thread.start()
            return record

    def resume_from_checkpoint(self, run_id: str) -> RunRecord:
        if not RUN_ID_PATTERN.fullmatch(run_id):
            raise ServiceError(HTTPStatus.NOT_FOUND, "run not found")
        with self.lock:
            record = self.runs.get(run_id)
            if record is None:
                raise ServiceError(HTTPStatus.NOT_FOUND, "run not found")
            active = next(
                (
                    candidate
                    for candidate in self.runs.values()
                    if candidate.snapshot().get("status") in ACTIVE_STATES
                ),
                None,
            )
            if active is not None:
                raise ServiceError(
                    HTTPStatus.CONFLICT,
                    "another training run is already active",
                )
            if record.thread is not None and record.thread.is_alive():
                raise ServiceError(
                    HTTPStatus.CONFLICT,
                    "this training run is still shutting down",
                )

            with record.lock:
                advertised_step = record._resume_checkpoint_step_locked()
                if advertised_step is None:
                    raise ServiceError(
                        HTTPStatus.CONFLICT,
                        "this run does not have a resumable checkpoint",
                    )
                config, checkpoint_step, best_validation = _load_resume_config(
                    record.run_dir
                )
                if checkpoint_step != advertised_step:
                    raise ServiceError(
                        HTTPStatus.UNPROCESSABLE_ENTITY,
                        "the latest checkpoint does not match the newest durable checkpoint file",
                    )

                elapsed_offset = float(record.snapshot_data.get("elapsedSeconds") or 0.0)
                record.snapshot_data["metrics"] = [
                    metric
                    for metric in record.snapshot_data.get("metrics", [])
                    if isinstance(metric, dict)
                    and isinstance(metric.get("step"), (int, float))
                    and metric["step"] <= checkpoint_step
                ]
                record.snapshot_data["samples"] = [
                    sample
                    for sample in record.snapshot_data.get("samples", [])
                    if isinstance(sample, dict)
                    and isinstance(sample.get("step"), (int, float))
                    and sample["step"] <= checkpoint_step
                ]
                record.snapshot_data["checkpoints"] = [
                    checkpoint
                    for checkpoint in record.snapshot_data.get("checkpoints", [])
                    if isinstance(checkpoint, dict)
                    and isinstance(checkpoint.get("step"), (int, float))
                    and checkpoint["step"] <= checkpoint_step
                ]
                record.snapshot_data["step"] = checkpoint_step
                if math.isfinite(best_validation):
                    record.snapshot_data["bestValidationLoss"] = best_validation
                latest_metric = next(
                    (
                        metric
                        for metric in reversed(record.snapshot_data["metrics"])
                        if isinstance(metric.get("loss"), (int, float))
                    ),
                    None,
                )
                record.snapshot_data["currentLoss"] = (
                    latest_metric.get("loss") if latest_metric is not None else None
                )
                latest_validation = next(
                    (
                        metric
                        for metric in reversed(record.snapshot_data["metrics"])
                        if isinstance(metric.get("validationLoss"), (int, float))
                    ),
                    None,
                )
                record.snapshot_data["validationLoss"] = (
                    latest_validation.get("validationLoss")
                    if latest_validation is not None
                    else None
                )
                record.controller = TrainingController()
                record._emit_locked(
                    {
                        "type": "resume_requested",
                        "state": "running",
                        "phase": "resuming",
                        "step": checkpoint_step,
                        "checkpoint": str(config.training.resume),
                    }
                )
                thread = Thread(
                    target=self._execute_resume,
                    args=(record, config, elapsed_offset),
                    name=f"chamber-resume-{run_id[:8]}",
                    daemon=True,
                )
                record.thread = thread
                self.current_id = run_id
                thread.start()
            return record

    def _execute(self, record: RunRecord, request: dict[str, Any]) -> None:
        while not self.compute_lock.acquire(timeout=0.25):
            if record.controller.state() == "stopping":
                record.emit(
                    {"type": "status", "state": "stopped", "phase": "stopped", "step": 0}
                )
                return
        try:
            if record.controller.state() == "stopping":
                record.emit(
                    {"type": "status", "state": "stopped", "phase": "stopped", "step": 0}
                )
                return
            self._execute_with_compute(record, request)
        finally:
            self.compute_lock.release()

    def _execute_with_compute(self, record: RunRecord, request: dict[str, Any]) -> None:
        try:
            from .engine import train

            source_dir = record.run_dir / "source"
            source_dir.mkdir(parents=True, exist_ok=True)
            source_paths: list[Path] = []
            request_manifest = {key: value for key, value in request.items() if key != "documents"}
            request_manifest["documents"] = [
                {"name": item["name"], "bytes": len(item["content"].encode("utf-8"))}
                for item in request["documents"]
            ]
            _atomic_json(record.run_dir / "request.json", request_manifest)
            for index, document in enumerate(request["documents"], start=1):
                extension = ".md" if Path(document["name"]).suffix.lower() == ".md" else ".txt"
                destination = source_dir / f"document_{index:04d}{extension}"
                destination.write_text(document["content"], encoding="utf-8")
                source_paths.append(destination)
            request["documents"] = []

            manifest = prepare_corpus(
                source_paths,
                record.run_dir / "data",
                validation_fraction=0.1,
            )
            train_tokens = int(manifest["train"]["tokens"])
            validation_tokens = int(manifest["validation"]["tokens"])
            record.emit(
                {
                    "type": "corpus_prepared",
                    "train_tokens": train_tokens,
                    "validation_tokens": validation_tokens,
                    "documents": len(source_paths),
                }
            )
            if record.controller.state() == "stopping":
                record.emit({"type": "status", "state": "stopped", "phase": "stopped", "step": 0})
                return

            config = _config_for_request(
                request,
                run_dir=record.run_dir,
                train_tokens=train_tokens,
                validation_tokens=validation_tokens,
            )
            serializable_config = config.as_serializable_dict()
            _atomic_json(record.run_dir / "config.json", serializable_config)
            record.emit({"type": "config_ready", "config": serializable_config})
            train(config, observer=record.emit, control=record.controller)
        except Exception as error:
            if record.snapshot().get("status") != "failed":
                record.emit(
                    {
                        "type": "status",
                        "state": "failed",
                        "phase": "failed",
                        "error": f"{type(error).__name__}: {error}",
                    }
                )

    def _execute_resume(
        self,
        record: RunRecord,
        config: ExperimentConfig,
        elapsed_offset: float,
    ) -> None:
        while not self.compute_lock.acquire(timeout=0.25):
            if record.controller.state() == "stopping":
                step = int(record.snapshot().get("step", 0))
                record.emit(
                    {
                        "type": "status",
                        "state": "stopped",
                        "phase": "stopped",
                        "step": step,
                    }
                )
                return
        try:
            if record.controller.state() == "stopping":
                step = int(record.snapshot().get("step", 0))
                record.emit(
                    {
                        "type": "status",
                        "state": "stopped",
                        "phase": "stopped",
                        "step": step,
                    }
                )
                return
            self._execute_resume_with_compute(record, config, elapsed_offset)
        finally:
            self.compute_lock.release()

    def _execute_resume_with_compute(
        self,
        record: RunRecord,
        config: ExperimentConfig,
        elapsed_offset: float,
    ) -> None:
        try:
            from .engine import train

            def observe(raw_event: dict[str, Any]) -> None:
                event = raw_event
                if raw_event.get("type") == "train_metrics":
                    event = dict(raw_event)
                    event["elapsed_seconds"] = (
                        elapsed_offset + float(raw_event.get("elapsed_seconds", 0.0))
                    )
                record.emit(event)

            train(config, observer=observe, control=record.controller)
        except Exception as error:
            if record.snapshot().get("status") != "failed":
                record.emit(
                    {
                        "type": "status",
                        "state": "failed",
                        "phase": "failed",
                        "error": f"{type(error).__name__}: {error}",
                    }
                )

    def get(self, run_id: str) -> RunRecord:
        if not RUN_ID_PATTERN.fullmatch(run_id):
            raise ServiceError(HTTPStatus.NOT_FOUND, "run not found")
        with self.lock:
            record = self.runs.get(run_id)
        if record is None:
            raise ServiceError(HTTPStatus.NOT_FOUND, "run not found")
        return record

    def current(self) -> RunRecord | None:
        with self.lock:
            return self.runs.get(self.current_id or "")

    def generate(self, run_id: str, payload: object) -> dict[str, object]:
        request = _validate_generation_request(payload)
        record = self.get(run_id)
        with record.lock:
            status = record.snapshot_data.get("status")
        if status not in INFERENCE_STATES:
            raise ServiceError(
                HTTPStatus.CONFLICT,
                "model testing is available only after a run has stopped or finished",
            )

        if not self.compute_lock.acquire(blocking=False):
            raise ServiceError(
                HTTPStatus.CONFLICT,
                "the local trainer is busy with another training or generation request",
            )
        try:
            # Recheck after acquiring the shared model-compute slot. A failed
            # training thread may have published its terminal status just
            # before it finished unwinding.
            with record.lock:
                status = record.snapshot_data.get("status")
            if status not in INFERENCE_STATES:
                raise ServiceError(
                    HTTPStatus.CONFLICT,
                    "model testing is available only after a run has stopped or finished",
                )

            checkpoint_dir = record.run_dir / "checkpoints"
            best = checkpoint_dir / "best.pt"
            latest = checkpoint_dir / "latest.pt"
            if best.is_file():
                checkpoint_path, checkpoint_kind = best, "best"
            elif latest.is_file():
                checkpoint_path, checkpoint_kind = latest, "latest"
            else:
                raise ServiceError(
                    HTTPStatus.CONFLICT,
                    "this run does not have a completed checkpoint to test",
                )

            from .inference import PromptExceedsContextError, generate_from_checkpoint

            try:
                generated = generate_from_checkpoint(
                    checkpoint_path,
                    checkpoint_kind=checkpoint_kind,
                    **request,
                )
                return {"runId": run_id, **generated}
            except PromptExceedsContextError as error:
                raise ServiceError(HTTPStatus.BAD_REQUEST, str(error)) from error
            except (FileNotFoundError, KeyError, RuntimeError, ValueError) as error:
                raise ServiceError(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    f"the selected {checkpoint_kind} checkpoint could not be loaded",
                ) from error
        finally:
            self.compute_lock.release()

    def control(self, run_id: str, action: str) -> RunRecord:
        record = self.get(run_id)
        with record.lock:
            status = record.snapshot_data.get("status")
            if status not in ACTIVE_STATES:
                raise ServiceError(HTTPStatus.CONFLICT, f"cannot {action} a {status} run")
            if action == "pause":
                record.controller.pause()
            elif action == "resume":
                record.controller.resume()
            elif action == "stop":
                record.controller.stop()
            else:
                raise ServiceError(HTTPStatus.NOT_FOUND, "unknown control action")
            record._emit_locked({"type": "control_requested", "action": action})
        return record

    def shutdown(self, timeout: float = 30.0) -> None:
        record = self.current()
        if record is None or record.snapshot().get("status") not in ACTIVE_STATES:
            return
        record.controller.stop()
        if record.thread is not None:
            record.thread.join(timeout)


def idle_snapshot() -> dict[str, Any]:
    return {
        "id": None,
        "status": "idle",
        "phase": "idle",
        "step": 0,
        "maxSteps": None,
        "progress": 0.0,
        "metrics": [],
        "samples": [],
        "logs": [],
        "checkpoints": [],
        "error": None,
    }


class CompanionRequestHandler(BaseHTTPRequestHandler):
    server_version = "ChamberTrainerCompanion/0.1"

    @property
    def manager(self) -> RunManager:
        return self.server.manager  # type: ignore[attr-defined, no-any-return]

    def log_message(self, format: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}", flush=True)

    def _origin(self) -> str | None:
        origin = self.headers.get("Origin")
        if origin is None:
            return None
        parsed = urlsplit(origin)
        if parsed.scheme not in {"http", "https"} or parsed.hostname not in LOCAL_HOSTS:
            raise ServiceError(HTTPStatus.FORBIDDEN, "only loopback browser origins are allowed")
        return origin

    def _require_local_host(self) -> None:
        host = self.headers.get("Host", "")
        parsed = urlsplit(f"//{host}")
        if parsed.hostname not in LOCAL_HOSTS:
            raise ServiceError(HTTPStatus.FORBIDDEN, "the companion accepts loopback hosts only")

    def _send_json(self, status: int, value: object, *, origin: str | None = None) -> None:
        body = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if origin is not None:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self, *, max_bytes: int = MAX_REQUEST_BYTES) -> object:
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            raise ServiceError(HTTPStatus.LENGTH_REQUIRED, "Content-Length is required")
        try:
            length = int(raw_length)
        except ValueError as error:
            raise ServiceError(HTTPStatus.BAD_REQUEST, "invalid Content-Length") from error
        if length < 0 or length > max_bytes:
            raise ServiceError(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                f"request exceeds the {max_bytes:,}-byte limit",
            )
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            raise ServiceError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Content-Type must be application/json")
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ServiceError(HTTPStatus.BAD_REQUEST, "request body is not valid UTF-8 JSON") from error

    def _discard_small_body(self) -> None:
        """Consume an optional control body so keep-alive requests stay aligned."""

        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            return
        try:
            length = int(raw_length)
        except ValueError as error:
            raise ServiceError(HTTPStatus.BAD_REQUEST, "invalid Content-Length") from error
        if length < 0 or length > 1_024:
            raise ServiceError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "control body is too large")
        if length:
            self.rfile.read(length)

    def _dispatch(self, method: str) -> tuple[int, object]:
        parsed = urlsplit(self.path)
        path = parsed.path.rstrip("/") or "/"
        if method == "GET" and path == "/health":
            return HTTPStatus.OK, {
                "ok": True,
                "status": "ok",
                "service": "chamber-trainer-companion",
                "version": "0.1.0",
                "instanceId": self.server.instance_id,  # type: ignore[attr-defined]
                "localOnly": True,
                "maxRequestBytes": MAX_REQUEST_BYTES,
                "presets": sorted(PRESETS),
            }
        if method == "POST" and path == "/runs":
            record = self.manager.create(self._read_json())
            return HTTPStatus.ACCEPTED, record.snapshot()
        if method == "GET" and path == "/runs/current":
            record = self.manager.current()
            if record is None:
                raise ServiceError(HTTPStatus.NOT_FOUND, "no training run exists")
            return HTTPStatus.OK, record.snapshot()

        match = re.fullmatch(
            r"/runs/([0-9a-f]{32})(?:/(events|pause|resume|resume-from-checkpoint|stop|generate))?",
            path,
        )
        if match:
            run_id, action = match.groups()
            if method == "GET" and action is None:
                return HTTPStatus.OK, self.manager.get(run_id).snapshot()
            if method == "GET" and action == "events":
                raw_after = parse_qs(parsed.query).get("after", ["0"])[0]
                try:
                    after = max(0, int(raw_after))
                except ValueError as error:
                    raise ServiceError(HTTPStatus.BAD_REQUEST, "after must be an integer") from error
                record = self.manager.get(run_id)
                events = record.events_after(after)
                return HTTPStatus.OK, {
                    "events": events,
                    "next": events[-1]["seq"] if events else after,
                }
            if method == "POST" and action == "generate":
                request = self._read_json(max_bytes=GENERATION_REQUEST_BYTES)
                return HTTPStatus.OK, self.manager.generate(run_id, request)
            if method == "POST" and action == "resume-from-checkpoint":
                self._discard_small_body()
                return HTTPStatus.ACCEPTED, self.manager.resume_from_checkpoint(
                    run_id
                ).snapshot()
            if method == "POST" and action in {"pause", "resume", "stop"}:
                self._discard_small_body()
                if action == "stop":
                    requesting_instance = self.headers.get(
                        "X-Chamber-Trainer-Instance"
                    )
                    server_instance = self.server.instance_id  # type: ignore[attr-defined]
                    if (
                        requesting_instance is not None
                        and requesting_instance != server_instance
                    ):
                        raise ServiceError(
                            HTTPStatus.CONFLICT,
                            "the stop request belongs to a different trainer instance",
                        )
                return HTTPStatus.ACCEPTED, self.manager.control(run_id, action).snapshot()
        raise ServiceError(HTTPStatus.NOT_FOUND, "endpoint not found")

    def _handle(self, method: str) -> None:
        origin: str | None = None
        try:
            self._require_local_host()
            origin = self._origin()
            status, payload = self._dispatch(method)
            self._send_json(status, payload, origin=origin)
        except ServiceError as error:
            self._send_json(error.status, {"error": error.message}, origin=origin)
        except Exception as error:
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"internal companion error: {type(error).__name__}"},
                origin=origin,
            )

    def do_GET(self) -> None:
        self._handle("GET")

    def do_POST(self) -> None:
        self._handle("POST")

    def do_OPTIONS(self) -> None:
        try:
            self._require_local_host()
            origin = self._origin()
            self.send_response(HTTPStatus.NO_CONTENT)
            if origin is not None:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()
        except ServiceError as error:
            self._send_json(error.status, {"error": error.message})


class CompanionHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = os.name != "nt"

    def __init__(
        self,
        address: tuple[str, int],
        manager: RunManager | None,
        *,
        instance_id: str | None = None,
    ) -> None:
        self.manager = manager
        self.instance_id = instance_id or uuid4().hex
        super().__init__(address, CompanionRequestHandler)

    def server_bind(self) -> None:
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(
                socket.SOL_SOCKET,
                socket.SO_EXCLUSIVEADDRUSE,
                1,
            )
        super().server_bind()


def serve(*, host: str, port: int, runs_dir: str | Path) -> None:
    if host not in {"127.0.0.1", "localhost"}:
        raise ValueError("the companion may bind only to 127.0.0.1 or localhost")
    if not 1 <= port <= 65_535:
        raise ValueError("port must be between 1 and 65535")
    instance_id = (
        os.environ.get("CHAMBER_TRAINER_INSTANCE_ID", "").strip()[:128]
        or uuid4().hex
    )
    # Bind before loading durable run state. A losing duplicate therefore
    # cannot mark the winning process's active run as interrupted.
    server = CompanionHTTPServer(
        (host, port),
        None,
        instance_id=instance_id,
    )
    manager: RunManager | None = None
    try:
        manager = RunManager(runs_dir)
        server.manager = manager
        print(
            f"chamber trainer companion listening on http://{host}:{port}",
            flush=True,
        )
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("stopping companion; saving the active run at its next safe step", flush=True)
    finally:
        server.server_close()
        if manager is not None:
            manager.shutdown()
