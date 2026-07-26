import * as THREE from "three";

import { SELECTED_TRACE } from "../../lib/trainingTrace";
import { AVENUE, avenueAnchor, avenueRoute, avenueZ, placeOnAvenue } from "./avenue";
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

/**
 * Training Complex, laid out as a walkable avenue.
 *
 * The hall is the whole step in miniature, so the walk *is* the loop. Inputs and
 * answers fork at the threshold and take opposite lanes, because they never meet
 * again until the loss. The two owned blocks span the runway overhead: the model
 * is the one thing the batch travels *through*, and hanging it at arch height is
 * the only honest way to say so without blocking the walk. Scores, loss,
 * gradient and updated weight then alternate lanes, so no stage stands behind
 * the stage that produced it.
 */
function buildTrainingComplex(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const process = new THREE.Group();
  process.name = "early-process-training-complex-circuit";
  context.group.add(process);

  const title = createPanel(
    ["ONE COMPLETE LEARNING STEP", "cyan forward · coral backward · gold update"],
    { width: 13.6, height: 1.95, color: WHITE, borderColor: context.palette.phaseBase },
  );
  placeOnAvenue(title, { stop: 0, slot: "banner" });
  process.add(title);

  const inputBoard = createValueBoard(
    SELECTED_TRACE.batch.inputTokenIds.flat(),
    2,
    6,
    {
      width: 6.4,
      cellHeight: 0.62,
      title: "X [2 x 6]",
      subtitle: "12 input token IDs",
      color: CYAN,
    },
  );
  placeOnAvenue(inputBoard, { stop: 0, slot: "left", xShift: 0.5 });
  process.add(inputBoard);

  const targetBoard = createValueBoard(
    SELECTED_TRACE.batch.targetTokenIds.flat(),
    2,
    6,
    {
      width: 6.4,
      cellHeight: 0.62,
      title: "Y [2 x 6]",
      subtitle: "answers take a separate route",
      color: MAGENTA,
    },
  );
  placeOnAvenue(targetBoard, { stop: 0, slot: "right", xShift: 0.5 });
  process.add(targetBoard);

  // The block stack itself carries no reading matter, so it becomes pure
  // structure spanning the runway; its two nameplates move into the lanes
  // either side, at the height of the floor they name.
  const tower = new THREE.Group();
  tower.name = "training-circuit-two-block-tower";
  for (let floor = 0; floor < 2; floor += 1) {
    const slab = createDeck(new THREE.Vector3(6.6, 0.36, 3.6), BLUE, 0.82);
    slab.position.y = -1.05 + floor * 2.15;
    tower.add(slab);
  }
  const towerSpine = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 4.55, 14),
    createProcessMaterial(CYAN, 1.2),
  );
  tower.add(towerSpine);
  placeOnAvenue(tower, { stop: 1, slot: "centre", offset: [0, 0.6, 0] });
  process.add(tower);

  const blockLabels = [0, 1].map((floor) => {
    const label = createPanel([`BLOCK ${floor}`, "parameters read only"], {
      width: 5.2,
      height: 1.6,
      color: WHITE,
      borderColor: GOLD,
      fontScale: 0.72,
    });
    placeOnAvenue(label, {
      stop: 1,
      slot: floor === 0 ? "left" : "right",
      row: 1,
    });
    process.add(label);
    return label;
  });

  const logitsBoard = createValueBoard(
    SELECTED_TRACE.output.selectedLogits,
    4,
    4,
    {
      width: 6.4,
      cellHeight: 0.58,
      title: "selected logits [16]",
      subtitle: "batch 0 · position 2",
      color: BLUE,
      highlightedIndices: [5, 6],
      accent: GOLD,
    },
  );
  placeOnAvenue(logitsBoard, { stop: 2, slot: "left" });
  process.add(logitsBoard);

  const lossBoard = createValueBoard(
    [SELECTED_TRACE.output.meanLoss],
    1,
    1,
    {
      width: 4.4,
      cellHeight: 1.4,
      title: "MEAN LOSS L",
      subtitle: "12 penalties -> 1 scalar",
      color: GOLD,
      accent: GOLD,
      highlightedIndices: [0],
    },
  );
  placeOnAvenue(lossBoard, { stop: 3, slot: "right" });
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
      width: 8.0,
      cellHeight: 1.0,
      title: "w | grad | delta | w'",
      subtitle: "AdamW changes WQ[3,6] only after backward",
      color: GOLD,
      highlightedIndices: [3],
      accent: GREEN,
    },
  );
  placeOnAvenue(weightBoard, { stop: 4, slot: "left" });
  process.add(weightBoard);

  const nextPanel = createPanel(["theta' READY", "NEXT BATCH"], {
    width: 5.0,
    height: 1.8,
    color: GREEN,
    borderColor: GREEN,
  });
  placeOnAvenue(nextPanel, { stop: 5, slot: "right" });
  process.add(nextPanel);

  // An aside about production, not a step of the loop, so it stands out in the
  // far lane where it can be ignored on the way past.
  const productionPlaque = createPanel(
    [
      "WHAT PRODUCTION ADDS AROUND THIS LOOP",
      "validation runs · checkpoints",
      "mixed precision · data + model parallelism",
    ],
    {
      width: 8.6,
      height: 2.4,
      color: "#d9e7ff",
      borderColor: GOLD,
      fontScale: 0.6,
    },
  );
  placeOnAvenue(productionPlaque, { stop: 2, slot: "outer-right" });
  process.add(productionPlaque);

  // The forward run stays in the left lane as far as the logits and only then
  // crosses to the loss, and every crossing is lifted over the arch tier so a
  // conduit never sweeps through the walker's face.
  const forwardPoints = [
    ...avenueRoute(
      avenueAnchor({ stop: 0, slot: "left" }),
      avenueAnchor({ stop: 2, slot: "left" }),
      1.2,
    ),
    ...avenueRoute(
      avenueAnchor({ stop: 2, slot: "left" }),
      avenueAnchor({ stop: 3, slot: "right" }),
      3.4,
    ).slice(1),
  ];
  const targetPoints = avenueRoute(
    avenueAnchor({ stop: 0, slot: "right" }),
    avenueAnchor({ stop: 3, slot: "right" }),
    1.6,
  );
  const reversePoints = avenueRoute(
    avenueAnchor({ stop: 3, slot: "right", offset: [0, 1.4, 0] }),
    avenueAnchor({ stop: 4, slot: "left", offset: [0, 1.4, 0] }),
    3.4,
  );
  const updatePoints = avenueRoute(
    avenueAnchor({ stop: 4, slot: "left" }),
    avenueAnchor({ stop: 5, slot: "right" }),
    3.4,
  );
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
    blockLabels.forEach((label, floor) =>
      setBoardFocus(label, p, 0.06 + floor * 0.04, 0.2 + floor * 0.04),
    );
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

