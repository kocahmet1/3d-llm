import * as THREE from "three";

import { SELECTED_TRACE } from "../../lib/trainingTrace";
import {
  type ChamberProcessContext,
  type ChamberProcessUpdater,
  createGlyph,
  createPacket,
  createPanel,
  createPath,
  createProcessMaterial,
  createValueBoard,
  moveObject,
  pulseObject,
  samplePath,
  setObjectEmissive,
  setObjectOpacity,
  smoothStep,
  vector,
  windowPulse,
} from "./processShared";

const CYAN = "#63e9ff";
const BLUE = "#6da8ff";
const VIOLET = "#ad9cff";
const GREEN = "#70efb8";
const GOLD = "#ffd166";
const CORAL = "#ff765f";
const PINK = "#ff4f86";
const STEEL = "#b7c8d8";
const DARK = "#142638";

const SCORE_ROW = [...SELECTED_TRACE.attention.scaledScoresBeforeMask];
const WEIGHTS = [...SELECTED_TRACE.attention.attentionWeights];
const HEAD_ZERO = [...SELECTED_TRACE.attention.weightedValue];

function add<T extends THREE.Object3D>(
  parent: THREE.Object3D,
  object: T,
  position?: THREE.Vector3,
): T {
  if (position) object.position.copy(position);
  parent.add(object);
  return object;
}

function processRoot(context: ChamberProcessContext) {
  const root = new THREE.Group();
  root.name = `distinct-process-${context.stationId}`;
  context.group.add(root);
  return root;
}

function stageLabel(
  root: THREE.Object3D,
  lines: readonly string[],
  position: THREE.Vector3,
  color: THREE.ColorRepresentation = CYAN,
  width = 5.4,
) {
  return add(
    root,
    createPanel(lines, {
      width,
      height: Math.max(0.82, 0.48 + lines.length * 0.4),
      color: "#eefaff",
      borderColor: color,
      fontScale: 0.82,
    }),
    position,
  );
}

function addDeck(
  root: THREE.Object3D,
  position: THREE.Vector3,
  size: THREE.Vector3,
  color: THREE.ColorRepresentation,
) {
  const material = createProcessMaterial(color, 0.28, 0.34);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  deck.position.copy(position);
  root.add(deck);
  return deck;
}

function visibilityWindow(
  progress: number,
  enterStart: number,
  enterEnd: number,
  exitStart = 1,
  exitEnd = 1,
) {
  return Math.min(
    smoothStep(progress, enterStart, enterEnd),
    1 - smoothStep(progress, exitStart, exitEnd),
  );
}

function finaliseUpdater(updater: ChamberProcessUpdater) {
  updater(0, 0, false);
  return updater;
}

function makeScoreMatrix(masked = false) {
  return Array.from({ length: 36 }, (_, index) => {
    const row = Math.floor(index / 6);
    const column = index % 6;
    if (row === 2) {
      if (masked && column > 2) return "-INF";
      return SCORE_ROW[column];
    }
    if (masked && column > row) return "-INF";
    return `s${row}${column}`;
  });
}

function makeMaskMatrix() {
  return Array.from({ length: 36 }, (_, index) => {
    const row = Math.floor(index / 6);
    const column = index % 6;
    return column > row ? "-INF" : 0;
  });
}

function buildOneHead(context: ChamberProcessContext): ChamberProcessUpdater {
  const root = processRoot(context);
  const overviewDeck = addDeck(
    root,
    vector(0, -3.15, -0.4),
    vector(17.2, 0.18, 13.8),
    DARK,
  );
  overviewDeck.name = "assistant-target-qkv-overview";
  stageLabel(root, ["QUERY TESTS KEYS", "VALUES WAIT AS PAYLOAD"], vector(0, 4.25, -5.8), CYAN, 6.6);

  const tokenNames = ["<bos>", "the", "cat", "sat", "on", "the"];
  const exactKeys: readonly (readonly (number | string)[])[] = [
    [1, 1, 1, 1.2],
    [0.2, 0.2, 0.2, 0.2],
    [-0.1, -0.1, -0.2, -0.2],
    ["k30", "k31", "k32", "k33"],
    ["k40", "k41", "k42", "k43"],
    ["k50", "k51", "k52", "k53"],
  ];
  const exactValues: readonly (readonly (number | string)[])[] = [
    [...SELECTED_TRACE.attention.allowedValues[0]],
    [...SELECTED_TRACE.attention.allowedValues[1]],
    [...SELECTED_TRACE.attention.allowedValues[2]],
    ["v30", "v31", "v32", "v33"],
    ["v40", "v41", "v42", "v43"],
    ["v50", "v51", "v52", "v53"],
  ];
  const bayX = [-7.15, -4.3, -1.43, 1.43, 4.3, 7.15];
  const keys: THREE.Group[] = [];
  const values: THREE.Group[] = [];
  const tokenLabels: THREE.Object3D[] = [];

  bayX.forEach((x, index) => {
    const unknown = index > 2 ? [0, 1, 2, 3] : undefined;
    const key = createValueBoard(exactKeys[index], 1, 4, {
      width: 2.12,
      cellHeight: 0.42,
      title: `K${index} LOCK`,
      color: VIOLET,
      unknownIndices: unknown,
      fontScale: 0.72,
    });
    key.name = "assistant-target-qkv-keys";
    key.position.set(x, 0.95 + Math.cos(index * 0.75) * 0.2, 0.7 - Math.abs(x) * 0.075);
    root.add(key);
    keys.push(key);

    const value = createValueBoard(exactValues[index], 1, 4, {
      width: 2.12,
      cellHeight: 0.42,
      title: `V${index} CARGO`,
      color: GREEN,
      unknownIndices: unknown,
      fontScale: 0.72,
    });
    value.name = "assistant-target-qkv-values";
    value.position.set(x, -1.55, -2.45 - Math.abs(x) * 0.035);
    root.add(value);
    values.push(value);

    tokenLabels.push(
      stageLabel(root, [`j${index}  ${tokenNames[index]}`], vector(x, 2.72, key.position.z), index === 2 ? GOLD : STEEL, 1.82),
    );
  });

  const query = add(
    root,
    createValueBoard([...SELECTED_TRACE.attention.query], 1, 4, {
      width: 3.15,
      cellHeight: 0.56,
      title: "q2 = CAT ASKS",
      subtitle: "[1, 1, 1, 1]",
      color: CYAN,
      accent: GOLD,
    }),
    vector(0, 3.28, 5.75),
  );
  query.name = "assistant-target-qkv-query";

  const queryPackets = [0, 1, 2].map((index) => {
    const packet = createPacket(CYAN, 0.2);
    root.add(packet);
    const path = createPath(
      [vector(0, 3.05, 4.9), vector(bayX[index] * 0.45, 2.55, 2.9), vector(bayX[index], 2.15, keys[index].position.z + 0.35)],
      CYAN,
      0.035,
      0.24,
    );
    root.add(path);
    return { packet, path };
  });

  const scoreLabels = ["4.20", "0.80", "-0.60"];
  const scoreCoins = scoreLabels.map((score, index) => {
    const coin = createPanel([`q2 dot K${index}`, score], {
      width: 1.82,
      height: 1.0,
      color: index === 2 ? CORAL : "#ffffff",
      borderColor: index === 2 ? CORAL : CYAN,
      fontScale: 0.78,
    });
    coin.position.set(bayX[index], 3.35, keys[index].position.z - 0.1);
    root.add(coin);
    return coin;
  });

  const valueMessage = stageLabel(
    root,
    ["V0..V2 STAY PUT", "weights arrive after softmax"],
    vector(0, -2.35, -5.45),
    GREEN,
    5.9,
  );

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    setObjectOpacity(query, 0.34 + smoothStep(p, 0.01, 0.12) * 0.66);
    keys.forEach((key, index) => {
      setObjectOpacity(key, 0.2 + smoothStep(p, 0.03 + index * 0.012, 0.18 + index * 0.012) * 0.8);
      setObjectOpacity(tokenLabels[index], 0.24 + smoothStep(p, 0.02, 0.15) * 0.76);
    });
    values.forEach((value, index) => {
      const reveal = smoothStep(p, 0.52 + index * 0.012, 0.68 + index * 0.012);
      setObjectOpacity(value, 0.1 + reveal * (index < 3 ? 0.9 : 0.42));
      if (motionEnabled && index < 3 && reveal > 0) {
        setObjectEmissive(value, 0.38 + Math.sin(elapsed * 3.4 + index) * 0.12 + reveal * 0.45);
      }
    });

    queryPackets.forEach(({ packet, path }, index) => {
      const start = 0.16 + index * 0.105;
      const travel = smoothStep(p, start, start + 0.16);
      samplePath(packet, [vector(0, 3.05, 4.9), vector(bayX[index] * 0.45, 2.55, 2.9), vector(bayX[index], 2.15, keys[index].position.z + 0.35)], travel, 0.22);
      setObjectOpacity(packet, visibilityWindow(p, start, start + 0.035, start + 0.15, start + 0.2));
      setObjectOpacity(path, 0.08 + windowPulse(p, start, start + 0.08, start + 0.22) * 0.68);
      if (motionEnabled) pulseObject(packet, elapsed + index * 0.4, 5.2, 0.1);

      const coinReveal = smoothStep(p, start + 0.12, start + 0.18);
      const handoff = smoothStep(p, 0.58 + index * 0.025, 0.78 + index * 0.025);
      moveObject(
        scoreCoins[index],
        vector(bayX[index], 3.35, keys[index].position.z - 0.1),
        vector((index - 1) * 2.5, 3.15, -6.55),
        handoff,
        0.45,
      );
      setObjectOpacity(scoreCoins[index], coinReveal);
    });
    setObjectOpacity(valueMessage, smoothStep(p, 0.64, 0.8));
  };
  return finaliseUpdater(updater);
}

