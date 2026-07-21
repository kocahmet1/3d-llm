"""Single-device optimization, validation, scheduling, and resume logic."""

from __future__ import annotations

from contextlib import nullcontext
import math
from pathlib import Path
import random
import time
from typing import Any

import torch
from torch import nn

from .checkpoint import load_checkpoint, publish_checkpoint_alias, save_checkpoint
from .config import ExperimentConfig
from .data import TokenStream, build_token_streams, sample_batch
from .generation import generate_text
from .model import DecoderOnlyTransformer, language_model_loss
from .runtime import TrainingControl, TrainingObserver, emit
from .tokenizer import VOCAB_SIZE


def resolve_device(requested: str) -> torch.device:
    if requested == "auto":
        if torch.cuda.is_available():
            return torch.device("cuda")
        mps = getattr(torch.backends, "mps", None)
        if mps is not None and mps.is_available():
            return torch.device("mps")
        return torch.device("cpu")
    device = torch.device(requested)
    if device.type == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is unavailable")
    if device.type == "cuda" and device.index is not None:
        if device.index < 0 or device.index >= torch.cuda.device_count():
            raise RuntimeError(f"CUDA device index {device.index} is unavailable")
    if device.type == "mps":
        mps = getattr(torch.backends, "mps", None)
        if mps is None or not mps.is_available():
            raise RuntimeError("MPS was requested but is unavailable")
    return device


def resolve_precision(requested: str, device: torch.device) -> str:
    if requested == "auto":
        if device.type == "cuda":
            return "bf16" if torch.cuda.is_bf16_supported() else "fp16"
        return "fp32"
    if requested == "fp16" and device.type not in {"cuda", "mps"}:
        raise ValueError("FP16 autocast requires a CUDA or MPS device")
    if requested == "bf16" and device.type not in {"cuda", "cpu"}:
        raise ValueError("BF16 autocast is supported here only on CUDA or CPU")
    if requested == "bf16" and device.type == "cuda" and not torch.cuda.is_bf16_supported():
        raise ValueError("BF16 was requested but this CUDA device does not support it")
    return requested


def autocast_context(device: torch.device, precision: str):
    if precision == "fp32":
        return nullcontext()
    dtype = torch.bfloat16 if precision == "bf16" else torch.float16
    return torch.autocast(device_type=device.type, dtype=dtype)


def make_grad_scaler(*, enabled: bool):
    try:
        return torch.amp.GradScaler("cuda", enabled=enabled)
    except (AttributeError, TypeError):
        return torch.cuda.amp.GradScaler(enabled=enabled)


def _synchronize_device(device: torch.device) -> None:
    """Make update timing meaningful on asynchronous accelerator backends."""

    if device.type == "cuda":
        torch.cuda.synchronize(device)
    elif device.type == "mps" and hasattr(torch, "mps"):
        torch.mps.synchronize()


def learning_rate_for_step(
    step: int,
    *,
    peak: float,
    minimum: float,
    warmup_steps: int,
    total_steps: int,
) -> float:
    if warmup_steps > 0 and step < warmup_steps:
        return peak * (step + 1) / warmup_steps
    if step >= total_steps:
        return minimum
    decay_points = total_steps - warmup_steps
    if decay_points <= 1:
        return peak if warmup_steps == 0 else minimum
    progress = min(
        1.0,
        max(0.0, (step - warmup_steps) / (decay_points - 1)),
    )
    cosine = 0.5 * (1.0 + math.cos(math.pi * progress))
    return minimum + cosine * (peak - minimum)


def _set_learning_rate(optimizer: torch.optim.Optimizer, value: float) -> None:
    for group in optimizer.param_groups:
        group["lr"] = value


