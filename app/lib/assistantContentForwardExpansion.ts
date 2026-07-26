import type {
  AssistantTargetContext,
  AssistantTargetWorldMetadata,
} from "./assistantContext";
import {
  SELECTED_TRACE,
  TEACHING_MODEL,
  TEACHING_MODEL_PARAMETERS,
} from "./trainingTrace";

const selectedBatch = SELECTED_TRACE.batch.selectedBatch;
const selectedPosition = SELECTED_TRACE.batch.selectedPosition;
const selectedInputToken =
  SELECTED_TRACE.vocabulary[SELECTED_TRACE.batch.selectedInputTokenId];
const selectedTargetToken =
  SELECTED_TRACE.vocabulary[SELECTED_TRACE.batch.selectedTargetTokenId];
const selectedLogits = SELECTED_TRACE.output.selectedLogits;

function explanationByMode(
  story: string,
  structure: string,
  math: string,
  code: string,
): AssistantTargetContext["explanationByMode"] {
  return { story, structure, math, code };
}

export const FORWARD_EXPANSION_COMPONENT_TARGETS: readonly AssistantTargetContext[] =
  [
    {
      id: "final-hidden:input-tensor",
      stationId: "final-hidden-state",
      kind: "component",
      label: "Block-1 output tensor H²",
      aliases: ["H2 tensor", "final norm input", "contextual pod batch"],
      summary:
        "The twelve width-8 contextual vectors leaving Transformer block 1 are the input to the model's final LayerNorm.",
      role:
        "It carries the completed Transformer-stack representation into the final normalization without changing batch, position, or feature dimensions.",
      inputs: ["Output H² from Transformer block 1, shape [2,6,8]"],
      operation:
        "Route each of the 12 position vectors independently toward the shared final LayerNorm.",
      outputs: ["Twelve width-8 rows ready for LN_f"],
      formula: "H² = Block₁(Block₀(H⁰))",
      shape: "[2,6,8]",
      exactValues: {
        batchSize: TEACHING_MODEL.batchSize,
        sequenceLength: TEACHING_MODEL.sequenceLength,
        modelWidth: TEACHING_MODEL.modelWidth,
        vectorCount: TEACHING_MODEL.validTokens,
        selectedBatch,
        selectedPosition,
        selectedToken: selectedInputToken,
      },
      whyItMatters:
        "This is the final contextual representation produced by the Transformer blocks; normalization prepares it for a stable shared vocabulary readout.",
      commonMisconceptions: [
        "H² contains contextual activations, not vocabulary probabilities.",
        "The twelve pods are rows of one batch tensor, not twelve separately learned parameter sets.",
      ],
      relatedTargetIds: [
        "final-hidden:selected-input",
        "final-hidden:layer-norm",
        "final-hidden:output-tensor",
        "station:mlp",
      ],
      explanationByMode: explanationByMode(
        "Twelve contextual messages arrive from the last Transformer block and fly toward one final calibration gate.",
        "H² has 2 batch rows, 6 positions per row, and 8 features per position; LN_f preserves that shape.",
        "H² ∈ R^(2×6×8), and LN_f acts independently on each of its 12 width-8 rows.",
        "h_final = final_layer_norm(h2)",
      ),
    },
    {
      id: "final-hidden:selected-input",
      stationId: "final-hidden-state",
      kind: "component",
      label: `Selected H² row for '${selectedInputToken}'`,
      aliases: ["selected final norm input", "H2 cat row", "pre-normalized row"],
      summary:
        "A symbolic width-8 row isolates batch 0, position 2 so the final LayerNorm steps can be inspected one vector at a time.",
      role:
        "It is the selected contextual activation whose feature mean and variance are computed by LN_f.",
      inputs: [`H²[${selectedBatch},${selectedPosition},:]`],
      operation:
        "Present the selected eight-feature activation to the centering and rescaling operation.",
      outputs: ["The same row after subtracting its feature mean"],
      formula: `h = H²[${selectedBatch},${selectedPosition},:]`,
      shape: "[8]",
      exactValues: {
        selectedBatch,
        selectedPosition,
        selectedToken: selectedInputToken,
        featureCount: TEACHING_MODEL.modelWidth,
        displayedValues: "symbolic",
      },
      whyItMatters:
        "Following one row makes clear that LayerNorm mixes features within a position, not information across token positions.",
      commonMisconceptions: [
        "The displayed h0 through h7 labels are symbolic; this trace does not claim numeric H² values.",
        "Final LayerNorm does not average different tokens or batch rows together.",
      ],
      relatedTargetIds: [
        "final-hidden:input-tensor",
        "final-hidden:layer-norm",
        "final-hidden:centered-vector",
      ],
      explanationByMode: explanationByMode(
        `This is the '${selectedInputToken}' position pulled out of the twelve-row stream so its final calibration can be followed.`,
        "One [8] activation row is selected from H²[2,6,8]; its eight features remain attached to the same batch-position slot.",
        `h = H²[${selectedBatch},${selectedPosition},:] ∈ R^8.`,
        `h = h2[${selectedBatch}, ${selectedPosition}, :]`,
      ),
    },
    {
      id: "final-hidden:layer-norm",
      stationId: "final-hidden-state",
      kind: "component",
      label: "Final LayerNorm operator LN_f",
      aliases: ["final norm ring", "LN f", "normalization gate"],
      summary:
        "The final LayerNorm subtracts each row's feature mean, divides by its feature standard deviation, and applies learned gain and bias.",
      role:
        "It stabilizes the scale and offset of every final hidden row before the vocabulary head reads it.",
      inputs: ["One width-8 H² row", "Learned gain γ_f[8]", "Learned bias β_f[8]"],
      operation:
        "Center and standardize the row across its eight features, then apply elementwise learned γ_f and β_f.",
      outputs: ["One width-8 normalized H_final row"],
      formula: "LN_f(h) = γ_f ⊙ ((h-μ)/sqrt(σ²+ε)) + β_f",
      shape: "[8] → [8], applied to 12 rows",
      exactValues: {
        featureCount: TEACHING_MODEL.modelWidth,
        gainParameters: TEACHING_MODEL.modelWidth,
        biasParameters: TEACHING_MODEL.modelWidth,
        totalFinalNormParameters: TEACHING_MODEL_PARAMETERS.finalNorm,
      },
      whyItMatters:
        "The same normalized feature scale feeds the shared vocabulary projection at every position.",
      commonMisconceptions: [
        "LayerNorm has learned gain and bias, but the per-row mean and variance are temporary activations.",
        "This teaching model uses LayerNorm; it is not depicting RMSNorm.",
      ],
      relatedTargetIds: [
        "final-hidden:selected-input",
        "final-hidden:centered-vector",
        "final-hidden:normalized-vector",
      ],
      explanationByMode: explanationByMode(
        "The rotating rings are a calibration gate: center, rescale, then restore a learned per-feature gain and offset.",
        "LN_f owns 8 gain and 8 bias parameters and reuses them for all 12 position rows.",
        "For each row, μ and σ² are computed over 8 features; γ_f and β_f then act elementwise.",
        "h_final = gamma_f * layer_norm(h2) + beta_f",
      ),
    },
    {
      id: "final-hidden:centered-vector",
      stationId: "final-hidden-state",
      kind: "component",
      label: "Mean-centered selected vector",
      aliases: ["centered H2 row", "h minus mu", "centered vector"],
      summary:
        "The selected row after subtracting its own eight-feature mean is an intermediate LayerNorm activation.",
      role:
        "Centering removes the row's shared offset before variance-based rescaling.",
      inputs: ["Selected width-8 H² row", "Its scalar feature mean μ"],
      operation: "Subtract μ from each of the row's eight feature values.",
      outputs: ["Centered vector h-μ"],
      formula: "c_i = h_i - μ, where μ = (1/8) Σ_i h_i",
      shape: "[8]",
      exactValues: {
        featureCount: TEACHING_MODEL.modelWidth,
        displayedValues: "symbolic",
      },
      whyItMatters:
        "It exposes the first concrete step of LayerNorm and separates temporary statistics from learned parameters.",
      commonMisconceptions: [
        "The mean is over features within this row, not over the twelve token positions.",
        "The centered vector is not yet the complete LayerNorm output.",
      ],
      relatedTargetIds: [
        "final-hidden:selected-input",
        "final-hidden:layer-norm",
        "final-hidden:normalized-vector",
      ],
      explanationByMode: explanationByMode(
        "The row shifts so its eight features balance around zero.",
        "This board is a temporary activation between the mean-subtraction and variance-rescaling parts of LN_f.",
        "c = h - μ1 and Σ_i c_i = 0 up to numerical precision.",
        "centered = h - h.mean(dim=-1, keepdim=True)",
      ),
    },
    {
      id: "final-hidden:normalized-vector",
      stationId: "final-hidden-state",
      kind: "component",
      label: "Selected H_final row",
      aliases: ["normalized selected row", "H final cat row", "LN output row"],
      summary:
        "The selected width-8 row after standardization and learned gain-and-bias is one row of H_final.",
      role:
        "It is the final contextual activation for this batch-position slot and the direct input to the vocabulary projection.",
      inputs: ["Centered row", "Feature variance σ²", "γ_f[8]", "β_f[8]"],
      operation:
        "Divide by the stabilized feature standard deviation, then apply learned gain and bias.",
      outputs: [`H_final[${selectedBatch},${selectedPosition},:]`],
      formula:
        "H_final[0,2,:] = γ_f ⊙ ((H²[0,2,:]-μ)/sqrt(σ²+ε)) + β_f",
      shape: "[8]",
      exactValues: {
        selectedBatch,
        selectedPosition,
        selectedToken: selectedInputToken,
        featureCount: TEACHING_MODEL.modelWidth,
        displayedValues: "symbolic",
      },
      whyItMatters:
        "This exact slot will be multiplied by W_vocab to produce sixteen next-token scores.",
      commonMisconceptions: [
        "A normalized hidden row is still an activation vector, not a probability distribution.",
        "LayerNorm preserves width 8; it does not expand to vocabulary size.",
      ],
      relatedTargetIds: [
        "final-hidden:centered-vector",
        "final-hidden:layer-norm",
        "final-hidden:output-tensor",
        "vocab:hidden-input",
      ],
      explanationByMode: explanationByMode(
        `This is the calibrated contextual description at the '${selectedInputToken}' position, ready to score possible next tokens.`,
        "The row remains width 8 and occupies the same batch-position index after LN_f.",
        "H_final[0,2,:] ∈ R^8; normalization changes values, not shape.",
        `selected_h_final = h_final[${selectedBatch}, ${selectedPosition}, :]`,
      ),
    },
    {
      id: "final-hidden:output-tensor",
      stationId: "final-hidden-state",
      kind: "component",
      label: "Final hidden-state tensor H_final",
      aliases: ["H final tensor", "final normalized tray", "contextual output tensor"],
      summary:
        "All twelve normalized width-8 contextual rows are collected into H_final[2,6,8].",
      role:
        "It is the complete Transformer representation delivered to the shared vocabulary head.",
      inputs: ["Twelve independently normalized H² rows"],
      operation: "Collect the LN_f outputs without changing their batch-position layout.",
      outputs: ["H_final[2,6,8] for vocabulary projection"],
      formula: "H_final = LN_f(H²)",
      shape: "[2,6,8]",
      exactValues: {
        batchSize: TEACHING_MODEL.batchSize,
        sequenceLength: TEACHING_MODEL.sequenceLength,
        modelWidth: TEACHING_MODEL.modelWidth,
        vectorCount: TEACHING_MODEL.validTokens,
      },
      whyItMatters:
        "Every one of the twelve positions now has the final width-8 features from which its sixteen vocabulary logits are computed.",
      commonMisconceptions: [
        "H_final contains twelve contextual vectors, not one pooled sentence vector.",
        "It is not yet logits and has no vocabulary-sized axis.",
      ],
      relatedTargetIds: [
        "final-hidden:normalized-vector",
        "vocab:hidden-input",
        "station:vocabulary-projection",
      ],
      explanationByMode: explanationByMode(
        "The twelve calibrated messages regroup into one tray and continue to the vocabulary scoreboard.",
        "H_final retains axes [batch=2, position=6, features=8].",
        "LN_f: R^(2×6×8) → R^(2×6×8).",
        "h_final = final_layer_norm(h2)  # shape: (2, 6, 8)",
      ),
    },
    {
      id: "vocab:hidden-input",
      stationId: "vocabulary-projection",
      kind: "component",
      label: `Selected H_final input for '${selectedInputToken}'`,
      aliases: ["vocabulary head input", "selected hidden vector", "h final input"],
      summary:
        "The selected symbolic width-8 H_final row docks above W_vocab before producing sixteen scores.",
      role:
        "It supplies the eight activation features used by every vocabulary column for this position.",
      inputs: [`H_final[${selectedBatch},${selectedPosition},:]`],
      operation:
        "Present the same eight hidden features to all sixteen columns of W_vocab.",
      outputs: ["Sixteen dot-product contributions before bias"],
      formula: `h = H_final[${selectedBatch},${selectedPosition},:]`,
      shape: "[8]",
      exactValues: {
        selectedBatch,
        selectedPosition,
        selectedInputToken,
        featureCount: TEACHING_MODEL.modelWidth,
        displayedValues: "symbolic",
      },
      whyItMatters:
        "This is the bridge from contextual features to scores over concrete vocabulary entries.",
      commonMisconceptions: [
        "The hidden vector does not already contain sixteen token probabilities.",
        "The symbolic h0 through h7 labels are not claimed numeric trace values.",
      ],
      relatedTargetIds: [
        "vocab:weight-matrix",
        "vocab:matrix-multiply",
        "final-hidden:output-tensor",
      ],
      explanationByMode: explanationByMode(
        `The contextual description at '${selectedInputToken}' now faces all sixteen possible next-token columns.`,
        "One [8] activation row is broadcast across the [8,16] output matrix.",
        "h ∈ R^8 is the left factor in hW_vocab.",
        `h = h_final[${selectedBatch}, ${selectedPosition}, :]`,
      ),
    },
    {
      id: "vocab:weight-matrix",
      stationId: "vocabulary-projection",
      kind: "component",
      label: "Untied vocabulary weight matrix W_vocab",
      aliases: ["W vocab", "output weight matrix", "vocabulary head weights"],
      summary:
        "A learned [8,16] matrix gives one width-8 scoring column to each vocabulary entry.",
      role:
        "It converts eight final hidden features into sixteen independent raw token scores.",
      inputs: ["Selected H_final row [8]", "Learned W_vocab[8,16]"],
      operation: "Take the hidden-vector dot product with each of 16 learned columns.",
      outputs: ["Sixteen pre-bias score accumulations"],
      formula: "s = h W_vocab",
      shape: "[8] × [8,16] → [16]",
      exactValues: {
        inputFeatures: TEACHING_MODEL.modelWidth,
        vocabularySize: TEACHING_MODEL.vocabularySize,
        weightCount:
          TEACHING_MODEL.modelWidth * TEACHING_MODEL.vocabularySize,
        tiedToTokenEmbedding: false,
        displayedValues: "symbolic",
      },
      whyItMatters:
        "These learned columns determine which vocabulary tokens align with a contextual hidden direction.",
      commonMisconceptions: [
        "This teaching model's vocabulary matrix is untied; it is not the transpose of the token embedding table.",
        "The matrix is a learned parameter and remains stationary during this forward pass.",
      ],
      relatedTargetIds: [
        "vocab:hidden-input",
        "vocab:matrix-multiply",
        "vocab:accumulators",
      ],
      explanationByMode: explanationByMode(
        "Each of the sixteen columns is a learned scoring ruler for one possible next token.",
        "W_vocab has 8 rows by 16 columns, for 128 learned weights; the separate bias contributes 16 more parameters.",
        "s_j = Σ_i h_i W_vocab[i,j] for j=0…15.",
        "pre_bias_scores = h @ W_vocab",
      ),
    },
    {
      id: "vocab:matrix-multiply",
      stationId: "vocabulary-projection",
      kind: "component",
      label: "Hidden-to-vocabulary matrix multiply",
      aliases: ["vocabulary scan", "output projection multiply", "product packets"],
      summary:
        "The scan beam and product packets visualize the selected width-8 row being multiplied across all sixteen W_vocab columns.",
      role:
        "It performs the forward-pass computation that turns contextual features into one pre-bias score per vocabulary entry.",
      inputs: ["h[8]", "W_vocab[8,16]"],
      operation:
        "Multiply matching hidden features and weights, then route each column's products to its accumulator.",
      outputs: ["Sixteen accumulated dot products"],
      formula: "s_j = Σ_(i=0)^7 h_i W_vocab[i,j]",
      shape: "[8] × [8,16] → [16]",
      exactValues: {
        multiplicationsPerPosition:
          TEACHING_MODEL.modelWidth * TEACHING_MODEL.vocabularySize,
        outputCount: TEACHING_MODEL.vocabularySize,
      },
      whyItMatters:
        "This is the actual dimension-changing operation from model width 8 to vocabulary width 16.",
      commonMisconceptions: [
        "The scan is a replay metaphor for one matrix multiply, not sixteen sequential model steps.",
        "No softmax happens here; the outputs are still unbounded scores.",
      ],
      relatedTargetIds: [
        "vocab:hidden-input",
        "vocab:weight-matrix",
        "vocab:accumulators",
      ],
      explanationByMode: explanationByMode(
        "The hidden vector sweeps the whole wall, sending one stream of products toward each candidate token.",
        "All sixteen output columns use the same input row in one matrix multiplication.",
        "The operation computes sixteen dot products, each with eight multiply-add terms.",
        "pre_bias_scores = torch.matmul(h, W_vocab)",
      ),
    },
    {
      id: "vocab:accumulators",
      stationId: "vocabulary-projection",
      kind: "component",
      label: "Sixteen vocabulary accumulators",
      aliases: ["logit accumulators", "column sums", "sixteen sum cups"],
      summary:
        "One accumulator collects the eight products belonging to each vocabulary column.",
      role:
        "It reduces the eight feature contributions into sixteen pre-bias scalar scores.",
      inputs: ["Eight products for each of sixteen vocabulary columns"],
      operation: "Sum feature products independently for every vocabulary entry.",
      outputs: ["Pre-bias score vector s[16]"],
      formula: "s_j = Σ_i h_i W_vocab[i,j]",
      shape: "16 scalar accumulators",
      exactValues: {
        accumulatorCount: TEACHING_MODEL.vocabularySize,
        termsPerAccumulator: TEACHING_MODEL.modelWidth,
      },
      whyItMatters:
        "The separate accumulators make clear that every vocabulary entry receives its own score.",
      commonMisconceptions: [
        "The sixteen accumulators are output activations, not sixteen sets of learned parameters.",
        "They do not normalize or choose a winning token.",
      ],
      relatedTargetIds: [
        "vocab:matrix-multiply",
        "vocab:weight-matrix",
        "vocab:bias",
        "vocab:logit-output",
      ],
      explanationByMode: explanationByMode(
        "Sixteen cups gather the evidence, one cup for each possible next token.",
        "Each accumulator reduces eight products to one scalar while preserving the vocabulary axis.",
        "Eight terms sum into each s_j; together the s_j form a [16] vector.",
        "pre_bias_scores = (h[:, None] * W_vocab).sum(dim=0)",
      ),
    },
    {
      id: "vocab:bias",
      stationId: "vocabulary-projection",
      kind: "component",
      label: "Vocabulary bias b_vocab",
      aliases: ["output bias", "logit bias", "b vocab"],
      summary:
        "A learned length-16 bias adds one offset to each vocabulary score after the matrix multiply.",
      role:
        "It lets each token's score learn a baseline offset independent of the current hidden activation.",
      inputs: ["Pre-bias scores s[16]", "Learned b_vocab[16]"],
      operation: "Add the matching bias entry to each vocabulary score.",
      outputs: ["Raw logits g[16]"],
      formula: "g = s + b_vocab",
      shape: "[16] + [16] → [16]",
      exactValues: {
        biasCount: TEACHING_MODEL.vocabularySize,
        displayedValues: "symbolic",
      },
      whyItMatters:
        "The bias completes this teaching model's untied, biased vocabulary head.",
      commonMisconceptions: [
        "The bias has one learned scalar per vocabulary entry, not one per hidden feature.",
        "Many real architectures omit this bias, but this teaching trace includes it.",
      ],
      relatedTargetIds: [
        "vocab:accumulators",
        "vocab:logit-output",
        "vocab:weight-matrix",
      ],
      explanationByMode: explanationByMode(
        "A final learned offset is added to each candidate's accumulated evidence.",
        "b_vocab is a stationary learned [16] parameter vector shared across all batch positions.",
        "g_j = s_j + b_vocab[j].",
        "logits = pre_bias_scores + b_vocab",
      ),
    },
    {
      id: "vocab:logit-output",
      stationId: "vocabulary-projection",
      kind: "component",
      label: "Selected raw-logit vector",
      aliases: ["raw logits output", "vocabulary scores", "G row"],
      summary: `The selected position produces sixteen exact signed scores; '${selectedTargetToken}' is highlighted, but no probability normalization has happened yet.`,
      role:
        "It is the vocabulary projection's output for batch 0, position 2 and the input to the next chamber's softmax demonstration.",
      inputs: ["Sixteen accumulated dot products", "b_vocab[16]"],
      operation: "Collect the biased scores in vocabulary order.",
      outputs: ["Raw logits g[16] for softmax and loss"],
      formula: "g = h W_vocab + b_vocab",
      shape: "[16] selected row; [2,6,16] for the full batch",
      exactValues: {
        vocabulary: [...SELECTED_TRACE.vocabulary],
        logits: [...selectedLogits],
        selectedTargetIndex: SELECTED_TRACE.batch.selectedTargetTokenId,
        selectedTargetToken,
      },
      whyItMatters:
        "These scores contain the model's relative preference over every next-token candidate before softmax converts them to probabilities.",
      commonMisconceptions: [
        "Logits may be negative and do not sum to one.",
        "Highlighting the correct target is supervision for inspection; it does not mean the model already chose that token.",
      ],
      relatedTargetIds: [
        "vocab:accumulators",
        "vocab:bias",
        "logits:raw-logits",
        "station:logits",
      ],
      explanationByMode: explanationByMode(
        `Sixteen candidate scores emerge; '${selectedTargetToken}' is the supervised answer, while softmax in the next chamber will reveal the model's confidence.`,
        "This selected [16] row is one slice of the full [2,6,16] logit tensor.",
        `g[${SELECTED_TRACE.batch.selectedTargetTokenId}] = ${selectedLogits[
          SELECTED_TRACE.batch.selectedTargetTokenId
        ].toFixed(9)} for '${selectedTargetToken}'.`,
        "logits = h @ W_vocab + b_vocab",
      ),
    },
  ];

