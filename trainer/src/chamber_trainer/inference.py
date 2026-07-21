"""Load a trusted chamber checkpoint and generate text from its exact model."""

from __future__ import annotations

from dataclasses import fields
from pathlib import Path
import time
from typing import Any

import torch

from .checkpoint import load_checkpoint
from .config import ModelConfig
from .generation import generate_text
from .model import DecoderOnlyTransformer
from .tokenizer import VOCAB_SIZE


class PromptExceedsContextError(ValueError):
    """The byte-level prompt cannot fit in the checkpoint's context window."""


def _model_config_from_checkpoint(payload: dict[str, Any]) -> ModelConfig:
    checkpoint_config = payload.get("config")
    if not isinstance(checkpoint_config, dict):
        raise ValueError("checkpoint does not contain an experiment configuration")
    raw_model = checkpoint_config.get("model")
    if not isinstance(raw_model, dict):
        raise ValueError("checkpoint does not contain a model configuration")

    expected = {field.name for field in fields(ModelConfig)}
    missing = expected - set(raw_model)
    unknown = set(raw_model) - expected
    if missing or unknown:
        details = []
        if missing:
            details.append(f"missing: {', '.join(sorted(missing))}")
        if unknown:
            details.append(f"unknown: {', '.join(sorted(unknown))}")
        raise ValueError(f"checkpoint model configuration is invalid ({'; '.join(details)})")

    model_config = ModelConfig(**raw_model)
    if model_config.vocab_size != VOCAB_SIZE:
        raise ValueError(
            f"checkpoint vocabulary has {model_config.vocab_size} entries; "
            f"byte-level inference requires exactly {VOCAB_SIZE}"
        )
    return model_config


def generate_from_checkpoint(
    checkpoint_path: str | Path,
    *,
    checkpoint_kind: str,
    prompt: str,
    max_new_tokens: int,
    temperature: float,
    top_k: int,
    seed: int,
) -> dict[str, object]:
    """Generate on CPU from a complete, service-created training checkpoint."""

    started = time.perf_counter()
    path = Path(checkpoint_path)
    device = torch.device("cpu")
    payload = load_checkpoint(path, map_location=device)
    model_config = _model_config_from_checkpoint(payload)

    prompt_tokens = len(prompt.encode("utf-8"))
    if prompt_tokens > model_config.context_length:
        raise PromptExceedsContextError(
            f"prompt uses {prompt_tokens} UTF-8 byte tokens, but this checkpoint's "
            f"context length is {model_config.context_length}; shorten the prompt"
        )

    model = DecoderOnlyTransformer(model_config).to(device)
    model.load_state_dict(payload["model"])
    sample = generate_text(
        model,
        prompt,
        device=device,
        max_new_tokens=max_new_tokens,
        temperature=temperature,
        top_k=top_k,
        seed=seed,
    )
    return {
        "prompt": sample["prompt"],
        "completion": sample["completion"],
        "text": sample["text"],
        "generatedTokens": sample["generated_tokens"],
        "seed": sample["seed"],
        "temperature": sample["temperature"],
        "topK": sample["top_k"],
        "checkpoint": path.name,
        "checkpointKind": checkpoint_kind,
        "checkpointStep": int(payload["step"]),
        "device": str(device),
        "contextLength": model_config.context_length,
        "elapsedSeconds": time.perf_counter() - started,
    }