@torch.no_grad()
def evaluate(
    model: DecoderOnlyTransformer,
    stream: TokenStream,
    config: ExperimentConfig,
    *,
    device: torch.device,
    precision: str,
) -> float:
    model.eval()
    generator = torch.Generator(device="cpu").manual_seed(config.seed + 10_000)
    losses = []
    for _ in range(config.training.eval_batches):
        inputs, targets = sample_batch(
            stream,
            batch_size=config.training.micro_batch_size,
            context_length=config.model.context_length,
            generator=generator,
            device=device,
        )
        with autocast_context(device, precision):
            logits = model(inputs)
            loss = language_model_loss(logits, targets)
        losses.append(loss.float())
    model.train()
    return torch.stack(losses).mean().item()


def _checkpoint_payload(
    *,
    model: nn.Module,
    optimizer: torch.optim.Optimizer,
    scaler: Any,
    config: ExperimentConfig,
    step: int,
    best_validation: float,
    train_generator: torch.Generator,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "format_version": 1,
        "step": step,
        "best_validation": best_validation,
        "model": model.state_dict(),
        "optimizer": optimizer.state_dict(),
        "scaler": scaler.state_dict(),
        "config": config.as_serializable_dict(),
        "python_random_state": random.getstate(),
        "torch_random_state": torch.get_rng_state(),
        "train_generator_state": train_generator.get_state(),
    }
    if torch.cuda.is_available():
        payload["cuda_random_state_all"] = torch.cuda.get_rng_state_all()
    return payload


def _restore_checkpoint(
    payload: dict[str, Any],
    *,
    model: nn.Module,
    optimizer: torch.optim.Optimizer,
    scaler: Any,
    train_generator: torch.Generator,
    config: ExperimentConfig,
) -> tuple[int, float]:
    checkpoint_config = payload.get("config")
    if not isinstance(checkpoint_config, dict) or "model" not in checkpoint_config:
        raise ValueError("checkpoint does not contain a model configuration")
    current_model_config = config.as_serializable_dict()["model"]
    if checkpoint_config["model"] != current_model_config:
        raise ValueError(
            "checkpoint model configuration does not match the current [model] table"
        )
    model.load_state_dict(payload["model"])
    optimizer.load_state_dict(payload["optimizer"])
    for parameter_group in optimizer.param_groups:
        parameter_group["betas"] = (config.training.beta1, config.training.beta2)
        parameter_group["weight_decay"] = config.training.weight_decay
    if payload.get("scaler"):
        scaler.load_state_dict(payload["scaler"])
    if "python_random_state" in payload:
        random.setstate(payload["python_random_state"])
    if "torch_random_state" in payload:
        torch.set_rng_state(payload["torch_random_state"].cpu())
    if torch.cuda.is_available() and "cuda_random_state_all" in payload:
        torch.cuda.set_rng_state_all(payload["cuda_random_state_all"])
    if "train_generator_state" in payload:
        train_generator.set_state(payload["train_generator_state"].cpu())
    return int(payload["step"]), float(payload.get("best_validation", math.inf))


def _stop_requested(
    control: TrainingControl | None,
    observer: TrainingObserver | None,
    *,
    step: int,
) -> bool:
    """Pause only at safe optimizer boundaries and report a pending stop."""

    if control is None:
        return False
    state = control.state()
    if state == "paused":
        emit(observer, "status", state="paused", phase="paused", step=step)
        while control.state() == "paused":
            control.wait(0.25)
        state = control.state()
        if state == "running":
            emit(observer, "status", state="running", phase="training", step=step)
    if state == "stopping":
        emit(observer, "status", state="stopping", phase="checkpointing", step=step)
        return True
    return False


def train(
    config: ExperimentConfig,
    *,
    observer: TrainingObserver | None = None,
    control: TrainingControl | None = None,
) -> Path:
    """Train while guaranteeing that disk-backed token mappings are released."""

    opened_streams: list[TokenStream] = []
    try:
        return _run_training_complex(
            config,
            opened_streams,
            observer=observer,
            control=control,
        )
    except Exception as error:
        emit(
            observer,
            "status",
            state="failed",
            phase="failed",
            error=f"{type(error).__name__}: {error}",
        )
        raise
    finally:
        for stream in reversed(opened_streams):
            stream.close()


