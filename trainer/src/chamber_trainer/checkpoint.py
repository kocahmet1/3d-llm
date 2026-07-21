"""Atomic, resumable training checkpoints."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import time
from typing import Any
from uuid import uuid4

import torch


ATOMIC_REPLACE_RETRY_DELAYS = (0.02, 0.04, 0.08, 0.16, 0.32, 0.5)


def _temporary_path(destination: Path) -> Path:
    return destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")


def _replace_with_retries(source: Path, destination: Path) -> None:
    for attempt in range(len(ATOMIC_REPLACE_RETRY_DELAYS) + 1):
        try:
            os.replace(source, destination)
            return
        except OSError as error:
            retryable = isinstance(error, PermissionError) or getattr(
                error, "winerror", None
            ) in {5, 32, 33}
            if not retryable or attempt == len(ATOMIC_REPLACE_RETRY_DELAYS):
                raise
            time.sleep(ATOMIC_REPLACE_RETRY_DELAYS[attempt])


def _remove_temporary(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        # A scanner may still have the abandoned temporary open. It is hidden,
        # uniquely named, and safe to leave for later cleanup.
        pass


def save_checkpoint(output_dir: str | Path, step: int, payload: dict[str, Any]) -> Path:
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    checkpoint_path = output / f"checkpoint_{step:08d}.pt"
    temporary = _temporary_path(checkpoint_path)
    try:
        torch.save(payload, temporary)
        _replace_with_retries(temporary, checkpoint_path)
    finally:
        _remove_temporary(temporary)

    publish_checkpoint_alias(checkpoint_path, output / "latest.pt")
    return checkpoint_path


def publish_checkpoint_alias(source: str | Path, destination: str | Path) -> Path:
    """Atomically publish a stable alias such as ``latest.pt`` or ``best.pt``."""

    source_path = Path(source)
    destination_path = Path(destination)
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = _temporary_path(destination_path)
    try:
        shutil.copyfile(source_path, temporary)
        _replace_with_retries(temporary, destination_path)
    finally:
        _remove_temporary(temporary)
    return destination_path


def load_checkpoint(path: str | Path, *, map_location: torch.device) -> dict[str, Any]:
    checkpoint_path = Path(path)
    if not checkpoint_path.is_file():
        raise FileNotFoundError(checkpoint_path)
    try:
        payload = torch.load(checkpoint_path, map_location=map_location, weights_only=True)
    except TypeError:  # PyTorch 2.1 did not expose weights_only on every loader.
        payload = torch.load(checkpoint_path, map_location=map_location)
    if not isinstance(payload, dict) or "model" not in payload or "step" not in payload:
        raise ValueError(f"{checkpoint_path} is not a chamber trainer checkpoint")
    return payload
