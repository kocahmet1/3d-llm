from __future__ import annotations

import argparse
from contextlib import redirect_stderr
import errno
import io
from pathlib import Path
import unittest
from unittest.mock import patch

from chamber_trainer.cli import (
    TRAINER_ALREADY_RUNNING_EXIT_CODE,
    _apply_training_overrides,
    _serve,
)
from chamber_trainer.config import ExperimentConfig


class ConfigAndCliTests(unittest.TestCase):
    def test_serve_reports_an_existing_trainer_without_a_traceback(self) -> None:
        args = argparse.Namespace(
            host="127.0.0.1",
            port=8765,
            runs_dir=Path("runs/custom"),
        )
        output = io.StringIO()
        with (
            patch(
                "chamber_trainer.service.serve",
                side_effect=OSError(errno.EADDRINUSE, "Address already in use"),
            ),
            redirect_stderr(output),
        ):
            exit_code = _serve(args)

        self.assertEqual(exit_code, TRAINER_ALREADY_RUNNING_EXIT_CODE)
        self.assertIn("cannot start another local trainer", output.getvalue())
        self.assertIn("Run the command only once", output.getvalue())
        self.assertIn("Local URL", output.getvalue())

    def test_short_max_steps_override_clamps_warmup(self) -> None:
        config_path = Path(__file__).parents[1] / "configs" / "local.toml"
        config = ExperimentConfig.load(config_path)
        args = argparse.Namespace(
            resume=None,
            device="cpu",
            precision=None,
            max_steps=2,
        )
        _apply_training_overrides(config, args)
        config.validate()
        self.assertEqual(config.training.max_steps, 2)
        self.assertEqual(config.training.warmup_steps, 2)


if __name__ == "__main__":
    unittest.main()
