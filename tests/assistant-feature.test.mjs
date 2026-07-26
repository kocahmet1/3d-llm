import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);
const fileUrl = (path) => new URL(path, rootUrl);
const readSource = (path) => readFile(fileUrl(path), "utf8");

function asDataModule(javascript) {
  return `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
}

function transpile(source, fileName) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName,
  }).outputText;
}

let contextModulesPromise;
async function loadContextModules() {
  if (!contextModulesPromise) {
    const contentModules = [
      "assistantContentCorpusExpansion",
      "assistantContentEarlyExpansion",
      "assistantContentForwardExpansion",
      "assistantContentLearningExpansion",
    ];
    const beatModules = [
      "componentBeatsCorpusExpansion",
      "componentBeatsEarlyExpansion",
      "componentBeatsForwardExpansion",
      "componentBeatsLearningExpansion",
    ];
    const replaceImport = (source, specifier, replacement) =>
      source.replace(
        new RegExp(
          `from\\s+["']${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
          "g",
        ),
        `from ${JSON.stringify(replacement)}`,
      );

    contextModulesPromise = Promise.all([
      readSource("app/lib/trainingTrace.ts"),
      readSource("app/lib/assistantContext.ts"),
      readSource("app/lib/componentProcesses.ts"),
      ...contentModules.map((name) => readSource(`app/lib/${name}.ts`)),
      ...beatModules.map((name) => readSource(`app/lib/${name}.ts`)),
    ]).then(async (sources) => {
      const [traceSource, contextSource, componentProcessSource] =
        sources.slice(0, 3);
      const contentSources = sources.slice(3, 3 + contentModules.length);
      const beatSources = sources.slice(3 + contentModules.length);
      const traceUrl = asDataModule(
        transpile(traceSource, "trainingTrace.ts"),
      );
      const contentUrls = Object.fromEntries(
        contentModules.map((name, index) => {
          const javascript = replaceImport(
            transpile(contentSources[index], `${name}.ts`),
            "./trainingTrace",
            traceUrl,
          );
          return [name, asDataModule(javascript)];
        }),
      );
      const beatUrls = Object.fromEntries(
        beatModules.map((name, index) => [
          name,
          asDataModule(transpile(beatSources[index], `${name}.ts`)),
        ]),
      );
      let contextJavascript = transpile(
        contextSource,
        "assistantContext.ts",
      );
      contextJavascript = replaceImport(
        contextJavascript,
        "./trainingTrace",
        traceUrl,
      );
      for (const name of contentModules) {
        contextJavascript = replaceImport(
          contextJavascript,
          `./${name}`,
          contentUrls[name],
        );
      }
      assert.doesNotMatch(
        contextJavascript,
        /from\s+["']\.\/(?:trainingTrace|assistantContent[A-Za-z]+Expansion)["']/,
        "the runtime test loader must replace assistant-context module imports",
      );
      const contextUrl = asDataModule(contextJavascript);
      let componentProcessJavascript = transpile(
        componentProcessSource,
        "componentProcesses.ts",
      );
      componentProcessJavascript = replaceImport(
        componentProcessJavascript,
        "./assistantContext",
        contextUrl,
      );
      for (const name of beatModules) {
        componentProcessJavascript = replaceImport(
          componentProcessJavascript,
          `./${name}`,
          beatUrls[name],
        );
      }
      assert.doesNotMatch(
        componentProcessJavascript,
        /from\s+["']\.\/(?:assistantContext|componentBeats[A-Za-z]+Expansion)["']/,
        "the runtime test loader must replace component-process module imports",
      );
      const [trace, context, componentProcesses] = await Promise.all([
        import(traceUrl),
        import(contextUrl),
        import(asDataModule(componentProcessJavascript)),
      ]);
      return { trace, context, componentProcesses };
    });
  }
  return contextModulesPromise;
}

let realtimeRoutePromise;
async function loadRealtimeRoute() {
  if (!realtimeRoutePromise) {
    realtimeRoutePromise = readSource(
      "app/api/realtime/session/route.ts",
    ).then((source) =>
      import(asDataModule(transpile(source, "realtime-session-route.ts"))),
    );
  }
  return realtimeRoutePromise;
}

let focusVisibilityPromise;
async function loadFocusVisibility() {
  if (!focusVisibilityPromise) {
    focusVisibilityPromise = readSource("app/lib/focusVisibility.ts").then(
      (source) =>
        import(asDataModule(transpile(source, "focusVisibility.ts"))),
    );
  }
  return focusVisibilityPromise;
}