function buildAttentionScores(context: ChamberProcessContext): ChamberProcessUpdater {
  const root = processRoot(context);
  addDeck(root, vector(0, -3.18, -0.8), vector(16.8, 0.16, 14.2), DARK);
  stageLabel(root, ["FOUR PRODUCTS", "SUM, SCALE, WRITE ONE CELL"], vector(0, 4.25, -6.2), VIOLET, 6.8);

  const qBoard = add(
    root,
    createValueBoard([1, 1, 1, 1], 1, 4, {
      width: 3.25,
      title: "q2",
      color: CYAN,
    }),
    vector(-5.7, 2.55, 5.65),
  );
  const kBoard = add(
    root,
    createValueBoard([1, 1, 1, 1.2], 1, 4, {
      width: 3.25,
      title: "k0",
      color: VIOLET,
    }),
    vector(5.7, 2.55, 5.65),
  );
  const dot = add(root, createGlyph("DOT", GOLD, 1.25), vector(0, 2.55, 3.7));
  const products = add(
    root,
    createValueBoard([1, 1, 1, 1.2], 1, 4, {
      width: 3.55,
      title: "PAIRWISE PRODUCTS",
      color: BLUE,
    }),
    vector(0, 2.45, 1.62),
  );
  const sigma = add(root, createGlyph("SUM", GOLD, 1.35), vector(-2.0, 0.35, -0.05));
  const raw = add(
    root,
    createValueBoard([4.2], 1, 1, { width: 1.55, title: "RAW", color: GOLD }),
    vector(-0.45, 0.35, -0.05),
  );
  const divide = add(root, createGlyph("/ 2", STEEL, 1.35), vector(1.18, 0.35, -0.05));
  const scaled = add(
    root,
    createValueBoard([2.1], 1, 1, { width: 1.55, title: "S[2,0]", color: CYAN, accent: GOLD }),
    vector(2.9, 0.35, -0.05),
  );

  const unknownIndices = Array.from({ length: 36 }, (_, index) => index).filter(
    (index) => Math.floor(index / 6) !== 2,
  );
  const matrix = add(
    root,
    createValueBoard(makeScoreMatrix(false), 6, 6, {
      width: 7.35,
      cellHeight: 0.44,
      title: "SCORE MATRIX S [6 x 6]",
      subtitle: "row 2 exact; other rows symbolic",
      color: CYAN,
      accent: GOLD,
      highlightedIndices: [12, 13, 14, 15, 16, 17],
      unknownIndices,
      fontScale: 0.82,
    }),
    vector(0, 0.15, -5.55),
  );
  matrix.name = "assistant-target-attention-score-matrix";
  const beamMaterial = createProcessMaterial(GOLD, 1.3, 0.74);
  const rowBeam = add(
    root,
    new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.07, 0.08), beamMaterial),
    vector(0, 0.32, -5.38),
  );
  rowBeam.name = "assistant-target-attention-score-row-2";
  const columnBeam = add(
    root,
    new THREE.Mesh(new THREE.BoxGeometry(0.07, 3.0, 0.08), createProcessMaterial(CYAN, 1.3, 0.72)),
    vector(-3.02, 0.55, -5.35),
  );
  columnBeam.name = "assistant-target-attention-score-cell-q2-k0";

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const meet = smoothStep(p, 0.08, 0.23);
    moveObject(qBoard, vector(-5.7, 2.55, 5.65), vector(-2.05, 2.55, 3.7), meet, 0.2);
    moveObject(kBoard, vector(5.7, 2.55, 5.65), vector(2.05, 2.55, 3.7), meet, 0.2);
    setObjectOpacity(dot, visibilityWindow(p, 0.12, 0.22, 0.32, 0.42));
    setObjectOpacity(products, visibilityWindow(p, 0.25, 0.34, 0.46, 0.54));
    setObjectOpacity(qBoard, 1 - smoothStep(p, 0.31, 0.44) * 0.75);
    setObjectOpacity(kBoard, 1 - smoothStep(p, 0.31, 0.44) * 0.75);
    const sumReveal = visibilityWindow(p, 0.37, 0.45, 0.57, 0.66);
    setObjectOpacity(sigma, sumReveal);
    setObjectOpacity(raw, sumReveal);
    setObjectOpacity(divide, visibilityWindow(p, 0.45, 0.53, 0.61, 0.69));
    const scaledReveal = smoothStep(p, 0.51, 0.59);
    const write = smoothStep(p, 0.59, 0.72);
    moveObject(scaled, vector(2.9, 0.35, -0.05), vector(-3.0, 0.35, -4.98), write, 0.55);
    setObjectOpacity(scaled, scaledReveal * (1 - smoothStep(p, 0.7, 0.78)));
    setObjectOpacity(matrix, 0.08 + smoothStep(p, 0.55, 0.73) * 0.92);
    setObjectOpacity(rowBeam, smoothStep(p, 0.7, 0.79));
    setObjectOpacity(columnBeam, smoothStep(p, 0.75, 0.84));
    if (motionEnabled && p > 0.7) {
      rowBeam.scale.x = 1 + Math.sin(elapsed * 3.2) * 0.025;
      columnBeam.scale.y = 1 + Math.sin(elapsed * 3.2 + 1.2) * 0.04;
    } else {
      rowBeam.scale.set(1, 1, 1);
      columnBeam.scale.set(1, 1, 1);
    }
  };
  return finaliseUpdater(updater);
}

function buildCausalMask(context: ChamberProcessContext): ChamberProcessUpdater {
  const root = processRoot(context);
  addDeck(root, vector(0, -3.2, -0.6), vector(17.2, 0.18, 14.4), DARK);
  stageLabel(root, ["ELEMENTWISE MATRIX ADDITION", "raw scores + causal mask = masked scores"], vector(0, 4.2, -6.25), PINK, 7.4);

  const rawStart = vector(-4.65, 0.25, 3.7);
  const maskStart = vector(4.65, 0.25, 3.7);
  const overlay = vector(0, 0.25, 0.55);
  const raw = add(
    root,
    createValueBoard(makeScoreMatrix(false), 6, 6, {
      width: 6.25,
      cellHeight: 0.4,
      title: "RAW S",
      color: CYAN,
      highlightedIndices: [12, 13, 14, 15, 16, 17],
      unknownIndices: Array.from({ length: 36 }, (_, i) => i).filter((i) => Math.floor(i / 6) !== 2),
      fontScale: 0.76,
    }),
    rawStart,
  );
  const upperIndices = Array.from({ length: 36 }, (_, index) => index).filter(
    (index) => index % 6 > Math.floor(index / 6),
  );
  const mask = add(
    root,
    createValueBoard(makeMaskMatrix(), 6, 6, {
      width: 6.25,
      cellHeight: 0.4,
      title: "MASK M",
      color: STEEL,
      accent: PINK,
      maskedIndices: upperIndices,
      fontScale: 0.76,
    }),
    maskStart,
  );
  mask.name = "assistant-target-causal-mask-matrix";
  const plus = add(root, createGlyph("+", GOLD, 1.25), vector(0, 2.2, 3.78));
  const equals = add(root, createGlyph("=", GOLD, 1.25), vector(0, 2.2, -2.58));

  const result = add(
    root,
    createValueBoard(makeScoreMatrix(true), 6, 6, {
      width: 6.75,
      cellHeight: 0.42,
      title: "S + M = MASKED SCORES",
      subtitle: "future columns become -INF",
      color: CYAN,
      accent: PINK,
      highlightedIndices: [12, 13, 14],
      maskedIndices: upperIndices,
      unknownIndices: Array.from({ length: 36 }, (_, i) => i).filter(
        (i) => Math.floor(i / 6) !== 2 && !upperIndices.includes(i),
      ),
      fontScale: 0.78,
    }),
    vector(0, 0.2, -5.25),
  );
  result.name = "assistant-target-causal-mask-allowed";
  const selectedRow = add(
    root,
    createValueBoard([2.1, 0.4, -0.3, "-INF", "-INF", "-INF"], 1, 6, {
      width: 5.8,
      cellHeight: 0.52,
      title: "ROW 2 AFTER ADD",
      color: CYAN,
      accent: PINK,
      highlightedIndices: [0, 1, 2],
      maskedIndices: [3, 4, 5],
    }),
    vector(0, 3.62, -5.2),
  );

  const shutters = new THREE.Group();
  shutters.name = "assistant-target-causal-mask-future";
  const shutterMaterial = createProcessMaterial(PINK, 1.2, 0.88);
  upperIndices.forEach((index) => {
    const row = Math.floor(index / 6);
    const column = index % 6;
    const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.29, 0.25), shutterMaterial);
    shutter.position.set((column - 2.5) * 0.98, 1.45 - row * 0.38, 0);
    shutters.add(shutter);
  });
  shutters.position.set(0, 3.15, 0.88);
  root.add(shutters);

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    // Hold the operands apart through the midpoint so the visitor can read the
    // complete matrix equation before the physical overlay begins.
    const approach = smoothStep(p, 0.52, 0.68);
    moveObject(raw, rawStart, overlay, approach, 0.28);
    moveObject(mask, maskStart, vector(0, 0.25, 0.82), approach, 0.28);
    setObjectOpacity(plus, visibilityWindow(p, 0.05, 0.15, 0.58, 0.7));
    const slam = smoothStep(p, 0.64, 0.76);
    shutters.position.y = THREE.MathUtils.lerp(3.15, 0, slam);
    shutters.position.z = 0.88;
    if (motionEnabled && slam > 0.05 && slam < 1) {
      shutters.position.y += Math.sin(elapsed * 16) * 0.035 * slam;
    }
    setObjectOpacity(shutters, smoothStep(p, 0.61, 0.68) * (1 - smoothStep(p, 0.82, 0.9)));
    const consume = smoothStep(p, 0.72, 0.84);
    setObjectOpacity(raw, 1 - consume);
    setObjectOpacity(mask, 1 - consume);
    setObjectOpacity(equals, visibilityWindow(p, 0.73, 0.8, 0.89, 0.95));
    setObjectOpacity(result, smoothStep(p, 0.79, 0.91));
    setObjectOpacity(selectedRow, smoothStep(p, 0.9, 0.99));
    if (motionEnabled && p > 0.88) setObjectEmissive(result, 0.46 + Math.sin(elapsed * 2.5) * 0.08);
  };
  return finaliseUpdater(updater);
}

function buildSoftmaxWeightedValues(context: ChamberProcessContext): ChamberProcessUpdater {
  const root = processRoot(context);
  addDeck(root, vector(0, -3.2, -0.8), vector(17.2, 0.18, 14.4), DARK);
  stageLabel(root, ["NORMALIZE SIX SCORES", "WEIGHT THREE VECTORS, THEN SUM"], vector(0, 4.22, -6.4), GREEN, 7.2);

  const scoreBoard = add(
    root,
    createValueBoard([2.1, 0.4, -0.3, "-INF", "-INF", "-INF"], 1, 6, {
      width: 5.9,
      cellHeight: 0.5,
      title: "MASKED SCORE ROW",
      color: CYAN,
      maskedIndices: [3, 4, 5],
    }),
    vector(0, 3.45, 6.05),
  );
  const hoppers = new THREE.Group();
  hoppers.name = "six-softmax-exponential-hoppers";
  const hopperMaterials: THREE.MeshStandardMaterial[] = [];
  for (let index = 0; index < 6; index += 1) {
    const color = index > 2 ? PINK : index === 0 ? GOLD : CYAN;
    const material = createProcessMaterial(color, 0.7, 0.76);
    hopperMaterials.push(material);
    const hopper = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.35, 16, 1, true), material);
    hopper.rotation.x = Math.PI;
    hopper.position.set((index - 2.5) * 2.05, 1.22, 3.25);
    hoppers.add(hopper);
    const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.65, 12), material);
    throat.position.set((index - 2.5) * 2.05, 0.25, 3.25);
    hoppers.add(throat);
  }
  root.add(hoppers);
  stageLabel(root, ["exp", "masked -> 0"], vector(0, 2.75, 3.25), PINK, 3.8);

  const weightsBoard = add(
    root,
    createValueBoard(WEIGHTS, 1, 6, {
      width: 6.15,
      cellHeight: 0.52,
      title: "SOFTMAX A",
      subtitle: "sum = 1.0000",
      color: GREEN,
      accent: GOLD,
      highlightedIndices: [0],
    }),
    vector(0, 3.12, 0.55),
  );
  weightsBoard.name = "assistant-target-softmax-row";
  const aBoard = add(
    root,
    createValueBoard(WEIGHTS, 1, 6, {
      width: 3.65,
      cellHeight: 0.46,
      title: "A [1 x 6]",
      color: GREEN,
      highlightedIndices: [0],
    }),
    vector(-5.25, 0.35, -1.35),
  );
  aBoard.name = "assistant-target-attention-weight-bars";
  const values = [
    ...SELECTED_TRACE.attention.allowedValues.flat(),
    "v30", "v31", "v32", "v33",
    "v40", "v41", "v42", "v43",
    "v50", "v51", "v52", "v53",
  ];
  const vBoard = add(
    root,
    createValueBoard(values, 6, 4, {
      width: 4.1,
      cellHeight: 0.37,
      title: "V [6 x 4]",
      color: GREEN,
      unknownIndices: Array.from({ length: 12 }, (_, i) => i + 12),
      fontScale: 0.78,
    }),
    vector(4.65, 0.2, -1.35),
  );
  vBoard.name = "assistant-target-weighted-value-streams";
  const multiply = add(root, createGlyph("x", GOLD, 1.12), vector(0, 0.4, -1.3));

  const contributions = [
    [0.471178973, -0.157059658, 0.078529829, 0.392649144],
    [-0.014346106, 0.057384424, 0.114768847, -0.043038318],
    [0.021372196, 0.014248131, -0.028496261, 0.049868457],
  ].map((valuesForRow, index) => {
    const board = createValueBoard(valuesForRow, 1, 4, {
      width: 2.75,
      cellHeight: 0.46,
      title: `${WEIGHTS[index].toFixed(4)} x V${index}`,
      color: index === 0 ? GOLD : GREEN,
      fontScale: 0.72,
    });
    board.position.set((index - 1) * 5.2, -1.25, -4.4);
    root.add(board);
    return board;
  });
  const plusLeft = add(root, createGlyph("+", GOLD, 0.92), vector(-2.55, -1.2, -4.35));
  const plusRight = add(root, createGlyph("+", GOLD, 0.92), vector(2.55, -1.2, -4.35));
  const output = add(
    root,
    createValueBoard(HEAD_ZERO, 1, 4, {
      width: 4.5,
      cellHeight: 0.58,
      title: "HEAD OUTPUT z",
      subtitle: "componentwise contribution sum",
      color: CYAN,
      accent: GOLD,
    }),
    vector(0, 1.35, -7.05),
  );
  output.name = "assistant-target-weighted-value-output";

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const normalize = smoothStep(p, 0.08, 0.31);
    moveObject(scoreBoard, vector(0, 3.45, 6.05), vector(0, 3.05, 4.35), normalize, 0.18);
    setObjectOpacity(scoreBoard, 1 - smoothStep(p, 0.24, 0.4) * 0.72);
    hopperMaterials.forEach((material, index) => {
      const live = index < 3 ? 1 : 0.22;
      material.emissiveIntensity = 0.3 + normalize * live * (motionEnabled ? 0.65 + Math.sin(elapsed * 4 + index) * 0.12 : 0.7);
    });
    setObjectOpacity(weightsBoard, smoothStep(p, 0.22, 0.38));
    const matrixMeet = smoothStep(p, 0.36, 0.52);
    moveObject(aBoard, vector(-5.25, 0.35, -1.35), vector(-2.45, 0.35, -1.35), matrixMeet, 0.18);
    moveObject(vBoard, vector(4.65, 0.2, -1.35), vector(2.55, 0.2, -1.35), matrixMeet, 0.18);
    setObjectOpacity(aBoard, smoothStep(p, 0.3, 0.4) * (1 - smoothStep(p, 0.61, 0.71)));
    setObjectOpacity(vBoard, smoothStep(p, 0.3, 0.4) * (1 - smoothStep(p, 0.61, 0.71)));
    setObjectOpacity(multiply, visibilityWindow(p, 0.37, 0.46, 0.6, 0.69));

    const contributionReveal = smoothStep(p, 0.5, 0.66);
    const merge = smoothStep(p, 0.66, 0.82);
    contributions.forEach((board, index) => {
      moveObject(
        board,
        vector((index - 1) * 5.2, -1.25, -4.4),
        vector((index - 1) * 1.75, 0.25, -6.15),
        merge,
        0.36,
      );
      setObjectOpacity(board, contributionReveal * (1 - smoothStep(p, 0.78, 0.88)));
    });
    setObjectOpacity(plusLeft, visibilityWindow(p, 0.57, 0.65, 0.8, 0.88));
    setObjectOpacity(plusRight, visibilityWindow(p, 0.57, 0.65, 0.8, 0.88));
    setObjectOpacity(output, smoothStep(p, 0.75, 0.88));
    if (motionEnabled && p > 0.82) pulseObject(output, elapsed, 2.2, 0.025);
  };
  return finaliseUpdater(updater);
}

function buildHeadRecombination(context: ChamberProcessContext): ChamberProcessUpdater {
  const root = processRoot(context);
  addDeck(root, vector(0, -3.2, -0.8), vector(17.4, 0.18, 14.5), DARK);
  stageLabel(root, ["HEADS CLICK SIDE-BY-SIDE", "W_O MIXES, RESIDUAL ADDS"], vector(0, 4.22, -6.35), GOLD, 7.1);

  const head0Start = vector(-4.85, 3.0, 5.9);
  const head1Start = vector(4.85, 3.0, 5.9);
  const head0 = add(
    root,
    createValueBoard(HEAD_ZERO, 1, 4, {
      width: 3.45,
      cellHeight: 0.5,
      title: "HEAD 0 [4]",
      color: CYAN,
    }),
    head0Start,
  );
  head0.name = "assistant-target-recombine-head-zero-output";
  const head1 = add(
    root,
    createValueBoard(["z10", "z11", "z12", "z13"], 1, 4, {
      width: 3.45,
      cellHeight: 0.5,
      title: "HEAD 1 [4]",
      color: GREEN,
      unknownIndices: [0, 1, 2, 3],
    }),
    head1Start,
  );
  head1.name = "assistant-target-recombine-head-one-output";
  const concat = add(
    root,
    createValueBoard([...HEAD_ZERO, "z10", "z11", "z12", "z13"], 1, 8, {
      width: 6.8,
      cellHeight: 0.52,
      title: "CONCAT [8] -- NOT ADDITION",
      color: CYAN,
      accent: GOLD,
      unknownIndices: [4, 5, 6, 7],
    }),
    vector(0, 2.62, 2.55),
  );
  concat.name = "assistant-target-recombine-concatenation";
  const clamp = new THREE.Group();
  const clampMaterial = createProcessMaterial(GOLD, 1.05, 0.86);
  for (const x of [-3.7, 3.7]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.8, 0.18), clampMaterial);
    rail.position.x = x;
    clamp.add(rail);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.14, 0.18), clampMaterial);
  bridge.position.y = 0.9;
  clamp.add(bridge);
  clamp.position.set(0, 2.55, 2.8);
  root.add(clamp);

  const woValues = Array.from({ length: 64 }, (_, index) => `w${Math.floor(index / 8)}${index % 8}`);
  const wo = add(
    root,
    createValueBoard(woValues, 8, 8, {
      width: 5.75,
      cellHeight: 0.3,
      title: "LEARNED W_O [8 x 8]",
      color: GOLD,
      unknownIndices: Array.from({ length: 64 }, (_, i) => i),
      fontScale: 0.7,
    }),
    vector(0, -0.1, -0.55),
  );
  wo.name = "assistant-target-recombine-output-projection";
  const scanMaterial = createProcessMaterial(CYAN, 1.25, 0.75);
  const scan = add(
    root,
    new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.75, 0.08), scanMaterial),
    vector(-2.55, 0.0, -0.39),
  );
  scan.name = "assistant-target-recombine-output-projection";
  const outputO = add(
    root,
    createValueBoard(Array.from({ length: 8 }, (_, i) => `o${i}`), 1, 8, {
      width: 5.8,
      cellHeight: 0.46,
      title: "O = CONCAT x W_O",
      color: CYAN,
      unknownIndices: Array.from({ length: 8 }, (_, i) => i),
    }),
    vector(0, 2.85, -3.45),
  );
  outputO.name = "assistant-target-recombine-projected-output";
  const residualStart = vector(-6.15, -0.55, 3.7);
  const residual = add(
    root,
    createValueBoard(Array.from({ length: 8 }, (_, i) => `h${i}`), 1, 8, {
      width: 4.8,
      cellHeight: 0.45,
      title: "UNTOUCHED H",
      color: GREEN,
      unknownIndices: Array.from({ length: 8 }, (_, i) => i),
    }),
    residualStart,
  );
  residual.name = "assistant-target-recombine-residual-bypass";
  // The merge column lives on the right flank, beside the W_O wall rather
  // than behind it, so the residual add and the U result stay visible from
  // the chamber entrance instead of hiding behind the 8x8 matrix.
  root.add(
    createPath(
      [residualStart, vector(-7.2, -0.55, 0), vector(-4.9, -2.35, -5.9), vector(4.75, 2.05, -6.0)],
      GREEN,
      0.095,
      0.55,
    ),
  );
  const plus = add(root, createGlyph("+", GOLD, 1.12), vector(4.75, 1.1, -6.05));
  plus.name = "assistant-target-recombine-block-output";
  const result = add(
    root,
    createValueBoard(Array.from({ length: 8 }, (_, i) => `u${i}`), 1, 8, {
      width: 5.9,
      cellHeight: 0.52,
      title: "U = H + O",
      color: CYAN,
      accent: GOLD,
      unknownIndices: Array.from({ length: 8 }, (_, i) => i),
    }),
    vector(4.75, -1.35, -7.25),
  );
  result.name = "assistant-target-recombine-block-output";

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const dock = smoothStep(p, 0.08, 0.26);
    moveObject(head0, head0Start, vector(-1.75, 3.0, 3.2), dock, 0.16);
    moveObject(head1, head1Start, vector(1.75, 3.0, 3.2), dock, 0.16);
    setObjectOpacity(head0, 1 - smoothStep(p, 0.25, 0.38));
    setObjectOpacity(head1, 1 - smoothStep(p, 0.25, 0.38));
    setObjectOpacity(clamp, visibilityWindow(p, 0.14, 0.23, 0.35, 0.45));
    clamp.scale.x = THREE.MathUtils.lerp(1.38, 1, dock);
    setObjectOpacity(concat, visibilityWindow(p, 0.22, 0.36, 0.52, 0.64));
    setObjectOpacity(wo, 0.18 + smoothStep(p, 0.28, 0.42) * 0.82);
    const projection = smoothStep(p, 0.36, 0.59);
    scan.position.x = THREE.MathUtils.lerp(-2.55, 2.55, projection);
    setObjectOpacity(scan, visibilityWindow(p, 0.34, 0.4, 0.58, 0.66));
    setObjectOpacity(outputO, smoothStep(p, 0.51, 0.65) * (1 - smoothStep(p, 0.79, 0.9)));
    const merge = smoothStep(p, 0.65, 0.83);
    moveObject(residual, residualStart, vector(4.75, 2.05, -6.0), merge, 0.38);
    moveObject(outputO, vector(0, 2.85, -3.45), vector(4.75, 0.15, -6.0), merge, 0.38);
    setObjectOpacity(plus, visibilityWindow(p, 0.66, 0.73, 0.84, 0.92));
    setObjectOpacity(result, smoothStep(p, 0.8, 0.92));
    if (motionEnabled && p > 0.88) pulseObject(result, elapsed, 2.2, 0.025);
  };
  return finaliseUpdater(updater);
}

