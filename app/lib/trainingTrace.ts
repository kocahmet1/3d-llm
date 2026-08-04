import type { TrainingPhase, TrainingStation } from "./worldTypes";

/**
 * The exact, deliberately tiny decoder-only model used by every numerical label
 * in the world. Production scale is described in prose, never mixed into this
 * trace.
 */
export const TEACHING_MODEL = {
  batchSize: 2,
  sequenceLength: 6,
  vocabularySize: 16,
  modelWidth: 8,
  attentionHeads: 2,
  headWidth: 4,
  transformerBlocks: 2,
  feedForwardWidth: 32,
  validTokens: 12,
} as const;

/**
 * Exact learned-parameter census of the teaching model, derived from
 * TEACHING_MODEL and matching `trainer/configs/toy.toml` (bias = true): token
 * and position embeddings, per-block LayerNorms, Q/K/V/output projections with
 * biases, the GELU MLP with biases, the final LayerNorm, and the untied
 * vocabulary head with bias. The orientation chamber displays these counts;
 * keeping them derived means they cannot drift from the model dimensions.
 */
export const TEACHING_MODEL_PARAMETERS = (() => {
  const d = TEACHING_MODEL.modelWidth;
  const vocabulary = TEACHING_MODEL.vocabularySize;
  const positions = TEACHING_MODEL.sequenceLength;
  const feedForward = TEACHING_MODEL.feedForwardWidth;
  const tokenEmbedding = vocabulary * d;
  const positionEmbedding = positions * d;
  const perBlock =
    2 * d + // LayerNorm 1 gain + bias
    4 * (d * d + d) + // W_Q, W_K, W_V, W_O with biases
    2 * d + // LayerNorm 2 gain + bias
    (d * feedForward + feedForward) + // W_up + b_up
    (feedForward * d + d); // W_down + b_down
  const blocks = TEACHING_MODEL.transformerBlocks * perBlock;
  const finalNorm = 2 * d;
  const vocabularyHead = d * vocabulary + vocabulary;
  return {
    tokenEmbedding,
    positionEmbedding,
    embeddings: tokenEmbedding + positionEmbedding,
    perBlock,
    blocks,
    finalNorm,
    vocabularyHead,
    total:
      tokenEmbedding + positionEmbedding + blocks + finalNorm + vocabularyHead,
  } as const;
})();

/**
 * Published reference points the orientation chamber compares the specimen
 * against. These are prose-scale facts from the GPT-2 and GPT-3 papers and
 * model cards — deliberately kept beside, never inside, the deterministic
 * trace: nothing here feeds a displayed calculation.
 */
export const PRODUCTION_SCALE_REFERENCES = {
  gpt2Small: {
    name: "GPT-2 SMALL",
    year: 2019,
    parameters: 124_000_000,
    contextLength: 1024,
    vocabularySize: 50257,
    /** WebText: ~8M documents, ~40 GB of text (GPT-2 paper). */
    trainingBytes: 40e9,
    trainingData: "~40 GB of web text (WebText, ~8M documents)",
    modelWidth: 768,
    transformerBlocks: 12,
    attentionHeads: 12,
    feedForwardWidth: 3072,
  },
  gpt3: {
    name: "GPT-3",
    year: 2020,
    parameters: 175_000_000_000,
    contextLength: 2048,
    vocabularySize: 50257,
    /** ~570 GB of filtered text, ~300B training tokens (GPT-3 paper). */
    trainingBytes: 570e9,
    trainingData: "~570 GB of filtered text (~300B training tokens)",
    modelWidth: 12288,
    transformerBlocks: 96,
    attentionHeads: 96,
    feedForwardWidth: 49152,
  },
} as const;

/**
 * How one weight matrix inside a Transformer block compares between this
 * world and GPT-2 small. Both models share the block's shapes — square
 * projections at d_model², and an MLP that widens by 4× — so the two exhibits
 * reduce to one honest ratio: every block matrix here is exactly 96× narrower
 * and 96× shorter than GPT-2's, i.e. 9,216 of ours tile into one of theirs.
 * The vocabulary head is deliberately excluded: its second dimension is the
 * vocabulary, which scales by a different factor entirely.
 */
export const BLOCK_MATRIX_COMPARISON = (() => {
  const ours = TEACHING_MODEL;
  const theirs = PRODUCTION_SCALE_REFERENCES.gpt2Small;
  const widthRatio = theirs.modelWidth / ours.modelWidth;
  const feedForwardRatio = theirs.feedForwardWidth / ours.feedForwardWidth;
  return {
    widthRatio,
    feedForwardRatio,
    /** Only true because both dimensions scale by the same factor. */
    tilesPerMatrix: widthRatio * feedForwardRatio,
    attention: {
      ours: [ours.modelWidth, ours.modelWidth] as const,
      theirs: [theirs.modelWidth, theirs.modelWidth] as const,
      oursCells: ours.modelWidth * ours.modelWidth,
      theirsCells: theirs.modelWidth * theirs.modelWidth,
    },
    feedForward: {
      ours: [ours.modelWidth, ours.feedForwardWidth] as const,
      theirs: [theirs.modelWidth, theirs.feedForwardWidth] as const,
      oursCells: ours.modelWidth * ours.feedForwardWidth,
      theirsCells: theirs.modelWidth * theirs.feedForwardWidth,
    },
  } as const;
})();

