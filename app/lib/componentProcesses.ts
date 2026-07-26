import {
  ASSISTANT_TARGET_CONTEXTS,
  ASSISTANT_TARGET_WORLD_METADATA,
  type AssistantComponentProcessBeat,
  type AssistantComponentProcessContext,
  type AssistantComponentProcessPartner,
  type AssistantTargetContext,
  type AssistantTurnContextSnapshot,
} from "./assistantContext";
import { CORPUS_EXPANSION_PROCESS_BEATS } from "./componentBeatsCorpusExpansion";
import { EARLY_EXPANSION_PROCESS_BEATS } from "./componentBeatsEarlyExpansion";
import { FORWARD_EXPANSION_PROCESS_BEATS } from "./componentBeatsForwardExpansion";
import { LEARNING_EXPANSION_PROCESS_BEATS } from "./componentBeatsLearningExpansion";

export interface ChamberProcessBeat {
  id: string;
  stationId: string;
  label: string;
  startProgress: number;
  endProgress: number;
  cause: string;
  result: string;
  /** Semantic participants, not Three.js object names. */
  targetIds: readonly string[];
  /**
   * Scene-only keys for moving packets, routes, or gates that make this beat
   * legible but are not themselves voice-guide components.
   */
  auxiliarySceneKeys: readonly string[];
}

/**
 * A component replay is a view onto an existing deterministic chamber
 * animation. The canvas remaps a short local clock into this range instead of
 * owning a second set of animation keyframes.
 */
export interface ComponentProcessPlayback {
  startProgress: number;
  endProgress: number;
  durationSeconds: number;
  loop: "restart";
  source: "authored-beats" | "derived-window";
}

export type ComponentProcessPartner = AssistantComponentProcessPartner;
export type ComponentProcessNarrativeBeat = AssistantComponentProcessBeat;
export type ComponentProcessNarrative = AssistantComponentProcessContext;

export interface ComponentProcessDefinition {
  targetId: string;
  stationId: string;
  label: string;
  beatIds: readonly string[];
  playback: ComponentProcessPlayback;
  /**
   * Semantic scene targets cloned onto the replay stage. The selected target
   * is always first; the others share one or more authored beats with it.
   */
  participantTargetIds: readonly string[];
  /** Scene-only animated actors cloned alongside the semantic participants. */
  auxiliarySceneKeys: readonly string[];
  narrative: Omit<ComponentProcessNarrative, "status">;
}

export type AssistantTurnContextWithComponentProcess =
  AssistantTurnContextSnapshot;

function beat(
  stationId: string,
  id: string,
  label: string,
  startProgress: number,
  endProgress: number,
  cause: string,
  result: string,
  targetIds: readonly string[],
  auxiliarySceneKeys: readonly string[] = [],
): ChamberProcessBeat {
  return {
    id: `${stationId}:${id}`,
    stationId,
    label,
    startProgress,
    endProgress,
    cause,
    result,
    targetIds,
    auxiliarySceneKeys,
  };
}

/**
 * Four to six causal beats describe a chamber once. Every component clip and
 * partner set is derived from beat membership, so adding more components does
 * not require authoring more Three.js animations.
 */
export const CHAMBER_PROCESS_BEATS: readonly ChamberProcessBeat[] = [
  beat(
    "embedding",
    "token-lookup",
    "Select the token row",
    0.03,
    0.38,
    "A token ID arrives as an address into the learned token table.",
    "The selected token row becomes a moving activation vector.",
    [
      "embedding:token-table",
      "embedding:token-address",
      "embedding:selected-token-row",
    ],
  ),
  beat(
    "embedding",
    "position-lookup",
    "Select the position row",
    0.1,
    0.5,
    "The token's sequence position addresses the learned position table.",
    "A position vector aligned with that token is selected.",
    [
      "embedding:position-table",
      "embedding:position-address",
      "embedding:selected-position-row",
    ],
  ),
  beat(
    "embedding",
    "align-and-add",
    "Align and add both vectors",
    0.36,
    0.82,
    "Token identity and sequence position must coexist in one model-width vector.",
    "Elementwise addition produces the selected hidden-state row.",
    [
      "embedding:selected-token-row",
      "embedding:selected-position-row",
      "embedding:sum-result",
    ],
  ),
  beat(
    "embedding",
    "emit-hidden-state",
    "Emit the hidden-state tensor",
    0.68,
    0.99,
    "Every batch-position pair has completed the same lookup-and-add operation.",
    "The complete H0 tensor continues into the Transformer tower.",
    ["embedding:sum-result", "embedding:hidden-state-output"],
  ),

  beat(
    "multi-head-attention",
    "normalize",
    "Normalize the block input",
    0.02,
    0.3,
    "Attention projections receive the pre-normalized residual stream.",
    "One normalized input feeds all three learned projection matrices.",
    [
      "mha:normalized-input",
      "mha:query-projection",
      "mha:key-projection",
      "mha:value-projection",
    ],
    [
      "mha-query-projection-flow",
      "mha-key-projection-flow",
      "mha-value-projection-flow",
    ],
  ),
  beat(
    "multi-head-attention",
    "project-query",
    "Project queries",
    0.08,
    0.58,
    "The normalized hidden state needs a learned query representation.",
    "Multiplication by W_Q creates the projected query vector.",
    [
      "mha:normalized-input",
      "mha:query-projection",
      "mha:projected-query",
    ],
    ["mha-query-projection-flow"],
  ),
  beat(
    "multi-head-attention",
    "project-key",
    "Project keys",
    0.08,
    0.58,
    "The normalized hidden state needs learned addresses that queries can match.",
    "Multiplication by W_K creates the projected key vector.",
    [
      "mha:normalized-input",
      "mha:key-projection",
      "mha:projected-key",
    ],
    ["mha-key-projection-flow"],
  ),
  beat(
    "multi-head-attention",
    "project-value",
    "Project values",
    0.08,
    0.58,
    "Attention needs learned payload vectors to route after matching.",
    "Multiplication by W_V creates the projected value vector.",
    [
      "mha:normalized-input",
      "mha:value-projection",
      "mha:projected-value",
    ],
    ["mha-value-projection-flow"],
  ),
  beat(
    "multi-head-attention",
    "split-heads",
    "Reshape into heads",
    0.5,
    0.88,
    "The model-width projections must be partitioned into independent feature subspaces.",
    "Q, K, and V are reshaped into head 0 and head 1 lanes.",
    [
      "mha:projected-query",
      "mha:projected-key",
      "mha:projected-value",
      "mha:head-split",
      "mha:head-0",
      "mha:head-1",
    ],
    ["mha-head-split-flow"],
  ),
  beat(
    "multi-head-attention",
    "emit-heads",
    "Send both heads onward",
    0.7,
    0.99,
    "Each head now owns its query, key, and value feature lanes.",
    "Both head tensors continue into per-head attention.",
    ["mha:head-split", "mha:head-0", "mha:head-1"],
    ["mha-head-split-flow"],
  ),

  beat(
    "one-head-qkv",
    "match-query-and-keys",
    "Match the query against keys",
    0.04,
    0.72,
    "The selected query needs compatibility scores for allowed source positions.",
    "Query-key comparisons are ready for the score matrix.",
    [
      "attention:qkv-overview",
      "attention:query",
      "attention:keys",
    ],
  ),
  beat(
    "one-head-qkv",
    "carry-values",
    "Carry the value payloads",
    0.28,
    0.94,
    "Matched positions must also provide information that attention can blend.",
    "The value vectors remain aligned with their keys.",
    ["attention:qkv-overview", "attention:keys", "attention:values"],
  ),
  beat(
    "one-head-qkv",
    "emit-qkv",
    "Emit the head's Q, K, and V lanes",
    0.62,
    0.99,
    "All three projections are ready for their distinct downstream roles.",
    "Q and K continue to scoring while V continues to weighted blending.",
    [
      "attention:qkv-overview",
      "attention:query",
      "attention:keys",
      "attention:values",
    ],
  ),

  beat(
    "attention-scores",
    "form-matrix",
    "Form the score matrix",
    0.04,
    0.58,
    "Every query position is compared with every key position in this head.",
    "Scaled compatibility values fill the attention score matrix.",
    ["attention:score-matrix", "attention:selected-score-row"],
  ),
  beat(
    "attention-scores",
    "inspect-row",
    "Inspect the selected query row",
    0.16,
    0.82,
    "One query position owns one row of key-compatibility scores.",
    "The selected row exposes each query-to-key comparison.",
    [
      "attention:score-matrix",
      "attention:selected-score-row",
      "attention:selected-score-cell",
    ],
  ),
  beat(
    "attention-scores",
    "emit-scores",
    "Send scores to masking",
    0.54,
    0.99,
    "The compatibility scores must be constrained before normalization.",
    "The completed score matrix continues to the causal mask.",
    [
      "attention:score-matrix",
      "attention:selected-score-row",
      "attention:selected-score-cell",
    ],
  ),

  beat(
    "causal-mask",
    "overlay-mask",
    "Overlay the causal rule",
    0.04,
    0.46,
    "Decoder positions may use the present and past but not future tokens.",
    "The triangular mask aligns with the score matrix.",
    [
      "attention:causal-mask",
      "attention:allowed-mask-region",
      "attention:future-mask-region",
    ],
  ),
  beat(
    "causal-mask",
    "block-future",
    "Block future positions",
    0.24,
    0.76,
    "Future-token scores would leak answers during next-token training.",
    "Disallowed cells become negative infinity before softmax.",
    ["attention:causal-mask", "attention:future-mask-region"],
  ),
  beat(
    "causal-mask",
    "preserve-history",
    "Preserve present and past",
    0.46,
    0.99,
    "Allowed history must remain available to the selected query.",
    "The lower-triangular score region continues to softmax.",
    ["attention:causal-mask", "attention:allowed-mask-region"],
  ),

  beat(
    "softmax-weighted-v",
    "normalize-row",
    "Normalize the allowed score row",
    0.03,
    0.52,
    "Allowed compatibility scores need nonnegative weights that sum to one.",
    "Softmax produces the selected attention-weight row.",
    ["attention:softmax-row", "attention:attention-weights"],
  ),
  beat(
    "softmax-weighted-v",
    "weight-values",
    "Weight each value vector",
    0.14,
    0.78,
    "Each allowed source position contributes in proportion to its attention weight.",
    "Every value vector is scaled by its matching weight.",
    [
      "attention:attention-weights",
      "attention:value-vectors",
      "attention:weighted-value-output",
    ],
  ),
  beat(
    "softmax-weighted-v",
    "sum-values",
    "Sum the weighted values",
    0.5,
    0.99,
    "The head needs one contextual payload for the selected query.",
    "The weighted value vectors sum into the head output.",
    [
      "attention:attention-weights",
      "attention:value-vectors",
      "attention:weighted-value-output",
    ],
  ),

  beat(
    "head-recombination",
    "receive-heads",
    "Receive both head outputs",
    0.02,
    0.4,
    "The independently computed attention heads must return to model width.",
    "Head 0 and head 1 outputs align for concatenation.",
    [
      "recombine:head-zero-output",
      "recombine:head-one-output",
      "recombine:concatenation",
    ],
  ),
  beat(
    "head-recombination",
    "concatenate",
    "Concatenate feature lanes",
    0.2,
    0.6,
    "Head features are complementary lanes, not values to add together.",
    "Concatenation reconstructs one model-width vector.",
    [
      "recombine:head-zero-output",
      "recombine:head-one-output",
      "recombine:concatenation",
    ],
  ),
  beat(
    "head-recombination",
    "output-project",
    "Apply the output projection",
    0.38,
    0.78,
    "Concatenated head features need to be mixed back into the residual stream's basis.",
    "W_O produces the multi-head attention output.",
    [
      "recombine:concatenation",
      "recombine:output-projection",
      "recombine:projected-output",
    ],
  ),
  beat(
    "head-recombination",
    "residual-add",
    "Add the residual path",
    0.56,
    0.94,
    "The block preserves its input while adding the attention update.",
    "Projected attention plus the untouched residual produces U.",
    [
      "recombine:projected-output",
      "recombine:residual-bypass",
      "recombine:block-output",
    ],
  ),
  beat(
    "head-recombination",
    "emit-block-state",
    "Emit the attention sublayer state",
    0.76,
    0.99,
    "The attention residual merge is complete.",
    "U continues into the MLP sublayer.",
    ["recombine:projected-output", "recombine:block-output"],
  ),

  beat(
    "mlp",
    "select-and-normalize",
    "Select and normalize a token lane",
    0.02,
    0.36,
    "Each position enters the feed-forward path independently after the attention residual.",
    "LayerNorm2 produces the selected normalized input.",
    [
      "mlp:token-lanes",
      "mlp:selected-input",
      "mlp:layer-norm-gate",
      "mlp:normalized-input",
    ],
  ),
  beat(
    "mlp",
    "expand",
    "Expand to feed-forward width",
    0.22,
    0.6,
    "The MLP needs a wider feature space for nonlinear combinations.",
    "The up projection maps model width 8 to feed-forward width 32.",
    ["mlp:normalized-input", "mlp:up-projection", "mlp:gelu-activation"],
  ),
  beat(
    "mlp",
    "activate",
    "Apply GELU",
    0.4,
    0.74,
    "A nonlinear gate lets the MLP express more than one linear transform.",
    "GELU selectively reshapes the expanded activations.",
    ["mlp:up-projection", "mlp:gelu-activation", "mlp:down-projection"],
  ),
  beat(
    "mlp",
    "contract",
    "Project back to model width",
    0.54,
    0.88,
    "The expanded features must return to the residual stream's width.",
    "The down projection produces the MLP output F.",
    ["mlp:gelu-activation", "mlp:down-projection", "mlp:output"],
  ),
  beat(
    "mlp",
    "residual-route",
    "Carry the residual bypass",
    0.08,
    0.92,
    "The original attention-sublayer state must remain available for the residual merge.",
    "U bypasses the nonlinear branch unchanged.",
    ["mlp:selected-input", "mlp:residual-bypass", "mlp:block-output"],
  ),
  beat(
    "mlp",
    "residual-add",
    "Add the MLP update",
    0.72,
    0.99,
    "The block combines preserved state with the position-wise MLP result.",
    "U plus F produces the block output H-prime.",
    ["mlp:output", "mlp:residual-bypass", "mlp:block-output"],
  ),

  beat(
    "logits",
    "receive-logits",
    "Receive raw vocabulary scores",
    0.02,
    0.34,
    "The vocabulary projection emits one unnormalized score per token.",
    "The selected raw-logit row enters the probability demonstration.",
    ["logits:raw-logits", "logits:softmax-operation"],
  ),
  beat(
    "logits",
    "normalize",
    "Demonstrate stable softmax",
    0.14,
    0.62,
    "Raw logits are not probabilities and need stable normalization for interpretation.",
    "Exponentiation and division produce a probability distribution.",
    [
      "logits:raw-logits",
      "logits:softmax-operation",
      "logits:probabilities",
    ],
  ),
  beat(
    "logits",
    "display-distribution",
    "Display the vocabulary distribution",
    0.4,
    0.84,
    "Each vocabulary token needs its corresponding probability shown.",
    "Probability bars expose the full normalized distribution.",
    ["logits:probabilities", "logits:distribution-bars"],
  ),
  beat(
    "logits",
    "emit-probabilities",
    "Send the selected distribution onward",
    0.64,
    0.99,
    "The correct target token must be compared with its predicted probability.",
    "The distribution continues to target comparison and loss.",
    ["logits:probabilities", "logits:distribution-bars"],
  ),

  beat(
    "loss",
    "receive-correct-probabilities",
    "Receive correct-token probabilities",
    0.02,
    0.36,
    "Each supervised position selects the probability assigned to its target token.",
    "Twelve correct-token probabilities line up with their training positions.",
    ["loss:correct-probabilities", "loss:selected-lane"],
  ),
  beat(
    "loss",
    "convert-to-penalties",
    "Convert confidence to penalties",
    0.16,
    0.62,
    "Low probability on the correct token should incur a larger cost.",
    "Negative log transforms each correct-token probability into a token loss.",
    [
      "loss:correct-probabilities",
      "loss:selected-lane",
      "loss:cross-entropy-gates",
      "loss:token-penalties",
    ],
  ),
  beat(
    "loss",
    "collect-penalties",
    "Collect all token penalties",
    0.38,
    0.82,
    "The training step needs one objective covering every supervised position.",
    "All twelve token penalties enter the averaging funnel.",
    [
      "loss:token-penalties",
      "loss:cross-entropy-gates",
      "loss:averaging",
    ],
  ),
  beat(
    "loss",
    "average",
    "Average into one scalar",
    0.58,
    0.94,
    "Backpropagation starts from one scalar objective.",
    "Summing and dividing by twelve produces the mean cross-entropy loss.",
    ["loss:token-penalties", "loss:averaging", "loss:scalar-loss"],
  ),
  beat(
    "loss",
    "emit-loss",
    "Emit the scalar loss",
    0.78,
    0.99,
    "The completed forward-pass objective is ready to seed reverse-mode differentiation.",
    "The scalar loss continues to output backpropagation.",
    ["loss:averaging", "loss:scalar-loss"],
  ),
  ...CORPUS_EXPANSION_PROCESS_BEATS,
  ...EARLY_EXPANSION_PROCESS_BEATS,
  ...FORWARD_EXPANSION_PROCESS_BEATS,
  ...LEARNING_EXPANSION_PROCESS_BEATS,
] as const;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach((child) => {
      deepFreeze(child);
    });
    Object.freeze(value);
  }
  return value;
}