function buildMlp(context: ChamberProcessContext): ChamberProcessUpdater {
  const root = processRoot(context);
  addDeck(root, vector(0, -3.2, -0.7), vector(17.4, 0.18, 14.6), DARK);
  stageLabel(root, ["ONE TOKEN WIDENS", "8 -> 32 -> 8, THEN RESIDUAL"], vector(0, 4.2, -6.35), CORAL, 7.1);

  const tokenNames = SELECTED_TRACE.batch.inputTokenIds
    .flat()
    .map((id) => SELECTED_TRACE.vocabulary[id]);
  const queue = add(
    root,
    createValueBoard(tokenNames, 2, 6, {
      width: 6.2,
      cellHeight: 0.42,
      title: "12 INDEPENDENT TOKEN LANES",
      color: CYAN,
      accent: GOLD,
      highlightedIndices: [2],
      fontScale: 0.76,
    }),
    vector(0, 3.15, 6.1),
  );
  queue.name = "assistant-target-mlp-token-lanes";
  const input = add(
    root,
    createValueBoard(Array.from({ length: 8 }, (_, i) => `u${i}`), 1, 8, {
      width: 5.4,
      cellHeight: 0.48,
      title: "SELECTED U [8]",
      color: CYAN,
      unknownIndices: Array.from({ length: 8 }, (_, i) => i),
    }),
    vector(0, 1.45, 5.0),
  );
  input.name = "assistant-target-mlp-selected-input";
  const ln2Gate = add(
    root,
    createPanel(["LN2", "normalize 8 features"], {
      width: 3.2,
      height: 1.0,
      color: VIOLET,
      borderColor: VIOLET,
      fontScale: 0.72,
    }),
    vector(0, 3.05, 4.05),
  );
  ln2Gate.name = "assistant-target-mlp-layer-norm-gate";
  const normalizedInput = add(
    root,
    createValueBoard(Array.from({ length: 8 }, (_, i) => `n${i}`), 1, 8, {
      width: 5.15,
      cellHeight: 0.46,
      title: "LN2(U) [8]",
      subtitle: "normalized before W_up",
      color: VIOLET,
      unknownIndices: Array.from({ length: 8 }, (_, i) => i),
    }),
    vector(0, 1.2, 3.65),
  );
  normalizedInput.name = "assistant-target-mlp-normalized-input";

  const upWall = add(
    root,
    new THREE.Mesh(new THREE.BoxGeometry(14.5, 2.65, 0.28), createProcessMaterial(GOLD, 0.55, 0.68)),
    vector(0, 0.2, 2.8),
  );
  upWall.name = "assistant-target-mlp-up-projection";
  stageLabel(root, ["W_up [8 x 32]", "shared learned wall"], vector(0, 2.05, 2.85), GOLD, 4.4);
  const fanPaths: THREE.Object3D[] = [];
  for (let index = 0; index < 8; index += 1) {
    const fromX = (index - 3.5) * 0.68;
    const toX = (index - 3.5) * 1.55;
    const path = createPath([vector(fromX, 1.1, 3.55), vector(fromX, 0.7, 2.95), vector(toX, 0.6, 0.75)], VIOLET, 0.035, 0.3);
    root.add(path);
    fanPaths.push(path);
  }
  const upBias = add(
    root,
    createPanel(["+ b_up [32]", "bias before GELU"], {
      width: 3.55,
      height: 0.92,
      color: GOLD,
      borderColor: GOLD,
      fontScale: 0.72,
    }),
    vector(0, 2.0, 1.25),
  );
  upBias.name = "assistant-target-mlp-up-projection";

  const geluUnits = new THREE.Group();
  geluUnits.name = "assistant-target-mlp-gelu-activation";
  const unitMaterial = createProcessMaterial(CORAL, 1.0, 0.86);
  const units: THREE.Mesh[] = [];
  for (let index = 0; index < 32; index += 1) {
    const row = Math.floor(index / 8);
    const column = index % 8;
    const unit = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), unitMaterial);
    unit.position.set((column - 3.5) * 1.5, (row - 1.5) * 0.82, 0.1 + Math.sin(index * 0.8) * 0.18);
    geluUnits.add(unit);
    units.push(unit);
  }
  root.add(geluUnits);
  stageLabel(root, ["GELU [32]", "schematic activations"], vector(0, 2.55, 0.1), CORAL, 4.1);

  const downWall = add(
    root,
    new THREE.Mesh(new THREE.BoxGeometry(14.5, 2.65, 0.28), createProcessMaterial(GOLD, 0.55, 0.68)),
    vector(0, 0.2, -2.25),
  );
  downWall.name = "assistant-target-mlp-down-projection";
  stageLabel(root, ["W_down [32 x 8]", "funnel back to width 8"], vector(0, 2.05, -2.2), GOLD, 4.8);
  const contractionPaths: THREE.Object3D[] = [];
  for (let index = 0; index < 8; index += 1) {
    const fromX = (index - 3.5) * 1.5;
    const toX = (index - 3.5) * 0.68;
    const path = createPath([vector(fromX, 0.2, -0.55), vector(fromX, 0.45, -2.1), vector(toX, 0.8, -3.05), vector(toX, 0.8, -3.6)], CORAL, 0.035, 0.3);
    root.add(path);
    contractionPaths.push(path);
  }
  const downBias = add(
    root,
    createPanel(["+ b_down [8]", "bias before residual add"], {
      width: 3.65,
      height: 0.92,
      color: GOLD,
      borderColor: GOLD,
      fontScale: 0.7,
    }),
    vector(0, 2.0, -3.2),
  );
  downBias.name = "assistant-target-mlp-down-projection";
  const fBoard = add(
    root,
    createValueBoard(Array.from({ length: 8 }, (_, i) => `f${i}`), 1, 8, {
      width: 5.0,
      cellHeight: 0.46,
      title: "MLP OUTPUT F [8]",
      color: CORAL,
      unknownIndices: Array.from({ length: 8 }, (_, i) => i),
    }),
    vector(0, 1.25, -4.15),
  );
  fBoard.name = "assistant-target-mlp-output";
  const residual = add(
    root,
    createValueBoard(Array.from({ length: 8 }, (_, i) => `u${i}`), 1, 8, {
      width: 4.65,
      cellHeight: 0.44,
      title: "BYPASS U",
      color: GREEN,
      unknownIndices: Array.from({ length: 8 }, (_, i) => i),
    }),
    vector(-6.1, -1.25, 4.45),
  );
  residual.name = "assistant-target-mlp-residual-bypass";
  root.add(createPath([vector(-6.1, -1.25, 4.45), vector(-7.1, -1.1, 0), vector(-6.2, -0.35, -5.7), vector(-2.15, 0.2, -6.25)], GREEN, 0.09, 0.5));
  const plus = add(root, createGlyph("+", GOLD, 1.12), vector(0, 0.35, -6.22));
  plus.name = "assistant-target-mlp-block-output";
  const result = add(
    root,
    createValueBoard(Array.from({ length: 8 }, (_, i) => `h'${i}`), 1, 8, {
      width: 5.7,
      cellHeight: 0.5,
      title: "H' = U + F",
      color: CYAN,
      accent: GOLD,
      unknownIndices: Array.from({ length: 8 }, (_, i) => i),
    }),
    vector(0, -0.85, -7.35),
  );
  result.name = "assistant-target-mlp-block-output";

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    setObjectOpacity(queue, 1 - smoothStep(p, 0.08, 0.24) * 0.7);
    const enterNorm = smoothStep(p, 0.05, 0.18);
    moveObject(input, vector(0, 1.45, 5.0), vector(0, 1.45, 4.25), enterNorm, 0.1);
    setObjectOpacity(input, 1 - smoothStep(p, 0.16, 0.27));
    setObjectOpacity(ln2Gate, visibilityWindow(p, 0.05, 0.14, 0.28, 0.36));
    setObjectOpacity(normalizedInput, visibilityWindow(p, 0.17, 0.28, 0.41, 0.5));
    setObjectEmissive(upWall, 0.35 + windowPulse(p, 0.25, 0.39, 0.53) * 0.95);
    fanPaths.forEach((path, index) => setObjectOpacity(path, 0.08 + windowPulse(p, 0.28 + index * 0.005, 0.43, 0.57) * 0.62));
    setObjectOpacity(upBias, visibilityWindow(p, 0.38, 0.49, 0.61, 0.69));
    const expand = smoothStep(p, 0.42, 0.62);
    setObjectOpacity(geluUnits, expand * (1 - smoothStep(p, 0.72, 0.82) * 0.55));
    units.forEach((unit, index) => {
      const wave = motionEnabled ? Math.sin(elapsed * 4 + index * 0.52) : Math.sin(index * 0.52);
      const positive = Math.max(0, wave);
      unit.scale.set(0.72 + expand * 0.28, 0.36 + expand * (0.44 + positive * 0.48), 0.72 + expand * 0.28);
    });
    setObjectEmissive(downWall, 0.35 + windowPulse(p, 0.57, 0.69, 0.81) * 0.95);
    contractionPaths.forEach((path, index) => setObjectOpacity(path, 0.08 + windowPulse(p, 0.59 + index * 0.004, 0.72, 0.84) * 0.62));
    setObjectOpacity(downBias, visibilityWindow(p, 0.68, 0.76, 0.86, 0.92));
    setObjectOpacity(fBoard, smoothStep(p, 0.74, 0.84) * (1 - smoothStep(p, 0.92, 0.97)));
    const merge = smoothStep(p, 0.8, 0.93);
    moveObject(residual, vector(-6.1, -1.25, 4.45), vector(-2.15, 0.2, -6.25), merge, 0.35);
    moveObject(fBoard, vector(0, 1.25, -4.15), vector(2.15, 0.2, -6.25), merge, 0.35);
    setObjectOpacity(plus, visibilityWindow(p, 0.82, 0.88, 0.94, 0.98));
    setObjectOpacity(result, smoothStep(p, 0.91, 0.99));
    if (motionEnabled && p > 0.95) pulseObject(result, elapsed, 2.1, 0.022);
  };
  return finaliseUpdater(updater);
}

