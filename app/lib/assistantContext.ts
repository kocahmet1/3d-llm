import {
  SELECTED_TRACE,
  TEACHING_MODEL,
  TRAINING_STATIONS,
} from "./trainingTrace";
import type {
  BranchSide,
  DetailMode,
  TrainingPhase,
  TrainingStation,
} from "./worldTypes";

/** JSON-safe values accepted from the live scene at the start of a voice turn. */
export interface AssistantContextObject {
  readonly [key: string]: AssistantContextValue;
}

export type AssistantContextValue =
  | string
  | number
  | boolean
  | null
  | readonly AssistantContextValue[]
  | AssistantContextObject;

export type AssistantVisibleState = Readonly<
  Record<string, AssistantContextValue>
>;

export interface AssistantProcessStep {
  id: string;
  label: string;
  summary: string;
}

export interface AssistantProcessOverview {
  title: string;
  summary: string;
  steps: readonly AssistantProcessStep[];
  teachingModel: Readonly<{
    batchSize: number;
    sequenceLength: number;
    vocabularySize: number;
    modelWidth: number;
    attentionHeads: number;
    headWidth: number;
    transformerBlocks: number;
    feedForwardWidth: number;
    validNextTokenPredictions: number;
  }>;
  visualConventions: readonly string[];
}

export interface AssistantStationContext {
  id: string;
  index: number;
  title: string;
  shortTitle: string;
  phase: TrainingPhase;
  breadcrumb: readonly string[];
  summary: string;
  structure: string;
  math: string;
  formula?: string;
  shape?: string;
  scaleLabel: string;
  processPosition: Readonly<{
    previousStationId?: string;
    nextStationId?: string;
  }>;
  branch?: Readonly<{
    left: string;
    right: string;
    default: BranchSide;
  }>;
  detailByMode: Readonly<Record<DetailMode, string>>;
}

export type AssistantTargetKind = "station" | "component";

/**
 * Facts that are safe to send to the model. Three.js names, positions, and
 * presentation offsets intentionally do not belong in this interface.
 */
export interface AssistantTargetContext {
  id: string;
  stationId: string;
  kind: AssistantTargetKind;
  label: string;
  aliases: readonly string[];
  summary: string;
  role: string;
  inputs: readonly string[];
  operation: string;
  outputs: readonly string[];
  formula?: string;
  shape?: string;
  exactValues?: AssistantVisibleState;
  whyItMatters: string;
  commonMisconceptions: readonly string[];
  relatedTargetIds: readonly string[];
  explanationByMode: Readonly<Record<DetailMode, string>>;
  branchRelevance?: Readonly<Partial<Record<BranchSide, string>>>;
}

export type AssistantAnchorSide =
  | "player-left"
  | "player-right"
  | "target-left"
  | "target-right"
  | "target-front";

/**
 * Scene-only selection and presentation metadata. This registry is separate
 * from ASSISTANT_TARGET_CONTEXTS so callers cannot accidentally include world
 * coordinates or object names in the model prompt.
 */
export interface AssistantTargetWorldMetadata {
  targetId: string;
  stationId: string;
  matching: Readonly<{
    canonicalObjectName: string;
    exactObjectNames: readonly string[];
    containsTokenSets: readonly (readonly string[])[];
  }>;
  anchor: Readonly<{
    preferredSide: AssistantAnchorSide;
    standOffDistance: number;
    verticalOffset: number;
    lookAt: "target-bounds-center";
    pointAt: "target-bounds-center";
  }>;
}

export type AssistantTargetResolutionSource =
  | "explicit-target"
  | "semantic-object-name"
  | "station-fallback"
  | "world-fallback";

export interface AssistantTargetResolution {
  station: AssistantStationContext;
  target: AssistantTargetContext;
  world: AssistantTargetWorldMetadata;
  source: AssistantTargetResolutionSource;
  matchedObjectName?: string;
}

export interface ResolveAssistantTargetInput {
  stationId?: string | null;
  explicitTargetId?: string | null;
  /** May be supplied leaf-to-root or root-to-leaf; resolution is order-free. */
  objectAncestryNames?: readonly (string | null | undefined)[];
}

export interface BuildAssistantTurnContextInput
  extends ResolveAssistantTargetInput {
  detailMode: DetailMode;
  branchSide?: BranchSide;
  visibleState?: AssistantVisibleState;
}

/** This is the only aggregate intended to be serialized into a model turn. */
export interface AssistantTurnContextSnapshot {
  schemaVersion: 1;
  tutorInstructions: string;
  process: AssistantProcessOverview;
  station: AssistantStationContext;
  target: AssistantTargetContext;
  view: Readonly<{
    detailMode: DetailMode;
    detailFocus: string;
    branch?: Readonly<{
      side: BranchSide;
      label: string;
      targetRelevance?: string;
    }>;
  }>;
  visibleState: AssistantVisibleState;
  groundingRules: readonly string[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach((child) => {
      deepFreeze(child);
    });
    Object.freeze(value);
  }
  return value;
}

function cloneContextValue(value: AssistantContextValue): AssistantContextValue {
  if (Array.isArray(value)) {
    return value.map((item) => cloneContextValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        cloneContextValue(item),
      ]),
    );
  }
  return value;
}

function cloneVisibleState(value?: AssistantVisibleState): AssistantVisibleState {
  return deepFreeze(
    cloneContextValue(value ?? {}) as Readonly<
      Record<string, AssistantContextValue>
    >,
  );
}

export const SESSION_TUTOR_INSTRUCTIONS = `You are the in-world voice tutor for a deterministic visualization of one decoder-only Transformer training step. Answer the user's question about the frozen selected target, using the supplied station, target, visible-state, and exact-value context. Treat words such as "this", "that", and "here" as references to the selected target. Prefer the requested Story, Structure, Math, or Code detail mode while remaining conversational. Explain how the target connects to the preceding and following stages when useful. Never invent a displayed value, tensor shape, object identity, or animation state. Clearly distinguish temporary activations, gradients, optimizer state, and learned parameters. Clearly distinguish this tiny teaching trace from production-scale language models. If the supplied context is insufficient, say what is missing or ask a short clarifying question. You can use the supplied application tools when the user explicitly asks you to navigate or change a lesson control. Make exactly one tool call for one requested action, wait for its result, and only then briefly confirm what actually changed. Do not call a tool merely to answer a question, do not claim success before its result, and never imply that an unavailable or rejected action occurred. Keep spoken answers focused, and let the user interrupt.`;

export const GENERAL_PROCESS_OVERVIEW: AssistantProcessOverview = deepFreeze({
  title: "One complete language-model training step",
  summary:
    "Prepared token windows enter a two-block decoder-only Transformer. The model predicts every next token, cross-entropy reduces those predictions to one loss, reverse-mode differentiation computes gradients, and AdamW changes the parameters once.",
  steps: [
    {
      id: "prepare",
      label: "Prepare text",
      summary: "Clean text, tokenize it, and slice token streams into context windows.",
    },
    {
      id: "batch",
      label: "Build inputs and targets",
      summary: "Use each window except its last token as input and the one-token-shifted window as next-token targets.",
    },
    {
      id: "forward",
      label: "Forward pass",
      summary: "Embeddings and two Transformer blocks produce contextual states and vocabulary logits without changing parameters.",
    },
    {
      id: "loss",
      label: "Measure predictions",
      summary: "Softmax and cross-entropy score the correct next token at all twelve supervised positions and average them.",
    },
    {
      id: "backward",
      label: "Backpropagate",
      summary: "Reverse-mode differentiation sends activation gradients backward and accumulates a gradient for every participating parameter.",
    },
    {
      id: "update",
      label: "Update with AdamW",
      summary: "The optimizer combines gradients, moment estimates, learning rate, and weight decay to produce the only parameter change in the step.",
    },
  ],
  teachingModel: {
    batchSize: TEACHING_MODEL.batchSize,
    sequenceLength: TEACHING_MODEL.sequenceLength,
    vocabularySize: TEACHING_MODEL.vocabularySize,
    modelWidth: TEACHING_MODEL.modelWidth,
    attentionHeads: TEACHING_MODEL.attentionHeads,
    headWidth: TEACHING_MODEL.headWidth,
    transformerBlocks: TEACHING_MODEL.transformerBlocks,
    feedForwardWidth: TEACHING_MODEL.feedForwardWidth,
    validNextTokenPredictions: TEACHING_MODEL.validTokens,
  },
  visualConventions: [
    "Stationary structures represent reusable model structure or parameter stores.",
    "Cool moving streams represent forward activations.",
    "Warm reverse-moving streams represent gradients during backpropagation.",
    "Parameters remain fixed during forward and backward passes; AdamW changes them only in the update phase.",
    "Displayed numbers belong to one deliberately tiny deterministic teaching trace, not a production model.",
  ],
});

function stationDetailByMode(
  station: TrainingStation,
): Readonly<Record<DetailMode, string>> {
  return {
    story: station.story,
    structure: station.structure,
    math: [station.math, station.formula, station.shape]
      .filter(Boolean)
      .join(" "),
    code: `Explain the ${station.shortTitle} stage as compact tensor-oriented pseudocode. Preserve the displayed operation order${
      station.formula ? ` represented by ${station.formula}` : ""
    }${station.shape ? ` and the shape transition ${station.shape}` : ""}.`,
  };
}

function makeStationContext(
  station: TrainingStation,
  index: number,
): AssistantStationContext {
  return {
    id: station.id,
    index,
    title: station.title,
    shortTitle: station.shortTitle,
    phase: station.phase,
    breadcrumb: [...station.breadcrumb],
    summary: station.story,
    structure: station.structure,
    math: station.math,
    ...(station.formula ? { formula: station.formula } : {}),
    ...(station.shape ? { shape: station.shape } : {}),
    scaleLabel: station.scaleLabel,
    processPosition: {
      ...(index > 0
        ? { previousStationId: TRAINING_STATIONS[index - 1].id }
        : {}),
      ...(index < TRAINING_STATIONS.length - 1
        ? { nextStationId: TRAINING_STATIONS[index + 1].id }
        : {}),
    },
    ...(station.branch
      ? {
          branch: {
            left: station.branch.left,
            right: station.branch.right,
            default: station.branch.default,
          },
        }
      : {}),
    detailByMode: stationDetailByMode(station),
  };
}

export const ASSISTANT_STATION_CONTEXTS: Readonly<
  Record<string, AssistantStationContext>
> = deepFreeze(
  Object.fromEntries(
    TRAINING_STATIONS.map((station, index) => [
      station.id,
      makeStationContext(station, index),
    ]),
  ),
);

function makeStationFallbackTarget(
  station: TrainingStation,
): AssistantTargetContext {
  const stationContext = ASSISTANT_STATION_CONTEXTS[station.id];
  const relatedTargetIds = [
    stationContext.processPosition.previousStationId,
    stationContext.processPosition.nextStationId,
  ]
    .filter((id): id is string => Boolean(id))
    .map((id) => `station:${id}`);

  return {
    id: `station:${station.id}`,
    stationId: station.id,
    kind: "station",
    label: station.title,
    aliases: [station.shortTitle, ...station.breadcrumb],
    summary: station.story,
    role: station.structure,
    inputs: stationContext.processPosition.previousStationId
      ? [`Output of station ${stationContext.processPosition.previousStationId}`]
      : ["Prepared text and the current model state"],
    operation: station.formula ?? station.story,
    outputs: stationContext.processPosition.nextStationId
      ? [`Input to station ${stationContext.processPosition.nextStationId}`]
      : ["Updated model state ready for the next batch"],
    ...(station.formula ? { formula: station.formula } : {}),
    ...(station.shape ? { shape: station.shape } : {}),
    whyItMatters: station.scaleLabel,
    commonMisconceptions: [
      "The scene is a small deterministic teaching trace, not the size or full infrastructure of a production LLM.",
      "Motion and color encode computation roles; they do not imply that every visible structure is a learned parameter.",
    ],
    relatedTargetIds,
    explanationByMode: stationContext.detailByMode,
  };
}

/** One safe station-level target for each of the current 25 stations. */
export const STATION_FALLBACK_TARGETS: readonly AssistantTargetContext[] =
  deepFreeze(TRAINING_STATIONS.map(makeStationFallbackTarget));

const q = SELECTED_TRACE.attention.query;
const keys = SELECTED_TRACE.attention.allowedKeys;
const values = SELECTED_TRACE.attention.allowedValues;
const rawScores = SELECTED_TRACE.attention.rawDotProducts;
const scaledScores = SELECTED_TRACE.attention.scaledScoresBeforeMask;
const maskedScores = SELECTED_TRACE.attention.maskedScores.map((value) =>
  Number.isFinite(value) ? value : "-Infinity",
);
const attentionWeights = SELECTED_TRACE.attention.attentionWeights;
const weightedValue = SELECTED_TRACE.attention.weightedValue;
const selectedPosition = SELECTED_TRACE.attention.selectedQueryPosition;
const selectedToken = SELECTED_TRACE.embedding.selectedToken;
const scale = Math.sqrt(TEACHING_MODEL.headWidth);

const ATTENTION_COMPONENT_TARGETS = deepFreeze<
  readonly AssistantTargetContext[]