/**
 * Context Window Hall, laid out as a walkable avenue.
 *
 * The two batch rows are independent streams that must never mix, so they get a
 * lane each and keep it for the whole walk: source row, clamp, dock. The cutter
 * is the one thing both rows pass through, so it spans the runway as a gantry
 * with a clamp hanging over each lane, and the selected-window plaque closes the
 * walk over the exit.
 */
function buildTokenStream(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const process = new THREE.Group();
  process.name = "early-process-context-window-rail-tunnel";
  context.group.add(process);

  const rows = sourceRows();
  const title = createPanel(["TWO INDEPENDENT TOKEN STREAMS", "clamp exactly T+1 = 7"], {
    width: 12.6,
    height: 1.9,
    color: WHITE,
    borderColor: context.palette.phaseBase,
  });
  placeOnAvenue(title, { stop: 0, slot: "banner" });
  process.add(title);

  const laneSlots = ["left", "right"] as const;
  const streamBoards = rows.map((row, rowIndex) => {
    const board = createValueBoard(row, 1, 7, {
      width: 7.6,
      cellHeight: 0.88,
      title: `SOURCE ROW ${rowIndex}`,
      subtitle: rowIndex === 0 ? "<bos> the cat sat on the mat" : "<bos> a small model can learn <eos>",
      color: BLUE,
    });
    placeOnAvenue(board, { stop: 0, slot: laneSlots[rowIndex], xShift: 1.4 });
    process.add(board);
    return board;
  });

  const clamps = laneSlots.map((slot, rowIndex) => {
    const clamp = createFrame(new THREE.Vector3(8.4, 3.0, 0.9), GOLD);
    clamp.name = `seven-token-selection-clamp-${rowIndex}`;
    placeOnAvenue(clamp, { stop: 1, slot, xShift: 1.4, row: 1 });
    process.add(clamp);
    return clamp;
  });

  const outputDocks = laneSlots.map((slot, rowIndex) => {
    const deck = createDeck(new THREE.Vector3(8.6, 0.3, 2.8), rowIndex ? VIOLET : CYAN, 0.7);
    placeOnAvenue(deck, { stop: 2, slot, xShift: 1.4, offset: [0, -1.6, 0] });
    process.add(deck);
    return deck;
  });

  const preview = createPanel(
    ["SELECTED S[b,0:7]", "next chamber: X=0:6 · Y=1:7", "batch rows never mix"],
    { width: 10.6, height: 2.2, color: GOLD, borderColor: GOLD, fontScale: 0.82 },
  );
  placeOnAvenue(preview, { stop: 3, slot: "centre", offset: [0, 0.9, 0] });
  process.add(preview);

  const cutterPanel = createPanel(["WINDOW CUTTER", "7 consecutive positions"], {
    width: 5.8,
    height: 1.5,
    color: GOLD,
    borderColor: GOLD,
    fontScale: 0.75,
  });
  placeOnAvenue(cutterPanel, { stop: 1, slot: "centre" });
  process.add(cutterPanel);

  const streamHome = streamBoards.map((board) => board.position.clone());
  const streamGate = laneSlots.map((slot) =>
    avenueAnchor({ stop: 1, slot, xShift: 1.4 }),
  );
  const streamLifted = streamGate.map((point) => point.clone().setY(point.y + 1.55));
  const streamDock = laneSlots.map((slot) =>
    avenueAnchor({ stop: 2, slot, xShift: 1.4, offset: [0, -0.7, 0] }),
  );
  const clampHome = clamps.map((clamp) => clamp.position.clone());

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const arrive = smoothStep(p, 0, 0.28);
    const lift = smoothStep(p, 0.34, 0.52);
    const extract = smoothStep(p, 0.52, 0.82);
    streamBoards.forEach((board, rowIndex) => {
      if (p < 0.34) {
        moveObject(board, streamHome[rowIndex], streamGate[rowIndex], arrive);
      } else if (p < 0.52) {
        moveObject(board, streamGate[rowIndex], streamLifted[rowIndex], lift);
      } else {
        moveObject(board, streamLifted[rowIndex], streamDock[rowIndex], extract, 0.42);
      }
      setObjectOpacity(board, 1);
      if (motionEnabled && p < 0.28) board.position.z += Math.sin(elapsed * 2.2 + rowIndex) * 0.04;
    });
    clamps.forEach((clamp, rowIndex) => {
      const lock = smoothStep(p, 0.2 + rowIndex * 0.02, 0.36 + rowIndex * 0.02);
      // The clamp rides down its own lane onto the row it is holding, so it
      // never has to cross the runway to reach the stream it clamps.
      clamp.position.y = THREE.MathUtils.lerp(
        clampHome[rowIndex].y,
        streamLifted[rowIndex].y,
        lock,
      );
      setObjectOpacity(clamp, smoothStep(p, 0.14, 0.25));
      setObjectEmissive(clamp, 0.5 + windowPulse(p, 0.19, 0.34, 0.52) * 1.2);
    });
    outputDocks.forEach((dock) => setObjectEmissive(dock, 0.35 + smoothStep(p, 0.62, 0.84) * 0.8));
    setBoardFocus(cutterPanel, p, 0.16, 0.32);
    setBoardFocus(preview, p, 0.78, 0.94);
  };
  updater(0, 0, false);
  return updater;
}