const componentTargets = Object.values(ASSISTANT_TARGET_CONTEXTS).filter(
  (target): target is AssistantTargetContext => target.kind === "component",
);
const componentsByStation = new Map<string, AssistantTargetContext[]>();
for (const target of componentTargets) {
  const stationTargets = componentsByStation.get(target.stationId) ?? [];
  stationTargets.push(target);
  componentsByStation.set(target.stationId, stationTargets);
}

const beatsByTarget = new Map<string, ChamberProcessBeat[]>();
for (const processBeat of CHAMBER_PROCESS_BEATS) {
  for (const targetId of processBeat.targetIds) {
    const targetBeats = beatsByTarget.get(targetId) ?? [];
    targetBeats.push(processBeat);
    beatsByTarget.set(targetId, targetBeats);
  }
}

function derivedWindow(target: AssistantTargetContext) {
  const peers = componentsByStation.get(target.stationId) ?? [target];
  const index = Math.max(0, peers.findIndex((peer) => peer.id === target.id));
  const center = (index + 0.5) / Math.max(1, peers.length);
  const halfWidth = Math.max(0.14, 0.75 / Math.max(2, peers.length));
  return {
    startProgress: Math.max(0.02, center - halfWidth),
    endProgress: Math.min(0.99, center + halfWidth),
  };
}