const validOffer = [
  "v=0",
  "o=- 0 0 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=ice-ufrag:test",
  "a=fingerprint:sha-256 00:11:22:33",
  "",
].join("\r\n");

const validAnswer = [
  "v=0",
  "o=- 1 1 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "",
].join("\r\n");

function sessionRequest(headers = {}, { origin = "http://localhost" } = {}) {
  return new Request("http://localhost/api/realtime/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/sdp",
      ...(origin ? { Origin: origin } : {}),
      ...headers,
    },
    body: validOffer,
  });
}

function requestHeader(init, name) {
  return new Headers(init?.headers).get(name);
}

test("assistant context covers every station and every world binding", async () => {
  const { trace, context } = await loadContextModules();
  const stationIds = trace.TRAINING_STATIONS.map(({ id }) => id);

  assert.equal(stationIds.length, 25);
  assert.deepEqual(
    Object.keys(context.ASSISTANT_STATION_CONTEXTS),
    stationIds,
  );
  assert.equal(context.STATION_FALLBACK_TARGETS.length, stationIds.length);

  for (const stationId of stationIds) {
    const targetId = `station:${stationId}`;
    assert.equal(
      context.ASSISTANT_TARGET_CONTEXTS[targetId]?.stationId,
      stationId,
    );
    assert.equal(
      context.ASSISTANT_TARGET_WORLD_METADATA[targetId]?.stationId,
      stationId,
    );
  }

  for (const [targetId, target] of Object.entries(
    context.ASSISTANT_TARGET_CONTEXTS,
  )) {
    assert.equal(
      context.ASSISTANT_TARGET_WORLD_METADATA[targetId]?.targetId,
      targetId,
      `${targetId} needs a separate world binding`,
    );
    assert.equal("anchor" in target, false, "model context must omit anchors");
    assert.equal("matching" in target, false, "model context must omit mesh names");
  }
});