>([
  {
    id: "attention:qkv-overview",
    stationId: "one-head-qkv",
    kind: "component",
    label: "Query, key, and value lanes",
    aliases: ["QKV", "Q K V", "head 0 projections"],
    summary:
      "Three learned projections give each normalized hidden state a query, a key, and a value for head 0.",
    role:
      "Queries and keys determine which allowed positions match; values carry the information that the resulting attention weights blend.",
    inputs: ["Normalized block input N = LayerNorm1(H), shape [2,6,8]"],
    operation:
      "Multiply N by W_Q, W_K, and W_V, then reshape model width 8 into 2 heads of width 4.",
    outputs: [
      "Q, K, and V tensors, each with shape [2,2,6,4]",
      "Selected head-0 vectors used by the following score and value-gathering chambers",
    ],
    formula: "Q=reshape(N W_Q); K=reshape(N W_K); V=reshape(N W_V)",
    shape: "3 x ([2,6,8] x [8,8] -> [2,2,6,4])",
    exactValues: {
      selectedBatch: SELECTED_TRACE.batch.selectedBatch,
      selectedHead: SELECTED_TRACE.attention.selectedHead,
      selectedPosition,
      selectedToken,
      selectedQuery: q,
    },
    whyItMatters:
      "The separation lets the same token expose one representation for matching and another representation for information transfer.",
    commonMisconceptions: [
      "Q, K, and V are learned projections of hidden states, not raw slices of the embedding.",
      "A query is not a natural-language question, and a value is not a scalar importance score.",
      "The moving Q/K/V vectors are temporary activations; W_Q, W_K, and W_V are learned parameters.",
    ],
    relatedTargetIds: [
      "attention:query",
      "attention:keys",
      "attention:values",
      "attention:score-matrix",
    ],
    explanationByMode: {
      story:
        "The query asks what this token needs, keys advertise what positions match, and values carry what can be collected.",
      structure:
        "All three lanes come from separate [8,8] learned projections and reshape to [B,H,T,d_head]=[2,2,6,4].",
      math: "For each position i: q_i=n_iW_Q, k_i=n_iW_K, and v_i=n_iW_V.",
      code: "q, k, v = project_qkv(layer_norm(h)); q, k, v = split_heads(q, k, v, heads=2)",
    },
    branchRelevance: {
      left: "The left branch follows query-key matching.",
      right: "The right branch follows value gathering.",
    },
  },
  {
    id: "attention:query",
    stationId: "one-head-qkv",
    kind: "component",
    label: `Selected query for '${selectedToken}'`,
    aliases: ["query", "Q lane", `q_${selectedPosition}`],
    summary: `This four-feature query belongs to batch 0, head 0, position ${selectedPosition}, the token '${selectedToken}'.`,
    role:
      "It is the looking position's matching representation. The score matrix compares it with every key in the same head.",
    inputs: [`Normalized hidden state at batch 0, position ${selectedPosition}`],
    operation: "Multiply that normalized row by the head's portion of W_Q.",
    outputs: [`q_${selectedPosition} = [${q.join(", ")}]`],
    formula: `q_${selectedPosition} = n_${selectedPosition} W_Q`,
    shape: `[${TEACHING_MODEL.headWidth}]`,
    exactValues: {
      batch: SELECTED_TRACE.batch.selectedBatch,
      head: SELECTED_TRACE.attention.selectedHead,
      position: selectedPosition,
      token: selectedToken,
      vector: q,
    },
    whyItMatters:
      "Changing this query changes which allowed keys look compatible for this particular token position.",
    commonMisconceptions: [
      "The query is a learned activation vector, not the token text and not an explicit human-written question.",
      "The query alone does not contain the attention weights; those appear only after key comparison, masking, and softmax.",
    ],
    relatedTargetIds: ["attention:keys", "attention:selected-score-row"],
    explanationByMode: {
      story: `This is how '${selectedToken}' asks what earlier context would be useful right now.`,
      structure: "One width-4 head-0 query is selected from Q[2,2,6,4].",
      math: `q_${selectedPosition}=[${q.join(",")}], which is dotted with each key and divided by sqrt(4).`,
      code: `query = q[0, 0, ${selectedPosition}, :]`,
    },
    branchRelevance: {
      left: "This is the query side of the selected Q dot K matching branch.",
    },
  },
  {
    id: "attention:keys",
    stationId: "one-head-qkv",
    kind: "component",
    label: "Key lane",
    aliases: ["keys", "K lane", "allowed keys"],
    summary:
      "Each position has a four-feature key that a query can compare against; the selected query may use only keys at positions 0, 1, and 2 after causal masking.",
    role:
      "Keys supply the matching coordinates used to create temporary attention scores.",
    inputs: ["Normalized hidden states for all six positions"],
    operation: "Multiply every normalized row by W_K and split into two heads.",
    outputs: ["K[2,2,6,4] for score calculation"],
    formula: "k_j = n_j W_K",
    shape: "selected head keys [6,4]",
    exactValues: {
      allowedPositionsForSelectedQuery: [0, 1, 2],
      allowedKeys: keys,
      dotProductsWithSelectedQuery: rawScores,
    },
    whyItMatters:
      "Keys determine which past or current positions appear relevant to each query without carrying the content that will ultimately be blended.",
    commonMisconceptions: [
      "A key is not a database key or token ID.",
      "Keys affect matching scores; values carry the information used in the output blend.",
    ],
    relatedTargetIds: ["attention:query", "attention:score-matrix"],
    explanationByMode: {
      story: "Each key is a label written in learned coordinates saying what its position can match.",
      structure: "Six width-4 keys occupy the selected batch/head lane; the causal mask later controls which are usable.",
      math: `q_${selectedPosition} dot k_[0:3] gives [${rawScores.join(", ")}].`,
      code: "raw_scores = query @ keys.transpose(-2, -1)",
    },
    branchRelevance: {
      left: "Keys are the comparison side of the selected Q dot K matching branch.",
    },
  },
  {
    id: "attention:values",
    stationId: "one-head-qkv",
    kind: "component",
    label: "Value lane",
    aliases: ["values", "V lane", "value vectors"],
    summary:
      "Each position has a four-feature value carrying the information that attention may transfer to a query position.",
    role:
      "After softmax chooses nonnegative weights, the corresponding values are multiplied by those weights and summed.",
    inputs: ["Normalized hidden states for all six positions"],
    operation: "Multiply every normalized row by W_V and split into two heads.",
    outputs: ["V[2,2,6,4] for weighted gathering"],
    formula: "v_j = n_j W_V; z_i = sum_j a_ij v_j",
    shape: "selected head values [6,4]",
    exactValues: {
      allowedValues: values,
      selectedWeights: attentionWeights.slice(0, 3),
      resultingWeightedValue: weightedValue,
    },
    whyItMatters:
      "Attention would only rank positions without values; values turn those rankings into an information-bearing output vector.",
    commonMisconceptions: [
      "Values are vectors, not the scalar attention weights.",
      "The value vectors are projected activations, not direct copies of token embeddings.",
    ],
    relatedTargetIds: [
      "attention:attention-weights",
      "attention:value-vectors",
      "attention:weighted-value-output",
    ],
    explanationByMode: {
      story: "The values are the parcels of information; attention weights decide how much of each parcel arrives.",
      structure: "Six width-4 value vectors share the selected head lane and reduce to one width-4 output per query.",
      math: "The selected output is a weighted sum of v_0, v_1, and v_2; future values receive weight zero.",
      code: "head_output = attention_weights @ values",
    },
    branchRelevance: {
      right: "Values are the information source on the selected value-gathering branch.",
    },
  },
  {
    id: "attention:score-matrix",
    stationId: "attention-scores",
    kind: "component",
    label: "Attention score matrix",
    aliases: ["score grid", "QK transpose scores", "S matrix"],
    summary:
      "Each row is a query position and each column is a key position. A cell stores one scaled query-key match before causal masking and softmax.",
    role:
      "The matrix collects all pairwise matching scores for one batch/head plane before access restrictions and normalization.",
    inputs: ["Q[2,2,6,4]", "K[2,2,6,4]"],
    operation: `Multiply Q by K transpose and divide by sqrt(d_head)=sqrt(${TEACHING_MODEL.headWidth})=${scale}.`,
    outputs: ["Temporary scores S[2,2,6,6]"],
    formula: "S[b,h,i,j] = dot(Q[b,h,i,:], K[b,h,j,:]) / sqrt(d_head)",
    shape: "[2,2,6,4] x [2,2,4,6] -> [2,2,6,6]",
    exactValues: {
      selectedBatch: SELECTED_TRACE.batch.selectedBatch,
      selectedHead: SELECTED_TRACE.attention.selectedHead,
      selectedQueryPosition: selectedPosition,
      selectedScaledRowBeforeMask: scaledScores,
      totalScoreCells: TEACHING_MODEL.batchSize *
        TEACHING_MODEL.attentionHeads *
        TEACHING_MODEL.sequenceLength *
        TEACHING_MODEL.sequenceLength,
    },
    whyItMatters:
      "This is where learned Q/K representations become explicit pairwise compatibility signals for every query position.",
    commonMisconceptions: [
      "These cells are temporary activations, not learned parameter weights.",
      "A large score is not yet a probability and rows need not sum to one.",
      "Causal masking has not yet been applied at this stage.",
    ],
    relatedTargetIds: [
      "attention:query",
      "attention:keys",
      "attention:selected-score-row",
      "attention:causal-mask",
    ],
    explanationByMode: {
      story: "Every row asks, 'As this position looks around, how strongly does each position match?'",
      structure: "For every batch and head there is a 6 by 6 query-key plane, producing 144 cells overall.",
      math: `S=QK^T/sqrt(${TEACHING_MODEL.headWidth}); the selected row begins [${scaledScores.slice(0, 3).join(", ")}].`,
      code: `scores = (q @ k.transpose(-2, -1)) / sqrt(${TEACHING_MODEL.headWidth})`,
    },
  },
  {
    id: "attention:selected-score-row",
    stationId: "attention-scores",
    kind: "component",
    label: `Score row for query position ${selectedPosition}`,
    aliases: ["selected row", "row 2", "cat score row"],
    summary: `This row shows how the query for '${selectedToken}' at position ${selectedPosition} matches all six key positions before masking.`,
    role: "It is the complete set of candidate matches for one looking position.",
    inputs: [`q_${selectedPosition}`, "keys k_0 through k_5"],
    operation: "Compute six scaled dot products, one per key column.",
    outputs: [`[${scaledScores.join(", ")}] before masking`],
    formula: `S[0,0,${selectedPosition},j] = dot(q_${selectedPosition}, k_j) / ${scale}`,
    shape: `[${TEACHING_MODEL.sequenceLength}]`,
    exactValues: {
      queryPosition: selectedPosition,
      queryToken: selectedToken,
      query: q,
      rawDotProductsForAllowedKeys: rawScores,
      scaledScoresBeforeMask: scaledScores,
    },
    whyItMatters:
      "Masking and softmax operate row-wise, so this row becomes exactly one attention distribution for the selected query.",
    commonMisconceptions: [
      "The row contains scores before normalization, not percentages.",
      "The future columns still have finite scores here; the next chamber masks them.",
    ],
    relatedTargetIds: [
      "attention:selected-score-cell",
      "attention:causal-mask",
      "attention:softmax-row",
    ],
    explanationByMode: {
      story: `This is '${selectedToken}' looking across every possible key position before the future doors close.`,
      structure: "One query row crosses six key columns in the selected batch/head plane.",
      math: `Raw allowed dot products [${rawScores.join(", ")}] divide by ${scale} to become [${scaledScores.slice(0, 3).join(", ")}].`,
      code: `selected_row = scores[0, 0, ${selectedPosition}, :]`,
    },
  },
  {
    id: "attention:selected-score-cell",
    stationId: "attention-scores",
    kind: "component",
    label: `Selected score cell q_${selectedPosition} x k_0`,
    aliases: ["selected cell", "q2 k0 cell", "score 2.1"],
    summary: `This cell measures how strongly the selected query at position ${selectedPosition} matches the key at position 0.`,
    role: "It contributes one candidate logit to the selected query's attention row.",
    inputs: [`q_${selectedPosition}=[${q.join(", ")}]`, `k_0=[${keys[0].join(", ")}]`],
    operation: `Take the dot product ${rawScores[0]} and divide by sqrt(${TEACHING_MODEL.headWidth})=${scale}.`,
    outputs: [`scaled score ${scaledScores[0]}`],
    formula: `${rawScores[0]} / ${scale} = ${scaledScores[0]}`,
    shape: "scalar",
    exactValues: {
      queryPosition: selectedPosition,
      keyPosition: 0,
      query: q,
      key: keys[0],
      rawDotProduct: rawScores[0],
      scale,
      scaledScore: scaledScores[0],
    },
    whyItMatters:
      "After masking and row-wise softmax, this comparatively high score becomes the largest selected attention weight.",
    commonMisconceptions: [
      "The value 2.1 is not a probability; softmax later turns the whole row into probabilities.",
      "The score is recalculated for this example and is not stored as a permanent model weight.",
    ],
    relatedTargetIds: ["attention:selected-score-row", "attention:softmax-row"],
    explanationByMode: {
      story: "This bright square says position 0 is the strongest match for the selected query in this trace.",
      structure: "It is the intersection of query row 2 and key column 0.",
      math: `dot([${q.join(",")}],[${keys[0].join(",")}])=${rawScores[0]}, then ${rawScores[0]}/sqrt(4)=${scaledScores[0]}.`,
      code: `cell = dot(q[0,0,${selectedPosition}], k[0,0,0]) / sqrt(4)`,
    },
  },
  {
    id: "attention:causal-mask",
    stationId: "causal-mask",
    kind: "component",
    label: "Causal mask matrix",
    aliases: ["mask", "triangular mask", "no-looking-ahead mask"],
    summary:
      "A lower-triangular access rule preserves past and current scores while replacing every future score with negative infinity before softmax.",
    role:
      "It prevents a next-token predictor from using the future tokens it is supposed to predict.",
    inputs: ["Temporary attention scores S[2,2,6,6]", "Broadcast mask M[1,1,6,6]"],
    operation: "Add 0 where j <= i and -Infinity where j > i.",
    outputs: ["Masked scores with no usable future columns"],
    formula: "S_masked=S+M, where M[i,j]=0 if j<=i and -Infinity if j>i",
    shape: "mask [1,1,6,6] broadcasts across scores [2,2,6,6]",
    exactValues: {
      selectedQueryPosition: selectedPosition,
      allowedKeyPositions: [0, 1, 2],
      maskedFutureKeyPositions: [3, 4, 5],
      selectedMaskedRow: maskedScores,
    },
    whyItMatters:
      "Without it, training could leak the answer from future input positions and the model would not learn valid autoregressive prediction.",
    commonMisconceptions: [
      "The mask changes temporary attention scores, not token data or learned parameter matrices.",
      "Masked scores become -Infinity before softmax so their probabilities become exactly zero.",
      "The same triangular mask is broadcast over batches and heads; it is not learned.",
    ],
    relatedTargetIds: [
      "attention:score-matrix",
      "attention:allowed-mask-region",
      "attention:future-mask-region",
      "attention:softmax-row",
    ],
    explanationByMode: {
      story: "The triangular barrier closes every doorway from a position to tokens that come later.",
      structure: "One [1,1,6,6] lower-triangular rule broadcasts over both batches and both heads.",
      math: `For row ${selectedPosition}, columns 0..${selectedPosition} add 0 and columns ${selectedPosition + 1}..5 add -Infinity.`,
      code: "scores = scores.masked_fill(future_positions, -Infinity)",
    },
  },
  {
    id: "attention:allowed-mask-region",
    stationId: "causal-mask",
    kind: "component",
    label: "Past-and-current allowed region",
    aliases: ["allowed region", "lower triangle", "past and current"],
    summary: "Cells on or below the diagonal remain available because their key position is no later than the query position.",
    role: "This region preserves valid autoregressive context.",
    inputs: ["Scores where key column j <= query row i"],
    operation: "Add zero, leaving each score unchanged.",
    outputs: ["Finite scores that softmax may assign nonzero weight"],
    formula: "M[i,j]=0 for j<=i",
    shape: "lower triangle including diagonal",
    exactValues: {
      selectedRowAllowedPositions: [0, 1, 2],
      selectedRowFiniteScores: scaledScores.slice(0, 3),
    },
    whyItMatters: "A token can still use itself and all earlier positions when building its contextual representation.",
    commonMisconceptions: [
      "Allowed does not mean equally weighted; softmax still depends on the finite matching scores.",
    ],
    relatedTargetIds: ["attention:future-mask-region", "attention:softmax-row"],
    explanationByMode: {
      story: "These doors stay open because they lead only to what the token has already seen, including itself.",
      structure: "The diagonal and lower triangle are the mask's zero-valued cells.",
      math: "j <= i implies M[i,j]=0, so S_masked[i,j]=S[i,j].",
      code: "allowed = key_position <= query_position",
    },
  },
  {
    id: "attention:future-mask-region",
    stationId: "causal-mask",
    kind: "component",
    label: "Future masked region",
    aliases: ["future region", "upper triangle", "masked future"],
    summary: "Cells above the diagonal correspond to future key positions and are forced to negative infinity.",
    role: "This region enforces the no-looking-ahead constraint.",
    inputs: ["Scores where key column j > query row i"],
    operation: "Add negative infinity before softmax.",
    outputs: ["Exactly zero attention probability at every future position"],
    formula: "M[i,j]=-Infinity for j>i; softmax(S[i,j]+M[i,j])=0",
    shape: "strict upper triangle",
    exactValues: {
      selectedRowFuturePositions: [3, 4, 5],
      selectedRowScoresAfterMask: ["-Infinity", "-Infinity", "-Infinity"],
      selectedRowProbabilitiesAfterSoftmax: [0, 0, 0],
    },
    whyItMatters: "It prevents target leakage while allowing all positions in a training window to be processed in parallel.",
    commonMisconceptions: [
      "The future tokens are not deleted from the batch; each query row merely loses access to later columns.",
      "Negative infinity is a masking device used before softmax, not a learned score.",
    ],
    relatedTargetIds: ["attention:allowed-mask-region", "attention:softmax-row"],
    explanationByMode: {
      story: "These shutters close because opening them would let the model peek at the answers ahead.",
      structure: "The strict upper triangle is broadcast to every batch/head score plane.",
      math: "j>i adds -Infinity, whose exponential is treated as zero in softmax.",
      code: "scores[..., future_mask] = -Infinity",
    },
  },
  {
    id: "attention:softmax-row",
    stationId: "softmax-weighted-v",
    kind: "component",
    label: "Selected row softmax",
    aliases: ["softmax", "normalized row", "attention distribution"],
    summary:
      "Row-wise softmax turns the selected finite match scores into nonnegative shares summing to one, while masked future positions receive zero.",
    role: "It converts unbounded compatibility scores into a stable mixing distribution over allowed values.",
    inputs: [`Masked row [${maskedScores.join(", ")}]`],
    operation: "Exponentiate after subtracting a stable row maximum, then divide by the row sum.",
    outputs: [`Attention weights [${attentionWeights.join(", ")}]`],
    formula: "A=softmax(S+M), independently along each key row",
    shape: `[${TEACHING_MODEL.sequenceLength}] -> [${TEACHING_MODEL.sequenceLength}]`,
    exactValues: {
      maskedScores,
      weights: attentionWeights,
      weightSum: attentionWeights.reduce<number>(
        (sum, value) => sum + value,
        0,
      ),
    },
    whyItMatters: "The normalized weights can now control how much of each value vector enters the head output.",
    commonMisconceptions: [
      "Softmax runs independently for every query row, not over the entire 6 by 6 matrix.",
      "These are temporary attention weights, not learned model parameter weights.",
      "Masked future cells receive exactly zero, not merely a small positive weight.",
    ],
    relatedTargetIds: [
      "attention:causal-mask",
      "attention:attention-weights",
      "attention:value-vectors",
    ],
    explanationByMode: {
      story: "The finite scores become valve openings whose shares add to one; the closed future valves stay at zero.",
      structure: "Softmax normalizes the six columns of one selected query row.",
      math: `softmax([${maskedScores.join(", ")}])=[${attentionWeights.join(", ")}].`,
      code: "attention_weights = softmax(masked_scores, dim=-1)",
    },
  },
  {
    id: "attention:attention-weights",
    stationId: "softmax-weighted-v",
    kind: "component",
    label: "Attention weight bars and valves",
    aliases: ["weights", "weight bars", "valves"],
    summary: "The six bars visualize the selected query's normalized attention shares; only positions 0, 1, and 2 are nonzero.",
    role: "Each scalar controls the contribution of the value vector at the same key position.",
    inputs: ["The selected masked score row"],
    operation: "Use row-wise softmax to produce one scalar per key position.",
    outputs: ["Six scalar coefficients for value gathering"],
    formula: "a_j = exp(s_j) / sum_k exp(s_k) over allowed k",
    shape: "6 scalars whose sum is 1",
    exactValues: {
      weights: attentionWeights,
      largestWeightPosition: 0,
      largestWeight: attentionWeights[0],
      futureWeights: attentionWeights.slice(3),
    },
    whyItMatters: "They make the value blend interpretable as position-by-position contributions for this head and query.",
    commonMisconceptions: [
      "An attention weight is input-dependent and temporary; it is not a learned parameter stored in the model.",
      "A high attention weight does not by itself prove a causal or human-interpretable explanation of the model's final prediction.",
    ],
    relatedTargetIds: ["attention:softmax-row", "attention:value-vectors", "attention:weighted-value-output"],
    explanationByMode: {
      story: "The tallest valve lets most of position 0's value through, while smaller valves admit less from positions 1 and 2.",
      structure: "Six scalar weights align one-to-one with six value vectors.",
      math: `The nonzero shares are ${attentionWeights[0]}, ${attentionWeights[1]}, and ${attentionWeights[2]}, summing to one up to floating-point precision.`,
      code: "weighted_values = attention_weights[..., None] * values",
    },
  },
  {
    id: "attention:value-vectors",
    stationId: "softmax-weighted-v",
    kind: "component",
    label: "Value streams being gathered",
    aliases: ["value streams", "V vectors", "weighted values"],
    summary: "The allowed four-feature value vectors are scaled by their matching attention weights and routed into one sum.",
    role: "They carry the actual projected information transferred from attended positions.",
    inputs: ["Value vectors V[0], V[1], V[2]", "Attention weights A[0], A[1], A[2]"],
    operation: "Multiply every value vector by its scalar weight.",
    outputs: ["Three weighted width-4 contributions ready to add"],
    formula: "contribution_j = a_j v_j",
    shape: "3 allowed values [3,4] -> 3 weighted values [3,4]",
    exactValues: {
      values,
      weights: attentionWeights.slice(0, 3),
    },
    whyItMatters: "The same attention distribution can produce different information depending on the learned value representations.",
    commonMisconceptions: [
      "The values are not the attention scores and are not normalized to sum to one.",
      "Future values contribute exactly zero for the selected causal row.",
    ],
    relatedTargetIds: ["attention:values", "attention:attention-weights", "attention:weighted-value-output"],
    explanationByMode: {
      story: "Each stream carries a parcel; the valve scales the parcel before all parcels merge.",
      structure: "Scalar weights broadcast across each value's four feature channels.",
      math: `z_${selectedPosition}=${attentionWeights[0]}v_0+${attentionWeights[1]}v_1+${attentionWeights[2]}v_2.`,
      code: "contributions = weights[..., None] * values",
    },
  },
  {
    id: "attention:weighted-value-output",
    stationId: "softmax-weighted-v",
    kind: "component",
    label: "Weighted head output",
    aliases: ["head output", "weighted sum", "Z vector"],
    summary: `The value contributions merge into the selected head-0 output for '${selectedToken}'.`,
    role: "It is the context gathered by one attention head for one query position before heads recombine.",
    inputs: ["Six attention weights", "Six width-4 value vectors"],
    operation: "Sum every weight times its aligned value vector; masked future terms are zero.",
    outputs: [`z_${selectedPosition}=[${weightedValue.join(", ")}]`],
    formula: `z_${selectedPosition}=sum_j a_${selectedPosition},j v_j`,
    shape: "[6] x [6,4] -> [4]",
    exactValues: {
      weights: attentionWeights,
      allowedValues: values,
      output: weightedValue,
    },
    whyItMatters: "This is the information the selected head passes onward to head concatenation and W_O.",
    commonMisconceptions: [
      "The output is a vector, not the index of the most-attended token.",
      "Attention performs a weighted blend rather than choosing only the largest-weight value.",
    ],
    relatedTargetIds: ["attention:value-vectors", "station:head-recombination"],
    explanationByMode: {
      story: `The streams merge into one new four-feature message for '${selectedToken}'.`,
      structure: "One width-4 vector leaves head 0 and will be concatenated with the other head's width-4 vector.",
      math: `The weighted sum equals [${weightedValue.join(", ")}].`,
      code: "head_output = attention_weights @ values",
    },
  },
]);

