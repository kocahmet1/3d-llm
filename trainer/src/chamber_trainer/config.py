"""Typed TOML configuration with validation and relative-path handling."""

from __future__ import annotations

from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Any, TypeVar
import tomllib

from .tokenizer import VOCAB_SIZE


@dataclass
class DataConfig:
    source: str = "synthetic"
    train_bin: Path | None = None
    val_bin: Path | None = None
    synthetic_train_tokens: int = 8192
    synthetic_val_tokens: int = 2048


@dataclass
class ModelConfig:
    vocab_size: int = VOCAB_SIZE
    context_length: int = 128
    d_model: int = 128
    n_heads: int = 4
    n_layers: int = 4
    mlp_ratio: int = 4
    dropout: float = 0.0
    bias: bool = True
    tie_embeddings: bool = False


@dataclass
class TrainingConfig:
    output_dir: Path = Path("runs/default")
    device: str = "auto"
    precision: str = "auto"
    micro_batch_size: int = 8
    gradient_accumulation_steps: int = 1
    max_steps: int = 1000
    learning_rate: float = 3e-4
    min_learning_rate: float = 3e-5
    warmup_steps: int = 100
    weight_decay: float = 0.1
    beta1: float = 0.9
    beta2: float = 0.95
    grad_clip: float = 1.0
    eval_interval: int = 100
    eval_batches: int = 10
    checkpoint_interval: int = 500
    log_interval: int = 10
    sample_interval: int = 250
    sample_max_new_tokens: int = 160
    sample_temperature: float = 0.8
    sample_top_k: int = 40
    sample_prompt: str = "Once upon a time"
    deterministic: bool = False
    resume: Path | None = None


@dataclass
class ExperimentConfig:
    seed: int
    data: DataConfig
    model: ModelConfig
    training: TrainingConfig

    @classmethod
    def load(cls, path: str | Path) -> "ExperimentConfig":
        config_path = Path(path).expanduser().resolve()
        with config_path.open("rb") as handle:
            raw = tomllib.load(handle)

        unknown_top_level = set(raw) - {"seed", "data", "model", "training"}
        if unknown_top_level:
            names = ", ".join(sorted(unknown_top_level))
            raise ValueError(f"unknown top-level config keys: {names}")

        base = config_path.parent
        data = _load_section(DataConfig, raw.get("data", {}), "data")
        model = _load_section(ModelConfig, raw.get("model", {}), "model")
        training = _load_section(TrainingConfig, raw.get("training", {}), "training")

        data.train_bin = _resolve_optional_path(data.train_bin, base)
        data.val_bin = _resolve_optional_path(data.val_bin, base)
        training.output_dir = _resolve_path(training.output_dir, base)
        training.resume = _resolve_optional_path(training.resume, base)

        config = cls(seed=int(raw.get("seed", 1337)), data=data, model=model, training=training)
        config.validate()
        return config

    def validate(self) -> None:
        if self.data.source not in {"synthetic", "bin"}:
            raise ValueError("data.source must be 'synthetic' or 'bin'")
        if self.data.source == "bin" and (self.data.train_bin is None or self.data.val_bin is None):
            raise ValueError("bin data requires data.train_bin and data.val_bin")
        if self.data.source == "bin" and self.model.vocab_size < VOCAB_SIZE:
            raise ValueError(f"model.vocab_size must be at least {VOCAB_SIZE} for byte-token bins")
        if self.data.source == "synthetic" and self.model.vocab_size < 2:
            raise ValueError("model.vocab_size must be at least 2")
        if self.model.context_length < 1:
            raise ValueError("model.context_length must be positive")
        if self.model.d_model < 1 or self.model.n_heads < 1 or self.model.n_layers < 1:
            raise ValueError("model dimensions and layer count must be positive")
        if self.model.d_model % self.model.n_heads != 0:
            raise ValueError("model.d_model must be divisible by model.n_heads")
        if self.model.mlp_ratio < 1:
            raise ValueError("model.mlp_ratio must be positive")
        if not 0.0 <= self.model.dropout < 1.0:
            raise ValueError("model.dropout must be in [0, 1)")

        train = self.training
        positive_ints = {
            "micro_batch_size": train.micro_batch_size,
            "gradient_accumulation_steps": train.gradient_accumulation_steps,
            "max_steps": train.max_steps,
            "eval_interval": train.eval_interval,
            "eval_batches": train.eval_batches,
            "checkpoint_interval": train.checkpoint_interval,
            "log_interval": train.log_interval,
            "sample_interval": train.sample_interval,
            "sample_max_new_tokens": train.sample_max_new_tokens,
            "sample_top_k": train.sample_top_k,
        }
        for name, value in positive_ints.items():
            if value < 1:
                raise ValueError(f"training.{name} must be positive")
        if train.warmup_steps < 0 or train.warmup_steps > train.max_steps:
            raise ValueError("training.warmup_steps must be between 0 and max_steps")
        if train.learning_rate <= 0 or train.min_learning_rate < 0:
            raise ValueError("learning rates must be non-negative and peak LR must be positive")
        if train.min_learning_rate > train.learning_rate:
            raise ValueError("min_learning_rate cannot exceed learning_rate")
        if train.weight_decay < 0 or train.grad_clip < 0:
            raise ValueError("weight_decay and grad_clip cannot be negative")
        if train.sample_temperature <= 0:
            raise ValueError("training.sample_temperature must be positive")
        if not train.sample_prompt:
            raise ValueError("training.sample_prompt cannot be empty")
        if not (0 <= train.beta1 < 1 and 0 <= train.beta2 < 1):
            raise ValueError("AdamW beta values must be in [0, 1)")
        if train.precision not in {"auto", "fp32", "bf16", "fp16"}:
            raise ValueError("training.precision must be auto, fp32, bf16, or fp16")

        minimum_tokens = self.model.context_length + 1
        if self.data.source == "synthetic":
            if self.data.synthetic_train_tokens < minimum_tokens:
                raise ValueError("synthetic_train_tokens is shorter than one source window")
            if self.data.synthetic_val_tokens < minimum_tokens:
                raise ValueError("synthetic_val_tokens is shorter than one source window")

    def as_serializable_dict(self) -> dict[str, Any]:
        value = asdict(self)
        return _stringify_paths(value)


SectionT = TypeVar("SectionT", DataConfig, ModelConfig, TrainingConfig)


def _load_section(section_type: type[SectionT], raw: dict[str, Any], name: str) -> SectionT:
    if not isinstance(raw, dict):
        raise ValueError(f"[{name}] must be a TOML table")
    allowed = {field.name for field in fields(section_type)}
    unknown = set(raw) - allowed
    if unknown:
        names = ", ".join(sorted(unknown))
        raise ValueError(f"unknown [{name}] keys: {names}")
    values = dict(raw)
    for path_name in {"train_bin", "val_bin", "output_dir", "resume"} & values.keys():
        raw_path = values[path_name]
        values[path_name] = None if raw_path in {None, ""} else Path(raw_path)
    return section_type(**values)


def _resolve_path(path: Path, base: Path) -> Path:
    path = path.expanduser()
    return path.resolve() if path.is_absolute() else (base / path).resolve()


def _resolve_optional_path(path: Path | None, base: Path) -> Path | None:
    return None if path is None else _resolve_path(path, base)


def _stringify_paths(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {key: _stringify_paths(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_stringify_paths(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_stringify_paths(item) for item in value)
    return value
