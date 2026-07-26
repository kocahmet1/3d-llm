import * as THREE from "three";

import { SELECTED_TRACE } from "../../lib/trainingTrace";
import {
  AVENUE,
  avenueAnchor,
  avenueRoute,
  avenueZ,
  placeOnAvenue,
} from "./avenue";
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

/**
 * One Head Q/K/V, laid out as a walkable avenue.
 *
 * The query asks its question from the opening arch, then the six positions it
 * could attend to become six bays down the walk — token name, key lock and
 * value cargo stacked in one lane so a position reads as a single column. The
 * bays mirror stop by stop, and each of the three answers the query actually
 * gets hangs in the lane opposite the bay that produced it. The three future
 * positions sit past the exit half of the walk, still dark, and the closing
 * note explains that the values have not moved yet.
 */
function buildOneHead(context: ChamberProcessContext): ChamberProcessUpdater {
  const root = processRoot(context);
  // The chamber shell lays its own runway, so the overview survives only as the
  // pair of plinths the bays stand on, clear of the walkway.
  const overviewDeck = new THREE.Group();
  overviewDeck.name = "assistant-target-qkv-overview";
  for (const side of [-1, 1]) {
    addDeck(
      overviewDeck,
      vector(side * 9.4, -4.35, avenueZ(3)),
      vector(9.6, 0.3, 34),
      DARK,
    );
  }
  root.add(overviewDeck);
  add(
    root,
    createPanel(["QUERY TESTS KEYS", "VALUES WAIT AS PAYLOAD"], {
      width: 13.6,
      height: 2.0,
      color: "#eefaff",
      borderColor: CYAN,
    }),
    avenueAnchor({ stop: 0, slot: "banner", zShift: 0 }),
  );

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
  // One bay per lane-stop, mirrored down the walk: a tall three-tier column,
  // then a single score coin opposite it, then another column. Six identical
  // bays in one lane would queue up on a single sightline.
  const baySlot = ["left", "right", "left", "right", "outer-left", "left"] as const;
  const bayStop = [1, 2, 3, 4, 4, 5] as const;
  const keys: THREE.Group[] = [];
  const values: THREE.Group[] = [];
  const tokenLabels: THREE.Object3D[] = [];

  tokenNames.forEach((tokenName, index) => {
    const unknown = index > 2 ? [0, 1, 2, 3] : undefined;
    const place = { stop: bayStop[index], slot: baySlot[index] };
    const key = placeOnAvenue(
      createValueBoard(exactKeys[index], 1, 4, {
        width: 5.6,
        cellHeight: 0.74,
        title: `K${index} LOCK`,
        color: VIOLET,
        unknownIndices: unknown,
        fontScale: 0.72,
      }),
      place,
    );
    key.name = "assistant-target-qkv-keys";
    root.add(key);
    keys.push(key);

    const value = placeOnAvenue(
      createValueBoard(exactValues[index], 1, 4, {
        width: 5.6,
        cellHeight: 0.74,
        title: `V${index} CARGO`,
        color: GREEN,
        unknownIndices: unknown,
        fontScale: 0.72,
      }),
      { ...place, row: -0.85 },
    );
    value.name = "assistant-target-qkv-values";
    root.add(value);
    values.push(value);

    tokenLabels.push(
      add(
        root,
        placeOnAvenue(
          createPanel([`j${index}  ${tokenName}`], {
            width: 5.2,
            height: 1.4,
            color: "#eefaff",
            borderColor: index === 2 ? GOLD : STEEL,
          }),
          { ...place, row: 0.95 },
        ),
      ),
    );
  });

  const query = add(
    root,
    createValueBoard([...SELECTED_TRACE.attention.query], 1, 4, {
      width: 8.6,
      cellHeight: 0.95,
      title: "q2 = CAT ASKS",
      subtitle: "[1, 1, 1, 1]",
      color: CYAN,
      accent: GOLD,
    }),
    avenueAnchor({ stop: 0, slot: "centre", offset: [0, -1.15, 0] }),
  );
  query.name = "assistant-target-qkv-query";

  const queryPackets = [0, 1, 2].map((index) => {
    const packet = createPacket(CYAN, 0.24);
    root.add(packet);
    const route = avenueRoute(
      query.position.clone().add(vector(0, -0.8, -1.2)),
      keys[index].position.clone().add(vector(0, 1.4, 1.0)),
      1.2,
    );
    const path = createPath(route, CYAN, 0.05, 0.24);
    root.add(path);
    return { packet, path, route };
  });

  const scoreLabels = ["4.20", "0.80", "-0.60"];
  // Each answer hangs in the lane facing the bay that produced it, so the
  // question and its result are read across the walkway rather than stacked.
  const coinSlot = ["right", "left", "right"] as const;
  const scoreCoins = scoreLabels.map((score, index) => {
    const coin = placeOnAvenue(
      createPanel([`q2 dot K${index}`, score], {
        width: 5.2,
        height: 2.0,
        color: index === 2 ? CORAL : "#ffffff",
        borderColor: index === 2 ? CORAL : CYAN,
        fontScale: 0.78,
      }),
      { stop: bayStop[index], slot: coinSlot[index] },
    );
    root.add(coin);
    return coin;
  });
  const coinHome = scoreCoins.map((coin) => coin.position.clone());
  const coinYaw = scoreCoins.map((coin) => coin.rotation.y);
  const scoreboard = avenueAnchor({ stop: 6, slot: "centre", zShift: 1.6 });

  const valueMessage = add(
    root,
    createPanel(["V0..V2 STAY PUT", "weights arrive after softmax"], {
      width: 11.0,
      height: 2.2,
      color: "#eefaff",
      borderColor: GREEN,
    }),
    avenueAnchor({ stop: 6, slot: "centre", offset: [0, -1.3, 0] }),
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

    queryPackets.forEach(({ packet, path, route }, index) => {
      const start = 0.16 + index * 0.105;
      const travel = smoothStep(p, start, start + 0.16);
      samplePath(packet, route, travel, 0.22);
      setObjectOpacity(packet, visibilityWindow(p, start, start + 0.035, start + 0.15, start + 0.2));
      setObjectOpacity(path, 0.08 + windowPulse(p, start, start + 0.08, start + 0.22) * 0.68);
      if (motionEnabled) pulseObject(packet, elapsed + index * 0.4, 5.2, 0.1);

      const coinReveal = smoothStep(p, start + 0.12, start + 0.18);
      const handoff = smoothStep(p, 0.58 + index * 0.025, 0.78 + index * 0.025);
      moveObject(
        scoreCoins[index],
        coinHome[index],
        scoreboard.clone().add(vector((index - 1) * 5.6, 0, 0)),
        handoff,
        0.45,
      );
      // The coins leave their lane for the scoreboard over the runway, so they
      // straighten as they converge.
      scoreCoins[index].rotation.y = coinYaw[index] * (1 - handoff);
      setObjectOpacity(scoreCoins[index], coinReveal);
    });
    setObjectOpacity(valueMessage, smoothStep(p, 0.64, 0.8));
  };
  return finaliseUpdater(updater);
}

/**
 * Attention Scores, laid out as a walkable avenue.
 *
 * A dot product has two simultaneous operands, so q2 and k0 face each other
 * across the first stop and climb into the DOT arch to meet. Everything after
 * that is a strict chain — pairwise products, sum, divide by root d — so each
 * link takes its own stop on the opposite side of the walk and the visitor
 * physically follows the arithmetic. The score matrix spans the exit, with the
 * row and cell beams showing where the single number just built gets filed.
 */