test("every rich component derives an isolated replay from valid chamber beats", async () => {
  const { context, componentProcesses } = await loadContextModules();
  const components = Object.values(context.ASSISTANT_TARGET_CONTEXTS).filter(
    ({ kind }) => kind === "component",
  );
  const definitions = componentProcesses.COMPONENT_PROCESS_DEFINITIONS;
  const beats = componentProcesses.CHAMBER_PROCESS_BEATS;
  const expectedCoveredStations = Object.keys(
    context.ASSISTANT_STATION_CONTEXTS,
  ).filter((stationId) => stationId !== "training-complex");
  const componentsByStation = Map.groupBy(
    components,
    ({ stationId }) => stationId,
  );
  const beatsByStation = Map.groupBy(beats, ({ stationId }) => stationId);

  assert.deepEqual(
    [...componentsByStation.keys()].sort(),
    [...expectedCoveredStations].sort(),
    "every non-opening chamber must have rich component content",
  );
  for (const stationId of expectedCoveredStations) {
    assert.ok(
      (componentsByStation.get(stationId)?.length ?? 0) >= 3,
      `${stationId} needs at least three component targets`,
    );
    assert.ok(
      (beatsByStation.get(stationId)?.length ?? 0) >= 3,
      `${stationId} needs at least three causal replay beats`,
    );
  }
  assert.equal(Object.keys(definitions).length, components.length);
  assert.ok(
    components.length >= expectedCoveredStations.length * 3,
    "covered chambers should expose substantial component inventories",
  );

  const beatIds = new Set();
  for (const beat of beats) {
    assert.equal(beatIds.has(beat.id), false, `duplicate beat ${beat.id}`);
    beatIds.add(beat.id);
    assert.ok(beat.startProgress >= 0 && beat.startProgress < beat.endProgress);
    assert.ok(beat.endProgress <= 1);
    assert.ok(beat.cause.length > 20);
    assert.ok(beat.result.length > 20);
    assert.ok(beat.targetIds.length >= 2);
    assert.ok(Array.isArray(beat.auxiliarySceneKeys));
    assert.ok(
      beat.auxiliarySceneKeys.every(
        (sceneKey) => typeof sceneKey === "string" && sceneKey.length > 0,
      ),
    );
    for (const targetId of beat.targetIds) {
      const target = context.ASSISTANT_TARGET_CONTEXTS[targetId];
      assert.equal(target?.kind, "component", `${beat.id} has unknown ${targetId}`);
      assert.equal(target.stationId, beat.stationId);
      assert.ok(context.ASSISTANT_TARGET_WORLD_METADATA[targetId]);
    }
  }

  for (const target of components) {
    assert.ok(target.aliases.length > 0, `${target.id} needs voice aliases`);
    assert.ok(target.summary.length > 20, `${target.id} needs a useful summary`);
    assert.ok(target.role.length > 20, `${target.id} needs a useful role`);
    assert.ok(target.inputs.length > 0, `${target.id} needs inputs`);
    assert.ok(target.operation.length > 10, `${target.id} needs an operation`);
    assert.ok(target.outputs.length > 0, `${target.id} needs outputs`);
    assert.ok(
      target.whyItMatters.length > 20,
      `${target.id} needs significance`,
    );
    assert.ok(
      target.commonMisconceptions.length > 0,
      `${target.id} needs a misconception guardrail`,
    );
    for (const mode of ["story", "structure", "math", "code"]) {
      assert.ok(
        target.explanationByMode[mode]?.length > 0,
        `${target.id} needs ${mode} guidance`,
      );
    }
    for (const relatedTargetId of target.relatedTargetIds) {
      assert.ok(
        context.ASSISTANT_TARGET_CONTEXTS[relatedTargetId],
        `${target.id} relates to unknown ${relatedTargetId}`,
      );
    }

    const definition = definitions[target.id];
    assert.equal(definition.targetId, target.id);
    assert.equal(definition.stationId, target.stationId);
    assert.equal(definition.playback.source, "authored-beats");
    assert.ok(definition.beatIds.length > 0);
    assert.ok(definition.beatIds.every((beatId) => beatIds.has(beatId)));
    assert.equal(definition.participantTargetIds[0], target.id);
    const targetBeats = beats.filter((beat) =>
      definition.beatIds.includes(beat.id),
    );
    const expectedPartners = target.relatedTargetIds.filter((targetId) => {
      const partner = context.ASSISTANT_TARGET_CONTEXTS[targetId];
      return (
        partner?.kind === "component" &&
        partner.stationId === target.stationId &&
        Boolean(context.ASSISTANT_TARGET_WORLD_METADATA[targetId]) &&
        targetBeats.some((beat) => beat.targetIds.includes(targetId))
      );
    });
    assert.deepEqual(
      definition.participantTargetIds.slice(1),
      expectedPartners,
      `${target.id} must stage curated same-beat causal neighbours only`,
    );
    assert.deepEqual(
      definition.auxiliarySceneKeys,
      [...new Set(targetBeats.flatMap((beat) => beat.auxiliarySceneKeys))],
    );
    assert.ok(
      definition.playback.startProgress <
        definition.playback.endProgress,
    );
    assert.ok(definition.playback.durationSeconds >= 3.5);
    assert.ok(definition.narrative.interactionCause.length > 20);
    assert.ok(definition.narrative.sequence.length > 0);
  }

  assert.deepEqual(
    definitions["mha:query-projection"].participantTargetIds,
    ["mha:query-projection", "mha:normalized-input", "mha:projected-query"],
  );
  assert.ok(
    definitions["mha:query-projection"].auxiliarySceneKeys.includes(
      "mha-query-projection-flow",
    ),
  );
  assert.deepEqual(
    definitions["mha:head-split"].participantTargetIds,
    ["mha:head-split", "mha:projected-query", "mha:head-0", "mha:head-1"],
  );

  const learningExpansionStations = new Set([
    "target-comparison",
    "output-backprop",
    "backprop-through-tower",
    "parameter-matrix",
    "adamw-state",
    "weight-update",
    "model-changed-next-step",
  ]);
  for (const stationId of learningExpansionStations) {
    assert.ok(
      beatsByStation
        .get(stationId)
        ?.some(({ auxiliarySceneKeys }) => auxiliarySceneKeys.length > 0),
      `${stationId} needs animated replay actors or routes`,
    );
  }
  for (const target of components.filter(({ stationId }) =>
    learningExpansionStations.has(stationId),
  )) {
    const definition = definitions[target.id];
    const coBeatParticipants = new Set(
      beats
        .filter(
          (beat) =>
            beat.stationId === target.stationId &&
            beat.targetIds.includes(target.id),
        )
        .flatMap(({ targetIds }) => targetIds)
        .filter((targetId) => targetId !== target.id),
    );
    assert.deepEqual(
      new Set(definition.participantTargetIds.slice(1)),
      coBeatParticipants,
      `${target.id} must stage every component in its narrated learning beat`,
    );
  }
  assert.ok(
    definitions[
      "output-backprop:vocabulary-bias-gradient"
    ].auxiliarySceneKeys.includes("output-backprop-fork-flow"),
  );
  const clippingContext =
    context.ASSISTANT_TARGET_CONTEXTS["adamw-state:clip-check"];
  assert.equal(clippingContext.exactValues.clippingOutcomeAvailable, false);
  assert.equal("wasClipped" in clippingContext.exactValues, false);
});

