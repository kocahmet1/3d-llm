import type {
  AssistantTargetContext,
  AssistantTargetWorldMetadata,
} from "./assistantContext";
import { SELECTED_TRACE } from "./trainingTrace";

type TargetInput = Omit<AssistantTargetContext, "stationId" | "kind">;

function component(
  stationId: string,
  input: TargetInput,
): AssistantTargetContext {
  return {
    ...input,
    stationId,
    kind: "component",
  };
}

function worldMetadata(
  targetId: string,
  stationId: string,
  canonicalObjectName: string,
  containsTokenSets: readonly (readonly string[])[],
  preferredSide: AssistantTargetWorldMetadata["anchor"]["preferredSide"] = "target-front",
  verticalOffset = 0.45,
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
      preferredSide,
      standOffDistance: 2.6,
      verticalOffset,
      lookAt: "target-bounds-center",
      pointAt: "target-bounds-center",
    },
  };
}

const sourceRows = SELECTED_TRACE.batch.inputTokenIds.map((row, rowIndex) => [
  ...row,
  SELECTED_TRACE.batch.targetTokenIds[rowIndex][row.length - 1],
]);

const tokenStreamStation = "token-stream-context";

const tokenStreamTargets: readonly AssistantTargetContext[] = [
  component(tokenStreamStation, {
    id: "token-stream:source-rows",
    label: "Independent source-token rows",
    aliases: ["source rows", "token streams", "seven-token rows", "S rows"],
    summary:
      "Two independent length-seven token-ID rows arrive from preprocessing and remain in separate lanes.",
    role:
      "Each row supplies one complete T+1 source window from which the next chamber can construct aligned inputs and targets.",
    inputs: ["Two ordered token-ID sequences from the prepared corpus"],
    operation:
      "Preserve token order and example boundaries while carrying each row toward the shared window cutter.",
    outputs: ["Two independently addressable source rows"],
    formula: "S[b, 0:T+1], with T=6",
    shape: "S [2,7]",
    exactValues: { rows: sourceRows, sequenceLength: 7, batchSize: 2 },
    whyItMatters:
      "Mixing rows would create false training examples, so batch identity must survive every later slice.",
    commonMisconceptions: [
      "The two rows are separate examples, not consecutive pieces of one sentence.",
      "These integers are token addresses, not embedding vectors.",
    ],
    relatedTargetIds: [
      "token-stream:selection-clamps",
      "token-stream:window-cutter",
      "token-stream:selected-windows",
    ],
    explanationByMode: {
      story:
        "Two numbered trains enter on parallel tracks, and neither train may swap cars with the other.",
      structure:
        "The chamber begins with two rows of seven scalar token IDs, one row per batch example.",
      math:
        "For each b in {0,1}, the source is S[b,0:7]; the batch tensor has shape [2,7].",
      code:
        "source_rows = stack([input_ids[b] + [target_ids[b][-1]] for b in range(2)])",
    },
  }),
  component(tokenStreamStation, {
    id: "token-stream:selection-clamps",
    label: "Seven-token selection clamps",
    aliases: ["clamps", "window clamps", "T plus one selectors"],
    summary:
      "A gold clamp locks onto exactly seven consecutive IDs in each source lane.",
    role:
      "It makes the context-length contract explicit: six model inputs require a seventh token to provide the final next-token answer.",
    inputs: ["An independent source-token row", "Configured context length T=6"],
    operation:
      "Select one contiguous T+1 span without crossing a row boundary.",
    outputs: ["One selected seven-token span per row"],
    formula: "window_length = T + 1 = 7",
    shape: "2 selections x 7 token IDs",
    exactValues: { contextLength: 6, selectedLength: 7, rowCount: 2 },
    whyItMatters:
      "A T-token input has T next-token labels only when the source span contains one extra token.",
    commonMisconceptions: [
      "The clamp does not attend to tokens; it is deterministic data slicing.",
      "The seventh token is not discarded globally; it becomes the last target.",
    ],
    relatedTargetIds: [
      "token-stream:source-rows",
      "token-stream:window-cutter",
      "token-stream:output-docks",
    ],
    explanationByMode: {
      story:
        "Each track gets a ruler that grips seven adjacent cars: six questions plus the next answer.",
      structure:
        "Two identical selectors act independently on the two batch rows.",
      math:
        "Selecting T+1 items guarantees |X_b|=|Y_b|=T after a one-position shift.",
      code:
        "selected = source_row[start : start + context_length + 1]",
    },
  }),
  component(tokenStreamStation, {
    id: "token-stream:window-cutter",
    label: "Shared context-window cutter",
    aliases: ["window cutter", "T plus one cutter", "context slicer"],
    summary:
      "The cutter applies the same fixed-length selection rule to both independent source rows.",
    role:
      "It turns a token stream into bounded training material while enforcing the model's context length.",
    inputs: ["Two clamped source spans", "T=6"],
    operation:
      "Cut each lane at the clamp boundaries and route the selected span to its output dock.",
    outputs: ["Two isolated T+1 windows ready for offset slicing"],
    formula: "W_b = S[b, start:start+T+1]",
    shape: "W [2,7]",
    exactValues: { selectedWindows: sourceRows, contextLength: 6 },
    whyItMatters:
      "All examples entering this teaching model must obey a consistent maximum sequence length.",
    commonMisconceptions: [
      "The cutter does not change token values or learn where to cut in this trace.",
      "It applies one rule to both lanes but never merges their contents.",
    ],
    relatedTargetIds: [
      "token-stream:source-rows",
      "token-stream:selection-clamps",
      "token-stream:selected-windows",
    ],
    explanationByMode: {
      story:
        "A shared gantry cuts matching seven-car sections from two separate tracks.",
      structure:
        "One deterministic operation is reused across batch rows while row identity remains intact.",
      math:
        "W_b is a contiguous length-seven slice of S_b, and W has shape [B,T+1]=[2,7].",
      code:
        "windows = source_ids[:, window_start : window_start + T + 1]",
    },
  }),
  component(tokenStreamStation, {
    id: "token-stream:output-docks",
    label: "Per-row output docks",
    aliases: ["window docks", "output platforms", "lane docks"],
    summary:
      "Two color-coded docks receive the selected windows without collapsing the batch dimension.",
    role:
      "They preserve the one-window-per-example handoff between selection and shifted-target construction.",
    inputs: ["The two cut seven-token windows"],
    operation:
      "Receive each selected span on the dock assigned to its original batch row.",
    outputs: ["Two docked windows with stable row identity"],
    shape: "2 docks, each holding [7]",
    exactValues: { dockCount: 2, itemsPerDock: 7 },
    whyItMatters:
      "The following shift must pair each input row only with targets from that same source row.",
    commonMisconceptions: [
      "The different dock colors identify routes; they do not imply different algorithms.",
      "Docking is a visual handoff, not a numerical transformation.",
    ],
    relatedTargetIds: [
      "token-stream:selection-clamps",
      "token-stream:selected-windows",
    ],
    explanationByMode: {
      story:
        "Each cut train parks at its own platform so its cars stay together.",
      structure:
        "The two lane outputs preserve the leading batch axis and the seven positions within each row.",
      math:
        "The handoff is identity-preserving: dock_b = W_b.",
      code:
        "docked_windows[b] = selected_windows[b]",
    },
  }),
  component(tokenStreamStation, {
    id: "token-stream:selected-windows",
    label: "Selected T+1 windows",
    aliases: ["selected windows", "window result", "S windows"],
    summary:
      "The completed two-by-seven window tensor is the chamber's output and the exact source for X/Y shifting.",
    role:
      "It exposes the extra-token relationship that lets every input position receive a next-token target.",
    inputs: ["Two docked length-seven spans"],
    operation:
      "Validate both windows and hand them to the shifted-target chamber.",
    outputs: ["S[2,7] ready for X=S[:,:-1] and Y=S[:,1:]"],
    formula: "S -> (X=S[:,:-1], Y=S[:,1:])",
    shape: "S [2,7], followed by X [2,6] and Y [2,6]",
    exactValues: {
      selectedWindows: sourceRows,
      nextInputTokenIds: SELECTED_TRACE.batch.inputTokenIds,
      nextTargetTokenIds: SELECTED_TRACE.batch.targetTokenIds,
    },
    whyItMatters:
      "This is the precise boundary between choosing context windows and constructing supervised next-token pairs.",
    commonMisconceptions: [
      "The selected window is not yet the model input batch; it still contains the extra answer token.",
      "No labels are invented: targets are the same row shifted by one position.",
    ],
    relatedTargetIds: [
      "token-stream:window-cutter",
      "token-stream:output-docks",
      "batch-shift:source-matrix",
    ],
    explanationByMode: {
      story:
        "The two seven-car sections leave the hall ready to be copied into question and answer tracks.",
      structure:
        "The output retains shape [2,7] until the next chamber takes two overlapping six-column views.",
      math:
        "For each b and t<6, X[b,t]=S[b,t] and Y[b,t]=S[b,t+1].",
      code:
        "x, y = selected_windows[:, :-1], selected_windows[:, 1:]",
    },
  }),
];

