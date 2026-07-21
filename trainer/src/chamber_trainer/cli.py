"""Command-line entry points for corpus preparation and training."""

from __future__ import annotations

import argparse
import errno
from pathlib import Path
import sys
from typing import Sequence


TRAINER_ALREADY_RUNNING_EXIT_CODE = 73


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="chamber-trainer",
        description="Prepare byte-token corpora and train the chamber Transformer.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    prepare = commands.add_parser("prepare", help="write train.bin and val.bin")
    prepare.add_argument(
        "--input",
        nargs="+",
        type=Path,
        help="one or more .txt/.md files or directories",
    )
    prepare.add_argument("--output", required=True, type=Path, help="output directory")
    prepare.add_argument("--validation-fraction", type=float, default=0.05)
    prepare.add_argument("--seed", type=int, default=1337)
    prepare.add_argument(
        "--toy",
        action="store_true",
        help="write the deterministic built-in toy corpus instead of reading --input",
    )
    prepare.add_argument("--toy-repetitions", type=int, default=64)

    train = commands.add_parser("train", help="run single-device training")
    train.add_argument("--config", required=True, type=Path, help="experiment TOML file")
    train.add_argument("--resume", type=Path, help="checkpoint path override")
    train.add_argument("--device", help="device override, such as cpu, cuda, or cuda:0")
    train.add_argument("--precision", choices=("auto", "fp32", "bf16", "fp16"))
    train.add_argument("--max-steps", type=int, help="optimizer-step limit override")

    serve = commands.add_parser("serve", help="run the loopback-only local training companion")
    serve.add_argument(
        "--host",
        choices=("127.0.0.1", "localhost"),
        default="127.0.0.1",
        help="loopback interface (non-loopback binds are intentionally unsupported)",
    )
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument(
        "--runs-dir",
        type=Path,
        default=Path("runs/custom"),
        help="durable run records, events, corpora, and checkpoints",
    )
    return parser


def _prepare(args: argparse.Namespace, parser: argparse.ArgumentParser) -> int:
    from .corpus import prepare_corpus, prepare_toy_corpus

    if args.toy and args.input:
        parser.error("prepare accepts either --toy or --input, not both")
    if not args.toy and not args.input:
        parser.error("prepare requires --input unless --toy is selected")

    if args.toy:
        manifest = prepare_toy_corpus(args.output, repetitions=args.toy_repetitions)
    else:
        manifest = prepare_corpus(
            args.input,
            args.output,
            validation_fraction=args.validation_fraction,
            seed=args.seed,
        )
    train_info = manifest["train"]
    validation_info = manifest["validation"]
    print(
        f"prepared {args.output.resolve()} | "
        f"train_tokens={train_info['tokens']} validation_tokens={validation_info['tokens']}"
    )
    return 0


def _train(args: argparse.Namespace) -> int:
    from .config import ExperimentConfig
    from .engine import train

    config = ExperimentConfig.load(args.config)
    _apply_training_overrides(config, args)
    config.validate()
    latest = train(config)
    print(f"training complete; resumable checkpoint: {latest}")
    return 0


def _apply_training_overrides(config, args: argparse.Namespace) -> None:
    if args.resume is not None:
        config.training.resume = args.resume.expanduser().resolve()
    if args.device is not None:
        config.training.device = args.device
    if args.precision is not None:
        config.training.precision = args.precision
    if args.max_steps is not None:
        config.training.max_steps = args.max_steps
        config.training.warmup_steps = min(config.training.warmup_steps, args.max_steps)


def _serve(args: argparse.Namespace) -> int:
    from .service import serve

    try:
        serve(host=args.host, port=args.port, runs_dir=args.runs_dir)
    except OSError as error:
        address_unavailable = error.errno in {errno.EACCES, errno.EADDRINUSE} or getattr(
            error, "winerror", None
        ) in {10013, 10048}
        if not address_unavailable:
            raise
        print(
            f"Training Chamber cannot start another local trainer at "
            f"http://{args.host}:{args.port}; that address is already in use.\n"
            "If an `npm run dev:training` window is already open, keep that one "
            "open and use the Local URL it printed. Run the command only once.",
            file=sys.stderr,
            flush=True,
        )
        return TRAINER_ALREADY_RUNNING_EXIT_CODE
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.command == "prepare":
        return _prepare(args, parser)
    if args.command == "train":
        return _train(args)
    if args.command == "serve":
        return _serve(args)
    parser.error(f"unknown command {args.command}")
    return 2
