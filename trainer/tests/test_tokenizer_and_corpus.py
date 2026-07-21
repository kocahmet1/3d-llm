from __future__ import annotations

from array import array
from pathlib import Path
import sys
import tempfile
import unittest

from chamber_trainer.corpus import prepare_corpus, prepare_toy_corpus
from chamber_trainer.tokenizer import ByteTokenizer, EOS_ID, VOCAB_SIZE


def read_int32(path: Path) -> list[int]:
    values = array("i")
    with path.open("rb") as handle:
        values.fromfile(handle, path.stat().st_size // 4)
    if sys.byteorder != "little":
        values.byteswap()
    return values.tolist()


class TokenizerAndCorpusTests(unittest.TestCase):
    def test_unicode_round_trip_and_eos(self) -> None:
        tokenizer = ByteTokenizer()
        text = "Merhaba, dünya 🌍"
        encoded = tokenizer.encode(text, add_eos=True)
        self.assertEqual(encoded[-1], EOS_ID)
        self.assertLess(max(encoded), VOCAB_SIZE)
        self.assertEqual(tokenizer.decode(encoded), text)

    def test_prepare_corpus_writes_deterministic_int32_bins(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            corpus = root / "corpus"
            corpus.mkdir()
            (corpus / "a.txt").write_text("alpha\n", encoding="utf-8")
            (corpus / "b.md").write_text("# beta\n", encoding="utf-8")
            (corpus / "ignored.json").write_text("{}", encoding="utf-8")

            first = root / "first"
            second = root / "second"
            manifest = prepare_corpus([corpus], first, validation_fraction=0.5, seed=7)
            prepare_corpus([corpus], second, validation_fraction=0.5, seed=7)

            self.assertEqual((first / "train.bin").read_bytes(), (second / "train.bin").read_bytes())
            self.assertEqual((first / "val.bin").read_bytes(), (second / "val.bin").read_bytes())
            self.assertEqual(manifest["vocab_size"], VOCAB_SIZE)
            self.assertEqual(read_int32(first / "train.bin")[-1], EOS_ID)
            self.assertEqual(read_int32(first / "val.bin")[-1], EOS_ID)

    def test_prepare_toy_is_repeatable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            manifest = prepare_toy_corpus(output, repetitions=2)
            self.assertGreater(manifest["train"]["tokens"], manifest["validation"]["tokens"])
            self.assertEqual(read_int32(output / "train.bin")[-1], EOS_ID)


if __name__ == "__main__":
    unittest.main()