const batchShiftStation = "batch-shifted-targets";

const batchShiftTargets: readonly AssistantTargetContext[] = [
  component(batchShiftStation, {
    id: "batch-shift:source-matrix",
    label: "Selected source matrix S",
    aliases: ["source matrix", "S matrix", "two by seven window"],
    summary:
      "S is the two-by-seven integer matrix whose rows are the selected context windows.",
    role:
      "It is the common source for both the model-input batch and the one-token-ahead target batch.",
    inputs: ["Two selected T+1 token windows"],
    operation:
      "Hold the windows in batch-major, sequence-order form before creating two offset views.",
    outputs: ["A source for the X and Y working copies"],
    formula: "S in token_ids^[B x (T+1)]",
    shape: "S [2,7]",
    exactValues: { sourceMatrix: sourceRows, batchSize: 2, columns: 7 },
    whyItMatters:
      "Deriving X and Y from one immutable source guarantees that every target is the actual next token in the same row.",
    commonMisconceptions: [
      "S is not a learned parameter matrix.",
      "The two rows are batch examples; shifting never carries a token between rows.",
    ],
    relatedTargetIds: [
      "batch-shift:working-copies",
      "batch-shift:input-slice",
      "batch-shift:target-shift",
    ],
    explanationByMode: {
      story:
        "One two-row master strip is about to be copied onto a question route and an answer route.",
      structure:
        "S has batch axis 2 and sequence axis 7, with ordered token IDs in each row.",
      math:
        "S has B=2 rows and T+1=7 columns, so two overlapping length-six slices are possible.",
      code:
        "source = selected_windows  # shape: [2, 7]",
    },
  }),
  component(batchShiftStation, {
    id: "batch-shift:working-copies",
    label: "X/Y working copies",
    aliases: ["working copies", "duplicated source", "copy for X", "copy for Y"],
    summary:
      "The source matrix is duplicated visually so the two offset slices can be compared side by side.",
    role:
      "It makes clear that inputs and labels share underlying token rows but use different column ranges.",
    inputs: ["Source matrix S[2,7]"],
    operation:
      "Create two read-only views of S: one destined to keep columns 0 through 5 and one to keep columns 1 through 6.",
    outputs: ["An input-side view and a target-side view"],
    formula: "copy_X = S; copy_Y = S",
    shape: "two views of [2,7]",
    exactValues: { inputView: sourceRows, targetView: sourceRows },
    whyItMatters:
      "Seeing both views prevents the shifted targets from looking like unrelated labels.",
    commonMisconceptions: [
      "Duplicating the display does not duplicate training examples in the batch.",
      "These can be tensor views; a physical memory copy is not mathematically required.",
    ],
    relatedTargetIds: [
      "batch-shift:source-matrix",
      "batch-shift:input-slice",
      "batch-shift:target-shift",
    ],
    explanationByMode: {
      story:
        "The master strip forks into two transparent copies so each route can trim a different edge.",
      structure:
        "Both branches initially contain identical [2,7] values and retain the same batch rows.",
      math:
        "Before slicing, copy_X[b,t]=copy_Y[b,t]=S[b,t].",
      code:
        "x_view, y_view = source, source",
    },
  }),
  component(batchShiftStation, {
    id: "batch-shift:input-slice",
    label: "Input slice 0:6",
    aliases: ["X slice", "input slicer", "drop last token"],
    summary:
      "The cyan branch keeps the first six columns of every source row and drops the final token.",
    role:
      "It creates the token IDs that enter the model at the six context positions.",
    inputs: ["The X-side [2,7] working view"],
    operation: "Take columns 0 through 5 independently from every row.",
    outputs: ["Input batch X[2,6]"],
    formula: "X = S[:, 0:6] = S[:, :-1]",
    shape: "X [2,6]",
    exactValues: { inputTokenIds: SELECTED_TRACE.batch.inputTokenIds },
    whyItMatters:
      "The model must receive the prefix token at each position before being judged on the following token.",
    commonMisconceptions: [
      "The last source token is omitted only from X; it remains the last answer in Y.",
      "Slicing columns does not shorten one row more than the other.",
    ],
    relatedTargetIds: [
      "batch-shift:working-copies",
      "batch-shift:input-batch",
      "batch-shift:target-shift",
    ],
    explanationByMode: {
      story:
        "The question route trims the final car, leaving six tokens the model is allowed to see.",
      structure:
        "The operation removes column 6 while preserving both rows and columns 0 through 5.",
      math:
        "X[b,t]=S[b,t] for b in {0,1} and t in {0,...,5}.",
      code:
        "x = source[:, :-1]",
    },
  }),
  component(batchShiftStation, {
    id: "batch-shift:target-shift",
    label: "One-token target shift",
    aliases: ["Y shift", "target slicer", "drop first token", "shift labels"],
    summary:
      "The magenta branch drops column zero and shifts columns one through six into target positions zero through five.",
    role:
      "It aligns each input token position with the actual token that followed it in the source row.",
    inputs: ["The Y-side [2,7] working view"],
    operation:
      "Take columns 1 through 6 from each row and reindex them as target positions 0 through 5.",
    outputs: ["Next-token target batch Y[2,6]"],
    formula: "Y = S[:, 1:7] = S[:, 1:]",
    shape: "Y [2,6]",
    exactValues: { targetTokenIds: SELECTED_TRACE.batch.targetTokenIds },
    whyItMatters:
      "This deterministic offset creates all twelve supervised next-token answers without manual labeling.",
    commonMisconceptions: [
      "Y is not produced by the model; it comes from the data.",
      "Shifted means reindexed by one position, not numerically incremented token IDs.",
    ],
    relatedTargetIds: [
      "batch-shift:working-copies",
      "batch-shift:input-slice",
      "batch-shift:target-batch",
    ],
    explanationByMode: {
      story:
        "The answer route trims the first car, so each remaining car sits one place beside the token that preceded it.",
      structure:
        "Columns 1 through 6 become a six-column label row for each unchanged batch example.",
      math:
        "Y[b,t]=S[b,t+1], aligned with X[b,t]=S[b,t].",
      code:
        "y = source[:, 1:]",
    },
  }),
  component(batchShiftStation, {
    id: "batch-shift:input-batch",
    label: "Model input batch X",
    aliases: ["input batch", "X batch", "model route"],
    summary:
      "X contains the exact twelve token IDs sent through embeddings and the Transformer tower.",
    role:
      "It is the data-bearing branch of the forward pass: two examples by six token positions.",
    inputs: ["Columns 0 through 5 of each source row"],
    operation:
      "Package the input slice as a batch while preserving row and position indices.",
    outputs: ["Twelve token addresses for embedding lookup"],
    formula: "X[b,t] = S[b,t]",
    shape: "X [2,6]",
    exactValues: {
      tokenIds: SELECTED_TRACE.batch.inputTokenIds,
      selectedBatch: SELECTED_TRACE.batch.selectedBatch,
      selectedPosition: SELECTED_TRACE.batch.selectedPosition,
      selectedTokenId: SELECTED_TRACE.batch.selectedInputTokenId,
    },
    whyItMatters:
      "Every later activation can be traced back to one of these twelve discrete input positions.",
    commonMisconceptions: [
      "X contains IDs, not the learned vectors selected by those IDs.",
      "The model processes both rows with shared weights; it does not learn separate parameters per row.",
    ],
    relatedTargetIds: [
      "batch-shift:input-slice",
      "batch-shift:target-batch",
      "station:embedding",
    ],
    explanationByMode: {
      story:
        "The cyan tray carries twelve prompts into the model route.",
      structure:
        "Two batch rows times six sequence positions produce twelve lookup addresses.",
      math:
        "X is an integer tensor in {0,...,15}^{2x6}.",
      code:
        "hidden = token_embedding[x] + position_embedding[:6]",
    },
  }),
  component(batchShiftStation, {
    id: "batch-shift:target-batch",
    label: "Next-token target batch Y",
    aliases: ["target batch", "Y batch", "answer route", "labels"],
    summary:
      "Y contains the exact next-token answer paired with every position in X.",
    role:
      "It bypasses the model and waits at the loss calculation so predictions can be scored against ground truth.",
    inputs: ["Columns 1 through 6 of each source row"],
    operation:
      "Package the shifted slice as twelve categorical labels aligned index-for-index with X.",
    outputs: ["Twelve correct-token IDs for cross-entropy"],
    formula: "Y[b,t] = S[b,t+1]",
    shape: "Y [2,6]",
    exactValues: {
      tokenIds: SELECTED_TRACE.batch.targetTokenIds,
      selectedBatch: SELECTED_TRACE.batch.selectedBatch,
      selectedPosition: SELECTED_TRACE.batch.selectedPosition,
      selectedTargetTokenId: SELECTED_TRACE.batch.selectedTargetTokenId,
    },
    whyItMatters:
      "Cross-entropy needs one correct vocabulary index for every valid prediction, so X and Y must align exactly.",
    commonMisconceptions: [
      "Targets supervise training but are not fed into this forward pass as hidden states.",
      "Y has the same shape as X because each visible input position predicts one following token.",
    ],
    relatedTargetIds: [
      "batch-shift:target-shift",
      "batch-shift:input-batch",
      "station:target-comparison",
    ],
    explanationByMode: {
      story:
        "The magenta tray carries twelve sealed answer cards directly to the scoring route.",
      structure:
        "Y mirrors X's [batch,position] indexing while storing the next source token at each cell.",
      math:
        "The pair (X[b,t],Y[b,t])=(S[b,t],S[b,t+1]) defines each next-token example.",
      code:
        "loss = cross_entropy(logits.reshape(-1, vocab_size), y.reshape(-1))",
    },
  }),
];

