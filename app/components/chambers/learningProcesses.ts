import * as THREE from "three";

import { SELECTED_TRACE } from "../../lib/trainingTrace";
import {
  AVENUE,
  type AvenuePlacement,
  avenueAnchor,
  avenueLaneX,
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
  samplePath,
  setObjectEmissive,
  setObjectOpacity,
  smoothStep,
  vector,
  windowPulse,
} from "./processShared";

const TARGET_INDEX = SELECTED_TRACE.batch.selectedTargetTokenId;
const SELECTED_CELL_INDEX = 3 * 8 + 6;
const MAX_LOGIT_MAGNITUDE = Math.max(
  ...SELECTED_TRACE.output.selectedLogits.map((value) => Math.abs(value)),
);

function addAt<T extends THREE.Object3D>(
  context: ChamberProcessContext,
  object: T,
  position: THREE.Vector3,
) {
  object.position.copy(position);
  context.group.add(object);
  return object;
}

/** Places an exhibit in the avenue and threads it into the chamber group. */
function place<T extends THREE.Object3D>(
  context: ChamberProcessContext,
  object: T,
  placement: AvenuePlacement,
) {
  placeOnAvenue(object, placement);
  context.group.add(object);
  return object;
}

function addHeader(
  context: ChamberProcessContext,
  lines: readonly string[],
  color: THREE.ColorRepresentation,
) {
  return place(
    context,
    createPanel(lines, {
      width: 13.2,
      height: 1.7,
      color,
      borderColor: color,
      fontScale: 0.72,
    }),
    { stop: 0, slot: "banner" },
  );
}

function finishBuilder(updater: ChamberProcessUpdater) {
  updater(0, 0, false);
  return updater;
}

function makeRing(
  color: THREE.ColorRepresentation,
  radius: number,
  tube = 0.055,
) {
  return new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 8, 48),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
}

function makeDeck(
  size: THREE.Vector3,
  color: THREE.ColorRepresentation,
  opacity = 0.28,
) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    createProcessMaterial(color, 0.35, opacity),
  );
}

function stringValues(values: readonly number[], digits: number) {
  return values.map((value) => value.toFixed(digits));
}

/**
 * Softmax Observatory, laid out as a walkable avenue.
 *
 * The raw scores are read at the entrance, then the visitor walks under the
 * exponential arch and past the panel that states the shared denominator. The
 * sixteen bars line both lanes for the next two stops, so the distribution is
 * seen from inside it rather than across a table, and the normalised row hangs
 * over the exit.
 */
function buildLogitsProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const cyan = context.palette.phaseBase;
  const gold = "#ffd166";
  addHeader(context, ["SOFTMAX OBSERVATORY", "16 LOGITS NORMALIZE TOGETHER"], cyan);

  const rawBoard = place(
    context,
    createValueBoard(SELECTED_TRACE.output.selectedLogits, 4, 4, {
      width: 6.8,
      cellHeight: 0.65,
      title: "RAW LOGITS g[16]",
      subtitle: "signed scores - any real value",
      color: "#ff765f",
      accent: gold,
      highlightedIndices: [TARGET_INDEX],
    }),
    { stop: 0, slot: "left", xShift: 0.6 },
  );
  rawBoard.name = "assistant-target-logits-raw-logits";

  // Every logit is exponentiated by the same operation, so the operation spans
  // the runway: the visitor passes through it instead of watching it from one
  // side.
  const archCentre = avenueAnchor({ stop: 1, slot: "centre" });
  const expRing = addAt(context, makeRing(cyan, 2.1, 0.16), archCentre.clone());
  expRing.rotation.x = Math.PI / 2;
  expRing.name = "assistant-target-logits-softmax-operation";
  const expGlyph = place(context, createGlyph("exp", cyan, 2.1), {
    stop: 1,
    slot: "centre",
  });
  expGlyph.name = "assistant-target-logits-softmax-operation";
  const sumPanel = place(
    context,
    createPanel(["SUM exp(g_k) = 10.000 for this row", "p_k = exp(g_k) / SUM"], {
      width: 6.6,
      height: 1.75,
      color: "#f4fbff",
      borderColor: cyan,
      fontScale: 0.68,
    }),
    { stop: 2, slot: "right" },
  );
  sumPanel.name = "assistant-target-logits-softmax-operation";
  const probabilityBoard = place(
    context,
    createValueBoard(SELECTED_TRACE.output.selectedProbabilities, 4, 4, {
      width: 8.0,
      cellHeight: 0.68,
      title: "PROBABILITIES p[16]",
      subtitle: "sat .28 | on .16 | sum 1.00",
      color: cyan,
      accent: gold,
      highlightedIndices: [TARGET_INDEX],
    }),
    { stop: 5, slot: "centre" },
  );
  probabilityBoard.name = "assistant-target-logits-probabilities";

  const bars: Array<{
    mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
    material: THREE.MeshStandardMaterial;
    rawHeight: number;
    probabilityHeight: number;
    x: number;
    z: number;
  }> = [];
  const packets: THREE.Object3D[] = [];
  const riseRoutes: THREE.Vector3[][] = [];
  const fallRoutes: THREE.Vector3[][] = [];
  const barBase = -4.3;

  SELECTED_TRACE.output.selectedLogits.forEach((logit, index) => {
    // Eight bars per lane, four across and two deep, so the whole vocabulary
    // stands on the plinths the visitor walks between.
    const side = index < 8 ? -1 : 1;
    const column = index % 4;
    const gridRow = Math.floor((index % 8) / 4);
    const stop = 3 + gridRow;
    const x = side * (5.2 + column * 2.4);
    const z = avenueZ(stop);
    const rawHeight = 0.38 + (Math.abs(logit) / MAX_LOGIT_MAGNITUDE) * 1.85;
    const probabilityHeight = 0.28 + SELECTED_TRACE.output.selectedProbabilities[index] * 9.5;
    const material = createProcessMaterial(
      index === TARGET_INDEX ? gold : "#ff765f",
      index === TARGET_INDEX ? 1.5 : 0.85,
    );
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 1, 0.46), material);
    mesh.position.set(x, barBase + rawHeight / 2, z);
    mesh.scale.y = rawHeight;
    mesh.name = "assistant-target-logits-distribution-bars";
    context.group.add(mesh);
    bars.push({ mesh, material, rawHeight, probabilityHeight, x, z });

    const packet = createPacket(index === TARGET_INDEX ? gold : cyan, 0.15);
    const rise = avenueRoute(vector(x, barBase + rawHeight + 0.6, z), archCentre, 1.1);
    const fall = avenueRoute(archCentre, vector(x, barBase + probabilityHeight + 0.6, z), 1.1);
    riseRoutes.push(rise);
    fallRoutes.push(fall);
    context.group.add(packet);
    packets.push(packet);

    if (index % 2 === 0 || index === TARGET_INDEX) {
      // The near rank labels sit below eye level and the far rank above it, so
      // one row of tokens never queues up behind the other.
      const label = addAt(
        context,
        createPanel([`${index} ${SELECTED_TRACE.vocabulary[index]}`], {
          width: 2.1,
          height: 1.0,
          color: index === TARGET_INDEX ? gold : "#dceaff",
          borderColor: index === TARGET_INDEX ? gold : cyan,
          fontScale: 0.62,
          background: "rgba(3,8,16,0.82)",
        }),
        vector(x, gridRow === 0 ? -0.7 : 2.8, z + 0.5),
      );
      label.rotation.y = -side * AVENUE.laneYaw;
    }
    context.group.add(
      createPath([...rise, ...fall.slice(1)], cyan, 0.022, 0.1),
    );
  });

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const morph = smoothStep(p, 0.5, 0.8);
    setObjectOpacity(rawBoard, 1 - smoothStep(p, 0.48, 0.7) * 0.82);
    setObjectOpacity(probabilityBoard, smoothStep(p, 0.56, 0.8));
    setObjectOpacity(sumPanel, windowPulse(p, 0.34, 0.5, 0.78));
    expRing.rotation.z = motionEnabled ? elapsed * 0.65 : 0;
    setObjectEmissive(expGlyph, 0.55 + windowPulse(p, 0.2, 0.46, 0.72) * 1.5);

    bars.forEach((bar, index) => {
      const height = THREE.MathUtils.lerp(bar.rawHeight, bar.probabilityHeight, morph);
      bar.mesh.position.set(bar.x, barBase + height / 2, bar.z);
      bar.mesh.scale.set(1, height, 1);
      const from = new THREE.Color(index === TARGET_INDEX ? gold : "#ff765f");
      const to = new THREE.Color(index === TARGET_INDEX ? gold : cyan);
      bar.material.color.copy(from.lerp(to, morph));
      bar.material.emissive.copy(bar.material.color);

      const packet = packets[index];
      if (p < 0.52) {
        samplePath(packet, riseRoutes[index], smoothStep(p, 0.16, 0.4), 0.2);
      } else {
        samplePath(packet, fallRoutes[index], smoothStep(p, 0.54, 0.78), 0.2);
      }
      setObjectOpacity(packet, windowPulse(p, 0.12, 0.5, 0.86));
      packet.rotation.y = motionEnabled ? elapsed * (0.5 + index * 0.015) : 0;
    });
  };
  return finishBuilder(updater);
}

