import type {
  AssistantTargetContext,
  AssistantTargetWorldMetadata,
} from "./assistantContext";
import { DATA_PREP_TRACE, SELECTED_TRACE } from "./trainingTrace";

const stationId = "corpus-data-preparation";
const sourceByteCounts = DATA_PREP_TRACE.sources.map(
  ({ raw }) => new TextEncoder().encode(raw).length,
);
const totalSourceBytes = sourceByteCounts.reduce(
  (total, byteCount) => total + byteCount,
  0,
);

function worldMetadata(
  targetId: string,
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
      verticalOffset: 0.45,
      lookAt: "target-bounds-center",
      pointAt: "target-bounds-center",
    },
  };
}

export const CORPUS_EXPANSION_COMPONENT_TARGETS: readonly AssistantTargetContext[] = [
  {
    id: "corpus:source-text",
    stationId,
    kind: "component",
    label: "Raw source-text panels",
    aliases: ["source text", "raw corpus", "documents"],
    summary:
      "Two deliberately messy source snippets stand in for the heterogeneous books, web text, code, and dialogue that enter a real preprocessing pipeline.",
    role:
      "They are the immutable input examples for this teaching trace; cleaning reads them but does not teach the neural network to interpret raw characters.",
    inputs: ["A book/web-text snippet", "A code/dialogue snippet"],
    operation:
      "Present the raw text exactly as collected, including capitalization, repeated spaces, and line breaks.",
    outputs: ["Two source strings passed to deterministic normalization"],
    shape: "2 source documents · 49 UTF-8 bytes in this teaching corpus",
    exactValues: {
      rawSources: DATA_PREP_TRACE.sources.map((source) => source.raw),
      sourceKinds: DATA_PREP_TRACE.sources.map((source) => source.kind),
      sourceByteCounts,
      totalSourceBytes,
    },
    whyItMatters:
      "A model can only learn from examples produced by its data pipeline, so preprocessing choices determine what evidence reaches training.",
    commonMisconceptions: [
      "These two snippets illustrate a pipeline; they are not a production-scale corpus.",
      "The raw characters have not entered the Transformer yet.",
    ],
    relatedTargetIds: [
      "corpus:cleaning-scanner",
      "corpus:normalized-text",
    ],
    explanationByMode: {
      story:
        "This is the unprocessed material arriving at the factory: useful text mixed with formatting variation.",
      structure:
        "Two independent document strings occupy separate panels and remain separate through cleaning.",
      math:
        "At this point the values are strings, not tensors; there is no learned matrix operation.",
      code:
        "raw_documents = [book_web_text, code_dialogue]",
    },
  },
  {
    id: "corpus:cleaning-scanner",
    stationId,
    kind: "component",
    label: "Deterministic cleaning scanner",
    aliases: ["cleaner", "normalizer", "scan line"],
    summary:
      "The cyan scanner visualizes deterministic lowercasing and whitespace normalization before tokenization.",
    role:
      "It removes superficial formatting variation so equivalent text is presented consistently to the tokenizer.",
    inputs: ["The two raw source strings"],
    operation:
      "Lowercase the text, collapse repeated whitespace, and flatten the shown line breaks into spaces.",
    outputs: ["Two normalized strings"],
    formula: "clean(s) = collapse_whitespace(lowercase(s))",
    exactValues: {
      sourceCount: DATA_PREP_TRACE.sources.length,
      normalizedSources: DATA_PREP_TRACE.sources.map((source) => source.clean),
    },
    whyItMatters:
      "Consistent normalization prevents accidental vocabulary fragmentation caused only by formatting differences.",
    commonMisconceptions: [
      "The scanner is not a learned neural-network layer.",
      "Cleaning is not semantic reasoning; it follows explicit preprocessing rules.",
    ],
    relatedTargetIds: ["corpus:source-text", "corpus:normalized-text"],
    explanationByMode: {
      story:
        "The scanner tidies presentation differences without changing the intended words.",
      structure:
        "A deterministic preprocessing function maps each source string to one cleaned string.",
      math:
        "The mapping is symbolic and rule-based, so it has no trainable parameters or gradients.",
      code:
        "clean = ' '.join(raw.lower().split())",
    },
  },
  {
    id: "corpus:normalized-text",
    stationId,
    kind: "component",
    label: "Normalized-text panels",
    aliases: ["clean text", "normalized documents"],
    summary:
      "These panels contain the exact cleaned strings that the tokenizer receives.",
    role:
      "They are the boundary between text normalization and token-piece construction.",
    inputs: ["Output of the deterministic cleaning scanner"],
    operation: "Hold one normalized string per source document.",
    outputs: ["Clean strings ready to split into vocabulary pieces"],
    exactValues: {
      cleanedSources: DATA_PREP_TRACE.sources.map((source) => source.clean),
    },
    whyItMatters:
      "The tokenizer operates on these strings, so this is the last human-readable representation before token IDs are created.",
    commonMisconceptions: [
      "Normalized text is still text, not an embedding or activation tensor.",
      "Lowercasing here is a choice of this teaching pipeline, not a universal requirement.",
    ],
    relatedTargetIds: [
      "corpus:cleaning-scanner",
      "corpus:token-pieces",
    ],
    explanationByMode: {
      story:
        "The cleaned sentences are the tidy copies handed from the cleaning station to the tokenizer.",
      structure:
        "Two strings remain document-aligned and feed two seven-piece source rows.",
      math:
        "No numeric model shape exists yet; the next operation converts symbols to discrete addresses.",
      code:
        "clean_documents = [normalize(document) for document in raw_documents]",
    },
  },
  {
    id: "corpus:token-pieces",
    stationId,
    kind: "component",
    label: "Token-piece rows",
    aliases: ["pieces", "split tokens", "token rows"],
    summary:
      "The cleaned strings are split into the exact seven-piece rows used by the trace, including loader-inserted boundary symbols.",
    role:
      "They define the discrete symbol sequence that will be looked up in the fixed teaching vocabulary.",
    inputs: [
      "Two normalized strings",
      "Boundary symbols supplied by the data loader",
    ],
    operation:
      "Split the teaching strings on spaces and insert <bos> or <eos> where the displayed loader policy requires them.",
    outputs: ["Two rows of seven token pieces"],
    shape: "pieces [2,7]",
    exactValues: {
      tokenPieces: DATA_PREP_TRACE.tokens,
    },
    whyItMatters:
      "Token boundaries determine which discrete units receive IDs and, later, learned embedding rows.",
    commonMisconceptions: [
      "A token piece is not yet a vector.",
      "<bos> and <eos> are inserted control symbols, not words recovered from the source text.",
    ],
    relatedTargetIds: [
      "corpus:normalized-text",
      "corpus:special-token-injector",
      "corpus:vocabulary",
    ],
    explanationByMode: {
      story:
        "The tokenizer cuts each cleaned sentence into labeled tiles and the loader adds boundary tiles.",
      structure:
        "Two independent rows each contain seven pieces, preserving document boundaries in this trace.",
      math:
        "The result is a categorical array with shape [2,7], not a floating-point tensor.",
      code:
        "pieces = add_special_tokens(clean_text.split())",
    },
  },
  {
    id: "corpus:special-token-injector",
    stationId,
    kind: "component",
    label: "Special-token injector",
    aliases: ["BOS injector", "EOS injector", "boundary-token loader"],
    summary:
      "The gold injector supplies <bos> and <eos> boundary symbols that are absent from the literal source strings.",
    role:
      "It marks sequence boundaries according to the data-loader policy before vocabulary lookup.",
    inputs: ["Token-piece rows", "The loader's boundary policy"],
    operation:
      "Insert the appropriate boundary token into the displayed seven-piece rows.",
    outputs: ["Rows containing ordinary pieces plus <bos> or <eos>"],
    formula: "pieces' = insert_boundaries(pieces, policy)",
    exactValues: {
      insertedSymbols: ["<bos>", "<eos>"],
      firstRow: DATA_PREP_TRACE.tokens[0],
      secondRow: DATA_PREP_TRACE.tokens[1],
    },
    whyItMatters:
      "Boundary tokens let later stages represent where a sequence begins or a document ends.",
    commonMisconceptions: [
      "The special symbols are not copied from the raw text.",
      "The injector is data-loader logic, not a learned part of the model.",
    ],
    relatedTargetIds: ["corpus:token-pieces", "corpus:vocabulary"],
    explanationByMode: {
      story:
        "This loader places explicit start and end markers onto the token conveyor.",
      structure:
        "Special symbols occupy ordinary token slots after insertion and receive vocabulary IDs like other pieces.",
      math:
        "Insertion changes the categorical sequence; it does not add numeric vectors.",
      code:
        "pieces = ['<bos>', *pieces]  # or append '<eos>' per loader policy",
    },
  },
  {
    id: "corpus:vocabulary",
    stationId,
    kind: "component",
    label: "Fixed tokenizer vocabulary",
    aliases: ["vocabulary table", "piece-to-ID map", "token dictionary"],
    summary:
      "This fixed sixteen-entry table maps every displayed token piece to one integer address.",
    role:
      "It converts symbols into stable discrete IDs that the model can use to select embedding rows later.",
    inputs: ["Ordinary and special token pieces"],
    operation: "Look up each exact piece in the tokenizer's piece-to-ID table.",
    outputs: ["One integer token ID per piece"],
    formula: "id = vocab[piece]",
    shape: "16 fixed vocabulary entries",
    exactValues: {
      vocabulary: SELECTED_TRACE.vocabulary,
      vocabularySize: SELECTED_TRACE.vocabulary.length,
    },
    whyItMatters:
      "The vocabulary is the shared contract between text preprocessing and the model's input/output dimensions.",
    commonMisconceptions: [
      "Vocabulary IDs are addresses, not measures of semantic similarity.",
      "This tokenizer table is fixed during the illustrated training step; it is not the learned embedding matrix.",
    ],
    relatedTargetIds: [
      "corpus:token-pieces",
      "corpus:special-token-injector",
      "corpus:token-id-matrix",
    ],
    explanationByMode: {
      story:
        "Each labeled tile finds its numbered drawer in a fixed dictionary.",
      structure:
        "A one-to-one mapping covers all sixteen pieces used by the teaching model.",
      math:
        "vocab maps a categorical symbol to an integer in [0,15].",
      code:
        "token_id = vocabulary[piece]",
    },
  },
  {
    id: "corpus:token-id-matrix",
    stationId,
    kind: "component",
    label: "Source token-ID matrix",
    aliases: ["ID matrix", "source matrix S", "integer token rows"],
    summary:
      "The lookup results fill the exact two-by-seven integer matrix S used to create context windows.",
    role:
      "It packages the tokenized source rows into a compact numeric artifact while preserving row and position order.",
    inputs: ["Fourteen vocabulary lookup results"],
    operation:
      "Write each token ID into the matrix cell matching its source row and sequence position.",
    outputs: ["S with shape [2,7]"],
    formula: "S[b,t] = vocab[piece[b,t]]",
    shape: "S [2,7]",
    exactValues: {
      tokenIds: DATA_PREP_TRACE.tokenIds,
      rows: 2,
      columns: 7,
    },
    whyItMatters:
      "All later tensor operations begin from ordered integer IDs, not from raw strings.",
    commonMisconceptions: [
      "The integers are categorical addresses; ID 12 is not intrinsically larger or more important than ID 3.",
      "The matrix contains no learned parameters.",
    ],
    relatedTargetIds: ["corpus:vocabulary", "corpus:ready-source-matrix"],
    explanationByMode: {
      story:
        "Every token tile deposits its dictionary address into the matching cell of a two-row tray.",
      structure:
        "Rows preserve the two examples and columns preserve the seven source positions.",
      math:
        "S∈{0,…,15}^{2×7}; its entries index the later embedding table.",
      code:
        "source_ids[b, t] = vocabulary[token_pieces[b][t]]",
    },
  },
  {
    id: "corpus:ready-source-matrix",
    stationId,
    kind: "component",
    label: "Window-ready source matrix",
    aliases: ["ready matrix", "tokenized corpus output", "S ready"],
    summary:
      "The completed S matrix is handed to the next chamber, where each seven-token row becomes a six-input/six-target training example.",
    role:
      "It is the final output boundary of preprocessing and the input to context-window slicing.",
    inputs: ["Completed source token-ID matrix S[2,7]"],
    operation:
      "Validate that both rows are complete and expose them to the window sampler.",
    outputs: ["Two source windows of length T+1=7"],
    formula: "S[2,7] → X=S[:,:-1], Y=S[:,1:]",
    shape: "[2,7] ready for slicing into X and Y",
    exactValues: {
      readyRows: DATA_PREP_TRACE.tokenIds,
      nextInputShape: [2, 6],
      nextTargetShape: [2, 6],
    },
    whyItMatters:
      "This handoff cleanly separates data preparation from the neural-network forward pass.",
    commonMisconceptions: [
      "Being ready for windows does not mean the model has made a prediction.",
      "The next chamber slices IDs; it does not retokenize the text.",
    ],
    relatedTargetIds: [
      "corpus:token-id-matrix",
      "station:token-stream-context",
    ],
    explanationByMode: {
      story:
        "The completed numbered tray is cleared to leave preprocessing and enter the training-example pipeline.",
      structure:
        "Two length-seven rows will each supply six aligned inputs and six next-token targets.",
      math:
        "Dropping the final column yields X[2,6]; dropping the first yields Y[2,6].",
      code:
        "x, y = source_ids[:, :-1], source_ids[:, 1:]",
    },
  },
];