function buildAttentionScores(context: ChamberProcessContext): ChamberProcessUpdater {
  const root = processRoot(context);
  add(
    root,
    createPanel(["FOUR PRODUCTS", "SUM, SCALE, WRITE ONE CELL"], {
      width: 13.2,
      height: 1.9,
      color: "#eefaff",
      borderColor: VIOLET,
    }),
    avenueAnchor({ stop: 0, slot: "banner" }),
  );

  const qBoard = add(
    root,
    placeOnAvenue(
      createValueBoard([1, 1, 1, 1], 1, 4, {
        width: 5.2,
        cellHeight: 1.0,
        title: "q2",
        color: CYAN,
      }),
      { stop: 0, slot: "left" },
    ),
  );
  const kBoard = add(
    root,
    placeOnAvenue(
      createValueBoard([1, 1, 1, 1.2], 1, 4, {
        width: 5.2,
        cellHeight: 1.0,
        title: "k0",
        color: VIOLET,
      }),
      { stop: 0, slot: "right" },
    ),
  );
  const dot = add(root, createGlyph("DOT", GOLD, 2.0), avenueAnchor({ stop: 1, slot: "centre" }));
  const products = add(
    root,
    placeOnAvenue(
      createValueBoard([1, 1, 1, 1.2], 1, 4, {
        width: 5.6,
        cellHeight: 1.0,
        title: "PAIRWISE PRODUCTS",
        color: BLUE,
      }),
      { stop: 1, slot: "left" },
    ),
  );
  // Operator and operand share a stop: the sigma stands at the runway edge of
  // the bay it belongs to rather than out on the centre line, where it would
  // sit on the same sightline as the DOT arch behind it.
  const sigma = add(
    root,
    createGlyph("SUM", GOLD, 2.0),
    avenueAnchor({ stop: 2, slot: "right", xShift: -2.8, zShift: 1.5 }),
  );
  const raw = add(
    root,
    placeOnAvenue(
      createValueBoard([4.2], 1, 1, { width: 3.0, cellHeight: 1.25, title: "RAW", color: GOLD }),
      { stop: 2, slot: "right" },
    ),
  );
  const divide = add(
    root,
    createGlyph("/ 2", STEEL, 2.0),
    avenueAnchor({ stop: 3, slot: "left", xShift: -2.8, zShift: 1.5 }),
  );
  const scaled = add(
    root,
    placeOnAvenue(
      createValueBoard([2.1], 1, 1, {
        width: 3.2,
        cellHeight: 1.25,
        title: "S[2,0]",
        color: CYAN,
        accent: GOLD,
      }),
      { stop: 3, slot: "left" },
    ),
  );

  const unknownIndices = Array.from({ length: 36 }, (_, index) => index).filter(
    (index) => Math.floor(index / 6) !== 2,
  );
  const matrixAnchor = avenueAnchor({ stop: 4, slot: "centre" });
  const matrix = add(
    root,
    createValueBoard(makeScoreMatrix(false), 6, 6, {
      width: 10.6,
      cellHeight: 0.63,
      title: "SCORE MATRIX S [6 x 6]",
      subtitle: "row 2 exact; other rows symbolic",
      color: CYAN,
      accent: GOLD,
      highlightedIndices: [12, 13, 14, 15, 16, 17],
      unknownIndices,
      fontScale: 0.82,
    }),
    matrixAnchor,
  );
  matrix.name = "assistant-target-attention-score-matrix";
  const beamMaterial = createProcessMaterial(GOLD, 1.3, 0.74);
  const rowBeam = add(
    root,
    new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.1, 0.08), beamMaterial),
    matrixAnchor.clone().add(vector(0, 0.37, 0.24)),
  );
  rowBeam.name = "assistant-target-attention-score-row-2";
  const columnBeam = add(
    root,
    new THREE.Mesh(new THREE.BoxGeometry(0.1, 4.2, 0.08), createProcessMaterial(CYAN, 1.3, 0.72)),
    matrixAnchor.clone().add(vector(-4.42, 0.55, 0.26)),
  );
  columnBeam.name = "assistant-target-attention-score-cell-q2-k0";

  const qHome = qBoard.position.clone();
  const kHome = kBoard.position.clone();
  const meetCentre = avenueAnchor({ stop: 1, slot: "centre", zShift: 2.6 });
  const qMeet = meetCentre.clone().add(vector(-3.6, 0, 0));
  const kMeet = meetCentre.clone().add(vector(3.6, 0, 0));
  const scaledHome = scaled.position.clone();
  const scaledYaw = scaled.rotation.y;
  const cellTarget = matrixAnchor.clone().add(vector(-4.42, 0.37, 0.9));

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const meet = smoothStep(p, 0.08, 0.23);
    moveObject(qBoard, qHome, qMeet, meet, 0.2);
    moveObject(kBoard, kHome, kMeet, meet, 0.2);
    // Both operands start angled into their lane and straighten as they rise,
    // so the dot product is read face-on from the runway.
    qBoard.rotation.y = AVENUE.laneYaw * (1 - meet);
    kBoard.rotation.y = -AVENUE.laneYaw * (1 - meet);
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
    moveObject(scaled, scaledHome, cellTarget, write, 0.55);
    scaled.rotation.y = scaledYaw * (1 - write);
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

/**
 * Causal Mask, laid out as a walkable avenue.
 *
 * The two matrices being added are the same shape and arrive at the same time,
 * so they face each other across the first stop and climb into the `+` arch to
 * overlay. The shutters that turn the future half of the grid to −∞ hang over
 * the runway and drop onto the result wall in the right lane, so the visitor
 * watches the mask land instead of standing behind it. The surviving row two
 * closes the walk over the exit.
 */