/**
 * Target Gather Gantry, laid out as a walkable avenue.
 *
 * The plaque over the threshold says the prediction is already finished, then
 * the prediction row and the answer tray face each other across the runway —
 * the answer literally arrives from the other side of the walk. It crosses
 * overhead, the gathered probability is called out one stop later, and the
 * gathered column closes the walk above the exit.
 */
function buildTargetComparisonProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const cyan = context.palette.phaseBase;
  const gold = "#ffd166";
  addHeader(context, ["TARGET GATHER GANTRY", "THE ANSWER ARRIVES AFTER PREDICTION"], gold);

  const lateAnswerPanel = place(
    context,
    createPanel(["PREDICTIONS COMPLETE", "ANSWERS REMAIN OUTSIDE THE MODEL"], {
      width: 7.4,
      height: 1.55,
      color: "#dceaff",
      borderColor: cyan,
      fontScale: 0.68,
    }),
    { stop: 0, slot: "centre" },
  );

  const predictionBoardWidth = 6.8;
  const predictionCellHeight = 0.7;
  const predictionBoard = place(
    context,
    createValueBoard(SELECTED_TRACE.output.selectedProbabilities, 4, 4, {
      width: predictionBoardWidth,
      cellHeight: predictionCellHeight,
      title: "PREDICTION ROW p[16]",
      subtitle: "batch 0 | position 2 | cat predicts next",
      color: cyan,
      accent: gold,
      highlightedIndices: [TARGET_INDEX],
    }),
    { stop: 1, slot: "left" },
  );
  // The lit cell is derived from the board's own grid so it keeps tracking the
  // highlighted target after the board is moved or resized.
  const predictionHeight = 4 * predictionCellHeight + 0.72 + 0.5 + 0.34;
  const selectedCell = predictionBoard.localToWorld(
    vector(
      -predictionBoardWidth / 2 + 1.5 * (predictionBoardWidth / 4),
      predictionHeight / 2 - 0.72 - 1.5 * predictionCellHeight,
      0.34,
    ),
  );

  const targetTile = place(
    context,
    createPanel(["TARGET TRAY", "sat | ID 5"], {
      width: 3.7,
      height: 1.7,
      color: gold,
      borderColor: gold,
      fontScale: 0.78,
    }),
    { stop: 1, slot: "right", zShift: 1.4 },
  );
  const targetStart = targetTile.position.clone();
  const targetYaw = targetTile.rotation.y;
  // The answer vaults the runway rather than crossing it, so the visitor
  // watches it pass overhead on the way to the prediction row.
  const targetPath = [
    targetStart,
    vector(4.6, 5.2, targetStart.z - 0.7),
    vector(0, 6.4, targetStart.z - 1.4),
    vector(-4.6, 5.0, targetStart.z - 2.1),
    selectedCell.clone(),
  ];
  context.group.add(createPath(targetPath, gold, 0.055, 0.42));

  const locator = addAt(context, makeRing(gold, 0.78, 0.085), selectedCell.clone());
  locator.rotation.y = predictionBoard.rotation.y;
  const gatheredPacket = addAt(context, createPacket(gold, 0.26), selectedCell.clone());

  const gatherPanel = place(
    context,
    createPanel(["GATHER ID 5", "p[sat] = 0.28"], {
      width: 4.8,
      height: 1.75,
      color: gold,
      borderColor: gold,
      fontScale: 0.78,
    }),
    { stop: 2, slot: "right", row: 1 },
  );

  const correctBoard = place(
    context,
    createValueBoard(SELECTED_TRACE.output.correctTokenProbabilities.flat(), 2, 6, {
      width: 8.4,
      cellHeight: 0.84,
      title: "P_CORRECT [2 x 6]",
      subtitle: "one gathered candidate per target",
      color: gold,
      accent: gold,
      highlightedIndices: [2],
    }),
    { stop: 3, slot: "centre" },
  );
  const resultPosition = correctBoard.position.clone();
  const gatherPath = [
    selectedCell.clone(),
    vector(-6.4, 4.6, (selectedCell.z + resultPosition.z) / 2 + 2.2),
    vector(-2.6, 6.2, (selectedCell.z + resultPosition.z) / 2),
    resultPosition.clone().add(vector(0, -0.4, 2.4)),
    resultPosition,
  ];
  context.group.add(createPath(gatherPath, gold, 0.07, 0.45));

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    setObjectOpacity(predictionBoard, 0.52 + smoothStep(p, 0, 0.18) * 0.48);
    setObjectOpacity(lateAnswerPanel, 1 - smoothStep(p, 0.22, 0.42) * 0.68);
    const arrival = smoothStep(p, 0.2, 0.48);
    samplePath(targetTile, targetPath, arrival, 0.18);
    // The tray leaves the right lane angled inward and squares up as it lands
    // on the prediction row it belongs to.
    targetTile.rotation.y = THREE.MathUtils.lerp(
      targetYaw,
      predictionBoard.rotation.y,
      arrival,
    );
    setObjectOpacity(targetTile, smoothStep(p, 0.16, 0.26));
    setObjectOpacity(locator, windowPulse(p, 0.4, 0.56, 0.82));
    locator.rotation.z = motionEnabled ? elapsed * 0.8 : 0;
    setObjectOpacity(gatherPanel, smoothStep(p, 0.5, 0.68));
    samplePath(gatheredPacket, gatherPath, smoothStep(p, 0.56, 0.8), 0.45);
    setObjectOpacity(gatheredPacket, windowPulse(p, 0.52, 0.7, 0.86));
    setObjectOpacity(correctBoard, smoothStep(p, 0.72, 0.9));
  };
  return finishBuilder(updater);
}

/**
 * Cross-Entropy Foundry, laid out as a walkable avenue.
 *
 * The twelve supervised probabilities are read on the left, then rise into a
 * bank of -ln gates suspended over the runway: the visitor walks through the
 * twelve independent penalties instead of watching them from outside. The
 * penalties board and the worked single lane face each other at the next stop,
 * the twelve streams pour into the averaging funnel overhead, and the scalar
 * stands alone at the end of the walk.
 */
function buildLossProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const gold = "#ffd166";
  const cyan = context.palette.phaseBase;
  addHeader(context, ["CROSS-ENTROPY FOUNDRY", "12 PROBABILITIES -> -ln -> MEAN"], gold);

  const probabilityBoard = place(
    context,
    createValueBoard(SELECTED_TRACE.output.correctTokenProbabilities.flat(), 2, 6, {
      width: 7.2,
      cellHeight: 0.78,
      title: "P_CORRECT [2 x 6]",
      subtitle: "one probability per supervised position",
      color: cyan,
      accent: gold,
      highlightedIndices: [2],
    }),
    { stop: 0, slot: "left", xShift: 0.6 },
  );
  probabilityBoard.name = "assistant-target-loss-correct-probabilities";
  const lossBoard = place(
    context,
    createValueBoard(SELECTED_TRACE.output.perTokenLosses.flat(), 2, 6, {
      width: 7.2,
      cellHeight: 0.78,
      title: "TOKEN PENALTIES [2 x 6]",
      subtitle: "exact -ln(p_correct) values",
      color: gold,
      accent: gold,
      highlightedIndices: [2],
    }),
    { stop: 2, slot: "right" },
  );
  lossBoard.name = "assistant-target-loss-token-penalties";
  const selectedEquation = place(
    context,
    createPanel(["SELECTED LANE", "0.28 -> -ln -> 1.272965676"], {
      width: 6.4,
      height: 1.55,
      color: gold,
      borderColor: gold,
      fontScale: 0.72,
    }),
    { stop: 2, slot: "left" },
  );
  selectedEquation.name = "assistant-target-loss-selected-lane";

  const probabilityPackets: THREE.Object3D[] = [];
  const lossPackets: THREE.Object3D[] = [];
  const laneStarts: THREE.Vector3[] = [];
  const gatePositions: THREE.Vector3[] = [];
  const lossPositions: THREE.Vector3[] = [];
  const funnelPosition = vector(0, AVENUE.archY + 0.9, avenueZ(3));
  const gateMaterial = createProcessMaterial(gold, 0.75, 0.65);
  for (let index = 0; index < 12; index += 1) {
    const row = Math.floor(index / 6);
    const column = index % 6;
    const gateX = (column - 2.5) * 1.35;
    const gateY = AVENUE.archY - 0.8 + row * 1.6;
    const start = vector(-(5.6 + column * 1.05), 3.7 + row * 1.0, avenueZ(0) - 1.2);
    const gate = vector(gateX, gateY, avenueZ(1));
    const output = vector(gateX, gateY, avenueZ(2));
    laneStarts.push(start);
    gatePositions.push(gate);
    lossPositions.push(output);
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.07, 8, 28), gateMaterial);
    hoop.position.copy(gate);
    hoop.name = "assistant-target-loss-cross-entropy-gates";
    context.group.add(hoop);
    const inputPacket = createPacket(index === 2 ? gold : cyan, 0.16);
    inputPacket.position.copy(start);
    context.group.add(inputPacket);
    probabilityPackets.push(inputPacket);
    const lossPacket = createPacket(gold, 0.2);
    lossPacket.position.copy(gate);
    context.group.add(lossPacket);
    lossPackets.push(lossPacket);
    context.group.add(createPath([start, gate, output, funnelPosition], gold, 0.024, 0.17));
  }
  const minusLogLabel = place(
    context,
    createPanel(["12 INDEPENDENT -ln GATES"], {
      width: 5.8,
      height: 1.15,
      color: gold,
      borderColor: gold,
      fontScale: 0.7,
    }),
    { stop: 1, slot: "right", row: 1 },
  );
  minusLogLabel.name = "assistant-target-loss-cross-entropy-gates";
  const funnel = addAt(
    context,
    new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 0.9, 1.9, 24, 1, true),
      createProcessMaterial(gold, 0.85, 0.5),
    ),
    funnelPosition,
  );
  funnel.name = "assistant-target-loss-averaging";
  // The divisor hangs in the funnel's throat, high enough that the walkway
  // underneath stays clear.
  const divideGlyph = place(context, createGlyph("/ 12", gold, 2.1), {
    stop: 3,
    slot: "centre",
    row: -0.34,
  });
  divideGlyph.name = "assistant-target-loss-averaging";
  const sumPanel = place(
    context,
    createPanel(["SUM 12 LOSSES ~= 17.131643", "MEAN = SUM / 12"], {
      width: 6.4,
      height: 1.55,
      color: gold,
      borderColor: gold,
      fontScale: 0.68,
    }),
    { stop: 4, slot: "left" },
  );
  sumPanel.name = "assistant-target-loss-averaging";
  const scalarAnchor = avenueAnchor({ stop: 4, slot: "right" });
  const scalar = addAt(
    context,
    new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 2), createProcessMaterial(gold, 1.7)),
    scalarAnchor.clone().add(vector(0, -2.3, 0.9)),
  );
  scalar.name = "assistant-target-loss-scalar-loss";
  const scalarPanel = place(
    context,
    createPanel(["SCALAR LOSS", "L = 1.427636920"], {
      width: 5.2,
      height: 1.7,
      color: gold,
      borderColor: gold,
      fontScale: 0.78,
    }),
    { stop: 4, slot: "right" },
  );
  scalarPanel.name = "assistant-target-loss-scalar-loss";

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    setObjectOpacity(probabilityBoard, 1 - smoothStep(p, 0.4, 0.62) * 0.66);
    setObjectOpacity(lossBoard, smoothStep(p, 0.38, 0.62));
    setObjectOpacity(selectedEquation, windowPulse(p, 0.2, 0.43, 0.72));
    setObjectOpacity(minusLogLabel, windowPulse(p, 0.12, 0.36, 0.64));

    probabilityPackets.forEach((packet, index) => {
      moveObject(packet, laneStarts[index], gatePositions[index], smoothStep(p, 0.14, 0.4), 0.16);
      setObjectOpacity(packet, 1 - smoothStep(p, 0.34, 0.46));
      const lossPacket = lossPackets[index];
      const launch = 0.35 + index * 0.006;
      const gatherStart = 0.57 + index * 0.01;
      const gatherEnd = 0.78 + index * 0.008;
      if (p < gatherStart) {
        moveObject(lossPacket, gatePositions[index], lossPositions[index], smoothStep(p, launch, 0.56), 0.18);
      } else {
        moveObject(lossPacket, lossPositions[index], funnelPosition, smoothStep(p, gatherStart, gatherEnd), 0.32);
      }
      setObjectOpacity(lossPacket, windowPulse(p, launch, 0.62, 0.86));
      if (motionEnabled) lossPacket.rotation.y = elapsed * (0.5 + index * 0.02);
    });
    setObjectOpacity(sumPanel, smoothStep(p, 0.7, 0.82));
    setObjectOpacity(divideGlyph, smoothStep(p, 0.72, 0.84));
    setObjectEmissive(funnel, 0.45 + smoothStep(p, 0.62, 0.82) * 1.15);
    const scalarReveal = smoothStep(p, 0.82, 0.94);
    setObjectOpacity(scalar, scalarReveal);
    setObjectOpacity(scalarPanel, scalarReveal);
    scalar.scale.setScalar(
      scalarReveal * (motionEnabled ? 1 + Math.sin(elapsed * 4) * 0.04 : 1),
    );
  };
  return finishBuilder(updater);
}

/**
 * Output Derivative Forge, laid out as a walkable avenue.
 *
 * The prediction and the answer are genuinely parallel operands, so they open
 * the walk facing each other and rise together into the minus arch. The
 * difference and the divisor share the next bay, the averaged gradient hangs
 * over the runway, and the copy fork sends one gradient into each lane at the
 * last stop — the split is seen as two boards on opposite sides of the walk.
 */
function buildOutputBackpropProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const warm = "#ff765f";
  const amber = "#ffd166";
  const probabilities = SELECTED_TRACE.output.selectedProbabilities;
  const oneHot = probabilities.map((_, index) => (index === TARGET_INDEX ? 1 : 0));
  const difference = probabilities.map((value, index) => value - oneHot[index]);
  const dG = difference.map((value) => value / 12);
  addHeader(context, ["OUTPUT DERIVATIVE FORGE", "p - one_hot -> /12 -> COPY FORK"], warm);

  const pBoard = place(
    context,
    createValueBoard(probabilities, 4, 4, {
      width: 6.8,
      cellHeight: 0.6,
      title: "p[16]",
      subtitle: "selected position",
      color: context.palette.phaseBase,
      accent: amber,
      highlightedIndices: [TARGET_INDEX],
    }),
    { stop: 0, slot: "left", xShift: 0.6 },
  );
  const yBoard = place(
    context,
    createValueBoard(oneHot, 4, 4, {
      width: 6.8,
      cellHeight: 0.6,
      title: "one_hot(target=5)",
      subtitle: "1 only at sat",
      color: amber,
      accent: amber,
      highlightedIndices: [TARGET_INDEX],
    }),
    { stop: 0, slot: "right", xShift: 0.6 },
  );
  const pStart = pBoard.position.clone();
  const yStart = yBoard.position.clone();
  const pYaw = pBoard.rotation.y;
  const yYaw = yBoard.rotation.y;
  const subtract = place(context, createGlyph("-", warm, 2.0), {
    stop: 1,
    slot: "centre",
  });
  const differenceBoard = place(
    context,
    createValueBoard(stringValues(difference, 3), 4, 4, {
      width: 7.4,
      cellHeight: 0.6,
      title: "p - one_hot(y)",
      subtitle: "sat becomes -0.720",
      color: warm,
      accent: amber,
      highlightedIndices: [TARGET_INDEX],
    }),
    { stop: 2, slot: "left" },
  );
  // Operator glyphs stand at the runway edge of the bay they belong to rather
  // than over the centre line, where each would hide the next.
  const divide = place(context, createGlyph("/ 12", warm, 2.1), {
    stop: 2,
    slot: "left",
    row: 0.5,
    xShift: -2.8,
    zShift: -2.8,
  });
  const dGBoard = place(
    context,
    createValueBoard(stringValues(dG, 9), 4, 4, {
      width: 8.0,
      cellHeight: 0.62,
      title: "dG SELECTED SLICE",
      subtitle: "sat -.060000000 | on +.013333333 | sum 0",
      color: warm,
      accent: amber,
      highlightedIndices: [TARGET_INDEX, 6],
    }),
    { stop: 3, slot: "centre" },
  );
  const forkGlyph = place(context, createGlyph("COPY", warm, 2.0), {
    stop: 3,
    slot: "right",
    row: 0.5,
    xShift: -2.8,
    zShift: -2.4,
  });
  const dHBoard = place(
    context,
    createValueBoard(Array.from({ length: 8 }, () => "."), 1, 8, {
      width: 6.8,
      cellHeight: 0.85,
      title: "dH = dG x W_vocab^T",
      subtitle: "dH [2 x 6 x 8] | values unknown",
      color: warm,
      unknownIndices: Array.from({ length: 8 }, (_, index) => index),
    }),
    { stop: 4, slot: "left" },
  );
  const dWBoard = place(
    context,
    createValueBoard(Array.from({ length: 16 }, () => "."), 4, 4, {
      width: 6.8,
      cellHeight: 0.65,
      title: "dW = H^T x dG | 4 x 4 SLICE",
      subtitle: "rows 0:4, cols 0:4 of full dW_vocab [8 x 16]",
      color: amber,
      unknownIndices: Array.from({ length: 16 }, (_, index) => index),
    }),
    { stop: 4, slot: "right" },
  );
  const fork = forkGlyph.position.clone();
  const leftResult = dHBoard.position.clone();
  const rightResult = dWBoard.position.clone();
  // The activation branch has to change sides, so it vaults the runway well
  // above head height instead of cutting across it.
  const activationRoute = [
    fork,
    vector(2.8, AVENUE.archY + 0.4, fork.z - 1.4),
    vector(-2.8, AVENUE.archY + 0.4, fork.z - 2.8),
    leftResult.clone().add(vector(0.6, 2.4, 2.2)),
    leftResult,
  ];
  const parameterRoute = avenueRoute(fork, rightResult, 0.8);
  const activationPacket = addAt(context, createPacket(warm, 0.24), fork.clone());
  const parameterPacket = addAt(context, createPacket(amber, 0.24), fork.clone());
  context.group.add(createPath(activationRoute, warm, 0.07, 0.48));
  context.group.add(createPath(parameterRoute, amber, 0.07, 0.48));

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    // Both operands climb out of their lanes to meet under the minus sign, and
    // square up to the walkway as they converge.
    const converge = smoothStep(p, 0.1, 0.3);
    const meet = subtract.position;
    moveObject(pBoard, pStart, meet.clone().add(vector(-4.8, -0.3, 1.8)), converge, 0);
    moveObject(yBoard, yStart, meet.clone().add(vector(4.8, -0.3, 1.8)), converge, 0);
    pBoard.rotation.y = pYaw * (1 - converge);
    yBoard.rotation.y = yYaw * (1 - converge);
    const operandsFade = 1 - smoothStep(p, 0.3, 0.44);
    setObjectOpacity(pBoard, operandsFade);
    setObjectOpacity(yBoard, operandsFade);
    setObjectOpacity(subtract, windowPulse(p, 0.08, 0.3, 0.48));
    setObjectOpacity(differenceBoard, windowPulse(p, 0.3, 0.46, 0.66));
    setObjectOpacity(divide, windowPulse(p, 0.42, 0.58, 0.72));
    setObjectOpacity(dGBoard, smoothStep(p, 0.52, 0.7));
    setObjectOpacity(forkGlyph, smoothStep(p, 0.64, 0.76));
    const forkTravel = smoothStep(p, 0.68, 0.88);
    samplePath(activationPacket, activationRoute, forkTravel, 0.2);
    samplePath(parameterPacket, parameterRoute, forkTravel, 0.2);
    setObjectOpacity(activationPacket, windowPulse(p, 0.64, 0.78, 0.94));
    setObjectOpacity(parameterPacket, windowPulse(p, 0.64, 0.78, 0.94));
    setObjectOpacity(dHBoard, smoothStep(p, 0.82, 0.96));
    setObjectOpacity(dWBoard, smoothStep(p, 0.82, 0.96));
    if (motionEnabled) {
      activationPacket.rotation.y = elapsed;
      parameterPacket.rotation.y = -elapsed;
    }
  };
  return finishBuilder(updater);
}

/**
 * Two-Block Reverse Circuit, laid out as a walkable avenue.
 *
 * The gradient enters over the threshold, the final norm is undone in the right
 * bay, and then the four residual-add branches take one stop each, mirroring
 * left and right so four identically built bays never queue up on one
 * sightline. Each bay is a single column: the copy at the top, the Jacobian and
 * its merge in the middle, and the parameter-gradient rack low down, which is
 * the order the gradient actually passes through them. The exhausted gradient
 * leaves over the exit.
 */
function buildBackpropTowerProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const warm = "#ff765f";
  const amber = "#ffd166";
  addHeader(context, ["TWO-BLOCK REVERSE CIRCUIT", "ADD COPIES dL | MATRIX OPS COLLECT dW"], warm);

  // The two block plaques stand in the outer lanes, level with the first bay of
  // the block they name, where nothing else competes for the sightline.
  place(
    context,
    createPanel(["BLOCK 1 BACKWARD", "MLP ADD -> ATTENTION ADD"], {
      width: 5.4,
      height: 1.5,
      color: warm,
      borderColor: warm,
      fontScale: 0.65,
    }),
    { stop: 2, slot: "outer-right" },
  );
  place(
    context,
    createPanel(["BLOCK 0 BACKWARD", "MLP ADD -> ATTENTION ADD"], {
      width: 5.4,
      height: 1.5,
      color: warm,
      borderColor: warm,
      fontScale: 0.65,
    }),
    { stop: 4, slot: "outer-left" },
  );

  const branchPackets: Array<{
    identity: THREE.Object3D;
    transformed: THREE.Object3D;
    deposit: THREE.Object3D;
    merged: THREE.Object3D;
  }> = [];
  const branchPaths: Array<{
    identity: THREE.Vector3[];
    transformed: THREE.Vector3[];
    deposit: THREE.Vector3[];
    merged: THREE.Vector3[];
  }> = [];
  const branchStageObjects: Array<{
    copy: THREE.Object3D;
    jacobian: THREE.Object3D;
    plus: THREE.Object3D;
  }> = [];
  const rackNames = ["dW_MLP_1", "dW_ATTN_1", "dW_MLP_0", "dW_ATTN_0"];
  const jacobianNames = [
    ["MLP 1 + LN2 BACKWARD", "J^T x g"],
    ["ATTENTION 1 + LN1 BACKWARD", "J^T x g"],
    ["MLP 0 + LN2 BACKWARD", "J^T x g"],
    ["ATTENTION 0 + LN1 BACKWARD", "J^T x g"],
  ] as const;

  const inputBoard = place(
    context,
    createValueBoard(Array.from({ length: 8 }, () => "."), 1, 8, {
      width: 7.4,
      cellHeight: 0.82,
      title: "dH_final [2 x 6 x 8]",
      subtitle: "values not present in trace",
      color: warm,
      unknownIndices: Array.from({ length: 8 }, (_, index) => index),
    }),
    { stop: 0, slot: "left", xShift: 0.9 },
  );
  const finalNormBackward = place(
    context,
    createPanel(["LN_f BACKWARD FIRST", "dH2 = J_LNf^T x dH_final", "collects dgamma_f + dbeta_f"], {
      width: 5.6,
      height: 1.9,
      color: warm,
      borderColor: warm,
      fontScale: 0.62,
    }),
    { stop: 1, slot: "right" },
  );
  const finalNormRack = place(
    context,
    createPanel(["dLN_f", "parameter gradient"], {
      width: 4.8,
      height: 1.25,
      color: amber,
      borderColor: amber,
      fontScale: 0.62,
    }),
    { stop: 1, slot: "right", row: 1 },
  );

  // The gradient hands itself from bay to bay across the avenue, so each leg
  // vaults the runway at arch height instead of sweeping through it.
  const handoff = (from: THREE.Vector3, to: THREE.Vector3) => {
    const midZ = (from.z + to.z) / 2;
    return [
      from.clone(),
      vector(from.x * 0.6, AVENUE.archY - 0.5, midZ + 1.6),
      vector(0, AVENUE.archY + 0.4, midZ),
      vector(to.x * 0.6, AVENUE.archY - 0.5, midZ - 1.6),
      to.clone(),
    ];
  };

  const branchStops = [2, 3, 4, 5] as const;
  const branchSides = ["left", "right", "left", "right"] as const;
  const branchStarts = branchStops.map((stop, index) =>
    avenueAnchor({ stop, slot: branchSides[index], row: 1, zShift: 1.4 }).setY(5.0),
  );

  branchStops.forEach((stop, index) => {
    const side = branchSides[index];
    const sign = side === "left" ? -1 : 1;
    const laneX = avenueLaneX(stop);
    const z = avenueZ(stop);
    const start = branchStarts[index];
    // The skip copy bows out to the chamber wall while the transformed copy
    // goes through the Jacobian, so the two halves of the residual add are
    // told apart by which way they leave the bay.
    const identityMidpoint = vector(sign * (laneX + 3.8), 4.9, z - 1.4);
    const jacobianPosition = vector(sign * laneX, 4.2, z + 0.7);
    const mergePoint = vector(sign * (laneX - 3.2), 4.2, z - 3.2);
    const rackPosition = avenueAnchor({ stop, slot: side, row: -1 });
    const identityPath = [start, identityMidpoint, mergePoint];
    const transformedPath = [start, jacobianPosition, mergePoint];
    const depositPath = [
      jacobianPosition,
      vector(sign * (laneX + 1.4), 0.9, z - 0.4),
      rackPosition,
    ];
    const mergedPath =
      index === 3
        ? handoff(mergePoint, avenueAnchor({ stop: 6, slot: "centre", zShift: 2.6 }))
        : handoff(mergePoint, branchStarts[index + 1]);
    context.group.add(createPath(identityPath, warm, 0.045, 0.5));
    context.group.add(createPath(transformedPath, "#ff9b87", 0.045, 0.5));
    context.group.add(createPath(depositPath, amber, 0.038, 0.5));
    context.group.add(createPath(mergedPath, warm, 0.06, 0.58));
    const copyGlyph = place(
      context,
      createPanel(["RESIDUAL ADD BACKWARD", "copy g -> skip | transform"], {
        width: 4.5,
        height: 1.3,
        color: warm,
        borderColor: warm,
        fontScale: 0.62,
      }),
      { stop, slot: side, row: 1 },
    );
    const jacobian = place(
      context,
      createPanel(jacobianNames[index], {
        width: 4.6,
        height: 1.3,
        color: "#ffd4ca",
        borderColor: warm,
        fontScale: 0.6,
      }),
      { stop, slot: side, row: 0.5, zShift: 0.7 },
    );
    const plusGlyph = place(context, createGlyph("+", warm, 1.5), {
      stop,
      slot: side,
      row: 0.5,
      xShift: -3.2,
      zShift: -3.2,
    });
    const identity = createPacket(warm, 0.2);
    const transformed = createPacket("#ff9b87", 0.2);
    const deposit = createPacket(amber, 0.16);
    const merged = createPacket(warm, 0.22);
    context.group.add(identity, transformed, deposit, merged);
    branchPackets.push({ identity, transformed, deposit, merged });
    branchPaths.push({
      identity: identityPath,
      transformed: transformedPath,
      deposit: depositPath,
      merged: mergedPath,
    });
    branchStageObjects.push({ copy: copyGlyph, jacobian, plus: plusGlyph });
    place(
      context,
      createPanel([rackNames[index], "parameter gradient"], {
        width: 4.8,
        height: 1.25,
        color: amber,
        borderColor: amber,
        fontScale: 0.62,
      }),
      { stop, slot: side, row: -1 },
    );
  });
  context.group.add(
    createPath(
      handoff(finalNormBackward.position.clone(), branchStarts[0]),
      warm,
      0.05,
      0.5,
    ),
  );

  const outputBoard = place(
    context,
    createValueBoard(Array.from({ length: 8 }, () => "."), 1, 8, {
      width: 7.4,
      cellHeight: 0.82,
      title: "dH0 EXITS TO EMBEDDINGS",
      subtitle: "all dW racks have accumulated",
      color: warm,
      unknownIndices: Array.from({ length: 8 }, (_, index) => index),
    }),
    { stop: 6, slot: "centre" },
  );
  const noUpdatePanel = place(
    context,
    createPanel(["GRADIENTS COLLECTED", "NO WEIGHTS MOVED"], {
      width: 5.8,
      height: 1.45,
      color: amber,
      borderColor: amber,
      fontScale: 0.72,
    }),
    { stop: 6, slot: "left" },
  );

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    setObjectOpacity(inputBoard, 1 - smoothStep(p, 0.08, 0.24) * 0.68);
    setObjectOpacity(finalNormBackward, Math.max(smoothStep(p, 0, 0.035), 1 - smoothStep(p, 0.12, 0.26) * 0.72));
    setObjectOpacity(finalNormRack, smoothStep(p, 0.02, 0.08) * (0.4 + windowPulse(p, 0.02, 0.06, 0.16) * 0.6));
    branchPackets.forEach((packets, index) => {
      const start = 0.04 + index * 0.205;
      const branchEnd = start + 0.13;
      const mergeEnd = start + 0.2;
      const branchProgress = smoothStep(p, start, branchEnd);
      samplePath(packets.identity, branchPaths[index].identity, branchProgress, 0.14);
      samplePath(packets.transformed, branchPaths[index].transformed, branchProgress, 0.14);
      samplePath(
        packets.deposit,
        branchPaths[index].deposit,
        smoothStep(p, start + 0.045, start + 0.17),
        0.12,
      );
      samplePath(
        packets.merged,
        branchPaths[index].merged,
        smoothStep(p, branchEnd - 0.01, mergeEnd),
        0.08,
      );
      setObjectOpacity(packets.identity, windowPulse(p, start - 0.015, start + 0.055, branchEnd + 0.015));
      setObjectOpacity(packets.transformed, windowPulse(p, start - 0.015, start + 0.065, branchEnd + 0.015));
      setObjectOpacity(packets.deposit, windowPulse(p, start + 0.025, start + 0.095, start + 0.18));
      setObjectOpacity(packets.merged, windowPulse(p, branchEnd - 0.025, branchEnd + 0.025, mergeEnd + 0.02));
      setObjectOpacity(branchStageObjects[index].copy, windowPulse(p, start - 0.025, start + 0.035, start + 0.1));
      setObjectOpacity(branchStageObjects[index].jacobian, windowPulse(p, start + 0.015, start + 0.075, branchEnd + 0.035));
      setObjectOpacity(branchStageObjects[index].plus, windowPulse(p, start + 0.07, branchEnd, mergeEnd + 0.015));
      if (motionEnabled) {
        packets.identity.rotation.y = elapsed;
        packets.transformed.rotation.y = -elapsed;
        packets.merged.rotation.y = elapsed * 0.8;
      }
    });
    setObjectOpacity(outputBoard, smoothStep(p, 0.82, 0.96));
    setObjectOpacity(noUpdatePanel, smoothStep(p, 0.86, 0.98));
  };
  return finishBuilder(updater);
}

/**
 * WQ Matrix Microscope, laid out as a walkable avenue.
 *
 * The twelve position contributions stream in under the entrance arch, the
 * addressed matrix stands alone in the left bay so the lit cell can be found
 * from the runway, and the two registers face it from the right. The gradient
 * register is shown twice — accumulating, then settled — at different stops, so
 * the change of state is a step along the walk rather than a swap in place.
 */
function buildParameterMatrixProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const warm = "#ff765f";
  const amber = "#ffd166";
  const matrixWidth = 8.6;
  const matrixCellHeight = 0.56;
  const matrixHeight = 0.72 + 8 * matrixCellHeight + 0.5 + 0.34;
  addHeader(context, ["WQ MATRIX MICROSCOPE", "ADDRESS [3,6] | ACCUMULATE 12 CONTRIBUTIONS"], amber);
  const values = Array.from({ length: 64 }, () => "." as string);
  values[SELECTED_CELL_INDEX] = "0.0174";
  const unknown = Array.from({ length: 64 }, (_, index) => index).filter(
    (index) => index !== SELECTED_CELL_INDEX,
  );
  const matrixBoard = place(
    context,
    createValueBoard(values, 8, 8, {
      width: matrixWidth,
      cellHeight: matrixCellHeight,
      title: "block.0.attention.WQ [8 x 8]",
      subtitle: "unknown cells remain neutral dots",
      color: context.palette.phaseBase,
      accent: amber,
      highlightedIndices: [SELECTED_CELL_INDEX],
      unknownIndices: unknown,
      fontScale: 0.92,
    }),
    { stop: 1, slot: "left", xShift: 1.0 },
  );
  // The sighting rig rides on the board itself, so it keeps pointing at cell
  // [3,6] whatever angle the bay is hung at.
  const cellX = -matrixWidth / 2 + 6.5 * (matrixWidth / 8);
  const cellY = matrixHeight / 2 - 0.72 - 3.5 * matrixCellHeight;
  const rowLaser = new THREE.Mesh(
    new THREE.BoxGeometry(matrixWidth, 0.07, 0.07),
    createProcessMaterial(amber, 1.2, 0.8),
  );
  rowLaser.position.set(0, cellY, 0.3);
  const columnLaser = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, matrixHeight - 1.0, 0.07),
    createProcessMaterial(amber, 1.2, 0.8),
  );
  columnLaser.position.set(cellX, cellY, 0.3);
  const selector = makeRing(amber, 0.62, 0.08);
  selector.position.set(cellX, cellY, 0.36);
  matrixBoard.add(rowLaser, columnLaser, selector);

  const weightPanel = place(
    context,
    createPanel(["WEIGHT REGISTER", "w = +0.017400"], {
      width: 4.9,
      height: 1.55,
      color: amber,
      borderColor: amber,
      fontScale: 0.72,
    }),
    { stop: 2, slot: "right" },
  );
  const accumulatingPanel = place(
    context,
    createPanel(["GRADIENT REGISTER", "SUM 12 CONTRIBUTIONS"], {
      width: 5.3,
      height: 1.55,
      color: warm,
      borderColor: warm,
      fontScale: 0.68,
    }),
    { stop: 3, slot: "left" },
  );
  const finalGradientPanel = place(
    context,
    createPanel(["GRADIENT REGISTER", "g = -0.003100"], {
      width: 5.3,
      height: 1.55,
      color: warm,
      borderColor: warm,
      fontScale: 0.72,
    }),
    { stop: 4, slot: "right" },
  );
  const lockPanel = place(
    context,
    createPanel(["LOCKED", "NO UPDATE YET"], {
      width: 4.6,
      height: 1.45,
      color: "#dceaff",
      borderColor: amber,
      fontScale: 0.74,
    }),
    { stop: 4, slot: "centre" },
  );
  place(
    context,
    createPanel(["(b,t) CONTRIBUTIONS", "INDIVIDUAL VALUES UNKNOWN"], {
      width: 6.4,
      height: 1.4,
      color: warm,
      borderColor: warm,
      fontScale: 0.66,
    }),
    { stop: 0, slot: "centre" },
  );
  const contributionPackets: THREE.Object3D[] = [];
  const contributionRoutes: THREE.Vector3[][] = [];
  const contributionEnd = accumulatingPanel.position
    .clone()
    .add(vector(0.9, -1.1, 0.7));
  for (let index = 0; index < 12; index += 1) {
    const row = Math.floor(index / 6);
    const column = index % 6;
    // The twelve contributions arrive overhead and only drop into the lane once
    // they are past the walkway.
    const route = [
      vector((column - 2.5) * 1.5, 4.7 + row * 0.9, avenueZ(0) - 1.4),
      vector(-6.2, 4.5 + row * 0.3, avenueZ(1) - 1.0),
      contributionEnd,
    ];
    contributionRoutes.push(route);
    const packet = createPacket(warm, 0.16);
    packet.position.copy(route[0]);
    context.group.add(packet);
    contributionPackets.push(packet);
    context.group.add(createPath(route, warm, 0.025, 0.18));
  }

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    setObjectOpacity(matrixBoard, 0.72 + smoothStep(p, 0, 0.14) * 0.28);
    setObjectOpacity(rowLaser, windowPulse(p, 0, 0.13, 0.34));
    setObjectOpacity(columnLaser, windowPulse(p, 0.04, 0.17, 0.38));
    setObjectOpacity(selector, smoothStep(p, 0.1, 0.24));
    selector.rotation.z = motionEnabled ? elapsed * 0.75 : 0;
    contributionPackets.forEach((packet, index) => {
      const start = 0.18 + index * 0.025;
      const end = start + 0.25;
      samplePath(packet, contributionRoutes[index], smoothStep(p, start, end), 0.3);
      setObjectOpacity(packet, windowPulse(p, start - 0.03, start + 0.1, end + 0.05));
    });
    setObjectOpacity(accumulatingPanel, 1 - smoothStep(p, 0.62, 0.76));
    setObjectOpacity(finalGradientPanel, smoothStep(p, 0.62, 0.76));
    setObjectOpacity(weightPanel, smoothStep(p, 0.08, 0.2));
    setObjectOpacity(lockPanel, smoothStep(p, 0.72, 0.88));
  };
  return finishBuilder(updater);
}

/**
 * AdamW Assembly Line, laid out as a walkable avenue.
 *
 * The optimiser's inputs hang over the threshold, the clip check stands aside
 * from the line proper, and then the two moments run down opposite lanes in
 * step — first raw, then bias-corrected — because they are computed from the
 * same gradient at the same instant. They combine into the normalised step, the
 * Adam and decay terms take one lane each, and their sum closes the walk.
 */
function buildAdamWProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const green = "#b8ff75";
  const warm = "#ff765f";
  const amber = "#ffd166";
  addHeader(context, ["ADAMW ASSEMBLY LINE", "MOMENTS -> BIAS CORRECTION -> STEP + DECAY"], green);

  const input = place(
    context,
    createPanel([
      "g=-0.0031 | m0=0 | v0=0",
      "beta1=.9 | beta2=.999 | eps=1e-8",
      "eta=.001 | lambda=.01 | w=.0174",
    ], {
      width: 7.4,
      height: 2.3,
      color: "#f4fbff",
      borderColor: green,
      fontScale: 0.65,
    }),
    { stop: 0, slot: "left", xShift: 0.6 },
  );
  const clipCheck = place(
    context,
    createPanel(["GLOBAL-NORM CLIP CHECK", "|g| under threshold -> unchanged", "(real runs clip before Adam)"], {
      width: 5.9,
      height: 1.9,
      color: "#f4fbff",
      borderColor: warm,
      fontScale: 0.6,
    }),
    { stop: 1, slot: "left", row: 1 },
  );
  // The first and second moments are computed from the same gradient at the
  // same instant, so they face each other across the runway and stay abreast
  // through the bias correction one stop later.
  const moment = place(
    context,
    createPanel(["m1=.9m0+.1g", "m1=-0.00031"], {
      width: 5.2,
      height: 1.6,
      color: warm,
      borderColor: warm,
      fontScale: 0.72,
    }),
    { stop: 2, slot: "left" },
  );
  const variance = place(
    context,
    createPanel(["v1=.999v0+.001g^2", "v1=9.61e-9"], {
      width: 5.2,
      height: 1.6,
      color: amber,
      borderColor: amber,
      fontScale: 0.68,
    }),
    { stop: 2, slot: "right" },
  );
  const correctedMoment = place(
    context,
    createPanel(["m_hat=m1/(1-beta1)", "m_hat=-0.0031"], {
      width: 5.2,
      height: 1.55,
      color: warm,
      borderColor: warm,
      fontScale: 0.68,
    }),
    { stop: 3, slot: "left", row: 1 },
  );
  const correctedVariance = place(
    context,
    createPanel(["v_hat=v1/(1-beta2)", "v_hat=9.61e-6"], {
      width: 5.2,
      height: 1.55,
      color: amber,
      borderColor: amber,
      fontScale: 0.68,
    }),
    { stop: 3, slot: "right", row: 1 },
  );
  const normalized = place(
    context,
    createPanel(["m_hat/(sqrt(v_hat)+eps)", "= -0.999996774"], {
      width: 6.2,
      height: 1.6,
      color: "#f4fbff",
      borderColor: green,
      fontScale: 0.68,
    }),
    { stop: 4, slot: "left" },
  );
  const adamComponent = place(
    context,
    createPanel(["-eta x normalized", "+0.000999996774"], {
      width: 5.4,
      height: 1.55,
      color: green,
      borderColor: green,
      fontScale: 0.7,
    }),
    { stop: 5, slot: "left", row: 1 },
  );
  const decayComponent = place(
    context,
    createPanel(["-eta x lambda x w", "-0.000000174"], {
      width: 5.4,
      height: 1.55,
      color: amber,
      borderColor: amber,
      fontScale: 0.7,
    }),
    { stop: 5, slot: "right", row: 1 },
  );
  // The junction stands at the runway edge, clear of the DELTA arch it feeds,
  // so neither hides the other on the way out.
  const plus = place(context, createGlyph("+", green, 1.9), {
    stop: 5,
    slot: "left",
    row: 0.5,
    xShift: -3.6,
  });
  const delta = place(
    context,
    createPanel(["DELTA w", "+0.000999822774"], {
      width: 5.6,
      height: 1.7,
      color: green,
      borderColor: green,
      fontScale: 0.78,
    }),
    { stop: 5, slot: "centre", zShift: -3.4 },
  );
  // The second-moment stream has to change sides twice; both crossings happen
  // at arch height so the walkway underneath stays clear.
  const varianceFeed = [
    input.position.clone(),
    vector(-4.6, 5.4, avenueZ(0.6)),
    vector(0, AVENUE.archY, avenueZ(1.0)),
    vector(4.6, 5.4, avenueZ(1.4)),
    variance.position.clone(),
  ];
  const varianceReturn = [
    variance.position.clone(),
    correctedVariance.position.clone(),
    vector(4.6, AVENUE.archY, avenueZ(3.7)),
    vector(-4.6, AVENUE.archY, avenueZ(3.95)),
    normalized.position.clone(),
  ];
  const paths = [
    createPath(avenueRoute(input.position, moment.position, 1.0), warm, 0.045, 0.35),
    createPath(varianceFeed, amber, 0.045, 0.35),
    createPath([moment.position, correctedMoment.position, normalized.position], warm, 0.045, 0.35),
    createPath(varianceReturn, amber, 0.045, 0.35),
    createPath([normalized.position, adamComponent.position, plus.position, delta.position], green, 0.05, 0.4),
    // Weight decay reads the same register but skips the moment machinery, so
    // it crosses to the far lane at the same arch and runs the length of it.
    createPath(
      [
        input.position,
        vector(-4.8, 4.9, avenueZ(0.5)),
        vector(0, AVENUE.archY + 0.8, avenueZ(0.9)),
        vector(5.2, 5.8, avenueZ(1.3)),
        decayComponent.position,
        plus.position,
        delta.position,
      ],
      amber,
      0.035,
      0.28,
    ),
  ];
  context.group.add(...paths);
  const packets = [createPacket(warm, 0.15), createPacket(amber, 0.15), createPacket(green, 0.17)];
  context.group.add(...packets);

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    setObjectOpacity(input, 1);
    setObjectOpacity(clipCheck, Math.max(smoothStep(p, 0.02, 0.1), 0.34) * (1 - smoothStep(p, 0.5, 0.68) * 0.66));
    setObjectOpacity(moment, smoothStep(p, 0.14, 0.3));
    setObjectOpacity(variance, smoothStep(p, 0.14, 0.3));
    setObjectOpacity(correctedMoment, smoothStep(p, 0.3, 0.48));
    setObjectOpacity(correctedVariance, smoothStep(p, 0.3, 0.48));
    setObjectOpacity(normalized, smoothStep(p, 0.48, 0.66));
    setObjectOpacity(adamComponent, smoothStep(p, 0.64, 0.8));
    setObjectOpacity(decayComponent, smoothStep(p, 0.64, 0.8));
    setObjectOpacity(plus, smoothStep(p, 0.72, 0.86));
    setObjectOpacity(delta, smoothStep(p, 0.82, 0.96));
    samplePath(packets[0], [input.position, moment.position, correctedMoment.position, normalized.position], smoothStep(p, 0.08, 0.64), 0.28);
    samplePath(
      packets[1],
      [...varianceFeed, ...varianceReturn.slice(1)],
      smoothStep(p, 0.08, 0.64),
      0.28,
    );
    samplePath(packets[2], [normalized.position, adamComponent.position, plus.position, delta.position], smoothStep(p, 0.62, 0.94), 0.24);
    packets.forEach((packet, index) => {
      setObjectOpacity(packet, windowPulse(p, 0.05 + index * 0.26, 0.3 + index * 0.28, 0.72 + index * 0.13));
      if (motionEnabled) packet.rotation.y = elapsed * (index % 2 ? -1 : 1);
    });
    const pulse = windowPulse(p, 0.84, 0.94, 1);
    delta.scale.setScalar(1 + pulse * (motionEnabled ? 0.08 + Math.sin(elapsed * 5) * 0.025 : 0.05));
  };
  return finishBuilder(updater);
}

