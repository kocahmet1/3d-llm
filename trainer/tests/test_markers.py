from __future__ import annotations

from pathlib import Path
import re
import unittest


STATION_IDS = {
    "training-complex",
    "corpus-data-preparation",
    "token-stream-context",
    "batch-shifted-targets",
    "embedding",
    "transformer-tower",
    "transformer-block",
    "multi-head-attention",
    "one-head-qkv",
    "attention-scores",
    "causal-mask",
    "softmax-weighted-v",
    "head-recombination",
    "mlp",
    "final-hidden-state",
    "vocabulary-projection",
    "logits",
    "target-comparison",
    "loss",
    "output-backprop",
    "backprop-through-tower",
    "parameter-matrix",
    "adamw-state",
    "weight-update",
    "model-changed-next-step",
    "full-training-loop",
}


class SourceMarkerTests(unittest.TestCase):
    def test_every_marker_has_exactly_one_ordered_pair(self) -> None:
        source_root = Path(__file__).parents[1] / "src" / "chamber_trainer"
        sources = "\n".join(path.read_text(encoding="utf-8") for path in source_root.glob("*.py"))
        discovered = set(re.findall(r"# chamber:([^:]+):start", sources))
        self.assertEqual(discovered, STATION_IDS)

        for station_id in STATION_IDS:
            start = f"# chamber:{station_id}:start"
            end = f"# chamber:{station_id}:end"
            self.assertEqual(sources.count(start), 1, station_id)
            self.assertEqual(sources.count(end), 1, station_id)
            start_index = sources.index(start) + len(start)
            end_index = sources.index(end)
            self.assertLess(start_index, end_index, station_id)
            excerpt = sources[start_index:end_index]
            code_lines = [
                line for line in excerpt.splitlines()
                if line.strip() and not line.lstrip().startswith("#")
            ]
            self.assertTrue(code_lines, f"empty code excerpt for {station_id}")


if __name__ == "__main__":
    unittest.main()
