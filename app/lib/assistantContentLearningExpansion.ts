import type {
  AssistantTargetContext,
  AssistantTargetWorldMetadata,
} from "./assistantContext";
import { SELECTED_TRACE } from "./trainingTrace";

const targetIndex = SELECTED_TRACE.batch.selectedTargetTokenId;
const selectedProbabilities = SELECTED_TRACE.output.selectedProbabilities;
const oneHotTarget = selectedProbabilities.map((_, index) =>
  index === targetIndex ? 1 : 0,
);
const probabilityDifference = selectedProbabilities.map(
  (value, index) => value - oneHotTarget[index],
);
const selectedLogitGradient = probabilityDifference.map(
  (value) => value / 12,
);

function worldMetadata(
  targetId: string,
  stationId: string,
  canonicalObjectName: string,
  aliases: readonly string[],
  containsTokenSets: readonly (readonly string[])[],
  preferredSide: AssistantTargetWorldMetadata["anchor"]["preferredSide"] = "target-front",
): AssistantTargetWorldMetadata {
  return {
    targetId,
    stationId,
    matching: {
      canonicalObjectName,
      exactObjectNames: [canonicalObjectName, ...aliases],
      containsTokenSets,
    },
    anchor: {
      preferredSide,
      standOffDistance: 2.6,
      verticalOffset: 0.5,
      lookAt: "target-bounds-center",
      pointAt: "target-bounds-center",
    },
  };
}