/**
 * Precision Update Bench, laid out as a walkable avenue.
 *
 * The stored weight and the computed step are two independent quantities, so
 * they open the walk facing each other and rise together into the plus arch.
 * The updated value stands on the right, the plaque that insists nothing moved
 * until now hangs above the left lane, and the matrix before and after the
 * write face each other at the last stop — the change is read by turning the
 * head, not by watching one board swap for another in place.
 */
function buildWeightUpdateProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const green = "#b8ff75";
  const amber = "#ffd166";
  addHeader(context, ["PRECISION UPDATE BENCH", "w + DELTA w = w'"], green);
  const oldTile = place(
    context,
    createPanel(["w", "0.017400000000"], {
      width: 5.0,
      height: 1.75,
      color: amber,
      borderColor: amber,
      fontScale: 0.78,
    }),
    { stop: 0, slot: "left" },
  );
  const deltaTile = place(
    context,
    createPanel(["DELTA w", "+0.000999822774"], {
      width: 5.0,
      height: 1.75,
      color: green,
      borderColor: green,
      fontScale: 0.75,
    }),
    { stop: 0, slot: "right" },
  );
  const oldStart = oldTile.position.clone();
  const deltaStart = deltaTile.position.clone();
  const oldYaw = oldTile.rotation.y;
  const deltaYaw = deltaTile.rotation.y;
  const plus = place(context, createGlyph("+", green, 2.0), {
    stop: 1,
    slot: "centre",
  });
  const oldMeet = plus.position.clone().add(vector(-3.6, -0.5, 1.8));
  const deltaMeet = plus.position.clone().add(vector(3.6, -0.5, 1.8));
  const resultTile = place(
    context,
    createPanel(["w'", "0.018399822774"], {
      width: 5.1,
      height: 1.75,
      color: green,
      borderColor: green,
      fontScale: 0.78,
    }),
    { stop: 2, slot: "right" },
  );
  const equals = place(context, createGlyph("=", green, 2.0), {
    stop: 2,
    slot: "right",
    xShift: -3.0,
    zShift: 2.6,
  });
  context.group.add(createPath(avenueRoute(oldStart, oldMeet, 0.8), amber, 0.045, 0.34));
  context.group.add(createPath(avenueRoute(deltaStart, deltaMeet, 0.8), green, 0.045, 0.34));

  const matrixValuesBefore = Array.from({ length: 64 }, () => "." as string);
  const matrixValuesAfter = [...matrixValuesBefore];
  matrixValuesBefore[SELECTED_CELL_INDEX] = "0.017400000000";
  matrixValuesAfter[SELECTED_CELL_INDEX] = "0.018399822774";
  const unknown = Array.from({ length: 64 }, (_, index) => index).filter(
    (index) => index !== SELECTED_CELL_INDEX,
  );
  const updateBoardWidth = 7.6;
  const updateBoardCellHeight = 0.46;
  const updateBoardHeight = 0.72 + 8 * updateBoardCellHeight + 0.5 + 0.34;
  const boardOptions = {
    width: updateBoardWidth,
    cellHeight: updateBoardCellHeight,
    title: "WQ [8 x 8] | CELL [3,6]",
    subtitle: "only the selected trace cell is numeric",
    color: context.palette.phaseBase,
    accent: green,
    highlightedIndices: [SELECTED_CELL_INDEX],
    unknownIndices: unknown,
    fontScale: 0.82,
  };
  const beforeBoard = place(
    context,
    createValueBoard(matrixValuesBefore, 8, 8, boardOptions),
    { stop: 4, slot: "left" },
  );
  const afterBoard = place(
    context,
    createValueBoard(matrixValuesAfter, 8, 8, boardOptions),
    { stop: 4, slot: "right" },
  );
  const selectedCellPosition = afterBoard.localToWorld(
    vector(
      -updateBoardWidth / 2 + 6.5 * (updateBoardWidth / 8),
      updateBoardHeight / 2 - 0.72 - 3.5 * updateBoardCellHeight,
      0.36,
    ),
  );
  // The write travels down the right lane it was computed in, so nothing about
  // the update crosses the walkway.
  const insertionRoute = [
    resultTile.position.clone(),
    resultTile.position.clone().lerp(selectedCellPosition, 0.5).add(vector(1.6, 1.2, 0)),
    selectedCellPosition.clone(),
  ];
  context.group.add(
    createPath([equals.position, ...insertionRoute], green, 0.055, 0.38),
  );
  const insertionPacket = addAt(context, createPacket(green, 0.22), resultTile.position.clone());
  const updateRing = addAt(context, makeRing(green, 0.72, 0.075), selectedCellPosition.clone());
  updateRing.rotation.y = afterBoard.rotation.y;
  const onlyNow = place(
    context,
    createPanel(["ONLY NOW", "THE STORED PARAMETER CHANGES"], {
      width: 6.2,
      height: 1.5,
      color: green,
      borderColor: green,
      fontScale: 0.7,
    }),
    { stop: 3, slot: "left", row: 1 },
  );

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const converge = smoothStep(p, 0.16, 0.48);
    moveObject(oldTile, oldStart, oldMeet, converge, 0.18);
    moveObject(deltaTile, deltaStart, deltaMeet, converge, 0.18);
    // Both operands square up to the runway as they rise, so the addition is
    // read face-on from underneath.
    oldTile.rotation.y = oldYaw * (1 - converge);
    deltaTile.rotation.y = deltaYaw * (1 - converge);
    const operandOpacity = 1 - smoothStep(p, 0.48, 0.62);
    setObjectOpacity(oldTile, operandOpacity);
    setObjectOpacity(deltaTile, operandOpacity);
    setObjectOpacity(plus, windowPulse(p, 0.12, 0.46, 0.68));
    setObjectOpacity(equals, smoothStep(p, 0.48, 0.64));
    setObjectOpacity(resultTile, smoothStep(p, 0.56, 0.7));
    samplePath(insertionPacket, insertionRoute, smoothStep(p, 0.68, 0.88), 0.28);
    setObjectOpacity(insertionPacket, windowPulse(p, 0.64, 0.78, 0.94));
    const boardChange = smoothStep(p, 0.82, 0.92);
    setObjectOpacity(beforeBoard, 1 - boardChange);
    setObjectOpacity(afterBoard, boardChange);
    const ringPulse = windowPulse(p, 0.8, 0.9, 1);
    setObjectOpacity(updateRing, ringPulse);
    updateRing.scale.setScalar(1 + ringPulse * 0.42);
    updateRing.rotation.z = motionEnabled ? elapsed * 0.7 : 0;
    setObjectOpacity(onlyNow, smoothStep(p, 0.86, 0.98));
  };
  return finishBuilder(updater);
}