/**
 * Batch & Shifted Targets Hall, laid out as a walkable avenue.
 *
 * One source row splits into two, so the walk is a Y: the source spans the
 * runway alone at the entrance, and from the next stop on there is a cyan lane
 * and a magenta lane running side by side, stop for stop — copy, cut, result.
 * Holding the two at the same stop is the point: X and Y are the *same* window
 * offset by one, and that only reads when they are level with each other.
 */
function buildBatchShift(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const process = new THREE.Group();
  process.name = "early-process-batch-shift-split-level-yard";
  context.group.add(process);

  const rows = sourceRows();
  const source = createValueBoard(rows.flat(), 2, 7, {
    width: 10.4,
    cellHeight: 0.68,
    title: "SOURCE S [2 x 7]",
    subtitle: "duplicate, then take two offset slices",
    color: BLUE,
  });
  placeOnAvenue(source, { stop: 0, slot: "centre", offset: [0, -1.15, 0] });
  process.add(source);

  const copyX = createValueBoard(rows.flat(), 2, 7, {
    width: 7.0,
    cellHeight: 0.55,
    title: "COPY FOR X",
    subtitle: "keep columns 0:6",
    color: CYAN,
    highlightedIndices: [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12],
  });
  const copyY = createValueBoard(rows.flat(), 2, 7, {
    width: 7.0,
    cellHeight: 0.55,
    title: "COPY FOR Y",
    subtitle: "drop column 0, shift left",
    color: MAGENTA,
    highlightedIndices: [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13],
  });
  placeOnAvenue(copyX, { stop: 1, slot: "left" });
  placeOnAvenue(copyY, { stop: 1, slot: "right" });
  process.add(copyX, copyY);

  const sliceX = createPanel(["SLICE 0:6", "discard last source token"], {
    width: 5.6,
    height: 1.5,
    color: CYAN,
    borderColor: CYAN,
  });
  const sliceY = createPanel(["SHIFT LEFT ONE", "discard first source token"], {
    width: 5.6,
    height: 1.5,
    color: MAGENTA,
    borderColor: MAGENTA,
  });
  placeOnAvenue(sliceX, { stop: 2, slot: "left" });
  placeOnAvenue(sliceY, { stop: 2, slot: "right" });
  process.add(sliceX, sliceY);

  const xBoard = createValueBoard(SELECTED_TRACE.batch.inputTokenIds.flat(), 2, 6, {
    width: 7.4,
    cellHeight: 0.7,
    title: "X = S[:,0:6]",
    subtitle: "cyan route -> model",
    color: CYAN,
  });
  const yBoard = createValueBoard(SELECTED_TRACE.batch.targetTokenIds.flat(), 2, 6, {
    width: 7.4,
    cellHeight: 0.7,
    title: "Y = S[:,1:7]",
    subtitle: "answer route -> loss only",
    color: MAGENTA,
  });
  placeOnAvenue(xBoard, { stop: 3, slot: "left" });
  placeOnAvenue(yBoard, { stop: 3, slot: "right" });
  process.add(xBoard, yBoard);

  const pairPanel = createPanel(
    ["12 NEXT-TOKEN PAIRS", "cat (4) -> sat (5)", "answers never enter attention"],
    { width: 8.4, height: 2.3, color: GOLD, borderColor: GOLD },
  );
  placeOnAvenue(pairPanel, { stop: 4, slot: "centre" });
  process.add(pairPanel);

  const forkPoint = avenueAnchor({ stop: 0, slot: "centre", offset: [0, -1.6, 0] });
  const xPath = avenueRoute(forkPoint, avenueAnchor({ stop: 3, slot: "left" }), 1.4);
  const yPath = avenueRoute(forkPoint, avenueAnchor({ stop: 3, slot: "right" }), 1.4);
  process.add(createPath(xPath, CYAN, 0.06, 0.48));
  process.add(createPath(yPath, MAGENTA, 0.06, 0.48));
  const xPacket = createPacket(CYAN, 0.22);
  const yPacket = createPacket(MAGENTA, 0.22);
  process.add(xPacket, yPacket);

  // The copies leave their own bay and slide forward under the cutting plaques
  // rather than being spawned on top of the source, so nothing ever shares a
  // position with the board it came from.
  const copyHome = [copyX.position.clone(), copyY.position.clone()];
  const copyCut = [
    avenueAnchor({ stop: 2, slot: "left", zShift: 2.4, offset: [0, -0.5, 0] }),
    avenueAnchor({ stop: 2, slot: "right", zShift: 2.4, offset: [0, -0.5, 0] }),
  ];

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    setObjectOpacity(source, 1);
    const fork = smoothStep(p, 0.14, 0.32);
    moveObject(copyX, copyHome[0], copyCut[0], fork, 0.35);
    moveObject(copyY, copyHome[1], copyCut[1], fork, 0.35);
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

/**
 * Embedding Hall, laid out as a walkable avenue.
 *
 * The two lookups are genuinely parallel, so token work runs down the left lane
 * and position work down the right lane, stop for stop: address → learned table
 * → selected row. They meet under the `+` arch, the exact sum stands at the
 * next stop, and the full hidden-state tray closes the walk over the exit.
 */
function buildEmbedding(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const process = new THREE.Group();
  process.name = "early-process-embedding-archive-addition-altar";
  context.group.add(process);

  const banner = createPanel(
    ["EMBEDDING HALL", "left lane: which token · right lane: which position"],
    { width: 13.5, height: 1.7, color: WHITE, borderColor: context.palette.phaseBase },
  );
  placeOnAvenue(banner, { stop: 0, slot: "banner" });
  process.add(banner);

  const address = createValueBoard(["cat", SELECTED_TRACE.embedding.selectedTokenId], 1, 2, {
    width: 4.2,
    cellHeight: 0.8,
    title: "TOKEN ADDRESS",
    subtitle: "ID is not a magnitude",
    color: CYAN,
    highlightedIndices: [1],
    accent: GOLD,
  });
  placeOnAvenue(address, { stop: 0, slot: "left" });
  address.name = "assistant-target-embedding-token-address";
  process.add(address);

  const positionTicket = createValueBoard(["pos", SELECTED_TRACE.embedding.selectedPosition], 1, 2, {
    width: 4.2,
    cellHeight: 0.8,
    title: "POSITION ADDRESS",
    subtitle: "which slot in the window",
    color: VIOLET,
    highlightedIndices: [1],
    accent: GOLD,
  });
  placeOnAvenue(positionTicket, { stop: 0, slot: "right" });
  positionTicket.name = "assistant-target-embedding-position-address";
  process.add(positionTicket);

  const embeddingDots = Array.from({ length: 16 * 8 }, () => "·");
  const positionDots = Array.from({ length: 6 * 8 }, () => "·");
  const embeddingWall = createValueBoard(embeddingDots, 16, 8, {
    width: 6.4,
    cellHeight: 0.29,
    title: "E [16 x 8] LEARNED",
    subtitle: "ID 4 selects one row",
    color: GOLD,
    accent: CYAN,
    highlightedIndices: Array.from({ length: 8 }, (_, index) => 4 * 8 + index),
  });
  placeOnAvenue(embeddingWall, { stop: 1, slot: "left", offset: [0, 0.9, 0] });
  embeddingWall.name = "assistant-target-embedding-token-table";
  process.add(embeddingWall);

  const positionWall = createValueBoard(positionDots, 6, 8, {
    width: 6.4,
    cellHeight: 0.52,
    title: "P [6 x 8] LEARNED",
    subtitle: "position 2 selects one row",
    color: GOLD,
    accent: VIOLET,
    highlightedIndices: Array.from({ length: 8 }, (_, index) => 2 * 8 + index),
  });
  placeOnAvenue(positionWall, { stop: 1, slot: "right", offset: [0, 0.9, 0] });
  positionWall.name = "assistant-target-embedding-position-table";
  process.add(positionWall);

  const tokenRow = createValueBoard(SELECTED_TRACE.embedding.selectedTokenVector, 1, 8, {
    width: 5.4,
    cellHeight: 0.7,
    title: "E[4,:]",
    subtitle: "selected learned token row",
    color: CYAN,
  });
  const positionRow = createValueBoard(SELECTED_TRACE.embedding.selectedPositionVector, 1, 8, {
    width: 5.4,
    cellHeight: 0.7,
    title: "P[2,:]",
    subtitle: "selected learned position row",
    color: VIOLET,
  });
  placeOnAvenue(tokenRow, { stop: 2, slot: "left" });
  placeOnAvenue(positionRow, { stop: 2, slot: "right" });
  tokenRow.name = "assistant-target-embedding-selected-token-row";
  positionRow.name = "assistant-target-embedding-selected-position-row";
  process.add(tokenRow, positionRow);

  // The plus hangs over the runway where the two lanes converge; the equals
  // stands beside the result board instead of trailing the plus down the same
  // sightline, where one would simply hide the other.
  const plus = createGlyph("+", GOLD, 2.1);
  placeOnAvenue(plus, { stop: 2, slot: "centre", zShift: -3.2 });
  const equals = createGlyph("=", WHITE, 1.8);
  placeOnAvenue(equals, { stop: 3, slot: "left", xShift: -3.4, zShift: 2.2 });
  process.add(plus, equals);

  const result = createValueBoard(SELECTED_TRACE.embedding.selectedHiddenVector, 1, 8, {
    width: 6.6,
    cellHeight: 0.86,
    title: "H0[0,2,:] = E[4,:] + P[2,:]",
    subtitle: "the eight displayed sums are exact",
    color: GREEN,
    accent: GREEN,
    highlightedIndices: Array.from({ length: 8 }, (_, index) => index),
  });
  placeOnAvenue(result, { stop: 3, slot: "left" });
  result.name = "assistant-target-embedding-sum-result";
  process.add(result);

  const resultNote = createPanel(
    ["ONE TOKEN VECTOR", "the same addition runs", "for all 12 positions"],
    { width: 5.4, height: 2.1, color: WHITE, borderColor: GREEN, fontScale: 0.72 },
  );
  placeOnAvenue(resultNote, { stop: 3, slot: "right" });
  process.add(resultNote);

  const outputSlots = createValueBoard(UNKNOWN_TWELVE, 2, 6, {
    width: 8.2,
    cellHeight: 0.62,
    title: "H0 [2 x 6 x 8]",
    subtitle: "12 moving width-8 vectors leave the hall",
    color: GREEN,
    unknownIndices: Array.from({ length: 12 }, (_, index) => index),
    highlightedIndices: [2],
    accent: GOLD,
  });
  placeOnAvenue(outputSlots, { stop: 4, slot: "centre", offset: [0, 0.6, 0] });
  outputSlots.name = "assistant-target-embedding-hidden-state-output";
  process.add(outputSlots);

  const tokenStart = tokenRow.position.clone();
  const positionStart = positionRow.position.clone();
  const tokenYaw = tokenRow.rotation.y;
  const positionYaw = positionRow.rotation.y;
  const mergeZ = avenueZ(2) - 3.2;
  const tokenOperand = vector(-4.4, 2.4, mergeZ + 1.6);
  const positionOperand = vector(4.4, 2.4, mergeZ + 1.6);
  const tokenMerge = vector(-2.9, 3.1, mergeZ);
  const positionMerge = vector(2.9, 3.1, mergeZ);

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
    // Both rows start angled into their lane and straighten as they rise to
    // meet under the arch, so the addition is read face-on from the runway.
    const straighten = smoothStep(p, 0.08, 0.5);
    tokenRow.rotation.y = tokenYaw * (1 - straighten);
    positionRow.rotation.y = positionYaw * (1 - straighten);
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

/**
 * Transformer Tower, laid out as a walkable avenue.
 *
 * The tower's "floors" become gates along the walk: the three reactors stand
 * upright across the runway as rings the visitor passes through, one per block
 * plus a final one for LN_f. Each block bay names itself on one side and shows
 * its output state on the other — the same bay shape used for the projections in
 * the attention hall — and the bays mirror so the tall labels and the wide state
 * trays never queue up in one lane. The entering and leaving states hang over
 * the runway at either end, because they belong to the whole hall rather than
 * to either side of it.
 */
function buildTransformerTower(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const process = new THREE.Group();
  process.name = "early-process-transformer-vertical-reactor-shaft";
  context.group.add(process);

  const title = createPanel(["H0 CLIMBS THROUGH TWO OWNED BLOCKS", "outer shape stays [2 x 6 x 8]"], {
    width: 12.6,
    height: 1.9,
    color: WHITE,
    borderColor: context.palette.phaseBase,
  });
  // Level with the entering state rather than behind it: hung further down the
  // avenue the tall H0 tray rises across its lower half from every approach.
  placeOnAvenue(title, { stop: 0, slot: "banner", zShift: 0 });
  process.add(title);

  // Masts flank the runway just outside the walking corridor and just inside the
  // lanes, so they frame each gate without ever standing in front of a board.
  const gateStops = [1, 2, 3] as const;
  const supports = gateStops.flatMap((stop) =>
    [-4.35, 4.35].map((x) => {
      const support = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 13.4, 0.24),
        createProcessMaterial(BLUE, 0.42, 0.65),
      );
      support.position.set(x, 2.1, avenueZ(stop));
      process.add(support);
      return support;
    }),
  );

  const block0Label = createPanel(["BLOCK 0 theta0", "attention + MLP + residual"], {
    width: 5.6,
    height: 1.6,
    color: GOLD,
    borderColor: GOLD,
  });
  placeOnAvenue(block0Label, { stop: 1, slot: "left", xShift: 0.8 });
  const block1Label = createPanel(["BLOCK 1 theta1", "different learned parameters"], {
    width: 5.6,
    height: 1.6,
    color: GOLD,
    borderColor: GOLD,
  });
  placeOnAvenue(block1Label, { stop: 2, slot: "right", xShift: 0.8 });
  process.add(block0Label, block1Label);

  const stateOptions = (titleText: string, color: THREE.ColorRepresentation) => ({
    width: 7.6,
    cellHeight: 0.62,
    title: titleText,
    subtitle: "12 width-8 vector cassettes",
    color,
    unknownIndices: Array.from({ length: 12 }, (_, index) => index),
  });
  const h0 = createValueBoard(UNKNOWN_TWELVE, 2, 6, stateOptions("H0 [2 x 6 x 8]", CYAN));
  const h1 = createValueBoard(UNKNOWN_TWELVE, 2, 6, stateOptions("H1 = BLOCK 0(H0)", BLUE));
  const h2 = createValueBoard(UNKNOWN_TWELVE, 2, 6, stateOptions("H2 = BLOCK 1(H1)", VIOLET));
  const hFinal = createValueBoard(UNKNOWN_TWELVE, 2, 6, stateOptions("H_FINAL = LN_f(H2)", GREEN));
  placeOnAvenue(h0, { stop: 0, slot: "centre", offset: [0, -1.0, 0] });
  placeOnAvenue(h1, { stop: 1, slot: "right", xShift: 0.8 });
  placeOnAvenue(h2, { stop: 2, slot: "left", xShift: 0.8 });
  placeOnAvenue(hFinal, { stop: 4, slot: "centre" });
  process.add(h0, h1, h2, hFinal);

  const gateRing = (
    stop: number,
    radius: number,
    color: THREE.ColorRepresentation,
    intensity: number,
    opacity: number,
  ) => {
    // Upright, not flat: a ring you walk through reads as a stage of the
    // computation, whereas a ring lying across the walkway is just a hurdle.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.14, 8, 54),
      createProcessMaterial(color, intensity, opacity),
    );
    ring.position.set(0, AVENUE.corridorClearY + radius + 0.2, avenueZ(stop));
    process.add(ring);
    return ring;
  };
  const reactor0 = gateRing(1, 3.9, CYAN, 1.0, 0.76);
  const reactor1 = gateRing(2, 3.9, VIOLET, 1.0, 0.76);
  const normHalo = gateRing(3, 3.65, GREEN, 1.15, 0.8);

  const h0Home = h0.position.clone();
  const h1Home = h1.position.clone();
  const h2Home = h2.position.clone();
  const h1Yaw = h1.rotation.y;
  const h2Yaw = h2.rotation.y;
  // Each state leaves its bay by rising into the middle of the avenue and
  // passing through the next gate, which is where the block that consumes it
  // stands.
  const h0Gate = avenueAnchor({ stop: 1, slot: "centre", offset: [0, -1.2, 0] });
  const h1Gate = avenueAnchor({ stop: 2, slot: "centre", offset: [0, -1.2, 0] });
  const h2Gate = avenueAnchor({ stop: 3, slot: "centre", offset: [0, -1.2, 0] });

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const enter0 = smoothStep(p, 0, 0.16);
    moveObject(h0, h0Home, h0Gate, enter0, 0.25);
    setObjectOpacity(h0, 1 - smoothStep(p, 0.28, 0.38));
    setBoardFocus(h1, p, 0.28, 0.4);
    const climb1 = smoothStep(p, 0.4, 0.54);
    moveObject(h1, h1Home, h1Gate, climb1, 0.16);
    h1.rotation.y = h1Yaw * (1 - climb1);
    setObjectOpacity(h1, smoothStep(p, 0.28, 0.4) * (1 - smoothStep(p, 0.62, 0.7)));
    setBoardFocus(h2, p, 0.62, 0.72);
    const climb2 = smoothStep(p, 0.72, 0.82);
    moveObject(h2, h2Home, h2Gate, climb2, 0.12);
    h2.rotation.y = h2Yaw * (1 - climb2);
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
  };
  updater(0, 0, false);
  return updater;
}

