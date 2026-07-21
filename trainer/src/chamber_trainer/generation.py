"""Autoregressive byte-level sampling for live training previews."""

from __future__ import annotations

import torch
from torch.nn import functional as F

from .model import DecoderOnlyTransformer
from .tokenizer import ByteTokenizer, EOS_ID


@torch.inference_mode()
def generate_text(
    model: DecoderOnlyTransformer,
    prompt: str,
    *,
    device: torch.device,
    max_new_tokens: int,
    temperature: float,
    top_k: int,
    seed: int,
) -> dict[str, object]:
    """Generate a reproducible preview while respecting the model context window."""

    if max_new_tokens < 1:
        raise ValueError("max_new_tokens must be positive")
    if temperature <= 0:
        raise ValueError("temperature must be positive")

    tokenizer = ByteTokenizer()
    prompt_ids = tokenizer.encode(prompt)
    if not prompt_ids:
        raise ValueError("sample prompt cannot be empty")

    generated = list(prompt_ids)
    completion: list[int] = []
    generator = torch.Generator(device="cpu").manual_seed(seed)
    was_training = model.training
    model.eval()
    try:
        for _ in range(max_new_tokens):
            context = generated[-model.config.context_length :]
            input_ids = torch.tensor([context], dtype=torch.long, device=device)
            logits = model(input_ids)[0, -1].float().cpu() / temperature
            if top_k > 0 and top_k < logits.numel():
                values, indices = torch.topk(logits, top_k)
                probabilities = F.softmax(values, dim=-1)
                selected = torch.multinomial(probabilities, 1, generator=generator)
                token_id = int(indices[selected].item())
            else:
                probabilities = F.softmax(logits, dim=-1)
                token_id = int(torch.multinomial(probabilities, 1, generator=generator).item())
            if token_id == EOS_ID:
                break
            generated.append(token_id)
            completion.append(token_id)
    finally:
        model.train(was_training)

    completion_text = tokenizer.decode(completion, errors="replace")
    return {
        "prompt": prompt,
        "completion": completion_text,
        "text": prompt + completion_text,
        "generated_tokens": len(completion),
        "seed": seed,
        "temperature": temperature,
        "top_k": top_k,
    }
