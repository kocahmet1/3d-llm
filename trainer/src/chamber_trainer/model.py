"""The pre-LN decoder-only Transformer represented by the visual chambers."""

from __future__ import annotations

import math

import torch
from torch import nn
from torch.nn import functional as F

from .config import ModelConfig


class CausalSelfAttention(nn.Module):
    def __init__(self, config: ModelConfig) -> None:
        super().__init__()
        self.n_heads = config.n_heads
        self.head_dim = config.d_model // config.n_heads
        self.dropout_probability = config.dropout

        self.q_proj = nn.Linear(config.d_model, config.d_model, bias=config.bias)
        self.k_proj = nn.Linear(config.d_model, config.d_model, bias=config.bias)
        self.v_proj = nn.Linear(config.d_model, config.d_model, bias=config.bias)
        self.out_proj = nn.Linear(config.d_model, config.d_model, bias=config.bias)
        self.residual_dropout = nn.Dropout(config.dropout)
        causal = torch.tril(
            torch.ones(config.context_length, config.context_length, dtype=torch.bool)
        ).view(1, 1, config.context_length, config.context_length)
        self.register_buffer("causal_mask", causal, persistent=False)

    # chamber:multi-head-attention:start
    def forward(self, hidden: torch.Tensor) -> torch.Tensor:
        batch_size, sequence_length, width = hidden.shape

        # chamber:one-head-qkv:start
        query = self.q_proj(hidden)
        key = self.k_proj(hidden)
        value = self.v_proj(hidden)
        query = query.view(batch_size, sequence_length, self.n_heads, self.head_dim).transpose(1, 2)
        key = key.view(batch_size, sequence_length, self.n_heads, self.head_dim).transpose(1, 2)
        value = value.view(batch_size, sequence_length, self.n_heads, self.head_dim).transpose(1, 2)
        # chamber:one-head-qkv:end

        # chamber:attention-scores:start
        scores = query @ key.transpose(-2, -1)
        scores = scores / math.sqrt(self.head_dim)
        # chamber:attention-scores:end

        # chamber:causal-mask:start
        allowed = self.causal_mask[:, :, :sequence_length, :sequence_length]
        scores = scores.masked_fill(~allowed, float("-inf"))
        # chamber:causal-mask:end

        # chamber:softmax-weighted-v:start
        attention = F.softmax(scores.float(), dim=-1).to(dtype=query.dtype)
        attention = F.dropout(
            attention, p=self.dropout_probability, training=self.training
        )
        heads = attention @ value
        # chamber:softmax-weighted-v:end

        # chamber:head-recombination:start
        combined = heads.transpose(1, 2).contiguous().view(batch_size, sequence_length, width)
        output = self.out_proj(combined)
        return self.residual_dropout(output)
        # chamber:head-recombination:end
    # chamber:multi-head-attention:end


# chamber:mlp:start
class FeedForward(nn.Module):
    def __init__(self, config: ModelConfig) -> None:
        super().__init__()
        inner_width = config.mlp_ratio * config.d_model
        self.up = nn.Linear(config.d_model, inner_width, bias=config.bias)
        self.down = nn.Linear(inner_width, config.d_model, bias=config.bias)
        self.dropout = nn.Dropout(config.dropout)

    def forward(self, hidden: torch.Tensor) -> torch.Tensor:
        hidden = self.up(hidden)
        hidden = F.gelu(hidden)
        return self.dropout(self.down(hidden))
# chamber:mlp:end


# chamber:transformer-block:start
class TransformerBlock(nn.Module):
    """Pre-normalization attention and MLP sublayers with residual paths."""

    def __init__(self, config: ModelConfig) -> None:
        super().__init__()
        self.attention_norm = nn.LayerNorm(config.d_model, bias=config.bias)
        self.attention = CausalSelfAttention(config)
        self.mlp_norm = nn.LayerNorm(config.d_model, bias=config.bias)
        self.mlp = FeedForward(config)

    def forward(self, hidden: torch.Tensor) -> torch.Tensor:
        hidden = hidden + self.attention(self.attention_norm(hidden))
        hidden = hidden + self.mlp(self.mlp_norm(hidden))
        return hidden
# chamber:transformer-block:end


class DecoderOnlyTransformer(nn.Module):
    def __init__(self, config: ModelConfig) -> None:
        super().__init__()
        self.config = config
        self.token_embedding = nn.Embedding(config.vocab_size, config.d_model)
        self.position_embedding = nn.Embedding(config.context_length, config.d_model)
        self.embedding_dropout = nn.Dropout(config.dropout)
        self.blocks = nn.ModuleList(TransformerBlock(config) for _ in range(config.n_layers))
        self.final_norm = nn.LayerNorm(config.d_model, bias=config.bias)
        self.lm_head = nn.Linear(config.d_model, config.vocab_size, bias=config.bias)

        self.apply(self._initialize)
        for name, parameter in self.named_parameters():
            if name.endswith("out_proj.weight") or name.endswith("down.weight"):
                nn.init.normal_(
                    parameter,
                    mean=0.0,
                    std=0.02 / math.sqrt(2 * config.n_layers),
                )
        if config.tie_embeddings:
            self.lm_head.weight = self.token_embedding.weight

    @staticmethod
    def _initialize(module: nn.Module) -> None:
        if isinstance(module, (nn.Linear, nn.Embedding)):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
            if isinstance(module, nn.Linear) and module.bias is not None:
                nn.init.zeros_(module.bias)

    def forward(self, input_ids: torch.Tensor) -> torch.Tensor:
        if input_ids.ndim != 2:
            raise ValueError("input_ids must have shape [batch, time]")
        _, sequence_length = input_ids.shape
        if sequence_length > self.config.context_length:
            raise ValueError(
                f"sequence length {sequence_length} exceeds configured context "
                f"{self.config.context_length}"
            )
        positions = torch.arange(sequence_length, device=input_ids.device)

        # chamber:embedding:start
        hidden = self.token_embedding(input_ids) + self.position_embedding(positions)[None, :, :]
        hidden = self.embedding_dropout(hidden)
        # chamber:embedding:end

        # chamber:transformer-tower:start
        for block in self.blocks:
            hidden = block(hidden)
        # chamber:transformer-tower:end

        # chamber:final-hidden-state:start
        hidden = self.final_norm(hidden)
        # chamber:final-hidden-state:end

        # chamber:vocabulary-projection:start
        # chamber:logits:start
        logits = self.lm_head(hidden)
        return logits
        # chamber:logits:end
        # chamber:vocabulary-projection:end

    def parameter_count(self) -> int:
        return sum(parameter.numel() for parameter in self.parameters())


def language_model_loss(logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
    """Mean next-token cross-entropy over all batch and time positions."""

    # chamber:target-comparison:start
    flat_logits = logits.reshape(-1, logits.size(-1))
    flat_targets = targets.reshape(-1)
    # chamber:loss:start
    loss = F.cross_entropy(flat_logits, flat_targets)
    # chamber:loss:end
    return loss
    # chamber:target-comparison:end