function buildFinalHidden(context: ChamberProcessContext): ChamberProcessUpdater {
  const root = processRoot(context);
  addDeck(root, vector(0, -3.2, -0.6), vector(17.3, 0.18, 14.3), DARK);
  stageLabel(root, ["FINAL LAYER NORM", "same 12 x 8 shape; context stays inside"], vector(0, 4.2, -6.35), VIOLET, 7.3);

  const tokenNames = SELECTED_TRACE.batch.inputTokenIds
    .flat()
    .map((id) => SELECTED_TRACE.vocabulary[id]);
  const tokenBoard = add(
    root,
    createValueBoard(tokenNames, 2, 6, {
      width: 6.2,
      cellHeight: 0.4,
      title: "H2: 12 CONTEXTUAL PODS",
      color: CYAN,
      accent: GOLD,
      highlightedIndices: [2],
      fontScale: 0.76,
    }),
    vector(0, 3.25, 6.05),
  );
  const pods = new THREE.Group();
  pods.name = "twelve-final-layernorm-pods";
  const podMaterial = createProcessMaterial(CYAN, 0.6, 0.74);
  for (let index = 0; index < 12; index += 1) {
    const row = Math.floor(index / 6);
    const column = index % 6;
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.72, 4, 10), podMaterial);
    pod.rotation.z = Math.PI / 2;
    pod.position.set((column - 2.5) * 2.35, (row - 0.5) * 1.45, 0);
    pods.add(pod);
  }
  pods.position.set(0, 0.45, 5.15);
  root.add(pods);

  const normRing = add(
    root,
    new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.18, 12, 64), createProcessMaterial(VIOLET, 1.1, 0.82)),
    vector(0, 0.55, 0),
  );
  const innerRing = add(
    root,
    new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.09, 10, 48), createProcessMaterial(GOLD, 1.0, 0.76)),
    vector(0, 0.55, 0.08),
  );
  const meanPlane = add(
    root,
    new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.08, 0.22), createProcessMaterial(STEEL, 1.0, 0.72)),
    vector(0, 0.55, 0.35),
  );
  stageLabel(root, ["subtract mean", "divide by std", "apply gamma + beta"], vector(0, 3.15, 0), VIOLET, 5.25);

  const before = add(
    root,
    createValueBoard(Array.from({ length: 8 }, (_, i) => `h${i}`), 1, 8, {
      width: 3.45,
      cellHeight: 0.43,
      title: "H2[cat]",
      color: CYAN,
      unknownIndices: Array.from({ length: 8 }, (_, i) => i),
      fontScale: 0.72,
    }),
    vector(-5.15, 3.65, 2.45),
  );
  const centered = add(
    root,
    createValueBoard(Array.from({ length: 8 }, (_, i) => `h${i}-mu`), 1, 8, {
      width: 3.55,
      cellHeight: 0.43,
      title: "CENTERED",
      color: STEEL,
      unknownIndices: Array.from({ length: 8 }, (_, i) => i),
      fontScale: 0.7,
    }),
    vector(0, 3.65, 0.45),
  );
  const normalized = add(
    root,
    createValueBoard(Array.from({ length: 8 }, (_, i) => `g${i}n${i}+b${i}`), 1, 8, {
      width: 3.75,
      cellHeight: 0.43,
      title: "H_FINAL[cat]",
      color: VIOLET,
      unknownIndices: Array.from({ length: 8 }, (_, i) => i),
      fontScale: 0.67,
    }),
    vector(5.05, 3.65, -2.4),
  );
  const finalBoard = add(
    root,
    createValueBoard(Array.from({ length: 12 }, (_, i) => `hF${i}[8]`), 2, 6, {
      width: 6.4,
      cellHeight: 0.45,
      title: "H_FINAL [2 x 6 x 8]",
      subtitle: "contextual values -- not probabilities",
      color: VIOLET,
      accent: GOLD,
      highlightedIndices: [2],
      unknownIndices: Array.from({ length: 12 }, (_, i) => i),
      fontScale: 0.72,
    }),
    vector(0, -0.3, -6.15),
  );

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    setObjectOpacity(tokenBoard, 1 - smoothStep(p, 0.15, 0.34) * 0.72);
    const travel = smoothStep(p, 0.12, 0.82);
    pods.position.z = THREE.MathUtils.lerp(5.15, -5.15, travel);
    pods.position.y = 0.45 + Math.sin(travel * Math.PI) * 0.18;
    setObjectOpacity(pods, 0.34 + smoothStep(p, 0.04, 0.16) * 0.66);
    setObjectEmissive(normRing, 0.45 + windowPulse(p, 0.22, 0.5, 0.78) * 0.95);
    setObjectEmissive(innerRing, 0.38 + windowPulse(p, 0.42, 0.59, 0.76) * 0.85);
    if (motionEnabled) {
      normRing.rotation.z = elapsed * 0.22;
      innerRing.rotation.z = -elapsed * 0.34;
    }
    meanPlane.position.y = THREE.MathUtils.lerp(1.3, 0.1, smoothStep(p, 0.3, 0.48));
    setObjectOpacity(meanPlane, visibilityWindow(p, 0.23, 0.31, 0.58, 0.68));
    setObjectOpacity(before, visibilityWindow(p, 0.12, 0.24, 0.4, 0.5));
    setObjectOpacity(centered, visibilityWindow(p, 0.34, 0.47, 0.62, 0.72));
    setObjectOpacity(normalized, smoothStep(p, 0.58, 0.74) * (1 - smoothStep(p, 0.84, 0.93)));
    setObjectOpacity(finalBoard, smoothStep(p, 0.78, 0.92));
    if (motionEnabled && p > 0.88) pulseObject(finalBoard, elapsed, 2.0, 0.02);
  };
  return finaliseUpdater(updater);
}

