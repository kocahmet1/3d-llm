# Chamber LLM trainer

This directory contains one coherent, runnable PyTorch implementation behind the visual chambers. It is intentionally small enough to read, but it performs real causal-language-model training: byte tokenization, disk-backed batches, a pre-LayerNorm decoder-only Transformer, cross-entropy, automatic differentiation, AdamW, validation, and resumable checkpoints.

The toy and local runs use the same model and training loop. Only configuration and the data source change. This is educational single-process code, not a claim that every research system uses identical infrastructure.

The toy profile matches the exhibit's architecture scale and source-token
patterns. The exhibit's hand-controlled selected decimal trace is separate: the
trainer uses seeded random initialization and sampling, so `configs/toy.toml`
does not reproduce those exact displayed logits, losses, gradients, or updates.

## Install

Python 3.11 or newer and PyTorch 2.1 or newer are required.

```powershell
cd trainer
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
```

If PowerShell blocks activation, install and run through the environment's
interpreter explicitly:

```powershell
.\.venv\Scripts\python.exe -m pip install -e .
.\.venv\Scripts\python.exe -m chamber_trainer train --config configs/toy.toml
```

Use the appropriate PyTorch installation command for your CUDA version if you want GPU training.

## Run the local Custom Training companion

The browser interface cannot launch PyTorch by itself. Start the dependency-free,
loopback-only companion on the same computer as the browser:

```powershell
chamber-trainer serve --host 127.0.0.1 --port 8765
```

For the website workflow, run `npm run dev:training` once from the repository
root, leave that PowerShell window open, and use the Local URL it prints. A
second launcher is refused so two companions cannot control or write the same
run. The PowerShell window itself holds no model state; checkpoints and prepared
data are stored under `runs/custom`.

The service accepts up to 50 MiB of UTF-8 text in a `POST /runs` JSON request,
prepares the corpus, and runs one real background training job at a time. Durable
status, structured `events.jsonl`, source copies, prepared token bins, preview
samples, and checkpoints live under `runs/custom/<run-id>/`. It exposes:

```text
GET  /health
POST /runs
GET  /runs/current
GET  /runs/<run-id>
GET  /runs/<run-id>/events?after=<sequence>
POST /runs/<run-id>/pause
POST /runs/<run-id>/resume
POST /runs/<run-id>/resume-from-checkpoint
POST /runs/<run-id>/stop
POST /runs/<run-id>/generate
```

Pause and stop requests take effect at the next safe optimizer-step boundary.
Stopping writes a fully resumable checkpoint. The server intentionally refuses
non-loopback binds and non-loopback browser origins; it is a local companion,
not a hardened multi-user training service.

`resume` continues a paused in-memory process. `resume-from-checkpoint` is
different: after an interrupted companion process is restarted, it launches a
new training thread, restores `latest.pt`, and reuses that run's existing
`data/train.bin`, `data/val.bin`, and saved experiment configuration. Observed
steps newer than the checkpoint are discarded because they were never saved
into the model state.

For a later checkpoint recovery, the original PowerShell window is not
required. If the local trainer is offline, open any PowerShell in the repository
root, run `npm run dev:training` once, leave it open, and open the Local URL it
prints. Then click **Resume from checkpoint** in the training panel. If a
trainer is already connected, do not run the command again; use the existing
site. No corpus upload or separate resume command is needed.

After a run completes or stops, `generate` loads `best.pt` when available and
otherwise `latest.pt`. Its JSON body is deliberately strict:

```json
{
  "prompt": "Once upon a time",
  "maxNewTokens": 128,
  "temperature": 0.8,
  "topK": 40,
  "seed": 1337
}
```

Because this trainer tokenizes UTF-8 bytes, the prompt's encoded byte count must
fit the checkpoint's saved context length.

## Run the deterministic toy model

The toy profile generates a deterministic synthetic token-ID stream in memory, so it needs no corpus files:

```powershell
chamber-trainer train --config configs/toy.toml
```

