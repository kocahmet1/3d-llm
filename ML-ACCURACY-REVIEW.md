# ML Accuracy Review — "Inside One Training Step"

> **Status: ✅ All findings resolved and re-verified.** This document records the
> project's dedicated machine-learning accuracy pass: every station, label, and
> number was reviewed against how a real decoder-only Transformer is trained,
> each finding below was then corrected in the exhibit, and the full trace was
> re-verified programmatically afterward (softmax, weighted values, per-token
> losses, mean loss, cross-entropy gradients, and the complete AdamW step —
> **every displayed number is exactly consistent**). The findings are kept here,
> with their resolutions, as a record of that review-and-fix loop.

Reviewed: `trainingTrace.ts`, all chamber process files, canvas labels, HUD, and
the voice-guide content registry. The overall pipeline order is correct: data
prep → windows → batch+shifted targets → embedding+position → 2 pre-LN blocks
(LN1 → causal MHA → W_O → residual; LN2 → GELU MLP → residual) → final LN →
vocab projection → softmax → gather target → mean CE loss → backprop
(activation vs. parameter gradients, residual-add copies gradient) → AdamW
(moments, bias correction, decoupled decay) → updated θ, cleared grads,
persisted optimizer state.

That skeleton survives a researcher's inspection. The items below are what an
expert reviewer would have flagged — **each has since been corrected**.

## A. Discrepancies found inside the content — all corrected

### A1. `<bos>` / `<eos>` appeared as "split pieces" of the source text — ✅ Corrected
Special tokens are inserted by the pipeline, not found in the text by the
tokenizer, so showing `<bos>` among the split word tiles was misleading.
**Resolution:** the data-prep chamber now splits the cleaned text into word
tiles only, and a dedicated special-token injector with INSERT panels adds
`<bos>` / `<eos>` in a separate, visible step before the ID matrix is built.

### A2. Symbol collision: `X` meant two different things — ✅ Corrected
Data stations define `X ∈ ℕ^(2×6)` as the integer token-ID matrix, while the
attention math reused `X` for the block's hidden state, which reads as
"multiplying token IDs by a matrix."
**Resolution:** attention input is now consistently written `N = LN₁(H)` —
`Q = NW_Q`, `K = NW_K`, `V = NW_V` — in the multi-head-attention and one-head
stations' math, structure text, and chamber boards. `X` is reserved for the
integer ID matrix everywhere.

### A3. LN1 silently dropped in the attention-hall math — ✅ Corrected
The QKV math one station after the block overview omitted the normalization.
**Resolution:** same fix as A2 — every q, k, v is explicitly derived from the
normalized hidden row `n = LN₁(H)`, stated in the station math and the voice
guide's component facts.

### A4. Softmax observatory presented Σexp = 1.000 as a law — ✅ Corrected
The trace originally stored logits as log-probabilities, so Σexp(g) = 1 held
*by construction* and all sixteen "raw logits" were negative — a false
invariant a newcomer could learn.
**Resolution:** logits are now stored as `log(p) + ln(10)`, so they are
mixed-sign (as real logits are), softmax still reproduces the displayed
probabilities exactly, and the observatory panel reads
"SUM exp(g_k) = 10.000 for this row." The logits station math states explicitly
that Σexp(g) = 10 here, not 1, and that general logits share no such constant.
The voice-guide content for the raw-logits board teaches the same point.

### A5. Backward pass skipped the final LayerNorm — ✅ Corrected
Forward ends with `H_final = LN_f(H²)`, but the backward chain originally
jumped from `dH_final` straight into Block 1.
**Resolution:** the backward-tower chamber now differentiates `LN_f` first —
collecting dγ_f and dβ_f in its own panel and rack — before the gradient enters
Block 1: `dH² = BackwardLN_f(dH_final)`. Every operation in the chain is now
accounted for.

### A6. "Clean" shown as lowercasing without a caveat — ✅ Corrected
Lowercasing suggested that LLM pipelines discard case, when modern tokenizers
are case-preserving and real cleaning means dedup, filtering, and Unicode
normalization.
**Resolution:** the corpus station's structure text and the cleaning scanner's
voice-guide content now state that lowercasing is a toy simplification for the
16-entry vocabulary, and describe what cleaning means at scale.