const mhaSelectedKey = keys[2];
const mhaSelectedValue = values[2];

const MHA_COMPONENT_TARGETS = deepFreeze<readonly AssistantTargetContext[]>([
  {
    id: "mha:normalized-input",
    stationId: "multi-head-attention",
    kind: "component",
    label: "Normalized block input N",
    aliases: ["N board", "LN1 output", "normalized hidden state"],
    summary: "All 12 post-LN1 vectors (2 batch rows x 6 positions) fan out three ways into the Q, K, and V projections.",
    role: "It is the single normalized representation that every one of Q, K, and V is computed from.",
    inputs: ["H, shape [2,6,8]"],
    operation: "LayerNorm1 normalizes each position's 8 features before this station begins.",
    outputs: ["N = LN1(H), shape [2,6,8]"],
    formula: "N = LN1(H)",
    shape: "[2,6,8]",
    whyItMatters: "Q, K, and V all read from this same normalized N, not from the raw residual-stream H, keeping their input scale stable.",
    commonMisconceptions: [
      "N is LN1(H), never token IDs; X is reserved elsewhere for the integer ID matrix.",
      "The same N feeds all three projections; Q, K, and V differ only because W_Q, W_K, and W_V differ.",
    ],
    relatedTargetIds: ["mha:query-projection", "mha:key-projection", "mha:value-projection", "station:transformer-block"],
    explanationByMode: {
      story: "Every token's steadied summary walks up to three separate learned gates at once.",
      structure: "12 width-8 vectors split into three identical copies, one per projection.",
      math: "N = LN1(H); N has shape [2,6,8].",
      code: "n = layer_norm_1(h)",
    },
  },
  {
    id: "mha:query-projection",
    stationId: "multi-head-attention",
    kind: "component",
    label: "Query projection W_Q",
    aliases: ["W_Q", "WQ wall", "query weight matrix"],
    summary: "A learned [8,8] matrix maps each normalized hidden vector to its query representation.",
    role: "It produces the matching representation each position will use to look for compatible earlier positions.",
    inputs: ["N, shape [2,6,8]"],
    operation: "Multiply N by W_Q.",
    outputs: ["Q, shape [2,6,8] before the head split"],
    formula: "Q = N W_Q",
    shape: "[2,6,8] x [8,8] -> [2,6,8]",
    whyItMatters: "W_Q is a learned parameter matrix reused by every position and both batch rows; it does not change during forward or backward passes.",
    commonMisconceptions: [
      "W_Q is a learned parameter, not computed from the current input.",
      "This projection happens before the head split; width stays 8 here.",
    ],
    relatedTargetIds: ["mha:normalized-input", "mha:projected-query", "mha:head-split"],
    explanationByMode: {
      story: "This learned wall teaches every token how to phrase what it is looking for.",
      structure: "One [8,8] matrix is shared by all 12 positions.",
      math: "Q[b,t,:] = N[b,t,:] W_Q.",
      code: "q = n @ W_Q",
    },
  },
  {
    id: "mha:key-projection",
    stationId: "multi-head-attention",
    kind: "component",
    label: "Key projection W_K",
    aliases: ["W_K", "WK wall", "key weight matrix"],
    summary: "A learned [8,8] matrix maps each normalized hidden vector to its key representation.",
    role: "It produces the representation other positions' queries compare against when deciding what matches.",
    inputs: ["N, shape [2,6,8]"],
    operation: "Multiply N by W_K.",
    outputs: ["K, shape [2,6,8] before the head split"],
    formula: "K = N W_K",
    shape: "[2,6,8] x [8,8] -> [2,6,8]",
    whyItMatters: "W_K is a separate learned parameter matrix from W_Q; a position's query and its own key are generally different vectors.",
    commonMisconceptions: [
      "W_K is a learned parameter, not computed from the current input.",
      "K is not a database key or token ID; it is a learned matching representation.",
    ],
    relatedTargetIds: ["mha:normalized-input", "mha:projected-key", "mha:head-split"],
    explanationByMode: {
      story: "This learned wall teaches every token how to advertise what it offers.",
      structure: "One [8,8] matrix is shared by all 12 positions.",
      math: "K[b,t,:] = N[b,t,:] W_K.",
      code: "k = n @ W_K",
    },
  },
  {
    id: "mha:value-projection",
    stationId: "multi-head-attention",
    kind: "component",
    label: "Value projection W_V",
    aliases: ["W_V", "WV wall", "value weight matrix"],
    summary: "A learned [8,8] matrix maps each normalized hidden vector to its value representation.",
    role: "It produces the information-carrying vector that attention weights will later blend.",
    inputs: ["N, shape [2,6,8]"],
    operation: "Multiply N by W_V.",
    outputs: ["V, shape [2,6,8] before the head split"],
    formula: "V = N W_V",
    shape: "[2,6,8] x [8,8] -> [2,6,8]",
    whyItMatters: "W_V is a third, independently learned parameter matrix; the value carried forward is not the same as the query or key representation.",
    commonMisconceptions: [
      "W_V is a learned parameter, not computed from the current input.",
      "Values are vectors that get weighted and summed later; they are not themselves attention weights.",
    ],
    relatedTargetIds: ["mha:normalized-input", "mha:projected-value", "mha:head-split"],
    explanationByMode: {
      story: "This learned wall teaches every token how to package what it can share.",
      structure: "One [8,8] matrix is shared by all 12 positions.",
      math: "V[b,t,:] = N[b,t,:] W_V.",
      code: "v = n @ W_V",
    },
  },
  {
    id: "mha:projected-query",
    stationId: "multi-head-attention",
    kind: "component",
    label: "Projected query Q2 (pre-split)",
    aliases: ["Q2 projected", "query before split"],
    summary: "The selected position's full width-8 query vector, before it is split into two heads; the first four features become head 0's query.",
    role: "It is the pre-split query vector; reshaping later slices it into per-head chunks.",
    inputs: ["N at the selected position"],
    operation: "Multiply by W_Q.",
    outputs: [`Q2, first four features (head 0) = [${q.join(", ")}]`],
    formula: "Q2 = n_2 W_Q",
    shape: "[8]",
    exactValues: { headZeroQuery: q },
    whyItMatters: "Only after this width-8 vector is reshaped do head 0 and head 1 become meaningful subsets.",
    commonMisconceptions: [
      "The projection produces one width-8 vector; the split into two width-4 heads happens as a separate reshape step.",
    ],
    relatedTargetIds: ["mha:query-projection", "mha:head-split", "mha:head-0"],
    explanationByMode: {
      story: "This is the token's full-width request, about to be cut into two specialized halves.",
      structure: "One width-8 vector will reshape into two width-4 head slices.",
      math: `Head 0's four features are [${q.join(", ")}].`,
      code: "q2 = n[2] @ W_Q  # then reshape to (2 heads, 4)",
    },
  },
  {
    id: "mha:projected-key",
    stationId: "multi-head-attention",
    kind: "component",
    label: "Projected key K2 (pre-split)",
    aliases: ["K2 projected", "key before split"],
    summary: "The selected position's full width-8 key vector, before it is split into two heads; the first four features become head 0's key.",
    role: "It is the pre-split key vector; reshaping later slices it into per-head chunks.",
    inputs: ["N at the selected position"],
    operation: "Multiply by W_K.",
    outputs: [`K2, first four features (head 0) = [${mhaSelectedKey.join(", ")}]`],
    formula: "K2 = n_2 W_K",
    shape: "[8]",
    exactValues: { headZeroKey: mhaSelectedKey },
    whyItMatters: "This is the same position's own key, which is why the causal mask allows the selected query to attend to it.",
    commonMisconceptions: [
      "The projection produces one width-8 vector; the split into two width-4 heads happens as a separate reshape step.",
    ],
    relatedTargetIds: ["mha:key-projection", "mha:head-split", "mha:head-0"],
    explanationByMode: {
      story: "This is the token's full-width advertisement, about to be cut into two specialized halves.",
      structure: "One width-8 vector will reshape into two width-4 head slices.",
      math: `Head 0's four features are [${mhaSelectedKey.join(", ")}].`,
      code: "k2 = n[2] @ W_K  # then reshape to (2 heads, 4)",
    },
  },
  {
    id: "mha:projected-value",
    stationId: "multi-head-attention",
    kind: "component",
    label: "Projected value V2 (pre-split)",
    aliases: ["V2 projected", "value before split"],
    summary: "The selected position's full width-8 value vector, before it is split into two heads; the first four features become head 0's value.",
    role: "It is the pre-split value vector; reshaping later slices it into per-head chunks.",
    inputs: ["N at the selected position"],
    operation: "Multiply by W_V.",
    outputs: [`V2, first four features (head 0) = [${mhaSelectedValue.join(", ")}]`],
    formula: "V2 = n_2 W_V",
    shape: "[8]",
    exactValues: { headZeroValue: mhaSelectedValue },
    whyItMatters: "This is the information this position can contribute to any query that is allowed to attend to it.",
    commonMisconceptions: [
      "The projection produces one width-8 vector; the split into two width-4 heads happens as a separate reshape step.",
    ],
    relatedTargetIds: ["mha:value-projection", "mha:head-split", "mha:head-0"],
    explanationByMode: {
      story: "This is the token's full-width package of information, about to be cut into two specialized halves.",
      structure: "One width-8 vector will reshape into two width-4 head slices.",
      math: `Head 0's four features are [${mhaSelectedValue.join(", ")}].`,
      code: "v2 = n[2] @ W_V  # then reshape to (2 heads, 4)",
    },
  },
  {
    id: "mha:head-split",
    stationId: "multi-head-attention",
    kind: "component",
    label: "Reshape into two heads",
    aliases: ["head split", "reshape unzip", "unzip projection"],
    summary: "Each width-8 projected vector is reshaped into two width-4 chunks, one per attention head.",
    role: "It is the operation that turns one shared projection into H=2 independent per-head representations.",
    inputs: ["Q, K, V each shape [2,6,8]"],
    operation: "Reshape the last axis, width 8, into 2 heads of width 4.",
    outputs: ["Q, K, V each shape [2,2,6,4]"],
    formula: "reshape([2,6,8]) -> [2,2,6,4]",
    shape: "[2,6,8] -> [2,2,6,4]",
    whyItMatters: "This is what makes attention multi-head: head 0 and head 1 see different four-feature slices of the same learned projection, letting them specialize.",
    commonMisconceptions: [
      "The split is a reshape of already-projected values; it does not use any separate learned parameters.",
      "The first four features are not more important than the last four; they simply belong to different heads.",
    ],
    relatedTargetIds: ["mha:projected-query", "mha:head-0", "mha:head-1"],
    explanationByMode: {
      story: "One wide request splits into two narrower requests, each handled by a different specialist.",
      structure: "Width 8 becomes 2 heads of width 4 for Q, K, and V alike.",
      math: "Q[2,6,8] reshapes to Q[2,2,6,4]; likewise for K and V.",
      code: "q = q.reshape(batch, seq, 2, 4).transpose(1, 2)",
    },
  },
  {
    id: "mha:head-0",
    stationId: "multi-head-attention",
    kind: "component",
    label: "Head 0 selected Q, K, V",
    aliases: ["head 0 board", "HEAD 0"],
    summary: "The exact four-feature query, key, and value for head 0 at the selected batch and position, the values this world follows in the next stations.",
    role: "It is the head-0 slice this world drills into for the one-head-qkv station and beyond.",
    inputs: ["Q2, K2, V2 projected vectors"],
    operation: "Take the first four features of each projected vector.",
    outputs: [`q=[${q.join(", ")}], k=[${mhaSelectedKey.join(", ")}], v=[${mhaSelectedValue.join(", ")}]`],
    shape: "3 x [4]",
    exactValues: { query: q, key: mhaSelectedKey, value: mhaSelectedValue },
    whyItMatters: "These exact numbers are what the following one-head-qkv, attention-scores, causal-mask, and softmax stations compute with.",
    commonMisconceptions: [
      "Head 0's four features are a slice of the shared projection, not a separately learned smaller matrix.",
    ],
    relatedTargetIds: ["mha:head-split", "mha:head-1", "station:one-head-qkv"],
    explanationByMode: {
      story: "This is the specific specialist team whose work this world follows number by number.",
      structure: "One of the two width-4 head lanes, carried forward into the next four stations.",
      math: `q=[${q.join(", ")}], k=[${mhaSelectedKey.join(", ")}], v=[${mhaSelectedValue.join(", ")}].`,
      code: "q0, k0, v0 = q[:, 0], k[:, 0], v[:, 0]",
    },
  },
  {
    id: "mha:head-1",
    stationId: "multi-head-attention",
    kind: "component",
    label: "Head 1 selected Q, K, V",
    aliases: ["head 1 board", "HEAD 1"],
    summary: "Head 1 receives the other four features of each projection, an independently useful learned view this world does not trace numerically.",
    role: "It runs the exact same score-mask-softmax-gather computation as head 0, in parallel, with different resulting numbers.",
    inputs: ["Q2, K2, V2 projected vectors"],
    operation: "Take the last four features of each projected vector.",
    outputs: ["A second independent four-feature query, key, and value per position"],
    shape: "3 x [4]",
    whyItMatters: "Two heads let the model track two different kinds of relationships at once; this world only traces head 0's numbers to keep the example small.",
    commonMisconceptions: [
      "Head 1 is not idle or a placeholder; it runs the full attention computation, just not shown numerically here.",
      "Head 1 uses the same W_Q, W_K, and W_V matrices as head 0; the difference comes only from which four features it reads.",
    ],
    relatedTargetIds: ["mha:head-split", "mha:head-0"],
    explanationByMode: {
      story: "A second specialist team works the exact same job with a different four-number slice.",
      structure: "The other of the two width-4 head lanes; this world does not display its exact numbers.",
      math: "Head 1 computes the same score-mask-softmax-gather pipeline as head 0, on different Q, K, V values.",
      code: "q1, k1, v1 = q[:, 1], k[:, 1], v[:, 1]",
    },
  },
]);