It matches the visual architecture's scale: vocabulary 16, two batch rows, context length 6, width 8, two heads, two pre-LN blocks, a 4x GELU MLP, learned positional embeddings, and an untied vocabulary projection. Its deterministic synthetic stream repeats the exhibit's two seven-token source patterns. Prepared byte-token corpora use the separate local profile with 257 vocabulary entries: 256 byte values plus `<eos>`.

## Prepare text or Markdown

`prepare` recursively discovers `.txt` and `.md` files, deterministically holds out documents for validation, encodes their raw bytes, inserts an `<eos>` document separator, and writes native little-endian `int32` token files. Preparation streams files in chunks rather than loading the corpus into memory.

```powershell
chamber-trainer prepare --input C:\path\to\corpus --output data\local
chamber-trainer train --config configs/local.toml
```

A deterministic on-disk toy corpus is also available for checking the preparation path:

```powershell
chamber-trainer prepare --toy --output data\toy
```

The resulting `train.bin` and `val.bin` are memory-mapped during training. A large corpus therefore does not have to fit in RAM or GPU memory; only each sampled `[B, T+1]` window batch is materialized.

## Configuration

Paths inside TOML files are resolved relative to the config file. The important independent controls are:

- `synthetic_*_tokens` or the prepared token bins: unique data available;
- `d_model`, `n_layers`, and `n_heads`: model capacity and parameter memory;
- `context_length`: sequence length and attention cost;
- `micro_batch_size`: sequences resident for one forward/backward pass;
- `gradient_accumulation_steps`: micro-batches combined into one optimizer update.

Effective non-padding tokens per update are

```text
micro_batch_size * context_length * gradient_accumulation_steps
```

Training windows are sampled randomly **with replacement**. Windows may overlap, some may repeat, and there is no strict iterator-defined epoch. For planning, the trainer prints this estimate:

```text
approx_updates_per_corpus_pass = ceil((train_tokens - 1) / tokens_per_update)
```

Choose `max_steps` by multiplying that estimate by the approximate number of corpus passes you want, then use validation loss to decide whether to stop sooner. Count prepared tokens rather than pages: page density and extraction quality vary too much for pages to predict training duration.

`precision = "auto"` selects BF16 on a supporting CUDA GPU, otherwise FP16 on CUDA, and FP32 on CPU. Mixed precision is useful on one GPU and is unrelated to whether training is distributed. This trainer is single-process: distributed training becomes relevant when a model does not fit on one device or when more throughput is required, not merely because the dataset is large.

`latest.pt` and numbered checkpoint files contain model, optimizer, scaler, step, and random-generator state. This save/resume checkpointing is distinct from activation checkpointing, which trades extra computation for lower activation memory.

Resume explicitly:

```powershell
chamber-trainer train --config configs/local.toml --resume runs\local\latest.pt
```

Resume requires the current `[model]` table to match the checkpoint exactly. Runtime and optimization controls may be changed deliberately: device/precision, batch and accumulation sizes, `max_steps`, warmup/cosine learning rates, AdamW betas and weight decay, clipping, logging, evaluation, checkpoint intervals, and output directory. Current TOML AdamW settings are reapplied after loading optimizer moments. Exact continuation also assumes unchanged token bins; CUDA and CPU RNG state is restored, while MPS RNG continuation is best-effort because this minimal checkpoint format does not save MPS generator state.

CLI overrides are available for quick checks:

```powershell
chamber-trainer train --config configs/local.toml --device cpu --max-steps 2
```

## Source-to-chamber markers

Comments in `corpus.py`, `data.py`, `model.py`, and `engine.py` use `# chamber:<station-id>:start` / `:end`. Each station owns exactly one authentic excerpt from this same runnable implementation. The main update loop is additionally marked `full-training-loop` so the interface can show the chamber excerpt in its cumulative context.

## Tests

The standard-library tests need no test framework. Corpus/tokenizer tests run without PyTorch; model and batch tests skip when PyTorch is unavailable.

```powershell
python -m unittest discover -s tests -v
```