def _run_training_complex(
    config: ExperimentConfig,
    opened_streams: list[TokenStream],
    *,
    observer: TrainingObserver | None = None,
    control: TrainingControl | None = None,
) -> Path:
    """Train one decoder-only model and return the latest checkpoint path."""

    config.validate()
    device = resolve_device(config.training.device)
    precision = resolve_precision(config.training.precision, device)
    random.seed(config.seed)
    torch.manual_seed(config.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(config.seed)
    torch.use_deterministic_algorithms(config.training.deterministic, warn_only=True)
    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("high")

    # chamber:training-complex:start
    train_stream, validation_stream = build_token_streams(
        config.data, vocab_size=config.model.vocab_size
    )
    opened_streams.extend((train_stream, validation_stream))
    required_window_tokens = config.model.context_length + 1
    for split_name, stream in (
        ("train", train_stream),
        ("validation", validation_stream),
    ):
        if len(stream) < required_window_tokens:
            raise ValueError(
                f"{split_name} stream has {len(stream)} tokens; "
                f"context_length={config.model.context_length} requires at least "
                f"{required_window_tokens}"
            )
    model = DecoderOnlyTransformer(config.model).to(device)
    # chamber:adamw-state:start
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=config.training.learning_rate,
        betas=(config.training.beta1, config.training.beta2),
        weight_decay=config.training.weight_decay,
    )
    # chamber:adamw-state:end
    scaler = make_grad_scaler(enabled=precision == "fp16" and device.type == "cuda")
    train_generator = torch.Generator(device="cpu").manual_seed(config.seed + 1)
    # chamber:training-complex:end
    start_step, best_validation = 0, math.inf

    if config.training.resume is not None:
        payload = load_checkpoint(config.training.resume, map_location=device)
        start_step, best_validation = _restore_checkpoint(
            payload,
            model=model,
            optimizer=optimizer,
            scaler=scaler,
            train_generator=train_generator,
            config=config,
        )
        print(
            f"resumed {config.training.resume} at optimizer step {start_step}",
            flush=True,
        )
        emit(observer, "resumed", step=start_step, checkpoint=str(config.training.resume))
    if start_step >= config.training.max_steps:
        raise ValueError(
            f"checkpoint step {start_step} is not below max_steps {config.training.max_steps}"
        )

    output_dir = config.training.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    tokens_per_update = (
        config.training.micro_batch_size
        * config.model.context_length
        * config.training.gradient_accumulation_steps
    )
    approximate_updates_per_pass = math.ceil(
        max(1, len(train_stream) - 1) / tokens_per_update
    )
    parameter_count = model.parameter_count()
    print(
        f"device={device} precision={precision} parameters={model.parameter_count():,} "
        f"train_tokens={len(train_stream):,} tokens/update={tokens_per_update:,} "
        f"approx_updates/corpus_pass={approximate_updates_per_pass:,} "
        "sampling=random-with-replacement",
        flush=True,
    )
    emit(
        observer,
        "run_started",
        state="running",
        phase="training",
        step=start_step,
        max_steps=config.training.max_steps,
        device=str(device),
        precision=precision,
        parameters=parameter_count,
        train_tokens=len(train_stream),
        validation_tokens=len(validation_stream),
        tokens_per_update=tokens_per_update,
        approximate_updates_per_pass=approximate_updates_per_pass,
    )

    optimizer.zero_grad(set_to_none=True)
    model.train()
    latest_checkpoint: Path | None = None
    session_started = time.perf_counter()
    active_seconds = 0.0
    measured_steps = 0

    def write_checkpoint(step: int, *, kind: str, publish_best: bool = False) -> Path:
        checkpoint = save_checkpoint(
            output_dir,
            step,
            _checkpoint_payload(
                model=model,
                optimizer=optimizer,
                scaler=scaler,
                config=config,
                step=step,
                best_validation=best_validation,
                train_generator=train_generator,
            ),
        )
        if publish_best:
            publish_checkpoint_alias(checkpoint, output_dir / "best.pt")
        print(f"saved {checkpoint}", flush=True)
        emit(
            observer,
            "checkpoint_saved",
            step=step,
            path=str(checkpoint),
            latest_path=str(output_dir / "latest.pt"),
            best_path=str(output_dir / "best.pt") if publish_best else None,
            kind=kind,
        )
        return checkpoint

    if _stop_requested(control, observer, step=start_step):
        write_checkpoint(start_step, kind="stopped")
        emit(observer, "status", state="stopped", phase="stopped", step=start_step)
        return output_dir / "latest.pt"

    # chamber:full-training-loop:start
    for step in range(start_step, config.training.max_steps):
        _synchronize_device(device)
        started = time.perf_counter()
        learning_rate = learning_rate_for_step(
            step,
            peak=config.training.learning_rate,
            minimum=config.training.min_learning_rate,
            warmup_steps=config.training.warmup_steps,
            total_steps=config.training.max_steps,
        )
        _set_learning_rate(optimizer, learning_rate)
        accumulated_loss = 0.0

        for _ in range(config.training.gradient_accumulation_steps):
            inputs, targets = sample_batch(
                train_stream,
                batch_size=config.training.micro_batch_size,
                context_length=config.model.context_length,
                generator=train_generator,
                device=device,
            )
            with autocast_context(device, precision):
                logits = model(inputs)
                loss = language_model_loss(logits, targets)
                scaled_micro_loss = loss / config.training.gradient_accumulation_steps
            accumulated_loss += scaled_micro_loss.detach().float().item()

            # chamber:output-backprop:start
            # chamber:backprop-through-tower:start
            scaler.scale(scaled_micro_loss).backward()
            # chamber:backprop-through-tower:end
            # chamber:output-backprop:end

        if scaler.is_enabled():
            scaler.unscale_(optimizer)

        # chamber:parameter-matrix:start
        # loss.backward() populated .grad on every participating parameter matrix.
        if config.training.grad_clip > 0:
            gradient_norm = torch.nn.utils.clip_grad_norm_(
                model.parameters(), config.training.grad_clip
            )
        else:
            parameter_norms = [
                parameter.grad.detach().float().norm()
                for parameter in model.parameters()
                if parameter.grad is not None
            ]
            gradient_norm = torch.stack(parameter_norms).norm()
        if not scaler.is_enabled() and not torch.isfinite(gradient_norm):
            raise FloatingPointError("the global gradient norm is not finite")
        # chamber:parameter-matrix:end

        # chamber:weight-update:start
        scaler.step(optimizer)
        scaler.update()
        # chamber:weight-update:end

        # chamber:model-changed-next-step:start
        completed_step = step + 1
        optimizer.zero_grad(set_to_none=True)
        # chamber:model-changed-next-step:end

        _synchronize_device(device)
        step_seconds = time.perf_counter() - started
        active_seconds += step_seconds
        measured_steps += 1
        tokens_per_second = tokens_per_update / max(step_seconds, 1e-9)
        elapsed_seconds = time.perf_counter() - session_started
        average_active_seconds = active_seconds / measured_steps
        eta_seconds = average_active_seconds * (config.training.max_steps - completed_step)

        if completed_step % config.training.log_interval == 0 or completed_step == 1:
            print(
                f"step={completed_step} loss={accumulated_loss:.6f} "
                f"lr={learning_rate:.3e} grad_norm={float(gradient_norm):.4f} "
                f"seconds={step_seconds:.3f}",
                flush=True,
            )
            emit(
                observer,
                "train_metrics",
                state="running",
                phase="training",
                step=completed_step,
                max_steps=config.training.max_steps,
                progress=completed_step / config.training.max_steps,
                loss=accumulated_loss,
                learning_rate=learning_rate,
                gradient_norm=float(gradient_norm),
                step_seconds=step_seconds,
                elapsed_seconds=elapsed_seconds,
                eta_seconds=eta_seconds,
                tokens_per_second=tokens_per_second,
                tokens_processed=completed_step * tokens_per_update,
            )

        if _stop_requested(control, observer, step=completed_step):
            latest_checkpoint = write_checkpoint(completed_step, kind="stopped")
            emit(
                observer,
                "status",
                state="stopped",
                phase="stopped",
                step=completed_step,
            )
            return output_dir / "latest.pt"

        should_evaluate = (
            completed_step % config.training.eval_interval == 0
            or completed_step == config.training.max_steps
        )
        if should_evaluate:
            emit(
                observer,
                "status",
                state="running",
                phase="evaluating",
                step=completed_step,
            )
            evaluation_started = time.perf_counter()
            validation_loss = evaluate(
                model,
                validation_stream,
                config,
                device=device,
                precision=precision,
            )
            evaluation_seconds = time.perf_counter() - evaluation_started
            active_seconds += evaluation_seconds
            improved = validation_loss < best_validation
            if improved:
                best_validation = validation_loss
            print(
                f"validation step={completed_step} loss={validation_loss:.6f} "
                f"best={best_validation:.6f}",
                flush=True,
            )
            emit(
                observer,
                "validation_metrics",
                state="running",
                phase="evaluating",
                step=completed_step,
                loss=validation_loss,
                best_loss=best_validation,
                improved=improved,
                evaluation_seconds=evaluation_seconds,
            )
            if improved:
                latest_checkpoint = write_checkpoint(
                    completed_step,
                    kind="best",
                    publish_best=True,
                )

            if _stop_requested(control, observer, step=completed_step):
                latest_checkpoint = write_checkpoint(completed_step, kind="stopped")
                emit(
                    observer,
                    "status",
                    state="stopped",
                    phase="stopped",
                    step=completed_step,
                )
                return output_dir / "latest.pt"

        should_sample = (
            config.model.vocab_size >= VOCAB_SIZE
            and (
                completed_step % config.training.sample_interval == 0
                or completed_step == config.training.max_steps
            )
        )
        if should_sample:
            emit(
                observer,
                "status",
                state="running",
                phase="sampling",
                step=completed_step,
            )
            sample_started = time.perf_counter()
            sample = generate_text(
                model,
                config.training.sample_prompt,
                device=device,
                max_new_tokens=config.training.sample_max_new_tokens,
                temperature=config.training.sample_temperature,
                top_k=config.training.sample_top_k,
                seed=config.seed + 20_000,
            )
            active_seconds += time.perf_counter() - sample_started
            emit(observer, "sample", step=completed_step, **sample)

            if _stop_requested(control, observer, step=completed_step):
                latest_checkpoint = write_checkpoint(completed_step, kind="stopped")
                emit(
                    observer,
                    "status",
                    state="stopped",
                    phase="stopped",
                    step=completed_step,
                )
                return output_dir / "latest.pt"

        should_checkpoint = (
            completed_step % config.training.checkpoint_interval == 0
            or completed_step == config.training.max_steps
        )
        if should_checkpoint and (
            latest_checkpoint is None
            or latest_checkpoint.name != f"checkpoint_{completed_step:08d}.pt"
        ):
            latest_checkpoint = write_checkpoint(completed_step, kind="latest")

        if should_evaluate or should_sample:
            emit(
                observer,
                "status",
                state="running",
                phase="training",
                step=completed_step,
            )
    # chamber:full-training-loop:end

    assert latest_checkpoint is not None
    emit(
        observer,
        "status",
        state="completed",
        phase="completed",
        step=config.training.max_steps,
        checkpoint=str(output_dir / "latest.pt"),
    )
    return output_dir / "latest.pt"