function buildVocabularyProjection(context: ChamberProcessContext): ChamberProcessUpdater {
  const root = processRoot(context);
  addDeck(root, vector(0, -3.2, -0.7), vector(17.4, 0.18, 14.5), DARK);
  stageLabel(root, ["ONE HIDDEN VECTOR", "SCANS W_VOCAB -> 16 RAW LOGITS"], vector(0, 4.2, -6.35), GOLD, 7.2);

  const hStart = vector(0, 3.45, 6.05);
  const hBoard = add(
    root,
    createValueBoard(Array.from({ length: 8 }, (_, i) => `h${i}`), 1, 8, {
      width: 5.4,
      cellHeight: 0.48,
      title: "h_final[batch0,pos2] [8]",
      subtitle: "values symbolic; shape exact",
      color: CYAN,
      unknownIndices: Array.from({ length: 8 }, (_, i) => i),
    }),
    hStart,
  );
  const weightValues = Array.from({ length: 128 }, (_, index) => `w${Math.floor(index / 16)}${index % 16}`);
  const weights = add(
    root,
    createValueBoard(weightValues, 8, 16, {
      width: 7.55,
      cellHeight: 0.31,
      title: "LEARNED W_VOCAB [8 x 16]",
      subtitle: "stationary parameters",
      color: GOLD,
      unknownIndices: Array.from({ length: 128 }, (_, i) => i),
      fontScale: 0.62,
    }),
    vector(0, 0.22, 0.65),
  );
  const rowBeam = add(
    root,
    new THREE.Mesh(new THREE.BoxGeometry(7.62, 0.08, 0.09), createProcessMaterial(CYAN, 1.4, 0.8)),
    vector(0, 1.42, 0.82),
  );

  const accumulators = new THREE.Group();
  accumulators.name = "sixteen-logit-accumulators";
  const accumulatorMaterial = createProcessMaterial(BLUE, 1.0, 0.78);
  const accumulatorMeshes: THREE.Mesh[] = [];
  for (let index = 0; index < 16; index += 1) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.28, 0.68, 10), accumulatorMaterial);
    mesh.position.set((index - 7.5) * 0.92, 3.05, -2.25);
    accumulators.add(mesh);
    accumulatorMeshes.push(mesh);
  }
  root.add(accumulators);
  stageLabel(root, ["16 SUM ACCUMULATORS", "one per vocabulary column"], vector(0, 4.35, -2.25), BLUE, 5.9);

  const productPackets = Array.from({ length: 16 }, (_, index) => {
    const packet = createPacket(index === SELECTED_TRACE.batch.selectedTargetTokenId ? GOLD : CYAN, 0.105);
    root.add(packet);
    return packet;
  });
  const bias = add(
    root,
    createValueBoard(Array.from({ length: 16 }, (_, i) => `b${i}`), 1, 16, {
      width: 7.25,
      cellHeight: 0.44,
      title: "+ b_vocab [16]",
      color: STEEL,
      unknownIndices: Array.from({ length: 16 }, (_, i) => i),
      fontScale: 0.65,
    }),
    vector(0, 3.05, -3.55),
  );
  const vocabulary = [...SELECTED_TRACE.vocabulary];
  const logitLabels = SELECTED_TRACE.output.selectedLogits.map(
    (value, index) => `${vocabulary[index]}:${value.toFixed(3)}`,
  );
  const logits = add(
    root,
    createValueBoard(logitLabels, 4, 4, {
      width: 7.3,
      cellHeight: 0.58,
      title: "RAW LOGITS [16]",
      subtitle: "scores, not probabilities -- softmax is next",
      color: BLUE,
      accent: GOLD,
      highlightedIndices: [SELECTED_TRACE.batch.selectedTargetTokenId],
      fontScale: 0.74,
    }),
    vector(0, -0.15, -6.35),
  );

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const dock = smoothStep(p, 0.08, 0.25);
    moveObject(hBoard, hStart, vector(0, 3.0, 2.75), dock, 0.18);
    setObjectOpacity(hBoard, 1 - smoothStep(p, 0.48, 0.62) * 0.72);
    setObjectOpacity(weights, 0.24 + smoothStep(p, 0.08, 0.22) * 0.76);
    const scan = smoothStep(p, 0.22, 0.59);
    rowBeam.position.y = THREE.MathUtils.lerp(1.42, -0.88, scan);
    setObjectOpacity(rowBeam, visibilityWindow(p, 0.19, 0.25, 0.58, 0.66));
    setObjectOpacity(accumulators, smoothStep(p, 0.2, 0.34));
    accumulatorMeshes.forEach((mesh, index) => {
      const pulse = motionEnabled ? Math.sin(elapsed * 5 + index * 0.45 + scan * 14) : Math.sin(index * 0.45);
      mesh.scale.y = 0.82 + scan * 0.22 + Math.max(0, pulse) * 0.12;
    });
    productPackets.forEach((packet, index) => {
      const delay = index * 0.0025;
      const travel = smoothStep(p, 0.25 + delay, 0.57 + delay);
      samplePath(
        packet,
        [vector((index - 7.5) * 0.42, 0.25, 1.0), vector((index - 7.5) * 0.7, 2.0, -0.8), vector((index - 7.5) * 0.92, 3.05, -2.25)],
        travel,
        0.28,
      );
      setObjectOpacity(packet, visibilityWindow(p, 0.23 + delay, 0.27 + delay, 0.58 + delay, 0.64 + delay));
      if (motionEnabled) packet.rotation.y = elapsed * 2 + index;
    });
    moveObject(bias, vector(0, 3.05, -3.55), vector(0, 1.7, -3.55), smoothStep(p, 0.55, 0.68), 0.12);
    setObjectOpacity(bias, visibilityWindow(p, 0.51, 0.58, 0.72, 0.82));
    setObjectOpacity(logits, smoothStep(p, 0.66, 0.86));
    if (motionEnabled && p > 0.84) pulseObject(logits, elapsed, 1.9, 0.018);
  };
  return finaliseUpdater(updater);
}

export function buildAttentionProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater | undefined {
  switch (context.stationId) {
    case "one-head-qkv":
      return buildOneHead(context);
    case "attention-scores":
      return buildAttentionScores(context);
    case "causal-mask":
      return buildCausalMask(context);
    case "softmax-weighted-v":
      return buildSoftmaxWeightedValues(context);
    case "head-recombination":
      return buildHeadRecombination(context);
    case "mlp":
      return buildMlp(context);
    case "final-hidden-state":
      return buildFinalHidden(context);
    case "vocabulary-projection":
      return buildVocabularyProjection(context);
    default:
      return undefined;
  }
}
