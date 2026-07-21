import * as THREE from "three";

import { SELECTED_TRACE } from "../../lib/trainingTrace";
import {
  createGlyph,
  createPacket,
  createPanel,
  createPath,
  createProcessMaterial,
  createValueBoard,
  moveObject,
  pulseObject,
  resetScale,
  samplePath,
  setObjectEmissive,
  setObjectOpacity,
  smoothStep,
  vector,
  windowPulse,
} from "./processShared";
import type {
  ChamberProcessContext,
  ChamberProcessUpdater,
} from "./processShared";

const CYAN = "#47d7ff";
const BLUE = "#76a9ff";
const VIOLET = "#b59cff";
const GREEN = "#69efb6";
const GOLD = "#ffd166";
const MAGENTA = "#ff70d5";
const CORAL = "#ff765f";
const WHITE = "#f4fbff";
const UNKNOWN_EIGHT = Array.from({ length: 8 }, () => "·");
const UNKNOWN_TWELVE = Array.from({ length: 12 }, () => "·");

function createDeck(
  size: THREE.Vector3,
  color: THREE.ColorRepresentation,
  opacity = 0.72,
) {
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    createProcessMaterial(color, 0.34, opacity),
  );
  const edgeMaterial = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  deck.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)),
      edgeMaterial,
    ),
  );
  return deck;
}

function createFrame(
  size: THREE.Vector3,
  color: THREE.ColorRepresentation,
) {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
  );
}

function showPacket(
  packet: THREE.Object3D,
  points: readonly THREE.Vector3[],
  progress: number,
  start: number,
  end: number,
  elapsed: number,
  motionEnabled: boolean,
  arcHeight = 0.22,
) {
  const active = progress >= start && progress <= end;
  setObjectOpacity(packet, active ? 1 : 0);
  if (!active) return;
  const local = smoothStep(progress, start, end);
  samplePath(packet, points, local, arcHeight);
  packet.rotation.x = motionEnabled ? elapsed * 1.3 : 0;
  packet.rotation.y = motionEnabled ? elapsed * 0.9 : 0;
}

function setBoardFocus(
  board: THREE.Object3D,
  progress: number,
  start: number,
  end: number,
) {
  const reveal = smoothStep(progress, start, end);
  setObjectOpacity(board, reveal);
  board.scale.setScalar(0.9 + reveal * 0.1);
}

function sourceRows() {
  return SELECTED_TRACE.batch.inputTokenIds.map((row, rowIndex) => [
    ...row,
    SELECTED_TRACE.batch.targetTokenIds[rowIndex][row.length - 1],
  ]);
}

function buildTrainingComplex(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const process = new THREE.Group();
  process.name = "early-process-training-complex-circuit";
  context.group.add(process);

  const title = createPanel(
    ["ONE COMPLETE LEARNING STEP", "cyan forward · coral backward · gold update"],
    { width: 8.8, height: 1.35, color: WHITE, borderColor: context.palette.phaseBase },
  );
  title.position.set(0, 4.35, 5.85);
  process.add(title);

  const inputBoard = createValueBoard(
    SELECTED_TRACE.batch.inputTokenIds.flat(),
    2,
    6,
    {
      width: 4.4,
      cellHeight: 0.43,
      title: "X [2 x 6]",
      subtitle: "12 input token IDs",
      color: CYAN,
    },
  );
  inputBoard.position.set(-6.35, -0.65, 4.6);
  process.add(inputBoard);

  const targetBoard = createValueBoard(
    SELECTED_TRACE.batch.targetTokenIds.flat(),
    2,
    6,
    {
      width: 4.4,
      cellHeight: 0.43,
      title: "Y [2 x 6]",
      subtitle: "answers take a separate route",
      color: MAGENTA,
    },
  );
  targetBoard.position.set(-6.35, 1.7, 4.6);
  process.add(targetBoard);

  const tower = new THREE.Group();
  tower.name = "training-circuit-two-block-tower";
  for (let floor = 0; floor < 2; floor += 1) {
    const slab = createDeck(new THREE.Vector3(5.1, 0.32, 3.3), BLUE, 0.82);
    slab.position.y = -1.05 + floor * 2.15;
    tower.add(slab);
    const floorLabel = createPanel([`BLOCK ${floor}`, "parameters read only"], {
      width: 3.4,
      height: 0.82,
      color: WHITE,
      borderColor: GOLD,
      fontScale: 0.72,
    });
    floorLabel.position.set(0, -0.42 + floor * 2.15, 1.85);
    tower.add(floorLabel);
  }
  const towerSpine = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 4.55, 14),
    createProcessMaterial(CYAN, 1.2),
  );
  tower.add(towerSpine);
  tower.position.set(0, 0, 1.05);
  process.add(tower);

  const logitsBoard = createValueBoard(
    SELECTED_TRACE.output.selectedLogits,
    4,
    4,
    {
      width: 4.25,
      cellHeight: 0.38,
      title: "selected logits [16]",
      subtitle: "batch 0 · position 2",
      color: BLUE,
      highlightedIndices: [5, 6],
      accent: GOLD,
    },
  );
  logitsBoard.position.set(6.35, 1.45, 1.4);
  process.add(logitsBoard);

  const lossBoard = createValueBoard(
    [SELECTED_TRACE.output.meanLoss],
    1,
    1,
    {
      width: 2.7,
      cellHeight: 0.86,
      title: "MEAN LOSS L",
      subtitle: "12 penalties -> 1 scalar",
      color: GOLD,
      accent: GOLD,
      highlightedIndices: [0],
    },
  );
  lossBoard.position.set(5.7, -1.3, -4.85);
  process.add(lossBoard);

  const weightBoard = createValueBoard(
    [
      SELECTED_TRACE.optimizer.weightBefore,
      SELECTED_TRACE.optimizer.gradient,
      SELECTED_TRACE.optimizer.deltaWeight,
      SELECTED_TRACE.optimizer.weightAfter,
    ],
    1,
    4,
    {
      width: 5.4,
      cellHeight: 0.66,
      title: "w | grad | delta | w'",
      subtitle: "AdamW changes WQ[3,6] only after backward",
      color: GOLD,
      highlightedIndices: [3],
      accent: GREEN,
    },
  );
  weightBoard.position.set(-3.25, 1.2, -5.75);
  process.add(weightBoard);

  const nextPanel = createPanel(["theta' READY", "NEXT BATCH"], {
    width: 3.25,
    height: 1.15,
    color: GREEN,
    borderColor: GREEN,
  });
  nextPanel.position.set(-7.0, -1.35, -2.55);
  process.add(nextPanel);

  const productionPlaque = createPanel(
    [
      "WHAT PRODUCTION ADDS AROUND THIS LOOP",
      "validation runs · checkpoints",
      "mixed precision · data + model parallelism",
    ],
    {
      width: 5.9,
      height: 1.6,
      color: "#d9e7ff",
      borderColor: GOLD,
      fontScale: 0.6,
    },
  );
  productionPlaque.position.set(7.15, 3.75, 3.3);
  process.add(productionPlaque);

  const forwardPoints = [
    vector(-6.6, -1.9, 4.2),
    vector(-2.8, -1.9, 2.5),
    vector(0, -1.25, 1.1),
    vector(3.2, -0.3, 1.0),
    vector(6.2, -0.2, -0.15),
    vector(5.7, -1.7, -4.4),
  ];
  const targetPoints = [
    vector(-6.7, 0.55, 4.0),
    vector(-8.0, 0.2, 0),
    vector(-7.4, -0.2, -4.8),
    vector(5.1, -1.0, -4.9),
  ];
  const reversePoints = [...forwardPoints].reverse().map((point) => point.clone().setY(point.y + 1.35));
  const updatePoints = [
    reversePoints[reversePoints.length - 1],
    vector(-2.9, 0.5, -5.0),
    vector(-6.8, -1.0, -2.8),
  ];
  process.add(createPath(forwardPoints, CYAN, 0.075, 0.5));
  process.add(createPath(targetPoints, MAGENTA, 0.055, 0.42));
  process.add(createPath(reversePoints, CORAL, 0.065, 0.46));
  process.add(createPath(updatePoints, GOLD, 0.06, 0.5));
  const forwardPacket = createPacket(CYAN, 0.25);
  const targetPacket = createPacket(MAGENTA, 0.22);
  const reversePacket = createPacket(CORAL, 0.24);
  const updatePacket = createPacket(GOLD, 0.23);
  process.add(forwardPacket, targetPacket, reversePacket, updatePacket);

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const motionTime = motionEnabled ? elapsed : 0;
    setObjectOpacity(inputBoard, 1);
    setObjectOpacity(targetBoard, 1);
    setBoardFocus(logitsBoard, p, 0.3, 0.48);
    setBoardFocus(lossBoard, p, 0.48, 0.62);
    setBoardFocus(weightBoard, p, 0.76, 0.91);
    setBoardFocus(nextPanel, p, 0.9, 0.98);
    const towerFocus = windowPulse(p, 0.08, 0.29, 0.52);
    setObjectEmissive(tower, 0.42 + towerFocus * 1.0);
    if (motionEnabled) {
      towerSpine.rotation.y = motionTime * 0.7;
    } else {
      towerSpine.rotation.y = 0;
    }
    showPacket(forwardPacket, forwardPoints, p, 0.06, 0.5, motionTime, motionEnabled);
    showPacket(targetPacket, targetPoints, p, 0.28, 0.59, motionTime, motionEnabled, 0.38);
    showPacket(reversePacket, reversePoints, p, 0.61, 0.82, motionTime, motionEnabled);
    showPacket(updatePacket, updatePoints, p, 0.82, 0.97, motionTime, motionEnabled);
  };
  updater(0, 0, false);
  return updater;
}