/**
 * Model Version Handoff, laid out as a walkable avenue.
 *
 * The old reading of the cell is taken at the entrance and the new one one stop
 * later on the far side, so the version change happens across the walk rather
 * than as a swap in place. The four-storey model stands in the left bay, the
 * draining gradient buffer and the surviving Adam state face each other over
 * the next two stops, and the gate onto the following step opens at the end.
 */
function buildNextStepProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const green = "#b8ff75";
  const warm = "#ff765f";
  addHeader(context, ["MODEL VERSION HANDOFF", "SAME ARCHITECTURE | NEW PARAMETER STATE"], green);

  const beforeReadout = place(
    context,
    createPanel(["theta0 SELECTED CELL", "WQ[3,6] = 0.0174"], {
      width: 5.6,
      height: 1.5,
      color: "#dceaff",
      borderColor: "#7f98aa",
      fontScale: 0.68,
    }),
    { stop: 0, slot: "left" },
  );
  const afterReadout = place(
    context,
    createPanel(["theta1 SELECTED CELL", "WQ[3,6] = 0.018399822774"], {
      width: 5.6,
      height: 1.5,
      color: green,
      borderColor: green,
      fontScale: 0.65,
    }),
    { stop: 1, slot: "right" },
  );

  // The model itself is a bay, not an obstacle: the four storeys stack up one
  // lane so the visitor reads them from the runway on the way past.
  const model = placeOnAvenue(new THREE.Group(), { stop: 2, slot: "left" });
  context.group.add(model);
  const thetaZero = new THREE.Group();
  const thetaOne = new THREE.Group();
  model.add(thetaZero, thetaOne);
  const oldMaterial = new THREE.MeshBasicMaterial({
    color: "#7f98aa",
    wireframe: true,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  const newMaterial = createProcessMaterial(green, 0.65, 0.58);
  const floorNames = ["EMBED", "BLOCK 0", "BLOCK 1", "OUTPUT"];
  floorNames.forEach((name, index) => {
    const y = -3.45 + index * 2.3;
    const oldFloor = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.28, 3.2), oldMaterial);
    const newFloor = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.28, 3.2), newMaterial);
    oldFloor.position.y = y;
    newFloor.position.y = y;
    thetaZero.add(oldFloor);
    thetaOne.add(newFloor);
    const label = createPanel([name], {
      width: 3.4,
      height: 0.85,
      color: "#f4fbff",
      borderColor: green,
      fontScale: 0.62,
      background: "rgba(3,8,16,0.76)",
    });
    label.position.set(0, y + 0.72, 1.75);
    model.add(label);
  });
  const parameterLights: THREE.Mesh[] = [];
  for (let index = 0; index < 16; index += 1) {
    const light = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.32, 0.15),
      createProcessMaterial(green, 1.4),
    );
    light.position.set(
      -3.6 + (index % 4 - 1.5) * 0.72,
      (Math.floor(index / 4) - 1.5) * 0.72,
      1.6,
    );
    model.add(light);
    parameterLights.push(light);
  }

  const gradientBuffers = new THREE.Group();
  gradientBuffers.position.copy(
    avenueAnchor({ stop: 3, slot: "right" }).add(vector(0, -2.8, 0.9)),
  );
  context.group.add(gradientBuffers);
  for (let index = 0; index < 12; index += 1) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.42, 0.42),
      createProcessMaterial(warm, 0.85),
    );
    box.position.set((index % 4 - 1.5) * 0.55, Math.floor(index / 4) * 0.55, 0);
    gradientBuffers.add(box);
  }
  place(
    context,
    createPanel(["GRAD BUFFER", "clears -> 0"], {
      width: 4.8,
      height: 1.4,
      color: warm,
      borderColor: warm,
      fontScale: 0.7,
    }),
    { stop: 3, slot: "right" },
  );
  const memoryPanel = place(
    context,
    createPanel(["ADAM STATE PERSISTS", "m1=-0.00031", "v1=9.61e-9"], {
      width: 5.2,
      height: 1.95,
      color: green,
      borderColor: green,
      fontScale: 0.68,
    }),
    { stop: 4, slot: "left" },
  );
  const postTrainingPlaque = place(
    context,
    createPanel([
      "THIS WORLD = ONE PRETRAINING STEP",
      "repeat a very large number of times,",
      "then: evaluation -> SFT -> RLHF post-training",
    ], {
      width: 8.2,
      height: 2.1,
      color: "#dceaff",
      borderColor: green,
      fontScale: 0.6,
    }),
    { stop: 4, slot: "right", row: 1 },
  );
  const nextBatch = place(
    context,
    createValueBoard(Array.from({ length: 12 }, () => "."), 2, 6, {
      width: 7.2,
      cellHeight: 0.68,
      title: "NEXT BATCH [2 x 6]",
      subtitle: "IDs not specified in this trace",
      color: context.palette.phaseBase,
      unknownIndices: Array.from({ length: 12 }, (_, index) => index),
    }),
    { stop: 5, slot: "right" },
  );
  const batchStart = nextBatch.position.clone();
  const batchEnd = avenueAnchor({ stop: 5, slot: "right", zShift: -4.6 });
  const routePanel = place(
    context,
    createPanel(["batch1 -> forward -> loss", "-> backward -> update"], {
      width: 7.4,
      height: 1.45,
      color: context.palette.phaseBase,
      borderColor: green,
      fontScale: 0.67,
    }),
    { stop: 5, slot: "centre" },
  );
  // The gate leaves stand at the runway edge and slide outward, so the visitor
  // walks between them rather than around them.
  const gateZ = avenueZ(5.4);
  const leftDoor = addAt(context, makeDeck(vector(1.4, 3.4, 0.25), green, 0.46), vector(-4.5, -0.65, gateZ));
  const rightDoor = addAt(context, makeDeck(vector(1.4, 3.4, 0.25), green, 0.46), vector(4.5, -0.65, gateZ));

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const versionChange = smoothStep(p, 0.16, 0.42);
    setObjectOpacity(thetaZero, 1 - versionChange * 0.72);
    setObjectOpacity(thetaOne, 0.08 + versionChange * 0.92);
    setObjectOpacity(beforeReadout, 1 - versionChange);
    setObjectOpacity(afterReadout, versionChange);
    parameterLights.forEach((light, index) => {
      const pulse = windowPulse(p, 0.18 + index * 0.01, 0.25 + index * 0.008, 0.44 + index * 0.004);
      light.scale.setScalar(0.7 + pulse * 0.72);
      setObjectOpacity(light, 0.18 + versionChange * 0.45 + pulse * 0.37);
    });
    const drain = smoothStep(p, 0.42, 0.6);
    gradientBuffers.scale.y = Math.max(0.05, 1 - drain * 0.95);
    setObjectOpacity(gradientBuffers, 1 - drain * 0.92);
    setObjectOpacity(memoryPanel, 0.7 + versionChange * 0.3);
    if (motionEnabled) {
      memoryPanel.scale.setScalar(1 + Math.sin(elapsed * 2.5) * 0.015);
    } else {
      memoryPanel.scale.setScalar(1);
    }
    const batchTravel = smoothStep(p, 0.58, 0.84);
    moveObject(nextBatch, batchStart, batchEnd, batchTravel, 0.25);
    setObjectOpacity(nextBatch, smoothStep(p, 0.52, 0.64));
    const gateOpen = smoothStep(p, 0.7, 0.86);
    leftDoor.position.x = THREE.MathUtils.lerp(-4.5, -7.6, gateOpen);
    rightDoor.position.x = THREE.MathUtils.lerp(4.5, 7.6, gateOpen);
    setObjectOpacity(routePanel, smoothStep(p, 0.82, 0.96));
    setObjectOpacity(postTrainingPlaque, smoothStep(p, 0.86, 0.97));
  };
  return finishBuilder(updater);
}

export function buildLearningProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater | undefined {
  switch (context.stationId) {
    case "logits":
      return buildLogitsProcess(context);
    case "target-comparison":
      return buildTargetComparisonProcess(context);
    case "loss":
      return buildLossProcess(context);
    case "output-backprop":
      return buildOutputBackpropProcess(context);
    case "backprop-through-tower":
      return buildBackpropTowerProcess(context);
    case "parameter-matrix":
      return buildParameterMatrixProcess(context);
    case "adamw-state":
      return buildAdamWProcess(context);
    case "weight-update":
      return buildWeightUpdateProcess(context);
    case "model-changed-next-step":
      return buildNextStepProcess(context);
    default:
      return undefined;
  }
}
