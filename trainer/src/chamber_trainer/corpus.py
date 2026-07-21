"""Stream text and Markdown documents into int32 byte-token files."""

from __future__ import annotations

from array import array
from collections.abc import Iterable, Iterator
import json
import os
from pathlib import Path
import random
import sys
from typing import BinaryIO

from .tokenizer import ByteTokenizer, EOS_ID, VOCAB_SIZE


SUPPORTED_SUFFIXES = {".txt", ".md"}
READ_CHUNK_BYTES = 1024 * 1024


class Int32TokenWriter:
    """Atomically write native token IDs in a documented little-endian format."""

    def __init__(self, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        self.destination = destination
        self.temporary = destination.with_name(f".{destination.name}.tmp")
        self.handle: BinaryIO = self.temporary.open("wb")
        self.count = 0

    def write(self, token_ids: Iterable[int]) -> None:
        values = array("i")
        values.extend(token_ids)
        if values.itemsize != 4:
            raise RuntimeError("this platform does not provide four-byte C int arrays")
        if sys.byteorder != "little":
            values.byteswap()
        values.tofile(self.handle)
        self.count += len(values)

    def close(self) -> int:
        if self.handle.closed:
            return self.count
        self.handle.flush()
        os.fsync(self.handle.fileno())
        self.handle.close()
        os.replace(self.temporary, self.destination)
        return self.count

    def abort(self) -> None:
        if not self.handle.closed:
            self.handle.close()
        self.temporary.unlink(missing_ok=True)

    def __enter__(self) -> "Int32TokenWriter":
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        if exc_type is None:
            self.close()
        else:
            self.abort()


def discover_documents(inputs: Iterable[str | Path]) -> list[Path]:
    documents: set[Path] = set()
    for raw_path in inputs:
        path = Path(raw_path).expanduser().resolve()
        if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES and path.stat().st_size > 0:
            documents.add(path)
        elif path.is_dir():
            for candidate in path.rglob("*"):
                if (
                    candidate.is_file()
                    and candidate.suffix.lower() in SUPPORTED_SUFFIXES
                    and candidate.stat().st_size > 0
                ):
                    documents.add(candidate.resolve())
        elif not path.exists():
            raise FileNotFoundError(path)
    return sorted(documents, key=lambda item: item.as_posix().casefold())


def _byte_chunks(path: Path, *, start: int = 0, stop: int | None = None) -> Iterator[bytes]:
    with path.open("rb") as handle:
        handle.seek(start)
        remaining = None if stop is None else max(0, stop - start)
        while remaining is None or remaining > 0:
            size = READ_CHUNK_BYTES if remaining is None else min(READ_CHUNK_BYTES, remaining)
            chunk = handle.read(size)
            if not chunk:
                return
            yield chunk
            if remaining is not None:
                remaining -= len(chunk)


# chamber:corpus-data-preparation:start
def _write_documents(writer: Int32TokenWriter, documents: Iterable[Path]) -> int:
    count = 0
    for path in documents:
        for chunk in _byte_chunks(path):
            writer.write(chunk)
        writer.write([EOS_ID])
        count += 1
    return count
# chamber:corpus-data-preparation:end


def prepare_corpus(
    inputs: Iterable[str | Path],
    output_dir: str | Path,
    *,
    validation_fraction: float = 0.05,
    seed: int = 1337,
) -> dict[str, object]:
    """Tokenize `.txt`/`.md` files into disk-backed train and validation bins."""

    if not 0.0 < validation_fraction < 1.0:
        raise ValueError("validation_fraction must be strictly between 0 and 1")
    documents = discover_documents(inputs)
    if not documents:
        raise ValueError("no non-empty .txt or .md documents were found")

    output = Path(output_dir).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    train_path, val_path = output / "train.bin", output / "val.bin"

    rng = random.Random(seed)
    shuffled = documents.copy()
    rng.shuffle(shuffled)

    if len(shuffled) == 1:
        only = shuffled[0]
        size = only.stat().st_size
        if size < 2:
            raise ValueError("a one-file corpus needs at least two bytes for a train/validation split")
        split_at = min(size - 1, max(1, round(size * (1.0 - validation_fraction))))
        with Int32TokenWriter(train_path) as train_writer:
            for chunk in _byte_chunks(only, stop=split_at):
                train_writer.write(chunk)
            train_writer.write([ByteTokenizer.eos_id])
        with Int32TokenWriter(val_path) as val_writer:
            for chunk in _byte_chunks(only, start=split_at):
                val_writer.write(chunk)
            val_writer.write([ByteTokenizer.eos_id])
        train_documents = val_documents = 1
        train_tokens, val_tokens = train_writer.count, val_writer.count
    else:
        validation_count = max(1, round(len(shuffled) * validation_fraction))
        validation_count = min(validation_count, len(shuffled) - 1)
        validation_docs = shuffled[:validation_count]
        training_docs = shuffled[validation_count:]
        with Int32TokenWriter(train_path) as train_writer:
            train_documents = _write_documents(train_writer, training_docs)
        with Int32TokenWriter(val_path) as val_writer:
            val_documents = _write_documents(val_writer, validation_docs)
        train_tokens, val_tokens = train_writer.count, val_writer.count

    manifest: dict[str, object] = {
        "format": "little-endian-int32",
        "tokenizer": "byte-level+eos",
        "vocab_size": VOCAB_SIZE,
        "eos_id": EOS_ID,
        "seed": seed,
        "validation_fraction": validation_fraction,
        "train": {"path": "train.bin", "tokens": train_tokens, "documents": train_documents},
        "validation": {"path": "val.bin", "tokens": val_tokens, "documents": val_documents},
    }
    manifest_path = output / "manifest.json"
    temporary_manifest = output / ".manifest.json.tmp"
    temporary_manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary_manifest, manifest_path)
    return manifest


def prepare_toy_corpus(output_dir: str | Path, *, repetitions: int = 64) -> dict[str, object]:
    """Write a deterministic, learnable corpus through the same int32 format."""

    if repetitions < 1:
        raise ValueError("repetitions must be positive")
    tokenizer = ByteTokenizer()
    output = Path(output_dir).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    train_text = "The tiny model reads bytes, predicts the next byte, and learns.\n"
    val_text = "The tiny model predicts a byte it has not yet seen.\n"

    with Int32TokenWriter(output / "train.bin") as train_writer:
        for _ in range(repetitions):
            train_writer.write(tokenizer.encode(train_text, add_eos=True))
    with Int32TokenWriter(output / "val.bin") as val_writer:
        for _ in range(max(1, repetitions // 8)):
            val_writer.write(tokenizer.encode(val_text, add_eos=True))

    manifest: dict[str, object] = {
        "format": "little-endian-int32",
        "tokenizer": "byte-level+eos",
        "vocab_size": VOCAB_SIZE,
        "eos_id": EOS_ID,
        "seed": 0,
        "train": {"path": "train.bin", "tokens": train_writer.count, "documents": repetitions},
        "validation": {
            "path": "val.bin",
            "tokens": val_writer.count,
            "documents": max(1, repetitions // 8),
        },
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest
