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

function addHeader(
  context: ChamberProcessContext,
  lines: readonly string[],
  color: THREE.ColorRepresentation,
) {
  return addAt(
    context,
    createPanel(lines, {
      width: 8.4,
      height: 1.08,
      color,
      borderColor: color,
      fontScale: 0.72,
    }),
    vector(0, 4.42, -0.35),
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

function buildLogitsProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const cyan = context.palette.phaseBase;
  const gold = "#ffd166";
  addHeader(context, ["SOFTMAX OBSERVATORY", "16 LOGITS NORMALIZE TOGETHER"], cyan);

  const rawBoard = addAt(
    context,
    createValueBoard(SELECTED_TRACE.output.selectedLogits, 4, 4, {
      width: 5.15,
      cellHeight: 0.48,
      title: "RAW LOGITS g[16]",
      subtitle: "signed scores - any real value",
      color: "#ff765f",
      accent: gold,
      highlightedIndices: [TARGET_INDEX],
    }),
    vector(-5.75, 1.48, 1.75),
  );
  rawBoard.name = "assistant-target-logits-raw-logits";
  const probabilityBoard = addAt(
    context,
    createValueBoard(SELECTED_TRACE.output.selectedProbabilities, 4, 4, {
      width: 5.15,
      cellHeight: 0.48,
      title: "PROBABILITIES p[16]",
      subtitle: "sat .28 | on .16 | sum 1.00",
      color: cyan,
      accent: gold,
      highlightedIndices: [TARGET_INDEX],
    }),
    vector(5.75, 1.48, -3.25),
  );
  probabilityBoard.name = "assistant-target-logits-probabilities";

  const center = vector(0, 0.35, -0.85);
  const outerRing = addAt(context, makeRing(cyan, 5.25), vector(0, -2.48, -0.85));
  outerRing.rotation.x = Math.PI / 2;
  const expRing = addAt(context, makeRing(cyan, 1.2, 0.13), center.clone());
  expRing.rotation.x = Math.PI / 2;
  expRing.name = "assistant-target-logits-softmax-operation";
  const expGlyph = addAt(context, createGlyph("exp", cyan, 1.5), center.clone().add(vector(0, 0.2, 0.15)));
  expGlyph.name = "assistant-target-logits-softmax-operation";
  const sumPanel = addAt(
    context,
    createPanel(["SUM exp(g_k) = 10.000 for this row", "p_k = exp(g_k) / SUM"], {
      width: 4.4,
      height: 1.2,
      color: "#f4fbff",
      borderColor: cyan,
      fontScale: 0.68,
    }),
    vector(0, 2.15, -0.85),
  );
  sumPanel.name = "assistant-target-logits-softmax-operation";

  const bars: Array<{
    mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
    material: THREE.MeshStandardMaterial;
    rawHeight: number;
    probabilityHeight: number;
    x: number;
    z: number;
  }> = [];
  const packets: THREE.Object3D[] = [];
  const packetStarts: THREE.Vector3[] = [];
  const packetEnds: THREE.Vector3[] = [];

  SELECTED_TRACE.output.selectedLogits.forEach((logit, index) => {
    const angle = (index / 16) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * 5.25;
    const z = -0.85 + Math.sin(angle) * 5.25;
    const rawHeight = 0.38 + (Math.abs(logit) / MAX_LOGIT_MAGNITUDE) * 1.85;
    const probabilityHeight = 0.28 + SELECTED_TRACE.output.selectedProbabilities[index] * 9.5;
    const material = createProcessMaterial(
      index === TARGET_INDEX ? gold : "#ff765f",
      index === TARGET_INDEX ? 1.5 : 0.85,
    );
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1, 0.34), material);
    mesh.position.set(x, 0.18 - rawHeight / 2, z);
    mesh.scale.y = rawHeight;
    mesh.name = "assistant-target-logits-distribution-bars";
    context.group.add(mesh);
    bars.push({ mesh, material, rawHeight, probabilityHeight, x, z });

    const packet = createPacket(index === TARGET_INDEX ? gold : cyan, 0.11);
    packetStarts.push(vector(x, 0.72, z));
    packetEnds.push(vector(x, -2.48 + probabilityHeight, z));
    context.group.add(packet);
    packets.push(packet);

    if (index % 2 === 0 || index === TARGET_INDEX) {
      addAt(
        context,
        createPanel([`${index} ${SELECTED_TRACE.vocabulary[index]}`], {
          width: 1.25,
          height: 0.42,
          color: index === TARGET_INDEX ? gold : "#dceaff",
          borderColor: index === TARGET_INDEX ? gold : cyan,
          fontScale: 0.62,
          background: "rgba(3,8,16,0.82)",
        }),
        vector(x, 1.05, z + 0.18),
      );
    }
    context.group.add(
      createPath([packetStarts[index], center, packetEnds[index]], cyan, 0.018, 0.1),
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
      const y = THREE.MathUtils.lerp(0.18 - height / 2, -2.48 + height / 2, morph);
      bar.mesh.position.set(bar.x, y, bar.z);
      bar.mesh.scale.set(1, height, 1);
      const from = new THREE.Color(index === TARGET_INDEX ? gold : "#ff765f");
      const to = new THREE.Color(index === TARGET_INDEX ? gold : cyan);
      bar.material.color.copy(from.lerp(to, morph));
      bar.material.emissive.copy(bar.material.color);

      const packet = packets[index];
      const inward = smoothStep(p, 0.16, 0.4);
      const outward = smoothStep(p, 0.54, 0.78);
      if (p < 0.52) {
        moveObject(packet, packetStarts[index], center, inward, 0.35);
      } else {
        moveObject(packet, center, packetEnds[index], outward, 0.35);
      }
      setObjectOpacity(packet, windowPulse(p, 0.12, 0.5, 0.86));
      packet.rotation.y = motionEnabled ? elapsed * (0.5 + index * 0.015) : 0;
    });
  };
  return finishBuilder(updater);
}

function buildTargetComparisonProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const cyan = context.palette.phaseBase;
  const gold = "#ffd166";
  addHeader(context, ["TARGET GATHER GANTRY", "THE ANSWER ARRIVES AFTER PREDICTION"], gold);

  const predictionBoard = addAt(
    context,
    createValueBoard(SELECTED_TRACE.output.selectedProbabilities, 4, 4, {
      width: 5.8,
      cellHeight: 0.52,
      title: "PREDICTION ROW p[16]",
      subtitle: "batch 0 | position 2 | cat predicts next",
      color: cyan,
      accent: gold,
      highlightedIndices: [TARGET_INDEX],
    }),
    vector(-4.9, 1.32, 1.7),
  );
  const targetStart = vector(7.4, 2.75, 6.25);
  const selectedCell = vector(-5.62, 1.62, 1.95);
  const targetTile = addAt(
    context,
    createPanel(["TARGET TRAY", "sat | ID 5"], {
      width: 2.45,
      height: 1.2,
      color: gold,
      borderColor: gold,
      fontScale: 0.78,
    }),
    targetStart,
  );
  context.group.add(
    createPath(
      [targetStart, vector(5, 3.25, 3.5), vector(0, 3, 2.2), selectedCell],
      gold,
      0.055,
      0.42,
    ),
  );
  const locator = addAt(context, makeRing(gold, 0.62, 0.075), selectedCell.clone());
  const gatheredPacket = addAt(context, createPacket(gold, 0.24), selectedCell.clone());
  const gatherDock = vector(0, 0.55, -1.25);
  const resultPosition = vector(4.8, 1.15, -4.65);
  context.group.add(
    createPath([selectedCell, gatherDock, resultPosition], gold, 0.07, 0.45),
  );
  const gatherPanel = addAt(
    context,
    createPanel(["GATHER ID 5", "p[sat] = 0.28"], {
      width: 3.2,
      height: 1.25,
      color: gold,
      borderColor: gold,
      fontScale: 0.78,
    }),
    vector(0, 1.9, -1.25),
  );
  const correctBoard = addAt(
    context,
    createValueBoard(SELECTED_TRACE.output.correctTokenProbabilities.flat(), 2, 6, {
      width: 6.2,
      cellHeight: 0.62,
      title: "P_CORRECT [2 x 6]",
      subtitle: "one gathered candidate per target",
      color: gold,
      accent: gold,
      highlightedIndices: [2],
    }),
    resultPosition,
  );
  const lateAnswerPanel = addAt(
    context,
    createPanel(["PREDICTIONS COMPLETE", "ANSWERS REMAIN OUTSIDE THE MODEL"], {
      width: 5.2,
      height: 1.1,
      color: "#dceaff",
      borderColor: cyan,
      fontScale: 0.68,
    }),
    vector(3.6, -1.85, 3.3),
  );

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    setObjectOpacity(predictionBoard, 0.52 + smoothStep(p, 0, 0.18) * 0.48);
    setObjectOpacity(lateAnswerPanel, 1 - smoothStep(p, 0.22, 0.42) * 0.68);
    samplePath(
      targetTile,
      [targetStart, vector(5, 3.25, 3.5), vector(0, 3, 2.2), selectedCell],
      smoothStep(p, 0.2, 0.48),
      0.18,
    );
    setObjectOpacity(targetTile, smoothStep(p, 0.16, 0.26));
    setObjectOpacity(locator, windowPulse(p, 0.4, 0.56, 0.82));
    locator.rotation.z = motionEnabled ? elapsed * 0.8 : 0;
    setObjectOpacity(gatherPanel, smoothStep(p, 0.5, 0.68));
    samplePath(
      gatheredPacket,
      [selectedCell, gatherDock, resultPosition],
      smoothStep(p, 0.56, 0.8),
      0.45,
    );
    setObjectOpacity(gatheredPacket, windowPulse(p, 0.52, 0.7, 0.86));
    setObjectOpacity(correctBoard, smoothStep(p, 0.72, 0.9));
  };
  return finishBuilder(updater);
}

function buildLossProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const gold = "#ffd166";
  const cyan = context.palette.phaseBase;
  addHeader(context, ["CROSS-ENTROPY FOUNDRY", "12 PROBABILITIES -> -ln -> MEAN"], gold);

  const probabilityBoard = addAt(
    context,
    createValueBoard(SELECTED_TRACE.output.correctTokenProbabilities.flat(), 2, 6, {
      width: 5.8,
      cellHeight: 0.58,
      title: "P_CORRECT [2 x 6]",
      subtitle: "one probability per supervised position",
      color: cyan,
      accent: gold,
      highlightedIndices: [2],
    }),
    vector(-5.15, 2.35, 3.25),
  );
  probabilityBoard.name = "assistant-target-loss-correct-probabilities";
  const lossBoard = addAt(
    context,
    createValueBoard(SELECTED_TRACE.output.perTokenLosses.flat(), 2, 6, {
      width: 5.8,
      cellHeight: 0.58,
      title: "TOKEN PENALTIES [2 x 6]",
      subtitle: "exact -ln(p_correct) values",
      color: gold,
      accent: gold,
      highlightedIndices: [2],
    }),
    vector(5.15, 2.35, -1.35),
  );
  lossBoard.name = "assistant-target-loss-token-penalties";
  const selectedEquation = addAt(
    context,
    createPanel(["SELECTED LANE", "0.28 -> -ln -> 1.272965676"], {
      width: 4.8,
      height: 1.15,
      color: gold,
      borderColor: gold,
      fontScale: 0.72,
    }),
    vector(0, 2.8, 1.1),
  );
  selectedEquation.name = "assistant-target-loss-selected-lane";

  const probabilityPackets: THREE.Object3D[] = [];
  const lossPackets: THREE.Object3D[] = [];
  const laneStarts: THREE.Vector3[] = [];
  const gatePositions: THREE.Vector3[] = [];
  const lossPositions: THREE.Vector3[] = [];
  const funnelPosition = vector(0, -0.9, -5.55);
  const gateMaterial = createProcessMaterial(gold, 0.75, 0.65);
  for (let index = 0; index < 12; index += 1) {
    const row = Math.floor(index / 6);
    const column = index % 6;
    const x = (column - 2.5) * 1.35;
    const y = -1.65 + row * 0.72;
    const start = vector(x, y, 4.85);
    const gate = vector(x, y + 0.1, 1.0);
    const output = vector(x, y, -2.35);
    laneStarts.push(start);
    gatePositions.push(gate);
    lossPositions.push(output);
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.055, 8, 28), gateMaterial);
    hoop.position.copy(gate);
    hoop.name = "assistant-target-loss-cross-entropy-gates";
    context.group.add(hoop);
    const inputPacket = createPacket(index === 2 ? gold : cyan, 0.14);
    inputPacket.position.copy(start);
    context.group.add(inputPacket);
    probabilityPackets.push(inputPacket);
    const lossPacket = createPacket(gold, 0.18);
    lossPacket.position.copy(gate);
    context.group.add(lossPacket);
    lossPackets.push(lossPacket);
    context.group.add(createPath([start, gate, output, funnelPosition], gold, 0.024, 0.17));
  }
  const minusLogLabel = addAt(
    context,
    createPanel(["12 INDEPENDENT -ln GATES"], {
      width: 4.2,
      height: 0.72,
      color: gold,
      borderColor: gold,
      fontScale: 0.7,
    }),
    vector(0, 0.15, 1.0),
  );
  minusLogLabel.name = "assistant-target-loss-cross-entropy-gates";
  const funnel = addAt(
    context,
    new THREE.Mesh(
      new THREE.CylinderGeometry(2.0, 0.68, 1.45, 24, 1, true),
      createProcessMaterial(gold, 0.85, 0.5),
    ),
    funnelPosition,
  );
  funnel.name = "assistant-target-loss-averaging";
  const divideGlyph = addAt(context, createGlyph("/ 12", gold, 1.5), vector(0, 1.05, -5.55));
  divideGlyph.name = "assistant-target-loss-averaging";
  const sumPanel = addAt(
    context,
    createPanel(["SUM 12 LOSSES ~= 17.131643", "MEAN = SUM / 12"], {
      width: 4.7,
      height: 1.15,
      color: gold,
      borderColor: gold,
      fontScale: 0.68,
    }),
    vector(0, 2.55, -5.55),
  );
  sumPanel.name = "assistant-target-loss-averaging";
  // The scalar result sits on the right flank instead of dead-center behind
  // the funnel and the /12 glyph, so it reads from the chamber entrance
  // without stepping to the side.
  const scalar = addAt(
    context,
    new THREE.Mesh(new THREE.IcosahedronGeometry(0.78, 2), createProcessMaterial(gold, 1.7)),
    vector(4.35, -0.35, -6.9),
  );
  scalar.name = "assistant-target-loss-scalar-loss";
  const scalarPanel = addAt(
    context,
    createPanel(["SCALAR LOSS", "L = 1.427636920"], {
      width: 3.7,
      height: 1.2,
      color: gold,
      borderColor: gold,
      fontScale: 0.78,
    }),
    vector(4.35, 1.1, -6.9),
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

  const pStart = vector(-5.2, 2.15, 4.65);
  const yStart = vector(5.2, 2.15, 4.65);
  const pBoard = addAt(
    context,
    createValueBoard(probabilities, 4, 4, {
      width: 5.2,
      cellHeight: 0.44,
      title: "p[16]",
      subtitle: "selected position",
      color: context.palette.phaseBase,
      accent: amber,
      highlightedIndices: [TARGET_INDEX],
    }),
    pStart,
  );
  const yBoard = addAt(
    context,
    createValueBoard(oneHot, 4, 4, {
      width: 5.2,
      cellHeight: 0.44,
      title: "one_hot(target=5)",
      subtitle: "1 only at sat",
      color: amber,
      accent: amber,
      highlightedIndices: [TARGET_INDEX],
    }),
    yStart,
  );
  const subtract = addAt(context, createGlyph("-", warm, 1.45), vector(0, 1.05, 2.55));
  const differenceBoard = addAt(
    context,
    createValueBoard(stringValues(difference, 3), 4, 4, {
      width: 5.8,
      cellHeight: 0.44,
      title: "p - one_hot(y)",
      subtitle: "sat becomes -0.720",
      color: warm,
      accent: amber,
      highlightedIndices: [TARGET_INDEX],
    }),
    vector(0, 1.55, 0.55),
  );
  const divide = addAt(context, createGlyph("/ 12", warm, 1.5), vector(0, -0.45, -1.25));
  const dGBoard = addAt(
    context,
    createValueBoard(stringValues(dG, 9), 4, 4, {
      width: 5.8,
      cellHeight: 0.44,
      title: "dG SELECTED SLICE",
      subtitle: "sat -.060000000 | on +.013333333 | sum 0",
      color: warm,
      accent: amber,
      highlightedIndices: [TARGET_INDEX, 6],
    }),
    vector(0, 1.15, -2.75),
  );
  const fork = vector(0, -1.25, -4.15);
  const leftResult = vector(-5.1, 0.55, -6.3);
  const rightResult = vector(5.1, 0.55, -6.3);
  const forkGlyph = addAt(context, createGlyph("COPY", warm, 1.45), fork.clone().add(vector(0, 1.15, 0)));
  const activationPacket = addAt(context, createPacket(warm, 0.22), fork.clone());
  const parameterPacket = addAt(context, createPacket(amber, 0.22), fork.clone());
  context.group.add(createPath([fork, vector(-2.2, -0.4, -5.1), leftResult], warm, 0.07, 0.48));
  context.group.add(createPath([fork, vector(2.2, -0.4, -5.1), rightResult], amber, 0.07, 0.48));
  const dHBoard = addAt(
    context,
    createValueBoard(Array.from({ length: 8 }, () => "."), 1, 8, {
      width: 5.0,
      cellHeight: 0.62,
      title: "dH = dG x W_vocab^T",
      subtitle: "dH [2 x 6 x 8] | values unknown",
      color: warm,
      unknownIndices: Array.from({ length: 8 }, (_, index) => index),
    }),
    leftResult,
  );
  const dWBoard = addAt(
    context,
    createValueBoard(Array.from({ length: 16 }, () => "."), 4, 4, {
      width: 5.0,
      cellHeight: 0.48,
      title: "dW = H^T x dG | 4 x 4 SLICE",
      subtitle: "rows 0:4, cols 0:4 of full dW_vocab [8 x 16]",
      color: amber,
      unknownIndices: Array.from({ length: 16 }, (_, index) => index),
    }),
    rightResult,
  );

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    moveObject(pBoard, pStart, vector(-2.9, 2.15, 2.75), smoothStep(p, 0.1, 0.3), 0);
    moveObject(yBoard, yStart, vector(2.9, 2.15, 2.75), smoothStep(p, 0.1, 0.3), 0);
    const operandsFade = 1 - smoothStep(p, 0.3, 0.44);
    setObjectOpacity(pBoard, operandsFade);
    setObjectOpacity(yBoard, operandsFade);
    setObjectOpacity(subtract, windowPulse(p, 0.08, 0.3, 0.48));
    setObjectOpacity(differenceBoard, windowPulse(p, 0.3, 0.46, 0.66));
    setObjectOpacity(divide, windowPulse(p, 0.42, 0.58, 0.72));
    setObjectOpacity(dGBoard, smoothStep(p, 0.52, 0.7));
    setObjectOpacity(forkGlyph, smoothStep(p, 0.64, 0.76));
    const forkTravel = smoothStep(p, 0.68, 0.88);
    samplePath(activationPacket, [fork, vector(-2.2, -0.4, -5.1), leftResult], forkTravel, 0.2);
    samplePath(parameterPacket, [fork, vector(2.2, -0.4, -5.1), rightResult], forkTravel, 0.2);
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

function buildBackpropTowerProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const warm = "#ff765f";
  const amber = "#ffd166";
  addHeader(context, ["TWO-BLOCK REVERSE CIRCUIT", "ADD COPIES dL | MATRIX OPS COLLECT dW"], warm);

  const blockOneDeck = addAt(context, makeDeck(vector(8.6, 0.2, 4.2), "#5d1f2b", 0.38), vector(0, 2.35, 0.9));
  const blockZeroDeck = addAt(context, makeDeck(vector(8.6, 0.2, 4.2), "#5d1f2b", 0.38), vector(0, -0.95, -1.75));
  void blockOneDeck;
  void blockZeroDeck;
  addAt(
    context,
    createPanel(["BLOCK 1 BACKWARD", "MLP ADD -> ATTENTION ADD"], {
      width: 3.8,
      height: 1.0,
      color: warm,
      borderColor: warm,
      fontScale: 0.65,
    }),
    vector(-6.4, 3.55, 0.9),
  );
  addAt(
    context,
    createPanel(["BLOCK 0 BACKWARD", "MLP ADD -> ATTENTION ADD"], {
      width: 3.8,
      height: 1.0,
      color: warm,
      borderColor: warm,
      fontScale: 0.65,
    }),
    vector(-6.4, 0.2, -1.75),
  );

  const centers = [
    vector(0, 3.55, 2.7),
    vector(0, 2.05, 1.35),
    vector(0, 0.55, 0),
    vector(0, -1.0, -1.45),
    vector(0, -2.65, -3.05),
  ];
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

  centers.slice(0, 4).forEach((start, index) => {
    const end = centers[index + 1];
    const middleY = (start.y + end.y) / 2;
    const middleZ = (start.z + end.z) / 2;
    const identityMidpoint = vector(-3.0, middleY, middleZ);
    const jacobianPosition = vector(3.0, middleY, middleZ);
    const mergePoint = vector(0, end.y + 0.32, end.z + 0.28);
    const identityPath = [start, identityMidpoint, mergePoint];
    const transformedPath = [start, jacobianPosition, mergePoint];
    const mergedPath = [mergePoint, end];
    const rackPosition = vector(7.0, middleY, middleZ - 0.55);
    const depositPath = [jacobianPosition, vector(5.0, middleY + 0.15, middleZ), rackPosition];
    context.group.add(createPath(identityPath, warm, 0.045, 0.5));
    context.group.add(createPath(transformedPath, "#ff9b87", 0.045, 0.5));
    context.group.add(createPath(depositPath, amber, 0.038, 0.5));
    context.group.add(createPath(mergedPath, warm, 0.06, 0.58));
    const copyGlyph = createPanel(["RESIDUAL ADD BACKWARD", "copy g -> skip | transform"], {
      width: 3.1,
      height: 0.86,
      color: warm,
      borderColor: warm,
      fontScale: 0.62,
    });
    copyGlyph.position.copy(start).add(vector(0, 0.45, 0));
    context.group.add(copyGlyph);
    const jacobian = createPanel(jacobianNames[index], {
      width: 3.15,
      height: 0.88,
      color: "#ffd4ca",
      borderColor: warm,
      fontScale: 0.6,
    });
    jacobian.position.copy(jacobianPosition).add(vector(0, 0.52, 0));
    context.group.add(jacobian);
    const plusGlyph = createGlyph("+", warm, 0.86);
    plusGlyph.position.copy(mergePoint);
    context.group.add(plusGlyph);
    const identity = createPacket(warm, 0.18);
    const transformed = createPacket("#ff9b87", 0.18);
    const deposit = createPacket(amber, 0.14);
    const merged = createPacket(warm, 0.2);
    context.group.add(identity, transformed, deposit, merged);
    branchPackets.push({ identity, transformed, deposit, merged });
    branchPaths.push({
      identity: identityPath,
      transformed: transformedPath,
      deposit: depositPath,
      merged: mergedPath,
    });
    branchStageObjects.push({ copy: copyGlyph, jacobian, plus: plusGlyph });
    addAt(
      context,
      createPanel([rackNames[index], "parameter gradient"], {
        width: 3.3,
        height: 0.82,
        color: amber,
        borderColor: amber,
        fontScale: 0.62,
      }),
      rackPosition,
    );
  });
  const inputBoard = addAt(
    context,
    createValueBoard(Array.from({ length: 8 }, () => "."), 1, 8, {
      width: 4.8,
      cellHeight: 0.56,
      title: "dH_final [2 x 6 x 8]",
      subtitle: "values not present in trace",
      color: warm,
      unknownIndices: Array.from({ length: 8 }, (_, index) => index),
    }),
    vector(0, 3.5, 5.25),
  );
  const finalNormBackward = addAt(
    context,
    createPanel(["LN_f BACKWARD FIRST", "dH2 = J_LNf^T x dH_final", "collects dgamma_f + dbeta_f"], {
      width: 4.1,
      height: 1.35,
      color: warm,
      borderColor: warm,
      fontScale: 0.62,
    }),
    vector(-5.35, 3.3, 4.1),
  );
  const finalNormRack = addAt(
    context,
    createPanel(["dLN_f", "parameter gradient"], {
      width: 3.3,
      height: 0.82,
      color: amber,
      borderColor: amber,
      fontScale: 0.62,
    }),
    vector(7.0, 4.2, 3.4),
  );
  const outputBoard = addAt(
    context,
    createValueBoard(Array.from({ length: 8 }, () => "."), 1, 8, {
      width: 4.8,
      cellHeight: 0.56,
      title: "dH0 EXITS TO EMBEDDINGS",
      subtitle: "all dW racks have accumulated",
      color: warm,
      unknownIndices: Array.from({ length: 8 }, (_, index) => index),
    }),
    vector(0, -2.25, -5.8),
  );
  const noUpdatePanel = addAt(
    context,
    createPanel(["GRADIENTS COLLECTED", "NO WEIGHTS MOVED"], {
      width: 4.3,
      height: 1.05,
      color: amber,
      borderColor: amber,
      fontScale: 0.72,
    }),
    vector(4.7, 3.65, -3.4),
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

function buildParameterMatrixProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const warm = "#ff765f";
  const amber = "#ffd166";
  const matrixWidth = 7.0;
  const matrixCellHeight = 0.43;
  const matrixPosition = vector(-2.0, 1.05, -2.65);
  const matrixHeight = 0.72 + 8 * matrixCellHeight + 0.5 + 0.34;
  const selectedPosition = vector(
    matrixPosition.x - matrixWidth / 2 + (6 + 0.5) * (matrixWidth / 8),
    matrixPosition.y + matrixHeight / 2 - 0.72 - (3 + 0.5) * matrixCellHeight,
    matrixPosition.z + 0.27,
  );
  addHeader(context, ["WQ MATRIX MICROSCOPE", "ADDRESS [3,6] | ACCUMULATE 12 CONTRIBUTIONS"], amber);
  const values = Array.from({ length: 64 }, () => "." as string);
  values[SELECTED_CELL_INDEX] = "0.0174";
  const unknown = Array.from({ length: 64 }, (_, index) => index).filter(
    (index) => index !== SELECTED_CELL_INDEX,
  );
  const matrixBoard = addAt(
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
    matrixPosition,
  );
  const rowLaser = addAt(
    context,
    new THREE.Mesh(new THREE.BoxGeometry(matrixWidth, 0.055, 0.055), createProcessMaterial(amber, 1.2, 0.8)),
    vector(matrixPosition.x, selectedPosition.y, selectedPosition.z),
  );
  const columnLaser = addAt(
    context,
    new THREE.Mesh(new THREE.BoxGeometry(0.055, 3.6, 0.055), createProcessMaterial(amber, 1.2, 0.8)),
    selectedPosition,
  );
  const selector = addAt(context, makeRing(amber, 0.52, 0.065), selectedPosition.clone());
  const weightPanel = addAt(
    context,
    createPanel(["WEIGHT REGISTER", "w = +0.017400"], {
      width: 3.5,
      height: 1.1,
      color: amber,
      borderColor: amber,
      fontScale: 0.72,
    }),
    vector(5.55, 2.55, -2.8),
  );
  const accumulatingPanel = addAt(
    context,
    createPanel(["GRADIENT REGISTER", "SUM 12 CONTRIBUTIONS"], {
      width: 3.8,
      height: 1.1,
      color: warm,
      borderColor: warm,
      fontScale: 0.68,
    }),
    vector(5.55, 0.55, -2.8),
  );
  const finalGradientPanel = addAt(
    context,
    createPanel(["GRADIENT REGISTER", "g = -0.003100"], {
      width: 3.8,
      height: 1.1,
      color: warm,
      borderColor: warm,
      fontScale: 0.72,
    }),
    vector(5.55, 0.55, -2.75),
  );
  const lockPanel = addAt(
    context,
    createPanel(["LOCKED", "NO UPDATE YET"], {
      width: 3.2,
      height: 1.0,
      color: "#dceaff",
      borderColor: amber,
      fontScale: 0.74,
    }),
    vector(5.55, -1.35, -2.8),
  );
  const contributionPackets: THREE.Object3D[] = [];
  const contributionStarts: THREE.Vector3[] = [];
  const contributionEnd = vector(5.55, -0.55, -2.55);
  for (let index = 0; index < 12; index += 1) {
    const row = Math.floor(index / 6);
    const column = index % 6;
    const start = vector((column - 2.5) * 1.25, -1.8 + row * 0.72, 5.7);
    contributionStarts.push(start);
    const packet = createPacket(warm, 0.13);
    packet.position.copy(start);
    context.group.add(packet);
    contributionPackets.push(packet);
    context.group.add(createPath([start, vector(2.8, -0.6 + row * 0.3, 1.2), contributionEnd], warm, 0.025, 0.18));
  }
  addAt(
    context,
    createPanel(["(b,t) CONTRIBUTIONS", "INDIVIDUAL VALUES UNKNOWN"], {
      width: 4.6,
      height: 1.0,
      color: warm,
      borderColor: warm,
      fontScale: 0.66,
    }),
    vector(0, -0.55, 4.8),
  );

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
      moveObject(packet, contributionStarts[index], contributionEnd, smoothStep(p, start, end), 0.45);
      setObjectOpacity(packet, windowPulse(p, start - 0.03, start + 0.1, end + 0.05));
    });
    setObjectOpacity(accumulatingPanel, 1 - smoothStep(p, 0.62, 0.76));
    setObjectOpacity(finalGradientPanel, smoothStep(p, 0.62, 0.76));
    setObjectOpacity(weightPanel, smoothStep(p, 0.08, 0.2));
    setObjectOpacity(lockPanel, smoothStep(p, 0.72, 0.88));
  };
  return finishBuilder(updater);
}

function buildAdamWProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const green = "#b8ff75";
  const warm = "#ff765f";
  const amber = "#ffd166";
  addHeader(context, ["ADAMW ASSEMBLY LINE", "MOMENTS -> BIAS CORRECTION -> STEP + DECAY"], green);

  const input = addAt(
    context,
    createPanel([
      "g=-0.0031 | m0=0 | v0=0",
      "beta1=.9 | beta2=.999 | eps=1e-8",
      "eta=.001 | lambda=.01 | w=.0174",
    ], {
      width: 7.6,
      height: 1.45,
      color: "#f4fbff",
      borderColor: green,
      fontScale: 0.65,
    }),
    vector(0, 3.35, 5.25),
  );
  const clipCheck = addAt(
    context,
    createPanel(["GLOBAL-NORM CLIP CHECK", "|g| under threshold -> unchanged", "(real runs clip before Adam)"], {
      width: 4.35,
      height: 1.4,
      color: "#f4fbff",
      borderColor: warm,
      fontScale: 0.6,
    }),
    vector(-6.6, 3.35, 4.15),
  );
  const moment = addAt(
    context,
    createPanel(["m1=.9m0+.1g", "m1=-0.00031"], {
      width: 3.8,
      height: 1.2,
      color: warm,
      borderColor: warm,
      fontScale: 0.72,
    }),
    vector(-4.45, 1.75, 2.3),
  );
  const variance = addAt(
    context,
    createPanel(["v1=.999v0+.001g^2", "v1=9.61e-9"], {
      width: 3.8,
      height: 1.2,
      color: amber,
      borderColor: amber,
      fontScale: 0.68,
    }),
    vector(4.45, 1.75, 2.3),
  );
  const correctedMoment = addAt(
    context,
    createPanel(["m_hat=m1/(1-beta1)", "m_hat=-0.0031"], {
      width: 3.8,
      height: 1.15,
      color: warm,
      borderColor: warm,
      fontScale: 0.68,
    }),
    vector(-4.45, 0.05, -0.1),
  );
  const correctedVariance = addAt(
    context,
    createPanel(["v_hat=v1/(1-beta2)", "v_hat=9.61e-6"], {
      width: 3.8,
      height: 1.15,
      color: amber,
      borderColor: amber,
      fontScale: 0.68,
    }),
    vector(4.45, 0.05, -0.1),
  );
  const normalized = addAt(
    context,
    createPanel(["m_hat/(sqrt(v_hat)+eps)", "= -0.999996774"], {
      width: 4.6,
      height: 1.2,
      color: "#f4fbff",
      borderColor: green,
      fontScale: 0.68,
    }),
    vector(0, -0.45, -2.55),
  );
  const adamComponent = addAt(
    context,
    createPanel(["-eta x normalized", "+0.000999996774"], {
      width: 4.0,
      height: 1.15,
      color: green,
      borderColor: green,
      fontScale: 0.7,
    }),
    vector(-4.0, -1.75, -4.75),
  );
  const decayComponent = addAt(
    context,
    createPanel(["-eta x lambda x w", "-0.000000174"], {
      width: 4.0,
      height: 1.15,
      color: amber,
      borderColor: amber,
      fontScale: 0.7,
    }),
    vector(4.0, -1.75, -4.75),
  );
  // The junction glyph dips below the sightline to the DELTA panel, and the
  // panel itself sits low so the "normalized" panel never covers it.
  const plus = addAt(context, createGlyph("+", green, 1.35), vector(0, -2.3, -5.85));
  const delta = addAt(
    context,
    createPanel(["DELTA w", "+0.000999822774"], {
      width: 4.1,
      height: 1.25,
      color: green,
      borderColor: green,
      fontScale: 0.78,
    }),
    vector(0, -1.5, -7.25),
  );
  const paths = [
    createPath([input.position, moment.position], warm, 0.045, 0.35),
    createPath([input.position, variance.position], amber, 0.045, 0.35),
    createPath([moment.position, correctedMoment.position, normalized.position], warm, 0.045, 0.35),
    createPath([variance.position, correctedVariance.position, normalized.position], amber, 0.045, 0.35),
    createPath([normalized.position, adamComponent.position, plus.position, delta.position], green, 0.05, 0.4),
    createPath([input.position, decayComponent.position, plus.position, delta.position], amber, 0.035, 0.28),
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
    samplePath(packets[1], [input.position, variance.position, correctedVariance.position, normalized.position], smoothStep(p, 0.08, 0.64), 0.28);
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

function buildWeightUpdateProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const green = "#b8ff75";
  const amber = "#ffd166";
  addHeader(context, ["PRECISION UPDATE BENCH", "w + DELTA w = w'"], green);
  const oldStart = vector(-5.95, 1.55, 3.85);
  const deltaStart = vector(5.95, 1.55, 3.85);
  const oldTile = addAt(
    context,
    createPanel(["w", "0.017400000000"], {
      width: 3.65,
      height: 1.3,
      color: amber,
      borderColor: amber,
      fontScale: 0.78,
    }),
    oldStart,
  );
  const deltaTile = addAt(
    context,
    createPanel(["DELTA w", "+0.000999822774"], {
      width: 3.65,
      height: 1.3,
      color: green,
      borderColor: green,
      fontScale: 0.75,
    }),
    deltaStart,
  );
  const plus = addAt(context, createGlyph("+", green, 1.45), vector(0, 1.55, 1.8));
  const equals = addAt(context, createGlyph("=", green, 1.45), vector(0, 1.55, -0.55));
  const resultTile = addAt(
    context,
    createPanel(["w'", "0.018399822774"], {
      width: 3.75,
      height: 1.3,
      color: green,
      borderColor: green,
      fontScale: 0.78,
    }),
    vector(0, 1.55, -2.75),
  );
  context.group.add(createPath([oldStart, vector(-1.25, 1.55, 1.8)], amber, 0.045, 0.34));
  context.group.add(createPath([deltaStart, vector(1.25, 1.55, 1.8)], green, 0.045, 0.34));

  const matrixValuesBefore = Array.from({ length: 64 }, () => "." as string);
  const matrixValuesAfter = [...matrixValuesBefore];
  matrixValuesBefore[SELECTED_CELL_INDEX] = "0.017400000000";
  matrixValuesAfter[SELECTED_CELL_INDEX] = "0.018399822774";
  const unknown = Array.from({ length: 64 }, (_, index) => index).filter(
    (index) => index !== SELECTED_CELL_INDEX,
  );
  const updateBoardWidth = 6.2;
  const updateBoardCellHeight = 0.34;
  // Low enough that the w' tile and the equation glyphs in front never
  // cover the matrix title or its top rows from the entrance sightline.
  const updateBoardPosition = vector(0, -0.55, -6.2);
  const updateBoardHeight = 0.72 + 8 * updateBoardCellHeight + 0.5 + 0.34;
  const selectedCellPosition = vector(
    updateBoardPosition.x - updateBoardWidth / 2 + (6 + 0.5) * (updateBoardWidth / 8),
    updateBoardPosition.y + updateBoardHeight / 2 - 0.72 - (3 + 0.5) * updateBoardCellHeight,
    -6.0,
  );
  context.group.add(
    createPath(
      [equals.position, resultTile.position, selectedCellPosition],
      green,
      0.055,
      0.38,
    ),
  );
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
  const beforeBoard = addAt(context, createValueBoard(matrixValuesBefore, 8, 8, boardOptions), vector(0, -0.55, -6.25));
  const afterBoard = addAt(context, createValueBoard(matrixValuesAfter, 8, 8, boardOptions), updateBoardPosition);
  const insertionPacket = addAt(context, createPacket(green, 0.2), resultTile.position.clone());
  const updateRing = addAt(context, makeRing(green, 0.62, 0.065), selectedCellPosition);
  const onlyNow = addAt(
    context,
    createPanel(["ONLY NOW", "THE STORED PARAMETER CHANGES"], {
      width: 4.7,
      height: 1.05,
      color: green,
      borderColor: green,
      fontScale: 0.7,
    }),
    vector(5.5, -1.45, -4.2),
  );

  const updater: ChamberProcessUpdater = (progress, elapsed, motionEnabled = true) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    moveObject(oldTile, oldStart, vector(-1.25, 1.55, 1.8), smoothStep(p, 0.16, 0.48), 0.18);
    moveObject(deltaTile, deltaStart, vector(1.25, 1.55, 1.8), smoothStep(p, 0.16, 0.48), 0.18);
    const operandOpacity = 1 - smoothStep(p, 0.48, 0.62);
    setObjectOpacity(oldTile, operandOpacity);
    setObjectOpacity(deltaTile, operandOpacity);
    setObjectOpacity(plus, windowPulse(p, 0.12, 0.46, 0.68));
    setObjectOpacity(equals, smoothStep(p, 0.48, 0.64));
    setObjectOpacity(resultTile, smoothStep(p, 0.56, 0.7));
    samplePath(insertionPacket, [resultTile.position, vector(0, 0.3, -4.5), selectedCellPosition], smoothStep(p, 0.68, 0.88), 0.28);
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

function buildNextStepProcess(
  context: ChamberProcessContext,
): ChamberProcessUpdater {
  const green = "#b8ff75";
  const warm = "#ff765f";
  addHeader(context, ["MODEL VERSION HANDOFF", "SAME ARCHITECTURE | NEW PARAMETER STATE"], green);

  const model = new THREE.Group();
  model.position.set(0, 0, -1.4);
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
    const y = -2.25 + index * 1.45;
    const oldFloor = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.28, 3.2), oldMaterial);
    const newFloor = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.28, 3.2), newMaterial);
    oldFloor.position.y = y;
    newFloor.position.y = y;
    thetaZero.add(oldFloor);
    thetaOne.add(newFloor);
    addAt(
      context,
      createPanel([name], {
        width: 2.2,
        height: 0.52,
        color: "#f4fbff",
        borderColor: green,
        fontScale: 0.62,
        background: "rgba(3,8,16,0.76)",
      }),
      vector(0, y + 0.42, 0.3),
    );
  });
  const parameterLights: THREE.Mesh[] = [];
  for (let index = 0; index < 16; index += 1) {
    const light = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.32, 0.15),
      createProcessMaterial(green, 1.4),
    );
    light.position.set((index % 4 - 1.5) * 0.72, (Math.floor(index / 4) - 1.5) * 0.72, 1.75);
    model.add(light);
    parameterLights.push(light);
  }
  const beforeReadout = addAt(
    context,
    createPanel(["theta0 SELECTED CELL", "WQ[3,6] = 0.0174"], {
      width: 4.2,
      height: 1.05,
      color: "#dceaff",
      borderColor: "#7f98aa",
      fontScale: 0.68,
    }),
    vector(-6.25, 3.2, -2.8),
  );
  const afterReadout = addAt(
    context,
    createPanel(["theta1 SELECTED CELL", "WQ[3,6] = 0.018399822774"], {
      width: 4.2,
      height: 1.05,
      color: green,
      borderColor: green,
      fontScale: 0.65,
    }),
    vector(-6.25, 3.2, -2.75),
  );

  const gradientBuffers = new THREE.Group();
  gradientBuffers.position.set(-6.0, -0.9, -4.4);
  context.group.add(gradientBuffers);
  for (let index = 0; index < 12; index += 1) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.42, 0.42),
      createProcessMaterial(warm, 0.85),
    );
    box.position.set((index % 4 - 1.5) * 0.55, Math.floor(index / 4) * 0.55, 0);
    gradientBuffers.add(box);
  }
  addAt(
    context,
    createPanel(["GRAD BUFFER", "clears -> 0"], {
      width: 3.4,
      height: 1.0,
      color: warm,
      borderColor: warm,
      fontScale: 0.7,
    }),
    vector(-6.0, 1.2, -4.4),
  );
  const memoryPanel = addAt(
    context,
    createPanel(["ADAM STATE PERSISTS", "m1=-0.00031", "v1=9.61e-9"], {
      width: 3.8,
      height: 1.45,
      color: green,
      borderColor: green,
      fontScale: 0.68,
    }),
    vector(6.1, 0.35, -4.35),
  );
  const batchStart = vector(0, -1.05, 6.3);
  const batchEnd = vector(0, -1.05, 1.45);
  const nextBatch = addAt(
    context,
    createValueBoard(Array.from({ length: 12 }, () => "."), 2, 6, {
      width: 5.4,
      cellHeight: 0.5,
      title: "NEXT BATCH [2 x 6]",
      subtitle: "IDs not specified in this trace",
      color: context.palette.phaseBase,
      unknownIndices: Array.from({ length: 12 }, (_, index) => index),
    }),
    batchStart,
  );
  const leftDoor = addAt(context, makeDeck(vector(1.8, 3.4, 0.25), green, 0.46), vector(-1.05, -0.65, 0.8));
  const rightDoor = addAt(context, makeDeck(vector(1.8, 3.4, 0.25), green, 0.46), vector(1.05, -0.65, 0.8));
  const routePanel = addAt(
    context,
    createPanel(["batch1 -> forward -> loss", "-> backward -> update"], {
      width: 5.5,
      height: 1.05,
      color: context.palette.phaseBase,
      borderColor: green,
      fontScale: 0.67,
    }),
    vector(0, 3.25, -5.9),
  );
  const postTrainingPlaque = addAt(
    context,
    createPanel([
      "THIS WORLD = ONE PRETRAINING STEP",
      "repeat a very large number of times,",
      "then: evaluation -> SFT -> RLHF post-training",
    ], {
      width: 6.3,
      height: 1.55,
      color: "#dceaff",
      borderColor: green,
      fontScale: 0.6,
    }),
    vector(6.5, 2.85, -5.5),
  );

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
    leftDoor.position.x = THREE.MathUtils.lerp(-1.05, -2.45, gateOpen);
    rightDoor.position.x = THREE.MathUtils.lerp(1.05, 2.45, gateOpen);
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