const HEAD_RECOMBINATION_COMPONENT_TARGETS = deepFreeze<
  readonly AssistantTargetContext[]
>([
  {
    id: "recombine:head-zero-output",
    stationId: "head-recombination",
    kind: "component",
    label: "Head 0 output Z0",
    aliases: ["head 0 output", "Z0 board", "HEAD 0 [4]"],
    summary: `Head 0's exact weighted-value output for the selected position returns from the softmax-weighted-value station.`,
    role: "It is one of the two per-head outputs that will be concatenated before the output projection.",
    inputs: ["Head 0's attention weights and values"],
    operation: "Carry the already-computed head-0 output forward.",
    outputs: [`Z0 = [${weightedValue.join(", ")}]`],
    formula: `Z0 = z_${selectedPosition}`,
    shape: "[4]",
    exactValues: { headZeroOutput: weightedValue },
    whyItMatters: "This is the same value computed at the end of the softmax-weighted-v station; nothing changes it here except its position in the concatenation.",
    commonMisconceptions: [
      "This value is not recomputed here; it is the identical head-0 output carried over from the previous station.",
    ],
    relatedTargetIds: ["recombine:head-one-output", "recombine:concatenation", "station:softmax-weighted-v"],
    explanationByMode: {
      story: "Head 0's finished contribution walks in from the previous chamber.",
      structure: "One width-4 vector, ready to sit beside head 1's output.",
      math: `Z0 = [${weightedValue.join(", ")}].`,
      code: "z0 = head_output  # from softmax_weighted_v",
    },
  },
  {
    id: "recombine:head-one-output",
    stationId: "head-recombination",
    kind: "component",
    label: "Head 1 output Z1",
    aliases: ["head 1 output", "Z1 board", "HEAD 1 [4]"],
    summary: "Head 1's width-4 output, computed the same way as head 0 but not traced numerically in this world.",
    role: "It is the second per-head output that will be concatenated before the output projection.",
    inputs: ["Head 1's attention weights and values"],
    operation: "Carry head 1's already-computed output forward.",
    outputs: ["Z1, shape [4], values not displayed"],
    shape: "[4]",
    whyItMatters: "Head 1 genuinely contributes different information than head 0; concatenation is what lets both specializations reach the residual stream.",
    commonMisconceptions: [
      "Head 1's output is a real computed vector, not a placeholder; this world simply does not display its exact numbers.",
    ],
    relatedTargetIds: ["recombine:head-zero-output", "recombine:concatenation"],
    explanationByMode: {
      story: "Head 1's finished contribution arrives alongside head 0's.",
      structure: "One width-4 vector, ready to sit beside head 0's output.",
      math: "Z1 has shape [4]; its exact values are not traced in this teaching example.",
      code: "z1 = head_output  # from head 1's own softmax_weighted_v",
    },
  },
  {
    id: "recombine:concatenation",
    stationId: "head-recombination",
    kind: "component",
    label: "Concatenation of Z0 and Z1",
    aliases: ["concat board", "CONCAT [8]", "head concatenation"],
    summary: "The two width-4 head outputs are placed side by side, not added, to rebuild a width-8 vector.",
    role: "It restores the model's working width of 8 so the output projection W_O can mix the two heads together.",
    inputs: [`Z0 = [${weightedValue.join(", ")}]`, "Z1, shape [4]"],
    operation: "Concatenate Z0 and Z1 along the feature axis.",
    outputs: ["Concat(Z0,Z1), shape [8]"],
    formula: "Concat(Z0,Z1)",
    shape: "[4] + [4] -> [8]",
    whyItMatters: "Concatenation keeps each head's four features distinct; only the next step, W_O, actually mixes information across heads.",
    commonMisconceptions: [
      "This step is concatenation, not elementwise addition; the width grows from 4 to 8, it does not stay at 4.",
      "The two heads are still unmixed at this point; mixing happens only once W_O is applied.",
    ],
    relatedTargetIds: ["recombine:head-zero-output", "recombine:head-one-output", "recombine:output-projection"],
    explanationByMode: {
      story: "Both specialists' notebooks are clipped together, still on separate pages.",
      structure: "Two width-4 vectors sit side by side to form one width-8 vector.",
      math: `Concat([${weightedValue.join(", ")}], Z1) has 8 entries.`,
      code: "concat = torch.cat([z0, z1], dim=-1)",
    },
  },
  {
    id: "recombine:output-projection",
    stationId: "head-recombination",
    kind: "component",
    label: "Output projection W_O",
    aliases: ["W_O", "output weight matrix", "LEARNED W_O"],
    summary: "A learned [8,8] matrix mixes the concatenated head outputs into one combined representation.",
    role: "It is the only place in attention where information from the two heads is actually combined together.",
    inputs: ["Concat(Z0,Z1), shape [8]"],
    operation: "Multiply the concatenated vector by W_O.",
    outputs: ["O, shape [8]"],
    formula: "O = Concat(Z0,Z1) W_O",
    shape: "[8] x [8,8] -> [8]",
    whyItMatters: "Without W_O, the two heads' contributions would simply sit next to each other in the residual stream instead of being blended into a single useful update.",
    commonMisconceptions: [
      "W_O is a learned parameter matrix, not a fixed averaging or splitting operation.",
      "W_O is separate from W_Q, W_K, and W_V; it operates only after concatenation.",
    ],
    relatedTargetIds: ["recombine:concatenation", "recombine:projected-output"],
    explanationByMode: {
      story: "A learned mixing wall blends the two specialists' notes into one combined message.",
      structure: "One [8,8] matrix multiplies the width-8 concatenated vector.",
      math: "O = Concat(Z0,Z1) W_O.",
      code: "o = concat @ W_O",
    },
  },
  {
    id: "recombine:projected-output",
    stationId: "head-recombination",
    kind: "component",
    label: "Attention output O",
    aliases: ["O = CONCAT x W_O", "attention output"],
    summary: "The width-8 result of mixing both heads through W_O, about to be added to the residual stream.",
    role: "It is attention's full contribution for this position, before the residual add.",
    inputs: ["O, shape [8]"],
    operation: "Carry O toward the residual addition.",
    outputs: ["o_0..o_7, one width-8 vector"],
    shape: "[8]",
    whyItMatters: "O, not H, is what the attention sublayer actually learned to contribute this step.",
    commonMisconceptions: [
      "O alone is not the block's new hidden state; it must still be added to the untouched H.",
    ],
    relatedTargetIds: ["recombine:output-projection", "recombine:block-output"],
    explanationByMode: {
      story: "This is what the two attention heads, mixed together, decided to contribute.",
      structure: "One width-8 vector travels from the W_O wall to the residual add.",
      math: "O = Concat(Z0,Z1) W_O.",
      code: "attention_output = concat @ W_O",
    },
  },
  {
    id: "recombine:residual-bypass",
    stationId: "head-recombination",
    kind: "component",
    label: "Residual bypass H",
    aliases: ["UNTOUCHED H", "residual bypass", "skip connection"],
    summary: "The original block input H travels around the entire attention computation to be added back at the end.",
    role: "It preserves the pre-attention signal so the sublayer only has to learn a useful update.",
    inputs: ["Block input H, shape [8]"],
    operation: "Carry H unchanged, in parallel with the LN1-QKV-attention-WO path, to the residual add.",
    outputs: ["h_0..h_7, unchanged"],
    shape: "[8]",
    whyItMatters: "This is the block's first residual connection; the MLP sublayer later adds its own second residual connection.",
    commonMisconceptions: [
      "The bypass path does not pass through LN1, attention, or W_O; it is a literal untouched copy of H.",
    ],
    relatedTargetIds: ["recombine:block-output", "station:transformer-block"],
    explanationByMode: {
      story: "A copy of the token's original summary quietly walks around the whole attention machine.",
      structure: "One width-8 vector skips the LN1-attention-W_O path entirely.",
      math: "The bypass value equals H exactly, unchanged.",
      code: "residual = h  # unchanged, added back later",
    },
  },
  {
    id: "recombine:block-output",
    stationId: "head-recombination",
    kind: "component",
    label: "Post-attention hidden state U",
    aliases: ["U = H + O", "block output", "post-attention state"],
    summary: "The bypassed H and the attention output O add elementwise to produce U, the state the MLP sublayer will read next.",
    role: "It is this block's first residual merge, and the value the MLP station calls U.",
    inputs: ["Bypass H, shape [8]", "Attention output O, shape [8]"],
    operation: "Add the two width-8 vectors element by element.",
    outputs: ["U = H + O, shape [8]"],
    formula: "U = H + O",
    shape: "[8] + [8] -> [8]",
    whyItMatters: "U is exactly the 'selected lane input' the MLP chamber begins with.",
    commonMisconceptions: [
      "U still has shape [8]; adding H and O does not change the model width.",
      "This is the first of two residual adds in the block; the MLP sublayer contributes a second one.",
    ],
    relatedTargetIds: ["recombine:projected-output", "recombine:residual-bypass", "station:mlp"],
    explanationByMode: {
      story: "The token's untouched summary and the attention heads' combined update merge into its next running summary.",
      structure: "Two width-8 vectors add to form one width-8 vector.",
      math: "U[i] = H[i] + O[i], for i in 0..7.",
      code: "u = h + attention_output",
    },
  },
]);

const logitsTargetIndex = SELECTED_TRACE.batch.selectedTargetTokenId;
const logitsRaw = SELECTED_TRACE.output.selectedLogits;
const logitsProbs = SELECTED_TRACE.output.selectedProbabilities;
const logitsTargetWord = SELECTED_TRACE.vocabulary[logitsTargetIndex];
const logitsTargetProb = logitsProbs[logitsTargetIndex];
const logitsTargetRaw = logitsRaw[logitsTargetIndex];

