"""Disk-backed and deterministic token streams plus causal batch sampling."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

import torch

from .config import DataConfig


class TokenStream(Protocol):
    def __len__(self) -> int: ...

    def __getitem__(self, item: slice) -> torch.Tensor: ...

    def close(self) -> None: ...


class TokenBin:
    """Memory-map a little-endian int32 token file without loading it all."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        if not self.path.is_file():
            raise FileNotFoundError(self.path)
        byte_count = self.path.stat().st_size
        if byte_count % 4:
            raise ValueError(f"{self.path} is not an aligned int32 token file")
        self.token_count = byte_count // 4
        if self.token_count < 2:
            raise ValueError(f"{self.path} contains fewer than two tokens")
        self.tokens: torch.Tensor | None = torch.from_file(
            str(self.path), shared=False, size=self.token_count, dtype=torch.int32
        )

    def __len__(self) -> int:
        return self.token_count

    def __getitem__(self, item: slice) -> torch.Tensor:
        if self.tokens is None:
            raise RuntimeError(f"token mapping for {self.path} is closed")
        return self.tokens[item]

    def close(self) -> None:
        """Release the mmap promptly, which is required before deletion on Windows."""

        self.tokens = None

    def __enter__(self) -> "TokenBin":
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.close()


class InMemoryTokenStream:
    def __init__(self, tokens: torch.Tensor) -> None:
        if tokens.ndim != 1 or len(tokens) < 2:
            raise ValueError("a token stream must be one-dimensional with at least two tokens")
        self.tokens = tokens.to(dtype=torch.int32, device="cpu")

    def __len__(self) -> int:
        return self.tokens.numel()

    def __getitem__(self, item: slice) -> torch.Tensor:
        return self.tokens[item]

    def close(self) -> None:
        return None


def synthetic_token_stream(
    length: int, *, split: str, vocab_size: int
) -> InMemoryTokenStream:
    """Repeat the exhibit's two source rows without reading corpus files."""

    visual_rows = (
        [1, 3, 4, 5, 6, 3, 7],
        [1, 8, 9, 10, 11, 12, 2],
    )
    if vocab_size >= 13:
        rows = visual_rows if split == "train" else tuple(reversed(visual_rows))
        pattern = [token for row in rows for token in row]
    else:
        pattern = list(range(vocab_size))
    repetitions = (length + len(pattern) - 1) // len(pattern)
    tokens = torch.tensor((pattern * repetitions)[:length], dtype=torch.int32)
    return InMemoryTokenStream(tokens)


def build_token_streams(
    config: DataConfig, *, vocab_size: int
) -> tuple[TokenStream, TokenStream]:
    if config.source == "synthetic":
        return (
            synthetic_token_stream(
                config.synthetic_train_tokens, split="train", vocab_size=vocab_size
            ),
            synthetic_token_stream(
                config.synthetic_val_tokens, split="validation", vocab_size=vocab_size
            ),
        )
    assert config.train_bin is not None and config.val_bin is not None
    return TokenBin(config.train_bin), TokenBin(config.val_bin)


def sample_batch(
    stream: TokenStream,
    *,
    batch_size: int,
    context_length: int,
    generator: torch.Generator,
    device: torch.device,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Sample source windows and explicitly split inputs from next-token labels."""

    source_length = context_length + 1
    if len(stream) < source_length:
        raise ValueError(
            f"token stream has {len(stream)} tokens but a batch window needs {source_length}"
        )
    highest_start = len(stream) - source_length
    starts = torch.randint(
        0, highest_start + 1, (batch_size,), generator=generator, device="cpu"
    )

    # chamber:token-stream-context:start
    source_windows = torch.stack(
        [stream[start : start + source_length] for start in starts.tolist()]
    ).to(dtype=torch.long)
    # chamber:token-stream-context:end

    # chamber:batch-shifted-targets:start
    input_ids = source_windows[:, :-1].contiguous()
    targets = source_windows[:, 1:].contiguous()
    # chamber:batch-shifted-targets:end
    return (
        input_ids.to(device=device, non_blocking=device.type == "cuda"),
        targets.to(device=device, non_blocking=device.type == "cuda"),
    )
