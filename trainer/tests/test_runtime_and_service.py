from __future__ import annotations

import errno
from pathlib import Path
from http.client import HTTPConnection
import json
import tempfile
from threading import Event, Thread, Timer
import time
import unittest
from unittest.mock import patch

try:
    import torch
except ImportError:
    torch = None

from chamber_trainer.runtime import TrainingController
import chamber_trainer.service as service_module
from chamber_trainer.service import (
    CompanionHTTPServer,
    RunManager,
    RunRecord,
    ServiceError,
    _atomic_json,
    _config_for_request,
    _validate_run_request,
)


def valid_request() -> dict[str, object]:
    return {
        "documents": [{"name": "notes.txt", "content": "small corpus " * 100}],
        "preset": "micro",
        "contextLength": 32,
        "effort": "quick",
        "device": "cpu",
        "samplePrompt": "small",
    }


def interrupted_run(
    root: Path,
    *,
    run_id: str = "b" * 32,
    checkpoint_step: int = 5,
    observed_step: int = 7,
) -> tuple[str, object]:
    if torch is None:
        raise RuntimeError("PyTorch is required to create a checkpoint fixture")
    from chamber_trainer.checkpoint import publish_checkpoint_alias

    request = _validate_run_request(valid_request())
    run_dir = root / run_id
    record = RunRecord.create(run_id, run_dir, request)
    train_tokens, validation_tokens = 1_000, 256
    config = _config_for_request(
        request,
        run_dir=run_dir,
        train_tokens=train_tokens,
        validation_tokens=validation_tokens,
    )
    data_dir = run_dir / "data"
    data_dir.mkdir(parents=True)
    (data_dir / "train.bin").write_bytes(b"\0\0\0\0" * train_tokens)
    (data_dir / "val.bin").write_bytes(b"\0\0\0\0" * validation_tokens)
    _atomic_json(
        data_dir / "manifest.json",
        {
            "format": "little-endian-int32",
            "tokenizer": "byte-level+eos",
            "vocab_size": config.model.vocab_size,
            "train": {"path": "train.bin", "tokens": train_tokens, "documents": 1},
            "validation": {
                "path": "val.bin",
                "tokens": validation_tokens,
                "documents": 1,
            },
        },
    )
    _atomic_json(run_dir / "config.json", config.as_serializable_dict())
    checkpoint_dir = run_dir / "checkpoints"
    checkpoint_dir.mkdir()
    numbered = checkpoint_dir / f"checkpoint_{checkpoint_step:08d}.pt"
    torch.save(
        {
            "format_version": 1,
            "step": checkpoint_step,
            "best_validation": 2.25,
            "model": {},
            "optimizer": {},
            "scaler": {},
            "config": config.as_serializable_dict(),
        },
        numbered,
    )
    publish_checkpoint_alias(numbered, checkpoint_dir / "latest.pt")

    with record.lock:
        record.snapshot_data.update(
            {
                "status": "failed",
                "phase": "interrupted",
                "step": observed_step,
                "maxSteps": config.training.max_steps,
                "progress": observed_step / config.training.max_steps,
                "elapsedSeconds": 100.0,
                "error": "The local companion stopped before this run finished.",
                "metrics": [
                    {
                        "step": checkpoint_step,
                        "loss": 2.4,
                        "validationLoss": 2.25,
                    },
                    {
                        "step": observed_step,
                        "loss": 2.3,
                        "validationLoss": None,
                    },
                ],
                "samples": [
                    {"step": checkpoint_step, "prompt": "x", "text": "x"},
                    {"step": observed_step, "prompt": "x", "text": "y"},
                ],
                "checkpoints": [
                    {
                        "step": checkpoint_step,
                        "kind": "best",
                        "name": numbered.name,
                        "path": str(numbered),
                    }
                ],
                "checkpoint": str(checkpoint_dir / "latest.pt"),
            }
        )
        record._persist_locked(required=True)
    return run_id, config