function buildTokenStream(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const process = new THREE.Group();
  process.name = "early-process-context-window-rail-tunnel";
  context.group.add(process);

  const rows = sourceRows();
  const title = createPanel(["TWO INDEPENDENT TOKEN STREAMS", "clamp exactly T+1 = 7"], {
    width: 8.4,
    height: 1.25,
    color: WHITE,
    borderColor: context.palette.phaseBase,
  });
  title.position.set(0, 4.25, 5.6);
  process.add(title);

  const streamBoards = rows.map((row, rowIndex) => {
    const board = createValueBoard(row, 1, 7, {
      width: 5.7,
      cellHeight: 0.58,
      title: `SOURCE ROW ${rowIndex}`,
      subtitle: rowIndex === 0 ? "<bos> the cat sat on the mat" : "<bos> a small model can learn <eos>",
      color: BLUE,
    });
    board.position.set(rowIndex === 0 ? -4.1 : 4.1, -0.55, 6.0);
    process.add(board);
    return board;
  });

  const clamps = [-4.1, 4.1].map((x, rowIndex) => {
    const clamp = createFrame(new THREE.Vector3(6.1, 2.25, 0.62), GOLD);
    clamp.name = `seven-token-selection-clamp-${rowIndex}`;
    clamp.position.set(x, 4.2, 0.55);
    process.add(clamp);
    return clamp;
  });

  const outputDocks = [-4.1, 4.1].map((x, rowIndex) => {
    const deck = createDeck(new THREE.Vector3(6.4, 0.24, 2.2), rowIndex ? VIOLET : CYAN, 0.7);
    deck.position.set(x, -2.25, -5.2);
    process.add(deck);
    return deck;
  });

  const preview = createPanel(
    ["SELECTED S[b,0:7]", "next chamber: X=0:6 · Y=1:7", "batch rows never mix"],
    { width: 7.2, height: 1.45, color: GOLD, borderColor: GOLD, fontScale: 0.82 },
  );
  preview.position.set(0, 3.35, -5.45);
  process.add(preview);

  const cutterPanel = createPanel(["WINDOW CUTTER", "7 consecutive positions"], {
    width: 3.8,
    height: 0.95,
    color: GOLD,
    borderColor: GOLD,
    fontScale: 0.75,
  });
  cutterPanel.position.set(0, 2.2, 0.65);
  process.add(cutterPanel);

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const arrive = smoothStep(p, 0, 0.28);
    const lift = smoothStep(p, 0.34, 0.52);
    const extract = smoothStep(p, 0.52, 0.82);
    streamBoards.forEach((board, rowIndex) => {
      const laneX = rowIndex === 0 ? -4.1 : 4.1;
      if (p < 0.34) {
        moveObject(board, vector(laneX, -0.55, 6), vector(laneX, -0.55, 0.55), arrive);
      } else if (p < 0.52) {
        board.position.set(laneX, THREE.MathUtils.lerp(-0.55, 1.0, lift), 0.55);
      } else {
        moveObject(board, vector(laneX, 1.0, 0.55), vector(laneX, 0.25, -5.1), extract, 0.42);
      }
      setObjectOpacity(board, 1);
      if (motionEnabled && p < 0.28) board.position.z += Math.sin(elapsed * 2.2 + rowIndex) * 0.04;
    });
    clamps.forEach((clamp, rowIndex) => {
      const lock = smoothStep(p, 0.2 + rowIndex * 0.02, 0.36 + rowIndex * 0.02);
      clamp.position.y = THREE.MathUtils.lerp(4.2, 0.45, lock);
      setObjectOpacity(clamp, smoothStep(p, 0.14, 0.25));
      setObjectEmissive(clamp, 0.5 + windowPulse(p, 0.19, 0.34, 0.52) * 1.2);
    });
    outputDocks.forEach((dock) => setObjectEmissive(dock, 0.35 + smoothStep(p, 0.62, 0.84) * 0.8));
    setBoardFocus(preview, p, 0.78, 0.94);
  };
  updater(0, 0, false);
  return updater;
}

function buildBatchShift(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const process = new THREE.Group();
  process.name = "early-process-batch-shift-split-level-yard";
  context.group.add(process);

  const rows = sourceRows();
  const source = createValueBoard(rows.flat(), 2, 7, {
    width: 7.2,
    cellHeight: 0.46,
    title: "SOURCE S [2 x 7]",
    subtitle: "duplicate, then take two offset slices",
    color: BLUE,
  });
  source.position.set(0, 2.15, 5.35);
  process.add(source);

  const copyX = createValueBoard(rows.flat(), 2, 7, {
    width: 5.1,
    cellHeight: 0.38,
    title: "COPY FOR X",
    subtitle: "keep columns 0:6",
    color: CYAN,
    highlightedIndices: [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12],
  });
  const copyY = createValueBoard(rows.flat(), 2, 7, {
    width: 5.1,
    cellHeight: 0.38,
    title: "COPY FOR Y",
    subtitle: "drop column 0, shift left",
    color: MAGENTA,
    highlightedIndices: [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13],
  });
  copyX.position.copy(source.position);
  copyY.position.copy(source.position);
  process.add(copyX, copyY);

  const sliceX = createPanel(["SLICE 0:6", "discard last source token"], {
    width: 3.8,
    height: 1.0,
    color: CYAN,
    borderColor: CYAN,
  });
  const sliceY = createPanel(["SHIFT LEFT ONE", "discard first source token"], {
    width: 3.8,
    height: 1.0,
    color: MAGENTA,
    borderColor: MAGENTA,
  });
  sliceX.position.set(-4.7, 3.35, 0.65);
  sliceY.position.set(4.7, 3.35, 0.65);
  process.add(sliceX, sliceY);

  const xBoard = createValueBoard(SELECTED_TRACE.batch.inputTokenIds.flat(), 2, 6, {
    width: 5.25,
    cellHeight: 0.48,
    title: "X = S[:,0:6]",
    subtitle: "cyan route -> model",
    color: CYAN,
  });
  const yBoard = createValueBoard(SELECTED_TRACE.batch.targetTokenIds.flat(), 2, 6, {
    width: 5.25,
    cellHeight: 0.48,
    title: "Y = S[:,1:7]",
    subtitle: "answer route -> loss only",
    color: MAGENTA,
  });
  xBoard.position.set(-4.75, -0.15, -3.85);
  yBoard.position.set(4.75, -0.15, -3.85);
  process.add(xBoard, yBoard);

  const pairPanel = createPanel(
    ["12 NEXT-TOKEN PAIRS", "cat (4) -> sat (5)", "answers never enter attention"],
    { width: 5.4, height: 1.45, color: GOLD, borderColor: GOLD },
  );
  pairPanel.position.set(0, 2.0, -5.8);
  process.add(pairPanel);

  const forkPoint = vector(0, 0.15, 2.8);
  const xPath = [forkPoint, vector(-4.7, 0.15, 0.5), vector(-4.75, -0.8, -7.2)];
  const yPath = [forkPoint, vector(4.7, 0.85, 0.5), vector(4.75, 0.55, -7.2)];
  process.add(createPath(xPath, CYAN, 0.06, 0.48));
  process.add(createPath(yPath, MAGENTA, 0.06, 0.48));
  const xPacket = createPacket(CYAN, 0.22);
  const yPacket = createPacket(MAGENTA, 0.22);
  process.add(xPacket, yPacket);

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    setObjectOpacity(source, 1);
    const fork = smoothStep(p, 0.14, 0.32);
    moveObject(copyX, source.position, vector(-4.75, 0.55, 0.75), fork, 0.35);
    moveObject(copyY, source.position, vector(4.75, 0.55, 0.75), fork, 0.35);
    setObjectOpacity(copyX, 1 - smoothStep(p, 0.5, 0.64));
    setObjectOpacity(copyY, 1 - smoothStep(p, 0.5, 0.64));
    setBoardFocus(sliceX, p, 0.28, 0.44);
    setBoardFocus(sliceY, p, 0.32, 0.48);
    setBoardFocus(xBoard, p, 0.52, 0.68);
    setBoardFocus(yBoard, p, 0.56, 0.72);
    setBoardFocus(pairPanel, p, 0.68, 0.84);
    showPacket(xPacket, xPath, p, 0.7, 0.96, elapsed, motionEnabled);
    showPacket(yPacket, yPath, p, 0.72, 0.98, elapsed, motionEnabled, 0.4);
  };
  updater(0, 0, false);
  return updater;
}

function buildEmbedding(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const process = new THREE.Group();
  process.name = "early-process-embedding-archive-addition-altar";
  context.group.add(process);

  const embeddingDots = Array.from({ length: 16 * 8 }, () => "·");
  const positionDots = Array.from({ length: 6 * 8 }, () => "·");
  const embeddingWall = createValueBoard(embeddingDots, 16, 8, {
    width: 4.7,
    cellHeight: 0.17,
    title: "E [16 x 8] LEARNED",
    subtitle: "ID 4 selects one row",
    color: GOLD,
    accent: CYAN,
    highlightedIndices: Array.from({ length: 8 }, (_, index) => 4 * 8 + index),
  });
  embeddingWall.position.set(-5.9, 1.1, 1.8);
  embeddingWall.name = "assistant-target-embedding-token-table";
  process.add(embeddingWall);

  const positionWall = createValueBoard(positionDots, 6, 8, {
    width: 4.7,
    cellHeight: 0.28,
    title: "P [6 x 8] LEARNED",
    subtitle: "position 2 selects one row",
    color: GOLD,
    accent: VIOLET,
    highlightedIndices: Array.from({ length: 8 }, (_, index) => 2 * 8 + index),
  });
  positionWall.position.set(5.9, 1.75, 1.8);
  positionWall.name = "assistant-target-embedding-position-table";
  process.add(positionWall);

  const address = createValueBoard(["cat", SELECTED_TRACE.embedding.selectedTokenId], 1, 2, {
    width: 3.0,
    cellHeight: 0.62,
    title: "TOKEN ADDRESS",
    subtitle: "ID is not a magnitude",
    color: CYAN,
    highlightedIndices: [1],
    accent: GOLD,
  });
  address.position.set(-5.9, -1.85, 5.75);
  address.name = "assistant-target-embedding-token-address";
  process.add(address);
  const positionTicket = createValueBoard(["pos", SELECTED_TRACE.embedding.selectedPosition], 1, 2, {
    width: 3.0,
    cellHeight: 0.62,
    title: "POSITION ADDRESS",
    color: VIOLET,
    highlightedIndices: [1],
    accent: GOLD,
  });
  positionTicket.position.set(5.9, -1.85, 5.75);
  positionTicket.name = "assistant-target-embedding-position-address";
  process.add(positionTicket);

  const tokenRow = createValueBoard(SELECTED_TRACE.embedding.selectedTokenVector, 1, 8, {
    width: 4.4,
    cellHeight: 0.56,
    title: "E[4,:]",
    subtitle: "selected learned token row",
    color: CYAN,
  });
  const positionRow = createValueBoard(SELECTED_TRACE.embedding.selectedPositionVector, 1, 8, {
    width: 4.4,
    cellHeight: 0.56,
    title: "P[2,:]",
    subtitle: "selected learned position row",
    color: VIOLET,
  });
  tokenRow.position.set(-5.9, 0.0, 1.6);
  tokenRow.name = "assistant-target-embedding-selected-token-row";
  positionRow.position.set(5.9, 0.0, 1.6);
  positionRow.name = "assistant-target-embedding-selected-position-row";
  process.add(tokenRow, positionRow);

  const plus = createGlyph("+", GOLD, 1.25);
  plus.position.set(0, 0.2, -1.65);
  const equals = createGlyph("=", WHITE, 1.25);
  equals.position.set(0, 0.2, -3.45);
  process.add(plus, equals);

  const result = createValueBoard(SELECTED_TRACE.embedding.selectedHiddenVector, 1, 8, {
    width: 4.7,
    cellHeight: 0.6,
    title: "H0[0,2,:] = E[4,:] + P[2,:]",
    subtitle: "the eight displayed sums are exact",
    color: GREEN,
    accent: GREEN,
    highlightedIndices: Array.from({ length: 8 }, (_, index) => index),
  });
  result.position.set(0, 0.1, -5.5);
  result.name = "assistant-target-embedding-sum-result";
  process.add(result);

  const outputSlots = createValueBoard(UNKNOWN_TWELVE, 2, 6, {
    width: 5.3,
    cellHeight: 0.36,
    title: "H0 [2 x 6 x 8]",
    subtitle: "12 moving width-8 vectors",
    color: GREEN,
    unknownIndices: Array.from({ length: 12 }, (_, index) => index),
    highlightedIndices: [2],
    accent: GOLD,
  });
  outputSlots.position.set(0, 3.25, -5.3);
  outputSlots.name = "assistant-target-embedding-hidden-state-output";
  process.add(outputSlots);

  const tokenStart = tokenRow.position.clone();
  const positionStart = positionRow.position.clone();
  const tokenOperand = vector(-3.25, 0.15, -1.65);
  const positionOperand = vector(3.25, 0.15, -1.65);
  const tokenMerge = vector(-2.35, 0.15, -2.2);
  const positionMerge = vector(2.35, 0.15, -2.2);

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const select = smoothStep(p, 0.08, 0.3);
    const align = smoothStep(p, 0.3, 0.5);
    const merge = smoothStep(p, 0.5, 0.7);
    setObjectOpacity(address, 1);
    setObjectOpacity(positionTicket, 1);
    setObjectEmissive(embeddingWall, 0.3 + windowPulse(p, 0.04, 0.2, 0.4) * 1.1);
    setObjectEmissive(positionWall, 0.3 + windowPulse(p, 0.08, 0.24, 0.44) * 1.1);
    if (p < 0.3) {
      moveObject(tokenRow, tokenStart, tokenOperand, select, 0.3);
      moveObject(positionRow, positionStart, positionOperand, select, 0.3);
    } else if (p < 0.5) {
      moveObject(tokenRow, tokenOperand, tokenMerge, align);
      moveObject(positionRow, positionOperand, positionMerge, align);
    } else {
      tokenRow.position.copy(tokenMerge);
      positionRow.position.copy(positionMerge);
    }
    setObjectOpacity(tokenRow, 1 - smoothStep(p, 0.62, 0.74));
    setObjectOpacity(positionRow, 1 - smoothStep(p, 0.62, 0.74));
    setBoardFocus(plus, p, 0.3, 0.46);
    plus.scale.setScalar((0.9 + align * 0.1) * (motionEnabled ? 1 + Math.sin(elapsed * 4) * 0.04 : 1));
    setBoardFocus(equals, p, 0.58, 0.7);
    setBoardFocus(result, p, 0.66, 0.82);
    setBoardFocus(outputSlots, p, 0.82, 0.96);
    if (merge > 0 && motionEnabled) setObjectEmissive(result, 0.7 + merge * 0.7);
  };
  updater(0, 0, false);
  return updater;
}