export const LEARNING_EXPANSION_COMPONENT_TARGETS: AssistantTargetContext[] = [
  {
    id: "target-comparison:prediction-distribution",
    stationId: "target-comparison",
    kind: "component",
    label: "Selected prediction distribution",
    aliases: ["prediction row", "p of 16", "selected probabilities"],
    summary:
      "This sixteen-value row is the model's already-computed probability distribution for batch 0, position 2.",
    role:
      "It supplies the candidate probabilities from which the data target selects the one probability assigned to the correct next token.",
    inputs: [
      "The selected position's sixteen vocabulary logits after softmax",
    ],
    operation:
      "Hold one probability for every vocabulary ID while the answer remains outside the model.",
    outputs: [
      "A sixteen-class probability distribution",
      "The candidate at target ID 5 for the gather operation",
    ],
    formula: "p = softmax(logits)",
    shape: "p[16] for batch 0, position 2",
    exactValues: {
      batch: SELECTED_TRACE.batch.selectedBatch,
      position: SELECTED_TRACE.batch.selectedPosition,
      probabilities: selectedProbabilities,
      selectedTargetId: targetIndex,
      selectedTargetProbability:
        SELECTED_TRACE.output.selectedCorrectProbability,
    },
    whyItMatters:
      "The loss can only evaluate the model after prediction is complete, so this board is the boundary between model output and supervision.",
    commonMisconceptions: [
      "The highlighted probability was not forced by the answer; it was produced before the target arrived.",
      "The sixteen values are temporary activations, not learned parameters.",
    ],
    relatedTargetIds: [
      "target-comparison:answer-id",
      "target-comparison:gather-operation",
      "station:logits",
    ],
    explanationByMode: {
      story:
        "The model has laid out sixteen bets; the answer tray will point to the bet that belongs to the real next token.",
      structure:
        "One selected [16] softmax row is held fixed while the target ID crosses into the chamber.",
      math:
        "p has sixteen nonnegative entries summing to one; here p[5]=0.28.",
      code:
        "probabilities = softmax(logits[0, 2, :], dim=-1)",
    },
  },
  {
    id: "target-comparison:answer-id",
    stationId: "target-comparison",
    kind: "component",
    label: "Ground-truth answer ID",
    aliases: ["target tray", "answer tray", "target ID 5", "sat target"],
    summary:
      "The data pipeline supplies token ID 5, 'sat', as the correct next token for the selected position.",
    role:
      "It acts as an address into the prediction distribution; it does not alter or recompute the model's probabilities.",
    inputs: [
      "The shifted target row Y from the training batch",
      "Batch 0, supervised position 2",
    ],
    operation:
      "Carry the correct vocabulary index to the matching probability cell.",
    outputs: ["Target index 5 used by the gather"],
    formula: "y = Y[0,2] = 5",
    shape: "one integer target address",
    exactValues: {
      batch: SELECTED_TRACE.batch.selectedBatch,
      position: SELECTED_TRACE.batch.selectedPosition,
      targetTokenId: targetIndex,
      targetToken: SELECTED_TRACE.vocabulary[targetIndex],
    },
    whyItMatters:
      "Supervision identifies which candidate should be rewarded without leaking the answer into the forward prediction.",
    commonMisconceptions: [
      "The target enters after prediction; it is not an input token at this position.",
      "ID 5 is a categorical address, not a numeric score.",
    ],
    relatedTargetIds: [
      "target-comparison:prediction-distribution",
      "target-comparison:gather-operation",
      "station:batch-shifted-targets",
    ],
    explanationByMode: {
      story:
        "Only after the model commits its bets does the answer card arrive: the next token should be 'sat'.",
      structure:
        "The scalar target ID aligns with one batch-position pair and addresses column 5 of its vocabulary row.",
      math: "y=5, so the selected probability is p_y=p[5].",
      code: "target_id = targets[0, 2]  # 5",
    },
  },
  {
    id: "target-comparison:gather-operation",
    stationId: "target-comparison",
    kind: "component",
    label: "Correct-class gather",
    aliases: ["gather ID 5", "probability lookup", "p of sat"],
    summary:
      "The gather uses target ID 5 to retrieve the model probability assigned to 'sat' at the selected position.",
    role:
      "It joins the externally supplied answer with the already-computed prediction row and reduces sixteen candidates to the supervised candidate.",
    inputs: [
      "Prediction distribution p[16]",
      "Ground-truth vocabulary ID 5",
    ],
    operation:
      "Index the prediction row at the target ID without changing the row.",
    outputs: ["p[sat] = 0.28 for the selected example"],
    formula: "p_correct[b,t] = p[b,t,Y[b,t]]",
    shape: "[16] plus scalar index -> scalar",
    exactValues: {
      targetTokenId: targetIndex,
      targetToken: SELECTED_TRACE.vocabulary[targetIndex],
      gatheredProbability:
        SELECTED_TRACE.output.selectedCorrectProbability,
    },
    whyItMatters:
      "Cross-entropy needs the probability of the correct class, not the largest probability or an average over classes.",
    commonMisconceptions: [
      "Gather is an indexing operation, not an argmax.",
      "A 0.28 correct-class probability can still be the row maximum; the loss nevertheless penalizes its uncertainty.",
    ],
    relatedTargetIds: [
      "target-comparison:prediction-distribution",
      "target-comparison:answer-id",
      "target-comparison:correct-probabilities",
    ],
    explanationByMode: {
      story:
        "The answer card lands on the 'sat' cell and lifts that one bet out for scoring.",
      structure:
        "The target index selects one vocabulary column from a single prediction row.",
      math: "gather(p,5)=p[5]=0.28.",
      code: "p_correct = probabilities.gather(-1, target_id[..., None])",
    },
  },
  {
    id: "target-comparison:correct-probabilities",
    stationId: "target-comparison",
    kind: "component",
    label: "Batch of correct-token probabilities",
    aliases: ["p correct board", "gathered probability matrix"],
    summary:
      "This two-by-six board contains one gathered correct-token probability for every supervised position in the batch.",
    role:
      "It collects all twelve independent gather results and hands them to the negative-log loss chamber.",
    inputs: [
      "Twelve prediction rows, each with sixteen candidates",
      "Twelve aligned target token IDs",
    ],
    operation:
      "Gather one correct-class probability for every batch and sequence position.",
    outputs: ["P_correct with twelve scalar probabilities"],
    formula: "P_correct[b,t] = P[b,t,Y[b,t]]",
    shape: "[2,6]",
    exactValues: {
      correctTokenProbabilities:
        SELECTED_TRACE.output.correctTokenProbabilities,
      selectedBatch: SELECTED_TRACE.batch.selectedBatch,
      selectedPosition: SELECTED_TRACE.batch.selectedPosition,
      selectedValue: SELECTED_TRACE.output.selectedCorrectProbability,
    },
    whyItMatters:
      "This board is the compact supervised view of the whole batch that cross-entropy transforms into twelve penalties.",
    commonMisconceptions: [
      "The board does not contain the maximum probability from each row unless that maximum happens to be the target.",
      "No averaging has happened yet.",
    ],
    relatedTargetIds: [
      "target-comparison:gather-operation",
      "station:loss",
    ],
    explanationByMode: {
      story:
        "Each of the twelve answer cards has now picked up its matching bet, filling a tray of probabilities ready for scoring.",
      structure:
        "The vocabulary axis has been gathered away, leaving the batch and sequence axes [2,6].",
      math:
        "P_correct is [2,6]; its selected entry is P_correct[0,2]=0.28.",
      code:
        "p_correct = probabilities.gather(-1, targets.unsqueeze(-1)).squeeze(-1)",
    },
  },

  {
    id: "output-backprop:probabilities",
    stationId: "output-backprop",
    kind: "component",
    label: "Softmax probability operand",
    aliases: ["p board", "probability operand", "selected softmax row"],
    summary:
      "This is the selected sixteen-class softmax row reused by the output-layer backward formula.",
    role:
      "It supplies the positive probability term in the cross-entropy derivative p minus one_hot(y).",
    inputs: ["The selected vocabulary logits from the forward pass"],
    operation: "Reuse the stored softmax probabilities during backward.",
    outputs: ["Probability operand p[16]"],
    formula: "p = softmax(logits)",
    shape: "[16] selected slice of [2,6,16]",
    exactValues: {
      probabilities: selectedProbabilities,
      selectedTargetId: targetIndex,
    },
    whyItMatters:
      "The derivative can be computed directly from the forward probabilities and the target, avoiding a full symbolic softmax Jacobian.",
    commonMisconceptions: [
      "Backward reuses these activations; it does not run a second prediction.",
      "The probabilities are not parameter gradients.",
    ],
    relatedTargetIds: [
      "output-backprop:one-hot-target",
      "output-backprop:difference",
      "station:target-comparison",
    ],
    explanationByMode: {
      story:
        "The same bets from the forward pass return as one side of the derivative subtraction.",
      structure:
        "One [16] activation row aligns elementwise with a [16] one-hot target row.",
      math: "p_i contributes positively to dL/dz_i for every class i.",
      code: "p = saved_softmax[0, 2, :]",
    },
  },
  {
    id: "output-backprop:one-hot-target",
    stationId: "output-backprop",
    kind: "component",
    label: "One-hot target operand",
    aliases: ["one hot target", "y board", "target vector"],
    summary:
      "Token ID 5 is expanded to a length-sixteen vector containing one at 'sat' and zero elsewhere.",
    role:
      "It supplies the correction term that makes the correct class gradient negative while leaving competitor terms positive.",
    inputs: ["Ground-truth token ID 5"],
    operation: "Encode the target index as a one-hot vector.",
    outputs: ["one_hot(y)[16]"],
    formula: "one_hot(y)_i = 1 if i=y, otherwise 0",
    shape: "[16]",
    exactValues: {
      targetTokenId: targetIndex,
      targetToken: SELECTED_TRACE.vocabulary[targetIndex],
      vector: oneHotTarget,
    },
    whyItMatters:
      "The one at the correct class is what changes its derivative from p_y to p_y minus one.",
    commonMisconceptions: [
      "The one-hot vector is constructed from the label; it is not a model output.",
      "It is a derivative operand, not a learned embedding.",
    ],
    relatedTargetIds: [
      "output-backprop:probabilities",
      "output-backprop:difference",
    ],
    explanationByMode: {
      story:
        "The answer becomes a row with one bright slot, ready to be subtracted from the model's bets.",
      structure:
        "A scalar class address becomes a dense [16] indicator aligned with the vocabulary axis.",
      math: "one_hot(5) has value 1 at index 5 and 0 elsewhere.",
      code: "y_one_hot = one_hot(target_id, num_classes=16)",
    },
  },
  {
    id: "output-backprop:difference",
    stationId: "output-backprop",
    kind: "component",
    label: "Probability-minus-target difference",
    aliases: ["p minus one hot", "difference board", "unaveraged logit gradient"],
    summary:
      "Elementwise subtraction produces the per-position cross-entropy derivative before the batch-position mean is applied.",
    role:
      "It assigns a negative correction to the correct logit and positive pressure to competing logits.",
    inputs: ["Softmax probabilities p[16]", "One-hot target [16]"],
    operation: "Subtract the one-hot target elementwise from p.",
    outputs: ["p - one_hot(y), length 16"],
    formula: "d(CE)/dz = p - one_hot(y)",
    shape: "[16]",
    exactValues: {
      difference: probabilityDifference,
      selectedTargetDifference: probabilityDifference[targetIndex],
      competitorIndex: 6,
      selectedCompetitorDifference: probabilityDifference[6],
    },
    whyItMatters:
      "This compact identity is the central signal that tells the output layer which logit to raise and which competitors to lower.",
    commonMisconceptions: [
      "The correct-class entry is negative because 0.28-1=-0.72; negative does not mean an invalid probability.",
      "The displayed vector is still for one position and has not yet been divided by twelve.",
    ],
    relatedTargetIds: [
      "output-backprop:probabilities",
      "output-backprop:one-hot-target",
      "output-backprop:mean-logit-gradient",
    ],
    explanationByMode: {
      story:
        "Subtracting the answer marks the correct class for an upward logit adjustment while competitors receive downward pressure.",
      structure:
        "Two aligned [16] rows produce one [16] derivative row before reduction scaling.",
      math: "At 'sat', 0.28-1=-0.72; at 'on', 0.16-0=0.16.",
      code: "difference = probabilities - one_hot_target",
    },
  },
  {
    id: "output-backprop:mean-logit-gradient",
    stationId: "output-backprop",
    kind: "component",
    label: "Mean-loss logit gradient",
    aliases: ["dG board", "logit gradient", "divided gradient"],
    summary:
      "The selected difference row is divided by twelve because the scalar loss is the mean over twelve supervised positions.",
    role:
      "It is the gradient with respect to the selected vocabulary-logit row that feeds both activation and parameter branches.",
    inputs: ["p - one_hot(y) for the selected position", "Mean divisor 12"],
    operation: "Scale every class derivative by one twelfth.",
    outputs: ["Selected slice of dL/dG with sixteen entries"],
    formula: "dL/dG[b,t,:] = (p[b,t,:] - one_hot(Y[b,t])) / 12",
    shape: "[16] selected slice of [2,6,16]",
    exactValues: {
      meanDivisor: 12,
      gradient: selectedLogitGradient,
      selectedTargetGradient:
        SELECTED_TRACE.output.selectedTargetLogitGradient,
      competitorIndex: 6,
      selectedCompetitorGradient:
        SELECTED_TRACE.output.selectedCompetitorLogitGradient,
    },
    whyItMatters:
      "The averaging factor controls the scale of every downstream gradient for this loss.",
    commonMisconceptions: [
      "Dividing by twelve comes from the loss reduction, not from vocabulary size sixteen.",
      "The sixteen entries of a softmax-cross-entropy row sum to approximately zero.",
    ],
    relatedTargetIds: [
      "output-backprop:difference",
      "output-backprop:gradient-fork",
      "output-backprop:hidden-state-gradient",
      "output-backprop:vocabulary-weight-gradient",
      "output-backprop:vocabulary-bias-gradient",
    ],
    explanationByMode: {
      story:
        "The derivative is shared fairly across the twelve supervised positions before it travels backward.",
      structure:
        "The vocabulary axis stays length sixteen; only every entry's scale changes.",
      math:
        "The selected target entry is -0.72/12=-0.06 and competitor 6 is 0.16/12=0.013333333.",
      code: "d_logits = (probabilities - one_hot_targets) / 12",
    },
  },
  {
    id: "output-backprop:gradient-fork",
    stationId: "output-backprop",
    kind: "component",
    label: "Reverse-mode gradient fork",
    aliases: ["copy fork", "gradient copy", "three backward branches"],
    summary:
      "The same logit-gradient tensor is consumed by the activation, vocabulary-weight, and vocabulary-bias derivative rules of the output head.",
    role:
      "It routes dG to the hidden-state gradient and to both learned parameter gradients of this teaching model's biased vocabulary head.",
    inputs: ["dG with shape [2,6,16]"],
    operation:
      "Expose the same upstream gradient to the activation, matrix-parameter, and bias-parameter derivative rules.",
    outputs: [
      "Activation gradient dH",
      "Vocabulary projection gradient dW_vocab",
      "Vocabulary bias gradient db_vocab",
    ],
    formula:
      "G=H W+b -> dH=dG W^T, dW=H^T dG, db=sum_(b,t) dG",
    shape: "[2,6,16] fans out to [2,6,8], [8,16], and [16]",
    exactValues: {
      activationGradientShape: [2, 6, 8],
      parameterGradientShape: [8, 16],
      biasGradientShape: [16],
      numericBranchValuesAvailable: false,
    },
    whyItMatters:
      "Reverse-mode differentiation must propagate responsibility to the input activation and to both learned parameters of the affine vocabulary head.",
    commonMisconceptions: [
      "The fork does not divide the gradient; all three derivative rules use the same upstream dG.",
      "Copying a gradient for three consumers is not another model forward pass.",
    ],
    relatedTargetIds: [
      "output-backprop:mean-logit-gradient",
      "output-backprop:hidden-state-gradient",
      "output-backprop:vocabulary-weight-gradient",
      "output-backprop:vocabulary-bias-gradient",
    ],
    explanationByMode: {
      story:
        "One error signal reaches a junction: one copy continues into the tower while two others record how the output weights and bias were responsible.",
      structure:
        "The affine vocabulary head has activation H plus learned W_vocab and b_vocab inputs, so backward emits one gradient for each.",
      math:
        "dH=dG W_vocab^T; dW_vocab=H^T dG; db_vocab=sum_(b,t) dG.",
      code:
        "d_h = d_logits @ w_vocab.T; d_w_vocab = h.T @ d_logits; d_b_vocab = d_logits.sum((0, 1))",
    },
  },
  {
    id: "output-backprop:hidden-state-gradient",
    stationId: "output-backprop",
    kind: "component",
    label: "Final hidden-state gradient",
    aliases: ["dH board", "activation gradient", "tower input gradient"],
    summary:
      "This branch carries the loss gradient from the vocabulary projection back into the final hidden states.",
    role:
      "It is the activation-gradient input to final-layer normalization and then the two-block reverse tower.",
    inputs: ["Logit gradient dG[2,6,16]", "W_vocab transposed"],
    operation: "Multiply dG by W_vocab transposed.",
    outputs: ["dH_final[2,6,8]"],
    formula: "dH_final = dG W_vocab^T",
    shape: "[2,6,16] x [16,8] -> [2,6,8]",
    exactValues: {
      shape: [2, 6, 8],
      displayedNumericValuesAvailable: false,
    },
    whyItMatters:
      "This is how output prediction error reaches all earlier activation-producing layers.",
    commonMisconceptions: [
      "dH is a temporary activation gradient, not a stored model parameter.",
      "The scene intentionally marks its numeric entries unknown; only the shape and operation are grounded.",
    ],
    relatedTargetIds: [
      "output-backprop:mean-logit-gradient",
      "output-backprop:gradient-fork",
      "output-backprop:vocabulary-weight-gradient",
      "output-backprop:vocabulary-bias-gradient",
      "backprop-through-tower:incoming-gradient",
    ],
    explanationByMode: {
      story:
        "This branch carries the prediction error back through the model's hidden-state highway.",
      structure:
        "Contracting the vocabulary dimension sixteen leaves model width eight at every batch-position.",
      math: "dH_final[b,t,:]=dG[b,t,:] W_vocab^T.",
      code: "d_h_final = d_logits @ w_vocab.transpose(-1, -2)",
    },
  },
  {
    id: "output-backprop:vocabulary-weight-gradient",
    stationId: "output-backprop",
    kind: "component",
    label: "Vocabulary projection weight gradient",
    aliases: ["dW board", "dW vocab", "output matrix gradient"],
    summary:
      "This branch accumulates how every final hidden feature contributed to every vocabulary-logit error.",
    role:
      "It produces the gradient for the learned output projection matrix while the parameter itself remains unchanged.",
    inputs: ["Final hidden states H[2,6,8]", "Logit gradient dG[2,6,16]"],
    operation:
      "Contract over all twelve batch-position examples using H transposed times dG.",
    outputs: ["dW_vocab[8,16]"],
    formula: "dW_vocab = H^T dG",
    shape: "[8,12] x [12,16] -> [8,16]",
    exactValues: {
      shape: [8, 16],
      displayedSliceShape: [4, 4],
      displayedNumericValuesAvailable: false,
    },
    whyItMatters:
      "The optimizer later needs one accumulated gradient for every learned output weight.",
    commonMisconceptions: [
      "Computing dW does not update W_vocab; the optimizer applies changes later.",
      "The shown four-by-four area is an unknown slice, not the full matrix.",
    ],
    relatedTargetIds: [
      "output-backprop:mean-logit-gradient",
      "output-backprop:gradient-fork",
      "output-backprop:hidden-state-gradient",
      "output-backprop:vocabulary-bias-gradient",
      "station:parameter-matrix",
    ],
    explanationByMode: {
      story:
        "The other fork branch fills a responsibility ledger for the output matrix's learned connections.",
      structure:
        "Batch and time flatten to twelve examples and are summed away, leaving [8,16].",
      math: "dW_vocab[i,j]=sum_(b,t) H[b,t,i] dG[b,t,j].",
      code: "d_w_vocab = einsum('bti,btj->ij', h_final, d_logits)",
    },
  },
  {
    id: "output-backprop:vocabulary-bias-gradient",
    stationId: "output-backprop",
    kind: "component",
    label: "Vocabulary projection bias gradient",
    aliases: ["db board", "db vocab", "output bias gradient"],
    summary:
      "This branch sums the logit gradient over all twelve batch-position examples to obtain one derivative for each learned vocabulary-bias entry.",
    role:
      "It completes the backward rule for this teaching model's biased vocabulary head while leaving b_vocab unchanged until optimization.",
    inputs: ["Logit gradient dG[2,6,16]"],
    operation:
      "Reduce the batch and sequence axes, retaining the sixteen-class vocabulary axis.",
    outputs: ["db_vocab[16]"],
    formula: "db_vocab = sum_(b,t) dG[b,t,:]",
    shape: "[2,6,16] -> [16]",
    exactValues: {
      shape: [16],
      selectedPositionContribution: selectedLogitGradient,
      fullBatchGradientValuesAvailable: false,
    },
    whyItMatters:
      "Because the forward head includes a learned bias, reverse-mode differentiation must produce its gradient as well as dH and dW_vocab.",
    commonMisconceptions: [
      "The selected dG row is only one of twelve contributions to db_vocab, so it is not the full bias gradient.",
      "Computing db_vocab does not update b_vocab; the optimizer applies that change later.",
    ],
    relatedTargetIds: [
      "output-backprop:mean-logit-gradient",
      "output-backprop:gradient-fork",
      "output-backprop:hidden-state-gradient",
      "output-backprop:vocabulary-weight-gradient",
      "vocab:bias",
      "station:parameter-matrix",
    ],
    explanationByMode: {
      story:
        "The third fork branch collects one error receipt per vocabulary class from every supervised position.",
      structure:
        "Summing away batch and time turns [2,6,16] into one length-sixteen bias-gradient vector.",
      math: "db_vocab[j]=sum_(b,t) dG[b,t,j].",
      code: "d_b_vocab = d_logits.sum(dim=(0, 1))",
    },
  },

  {
    id: "backprop-through-tower:incoming-gradient",
    stationId: "backprop-through-tower",
    kind: "component",
    label: "Incoming final-state gradient",
    aliases: ["dH final", "tower input gradient", "incoming dH"],
    summary:
      "The output projection sends this activation gradient into the model tower in reverse order.",
    role:
      "It is the upstream signal consumed first by final layer normalization and then by block 1 and block 0.",
    inputs: ["dG[2,6,16]", "W_vocab transposed"],
    operation:
      "Arrive from dH_final=dG W_vocab^T and seed the reverse traversal.",
    outputs: ["Upstream gradient for final-layer normalization"],
    formula: "dH_final = dG W_vocab^T",
    shape: "[2,6,8]",
    exactValues: {
      shape: [2, 6, 8],
      displayedNumericValuesAvailable: false,
      reverseOrder: ["LN_f", "block 1", "block 0", "embeddings"],
    },
    whyItMatters:
      "Backpropagation starts from the loss and must traverse the forward graph in exactly the opposite dependency order.",
    commonMisconceptions: [
      "This is a gradient with respect to an activation, not the activation itself.",
      "Its values are not supplied by the teaching trace, so the scene shows neutral unknown cells.",
    ],
    relatedTargetIds: [
      "output-backprop:hidden-state-gradient",
      "backprop-through-tower:final-norm-backward",
    ],
    explanationByMode: {
      story:
        "The error signal enters at the roof of the model and begins descending through the layers in reverse.",
      structure:
        "One width-eight gradient exists for every one of the twelve batch-position states.",
      math: "dH_final has shape [2,6,8] and is the cotangent entering LN_f.",
      code: "grad_h = d_logits @ w_vocab.T",
    },
  },
  {
    id: "backprop-through-tower:final-norm-backward",
    stationId: "backprop-through-tower",
    kind: "component",
    label: "Final layer-norm backward stage",
    aliases: ["LN f backward", "final norm gradient", "dLN f rack"],
    summary:
      "The final normalization is the last forward transform before logits, so it is the first model-internal transform reversed.",
    role:
      "It propagates the activation gradient to block 1 output and accumulates gradients for the final norm scale and bias.",
    inputs: [
      "Incoming dH_final[2,6,8]",
      "Saved final-layer-normalization intermediates",
    ],
    operation:
      "Apply the transpose Jacobian of LN_f and reduce parameter-gradient contributions over batch and time.",
    outputs: [
      "Gradient entering block 1",
      "d gamma_f and d beta_f parameter gradients",
    ],
    formula: "dH2 = J_LNf^T dH_final",
    shape: "[2,6,8] -> [2,6,8], plus two [8] parameter gradients",
    exactValues: {
      activationShape: [2, 6, 8],
      parameterGradientNames: ["d gamma_f", "d beta_f"],
      displayedNumericValuesAvailable: false,
    },
    whyItMatters:
      "Skipping this stage would break the chain rule and omit gradients for the final normalization parameters.",
    commonMisconceptions: [
      "Layer-norm backward is not simply multiplying by gamma; centering and variance dependencies also contribute.",
      "The gradient rack collects values now, but no parameter is updated in this chamber.",
    ],
    relatedTargetIds: [
      "backprop-through-tower:incoming-gradient",
      "backprop-through-tower:block-1-mlp-backward",
    ],
    explanationByMode: {
      story:
        "The descending signal first passes backward through the final calibration gate and leaves a gradient receipt for its scale and bias.",
      structure:
        "The activation shape stays [2,6,8], while reductions create width-eight gamma and beta gradients.",
      math: "dH2=J_LNf^T dH_final, with dgamma_f and dbeta_f summed over b,t.",
      code: "grad_h2, d_gamma_f, d_beta_f = layer_norm_backward(grad_h_final, cache_f)",
    },
  },
  {
    id: "backprop-through-tower:block-1-mlp-backward",
    stationId: "backprop-through-tower",
    kind: "component",
    label: "Block 1 MLP residual backward",
    aliases: ["MLP 1 backward", "block 1 LN2 backward", "dW MLP 1"],
    summary:
      "The block 1 output residual add copies its gradient to the identity path and the MLP-plus-LN2 path, then merges their input gradients.",
    role:
      "It propagates responsibility through the second block's feed-forward sublayer and collects that sublayer's parameter gradients.",
    inputs: [
      "Gradient from final layer normalization",
      "Saved block 1 MLP and LN2 intermediates",
    ],
    operation:
      "Copy at the residual add, apply the MLP/LN2 transpose Jacobian on one copy, deposit parameter gradients, and sum both activation branches.",
    outputs: [
      "Merged gradient entering block 1 attention residual",
      "Block 1 MLP and LN2 parameter gradients",
    ],
    formula: "g_in = g_skip + J_(MLP1 o LN2)^T g",
    shape: "[2,6,8] -> [2,6,8] plus parameter-shaped gradients",
    exactValues: {
      block: 1,
      sublayer: "MLP plus LN2",
      activationShape: [2, 6, 8],
      displayedNumericValuesAvailable: false,
    },
    whyItMatters:
      "A residual add creates two causal paths, so the incoming gradient must reach both before their contributions are summed.",
    commonMisconceptions: [
      "The copied gradient is not split in half; each residual branch receives the full upstream gradient.",
      "The parameter-gradient rack stores accumulated gradients, not updated weights.",
    ],
    relatedTargetIds: [
      "backprop-through-tower:final-norm-backward",
      "backprop-through-tower:block-1-attention-backward",
    ],
    explanationByMode: {
      story:
        "At block 1's MLP add, the signal takes the skip road and the transformation road, leaves weight-gradient receipts, then reunites.",
      structure:
        "Residual addition fans one [2,6,8] cotangent into two equal-shaped branches and sums their returned input cotangents.",
      math: "g_before=g + J_(MLP1 o LN2)^T g.",
      code: "grad = grad + mlp1_ln2_backward(grad, saved_block1)",
    },
  },
  {
    id: "backprop-through-tower:block-1-attention-backward",
    stationId: "backprop-through-tower",
    kind: "component",
    label: "Block 1 attention residual backward",
    aliases: [
      "attention 1 backward",
      "block 1 LN1 backward",
      "dW attention 1",
    ],
    summary:
      "The next reverse bay handles block 1's attention residual add, its attention computation, and LN1.",
    role:
      "It sends the merged gradient into block 0 while collecting parameter gradients for block 1 attention and normalization.",
    inputs: [
      "Gradient leaving block 1 MLP backward",
      "Saved block 1 attention and LN1 intermediates",
    ],
    operation:
      "Copy at the residual add, reverse attention and LN1 on the transformed branch, collect parameter gradients, and merge.",
    outputs: [
      "Gradient entering block 0 output",
      "Block 1 attention and LN1 parameter gradients",
    ],
    formula: "g_in = g_skip + J_(Attn1 o LN1)^T g",
    shape: "[2,6,8] -> [2,6,8] plus parameter-shaped gradients",
    exactValues: {
      block: 1,
      sublayer: "attention plus LN1",
      activationShape: [2, 6, 8],
      displayedNumericValuesAvailable: false,
    },
    whyItMatters:
      "This stage carries the output error through all query, key, value, and output-projection dependencies of the upper attention layer.",
    commonMisconceptions: [
      "Attention backward follows the causal mask used in forward; it does not reveal future-token paths.",
      "The residual identity branch still contributes even though it has no learned matrix.",
    ],
    relatedTargetIds: [
      "backprop-through-tower:block-1-mlp-backward",
      "backprop-through-tower:block-0-mlp-backward",
    ],
    explanationByMode: {
      story:
        "The signal now reverses the upper attention detour, combines it with the untouched skip road, and drops into block 0.",
      structure:
        "The attention/LN1 Jacobian branch and identity branch preserve [2,6,8] at their merge.",
      math: "g_block0_out=g + J_(Attn1 o LN1)^T g.",
      code: "grad = grad + attention1_ln1_backward(grad, saved_block1)",
    },
  },
  {
    id: "backprop-through-tower:block-0-mlp-backward",
    stationId: "backprop-through-tower",
    kind: "component",
    label: "Block 0 MLP residual backward",
    aliases: ["MLP 0 backward", "block 0 LN2 backward", "dW MLP 0"],
    summary:
      "The lower block's MLP residual add repeats the copy, transformed-Jacobian, parameter-deposit, and merge pattern.",
    role:
      "It propagates the upper-block gradient through block 0's feed-forward sublayer and accumulates its parameter gradients.",
    inputs: [
      "Gradient arriving from block 1 attention backward",
      "Saved block 0 MLP and LN2 intermediates",
    ],
    operation:
      "Send one copy through MLP0 and LN2 backward, retain the identity copy, then add the two input-gradient contributions.",
    outputs: [
      "Merged gradient entering block 0 attention residual",
      "Block 0 MLP and LN2 parameter gradients",
    ],
    formula: "g_in = g_skip + J_(MLP0 o LN2)^T g",
    shape: "[2,6,8] -> [2,6,8] plus parameter-shaped gradients",
    exactValues: {
      block: 0,
      sublayer: "MLP plus LN2",
      activationShape: [2, 6, 8],
      displayedNumericValuesAvailable: false,
    },
    whyItMatters:
      "Even the earliest feed-forward weights need gradients influenced by the final loss.",
    commonMisconceptions: [
      "Block 0 is traversed after block 1 during backward because it ran before block 1 during forward.",
      "The identity and transformed gradients are summed, not concatenated.",
    ],
    relatedTargetIds: [
      "backprop-through-tower:block-1-attention-backward",
      "backprop-through-tower:block-0-attention-backward",
    ],
    explanationByMode: {
      story:
        "The descending signal repeats the two-road residual pattern through block 0's MLP and reunites one level lower.",
      structure:
        "A width-eight residual stream is maintained while parameter-shaped MLP and LN2 gradients peel off.",
      math: "g_before=g + J_(MLP0 o LN2)^T g.",
      code: "grad = grad + mlp0_ln2_backward(grad, saved_block0)",
    },
  },
  {
    id: "backprop-through-tower:block-0-attention-backward",
    stationId: "backprop-through-tower",
    kind: "component",
    label: "Block 0 attention residual backward",
    aliases: [
      "attention 0 backward",
      "block 0 LN1 backward",
      "dW attention 0",
    ],
    summary:
      "The final residual bay reverses the first attention sublayer and its LN1 normalization.",
    role:
      "It produces the gradient with respect to the original embedding-sum activations while accumulating block 0 attention gradients.",
    inputs: [
      "Gradient leaving block 0 MLP backward",
      "Saved block 0 attention and LN1 intermediates",
    ],
    operation:
      "Copy the residual gradient, reverse attention0 and LN1, collect parameter gradients, and merge with the skip copy.",
    outputs: [
      "dH0 entering embedding backward",
      "Block 0 attention and LN1 parameter gradients",
    ],
    formula: "dH0 = g_skip + J_(Attn0 o LN1)^T g",
    shape: "[2,6,8] -> [2,6,8] plus parameter-shaped gradients",
    exactValues: {
      block: 0,
      sublayer: "attention plus LN1",
      activationShape: [2, 6, 8],
      displayedNumericValuesAvailable: false,
    },
    whyItMatters:
      "This closes the Transformer-tower chain rule and hands responsibility back to the token and position embedding lookups.",
    commonMisconceptions: [
      "The gradient leaves the tower at H0; it has not yet been scattered into embedding-table rows.",
      "No future-attention edge is created during backward.",
    ],
    relatedTargetIds: [
      "backprop-through-tower:block-0-mlp-backward",
      "backprop-through-tower:embedding-gradient-output",
    ],
    explanationByMode: {
      story:
        "The error signal reverses the first attention detour, rejoins its skip path, and reaches the embedding floor.",
      structure:
        "The last residual merge returns a [2,6,8] cotangent aligned with H0.",
      math: "dH0=g + J_(Attn0 o LN1)^T g.",
      code: "d_h0 = grad + attention0_ln1_backward(grad, saved_block0)",
    },
  },
  {
    id: "backprop-through-tower:embedding-gradient-output",
    stationId: "backprop-through-tower",
    kind: "component",
    label: "Embedding-bound gradient output",
    aliases: ["dH0 output", "embedding gradient handoff", "tower exit"],
    summary:
      "The completed tower traversal emits one gradient for every original token-plus-position hidden vector.",
    role:
      "It hands the activation gradient to embedding backward after every participating tower parameter gradient has been accumulated.",
    inputs: ["Merged output of block 0 attention backward"],
    operation:
      "Expose dH0 at the boundary between the Transformer tower and the two embedding lookup tables.",
    outputs: [
      "Gradient contributions for token embeddings",
      "Gradient contributions for position embeddings",
    ],
    formula: "H0=E[token]+P[position] -> dE_rows += dH0; dP_rows += dH0",
    shape: "[2,6,8]",
    exactValues: {
      shape: [2, 6, 8],
      supervisedPositions: 12,
      displayedNumericValuesAvailable: false,
    },
    whyItMatters:
      "The training signal reaches the earliest learned representations only after the full reverse tower is complete.",
    commonMisconceptions: [
      "dH0 still contains per-position activation gradients; repeated token IDs must be accumulated into shared embedding rows next.",
      "Completing backward still does not move a weight.",
    ],
    relatedTargetIds: [
      "backprop-through-tower:block-0-attention-backward",
      "station:embedding",
      "station:parameter-matrix",
    ],
    explanationByMode: {
      story:
        "After every floor has left its gradient receipts, the remaining signal exits toward the token and position lookup tables.",
      structure:
        "The output stays [2,6,8], aligned one-for-one with the H0 activation tensor.",
      math:
        "Because H0 is a sum, its incoming cotangent is copied to both embedding operands before row accumulation.",
      code: "d_token_rows, d_position_rows = embedding_backward(d_h0, token_ids, positions)",
    },
  },

  {
    id: "parameter-matrix:wq-matrix",
    stationId: "parameter-matrix",
    kind: "component",
    label: "Block 0 query-projection matrix",
    aliases: ["WQ matrix", "query weight matrix", "block 0 attention WQ"],
    summary:
      "This eight-by-eight learned matrix projects normalized block 0 states into query features.",
    role:
      "It is the parameter store containing the selected scalar weight at row 3, column 6 and 63 unshown numeric cells.",
    inputs: ["Normalized hidden features of width 8 during forward"],
    operation:
      "Participate in N W_Q during forward and receive an accumulated matrix gradient during backward.",
    outputs: ["Query projection activations during forward", "Addressable parameter cells for optimization"],
    formula: "Q = N W_Q",
    shape: "W_Q[8,8]",
    exactValues: {
      parameterName: SELECTED_TRACE.optimizer.parameterName,
      rows: 8,
      columns: 8,
      selectedRow: 3,
      selectedColumn: 6,
      selectedWeight: SELECTED_TRACE.optimizer.weightBefore,
      otherNumericValuesAvailable: false,
    },
    whyItMatters:
      "Inspecting one real cell makes the distinction between a parameter matrix, its gradient matrix, and an optimizer update concrete.",
    commonMisconceptions: [
      "Only the selected cell's numeric value is present in the teaching trace; neutral dots are not zeros.",
      "The matrix has participated in earlier computation, but it remains locked throughout backward.",
    ],
    relatedTargetIds: [
      "parameter-matrix:selected-cell",
      "parameter-matrix:stored-weight",
      "parameter-matrix:settled-gradient",
    ],
    explanationByMode: {
      story:
        "This is the learned query-projection ledger, with one cell placed under a microscope.",
      structure:
        "An [8,8] parameter maps model width eight back to width eight before splitting into heads.",
      math: "Q[b,t,j]=sum_i N[b,t,i] W_Q[i,j].",
      code: "q = normalized_hidden @ block0.attention.w_q",
    },
  },
  {
    id: "parameter-matrix:selected-cell",
    stationId: "parameter-matrix",
    kind: "component",
    label: "Selected WQ cell [3,6]",
    aliases: ["selected matrix cell", "cell 3 6", "WQ 3 6"],
    summary:
      "The row and column sighting lines isolate block.0.attention.WQ[3,6].",
    role:
      "It links the scalar weight register, twelve gradient contributions, AdamW state, and final write to one consistent parameter address.",
    inputs: ["Row address 3", "Column address 6", "The W_Q[8,8] parameter store"],
    operation: "Select one scalar parameter without changing it.",
    outputs: ["Addressed weight w=0.0174 and its matching gradient accumulator"],
    formula: "w = W_Q[3,6]",
    shape: "one scalar cell inside [8,8]",
    exactValues: {
      parameterName: SELECTED_TRACE.optimizer.parameterName,
      row: 3,
      column: 6,
      flattenedIndex: 30,
      value: SELECTED_TRACE.optimizer.weightBefore,
    },
    whyItMatters:
      "Every optimizer state value and update shown in the final chambers belongs to this exact address.",
    commonMisconceptions: [
      "The row and column indices identify a coordinate; they are not batch or token positions.",
      "Highlighting the cell does not mean only this parameter receives a gradient in a real training step.",
    ],
    relatedTargetIds: [
      "parameter-matrix:wq-matrix",
      "parameter-matrix:stored-weight",
      "parameter-matrix:gradient-contributions",
      "parameter-matrix:gradient-accumulator",
      "weight-update:matrix-after",
    ],
    explanationByMode: {
      story:
        "The crosshairs pick one learned connection so its entire gradient-and-update journey can be followed.",
      structure:
        "Zero-based row 3 and column 6 flatten to index 3*8+6=30.",
      math: "w=W_Q[3,6]=0.0174.",
      code: "w = model.block[0].attention.w_q[3, 6]",
    },
  },
  {
    id: "parameter-matrix:stored-weight",
    stationId: "parameter-matrix",
    kind: "component",
    label: "Stored weight register",
    aliases: ["weight register", "w register", "weight before"],
    summary:
      "This register holds the selected parameter's pre-update value while its gradient is accumulated separately.",
    role:
      "It demonstrates that the learned weight remains 0.0174 throughout forward and backward.",
    inputs: ["W_Q[3,6] read from the parameter store"],
    operation: "Hold the current scalar parameter value unchanged.",
    outputs: ["w_before=0.0174 for the optimizer"],
    formula: "w_before = 0.0174",
    shape: "scalar",
    exactValues: {
      parameterName: SELECTED_TRACE.optimizer.parameterName,
      weightBefore: SELECTED_TRACE.optimizer.weightBefore,
    },
    whyItMatters:
      "Keeping the weight separate from its gradient prevents accidental in-place learning during backpropagation.",
    commonMisconceptions: [
      "The gradient register does not overwrite this weight.",
      "A parameter value and a gradient can have different signs and magnitudes.",
    ],
    relatedTargetIds: [
      "parameter-matrix:wq-matrix",
      "parameter-matrix:selected-cell",
      "parameter-matrix:settled-gradient",
      "adamw-state:optimizer-inputs",
    ],
    explanationByMode: {
      story:
        "The weight waits in a locked register while twelve pieces of evidence are counted beside it.",
      structure:
        "One scalar parameter value is read alongside, but stored separately from, one scalar gradient accumulator.",
      math: "w remains 0.0174 until the optimizer produces delta w.",
      code: "w_before = parameter[3, 6].detach().clone()",
    },
  },
  {
    id: "parameter-matrix:gradient-contributions",
    stationId: "parameter-matrix",
    kind: "component",
    label: "Twelve per-position gradient contributions",
    aliases: ["contribution stream", "b t contributions", "gradient packets"],
    summary:
      "Each of the twelve batch-position uses of W_Q[3,6] contributes to one shared parameter gradient.",
    role:
      "The stream represents the local products that must be summed because the same learned matrix is reused at every token position.",
    inputs: [
      "Twelve normalized input-feature values",
      "Twelve query-gradient values at the selected output feature",
    ],
    operation:
      "Form one contribution per (batch, position) and route all of them to the selected gradient accumulator.",
    outputs: ["Twelve terms whose sum is dL/dW_Q[3,6]"],
    formula: "contribution[b,t] = N[b,t,3] * dQ[b,t,6]",
    shape: "12 scalar contributions from [2,6]",
    exactValues: {
      contributionCount: 12,
      selectedRowFeature: 3,
      selectedColumnFeature: 6,
      individualNumericValuesAvailable: false,
      settledSum: SELECTED_TRACE.optimizer.gradient,
    },
    whyItMatters:
      "Parameter sharing across positions means one weight learns from every place it was used, not from only the selected token.",
    commonMisconceptions: [
      "The twelve packet values are deliberately unknown; only their count and final sum are given.",
      "These are contributions to one parameter gradient, not twelve separate copies of the parameter.",
    ],
    relatedTargetIds: [
      "parameter-matrix:selected-cell",
      "parameter-matrix:gradient-accumulator",
      "parameter-matrix:settled-gradient",
    ],
    explanationByMode: {
      story:
        "Twelve small receipts arrive from the positions that reused this same weight.",
      structure:
        "The batch and time axes provide 2*6=12 scalar terms for one shared matrix coordinate.",
      math: "dW_Q[3,6]=sum_(b,t) N[b,t,3] dQ[b,t,6].",
      code: "contributions = normalized[:, :, 3] * d_q[:, :, 6]",
    },
  },
  {
    id: "parameter-matrix:gradient-accumulator",
    stationId: "parameter-matrix",
    kind: "component",
    label: "Selected-cell gradient accumulator",
    aliases: ["gradient register", "accumulating gradient", "gradient sum"],
    summary:
      "The register sums the twelve per-position contributions for W_Q[3,6].",
    role:
      "It reduces all uses of the shared parameter to the single scalar gradient the optimizer expects.",
    inputs: ["Twelve scalar contribution terms"],
    operation: "Add each contribution into one accumulator.",
    outputs: ["One settled scalar gradient"],
    formula: "g = sum_(b,t) contribution[b,t]",
    shape: "12 scalars -> 1 scalar",
    exactValues: {
      contributionCount: 12,
      finalGradient: SELECTED_TRACE.optimizer.gradient,
      intermediateSumsAvailable: false,
    },
    whyItMatters:
      "The optimizer updates each parameter once per step using its total gradient, not one update per token.",
    commonMisconceptions: [
      "The accumulator contains a derivative, not an average of weight values.",
      "Its intermediate totals are not shown in the trace.",
    ],
    relatedTargetIds: [
      "parameter-matrix:selected-cell",
      "parameter-matrix:gradient-contributions",
      "parameter-matrix:settled-gradient",
    ],
    explanationByMode: {
      story:
        "The incoming receipts pile into a single total beside the still-locked weight.",
      structure:
        "A reduction over batch and time removes both axes and leaves one scalar for cell [3,6].",
      math: "g=sum_(b,t) N[b,t,3] dQ[b,t,6]=-0.0031.",
      code: "gradient = contributions.sum()",
    },
  },
  {
    id: "parameter-matrix:settled-gradient",
    stationId: "parameter-matrix",
    kind: "component",
    label: "Settled WQ cell gradient",
    aliases: ["final gradient", "g register", "gradient minus 0.0031"],
    summary:
      "After all twelve contributions arrive, the selected cell's gradient is -0.0031.",
    role:
      "It is the complete loss derivative for W_Q[3,6] passed to AdamW while the stored weight remains unchanged.",
    inputs: ["Completed selected-cell gradient accumulator"],
    operation: "Freeze the accumulated result for optimizer consumption.",
    outputs: ["g=-0.0031 paired with w=0.0174"],
    formula: "g = dL/dW_Q[3,6]",
    shape: "scalar",
    exactValues: {
      parameterName: SELECTED_TRACE.optimizer.parameterName,
      gradient: SELECTED_TRACE.optimizer.gradient,
      weightStillBeforeUpdate: SELECTED_TRACE.optimizer.weightBefore,
    },
    whyItMatters:
      "This scalar is the bridge between differentiation and optimization for the selected parameter.",
    commonMisconceptions: [
      "A negative gradient is not itself the amount added to the weight; AdamW transforms it first.",
      "Settling the gradient still does not change the parameter.",
    ],
    relatedTargetIds: [
      "parameter-matrix:wq-matrix",
      "parameter-matrix:gradient-contributions",
      "parameter-matrix:gradient-accumulator",
      "parameter-matrix:stored-weight",
      "adamw-state:optimizer-inputs",
    ],
    explanationByMode: {
      story:
        "The twelve receipts settle at -0.0031 and are handed, with the untouched weight, to the optimizer.",
      structure:
        "The matrix-shaped gradient has one scalar at every parameter address; this chamber follows address [3,6].",
      math: "g=dL/dW_Q[3,6]=-0.0031.",
      code: "g = parameter.grad[3, 6]  # -0.0031",
    },
  },

  {
    id: "adamw-state:optimizer-inputs",
    stationId: "adamw-state",
    kind: "component",
    label: "AdamW scalar inputs",
    aliases: ["optimizer inputs", "Adam inputs", "hyperparameter board"],
    summary:
      "This board assembles the selected weight, gradient, prior moment state, and AdamW hyperparameters for optimizer step 1.",
    role:
      "It provides every grounded scalar needed to compute the selected parameter's moment updates and decoupled weight-decay term.",
    inputs: [
      "w=0.0174 and g=-0.0031",
      "m0=0 and v0=0",
      "beta1=0.9, beta2=0.999, epsilon=1e-8",
      "learning rate 0.001 and weight decay 0.01",
    ],
    operation:
      "Hold the immutable inputs for the selected AdamW update.",
    outputs: ["Inputs to clipping, moment, normalization, and decay branches"],
    formula: "AdamW(w,g,m0,v0; beta1,beta2,epsilon,eta,lambda)",
    shape: "one scalar lane for W_Q[3,6]",
    exactValues: {
      parameterName: SELECTED_TRACE.optimizer.parameterName,
      step: SELECTED_TRACE.optimizer.step,
      weight: SELECTED_TRACE.optimizer.weightBefore,
      gradient: SELECTED_TRACE.optimizer.gradient,
      momentBefore: SELECTED_TRACE.optimizer.momentBefore,
      varianceBefore: SELECTED_TRACE.optimizer.varianceBefore,
      beta1: SELECTED_TRACE.optimizer.beta1,
      beta2: SELECTED_TRACE.optimizer.beta2,
      epsilon: SELECTED_TRACE.optimizer.epsilon,
      learningRate: SELECTED_TRACE.optimizer.learningRate,
      weightDecay: SELECTED_TRACE.optimizer.weightDecay,
    },
    whyItMatters:
      "AdamW is stateful: the same gradient can produce a different update when the prior moments or step number differ.",
    commonMisconceptions: [
      "The learning rate and weight decay are hyperparameters, not learned values.",
      "The optimizer operates elementwise here, but clipping can depend on the global gradient collection.",
    ],
    relatedTargetIds: [
      "parameter-matrix:settled-gradient",
      "adamw-state:clip-check",
      "adamw-state:first-moment-lane",
      "adamw-state:second-moment-lane",
    ],
    explanationByMode: {
      story:
        "The assembly line receives the weight, its new gradient, two memory registers, and the optimizer settings.",
      structure:
        "One parameter address has scalar w, g, m, and v; the same hyperparameters govern the wider parameter set.",
      math:
        "At step 1: w=.0174, g=-.0031, m0=v0=0, beta1=.9, beta2=.999, eta=.001, lambda=.01.",
      code:
        "state = adamw_step(w, g, m=0, v=0, step=1, lr=1e-3, betas=(.9,.999), eps=1e-8, weight_decay=.01)",
    },
  },
  {
    id: "adamw-state:clip-check",
    stationId: "adamw-state",
    kind: "component",
    label: "Pre-Adam clipping boundary",
    aliases: ["global norm clip", "clipping boundary", "gradient clipping"],
    summary:
      "The training design places optional global-norm clipping before AdamW, but this deterministic trace does not provide the norm, threshold, or clipping outcome.",
    role:
      "It marks where a full-run safeguard would rescale the complete gradient collection; the numeric trace begins with the already-supplied AdamW input g=-0.0031.",
    inputs: [
      "The complete gradient collection in a real training run",
      "No pre-clipping gradient collection in this deterministic trace",
    ],
    operation:
      "Explain the clipping boundary without reconstructing or asserting a decision that the trace cannot support.",
    outputs: ["Trace-supplied AdamW input g=-0.0031 forwarded to moment updates"],
    formula:
      "If modeled: g_clipped = g * min(1, threshold / ||g_all||)",
    shape: "unmodeled global boundary, then parameter-shaped optimizer inputs",
    exactValues: {
      optimizerInputGradient: SELECTED_TRACE.optimizer.gradient,
      preClippingGradientAvailable: false,
      clippingOutcomeAvailable: false,
      globalNormAvailable: false,
      thresholdAvailable: false,
    },
    whyItMatters:
      "Clipping can prevent unusually large gradients from destabilizing the optimizer while preserving ordinary steps.",
    commonMisconceptions: [
      "The displayed scalar absolute value is not enough to reconstruct the true global norm.",
      "The trace does not justify saying that clipping did or did not occur.",
      "Clipping changes gradients when needed; it does not directly clamp parameter values.",
    ],
    relatedTargetIds: [
      "adamw-state:optimizer-inputs",
      "adamw-state:first-moment-lane",
      "adamw-state:second-moment-lane",
    ],
    explanationByMode: {
      story:
        "A safety-inspection station is marked on the route, but this specimen starts after that boundary and does not show the inspection result.",
      structure:
        "A real decision is global and would apply one scale factor to every parameter gradient; neither input norm nor decision is present here.",
      math:
        "AdamW receives g=-0.0031; no equality between pre- and post-clipping gradients is asserted.",
      code:
        "// Optional in a full run: clip_grad_norm_(parameters, max_norm); this trace starts from optimizer input g",
    },
  },
  {
    id: "adamw-state:first-moment-lane",
    stationId: "adamw-state",
    kind: "component",
    label: "First-moment and bias-correction lane",
    aliases: ["m lane", "first moment", "corrected moment", "m hat"],
    summary:
      "The first-moment lane exponentially smooths the gradient and removes its step-1 initialization bias.",
    role:
      "It estimates the signed gradient direction used in the Adam normalized update.",
    inputs: ["g=-0.0031", "m0=0", "beta1=0.9", "step=1"],
    operation:
      "Compute m1=beta1*m0+(1-beta1)*g, then m_hat=m1/(1-beta1^step).",
    outputs: ["m1=-0.00031", "m_hat=-0.0031"],
    formula:
      "m1=beta1*m0+(1-beta1)g; m_hat=m1/(1-beta1^step)",
    shape: "scalar state for W_Q[3,6]",
    exactValues: {
      beta1: SELECTED_TRACE.optimizer.beta1,
      momentBefore: SELECTED_TRACE.optimizer.momentBefore,
      momentAfter: SELECTED_TRACE.optimizer.momentAfter,
      biasCorrectedMoment:
        SELECTED_TRACE.optimizer.biasCorrectedMoment,
      step: SELECTED_TRACE.optimizer.step,
    },
    whyItMatters:
      "The signed moving average gives Adam a stable direction while bias correction compensates for starting from zero.",
    commonMisconceptions: [
      "m is persistent optimizer state, not a neural-network activation.",
      "At step 1 with m0=0, bias correction restores the current gradient exactly in this trace.",
    ],
    relatedTargetIds: [
      "adamw-state:optimizer-inputs",
      "adamw-state:second-moment-lane",
      "adamw-state:normalized-gradient",
    ],
    explanationByMode: {
      story:
        "The red lane remembers the signed direction of recent gradients, then corrects for its empty start.",
      structure:
        "The raw moment and corrected moment are two consecutive states of one scalar lane.",
      math:
        "m1=.9*0+.1*(-.0031)=-.00031; m_hat=m1/(1-.9)=-.0031.",
      code: "m = beta1*m + (1-beta1)*g; m_hat = m/(1-beta1**step)",
    },
  },
  {
    id: "adamw-state:second-moment-lane",
    stationId: "adamw-state",
    kind: "component",
    label: "Second-moment and bias-correction lane",
    aliases: ["v lane", "second moment", "corrected variance", "v hat"],
    summary:
      "The second-moment lane exponentially smooths squared gradients and removes its step-1 initialization bias.",
    role:
      "It estimates gradient scale so Adam can normalize the signed first moment.",
    inputs: ["g=-0.0031", "v0=0", "beta2=0.999", "step=1"],
    operation:
      "Compute v1=beta2*v0+(1-beta2)*g^2, then v_hat=v1/(1-beta2^step).",
    outputs: ["v1=9.61e-9", "v_hat=9.61e-6"],
    formula:
      "v1=beta2*v0+(1-beta2)g^2; v_hat=v1/(1-beta2^step)",
    shape: "scalar state for W_Q[3,6]",
    exactValues: {
      beta2: SELECTED_TRACE.optimizer.beta2,
      varianceBefore: SELECTED_TRACE.optimizer.varianceBefore,
      varianceAfter: SELECTED_TRACE.optimizer.varianceAfter,
      biasCorrectedVariance:
        SELECTED_TRACE.optimizer.biasCorrectedVariance,
      step: SELECTED_TRACE.optimizer.step,
    },
    whyItMatters:
      "Scaling by recent squared-gradient magnitude makes Adam's effective step adaptive for each parameter.",
    commonMisconceptions: [
      "v is an exponential average of squared gradients, not the statistical variance of the model's predictions.",
      "The square removes the sign; direction still comes from the first moment.",
    ],
    relatedTargetIds: [
      "adamw-state:optimizer-inputs",
      "adamw-state:first-moment-lane",
      "adamw-state:normalized-gradient",
    ],
    explanationByMode: {
      story:
        "The gold lane remembers how large recent gradients have been, then corrects for starting empty.",
      structure:
        "The raw second moment and corrected second moment are consecutive scalar states parallel to the m lane.",
      math:
        "v1=.999*0+.001*(-.0031)^2=9.61e-9; v_hat=v1/(1-.999)=9.61e-6.",
      code: "v = beta2*v + (1-beta2)*g.square(); v_hat = v/(1-beta2**step)",
    },
  },
  {
    id: "adamw-state:normalized-gradient",
    stationId: "adamw-state",
    kind: "component",
    label: "Adam normalized gradient",
    aliases: ["normalized step", "m hat over root v hat", "adaptive direction"],
    summary:
      "The bias-corrected first moment is divided by the square root of the corrected second moment plus epsilon.",
    role:
      "It combines signed direction and adaptive scale before the learning rate is applied.",
    inputs: [
      "m_hat=-0.0031",
      "v_hat=9.61e-6",
      "epsilon=1e-8",
    ],
    operation: "Divide m_hat by sqrt(v_hat)+epsilon.",
    outputs: ["normalized gradient=-0.999996774"],
    formula: "n = m_hat / (sqrt(v_hat) + epsilon)",
    shape: "scalar",
    exactValues: {
      biasCorrectedMoment:
        SELECTED_TRACE.optimizer.biasCorrectedMoment,
      biasCorrectedVariance:
        SELECTED_TRACE.optimizer.biasCorrectedVariance,
      epsilon: SELECTED_TRACE.optimizer.epsilon,
      normalizedGradient: SELECTED_TRACE.optimizer.normalizedGradient,
    },
    whyItMatters:
      "This ratio makes the update depend on gradient direction relative to its recent scale rather than raw magnitude alone.",
    commonMisconceptions: [
      "The normalized value being near -1 is specific to this first-step zero-state example.",
      "Epsilon is for numerical stability; it is not weight decay.",
    ],
    relatedTargetIds: [
      "adamw-state:first-moment-lane",
      "adamw-state:second-moment-lane",
      "adamw-state:update-components",
      "adamw-state:delta-weight",
    ],
    explanationByMode: {
      story:
        "The two memory lanes reunite: one supplies direction, the other supplies scale.",
      structure:
        "Two scalar corrected moments and epsilon collapse to one scalar adaptive direction.",
      math:
        "-.0031/(sqrt(9.61e-6)+1e-8)=-.999996774.",
      code: "normalized = m_hat / (v_hat.sqrt() + eps)",
    },
  },
  {
    id: "adamw-state:update-components",
    stationId: "adamw-state",
    kind: "component",
    label: "Adam and decoupled-decay components",
    aliases: ["update terms", "Adam component", "decay component", "plus junction"],
    summary:
      "One branch converts the normalized gradient into the Adam step while a separate branch computes decoupled weight decay; the junction adds them.",
    role:
      "It keeps optimization pressure and regularization pressure conceptually separate before producing one parameter delta.",
    inputs: [
      "normalized gradient=-0.999996774",
      "learning rate=0.001",
      "weight=0.0174",
      "weight decay=0.01",
    ],
    operation:
      "Compute -eta*n and -eta*lambda*w independently, then add the two terms.",
    outputs: [
      "Adam component=0.000999996774",
      "Decay component=-0.000000174",
      "Combined delta weight",
    ],
    formula: "delta w = -eta*n - eta*lambda*w",
    shape: "two scalar branches -> one scalar",
    exactValues: {
      adamComponent: SELECTED_TRACE.optimizer.adamComponent,
      decayComponent: SELECTED_TRACE.optimizer.decayComponent,
      learningRate: SELECTED_TRACE.optimizer.learningRate,
      weightDecay: SELECTED_TRACE.optimizer.weightDecay,
      weight: SELECTED_TRACE.optimizer.weightBefore,
      deltaWeight: SELECTED_TRACE.optimizer.deltaWeight,
    },
    whyItMatters:
      "AdamW's decoupled decay is applied directly to the weight instead of being mixed into the adaptive gradient statistics.",
    commonMisconceptions: [
      "The decay term uses the weight value, not the gradient.",
      "The two terms can have opposite signs, as they do here.",
    ],
    relatedTargetIds: [
      "adamw-state:normalized-gradient",
      "adamw-state:delta-weight",
    ],
    explanationByMode: {
      story:
        "The adaptive push and a tiny pull toward zero meet at one junction.",
      structure:
        "Two independently computed scalar branches are added without modifying m or v.",
      math:
        "Adam=+0.000999996774 and decay=-0.000000174, so their sum is +0.000999822774.",
      code:
        "adam_term = -lr*normalized; decay_term = -lr*weight_decay*w; delta = adam_term + decay_term",
    },
  },
  {
    id: "adamw-state:delta-weight",
    stationId: "adamw-state",
    kind: "component",
    label: "Computed parameter delta",
    aliases: ["delta w", "optimizer output", "weight step"],
    summary:
      "The Adam and decay branches combine to produce the selected parameter's signed change, +0.000999822774.",
    role:
      "It is the optimizer's output and the operand that the next chamber adds to the stored weight.",
    inputs: [
      "Adam component=+0.000999996774",
      "Decay component=-0.000000174",
    ],
    operation: "Add the two optimizer components.",
    outputs: ["delta w=+0.000999822774"],
    formula: "delta w = adam_component + decay_component",
    shape: "scalar",
    exactValues: {
      adamComponent: SELECTED_TRACE.optimizer.adamComponent,
      decayComponent: SELECTED_TRACE.optimizer.decayComponent,
      deltaWeight: SELECTED_TRACE.optimizer.deltaWeight,
    },
    whyItMatters:
      "This is the first value in the step intended to change the stored model parameter.",
    commonMisconceptions: [
      "Delta w is not the new weight; it must still be added to w_before.",
      "Its positive sign follows from the negative gradient after applying the optimizer formula.",
    ],
    relatedTargetIds: [
      "adamw-state:normalized-gradient",
      "adamw-state:update-components",
      "weight-update:delta-weight",
    ],
    explanationByMode: {
      story:
        "The optimizer seals both influences into one signed change ticket for the weight register.",
      structure:
        "The output is one scalar aligned to the same W_Q[3,6] address as w, g, m, and v.",
      math:
        "delta w=.000999996774-.000000174=.000999822774.",
      code: "delta_w = adam_term + decay_term",
    },
  },

  {
    id: "weight-update:stored-weight-before",
    stationId: "weight-update",
    kind: "component",
    label: "Pre-update stored weight",
    aliases: ["old weight", "w operand", "weight before"],
    summary:
      "The selected matrix cell still stores 0.0174 when the optimizer delta arrives.",
    role:
      "It is the left operand of the only parameter-changing addition in this training step.",
    inputs: ["W_Q[3,6] from the current model state theta0"],
    operation: "Read the current weight value without changing it.",
    outputs: ["w_before=0.0174"],
    formula: "w_before = W_Q[3,6]",
    shape: "scalar",
    exactValues: {
      parameterName: SELECTED_TRACE.optimizer.parameterName,
      weightBefore: SELECTED_TRACE.optimizer.weightBefore,
    },
    whyItMatters:
      "The scene makes the temporal boundary explicit: all gradient work completed before this stored value moves.",
    commonMisconceptions: [
      "This is the parameter value, not its gradient or moment.",
      "Reading the operand is not itself an update.",
    ],
    relatedTargetIds: [
      "parameter-matrix:stored-weight",
      "weight-update:delta-weight",
      "weight-update:scalar-addition",
      "weight-update:updated-weight",
    ],
    explanationByMode: {
      story:
        "The old weight comes off the shelf for the first and only actual write of the step.",
      structure:
        "One scalar is read from matrix coordinate [3,6] in model state theta0.",
      math: "w_before=0.0174.",
      code: "w_before = w_q[3, 6]",
    },
  },
  {
    id: "weight-update:delta-weight",
    stationId: "weight-update",
    kind: "component",
    label: "AdamW delta operand",
    aliases: ["delta operand", "delta w tile", "optimizer change"],
    summary:
      "The optimizer supplies +0.000999822774 as the signed change for W_Q[3,6].",
    role:
      "It is the right operand added to the stored weight.",
    inputs: ["Combined Adam and decoupled-decay components"],
    operation: "Carry the computed scalar delta into the write operation.",
    outputs: ["delta w=+0.000999822774"],
    formula: "delta w = -eta*n - eta*lambda*w",
    shape: "scalar",
    exactValues: {
      deltaWeight: SELECTED_TRACE.optimizer.deltaWeight,
      adamComponent: SELECTED_TRACE.optimizer.adamComponent,
      decayComponent: SELECTED_TRACE.optimizer.decayComponent,
    },
    whyItMatters:
      "Separating the delta from the stored weight makes it clear what AdamW computes versus what the model stores.",
    commonMisconceptions: [
      "The delta is not a learning rate by itself.",
      "It is already signed, so the update chamber adds it rather than subtracting it again.",
    ],
    relatedTargetIds: [
      "adamw-state:delta-weight",
      "weight-update:stored-weight-before",
      "weight-update:scalar-addition",
      "weight-update:updated-weight",
    ],
    explanationByMode: {
      story:
        "The signed change ticket arrives from the AdamW line and meets the old weight.",
      structure:
        "The scalar is aligned to the same parameter address as the stored-weight operand.",
      math: "delta w=+0.000999822774.",
      code: "delta_w = optimizer_delta[3, 6]",
    },
  },
  {
    id: "weight-update:scalar-addition",
    stationId: "weight-update",
    kind: "component",
    label: "Parameter write addition",
    aliases: ["w plus delta", "update operator", "plus equals"],
    summary:
      "The update operation adds the signed AdamW delta to the stored parameter value.",
    role:
      "It is the precise point at which the selected learned parameter changes.",
    inputs: ["w_before=0.0174", "delta w=+0.000999822774"],
    operation: "Add the two scalar operands at full displayed precision.",
    outputs: ["w_after=0.018399822774"],
    formula: "w_after = w_before + delta w",
    shape: "scalar + scalar -> scalar",
    exactValues: {
      weightBefore: SELECTED_TRACE.optimizer.weightBefore,
      deltaWeight: SELECTED_TRACE.optimizer.deltaWeight,
      weightAfter: SELECTED_TRACE.optimizer.weightAfter,
    },
    whyItMatters:
      "This addition separates gradient computation and optimizer-state computation from the actual mutation of model state.",
    commonMisconceptions: [
      "The addition occurs once after AdamW finishes, not continuously during backward.",
      "Rounding the displayed operands too early would obscure the exact shown result.",
    ],
    relatedTargetIds: [
      "weight-update:stored-weight-before",
      "weight-update:delta-weight",
      "weight-update:updated-weight",
    ],
    explanationByMode: {
      story:
        "The old value and the optimizer's change finally meet; this junction is where learning becomes a stored model change.",
      structure:
        "Two scalars for one parameter address produce one replacement scalar.",
      math: "0.0174+0.000999822774=0.018399822774.",
      code: "w_after = w_before + delta_w",
    },
  },
  {
    id: "weight-update:updated-weight",
    stationId: "weight-update",
    kind: "component",
    label: "Updated scalar weight",
    aliases: ["w prime", "result weight", "weight after"],
    summary:
      "The computed result for W_Q[3,6] is 0.018399822774.",
    role:
      "It is the replacement scalar carried to the selected matrix cell.",
    inputs: ["Output of w_before plus delta w"],
    operation: "Hold the new scalar until it is written into W_Q.",
    outputs: ["w_after=0.018399822774"],
    formula: "w' = w + delta w",
    shape: "scalar",
    exactValues: {
      parameterName: SELECTED_TRACE.optimizer.parameterName,
      weightAfter: SELECTED_TRACE.optimizer.weightAfter,
    },
    whyItMatters:
      "The new value is the concrete learned change that will affect subsequent forward passes.",
    commonMisconceptions: [
      "This value belongs to one selected cell, not the whole W_Q matrix.",
      "The model does not retroactively recompute the completed batch with this value.",
    ],
    relatedTargetIds: [
      "weight-update:stored-weight-before",
      "weight-update:delta-weight",
      "weight-update:scalar-addition",
      "weight-update:matrix-before",
      "weight-update:matrix-after",
    ],
    explanationByMode: {
      story:
        "The update bench produces the replacement value and sends it down the lane to its matrix address.",
      structure:
        "One scalar result remains associated with W_Q row 3, column 6.",
      math: "w'=0.018399822774.",
      code: "updated_value = 0.018399822774",
    },
  },
  {
    id: "weight-update:matrix-before",
    stationId: "weight-update",
    kind: "component",
    label: "WQ matrix before the write",
    aliases: ["before matrix", "theta0 WQ", "old matrix state"],
    summary:
      "This board represents W_Q immediately before the selected-cell update, with W_Q[3,6]=0.0174.",
    role:
      "It provides the old matrix state against which the committed update is compared.",
    inputs: ["Current W_Q[8,8] parameter store"],
    operation: "Snapshot the pre-update matrix state.",
    outputs: ["theta0 view of W_Q"],
    formula: "W_Q_before[3,6]=0.0174",
    shape: "[8,8]",
    exactValues: {
      selectedRow: 3,
      selectedColumn: 6,
      selectedValue: SELECTED_TRACE.optimizer.weightBefore,
      otherNumericValuesAvailable: false,
    },
    whyItMatters:
      "A before-state proves that the write changes stored model state rather than merely displaying an optimizer result.",
    commonMisconceptions: [
      "Neutral cells have unknown trace values, not zero values.",
      "Only the selected cell is numerically compared in this teaching trace.",
    ],
    relatedTargetIds: [
      "weight-update:stored-weight-before",
      "weight-update:updated-weight",
      "weight-update:matrix-after",
    ],
    explanationByMode: {
      story:
        "The left board is the old model ledger just before the replacement value is inserted.",
      structure:
        "The matrix shape stays [8,8]; only coordinate [3,6] is numerically exposed.",
      math: "W_Q_before[3,6]=0.0174.",
      code: "before = w_q.clone()",
    },
  },
  {
    id: "weight-update:matrix-after",
    stationId: "weight-update",
    kind: "component",
    label: "WQ matrix after the write",
    aliases: ["after matrix", "theta1 WQ", "updated matrix state"],
    summary:
      "The replacement scalar is written into W_Q[3,6], producing the next model state.",
    role:
      "It commits the optimizer result to the learned parameter store while retaining the same matrix architecture.",
    inputs: [
      "Pre-update W_Q[8,8]",
      "Updated scalar 0.018399822774 at address [3,6]",
    ],
    operation: "Replace the selected cell with w_after.",
    outputs: ["theta1 view of W_Q for subsequent batches"],
    formula: "W_Q_after[3,6] = W_Q_before[3,6] + delta w",
    shape: "[8,8] -> [8,8]",
    exactValues: {
      selectedRow: 3,
      selectedColumn: 6,
      before: SELECTED_TRACE.optimizer.weightBefore,
      after: SELECTED_TRACE.optimizer.weightAfter,
      otherNumericValuesAvailable: false,
    },
    whyItMatters:
      "Future model predictions can differ because the stored parameter state, not the architecture, has changed.",
    commonMisconceptions: [
      "The update changes a value, not the matrix's dimensions or role.",
      "The highlighted ring identifies the write location; it is not another parameter.",
    ],
    relatedTargetIds: [
      "weight-update:updated-weight",
      "weight-update:matrix-before",
      "model-changed-next-step:updated-parameter-state",
    ],
    explanationByMode: {
      story:
        "The new scalar lands in the highlighted cell, turning the old model ledger into its next version.",
      structure:
        "The [8,8] matrix is unchanged structurally; coordinate [3,6] now stores the new value.",
      math: "W_Q_after[3,6]=0.018399822774.",
      code: "w_q[3, 6] = updated_value",
    },
  },

  {
    id: "model-changed-next-step:old-parameter-state",
    stationId: "model-changed-next-step",
    kind: "component",
    label: "Old model parameter state theta0",
    aliases: ["theta zero", "old model", "before readout"],
    summary:
      "Theta0 is the complete parameter state used for the illustrated forward and backward pass, represented by W_Q[3,6]=0.0174.",
    role:
      "It provides the before-state that fades only after the optimizer's parameter write is committed.",
    inputs: ["All learned parameters before optimizer step 1"],
    operation: "Identify the model version that processed the completed batch.",
    outputs: ["Reference state for comparison with theta1"],
    formula: "theta1 = theta0 + delta theta",
    shape: "same model architecture; pre-update parameter values",
    exactValues: {
      selectedParameter: SELECTED_TRACE.optimizer.parameterName,
      selectedValue: SELECTED_TRACE.optimizer.weightBefore,
      fullParameterStateAvailable: false,
    },
    whyItMatters:
      "The completed batch's loss and gradients belong to theta0, even though the next batch will use theta1.",
    commonMisconceptions: [
      "Theta0 means the old values of all parameters, not a different network architecture.",
      "Only one selected parameter value is numerically exposed in the trace.",
    ],
    relatedTargetIds: [
      "weight-update:matrix-before",
      "model-changed-next-step:updated-parameter-state",
    ],
    explanationByMode: {
      story:
        "The ghosted tower is the exact model version that made the prediction and earned the completed batch's gradient.",
      structure:
        "Architecture and tensor shapes remain fixed; theta0 names the pre-update contents of every parameter tensor.",
      math:
        "For the selected coordinate, theta0 contains W_Q[3,6]=0.0174.",
      code: "theta0 = snapshot(model.parameters())",
    },
  },
  {
    id: "model-changed-next-step:updated-parameter-state",
    stationId: "model-changed-next-step",
    kind: "component",
    label: "Updated model parameter state theta1",
    aliases: ["theta one", "new model", "after readout", "updated tower"],
    summary:
      "Theta1 is the same Transformer architecture after AdamW has changed its participating parameters.",
    role:
      "It becomes the parameter state used by the next training batch, represented by W_Q[3,6]=0.018399822774.",
    inputs: ["Theta0", "The optimizer's parameter deltas"],
    operation: "Commit each optimizer delta to its matching parameter address.",
    outputs: ["Updated model ready for another forward pass"],
    formula: "theta1 = theta0 + delta theta",
    shape: "same model architecture; updated parameter values",
    exactValues: {
      selectedParameter: SELECTED_TRACE.optimizer.parameterName,
      selectedValueBefore: SELECTED_TRACE.optimizer.weightBefore,
      selectedDelta: SELECTED_TRACE.optimizer.deltaWeight,
      selectedValueAfter: SELECTED_TRACE.optimizer.weightAfter,
      fullParameterStateAvailable: false,
    },
    whyItMatters:
      "Learning is the change in parameter state that makes later computations potentially different.",
    commonMisconceptions: [
      "The architecture, layer count, and tensor shapes do not change when theta changes.",
      "The chamber's isolated replay visualizes the handoff; it does not apply the optimizer update repeatedly.",
    ],
    relatedTargetIds: [
      "weight-update:matrix-after",
      "model-changed-next-step:old-parameter-state",
      "model-changed-next-step:gradient-buffer",
      "model-changed-next-step:optimizer-memory",
      "model-changed-next-step:next-batch",
      "model-changed-next-step:training-loop",
    ],
    explanationByMode: {
      story:
        "The solid green tower is the same machine with a newly learned setting, ready for fresh data.",
      structure:
        "Theta1 has the same parameter tensors and shapes as theta0 but different stored values at updated coordinates.",
      math:
        "For the selected coordinate, .0174+.000999822774=.018399822774.",
      code: "theta1 = apply_updates(theta0, optimizer_deltas)",
    },
  },
  {
    id: "model-changed-next-step:gradient-buffer",
    stationId: "model-changed-next-step",
    kind: "component",
    label: "Cleared gradient buffer",
    aliases: ["grad buffer", "zero grad", "draining gradients"],
    summary:
      "After the update consumes the gradients, the per-parameter gradient buffers are cleared before the next backward pass.",
    role:
      "It prevents the next batch's gradients from being accidentally added to the completed batch unless accumulation is intentionally configured.",
    inputs: ["Gradient buffers used by optimizer step 1"],
    operation: "Reset stored parameter-gradient buffers to zero or no-gradient state.",
    outputs: ["Empty gradient buffers for the next training iteration"],
    formula: "grad(theta) <- 0",
    shape: "one buffer matching each participating parameter tensor",
    exactValues: {
      clearsAfterOptimizerStep: true,
      selectedPreviousGradient: SELECTED_TRACE.optimizer.gradient,
      nextGradientValuesAvailable: false,
    },
    whyItMatters:
      "Most training loops accumulate gradients by default, so explicit clearing defines the boundary between optimizer steps.",
    commonMisconceptions: [
      "Clearing gradients does not erase learned weights.",
      "It also does not erase Adam's moment estimates.",
    ],
    relatedTargetIds: [
      "model-changed-next-step:updated-parameter-state",
      "model-changed-next-step:optimizer-memory",
      "model-changed-next-step:next-batch",
    ],
    explanationByMode: {
      story:
        "The temporary gradient crates are emptied after delivery so the next batch starts with a clean ledger.",
      structure:
        "Gradient buffers mirror parameter shapes but have a shorter lifecycle than parameters or optimizer moments.",
      math:
        "After the step, grad(theta) is reset while theta=theta1 and (m,v) remain stored.",
      code: "optimizer.zero_grad(set_to_none=True)",
    },
  },
  {
    id: "model-changed-next-step:optimizer-memory",
    stationId: "model-changed-next-step",
    kind: "component",
    label: "Persistent Adam optimizer memory",
    aliases: ["Adam state", "moment memory", "persistent m and v"],
    summary:
      "Adam's first- and second-moment state persists across batches even though ordinary gradient buffers clear.",
    role:
      "It carries historical gradient direction and scale into the next optimizer step for the same parameter.",
    inputs: ["m1=-0.00031", "v1=9.61e-9", "completed optimizer step index 1"],
    operation: "Retain moment estimates and advance the optimizer step counter.",
    outputs: ["Prior state for Adam step 2"],
    formula: "(m_prev,v_prev,step) <- (m1,v1,1)",
    shape: "two scalar states per selected parameter, plus step counter",
    exactValues: {
      momentAfter: SELECTED_TRACE.optimizer.momentAfter,
      varianceAfter: SELECTED_TRACE.optimizer.varianceAfter,
      completedStep: SELECTED_TRACE.optimizer.step,
    },
    whyItMatters:
      "Adam's adaptive behavior depends on history, so discarding its state would change the optimization algorithm.",
    commonMisconceptions: [
      "Moment buffers are optimizer state, not learned model parameters used in the forward pass.",
      "zero_grad clears parameter gradients but should not reset m or v.",
    ],
    relatedTargetIds: [
      "adamw-state:first-moment-lane",
      "adamw-state:second-moment-lane",
      "model-changed-next-step:updated-parameter-state",
      "model-changed-next-step:gradient-buffer",
      "model-changed-next-step:next-batch",
    ],
    explanationByMode: {
      story:
        "Unlike the disposable gradient crates, the optimizer's two memory registers stay on the line for the next shipment.",
      structure:
        "Each parameter retains matching m and v state arrays plus a step count outside the model's forward graph.",
      math: "Next step begins from m_prev=-0.00031 and v_prev=9.61e-9.",
      code: "state[p] = {'step': 1, 'exp_avg': m1, 'exp_avg_sq': v1}",
    },
  },
  {
    id: "model-changed-next-step:next-batch",
    stationId: "model-changed-next-step",
    kind: "component",
    label: "Next training batch",
    aliases: ["next batch board", "batch 1", "new examples"],
    summary:
      "A new two-by-six batch enters after the model update and gradient-buffer reset.",
    role:
      "It starts the next training iteration using theta1 and the persistent Adam state.",
    inputs: [
      "Twelve new input token IDs from the data loader",
      "Aligned next-token targets",
      "Updated model theta1",
    ],
    operation:
      "Admit the next examples to a fresh forward pass.",
    outputs: ["New activations, predictions, loss, and eventually new gradients"],
    shape: "displayed input-ID placeholder [2,6]",
    exactValues: {
      batchSize: 2,
      sequenceLength: 6,
      tokenIdsAvailable: false,
      usesUpdatedModel: true,
    },
    whyItMatters:
      "Training improves a model through many parameter-state transitions over many different batches, not by replaying one batch forever.",
    commonMisconceptions: [
      "The dots are unknown next-batch IDs, not padding or zeros.",
      "The next batch is not part of the deterministic numeric trace shown for batch 0.",
    ],
    relatedTargetIds: [
      "model-changed-next-step:updated-parameter-state",
      "model-changed-next-step:gradient-buffer",
      "model-changed-next-step:optimizer-memory",
      "model-changed-next-step:training-loop",
    ],
    explanationByMode: {
      story:
        "Fresh examples approach the now-updated model while its temporary gradient workspace stands clear.",
      structure:
        "The teaching shape stays [2,6], but the actual twelve token IDs are intentionally unspecified.",
      math:
        "The next forward computes activations with theta1; no numeric next-batch tensor is available here.",
      code: "next_inputs, next_targets = next(data_loader)",
    },
  },
  {
    id: "model-changed-next-step:training-loop",
    stationId: "model-changed-next-step",
    kind: "component",
    label: "Next-iteration training route",
    aliases: ["training loop", "forward loss backward update", "next route"],
    summary:
      "The route sends the next batch through forward prediction, loss, backward differentiation, and another optimizer update.",
    role:
      "It reconnects the end of one parameter update to the beginning of the next training iteration.",
    inputs: [
      "Updated model theta1",
      "Next input-target batch",
      "Persistent optimizer state",
      "Cleared gradient buffers",
    ],
    operation:
      "Repeat the ordered training stages once for the next batch.",
    outputs: ["Theta2 after the next completed optimizer step"],
    formula: "batch -> forward(theta1) -> loss -> backward -> AdamW -> theta2",
    shape: "iteration-level control flow",
    exactValues: {
      stageOrder: ["forward", "loss", "backward", "update"],
      nextNumericTraceAvailable: false,
      replayIsInspectionOnly: true,
    },
    whyItMatters:
      "The model learns from repeated, ordered applications of the same computation graph to many batches.",
    commonMisconceptions: [
      "Looping the isolated chamber animation is only an inspection replay; it does not perform extra optimizer steps.",
      "The displayed single step illustrates pretraining mechanics, not the full evaluation or post-training pipeline.",
    ],
    relatedTargetIds: [
      "model-changed-next-step:next-batch",
      "model-changed-next-step:updated-parameter-state",
      "station:corpus-data-preparation",
    ],
    explanationByMode: {
      story:
        "The exit gate opens back onto the same learning route: new examples, a new prediction, a new error signal, and one more careful update.",
      structure:
        "Iteration control reconnects data loading to the same forward-backward-update graph with new state and inputs.",
      math: "theta_(k+1)=AdamW(theta_k, grad L_batch_k(theta_k), state_k).",
      code:
        "for x, y in loader: optimizer.zero_grad(); loss = model(x, theta).loss(y); loss.backward(); optimizer.step()",
    },
  },
];