/**
 * Transformer Block, laid out as a walkable avenue.
 *
 * A block is the same fork-and-merge unit run twice, so the walk builds that
 * unit twice and mirrors it the second time: bypass lane on one side, the
 * operator and its output stacked in the bay opposite, then the sum standing
 * over the runway where the two lanes converge. Mirroring matters here — the two
 * bypass trays are near-identical boards, and side by side in one lane they
 * would simply queue up on a single sightline. The arithmetic glyphs stand at
 * the runway edge beside the merge they belong to, alternating sides so the plus
 * never hides the equals.
 */
function buildTransformerBlock(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const process = new THREE.Group();
  process.name = "early-process-transformer-block-fork-and-merge-foundry";
  context.group.add(process);

  const title = createPanel(["ONE BLOCK: TWO REAL FORKS + TWO REAL ADDS", "H -> U -> H' · shape [2 x 6 x 8]"], {
    width: 13.2,
    height: 1.9,
    color: WHITE,
    borderColor: context.palette.phaseBase,
  });
  placeOnAvenue(title, { stop: 0, slot: "banner" });
  process.add(title);

  const boardOptions = (titleText: string, color: THREE.ColorRepresentation) => ({
    width: 5.2,
    cellHeight: 0.72,
    title: titleText,
    color,
    unknownIndices: Array.from({ length: 8 }, (_, index) => index),
  });
  const inputH = createValueBoard(UNKNOWN_EIGHT, 1, 8, {
    ...boardOptions("selected H[8]", CYAN),
    width: 7.8,
    cellHeight: 0.95,
  });
  placeOnAvenue(inputH, { stop: 0, slot: "centre", offset: [0, -1.1, 0] });
  const residualH = createValueBoard(UNKNOWN_EIGHT, 1, 8, boardOptions("H bypass", CYAN));
  const attentionA = createValueBoard(UNKNOWN_EIGHT, 1, 8, boardOptions("A=MHA(LN1(H))", VIOLET));
  placeOnAvenue(residualH, { stop: 1, slot: "left" });
  placeOnAvenue(attentionA, { stop: 1, slot: "right" });
  const firstPlus = createGlyph("+", GOLD, 1.9);
  placeOnAvenue(firstPlus, { stop: 2, slot: "left", xShift: -2.8, zShift: 2.6 });
  const firstEquals = createGlyph("=", WHITE, 1.7);
  placeOnAvenue(firstEquals, { stop: 2, slot: "right", xShift: -2.8, zShift: 2.0 });
  const uBoard = createValueBoard(UNKNOWN_EIGHT, 1, 8, {
    ...boardOptions("U = H + A", GREEN),
    width: 7.8,
    cellHeight: 0.95,
  });
  placeOnAvenue(uBoard, { stop: 2, slot: "centre" });

  const expansion = createValueBoard(Array.from({ length: 32 }, () => "·"), 4, 8, {
    width: 5.9,
    cellHeight: 0.4,
    title: "shared MLP: 8 -> 32 GELU -> 8",
    subtitle: "positions remain independent",
    color: CORAL,
    unknownIndices: Array.from({ length: 32 }, (_, index) => index),
  });
  placeOnAvenue(expansion, { stop: 3, slot: "left" });
  const residualU = createValueBoard(UNKNOWN_EIGHT, 1, 8, boardOptions("U bypass", GREEN));
  const mlpF = createValueBoard(UNKNOWN_EIGHT, 1, 8, boardOptions("F=MLP(LN2(U))", CORAL));
  placeOnAvenue(residualU, { stop: 3, slot: "right" });
  placeOnAvenue(mlpF, { stop: 4, slot: "left", offset: [0, 2.1, 0] });
  const secondPlus = createGlyph("+", GOLD, 1.9);
  placeOnAvenue(secondPlus, { stop: 4, slot: "right", xShift: -2.8, zShift: -1.6 });
  const secondEquals = createGlyph("=", WHITE, 1.7);
  placeOnAvenue(secondEquals, { stop: 5, slot: "left", xShift: -2.8, zShift: 2.4 });
  const output = createValueBoard(UNKNOWN_EIGHT, 1, 8, {
    ...boardOptions("H' = U + F", GOLD),
    width: 7.8,
    cellHeight: 0.95,
  });
  placeOnAvenue(output, { stop: 5, slot: "centre" });
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

  // Each operator plaque hangs a row above the board it produces, so the bay
  // reads top-down as "this transform, then its result".
  const attentionOperator = createPanel(["LN1", "CAUSAL ATTENTION"], {
    width: 4.6,
    height: 1.8,
    color: VIOLET,
    borderColor: VIOLET,
  });
  placeOnAvenue(attentionOperator, { stop: 1, slot: "right", row: 1 });
  process.add(attentionOperator);
  const ln2Operator = createPanel(["LN2", "12 ISOLATED MLP LANES"], {
    width: 5.2,
    height: 1.8,
    color: CORAL,
    borderColor: CORAL,
  });
  placeOnAvenue(ln2Operator, { stop: 3, slot: "left", row: 1 });
  process.add(ln2Operator);

  const forkPoint = avenueAnchor({ stop: 0, slot: "centre", offset: [0, -1.6, 0] });
  const firstResidualPath = avenueRoute(forkPoint, avenueAnchor({ stop: 1, slot: "left" }), 1.0);
  const attentionPath = avenueRoute(forkPoint, avenueAnchor({ stop: 1, slot: "right" }), 1.0);
  const secondForkPoint = avenueAnchor({ stop: 2, slot: "centre", offset: [0, -1.4, 0] });
  const secondResidualPath = avenueRoute(
    secondForkPoint,
    avenueAnchor({ stop: 3, slot: "right" }),
    1.0,
  );
  const mlpPath = avenueRoute(secondForkPoint, avenueAnchor({ stop: 3, slot: "left" }), 1.0);
  process.add(createPath(firstResidualPath, CYAN, 0.05, 0.42));
  process.add(createPath(attentionPath, VIOLET, 0.05, 0.42));
  process.add(createPath(secondResidualPath, GREEN, 0.05, 0.42));
  process.add(createPath(mlpPath, CORAL, 0.05, 0.42));

  const residualHHome = residualH.position.clone();
  const attentionAHome = attentionA.position.clone();
  const residualUHome = residualU.position.clone();
  const mlpFHome = mlpF.position.clone();
  const residualHYaw = residualH.rotation.y;
  const attentionAYaw = attentionA.rotation.y;
  const residualUYaw = residualU.rotation.y;
  const mlpFYaw = mlpF.rotation.y;
  // Operands meet just in front of the sum, up in the arch tier: they converge
  // over the walkway rather than across it, and straighten as they go so the
  // addition is read face-on.
  const firstMergePoint = avenueAnchor({ stop: 2, slot: "centre", zShift: 2.8, offset: [0, -1.3, 0] });
  const secondMergePoint = avenueAnchor({ stop: 5, slot: "centre", zShift: 2.8, offset: [0, -1.3, 0] });

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    setObjectOpacity(inputH, 1 - smoothStep(p, 0.12, 0.24));
    setBoardFocus(residualH, p, 0.08, 0.2);
    setBoardFocus(attentionOperator, p, 0.1, 0.22);
    setBoardFocus(attentionA, p, 0.18, 0.3);
    setBoardFocus(firstPlus, p, 0.25, 0.34);
    const firstMerge = smoothStep(p, 0.3, 0.43);
    moveObject(residualH, residualHHome, firstMergePoint.clone().add(vector(-3.3, 0, 0)), firstMerge);
    moveObject(attentionA, attentionAHome, firstMergePoint.clone().add(vector(3.3, 0, 0)), firstMerge);
    residualH.rotation.y = residualHYaw * (1 - firstMerge);
    attentionA.rotation.y = attentionAYaw * (1 - firstMerge);
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
    moveObject(residualU, residualUHome, secondMergePoint.clone().add(vector(3.3, 0, 0)), secondMerge);
    moveObject(mlpF, mlpFHome, secondMergePoint.clone().add(vector(-3.3, 0, 0)), secondMerge);
    residualU.rotation.y = residualUYaw * (1 - secondMerge);
    mlpF.rotation.y = mlpFYaw * (1 - secondMerge);
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

/**
 * Multi-Head Attention Hall, laid out as a walkable avenue.
 *
 * Q, K and V are three runs of one operation, so the walk gives each its own
 * identical bay: learned wall on the left, multiply glyph over the runway,
 * resulting row on the right. Three bays that look the same say "these are
 * parallel" far more plainly than three interchangeable boards crowded into one
 * tableau. The reshape arch then splits the rows into the two head trays that
 * face each other across the final stop.
 */
function buildMultiHeadAttention(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const process = new THREE.Group();
  process.name = "early-process-qkv-three-wing-projection-fan";
  context.group.add(process);

  const title = createPanel(["PROJECT FIRST, THEN SPLIT INTO HEADS", "N=LN1(H) -> Q/K/V [8] -> head 0 [4] | head 1 [4]"], {
    width: 14.5,
    height: 2.4,
    color: WHITE,
    borderColor: context.palette.phaseBase,
  });
  // Hung level with the input board rather than behind it, so the two share the
  // frame instead of one covering the other.
  placeOnAvenue(title, { stop: 0, slot: "banner", zShift: 0 });
  process.add(title);

  const input = createValueBoard(UNKNOWN_TWELVE, 2, 6, {
    width: 8.2,
    cellHeight: 0.66,
    title: "N = LN1(H) [2 x 6 x 8]",
    subtitle: "12 normalized vectors fan out three ways",
    color: BLUE,
    unknownIndices: Array.from({ length: 12 }, (_, index) => index),
    highlightedIndices: [2],
    accent: GOLD,
  });
  // Sits at the low end of the arch tier — just clear of the walkway — so the
  // banner hanging behind it still reads over the top.
  placeOnAvenue(input, { stop: 0, slot: "centre", offset: [0, -1.15, 0] });
  input.name = "assistant-target-mha-normalized-input";
  process.add(input);

  const projectionColors = [CYAN, VIOLET, GREEN] as const;
  const projectionNames = ["WQ [8 x 8]", "WK [8 x 8]", "WV [8 x 8]"] as const;
  const projectionTargetNames = [
    "assistant-target-mha-query-projection",
    "assistant-target-mha-key-projection",
    "assistant-target-mha-value-projection",
  ] as const;
  // Stops 1, 2 and 3 are the query, key and value bays, each built the same
  // way, so the repetition itself says "these three run in parallel". The bays
  // mirror alternately: putting three identical 8×8 walls in one lane would
  // stack them on a single sightline, whereas alternating means each lane shows
  // a tall wall, then a short row, then a tall wall.
  const projectionStop = [1, 2, 3] as const;
  const wallSide = ["left", "right", "left"] as const;
  const rowSide = ["right", "left", "right"] as const;
  const projectionWalls = projectionNames.map((name, index) => {
    const wall = createValueBoard(Array.from({ length: 64 }, () => "·"), 8, 8, {
      width: 4.6,
      cellHeight: 0.44,
      title: name,
      subtitle: "learned projection",
      color: GOLD,
      unknownIndices: Array.from({ length: 64 }, (_, cell) => cell),
      accent: projectionColors[index],
    });
    placeOnAvenue(wall, {
      stop: projectionStop[index],
      slot: wallSide[index],
      offset: [0, 0.8, 0],
    });
    wall.name = projectionTargetNames[index];
    process.add(wall);
    // The multiply sign belongs to its bay, so it stands at the runway edge
    // beside that bay's wall. Hanging all three over the centre line instead
    // would put them on one sightline, where the nearest hides the rest.
    const multiply = createGlyph("x", projectionColors[index], 1.5);
    placeOnAvenue(multiply, {
      stop: projectionStop[index],
      slot: wallSide[index],
      xShift: -2.6,
      zShift: 1.6,
      offset: [0, 0.8, 0],
    });
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
      width: 5.6,
      cellHeight: 0.74,
      title: `${["Q2", "K2", "V2"][index]} projected [8]`,
      subtitle: "first 4 cells = selected head 0",
      color: projectionColors[index],
      highlightedIndices: [0, 1, 2, 3],
      unknownIndices: [4, 5, 6, 7],
      accent: GOLD,
    });
    placeOnAvenue(board, { stop: projectionStop[index], slot: rowSide[index] });
    board.name = qkvTargetNames[index];
    process.add(board);
    return board;
  });
  const qkvHome = qkvBoards.map((board) => board.position.clone());
  const qkvYaw = qkvBoards.map((board) => board.rotation.y);

  const splitter = createPanel(["RESHAPE / UNZIP", "[8] -> HEAD 0 [4] | HEAD 1 [4]", "split projected Q/K/V, not raw N"], {
    width: 9.2,
    height: 2.3,
    color: GOLD,
    borderColor: GOLD,
  });
  placeOnAvenue(splitter, { stop: 4, slot: "centre" });
  splitter.name = "assistant-target-mha-head-split";
  process.add(splitter);

  const head0Values = [
    ...SELECTED_TRACE.attention.query,
    ...selectedKey,
    ...selectedValue,
  ];
  const head0 = createValueBoard(head0Values, 3, 4, {
    width: 6.2,
    cellHeight: 0.78,
    title: "HEAD 0: Q2 | K2 | V2",
    subtitle: "exact selected four-feature values",
    color: CYAN,
    highlightedIndices: Array.from({ length: 12 }, (_, index) => index),
    accent: GOLD,
  });
  placeOnAvenue(head0, { stop: 5, slot: "left" });
  head0.name = "assistant-target-mha-head-0";
  const head1 = createValueBoard(Array.from({ length: 12 }, () => "·"), 3, 4, {
    width: 6.2,
    cellHeight: 0.78,
    title: "HEAD 1: Q | K | V",
    subtitle: "separate learned four-feature view",
    color: VIOLET,
    unknownIndices: Array.from({ length: 12 }, (_, index) => index),
  });
  placeOnAvenue(head1, { stop: 5, slot: "right" });
  head1.name = "assistant-target-mha-head-1";
  process.add(head0, head1);

  const inputPoint = avenueAnchor({ stop: 0, slot: "centre" }).setY(4.2);
  const fanPaths = projectionStop.map((stop, index) =>
    avenueRoute(
      inputPoint,
      avenueAnchor({
        stop,
        slot: wallSide[index],
        zShift: 2.8,
        offset: [0, 0.8, 0],
      }),
      1.2,
    ),
  );
  fanPaths.forEach((path, index) => process.add(createPath(path, projectionColors[index], 0.055, 0.46)));
  const fanPackets = projectionColors.map((color) => {
    const packet = createPacket(color, 0.21);
    process.add(packet);
    return packet;
  });
  const splitOrigin = avenueAnchor({ stop: 4, slot: "centre", zShift: -1.4 });
  const splitLeftPath = avenueRoute(
    splitOrigin,
    avenueAnchor({ stop: 5, slot: "left", zShift: 2.2 }),
    0.6,
  );
  const splitRightPath = avenueRoute(
    splitOrigin,
    avenueAnchor({ stop: 5, slot: "right", zShift: 2.2 }),
    0.6,
  );
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
    // The three projected rows leave their rack and gather under the reshape
    // arch, straightening as they go so the split is read face-on.
    const gatherTarget = avenueAnchor({ stop: 4, slot: "centre", zShift: 2.4 });
    qkvBoards.forEach((board, index) => {
      const gather = smoothStep(p, 0.54 + index * 0.015, 0.72 + index * 0.015);
      moveObject(
        board,
        qkvHome[index],
        gatherTarget.clone().add(vector((index - 1) * 6.0, -1.1, 0)),
        gather,
        0.18,
      );
      board.rotation.y = qkvYaw[index] * (1 - gather);
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