function buildTransformerTower(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const process = new THREE.Group();
  process.name = "early-process-transformer-vertical-reactor-shaft";
  context.group.add(process);

  const title = createPanel(["H0 CLIMBS THROUGH TWO OWNED BLOCKS", "outer shape stays [2 x 6 x 8]"], {
    width: 8.4,
    height: 1.25,
    color: WHITE,
    borderColor: context.palette.phaseBase,
  });
  title.position.set(0, 4.3, 5.7);
  process.add(title);

  const supports = [-5.3, 5.3].map((x) => {
    const support = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 7.5, 0.22),
      createProcessMaterial(BLUE, 0.42, 0.65),
    );
    support.position.set(x, 0.15, -0.4);
    process.add(support);
    return support;
  });
  const floors = [-1.75, 0.85, 3.45].map((y, index) => {
    const floor = createDeck(new THREE.Vector3(10.8, 0.22, 4.4), index === 2 ? GREEN : BLUE, 0.74);
    floor.position.set(0, y, -0.4);
    process.add(floor);
    return floor;
  });
  const block0Label = createPanel(["BLOCK 0 theta0", "attention + MLP + residual"], {
    width: 3.8,
    height: 1.0,
    color: GOLD,
    borderColor: GOLD,
  });
  block0Label.position.set(-6.4, -0.35, -0.2);
  const block1Label = createPanel(["BLOCK 1 theta1", "different learned parameters"], {
    width: 3.8,
    height: 1.0,
    color: GOLD,
    borderColor: GOLD,
  });
  block1Label.position.set(6.4, 2.25, -0.2);
  process.add(block0Label, block1Label);

  const stateOptions = (titleText: string, color: THREE.ColorRepresentation) => ({
    width: 4.8,
    cellHeight: 0.38,
    title: titleText,
    subtitle: "12 width-8 vector cassettes",
    color,
    unknownIndices: Array.from({ length: 12 }, (_, index) => index),
  });
  const h0 = createValueBoard(UNKNOWN_TWELVE, 2, 6, stateOptions("H0 [2 x 6 x 8]", CYAN));
  const h1 = createValueBoard(UNKNOWN_TWELVE, 2, 6, stateOptions("H1 = BLOCK 0(H0)", BLUE));
  const h2 = createValueBoard(UNKNOWN_TWELVE, 2, 6, stateOptions("H2 = BLOCK 1(H1)", VIOLET));
  const hFinal = createValueBoard(UNKNOWN_TWELVE, 2, 6, stateOptions("H_FINAL = LN_f(H2)", GREEN));
  h0.position.set(0, -1.0, 5.3);
  h1.position.set(0, -0.95, -0.4);
  h2.position.set(0, 1.65, -0.4);
  hFinal.position.set(0, 3.45, -4.9);
  process.add(h0, h1, h2, hFinal);

  const reactor0 = new THREE.Mesh(
    new THREE.TorusGeometry(3.0, 0.12, 8, 54),
    createProcessMaterial(CYAN, 1.0, 0.76),
  );
  reactor0.rotation.x = Math.PI / 2;
  reactor0.position.set(0, -1.35, -0.4);
  const reactor1 = reactor0.clone();
  reactor1.material = createProcessMaterial(VIOLET, 1.0, 0.76);
  reactor1.position.y = 1.25;
  process.add(reactor0, reactor1);
  const normHalo = new THREE.Mesh(
    new THREE.TorusGeometry(2.75, 0.11, 8, 54),
    createProcessMaterial(GREEN, 1.15, 0.8),
  );
  normHalo.rotation.x = Math.PI / 2;
  normHalo.position.set(0, 3.7, -0.4);
  process.add(normHalo);

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const enter0 = smoothStep(p, 0, 0.16);
    moveObject(h0, vector(0, -1.0, 5.3), vector(0, -0.9, -0.4), enter0, 0.25);
    setObjectOpacity(h0, 1 - smoothStep(p, 0.28, 0.38));
    setBoardFocus(h1, p, 0.28, 0.4);
    moveObject(
      h1,
      vector(0, -0.95, -0.4),
      vector(0, 1.65, -0.4),
      smoothStep(p, 0.4, 0.54),
      0.16,
    );
    setObjectOpacity(h1, smoothStep(p, 0.28, 0.4) * (1 - smoothStep(p, 0.62, 0.7)));
    setBoardFocus(h2, p, 0.62, 0.72);
    moveObject(
      h2,
      vector(0, 1.65, -0.4),
      vector(0, 3.05, -0.4),
      smoothStep(p, 0.72, 0.82),
      0.12,
    );
    setObjectOpacity(h2, smoothStep(p, 0.62, 0.72) * (1 - smoothStep(p, 0.86, 0.92)));
    setBoardFocus(hFinal, p, 0.88, 0.98);
    const block0Pulse = windowPulse(p, 0.12, 0.25, 0.42);
    const block1Pulse = windowPulse(p, 0.5, 0.61, 0.76);
    setObjectEmissive(reactor0, 0.4 + block0Pulse * 1.5);
    setObjectEmissive(reactor1, 0.4 + block1Pulse * 1.5);
    setObjectEmissive(normHalo, 0.4 + windowPulse(p, 0.78, 0.88, 0.98) * 1.6);
    if (motionEnabled) {
      reactor0.rotation.z = elapsed * 0.55;
      reactor1.rotation.z = -elapsed * 0.48;
      normHalo.rotation.z = elapsed * 0.8;
    } else {
      reactor0.rotation.z = 0;
      reactor1.rotation.z = 0;
      normHalo.rotation.z = 0;
    }
    supports.forEach((support) => setObjectEmissive(support, 0.25 + p * 0.3));
    floors.forEach((floor, index) => setObjectEmissive(floor, 0.3 + (index === 2 ? smoothStep(p, 0.82, 0.96) : 0.15)));
  };
  updater(0, 0, false);
  return updater;
}