function participantTargetIds(
  target: AssistantTargetContext,
  targetBeats: readonly ChamberProcessBeat[],
) {
  const coOccurrences = new Map<string, number>();
  for (const processBeat of targetBeats) {
    for (const candidateId of processBeat.targetIds) {
      if (candidateId === target.id) continue;
      const candidate = ASSISTANT_TARGET_CONTEXTS[candidateId];
      if (
        candidate?.kind !== "component" ||
        candidate.stationId !== target.stationId ||
        !ASSISTANT_TARGET_WORLD_METADATA[candidateId]
      ) {
        continue;
      }
      coOccurrences.set(
        candidateId,
        (coOccurrences.get(candidateId) ?? 0) + 1,
      );
    }
  }
  // The context registry's related targets are curated causal neighbours, so
  // they outrank mere co-occurrence. Keep every eligible curated neighbour:
  // symmetric operations such as Q/K/V fan-out or a two-head split must not
  // silently lose one branch to an arbitrary presentation cap.
  const partners = target.relatedTargetIds.filter((targetId) =>
    coOccurrences.has(targetId),
  );
  // Do not manufacture a partner when the registry has no same-chamber causal
  // neighbour. A truthful single-component replay is preferable to staging a
  // merely adjacent overview deck or parallel lane as though it interacted.
  return [target.id, ...partners];
}