test("component replay clock loops its chamber slice and holds under reduced motion", async () => {
  const { componentProcesses } = await loadContextModules();
  const definition =
    componentProcesses.COMPONENT_PROCESS_DEFINITIONS[
      "embedding:sum-result"
    ];
  const start = componentProcesses.componentProcessProgressAt(
    definition,
    0,
  );
  const halfway = componentProcesses.componentProcessProgressAt(
    definition,
    definition.playback.durationSeconds / 2,
  );
  const restarted = componentProcesses.componentProcessProgressAt(
    definition,
    definition.playback.durationSeconds,
  );
  const heldA = componentProcesses.componentProcessProgressAt(
    definition,
    1,
    false,
  );
  const heldB = componentProcesses.componentProcessProgressAt(
    definition,
    100,
    false,
  );

  assert.equal(start, definition.playback.startProgress);
  assert.ok(start < halfway && halfway < definition.playback.endProgress);
  assert.ok(Math.abs(restarted - start) < 1e-12);
  assert.equal(heldA, heldB);
  assert.equal(
    heldA,
    (definition.playback.startProgress +
      definition.playback.endProgress) /
      2,
  );
});

test("semantic object names select rich attention context and unnamed meshes fall back", async () => {
  const { context } = await loadContextModules();

  const selectedCell = context.resolveAssistantTarget({
    stationId: "attention-scores",
    objectAncestryNames: [
      "assistant-target-attention-score-cell-q2-k0",
      "station-09-attention-scores",
    ],
  });
  assert.equal(selectedCell.source, "semantic-object-name");
  assert.equal(selectedCell.target.id, "attention:selected-score-cell");
  assert.equal(selectedCell.target.exactValues.scaledScore, 2.1);
  assert.equal(
    selectedCell.world.matching.canonicalObjectName,
    "assistant-target-attention-score-cell-q2-k0",
  );

  const fallback = context.resolveAssistantTarget({
    stationId: "attention-scores",
    objectAncestryNames: ["station-09-attention-scores"],
  });
  assert.equal(fallback.source, "station-fallback");
  assert.equal(fallback.target.id, "station:attention-scores");
});

test("turn snapshots freeze the referent, mode, branch, and cloned visible state", async () => {
  const { context, componentProcesses } = await loadContextModules();
  const visibleState = {
    animation: { phase: "value-gathering", progress: 0.4 },
    highlightedPositions: [0, 1, 2],
  };

  const snapshot = context.buildAssistantTurnContextSnapshot({
    stationId: "one-head-qkv",
    explicitTargetId: "attention:values",
    detailMode: "math",
    branchSide: "right",
    visibleState,
  });

  visibleState.animation.phase = "moved-after-speech-start";
  visibleState.highlightedPositions.push(5);

  assert.equal(snapshot.target.id, "attention:values");
  assert.equal(snapshot.view.detailMode, "math");
  assert.equal(snapshot.view.branch.side, "right");
  assert.match(snapshot.view.branch.label, /value gathering/i);
  assert.equal(snapshot.visibleState.animation.phase, "value-gathering");
  assert.deepEqual(snapshot.visibleState.highlightedPositions, [0, 1, 2]);
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(Object.hasOwn(snapshot, "tutorInstructions"), false);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.visibleState), true);
  assert.equal(Object.isFrozen(snapshot.visibleState.animation), true);
  assert.equal(Object.isFrozen(snapshot.visibleState.highlightedPositions), true);

  const replaySnapshot = componentProcesses.attachComponentProcessContext(
    snapshot,
    "attention:values",
    "playing-isolated-chamber-slice",
  );
  assert.equal(
    replaySnapshot.componentProcess.status,
    "playing-isolated-chamber-slice",
  );
  assert.equal(
    replaySnapshot.componentProcess.selectedComponent,
    componentProcesses.COMPONENT_PROCESS_DEFINITIONS["attention:values"].label,
  );
  assert.equal(
    replaySnapshot.componentProcess.interactionPartners.length,
    0,
    "a component without a same-chamber causal neighbour must not invent one",
  );
  assert.ok(replaySnapshot.componentProcess.beats.length > 0);
  assert.equal(Object.isFrozen(replaySnapshot.componentProcess), true);
  assert.equal(Object.isFrozen(replaySnapshot.componentProcess.beats), true);
});