function buildCausalMask(context: ChamberProcessContext): ChamberProcessUpdater {
  const root = processRoot(context);
  add(
    root,
    createPanel(["ELEMENTWISE MATRIX ADDITION", "raw scores + causal mask = masked scores"], {
      width: 14.5,
      height: 2.0,
      color: "#eefaff",
      borderColor: PINK,
    }),
    avenueAnchor({ stop: 0, slot: "banner" }),
  );

  const raw = add(
    root,
    placeOnAvenue(
      createValueBoard(makeScoreMatrix(false), 6, 6, {
        width: 9.0,
        cellHeight: 0.58,
        title: "RAW S",
        color: CYAN,
        highlightedIndices: [12, 13, 14, 15, 16, 17],
        unknownIndices: Array.from({ length: 36 }, (_, i) => i).filter((i) => Math.floor(i / 6) !== 2),
        fontScale: 0.76,
      }),
      // Six-column matrices are wide enough that the inner lane would clip the
      // walkway, so both operand walls stand one board-width further out.
      { stop: 0, slot: "left", offset: [0, 0.9, 0], xShift: 2.6 },
    ),
  );
  const upperIndices = Array.from({ length: 36 }, (_, index) => index).filter(
    (index) => index % 6 > Math.floor(index / 6),
  );
  const mask = add(
    root,
    placeOnAvenue(
      createValueBoard(makeMaskMatrix(), 6, 6, {
        width: 9.0,
        cellHeight: 0.58,
        title: "MASK M",
        color: STEEL,
        accent: PINK,
        maskedIndices: upperIndices,
        fontScale: 0.76,
      }),
      { stop: 0, slot: "right", offset: [0, 0.9, 0], xShift: 2.6 },
    ),
  );
  mask.name = "assistant-target-causal-mask-matrix";
  const plus = add(root, createGlyph("+", GOLD, 2.0), avenueAnchor({ stop: 1, slot: "centre" }));
  const equals = add(
    root,
    createGlyph("=", GOLD, 2.0),
    avenueAnchor({ stop: 2, slot: "left", xShift: -2.6 }),
  );

  const result = add(
    root,
    placeOnAvenue(
      createValueBoard(makeScoreMatrix(true), 6, 6, {
        width: 9.8,
        cellHeight: 0.6,
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
      { stop: 3, slot: "right", offset: [0, 1.1, 0], xShift: 1.2 },
    ),
  );
  result.name = "assistant-target-causal-mask-allowed";
  const selectedRow = add(
    root,
    createValueBoard([2.1, 0.4, -0.3, "-INF", "-INF", "-INF"], 1, 6, {
      width: 8.6,
      cellHeight: 0.9,
      title: "ROW 2 AFTER ADD",
      color: CYAN,
      accent: PINK,
      highlightedIndices: [0, 1, 2],
      maskedIndices: [3, 4, 5],
    }),
    avenueAnchor({ stop: 4, slot: "centre" }),
  );

  const shutters = new THREE.Group();
  shutters.name = "assistant-target-causal-mask-future";
  const shutterMaterial = createProcessMaterial(PINK, 1.2, 0.88);
  upperIndices.forEach((index) => {
    const row = Math.floor(index / 6);
    const column = index % 6;
    const shutter = new THREE.Mesh(new THREE.BoxGeometry(1.19, 0.42, 0.3), shutterMaterial);
    shutter.position.set((column - 2.5) * 1.63, 1.56 - row * 0.6, 0);
    shutters.add(shutter);
  });
  // The shutters ride in the same lane as the wall they will cover, so they
  // never hang over the walkway on their way down.
  const shutterSeat = result.position.clone().add(vector(0, 0, 0.42));
  const shutterHome = shutterSeat.clone().add(vector(0, 5.4, 0));
  shutters.position.copy(shutterHome);
  shutters.rotation.y = result.rotation.y;
  root.add(shutters);

  const rawHome = raw.position.clone();
  const maskHome = mask.position.clone();
  const overlay = avenueAnchor({ stop: 1, slot: "centre", zShift: -2.4, offset: [0, -0.4, 0] });

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    // Hold the operands apart through the midpoint so the visitor can read the
    // complete matrix equation before the physical overlay begins.
    const approach = smoothStep(p, 0.52, 0.68);
    moveObject(raw, rawHome, overlay, approach, 0.28);
    moveObject(mask, maskHome, overlay.clone().add(vector(0, 0, 0.3)), approach, 0.28);
    raw.rotation.y = AVENUE.laneYaw * (1 - approach);
    mask.rotation.y = -AVENUE.laneYaw * (1 - approach);
    setObjectOpacity(plus, visibilityWindow(p, 0.05, 0.15, 0.58, 0.7));
    const slam = smoothStep(p, 0.64, 0.76);
    shutters.position.lerpVectors(shutterHome, shutterSeat, slam);
    if (motionEnabled && slam > 0.05 && slam < 1) {
      shutters.position.y += Math.sin(elapsed * 16) * 0.05 * slam;
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

/**
 * Softmax & Weighted Values, laid out as a walkable avenue.
 *
 * The masked row is read at the first stop, then the visitor walks under the
 * bank of exponential hoppers — suspended over the runway, so the normalisation
 * happens overhead rather than across the path. The weights and the value
 * matrix face each other at the multiply stop, the three surviving
 * contributions stack as a triptych, and the head output closes the walk.
 */
function buildSoftmaxWeightedValues(context: ChamberProcessContext): ChamberProcessUpdater {
  const root = processRoot(context);
  add(
    root,
    createPanel(["NORMALIZE SIX SCORES", "WEIGHT THREE VECTORS, THEN SUM"], {
      width: 13.5,
      height: 1.9,
      color: "#eefaff",
      borderColor: GREEN,
    }),
    avenueAnchor({ stop: 0, slot: "banner" }),
  );

  const scoreBoard = add(
    root,
    createValueBoard([2.1, 0.4, -0.3, "-INF", "-INF", "-INF"], 1, 6, {
      width: 7.6,
      cellHeight: 0.72,
      title: "MASKED SCORE ROW",
      subtitle: "three positions are already gone",
      color: CYAN,
      maskedIndices: [3, 4, 5],
    }),
    // Pushed a little further out than the standard lane: it is the widest
    // board in the hall and would otherwise clip the walkway.
    avenueAnchor({ stop: 0, slot: "left", xShift: 1.2 }),
  );
  scoreBoard.rotation.y = AVENUE.laneYaw;

  // The hoppers hang over the runway: the visitor walks beneath six funnels and
  // watches the three masked ones stay dark.
  const hoppers = new THREE.Group();
  hoppers.name = "six-softmax-exponential-hoppers";
  const hopperZ = avenueZ(1);
  const hopperMaterials: THREE.MeshStandardMaterial[] = [];
  for (let index = 0; index < 6; index += 1) {
    const color = index > 2 ? PINK : index === 0 ? GOLD : CYAN;
    const material = createProcessMaterial(color, 0.7, 0.76);
    hopperMaterials.push(material);
    const hopper = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.6, 16, 1, true), material);
    hopper.rotation.x = Math.PI;
    hopper.position.set((index - 2.5) * 1.15, AVENUE.archY + 0.9, hopperZ);
    hoppers.add(hopper);
    const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.8, 12), material);
    throat.position.set((index - 2.5) * 1.15, AVENUE.archY - 0.2, hopperZ);
    hoppers.add(throat);
  }
  root.add(hoppers);
  add(
    root,
    createPanel(["exp", "masked -> 0"], {
      width: 4.6,
      height: 1.7,
      color: "#eefaff",
      borderColor: PINK,
    }),
    avenueAnchor({ stop: 1, slot: "right" }),
  ).rotation.y = -AVENUE.laneYaw;

  const weightsBoard = add(
    root,
    createValueBoard(WEIGHTS, 1, 6, {
      width: 8.4,
      cellHeight: 0.78,
      title: "SOFTMAX A",
      subtitle: "sum = 1.0000",
      color: GREEN,
      accent: GOLD,
      highlightedIndices: [0],
    }),
    avenueAnchor({ stop: 2, slot: "centre" }),
  );
  weightsBoard.name = "assistant-target-softmax-row";

  const aBoard = add(
    root,
    createValueBoard(WEIGHTS, 1, 6, {
      width: 5.6,
      cellHeight: 0.66,
      title: "A [1 x 6]",
      subtitle: "one weight per position",
      color: GREEN,
      highlightedIndices: [0],
    }),
    avenueAnchor({ stop: 3, slot: "left" }),
  );
  aBoard.rotation.y = AVENUE.laneYaw;
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
      width: 5.8,
      cellHeight: 0.56,
      title: "V [6 x 4]",
      subtitle: "one value vector per position",
      color: GREEN,
      unknownIndices: Array.from({ length: 12 }, (_, i) => i + 12),
      fontScale: 0.78,
    }),
    avenueAnchor({ stop: 3, slot: "right" }),
  );
  vBoard.rotation.y = -AVENUE.laneYaw;
  vBoard.name = "assistant-target-weighted-value-streams";
  const aHome = aBoard.position.clone();
  const vHome = vBoard.position.clone();
  const multiply = add(
    root,
    createGlyph("x", GOLD, 1.6),
    // Kept high in the arch tier so it stays clear of the head-output board
    // that closes the avenue two stops further on.
    avenueAnchor({ stop: 3, slot: "centre", offset: [0, 0.6, 0] }),
  );

  // Only three positions survive the mask, so their contributions stack as a
  // triptych in one lane instead of spreading across the walkway.
  const contributionRow = [1, 0, -1] as const;
  const contributions = [
    [0.471178973, -0.157059658, 0.078529829, 0.392649144],
    [-0.014346106, 0.057384424, 0.114768847, -0.043038318],
    [0.021372196, 0.014248131, -0.028496261, 0.049868457],
  ].map((valuesForRow, index) => {
    const board = createValueBoard(valuesForRow, 1, 4, {
      width: 5.0,
      cellHeight: 0.7,
      title: `${WEIGHTS[index].toFixed(4)} x V${index}`,
      color: index === 0 ? GOLD : GREEN,
      fontScale: 0.72,
    });
    placeOnAvenue(board, { stop: 4, slot: "left", row: contributionRow[index] });
    root.add(board);
    return board;
  });
  const contributionHome = contributions.map((board) => board.position.clone());
  const contributionYaw = contributions.map((board) => board.rotation.y);
  const plusTop = add(
    root,
    createGlyph("+", GOLD, 1.15),
    avenueAnchor({ stop: 4, slot: "left", row: 0.5, xShift: -3.8 }),
  );
  const plusBottom = add(
    root,
    createGlyph("+", GOLD, 1.15),
    avenueAnchor({ stop: 4, slot: "left", row: -0.5, xShift: -3.8 }),
  );

  const output = add(
    root,
    createValueBoard(HEAD_ZERO, 1, 4, {
      width: 6.8,
      cellHeight: 0.92,
      title: "HEAD OUTPUT z",
      subtitle: "componentwise contribution sum",
      color: CYAN,
      accent: GOLD,
    }),
    avenueAnchor({ stop: 5, slot: "centre" }),
  );
  output.name = "assistant-target-weighted-value-output";

  const scoreHome = scoreBoard.position.clone();
  const scoreDrift = scoreHome.clone().add(vector(1.6, 1.6, -2.4));
  const mergeTarget = avenueAnchor({ stop: 4, slot: "centre", zShift: -2.6 });

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const normalize = smoothStep(p, 0.08, 0.31);
    moveObject(scoreBoard, scoreHome, scoreDrift, normalize, 0.18);
    setObjectOpacity(scoreBoard, 1 - smoothStep(p, 0.24, 0.4) * 0.72);
    hopperMaterials.forEach((material, index) => {
      const live = index < 3 ? 1 : 0.22;
      material.emissiveIntensity = 0.3 + normalize * live * (motionEnabled ? 0.65 + Math.sin(elapsed * 4 + index) * 0.12 : 0.7);
    });
    setObjectOpacity(weightsBoard, smoothStep(p, 0.22, 0.38));
    const matrixMeet = smoothStep(p, 0.36, 0.52);
    moveObject(aBoard, aHome, aHome.clone().add(vector(3.4, 0, -1.1)), matrixMeet, 0.18);
    moveObject(vBoard, vHome, vHome.clone().add(vector(-3.4, 0, -1.1)), matrixMeet, 0.18);
    aBoard.rotation.y = AVENUE.laneYaw * (1 - matrixMeet);
    vBoard.rotation.y = -AVENUE.laneYaw * (1 - matrixMeet);
    setObjectOpacity(aBoard, smoothStep(p, 0.3, 0.4) * (1 - smoothStep(p, 0.61, 0.71)));
    setObjectOpacity(vBoard, smoothStep(p, 0.3, 0.4) * (1 - smoothStep(p, 0.61, 0.71)));
    setObjectOpacity(multiply, visibilityWindow(p, 0.37, 0.46, 0.6, 0.69));

    const contributionReveal = smoothStep(p, 0.5, 0.66);
    const merge = smoothStep(p, 0.66, 0.82);
    contributions.forEach((board, index) => {
      moveObject(
        board,
        contributionHome[index],
        mergeTarget.clone().add(vector(0, (1 - index) * 1.35 - 1.0, 0)),
        merge,
        0.36,
      );
      board.rotation.y = contributionYaw[index] * (1 - merge);
      setObjectOpacity(board, contributionReveal * (1 - smoothStep(p, 0.78, 0.88)));
    });
    setObjectOpacity(plusTop, visibilityWindow(p, 0.57, 0.65, 0.8, 0.88));
    setObjectOpacity(plusBottom, visibilityWindow(p, 0.57, 0.65, 0.8, 0.88));
    setObjectOpacity(output, smoothStep(p, 0.75, 0.88));
    if (motionEnabled && p > 0.82) pulseObject(output, elapsed, 2.2, 0.025);
  };
  return finaliseUpdater(updater);
}

/**
 * Head Recombination, laid out as a walkable avenue.
 *
 * The two heads finish at the same instant, so they face each other across the
 * first stop and click together in the clamp arch overhead — concatenation, not
 * addition, is easiest to believe when the visitor sees two trays slide into
 * one rail. The projection wall then fills one lane while the untouched residual
 * runs the whole length of the hall on the outer road, and the two arrive at the
 * `+` over the exit from opposite sides.
 */
function buildHeadRecombination(context: ChamberProcessContext): ChamberProcessUpdater {
  const root = processRoot(context);
  add(
    root,
    createPanel(["HEADS CLICK SIDE-BY-SIDE", "W_O MIXES, RESIDUAL ADDS"], {
      width: 13.2,
      height: 2.0,
      color: "#eefaff",
      borderColor: GOLD,
    }),
    avenueAnchor({ stop: 0, slot: "banner" }),
  );

  const head0 = add(
    root,
    placeOnAvenue(
      createValueBoard(HEAD_ZERO, 1, 4, {
        width: 5.4,
        cellHeight: 0.78,
        title: "HEAD 0 [4]",
        color: CYAN,
      }),
      { stop: 0, slot: "left" },
    ),
  );
  head0.name = "assistant-target-recombine-head-zero-output";
  const head1 = add(
    root,
    placeOnAvenue(
      createValueBoard(["z10", "z11", "z12", "z13"], 1, 4, {
        width: 5.4,
        cellHeight: 0.78,
        title: "HEAD 1 [4]",
        color: GREEN,
        unknownIndices: [0, 1, 2, 3],
      }),
      { stop: 0, slot: "right" },
    ),
  );
  head1.name = "assistant-target-recombine-head-one-output";
  const concatAnchor = avenueAnchor({ stop: 1, slot: "centre" });
  const concat = add(
    root,
    createValueBoard([...HEAD_ZERO, "z10", "z11", "z12", "z13"], 1, 8, {
      width: 9.8,
      cellHeight: 0.8,
      title: "CONCAT [8] -- NOT ADDITION",
      color: CYAN,
      accent: GOLD,
      unknownIndices: [4, 5, 6, 7],
    }),
    concatAnchor,
  );
  concat.name = "assistant-target-recombine-concatenation";
  const clamp = new THREE.Group();
  const clampMaterial = createProcessMaterial(GOLD, 1.05, 0.86);
  for (const x of [-5.3, 5.3]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 0.26), clampMaterial);
    rail.position.x = x;
    clamp.add(rail);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(10.7, 0.2, 0.26), clampMaterial);
  bridge.position.y = 1.3;
  clamp.add(bridge);
  clamp.position.copy(concatAnchor.clone().add(vector(0, -0.1, 0.35)));
  root.add(clamp);

  const woValues = Array.from({ length: 64 }, (_, index) => `w${Math.floor(index / 8)}${index % 8}`);
  const wo = add(
    root,
    placeOnAvenue(
      createValueBoard(woValues, 8, 8, {
        width: 8.4,
        cellHeight: 0.44,
        title: "LEARNED W_O [8 x 8]",
        color: GOLD,
        unknownIndices: Array.from({ length: 64 }, (_, i) => i),
        fontScale: 0.7,
      }),
      // Set out slightly wider than the lane: at 8.4 units it is the broadest
      // board in the hall and would otherwise overhang the walkway.
      { stop: 2, slot: "right", xShift: 0.9, offset: [0, 0.8, 0] },
    ),
  );
  wo.name = "assistant-target-recombine-output-projection";
  // The scan rides in a rig that carries the wall's yaw, so it sweeps across
  // the face of the matrix instead of skewing off it.
  const scanRig = new THREE.Group();
  scanRig.position.copy(wo.position);
  scanRig.rotation.y = wo.rotation.y;
  const scanMaterial = createProcessMaterial(CYAN, 1.25, 0.75);
  const scan = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.0, 0.08), scanMaterial);
  scan.position.set(-3.9, 0, 0.4);
  scan.name = "assistant-target-recombine-output-projection";
  scanRig.add(scan);
  root.add(scanRig);

  const outputO = add(
    root,
    placeOnAvenue(
      createValueBoard(Array.from({ length: 8 }, (_, i) => `o${i}`), 1, 8, {
        width: 8.4,
        cellHeight: 0.7,
        title: "O = CONCAT x W_O",
        color: CYAN,
        unknownIndices: Array.from({ length: 8 }, (_, i) => i),
      }),
      { stop: 3, slot: "left" },
    ),
  );
  outputO.name = "assistant-target-recombine-projected-output";
  // The bypass takes the outer road: it belongs to no stop on the avenue, it
  // simply runs the length of the hall untouched and rejoins at the end.
  const residual = add(
    root,
    placeOnAvenue(
      createValueBoard(Array.from({ length: 8 }, (_, i) => `h${i}`), 1, 8, {
        width: 7.0,
        cellHeight: 0.68,
        title: "UNTOUCHED H",
        color: GREEN,
        unknownIndices: Array.from({ length: 8 }, (_, i) => i),
      }),
      { stop: 2, slot: "outer-left" },
    ),
  );
  residual.name = "assistant-target-recombine-residual-bypass";

  const mergeAnchor = avenueAnchor({ stop: 4, slot: "centre", zShift: 3.4 });
  const residualHome = residual.position.clone();
  const residualYaw = residual.rotation.y;
  const outputHome = outputO.position.clone();
  const outputYaw = outputO.rotation.y;
  const residualMerge = mergeAnchor.clone().add(vector(-3.4, 0.9, 0));
  const outputMerge = mergeAnchor.clone().add(vector(3.4, 0.9, 0));
  root.add(createPath(avenueRoute(residualHome, residualMerge, 1.4), GREEN, 0.095, 0.55));

  const plus = add(
    root,
    createGlyph("+", GOLD, 1.9),
    mergeAnchor.clone().add(vector(0, 0.9, 0)),
  );
  plus.name = "assistant-target-recombine-block-output";
  const result = add(
    root,
    createValueBoard(Array.from({ length: 8 }, (_, i) => `u${i}`), 1, 8, {
      width: 8.6,
      cellHeight: 0.85,
      title: "U = H + O",
      color: CYAN,
      accent: GOLD,
      unknownIndices: Array.from({ length: 8 }, (_, i) => i),
    }),
    avenueAnchor({ stop: 4, slot: "centre" }),
  );
  result.name = "assistant-target-recombine-block-output";

  const head0Home = head0.position.clone();
  const head1Home = head1.position.clone();
  const head0Dock = concatAnchor.clone().add(vector(-2.7, 0, 2.6));
  const head1Dock = concatAnchor.clone().add(vector(2.7, 0, 2.6));

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const dock = smoothStep(p, 0.08, 0.26);
    moveObject(head0, head0Home, head0Dock, dock, 0.16);
    moveObject(head1, head1Home, head1Dock, dock, 0.16);
    // The two trays straighten as they climb into the clamp, so the join is
    // read square-on from the runway underneath.
    head0.rotation.y = AVENUE.laneYaw * (1 - dock);
    head1.rotation.y = -AVENUE.laneYaw * (1 - dock);
    setObjectOpacity(head0, 1 - smoothStep(p, 0.25, 0.38));
    setObjectOpacity(head1, 1 - smoothStep(p, 0.25, 0.38));
    setObjectOpacity(clamp, visibilityWindow(p, 0.14, 0.23, 0.35, 0.45));
    clamp.scale.x = THREE.MathUtils.lerp(1.38, 1, dock);
    setObjectOpacity(concat, visibilityWindow(p, 0.22, 0.36, 0.52, 0.64));
    setObjectOpacity(wo, 0.18 + smoothStep(p, 0.28, 0.42) * 0.82);
    const projection = smoothStep(p, 0.36, 0.59);
    scan.position.x = THREE.MathUtils.lerp(-3.9, 3.9, projection);
    setObjectOpacity(scan, visibilityWindow(p, 0.34, 0.4, 0.58, 0.66));
    setObjectOpacity(outputO, smoothStep(p, 0.51, 0.65) * (1 - smoothStep(p, 0.79, 0.9)));
    const merge = smoothStep(p, 0.65, 0.83);
    moveObject(residual, residualHome, residualMerge, merge, 0.38);
    moveObject(outputO, outputHome, outputMerge, merge, 0.38);
    residual.rotation.y = residualYaw * (1 - merge);
    outputO.rotation.y = outputYaw * (1 - merge);
    setObjectOpacity(plus, visibilityWindow(p, 0.66, 0.73, 0.84, 0.92));
    setObjectOpacity(result, smoothStep(p, 0.8, 0.92));
    if (motionEnabled && p > 0.88) pulseObject(result, elapsed, 2.2, 0.025);
  };
  return finaliseUpdater(updater);
}

