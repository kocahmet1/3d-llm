from __future__ import annotations

from dataclasses import asdict
from http.client import HTTPConnection
import json
from pathlib import Path
import tempfile
from threading import Thread
import unittest

try:
    import torch
except ImportError:
    torch = None

from chamber_trainer.service import (
    CompanionHTTPServer,
    RunManager,
    RunRecord,
    ServiceError,
    _validate_generation_request,
    _validate_run_request,
)


GENERATION_REQUEST = {
    "prompt": "Hi",
    "maxNewTokens": 16,
    "temperature": 0.8,
    "topK": 20,
    "seed": 42,
}


def training_request() -> dict[str, object]:
    return _validate_run_request(
        {
            "documents": [{"name": "notes.txt", "content": "training text " * 100}],
            "preset": "micro",
            "contextLength": 64,
            "effort": "quick",
            "device": "cpu",
            "samplePrompt": "The",
        }
    )


class GenerationValidationTests(unittest.TestCase):
    def test_accepts_exact_contract_and_normalizes_temperature(self) -> None:
        value = _validate_generation_request(GENERATION_REQUEST)
        self.assertEqual(value["prompt"], "Hi")
        self.assertEqual(value["max_new_tokens"], 16)
        self.assertEqual(value["temperature"], 0.8)
        self.assertEqual(value["top_k"], 20)
        self.assertEqual(value["seed"], 42)

    def test_rejects_missing_unknown_boolean_and_out_of_range_fields(self) -> None:
        invalid_payloads = [
            {key: value for key, value in GENERATION_REQUEST.items() if key != "seed"},
            {**GENERATION_REQUEST, "extra": True},
            {**GENERATION_REQUEST, "maxNewTokens": True},
            {**GENERATION_REQUEST, "maxNewTokens": 15},
            {**GENERATION_REQUEST, "temperature": float("nan")},
            {**GENERATION_REQUEST, "temperature": 1.6},
            {**GENERATION_REQUEST, "topK": 258},
            {**GENERATION_REQUEST, "seed": -1},
            {**GENERATION_REQUEST, "prompt": " "},
            {**GENERATION_REQUEST, "prompt": "x" * 2_049},
        ]
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                with self.assertRaises(ServiceError) as raised:
                    _validate_generation_request(payload)
                self.assertEqual(raised.exception.status, 400)


@unittest.skipIf(torch is None, "PyTorch is not installed")
class CheckpointInferenceTests(unittest.TestCase):
    def _write_checkpoint(self, path: Path, *, step: int, context_length: int = 32) -> None:
        from chamber_trainer.config import ModelConfig
        from chamber_trainer.model import DecoderOnlyTransformer

        model_config = ModelConfig(
            vocab_size=257,
            context_length=context_length,
            d_model=8,
            n_heads=2,
            n_layers=1,
            dropout=0.0,
        )
        torch.manual_seed(step)
        model = DecoderOnlyTransformer(model_config)
        path.parent.mkdir(parents=True, exist_ok=True)
        torch.save(
            {
                "format_version": 1,
                "step": step,
                "model": model.state_dict(),
                "config": {"model": asdict(model_config)},
            },
            path,
        )

    def _manager_with_terminal_run(
        self, root: Path, *, status: str = "completed"
    ) -> tuple[RunManager, RunRecord]:
        manager = RunManager(root)
        run_id = "b" * 32
        record = RunRecord.create(run_id, root / run_id, training_request())
        record.emit({"type": "status", "state": status, "phase": status, "step": 12})
        manager.runs[run_id] = record
        manager.current_id = run_id
        return manager, record

    def test_prefers_best_checkpoint_and_returns_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager, record = self._manager_with_terminal_run(Path(temporary))
            self._write_checkpoint(record.run_dir / "checkpoints" / "best.pt", step=11)
            self._write_checkpoint(record.run_dir / "checkpoints" / "latest.pt", step=12)

            first = manager.generate(record.run_id, GENERATION_REQUEST)
            second = manager.generate(record.run_id, GENERATION_REQUEST)

            self.assertEqual(first["runId"], record.run_id)
            self.assertEqual(first["checkpoint"], "best.pt")
            self.assertEqual(first["checkpointKind"], "best")
            self.assertEqual(first["checkpointStep"], 11)
            self.assertEqual(first["device"], "cpu")
            self.assertEqual(first["contextLength"], 32)
            self.assertEqual(first["seed"], 42)
            self.assertEqual(first["temperature"], 0.8)
            self.assertEqual(first["topK"], 20)
            self.assertEqual(first["text"], second["text"])
            self.assertGreaterEqual(first["elapsedSeconds"], 0.0)

    def test_falls_back_to_latest_and_rejects_prompt_beyond_byte_context(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager, record = self._manager_with_terminal_run(
                Path(temporary), status="stopped"
            )
            latest = record.run_dir / "checkpoints" / "latest.pt"
            self._write_checkpoint(latest, step=9, context_length=4)

            request = {**GENERATION_REQUEST, "prompt": "ééé"}
            with self.assertRaises(ServiceError) as raised:
                manager.generate(record.run_id, request)
            self.assertEqual(raised.exception.status, 400)
            self.assertIn("6 UTF-8 byte tokens", raised.exception.message)
            self.assertIn("context length is 4", raised.exception.message)

            valid = manager.generate(record.run_id, {**GENERATION_REQUEST, "prompt": "test"})
            self.assertEqual(valid["checkpoint"], "latest.pt")
            self.assertEqual(valid["checkpointKind"], "latest")
            self.assertEqual(valid["checkpointStep"], 9)

    def test_rejects_active_missing_checkpoint_and_concurrent_compute(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manager, record = self._manager_with_terminal_run(root, status="training")
            with self.assertRaises(ServiceError) as active:
                manager.generate(record.run_id, GENERATION_REQUEST)
            self.assertEqual(active.exception.status, 409)

            record.emit({"type": "status", "state": "completed", "phase": "completed"})
            with self.assertRaises(ServiceError) as missing:
                manager.generate(record.run_id, GENERATION_REQUEST)
            self.assertEqual(missing.exception.status, 409)

            self._write_checkpoint(record.run_dir / "checkpoints" / "latest.pt", step=3)
            manager.compute_lock.acquire()
            try:
                with self.assertRaises(ServiceError) as busy:
                    manager.generate(record.run_id, GENERATION_REQUEST)
                self.assertEqual(busy.exception.status, 409)
                self.assertIn("busy", busy.exception.message)
            finally:
                manager.compute_lock.release()

    def test_http_generate_endpoint_returns_checkpoint_sample(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager, record = self._manager_with_terminal_run(Path(temporary))
            self._write_checkpoint(record.run_dir / "checkpoints" / "best.pt", step=7)
            server = CompanionHTTPServer(("127.0.0.1", 0), manager)
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=15)
            try:
                body = json.dumps(GENERATION_REQUEST).encode("utf-8")
                connection.request(
                    "POST",
                    f"/runs/{record.run_id}/generate",
                    body=body,
                    headers={"Content-Type": "application/json"},
                )
                response = connection.getresponse()
                payload = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertEqual(payload["checkpoint"], "best.pt")
                self.assertEqual(payload["checkpointKind"], "best")
                self.assertEqual(payload["checkpointStep"], 7)
                self.assertEqual(payload["prompt"], "Hi")
                self.assertIn("completion", payload)
            finally:
                connection.close()
                server.shutdown()
                server.server_close()
                thread.join(5)


if __name__ == "__main__":
    unittest.main()