export const CORPUS_EXPANSION_WORLD_METADATA: readonly AssistantTargetWorldMetadata[] = [
  worldMetadata(
    "corpus:source-text",
    "assistant-target-corpus-source-text",
    ["source-panels"],
    [["source", "text"]],
    "player-left",
  ),
  worldMetadata(
    "corpus:cleaning-scanner",
    "assistant-target-corpus-cleaning-scanner",
    ["cleaning-scanner"],
    [["clean", "scanner"]],
  ),
  worldMetadata(
    "corpus:normalized-text",
    "assistant-target-corpus-normalized-text",
    ["clean-panels"],
    [["normalized", "text"]],
  ),
  worldMetadata(
    "corpus:token-pieces",
    "assistant-target-corpus-token-pieces",
    ["piece-boards"],
    [["token", "pieces"]],
  ),
  worldMetadata(
    "corpus:special-token-injector",
    "assistant-target-corpus-special-token-injector",
    ["special-token-injector"],
    [["special", "token"]],
  ),
  worldMetadata(
    "corpus:vocabulary",
    "assistant-target-corpus-vocabulary",
    ["vocabulary-board"],
    [["vocabulary"]],
  ),
  worldMetadata(
    "corpus:token-id-matrix",
    "assistant-target-corpus-token-id-matrix",
    ["source-id-matrix"],
    [["token", "id", "matrix"]],
  ),
  worldMetadata(
    "corpus:ready-source-matrix",
    "assistant-target-corpus-ready-source-matrix",
    ["ready-source-matrix"],
    [["ready", "matrix"]],
    "player-right",
  ),
];