const LOGITS_COMPONENT_TARGETS = deepFreeze<readonly AssistantTargetContext[]>([
  {
    id: "logits:raw-logits",
    stationId: "logits",
    kind: "component",
    label: "Raw logits g[16]",
    aliases: ["raw logits board", "logit scores", "prediction scores"],
    summary: "Sixteen signed scores, one per vocabulary entry, for the selected position; softmax has not yet been applied.",
    role: "It is the unnormalized output of the vocabulary projection, before it becomes a probability distribution.",
    inputs: ["H_final at the selected position, shape [8]"],
    operation: "The vocabulary-projection station already produced these 16 scores; this board displays them.",
    outputs: [`g[16] = [${logitsRaw.join(", ")}]`],
    shape: "[16]",
    exactValues: {
      logits: logitsRaw,
      targetIndex: logitsTargetIndex,
      targetWord: logitsTargetWord,
      targetLogit: logitsTargetRaw,
    },
    whyItMatters: "Logits can be any real number and are not comparable to a probability until softmax normalizes them.",
    commonMisconceptions: [
      "This trace deliberately stores logits as log(p)+ln(10), so every value here is negative and they sum to a specific constant under exp; general logits can be any sign and do not share that property.",
      "A higher logit means a higher resulting probability, but the raw number itself is not a probability.",
    ],
    relatedTargetIds: ["logits:softmax-operation", "logits:probabilities", "station:vocabulary-projection"],
    explanationByMode: {
      story: "Sixteen towers rise to different heights, one guess-strength per possible next word.",
      structure: "16 signed scalar scores, one per vocabulary entry.",
      math: `The correct next word '${logitsTargetWord}' has raw logit ${logitsTargetRaw}.`,
      code: "logits = h_final @ W_vocab + b_vocab",
    },
  },
  {
    id: "logits:softmax-operation",
    stationId: "logits",
    kind: "component",
    label: "Softmax normalization",
    aliases: ["exp ring", "softmax gate", "normalization ring"],
    summary: "Softmax exponentiates every logit and divides by their sum, turning 16 signed scores into 16 nonnegative probabilities that add to one.",
    role: "It is the operation that converts arbitrary-scale prediction scores into a valid probability distribution over the vocabulary.",
    inputs: [`g[16] = [${logitsRaw.join(", ")}]`],
    operation: "Exponentiate every logit, then divide each by the sum of all 16 exponentials.",
    outputs: [`p[16] = [${logitsProbs.join(", ")}]`],
    formula: "p_k = exp(g_k) / sum_j exp(g_j)",
    shape: "[16] -> [16]",
    exactValues: { sumExp: 10, note: "true only because this trace stores logits as log(p)+ln(10)" },
    whyItMatters: "Softmax is what lets 16 unbounded scores become 16 numbers that can be interpreted as, and summed like, probabilities.",
    commonMisconceptions: [
      "This chamber's sum of exponentials equals 10 only because of how this trace's logits were deliberately constructed; it is not a general property of softmax, where the exponentials of raw logits can sum to anything positive.",
      "Softmax is applied across all 16 vocabulary entries at once, not independently per entry.",
    ],
    relatedTargetIds: ["logits:raw-logits", "logits:probabilities"],
    explanationByMode: {
      story: "Every tower's height gets converted into a share of one whole pie.",
      structure: "16 exponentials are summed once, then each logit's exponential is divided by that sum.",
      math: `p_k = exp(g_k) / 10 in this trace; e.g. p('${logitsTargetWord}') = ${logitsTargetProb}.`,
      code: "probabilities = softmax(logits)",
    },
  },
  {
    id: "logits:probabilities",
    stationId: "logits",
    kind: "component",
    label: "Probabilities p[16]",
    aliases: ["probability board", "softmax output", "prediction distribution"],
    summary: `The 16 resulting probabilities for the selected position, summing to 1.00; '${logitsTargetWord}' receives ${logitsTargetProb}.`,
    role: "It is the model's full next-token prediction for this position, before any single answer is chosen or compared to the target.",
    inputs: [`g[16] = [${logitsRaw.join(", ")}]`],
    operation: "Read off the softmax result.",
    outputs: [`p[16] = [${logitsProbs.join(", ")}]`],
    formula: "p = softmax(g)",
    shape: "[16]",
    exactValues: {
      probabilities: logitsProbs,
      targetWord: logitsTargetWord,
      targetProbability: logitsTargetProb,
    },
    whyItMatters: "The loss station reads exactly one of these 16 numbers, the probability assigned to the correct target, to compute this position's penalty.",
    commonMisconceptions: [
      "The model does not commit to one prediction here; all 16 probabilities remain, even the small ones.",
      "The highest probability is not necessarily the correct target; here 'sat' at 0.28 outranks the others, but training continues even when the top guess is wrong.",
    ],
    relatedTargetIds: ["logits:softmax-operation", "station:target-comparison", "loss:correct-probabilities"],
    explanationByMode: {
      story: "Every candidate next word now has its own honest share of belief.",
      structure: "16 nonnegative numbers summing to 1.00.",
      math: `p('${logitsTargetWord}') = ${logitsTargetProb}, the value the loss station will read next.`,
      code: "p_correct = probabilities[target_id]",
    },
  },
  {
    id: "logits:distribution-bars",
    stationId: "logits",
    kind: "component",
    label: "Sixteen vocabulary bars",
    aliases: ["logit bars", "probability bars", "vocabulary ring"],
    summary: "Sixteen bars arranged around the ring morph from raw-logit heights to probability heights, one bar per vocabulary entry, with the correct target highlighted.",
    role: "It is the same 16 numbers as the two boards, shown as an animated distribution so their relative sizes are easy to compare at a glance.",
    inputs: ["g[16] and p[16]"],
    operation: "Interpolate each bar's height between its raw-logit scale and its probability scale as the station plays.",
    outputs: ["16 bars, one highlighted for the correct target"],
    shape: "16 bars",
    exactValues: { targetWord: logitsTargetWord, targetProbability: logitsTargetProb },
    whyItMatters: "Watching the same 16 values morph from logit heights to probability heights makes concrete that softmax reorders nothing, it only rescales.",
    commonMisconceptions: [
      "The morph animation does not change which entry has the highest value; softmax preserves relative order among the logits.",
      "Only the highlighted bar corresponds to the correct next token; the tallest bar is not always the highlighted one in general, though it is in this selected example.",
    ],
    relatedTargetIds: ["logits:raw-logits", "logits:probabilities"],
    explanationByMode: {
      story: "Sixteen candidate answers stand in a ring, their heights reshaping from raw scores into honest probabilities.",
      structure: "One bar per vocabulary entry, arranged in a circle of 16.",
      math: `The highlighted bar is '${logitsTargetWord}', the correct next token, ending at height ${logitsTargetProb}.`,
      code: "bar_height = lerp(abs(logit), probability, morph)",
    },
  },
]);

const embeddingToken = SELECTED_TRACE.embedding.selectedTokenVector;
const embeddingPosVec = SELECTED_TRACE.embedding.selectedPositionVector;
const embeddingHidden = SELECTED_TRACE.embedding.selectedHiddenVector;
const embeddingTokenId = SELECTED_TRACE.embedding.selectedTokenId;
const embeddingSelectedToken = SELECTED_TRACE.embedding.selectedToken;
const embeddingSelectedPosition = SELECTED_TRACE.embedding.selectedPosition;

const EMBEDDING_COMPONENT_TARGETS = deepFreeze<
  readonly AssistantTargetContext[]
>([
  {
    id: "embedding:token-table",
    stationId: "embedding",
    kind: "component",
    label: "Learned token embedding table E",
    aliases: ["token embedding table", "E matrix", "vocabulary embedding wall"],
    summary: `A learned [16,8] table holds one width-8 row for every vocabulary entry; row ${embeddingTokenId} is highlighted because it belongs to the selected token '${embeddingSelectedToken}'.`,
    role: "It converts a token ID into a dense learned vector without any positional information.",
    inputs: [`Token ID ${embeddingTokenId} for the selected token '${embeddingSelectedToken}'`],
    operation: "Look up row id in table E.",
    outputs: [`E[${embeddingTokenId},:] = [${embeddingToken.join(", ")}]`],
    formula: "E[16,8]; E[id,:] selects one learned row",
    shape: "[16,8]",
    exactValues: {
      vocabularySize: TEACHING_MODEL.vocabularySize,
      modelWidth: TEACHING_MODEL.modelWidth,
      selectedTokenId: embeddingTokenId,
      selectedToken: embeddingSelectedToken,
      selectedRow: embeddingToken,
    },
    whyItMatters:
      "Every occurrence of the same token type shares this same learned row wherever it appears in a window.",
    commonMisconceptions: [
      "The lookup is a row selection, not a computed projection like Q, K, or V.",
      "E is a learned parameter table; it is not recomputed from the input text at every step.",
      "The row alone carries no information about where the token sits in the sequence.",
    ],
    relatedTargetIds: [
      "embedding:position-table",
      "embedding:selected-token-row",
      "embedding:sum-result",
    ],
    explanationByMode: {
      story: `The table is a dictionary of learned meanings; row ${embeddingTokenId} is the entry the model has learned for '${embeddingSelectedToken}'.`,
      structure: "16 rows, one per vocabulary entry, by 8 learned features form table E.",
      math: `E[${embeddingTokenId},:] = [${embeddingToken.join(", ")}].`,
      code: "token_vector = E[token_id]",
    },
  },
  {
    id: "embedding:position-table",
    stationId: "embedding",
    kind: "component",
    label: "Learned position embedding table P",
    aliases: ["position embedding table", "P matrix", "position embedding wall"],
    summary: `A learned [6,8] table holds one width-8 row for every sequence position; row ${embeddingSelectedPosition} is highlighted because the selected token sits at position ${embeddingSelectedPosition}.`,
    role: "It gives the model a learned signal for where in the 6-token window a position falls, independent of which token occupies it.",
    inputs: [`Position index ${embeddingSelectedPosition}`],
    operation: "Look up row position in table P.",
    outputs: [`P[${embeddingSelectedPosition},:] = [${embeddingPosVec.join(", ")}]`],
    formula: "P[6,8]; P[pos,:] selects one learned row",
    shape: "[6,8]",
    exactValues: {
      sequenceLength: TEACHING_MODEL.sequenceLength,
      modelWidth: TEACHING_MODEL.modelWidth,
      selectedPosition: embeddingSelectedPosition,
      selectedRow: embeddingPosVec,
    },
    whyItMatters:
      "Without this table, the same token at two different positions would look identical, and attention could not use order.",
    commonMisconceptions: [
      "Position embeddings are learned parameters here, not the fixed sinusoidal encodings used by some other Transformers.",
      "The position row does not depend on which token occupies that position.",
    ],
    relatedTargetIds: [
      "embedding:token-table",
      "embedding:selected-position-row",
      "embedding:sum-result",
    ],
    explanationByMode: {
      story: `This table is a learned map of 'slots' 0 through 5; row ${embeddingSelectedPosition} is the entry for this slot in the window.`,
      structure: "6 rows, one per sequence position, by 8 learned features form table P.",
      math: `P[${embeddingSelectedPosition},:] = [${embeddingPosVec.join(", ")}].`,
      code: "position_vector = P[position_index]",
    },
  },
  {
    id: "embedding:token-address",
    stationId: "embedding",
    kind: "component",
    label: "Token address",
    aliases: ["token address", "token ID ticket", "which row"],
    summary: `This small board names the selected token '${embeddingSelectedToken}' and its integer ID ${embeddingTokenId}; the ID is only an address into table E, not a magnitude.`,
    role: "It labels which row of the token table is about to be read.",
    inputs: ["Selected token from the current input window"],
    operation: "Look up the vocabulary ID assigned to this token.",
    outputs: [`Token '${embeddingSelectedToken}' -> ID ${embeddingTokenId}`],
    shape: "scalar ID",
    exactValues: { token: embeddingSelectedToken, tokenId: embeddingTokenId },
    whyItMatters:
      "Confusing an ID with a quantity is a common mistake; a higher ID is not 'more' than a lower one in any numeric sense.",
    commonMisconceptions: [
      "Token IDs are arbitrary addresses assigned during vocabulary construction, not learned or ordered by meaning.",
    ],
    relatedTargetIds: ["embedding:token-table", "embedding:position-address"],
    explanationByMode: {
      story: "This ticket just says which drawer of the token dictionary to open.",
      structure: "One scalar ID selects one of 16 rows.",
      math: `id('${embeddingSelectedToken}') = ${embeddingTokenId}.`,
      code: "token_id = vocabulary[token]",
    },
  },
  {
    id: "embedding:position-address",
    stationId: "embedding",
    kind: "component",
    label: "Position address",
    aliases: ["position address", "position ticket", "which slot"],
    summary: `This small board names the selected sequence slot, position ${embeddingSelectedPosition}, used to look up the position table.`,
    role: "It labels which row of the position table is about to be read.",
    inputs: [`Selected position ${embeddingSelectedPosition} within the 6-token window`],
    operation: "Identify the index of this token within its window.",
    outputs: [`Position -> ${embeddingSelectedPosition}`],
    shape: "scalar index",
    exactValues: {
      position: embeddingSelectedPosition,
      sequenceLength: TEACHING_MODEL.sequenceLength,
    },
    whyItMatters:
      "The same position index is reused by every window at that slot, regardless of which tokens occupy it.",
    commonMisconceptions: [
      "The position index counts slots in the window; it is not a token ID and is not affected by which token is present.",
    ],
    relatedTargetIds: ["embedding:position-table", "embedding:token-address"],
    explanationByMode: {
      story: "This ticket says which numbered slot in the six-wide window is being filled.",
      structure: "One scalar index selects one of 6 rows.",
      math: `position = ${embeddingSelectedPosition}.`,
      code: "position_vector = P[position_index]",
    },
  },
  {
    id: "embedding:selected-token-row",
    stationId: "embedding",
    kind: "component",
    label: `Selected token row E[${embeddingTokenId},:]`,
    aliases: ["token row", "E row", "token vector in flight"],
    summary: `The width-8 row read from table E for '${embeddingSelectedToken}' travels toward the addition point.`,
    role: "It is one of the two operands that will be summed to build this position's starting hidden state.",
    inputs: [`E[${embeddingTokenId},:]`],
    operation: "Carry the looked-up token row toward the addition.",
    outputs: [`[${embeddingToken.join(", ")}]`],
    formula: `E[${embeddingTokenId},:] = [${embeddingToken.join(", ")}]`,
    shape: "[8]",
    exactValues: { vector: embeddingToken },
    whyItMatters:
      "This is the token-identity half of the initial hidden state, before any positional information is added.",
    commonMisconceptions: [
      "This moving vector is a temporary activation copied from the learned table; moving it does not change E itself.",
    ],
    relatedTargetIds: [
      "embedding:token-table",
      "embedding:selected-position-row",
      "embedding:sum-result",
    ],
    explanationByMode: {
      story: `This is '${embeddingSelectedToken}' meaning, still waiting to learn which slot it fills.`,
      structure: "One width-8 vector moves from the token table toward the addition point.",
      math: `[${embeddingToken.join(", ")}] will be added to the position row.`,
      code: "token_vector = E[token_id]  # travels to the add step",
    },
  },
  {
    id: "embedding:selected-position-row",
    stationId: "embedding",
    kind: "component",
    label: `Selected position row P[${embeddingSelectedPosition},:]`,
    aliases: ["position row", "P row", "position vector in flight"],
    summary: `The width-8 row read from table P for position ${embeddingSelectedPosition} travels toward the addition point.`,
    role: "It is the second operand summed with the token row to build this position's starting hidden state.",
    inputs: [`P[${embeddingSelectedPosition},:]`],
    operation: "Carry the looked-up position row toward the addition.",
    outputs: [`[${embeddingPosVec.join(", ")}]`],
    formula: `P[${embeddingSelectedPosition},:] = [${embeddingPosVec.join(", ")}]`,
    shape: "[8]",
    exactValues: { vector: embeddingPosVec },
    whyItMatters:
      "This is the slot-identity half of the initial hidden state, independent of which token is present.",
    commonMisconceptions: [
      "This moving vector is a temporary activation copied from the learned table; moving it does not change P itself.",
    ],
    relatedTargetIds: [
      "embedding:position-table",
      "embedding:selected-token-row",
      "embedding:sum-result",
    ],
    explanationByMode: {
      story: "This is the slot signal, still waiting to be merged with a token's identity.",
      structure: "One width-8 vector moves from the position table toward the addition point.",
      math: `[${embeddingPosVec.join(", ")}] will be added to the token row.`,
      code: "position_vector = P[position_index]  # travels to the add step",
    },
  },
  {
    id: "embedding:sum-result",
    stationId: "embedding",
    kind: "component",
    label: `Summed hidden state H0[0,${embeddingSelectedPosition},:]`,
    aliases: ["sum result", "H0 selected row", "token plus position"],
    summary:
      "The token row and position row add element by element to produce the exact starting hidden state for this position.",
    role: "It is the model's first per-position representation, before any Transformer block processes it.",
    inputs: [
      `E[${embeddingTokenId},:] = [${embeddingToken.join(", ")}]`,
      `P[${embeddingSelectedPosition},:] = [${embeddingPosVec.join(", ")}]`,
    ],
    operation: "Add the two width-8 vectors element by element.",
    outputs: [`H0[0,${embeddingSelectedPosition},:] = [${embeddingHidden.join(", ")}]`],
    formula: `H0[0,${embeddingSelectedPosition},:] = E[${embeddingTokenId},:] + P[${embeddingSelectedPosition},:]`,
    shape: "[8] + [8] -> [8]",
    exactValues: {
      tokenVector: embeddingToken,
      positionVector: embeddingPosVec,
      sum: embeddingHidden,
    },
    whyItMatters:
      "From this point forward the model only ever sees the sum; token identity and position are not kept as separate channels.",
    commonMisconceptions: [
      "The addition is elementwise, not concatenation; the result stays width 8, not width 16.",
      "After this point the model cannot separately recover the original token row or position row from H0.",
    ],
    relatedTargetIds: [
      "embedding:selected-token-row",
      "embedding:selected-position-row",
      "embedding:hidden-state-output",
    ],
    explanationByMode: {
      story: `'${embeddingSelectedToken}' and position ${embeddingSelectedPosition} merge into one updated description of this spot in the sentence.`,
      structure: "Two width-8 vectors add to form one width-8 vector.",
      math: `${embeddingToken[0]}+${embeddingPosVec[0]}=${embeddingHidden[0]}, and likewise for the other seven features.`,
      code: "h0 = token_vector + position_vector",
    },
  },
  {
    id: "embedding:hidden-state-output",
    stationId: "embedding",
    kind: "component",
    label: "Initial hidden state H0",
    aliases: ["H0 output", "hidden state cassette rack", "embedding output tensor"],
    summary:
      "All 12 positions across both batch rows receive their own token-plus-position sum, producing the full [2,6,8] tensor H0 that enters the Transformer tower.",
    role: "It is the input the first Transformer block will read; every later station builds on this exact tensor shape.",
    inputs: ["12 independent token-plus-position sums, one per batch/position pair"],
    operation: "Repeat the token-plus-position lookup and sum for every position in both batch rows.",
    outputs: ["H0 with shape [2,6,8]"],
    formula: "H0[b,t,:] = E[token_id(b,t),:] + P[t,:]",
    shape: "[2,6,8]",
    exactValues: {
      batchSize: TEACHING_MODEL.batchSize,
      sequenceLength: TEACHING_MODEL.sequenceLength,
      modelWidth: TEACHING_MODEL.modelWidth,
      selectedRow: embeddingHidden,
    },
    whyItMatters:
      "This is the only station where token identity and sequence position are combined; every later station operates on this merged representation.",
    commonMisconceptions: [
      "H0 does not yet mix information across positions; that begins only once attention runs in the next stations.",
      "The tensor holds 12 independent width-8 vectors, not one shared vector.",
    ],
    relatedTargetIds: ["embedding:sum-result", "station:transformer-tower"],
    explanationByMode: {
      story: "Every seat in the sentence now has its own starting description, ready to enter the tower.",
      structure: "12 width-8 vectors (2 batch rows x 6 positions) form the [2,6,8] tensor.",
      math: `The highlighted row equals [${embeddingHidden.join(", ")}]; the other 11 rows follow the same rule.`,
      code: "h0 = token_embeddings[token_ids] + position_embeddings[positions]",
    },
  },
]);