function makeDefinition(
  target: AssistantTargetContext,
): ComponentProcessDefinition {
  const targetBeats = beatsByTarget.get(target.id) ?? [];
  const authored = targetBeats.length > 0;
  const derived = derivedWindow(target);
  const startProgress = authored
    ? Math.min(...targetBeats.map((processBeat) => processBeat.startProgress))
    : derived.startProgress;
  const endProgress = authored
    ? Math.max(...targetBeats.map((processBeat) => processBeat.endProgress))
    : derived.endProgress;
  const span = endProgress - startProgress;
  const participants = participantTargetIds(target, targetBeats);
  const auxiliarySceneKeys = [
    ...new Set(
      targetBeats.flatMap((processBeat) => processBeat.auxiliarySceneKeys),
    ),
  ];
  const interactionPartners = participants
    .slice(1)
    .map((targetId) => ASSISTANT_TARGET_CONTEXTS[targetId])
    .filter((partner): partner is AssistantTargetContext => Boolean(partner))
    .map((partner) => ({
      targetId: partner.id,
      label: partner.label,
      role: partner.role,
    }));
  const narrativeBeats = targetBeats.map((processBeat) => ({
    id: processBeat.id,
    label: processBeat.label,
    cause: processBeat.cause,
    result: processBeat.result,
  }));

  return {
    targetId: target.id,
    stationId: target.stationId,
    label: target.label,
    beatIds: targetBeats.map((processBeat) => processBeat.id),
    playback: {
      startProgress,
      endProgress,
      durationSeconds: Math.min(7.5, Math.max(3.5, span * 12)),
      loop: "restart",
      source: authored ? "authored-beats" : "derived-window",
    },
    participantTargetIds: participants,
    auxiliarySceneKeys,
    narrative: {
      selectedComponent: target.label,
      chamberRole: target.role,
      startsBecause: [...target.inputs],
      interactionCause:
        narrativeBeats.map((processBeat) => processBeat.cause).join(" ") ||
        target.operation,
      interactionPartners,
      beats: narrativeBeats,
      sequence:
        narrativeBeats.length > 0
          ? narrativeBeats.map(
              (processBeat) =>
                `${processBeat.label}: ${processBeat.cause} Result: ${processBeat.result}`,
            )
          : [
              `Inputs arrive: ${target.inputs.join("; ")}`,
              `${target.label} acts: ${target.operation}`,
              `The result continues as: ${target.outputs.join("; ")}`,
            ],
      produces: [...target.outputs],
      whyItMatters: target.whyItMatters,
      visualGrounding: [
        "The normal chamber timeline is paused while this replay is active.",
        authored
          ? "The replay is derived from the authored chamber beats that include this component."
          : "This component is using a provisional derived window until its chamber beats are authored.",
        "The selected component, its curated same-beat interaction partners, and any bound moving process actors are staged; unrelated chamber objects are omitted.",
        "The slice restarts for inspection; each restart is not an additional model computation.",
      ],
    },
  };
}

