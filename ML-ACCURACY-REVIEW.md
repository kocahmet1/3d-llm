# ML Accuracy Review — "Inside One Training Step"

> **Status (updated):** All items below have been addressed. A1–A6 and D were fixed
> structurally (logits shifted by ln(10) so Σexp = 10 with mixed signs; special tokens
> now spawn from a dedicated injector with INSERT panels; attention input renamed
> N=LN₁(H) everywhere; LN_f backward panel + dLN_f rack added; clip-check panel added
> to the AdamW chamber; post-training and production-scope plaques added; branch keys
> corrected to Q/E). B1–B7 and C1–C4 were added as one-line commentary in the relevant
> stations' structure text. Trace consistency re-verified programmatically; full
> typecheck passes.

Reviewed: `trainingTrace.ts`, all chamber process files, canvas labels, HUD. All trace numbers were re-verified programmatically (softmax, weighted values, per-token losses, mean loss, cross-entropy gradients, full AdamW step) — **every number is exactly consistent**. The overall pipeline order is correct: data prep → windows → batch+shifted targets → embedding+position → 2 pre-LN blocks (LN1 → causal MHA → W_O → residual; LN2 → GELU MLP → residual) → final LN → vocab projection → softmax → gather target → mean CE loss → backprop (activation vs. parameter gradients, residual-add copies gradient) → AdamW (moments, bias correction, decoupled decay) → updated θ, cleared grads, persisted optimizer state.

That skeleton would survive a researcher's inspection. The items below are what would *not*.

## A. Discrepancies inside the current content

### A1. `<bos>` / `<eos>` appear as "split pieces" of the source text  ⚠ most visible issue
In the data-prep chamber, the cleaned text "the cat sat on the mat" (6 words) is split into **7** tiles including `<bos>`, and the lookup animation shows `'<bos>' → vocabulary address 1` as one of the 14 lookups. Special tokens are *inserted by the pipeline*, not found in the text by the tokenizer. Fix: split into 6 word tiles, then show a separate "insert `<bos>` / append `<eos>`" step before the ID matrix is built.

### A2. Symbol collision: `X` means two different things
Data stations define `X ∈ ℕ^(2×6)` as the integer token-ID matrix. The multi-head-attention station then writes `Q = XW_Q` with `X [2×6×8]` — here X is the block's hidden state (post-LN1). A researcher reads `XW_Q` as "multiplying token IDs by a matrix." Use `Q = LN₁(H)W_Q` (or `N = LN₁(H)`, `Q = NW_Q`) in the station math and rename the chamber board.

### A3. LN1 silently dropped in the attention-hall math
The block station correctly defines `U = H + MHA(LN₁(H))`, but one station later the QKV math is `Q,K,V = XW_*` with no norm. Even if X is meant to be the normalized input, it's never stated. Same fix as A2.