## B. Stages a researcher would look for — all now acknowledged in-world

Each of these is now covered by explicit commentary in the relevant station,
so the boundary of the exhibit reads as a deliberate choice:

1. **Tokenizer training** — ✅ the corpus station states that real vocabularies
   (BPE) are themselves learned from corpus statistics in a separate prior phase.
2. **Pretraining only** — ✅ the closing station notes that after many steps
   come evaluation and post-training (SFT, then RLHF or similar).
3. **Learning-rate schedule** — ✅ the AdamW station notes that η follows a
   warmup-then-decay schedule across real steps (held fixed here). The runnable
   trainer in `trainer/` actually implements warmup + decay.
4. **Gradient clipping** — ✅ the AdamW chamber gained a clip-check panel and a
   note that real runs first clip the global gradient norm. The runnable trainer
   clips (`grad_clip = 1.0`).
5. **Random initialization** — ✅ the parameter-matrix station explains the
   selected weight descends from its small random initial value.
6. **Dropout / regularization** — ✅ the block station states dropout is omitted
   so displayed numbers stay exact, and what real training does instead.
7. **Validation, checkpoints, mixed precision, parallelism** — ✅ the
   orientation briefing now names the production machinery deliberately left
   outside the exhibit, none of which changes the mathematics shown.

## C. Defensible design choices — captioned as choices

- **Learned absolute positional embeddings** (GPT-2 style) — ✅ the embedding
  station notes many modern LLMs use RoPE inside attention instead.
- **GELU MLP and LayerNorm** — ✅ captioned as the deliberate MVP choices; the
  final-hidden station notes many recent LLMs use the lighter RMSNorm.
- **Untied `W_vocab` with bias** — ✅ the vocabulary-projection station notes
  many real models tie the head to Eᵀ and drop the bias; untied is a choice.
- **Two separate document streams** — ✅ the token-stream station states that
  real pretraining concatenates and packs documents before windowing.
- **Attention weight 0.785 on `<bos>`** — accidentally realistic
  (attention-sink behavior); kept as is.

## D. UI consistency — ✅ Corrected
In-world branch labels, the HUD bindings, and the README controls table now all
agree on **Q / E** for branch selection (A/D remain sideways movement).

## What's notably *right* (machine-verified)

- softmax([2.1, 0.4, −0.3]) = [0.785298288, 0.143461059, 0.071240653]; weighted
  V sum matches to 9 decimals.
- Per-token losses = −ln(p) for all 12 positions; mean = 1.427636920; Σ = 17.131643.
- ∂L/∂g = (p − one-hot)/12: target −0.06, competitor +0.013333333, slice sums to 0.
- Full AdamW chain: m₁ = −0.00031, v₁ = 9.61e−9, m̂ = −0.0031, v̂ = 9.61e−6,
  normalized −0.999996774, Δw = +0.000999822774, w′ = 0.018399822774 — all
  exact, decoupled decay applied correctly with the right sign story (negative
  gradient → positive step).
- Logits stored as log(p) + ln(10): mixed-sign, softmax reproduces the stored
  probabilities exactly, Σexp = 10 as displayed.
- Parameter census 2,080 = embeddings 176 + blocks 2×872 + final norm 16 +
  vocabulary head 144, derived from the model dimensions so it cannot drift.
- Heads correctly shown as learned projections then reshape ("split projected
  Q/K/V, not raw X").
- Scores computed for all positions *then* masked (matches real
  implementations), mask broadcast over batch and heads, masked cells get
  exactly 0 after softmax.
- Residual-add backward explicitly copies the gradient to both inputs ("not a
  conserved liquid") — a misconception most visualizations get wrong.
- Targets never enter the model; gradient ≠ update; parameters frozen until the
  optimizer; grads cleared, Adam state persists; "one step doesn't guarantee
  lower loss on every batch."