const transformerTowerStation = "transformer-tower";

const transformerTowerTargets: readonly AssistantTargetContext[] = [
  component(transformerTowerStation, {
    id: "tower:h0",
    label: "Entering hidden state H0",
    aliases: ["H0", "tower input", "embedding output"],
    summary:
      "H0 is the full batch of token-plus-position vectors entering the first Transformer block.",
    role:
      "It carries token identity and position information into the learned contextual transformations.",
    inputs: ["Token embeddings", "Position embeddings"],
    operation:
      "Hold one model-width vector for each of the twelve batch-position cells.",
    outputs: ["The input activation tensor consumed by block 0"],
    formula: "H0 = E_token[X] + E_position",
    shape: "H0 [2,6,8]",
    exactValues: {
      selectedBatch: SELECTED_TRACE.batch.selectedBatch,
      selectedPosition: SELECTED_TRACE.batch.selectedPosition,
      selectedVector: SELECTED_TRACE.embedding.selectedHiddenVector,
    },
    whyItMatters:
      "This is the initial representation that every block refines while keeping the same outer tensor shape.",
    commonMisconceptions: [
      "H0 is an activation tensor, not a learned parameter matrix.",
      "Adding position vectors does not add a new sequence position; it changes each eight-value row.",
    ],
    relatedTargetIds: ["tower:block-0", "tower:h1"],
    explanationByMode: {
      story:
        "Twelve model-width capsules arrive at the base of the tower carrying identity plus position.",
      structure:
        "The outer axes are batch 2 and sequence 6; each cell contains an eight-channel hidden vector.",
      math:
        "H0 in R^{2x6x8}; the selected row is the elementwise sum of its token and position vectors.",
      code:
        "h = token_embedding[x] + position_embedding[:T]",
    },
  }),
  component(transformerTowerStation, {
    id: "tower:block-0",
    label: "Transformer block 0",
    aliases: ["block zero", "first block", "theta zero"],
    summary:
      "The first owned Transformer block applies causal self-attention, an MLP, and two residual additions to H0.",
    role:
      "It performs the first learned contextual update using parameter set theta0.",
    inputs: ["H0[2,6,8]", "Learned block-0 parameters theta0"],
    operation:
      "Normalize, attend causally, add the attention residual, normalize again, apply the shared MLP, and add the MLP residual.",
    outputs: ["Updated hidden state H1[2,6,8]"],
    formula:
      "U0=H0+MHA0(LN1_0(H0)); H1=U0+MLP0(LN2_0(U0))",
    shape: "[2,6,8] -> [2,6,8]",
    exactValues: { blockIndex: 0, attentionHeads: 2, modelWidth: 8, mlpWidth: 32 },
    whyItMatters:
      "Block 0 is where each position first gathers causal context from earlier positions and transforms it nonlinearly.",
    commonMisconceptions: [
      "The block preserves shape but generally changes every floating-point activation.",
      "Block 0 and block 1 share architecture, not parameter values.",
    ],
    relatedTargetIds: ["tower:h0", "tower:h1", "tower:block-1"],
    explanationByMode: {
      story:
        "The first reactor lets each token consult its past, then refines the result through a shared nonlinear workshop.",
      structure:
        "Attention and MLP sublayers each sit on a pre-normalized branch with an additive residual bypass.",
      math:
        "Two residual equations map H0 to H1 without changing B, T, or C.",
      code:
        "h = h + block0.attn(block0.ln1(h)); h = h + block0.mlp(block0.ln2(h))",
    },
  }),
  component(transformerTowerStation, {
    id: "tower:h1",
    label: "Intermediate hidden state H1",
    aliases: ["H1", "block zero output", "block one input"],
    summary:
      "H1 is the contextual activation tensor produced by block 0 and immediately consumed by block 1.",
    role:
      "It is the handoff between independently parameterized blocks, carrying the first layer of learned context.",
    inputs: ["H0 transformed by block 0"],
    operation:
      "Preserve all batch and position slots while storing block 0's updated eight-channel vectors.",
    outputs: ["Input activation tensor for block 1"],
    formula: "H1 = Block0(H0; theta0)",
    shape: "H1 [2,6,8]",
    exactValues: { batchSize: 2, sequenceLength: 6, modelWidth: 8, valuesShown: false },
    whyItMatters:
      "It demonstrates that stacked blocks communicate through activations, not by passing or sharing their parameter matrices.",
    commonMisconceptions: [
      "H1 is not the final normalized tower output.",
      "Its unchanged shape does not mean block 0 acted as the identity.",
    ],
    relatedTargetIds: ["tower:h0", "tower:block-0", "tower:block-1", "tower:h2"],
    explanationByMode: {
      story:
        "After the first reactor, the same twelve capsules carry richer contextual contents to the second.",
      structure:
        "H1 is both block 0's output boundary and block 1's input boundary.",
      math:
        "H1 remains in R^{2x6x8}, although its values differ from H0.",
      code:
        "h1 = block0(h0)",
    },
  }),
  component(transformerTowerStation, {
    id: "tower:block-1",
    label: "Transformer block 1",
    aliases: ["block one", "second block", "theta one"],
    summary:
      "The second Transformer block repeats the same sublayer pattern using its own learned parameter set theta1.",
    role:
      "It performs a second causal contextual update on the representation already produced by block 0.",
    inputs: ["H1[2,6,8]", "Learned block-1 parameters theta1"],
    operation:
      "Apply pre-normalized causal attention and MLP updates, each merged through its own residual addition.",
    outputs: ["Updated hidden state H2[2,6,8]"],
    formula:
      "U1=H1+MHA1(LN1_1(H1)); H2=U1+MLP1(LN2_1(U1))",
    shape: "[2,6,8] -> [2,6,8]",
    exactValues: { blockIndex: 1, attentionHeads: 2, modelWidth: 8, mlpWidth: 32 },
    whyItMatters:
      "Depth lets the model refine representations through another independently learned composition of context and features.",
    commonMisconceptions: [
      "Block 1 does not reuse theta0; its weights are separately learned.",
      "It processes the whole H1 tensor, not only a single highlighted token.",
    ],
    relatedTargetIds: ["tower:h1", "tower:h2", "tower:final-norm"],
    explanationByMode: {
      story:
        "A second reactor with different controls takes the already contextual capsules and refines them again.",
      structure:
        "The architecture matches block 0, but every LayerNorm, attention, and MLP module belongs to block 1.",
      math:
        "Block1_theta1: R^{2x6x8} -> R^{2x6x8}.",
      code:
        "h = h + block1.attn(block1.ln1(h)); h = h + block1.mlp(block1.ln2(h))",
    },
  }),
  component(transformerTowerStation, {
    id: "tower:h2",
    label: "Top-block hidden state H2",
    aliases: ["H2", "block one output", "pre-final hidden state"],
    summary:
      "H2 is the output of the second and final Transformer block, before the tower's final normalization.",
    role:
      "It contains the deepest contextual representation while retaining one vector per batch-position cell.",
    inputs: ["H1 transformed by block 1"],
    operation:
      "Hold the final block's residual-stream values for all twelve positions.",
    outputs: ["Input tensor for the final LayerNorm"],
    formula: "H2 = Block1(H1; theta1)",
    shape: "H2 [2,6,8]",
    exactValues: { batchSize: 2, sequenceLength: 6, modelWidth: 8, valuesShown: false },
    whyItMatters:
      "The final normalization and vocabulary projection can only act on the representation the stacked blocks have built here.",
    commonMisconceptions: [
      "H2 is not yet vocabulary logits.",
      "It has twelve vectors, even when the guide spotlights one selected position.",
    ],
    relatedTargetIds: ["tower:h1", "tower:block-1", "tower:final-norm"],
    explanationByMode: {
      story:
        "The capsules leave the last reactor carrying the tower's deepest features, then approach a final calibration ring.",
      structure:
        "H2 closes the block stack and opens the final-normalization stage.",
      math:
        "H2 in R^{B x T x C}=R^{2x6x8}.",
      code:
        "h2 = block1(h1)",
    },
  }),
  component(transformerTowerStation, {
    id: "tower:final-norm",
    label: "Final LayerNorm LN_f",
    aliases: ["final norm", "LN f", "tower normalization", "normalization halo"],
    summary:
      "The learned final LayerNorm independently centers and rescales each H2 vector across its eight channels.",
    role:
      "It standardizes the residual stream before the shared vocabulary projection reads it.",
    inputs: ["H2[2,6,8]", "Learned scale gamma_f and bias beta_f"],
    operation:
      "For every batch-position vector, compute its channel mean and variance, normalize it, then apply learned scale and bias.",
    outputs: ["Final hidden-state tensor H_final[2,6,8]"],
    formula:
      "H_final = gamma_f * (H2 - mean(H2))/sqrt(var(H2)+epsilon) + beta_f",
    shape: "[2,6,8] -> [2,6,8], normalized over the last axis",
    exactValues: { normalizedWidth: 8, independentVectors: 12 },
    whyItMatters:
      "The output head receives consistently scaled representations while the learned affine terms preserve useful channel calibration.",
    commonMisconceptions: [
      "LayerNorm does not normalize across batch rows or sequence positions.",
      "Final normalization changes values, not tensor dimensions.",
    ],
    relatedTargetIds: ["tower:h2", "tower:final-output"],
    explanationByMode: {
      story:
        "The final ring calibrates each eight-dial capsule on its own before it leaves the tower.",
      structure:
        "One shared LayerNorm module is applied independently to each of the twelve hidden vectors.",
      math:
        "Mean and variance are taken over C=8 for each fixed (b,t).",
      code:
        "h_final = final_layer_norm(h2)",
    },
  }),
  component(transformerTowerStation, {
    id: "tower:final-output",
    label: "Final hidden state H_final",
    aliases: ["H final", "tower output", "normalized hidden state"],
    summary:
      "H_final is the normalized tower output handed to the vocabulary projection for every valid token position.",
    role:
      "It is the activation interface between contextual processing and next-token scoring.",
    inputs: ["H2 passed through final LayerNorm"],
    operation:
      "Expose one normalized eight-channel vector per batch and sequence position.",
    outputs: ["Twelve vectors ready for the shared 8-to-16 vocabulary projection"],
    formula: "H_final = LN_f(H2)",
    shape: "H_final [2,6,8]",
    exactValues: {
      vectorCount: 12,
      modelWidth: 8,
      followingVocabularySize: 16,
      valuesShown: false,
    },
    whyItMatters:
      "These are the exact features the output matrix converts into sixteen logits at each of twelve positions.",
    commonMisconceptions: [
      "H_final contains features, not probabilities or token IDs.",
      "The same vocabulary projection is applied to all twelve vectors.",
    ],
    relatedTargetIds: [
      "tower:h2",
      "tower:final-norm",
      "station:vocabulary-projection",
    ],
    explanationByMode: {
      story:
        "Twelve calibrated capsules exit the tower and line up for the shared vocabulary scorer.",
      structure:
        "The output keeps the [batch,position,channel] axes established at H0.",
      math:
        "Each H_final[b,t,:] in R^8 will be multiplied by a shared 8-by-16 output matrix.",
      code:
        "logits = h_final @ output_weight  # [2, 6, 16]",
    },
  }),
];

