import * as THREE from "three";

import {
  BLOCK_MATRIX_COMPARISON,
  DATA_PREP_TRACE,
  PRODUCTION_SCALE_REFERENCES,
  SELECTED_TRACE,
  TEACHING_MODEL,
  TEACHING_MODEL_PARAMETERS,
} from "../../lib/trainingTrace";
import { CHAMBER_PANEL_DECK_TOP_Y } from "./chamberArchitecture";
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
 * So the room is an exhibition hall instead: five warm-white lightboxes in bays that
 * alternate down the gallery, each turned square-on to a viewing mark, and a
 * guided walk that takes the visitor to each in turn. The angle is what makes
 * it work — from any mark the page being read fills about 45% of the frame
 * while its neighbours are steeply oblique. `.qa/verify-gallery-tour.mjs`
 * checks exactly that, stop by stop.
 *
 * Placard faces are drawn as full canvas compositions rather than assembled
 * from value boards, because a page wants typography and diagrams. Every
 * figure comes from `trainingTrace.ts`, so the gallery cannot drift from the
 * model it describes.
 */

const PAPER = "#fbfaf6";
const PAPER_ALT = "#f2efe7";
const INK = "#171a1f";
const DIM_INK = "#3f4954";
const FAINT_INK = "#5f6872";
const RULE = "#c4bcaf";
// Saturated enough to organize a white page, dark enough to remain readable.
const CYAN = "#14796f";
const BLUE = "#285fab";
const VIOLET = "#654c9d";
const GREEN = "#267052";
const GOLD = "#986500";
const MAGENTA = "#a44769";

// Opaque print tints: color should organize whole information regions, not
// disappear into hairline rules. These remain pale enough for black body copy.
const CYAN_TINT = "#cfe7e2";
const BLUE_TINT = "#d7e2f2";
const VIOLET_TINT = "#e0d9ee";
const GREEN_TINT = "#d5e7da";
const GOLD_TINT = "#eaddbb";
const MAGENTA_TINT = "#e9d7df";

/** Slide canvas resolution: 16:9, sharp enough to fill most of the view. */
const SLIDE_W = 1024;
const SLIDE_H = 576;
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const SANS = '"Segoe UI", Inter, Arial, sans-serif';

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

function tintFor(accent: string) {
  switch (accent) {
    case CYAN:
      return CYAN_TINT;
    case BLUE:
      return BLUE_TINT;
    case VIOLET:
      return VIOLET_TINT;
    case GREEN:
      return GREEN_TINT;
    case GOLD:
      return GOLD_TINT;
    case MAGENTA:
      return MAGENTA_TINT;
    default:
      return PAPER_ALT;
  }
}

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
  backdrop.addColorStop(0, "#fdfcf8");
  backdrop.addColorStop(0.58, PAPER);
  backdrop.addColorStop(1, "#f7f4ec");
  paint.fillStyle = backdrop;
  paint.fillRect(0, 0, SLIDE_W, SLIDE_H);

  // A colored header field and deterministic paper fibres make the surface
  // read as a printed museum sheet rather than a luminous dashboard.
  paint.fillStyle = tintFor(accent);
  paint.fillRect(24, 22, SLIDE_W - 48, 92);
  paint.fillStyle = accent;
  paint.fillRect(24, 22, 9, SLIDE_H - 44);
  paint.fillStyle = "rgba(23, 26, 31, 0.025)";
  for (let fibre = 0; fibre < 28; fibre += 1) {
    const x = 30 + ((fibre * 83) % 860);
    const y = 128 + fibre * 14;
    paint.fillRect(x, y, 54 + (fibre % 5) * 24, 1);
  }

  paint.strokeStyle = RULE;
  paint.lineWidth = 1;
  paint.strokeRect(24.5, 22.5, SLIDE_W - 49, SLIDE_H - 45);
  paint.fillStyle = accent;
  paint.fillRect(64, 108, 154, 4);
  paint.fillStyle = RULE;
  paint.fillRect(64, SLIDE_H - 54, SLIDE_W - 128, 1);
}

