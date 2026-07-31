import * as THREE from "three";

import {
  BLOCK_MATRIX_COMPARISON,
  DATA_PREP_TRACE,
  PRODUCTION_SCALE_REFERENCES,
  SELECTED_TRACE,
  TEACHING_MODEL,
  TEACHING_MODEL_PARAMETERS,
} from "../../lib/trainingTrace";
import { createNeonFrame } from "./processShared";
import type {
  ChamberProcessContext,
  ChamberProcessUpdater,
} from "./processShared";

/**
 * The orientation gallery.
 *
 * Every other chamber is a walk through one step of the computation. This one
 * is a briefing, because a visitor arriving from the machine room does not yet
 * know what is being trained, on what text, or at what size — and those facts
 * have no spatial shape. Laying them out along a runway like a computation
 * produced a crowded room where every exhibit competed for one sightline.
 *
 * So the room is an exhibition hall instead: eight lit placards in bays that
 * alternate down the gallery, each turned square-on to a viewing mark, and a
 * guided walk that takes the visitor to each in turn. The angle is what makes
 * it work — from any mark the placard being read fills about three quarters of
 * the view while its neighbours are steeply oblique. `.qa/verify-gallery-tour.mjs`
 * checks exactly that, stop by stop.
 *
 * Placard faces are drawn as full canvas compositions rather than assembled
 * from value boards, because a page wants typography and diagrams — a gold
 * speck inside GPT-2's weight matrix says more about scale than any label.
 * Every figure comes from `trainingTrace.ts`, so the gallery cannot drift from
 * the model it describes.
 */

const INK = "rgba(244, 251, 255, 0.97)";
const DIM_INK = "rgba(186, 212, 232, 0.82)";
const FAINT_INK = "rgba(150, 178, 200, 0.7)";
const CYAN = "#47d7ff";
const BLUE = "#76a9ff";
const VIOLET = "#b59cff";
const GREEN = "#69efb6";
const GOLD = "#ffd166";
const MAGENTA = "#ff70d5";

/** Slide canvas resolution: 16:9, sharp enough to fill most of the view. */
const SLIDE_W = 1024;
const SLIDE_H = 576;
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

function withThousands(value: number) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "870 million", "9,216", "60 thousand" — readable magnitudes for captions. */
function approximately(value: number) {
  if (value >= 1e9) return `${withThousands(value / 1e9)} billion`;
  if (value >= 1e6) return `${withThousands(value / 1e6)} million`;
  if (value >= 1e4) return `${withThousands(value / 1e3)} thousand`;
  return withThousands(value);
}

type Paint = CanvasRenderingContext2D;

/**
 * Greedy word wrap. The layout audit runs the builders against a stubbed
 * canvas whose `measureText` always returns the same width, so this is capped
 * by word count rather than trusting measurement to terminate the loop.
 */