const transformerBlockStation = "transformer-block";

const transformerBlockTargets: readonly AssistantTargetContext[] = [
  component(transformerBlockStation, {
    id: "transformer-block:input-h",
    label: "Block input H",
    aliases: ["input H", "residual stream input", "selected hidden vector"],
    summary:
      "H is the incoming residual-stream tensor; the display follows one selected eight-channel vector through the block.",
    role:
      "It is the common source that forks into the attention transform and the first unchanged residual bypass.",
    inputs: ["Hidden state from the embedding stage or previous block"],
    operation:
      "Expose the same incoming values to both branches without changing their batch, position, or channel indices.",
    outputs: ["Attention-branch input", "First residual-bypass input"],
    formula: "H -> {H, LN1(H)}",
    shape: "full H [2,6,8]; selected row H[b,t,:] [8]",
    exactValues: { selectedVectorWidth: 8, fullShape: [2, 6, 8] },
    whyItMatters:
      "Both the learned update and the identity path must start from exactly the same residual-stream state.",
    commonMisconceptions: [
      "The highlighted vector is one row of the full tensor, not the only vector processed.",
      "Forking does not split the eight channels between branches; both branches receive all eight.",
    ],
    relatedTargetIds: [
      "transformer-block:attention-residual",
      "transformer-block:attention-update",
    ],
    explanationByMode: {
      story:
        "One eight-dial capsule reaches a fork: a copy stays unchanged while another visits the attention workshop.",
      structure:
        "The full [2,6,8] residual stream fans out to two branches with identical indexing.",
      math:
        "The identity branch carries H; the learned branch evaluates MHA(LN1(H)).",
      code:
        "residual_h = h; attention_input = ln1(h)",
    },
  }),
  component(transformerBlockStation, {
    id: "transformer-block:attention-residual",
    label: "Attention residual bypass",
    aliases: ["H bypass", "first residual", "attention skip connection"],
    summary:
      "The first bypass carries H unchanged around LayerNorm and causal multi-head attention.",
    role:
      "It preserves the incoming residual stream so the attention update can be added instead of replacing it.",
    inputs: ["Block input H"],
    operation:
      "Route H directly to the first addition while the parallel attention branch computes A.",
    outputs: ["Identity operand H for U=H+A"],
    formula: "R_attn = H",
    shape: "[2,6,8] identity path",
    exactValues: { selectedVectorWidth: 8, transform: "identity" },
    whyItMatters:
      "The identity route supports stable information flow and gives the learned branch permission to encode a correction.",
    commonMisconceptions: [
      "A residual connection is an addition, not a concatenation.",
      "The bypass is unchanged; LayerNorm belongs only to the parallel transform branch in this pre-norm block.",
    ],
    relatedTargetIds: [
      "transformer-block:input-h",
      "transformer-block:attention-update",
      "transformer-block:attention-output",
    ],
    explanationByMode: {
      story:
        "The original capsule takes a short clear route to the first merge while its twin does contextual work.",
      structure:
        "This is the identity operand feeding the first elementwise plus.",
      math:
        "R_attn[b,t,c]=H[b,t,c] for every batch, position, and channel.",
      code:
        "u = h + attention(ln1(h))",
    },
  }),
  component(transformerBlockStation, {
    id: "transformer-block:attention-update",
    label: "Normalized causal-attention update A",
    aliases: ["attention update", "A vector", "LN1 attention branch", "MHA branch"],
    summary:
      "The learned branch normalizes H, lets each position attend only to allowed past-and-current positions, and returns an eight-channel update A.",
    role:
      "It injects context-dependent information into the residual stream before the first addition.",
    inputs: ["H[2,6,8]", "LN1 parameters", "Block-owned Q/K/V/output matrices"],
    operation:
      "Apply LN1, causal multi-head self-attention, head recombination, and the attention output projection.",
    outputs: ["Attention update A[2,6,8]"],
    formula: "A = MHA(LN1(H))",
    shape: "[2,6,8] -> [2,6,8]; 2 heads x width 4",
    exactValues: {
      attentionHeads: 2,
      headWidth: 4,
      modelWidth: 8,
      selectedQueryPosition: SELECTED_TRACE.attention.selectedQueryPosition,
    },
    whyItMatters:
      "This is the sublayer that makes each token representation depend on relevant earlier context.",
    commonMisconceptions: [
      "A is an update added to H, not the whole block output.",
      "Causal attention cannot read future positions even though all positions are processed in parallel.",
    ],
    relatedTargetIds: [
      "transformer-block:input-h",
      "transformer-block:attention-residual",
      "transformer-block:attention-output",
    ],
    explanationByMode: {
      story:
        "The working branch calibrates each capsule, consults allowed earlier capsules, and returns a contextual correction.",
      structure:
        "LN1 and multi-head attention form one transform branch parallel to the H identity route.",
      math:
        "A has the same shape as H so U[b,t,c]=H[b,t,c]+A[b,t,c] is defined elementwise.",
      code:
        "a = self_attention(ln1(h), causal=True)",
    },
  }),
  component(transformerBlockStation, {
    id: "transformer-block:attention-output",
    label: "First residual sum U",
    aliases: ["U", "H plus A", "attention residual output", "first add"],
    summary:
      "The first merge adds the original H and the causal-attention update A channel by channel.",
    role:
      "It commits contextual information to the residual stream and becomes the common source for the MLP stage.",
    inputs: ["Attention residual H", "Attention update A"],
    operation:
      "Align matching batch, position, and channel indices and add them elementwise.",
    outputs: ["Intermediate residual stream U[2,6,8]"],
    formula: "U = H + A = H + MHA(LN1(H))",
    shape: "[2,6,8] + [2,6,8] -> [2,6,8]",
    exactValues: { operandCount: 2, selectedVectorWidth: 8, fullShape: [2, 6, 8] },
    whyItMatters:
      "U preserves the original representation while carrying the attention-derived correction into the second sublayer.",
    commonMisconceptions: [
      "The plus is elementwise; it does not append A as extra channels.",
      "U is only the midpoint of the block, not the final output H'.",
    ],
    relatedTargetIds: [
      "transformer-block:attention-residual",
      "transformer-block:attention-update",
      "transformer-block:mlp-residual",
      "transformer-block:mlp-update",
    ],
    explanationByMode: {
      story:
        "The unchanged capsule and its contextual correction meet dial-for-dial, producing a revised capsule U.",
      structure:
        "The first fork closes at an elementwise residual addition, then U immediately opens the second fork.",
      math:
        "For every (b,t,c), U[b,t,c]=H[b,t,c]+A[b,t,c].",
      code:
        "u = h + a",
    },
  }),
  component(transformerBlockStation, {
    id: "transformer-block:mlp-residual",
    label: "MLP residual bypass",
    aliases: ["U bypass", "second residual", "MLP skip connection"],
    summary:
      "The second bypass carries U unchanged around LN2 and the feed-forward network.",
    role:
      "It preserves the attention-updated residual stream while the parallel MLP computes a feature update.",
    inputs: ["Intermediate state U"],
    operation:
      "Route U directly to the second elementwise addition.",
    outputs: ["Identity operand U for H'=U+F"],
    formula: "R_mlp = U",
    shape: "[2,6,8] identity path",
    exactValues: { selectedVectorWidth: 8, transform: "identity" },
    whyItMatters:
      "The second identity path lets the MLP specialize as a correction without erasing contextual information already stored in U.",
    commonMisconceptions: [
      "This residual carries U, not the original pre-attention H.",
      "It does not bypass the entire block; it bypasses only the MLP sublayer.",
    ],
    relatedTargetIds: [
      "transformer-block:attention-output",
      "transformer-block:mlp-update",
      "transformer-block:output-h",
    ],
    explanationByMode: {
      story:
        "The contextual capsule U keeps a safe copy while another copy visits the nonlinear workshop.",
      structure:
        "This identity route is parallel to LN2 followed by the shared MLP.",
      math:
        "R_mlp[b,t,c]=U[b,t,c] at every index.",
      code:
        "h_next = u + mlp(ln2(u))",
    },
  }),
  component(transformerBlockStation, {
    id: "transformer-block:mlp-update",
    label: "Normalized MLP update F",
    aliases: ["MLP update", "F vector", "LN2 MLP branch", "feed-forward branch"],
    summary:
      "The second learned branch normalizes U, expands each position independently from width 8 to 32, applies GELU, and projects back to width 8.",
    role:
      "It performs a shared nonlinear channel transformation at every batch-position cell.",
    inputs: ["U[2,6,8]", "LN2 parameters", "Block-owned 8-to-32 and 32-to-8 matrices"],
    operation:
      "Apply LN2, an affine expansion, GELU, and an affine contraction independently at each position.",
    outputs: ["MLP update F[2,6,8]"],
    formula: "F = W2 * GELU(W1 * LN2(U) + b1) + b2",
    shape: "[2,6,8] -> [2,6,32] -> [2,6,8]",
    exactValues: { modelWidth: 8, expansionWidth: 32, independentLanes: 12 },
    whyItMatters:
      "Attention mixes information across positions; the MLP then transforms features within each position using shared learned weights.",
    commonMisconceptions: [
      "The MLP does not mix different token positions.",
      "The temporary width-32 expansion is not the block's output shape.",
    ],
    relatedTargetIds: [
      "transformer-block:attention-output",
      "transformer-block:mlp-residual",
      "transformer-block:output-h",
    ],
    explanationByMode: {
      story:
        "Each capsule independently expands into thirty-two internal signals, passes a nonlinear gate, and compresses back to eight.",
      structure:
        "One shared position-wise MLP runs in twelve isolated lanes after LN2.",
      math:
        "F[b,t,:]=W2 GELU(W1 LN2(U[b,t,:])+b1)+b2.",
      code:
        "f = linear2(gelu(linear1(ln2(u))))",
    },
  }),
  component(transformerBlockStation, {
    id: "transformer-block:output-h",
    label: "Block output H prime",
    aliases: ["H prime", "block output", "U plus F", "second add"],
    summary:
      "The second merge adds U and the MLP update F to produce the completed block output H'.",
    role:
      "It closes the block's second residual branch and passes the refined residual stream to the next block or final LayerNorm.",
    inputs: ["MLP residual U", "MLP update F"],
    operation:
      "Add matching channels elementwise at every batch-position cell.",
    outputs: ["H'[2,6,8]"],
    formula: "H' = U + F = U + MLP(LN2(U))",
    shape: "[2,6,8] + [2,6,8] -> [2,6,8]",
    exactValues: { operandCount: 2, selectedVectorWidth: 8, fullShape: [2, 6, 8] },
    whyItMatters:
      "H' carries both contextual and position-wise learned updates forward while keeping the tower's stable interface shape.",
    commonMisconceptions: [
      "H' is not a derivative; the prime marks the updated hidden state.",
      "The block output has width 8, not the MLP's temporary width 32.",
    ],
    relatedTargetIds: [
      "transformer-block:mlp-residual",
      "transformer-block:mlp-update",
      "tower:h1",
      "tower:h2",
    ],
    explanationByMode: {
      story:
        "The contextual capsule and its nonlinear feature correction merge dial-for-dial, completing one block.",
      structure:
        "The second residual addition restores a single [2,6,8] stream at the block exit.",
      math:
        "For every (b,t,c), H'[b,t,c]=U[b,t,c]+F[b,t,c].",
      code:
        "h_out = u + f",
    },
  }),
];