test("raycastable attention groups honor the context registry naming contract", async () => {
  const [{ context }, chamberSource] = await Promise.all([
    loadContextModules(),
    readSource("app/components/chambers/attentionProcesses.ts"),
  ]);

  const componentBindings = Object.values(
    context.ASSISTANT_TARGET_WORLD_METADATA,
  ).filter(({ targetId }) =>
    targetId.startsWith("attention:"),
  );
  assert.ok(componentBindings.length >= 12);

  for (const binding of componentBindings) {
    assert.match(
      chamberSource,
      new RegExp(
        `name\\s*=\\s*["']${binding.matching.canonicalObjectName}["']`,
      ),
      `${binding.targetId} must name a raycastable scene object`,
    );
  }
});

test("focus visibility lease hides only the exhibit parent and restores exactly", async () => {
  const { createFocusVisibilityLease } = await loadFocusVisibility();
  const chamber = { visible: true, parent: null };
  const exhibit = { visible: true, parent: chamber };
  const selected = { visible: true, parent: exhibit };
  const detailOnlyChild = { visible: false, parent: exhibit };
  const lease = createFocusVisibilityLease(exhibit);

  lease.hide();
  assert.equal(chamber.visible, true, "the chamber shell must remain visible");
  assert.equal(exhibit.visible, false, "the original exhibit must be hidden");
  assert.equal(
    selected.visible,
    true,
    "source-local state must remain available to the staged clone",
  );

  selected.visible = false;
  detailOnlyChild.visible = true;
  lease.restore();
  assert.equal(exhibit.visible, true);
  assert.equal(
    selected.visible,
    false,
    "component animation changes made during focus must survive dismissal",
  );
  assert.equal(
    detailOnlyChild.visible,
    true,
    "Detail Mode changes made during focus must survive dismissal",
  );

  lease.hide();
  assert.equal(
    exhibit.visible,
    true,
    "a completed lease must not be able to hide the exhibit again",
  );
});

test("direct focus switches restore A before hiding B", async () => {
  const { createFocusVisibilityLease } = await loadFocusVisibility();
  const chamberA = { visible: true, parent: null };
  const chamberB = { visible: true, parent: null };

  const focusA = createFocusVisibilityLease(chamberA);
  focusA.hide();
  assert.equal(chamberA.visible, false);

  focusA.restore();
  const focusB = createFocusVisibilityLease(chamberB);
  focusB.hide();
  assert.equal(chamberA.visible, true);
  assert.equal(chamberB.visible, false);

  focusB.restore();
  assert.equal(chamberA.visible, true);
  assert.equal(chamberB.visible, true);
});

test("hidden exhibit ancestry is excluded from component picking", async () => {
  const { isVisibleThroughAncestor } = await loadFocusVisibility();
  const chamber = { visible: true, parent: null };
  const exhibit = { visible: true, parent: chamber };
  const component = { visible: true, parent: exhibit };
  const outside = { visible: true, parent: null };

  assert.equal(isVisibleThroughAncestor(component, chamber), true);
  component.visible = false;
  assert.equal(isVisibleThroughAncestor(component, chamber), false);
  component.visible = true;
  exhibit.visible = false;
  assert.equal(isVisibleThroughAncestor(component, chamber), false);
  assert.equal(isVisibleThroughAncestor(outside, chamber), false);
});