/**
 * MLP, laid out as a walkable avenue.
 *
 * The two projection walls really are walls the data passes through, so they
 * become lintels spanning the avenue and the visitor walks under each in turn;
 * the GELU bank hangs between them, activations firing overhead. The learned
 * weights are captioned in the near lane and their biases on the outer road, so
 * every stage names itself from the side rather than blocking the way. One
 * token's vector is followed the whole length, and the residual bypass runs
 * outside all of it to rejoin under the `+` at the exit.
 */
function buildMlp(context: ChamberProcessContext): ChamberProcessUpdater {
  const root = processRoot(context);
  add(
    root,
    createPanel(["ONE TOKEN WIDENS", "8 -> 32 -> 8, THEN RESIDUAL"], {
      width: 13.6,
      height: 2.0,
      color: "#eefaff",
      borderColor: CORAL,
    }),
    avenueAnchor({ stop: 0, slot: "banner", zShift: 0 }),
  );

  const tokenNames = SELECTED_TRACE.batch.inputTokenIds
    .flat()
    .map((id) => SELECTED_TRACE.vocabulary[id]);
  const queue = add(
    root,
    createValueBoard(tokenNames, 2, 6, {
      width: 9.0,
      cellHeight: 0.62,
      title: "12 INDEPENDENT TOKEN LANES",
      color: CYAN,
      accent: GOLD,
      highlightedIndices: [2],
      fontScale: 0.76,
    }),
    avenueAnchor({ stop: 0, slot: "centre", offset: [0, -1.15, 0] }),
  );
  queue.name = "assistant-target-mlp-token-lanes";
  const input = add(
    root,
    placeOnAvenue(
      createValueBoard(Array.from({ length: 8 }, (_, i) => `u${i}`), 1, 8, {
        width: 7.8,
        cellHeight: 0.72,
        title: "SELECTED U [8]",
        color: CYAN,
        unknownIndices: Array.from({ length: 8 }, (_, i) => i),
      }),
      { stop: 0, slot: "left", xShift: 1.0 },
    ),
  );
  input.name = "assistant-target-mlp-selected-input";
  const ln2Gate = add(
    root,
    placeOnAvenue(
      createPanel(["LN2", "normalize 8 features"], {
        width: 6.4,
        height: 2.0,
        color: VIOLET,
        borderColor: VIOLET,
        fontScale: 0.72,
      }),
      { stop: 1, slot: "right", row: 1, xShift: 0.5 },
    ),
  );
  ln2Gate.name = "assistant-target-mlp-layer-norm-gate";
  const normalizedInput = add(
    root,
    placeOnAvenue(
      createValueBoard(Array.from({ length: 8 }, (_, i) => `n${i}`), 1, 8, {
        width: 7.5,
        cellHeight: 0.7,
        title: "LN2(U) [8]",
        subtitle: "normalized before W_up",
        color: VIOLET,
        unknownIndices: Array.from({ length: 8 }, (_, i) => i),
      }),
      { stop: 1, slot: "right", xShift: 0.5 },
    ),
  );
  normalizedInput.name = "assistant-target-mlp-normalized-input";

  // Each projection wall spans the avenue as a lintel in the arch tier: the
  // visitor walks through the learned parameters instead of around a slab
  // parked across the walkway.
  const upZ = avenueZ(2);
  const upWall = add(
    root,
    new THREE.Mesh(new THREE.BoxGeometry(16.4, 2.2, 0.7), createProcessMaterial(GOLD, 0.55, 0.68)),
    vector(0, AVENUE.archY, upZ),
  );
  upWall.name = "assistant-target-mlp-up-projection";
  add(
    root,
    placeOnAvenue(
      createPanel(["W_up [8 x 32]", "shared learned wall"], {
        width: 7.0,
        height: 2.0,
        color: "#eefaff",
        borderColor: GOLD,
      }),
      { stop: 2, slot: "left" },
    ),
  );
  const fanStart = normalizedInput.position.clone().add(vector(0, 1.9, 0));
  const fanPaths: THREE.Object3D[] = [];
  for (let index = 0; index < 8; index += 1) {
    const toX = (index - 3.5) * 2.0;
    const path = createPath(
      [
        fanStart,
        fanStart.clone().lerp(vector(toX, AVENUE.archY - 0.9, upZ), 0.5).setY(AVENUE.archY - 1.6),
        vector(toX, AVENUE.archY - 0.9, upZ),
      ],
      VIOLET,
      0.05,
      0.3,
    );
    root.add(path);
    fanPaths.push(path);
  }
  const upBias = add(
    root,
    placeOnAvenue(
      createPanel(["+ b_up [32]", "bias before GELU"], {
        width: 6.4,
        height: 1.8,
        color: "#eefaff",
        borderColor: GOLD,
        fontScale: 0.72,
      }),
      { stop: 2, slot: "outer-left" },
    ),
  );
  upBias.name = "assistant-target-mlp-up-projection";

  const geluY = AVENUE.archY + 0.6;
  const geluZ = avenueZ(3);
  const geluUnits = new THREE.Group();
  geluUnits.name = "assistant-target-mlp-gelu-activation";
  const unitMaterial = createProcessMaterial(CORAL, 1.0, 0.86);
  const units: THREE.Mesh[] = [];
  for (let index = 0; index < 32; index += 1) {
    const row = Math.floor(index / 8);
    const column = index % 8;
    const unit = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), unitMaterial);
    unit.position.set(
      (column - 3.5) * 2.0,
      geluY + (row - 1.5) * 1.05,
      geluZ + Math.sin(index * 0.8) * 0.24,
    );
    geluUnits.add(unit);
    units.push(unit);
  }
  root.add(geluUnits);
  add(
    root,
    placeOnAvenue(
      createPanel(["GELU [32]", "schematic activations"], {
        width: 6.8,
        height: 2.0,
        color: "#eefaff",
        borderColor: CORAL,
      }),
      { stop: 3, slot: "right" },
    ),
  );

  const downZ = avenueZ(4);
  const downWall = add(
    root,
    new THREE.Mesh(new THREE.BoxGeometry(16.4, 2.2, 0.7), createProcessMaterial(GOLD, 0.55, 0.68)),
    vector(0, AVENUE.archY, downZ),
  );
  downWall.name = "assistant-target-mlp-down-projection";
  add(
    root,
    placeOnAvenue(
      createPanel(["W_down [32 x 8]", "funnel back to width 8"], {
        width: 7.4,
        height: 2.0,
        color: "#eefaff",
        borderColor: GOLD,
      }),
      { stop: 4, slot: "left" },
    ),
  );
  const downBias = add(
    root,
    placeOnAvenue(
      createPanel(["+ b_down [8]", "bias before residual add"], {
        width: 6.6,
        height: 1.8,
        color: "#eefaff",
        borderColor: GOLD,
        fontScale: 0.7,
      }),
      { stop: 4, slot: "outer-left" },
    ),
  );
  downBias.name = "assistant-target-mlp-down-projection";
  const fBoard = add(
    root,
    placeOnAvenue(
      createValueBoard(Array.from({ length: 8 }, (_, i) => `f${i}`), 1, 8, {
        width: 7.6,
        cellHeight: 0.7,
        title: "MLP OUTPUT F [8]",
        color: CORAL,
        unknownIndices: Array.from({ length: 8 }, (_, i) => i),
      }),
      { stop: 5, slot: "right" },
    ),
  );
  fBoard.name = "assistant-target-mlp-output";
  const contractionPaths: THREE.Object3D[] = [];
  const fanEnd = fBoard.position.clone().add(vector(0, 1.9, 0));
  for (let index = 0; index < 8; index += 1) {
    const fromX = (index - 3.5) * 2.0;
    const path = createPath(
      [
        vector(fromX, AVENUE.archY - 0.9, downZ),
        vector(fromX, AVENUE.archY - 1.4, downZ).lerp(fanEnd, 0.5).setY(AVENUE.archY - 1.6),
        fanEnd,
      ],
      CORAL,
      0.05,
      0.3,
    );
    root.add(path);
    contractionPaths.push(path);
  }
  // The bypass never enters the works: it takes the outer road past both walls
  // and the activation bank, and only rejoins at the closing add.
  const residual = add(
    root,
    placeOnAvenue(
      createValueBoard(Array.from({ length: 8 }, (_, i) => `u${i}`), 1, 8, {
        width: 7.0,
        cellHeight: 0.68,
        title: "BYPASS U",
        color: GREEN,
        unknownIndices: Array.from({ length: 8 }, (_, i) => i),
      }),
      { stop: 2, slot: "outer-right" },
    ),
  );
  residual.name = "assistant-target-mlp-residual-bypass";

  const mergeAnchor = avenueAnchor({ stop: 5, slot: "centre", zShift: 3.4 });
  const residualHome = residual.position.clone();
  const residualYaw = residual.rotation.y;
  const fHome = fBoard.position.clone();
  const fYaw = fBoard.rotation.y;
  const residualMerge = mergeAnchor.clone().add(vector(-3.4, 0.9, 0));
  const fMerge = mergeAnchor.clone().add(vector(3.4, 0.9, 0));
  root.add(createPath(avenueRoute(residualHome, residualMerge, 1.4), GREEN, 0.09, 0.5));

  const plus = add(
    root,
    createGlyph("+", GOLD, 1.9),
    mergeAnchor.clone().add(vector(0, 0.9, 0)),
  );
  plus.name = "assistant-target-mlp-block-output";
  const result = add(
    root,
    createValueBoard(Array.from({ length: 8 }, (_, i) => `h'${i}`), 1, 8, {
      width: 8.6,
      cellHeight: 0.82,
      title: "H' = U + F",
      color: CYAN,
      accent: GOLD,
      unknownIndices: Array.from({ length: 8 }, (_, i) => i),
    }),
    avenueAnchor({ stop: 5, slot: "centre" }),
  );
  result.name = "assistant-target-mlp-block-output";

  const inputHome = input.position.clone();
  const inputDock = inputHome.clone().add(vector(1.2, 0, -2.2));

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    setObjectOpacity(queue, 1 - smoothStep(p, 0.08, 0.24) * 0.7);
    const enterNorm = smoothStep(p, 0.05, 0.18);
    moveObject(input, inputHome, inputDock, enterNorm, 0.1);
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
    moveObject(residual, residualHome, residualMerge, merge, 0.35);
    moveObject(fBoard, fHome, fMerge, merge, 0.35);
    residual.rotation.y = residualYaw * (1 - merge);
    fBoard.rotation.y = fYaw * (1 - merge);
    setObjectOpacity(plus, visibilityWindow(p, 0.82, 0.88, 0.94, 0.98));
    setObjectOpacity(result, smoothStep(p, 0.91, 0.99));
    if (motionEnabled && p > 0.95) pulseObject(result, elapsed, 2.1, 0.022);
  };
  return finaliseUpdater(updater);
}