function wrapText(paint: Paint, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    const width = paint.measureText(candidate)?.width ?? 0;
    if (line && width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function slideBackdrop(paint: Paint, accent: string) {
  const backdrop = paint.createLinearGradient(0, 0, 0, SLIDE_H);
  backdrop.addColorStop(0, "rgba(9, 18, 32, 0.99)");
  backdrop.addColorStop(0.55, "rgba(4, 10, 20, 0.99)");
  backdrop.addColorStop(1, "rgba(6, 13, 24, 0.99)");
  paint.fillStyle = backdrop;
  paint.fillRect(0, 0, SLIDE_W, SLIDE_H);
  // A single accent hairline under the title keeps the deck feeling authored
  // rather than like a stack of unrelated boards.
  paint.fillStyle = accent;
  paint.globalAlpha = 0.55;
  paint.fillRect(64, 104, 150, 3);
  paint.globalAlpha = 1;
}

function drawTitle(paint: Paint, title: string, kicker: string) {
  paint.textAlign = "left";
  paint.textBaseline = "alphabetic";
  paint.fillStyle = FAINT_INK;
  paint.font = `700 17px ${MONO}`;
  paint.fillText(kicker, 64, 52, SLIDE_W - 200);
  paint.fillStyle = INK;
  paint.font = `800 37px ${MONO}`;
  paint.fillText(title, 64, 92, SLIDE_W - 128);
}

function drawFooter(paint: Paint, text: string, index: number, count: number) {
  paint.textAlign = "left";
  paint.fillStyle = FAINT_INK;
  paint.font = `700 16px ${MONO}`;
  paint.fillText(text, 64, SLIDE_H - 30, SLIDE_W - 220);
  paint.textAlign = "right";
  paint.fillText(`${index + 1} / ${count}`, SLIDE_W - 64, SLIDE_H - 30);
}

function drawBody(
  paint: Paint,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size = 21,
  color = DIM_INK,
) {
  paint.textAlign = "left";
  paint.fillStyle = color;
  paint.font = `600 ${size}px ${MONO}`;
  const lines = wrapText(paint, text, maxWidth);
  lines.forEach((line, index) => {
    paint.fillText(line, x, y + index * (size * 1.5), maxWidth);
  });
  return y + lines.length * (size * 1.5);
}

/** A labelled figure: big number, small caption under it. */
function drawStat(
  paint: Paint,
  x: number,
  y: number,
  value: string,
  caption: string,
  color: string,
  size = 40,
) {
  paint.textAlign = "left";
  paint.fillStyle = color;
  paint.font = `800 ${size}px ${MONO}`;
  paint.fillText(value, x, y, SLIDE_W - x - 48);
  paint.fillStyle = FAINT_INK;
  paint.font = `700 15px ${MONO}`;
  paint.fillText(caption, x, y + 24, SLIDE_W - x - 48);
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

const gpt2 = PRODUCTION_SCALE_REFERENCES.gpt2Small;
const gpt3 = PRODUCTION_SCALE_REFERENCES.gpt3;
const P = TEACHING_MODEL_PARAMETERS;
const M = BLOCK_MATRIX_COMPARISON;

const CORPUS_BYTES =
  DATA_PREP_TRACE.sources.reduce((sum, source) => sum + source.clean.length, 0) +
  (DATA_PREP_TRACE.sources.length - 1);
const CORPUS_WORDS = DATA_PREP_TRACE.sources.reduce(
  (sum, source) => sum + source.clean.split(" ").length,
  0,
);

/** Slide 1 — what this whole place is. */
function paintWelcome(paint: Paint, index: number, count: number) {
  slideBackdrop(paint, CYAN);
  drawTitle(paint, "INSIDE ONE TRAINING STEP", "WELCOME");
  const afterIntro = drawBody(
    paint,
    "You are standing inside a language model. Everything past this room is one single training step: the model reads text, guesses the next word, measures how wrong it was, and adjusts itself once.",
    64,
    166,
    SLIDE_W - 128,
    22,
  );
  drawBody(
    paint,
    "Real training repeats that step millions of times. You are about to walk through it once, slowly.",
    64,
    afterIntro + 24,
    SLIDE_W - 128,
    22,
    "rgba(215, 236, 250, 0.9)",
  );

  // The five phases as a strip, so the deck previews the shape of the journey.
  const phases = ["PREPARE", "PREDICT", "MEASURE", "TRACE", "ADJUST"];
  const colors = [BLUE, CYAN, GOLD, "#ff765f", GREEN];
  const boxW = 152;
  const gap = 20;
  const startX = (SLIDE_W - (phases.length * boxW + (phases.length - 1) * gap)) / 2;
  phases.forEach((phase, phaseIndex) => {
    const x = startX + phaseIndex * (boxW + gap);
    paint.fillStyle = colors[phaseIndex];
    paint.globalAlpha = 0.16;
    paint.fillRect(x, 372, boxW, 54);
    paint.globalAlpha = 1;
    paint.strokeStyle = colors[phaseIndex];
    paint.lineWidth = 2;
    paint.strokeRect(x, 372, boxW, 54);
    paint.textAlign = "center";
    paint.fillStyle = INK;
    paint.font = `800 19px ${MONO}`;
    paint.fillText(phase, x + boxW / 2, 406, boxW - 16);
    if (phaseIndex < phases.length - 1) {
      paint.fillStyle = FAINT_INK;
      paint.font = `700 20px ${MONO}`;
      paint.fillText(">", x + boxW + gap / 2, 406);
    }
  });

  drawFooter(paint, "Turn the dial, or press space, to continue", index, count);
}

/** Slide 2 — the two exact sentences, given the whole screen. */
function paintCorpus(paint: Paint, index: number, count: number) {
  slideBackdrop(paint, GOLD);
  drawTitle(paint, "THIS IS THE ENTIRE TRAINING SET", "THE DATA");

  const sentences = DATA_PREP_TRACE.sources.map((source) => source.clean);
  sentences.forEach((sentence, sentenceIndex) => {
    const y = 196 + sentenceIndex * 108;
    const accent = sentenceIndex === 0 ? CYAN : BLUE;
    paint.fillStyle = accent;
    paint.globalAlpha = 0.1;
    paint.fillRect(64, y - 46, SLIDE_W - 128, 76);
    paint.globalAlpha = 1;
    paint.fillStyle = accent;
    paint.fillRect(64, y - 46, 5, 76);
    paint.textAlign = "left";
    paint.fillStyle = INK;
    paint.font = `800 33px ${MONO}`;
    paint.fillText(`"${sentence}"`, 92, y, SLIDE_W - 250);
    paint.fillStyle = FAINT_INK;
    paint.font = `700 15px ${MONO}`;
    paint.textAlign = "right";
    paint.fillText(
      `${sentence.split(" ").length} words`,
      SLIDE_W - 84,
      y,
    );
  });

  drawStat(paint, 64, 432, `${CORPUS_WORDS} words`, "EVERY WORD IT WILL EVER READ", GOLD, 34);
  drawStat(paint, 380, 432, `${CORPUS_BYTES} bytes`, "TOTAL CORPUS SIZE ON DISK", GOLD, 34);

  drawBody(
    paint,
    "A real run reads billions of sentences. Two is enough to watch every number move.",
    64,
    504,
    SLIDE_W - 128,
    18,
  );
  drawFooter(paint, "", index, count);
}

/** Slide 3 — how much text a real run would have read. */
function paintCorpusScale(paint: Paint, index: number, count: number) {
  slideBackdrop(paint, BLUE);
  drawTitle(paint, "A REAL CORPUS IS UNIMAGINABLY BIGGER", "SCALE · TRAINING TEXT");

  const rows = [
    { label: "THIS DEMONSTRATION", value: CORPUS_BYTES, text: `${CORPUS_BYTES} bytes`, color: GREEN },
    { label: gpt2.name, value: gpt2.trainingBytes, text: "~40 GB", color: BLUE },
    { label: gpt3.name, value: gpt3.trainingBytes, text: "~570 GB", color: VIOLET },
  ];
  const barX = 300;
  const barMax = SLIDE_W - barX - 180;
  const maxLog = Math.log10(gpt3.trainingBytes);
  rows.forEach((row, rowIndex) => {
    const y = 186 + rowIndex * 76;
    paint.textAlign = "left";
    paint.fillStyle = DIM_INK;
    paint.font = `700 18px ${MONO}`;
    paint.fillText(row.label, 64, y + 22, 220);
    const width = Math.max(6, (Math.log10(row.value) / maxLog) * barMax);
    paint.fillStyle = row.color;
    paint.globalAlpha = 0.22;
    paint.fillRect(barX, y, barMax, 34);
    paint.globalAlpha = 1;
    paint.fillRect(barX, y, width, 34);
    paint.fillStyle = INK;
    paint.font = `800 20px ${MONO}`;
    paint.fillText(row.text, barX + barMax + 18, y + 25, 160);
  });

  paint.textAlign = "left";
  paint.fillStyle = FAINT_INK;
  paint.font = `700 14px ${MONO}`;
  paint.fillText("bar length is log scale — a linear chart would need a bar 20 km long", barX, 156);

  drawStat(
    paint,
    64,
    468,
    `${approximately(gpt2.trainingBytes / CORPUS_BYTES)} times`,
    `MORE TEXT IN ${gpt2.name} THAN HERE`,
    BLUE,
    38,
  );
  drawStat(
    paint,
    520,
    468,
    `${approximately(gpt3.trainingBytes / CORPUS_BYTES)} times`,
    `MORE TEXT IN ${gpt3.name} THAN HERE`,
    VIOLET,
    38,
  );
  drawFooter(paint, "Small data is the point: it keeps every value on screen", index, count);
}

/** Slide 4 — the model itself, every parameter drawn. */
function paintModelSize(paint: Paint, index: number, count: number) {
  slideBackdrop(paint, GREEN);
  drawTitle(paint, `THE WHOLE MODEL IS ${withThousands(P.total)} NUMBERS`, "SCALE · PARAMETERS");

  // Every parameter as one dot, banded by the part of the model that owns it.
  const bands = [
    { label: "EMBEDDINGS", count: P.embeddings, color: GOLD },
    { label: "BLOCK 0", count: P.perBlock, color: CYAN },
    { label: "BLOCK 1", count: P.perBlock, color: BLUE },
    { label: "FINAL NORM + VOCAB HEAD", count: P.finalNorm + P.vocabularyHead, color: GREEN },
  ];
  const dotsPerRow = 74;
  const pitch = 5.2;
  let y = 150;
  const left = 64;
  for (const band of bands) {
    paint.textAlign = "left";
    paint.fillStyle = band.color;
    paint.font = `800 14px ${MONO}`;
    paint.fillText(band.label, left, y, 340);
    paint.textAlign = "right";
    paint.fillStyle = DIM_INK;
    paint.fillText(withThousands(band.count), left + dotsPerRow * pitch - 4, y);
    y += 10;
    for (let dot = 0; dot < band.count; dot += 1) {
      const row = Math.floor(dot / dotsPerRow);
      const column = dot % dotsPerRow;
      paint.fillStyle = band.color;
      paint.globalAlpha = (row + column) % 4 === 0 ? 1 : 0.62;
      paint.fillRect(left + column * pitch, y + row * pitch, pitch - 1.9, pitch - 1.9);
    }
    paint.globalAlpha = 1;
    y += Math.ceil(band.count / dotsPerRow) * pitch + 14;
  }
  paint.textAlign = "left";
  paint.fillStyle = FAINT_INK;
  paint.font = `700 14px ${MONO}`;
  paint.fillText("every dot is one learned number — all of them are drawn", left, y + 6);

  const panelX = 486;
  paint.fillStyle = "rgba(255,255,255,0.04)";
  paint.fillRect(panelX, 138, SLIDE_W - panelX - 64, 300);
  drawStat(paint, panelX + 26, 196, withThousands(P.total), "THIS MODEL", GREEN, 42);
  drawStat(paint, panelX + 26, 288, withThousands(gpt2.parameters), `${gpt2.name} · ${gpt2.year}`, BLUE, 34);
  drawStat(paint, panelX + 26, 380, withThousands(gpt3.parameters), `${gpt3.name} · ${gpt3.year}`, VIOLET, 34);
  paint.textAlign = "left";
  paint.fillStyle = DIM_INK;
  paint.font = `700 16px ${MONO}`;
  paint.fillText(
    `${approximately(gpt2.parameters / P.total)} times and ${approximately(gpt3.parameters / P.total)} times more`,
    panelX + 26,
    424,
    SLIDE_W - panelX - 100,
  );

  drawFooter(paint, "Same architecture, same math — fewer numbers", index, count);
}

/**
 * Slide 5 — one weight matrix, ours against GPT-2's.
 *
 * The strongest image in the deck: GPT-2's projection drawn as a grid of
 * 96 × 96 tiles, each tile exactly the size of this model's entire matrix,
 * with one tile lit gold.
 */
function paintMatrixScale(paint: Paint, index: number, count: number) {
  slideBackdrop(paint, GOLD);
  drawTitle(paint, "ONE WEIGHT MATRIX, SIDE BY SIDE", "SCALE · INSIDE A BLOCK");

  const gridSize = 278;
  const gridX = SLIDE_W - gridSize - 72;
  const gridY = 212;
  const tiles = M.widthRatio; // 96 tiles across, 96 down
  const tilePx = gridSize / tiles;

  paint.fillStyle = BLUE;
  paint.globalAlpha = 0.16;
  paint.fillRect(gridX, gridY, gridSize, gridSize);
  paint.globalAlpha = 1;
  // Rule every eighth tile: a full 96-line grid would alias into mush.
  paint.strokeStyle = "rgba(118, 169, 255, 0.34)";
  paint.lineWidth = 1;
  for (let line = 0; line <= tiles; line += 8) {
    const offset = line * tilePx;
    paint.beginPath();
    paint.moveTo(gridX + offset, gridY);
    paint.lineTo(gridX + offset, gridY + gridSize);
    paint.stroke();
    paint.beginPath();
    paint.moveTo(gridX, gridY + offset);
    paint.lineTo(gridX + gridSize, gridY + offset);
    paint.stroke();
  }
  paint.strokeStyle = BLUE;
  paint.lineWidth = 2;
  paint.strokeRect(gridX, gridY, gridSize, gridSize);

  // Our entire matrix is one tile of that grid — about three pixels wide. Left
  // on its own it reads as a rendering fault rather than as the point, so it
  // gets a finder box and a magnified inset showing the real 8x8.
  const speckX = gridX + 6 * tilePx;
  const speckY = gridY + 7 * tilePx;
  paint.fillStyle = GOLD;
  paint.fillRect(speckX, speckY, Math.max(tilePx, 2), Math.max(tilePx, 2));
  paint.strokeStyle = GOLD;
  paint.lineWidth = 1.5;
  paint.strokeRect(speckX - 7, speckY - 7, 14 + tilePx, 14 + tilePx);

  const insetSize = 84;
  const insetX = gridX + gridSize - insetSize;
  const insetY = gridY - insetSize - 26;
  paint.beginPath();
  paint.moveTo(speckX + tilePx + 7, speckY - 7);
  paint.lineTo(insetX - 16, insetY + insetSize - 6);
  paint.lineTo(insetX, insetY + insetSize - 6);
  paint.stroke();

  const cell = insetSize / TEACHING_MODEL.modelWidth;
  paint.fillStyle = GOLD;
  paint.globalAlpha = 0.18;
  paint.fillRect(insetX, insetY, insetSize, insetSize);
  paint.globalAlpha = 1;
  for (let row = 0; row < TEACHING_MODEL.modelWidth; row += 1) {
    for (let column = 0; column < TEACHING_MODEL.modelWidth; column += 1) {
      paint.fillStyle = GOLD;
      paint.globalAlpha = (row + column) % 2 === 0 ? 0.85 : 0.5;
      paint.fillRect(
        insetX + column * cell + 0.8,
        insetY + row * cell + 0.8,
        cell - 1.6,
        cell - 1.6,
      );
    }
  }
  paint.globalAlpha = 1;
  paint.strokeStyle = GOLD;
  paint.lineWidth = 2;
  paint.strokeRect(insetX, insetY, insetSize, insetSize);
  paint.textAlign = "right";
  paint.fillStyle = GOLD;
  paint.font = `800 15px ${MONO}`;
  paint.fillText(
    `this model: ${M.attention.ours[0]} x ${M.attention.ours[1]}`,
    insetX + insetSize,
    insetY - 10,
  );

  paint.textAlign = "center";
  paint.fillStyle = DIM_INK;
  paint.font = `700 15px ${MONO}`;
  paint.fillText(
    `${gpt2.name}: ${M.attention.theirs[0]} x ${M.attention.theirs[1]}`,
    gridX + gridSize / 2,
    gridY + gridSize + 26,
    gridSize,
  );

  const textWidth = gridX - 64 - 40;
  let cursor = drawBody(
    paint,
    `Attention and MLP weights here are ${M.attention.ours[0]}x${M.attention.ours[1]} and ${M.feedForward.ours[0]}x${M.feedForward.ours[1]}. In ${gpt2.name} the same two matrices are ${M.attention.theirs[0]}x${M.attention.theirs[1]} and ${M.feedForward.theirs[0]}x${M.feedForward.theirs[1]}.`,
    64,
    172,
    textWidth,
    20,
  );
  cursor = drawBody(
    paint,
    `Both dimensions grow by the same factor, so every weight matrix in a block is ${M.widthRatio}x narrower and ${M.widthRatio}x shorter than GPT-2's.`,
    64,
    cursor + 26,
    textWidth,
    20,
    "rgba(215, 236, 250, 0.9)",
  );

  drawStat(
    paint,
    64,
    cursor + 78,
    `${withThousands(M.tilesPerMatrix)}`,
    "OF OUR MATRICES FIT IN ONE OF THEIRS",
    GOLD,
    46,
  );
  drawStat(
    paint,
    64,
    cursor + 152,
    `${withThousands(M.attention.oursCells)} vs ${withThousands(M.attention.theirsCells)}`,
    "NUMBERS IN ONE ATTENTION PROJECTION",
    DIM_INK,
    22,
  );
  drawFooter(paint, "", index, count);
}

/** Slide 6 — how much text the model can hold in view at once. */
function paintContextWindow(paint: Paint, index: number, count: number) {
  slideBackdrop(paint, CYAN);
  drawTitle(paint, "IT CAN ONLY SEE SIX TOKENS AT A TIME", "SCALE · CONTEXT WINDOW");

  const tokens = SELECTED_TRACE.batch.inputTokenIds[0].map(
    (id) => SELECTED_TRACE.vocabulary[id],
  );
  const cellW = 128;
  const gap = 10;
  tokens.forEach((token, tokenIndex) => {
    const x = 64 + tokenIndex * (cellW + gap);
    paint.fillStyle = CYAN;
    paint.globalAlpha = 0.2;
    paint.fillRect(x, 154, cellW, 60);
    paint.globalAlpha = 1;
    paint.strokeStyle = CYAN;
    paint.lineWidth = 2;
    paint.strokeRect(x, 154, cellW, 60);
    paint.textAlign = "center";
    paint.fillStyle = INK;
    paint.font = `800 20px ${MONO}`;
    paint.fillText(token, x + cellW / 2, 192, cellW - 12);
  });
  paint.textAlign = "left";
  paint.fillStyle = GREEN;
  paint.font = `800 20px ${MONO}`;
  paint.fillText(
    `${TEACHING_MODEL.sequenceLength} tokens — one context window`,
    64,
    248,
    SLIDE_W - 128,
  );

  // The giants' windows cannot be drawn to the same scale, so their bars run
  // off the edge of the slide instead of pretending to end somewhere.
  [
    { label: gpt2.name, length: gpt2.contextLength, color: BLUE, y: 288 },
    { label: gpt3.name, length: gpt3.contextLength, color: VIOLET, y: 352 },
  ].forEach((row) => {
    const barWidth = SLIDE_W - 64;
    const gradient = paint.createLinearGradient(64, 0, 64 + barWidth, 0);
    gradient.addColorStop(0, row.color);
    gradient.addColorStop(0.66, row.color);
    gradient.addColorStop(1, "rgba(6, 13, 24, 0)");
    paint.globalAlpha = 0.5;
    paint.fillStyle = gradient;
    paint.fillRect(64, row.y, barWidth, 42);
    paint.globalAlpha = 1;
    paint.textAlign = "left";
    paint.fillStyle = INK;
    paint.font = `800 20px ${MONO}`;
    paint.fillText(
      `${row.label}: ${withThousands(row.length)} tokens`,
      80,
      row.y + 28,
      520,
    );
  });

  drawStat(
    paint,
    64,
    468,
    `${Math.round(gpt2.contextLength / TEACHING_MODEL.sequenceLength)} times`,
    `LONGER WINDOW IN ${gpt2.name}`,
    BLUE,
    32,
  );
  drawStat(
    paint,
    520,
    468,
    `${Math.round(gpt3.contextLength / TEACHING_MODEL.sequenceLength)} times`,
    `LONGER WINDOW IN ${gpt3.name}`,
    VIOLET,
    32,
  );
  drawFooter(paint, "Anything outside the window does not exist to the model", index, count);
}

/** Slide 7 — the complete vocabulary, against the one real models use. */
function paintVocabulary(paint: Paint, index: number, count: number) {
  slideBackdrop(paint, MAGENTA);
  drawTitle(paint, `IT KNOWS EXACTLY ${TEACHING_MODEL.vocabularySize} WORD PIECES`, "SCALE · VOCABULARY");

  const chipsPerRow = 8;
  const chipW = 106;
  const chipGap = 8;
  SELECTED_TRACE.vocabulary.forEach((word, wordIndex) => {
    const row = Math.floor(wordIndex / chipsPerRow);
    const column = wordIndex % chipsPerRow;
    const x = 64 + column * (chipW + chipGap);
    const y = 148 + row * 44;
    const special = word.startsWith("<");
    paint.fillStyle = special ? MAGENTA : CYAN;
    paint.globalAlpha = 0.18;
    paint.fillRect(x, y, chipW, 36);
    paint.globalAlpha = 1;
    paint.strokeStyle = special ? MAGENTA : CYAN;
    paint.lineWidth = 1.4;
    paint.strokeRect(x, y, chipW, 36);
    paint.textAlign = "center";
    paint.fillStyle = INK;
    paint.font = `700 16px ${MONO}`;
    paint.fillText(word, x + chipW / 2, y + 24, chipW - 10);
  });
  paint.textAlign = "left";
  paint.fillStyle = GREEN;
  paint.font = `800 17px ${MONO}`;
  paint.fillText(
    "every piece it can read or write — the whole dictionary",
    64,
    262,
    SLIDE_W - 128,
  );

  // The shared GPT-2 / GPT-3 vocabulary as a field of grains, one per entry.
  // Sized so the field always lands inside the slide: the pitch follows from
  // the box, rather than the box following from a guessed pitch.
  const fieldX = 64;
  const fieldY = 306;
  const fieldW = SLIDE_W - 128;
  const fieldH = 150;
  const grainPitch = Math.sqrt((fieldH * fieldW) / gpt2.vocabularySize);
  const columns = Math.floor(fieldW / grainPitch);
  const grain = Math.max(1, grainPitch - 0.7);
  paint.fillStyle = BLUE;
  paint.globalAlpha = 0.6;
  for (let entry = TEACHING_MODEL.vocabularySize; entry < gpt2.vocabularySize; entry += 1) {
    const row = Math.floor(entry / columns);
    const column = entry % columns;
    paint.fillRect(fieldX + column * grainPitch, fieldY + row * grainPitch, grain, grain);
  }
  paint.globalAlpha = 1;
  paint.fillStyle = GOLD;
  for (let entry = 0; entry < TEACHING_MODEL.vocabularySize; entry += 1) {
    paint.fillRect(
      fieldX + entry * grainPitch,
      fieldY,
      Math.max(1.6, grain),
      Math.max(1.6, grain),
    );
  }
  paint.textAlign = "left";
  paint.fillStyle = DIM_INK;
  paint.font = `700 15px ${MONO}`;
  paint.fillText(
    `${withThousands(gpt2.vocabularySize)} pieces in GPT-2 and GPT-3 — the gold sliver top-left is all ${TEACHING_MODEL.vocabularySize} of ours`,
    fieldX,
    fieldY + fieldH + 26,
    fieldW,
  );

  drawFooter(
    paint,
    `${withThousands(gpt2.vocabularySize / TEACHING_MODEL.vocabularySize)} times more pieces in a real vocabulary`,
    index,
    count,
  );
}

/** Slide 7 — why everything is small, and what to do next. */
function paintWhy(paint: Paint, index: number, count: number) {
  slideBackdrop(paint, GREEN);
  drawTitle(paint, "SAME MATH, SPECIMEN SIZE", "WHY IT IS THIS SMALL");

  drawBody(
    paint,
    "Nothing ahead is simplified. Attention, cross-entropy loss, backpropagation and the AdamW update are exactly what a production model runs. Only the sizes shrank — so every number fits on a wall and can be checked by hand.",
    64,
    168,
    SLIDE_W - 128,
    22,
  );

  const facts = [
    { value: `${TEACHING_MODEL.transformerBlocks} blocks`, caption: `GPT-2 SMALL HAS ${gpt2.transformerBlocks}` },
    { value: `${TEACHING_MODEL.attentionHeads} heads`, caption: `GPT-2 SMALL HAS ${gpt2.attentionHeads}` },
    { value: `width ${TEACHING_MODEL.modelWidth}`, caption: `GPT-2 SMALL USES ${gpt2.modelWidth}` },
  ];
  facts.forEach((fact, factIndex) => {
    drawStat(paint, 64 + factIndex * 316, 320, fact.value, fact.caption, CYAN, 30);
  });

  paint.fillStyle = GREEN;
  paint.globalAlpha = 0.12;
  paint.fillRect(64, 380, SLIDE_W - 128, 84);
  paint.globalAlpha = 1;
  paint.fillStyle = GREEN;
  paint.fillRect(64, 380, 5, 84);
  paint.textAlign = "left";
  paint.fillStyle = INK;
  paint.font = `800 22px ${MONO}`;
  paint.fillText("Through the door, this batch starts moving:", 92, 414, SLIDE_W - 220);
  paint.fillStyle = GOLD;
  paint.font = `800 23px ${MONO}`;
  paint.fillText(
    DATA_PREP_TRACE.sources.map((source) => `"${source.clean}"`).join("   +   "),
    92,
    446,
    SLIDE_W - 220,
  );

  drawFooter(paint, "Walk around the stage to enter the data wing", index, count);
}

/**
 * Exported so `.qa/render-slides.mjs` can draw the real deck to reviewable
 * images without launching the 3D world; nothing in the app reads it.
 */
export const SLIDE_PAINTERS = [
  paintWelcome,
  paintCorpus,
  paintCorpusScale,
  paintModelSize,
  paintMatrixScale,
  paintContextWindow,
  paintVocabulary,
  paintWhy,
] as const;

/** Canvas resolution each painter draws into. */
export const SLIDE_PIXELS = { width: SLIDE_W, height: SLIDE_H } as const;

/** Accent per placard, used for its frame, beam and floor pool. */
const SLIDE_ACCENTS = [CYAN, GOLD, BLUE, GREEN, GOLD, CYAN, MAGENTA, GREEN] as const;

/** Short names, used by the layout audit's per-surface report. */
const SLIDE_TITLES = [
  "welcome",
  "the corpus",
  "corpus scale",
  "model size",
  "one weight matrix",
  "context window",
  "vocabulary",
  "why so small",
] as const;

export const ORIENTATION_SLIDE_COUNT = SLIDE_PAINTERS.length;

// ---------------------------------------------------------------------------
// Gallery geometry
//
// The hall is a processional gallery: placards stand in bays that alternate
// left and right down the room, each turned to face a viewing mark on the
// centre line a little downstream of it. That angle is what keeps the room
// readable — from any mark the placard being read is square-on and nearly
// fills the view, while its neighbours are steeply oblique and read as thin
// slivers. Everything below is derived from these five numbers so the
// placards, their lighting, and the camera tour cannot disagree.
// ---------------------------------------------------------------------------

/** Placard face width in chamber units; height follows the canvas aspect. */
const PLACARD_W = 12;
const PLACARD_H = (SLIDE_H / SLIDE_W) * PLACARD_W;
/** Centre height of a placard face. */
const PLACARD_Y = 2.2;
/** How far each bay sits off the centre line. */
const BAY_X = 10.5;
/** z of the first bay, and the gap between consecutive bays. */
const BAY_Z_START = 27;
const BAY_Z_STEP = 9;
/** How far downstream of its placard a viewing mark sits. */
const VIEW_AHEAD = 9.5;
/**
 * How far the viewing mark steps off the centre line toward its placard.
 *
 * Standing in the middle of the hall is not how anyone reads a gallery, and it
 * does not work optically either: from the centre line a 12-unit placard spans
 * barely half the frame at this room's field of view, which is not the
 * "one thing dominates" the layout depends on. Stepping across puts the reader
 * about 7.5 units out, where the placard fills roughly three quarters of the
 * view. The mark stays inside the runway, so the walkway is still a walkway.
 */
const VIEW_LATERAL = 3.6;
/** Eye height in the gallery — a little below the placard centre. */
const GALLERY_EYE_Y = 1.9;

/** Bays alternate, starting on the left as the visitor walks in. */
function baySide(index: number) {
  return index % 2 === 0 ? -1 : 1;
}

function bayPosition(index: number) {
  return new THREE.Vector3(
    baySide(index) * BAY_X,
    PLACARD_Y,
    BAY_Z_START - index * BAY_Z_STEP,
  );
}

/** Chamber-local eye position the tour reads bay `index` from. */
function bayViewpoint(index: number) {
  return new THREE.Vector3(
    baySide(index) * VIEW_LATERAL,
    GALLERY_EYE_Y,
    BAY_Z_START - index * BAY_Z_STEP + VIEW_AHEAD,
  );
}

/** Yaw that turns a bay's placard square-on to its viewing mark. */
function bayYaw(index: number) {
  return Math.atan2(-baySide(index) * (BAY_X - VIEW_LATERAL), VIEW_AHEAD);
}

export interface OrientationTourStop {
  /** Chamber-local camera position. */
  eye: readonly [number, number, number];
  /** Chamber-local point the camera faces. */
  look: readonly [number, number, number];
}

/**
 * Where the guided tour stands to read each placard, in chamber-local space.
 *
 * Derived from the same bay constants the placards are built from, so the
 * camera always ends up square-on to the panel rather than at a pose that has
 * to be re-tuned by hand whenever the gallery is re-spaced.
 */
export const ORIENTATION_TOUR_STOPS: readonly OrientationTourStop[] =
  SLIDE_PAINTERS.map((_, index) => {
    const placard = bayPosition(index);
    const eye = bayViewpoint(index);
    return {
      eye: [eye.x, eye.y, eye.z] as const,
      look: [placard.x, placard.y, placard.z] as const,
    };
  });

/** Per-bay transforms (position, facing yaw, side, accent) so the crafted room
 *  can seat an alcove housing exactly behind each screen. */
export const ORIENTATION_BAYS = SLIDE_PAINTERS.map((_, index) => {
  const placard = bayPosition(index);
  return {
    x: placard.x,
    y: placard.y,
    z: placard.z,
    yaw: bayYaw(index),
    side: baySide(index),
    accent: SLIDE_ACCENTS[index],
  };
});

/** Screen face dimensions, shared with the room so surrounds match exactly. */
export const ORIENTATION_PLACARD = {
  width: PLACARD_W,
  height: PLACARD_H,
  y: PLACARD_Y,
} as const;

/** Standing eye height the chamber shell should use for this gallery. */
export const ORIENTATION_EYE_Y = GALLERY_EYE_Y;

/**
 * Where the invitation sign hangs: on the end wall directly over the doorway
 * to the data wing. The chamber's exit is a 7.2 x 9.2 opening centred on the
 * far wall with its head at y = 4.5, so the sign sits just above the lintel —
 * high enough to clear the opening, low enough to share a frame with it.
 */
const EXIT_SIGN_H = 2.2;
/** Just clear of the 4.5-high lintel, so the sign never crosses the opening. */
const EXIT_SIGN_CENTER = new THREE.Vector3(0, 4.5 + 0.15 + EXIT_SIGN_H / 2, -40.6);
const EXIT_SIGN_W = 13.5;

/**
 * The point the tour turns to face once the last placard has been read: a spot
 * in the doorway itself, chosen so the opening fills the lower half of the
 * frame and the sign above it the upper half.
 */
/**
 * The y is not the middle of the doorway but a little below it: the shot has to
 * hold the sign's top edge and the floor of the opening at once, which spans
 * about 52 degrees from the last stop. Aiming at the midpoint of that span
 * leaves roughly four degrees of margin at both edges of a 60-degree frame.
 */
export const ORIENTATION_EXIT_LOOK: readonly [number, number, number] = [
  0, 1.5, -40.5,
];

/** Where the closing beat dollies the eye — a little back from the exit so the
 *  whole doorway and its sign frame up rather than being read from far away. */
export const ORIENTATION_EXIT_EYE_Z = -27;

/**
 * Where the guided walk stands, and what it faces, at a given point in the
 * chamber's transport. Writes into the supplied vectors so the render loop can
 * call it every frame without allocating.
 *
 * This is deliberately a pure function of `progress` with no memory of how it
 * got there. That is the property that makes the dial work in both directions:
 * winding back to 40% puts the camera exactly where playing forward to 40%
 * would, so scrubbing back walks the visitor back up the hall instead of
 * leaving them parked while the placards change around them.
 */
export function orientationTourPose(
  progress: number,
  eye: THREE.Vector3,
  look: THREE.Vector3,
) {
  const stops = ORIENTATION_TOUR_STOPS;
  const walk = Math.min(1, Math.max(0, progress));
  // Each placard owns a slice of the transport. Within its slice the camera
  // arrives over the first part and then holds, so the visitor is standing
  // still while they read rather than drifting the whole time.
  const scaled = walk * stops.length;
  const index = Math.min(stops.length - 1, Math.floor(scaled));
  const withinStop = scaled - index;
  const approach = THREE.MathUtils.smoothstep(withinStop, 0, 0.45);
  const from = stops[Math.max(0, index - 1)];
  const to = stops[index];
  const blend = index === 0 ? 1 : approach;

  eye.set(from.eye[0], from.eye[1], from.eye[2]);
  look.set(from.look[0], from.look[1], from.look[2]);
  tourScratch.set(to.eye[0], to.eye[1], to.eye[2]);
  eye.lerp(tourScratch, blend);
  tourScratch.set(to.look[0], to.look[1], to.look[2]);
  look.lerp(tourScratch, blend);

  // Closing beat: over the tail of the last placard, step back to the middle of
  // the hall and turn to the doorway, where the invitation has just come up.
  if (index === stops.length - 1) {
    const turn = THREE.MathUtils.smoothstep(withinStop, 0.72, 0.96);
    if (turn > 0) {
      tourScratch.set(0, to.eye[1], ORIENTATION_EXIT_EYE_Z);
      eye.lerp(tourScratch, turn);
      tourScratch.set(
        ORIENTATION_EXIT_LOOK[0],
        ORIENTATION_EXIT_LOOK[1],
        ORIENTATION_EXIT_LOOK[2],
      );
      look.lerp(tourScratch, turn);
    }
  }
}

const tourScratch = new THREE.Vector3();

/**
 * Lane blockers that keep the visitor on the central runway. Returned rather
 * than applied so the chamber shell stays the single owner of navigation.
 */
export const ORIENTATION_BAY_BLOCKERS = (() => {
  const nearZ = BAY_Z_START + 5;
  const farZ = BAY_Z_START - (SLIDE_PAINTERS.length - 1) * BAY_Z_STEP - 5;
  const inner = 4.0;
  const outer = BAY_X + 6;
  return [-1, 1].map((side) => ({
    minX: side < 0 ? -outer : inner,
    maxX: side < 0 ? -inner : outer,
    minY: -4.7,
    maxY: 14,
    minZ: farZ,
    maxZ: nearZ,
  }));
})();

interface Placard {
  group: THREE.Group;
  /** Face material, dimmed when the placard is not the one being read. */
  faceMaterial: THREE.MeshBasicMaterial;
  frameMaterial: THREE.MeshStandardMaterial;
  poolMaterial: THREE.MeshBasicMaterial;
  numberMaterial: THREE.MeshBasicMaterial;
}

/**
 * One lit museum placard: a framed panel on a stand, a fixture above it
 * throwing a soft beam across the face, and a pool of light on the floor in
 * front of it.
 *
 * The beam and pool are additive geometry rather than real spotlights. Eight
 * shadow-casting lights in one room would dominate the frame budget for the
 * whole world, and because the face is self-lit (an emissive canvas texture)
 * the physical lights would not actually be doing the lighting anyone sees.
 */
function createPlacard(index: number): Placard {
  const canvas = document.createElement("canvas");
  canvas.width = SLIDE_W;
  canvas.height = SLIDE_H;
  const paint = canvas.getContext("2d");
  if (paint) {
    SLIDE_PAINTERS[index](paint, index, SLIDE_PAINTERS.length);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;

  const accent = new THREE.Color(SLIDE_ACCENTS[index]);
  const group = new THREE.Group();
  group.name = `orientation-placard-${index + 1}`;

  // Frame: a dark slab a little larger than the face, so the panel reads as a
  // mounted object with a physical edge rather than a floating rectangle.
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: "#05080d",
    emissive: accent.clone().multiplyScalar(0.4),
    emissiveIntensity: 0.25,
    roughness: 0.4,
    metalness: 0.62,
  });
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(PLACARD_W + 0.44, PLACARD_H + 0.44, 0.24),
    frameMaterial,
  );
  frame.position.z = -0.14;
  group.add(frame);

  const faceMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(PLACARD_W, PLACARD_H),
    faceMaterial,
  );
  face.renderOrder = 12;
  group.add(face);
  group.add(createNeonFrame(PLACARD_W, PLACARD_H, accent, 0.04));


  // Base: a low metal pedestal + slim pylon the screen rises from, replacing
  // the museum stand. In the crafted room an alcove housing wraps this so the
  // screen reads as installed into a purpose-built bay rather than propped up.
  const postMaterial = new THREE.MeshStandardMaterial({
    color: "#10161f",
    roughness: 0.42,
    metalness: 0.7,
  });
  const floorLocalY = -4.7 - PLACARD_Y;
  const pylonTop = -PLACARD_H / 2 - 0.1;
  const pylonHeight = pylonTop - floorLocalY - 0.34;
  const pylon = new THREE.Mesh(
    new THREE.BoxGeometry(PLACARD_W * 0.5, pylonHeight, 0.6),
    postMaterial,
  );
  pylon.position.set(0, pylonTop - pylonHeight / 2, -0.12);
  group.add(pylon);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(PLACARD_W * 0.86, 0.42, 2.1),
    postMaterial,
  );
  base.position.set(0, floorLocalY + 0.21, -0.05);
  group.add(base);


  // Pool of light on the floor where the visitor stands to read.
  const poolMaterial = new THREE.MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(4.4, 40), poolMaterial);
  pool.rotation.x = -Math.PI / 2;
  pool.scale.set(1, 0.72, 1);
  pool.position.set(0, -4.7 - PLACARD_Y + 0.03, 2.6);
  pool.renderOrder = 2;
  pool.userData.processDecal = true;
  pool.userData.assistantNonInteractive = true;
  group.add(pool);

  // Brass-style numeral plate under the frame, as on a gallery wall label.
  const numberCanvas = document.createElement("canvas");
  numberCanvas.width = 128;
  numberCanvas.height = 64;
  const numberPaint = numberCanvas.getContext("2d");
  if (numberPaint) {
    numberPaint.fillStyle = "rgba(8, 14, 24, 0.95)";
    numberPaint.fillRect(0, 0, 128, 64);
    numberPaint.strokeStyle = "rgba(255, 209, 102, 0.75)";
    numberPaint.lineWidth = 3;
    numberPaint.strokeRect(3, 3, 122, 58);
    numberPaint.fillStyle = "rgba(255, 226, 160, 0.95)";
    numberPaint.font = `800 34px ${MONO}`;
    numberPaint.textAlign = "center";
    numberPaint.textBaseline = "middle";
    numberPaint.fillText(String(index + 1).padStart(2, "0"), 64, 34);
  }
  const numberTexture = new THREE.CanvasTexture(numberCanvas);
  numberTexture.colorSpace = THREE.SRGBColorSpace;
  numberTexture.generateMipmaps = false;
  const numberMaterial = new THREE.MeshBasicMaterial({
    map: numberTexture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const numberPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.55),
    numberMaterial,
  );
  numberPlate.position.set(
    -PLACARD_W / 2 + 0.75,
    -PLACARD_H / 2 - 0.72,
    0.05,
  );
  numberPlate.renderOrder = 12;
  group.add(numberPlate);

  // The readable surface the layout audit measures.
  group.userData.processSurface = "board";
  group.userData.processLabel = `${index + 1}. ${SLIDE_TITLES[index]}`;
  group.userData.processSurfaceSize = { width: PLACARD_W, height: PLACARD_H };

  return { group, faceMaterial, frameMaterial, poolMaterial, numberMaterial };
}

