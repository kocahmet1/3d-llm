"""Small, dependency-free runtime hooks for observable and controllable runs."""

from __future__ import annotations

from collections.abc import Callable
from threading import Condition
from typing import Any, Literal, Protocol


TrainingEvent = dict[str, Any]
TrainingObserver = Callable[[TrainingEvent], None]
ControlState = Literal["running", "paused", "stopping"]


class TrainingControl(Protocol):
    """Cross-thread/process-friendly control surface checked between updates."""

    def state(self) -> ControlState: ...

    def wait(self, timeout: float) -> None: ...


class TrainingController:
    """Thread-safe pause/resume/stop controller used by the local companion."""

    def __init__(self) -> None:
        self._condition = Condition()
        self._state: ControlState = "running"

    def state(self) -> ControlState:
        with self._condition:
            return self._state

    def wait(self, timeout: float) -> None:
        with self._condition:
            self._condition.wait(timeout)

    def pause(self) -> bool:
        with self._condition:
            if self._state == "stopping":
                return False
            changed = self._state != "paused"
            self._state = "paused"
            self._condition.notify_all()
            return changed

    def resume(self) -> bool:
        with self._condition:
            if self._state == "stopping":
                return False
            changed = self._state != "running"
            self._state = "running"
            self._condition.notify_all()
            return changed

    def stop(self) -> bool:
        with self._condition:
            changed = self._state != "stopping"
            self._state = "stopping"
            self._condition.notify_all()
            return changed


def emit(observer: TrainingObserver | None, event_type: str, **fields: Any) -> None:
    """Emit one structured event without requiring monitoring infrastructure."""

    if observer is not None:
        observer({"type": event_type, **fields})