const lossCorrectProbs = SELECTED_TRACE.output.correctTokenProbabilities.flat();
const lossPerTokenLosses = SELECTED_TRACE.output.perTokenLosses.flat();
const lossSelectedProbability = SELECTED_TRACE.output.selectedCorrectProbability;
const lossSelectedTokenLoss = SELECTED_TRACE.output.selectedTokenLoss;
const lossMean = SELECTED_TRACE.output.meanLoss;
const lossSum = Number(
  lossPerTokenLosses.reduce<number>((sum, value) => sum + value, 0).toFixed(6),
);

const LOSS_COMPONENT_TARGETS = deepFreeze<readonly AssistantTargetContext[]>([
  {
    id: "loss:correct-probabilities",
    stationId: "loss",
    kind: "component",
    label: "Correct-token probabilities P_correct",
    aliases: ["P_correct board", "correct probabilities", "target probability board"],
    summary:
      "For each of the 12 supervised positions, this board shows the softmax probability the model assigned to the actual next token, not the probability of its top guess.",
    role: "It is the raw ingredient cross-entropy consumes; every other value in this chamber is derived from these 12 numbers.",
    inputs: ["Softmax probabilities from the logits station, restricted to the correct next-token index at each position"],
    operation: "Gather softmax(logits)[b,t,target_id(b,t)] for every supervised position.",
    outputs: [`P_correct [2x6] = [${lossCorrectProbs.join(", ")}]`],
    formula: "P_correct[b,t] = softmax(logits[b,t,:])[target_id(b,t)]",
    shape: "[2,6]",
    exactValues: {
      correctTokenProbabilities: SELECTED_TRACE.output.correctTokenProbabilities,
      selectedValue: lossSelectedProbability,
    },
    whyItMatters:
      "Cross-entropy only ever looks at the probability given to the correct answer; the probabilities given to wrong tokens do not directly appear in the loss.",
    commonMisconceptions: [
      "A probability like 0.28 is not necessarily the model's top guess; it is only how much probability landed on the correct token.",
      "These 12 values are gathered from the full [2,6,16] softmax output, not computed by a separate operation.",
    ],
    relatedTargetIds: ["loss:token-penalties", "loss:selected-lane", "station:target-comparison"],
    explanationByMode: {
      story: "For every position, this asks how much the model actually believed the true next word.",
      structure: "12 supervised positions, 2 batch rows by 6, each contribute one probability.",
      math: `The highlighted lane shows ${lossSelectedProbability}, the probability given to the correct token.`,
      code: "p_correct = probs[batch, position, target_id]",
    },
  },
  {
    id: "loss:token-penalties",
    stationId: "loss",
    kind: "component",
    label: "Per-token penalties -ln(P_correct)",
    aliases: ["token penalties", "negative log loss board", "per-token loss"],
    summary:
      "Each correct-token probability is passed through -ln to produce a penalty: near 0 for confident correct predictions, large for confident wrong ones.",
    role: "It converts probabilities into an additive, always-nonnegative penalty that cross-entropy can average.",
    inputs: [`P_correct [2x6] = [${lossCorrectProbs.join(", ")}]`],
    operation: "Apply the negative natural logarithm elementwise to all 12 probabilities.",
    outputs: [`Token penalties [2x6] = [${lossPerTokenLosses.join(", ")}]`],
    formula: "penalty[b,t] = -ln(P_correct[b,t])",
    shape: "[2,6] -> [2,6]",
    exactValues: {
      perTokenLosses: SELECTED_TRACE.output.perTokenLosses,
      selectedValue: lossSelectedTokenLoss,
    },
    whyItMatters:
      "-ln is what makes a confident wrong prediction cost far more than a mildly wrong one, since -ln approaches infinity as probability approaches zero.",
    commonMisconceptions: [
      "-ln(1) = 0, so a perfectly confident correct prediction costs nothing; these values are never negative for probabilities in (0,1].",
      "Each penalty depends only on that position's own correct-token probability, not on the other 11 positions.",
    ],
    relatedTargetIds: ["loss:correct-probabilities", "loss:cross-entropy-gates", "loss:selected-lane"],
    explanationByMode: {
      story: "Every confident correct guess earns a near-zero penalty; every confident wrong guess earns a steep one.",
      structure: "12 independent -ln gates, one per supervised position.",
      math: `The highlighted lane computes -ln(${lossSelectedProbability}) = ${lossSelectedTokenLoss}.`,
      code: "loss_per_token = -log(p_correct)",
    },
  },
  {
    id: "loss:selected-lane",
    stationId: "loss",
    kind: "component",
    label: `Selected lane: -ln(${lossSelectedProbability})`,
    aliases: ["selected lane", "highlighted computation", "worked example"],
    summary: `This panel walks the one highlighted lane through the exact computation: probability ${lossSelectedProbability} becomes penalty ${lossSelectedTokenLoss}.`,
    role: "It is a worked numeric example of the -ln step applied elsewhere across all 12 lanes.",
    inputs: [`P_correct = ${lossSelectedProbability}`],
    operation: `Compute -ln(${lossSelectedProbability}).`,
    outputs: [`${lossSelectedTokenLoss}`],
    formula: `-ln(${lossSelectedProbability}) = ${lossSelectedTokenLoss}`,
    shape: "scalar",
    exactValues: { probability: lossSelectedProbability, penalty: lossSelectedTokenLoss },
    whyItMatters:
      "Seeing one lane worked out exactly makes the abstract -ln operation concrete before the chamber sums all 12.",
    commonMisconceptions: [
      "This single value is one of 12 penalties feeding the mean; it is not the final scalar loss by itself.",
    ],
    relatedTargetIds: ["loss:correct-probabilities", "loss:token-penalties", "loss:scalar-loss"],
    explanationByMode: {
      story: `One lane, worked all the way through: a ${Math.round(lossSelectedProbability * 100)}% correct-token probability costs about ${lossSelectedTokenLoss.toFixed(2)}.`,
      structure: "This is one cell out of the [2,6] penalty board, shown enlarged.",
      math: `-ln(${lossSelectedProbability}) = ${lossSelectedTokenLoss}.`,
      code: `loss = -math.log(${lossSelectedProbability})  # ${lossSelectedTokenLoss}`,
    },
  },
  {
    id: "loss:cross-entropy-gates",
    stationId: "loss",
    kind: "component",
    label: "Twelve independent -ln gates",
    aliases: ["ln gates", "cross entropy gates", "penalty hoops"],
    summary:
      "Twelve identical -ln gates, one per supervised position, each turn one correct-token probability into one penalty.",
    role: "It is the visual machinery performing the elementwise -ln step shared by all 12 positions.",
    inputs: ["12 correct-token probabilities"],
    operation: "Apply -ln independently in each of the 12 gates.",
    outputs: ["12 penalties, later gathered into the funnel"],
    formula: "penalty[i] = -ln(P_correct[i]) for i in 0..11",
    shape: "12 independent scalar gates",
    whyItMatters:
      "Each gate is identical in function; only its input probability differs, which is why penalties vary so much across positions.",
    commonMisconceptions: [
      "The gates apply the same fixed -ln function everywhere; they contain no learned parameters.",
    ],
    relatedTargetIds: ["loss:token-penalties", "loss:averaging"],
    explanationByMode: {
      story: "Twelve identical judges, each scoring one position's confidence in the true answer.",
      structure: "12 gates arranged 2 rows by 6 columns, matching the batch and sequence axes.",
      math: "Every gate computes the same function -ln(p); only p differs per gate.",
      code: "penalties = [-log(p) for p in correct_probs]",
    },
  },
  {
    id: "loss:averaging",
    stationId: "loss",
    kind: "component",
    label: "Sum and mean over 12 penalties",
    aliases: ["averaging funnel", "sum and divide", "mean loss computation"],
    summary: `All 12 penalties funnel together, sum to about ${lossSum}, and divide by 12 to produce the mean loss ${lossMean}.`,
    role: "It reduces 12 independent per-token penalties into the single scalar that AdamW will ultimately differentiate.",
    inputs: [`12 token penalties, summing to ${lossSum}`],
    operation: "Add all 12 penalties, then divide by 12.",
    outputs: [`Mean loss L = ${lossMean}`],
    formula: "L = (1/12) * sum_i penalty[i]",
    shape: "[12] -> scalar",
    exactValues: { sum: lossSum, count: 12, mean: lossMean },
    whyItMatters:
      "Averaging, rather than summing, keeps the loss magnitude comparable across batches of different sizes or sequence lengths.",
    commonMisconceptions: [
      "Every one of the 12 positions contributes equally to the mean; none are weighted more than others in this trace.",
      "The mean is computed over valid supervised next-token positions only, not over vocabulary entries.",
    ],
    relatedTargetIds: ["loss:cross-entropy-gates", "loss:scalar-loss"],
    explanationByMode: {
      story: "Every position's penalty pours into one funnel, which reports back the average disappointment.",
      structure: "12 scalar penalties reduce to 1 scalar loss.",
      math: `sum ~= ${lossSum}; ${lossSum} / 12 = ${lossMean}.`,
      code: "mean_loss = sum(penalties) / len(penalties)",
    },
  },
  {
    id: "loss:scalar-loss",
    stationId: "loss",
    kind: "component",
    label: "Scalar training loss L",
    aliases: ["scalar loss", "L value", "final loss value"],
    summary: `The single number L = ${lossMean} that reverse-mode differentiation will use to compute every gradient in the backward pass.`,
    role: "It is the one quantity the entire backward pass and AdamW update ultimately trace back to.",
    inputs: [`Mean loss ${lossMean}`],
    operation: "Hold the scalar loss as the root of backpropagation.",
    outputs: [`L = ${lossMean}`],
    formula: `L = ${lossMean}`,
    shape: "scalar",
    exactValues: { meanLoss: lossMean },
    whyItMatters:
      "Every gradient computed in the following backprop stations is, by the chain rule, a derivative of exactly this one number.",
    commonMisconceptions: [
      "A lower L means better predictions on this batch; L is not itself a probability and is not bounded by 1.",
      "This scalar is recomputed fresh every training step; it is not accumulated across steps.",
    ],
    relatedTargetIds: ["loss:averaging", "station:output-backprop"],
    explanationByMode: {
      story: "This is the one number the whole model is being nudged to reduce.",
      structure: "One scalar sits at the root of the backward pass that follows.",
      math: `L = ${lossMean}.`,
      code: "loss.backward()  # starts from this scalar",
    },
  },
]);

