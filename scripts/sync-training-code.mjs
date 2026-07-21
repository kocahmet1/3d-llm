import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const trainerRoot = path.join(projectRoot, "trainer", "src", "chamber_trainer");
const outputPath = path.join(projectRoot, "app", "lib", "generatedTrainingCode.ts");

const STATIONS = [
  ["training-complex", "The runnable entry point connects data, model, loss, backward, and AdamW into one repeated training process."],
  ["corpus-data-preparation", "Real documents are read, encoded into token IDs, split into train/validation data, and written to disk-backed token files."],
  ["token-stream-context", "The batcher selects source windows of T + 1 consecutive IDs without loading the whole corpus onto the accelerator."],
  ["batch-shifted-targets", "These two slices create the model inputs and their one-token-ahead answers."],
  ["embedding", "Embedding lookup and learned positional vectors create the first hidden-state tensor."],
  ["transformer-tower", "Every Transformer block consumes the previous hidden states in sequence."],
  ["transformer-block", "This is the actual pre-normalized residual block used by the trainer."],
  ["multi-head-attention", "Three learned projections create Q, K, and V, then reshape them into independently computed heads."],
  ["one-head-qkv", "Each head receives its own projected query, key, and value feature lanes."],
  ["attention-scores", "The query-key matrix product produces scaled compatibility scores."],
  ["causal-mask", "Future positions are filled with negative infinity before normalization."],
  ["softmax-weighted-v", "Softmax turns each permitted score row into weights that blend the value vectors."],
  ["head-recombination", "The head outputs are transposed, concatenated, and passed through the output projection."],
  ["mlp", "The position-wise feed-forward path expands, activates, projects back, and applies dropout."],
  ["final-hidden-state", "A final normalization produces the contextual hidden states used for vocabulary prediction."],
  ["vocabulary-projection", "The language-model head maps every hidden vector to one score per vocabulary token."],
  ["logits", "Training keeps these scores as raw logits; cross-entropy performs the stable normalization internally."],
  ["target-comparison", "Flattened logits and target IDs stay aligned so every position is compared with its own next token."],
  ["loss", "PyTorch computes mean cross-entropy over all supervised batch positions."],
  ["output-backprop", "This is the researcher-written call that starts reverse-mode differentiation from the loss."],
  ["backprop-through-tower", "Autograd follows the recorded graph through the output head, final norm, blocks, and embeddings; researchers do not hand-code each derivative."],
  ["parameter-matrix", "Autograd has populated each parameter tensor's .grad field, including W_Q; the trainer now checks and clips their global norm before any weight changes."],
  ["adamw-state", "AdamW owns first- and second-moment state for each trainable parameter and updates it on every optimizer step."],
  ["weight-update", "The optimizer step applies the computed update; AMP uses a scaler wrapper while full precision calls AdamW directly."],
  ["model-changed-next-step", "Gradients are cleared after the update, state can be saved, and the loop advances to a fresh batch."],
];

const expectedIds = new Set(STATIONS.map(([id]) => id));
const notes = new Map(STATIONS);
const markerPattern = /^\s*# chamber:([a-z0-9-]+):(start|end)\s*$/;

async function collectPythonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (![".venv", "__pycache__", "build", "dist"].includes(entry.name)) {
        files.push(...(await collectPythonFiles(absolute)));
      }
    } else if (entry.isFile() && entry.name.endsWith(".py")) {
      files.push(absolute);
    }
  }
  return files.sort();
}

function nearestSymbol(lines, markerIndex) {
  for (let index = markerIndex + 1; index < Math.min(lines.length, markerIndex + 5); index += 1) {
    const match = /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[index]);
    if (match) return match[1];
    if (lines[index].trim() !== "" && !lines[index].trimStart().startsWith("#")) break;
  }
  for (let index = markerIndex - 1; index >= 0; index -= 1) {
    const match = /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[index]);
    if (match) return match[1];
  }
  return "module";
}

function dedent(lines) {
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines.at(-1).trim() === "") lines.pop();
  const indents = lines
    .filter((line) => line.trim() !== "")
    .map((line) => /^\s*/.exec(line)?.[0].length ?? 0);
  const width = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(width)).join("\n");
}

async function extractMarkers() {
  const blocks = new Map();
  const active = new Map();
  for (const absolute of await collectPythonFiles(trainerRoot)) {
    const source = await readFile(absolute, "utf8");
    const lines = source.replaceAll("\r\n", "\n").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const marker = markerPattern.exec(lines[index]);
      if (marker) {
        const [, id, action] = marker;
        if (action === "start") {
          assert(!blocks.has(id) && !active.has(id), `Duplicate chamber marker: ${id}`);
          active.set(id, {
            stationId: id,
            file: path.relative(projectRoot, absolute).replaceAll("\\", "/"),
            symbol: nearestSymbol(lines, index),
            lines: [],
          });
        } else {
          const block = active.get(id);
          assert(block, `End marker without start: ${id}`);
          active.delete(id);
          blocks.set(id, { ...block, code: dedent(block.lines) });
        }
        continue;
      }
      for (const block of active.values()) block.lines.push(lines[index]);
    }
  }
  assert.equal(active.size, 0, `Unclosed chamber markers: ${[...active.keys()].join(", ")}`);
  return blocks;
}

function serialize(excerpt) {
  return `  ${JSON.stringify(excerpt, null, 2).replaceAll("\n", "\n  ")}`;
}

async function main() {
  const blocks = await extractMarkers();
  const unexpected = [...blocks.keys()].filter(
    (id) => id !== "full-training-loop" && !expectedIds.has(id),
  );
  assert.deepEqual(unexpected, [], `Unexpected chamber markers: ${unexpected.join(", ")}`);
  for (const id of expectedIds) assert(blocks.has(id), `Missing chamber marker: ${id}`);
  assert(blocks.has("full-training-loop"), "Missing chamber marker: full-training-loop");

  const excerpts = STATIONS.map(([stationId]) => {
    const block = blocks.get(stationId);
    assert(block.code.trim().length > 0, `Empty chamber excerpt: ${stationId}`);
    return {
      stationId,
      file: block.file,
      symbol: block.symbol,
      code: block.code,
      note: notes.get(stationId),
    };
  });
  const full = blocks.get("full-training-loop");
  const fullLoop = {
    stationId: "full-training-loop",
    file: full.file,
    symbol: full.symbol,
    code: full.code,
    note: "This is the continuous optimizer loop behind the excerpts. It executes the same operations, while the exhibit's selected decimal values remain a separate controlled trace.",
  };
  const generated = `// Generated by scripts/sync-training-code.mjs from runnable Python source.\n// Do not edit this file by hand.\n\nexport interface TrainingCodeExcerpt {\n  stationId: string;\n  file: string;\n  symbol: string;\n  code: string;\n  note: string;\n}\n\nexport const TRAINING_CODE_EXCERPTS = [\n${excerpts.map(serialize).join(",\n")}\n] as const satisfies ReadonlyArray<TrainingCodeExcerpt>;\n\nexport const FULL_TRAINING_LOOP = ${JSON.stringify(fullLoop, null, 2)} as const satisfies TrainingCodeExcerpt;\n`;

  if (process.argv.includes("--check")) {
    const current = await readFile(outputPath, "utf8").catch(() => "");
    assert.equal(current, generated, "Generated training excerpts are out of date; run npm run code:sync");
    return;
  }
  await writeFile(outputPath, generated, "utf8");
}

await main();