export const LEARNING_EXPANSION_WORLD_METADATA: AssistantTargetWorldMetadata[] = [
  worldMetadata(
    "target-comparison:prediction-distribution",
    "target-comparison",
    "assistant-target-target-comparison-prediction-distribution",
    ["prediction-row"],
    [["prediction", "distribution"]],
  ),
  worldMetadata(
    "target-comparison:answer-id",
    "target-comparison",
    "assistant-target-target-comparison-answer-id",
    ["target-tray"],
    [["answer", "id"], ["target", "tray"]],
  ),
  worldMetadata(
    "target-comparison:gather-operation",
    "target-comparison",
    "assistant-target-target-comparison-gather-operation",
    ["gather-id-5"],
    [["gather", "operation"]],
  ),
  worldMetadata(
    "target-comparison:correct-probabilities",
    "target-comparison",
    "assistant-target-target-comparison-correct-probabilities",
    ["p-correct-board"],
    [["correct", "probabilities"]],
  ),

  worldMetadata(
    "output-backprop:probabilities",
    "output-backprop",
    "assistant-target-output-backprop-probabilities",
    ["backprop-p-board"],
    [["backprop", "probabilities"]],
  ),
  worldMetadata(
    "output-backprop:one-hot-target",
    "output-backprop",
    "assistant-target-output-backprop-one-hot-target",
    ["one-hot-target-board"],
    [["one", "hot", "target"]],
  ),
  worldMetadata(
    "output-backprop:difference",
    "output-backprop",
    "assistant-target-output-backprop-difference",
    ["probability-target-difference"],
    [["output", "difference"]],
  ),
  worldMetadata(
    "output-backprop:mean-logit-gradient",
    "output-backprop",
    "assistant-target-output-backprop-mean-logit-gradient",
    ["dG-board"],
    [["mean", "logit", "gradient"]],
  ),
  worldMetadata(
    "output-backprop:gradient-fork",
    "output-backprop",
    "assistant-target-output-backprop-gradient-fork",
    ["copy-fork"],
    [["gradient", "fork"]],
  ),
  worldMetadata(
    "output-backprop:hidden-state-gradient",
    "output-backprop",
    "assistant-target-output-backprop-hidden-state-gradient",
    ["dH-board"],
    [["hidden", "state", "gradient"]],
  ),
  worldMetadata(
    "output-backprop:vocabulary-weight-gradient",
    "output-backprop",
    "assistant-target-output-backprop-vocabulary-weight-gradient",
    ["dW-vocab-board"],
    [["vocabulary", "weight", "gradient"]],
  ),
  worldMetadata(
    "output-backprop:vocabulary-bias-gradient",
    "output-backprop",
    "assistant-target-output-backprop-vocabulary-bias-gradient",
    ["db-vocab-board"],
    [["vocabulary", "bias", "gradient"]],
  ),

  worldMetadata(
    "backprop-through-tower:incoming-gradient",
    "backprop-through-tower",
    "assistant-target-backprop-through-tower-incoming-gradient",
    ["tower-input-gradient"],
    [["incoming", "gradient"]],
  ),
  worldMetadata(
    "backprop-through-tower:final-norm-backward",
    "backprop-through-tower",
    "assistant-target-backprop-through-tower-final-norm-backward",
    ["LN-f-backward"],
    [["final", "norm", "backward"]],
  ),
  worldMetadata(
    "backprop-through-tower:block-1-mlp-backward",
    "backprop-through-tower",
    "assistant-target-backprop-through-tower-block-1-mlp-backward",
    ["block-1-MLP-backward"],
    [["block", "1", "mlp", "backward"]],
  ),
  worldMetadata(
    "backprop-through-tower:block-1-attention-backward",
    "backprop-through-tower",
    "assistant-target-backprop-through-tower-block-1-attention-backward",
    ["block-1-attention-backward"],
    [["block", "1", "attention", "backward"]],
  ),
  worldMetadata(
    "backprop-through-tower:block-0-mlp-backward",
    "backprop-through-tower",
    "assistant-target-backprop-through-tower-block-0-mlp-backward",
    ["block-0-MLP-backward"],
    [["block", "0", "mlp", "backward"]],
  ),
  worldMetadata(
    "backprop-through-tower:block-0-attention-backward",
    "backprop-through-tower",
    "assistant-target-backprop-through-tower-block-0-attention-backward",
    ["block-0-attention-backward"],
    [["block", "0", "attention", "backward"]],
  ),
  worldMetadata(
    "backprop-through-tower:embedding-gradient-output",
    "backprop-through-tower",
    "assistant-target-backprop-through-tower-embedding-gradient-output",
    ["dH0-output"],
    [["embedding", "gradient", "output"]],
  ),

  worldMetadata(
    "parameter-matrix:selected-cell",
    "parameter-matrix",
    "assistant-target-parameter-matrix-selected-cell",
    ["WQ-cell-3-6"],
    [["selected", "cell"]],
  ),
  // The cell rig is nested under the matrix. Put its equally exact semantic
  // match first so a ray that hits the rig resolves to the cell, while every
  // other matrix hit still falls through to the matrix target below.
  worldMetadata(
    "parameter-matrix:wq-matrix",
    "parameter-matrix",
    "assistant-target-parameter-matrix-wq-matrix",
    ["WQ-matrix"],
    [["wq", "matrix"]],
  ),
  worldMetadata(
    "parameter-matrix:stored-weight",
    "parameter-matrix",
    "assistant-target-parameter-matrix-stored-weight",
    ["weight-register"],
    [["stored", "weight"]],
  ),
  worldMetadata(
    "parameter-matrix:gradient-contributions",
    "parameter-matrix",
    "assistant-target-parameter-matrix-gradient-contributions",
    ["gradient-contribution-stream"],
    [["gradient", "contributions"]],
  ),
  worldMetadata(
    "parameter-matrix:gradient-accumulator",
    "parameter-matrix",
    "assistant-target-parameter-matrix-gradient-accumulator",
    ["gradient-accumulator"],
    [["gradient", "accumulator"]],
  ),
  worldMetadata(
    "parameter-matrix:settled-gradient",
    "parameter-matrix",
    "assistant-target-parameter-matrix-settled-gradient",
    ["settled-gradient-register"],
    [["settled", "gradient"]],
  ),

  worldMetadata(
    "adamw-state:optimizer-inputs",
    "adamw-state",
    "assistant-target-adamw-state-optimizer-inputs",
    ["adamw-inputs"],
    [["optimizer", "inputs"]],
  ),
  worldMetadata(
    "adamw-state:clip-check",
    "adamw-state",
    "assistant-target-adamw-state-clip-check",
    ["global-norm-clip-check"],
    [["clip", "check"]],
  ),
  worldMetadata(
    "adamw-state:first-moment-lane",
    "adamw-state",
    "assistant-target-adamw-state-first-moment-lane",
    ["adam-first-moment"],
    [["first", "moment"]],
  ),
  worldMetadata(
    "adamw-state:second-moment-lane",
    "adamw-state",
    "assistant-target-adamw-state-second-moment-lane",
    ["adam-second-moment"],
    [["second", "moment"]],
  ),
  worldMetadata(
    "adamw-state:normalized-gradient",
    "adamw-state",
    "assistant-target-adamw-state-normalized-gradient",
    ["adam-normalized-gradient"],
    [["normalized", "gradient"]],
  ),
  worldMetadata(
    "adamw-state:update-components",
    "adamw-state",
    "assistant-target-adamw-state-update-components",
    ["adam-decay-components"],
    [["update", "components"]],
  ),
  worldMetadata(
    "adamw-state:delta-weight",
    "adamw-state",
    "assistant-target-adamw-state-delta-weight",
    ["adamw-delta-weight"],
    [["delta", "weight"]],
  ),

  worldMetadata(
    "weight-update:stored-weight-before",
    "weight-update",
    "assistant-target-weight-update-stored-weight-before",
    ["old-weight-tile"],
    [["stored", "weight", "before"]],
  ),
  worldMetadata(
    "weight-update:delta-weight",
    "weight-update",
    "assistant-target-weight-update-delta-weight",
    ["delta-weight-tile"],
    [["delta", "weight"]],
  ),
  worldMetadata(
    "weight-update:scalar-addition",
    "weight-update",
    "assistant-target-weight-update-scalar-addition",
    ["parameter-update-plus"],
    [["scalar", "addition"]],
  ),
  worldMetadata(
    "weight-update:updated-weight",
    "weight-update",
    "assistant-target-weight-update-updated-weight",
    ["updated-weight-tile"],
    [["updated", "weight"]],
  ),
  worldMetadata(
    "weight-update:matrix-before",
    "weight-update",
    "assistant-target-weight-update-matrix-before",
    ["WQ-before-board"],
    [["matrix", "before"]],
  ),
  worldMetadata(
    "weight-update:matrix-after",
    "weight-update",
    "assistant-target-weight-update-matrix-after",
    ["WQ-after-board"],
    [["matrix", "after"]],
  ),

  worldMetadata(
    "model-changed-next-step:old-parameter-state",
    "model-changed-next-step",
    "assistant-target-model-changed-next-step-old-parameter-state",
    ["theta0-model"],
    [["old", "parameter", "state"]],
  ),
  worldMetadata(
    "model-changed-next-step:updated-parameter-state",
    "model-changed-next-step",
    "assistant-target-model-changed-next-step-updated-parameter-state",
    ["theta1-model"],
    [["updated", "parameter", "state"]],
  ),
  worldMetadata(
    "model-changed-next-step:gradient-buffer",
    "model-changed-next-step",
    "assistant-target-model-changed-next-step-gradient-buffer",
    ["gradient-buffer"],
    [["gradient", "buffer"]],
  ),
  worldMetadata(
    "model-changed-next-step:optimizer-memory",
    "model-changed-next-step",
    "assistant-target-model-changed-next-step-optimizer-memory",
    ["adam-memory"],
    [["optimizer", "memory"]],
  ),
  worldMetadata(
    "model-changed-next-step:next-batch",
    "model-changed-next-step",
    "assistant-target-model-changed-next-step-next-batch",
    ["next-batch-board"],
    [["next", "batch"]],
  ),
  worldMetadata(
    "model-changed-next-step:training-loop",
    "model-changed-next-step",
    "assistant-target-model-changed-next-step-training-loop",
    ["next-training-route"],
    [["training", "loop"]],
  ),
];