test("spotlight lifecycle owns a reversible chamber exhibit container", async () => {
  const canvas = await readSource(
    "app/components/TrainingWorldCanvas.tsx",
  );

  assert.match(canvas, /exhibitRoot:\s*THREE\.Group/);
  assert.match(canvas, /group\.add\(processGroup\)/);
  assert.match(canvas, /exhibitRoot:\s*processGroup/);
  assert.match(
    canvas,
    /const clearFocusStage = \(\) => \{[\s\S]*?focusSourceVisibilityLease\?\.restore\(\);[\s\S]*?focusSourceVisibilityLease = null;/,
  );
  assert.match(
    canvas,
    /focusSourceVisibilityLease = createFocusVisibilityLease\(\s*runtime\.exhibitRoot,\s*\);[\s\S]*?focusSourceVisibilityLease\.hide\(\);/,
  );
  assert.match(
    canvas,
    /const wasActive = focusActive;[\s\S]*?focusActive = false;\s*clearFocusStage\(\);[\s\S]*?const runtime = stationRuntimes\[currentStation\];/,
    "a direct target switch must restore the previous exhibit before staging the next one",
  );
  assert.match(
    canvas,
    /return \(\) => \{\s*disposed = true;[\s\S]*?clearFocusStage\(\);/,
    "unmount cleanup must restore an active chamber exhibit",
  );
  assert.match(
    canvas,
    /isVisibleThroughAncestor\(intersection\.object,\s*runtime\.group\)/,
    "invisible source exhibits must not remain raycast-interactive",
  );
});

test("Realtime route rejects cross-origin setup before using credentials", async () => {
  const { POST } = await loadRealtimeRoute();
  const response = await POST(
    sessionRequest({ Origin: "https://untrusted.example" }),
  );
  assert.equal(response.status, 403);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  assert.match((await response.json()).error, /cross-origin/i);
});

test("Realtime route rejects a missing browser Origin before using credentials", async () => {
  const { POST } = await loadRealtimeRoute();
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  let upstreamCalled = false;

  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async () => {
    upstreamCalled = true;
    return new Response(validAnswer, { status: 200 });
  };

  try {
    const response = await POST(sessionRequest({}, { origin: null }));
    assert.equal(response.status, 403);
    assert.equal(upstreamCalled, false);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.match((await response.json()).error, /origin/i);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("Realtime route fails safely when the server key is absent", async () => {
  const { POST } = await loadRealtimeRoute();
  const previousKey = process.env.OPENAI_API_KEY;
  const previousConsoleError = console.error;
  delete process.env.OPENAI_API_KEY;
  console.error = () => {};

  try {
    const response = await POST(sessionRequest());
    assert.equal(response.status, 500);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    const payload = await response.json();
    assert.match(payload.error, /not configured/i);
    assert.doesNotMatch(JSON.stringify(payload), /OPENAI_API_KEY|Bearer/i);
  } finally {
    console.error = previousConsoleError;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("Realtime route proxies SDP with a server-only bearer key", async () => {
  const { POST } = await loadRealtimeRoute();
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  const serverSecret = "test-server-secret-never-returned";
  let observed = false;

  process.env.OPENAI_API_KEY = serverSecret;
  globalThis.fetch = async (url, init) => {
    observed = true;
    assert.equal(String(url), "https://api.openai.com/v1/realtime/calls");
    assert.equal(init?.method, "POST");
    assert.equal(requestHeader(init, "Authorization"), `Bearer ${serverSecret}`);
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("sdp"), validOffer);
    const session = JSON.parse(String(init.body.get("session")));
    assert.equal(session.type, "realtime");
    assert.deepEqual(session.output_modalities, ["audio"]);
    assert.deepEqual(session.reasoning, { effort: "low" });
    assert.deepEqual(session.tools, []);
    assert.equal(session.tool_choice, "none");
    assert.equal(session.audio.input.transcription, undefined);
    assert.deepEqual(session.audio.input.turn_detection, {
      type: "semantic_vad",
      eagerness: "high",
      create_response: true,
      interrupt_response: true,
    });
    return new Response(validAnswer, {
      status: 200,
      headers: { "X-Request-Id": "req_assistant_contract" },
    });
  };

  try {
    const response = await POST(sessionRequest());
    const body = await response.text();
    assert.equal(observed, true);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/sdp/i);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.equal(response.headers.get("x-openai-request-id"), "req_assistant_contract");
    assert.equal(body, validAnswer);
    assert.doesNotMatch(body, new RegExp(serverSecret));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("Realtime route accepts an explicit temporary bearer", async () => {
  const { POST } = await loadRealtimeRoute();
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  const temporarySecret = ["sk", "test-temporary-secret-never-returned"].join("-");
  let observed = false;

  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async (url, init) => {
    observed = true;
    assert.equal(String(url), "https://api.openai.com/v1/realtime/calls");
    assert.equal(
      requestHeader(init, "Authorization"),
      `Bearer ${temporarySecret}`,
    );
    assert.equal(init?.method, "POST");
    assert.ok(init?.body instanceof FormData);
    return new Response(validAnswer, {
      status: 200,
      headers: { "X-Request-Id": "req_temporary_key_contract" },
    });
  };

  try {
    const response = await POST(
      sessionRequest({ Authorization: `Bearer ${temporarySecret}` }),
    );
    const body = await response.text();
    const responseMetadata = JSON.stringify([...response.headers]);

    assert.equal(observed, true);
    assert.equal(response.status, 200);
    assert.equal(body, validAnswer);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
    assert.doesNotMatch(`${body}\n${responseMetadata}`, new RegExp(temporarySecret));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("an explicit temporary bearer takes precedence over server fallback", async () => {
  const { POST } = await loadRealtimeRoute();
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  const serverSecret = "test-server-secret-preferred";
  const temporarySecret = ["sk", "test-temporary-secret-ignored"].join("-");

  process.env.OPENAI_API_KEY = serverSecret;
  globalThis.fetch = async (_url, init) => {
    assert.equal(
      requestHeader(init, "Authorization"),
      `Bearer ${temporarySecret}`,
    );
    assert.doesNotMatch(
      requestHeader(init, "Authorization") ?? "",
      new RegExp(serverSecret),
    );
    return new Response(validAnswer, { status: 200 });
  };

  try {
    const response = await POST(
      sessionRequest({ Authorization: `Bearer ${temporarySecret}` }),
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), validAnswer);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("a malformed temporary bearer is rejected instead of using server fallback", async () => {
  const { POST } = await loadRealtimeRoute();
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  let upstreamCalled = false;

  process.env.OPENAI_API_KEY = "test-server-secret-must-not-be-used";
  globalThis.fetch = async () => {
    upstreamCalled = true;
    return new Response(validAnswer, { status: 200 });
  };

  try {
    const response = await POST(
      sessionRequest({ Authorization: "Bearer not-a-standard-openai-key" }),
    );
    const body = await response.text();

    assert.equal(response.status, 401);
    assert.equal(upstreamCalled, false);
    assert.match(body, /temporary OpenAI API key is invalid/i);
    assert.doesNotMatch(body, /not-a-standard-openai-key/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("Realtime setup never echoes or logs a rejected temporary key", async () => {
  const { POST } = await loadRealtimeRoute();
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  const previousConsoleError = console.error;
  const temporarySecret = ["sk", "test-temporary-secret-never-logged"].join("-");
  const logged = [];

  delete process.env.OPENAI_API_KEY;
  console.error = (...values) => {
    logged.push(
      values
        .map((value) =>
          typeof value === "string" ? value : JSON.stringify(value),
        )
        .join(" "),
    );
  };
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: { message: `Rejected credential ${temporarySecret}` },
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "req_rejected_temporary_key",
        },
      },
    );

  try {
    const response = await POST(
      sessionRequest({ Authorization: `Bearer ${temporarySecret}` }),
    );
    const body = await response.text();
    const observableOutput = [
      body,
      JSON.stringify([...response.headers]),
      logged.join("\n"),
    ].join("\n");

    assert.equal(response.status, 401);
    assert.match(body, /rejected the temporary API key/i);
    assert.doesNotMatch(observableOutput, new RegExp(temporarySecret));
    assert.doesNotMatch(observableOutput, /Rejected credential/i);
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousConsoleError;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("voice guide keeps a private, low-latency audio-only Realtime flow", async () => {
  const [dock, hook, route, experience, canvas] = await Promise.all([
    readSource("app/components/assistant/AssistantDock.tsx"),
    readSource("app/components/assistant/useRealtimeAssistant.ts"),
    readSource("app/api/realtime/session/route.ts"),
    readSource("app/components/TrainingExperience.tsx"),
    readSource("app/components/TrainingWorldCanvas.tsx"),
  ]);

  assert.match(dock, /Meet your guide/);
  assert.match(dock, /hold V.*ask about this/i);
  assert.match(dock, /aria-label="Hold to ask the guide/);
  assert.match(dock, /onPointerDown/);
  assert.match(dock, /onPointerUp/);
  assert.match(dock, /onKeyDown/);
  assert.match(dock, /onKeyUp/);
  assert.match(dock, /Temporary bring-your-own-key mode/);
  assert.match(dock, /Temporary API key/);
  assert.match(dock, /type="password"/);
  assert.match(dock, /autoComplete="off"/);
  assert.match(dock, /Connect for this session/);
  assert.match(dock, /Use configured server key/);
  assert.match(dock, /Try another key/);
  assert.match(
    dock,
    /Temporary testing only\. A server-side key is safer for regular use\./,
  );
  assert.match(dock, /if \(!enabled\)[\s\S]*if \(showKeyEntry\)/);
  assert.match(
    dock,
    /status === "error"[\s\S]*onDisable\(\);[\s\S]*setShowKeyEntry\(true\)/,
  );
  assert.match(dock, /setTemporaryApiKey\(""\)/);
  assert.doesNotMatch(
    dock,
    /navigate|direct the lesson|control the lesson|next chamber/i,
  );

  assert.match(hook, /new RTCPeerConnection\(\)/);
  assert.match(hook, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(hook, /DEFAULT_SESSION_ENDPOINT\s*=\s*"\/api\/realtime\/session"/);
  assert.match(hook, /conversation\.item\.create/);
  assert.match(hook, /APPLICATION_CONTEXT_FOR_NEXT_USER_TURN/);
  assert.match(hook, /APPLICATION_SPOTLIGHT_CONTEXT/);
  assert.match(hook, /persistentContext/);
  assert.match(hook, /reasoning:\s*\{\s*effort:\s*"low"/);
  assert.match(hook, /eagerness:\s*currentOptions\.semanticVadEagerness\s*\?\?\s*"high"/);
  assert.match(hook, /interrupt_response:\s*true/);
  assert.match(hook, /voice-guide:turn-/);
  assert.match(hook, /vad-to-first-output/);
  assert.doesNotMatch(
    hook,
    /function_call|onToolCall|tool_choice|gpt-4o-mini-transcribe/,
  );
  assert.match(hook, /enable\s*=\s*useCallback\(async \(temporaryApiKey\?: string\)/);
  assert.match(hook, /function isSecureSameOriginEndpoint\(endpoint: URL\)/);
  assert.match(hook, /endpoint\.origin\s*!==\s*window\.location\.origin/);
  assert.match(hook, /endpoint\.protocol\s*===\s*"https:"/);
  assert.match(hook, /\["localhost", "127\.0\.0\.1", "::1", "\[::1\]"\]/);
  assert.match(hook, /!isSecureSameOriginEndpoint\(sessionEndpoint\)/);
  assert.match(
    hook,
    /sessionHeaders\.set\("Authorization", `Bearer \$\{requestApiKey\}`\)/,
  );
  assert.match(hook, /sessionHeaders\?\.delete\("Authorization"\)/);
  assert.match(hook, /setupHeadersRef\.current\?\.delete\("Authorization"\)/);
  assert.match(hook, /temporaryApiKeyRef\.current\s*=\s*null/);
  assert.doesNotMatch(hook, /OPENAI_API_KEY|api\.openai\.com/);

  assert.match(experience, /event\.code\s*!==\s*"KeyV"/);
  assert.match(experience, /buildAssistantTurnContextSnapshot/);
  assert.match(experience, /persistentContext:\s*spotlightContext/);
  assert.match(experience, /semanticVadEagerness:\s*"high"/);
  assert.match(
    experience,
    /buildAssistantContextSnapshot\(\s*targetId,\s*Boolean\(componentProcess\)/,
  );
  assert.match(experience, /resolveComponentProcessDefinition\(targetId\)/);
  assert.match(experience, /setProcessPlaying\(false\)/);
  assert.match(experience, /restoreComponentReplayTransport/);
  assert.match(experience, /startTalking\(\)/);
  assert.doesNotMatch(
    experience,
    /ASSISTANT_APP_TOOLS|onToolCall|handleAssistantToolCall|assistantAppTools/,
  );
  assert.match(experience, /voice\.enable\(temporaryApiKey\)/);
  assert.match(canvas, /new THREE\.Raycaster\(\)/);
  assert.match(canvas, /createAssistantController/);
  assert.match(canvas, /resolveAssistantTarget/);
  assert.match(canvas, /componentProcessProgressAt/);
  assert.match(canvas, /focusReplayProgress/);
  assert.match(canvas, /findComponentProcessObjects/);
  assert.match(canvas, /findComponentProcessAuxiliaryObjects/);
  assert.match(canvas, /syncFocusStage/);
  assert.match(canvas, /participantTargetIds/);
  assert.match(canvas, /processLocked/);
  assert.match(
    experience,
    /progress:\s*dataPreparation\s*\?\s*dataPrepProgress\s*:\s*processProgress/,
  );
  assert.match(route, /process\.env\.OPENAI_API_KEY/);
  assert.match(route, /temporaryBearerKey/);
  assert.match(route, /request\.headers\.get\("authorization"\)/);
  assert.match(route, /api\.openai\.com\/v1\/realtime\/calls/);
  assert.match(route, /output_modalities:\s*\["audio"\]/);
  assert.match(route, /reasoning:\s*\{\s*effort:\s*"low"/);
  assert.match(route, /tools:\s*\[\]/);
  assert.match(route, /tool_choice:\s*"none"/);
  assert.match(route, /eagerness:\s*"high"/);
  assert.doesNotMatch(route, /gpt-4o-mini-transcribe/);
  assert.doesNotMatch(route, /NEXT_PUBLIC_OPENAI|PUBLIC_OPENAI/);

  const browserCredentialSources = [dock, hook, experience].join("\n");
  assert.doesNotMatch(
    browserCredentialSources,
    /localStorage|sessionStorage|document\.cookie|cookieStore|indexedDB|URLSearchParams/,
    "temporary keys must never be persisted in browser storage or URLs",
  );
  assert.doesNotMatch(
    `${browserCredentialSources}\n${route}`,
    /console\.(?:log|info|warn|error)\([^)]*(?:temporaryApiKey|requestApiKey|apiKey|authorization)/is,
    "credential variables must never be written to logs",
  );
});