class RuntimeControlTests(unittest.TestCase):
    def test_controller_transitions_are_terminal_after_stop(self) -> None:
        controller = TrainingController()
        self.assertEqual(controller.state(), "running")
        self.assertTrue(controller.pause())
        self.assertEqual(controller.state(), "paused")
        self.assertTrue(controller.resume())
        self.assertTrue(controller.stop())
        self.assertEqual(controller.state(), "stopping")
        self.assertFalse(controller.pause())
        self.assertFalse(controller.resume())


class ServiceConfigurationTests(unittest.TestCase):
    def test_atomic_json_retries_a_transient_windows_replace_denial(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "status.json"
            real_replace = service_module.os.replace
            attempts = 0

            def replace_after_two_denials(source: object, target: object) -> None:
                nonlocal attempts
                attempts += 1
                if attempts <= 2:
                    raise PermissionError(13, "Access denied")
                real_replace(source, target)

            with (
                patch.object(
                    service_module.os,
                    "replace",
                    side_effect=replace_after_two_denials,
                ),
                patch.object(service_module.time, "sleep") as mocked_sleep,
            ):
                _atomic_json(destination, {"step": 21, "status": "training"})

            self.assertEqual(attempts, 3)
            self.assertEqual(mocked_sleep.call_count, 2)
            self.assertEqual(
                json.loads(destination.read_text(encoding="utf-8")),
                {"step": 21, "status": "training"},
            )
            self.assertEqual(list(destination.parent.glob(".status.json.*.tmp")), [])

    def test_status_persistence_failure_does_not_abort_event_processing(self) -> None:
        request = _validate_run_request(valid_request())
        with tempfile.TemporaryDirectory() as temporary:
            run_dir = Path(temporary) / ("f" * 32)
            record = RunRecord.create("f" * 32, run_dir, request)

            with patch(
                "chamber_trainer.service._atomic_json",
                side_effect=PermissionError(13, "Access denied"),
            ):
                record.emit(
                    {
                        "type": "status",
                        "state": "running",
                        "phase": "training",
                        "step": 21,
                    }
                )

            degraded = record.snapshot()
            self.assertEqual(degraded["status"], "training")
            self.assertEqual(degraded["step"], 21)
            self.assertEqual(degraded["persistenceWarning"]["failures"], 1)
            self.assertTrue(
                any(
                    entry["level"] == "warning"
                    and "Training is continuing" in entry["message"]
                    for entry in degraded["logs"]
                )
            )

            record.emit(
                {
                    "type": "status",
                    "state": "running",
                    "phase": "training",
                    "step": 22,
                }
            )
            recovered = record.snapshot()
            durable = json.loads(
                (run_dir / "status.json").read_text(encoding="utf-8")
            )
            self.assertNotIn("persistenceWarning", recovered)
            self.assertEqual(durable["status"], "training")
            self.assertEqual(durable["step"], 22)

    def test_request_contract_and_derived_config(self) -> None:
        request = _validate_run_request(valid_request())
        with tempfile.TemporaryDirectory() as temporary:
            run_dir = Path(temporary)
            config = _config_for_request(
                request,
                run_dir=run_dir,
                train_tokens=10_000,
                validation_tokens=1_000,
            )
        self.assertEqual(config.model.context_length, 32)
        self.assertEqual(config.model.d_model, 64)
        self.assertEqual(config.training.device, "cpu")
        self.assertGreaterEqual(config.training.max_steps, 20)
        self.assertEqual(config.training.sample_prompt, "small")

        local_payload = valid_request()
        local_payload.update(
            {"preset": "local", "contextLength": 256, "effort": "balanced"}
        )
        local_request = _validate_run_request(local_payload)
        with tempfile.TemporaryDirectory() as temporary:
            local_config = _config_for_request(
                local_request,
                run_dir=Path(temporary),
                train_tokens=100_000,
                validation_tokens=10_000,
            )
        self.assertEqual(
            (local_config.model.d_model, local_config.model.n_heads, local_config.model.n_layers),
            (256, 8, 6),
        )
        self.assertFalse(local_config.model.tie_embeddings)

    def test_request_rejects_foreign_settings_and_tiny_splits(self) -> None:
        payload = valid_request()
        payload["device"] = "remote"
        with self.assertRaises(ServiceError):
            _validate_run_request(payload)

        request = _validate_run_request(valid_request())
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, "each contain at least"):
                _config_for_request(
                    request,
                    run_dir=Path(temporary),
                    train_tokens=1_000,
                    validation_tokens=12,
                )

    def test_durable_snapshot_merges_validation_and_uses_ui_contract(self) -> None:
        request = _validate_run_request(valid_request())
        with tempfile.TemporaryDirectory() as temporary:
            run_dir = Path(temporary) / ("a" * 32)
            record = RunRecord.create("a" * 32, run_dir, request)
            record.emit(
                {
                    "type": "run_started",
                    "state": "running",
                    "phase": "training",
                    "step": 0,
                    "max_steps": 20,
                    "device": "cpu",
                    "precision": "fp32",
                    "parameters": 123,
                    "train_tokens": 1_000,
                    "validation_tokens": 100,
                }
            )
            record.emit(
                {
                    "type": "train_metrics",
                    "step": 10,
                    "max_steps": 20,
                    "progress": 0.5,
                    "loss": 2.0,
                    "learning_rate": 0.001,
                    "gradient_norm": 1.0,
                    "tokens_per_second": 50.0,
                    "elapsed_seconds": 5.0,
                    "eta_seconds": 5.0,
                }
            )
            record.emit(
                {
                    "type": "validation_metrics",
                    "step": 10,
                    "loss": 2.2,
                    "best_loss": 2.2,
                    "improved": True,
                }
            )
            snapshot = record.snapshot()
            self.assertEqual(snapshot["status"], "training")
            self.assertEqual(snapshot["metrics"][0]["loss"], 2.0)
            self.assertEqual(snapshot["metrics"][0]["validationLoss"], 2.2)
            self.assertIsInstance(snapshot["logs"][0], dict)
            self.assertTrue((run_dir / "events.jsonl").is_file())