export const COMPONENT_PROCESS_DEFINITIONS: Readonly<
  Record<string, ComponentProcessDefinition>
> = deepFreeze(
  Object.fromEntries(
    componentTargets.map((target) => [target.id, makeDefinition(target)]),
  ),
);

export function resolveComponentProcessDefinition(
  targetId?: string | null,
): ComponentProcessDefinition | null {
  if (!targetId) return null;
  return COMPONENT_PROCESS_DEFINITIONS[targetId] ?? null;
}

/**
 * Maps elapsed replay time into the selected slice of the chamber timeline.
 * Reduced-motion mode holds the most informative midpoint instead of looping.
 */
export function componentProcessProgressAt(
  definition: ComponentProcessDefinition,
  elapsedSeconds: number,
  motionEnabled = true,
) {
  const { startProgress, endProgress, durationSeconds } = definition.playback;
  if (!motionEnabled) return (startProgress + endProgress) / 2;
  const safeDuration = Math.max(0.001, durationSeconds);
  const normalized =
    ((Math.max(0, elapsedSeconds) % safeDuration) + safeDuration) %
    safeDuration;
  return (
    startProgress +
    (normalized / safeDuration) * (endProgress - startProgress)
  );
}

export function attachComponentProcessContext(
  snapshot: AssistantTurnContextSnapshot,
  targetId: string | null | undefined,
  status: ComponentProcessNarrative["status"],
): AssistantTurnContextWithComponentProcess {
  const definition = resolveComponentProcessDefinition(targetId);
  if (!definition) return snapshot;
  return deepFreeze({
    ...snapshot,
    componentProcess: {
      status,
      ...definition.narrative,
    },
  });
}