function buildTransformerBlock(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const process = new THREE.Group();
  process.name = "early-process-transformer-block-fork-and-merge-foundry";
  context.group.add(process);

  const title = createPanel(["ONE BLOCK: TWO REAL FORKS + TWO REAL ADDS", "H -> U -> H' · shape [2 x 6 x 8]"], {
    width: 8.8,
    height: 1.25,
    color: WHITE,
    borderColor: context.palette.phaseBase,
  });
  title.position.set(0, 4.25, 5.65);
  process.add(title);

  const boardOptions = (titleText: string, color: THREE.ColorRepresentation) => ({
    width: 3.55,
    cellHeight: 0.48,
    title: titleText,
    color,
    unknownIndices: Array.from({ length: 8 }, (_, index) => index),
  });
  const inputH = createValueBoard(UNKNOWN_EIGHT, 1, 8, boardOptions("selected H[8]", CYAN));
  inputH.position.set(0, 2.8, 5.1);
  const residualH = createValueBoard(UNKNOWN_EIGHT, 1, 8, boardOptions("H bypass", CYAN));
  const attentionA = createValueBoard(UNKNOWN_EIGHT, 1, 8, boardOptions("A=MHA(LN1(H))", VIOLET));
  residualH.position.set(-4.25, 2.05, 1.15);
  attentionA.position.set(4.25, 2.05, 1.15);
  const firstPlus = createGlyph("+", GOLD, 1.1);
  firstPlus.position.set(0, 2.05, 1.15);
  const firstEquals = createGlyph("=", WHITE, 1.0);
  firstEquals.position.set(0, 1.45, -0.25);
  const uBoard = createValueBoard(UNKNOWN_EIGHT, 1, 8, boardOptions("U = H + A", GREEN));
  uBoard.position.set(0, 1.05, -1.35);

  const expansion = createValueBoard(Array.from({ length: 32 }, () => "·"), 4, 8, {
    width: 4.1,
    cellHeight: 0.24,
    title: "shared MLP: 8 -> 32 GELU -> 8",
    subtitle: "positions remain independent",
    color: CORAL,
    unknownIndices: Array.from({ length: 32 }, (_, index) => index),
  });
  expansion.position.set(5.7, 0.0, -3.6);
  const residualU = createValueBoard(UNKNOWN_EIGHT, 1, 8, boardOptions("U bypass", GREEN));
  const mlpF = createValueBoard(UNKNOWN_EIGHT, 1, 8, boardOptions("F=MLP(LN2(U))", CORAL));
  residualU.position.set(-4.25, 0.65, -4.55);
  mlpF.position.set(4.25, 0.65, -4.55);
  const secondPlus = createGlyph("+", GOLD, 1.1);
  secondPlus.position.set(0, 0.65, -4.55);
  const secondEquals = createGlyph("=", WHITE, 1.0);
  secondEquals.position.set(0, 0.1, -5.65);
  const output = createValueBoard(UNKNOWN_EIGHT, 1, 8, boardOptions("H' = U + F", GOLD));
  output.position.set(0, -0.35, -6.75);
  process.add(
    inputH,
    residualH,
    attentionA,
    firstPlus,
    firstEquals,
    uBoard,
    expansion,
    residualU,
    mlpF,
    secondPlus,
    secondEquals,
    output,
  );

  const attentionOperator = createPanel(["LN1", "CAUSAL ATTENTION"], {
    width: 3.1,
    height: 1.2,
    color: VIOLET,
    borderColor: VIOLET,
  });
  attentionOperator.position.set(5.9, 3.45, 3.1);
  process.add(attentionOperator);
  const ln2Operator = createPanel(["LN2", "12 ISOLATED MLP LANES"], {
    width: 3.5,
    height: 1.2,
    color: CORAL,
    borderColor: CORAL,
  });
  ln2Operator.position.set(5.5, 2.45, -2.05);
  process.add(ln2Operator);

  const firstResidualPath = [vector(0, 1.8, 4.35), vector(-4.2, 1.5, 2.5), vector(-4.2, 1.6, 1.2)];
  const attentionPath = [vector(0, 1.8, 4.35), vector(5.8, 2.6, 3.1), vector(4.2, 1.6, 1.2)];
  const secondResidualPath = [vector(0, 0.5, -1.85), vector(-4.2, 0.2, -3.2), vector(-4.2, 0.2, -4.5)];
  const mlpPath = [vector(0, 0.5, -1.85), vector(5.5, 1.6, -2.1), vector(4.2, 0.2, -4.5)];
  process.add(createPath(firstResidualPath, CYAN, 0.05, 0.42));
  process.add(createPath(attentionPath, VIOLET, 0.05, 0.42));
  process.add(createPath(secondResidualPath, GREEN, 0.05, 0.42));
  process.add(createPath(mlpPath, CORAL, 0.05, 0.42));

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    setObjectOpacity(inputH, 1 - smoothStep(p, 0.12, 0.24));
    setBoardFocus(residualH, p, 0.08, 0.2);
    setBoardFocus(attentionOperator, p, 0.1, 0.22);
    setBoardFocus(attentionA, p, 0.18, 0.3);
    setBoardFocus(firstPlus, p, 0.25, 0.34);
    const firstMerge = smoothStep(p, 0.3, 0.43);
    moveObject(residualH, vector(-4.25, 2.05, 1.15), vector(-2.15, 2.05, 0.55), firstMerge);
    moveObject(attentionA, vector(4.25, 2.05, 1.15), vector(2.15, 2.05, 0.55), firstMerge);
    const firstOperandOpacity = 1 - smoothStep(p, 0.39, 0.48);
    setObjectOpacity(residualH, smoothStep(p, 0.08, 0.2) * firstOperandOpacity);
    setObjectOpacity(attentionA, smoothStep(p, 0.18, 0.3) * firstOperandOpacity);
    setBoardFocus(firstEquals, p, 0.38, 0.48);
    setBoardFocus(uBoard, p, 0.42, 0.53);
    setBoardFocus(residualU, p, 0.47, 0.58);
    setBoardFocus(ln2Operator, p, 0.48, 0.6);
    setBoardFocus(expansion, p, 0.52, 0.67);
    setBoardFocus(mlpF, p, 0.62, 0.72);
    setBoardFocus(secondPlus, p, 0.68, 0.76);
    const secondMerge = smoothStep(p, 0.72, 0.86);
    moveObject(residualU, vector(-4.25, 0.65, -4.55), vector(-2.15, 0.65, -5.0), secondMerge);
    moveObject(mlpF, vector(4.25, 0.65, -4.55), vector(2.15, 0.65, -5.0), secondMerge);
    const secondOperandOpacity = 1 - smoothStep(p, 0.82, 0.9);
    setObjectOpacity(residualU, smoothStep(p, 0.47, 0.58) * secondOperandOpacity);
    setObjectOpacity(mlpF, smoothStep(p, 0.62, 0.72) * secondOperandOpacity);
    setBoardFocus(secondEquals, p, 0.8, 0.89);
    setBoardFocus(output, p, 0.84, 0.97);
    if (motionEnabled) {
      firstPlus.scale.setScalar(1 + Math.sin(elapsed * 4.2) * 0.04);
      secondPlus.scale.setScalar(1 + Math.sin(elapsed * 4.2 + 1) * 0.04);
    } else {
      resetScale(firstPlus);
      resetScale(secondPlus);
    }
  };
  updater(0, 0, false);
  return updater;
}