### A4. Softmax observatory: "SUM exp(g_k) = 1.000" presents a coincidence as a law
The trace deliberately stores logits as log-probabilities, so Σexp(g) = 1 *by construction*. In general Σexp(g) ≠ 1 (that's the whole point of the denominator). A newbie can learn a false invariant, and a researcher will spot that all 16 "raw logits" are negative for the same reason (real logits are mixed-sign). Fix: label the panel "= 1.000 (here by construction — normally any positive value)" or store un-normalized logits and show the actual denominator.

### A5. Backward pass skips the final LayerNorm
Forward: `H_final = LN_f(H²)`. Backward: output-backprop emits `dH_final`, and the tower chamber goes straight into "Block 1 backward: MLP add → attention add." The `LN_f` backward step between them is missing (every other op in the chain is accounted for). One extra panel ("LN_f backward") before Block 1 fixes the chain. Related, smaller: `dE`/`dP` (embedding-row gradients) end the chain only as the prose "dH0 exits to embeddings" — acceptable, but an explicit dE-rows rack would complete the picture.

### A6. "Clean" shown as lowercasing
"THE CAT sat" → "the cat sat" implies LLM pipelines lowercase text. Modern tokenizers are case-preserving; cleaning at scale means dedup, filtering, unicode normalization. Fine for the toy, but caption it as such ("toy normalization — real pipelines keep case; cleaning = dedup/filter/quality").

## B. Missing stages/components (things a researcher would look for)

These don't require new chambers — a prose line in `story`/`structure` text, or one wall panel, is enough for each:

1. **Tokenizer training.** The tokenizer is presented as a "fixed 16-entry teaching dictionary," which is right for the step, but nowhere is it said that real vocabularies (BPE/unigram) are *themselves learned from corpus statistics in a separate prior phase*. One sentence at the corpus station closes this.
2. **This is pretraining only.** The world says "one training step," which is honest, but if the tool is pitched as "how LLMs are trained," add a closing note at `model-changed-next-step`: after many such steps comes evaluation, then post-training (SFT, RLHF/DPO). Otherwise a researcher will call the pipeline incomplete.
3. **Learning-rate schedule.** η is a fixed 0.001. Real runs use warmup + decay; the AdamW station could note "η itself follows a schedule across steps."
4. **Gradient clipping.** Typically applied between backward and optimizer; a one-line panel at the parameter-matrix or AdamW station would slot in naturally.
5. **Random initialization.** Step 1 with m₀ = v₀ = 0 is depicted, but nothing says θ₀ started as small random values — a newbie may wonder where 0.0174 came from.
6. **Dropout / regularization** — absent (fine for an MVP; worth one acknowledging sentence so the omission reads as a choice).
7. **Validation loss / checkpoints, mixed precision, data/model parallelism** — all legitimately out of scope; consider a single "what production adds" plaque in the overview chamber so researchers see the boundary was drawn deliberately.

## C. Defensible choices worth a one-line caption (not errors)

- **Learned absolute positional embeddings** (GPT-2 style). Modern LLMs mostly use RoPE inside attention. Caption: "this world uses the simpler learned-position scheme."
- **GELU MLP** — already explicitly captioned as the MVP choice (good); same could be said for LayerNorm vs. RMSNorm.
- **Untied `W_vocab` with bias `b_vocab`.** Many real models tie the output projection to Eᵀ and drop the bias. Untied is legitimate, just worth knowing it's a choice.
- **Documents shown as two separate streams.** Real pretraining concatenates/packs documents into one stream before windowing; the station prose ("a long railway of token IDs is cut into windows") is actually more correct than the visual.
- **Attention weight 0.785 on `<bos>`** — accidentally realistic (attention-sink behavior), no change needed.

## D. Minor UI nit

In-world branch labels say "A: …" / "D: …" (e.g., "A: EXPLORE ALL CANDIDATES", "D: FOLLOW CORRECT TARGET") while the HUD binds branches to **Q / E**. Align the letters.

## What's notably *right* (verified)

- softmax([2.1, 0.4, −0.3]) = [0.785298288, 0.143461059, 0.071240653]; weighted V sum matches to 9 decimals.
- Per-token losses = −ln(p) for all 12 positions; mean = 1.427636920; Σ = 17.131643.
- ∂L/∂g = (p − one-hot)/12: target −0.06, competitor +0.013333333, slice sums to 0.
- Full AdamW chain: m₁ = −0.00031, v₁ = 9.61e−9, m̂ = −0.0031, v̂ = 9.61e−6, normalized −0.999996774, Δw = +0.000999822774, w′ = 0.018399822774 — all exact, decoupled decay applied correctly with the right sign story (negative gradient → positive step).
- Heads correctly shown as learned projections then reshape ("split projected Q/K/V, not raw X").
- Scores computed for all positions *then* masked (matches real implementations), mask broadcast over batch and heads, masked cells get exactly 0 after softmax.
- Residual-add backward explicitly copies the gradient to both inputs ("not a conserved liquid") — a misconception most visualizations get wrong.
- Targets never enter the model; gradient ≠ update; parameters frozen until the optimizer; grads cleared, Adam state persists; "one step doesn't guarantee lower loss on every batch."
