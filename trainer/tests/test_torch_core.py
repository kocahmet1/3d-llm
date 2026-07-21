from __future__ import annotations

import copy
from pathlib import Path
import tempfile
import unittest
from unittest import mock

try:
    import torch
except ImportError:
    torch = None


@unittest.skipIf(torch is None, "PyTorch is not installed")
class TorchCoreTests(unittest.TestCase):
    def test_batch_shift_and_visual_synthetic_pattern(self) -> None:
        from chamber_trainer.data import sample_batch, synthetic_token_stream

        stream = synthetic_token_stream(128, split="train", vocab_size=16)
        self.assertEqual(stream[:7].tolist(), [1, 3, 4, 5, 6, 3, 7])
        generator = torch.Generator(device="cpu").manual_seed(3)
        inputs, targets = sample_batch(
            stream,
            batch_size=2,
            context_length=6,
            generator=generator,
            device=torch.device("cpu"),
        )
        self.assertEqual(tuple(inputs.shape), (2, 6))
        self.assertTrue(torch.equal(inputs[:, 1:], targets[:, :-1]))

    def test_model_shape_causality_and_backward(self) -> None:
        from chamber_trainer.config import ModelConfig
        from chamber_trainer.model import DecoderOnlyTransformer, language_model_loss

        torch.manual_seed(11)
        config = ModelConfig(
            vocab_size=16,
            context_length=6,
            d_model=8,
            n_heads=2,
            n_layers=2,
            mlp_ratio=4,
            dropout=0.0,
        )
        model = DecoderOnlyTransformer(config).eval()
        first = torch.tensor([[1, 3, 4, 5, 6, 3]])
        second = first.clone()
        second[0, -1] = 14
        logits_first = model(first)
        logits_second = model(second)
        self.assertEqual(tuple(logits_first.shape), (1, 6, 16))
        self.assertTrue(torch.allclose(logits_first[:, :-1], logits_second[:, :-1], atol=1e-6))

        targets = torch.tensor([[3, 4, 5, 6, 3, 7]])
        loss = language_model_loss(logits_first, targets)
        loss.backward()
        gradient = model.blocks[0].attention.q_proj.weight.grad
        self.assertIsNotNone(gradient)
        self.assertTrue(torch.isfinite(gradient).all())

    def test_token_bin_is_disk_backed(self) -> None:
        from chamber_trainer.corpus import prepare_toy_corpus
        from chamber_trainer.data import TokenBin

        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            manifest = prepare_toy_corpus(output, repetitions=2)
            with TokenBin(output / "train.bin") as stream:
                self.assertEqual(len(stream), manifest["train"]["tokens"])
                self.assertEqual(stream[:4].dtype, torch.int32)

    def test_short_split_fails_early_and_releases_both_mmaps(self) -> None:
        from chamber_trainer.config import (
            DataConfig,
            ExperimentConfig,
            ModelConfig,
            TrainingConfig,
        )
        from chamber_trainer.corpus import Int32TokenWriter
        from chamber_trainer.engine import train

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            train_path, val_path = root / "train.bin", root / "val.bin"
            with Int32TokenWriter(train_path) as writer:
                writer.write(range(16))
            with Int32TokenWriter(val_path) as writer:
                writer.write([1, 2])
            config = ExperimentConfig(
                seed=1,
                data=DataConfig(source="bin", train_bin=train_path, val_bin=val_path),
                model=ModelConfig(
                    vocab_size=257,
                    context_length=6,
                    d_model=8,
                    n_heads=2,
                    n_layers=1,
                ),
                training=TrainingConfig(
                    output_dir=root / "run",
                    device="cpu",
                    precision="fp32",
                    micro_batch_size=1,
                    max_steps=1,
                    warmup_steps=0,
                    eval_interval=1,
                    eval_batches=1,
                    checkpoint_interval=1,
                    log_interval=1,
                ),
            )
            with self.assertRaisesRegex(ValueError, "validation stream"):
                train(config)
            train_path.unlink()
            val_path.unlink()

    def test_resume_validates_model_and_reapplies_current_adamw_settings(self) -> None:
        from chamber_trainer.config import (
            DataConfig,
            ExperimentConfig,
            ModelConfig,
            TrainingConfig,
        )
        from chamber_trainer.engine import _restore_checkpoint
        from chamber_trainer.model import DecoderOnlyTransformer

        model_config = ModelConfig(
            vocab_size=16,
            context_length=6,
            d_model=8,
            n_heads=2,
            n_layers=1,
        )
        config = ExperimentConfig(
            seed=5,
            data=DataConfig(source="synthetic"),
            model=model_config,
            training=TrainingConfig(beta1=0.8, beta2=0.88, weight_decay=0.02),
        )
        model = DecoderOnlyTransformer(model_config)
        loaded_optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
        checkpoint_optimizer = torch.optim.AdamW(
            model.parameters(), lr=7e-4, betas=(0.1, 0.2), weight_decay=0.9
        )
        payload = {
            "step": 3,
            "best_validation": 1.5,
            "model": model.state_dict(),
            "optimizer": checkpoint_optimizer.state_dict(),
            "scaler": {},
            "config": config.as_serializable_dict(),
        }
        generator = torch.Generator(device="cpu").manual_seed(5)
        step, best = _restore_checkpoint(
            payload,
            model=model,
            optimizer=loaded_optimizer,
            scaler=object(),
            train_generator=generator,
            config=config,
        )
        self.assertEqual((step, best), (3, 1.5))
        self.assertEqual(loaded_optimizer.param_groups[0]["betas"], (0.8, 0.88))
        self.assertEqual(loaded_optimizer.param_groups[0]["weight_decay"], 0.02)

        incompatible = copy.deepcopy(payload)
        incompatible["config"]["model"]["n_layers"] = 2
        with self.assertRaisesRegex(ValueError, "model configuration"):
            _restore_checkpoint(
                incompatible,
                model=model,
                optimizer=loaded_optimizer,
                scaler=object(),
                train_generator=generator,
                config=config,
            )


@unittest.skipIf(torch is None, "PyTorch is not installed")
class ScheduleTests(unittest.TestCase):
    def test_warmup_and_cosine_bounds(self) -> None:
        from chamber_trainer.engine import learning_rate_for_step

        values = [
            learning_rate_for_step(
                step,
                peak=1.0,
                minimum=0.1,
                warmup_steps=2,
                total_steps=10,
            )
            for step in range(10)
        ]
        self.assertEqual(values[0], 0.5)
        self.assertEqual(values[1], 1.0)
        self.assertEqual(values[2], 1.0)
        self.assertEqual(values[-1], 0.1)
        self.assertTrue(all(0.1 <= value <= 1.0 for value in values))
        one_step = learning_rate_for_step(
            0, peak=1.0, minimum=0.1, warmup_steps=0, total_steps=1
        )
        self.assertEqual(one_step, 1.0)
        final_after_warmup = learning_rate_for_step(
            1, peak=1.0, minimum=0.1, warmup_steps=1, total_steps=2
        )
        self.assertEqual(final_after_warmup, 0.1)

    def test_explicit_unavailable_accelerators_fail_early(self) -> None:
        from chamber_trainer.engine import resolve_device, resolve_precision

        if not torch.backends.mps.is_available():
            with self.assertRaisesRegex(RuntimeError, "MPS"):
                resolve_device("mps")
        with mock.patch.object(torch.cuda, "is_bf16_supported", return_value=False):
            with self.assertRaisesRegex(ValueError, "does not support"):
                resolve_precision("bf16", torch.device("cuda"))


if __name__ == "__main__":
    unittest.main()