function buildMultiHeadAttention(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const process = new THREE.Group();
  process.name = "early-process-qkv-three-wing-projection-fan";
  context.group.add(process);

  const title = createPanel(["PROJECT FIRST, THEN SPLIT INTO HEADS", "N=LN1(H) -> Q/K/V [8] -> head 0 [4] | head 1 [4]"], {
    width: 9.0,
    height: 1.25,
    color: WHITE,
    borderColor: context.palette.phaseBase,
  });
  title.position.set(0, 4.3, 5.7);
  process.add(title);

  const input = createValueBoard(UNKNOWN_TWELVE, 2, 6, {
    width: 4.6,
    cellHeight: 0.4,
    title: "N = LN1(H) [2 x 6 x 8]",
    subtitle: "12 normalized vectors fan out three ways",
    color: BLUE,
    unknownIndices: Array.from({ length: 12 }, (_, index) => index),
    highlightedIndices: [2],
    accent: GOLD,
  });
  input.position.set(0, 1.75, 5.0);
  input.name = "assistant-target-mha-normalized-input";
  process.add(input);

  const projectionColors = [CYAN, VIOLET, GREEN] as const;
  const projectionNames = ["WQ [8 x 8]", "WK [8 x 8]", "WV [8 x 8]"] as const;
  const projectionTargetNames = [
    "assistant-target-mha-query-projection",
    "assistant-target-mha-key-projection",
    "assistant-target-mha-value-projection",
  ] as const;
  const projectionX = [-5.6, 0, 5.6] as const;
  const projectionWalls = projectionNames.map((name, index) => {
    const wall = createValueBoard(Array.from({ length: 64 }, () => "·"), 8, 8, {
      width: 3.25,
      cellHeight: 0.25,
      title: name,
      subtitle: "learned projection",
      color: GOLD,
      unknownIndices: Array.from({ length: 64 }, (_, cell) => cell),
      accent: projectionColors[index],
    });
    wall.position.set(projectionX[index], 1.1, 0.9);
    wall.name = projectionTargetNames[index];
    process.add(wall);
    const multiply = createGlyph("x", projectionColors[index], 0.92);
    multiply.position.set(projectionX[index], 1.1, 3.1);
    multiply.name = projectionTargetNames[index];
    process.add(multiply);
    return { wall, multiply };
  });

  const selectedKey = SELECTED_TRACE.attention.allowedKeys[2];
  const selectedValue = SELECTED_TRACE.attention.allowedValues[2];
  const qkvValues: readonly (readonly (string | number)[])[] = [
    [...SELECTED_TRACE.attention.query, ...UNKNOWN_EIGHT.slice(0, 4)],
    [...selectedKey, ...UNKNOWN_EIGHT.slice(0, 4)],
    [...selectedValue, ...UNKNOWN_EIGHT.slice(0, 4)],
  ];
  const qkvTargetNames = [
    "assistant-target-mha-projected-query",
    "assistant-target-mha-projected-key",
    "assistant-target-mha-projected-value",
  ] as const;
  const qkvBoards = qkvValues.map((values, index) => {
    const board = createValueBoard(values, 1, 8, {
      width: 3.7,
      cellHeight: 0.52,
      title: `${["Q2", "K2", "V2"][index]} projected [8]`,
      subtitle: "first 4 cells = selected head 0",
      color: projectionColors[index],
      highlightedIndices: [0, 1, 2, 3],
      unknownIndices: [4, 5, 6, 7],
      accent: GOLD,
    });
    board.position.set(projectionX[index], -1.55, -1.55);
    board.name = qkvTargetNames[index];
    process.add(board);
    return board;
  });

  const splitter = createPanel(["RESHAPE / UNZIP", "[8] -> HEAD 0 [4] | HEAD 1 [4]", "split projected Q/K/V, not raw N"], {
    width: 6.0,
    height: 1.45,
    color: GOLD,
    borderColor: GOLD,
  });
  splitter.position.set(0, 2.55, -3.55);
  splitter.name = "assistant-target-mha-head-split";
  process.add(splitter);

  const head0Values = [
    ...SELECTED_TRACE.attention.query,
    ...selectedKey,
    ...selectedValue,
  ];
  const head0 = createValueBoard(head0Values, 3, 4, {
    width: 4.4,
    cellHeight: 0.46,
    title: "HEAD 0: Q2 | K2 | V2",
    subtitle: "exact selected four-feature values",
    color: CYAN,
    highlightedIndices: Array.from({ length: 12 }, (_, index) => index),
    accent: GOLD,
  });
  head0.position.set(-4.35, -0.15, -5.85);
  head0.name = "assistant-target-mha-head-0";
  const head1 = createValueBoard(Array.from({ length: 12 }, () => "·"), 3, 4, {
    width: 4.4,
    cellHeight: 0.46,
    title: "HEAD 1: Q | K | V",
    subtitle: "separate learned four-feature view",
    color: VIOLET,
    unknownIndices: Array.from({ length: 12 }, (_, index) => index),
  });
  head1.position.set(4.35, -0.15, -5.85);
  head1.name = "assistant-target-mha-head-1";
  process.add(head0, head1);

  const inputPoint = vector(0, 0.55, 4.2);
  const fanPaths = projectionX.map((x) => [
    inputPoint,
    vector(x * 0.55, 0.45, 2.9),
    vector(x, 0.1, 1.8),
  ]);
  fanPaths.forEach((path, index) => process.add(createPath(path, projectionColors[index], 0.055, 0.46)));
  const fanPackets = projectionColors.map((color) => {
    const packet = createPacket(color, 0.21);
    process.add(packet);
    return packet;
  });
  const splitLeftPath = [vector(0, 0.2, -3.8), vector(-4.35, -0.4, -5.2)];
  const splitRightPath = [vector(0, 0.2, -3.8), vector(4.35, -0.4, -5.2)];
  process.add(createPath(splitLeftPath, CYAN, 0.055, 0.48));
  process.add(createPath(splitRightPath, VIOLET, 0.055, 0.48));
  const splitLeftPacket = createPacket(CYAN, 0.2);
  const splitRightPacket = createPacket(VIOLET, 0.2);
  process.add(splitLeftPacket, splitRightPacket);

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    setObjectOpacity(input, 1);
    projectionWalls.forEach(({ wall, multiply }, index) => {
      const focus = windowPulse(p, 0.18 + index * 0.025, 0.37 + index * 0.025, 0.58 + index * 0.02);
      setObjectEmissive(wall, 0.28 + focus * 1.35);
      setBoardFocus(multiply, p, 0.12 + index * 0.025, 0.24 + index * 0.025);
      showPacket(
        fanPackets[index],
        fanPaths[index],
        p,
        0.12 + index * 0.025,
        0.34 + index * 0.025,
        elapsed,
        motionEnabled,
      );
      setBoardFocus(qkvBoards[index], p, 0.36 + index * 0.025, 0.52 + index * 0.025);
    });
    setBoardFocus(splitter, p, 0.52, 0.7);
    qkvBoards.forEach((board, index) => {
      const gather = smoothStep(p, 0.54 + index * 0.015, 0.72 + index * 0.015);
      moveObject(
        board,
        vector(projectionX[index], -1.55, -1.55),
        vector((index - 1) * 2.0, 0.2 + index * 0.72, -3.55),
        gather,
        0.18,
      );
      setObjectOpacity(board, smoothStep(p, 0.36, 0.52) * (1 - smoothStep(p, 0.72, 0.82)));
    });
    setBoardFocus(head0, p, 0.74, 0.9);
    setBoardFocus(head1, p, 0.76, 0.92);
    showPacket(splitLeftPacket, splitLeftPath, p, 0.68, 0.88, elapsed, motionEnabled);
    showPacket(splitRightPacket, splitRightPath, p, 0.7, 0.9, elapsed, motionEnabled);
    if (motionEnabled && p > 0.82) {
      pulseObject(head0, elapsed, 3.2, 0.025);
      pulseObject(head1, elapsed, 3.2, 0.025);
    } else {
      resetScale(head0);
      resetScale(head1);
    }
  };
  updater(0, 0, false);
  return updater;
}

export function buildEarlyProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater | undefined {
  switch (context.stationId) {
    case "training-complex":
      return buildTrainingComplex(context);
    case "corpus-data-preparation":
      return undefined;
    case "token-stream-context":
      return buildTokenStream(context);
    case "batch-shifted-targets":
      return buildBatchShift(context);
    case "embedding":
      return buildEmbedding(context);
    case "transformer-tower":
      return buildTransformerTower(context);
    case "transformer-block":
      return buildTransformerBlock(context);
    case "multi-head-attention":
      return buildMultiHeadAttention(context);
    default:
      return undefined;
  }
}