export const EARLY_EXPANSION_COMPONENT_TARGETS = [
  ...tokenStreamTargets,
  ...batchShiftTargets,
  ...transformerTowerTargets,
  ...transformerBlockTargets,
] satisfies readonly AssistantTargetContext[];

export const EARLY_EXPANSION_WORLD_METADATA = [
  worldMetadata(
    "token-stream:source-rows",
    tokenStreamStation,
    "assistant-target-token-stream-source-rows",
    [["token", "stream", "source", "rows"]],
    "player-left",
  ),
  worldMetadata(
    "token-stream:selection-clamps",
    tokenStreamStation,
    "assistant-target-token-stream-selection-clamps",
    [["token", "stream", "selection", "clamps"]],
  ),
  worldMetadata(
    "token-stream:window-cutter",
    tokenStreamStation,
    "assistant-target-token-stream-window-cutter",
    [["token", "stream", "window", "cutter"]],
    "target-front",
    0.7,
  ),
  worldMetadata(
    "token-stream:output-docks",
    tokenStreamStation,
    "assistant-target-token-stream-output-docks",
    [["token", "stream", "output", "docks"]],
  ),
  worldMetadata(
    "token-stream:selected-windows",
    tokenStreamStation,
    "assistant-target-token-stream-selected-windows",
    [["token", "stream", "selected", "windows"]],
    "player-right",
  ),
  worldMetadata(
    "batch-shift:source-matrix",
    batchShiftStation,
    "assistant-target-batch-shift-source-matrix",
    [["batch", "shift", "source", "matrix"]],
  ),
  worldMetadata(
    "batch-shift:working-copies",
    batchShiftStation,
    "assistant-target-batch-shift-working-copies",
    [["batch", "shift", "working", "copies"]],
  ),
  worldMetadata(
    "batch-shift:input-slice",
    batchShiftStation,
    "assistant-target-batch-shift-input-slice",
    [["batch", "shift", "input", "slice"]],
    "player-left",
  ),
  worldMetadata(
    "batch-shift:target-shift",
    batchShiftStation,
    "assistant-target-batch-shift-target-shift",
    [["batch", "shift", "target"]],
    "player-right",
  ),
  worldMetadata(
    "batch-shift:input-batch",
    batchShiftStation,
    "assistant-target-batch-shift-input-batch",
    [["batch", "shift", "input", "batch"]],
    "player-left",
  ),
  worldMetadata(
    "batch-shift:target-batch",
    batchShiftStation,
    "assistant-target-batch-shift-target-batch",
    [["batch", "shift", "target", "batch"]],
    "player-right",
  ),
  worldMetadata(
    "tower:h0",
    transformerTowerStation,
    "assistant-target-transformer-tower-h0",
    [["transformer", "tower", "h0"]],
  ),
  worldMetadata(
    "tower:block-0",
    transformerTowerStation,
    "assistant-target-transformer-tower-block-0",
    [["transformer", "tower", "block", "0"]],
    "player-left",
    0.9,
  ),
  worldMetadata(
    "tower:h1",
    transformerTowerStation,
    "assistant-target-transformer-tower-h1",
    [["transformer", "tower", "h1"]],
    "player-right",
  ),
  worldMetadata(
    "tower:block-1",
    transformerTowerStation,
    "assistant-target-transformer-tower-block-1",
    [["transformer", "tower", "block", "1"]],
    "player-right",
    0.9,
  ),
  worldMetadata(
    "tower:h2",
    transformerTowerStation,
    "assistant-target-transformer-tower-h2",
    [["transformer", "tower", "h2"]],
    "player-left",
  ),
  worldMetadata(
    "tower:final-norm",
    transformerTowerStation,
    "assistant-target-transformer-tower-final-norm",
    [["transformer", "tower", "final", "norm"]],
    "target-front",
    0.9,
  ),
  worldMetadata(
    "tower:final-output",
    transformerTowerStation,
    "assistant-target-transformer-tower-final-output",
    [["transformer", "tower", "final", "output"]],
  ),
  worldMetadata(
    "transformer-block:input-h",
    transformerBlockStation,
    "assistant-target-transformer-block-input-h",
    [["transformer", "block", "input", "h"]],
  ),
  worldMetadata(
    "transformer-block:attention-residual",
    transformerBlockStation,
    "assistant-target-transformer-block-attention-residual",
    [["transformer", "block", "attention", "residual"]],
    "player-left",
  ),
  worldMetadata(
    "transformer-block:attention-update",
    transformerBlockStation,
    "assistant-target-transformer-block-attention-update",
    [["transformer", "block", "attention", "update"]],
    "player-right",
  ),
  worldMetadata(
    "transformer-block:attention-output",
    transformerBlockStation,
    "assistant-target-transformer-block-attention-output",
    [["transformer", "block", "attention", "output"]],
  ),
  worldMetadata(
    "transformer-block:mlp-residual",
    transformerBlockStation,
    "assistant-target-transformer-block-mlp-residual",
    [["transformer", "block", "mlp", "residual"]],
    "player-right",
  ),
  worldMetadata(
    "transformer-block:mlp-update",
    transformerBlockStation,
    "assistant-target-transformer-block-mlp-update",
    [["transformer", "block", "mlp", "update"]],
    "player-left",
  ),
  worldMetadata(
    "transformer-block:output-h",
    transformerBlockStation,
    "assistant-target-transformer-block-output-h",
    [["transformer", "block", "output", "h"]],
  ),
] satisfies readonly AssistantTargetWorldMetadata[];