const MLP_COMPONENT_TARGETS = deepFreeze<readonly AssistantTargetContext[]>([
  {
    id: "mlp:token-lanes",
    stationId: "mlp",
    kind: "component",
    label: "Twelve independent token lanes",
    aliases: ["token lanes", "independent lanes", "per-token queue"],
    summary:
      "Every one of the 12 supervised positions (2 batch rows x 6 positions) enters its own MLP lane; positions never exchange information inside this chamber.",
    role: "It sets up the per-token, position-independent processing that defines a feed-forward layer, in contrast to attention which mixes across positions.",
    inputs: ["12 post-attention hidden vectors U, shape [2,6,8]"],
    operation: "Route each width-8 vector into its own lane without mixing across lanes.",
    outputs: ["12 independent width-8 lanes ready for LN2"],
    shape: "[2,6,8]",
    whyItMatters:
      "This position-independence is what makes the MLP a per-token computation, unlike the attention stations that just finished mixing across positions.",
    commonMisconceptions: [
      "Lanes are visually separated for clarity; all 12 reuse the exact same learned W_up and W_down parameters, they are not 12 different MLPs.",
    ],
    relatedTargetIds: ["station:head-recombination", "mlp:selected-input"],
    explanationByMode: {
      story: "Twelve tokens each walk into their own private processing lane.",
      structure: "2 batch rows x 6 positions = 12 lanes, each carrying one width-8 vector.",
      math: "U has shape [2,6,8]; the MLP treats the leading two axes as 12 independent rows.",
      code: "for b, t in positions: mlp(u[b, t])  # conceptually; actually batched",
    },
  },
  {
    id: "mlp:selected-input",
    stationId: "mlp",
    kind: "component",
    label: "Selected lane input U",
    aliases: ["selected input", "U vector", "block residual stream"],
    summary:
      "This is the width-8 vector for one selected token entering the MLP; it is the same residual-stream value that will later be added back after the MLP output.",
    role: "It is both the value that gets normalized and transformed, and the value kept aside for the residual bypass.",
    inputs: ["One row of the post-attention residual stream U"],
    operation: "Copy the selected lane's vector for display; the original continues unmodified into LN2 and into the bypass path.",
    outputs: ["u_0..u_7, one selected width-8 vector"],
    shape: "[8]",
    whyItMatters:
      "Keeping an unmodified copy of U is what lets the residual connection add the original signal back later.",
    commonMisconceptions: [
      "This vector is a temporary activation for the selected lane, not a stored parameter.",
    ],
    relatedTargetIds: ["mlp:token-lanes", "mlp:layer-norm-gate", "mlp:residual-bypass"],
    explanationByMode: {
      story: "This is one token's current running summary, about to be examined by the MLP.",
      structure: "One width-8 vector splits conceptually into a normalized path and an unmodified bypass path.",
      math: "U enters both LN2(U) and the later residual add U+F.",
      code: "u = hidden_state[b, t]",
    },
  },
  {
    id: "mlp:layer-norm-gate",
    stationId: "mlp",
    kind: "component",
    label: "Pre-MLP LayerNorm (LN2)",
    aliases: ["LN2", "layer norm gate", "pre-MLP normalization"],
    summary:
      "LayerNorm2 renormalizes the selected lane's eight features before they reach W_up, the same pre-norm pattern used before attention.",
    role: "It stabilizes the scale of the input to the expansion projection, independent of the raw magnitude of U.",
    inputs: ["Selected lane U, shape [8]"],
    operation: "Normalize U's eight features to zero mean and unit variance, then apply a learned scale and shift.",
    outputs: ["LN2(U), shape [8]"],
    formula: "LN2(U) = normalize(U) * gamma + beta",
    shape: "[8] -> [8]",
    whyItMatters:
      "Pre-norm placement, normalizing before the sublayer rather than after, is the same architectural choice used before attention in this world.",
    commonMisconceptions: [
      "LN2 is a separate learned normalization from LN1; each block owns its own LN1 and LN2 parameters.",
      "Normalizing does not change the vector's width; it stays 8 features.",
    ],
    relatedTargetIds: ["mlp:selected-input", "mlp:normalized-input", "mlp:up-projection"],
    explanationByMode: {
      story: "Before the token's summary is stretched wide, its scale gets steadied first.",
      structure: "One width-8 vector is normalized feature by feature.",
      math: "LN2(U) = (U - mean(U)) / std(U) * gamma + beta.",
      code: "normalized = layer_norm_2(u)",
    },
  },
  {
    id: "mlp:normalized-input",
    stationId: "mlp",
    kind: "component",
    label: "Normalized lane LN2(U)",
    aliases: ["normalized input", "LN2 output", "n vector"],
    summary: "The renormalized width-8 vector that feeds the up-projection W_up.",
    role: "It is the actual operand multiplied by W_up in the expansion step.",
    inputs: ["LN2(U)"],
    operation: "Carry the normalized vector to the W_up wall.",
    outputs: ["n_0..n_7, one width-8 vector"],
    shape: "[8]",
    whyItMatters:
      "Distinguishing LN2(U) from raw U matters because W_up is applied to the normalized value, not the residual-stream value.",
    commonMisconceptions: [
      "This normalized vector is temporary; it is not what gets added back in the residual connection later.",
    ],
    relatedTargetIds: ["mlp:layer-norm-gate", "mlp:up-projection"],
    explanationByMode: {
      story: "This is the steadied version of the token's summary, ready to be expanded.",
      structure: "One width-8 vector travels from the LN2 gate to the W_up wall.",
      math: "n = LN2(U); n multiplies W_up next.",
      code: "normalized_input = layer_norm_2(u)",
    },
  },
  {
    id: "mlp:up-projection",
    stationId: "mlp",
    kind: "component",
    label: "Up-projection W_up and bias b_up",
    aliases: ["W_up", "up projection wall", "expansion wall", "b_up"],
    summary: "A shared learned [8,32] matrix and [32] bias expand the normalized width-8 vector into 32 features.",
    role: "It is the first half of the MLP's expand-then-contract structure that gives the model extra per-token capacity.",
    inputs: ["LN2(U), shape [8]"],
    operation: "Multiply by W_up and add b_up.",
    outputs: ["Pre-activation vector, shape [32]"],
    formula: "pre_activation = LN2(U) W_up + b_up",
    shape: "[8] x [8,32] -> [32]",
    whyItMatters:
      "Widening to 32 features gives the per-token computation more room to combine the eight input features before GELU and contraction back to 8.",
    commonMisconceptions: [
      "W_up and b_up are shared learned parameters reused by all 12 lanes; they are not recomputed per token.",
      "This is a per-token computation; W_up does not mix information across positions.",
    ],
    relatedTargetIds: ["mlp:normalized-input", "mlp:gelu-activation"],
    explanationByMode: {
      story: "One wide learned wall stretches the token's eight-number summary out to thirty-two.",
      structure: "The same [8,32] wall and [32] bias serve every one of the 12 lanes.",
      math: "pre_activation[k] = sum_i n[i] W_up[i,k] + b_up[k], for k in 0..31.",
      code: "pre_activation = normalized_input @ W_up + b_up",
    },
  },
  {
    id: "mlp:gelu-activation",
    stationId: "mlp",
    kind: "component",
    label: "GELU activation",
    aliases: ["GELU", "gelu units", "activation gate"],
    summary: "Each of the 32 expanded features passes through the smooth GELU nonlinearity, the MVP activation choice for this world.",
    role: "It introduces the nonlinearity that lets the MLP represent more than a linear function of its input.",
    inputs: ["Pre-activation vector, shape [32]"],
    operation: "Apply GELU elementwise to each of the 32 features.",
    outputs: ["Activated vector, shape [32]"],
    formula: "activated = GELU(pre_activation)",
    shape: "[32] -> [32]",
    whyItMatters:
      "Without a nonlinearity here, stacking W_up and W_down would collapse into one linear map, unable to represent more than the attention stations already computed.",
    commonMisconceptions: [
      "GELU is applied independently to each of the 32 features; it does not mix them together.",
      "This world uses plain GELU, not the gated SwiGLU variant some modern LLMs use instead.",
    ],
    relatedTargetIds: ["mlp:up-projection", "mlp:down-projection"],
    explanationByMode: {
      story: "Thirty-two valves each smoothly decide how much of their signal to let through.",
      structure: "32 independent scalar activations sit between the up- and down-projections.",
      math: "GELU(x) ~= x * Phi(x), where Phi is the standard normal CDF.",
      code: "activated = gelu(pre_activation)",
    },
  },
  {
    id: "mlp:down-projection",
    stationId: "mlp",
    kind: "component",
    label: "Down-projection W_down and bias b_down",
    aliases: ["W_down", "down projection wall", "contraction wall", "b_down"],
    summary: "A shared learned [32,8] matrix and [8] bias compress the 32 activated features back down to width 8.",
    role: "It is the second half of the expand-then-contract structure, returning the MLP output to the model's working width.",
    inputs: ["Activated vector, shape [32]"],
    operation: "Multiply by W_down and add b_down.",
    outputs: ["F, shape [8]"],
    formula: "F = activated W_down + b_down",
    shape: "[32] x [32,8] -> [8]",
    whyItMatters: "Returning to width 8 lets F be added directly back into the residual stream alongside U.",
    commonMisconceptions: [
      "W_down and b_down are a separate learned parameter set from W_up and b_up, not its transpose or inverse.",
    ],
    relatedTargetIds: ["mlp:gelu-activation", "mlp:output"],
    explanationByMode: {
      story: "A second wide learned wall funnels the thirty-two signals back down to eight.",
      structure: "The same [32,8] wall and [8] bias serve every one of the 12 lanes.",
      math: "F[j] = sum_k activated[k] W_down[k,j] + b_down[j], for j in 0..7.",
      code: "mlp_output = activated @ W_down + b_down",
    },
  },
  {
    id: "mlp:output",
    stationId: "mlp",
    kind: "component",
    label: "MLP output F",
    aliases: ["MLP output", "F vector", "feed-forward output"],
    summary: "The width-8 result of the full expand-GELU-contract computation for the selected lane, about to rejoin the residual stream.",
    role: "It is the MLP sublayer's contribution before the residual add.",
    inputs: ["Down-projected vector F, shape [8]"],
    operation: "Carry F toward the residual addition.",
    outputs: ["f_0..f_7, one width-8 vector"],
    shape: "[8]",
    whyItMatters: "F, not U, is what the MLP actually learned to compute this step; the residual add combines it with the untouched U.",
    commonMisconceptions: [
      "F alone is not the block's new hidden state; it must still be added to U.",
    ],
    relatedTargetIds: ["mlp:down-projection", "mlp:block-output"],
    explanationByMode: {
      story: "This is what the MLP decided to contribute for this token.",
      structure: "One width-8 vector travels from the down-projection wall to the residual add.",
      math: "F = GELU(LN2(U) W_up + b_up) W_down + b_down.",
      code: "mlp_output = mlp(normalized_input)",
    },
  },
  {
    id: "mlp:residual-bypass",
    stationId: "mlp",
    kind: "component",
    label: "Residual bypass U",
    aliases: ["residual bypass", "bypass U", "skip connection"],
    summary: "The original, unmodified lane input U travels around the MLP computation to be added back at the end.",
    role: "It preserves the pre-MLP signal so the sublayer only has to learn a useful update, not reconstruct its own input.",
    inputs: ["Selected lane U, shape [8]"],
    operation: "Carry U unchanged, in parallel with the LN2-GELU-projection path, to the residual add.",
    outputs: ["u_0..u_7, unchanged"],
    shape: "[8]",
    whyItMatters: "Residual connections are why deep stacks of blocks remain trainable; gradients can flow through this path even if the MLP path is small.",
    commonMisconceptions: [
      "The bypass path does not pass through LN2, W_up, GELU, or W_down; it is a literal untouched copy of U.",
    ],
    relatedTargetIds: ["mlp:selected-input", "mlp:block-output"],
    explanationByMode: {
      story: "A copy of the token's original summary quietly walks around the whole MLP machine.",
      structure: "One width-8 vector skips the expand-GELU-contract path entirely.",
      math: "The bypass value equals U exactly, unchanged.",
      code: "residual = u  # unchanged, added back later",
    },
  },
  {
    id: "mlp:block-output",
    stationId: "mlp",
    kind: "component",
    label: "Block MLP output H'",
    aliases: ["H prime", "residual sum", "block output"],
    summary: "The bypassed U and the MLP output F add elementwise to produce H', this lane's hidden state after the MLP sublayer.",
    role: "It is the value this lane carries out of the MLP chamber and into the next block, or final LayerNorm if this was the last block.",
    inputs: ["Bypass U, shape [8]", "MLP output F, shape [8]"],
    operation: "Add the two width-8 vectors element by element.",
    outputs: ["H' = U + F, shape [8]"],
    formula: "H' = U + F",
    shape: "[8] + [8] -> [8]",
    whyItMatters: "This residual add is the second and last place, after the attention sublayer's own residual add, that this block changes the hidden state.",
    commonMisconceptions: [
      "H' still has shape [8]; adding U and F does not change the model width.",
      "This addition happens independently in each of the 12 lanes; it does not mix information across positions.",
    ],
    relatedTargetIds: ["mlp:output", "mlp:residual-bypass", "station:final-hidden-state"],
    explanationByMode: {
      story: "The token's untouched summary and the MLP's suggested update merge into its next running summary.",
      structure: "Two width-8 vectors add to form one width-8 vector, independently for each of the 12 lanes.",
      math: "H'[i] = U[i] + F[i], for i in 0..7.",
      code: "h_prime = u + mlp_output",
    },
  },
]);

export const ASSISTANT_TARGET_CONTEXTS: Readonly<
  Record<string, AssistantTargetContext>
> = deepFreeze(
  Object.fromEntries(
    [
      ...STATION_FALLBACK_TARGETS,
      ...ATTENTION_COMPONENT_TARGETS,
      ...EMBEDDING_COMPONENT_TARGETS,
      ...MLP_COMPONENT_TARGETS,
      ...LOSS_COMPONENT_TARGETS,
      ...MHA_COMPONENT_TARGETS,
      ...HEAD_RECOMBINATION_COMPONENT_TARGETS,
      ...LOGITS_COMPONENT_TARGETS,
    ].map((target) => [target.id, target]),
  ),
);

function anchor(
  preferredSide: AssistantAnchorSide,
  standOffDistance = 2.2,
  verticalOffset = 0.45,
): AssistantTargetWorldMetadata["anchor"] {
  return {
    preferredSide,
    standOffDistance,
    verticalOffset,
    lookAt: "target-bounds-center",
    pointAt: "target-bounds-center",
  };
}

function worldMetadata(
  targetId: string,
  stationId: string,
  canonicalObjectName: string,
  exactObjectNames: readonly string[],
  containsTokenSets: readonly (readonly string[])[],
  presentationAnchor: AssistantTargetWorldMetadata["anchor"],
): AssistantTargetWorldMetadata {
  return {
    targetId,
    stationId,
    matching: {
      canonicalObjectName,
      exactObjectNames: [canonicalObjectName, ...exactObjectNames],
      containsTokenSets,
    },
    anchor: presentationAnchor,
  };
}

const STATION_WORLD_METADATA: readonly AssistantTargetWorldMetadata[] =
  STATION_FALLBACK_TARGETS.map((target) => {
    const index = ASSISTANT_STATION_CONTEXTS[target.stationId].index;
    const stationGroupName = `station-${String(index).padStart(2, "0")}-${target.stationId}`;
    return worldMetadata(
      target.id,
      target.stationId,
      stationGroupName,
      [`station-${target.stationId}`, target.stationId],
      [],
      anchor("player-right", 2.8, 0.7),
    );
  });

/**
 * Canonical names below are the contract for future raycastable scene groups.
 * Existing unnamed meshes safely fall back to their named station ancestor.
 */
const ATTENTION_WORLD_METADATA: readonly AssistantTargetWorldMetadata[] = [
  worldMetadata("attention:qkv-overview", "one-head-qkv", "assistant-target-qkv-overview", ["qkv-lanes"], [["qkv", "overview"]], anchor("player-right", 2.8, 0.7)),
  worldMetadata("attention:query", "one-head-qkv", "assistant-target-qkv-query", ["query", "query-lane", "q-lane"], [["query", "lane"]], anchor("target-right")),
  worldMetadata("attention:keys", "one-head-qkv", "assistant-target-qkv-keys", ["key", "keys", "key-lane", "k-lane"], [["key", "lane"]], anchor("target-right")),
  worldMetadata("attention:values", "one-head-qkv", "assistant-target-qkv-values", ["value", "values", "value-lane", "v-lane"], [["value", "lane"]], anchor("target-left")),
  worldMetadata("attention:score-matrix", "attention-scores", "assistant-target-attention-score-matrix", ["attention-score-grid", "score-matrix"], [["score", "matrix"]], anchor("target-right", 2.8, 1.0)),
  worldMetadata("attention:selected-score-row", "attention-scores", "assistant-target-attention-score-row-2", ["selected-score-row", "score-row-2"], [["score", "row", "2"]], anchor("target-right", 2.2, 0.3)),
  worldMetadata("attention:selected-score-cell", "attention-scores", "assistant-target-attention-score-cell-q2-k0", ["selected-score-cell", "score-cell-q2-k0"], [["score", "cell", "q2", "k0"]], anchor("target-right", 1.8, 0.25)),
  worldMetadata("attention:causal-mask", "causal-mask", "assistant-target-causal-mask-matrix", ["causal-mask-matrix", "triangular-mask"], [["causal", "mask", "matrix"]], anchor("target-right", 2.8, 1.0)),
  worldMetadata("attention:allowed-mask-region", "causal-mask", "assistant-target-causal-mask-allowed", ["allowed-mask-region", "mask-lower-triangle"], [["mask", "allowed"]], anchor("target-right", 2.2, 0.45)),
  worldMetadata("attention:future-mask-region", "causal-mask", "assistant-target-causal-mask-future", ["future-mask-region", "mask-upper-triangle"], [["mask", "future"]], anchor("target-left", 2.2, 0.45)),
  worldMetadata("attention:softmax-row", "softmax-weighted-v", "assistant-target-softmax-row", ["selected-softmax-row", "softmax-row"], [["softmax", "row"]], anchor("target-right", 2.3, 0.7)),
  worldMetadata("attention:attention-weights", "softmax-weighted-v", "assistant-target-attention-weight-bars", ["attention-weight-bars", "weight-valves"], [["attention", "weight"], ["weight", "valve"]], anchor("target-right", 2.4, 0.7)),
  worldMetadata("attention:value-vectors", "softmax-weighted-v", "assistant-target-weighted-value-streams", ["weighted-value-streams", "value-streams"], [["value", "stream"]], anchor("target-left", 2.3, 0.4)),
  worldMetadata("attention:weighted-value-output", "softmax-weighted-v", "assistant-target-weighted-value-output", ["weighted-head-output", "head-output"], [["weighted", "output"], ["head", "output"]], anchor("target-right", 2.0, 0.4)),
];