function worldMetadata(
  targetId: string,
  stationId: string,
  canonicalObjectName: string,
  containsTokenSets: readonly (readonly string[])[],
  standOffDistance: number,
  verticalOffset: number,
): AssistantTargetWorldMetadata {
  return {
    targetId,
    stationId,
    matching: {
      canonicalObjectName,
      exactObjectNames: [canonicalObjectName],
      containsTokenSets,
    },
    anchor: {
      preferredSide: "target-front",
      standOffDistance,
      verticalOffset,
      lookAt: "target-bounds-center",
      pointAt: "target-bounds-center",
    },
  };
}

export const FORWARD_EXPANSION_WORLD_METADATA: readonly AssistantTargetWorldMetadata[] =
  [
    worldMetadata(
      "final-hidden:input-tensor",
      "final-hidden-state",
      "assistant-target-final-hidden-input-tensor",
      [["final", "hidden", "input"], ["contextual", "pods"]],
      3.2,
      0.8,
    ),
    worldMetadata(
      "final-hidden:selected-input",
      "final-hidden-state",
      "assistant-target-final-hidden-selected-input",
      [["selected", "hidden", "input"]],
      2.4,
      0.45,
    ),
    worldMetadata(
      "final-hidden:layer-norm",
      "final-hidden-state",
      "assistant-target-final-hidden-layernorm",
      [["final", "hidden", "layernorm"], ["norm", "ring"]],
      3,
      1,
    ),
    worldMetadata(
      "final-hidden:centered-vector",
      "final-hidden-state",
      "assistant-target-final-hidden-centered-vector",
      [["centered", "vector"]],
      2.4,
      0.45,
    ),
    worldMetadata(
      "final-hidden:normalized-vector",
      "final-hidden-state",
      "assistant-target-final-hidden-normalized-vector",
      [["normalized", "vector"]],
      2.5,
      0.45,
    ),
    worldMetadata(
      "final-hidden:output-tensor",
      "final-hidden-state",
      "assistant-target-final-hidden-output-tensor",
      [["final", "hidden", "output"]],
      3,
      0.75,
    ),
    worldMetadata(
      "vocab:hidden-input",
      "vocabulary-projection",
      "assistant-target-vocab-hidden-input",
      [["vocab", "hidden", "input"]],
      2.5,
      0.45,
    ),
    worldMetadata(
      "vocab:weight-matrix",
      "vocabulary-projection",
      "assistant-target-vocab-weight-matrix",
      [["vocab", "weight", "matrix"]],
      3.4,
      0.9,
    ),
    worldMetadata(
      "vocab:matrix-multiply",
      "vocabulary-projection",
      "assistant-target-vocab-matrix-multiply",
      [["vocab", "matrix", "multiply"], ["product", "packet"]],
      2.8,
      0.8,
    ),
    worldMetadata(
      "vocab:accumulators",
      "vocabulary-projection",
      "assistant-target-vocab-accumulators",
      [["vocab", "accumulators"]],
      3,
      0.8,
    ),
    worldMetadata(
      "vocab:bias",
      "vocabulary-projection",
      "assistant-target-vocab-bias",
      [["vocab", "bias"]],
      2.5,
      0.45,
    ),
    worldMetadata(
      "vocab:logit-output",
      "vocabulary-projection",
      "assistant-target-vocab-logit-output",
      [["vocab", "logit", "output"]],
      3,
      0.65,
    ),
  ];