class CompanionHttpTests(unittest.TestCase):
    def test_companion_server_rejects_a_second_listener_on_the_same_port(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = RunManager(Path(temporary) / "runs")
            server = CompanionHTTPServer(
                ("127.0.0.1", 0),
                manager,
                instance_id="first-instance",
            )
            try:
                with self.assertRaises(OSError):
                    CompanionHTTPServer(
                        ("127.0.0.1", server.server_port),
                        None,
                        instance_id="second-instance",
                    )
            finally:
                server.server_close()
                manager.shutdown()

    def test_serve_binds_before_loading_durable_runs(self) -> None:
        with (
            patch.object(
                service_module,
                "CompanionHTTPServer",
                side_effect=OSError(errno.EADDRINUSE, "Address already in use"),
            ),
            patch.object(service_module, "RunManager") as run_manager,
        ):
            with self.assertRaises(OSError):
                service_module.serve(
                    host="127.0.0.1",
                    port=8765,
                    runs_dir="unused",
                )
        run_manager.assert_not_called()

    def test_health_cors_and_missing_current_run(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = RunManager(temporary)
            server = CompanionHTTPServer(
                ("127.0.0.1", 0),
                manager,
                instance_id="health-test-instance",
            )
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                connection.request("GET", "/health", headers={"Origin": "http://localhost:3000"})
                response = connection.getresponse()
                payload = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertTrue(payload["ok"])
                self.assertEqual(payload["instanceId"], "health-test-instance")
                self.assertEqual(
                    response.getheader("Access-Control-Allow-Origin"),
                    "http://localhost:3000",
                )
                connection.request(
                    "POST",
                    f"/runs/{'a' * 32}/stop",
                    body=b"{}",
                    headers={
                        "Content-Type": "application/json",
                        "X-Chamber-Trainer-Instance": "foreign-instance",
                    },
                )
                foreign_stop = connection.getresponse()
                foreign_payload = json.loads(foreign_stop.read())
                self.assertEqual(foreign_stop.status, 409)
                self.assertIn("different trainer instance", foreign_payload["error"])
                connection.request("GET", "/runs/current")
                missing = connection.getresponse()
                missing.read()
                self.assertEqual(missing.status, 404)
                connection.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(5)


@unittest.skipIf(torch is None, "PyTorch is not installed")
class CheckpointResumeServiceTests(unittest.TestCase):
    def test_checkpoint_alias_retries_a_transient_windows_replace_denial(self) -> None:
        import chamber_trainer.checkpoint as checkpoint_module

        with tempfile.TemporaryDirectory() as temporary:
            checkpoint_dir = Path(temporary)
            source = checkpoint_dir / "checkpoint_00000021.pt"
            destination = checkpoint_dir / "best.pt"
            source.write_bytes(b"new checkpoint")
            destination.write_bytes(b"old checkpoint")
            real_replace = checkpoint_module.os.replace
            attempts = 0

            def replace_after_two_denials(source_path: object, target_path: object) -> None:
                nonlocal attempts
                attempts += 1
                if attempts <= 2:
                    raise PermissionError(13, "Access denied")
                real_replace(source_path, target_path)

            with (
                patch.object(
                    checkpoint_module.os,
                    "replace",
                    side_effect=replace_after_two_denials,
                ),
                patch.object(checkpoint_module.time, "sleep") as mocked_sleep,
            ):
                checkpoint_module.publish_checkpoint_alias(source, destination)

            self.assertEqual(attempts, 3)
            self.assertEqual(mocked_sleep.call_count, 2)
            self.assertEqual(destination.read_bytes(), b"new checkpoint")
            self.assertEqual(list(checkpoint_dir.glob(".best.pt.*.tmp")), [])

    def test_failed_run_uses_newest_durable_checkpoint_when_event_was_not_emitted(
        self,
    ) -> None:
        from chamber_trainer.checkpoint import publish_checkpoint_alias

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run_id, original_config = interrupted_run(root)
            manager = RunManager(root)
            record = manager.get(run_id)
            checkpoint_dir = record.run_dir / "checkpoints"
            newer_step = 9
            newer = checkpoint_dir / f"checkpoint_{newer_step:08d}.pt"
            torch.save(
                {
                    "format_version": 1,
                    "step": newer_step,
                    "best_validation": 2.1,
                    "model": {},
                    "optimizer": {},
                    "scaler": {},
                    "config": original_config.as_serializable_dict(),
                },
                newer,
            )
            publish_checkpoint_alias(newer, checkpoint_dir / "latest.pt")
            with record.lock:
                record.snapshot_data.update(
                    {
                        "status": "failed",
                        "phase": "failed",
                        "step": newer_step,
                        "error": "PermissionError: best.pt was briefly locked",
                    }
                )
                record._persist_locked(required=True)

            before = record.snapshot()
            self.assertEqual(
                [item["step"] for item in before["checkpoints"]],
                [5],
                "the fixture must represent a checkpoint_saved event that never fired",
            )
            self.assertTrue(before["canResumeFromCheckpoint"])
            self.assertEqual(before["resumeCheckpointStep"], newer_step)

            with patch.object(manager, "_execute_resume") as execute_resume:
                resumed = manager.resume_from_checkpoint(run_id).snapshot()
                assert record.thread is not None
                record.thread.join(5)

            self.assertEqual(resumed["status"], "training")
            self.assertEqual(resumed["phase"], "resuming")
            self.assertEqual(resumed["step"], newer_step)
            self.assertEqual(resumed["resumedFromStep"], newer_step)
            execute_resume.assert_called_once()
            resume_config = execute_resume.call_args.args[1]
            self.assertEqual(
                resume_config.training.resume,
                (checkpoint_dir / "latest.pt").resolve(),
            )

    def test_resume_reuses_saved_data_and_rolls_back_unsaved_observations(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run_id, original_config = interrupted_run(root)
            manager = RunManager(root)
            record = manager.get(run_id)
            before = record.snapshot()
            old_controller = record.controller
            self.assertTrue(before["canResumeFromCheckpoint"])
            self.assertEqual(before["resumeCheckpointStep"], 5)

            entered = Event()
            release = Event()
            captured: dict[str, object] = {}

            def fake_train(config, *, observer, control):
                captured["config"] = config
                captured["control"] = control
                entered.set()
                release.wait(5)
                observer(
                    {
                        "type": "resumed",
                        "step": 5,
                        "checkpoint": str(config.training.resume),
                    }
                )
                observer(
                    {
                        "type": "run_started",
                        "state": "running",
                        "phase": "training",
                        "step": 5,
                        "max_steps": config.training.max_steps,
                        "device": "cpu",
                        "precision": "fp32",
                        "parameters": 1,
                        "train_tokens": 1_000,
                        "validation_tokens": 256,
                    }
                )
                observer(
                    {
                        "type": "train_metrics",
                        "state": "running",
                        "phase": "training",
                        "step": 6,
                        "max_steps": config.training.max_steps,
                        "progress": 6 / config.training.max_steps,
                        "loss": 2.2,
                        "learning_rate": 0.001,
                        "gradient_norm": 1.0,
                        "step_seconds": 1.0,
                        "elapsed_seconds": 2.0,
                        "eta_seconds": 10.0,
                        "tokens_per_second": 50.0,
                    }
                )
                observer(
                    {
                        "type": "status",
                        "state": "completed",
                        "phase": "completed",
                        "step": config.training.max_steps,
                        "checkpoint": str(config.training.resume),
                    }
                )
                return config.training.resume

            try:
                with (
                    patch("chamber_trainer.engine.train", side_effect=fake_train),
                    patch.object(
                        service_module,
                        "prepare_corpus",
                        side_effect=AssertionError("resume must not rebuild the corpus"),
                    ),
                ):
                    resumed = manager.resume_from_checkpoint(run_id).snapshot()
                    self.assertTrue(entered.wait(5))
                    self.assertEqual(resumed["status"], "training")
                    self.assertEqual(resumed["phase"], "resuming")
                    self.assertEqual(resumed["step"], 5)
                    self.assertAlmostEqual(
                        resumed["progress"],
                        5 / original_config.training.max_steps,
                    )
                    self.assertIsNone(resumed["error"])
                    self.assertFalse(resumed["canResumeFromCheckpoint"])
                    self.assertEqual([item["step"] for item in resumed["metrics"]], [5])
                    self.assertEqual([item["step"] for item in resumed["samples"]], [5])
                    self.assertIsNot(record.controller, old_controller)
                    with self.assertRaisesRegex(
                        ServiceError, "another training run is already active"
                    ):
                        manager.resume_from_checkpoint(run_id)
                    release.set()
                    assert record.thread is not None
                    record.thread.join(5)
            finally:
                release.set()
                if record.thread is not None:
                    record.thread.join(5)

            resumed_config = captured["config"]
            self.assertEqual(
                resumed_config.data.train_bin,
                (record.run_dir / "data" / "train.bin").resolve(),
            )
            self.assertEqual(
                resumed_config.data.val_bin,
                (record.run_dir / "data" / "val.bin").resolve(),
            )
            self.assertEqual(
                resumed_config.training.resume,
                (record.run_dir / "checkpoints" / "latest.pt").resolve(),
            )
            final = record.snapshot()
            self.assertEqual(final["status"], "completed")
            self.assertEqual(final["elapsedSeconds"], 102.0)
            self.assertTrue(
                any("Resumed checkpoint at step 5" in item["message"] for item in final["logs"])
            )

    def test_resume_endpoint_rejects_missing_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run_id, _ = interrupted_run(root)
            manager = RunManager(root)
            record = manager.get(run_id)
            (record.run_dir / "data" / "val.bin").unlink()
            self.assertFalse(record.snapshot()["canResumeFromCheckpoint"])

            server = CompanionHTTPServer(("127.0.0.1", 0), manager)
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            try:
                connection.request(
                    "POST",
                    f"/runs/{run_id}/resume-from-checkpoint",
                    body=b"{}",
                    headers={"Content-Type": "application/json"},
                )
                response = connection.getresponse()
                response.read()
                self.assertEqual(response.status, 409)
            finally:
                connection.close()
                server.shutdown()
                server.server_close()
                thread.join(5)

    def test_resume_endpoint_accepts_an_interrupted_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run_id, _ = interrupted_run(root)
            manager = RunManager(root)
            record = manager.get(run_id)
            entered = Event()
            release = Event()

            def fake_train(config, *, observer, control):
                entered.set()
                release.wait(5)
                observer(
                    {
                        "type": "status",
                        "state": "stopped",
                        "phase": "stopped",
                        "step": 5,
                        "checkpoint": str(config.training.resume),
                    }
                )
                return config.training.resume

            server = CompanionHTTPServer(("127.0.0.1", 0), manager)
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            try:
                with patch("chamber_trainer.engine.train", side_effect=fake_train):
                    connection.request(
                        "POST",
                        f"/runs/{run_id}/resume-from-checkpoint",
                        body=b"{}",
                        headers={"Content-Type": "application/json"},
                    )
                    response = connection.getresponse()
                    snapshot = json.loads(response.read())
                    self.assertEqual(response.status, 202)
                    self.assertTrue(entered.wait(5))
                    self.assertEqual(snapshot["status"], "training")
                    self.assertEqual(snapshot["phase"], "resuming")
                    self.assertEqual(snapshot["step"], 5)
                    self.assertFalse(snapshot["canResumeFromCheckpoint"])
                    release.set()
                    assert record.thread is not None
                    record.thread.join(5)
            finally:
                release.set()
                connection.close()
                if record.thread is not None:
                    record.thread.join(5)
                server.shutdown()
                server.server_close()
                thread.join(5)

    @unittest.skipIf(torch is None, "PyTorch is not installed")
    def test_post_run_pause_resume_and_graceful_stop(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manager = RunManager(temporary)
            server = CompanionHTTPServer(("127.0.0.1", 0), manager)
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=10)
            try:
                payload = valid_request()
                payload["contextLength"] = 16
                payload["documents"] = [
                    {"name": "training.txt", "content": "A small real training sentence. " * 300}
                ]
                body = json.dumps(payload).encode("utf-8")
                connection.request(
                    "POST",
                    "/runs",
                    body=body,
                    headers={"Content-Type": "application/json"},
                )
                created = connection.getresponse()
                snapshot = json.loads(created.read())
                self.assertEqual(created.status, 202)
                run_id = snapshot["id"]

                # The first AdamW construction can lazily import substantial
                # PyTorch internals on a cold Windows process.
                deadline = time.monotonic() + 30
                current_status = None
                while time.monotonic() < deadline:
                    connection.request("GET", f"/runs/{run_id}")
                    current = connection.getresponse()
                    latest = json.loads(current.read())
                    current_status = latest["status"]
                    if current_status == "training" and latest["step"] >= 1:
                        break
                    time.sleep(0.05)
                self.assertEqual(current_status, "training")

                control_headers = {"Content-Type": "application/json"}
                connection.request(
                    "POST",
                    f"/runs/{run_id}/pause",
                    body=b"{}",
                    headers=control_headers,
                )
                pause_response = connection.getresponse()
                pause_response.read()
                self.assertEqual(pause_response.status, 202)

                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    connection.request("GET", f"/runs/{run_id}")
                    current = connection.getresponse()
                    latest = json.loads(current.read())
                    if latest["status"] == "paused":
                        break
                    time.sleep(0.05)
                self.assertEqual(latest["status"], "paused")

                connection.request(
                    "POST",
                    f"/runs/{run_id}/resume",
                    body=b"{}",
                    headers=control_headers,
                )
                resume_response = connection.getresponse()
                resume_response.read()
                self.assertEqual(resume_response.status, 202)

                connection.request(
                    "POST",
                    f"/runs/{run_id}/stop",
                    body=b"{}",
                    headers=control_headers,
                )
                stop_response = connection.getresponse()
                stop_response.read()
                self.assertEqual(stop_response.status, 202)

                deadline = time.monotonic() + 10
                final_status = None
                while time.monotonic() < deadline:
                    connection.request("GET", f"/runs/{run_id}")
                    current = connection.getresponse()
                    latest = json.loads(current.read())
                    final_status = latest["status"]
                    if final_status in {"stopped", "completed", "failed"}:
                        break
                    time.sleep(0.05)
                self.assertEqual(final_status, "stopped")
                self.assertTrue(any(item["kind"] == "stopped" for item in latest["checkpoints"]))
            finally:
                connection.close()
                manager.shutdown()
                server.shutdown()
                server.server_close()
                thread.join(5)


@unittest.skipIf(torch is None, "PyTorch is not installed")
class ObservableEngineTests(unittest.TestCase):
    def test_training_completes_while_status_persistence_is_degraded(self) -> None:
        from chamber_trainer.config import (
            DataConfig,
            ExperimentConfig,
            ModelConfig,
            TrainingConfig,
        )
        from chamber_trainer.engine import train

        request = _validate_run_request(valid_request())
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            record = RunRecord.create("e" * 32, root / ("e" * 32), request)
            config = ExperimentConfig(
                seed=5,
                data=DataConfig(
                    source="synthetic",
                    synthetic_train_tokens=128,
                    synthetic_val_tokens=64,
                ),
                model=ModelConfig(
                    vocab_size=257,
                    context_length=4,
                    d_model=8,
                    n_heads=2,
                    n_layers=1,
                ),
                training=TrainingConfig(
                    output_dir=record.run_dir / "checkpoints",
                    device="cpu",
                    precision="fp32",
                    micro_batch_size=1,
                    max_steps=1,
                    warmup_steps=0,
                    eval_interval=1,
                    eval_batches=1,
                    checkpoint_interval=1,
                    log_interval=1,
                    sample_interval=1,
                    sample_max_new_tokens=1,
                    sample_top_k=4,
                    sample_prompt="x",
                ),
            )

            with patch(
                "chamber_trainer.service._atomic_json",
                side_effect=PermissionError(13, "Access denied"),
            ):
                latest = train(config, observer=record.emit)

            snapshot = record.snapshot()
            self.assertTrue(latest.is_file())
            self.assertEqual(snapshot["status"], "completed")
            self.assertEqual(snapshot["step"], 1)
            self.assertIn("persistenceWarning", snapshot)
            self.assertNotEqual(snapshot["status"], "failed")

    def test_stop_before_first_update_writes_resumable_checkpoint(self) -> None:
        from chamber_trainer.config import (
            DataConfig,
            ExperimentConfig,
            ModelConfig,
            TrainingConfig,
        )
        from chamber_trainer.engine import train

        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            config = ExperimentConfig(
                seed=7,
                data=DataConfig(
                    source="synthetic",
                    synthetic_train_tokens=128,
                    synthetic_val_tokens=64,
                ),
                model=ModelConfig(
                    vocab_size=257,
                    context_length=4,
                    d_model=8,
                    n_heads=2,
                    n_layers=1,
                ),
                training=TrainingConfig(
                    output_dir=output,
                    device="cpu",
                    precision="fp32",
                    micro_batch_size=1,
                    max_steps=2,
                    warmup_steps=0,
                    eval_interval=1,
                    eval_batches=1,
                    checkpoint_interval=1,
                    log_interval=1,
                    sample_interval=1,
                    sample_max_new_tokens=2,
                    sample_top_k=4,
                    sample_prompt="x",
                ),
            )
            controller = TrainingController()
            controller.stop()
            events: list[dict[str, object]] = []
            latest = train(config, observer=events.append, control=controller)

            self.assertTrue(latest.is_file())
            payload = torch.load(latest, map_location="cpu", weights_only=False)
            self.assertEqual(payload["step"], 0)
            self.assertEqual(events[-1]["state"], "stopped")

    def test_observer_receives_metrics_sample_and_best_checkpoint(self) -> None:
        from chamber_trainer.config import (
            DataConfig,
            ExperimentConfig,
            ModelConfig,
            TrainingConfig,
        )
        from chamber_trainer.engine import train

        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            config = ExperimentConfig(
                seed=3,
                data=DataConfig(
                    source="synthetic",
                    synthetic_train_tokens=128,
                    synthetic_val_tokens=64,
                ),
                model=ModelConfig(
                    vocab_size=257,
                    context_length=4,
                    d_model=8,
                    n_heads=2,
                    n_layers=1,
                ),
                training=TrainingConfig(
                    output_dir=output,
                    device="cpu",
                    precision="fp32",
                    micro_batch_size=1,
                    max_steps=1,
                    warmup_steps=0,
                    eval_interval=1,
                    eval_batches=1,
                    checkpoint_interval=1,
                    log_interval=1,
                    sample_interval=1,
                    sample_max_new_tokens=2,
                    sample_top_k=4,
                    sample_prompt="x",
                ),
            )
            events: list[dict[str, object]] = []
            train(config, observer=events.append)
            event_types = {event["type"] for event in events}
            self.assertTrue({"train_metrics", "validation_metrics", "sample"} <= event_types)
            self.assertTrue((output / "best.pt").is_file())
            self.assertEqual(events[-1]["state"], "completed")

    def test_pause_and_resume_are_honored_between_updates(self) -> None:
        from chamber_trainer.config import (
            DataConfig,
            ExperimentConfig,
            ModelConfig,
            TrainingConfig,
        )
        from chamber_trainer.engine import train

        with tempfile.TemporaryDirectory() as temporary:
            config = ExperimentConfig(
                seed=9,
                data=DataConfig(
                    source="synthetic",
                    synthetic_train_tokens=128,
                    synthetic_val_tokens=64,
                ),
                model=ModelConfig(
                    vocab_size=257,
                    context_length=4,
                    d_model=8,
                    n_heads=2,
                    n_layers=1,
                ),
                training=TrainingConfig(
                    output_dir=Path(temporary),
                    device="cpu",
                    precision="fp32",
                    micro_batch_size=1,
                    max_steps=2,
                    warmup_steps=0,
                    eval_interval=2,
                    eval_batches=1,
                    checkpoint_interval=2,
                    log_interval=1,
                    sample_interval=2,
                    sample_max_new_tokens=1,
                    sample_top_k=4,
                    sample_prompt="x",
                ),
            )
            controller = TrainingController()
            events: list[dict[str, object]] = []
            did_pause = False

            def observe(event: dict[str, object]) -> None:
                nonlocal did_pause
                events.append(event)
                if event["type"] == "train_metrics" and not did_pause:
                    did_pause = True
                    controller.pause()
                    Timer(0.05, controller.resume).start()

            train(config, observer=observe, control=controller)
            states = [event.get("state") for event in events if event["type"] == "status"]
            self.assertIn("paused", states)
            self.assertIn("completed", states)


if __name__ == "__main__":
    unittest.main()