const EMBEDDING_WORLD_METADATA: readonly AssistantTargetWorldMetadata[] = [
  worldMetadata("embedding:token-table", "embedding", "assistant-target-embedding-token-table", ["token-table", "E-table"], [["token", "table"]], anchor("target-left", 2.6, 0.8)),
  worldMetadata("embedding:position-table", "embedding", "assistant-target-embedding-position-table", ["position-table", "P-table"], [["position", "table"]], anchor("target-right", 2.6, 0.8)),
  worldMetadata("embedding:token-address", "embedding", "assistant-target-embedding-token-address", ["token-address", "token-id-ticket"], [["token", "address"]], anchor("target-left", 2.0, 0.3)),
  worldMetadata("embedding:position-address", "embedding", "assistant-target-embedding-position-address", ["position-address", "position-ticket"], [["position", "address"]], anchor("target-right", 2.0, 0.3)),
  worldMetadata("embedding:selected-token-row", "embedding", "assistant-target-embedding-selected-token-row", ["token-row", "E-row"], [["token", "row"]], anchor("target-left", 2.2, 0.4)),
  worldMetadata("embedding:selected-position-row", "embedding", "assistant-target-embedding-selected-position-row", ["position-row", "P-row"], [["position", "row"]], anchor("target-right", 2.2, 0.4)),
  worldMetadata("embedding:sum-result", "embedding", "assistant-target-embedding-sum-result", ["sum-result", "H0-selected-row"], [["sum", "result"]], anchor("target-front", 2.4, 0.5)),
  worldMetadata("embedding:hidden-state-output", "embedding", "assistant-target-embedding-hidden-state-output", ["hidden-state-output", "H0-output"], [["hidden", "state", "output"]], anchor("target-front", 2.8, 0.9)),
];

const MLP_WORLD_METADATA: readonly AssistantTargetWorldMetadata[] = [
  worldMetadata("mlp:token-lanes", "mlp", "assistant-target-mlp-token-lanes", ["token-lanes"], [["token", "lanes"]], anchor("target-front", 3.0, 1.0)),
  worldMetadata("mlp:selected-input", "mlp", "assistant-target-mlp-selected-input", ["selected-input", "u-vector"], [["selected", "input"]], anchor("target-front", 2.2, 0.4)),
  worldMetadata("mlp:layer-norm-gate", "mlp", "assistant-target-mlp-layer-norm-gate", ["ln2-gate", "layer-norm-gate"], [["ln2"]], anchor("target-front", 2.0, 0.4)),
  worldMetadata("mlp:normalized-input", "mlp", "assistant-target-mlp-normalized-input", ["normalized-input", "ln2-output"], [["normalized", "input"]], anchor("target-front", 2.0, 0.4)),
  worldMetadata("mlp:up-projection", "mlp", "assistant-target-mlp-up-projection", ["w-up", "up-projection-wall", "up-bias"], [["up", "projection"]], anchor("target-front", 2.8, 0.6)),
  worldMetadata("mlp:gelu-activation", "mlp", "assistant-target-mlp-gelu-activation", ["gelu-units", "gelu"], [["gelu"]], anchor("target-front", 2.6, 0.6)),
  worldMetadata("mlp:down-projection", "mlp", "assistant-target-mlp-down-projection", ["w-down", "down-projection-wall", "down-bias"], [["down", "projection"]], anchor("target-front", 2.8, 0.6)),
  worldMetadata("mlp:output", "mlp", "assistant-target-mlp-output", ["mlp-output", "f-vector"], [["mlp", "output"]], anchor("target-right", 2.2, 0.4)),
  worldMetadata("mlp:residual-bypass", "mlp", "assistant-target-mlp-residual-bypass", ["residual-bypass", "bypass-u"], [["residual", "bypass"]], anchor("target-left", 2.2, 0.4)),
  worldMetadata("mlp:block-output", "mlp", "assistant-target-mlp-block-output", ["block-output", "h-prime"], [["block", "output"]], anchor("target-front", 2.4, 0.5)),
];

const LOSS_WORLD_METADATA: readonly AssistantTargetWorldMetadata[] = [
  worldMetadata("loss:correct-probabilities", "loss", "assistant-target-loss-correct-probabilities", ["p-correct-board", "correct-probabilities"], [["correct", "probabilities"]], anchor("target-left", 2.6, 0.7)),
  worldMetadata("loss:token-penalties", "loss", "assistant-target-loss-token-penalties", ["token-penalties", "negative-log-loss-board"], [["token", "penalties"]], anchor("target-right", 2.6, 0.7)),
  worldMetadata("loss:selected-lane", "loss", "assistant-target-loss-selected-lane", ["selected-lane", "worked-example"], [["selected", "lane"]], anchor("target-front", 2.2, 0.5)),
  worldMetadata("loss:cross-entropy-gates", "loss", "assistant-target-loss-cross-entropy-gates", ["ln-gates", "penalty-hoops"], [["ln", "gates"]], anchor("target-front", 2.4, 0.3)),
  worldMetadata("loss:averaging", "loss", "assistant-target-loss-averaging", ["averaging-funnel", "sum-and-divide"], [["averaging"]], anchor("target-front", 2.6, 0.6)),
  worldMetadata("loss:scalar-loss", "loss", "assistant-target-loss-scalar-loss", ["scalar-loss", "l-value"], [["scalar", "loss"]], anchor("target-right", 2.0, 0.5)),
];

const MHA_WORLD_METADATA: readonly AssistantTargetWorldMetadata[] = [
  worldMetadata("mha:normalized-input", "multi-head-attention", "assistant-target-mha-normalized-input", ["n-board"], [["normalized", "input"]], anchor("target-front", 2.6, 0.6)),
  worldMetadata("mha:query-projection", "multi-head-attention", "assistant-target-mha-query-projection", ["wq-wall"], [["query", "projection"]], anchor("target-left", 2.4, 0.5)),
  worldMetadata("mha:key-projection", "multi-head-attention", "assistant-target-mha-key-projection", ["wk-wall"], [["key", "projection"]], anchor("target-front", 2.4, 0.5)),
  worldMetadata("mha:value-projection", "multi-head-attention", "assistant-target-mha-value-projection", ["wv-wall"], [["value", "projection"]], anchor("target-right", 2.4, 0.5)),
  worldMetadata("mha:projected-query", "multi-head-attention", "assistant-target-mha-projected-query", ["q2-projected"], [["q2", "projected"]], anchor("target-left", 2.0, 0.4)),
  worldMetadata("mha:projected-key", "multi-head-attention", "assistant-target-mha-projected-key", ["k2-projected"], [["k2", "projected"]], anchor("target-front", 2.0, 0.4)),
  worldMetadata("mha:projected-value", "multi-head-attention", "assistant-target-mha-projected-value", ["v2-projected"], [["v2", "projected"]], anchor("target-right", 2.0, 0.4)),
  worldMetadata("mha:head-split", "multi-head-attention", "assistant-target-mha-head-split", ["reshape-unzip"], [["reshape"], ["unzip"]], anchor("target-front", 2.4, 0.5)),
  worldMetadata("mha:head-0", "multi-head-attention", "assistant-target-mha-head-0", ["head-0-board"], [["head", "0"]], anchor("target-left", 2.4, 0.5)),
  worldMetadata("mha:head-1", "multi-head-attention", "assistant-target-mha-head-1", ["head-1-board"], [["head", "1"]], anchor("target-right", 2.4, 0.5)),
];

const HEAD_RECOMBINATION_WORLD_METADATA: readonly AssistantTargetWorldMetadata[] = [
  worldMetadata("recombine:head-zero-output", "head-recombination", "assistant-target-recombine-head-zero-output", ["head-0-output"], [["head", "0", "output"]], anchor("target-left", 2.2, 0.5)),
  worldMetadata("recombine:head-one-output", "head-recombination", "assistant-target-recombine-head-one-output", ["head-1-output"], [["head", "1", "output"]], anchor("target-right", 2.2, 0.5)),
  worldMetadata("recombine:concatenation", "head-recombination", "assistant-target-recombine-concatenation", ["concat-board"], [["concat"]], anchor("target-front", 2.4, 0.5)),
  worldMetadata("recombine:output-projection", "head-recombination", "assistant-target-recombine-output-projection", ["wo-wall"], [["output", "projection"]], anchor("target-front", 2.6, 0.6)),
  worldMetadata("recombine:projected-output", "head-recombination", "assistant-target-recombine-projected-output", ["attention-output"], [["attention", "output"]], anchor("target-front", 2.2, 0.5)),
  worldMetadata("recombine:residual-bypass", "head-recombination", "assistant-target-recombine-residual-bypass", ["untouched-h"], [["residual", "bypass"]], anchor("target-left", 2.2, 0.4)),
  worldMetadata("recombine:block-output", "head-recombination", "assistant-target-recombine-block-output", ["u-result"], [["block", "output"]], anchor("target-right", 2.2, 0.5)),
];

const LOGITS_WORLD_METADATA: readonly AssistantTargetWorldMetadata[] = [
  worldMetadata("logits:raw-logits", "logits", "assistant-target-logits-raw-logits", ["raw-logits-board"], [["raw", "logits"]], anchor("target-left", 2.6, 0.7)),
  worldMetadata("logits:softmax-operation", "logits", "assistant-target-logits-softmax-operation", ["exp-ring", "softmax-gate"], [["softmax", "operation"]], anchor("target-front", 2.4, 0.5)),
  worldMetadata("logits:probabilities", "logits", "assistant-target-logits-probabilities", ["probability-board"], [["probabilities"]], anchor("target-right", 2.6, 0.7)),
  worldMetadata("logits:distribution-bars", "logits", "assistant-target-logits-distribution-bars", ["logit-bars", "vocabulary-ring"], [["distribution", "bars"]], anchor("target-front", 3.2, 0.9)),
];

export const ASSISTANT_TARGET_WORLD_METADATA: Readonly<
  Record<string, AssistantTargetWorldMetadata>
> = deepFreeze(
  Object.fromEntries(
    [
      ...STATION_WORLD_METADATA,
      ...ATTENTION_WORLD_METADATA,
      ...EMBEDDING_WORLD_METADATA,
      ...MLP_WORLD_METADATA,
      ...LOSS_WORLD_METADATA,
      ...MHA_WORLD_METADATA,
      ...HEAD_RECOMBINATION_WORLD_METADATA,
      ...LOGITS_WORLD_METADATA,
    ].map((metadata) => [metadata.targetId, metadata]),
  ),
);

function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isStationGroupName(name: string): boolean {
  return /^station-\d{2}-/.test(name) || /^opaque-chamber-\d{2}$/.test(name);
}

export function resolveAssistantStationId(
  stationId?: string | null,
  objectAncestryNames: readonly (string | null | undefined)[] = [],
): string | undefined {
  if (stationId && ASSISTANT_STATION_CONTEXTS[stationId]) {
    return stationId;
  }

  const names = objectAncestryNames
    .filter((name): name is string => Boolean(name))
    .map(normalizeName);

  for (const station of TRAINING_STATIONS) {
    const stationName = normalizeName(station.id);
    const indexName = `station-${String(
      ASSISTANT_STATION_CONTEXTS[station.id].index,
    ).padStart(2, "0")}-${stationName}`;
    if (
      names.some(
        (name) =>
          name === stationName ||
          name === indexName ||
          name === `station-${stationName}`,
      )
    ) {
      return station.id;
    }
  }
  return undefined;
}

function componentMatchScore(
  metadata: AssistantTargetWorldMetadata,
  objectName: string,
): number {
  const normalized = normalizeName(objectName);
  const canonical = normalizeName(metadata.matching.canonicalObjectName);
  if (normalized === canonical) return 1_000;

  if (
    metadata.matching.exactObjectNames.some(
      (name) => normalized === normalizeName(name),
    )
  ) {
    return 800;
  }

  const tokenSet = metadata.matching.containsTokenSets.find((tokens) =>
    tokens.every((token) => {
      const normalizedToken = normalizeName(token);
      return normalized.split("-").includes(normalizedToken);
    }),
  );
  return tokenSet ? 400 + tokenSet.length : 0;
}

export function resolveAssistantTarget(
  input: ResolveAssistantTargetInput,
): AssistantTargetResolution {
  const names = (input.objectAncestryNames ?? []).filter(
    (name): name is string => Boolean(name),
  );
  const resolvedStationId =
    resolveAssistantStationId(input.stationId, names) ??
    TRAINING_STATIONS[0].id;
  const station = ASSISTANT_STATION_CONTEXTS[resolvedStationId];

  if (input.explicitTargetId) {
    const explicitTarget = ASSISTANT_TARGET_CONTEXTS[input.explicitTargetId];
    if (explicitTarget && explicitTarget.stationId === resolvedStationId) {
      return {
        station,
        target: explicitTarget,
        world: ASSISTANT_TARGET_WORLD_METADATA[explicitTarget.id],
        source: "explicit-target",
      };
    }
  }

  const semanticNames = names.filter(
    (name) => !isStationGroupName(normalizeName(name)),
  );
  let best:
    | {
        target: AssistantTargetContext;
        world: AssistantTargetWorldMetadata;
        score: number;
        matchedObjectName: string;
      }
    | undefined;

  Object.values(ASSISTANT_TARGET_WORLD_METADATA)
    .filter(
      (metadata) =>
        metadata.stationId === resolvedStationId &&
        ASSISTANT_TARGET_CONTEXTS[metadata.targetId].kind === "component",
    )
    .forEach((metadata) => {
      semanticNames.forEach((name) => {
        const score = componentMatchScore(metadata, name);
        if (score > 0 && (!best || score > best.score)) {
          best = {
            target: ASSISTANT_TARGET_CONTEXTS[metadata.targetId],
            world: metadata,
            score,
            matchedObjectName: name,
          };
        }
      });
    });

  if (best) {
    return {
      station,
      target: best.target,
      world: best.world,
      source: "semantic-object-name",
      matchedObjectName: best.matchedObjectName,
    };
  }

  const fallbackTarget = ASSISTANT_TARGET_CONTEXTS[
    `station:${resolvedStationId}`
  ];
  return {
    station,
    target: fallbackTarget,
    world: ASSISTANT_TARGET_WORLD_METADATA[fallbackTarget.id],
    source: resolvedStationId === input.stationId
      ? "station-fallback"
      : "world-fallback",
  };
}

/**
 * Captures target, chamber, branch, mode, and visible values at speech start.
 * The returned graph is recursively frozen, including a clone of visibleState,
 * so later gaze or animation changes cannot alter what "this" means mid-turn.
 */
export function buildAssistantTurnContextSnapshot(
  input: BuildAssistantTurnContextInput,
): AssistantTurnContextSnapshot {
  const resolution = resolveAssistantTarget(input);
  const branchSide = input.branchSide ?? resolution.station.branch?.default;
  const branch =
    branchSide && resolution.station.branch
      ? {
          side: branchSide,
          label: resolution.station.branch[branchSide],
          ...(resolution.target.branchRelevance?.[branchSide]
            ? {
                targetRelevance:
                  resolution.target.branchRelevance[branchSide],
              }
            : {}),
        }
      : undefined;

  return deepFreeze({
    schemaVersion: 1 as const,
    tutorInstructions: SESSION_TUTOR_INSTRUCTIONS,
    process: GENERAL_PROCESS_OVERVIEW,
    station: resolution.station,
    target: resolution.target,
    view: {
      detailMode: input.detailMode,
      detailFocus: resolution.target.explanationByMode[input.detailMode],
      ...(branch ? { branch } : {}),
    },
    visibleState: cloneVisibleState(input.visibleState),
    groundingRules: [
      "The target in this snapshot was frozen when the user began the turn; do not silently switch referents if their gaze later moves.",
      "Prefer exactValues and visibleState for claims about the selected trace; do not derive or invent unseen animation values.",
      "Use relatedTargetIds only as conceptual links. Their full records are not present unless the application supplies them.",
      "If visibleState conflicts with a general description, describe the observed state and flag the discrepancy instead of guessing.",
    ],
  });
}