function drawTitle(paint: Paint, title: string, kicker: string) {
  paint.textAlign = "left";
  paint.textBaseline = "alphabetic";
  paint.fillStyle = FAINT_INK;
  paint.font = `700 16px ${SANS}`;
  paint.fillText(kicker, 64, 52, SLIDE_W - 200);
  paint.fillStyle = INK;
  paint.font = `800 40px ${SANS}`;
  paint.fillText(title, 64, 92, SLIDE_W - 128);
}

function drawFooter(paint: Paint, text: string, index: number, count: number) {
  paint.textAlign = "left";
  paint.fillStyle = FAINT_INK;
  paint.font = `650 15px ${SANS}`;
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
  paint.font = `600 ${size}px ${SANS}`;
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
  paint.font = `800 ${size}px ${SANS}`;
  paint.fillText(value, x, y, SLIDE_W - x - 48);
  paint.fillStyle = FAINT_INK;
  paint.font = `700 15px ${SANS}`;
  paint.fillText(caption, x, y + 24, SLIDE_W - x - 48);
}

/** One large, glance-readable specification tile on the opening placard. */
function drawSpecCard(
  paint: Paint,
  x: number,
  y: number,
  width: number,
  height: number,
  value: string,
  labels: readonly string[],
  accent: string,
) {
  paint.fillStyle = tintFor(accent);
  paint.fillRect(x, y, width, height);
  paint.strokeStyle = RULE;
  paint.lineWidth = 1;
  paint.strokeRect(x, y, width, height);
  paint.fillStyle = accent;
  paint.fillRect(x, y, width, 5);

  paint.textAlign = "center";
  paint.fillStyle = INK;
  paint.font = `800 26px ${SANS}`;
  paint.fillText(value, x + width / 2, y + 34, width - 14);
  paint.fillStyle = DIM_INK;
  paint.font = `700 12px ${SANS}`;
  labels.forEach((label, labelIndex) => {
    paint.fillText(label, x + width / 2, y + 57 + labelIndex * 15, width - 12);
  });
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

const gpt2 = PRODUCTION_SCALE_REFERENCES.gpt2Small;
const gpt3 = PRODUCTION_SCALE_REFERENCES.gpt3;
const P = TEACHING_MODEL_PARAMETERS;
const M = BLOCK_MATRIX_COMPARISON;

/** Slide 1 — what this whole place is. */
function paintWelcome(paint: Paint, index: number, count: number) {
  slideBackdrop(paint, CYAN);
  drawTitle(paint, "A REAL GPT-STYLE MODEL", "MEET THE MODEL");

  paint.textAlign = "left";
  paint.fillStyle = GREEN;
  paint.font = `800 17px ${SANS}`;
  paint.fillText(
    "TRAINABLE DECODER-ONLY TRANSFORMER · REAL TRAINING MATH",
    64,
    132,
    SLIDE_W - 128,
  );

  // The corpus owns the larger half of the page. The visitor should recognize
  // both complete sentences before they have time to read any explanatory copy.
  const corpusX = 64;
  const corpusY = 158;
  const corpusW = 528;
  const corpusH = 334;
  paint.fillStyle = GOLD_TINT;
  paint.fillRect(corpusX, corpusY, corpusW, corpusH);
  paint.strokeStyle = GOLD;
  paint.lineWidth = 2;
  paint.strokeRect(corpusX, corpusY, corpusW, corpusH);
  paint.fillStyle = GOLD;
  paint.font = `800 23px ${SANS}`;
  paint.fillText("ITS ENTIRE TRAINING CORPUS", corpusX + 24, corpusY + 38, corpusW - 48);

  DATA_PREP_TRACE.sources.forEach((source, sentenceIndex) => {
    const cardY = corpusY + 62 + sentenceIndex * 94;
    const accent = sentenceIndex === 0 ? CYAN : BLUE;
    paint.fillStyle = tintFor(accent);
    paint.fillRect(corpusX + 24, cardY, corpusW - 48, 74);
    paint.fillStyle = accent;
    paint.fillRect(corpusX + 24, cardY, 5, 74);
    paint.fillStyle = INK;
    paint.font = `800 30px ${MONO}`;
    paint.fillText(
      `“${source.clean}”`,
      corpusX + 48,
      cardY + 47,
      corpusW - 92,
    );
  });

  paint.fillStyle = INK;
  paint.font = `800 17px ${SANS}`;
  paint.fillText(
    "ALL THE TEXT THIS MODEL TRAINS ON",
    corpusX + 24,
    corpusY + corpusH - 28,
    corpusW - 48,
  );

  // The model facts are the second focal block, not footer trivia: six large
  // cards with values and labels readable during the guided tour's first hold.
  const specsX = 620;
  const specsY = corpusY;
  const specsW = 340;
  const cardGap = 12;
  const cardW = (specsW - cardGap) / 2;
  const cardH = 82;
  paint.fillStyle = CYAN;
  paint.font = `800 23px ${SANS}`;
  paint.fillText("MODEL AT A GLANCE", specsX, specsY + 38, specsW);

  const specs = [
    { value: withThousands(P.total), labels: ["LEARNED", "PARAMETERS"], accent: GREEN },
    { value: `${TEACHING_MODEL.sequenceLength} TOKENS`, labels: ["CONTEXT", "WINDOW"], accent: CYAN },
    { value: String(TEACHING_MODEL.transformerBlocks), labels: ["TRANSFORMER", "LAYERS"], accent: BLUE },
    { value: String(TEACHING_MODEL.attentionHeads), labels: ["ATTENTION", "HEADS"], accent: GOLD },
    { value: `WIDTH ${TEACHING_MODEL.modelWidth}`, labels: ["HIDDEN STATE"], accent: VIOLET },
    { value: `${TEACHING_MODEL.vocabularySize} PIECES`, labels: ["VOCABULARY"], accent: GREEN },
  ] as const;
  specs.forEach((spec, specIndex) => {
    const column = specIndex % 2;
    const row = Math.floor(specIndex / 2);
    drawSpecCard(
      paint,
      specsX + column * (cardW + cardGap),
      specsY + 56 + row * (cardH + cardGap),
      cardW,
      cardH,
      spec.value,
      spec.labels,
      spec.accent,
    );
  });

  drawFooter(
    paint,
    "REAL COMPONENTS · REAL MATRICES · REAL GRADIENTS · REAL ADAMW UPDATE",
    index,
    count,
  );
}

/** Slide 2 — the model's real decoder-only Transformer architecture. */
function paintArchitecture(paint: Paint, index: number, count: number) {
  slideBackdrop(paint, BLUE);
  drawTitle(paint, "THE SAME CORE PARTS AS GPT", "THE ARCHITECTURE");

  paint.textAlign = "left";
  paint.fillStyle = DIM_INK;
  paint.font = `650 17px ${SANS}`;
  paint.fillText(
    "TOKEN IDS BECOME VECTORS, CROSS TWO DECODER LAYERS, THEN BECOME NEXT-TOKEN SCORES.",
    64,
    136,
    SLIDE_W - 128,
  );

  const stageY = 174;
  const stageH = 286;
  const stages = [
    {
      x: 64,
      width: 142,
      accent: GOLD,
      title: "TOKEN IDs",
      lines: ["BATCH 2 × 6", "16-PIECE", "VOCABULARY"],
    },
    {
      x: 236,
      width: 156,
      accent: CYAN,
      title: "EMBEDDINGS",
      lines: ["TOKEN +", "POSITION", "SHAPE", "2 × 6 × 8"],
    },
    {
      x: 422,
      width: 316,
      accent: BLUE,
      title: "2 TRANSFORMER LAYERS",
      lines: [
        "LAYER NORM",
        "2-HEAD CAUSAL ATTENTION",
        "RESIDUAL ADD",
        "LAYER NORM",
        "GELU MLP  8 → 32 → 8",
        "RESIDUAL ADD",
      ],
    },
    {
      x: 768,
      width: 192,
      accent: GREEN,
      title: "OUTPUT",
      lines: ["FINAL NORM", "VOCAB HEAD", "16 SCORES", "PER POSITION"],
    },
  ] as const;

  stages.forEach((stage, stageIndex) => {
    paint.fillStyle = tintFor(stage.accent);
    paint.fillRect(stage.x, stageY, stage.width, stageH);
    paint.strokeStyle = stage.accent;
    paint.lineWidth = 2;
    paint.strokeRect(stage.x, stageY, stage.width, stageH);
    paint.textAlign = "center";
    paint.fillStyle = stage.accent;
    paint.font = `800 ${stageIndex === 2 ? 20 : 18}px ${SANS}`;
    paint.fillText(stage.title, stage.x + stage.width / 2, stageY + 38, stage.width - 16);

    const lineGap = stageIndex === 2 ? 31 : 38;
    const startY = stageY + (stageIndex === 2 ? 82 : 96);
    stage.lines.forEach((line, lineIndex) => {
      paint.fillStyle = lineIndex % 2 === 0 ? INK : DIM_INK;
      paint.font = `700 ${stageIndex === 2 ? 16 : 15}px ${SANS}`;
      paint.fillText(
        line,
        stage.x + stage.width / 2,
        startY + lineIndex * lineGap,
        stage.width - 18,
      );
    });

    if (stageIndex < stages.length - 1) {
      const next = stages[stageIndex + 1];
      paint.fillStyle = FAINT_INK;
      paint.font = `800 27px ${SANS}`;
      paint.fillText(
        "→",
        (stage.x + stage.width + next.x) / 2,
        stageY + stageH / 2 + 8,
      );
    }
  });

  drawFooter(
    paint,
    "EVERY BOX RUNS · EVERY ARROW CARRIES A REAL TENSOR",
    index,
    count,
  );
}

/** Slide 3 — the model itself, every parameter drawn. */
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
    const dotRows = Math.ceil(band.count / dotsPerRow);
    paint.fillStyle = tintFor(band.color);
    paint.fillRect(
      left - 8,
      y - 18,
      dotsPerRow * pitch + 14,
      dotRows * pitch + 31,
    );
    paint.textAlign = "left";
    paint.fillStyle = band.color;
    paint.font = `800 14px ${SANS}`;
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
    y += dotRows * pitch + 14;
  }
  paint.textAlign = "left";
  paint.fillStyle = FAINT_INK;
  paint.font = `700 14px ${SANS}`;
  paint.fillText("every dot is one learned number — all of them are drawn", left, y + 6);

  const panelX = 486;
  const panelW = SLIDE_W - panelX - 64;
  paint.fillStyle = GREEN_TINT;
  paint.fillRect(panelX, 138, panelW, 312);
  paint.strokeStyle = RULE;
  paint.lineWidth = 1;
  paint.strokeRect(panelX, 138, panelW, 312);
  paint.textAlign = "left";
  paint.fillStyle = INK;
  paint.font = `800 18px ${SANS}`;
  paint.fillText("PARAMETER SCALE", panelX + 24, 169, panelW - 48);
  paint.textAlign = "right";
  paint.fillStyle = FAINT_INK;
  paint.font = `700 13px ${SANS}`;
  paint.fillText("LOGARITHMIC · EACH STEP = 10×", panelX + panelW - 24, 169);

  const scaleRows = [
    { label: "THIS MODEL", value: P.total, color: GREEN },
    { label: `${gpt2.name} · ${gpt2.year}`, value: gpt2.parameters, color: BLUE },
    { label: `${gpt3.name} · ${gpt3.year}`, value: gpt3.parameters, color: VIOLET },
  ] as const;
  const minLog = Math.log10(P.total);
  const maxLog = Math.log10(gpt3.parameters);
  const chartX = panelX + 24;
  const chartW = panelW - 48;
  scaleRows.forEach((row, rowIndex) => {
    const labelY = 210 + rowIndex * 83;
    paint.textAlign = "left";
    paint.fillStyle = DIM_INK;
    paint.font = `750 15px ${SANS}`;
    paint.fillText(row.label, chartX, labelY, chartW * 0.62);
    paint.textAlign = "right";
    paint.fillStyle = INK;
    paint.font = `800 17px ${MONO}`;
    paint.fillText(withThousands(row.value), chartX + chartW, labelY);
    paint.fillStyle = tintFor(row.color);
    paint.fillRect(chartX, labelY + 15, chartW, 16);
    const normalized = (Math.log10(row.value) - minLog) / (maxLog - minLog);
    paint.fillStyle = row.color;
    paint.fillRect(chartX, labelY + 15, 34 + normalized * (chartW - 34), 16);
  });

  paint.textAlign = "left";
  paint.fillStyle = FAINT_INK;
  paint.font = `650 14px ${SANS}`;
  paint.fillText(
    `${approximately(gpt2.parameters / P.total)}× and ${approximately(gpt3.parameters / P.total)}× larger`,
    chartX,
    430,
    chartW,
  );

  drawFooter(paint, "Same architecture, same math — fewer numbers", index, count);
}