/**
 * Final Layer Norm, laid out as a walkable avenue.
 *
 * The twelve contextual pods enter overhead and fly the length of the avenue
 * through the normalisation ring, so the visitor walks beneath the operation
 * rather than around it. Below, one selected vector is followed step by step —
 * raw, centred, rescaled — each step in the opposite lane, and the whole
 * normalised tray closes the walk above the exit.
 */
function buildFinalHidden(context: ChamberProcessContext): ChamberProcessUpdater {
  const root = processRoot(context);
  add(
    root,
    createPanel(["FINAL LAYER NORM", "same 12 x 8 shape; context stays inside"], {
      width: 14.0,
      height: 2.0,
      color: "#eefaff",
      borderColor: VIOLET,
    }),
    // Hung level with the pod tray rather than behind it, so the two share the
    // frame instead of one covering the other.
    avenueAnchor({ stop: 0, slot: "banner", zShift: 0 }),
  );

  const tokenNames = SELECTED_TRACE.batch.inputTokenIds
    .flat()
    .map((id) => SELECTED_TRACE.vocabulary[id]);
  const tokenBoard = add(
    root,
    createValueBoard(tokenNames, 2, 6, {
      width: 9.0,
      cellHeight: 0.6,
      title: "H2: 12 CONTEXTUAL PODS",
      color: CYAN,
      accent: GOLD,
      highlightedIndices: [2],
      fontScale: 0.76,
    }),
    avenueAnchor({ stop: 0, slot: "centre", offset: [0, -1.15, 0] }),
  );
  tokenBoard.name = "assistant-target-final-hidden-input-tensor";

  // The pods fly the avenue in the arch tier: the visitor walks under the whole
  // batch instead of having a rack of capsules laid across the walkway.
  const podY = AVENUE.archY + 1.0;
  const podEnter = avenueZ(1);
  const podExit = avenueZ(3);
  const pods = new THREE.Group();
  pods.name = "assistant-target-final-hidden-input-tensor";
  const podMaterial = createProcessMaterial(CYAN, 0.6, 0.74);
  for (let index = 0; index < 12; index += 1) {
    const row = Math.floor(index / 6);
    const column = index % 6;
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.72, 4, 10), podMaterial);
    pod.rotation.z = Math.PI / 2;
    pod.position.set((column - 2.5) * 2.35, (row - 0.5) * 1.45, 0);
    pods.add(pod);
  }
  pods.position.set(0, podY, podEnter);
  root.add(pods);

  const ringZ = avenueZ(2);
  const normRing = add(
    root,
    new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.18, 12, 64), createProcessMaterial(VIOLET, 1.1, 0.82)),
    vector(0, podY, ringZ),
  );
  const innerRing = add(
    root,
    new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.09, 10, 48), createProcessMaterial(GOLD, 1.0, 0.76)),
    vector(0, podY, ringZ + 0.08),
  );
  const meanPlane = add(
    root,
    new THREE.Mesh(new THREE.BoxGeometry(8.0, 0.1, 0.26), createProcessMaterial(STEEL, 1.0, 0.72)),
    vector(0, podY, ringZ + 0.35),
  );
  normRing.name = "assistant-target-final-hidden-layernorm";
  innerRing.name = "assistant-target-final-hidden-layernorm";
  meanPlane.name = "assistant-target-final-hidden-layernorm";
  // The recipe hangs above the vector it is applied to, rather than beside it:
  // stacking keeps the whole lane on one sightline from the walkway.
  add(
    root,
    placeOnAvenue(
      createPanel(["subtract mean", "divide by std", "apply gamma + beta"], {
        width: 7.6,
        height: 2.5,
        color: "#eefaff",
        borderColor: VIOLET,
        fontScale: 0.82,
      }),
      { stop: 1, slot: "left", row: 1 },
    ),
  );

  const before = add(
    root,
    placeOnAvenue(
      createValueBoard(Array.from({ length: 8 }, (_, i) => `h${i}`), 1, 8, {
        width: 5.6,
        cellHeight: 0.68,
        title: "H2[cat]",
        color: CYAN,
        unknownIndices: Array.from({ length: 8 }, (_, i) => i),
        fontScale: 0.72,
      }),
      { stop: 1, slot: "left" },
    ),
  );
  const centered = add(
    root,
    placeOnAvenue(
      createValueBoard(Array.from({ length: 8 }, (_, i) => `h${i}-mu`), 1, 8, {
        width: 5.8,
        cellHeight: 0.68,
        title: "CENTERED",
        color: STEEL,
        unknownIndices: Array.from({ length: 8 }, (_, i) => i),
        fontScale: 0.7,
      }),
      { stop: 2, slot: "right" },
    ),
  );
  const normalized = add(
    root,
    placeOnAvenue(
      createValueBoard(Array.from({ length: 8 }, (_, i) => `g${i}n${i}+b${i}`), 1, 8, {
        width: 6.2,
        cellHeight: 0.68,
        title: "H_FINAL[cat]",
        color: VIOLET,
        unknownIndices: Array.from({ length: 8 }, (_, i) => i),
        fontScale: 0.67,
      }),
      { stop: 3, slot: "left" },
    ),
  );
  const finalBoard = add(
    root,
    createValueBoard(Array.from({ length: 12 }, (_, i) => `hF${i}[8]`), 2, 6, {
      width: 9.4,
      cellHeight: 0.68,
      title: "H_FINAL [2 x 6 x 8]",
      subtitle: "contextual values -- not probabilities",
      color: VIOLET,
      accent: GOLD,
      highlightedIndices: [2],
      unknownIndices: Array.from({ length: 12 }, (_, i) => i),
      fontScale: 0.72,
    }),
    avenueAnchor({ stop: 4, slot: "centre" }),
  );
  before.name = "assistant-target-final-hidden-selected-input";
  centered.name = "assistant-target-final-hidden-centered-vector";
  normalized.name = "assistant-target-final-hidden-normalized-vector";
  finalBoard.name = "assistant-target-final-hidden-output-tensor";

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    setObjectOpacity(tokenBoard, 1 - smoothStep(p, 0.15, 0.34) * 0.72);
    const travel = smoothStep(p, 0.12, 0.82);
    pods.position.z = THREE.MathUtils.lerp(podEnter, podExit, travel);
    pods.position.y = podY + Math.sin(travel * Math.PI) * 0.18;
    setObjectOpacity(pods, 0.34 + smoothStep(p, 0.04, 0.16) * 0.66);
    setObjectEmissive(normRing, 0.45 + windowPulse(p, 0.22, 0.5, 0.78) * 0.95);
    setObjectEmissive(innerRing, 0.38 + windowPulse(p, 0.42, 0.59, 0.76) * 0.85);
    if (motionEnabled) {
      normRing.rotation.z = elapsed * 0.22;
      innerRing.rotation.z = -elapsed * 0.34;
    }
    meanPlane.position.y = THREE.MathUtils.lerp(podY + 1.5, podY - 0.4, smoothStep(p, 0.3, 0.48));
    setObjectOpacity(meanPlane, visibilityWindow(p, 0.23, 0.31, 0.58, 0.68));
    setObjectOpacity(before, visibilityWindow(p, 0.12, 0.24, 0.4, 0.5));
    setObjectOpacity(centered, visibilityWindow(p, 0.34, 0.47, 0.62, 0.72));
    setObjectOpacity(normalized, smoothStep(p, 0.58, 0.74) * (1 - smoothStep(p, 0.84, 0.93)));
    setObjectOpacity(finalBoard, smoothStep(p, 0.78, 0.92));
    if (motionEnabled && p > 0.88) pulseObject(finalBoard, elapsed, 2.0, 0.02);
  };
  return finaliseUpdater(updater);
}

