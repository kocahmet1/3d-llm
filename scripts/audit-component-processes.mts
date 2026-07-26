/**
 * Contract audit for component-specific chamber replays.
 *
 * It verifies that every rich assistant component has:
 *   - a world binding and a real canonical scene name,
 *   - one replay definition derived from valid same-station beats,
 *   - a bounded progress window and resolvable staged participants,
 *   - model-facing causal narration.
 *
 * Chamber 1 is intentionally station-level. Every later chamber must expose
 * a substantial component inventory and authored replay beats.
 */
import { readFile } from "node:fs/promises";

import {
  ASSISTANT_STATION_CONTEXTS,
  ASSISTANT_TARGET_CONTEXTS,
  ASSISTANT_TARGET_WORLD_METADATA,
} from "../app/lib/assistantContext.ts";
import {
  CHAMBER_PROCESS_BEATS,
  COMPONENT_PROCESS_DEFINITIONS,
} from "../app/lib/componentProcesses.ts";

const sceneSource = (
  await Promise.all(
    [
      "../app/components/chambers/earlyProcesses.ts",
      "../app/components/chambers/attentionProcesses.ts",
      "../app/components/chambers/learningProcesses.ts",
      "../app/components/TrainingWorldCanvas.tsx",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  )
).join("\n");

const components = Object.values(ASSISTANT_TARGET_CONTEXTS).filter(
  (target) => target.kind === "component",
);
const beatIds = new Set<string>();
const problems: string[] = [];

for (const processBeat of CHAMBER_PROCESS_BEATS) {
  if (beatIds.has(processBeat.id)) {
    problems.push(`duplicate beat id ${processBeat.id}`);
  }
  beatIds.add(processBeat.id);
  if (
    processBeat.startProgress < 0 ||
    processBeat.endProgress > 1 ||
    processBeat.startProgress >= processBeat.endProgress
  ) {
    problems.push(`invalid progress range on ${processBeat.id}`);
  }
  for (const targetId of processBeat.targetIds) {
    const target = ASSISTANT_TARGET_CONTEXTS[targetId];
    if (!target || target.kind !== "component") {
      problems.push(`${processBeat.id} references unknown component ${targetId}`);
    } else if (target.stationId !== processBeat.stationId) {
      problems.push(`${processBeat.id} crosses stations through ${targetId}`);
    }
  }
  for (const sceneKey of processBeat.auxiliarySceneKeys) {
    if (!sceneSource.includes(sceneKey)) {
      problems.push(
        `${processBeat.id} auxiliary scene key is absent: ${sceneKey}`,
      );
    }
  }
}

for (const target of components) {
  const definition = COMPONENT_PROCESS_DEFINITIONS[target.id];
  const world = ASSISTANT_TARGET_WORLD_METADATA[target.id];
  if (!definition) {
    problems.push(`${target.id} has no component replay definition`);
    continue;
  }
  if (!world) {
    problems.push(`${target.id} has no world binding`);
    continue;
  }
  if (!sceneSource.includes(world.matching.canonicalObjectName)) {
    problems.push(
      `${target.id} canonical scene name is absent: ${world.matching.canonicalObjectName}`,
    );
  }
  if (definition.stationId !== target.stationId) {
    problems.push(`${target.id} replay is assigned to the wrong station`);
  }
  if (
    definition.playback.startProgress < 0 ||
    definition.playback.endProgress > 1 ||
    definition.playback.startProgress >= definition.playback.endProgress
  ) {
    problems.push(`${target.id} has an invalid replay range`);
  }
  if (definition.playback.source !== "authored-beats") {
    problems.push(`${target.id} still uses a provisional derived window`);
  }
  if (
    definition.beatIds.length === 0 ||
    definition.beatIds.some((beatId) => !beatIds.has(beatId))
  ) {
    problems.push(`${target.id} has missing or invalid beat membership`);
  }
  if (definition.participantTargetIds[0] !== target.id) {
    problems.push(`${target.id} is not first in its staged participant list`);
  }
  for (const participantId of definition.participantTargetIds) {
    const participant = ASSISTANT_TARGET_CONTEXTS[participantId];
    if (!participant || participant.stationId !== target.stationId) {
      problems.push(`${target.id} has invalid participant ${participantId}`);
    }
  }
  for (const sceneKey of definition.auxiliarySceneKeys) {
    if (!sceneSource.includes(sceneKey)) {
      problems.push(`${target.id} has unresolved auxiliary scene key ${sceneKey}`);
    }
  }
  if (
    !definition.narrative.interactionCause ||
    definition.narrative.sequence.length === 0
  ) {
    problems.push(`${target.id} is missing causal voice narration`);
  }
}

const componentsByStation = new Map<string, number>();
for (const target of components) {
  componentsByStation.set(
    target.stationId,
    (componentsByStation.get(target.stationId) ?? 0) + 1,
  );
}
const uncoveredStations = Object.keys(ASSISTANT_STATION_CONTEXTS).filter(
  (stationId) => !componentsByStation.has(stationId),
);
const beatsByStation = new Map<string, number>();
for (const processBeat of CHAMBER_PROCESS_BEATS) {
  beatsByStation.set(
    processBeat.stationId,
    (beatsByStation.get(processBeat.stationId) ?? 0) + 1,
  );
}
const expectedCoveredStations = Object.keys(ASSISTANT_STATION_CONTEXTS).filter(
  (stationId) => stationId !== "training-complex",
);
for (const stationId of expectedCoveredStations) {
  if ((componentsByStation.get(stationId) ?? 0) < 3) {
    problems.push(`${stationId} has fewer than three component targets`);
  }
  if ((beatsByStation.get(stationId) ?? 0) < 3) {
    problems.push(`${stationId} has fewer than three causal replay beats`);
  }
}
if (
  uncoveredStations.length !== 1 ||
  uncoveredStations[0] !== "training-complex"
) {
  problems.push(
    `unexpected station-level fallback coverage: ${uncoveredStations.join(", ")}`,
  );
}

console.log(
  [
    `component targets  ${components.length}`,
    `chamber beats      ${CHAMBER_PROCESS_BEATS.length}`,
    `covered chambers   ${componentsByStation.size}`,
    `station fallbacks  ${uncoveredStations.length}`,
    `fallback stations  ${uncoveredStations.join(", ")}`,
  ].join("\n"),
);

if (problems.length > 0) {
  console.error(`\n${problems.length} component replay problem(s):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log("\nall registered components have valid isolated replays");
}