/**
 * The invitation over the doorway.
 *
 * A gallery tells you where the exhibition continues, and this one has a real
 * answer: the batch the briefing has just described goes through that door. The
 * sign is always present — a visitor who skips the tour should still find the
 * way on — but it is subdued until the last placard has been read, at which
 * point the tour turns to face it and it comes up to full.
 */
function createInvitation() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 220;
  const paint = canvas.getContext("2d");
  if (paint) {
    const backdrop = paint.createLinearGradient(0, 0, 0, canvas.height);
    backdrop.addColorStop(0, "rgba(8, 18, 30, 0.96)");
    backdrop.addColorStop(1, "rgba(4, 10, 18, 0.96)");
    paint.fillStyle = backdrop;
    paint.fillRect(0, 0, canvas.width, canvas.height);
    paint.fillStyle = GREEN;
    paint.globalAlpha = 0.5;
    paint.fillRect(0, canvas.height - 5, canvas.width, 5);
    paint.globalAlpha = 1;
    paint.textAlign = "center";
    paint.textBaseline = "middle";
    paint.fillStyle = INK;
    paint.font = `800 52px ${MONO}`;
    paint.fillText(
      "READY TO GO INSIDE THE TRAINING PROCESS?",
      canvas.width / 2,
      82,
      canvas.width - 60,
    );
    paint.fillStyle = GREEN;
    paint.font = `800 30px ${MONO}`;
    paint.fillText(
      "follow the batch through the door",
      canvas.width / 2,
      146,
      canvas.width - 120,
    );
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const group = new THREE.Group();
  group.name = "orientation-exit-invitation";
  group.position.copy(EXIT_SIGN_CENTER);

  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(EXIT_SIGN_W + 0.6, EXIT_SIGN_H + 0.6, 0.3),
    new THREE.MeshStandardMaterial({
      color: "#0b1119",
      emissive: new THREE.Color(GREEN).multiplyScalar(0.4),
      emissiveIntensity: 0.2,
      roughness: 0.46,
      metalness: 0.5,
    }),
  );
  backing.position.z = -0.16;
  group.add(backing);

  const faceMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(EXIT_SIGN_W, EXIT_SIGN_H),
    faceMaterial,
  );
  face.renderOrder = 12;
  group.add(face);
  group.add(createNeonFrame(EXIT_SIGN_W, EXIT_SIGN_H, GREEN, 0.04));

  // A wash spilling down the wall onto the threshold, so the doorway itself
  // brightens with the invitation rather than staying a dark hole.
  const washMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(GREEN),
    transparent: true,
    opacity: 0.04,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const wash = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 11), washMaterial);
  wash.position.set(0, -5.4, 0.55);
  wash.renderOrder = 11;
  wash.userData.processDecal = true;
  wash.userData.assistantNonInteractive = true;
  group.add(wash);

  group.userData.processSurface = "board";
  group.userData.processLabel = "exit invitation";
  group.userData.processSurfaceSize = { width: EXIT_SIGN_W, height: EXIT_SIGN_H };

  return { group, faceMaterial, washMaterial };
}

