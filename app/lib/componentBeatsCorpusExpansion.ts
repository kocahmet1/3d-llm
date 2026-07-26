import type { ChamberProcessBeat } from "./componentProcesses";

const stationId = "corpus-data-preparation";

function beat(
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

export const CORPUS_EXPANSION_PROCESS_BEATS = [
  beat(
    "ingest-source",
    "Ingest the raw source strings",
    0,
    0.2,
    "Collected text must enter a deterministic preprocessing pipeline before it can be tokenized.",
    "The two raw documents are aligned with the cleaning station.",
    ["corpus:source-text", "corpus:cleaning-scanner"],
  ),
  beat(
    "normalize",
    "Normalize case and whitespace",
    0.11,
    0.32,
    "Formatting variation would otherwise create inconsistent tokenizer inputs for equivalent text.",
    "Each raw document becomes one lowercase, whitespace-normalized string.",
    [
      "corpus:source-text",
      "corpus:cleaning-scanner",
      "corpus:normalized-text",
    ],
    ["corpus-cleaning-flow"],
  ),
  beat(
    "split-and-insert",
    "Split pieces and insert boundaries",
    0.28,
    0.49,
    "The tokenizer needs discrete pieces, and the loader needs explicit sequence-boundary symbols.",
    "Two ordered seven-piece rows are ready for vocabulary lookup.",
    [
      "corpus:normalized-text",
      "corpus:token-pieces",
      "corpus:special-token-injector",
    ],
    ["corpus-special-injection-flow"],
  ),
  beat(
    "lookup",
    "Look up each vocabulary address",
    0.42,
    0.84,
    "The neural-network input pipeline accepts integer token addresses rather than text symbols.",
    "Every ordinary or special piece resolves to one ID in the fixed sixteen-entry vocabulary.",
    [
      "corpus:token-pieces",
      "corpus:special-token-injector",
      "corpus:vocabulary",
      "corpus:token-id-matrix",
    ],
    ["corpus-lookup-flow"],
  ),
  beat(
    "materialize-matrix",
    "Materialize the source ID matrix",
    0.78,
    0.94,
    "The individual lookup results must preserve their example row and sequence position.",
    "The completed source matrix S has shape two by seven.",
    ["corpus:vocabulary", "corpus:token-id-matrix"],
  ),
  beat(
    "handoff",
    "Hand the matrix to window slicing",
    0.88,
    0.99,
    "Training examples require aligned input and next-token target slices from each source row.",
    "The window-ready matrix continues to the context-window chamber.",
    ["corpus:token-id-matrix", "corpus:ready-source-matrix"],
  ),
] satisfies readonly ChamberProcessBeat[];
