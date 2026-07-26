import type { ChamberProcessBeat } from "./componentProcesses";

export const FORWARD_EXPANSION_PROCESS_BEATS: readonly ChamberProcessBeat[] = [
  {
    id: "final-hidden-state:receive-context",
    stationId: "final-hidden-state",
    label: "Receive the final block states",
    startProgress: 0.04,
    endProgress: 0.34,
    cause:
      "Transformer block 1 has completed its contextual update for every batch-position row.",
    result:
      "The H² tensor and selected width-8 row enter the final normalization path.",
    targetIds: [
      "final-hidden:input-tensor",
      "final-hidden:selected-input",
      "final-hidden:layer-norm",
    ],
    auxiliarySceneKeys: [],
  },
  {
    id: "final-hidden-state:center-features",
    stationId: "final-hidden-state",
    label: "Center the selected feature row",
    startProgress: 0.22,
    endProgress: 0.62,
    cause:
      "LayerNorm must remove the selected row's shared feature offset before rescaling it.",
    result:
      "Subtracting the eight-feature mean produces the centered intermediate vector.",
    targetIds: [
      "final-hidden:selected-input",
      "final-hidden:layer-norm",
      "final-hidden:centered-vector",
    ],
    auxiliarySceneKeys: [],
  },
  {
    id: "final-hidden-state:rescale-and-affine",
    stationId: "final-hidden-state",
    label: "Rescale and apply learned gain and bias",
    startProgress: 0.4,
    endProgress: 0.84,
    cause:
      "The centered row still needs variance normalization and the learned γ_f and β_f transform.",
    result:
      "The selected row becomes a calibrated width-8 H_final activation.",
    targetIds: [
      "final-hidden:centered-vector",
      "final-hidden:layer-norm",
      "final-hidden:normalized-vector",
    ],
    auxiliarySceneKeys: [],
  },
  {
    id: "final-hidden-state:emit-final-hidden",
    stationId: "final-hidden-state",
    label: "Collect and emit H_final",
    startProgress: 0.68,
    endProgress: 0.99,
    cause:
      "All twelve H² rows have passed independently through the shared final LayerNorm.",
    result:
      "H_final[2,6,8] continues to the vocabulary projection.",
    targetIds: [
      "final-hidden:normalized-vector",
      "final-hidden:output-tensor",
    ],
    auxiliarySceneKeys: [],
  },
  {
    id: "vocabulary-projection:dock-hidden-row",
    stationId: "vocabulary-projection",
    label: "Dock the selected hidden row at W_vocab",
    startProgress: 0.05,
    endProgress: 0.28,
    cause:
      "The selected H_final row must be compared with every learned vocabulary column.",
    result:
      "The width-8 activation aligns with the untied [8,16] vocabulary matrix.",
    targetIds: [
      "vocab:hidden-input",
      "vocab:weight-matrix",
      "vocab:matrix-multiply",
    ],
    auxiliarySceneKeys: [],
  },
  {
    id: "vocabulary-projection:multiply-columns",
    stationId: "vocabulary-projection",
    label: "Multiply across all vocabulary columns",
    startProgress: 0.19,
    endProgress: 0.64,
    cause:
      "Each of the sixteen vocabulary entries needs a dot product with the same hidden row.",
    result:
      "Product streams travel from W_vocab toward sixteen independent accumulators.",
    targetIds: [
      "vocab:hidden-input",
      "vocab:weight-matrix",
      "vocab:matrix-multiply",
      "vocab:accumulators",
    ],
    auxiliarySceneKeys: [],
  },
  {
    id: "vocabulary-projection:accumulate-products",
    stationId: "vocabulary-projection",
    label: "Accumulate sixteen dot products",
    startProgress: 0.25,
    endProgress: 0.68,
    cause:
      "The eight feature-wise products for each vocabulary column must reduce to one score.",
    result:
      "Sixteen pre-bias scalar scores are ready for their learned offsets.",
    targetIds: [
      "vocab:matrix-multiply",
      "vocab:accumulators",
      "vocab:bias",
    ],
    auxiliarySceneKeys: [],
  },
  {
    id: "vocabulary-projection:add-bias",
    stationId: "vocabulary-projection",
    label: "Add the vocabulary bias",
    startProgress: 0.51,
    endProgress: 0.84,
    cause:
      "This teaching model's output head includes one learned bias for each vocabulary entry.",
    result:
      "Adding b_vocab converts the accumulated dot products into raw logits.",
    targetIds: [
      "vocab:accumulators",
      "vocab:bias",
      "vocab:logit-output",
    ],
    auxiliarySceneKeys: [],
  },
  {
    id: "vocabulary-projection:emit-logits",
    stationId: "vocabulary-projection",
    label: "Emit the selected logit row",
    startProgress: 0.66,
    endProgress: 0.99,
    cause:
      "The matrix product and bias addition are complete for the selected position.",
    result:
      "The exact sixteen-score vector continues to the logits and softmax chamber.",
    targetIds: ["vocab:bias", "vocab:logit-output"],
    auxiliarySceneKeys: [],
  },
];