/**
 * Vocabulary Projection, laid out as a walkable avenue.
 *
 * The one hidden vector is read at the first stop, then the visitor turns to
 * the learned vocabulary wall filling the opposite lane while the scan beam
 * works down it. The sixteen accumulators hang over the runway at the next
 * stop, so the products fly overhead and the visitor walks beneath the summing.
 * Bias comes in on the far lane and the logit tray closes the walk.
 */
function buildVocabularyProjection(context: ChamberProcessContext): ChamberProcessUpdater {
  const root = processRoot(context);
  add(
    root,
    createPanel(["ONE HIDDEN VECTOR", "SCANS W_VOCAB -> 16 RAW LOGITS"], {
      width: 13.6,
      height: 2.0,
      color: "#eefaff",
      borderColor: GOLD,
    }),
    avenueAnchor({ stop: 0, slot: "banner" }),
  );

  const hBoard = add(
    root,
    placeOnAvenue(
      createValueBoard(Array.from({ length: 8 }, (_, i) => `h${i}`), 1, 8, {
        width: 7.8,
        cellHeight: 0.72,
        title: "h_final[batch0,pos2] [8]",
        subtitle: "values symbolic; shape exact",
        color: CYAN,
        unknownIndices: Array.from({ length: 8 }, (_, i) => i),
      }),
      { stop: 0, slot: "left", xShift: 1.0 },
    ),
  );
  hBoard.name = "assistant-target-vocab-hidden-input";
  const weightValues = Array.from({ length: 128 }, (_, index) => `w${Math.floor(index / 16)}${index % 16}`);
  const weights = add(
    root,
    placeOnAvenue(
      createValueBoard(weightValues, 8, 16, {
        width: 10.5,
        cellHeight: 0.45,
        title: "LEARNED W_VOCAB [8 x 16]",
        subtitle: "stationary parameters",
        color: GOLD,
        unknownIndices: Array.from({ length: 128 }, (_, i) => i),
        fontScale: 0.62,
      }),
      // The sixteen-column wall is wide enough that the inner lane would clip
      // the walkway, so it stands further out and takes the whole flank.
      { stop: 1, slot: "right", offset: [0, 1.0, 0], xShift: 2.8 },
    ),
  );
  weights.name = "assistant-target-vocab-weight-matrix";
  const rowBeam = add(
    root,
    new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.1, 0.09), createProcessMaterial(CYAN, 1.4, 0.8)),
    weights.position.clone().add(vector(0, 1.85, 0.36)),
  );
  rowBeam.name = "assistant-target-vocab-matrix-multiply";
  rowBeam.rotation.y = weights.rotation.y;
  const beamTop = rowBeam.position.y;
  const beamBottom = weights.position.y - 1.75;

  // The accumulators are strung across the arch tier: sixteen columns wide,
  // they would otherwise be a fence straight across the walkway.
  const accumulatorY = AVENUE.archY + 0.4;
  const accumulatorZ = avenueZ(2);
  const accumulators = new THREE.Group();
  accumulators.name = "assistant-target-vocab-accumulators";
  const accumulatorMaterial = createProcessMaterial(BLUE, 1.0, 0.78);
  const accumulatorMeshes: THREE.Mesh[] = [];
  const accumulatorX = (index: number) => (index - 7.5) * 0.92;
  for (let index = 0; index < 16; index += 1) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.28, 0.68, 10), accumulatorMaterial);
    mesh.position.set(accumulatorX(index), accumulatorY, accumulatorZ);
    accumulators.add(mesh);
    accumulatorMeshes.push(mesh);
  }
  root.add(accumulators);
  add(
    root,
    placeOnAvenue(
      createPanel(["16 SUM ACCUMULATORS", "one per vocabulary column"], {
        width: 8.2,
        height: 2.0,
        color: "#eefaff",
        borderColor: BLUE,
      }),
      { stop: 2, slot: "left" },
    ),
  );

  const productPackets = Array.from({ length: 16 }, (_, index) => {
    const packet = createPacket(index === SELECTED_TRACE.batch.selectedTargetTokenId ? GOLD : CYAN, 0.105);
    packet.name = "assistant-target-vocab-matrix-multiply";
    root.add(packet);
    return packet;
  });
  const packetPaths = productPackets.map((_, index) => {
    const start = weights.position.clone().add(vector(0, 0.4, 0.5));
    const end = vector(accumulatorX(index), accumulatorY - 0.5, accumulatorZ);
    return avenueRoute(start, end, 1.1);
  });
  const bias = add(
    root,
    placeOnAvenue(
      createValueBoard(Array.from({ length: 16 }, (_, i) => `b${i}`), 1, 16, {
        width: 9.6,
        cellHeight: 0.62,
        title: "+ b_vocab [16]",
        color: STEEL,
        unknownIndices: Array.from({ length: 16 }, (_, i) => i),
        fontScale: 0.65,
      }),
      { stop: 3, slot: "right", row: 0.55 },
    ),
  );
  bias.name = "assistant-target-vocab-bias";
  const vocabulary = [...SELECTED_TRACE.vocabulary];
  const logitLabels = SELECTED_TRACE.output.selectedLogits.map(
    (value, index) => `${vocabulary[index]}:${value.toFixed(3)}`,
  );
  const logits = add(
    root,
    createValueBoard(logitLabels, 4, 4, {
      width: 10.0,
      cellHeight: 0.8,
      title: "RAW LOGITS [16]",
      subtitle: "scores, not probabilities -- softmax is next",
      color: BLUE,
      accent: GOLD,
      highlightedIndices: [SELECTED_TRACE.batch.selectedTargetTokenId],
      fontScale: 0.74,
    }),
    avenueAnchor({ stop: 4, slot: "centre" }),
  );
  logits.name = "assistant-target-vocab-logit-output";

  const hHome = hBoard.position.clone();
  const hYaw = hBoard.rotation.y;
  const hDock = weights.position.clone().add(vector(0, 3.9, 0.8));
  const biasHome = bias.position.clone();
  const biasSeat = avenueAnchor({ stop: 3, slot: "right" });

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const dock = smoothStep(p, 0.08, 0.25);
    moveObject(hBoard, hHome, hDock, dock, 0.18);
    // The vector crosses the avenue to reach the wall, so it unyaws on the way
    // and is read face-on once it is docked above the matrix.
    hBoard.rotation.y = hYaw * (1 - dock);
    setObjectOpacity(hBoard, 1 - smoothStep(p, 0.48, 0.62) * 0.72);
    setObjectOpacity(weights, 0.24 + smoothStep(p, 0.08, 0.22) * 0.76);
    const scan = smoothStep(p, 0.22, 0.59);
    rowBeam.position.y = THREE.MathUtils.lerp(beamTop, beamBottom, scan);
    setObjectOpacity(rowBeam, visibilityWindow(p, 0.19, 0.25, 0.58, 0.66));
    setObjectOpacity(accumulators, smoothStep(p, 0.2, 0.34));
    accumulatorMeshes.forEach((mesh, index) => {
      const pulse = motionEnabled ? Math.sin(elapsed * 5 + index * 0.45 + scan * 14) : Math.sin(index * 0.45);
      mesh.scale.y = 0.82 + scan * 0.22 + Math.max(0, pulse) * 0.12;
    });
    productPackets.forEach((packet, index) => {
      const delay = index * 0.0025;
      const travel = smoothStep(p, 0.25 + delay, 0.57 + delay);
      samplePath(packet, packetPaths[index], travel, 0.28);
      setObjectOpacity(packet, visibilityWindow(p, 0.23 + delay, 0.27 + delay, 0.58 + delay, 0.64 + delay));
      if (motionEnabled) packet.rotation.y = elapsed * 2 + index;
    });
    moveObject(bias, biasHome, biasSeat, smoothStep(p, 0.55, 0.68), 0.12);
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
