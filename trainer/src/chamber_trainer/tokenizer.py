"""A deterministic, lossless byte-level tokenizer.

Byte values 0..255 map directly to token IDs. ID 256 is an end-of-document
separator. Unlike a learned subword tokenizer, this tokenizer has no fitting
stage and can represent any UTF-8 text without unknown tokens.
"""

from __future__ import annotations

from collections.abc import Iterable


BYTE_VOCAB_SIZE = 256
EOS_ID = 256
VOCAB_SIZE = 257


class ByteTokenizer:
    """Map UTF-8 bytes to IDs and reserve one ID for document boundaries."""

    vocab_size = VOCAB_SIZE
    eos_id = EOS_ID

    def encode(self, text: str, *, add_eos: bool = False) -> list[int]:
        return self.encode_bytes(text.encode("utf-8"), add_eos=add_eos)

    def encode_bytes(self, value: bytes, *, add_eos: bool = False) -> list[int]:
        token_ids = list(value)
        if add_eos:
            token_ids.append(self.eos_id)
        return token_ids

    def decode(
        self,
        token_ids: Iterable[int],
        *,
        skip_eos: bool = True,
        errors: str = "strict",
    ) -> str:
        raw = bytearray()
        for token_id in token_ids:
            if token_id == self.eos_id and skip_eos:
                continue
            if not 0 <= token_id < BYTE_VOCAB_SIZE:
                raise ValueError(f"token ID {token_id} is not a byte token")
            raw.append(token_id)
        return bytes(raw).decode("utf-8", errors=errors)