/** Station indices retained by the fast Overview Ride. */
export const OVERVIEW_KEY_STATION_INDICES = [
  0, 3, 4, 5, 6, 7, 11, 13, 15, 18, 20, 22, 23, 24,
] as const;

/** Stable phase colors: color is reinforced by motion and labels in the scene. */
export const PHASE_COLORS: Readonly<Record<TrainingPhase, string>> = {
  overview: "#8ff7d4",
  data: "#a9c7ff",
  forward: "#47d7ff",
  loss: "#ffd166",
  backward: "#ff765f",
  update: "#b8ff75",
};

/**
 * A coherent deterministic trace for the selected example, token, head and
 * parameter. The selected token is batch 0, position 2: `cat` predicts `sat`.
 * Logits are log-probabilities shifted by ln(10) ≈ 2.302585093, so
 * softmax(logits) still reproduces `probabilities` exactly (softmax is
 * shift-invariant) while the logits stay mixed-sign and Σexp(logits) = 10,
 * as with real, un-normalized logits.
 */
export const SELECTED_NUMERIC_TRACE = {
  vocabulary: [
    "<pad>",
    "<bos>",
    "<eos>",
    "the",
    "cat",
    "sat",
    "on",
    "mat",
    "a",
    "small",
    "model",
    "can",
    "learn",
    ".",
    "dog",
    "runs",
  ],
  batch: {
    inputTokenIds: [
      [1, 3, 4, 5, 6, 3],
      [1, 8, 9, 10, 11, 12],
    ],
    targetTokenIds: [
      [3, 4, 5, 6, 3, 7],
      [8, 9, 10, 11, 12, 2],
    ],
    selectedBatch: 0,
    selectedPosition: 2,
    selectedInputTokenId: 4,
    selectedTargetTokenId: 5,
  },
  embedding: {
    selectedToken: "cat",
    selectedTokenId: 4,
    selectedPosition: 2,
    selectedTokenVector: [0.18, -0.32, 0.41, 0.07, -0.22, 0.56, -0.11, 0.29],
    selectedPositionVector: [0.04, 0.12, -0.08, 0.03, 0.15, -0.06, 0.09, -0.02],
    selectedHiddenVector: [0.22, -0.2, 0.33, 0.1, -0.07, 0.5, -0.02, 0.27],
  },
  attention: {
    selectedBlock: 0,
    selectedHead: 0,
    selectedQueryPosition: 2,
    query: [1, 1, 1, 1],
    allowedKeys: [
      [1, 1, 1, 1.2],
      [0.2, 0.2, 0.2, 0.2],
      [-0.1, -0.1, -0.2, -0.2],
    ],
    rawDotProducts: [4.2, 0.8, -0.6],
    scaledScoresBeforeMask: [2.1, 0.4, -0.3, -0.5, 0.7, 1.1],
    maskedScores: [2.1, 0.4, -0.3, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
    attentionWeights: [0.785298288, 0.143461059, 0.071240653, 0, 0, 0],
    allowedValues: [
      [0.6, -0.2, 0.1, 0.5],
      [-0.1, 0.4, 0.8, -0.3],
      [0.3, 0.2, -0.4, 0.7],
    ],
    weightedValue: [0.478205063, -0.085427103, 0.164802415, 0.399479283],
  },
  output: {
    selectedLogits: [
      -2.302585093, -2.302585093, -1.203972804, -0.223143551,
      0, 1.029619417, 0.470003629, -0.223143551,
      -0.916290732, -1.203972804, -0.693147181, -0.916290732,
      -1.203972804, -1.203972804, -1.609437912, -2.302585093,
    ],
    selectedProbabilities: [
      0.01, 0.01, 0.03, 0.08, 0.1, 0.28, 0.16, 0.08,
      0.04, 0.03, 0.05, 0.04, 0.03, 0.03, 0.02, 0.01,
    ],
    correctTokenProbabilities: [
      [0.18, 0.11, 0.28, 0.36, 0.22, 0.31],
      [0.15, 0.42, 0.25, 0.19, 0.33, 0.27],
    ],
    perTokenLosses: [
      [1.714798428, 2.207274913, 1.272965676, 1.021651248, 1.514127733, 1.171182982],
      [1.897119985, 0.867500568, 1.386294361, 1.660731207, 1.108662625, 1.30933332],
    ],
    selectedCorrectProbability: 0.28,
    selectedTokenLoss: 1.272965676,
    meanLoss: 1.42763692,
    selectedTargetLogitGradient: -0.06,
    selectedCompetitorProbability: 0.16,
    selectedCompetitorLogitGradient: 0.013333333,
  },
  optimizer: {
    parameterName: "block.0.attention.WQ[3, 6]",
    weightBefore: 0.0174,
    gradient: -0.0031,
    beta1: 0.9,
    beta2: 0.999,
    epsilon: 1e-8,
    learningRate: 0.001,
    weightDecay: 0.01,
    step: 1,
    momentBefore: 0,
    varianceBefore: 0,
    momentAfter: -0.00031,
    varianceAfter: 9.61e-9,
    biasCorrectedMoment: -0.0031,
    biasCorrectedVariance: 9.61e-6,
    normalizedGradient: -0.999996774,
    adamComponent: 0.000999996774,
    decayComponent: -0.000000174,
    deltaWeight: 0.000999822774,
    weightAfter: 0.018399822774,
  },
} as const;

/** Short alias for scene code that reads many values from the trace. */
export const SELECTED_TRACE = SELECTED_NUMERIC_TRACE;

export const DATA_PREP_DURATION_SECONDS = 28;

export const DATA_PREP_STAGES = [
  { id: "source", label: "Source text", start: 0 },
  { id: "clean", label: "Clean", start: 0.16 },
  { id: "split", label: "Split + specials", start: 0.3 },
  { id: "lookup", label: "Vocabulary lookup", start: 0.48 },
  { id: "matrix", label: "Build ID matrix", start: 0.82 },
  { id: "ready", label: "Ready for windows", start: 0.94 },
] as const;

const sourceTokenIds = SELECTED_NUMERIC_TRACE.batch.inputTokenIds.map(
  (row, rowIndex) => [
    ...row,
    SELECTED_NUMERIC_TRACE.batch.targetTokenIds[rowIndex][row.length - 1],
  ],
);

/** Exact artifacts used by the animated data-preparation chamber. */
export const DATA_PREP_TRACE = {
  sources: [
    {
      kind: "BOOK + WEB TEXT",
      raw: "THE   CAT sat\nON the MAT",
      clean: "the cat sat on the mat",
    },
    {
      kind: "CODE + DIALOGUE",
      raw: "A small MODEL\ncan   learn",
      clean: "a small model can learn",
    },
  ],
  tokenIds: sourceTokenIds,
  tokens: sourceTokenIds.map((row) =>
    row.map((tokenId) => SELECTED_NUMERIC_TRACE.vocabulary[tokenId]),
  ),
} as const;

/**
 * How many steps each chamber's walk is divided into.
 *
 * This is one number serving two jobs, deliberately. It sizes the avenue a
 * chamber is laid out along — the stops the visitor walks between, and the lit
 * thresholds marking them on the runway — and it is also the notch count on the
 * HUD's process dial. Keeping a single source means the detents the visitor
 * feels while scrubbing land on the same boundaries as the thresholds they
 * walked over, instead of the two drifting apart.
 */
export const CHAMBER_PROCESS_STOPS: Readonly<Record<string, number>> = {
  // Not an avenue: the orientation theater's "stops" are its slides, so the
  // dial's detents land exactly on slide boundaries. A contract test ties this
  // to the deck's actual length.
  "training-complex": 5,
  "token-stream-context": 4,
  "batch-shifted-targets": 5,
  embedding: 5,
  "transformer-tower": 5,
  "transformer-block": 6,
  "multi-head-attention": 6,
  "one-head-qkv": 7,
  "attention-scores": 5,
  "causal-mask": 5,
  "softmax-weighted-v": 6,
  "head-recombination": 5,
  mlp: 6,
  "final-hidden-state": 5,
  "vocabulary-projection": 5,
  logits: 6,
  "target-comparison": 4,
  loss: 5,
  "output-backprop": 5,
  "backprop-through-tower": 7,
  "parameter-matrix": 5,
  "adamw-state": 6,
  "weight-update": 5,
  "model-changed-next-step": 6,
};

/** Fallback notch count for chambers with no bespoke avenue, e.g. the corpus. */
export const DEFAULT_CHAMBER_PROCESS_STOPS = 5;

/**
 * Seconds one pass of a chamber's process animation takes at normal speed.
 * The transport advances against this, and the HUD dial reads its position out
 * in the same units, so "0:07 / 0:12" means what it says.
 */
export const CHAMBER_PROCESS_DURATION_SECONDS = 12;

/**
 * Chambers whose process is not paced like the others.
 *
 * Twelve seconds is right for watching one operation happen. The orientation
 * gallery is not an operation: its transport walks the visitor from placard to
 * placard, and each placard is a page of reading. At the shared pace the tour
 * would cross the whole hall in the time it takes to read one heading, so it
 * gets a briefing-length clock instead. Five placards share a 24-second pass,
 * putting the opening panel in view for 4.8 seconds and keeping later stops
 * brisk unless the visitor pauses to stay with one.
 */
export const CHAMBER_PROCESS_DURATION_OVERRIDES: Readonly<
  Record<string, number>
> = {
  "training-complex": 24,
};

/** Seconds one pass of a chamber's process takes at normal speed. */
export function chamberProcessDurationSeconds(stationId: string) {
  return (
    CHAMBER_PROCESS_DURATION_OVERRIDES[stationId] ??
    CHAMBER_PROCESS_DURATION_SECONDS
  );
}

/**
 * Chambers whose process runs once instead of looping.
 *
 * A chamber animation has no end state worth resting on, so it loops. A
 * briefing does: the orientation gallery's transport is a walk from the first
 * placard to the last, and looping it would either march the visitor back up
 * the hall or make the dial wrap them from the entrance to the exit. Running
 * once means the walk simply finishes, facing the door, and the dial scrubs
 * within the walk in both directions.
 */
const CHAMBER_PROCESS_RUNS_ONCE: ReadonlySet<string> = new Set([
  "training-complex",
]);

export function chamberProcessLoops(stationId: string) {
  return !CHAMBER_PROCESS_RUNS_ONCE.has(stationId);
}

export const TRAINING_STATIONS: TrainingStation[] = [
  {
    id: "training-complex",
    title: "Meet the Model",
    shortTitle: "Meet the Model",
    phase: "overview",
    zoomBand: 0,
    breadcrumb: ["orientation"],
    story: "A short briefing before the journey. Everything this model will ever read is two sentences — \"the cat sat on the mat\" and \"a small model can learn\" — and the model itself is 2,080 learned numbers, shrunk until every value ahead stays readable.",
    structure: "The deck introduces the specimen: a decoder-only Transformer, the same species as GPT-2 and GPT-3, at reading size. 16 vocabulary entries instead of 50,257; a 6-token context window instead of 1,024–2,048; 2,080 parameters instead of 124 million or 175 billion; 46 bytes of training text instead of tens of gigabytes. Inside a block, every weight matrix is 8×8 or 8×32 where GPT-2's is 768×768 or 768×3072. Production training also adds machinery deliberately left outside this exhibit — validation runs, checkpoints, mixed precision, and data/model parallelism across many accelerators — none of which change the mathematics ahead.",
    math: "B=2, T=6, V=16, d_model=8, H=2, d_head=4, blocks=2. Parameter census: embeddings 176 + blocks 2×872 + final norm 16 + vocabulary head 144 = 2,080. Because d_model and d_ff both scale by 96, 9,216 of this model's block matrices tile into one of GPT-2 small's. Only the sizes differ — the operations ahead are identical.",
    formula: "|θ| = 2,080 ; GPT-2 small: 1.24×10⁸ ; GPT-3: 1.75×10¹¹",
    shape: "corpus 2 sentences · 46 bytes → batch [2×6] → θ 2,080",
    scaleLabel: "orientation briefing · 5 slides",
    cameraHint: "wide",
  },
  {
    id: "corpus-data-preparation",
    title: "Corpus & Data Preparation",
    shortTitle: "Prepare Text",
    phase: "data",
    zoomBand: 1,
    breadcrumb: ["one training step", "data wing"],
    story: "Books, code, and conversations are cleaned into text. A tokenizer then turns familiar-looking pieces into numbered tiles the model can receive.",
    structure: "The tokenizer owns a fixed 16-entry teaching dictionary. It is outside the neural network: vocabulary entries map text pieces to IDs, while the learned embedding table appears later inside the model. Real vocabularies are themselves built beforehand, in a separate phase, by algorithms like BPE that learn frequent pieces from corpus statistics. The lowercase clean step is equally a toy simplification: real tokenizers keep case, and cleaning at scale means deduplication, quality filtering, and Unicode normalization.",
    math: "Our two seven-token source spans become integer IDs. IDs are addresses, not quantities: ID 12 is not more meaningful than ID 4.",
    formula: "text → tokenize → token IDs",
    shape: "2 source spans × 7 tokens",
    scaleLabel: "data supply · before the model",
    branch: {
      left: "Tokenizer dictionary",
      right: "Context windows",
      default: "right",
    },
    cameraHint: "approach",
  },
  {
    id: "token-stream-context",
    title: "Token Stream & Context Windows",
    shortTitle: "Context Windows",
    phase: "data",
    zoomBand: 2,
    breadcrumb: ["one training step", "data wing", "token stream"],
    story: "A long railway of token IDs is cut into small windows. Each window is a training example, not a whole document and not the whole corpus.",
    structure: "The loader selects two spans of T+1=7 tokens. Each span supplies six inputs and the six tokens immediately following them; examples remain separate and never attend across batch rows. In real pipelines many documents are concatenated and packed into one long stream before windows are sliced.",
    math: "Window b is s_b[0:6] for input and s_b[1:7] for targets. The one-position offset creates next-token supervision without sending answers into the model.",
    formula: "x[b,t] = s_b[t] ; y[b,t] = s_b[t+1]",
    shape: "stream [N] → source windows [B,T+1] = [2,7]",
    scaleLabel: "2 context windows · 7 source tokens each",
    cameraHint: "inside",
  },
  {
    id: "batch-shifted-targets",
    title: "Batch & Shifted Targets",
    shortTitle: "Batch + Answers",
    phase: "data",
    zoomBand: 2,
    breadcrumb: ["one training step", "batch platform"],
    story: "Two rows lock into a batch tray. A second tray holds each next-token answer, then takes a separate route to the loss chamber.",
    structure: "Inputs are [<bos>, the, cat, sat, on, the] and [<bos>, a, small, model, can, learn]. Targets are the same source spans shifted left: [the, cat, sat, on, the, mat] and [a, small, model, can, learn, <eos>].",
    math: "There are B×T=12 supervised positions. The model sees x∈ℕ^(2×6); target IDs y∈ℕ^(2×6) are used only after logits exist.",
    formula: "X = S[:,0:T] ; Y = S[:,1:T+1]",
    shape: "inputs [2,6] + targets [2,6]",
    scaleLabel: "12 next-token training pairs",
    cameraHint: "inside",
  },
  {
    id: "embedding",
    title: "Embedding Hall",
    shortTitle: "Token Embeddings",
    phase: "forward",
    zoomBand: 2,
    breadcrumb: ["one training step", "model", "embeddings"],
    story: "Each number selects a learned row, turning one token ID into eight useful features. A position vector is added so identical words can behave differently in different places.",
    structure: "The embedding wall E is a stationary parameter table [16,8]. Twelve selected rows become moving activations; learned positional table P [6,8] is added position by position. This world uses the simple learned-position scheme; many modern LLMs instead rotate query/key features with RoPE inside attention.",
    math: "H⁰[b,t,:] = E[X[b,t],:] + P[t,:]. Gradients later reach the selected rows of E and P, never the integer IDs or tokenizer.",
    formula: "H⁰ = lookup(E, X) + P",
    shape: "[2,6] → [2,6,8] using E[16,8] and P[6,8]",
    scaleLabel: "12 token vectors · 8 features each",
    cameraHint: "approach",
  },
  {
    id: "transformer-tower",
    title: "The Transformer Tower",
    shortTitle: "2-Block Model",
    phase: "forward",
    zoomBand: 2,
    breadcrumb: ["one training step", "model", "transformer tower"],
    story: "The batch climbs through two repeating floors. Each floor improves every token's representation while keeping the tray's outer shape unchanged.",
    structure: "Both blocks use the same architecture but own separate parameters. The twelve token positions travel as [2,6,8]; examples in different batch rows remain isolated.",
    math: "H² = Block₁(Block₀(H⁰)). Parameters θ are read many times during this forward pass but are not modified.",
    formula: "[2,6,8] ─Block 0→ [2,6,8] ─Block 1→ [2,6,8]",
    shape: "hidden states [2,6,8] · 2 sequential blocks",
    scaleLabel: "complete model spine · block 0 selected",
    cameraHint: "approach",
  },
  {
    id: "transformer-block",
    title: "Inside Transformer Block 0",
    shortTitle: "One Block",
    phase: "forward",
    zoomBand: 3,
    breadcrumb: ["model", "block 0"],
    story: "A central residual highway keeps what the token already knows. Attention adds information gathered from earlier positions; the MLP adds a private transformation for each position.",
    structure: "This pre-normalized block contains LayerNorm 1 → multi-head causal attention → output projection → residual add, then LayerNorm 2 → GELU MLP → residual add. Both bypasses stay visible. Dropout is omitted so every displayed number stays exact; real training randomly zeroes some activations for regularization.",
    math: "U = H + MHA(LN₁(H)); H′ = U + MLP(LN₂(U)). At each addition the two inputs and output all have shape [2,6,8].",
    formula: "U=H+MHA(LN₁(H)); H′=U+MLP(LN₂(U))",
    shape: "[2,6,8] → [2,6,8]",
    scaleLabel: "block 0 · attention + MLP",
    branch: {
      left: "Attention path",
      right: "MLP path",
      default: "left",
    },
    cameraHint: "inside",
  },
  {
    id: "multi-head-attention",
    title: "Multi-Head Attention Hall",
    shortTitle: "2 Attention Heads",
    phase: "forward",
    zoomBand: 4,
    breadcrumb: ["model", "block 0", "attention"],
    story: "Two parallel teams let each token gather different kinds of information from allowed earlier positions.",
    structure: "The block's normalized input N=LN₁(H) feeds combined Q, K, and V projection walls that each map width 8 to width 8, then reshape into H=2 head lanes of width d_head=4. Heads are learned projections, not raw slices of the hidden state.",
    math: "N=LN₁(H); Q=NW_Q, K=NW_K, V=NW_V with W_*∈ℝ^(8×8), followed by reshape [2,6,8]→[2,2,6,4].",
    formula: "N=LN₁(H) ; Q,K,V = reshape(NW_Q, NW_K, NW_V)",
    shape: "3 × ([2,6,8] × [8,8] → [2,2,6,4])",
    scaleLabel: "2 learned views · 4 features per head",
    cameraHint: "inside",
  },
  {
    id: "one-head-qkv",
    title: "One Head: Query, Key & Value",
    shortTitle: "Head 0 · QKV",
    phase: "forward",
    zoomBand: 5,
    breadcrumb: ["model", "block 0", "attention", "head 0"],
    story: "For one token, its query asks what matters; every allowed key says what it matches; each value carries the information that can be gathered.",
    structure: "We follow batch 0, head 0, query position 2—the token 'cat'. Its four-number query is compared with keys; the resulting weights later blend four-number values.",
    math: "For the selected query q=[1,1,1,1]. Dot products with the first three keys are [4.2,0.8,−0.6]. Every q, k and v came from multiplying a normalized hidden row n=LN₁(H) by a learned matrix.",
    formula: "q_i=n_iW_Q ; k_j=n_jW_K ; v_j=n_jW_V",
    shape: "selected q[4], keys[6,4], values[6,4]",
    scaleLabel: "block 0 · head 0 · query position 2",
    branch: {
      left: "Q·K matching",
      right: "Value gathering",
      default: "left",
    },
    cameraHint: "approach",
  },
  {
    id: "attention-scores",
    title: "Attention Score Matrix",
    shortTitle: "QKᵀ Scores",
    phase: "forward",
    zoomBand: 6,
    breadcrumb: ["model", "block 0", "attention", "head 0", "scores"],
    story: "A square floor answers two questions at once: each row is who is looking, and each column is which token position is being examined.",
    structure: "Every head builds its own 6×6 score grid for every batch row. One cell is one query-key dot product scaled by √4=2; it is an activation, not a permanent weight.",
    math: "S[b,h,i,j]=(Q[b,h,i,:]·K[b,h,j,:])/√d_head. For i=2, raw [4.2,0.8,−0.6] becomes [2.1,0.4,−0.3].",
    formula: "S = QKᵀ / √4",
    shape: "[2,2,6,4] × [2,2,4,6] → [2,2,6,6]",
    scaleLabel: "144 score cells · one cell selected",
    cameraHint: "microscope",
  },
  {
    id: "causal-mask",
    title: "The Causal Mask",
    shortTitle: "No Looking Ahead",
    phase: "forward",
    zoomBand: 6,
    breadcrumb: ["model", "block 0", "attention", "head 0", "mask"],
    story: "A triangular barrier closes every doorway into the future, so position 2 may use positions 0, 1, and 2—but never positions 3, 4, or 5.",
    structure: "The mask is added to temporary attention scores and broadcast across both batches and heads. It does not erase token data and does not alter learned parameter matrices.",
    math: "M[i,j]=0 when j≤i and −∞ when j>i. The selected row becomes [2.1,0.4,−0.3,−∞,−∞,−∞].",
    formula: "S_masked = S + M ; M[i,j] = −∞ if j>i",
    shape: "mask [1,1,6,6] broadcasts over scores [2,2,6,6]",
    scaleLabel: "lower-triangular access · row 2 selected",
    cameraHint: "microscope",
  },
  {
    id: "softmax-weighted-v",
    title: "Softmax & Weighted Values",
    shortTitle: "Gather Information",
    phase: "forward",
    zoomBand: 6,
    breadcrumb: ["model", "block 0", "attention", "head 0", "weighted values"],
    story: "Scores become shares that add to one. Those shares open valves on the value streams, blending several pieces of information into one result for 'cat'.",
    structure: "Softmax operates independently along each query row. Masked future cells receive exactly zero probability; the six weighted value vectors reduce to one four-feature head output per query.",
    math: "softmax([2.1,0.4,−0.3,−∞,−∞,−∞])=[0.785298288,0.143461059,0.071240653,0,0,0]. Their weighted V sum is [0.478205063,−0.085427103,0.164802415,0.399479283].",
    formula: "A=softmax(S+M); Z=AV",
    shape: "[2,2,6,6] × [2,2,6,4] → [2,2,6,4]",
    scaleLabel: "one normalized row · weights sum to 1",
    cameraHint: "microscope",
  },
  {
    id: "head-recombination",
    title: "Heads Recombine",
    shortTitle: "Concat + W_O",
    phase: "forward",
    zoomBand: 4,
    breadcrumb: ["model", "block 0", "attention", "head recombination"],
    story: "The two head results return side by side. An output projection mixes their discoveries, and the result merges with the unchanged residual highway.",
    structure: "Head outputs are transposed and concatenated from two width-4 lanes into width 8, multiplied by W_O[8,8], then added elementwise to the block input.",
    math: "O=Concat(Z₀,Z₁)W_O; U=H+O. Concatenation restores [2,6,8], and the residual addition preserves that shape.",
    formula: "U = H + Concat(Z₀,Z₁)W_O",
    shape: "2 × [2,6,4] → [2,6,8] × [8,8] → [2,6,8]",
    scaleLabel: "2 heads recombined · first residual merge",
    cameraHint: "return",
  },
  {
    id: "mlp",
    title: "The MLP Expansion Chamber",
    shortTitle: "Per-Token MLP",
    phase: "forward",
    zoomBand: 4,
    breadcrumb: ["model", "block 0", "MLP"],
    story: "Now each token enters its own lane. Its eight features expand to thirty-two, pass through a smooth GELU gate, compress back to eight, and rejoin the residual stream.",
    structure: "Positions do not communicate here. All twelve lanes reuse the same W_up[8,32] and W_down[32,8] parameters, so separate motion must not imply separate MLP weights.",
    math: "F=GELU(LN₂(U)W_up+b_up)W_down+b_down; H′=U+F. GELU is the chosen MVP activation—there is no mixed SwiGLU machinery.",
    formula: "H′ = U + GELU(LN₂(U)W_up+b_up)W_down+b_down",
    shape: "[2,6,8] → [2,6,32] → [2,6,8]",
    scaleLabel: "12 independent positions · shared parameters",
    cameraHint: "inside",
  },
  {
    id: "final-hidden-state",
    title: "Final Hidden-State Platform",
    shortTitle: "Contextual States",
    phase: "forward",
    zoomBand: 2,
    breadcrumb: ["model", "after block 1", "final norm"],
    story: "After the second block, every position still carries eight numbers—but those numbers now summarize the earlier context that position was allowed to see.",
    structure: "Block 1 repeats the same architecture with its own parameters. Final LayerNorm produces H_final; this is contextual representation, not yet a vocabulary probability. LayerNorm is the classic choice shown here; many recent LLMs use the lighter RMSNorm.",
    math: "H_final=LN_f(Block₁(Block₀(H⁰))). Causality means H_final[b,t] depends only on input positions ≤t in the same batch row.",
    formula: "H_final = LN_f(H²)",
    shape: "[2,6,8] → [2,6,8]",
    scaleLabel: "12 contextual vectors · 8 features each",
    cameraHint: "return",
  },
  {
    id: "vocabulary-projection",
    title: "Vocabulary Projection",
    shortTitle: "Vocabulary Scores",
    phase: "forward",
    zoomBand: 3,
    breadcrumb: ["model", "output", "vocabulary projection"],
    story: "Each position's eight features face a sixteen-column scoreboard. One matrix multiplication gives a separate score for every possible next token.",
    structure: "The stationary W_vocab[8,16] is a learned parameter matrix. It transforms each of the twelve final hidden vectors independently into sixteen moving logits. Keeping W_vocab separate is a choice: many real models tie it to the transpose of the embedding table E and drop the output bias.",
    math: "Logits[b,t,:]=H_final[b,t,:]W_vocab+b_vocab. Flattening positions gives [12,8]×[8,16]=[12,16].",
    formula: "G = H_final W_vocab + b_vocab",
    shape: "[2,6,8] × [8,16] → [2,6,16]",
    scaleLabel: "12 scoreboards · 16 candidates each",
    cameraHint: "approach",
  },
  {
    id: "logits",
    title: "The Logits Landscape",
    shortTitle: "All Predictions",
    phase: "forward",
    zoomBand: 5,
    breadcrumb: ["model", "output", "batch 0", "position 2", "logits"],
    story: "For 'cat', sixteen candidate towers rise at once. The model has not picked one answer; it has assigned a prediction score to every vocabulary entry.",
    structure: "Softmax converts this position's logits into a probability distribution. In the selected trace, 'sat' receives 0.28, 'on' 0.16, 'cat' 0.10, and all sixteen probabilities sum to one.",
    math: "p_k=exp(g_k)/Σ_j exp(g_j). Logits are signed, unbounded scores; softmax ignores any shared shift. This trace stores log(p_k)+ln 10, so softmax reproduces the probabilities exactly while Σ_j exp(g_j)=10, not 1.",
    formula: "p = softmax(logits) along V",
    shape: "selected logits [16] → probabilities [16]",
    scaleLabel: "batch 0 · position 2 · target will be 'sat'",
    branch: {
      left: "Explore all candidates",
      right: "Follow correct target",
      default: "right",
    },
    cameraHint: "inside",
  },
  {
    id: "target-comparison",
    title: "Target Comparison",
    shortTitle: "Reveal the Answer",
    phase: "loss",
    zoomBand: 5,
    breadcrumb: ["loss wing", "target comparison"],
    story: "Only now does the separate answer tray arrive. At the selected position it points to 'sat', so the inspector reads the 0.28 probability on that one candidate.",
    structure: "Each target ID gathers one probability from its matching [16]-candidate distribution. Targets supervise the outputs; they are never fed into attention as privileged future information.",
    math: "For b=0,t=2, y=5 ('sat') and p_y=0.28. Across the batch, gather(p,Y) changes [2,6,16] into twelve correct-token probabilities [2,6].",
    formula: "p_correct[b,t] = p[b,t,Y[b,t]]",
    shape: "probabilities [2,6,16] + targets [2,6] → [2,6]",
    scaleLabel: "one correct candidate per position",
    cameraHint: "approach",
  },
  {
    id: "loss",
    title: "Cross-Entropy Loss Chamber",
    shortTitle: "One Scalar Loss",
    phase: "loss",
    zoomBand: 7,
    breadcrumb: ["loss wing", "token losses", "mean loss"],
    story: "A confident correct prediction earns a small penalty; a weak one earns a larger penalty. Twelve amber penalties collapse into one glowing score for this step.",
    structure: "The selected token contributes −log(0.28)=1.272965676. The mean across all B×T=12 valid positions is 1.427636920. The parameters are still unchanged.",
    math: "L=−(1/12)Σ_{b,t}log p[b,t,Y[b,t]]. The scalar keeps a computation graph linking it to every operation and parameter that influenced it.",
    formula: "L = −mean(log p_correct) = 1.427636920",
    shape: "per-token loss [2,6] → scalar []",
    scaleLabel: "12 losses reduced to 1 scalar",
    cameraHint: "microscope",
  },
  {
    id: "output-backprop",
    title: "Backpropagation Through the Output",
    shortTitle: "Gradient Begins",
    phase: "backward",
    zoomBand: 5,
    breadcrumb: ["backward", "output projection"],
    story: "The direction reverses. The loss sends sensitivity signals into every logit, revealing which small score changes would raise or lower the loss.",
    structure: "At W_vocab, the incoming gradient produces two results: an activation gradient continues toward H_final, while a parameter gradient is collected for W_vocab. Nothing is updated yet.",
    math: "For mean cross-entropy, ∂L/∂g=(p−one_hot(y))/12. At selected target 'sat': (0.28−1)/12=−0.06; for competitor 'on': 0.16/12=0.013333333.",
    formula: "dG=(p−Y_onehot)/12; dH=dG W_vocabᵀ; dW=HᵀdG",
    shape: "dG [2,6,16] → dH [2,6,8] + dW_vocab [8,16]",
    scaleLabel: "reverse mode · gradients, not updates",
    cameraHint: "return",
  },
  {
    id: "backprop-through-tower",
    title: "Backpropagation Through the Tower",
    shortTitle: "Trace Influence Back",
    phase: "backward",
    zoomBand: 2,
    breadcrumb: ["backward", "final norm", "block 1", "block 0", "embeddings"],
    story: "Warm signals first cross the final LayerNorm, then retrace the dependencies through block 1 and block 0. At residual joins they reach both the direct highway and the transformation branch.",
    structure: "Every parameterized operation emits an input gradient and accumulates parameter gradients. The final LayerNorm is differentiated first, collecting dγ_f and dβ_f. Addition copies the upstream derivative to both inputs; it is not a conserved liquid divided into smaller portions.",
    math: "Reverse-mode chain rules traverse the final norm, MLP, attention, block norms, and residual adds. Gradients accumulate when one value influenced the loss through multiple downstream paths.",
    formula: "dH² = BackwardLN_f(dH_final) ; dH⁰ ← BackwardBlock₀(BackwardBlock₁(dH²))",
    shape: "dH [2,6,8] through 2 blocks + many parameter-gradient tensors",
    scaleLabel: "same tower · computation viewed backward",
    branch: {
      left: "Activation gradient",
      right: "Parameter gradient",
      default: "right",
    },
    cameraHint: "return",
  },
  {
    id: "parameter-matrix",
    title: "One Parameter Matrix",
    shortTitle: "W_Q Cell",
    phase: "backward",
    zoomBand: 6,
    breadcrumb: ["backward", "block 0", "attention", "W_Q"],
    story: "We follow one collected gradient into W_Q and stop at a single learned number. Its value stayed fixed while forward and backward calculations used it.",
    structure: "The selected cell is block.0.attention.WQ[3,6]. It stores weight 0.0174 and has accumulated gradient −0.0031 from all twelve token losses. The 0.0174 itself descends from the small random value this cell received at initialization, moved by every previous step (here: none — this is step 1).",
    math: "g=∂L/∂w=−0.0031 means an infinitesimal increase in w would locally decrease L. The gradient is neither the new weight nor an instruction to add −0.0031 directly.",
    formula: "w=0.0174 ; g=∂L/∂w=−0.0031",
    shape: "W_Q [8,8] → selected scalar W_Q[3,6]",
    scaleLabel: "1 of 64 W_Q parameters · block 0",
    cameraHint: "microscope",
  },
  {
    id: "adamw-state",
    title: "AdamW Optimizer State",
    shortTitle: "Plan the Update",
    phase: "update",
    zoomBand: 7,
    breadcrumb: ["optimizer", "W_Q[3,6]", "AdamW state"],
    story: "The optimizer combines today's gradient with memory slots, a learning rate, and gentle weight decay to decide one small move.",
    structure: "For this deterministic first step, m₀=v₀=0, β₁=0.9, β₂=0.999, learning rate=0.001, decay=0.01, and ε=10⁻⁸. This is the first moment parameters may change. Real runs first clip the global gradient norm, and η itself follows a warmup-then-decay schedule across steps; both are held fixed here.",
    math: "m₁=−0.00031, v₁=9.61×10⁻⁹; bias correction gives m̂=−0.0031 and v̂=9.61×10⁻⁶. The normalized gradient is −0.999996774.",
    formula: "m=β₁m₀+(1−β₁)g; v=β₂v₀+(1−β₂)g²",
    shape: "one parameter + gradient + m + v → one Δw",
    scaleLabel: "AdamW · step 1 · scalar state",
    branch: {
      left: "Simple small step",
      right: "Full AdamW state",
      default: "left",
    },
    cameraHint: "microscope",
  },
  {
    id: "weight-update",
    title: "The Weight Update",
    shortTitle: "Parameter Changes",
    phase: "update",
    zoomBand: 7,
    breadcrumb: ["optimizer", "W_Q[3,6]", "updated weight"],
    story: "The cell finally moves: a tiny violet pulse changes 0.0174 into 0.018399822774. Millions of other cells would receive their own distinct moves.",
    structure: "The negative gradient produces a positive Adam step; decoupled weight decay opposes it slightly. This sign relationship is visible instead of presenting the gradient as the update itself.",
    math: "Δw=−0.001[m̂/(√v̂+ε)+0.01w]=+0.000999822774. Thus w′=0.0174+0.000999822774=0.018399822774.",
    formula: "w′ = w − η·m̂/(√v̂+ε) − η·λw",
    shape: "scalar w → scalar w′",
    scaleLabel: "+0.000999822774 · one optimizer update",
    cameraHint: "microscope",
  },
  {
    id: "model-changed-next-step",
    title: "The Model Has Changed",
    shortTitle: "Next Training Step",
    phase: "overview",
    zoomBand: 0,
    breadcrumb: ["updated model", "next batch"],
    story: "From outside, the tower looks the same. Inside, its learned numbers are slightly different, so the next batch will meet a slightly different model.",
    structure: "AdamW has updated every participating parameter tensor—not one universal matrix. Optimizer state persists, gradients are cleared according to the training loop, and the next prepared batch enters. Pretraining repeats this loop for a very large number of steps; a released assistant then adds evaluation and post-training (SFT, then RLHF or similar) on top.",
    math: "θ₁=AdamW(θ₀,∇L₀,m₀,v₀). The next step computes L₁ with θ₁; one update does not guarantee every individual next-batch loss is lower, but repeated steps optimize expected training loss.",
    formula: "θ₀ → θ₁ ; batch₁ → forward → loss → backward → update",
    shape: "same architecture · updated parameter values",
    scaleLabel: "step 1 complete · loop continues",
    cameraHint: "return",
  },
];
// Trace numbers re-verified after the ln(10) logit shift: softmax(logits) still
// reproduces selectedProbabilities exactly and sum(exp(logits)) = 10.