/**
 * Builds the orientation gallery: eight lit placards in alternating bays down
 * the hall, with the chamber's process transport deciding which one is
 * currently being read.
 *
 * Nothing is hidden. Every placard stays lit enough to look like an exhibition
 * hall from the door, and the "current" one is simply brought up — brighter
 * face, hotter frame, a stronger beam and floor pool. That matters because the
 * visitor can leave the tour at any moment and walk the gallery themselves;
 * a room where seven of eight panels were switched off would look broken.
 */
export function buildOrientationGallery(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const process = new THREE.Group();
  process.name = "orientation-gallery-placards";
  context.group.add(process);

  const placards = SLIDE_PAINTERS.map((_, index) => {
    const placard = createPlacard(index);
    const position = bayPosition(index);
    placard.group.position.copy(position);
    placard.group.rotation.set(0, bayYaw(index), 0);
    process.add(placard.group);
    return placard;
  });

  // Deliberately not an `assistant-target-*` name: no world-target metadata is
  // registered for the placards, so pointing at one resolves to the station
  // fallback — which is right here, since the station's own story/structure/
  // math already describe the briefing.
  placards[0].group.name = "orientation-briefing-placard";

  const invitation = createInvitation();
  process.add(invitation.group);

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    // The transport is divided evenly among the placards; `reading` is the
    // continuous position within that sequence, so a placard can come up
    // smoothly as the tour walks toward it rather than snapping on arrival.
    const reading = p * placards.length;
    const breathe = motionEnabled ? (Math.sin(elapsed * 0.8) + 1) * 0.5 : 0.5;

    placards.forEach((placard, index) => {
      // 1 when the tour is standing at this placard, falling off across the
      // neighbouring bays.
      const focus = THREE.MathUtils.clamp(
        1 - Math.abs(reading - (index + 0.5)),
        0,
        1,
      );
      const eased = focus * focus * (3 - 2 * focus);
      // Screens hold rock-steady (no flicker/glitch, no overlay in front).
      placard.faceMaterial.opacity = 0.42 + eased * 0.58;
      placard.frameMaterial.emissiveIntensity = 0.2 + eased * 1.05;
      placard.poolMaterial.opacity = 0.07 + eased * 0.2;
      placard.numberMaterial.opacity = 0.5 + eased * 0.5;
    });

    // The invitation comes up over the tail of the last placard, so it is
    // already lit as the tour turns toward the door rather than snapping on
    // once the camera has arrived.
    const welcome = THREE.MathUtils.smoothstep(reading, placards.length - 0.4, placards.length - 0.05);
    invitation.faceMaterial.opacity = 0.34 + welcome * 0.66;
    invitation.washMaterial.opacity = 0.035 + welcome * (0.1 + breathe * 0.035);
  };
  updater(0, 0, false);
  return updater;
}