/**
 * Archived reference painter — one weight matrix, ours against GPT-2's.
 *
 * The strongest image in the deck: GPT-2's projection drawn as a grid of
 * 96 × 96 tiles, each tile exactly the size of this model's entire matrix,
 * with one tile lit gold.
 */
export function paintMatrixScale(paint: Paint, index: number, count: number) {
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

/** Slide 4 — how much text the model can hold in view at once. */
function paintContextWindow(paint: Paint, index: number, count: number) {
  slideBackdrop(paint, CYAN);
  drawTitle(paint, "IT CAN ONLY SEE SIX TOKENS AT A TIME", "SCALE · CONTEXT WINDOW");

  const tokens = SELECTED_TRACE.batch.inputTokenIds[0].map(
    (id) => SELECTED_TRACE.vocabulary[id],
  );
  const cellW = 128;
  const gap = 10;
  const tokenColors = [GOLD, CYAN, BLUE, GREEN, VIOLET, CYAN] as const;
  tokens.forEach((token, tokenIndex) => {
    const x = 64 + tokenIndex * (cellW + gap);
    const tokenColor = tokenColors[tokenIndex] ?? CYAN;
    paint.fillStyle = tintFor(tokenColor);
    paint.fillRect(x, 154, cellW, 60);
    paint.strokeStyle = tokenColor;
    paint.lineWidth = 2;
    paint.strokeRect(x, 154, cellW, 60);
    paint.textAlign = "center";
    paint.fillStyle = INK;
    paint.font = `800 20px ${MONO}`;
    paint.fillText(token, x + cellW / 2, 192, cellW - 12);
  });
  paint.textAlign = "left";
  paint.fillStyle = GREEN;
  paint.font = `800 20px ${SANS}`;
  paint.fillText(
    `${TEACHING_MODEL.sequenceLength} tokens — one context window`,
    64,
    248,
    SLIDE_W - 128,
  );

  // An honest linear chart: GPT-3 owns the full width, GPT-2 exactly half,
  // and this specimen remains a visible minimum marker at the origin.
  paint.fillStyle = FAINT_INK;
  paint.font = `700 14px ${SANS}`;
  paint.fillText("CONTEXT LENGTH · LINEAR SCALE", 64, 278, SLIDE_W - 128);
  const contextChartW = SLIDE_W - 128;
  [
    { label: gpt3.name, length: gpt3.contextLength, color: VIOLET, y: 304 },
    { label: gpt2.name, length: gpt2.contextLength, color: BLUE, y: 366 },
    { label: "THIS MODEL", length: TEACHING_MODEL.sequenceLength, color: CYAN, y: 428 },
  ].forEach((row) => {
    paint.fillStyle = tintFor(row.color);
    paint.fillRect(64, row.y - 22, contextChartW, 58);
    paint.textAlign = "left";
    paint.fillStyle = DIM_INK;
    paint.font = `750 15px ${SANS}`;
    paint.fillText(row.label, 64, row.y, contextChartW * 0.6);
    paint.textAlign = "right";
    paint.fillStyle = INK;
    paint.font = `800 16px ${MONO}`;
    paint.fillText(`${withThousands(row.length)} TOKENS`, SLIDE_W - 64, row.y);
    paint.fillStyle = "rgba(255, 255, 255, 0.72)";
    paint.fillRect(64, row.y + 12, contextChartW, 18);
    paint.fillStyle = row.color;
    paint.fillRect(
      64,
      row.y + 12,
      Math.max(12, (row.length / gpt3.contextLength) * contextChartW),
      18,
    );
  });

  drawStat(
    paint,
    64,
    494,
    `${Math.round(gpt2.contextLength / TEACHING_MODEL.sequenceLength)} times`,
    `LONGER WINDOW IN ${gpt2.name}`,
    BLUE,
    28,
  );
  drawStat(
    paint,
    520,
    494,
    `${Math.round(gpt3.contextLength / TEACHING_MODEL.sequenceLength)} times`,
    `LONGER WINDOW IN ${gpt3.name}`,
    VIOLET,
    28,
  );
  drawFooter(paint, "Anything outside the window does not exist to the model", index, count);
}

/** Archived reference painter — the complete vocabulary. */
export function paintVocabulary(paint: Paint, index: number, count: number) {
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

/** Slide 5 — why everything is small, and what to do next. */
function paintWhy(paint: Paint, index: number, count: number) {
  slideBackdrop(paint, GREEN);
  drawTitle(paint, "SAME MATH, SPECIMEN SIZE", "WHY IT IS THIS SMALL");

  paint.textAlign = "left";
  paint.fillStyle = INK;
  paint.font = `800 22px ${SANS}`;
  paint.fillText("NOTHING AHEAD IS SIMPLIFIED.", 64, 148, SLIDE_W - 128);

  const proofTiles = [
    { title: "ATTENTION", caption: "same causal softmax", color: CYAN },
    { title: "CROSS-ENTROPY", caption: "same next-token loss", color: GOLD },
    { title: "BACKPROPAGATION", caption: "same gradients", color: BLUE },
    { title: "ADAMW", caption: "same optimizer update", color: GREEN },
  ] as const;
  const proofGap = 12;
  const proofW = (SLIDE_W - 128 - proofGap * 3) / 4;
  proofTiles.forEach((tile, tileIndex) => {
    const x = 64 + tileIndex * (proofW + proofGap);
    paint.fillStyle = tintFor(tile.color);
    paint.fillRect(x, 168, proofW, 82);
    paint.strokeStyle = RULE;
    paint.lineWidth = 1;
    paint.strokeRect(x, 168, proofW, 82);
    paint.fillStyle = tile.color;
    paint.fillRect(x, 168, proofW, 5);
    paint.fillStyle = INK;
    paint.font = `800 17px ${SANS}`;
    paint.fillText(tile.title, x + 14, 202, proofW - 28);
    paint.fillStyle = DIM_INK;
    paint.font = `650 14px ${SANS}`;
    paint.fillText(tile.caption, x + 14, 229, proofW - 28);
  });

  const facts = [
    { value: `${TEACHING_MODEL.transformerBlocks} blocks`, caption: `GPT-2 SMALL HAS ${gpt2.transformerBlocks}`, color: CYAN },
    { value: `${TEACHING_MODEL.attentionHeads} heads`, caption: `GPT-2 SMALL HAS ${gpt2.attentionHeads}`, color: BLUE },
    { value: `width ${TEACHING_MODEL.modelWidth}`, caption: `GPT-2 SMALL USES ${gpt2.modelWidth}`, color: VIOLET },
  ];
  facts.forEach((fact, factIndex) => {
    const x = 64 + factIndex * 316;
    paint.fillStyle = tintFor(fact.color);
    paint.fillRect(x, 274, 296, 74);
    drawStat(paint, x + 16, 316, fact.value, fact.caption, fact.color, 30);
  });

  paint.fillStyle = GREEN_TINT;
  paint.fillRect(64, 368, SLIDE_W - 128, 122);
  paint.fillStyle = GREEN;
  paint.fillRect(64, 368, 5, 122);
  paint.textAlign = "left";
  paint.fillStyle = INK;
  paint.font = `800 19px ${SANS}`;
  paint.fillText("NEXT · THROUGH THE DOOR, THIS BATCH STARTS MOVING", 92, 400, SLIDE_W - 220);
  paint.fillStyle = GOLD;
  paint.font = `800 21px ${MONO}`;
  DATA_PREP_TRACE.sources.forEach((source, sourceIndex) => {
    paint.fillStyle = sourceIndex === 0 ? CYAN : BLUE;
    paint.fillText(`“${source.clean}”`, 92, 437 + sourceIndex * 34, SLIDE_W - 220);
  });

  drawFooter(paint, "Walk around the stage to enter the data wing", index, count);
}

/**
 * Exported so `.qa/render-slides.mjs` can draw the real deck to reviewable
 * images without launching the 3D world; nothing in the app reads it.
 */
export const SLIDE_PAINTERS = [
  paintWelcome,
  paintArchitecture,
  paintModelSize,
  paintContextWindow,
  paintWhy,
] as const;

/** Canvas resolution each painter draws into. */
export const SLIDE_PIXELS = { width: SLIDE_W, height: SLIDE_H } as const;

/** Physical accents echo the darker print palette without emitting light. */
const SLIDE_ACCENTS = ["#37c6c0", "#5f8de8", "#4cbf83", "#37c6c0", "#4cbf83"] as const;

/** Short names, used by the layout audit's per-surface report. */
const SLIDE_TITLES = [
  "meet the model",
  "architecture",
  "model size",
  "context window",
  "why so small",
] as const;

export const ORIENTATION_SLIDE_COUNT = SLIDE_PAINTERS.length;

// ---------------------------------------------------------------------------
// Gallery geometry
//
// The hall is a processional gallery: placards stand in bays that alternate
// left and right down the room, each turned to face a viewing mark on the
// central promenade a little downstream of it. That angle is what keeps the room
// readable — from any mark the placard being read is square-on and nearly
// fills the view, while its neighbours are steeply oblique and read as thin
// slivers. Everything below is derived from these five numbers so the
// placards, their lighting, and the camera tour cannot disagree.
// ---------------------------------------------------------------------------

/** Placard face width in chamber units; height follows the canvas aspect. */
const PLACARD_W = 16;
const PLACARD_H = (SLIDE_H / SLIDE_W) * PLACARD_W;
/** Centre height of a placard face. */
const PLACARD_Y = 2.2;
/** Bay centre, pulled forward from the continuous cube wall behind it. */
const BAY_X = 23.5;
/** z of the first bay, and the generous gap between consecutive bays. */
const BAY_Z_START = 27;
const BAY_Z_STEP = 14.5;
/** How far downstream of its placard a viewing mark sits. */
const VIEW_AHEAD = 8.5;
/**
 * How far the viewing mark steps off the centre line toward its placard.
 *
 * The room's wide central promenade lets each reading mark move with its bay.
 * The 17.2-unit reading distance keeps a 16-unit page large enough to study
 * while leaving the continuous cube wall visible behind each installation.
 */
const VIEW_LATERAL = 8.5;
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
 * Per-bay blockers protect the angled lightboxes without fencing off the whole
 * wall. Visitors can use the generous centre promenade and the gaps between
 * installations, while still keeping about three units from each housing.
 */
export const ORIENTATION_BAY_BLOCKERS = SLIDE_PAINTERS.map((_, index) => {
  const side = baySide(index);
  const z = BAY_Z_START - index * BAY_Z_STEP;
  const inner = 16;
  const outer = BAY_X + 6;
  const halfDepth = 10;
  return {
    minX: side < 0 ? -outer : inner,
    maxX: side < 0 ? -inner : outer,
    minY: -4.7,
    maxY: 14,
    minZ: z - halfDepth,
    maxZ: z + halfDepth,
  };
});

interface Placard {
  group: THREE.Group;
  /** Opaque paper face; focus is communicated by the surround, never fading. */
  faceMaterial: THREE.MeshBasicMaterial;
  frameMaterial: THREE.MeshStandardMaterial;
  numberMaterial: THREE.MeshBasicMaterial;
}

/**
 * One warm-white museum display in a slim brushed-metal support. The display
 * has no emissive frame, halo, beam, or floor glow.
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

  const group = new THREE.Group();
  group.name = `orientation-placard-${index + 1}`;

  // A pale brushed surround lets the printed page, not a black monitor bezel,
  // remain the object the visitor sees first.
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: "#d8d4ca",
    emissive: "#000000",
    emissiveIntensity: 0,
    roughness: 0.5,
    metalness: 0.32,
  });
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(PLACARD_W + 0.34, PLACARD_H + 0.34, 0.18),
    frameMaterial,
  );
  frame.position.z = -0.11;
  group.add(frame);

  const faceMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    color: "#efece4",
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(PLACARD_W, PLACARD_H),
    faceMaterial,
  );
  face.name = `orientation-placard-face-${index + 1}`;
  face.renderOrder = 12;
  group.add(face);

  // A narrow support remains for the legacy room; the crafted room wraps it in
  // an even shallower wall-seat. Both avoid the old full-width black pedestal.
  const postMaterial = new THREE.MeshStandardMaterial({
    color: "#aeb2b3",
    roughness: 0.54,
    metalness: 0.42,
  });
  // The gallery's floor is the panel deck, so the support lands on the glass
  // rather than on the slab that used to be the walking surface.
  const floorLocalY = CHAMBER_PANEL_DECK_TOP_Y - PLACARD_Y;
  const pylonTop = -PLACARD_H / 2 - 0.1;
  const pylonHeight = pylonTop - floorLocalY - 0.34;
  const pylon = new THREE.Mesh(
    new THREE.BoxGeometry(PLACARD_W * 0.18, pylonHeight, 0.34),
    postMaterial,
  );
  pylon.position.set(0, pylonTop - pylonHeight / 2, -0.12);
  group.add(pylon);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(PLACARD_W * 0.44, 0.26, 1.2),
    postMaterial,
  );
  base.position.set(0, floorLocalY + 0.13, -0.05);
  group.add(base);


  // Printed numeral label under the sheet, matching the warm paper system.
  const numberCanvas = document.createElement("canvas");
  numberCanvas.width = 128;
  numberCanvas.height = 64;
  const numberPaint = numberCanvas.getContext("2d");
  if (numberPaint) {
    numberPaint.fillStyle = "#fbfaf6";
    numberPaint.fillRect(0, 0, 128, 64);
    numberPaint.strokeStyle = "#b8b1a4";
    numberPaint.lineWidth = 3;
    numberPaint.strokeRect(3, 3, 122, 58);
    numberPaint.fillStyle = "#30343a";
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
    color: "#efece4",
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: true,
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

  return { group, faceMaterial, frameMaterial, numberMaterial };
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
 * Builds the orientation gallery: five paper-white lightboxes in alternating bays down
 * the hall, with the chamber's process transport deciding which one is
 * currently being read.
 *
 * Nothing is hidden. Every warm-white page remains fully opaque, and the
 * "current" one is indicated by the guided camera rather than light emission. That matters because the
 * visitor can leave the tour at any moment and walk the gallery themselves;
 * a room where four of five panels were switched off would look broken.
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
    // continuous position used to bring in the exit invitation at the end.
    const reading = p * placards.length;
    const breathe = motionEnabled ? (Math.sin(elapsed * 0.8) + 1) * 0.5 : 0.5;

    placards.forEach((placard) => {
      // Paper stays paper-white; focus never turns the other pages muddy gray.
      placard.faceMaterial.opacity = 1;
      placard.frameMaterial.emissiveIntensity = 0;
      placard.numberMaterial.opacity = 1;
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
