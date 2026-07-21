import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);
const appUrl = new URL("../app/", import.meta.url);

const fileUrl = (path) => new URL(path, rootUrl);
const readSource = (path) => readFile(fileUrl(path), "utf8");

async function render(pathname = "/") {
  const workerUrl = fileUrl("dist/server/index.js");
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(pathname, "http://localhost/"), {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

let traceModulePromise;
async function loadTrainingTrace() {
  if (!traceModulePromise) {
    traceModulePromise = readSource("app/lib/trainingTrace.ts").then((source) => {
      const javascript = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: "trainingTrace.ts",
      }).outputText;
      const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
      return import(moduleUrl);
    });
  }
  return traceModulePromise;
}

let trainingCodeModulePromise;
async function loadTrainingCode() {
  if (!trainingCodeModulePromise) {
    trainingCodeModulePromise = readSource("app/lib/generatedTrainingCode.ts").then(
      (source) => {
        const javascript = ts.transpileModule(source, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
          fileName: "generatedTrainingCode.ts",
        }).outputText;
        const moduleUrl = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
        return import(moduleUrl);
      },
    );
  }
  return trainingCodeModulePromise;
}

function assertNear(actual, expected, tolerance = 1e-9, label = "value") {
  assert.equal(Number.isFinite(actual), true, `${label} must be finite`);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`,
  );
}

function hasMeta(html, attribute, value, contentPattern) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  return tags.some((tag) => {
    const declaration = new RegExp(`\\b${attribute}=["']${value}["']`, "i");
    const content = /\bcontent=["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    return declaration.test(tag) && contentPattern.test(content);
  });
}

test("production worker renders the finished training experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Inside One Training Step<\/title>/i);
  assert.match(html, /Inside one training step controls/i);
  assert.match(html, /Hide interface panels/i);
  assert.match(html, /The Training Complex/i);
  assert.match(html, /Training step phases/i);
  assert.match(html, /Story(?: view)?/i);
  assert.match(html, /Structure(?: view)?/i);
  assert.match(html, /Math(?: view)?/i);
  assert.match(html, /Code(?: view)?/i);
  assert.match(html, /Overview/i);
  assert.match(html, /Learn/i);
  assert.match(html, /Explore/i);
  assert.match(html, /Forward/i);
  assert.match(html, /Loss/i);
  assert.match(html, /Backward/i);
  assert.match(html, /Update/i);
  assert.match(html, /Train your own model/i);

  assert.doesNotMatch(
    html,
    /codex-preview|Your site is taking shape|Codex is working|react-loading-skeleton/i,
  );
});

test("custom training chamber renders a truthful local-training setup", async () => {
  const response = await render("/custom-training");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Custom Training Chamber/i);
  assert.match(html, /Train a model on your own text/i);
  assert.match(html, /Your training corpus/i);
  assert.match(html, /Training choices/i);
  assert.match(html, /Start real training/i);
  assert.match(html, /Local trainer/i);
  assert.doesNotMatch(html, /mock training|simulated loss/i);
});

test("completed runs expose real checkpoint-backed model sampling", async () => {
  const [chamber, lab, client] = await Promise.all([
    readSource("app/components/custom-training/CustomTrainingChamber.tsx"),
    readSource("app/components/custom-training/ModelTestLab.tsx"),
    readSource("app/lib/trainingClient.ts"),
  ]);

  assert.match(chamber, />Test your model</i);
  assert.match(lab, /Test your trained model/i);
  assert.match(lab, /Generate continuation/i);
  assert.match(lab, /UTF-8 bytes/i);
  assert.match(lab, /Novel-looking text is not proof of generalization/i);
  assert.match(lab, /checkpointKind/);
  assert.match(client, /generateFromTrainingRun/);
  assert.match(client, /\/generate/);
  assert.doesNotMatch(`${chamber}\n${lab}\n${client}`, /mock (?:model|output|generation)/i);
});

test("interrupted runs expose checkpoint recovery without re-uploading the corpus", async () => {
  const [chamber, client, types, service] = await Promise.all([
    readSource("app/components/custom-training/CustomTrainingChamber.tsx"),
    readSource("app/lib/trainingClient.ts"),
    readSource("app/lib/customTrainingTypes.ts"),
    readSource("trainer/src/chamber_trainer/service.py"),
  ]);

  assert.match(client, /resumeTrainingRunFromCheckpoint/);
  assert.match(client, /\/resume-from-checkpoint/);
  assert.match(types, /canResumeFromCheckpoint:\s*boolean/);
  assert.match(types, /resumeCheckpointStep:\s*number\s*\|\s*null/);
  assert.match(chamber, />\s*Resume from checkpoint\s*</i);
  assert.match(chamber, /npm run dev:training/i);
  assert.match(chamber, /run[^.]+once/i);
  assert.match(chamber, /Leave it open/i);
  assert.match(chamber, /Local URL/i);
  assert.match(chamber, /original PowerShell window is not required/i);
  assert.match(chamber, /do not run[^.]+second copy/i);
  assert.match(chamber, /reuse this run's prepared corpus/i);
  assert.match(chamber, /bridge !== "online"/);
  assert.match(service, /def resume_from_checkpoint/);
  assert.match(service, /"data",\s*"train\.bin"/);
  assert.match(chamber, /does\s+not need to be uploaded again/i);
});

test("the local launcher enforces one ownership-aware trainer companion", async () => {
  const [launcher, service] = await Promise.all([
    readSource("scripts/start-training-chamber.mjs"),
    readSource("trainer/src/chamber_trainer/service.py"),
  ]);

  assert.match(launcher, /randomUUID/);
  assert.match(launcher, /CHAMBER_TRAINER_INSTANCE_ID/);
  assert.match(launcher, /health\?\.instanceId !== trainerInstanceId/);
  assert.match(launcher, /Run `npm run dev:training` only once/);
  assert.match(launcher, /requestTrainerStop: false/);
  assert.match(service, /SO_EXCLUSIVEADDRUSE/);
  assert.match(service, /allow_reuse_address = os\.name != "nt"/);
  assert.match(service, /Bind before loading durable run state/);
});

test("site metadata references the bespoke assistant social card", async () => {
  const response = await render();
  const html = await response.text();

  assert.equal(
    hasMeta(html, "name", "description", /interactive|forward pass/i),
    true,
    "site description metadata should describe the training experience",
  );
  assert.equal(
    hasMeta(html, "property", "og:title", /^Inside One Training Step$/i),
    true,
    "Open Graph title is missing",
  );
  assert.equal(
    hasMeta(html, "property", "og:image", /\/og-assistant\.png(?:$|\?)/i),
    true,
    "Open Graph image is missing",
  );
  assert.equal(
    hasMeta(html, "name", "twitter:card", /^summary_large_image$/i),
    true,
    "large Twitter card metadata is missing",
  );
  assert.equal(
    hasMeta(html, "name", "twitter:image", /\/og-assistant\.png(?:$|\?)/i),
    true,
    "Twitter image is missing",
  );

  const image = await readFile(fileUrl("public/og-assistant.png"));
  assert.deepEqual(
    [...image.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    "social card must be a valid PNG",
  );
  assert.equal(image.readUInt32BE(16), 1672);
  assert.equal(image.readUInt32BE(20), 941);
  assert.ok((await stat(fileUrl("public/og-assistant.png"))).size > 20_000);
});

test("starter preview and starter metadata are fully removed", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readSource("app/page.tsx"),
    readSource("app/layout.tsx"),
    readSource("package.json"),
  ]);

  await assert.rejects(access(new URL("_sites-preview/", appUrl)));
  assert.doesNotMatch(
    `${page}\n${layout}\n${packageJson}`,
    /codex-preview|_sites-preview|react-loading-skeleton|Starter Project|Your site is taking shape/i,
  );
  assert.match(layout, /Inside One Training Step/);
  assert.match(layout, /\/og-assistant\.png/);
  assert.match(layout, /openGraph\s*:/);
  assert.match(layout, /twitter\s*:/);
});

test("package scripts preserve build, test, and Bun server contracts", async () => {
  const packageJson = JSON.parse(await readSource("package.json"));

  assert.match(packageJson.scripts.build, /\bvinext\s+build\b/);
  assert.match(packageJson.scripts.start, /\bvinext\s+start\b/);
  assert.match(packageJson.scripts.server, /\bvinext\s+build\b/);
  assert.match(packageJson.scripts.server, /\bvinext\s+start\b/);
  assert.match(packageJson.scripts.test, /npm\s+run\s+build/);
  assert.match(packageJson.scripts.test, /node\s+--test/);
});

test("the authored world contains 25 unique stations and six real branches", async () => {
  const { TRAINING_STATIONS } = await loadTrainingTrace();
  assert.equal(TRAINING_STATIONS.length, 25);
  assert.equal(new Set(TRAINING_STATIONS.map(({ id }) => id)).size, 25);

  const branches = TRAINING_STATIONS.filter(({ branch }) => branch).map(
    ({ branch }) => branch,
  );
  assert.equal(branches.length, 6);
  for (const branch of branches) {
    assert.ok(branch.left.length > 3);
    assert.ok(branch.right.length > 3);
    assert.ok(["left", "right"].includes(branch.default));
    assert.notEqual(branch.left, branch.right);
  }

  for (const station of TRAINING_STATIONS) {
    assert.match(station.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(station.title.length > 3);
    assert.ok(station.story.length > 40);
    assert.ok(station.structure.length > 40);
    assert.ok(station.math.length > 20);
    assert.ok(station.breadcrumb.length > 0);
    assert.ok(Number.isInteger(station.zoomBand));
    assert.ok(station.zoomBand >= 0 && station.zoomBand <= 7);
  }
});

test("every station is connected to an excerpt from the runnable trainer", async () => {
  const [{ TRAINING_STATIONS }, codeModule, hud, packageJsonSource] = await Promise.all([
    loadTrainingTrace(),
    loadTrainingCode(),
    readSource("app/components/TrainingHUD.tsx"),
    readSource("package.json"),
  ]);
  const { FULL_TRAINING_LOOP, TRAINING_CODE_EXCERPTS } = codeModule;
  const stationIds = TRAINING_STATIONS.map(({ id }) => id);

  assert.equal(TRAINING_CODE_EXCERPTS.length, 25);
  assert.deepEqual(
    TRAINING_CODE_EXCERPTS.map(({ stationId }) => stationId),
    stationIds,
  );
  assert.equal(new Set(TRAINING_CODE_EXCERPTS.map(({ stationId }) => stationId)).size, 25);
  for (const excerpt of TRAINING_CODE_EXCERPTS) {
    assert.match(excerpt.file, /^trainer\/src\/chamber_trainer\/.*\.py$/);
    assert.match(excerpt.symbol, /^[A-Za-z_][A-Za-z0-9_]*$/);
    assert.ok(excerpt.code.trim().length > 12, `${excerpt.stationId} needs real code`);
    assert.ok(excerpt.note.length > 30, `${excerpt.stationId} needs context`);
    const source = await readSource(excerpt.file);
    assert.match(source, new RegExp(`# chamber:${excerpt.stationId}:start`));
    assert.match(source, new RegExp(`# chamber:${excerpt.stationId}:end`));
  }

  const byId = new Map(
    TRAINING_CODE_EXCERPTS.map((excerpt) => [excerpt.stationId, excerpt]),
  );
  assert.match(byId.get("batch-shifted-targets").code, /\[:,\s*:-1\]/);
  assert.match(byId.get("batch-shifted-targets").code, /\[:,\s*1:\]/);
  assert.match(byId.get("loss").code, /cross_entropy/);
  assert.match(byId.get("output-backprop").code, /backward\s*\(/);
  assert.match(byId.get("adamw-state").code, /AdamW/);
  assert.match(FULL_TRAINING_LOOP.file, /^trainer\/src\/chamber_trainer\/.*\.py$/);
  assert.match(FULL_TRAINING_LOOP.code, /for\s+step|while\s+/);
  assert.match(FULL_TRAINING_LOOP.code, /optimizer/);
  assert.match(hud, /Full training loop/);
  assert.match(hud, /aria-modal="true"/);

  const packageJson = JSON.parse(packageJsonSource);
  assert.match(packageJson.scripts["code:sync"], /sync-training-code\.mjs/);
  assert.match(packageJson.scripts["code:check"], /--check/);
  assert.match(packageJson.scripts.prebuild, /code:sync/);
});

test("station phases tell one ordered forward-loss-backward-update story", async () => {
  const { PHASE_COLORS, TRAINING_STATIONS } = await loadTrainingTrace();
  const requiredPhases = [
    "overview",
    "data",
    "forward",
    "loss",
    "backward",
    "update",
  ];
  assert.deepEqual(Object.keys(PHASE_COLORS).sort(), [...requiredPhases].sort());

  const usedPhases = new Set(TRAINING_STATIONS.map(({ phase }) => phase));
  assert.deepEqual([...usedPhases].sort(), [...requiredPhases].sort());

  const first = (phase) => TRAINING_STATIONS.findIndex((station) => station.phase === phase);
  assert.ok(first("data") > first("overview"));
  assert.ok(first("forward") > first("data"));
  assert.ok(first("loss") > first("forward"));
  assert.ok(first("backward") > first("loss"));
  assert.ok(first("update") > first("backward"));
  assert.equal(TRAINING_STATIONS.at(-1).phase, "overview");
});

test("teaching dimensions and selected attention/loss values are coherent", async () => {
  const { SELECTED_NUMERIC_TRACE: trace, TEACHING_MODEL: model } =
    await loadTrainingTrace();

  assert.deepEqual(model, {
    batchSize: 2,
    sequenceLength: 6,
    vocabularySize: 16,
    modelWidth: 8,
    attentionHeads: 2,
    headWidth: 4,
    transformerBlocks: 2,
    feedForwardWidth: 32,
    validTokens: 12,
  });
  assert.equal(model.attentionHeads * model.headWidth, model.modelWidth);
  assert.equal(model.batchSize * model.sequenceLength, model.validTokens);
  assert.equal(trace.vocabulary.length, model.vocabularySize);
  assert.equal(trace.embedding.selectedTokenVector.length, model.modelWidth);
  assert.equal(trace.embedding.selectedPositionVector.length, model.modelWidth);
  assert.equal(trace.embedding.selectedHiddenVector.length, model.modelWidth);
  trace.embedding.selectedHiddenVector.forEach((value, index) =>
    assertNear(
      trace.embedding.selectedTokenVector[index] +
        trace.embedding.selectedPositionVector[index],
      value,
      1e-12,
      `embedding sum ${index}`,
    ),
  );

  const selectedDots = trace.attention.allowedKeys.map((key) =>
    key.reduce((sum, value, index) => sum + value * trace.attention.query[index], 0),
  );
  selectedDots.forEach((value, index) =>
    assertNear(value, trace.attention.rawDotProducts[index], 1e-12, `dot ${index}`),
  );
  trace.attention.attentionWeights.slice(0, 3).reduce((sum, weight) => sum + weight, 0);
  assertNear(
    trace.attention.attentionWeights.reduce((sum, weight) => sum + weight, 0),
    1,
    1e-9,
    "attention weights",
  );
  assert.deepEqual(trace.attention.attentionWeights.slice(3), [0, 0, 0]);

  const weightedValue = trace.attention.allowedValues[0].map((_, channel) =>
    trace.attention.allowedValues.reduce(
      (sum, value, index) =>
        sum + value[channel] * trace.attention.attentionWeights[index],
      0,
    ),
  );
  weightedValue.forEach((value, index) =>
    assertNear(value, trace.attention.weightedValue[index], 1e-9, `weighted value ${index}`),
  );

  const probabilitySum = trace.output.selectedProbabilities.reduce(
    (sum, probability) => sum + probability,
    0,
  );
  assertNear(probabilitySum, 1, 1e-12, "vocabulary probabilities");
  assertNear(
    -Math.log(trace.output.selectedCorrectProbability),
    trace.output.selectedTokenLoss,
    1e-9,
    "selected cross-entropy",
  );
  const flattenedLosses = trace.output.perTokenLosses.flat();
  assert.equal(flattenedLosses.length, model.validTokens);
  assertNear(
    flattenedLosses.reduce((sum, loss) => sum + loss, 0) / flattenedLosses.length,
    trace.output.meanLoss,
    1e-9,
    "mean loss",
  );
  assertNear(
    (trace.output.selectedCorrectProbability - 1) / model.validTokens,
    trace.output.selectedTargetLogitGradient,
    1e-12,
    "target-logit gradient",
  );
  assertNear(
    trace.output.selectedCompetitorProbability / model.validTokens,
    trace.output.selectedCompetitorLogitGradient,
    1e-9,
    "competitor-logit gradient",
  );
});

test("the data chamber exposes one coherent staged tokenizer trace", async () => {
  const {
    DATA_PREP_STAGES,
    DATA_PREP_TRACE,
    SELECTED_NUMERIC_TRACE,
  } = await loadTrainingTrace();
  const [canvas, experience, hud] = await Promise.all([
    readSource("app/components/TrainingWorldCanvas.tsx"),
    readSource("app/components/TrainingExperience.tsx"),
    readSource("app/components/TrainingHUD.tsx"),
  ]);

  assert.equal(DATA_PREP_STAGES.length, 6);
  assert.deepEqual(
    DATA_PREP_STAGES.map(({ start }) => start),
    [...DATA_PREP_STAGES.map(({ start }) => start)].sort((a, b) => a - b),
  );
  assert.deepEqual(DATA_PREP_TRACE.tokenIds, [
    [1, 3, 4, 5, 6, 3, 7],
    [1, 8, 9, 10, 11, 12, 2],
  ]);
  assert.deepEqual(
    DATA_PREP_TRACE.tokens,
    DATA_PREP_TRACE.tokenIds.map((row) =>
      row.map((tokenId) => SELECTED_NUMERIC_TRACE.vocabulary[tokenId]),
    ),
  );
  assert.match(
    canvas,
    /addOpenCorpusArena\(context, openObservationArenaSize, CORPUS_ARENA_HEIGHT\)/,
  );
  assert.match(canvas, /new THREE\.Vector2\(140, 90\)/);
  assert.match(canvas, /index === 1\s*\? state\.dataPrepProgress/);
  assert.match(
    canvas,
    /runtime\.update\?\.\(runtimeProgress, elapsed, !reduceProcessMotion\)/,
  );
  assert.match(experience, /DATA_PREP_DURATION_SECONDS/);
  assert.match(experience, /dataPrepBlocking/);
  assert.match(experience, /reduceMotion \? 1 : 0/);
  assert.match(hud, /representativeProgress/);
  assert.match(hud, /data-prep-stage-title/);
  assert.match(hud, /data-testid="data-prep-play"/);
});

test("selected AdamW values reproduce the exact stored weight update", async () => {
  const { SELECTED_NUMERIC_TRACE } = await loadTrainingTrace();
  const optimizer = SELECTED_NUMERIC_TRACE.optimizer;

  const moment =
    optimizer.beta1 * optimizer.momentBefore +
    (1 - optimizer.beta1) * optimizer.gradient;
  const variance =
    optimizer.beta2 * optimizer.varianceBefore +
    (1 - optimizer.beta2) * optimizer.gradient ** 2;
  const correctedMoment = moment / (1 - optimizer.beta1 ** optimizer.step);
  const correctedVariance = variance / (1 - optimizer.beta2 ** optimizer.step);
  const normalized =
    correctedMoment / (Math.sqrt(correctedVariance) + optimizer.epsilon);
  const adamComponent = -optimizer.learningRate * normalized;
  const decayComponent =
    -optimizer.learningRate * optimizer.weightDecay * optimizer.weightBefore;
  const delta = adamComponent + decayComponent;
  const after = optimizer.weightBefore + delta;

  assertNear(optimizer.momentAfter, moment, 1e-15, "first moment");
  assertNear(optimizer.varianceAfter, variance, 1e-18, "second moment");
  assertNear(optimizer.biasCorrectedMoment, correctedMoment, 1e-15, "corrected moment");
  assertNear(
    optimizer.biasCorrectedVariance,
    correctedVariance,
    1e-15,
    "corrected variance",
  );
  assertNear(optimizer.normalizedGradient, normalized, 1e-9, "normalized gradient");
  assertNear(optimizer.adamComponent, adamComponent, 1e-12, "Adam component");
  assertNear(optimizer.decayComponent, decayComponent, 1e-15, "decay component");
  assertNear(optimizer.deltaWeight, delta, 1e-12, "weight delta");
  assertNear(optimizer.weightAfter, after, 1e-12, "updated weight");
  assertNear(
    optimizer.weightAfter - optimizer.weightBefore,
    optimizer.deltaWeight,
    1e-15,
    "stored before/after relationship",
  );
});

test("semantic process lines stay lightweight while navigation avoids a visible guide", async () => {
  const [canvas, experience, hud] = await Promise.all([
    readSource("app/components/TrainingWorldCanvas.tsx"),
    readSource("app/components/TrainingExperience.tsx"),
    readSource("app/components/TrainingHUD.tsx"),
  ]);

  const lineHelper = /function\s+addLine\b[\s\S]*?return\s+line;\s*}/.exec(canvas)?.[0] ?? "";
  assert.match(lineHelper, /new\s+THREE\.LineBasicMaterial\s*\(/);
  assert.match(lineHelper, /transparent\s*:\s*true/);
  assert.match(lineHelper, /new\s+THREE\.Line\s*\(/);
  assert.doesNotMatch(lineHelper, /TubeGeometry|addTube/);

  assert.match(canvas, /function\s+createCameraRoute\s*\(/);
  assert.match(canvas, /new\s+THREE\.CatmullRomCurve3\s*\(/);
  assert.doesNotMatch(
    canvas,
    /createGuideTrack|semantic-guide-track/,
    "navigation should not draw a route line across chamber surfaces",
  );

  for (const code of ["KeyW", "KeyS", "KeyA", "KeyD"]) {
    assert.match(
      canvas,
      new RegExp(`["']${code}["']`),
      `${code} should be owned by the real-time canvas controller`,
    );
  }
  assert.match(canvas, /addEventListener\s*\(\s*["']keydown["']/);
  assert.match(canvas, /addEventListener\s*\(\s*["']keyup["']/);
  assert.doesNotMatch(
    experience,
    /event\.code\s*===\s*["']Key[WSAD]["']/,
    "the React journey shell must not also consume FPS movement keys",
  );
  assert.match(canvas, /requestPointerLock\s*\(/);
  assert.match(canvas, /pointerlockchange/i);
  assert.match(canvas, /pointerLockElement/);
  assert.match(
    canvas,
    /canvas\.addEventListener\(\s*["']wheel["']\s*,\s*onWheel\s*,\s*\{\s*passive:\s*false\s*}\s*\)/,
    "directional wheel movement must stay on the canvas and be able to suppress page scrolling",
  );
  assert.match(
    canvas,
    /canvas\.removeEventListener\(\s*["']wheel["']\s*,\s*onWheel\s*\)/,
  );
  assert.doesNotMatch(canvas, /window\.addEventListener\(\s*["']wheel["']/);
  assert.match(
    canvas,
    /const\s+onWheel[\s\S]*?event\.preventDefault\(\)[\s\S]*?beginManualControl\(\)[\s\S]*?pendingDollyDistance/,
    "the wheel should take over from the guided ride and queue a spatial dolly",
  );
  assert.match(canvas, /WheelEvent\.DOM_DELTA_LINE/);
  assert.match(canvas, /WheelEvent\.DOM_DELTA_PAGE/);
  assert.match(
    canvas,
    /\.set\(0,\s*0,\s*-1\)[\s\S]*?\.applyQuaternion\(glanceQuaternion\)/,
    "wheel movement should follow the full pitch-aware view vector",
  );
  assert.match(canvas, /frameDollyDistance\s*\*\s*-dollyDirection\.z/);
  assert.match(
    canvas,
    /Math\.ceil\(movementDistance\s*\/\s*0\.32\)/,
    "large wheel impulses should be subdivided before collision resolution",
  );
  assert.match(canvas, /insidePortal\(crossingX,\s*crossingY\)/);
  assert.doesNotMatch(canvas, /zoomScaleTarget|zoomedFov/);
  assert.match(canvas, /const\s+beginManualControl\s*=\s*\(\)\s*=>/);
  assert.match(
    canvas,
    /const\s+onPointerDown[\s\S]*?beginManualControl\(\)[\s\S]*?requestPointerLock/,
    "clicking the scene should seed and enter manual control before pointer lock",
  );
  assert.doesNotMatch(
    canvas,
    /manualOverride\s*=\s*!latest\.current\.playing/,
    "pausing a guided camera must not teleport the visitor into free roam",
  );
  assert.match(
    canvas,
    /mousemove|onMouseMove/i,
    "the 3D view should update its look direction from locked mouse movement",
  );
  for (const code of ["KeyQ", "KeyE"]) {
    assert.match(
      experience,
      new RegExp(`event\\.code\\s*===\\s*["']${code}["']`),
      `${code} should select a teaching branch without conflicting with strafing`,
    );
  }
  assert.match(hud, /<kbd>W<\/kbd>[\s\S]*?<kbd>S<\/kbd>/);
  assert.match(hud, /<kbd>A<\/kbd>[\s\S]*?<kbd>D<\/kbd>/);
  assert.match(hud, /<kbd>Shift<\/kbd>/i);
  assert.match(hud, /<kbd>Q<\/kbd>[\s\S]*?<kbd>E<\/kbd>/);
  assert.match(hud, /Mouse[\s\S]*?Look around/i);
  assert.match(hud, /Wheel[\s\S]*?Move toward \/ away/i);
  assert.match(hud, /useState\(false\)[\s\S]*?hudMinimized/);
  assert.match(hud, /Show interface panels[\s\S]*?Hide interface panels/);
  assert.match(hud, /styles\.rootMinimized/);
});

test("the data-preparation chamber is a readable open observation arena", async () => {
  const canvas = await readSource("app/components/TrainingWorldCanvas.tsx");
  const corpusBuilder =
    /function\s+buildCorpus\s*\([\s\S]*?\n}\s*\n\s*function\s+buildTokenStream\s*\(/.exec(
      canvas,
    )?.[0] ?? "";

  assert.ok(corpusBuilder.length > 0, "buildCorpus source should be discoverable");
  assert.doesNotMatch(
    corpusBuilder,
    /\baddShell\s*\(/,
    "the corpus arena should not be enclosed by the standard close chamber shell",
  );
  assert.match(corpusBuilder, /\b140(?:\.0+)?\b/, "the open arena should be about 140 units wide");
  assert.match(corpusBuilder, /\b90(?:\.0+)?\b/, "the open arena should be about 90 units deep");
  assert.match(
    corpusBuilder,
    /open|arena|ground|floor/i,
    "the expanded dimensions should belong to an explicit open observation surface",
  );
  assert.match(canvas, /portalCenterX:\s*0/);
  assert.match(canvas, /const\s+CORPUS_ARENA_HEIGHT\s*=\s*120/);
  assert.match(canvas, /const\s+arenaTopY\s*=\s*floorY\s*\+\s*arenaHeight/);
  assert.match(canvas, /maxY:\s*arenaTopY\s*-\s*1/);
  assert.match(
    canvas,
    /arenaCenterZ\s*\+\s*arenaSize\.y\s*\*\s*0\.35/,
  );
  assert.match(canvas, /portalMinY:\s*-4\.15/);
  assert.match(canvas, /portalMaxY:\s*3\.95/);
  assert.match(canvas, /guidedViewDistance:\s*38/);
  assert.match(canvas, /arenaOutlineAt\(floorY\s*\+\s*arenaHeight\s*\*\s*level\)/);
  assert.match(corpusBuilder, /navigationBounds\.blockers/);
  assert.match(corpusBuilder, /const\s+maxY\s*=\s*8\.5/);
  assert.match(
    corpusBuilder,
    /const\s+observationPoint\s*=\s*context\.navigationBounds\?\.spawn\.clone\(\)/,
  );

  const spacingMatch = /const\s+STATION_SPACING\s*=\s*(\d+(?:\.\d+)?)/.exec(canvas);
  assert.ok(spacingMatch, "station spacing should remain an explicit world-layout constant");
  assert.ok(
    Number(spacingMatch[1]) >= 90,
    `station spacing must clear the expanded arena; received ${spacingMatch[1]}`,
  );

  const centersSource =
    /const\s+stageCenters\s*=\s*\[([\s\S]*?)\];/.exec(corpusBuilder)?.[1] ?? "";
  const centers = [...centersSource.matchAll(
    /new\s+THREE\.Vector3\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g,
  )].map((match) => ({ x: Number(match[1]), z: Number(match[3]) }));

  assert.equal(centers.length, 6, "the tokenizer story should retain six process stages");
  const stageGaps = centers.slice(1).map((center, index) =>
    Math.hypot(center.x - centers[index].x, center.z - centers[index].z),
  );
  assert.ok(
    stageGaps.every((gap) => gap >= 10),
    `each process stage needs a readable gap of at least 10 units; received ${stageGaps.join(", ")}`,
  );
  assert.ok(
    Math.hypot(
      centers.at(-1).x - centers[0].x,
      centers.at(-1).z - centers[0].z,
    ) >= 50,
    "the complete process should span enough space to make transfers visually legible",
  );
});

test("distinct chamber builders cover every non-Corpus station with trace-correct operations", async () => {
  const [
    { TRAINING_STATIONS },
    canvas,
    chamberIndex,
    early,
    attention,
    learning,
    shared,
  ] = await Promise.all([
    loadTrainingTrace(),
    readSource("app/components/TrainingWorldCanvas.tsx"),
    readSource("app/components/chambers/index.ts"),
    readSource("app/components/chambers/earlyProcesses.ts"),
    readSource("app/components/chambers/attentionProcesses.ts"),
    readSource("app/components/chambers/learningProcesses.ts"),
    readSource("app/components/chambers/processShared.ts"),
  ]);

  const caseIds = (source) =>
    [...source.matchAll(/case\s+"([^"]+)":/g)].map((match) => match[1]);
  const countMatches = (source, pattern) => (source.match(pattern) ?? []).length;
  const earlyCases = caseIds(early);
  const attentionCases = caseIds(attention);
  const learningCases = caseIds(learning);
  const expectedIds = TRAINING_STATIONS.map((station) => station.id).filter(
    (id) => id !== "corpus-data-preparation",
  );
  const coveredIds = [
    ...earlyCases.filter((id) => id !== "corpus-data-preparation"),
    ...attentionCases,
    ...learningCases,
  ];
  const covered = new Set(coveredIds);

  assert.equal(TRAINING_STATIONS.length, 25);
  assert.equal(expectedIds.length, 24);
  assert.equal(coveredIds.length, covered.size, "station dispatchers must not overlap");
  assert.deepEqual(covered, new Set(expectedIds));
  assert.deepEqual(
    new Set(earlyCases.filter((id) => id !== "corpus-data-preparation")),
    new Set([
      "training-complex",
      "token-stream-context",
      "batch-shifted-targets",
      "embedding",
      "transformer-tower",
      "transformer-block",
      "multi-head-attention",
    ]),
  );
  assert.deepEqual(
    new Set(attentionCases),
    new Set([
      "one-head-qkv",
      "attention-scores",
      "causal-mask",
      "softmax-weighted-v",
      "head-recombination",
      "mlp",
      "final-hidden-state",
      "vocabulary-projection",
    ]),
  );
  assert.deepEqual(
    new Set(learningCases),
    new Set([
      "logits",
      "target-comparison",
      "loss",
      "output-backprop",
      "backprop-through-tower",
      "parameter-matrix",
      "adamw-state",
      "weight-update",
      "model-changed-next-step",
    ]),
  );

  assert.match(
    early,
    /case\s+"corpus-data-preparation":[\s\S]{0,100}?return undefined;/,
    "Corpus must retain its authored six-stage updater",
  );
  const corpusBuilder =
    /function\s+buildCorpus\s*\([\s\S]*?\n}\s*\n\s*function\s+buildTokenStream\s*\(/.exec(
      canvas,
    )?.[0] ?? "";
  assert.ok(corpusBuilder.length > 0);
  assert.match(corpusBuilder, /DATA_PREP_STAGES\.reduce\s*\(/);
  assert.match(corpusBuilder, /tokenRuntimes\.forEach\s*\(/);
  assert.match(
    corpusBuilder,
    /const\s+update\s*=\s*\(progress:\s*number,\s*elapsed:\s*number\)\s*=>/,
  );
  assert.match(corpusBuilder, /update\(0,\s*0\);\s*return update;/);

  assert.match(
    chamberIndex,
    /buildEarlyProcess\(context\)\s*\?\?\s*buildAttentionProcess\(context\)\s*\?\?\s*buildLearningProcess\(context\)/,
  );
  const semanticBuilder =
    /function\s+buildSemanticWorld\s*\([\s\S]*?\n}\s*\n\s*function\s+applyAnimation\s*\(/.exec(
      canvas,
    )?.[0] ?? "";
  assert.ok(semanticBuilder.length > 0, "buildSemanticWorld source should be discoverable");
  assert.match(
    semanticBuilder,
    /const\s+processUpdate\s*=\s*buildDistinctChamberProcess\s*\(\s*\{/,
  );
  const shellSpecs =
    /const\s+DISTINCT_CHAMBER_SHELL_SPECS\s*=\s*\{([\s\S]*?)\n\}\s+as const/.exec(
      canvas,
    )?.[1] ?? "";
  assert.ok(shellSpecs.length > 0, "distinct chamber shell specs should be discoverable");
  const shellSpecIds = [...shellSpecs.matchAll(/^\s*"([^"]+)":\s*\{/gm)].map(
    (match) => match[1],
  );
  assert.equal(shellSpecIds.length, new Set(shellSpecIds).size);
  assert.deepEqual(
    new Set(shellSpecIds),
    new Set(expectedIds),
    "every non-Corpus process must have a spacious shell specification",
  );
  const shellDimensions = [...shellSpecs.matchAll(
    /size:\s*\[\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\]/g,
  )].map((match) => match.slice(1).map(Number));
  assert.equal(shellDimensions.length, expectedIds.length);
  assert.ok(
    shellDimensions.every(([width, height, depth]) =>
      width >= 48 && height >= 48 && depth >= 54
    ),
    `all chamber dimensions must be genuinely spacious; received ${JSON.stringify(shellDimensions)}`,
  );
  assert.ok(
    shellDimensions.every((dimensions) =>
      Math.max(...dimensions) / Math.min(...dimensions) <= 1.4
    ),
    "every enclosed chamber should be volumetric rather than a wide, flat stage",
  );
  assert.equal(countMatches(shellSpecs, /exhibitScale:/g), expectedIds.length);
  assert.equal(countMatches(shellSpecs, /guidedView:/g), expectedIds.length);
  const volumeRecords = [...shellSpecs.matchAll(
    /"([^"]+)":\s*\{\s*size:\s*\[\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\][\s\S]*?guidedView:\s*\{\s*distance:\s*(\d+(?:\.\d+)?)/g,
  )].map((match) => ({
    id: match[1],
    width: Number(match[2]),
    height: Number(match[3]),
    depth: Number(match[4]),
    cameraDistance: Number(match[5]),
  }));
  assert.equal(volumeRecords.length, expectedIds.length);
  assert.ok(
    volumeRecords.every(({ depth, cameraDistance }) =>
      cameraDistance <= depth / 2 - 2
    ),
    "each guided camera must sit at least two world units inside its chamber",
  );
  const volumeById = new Map(volumeRecords.map((record) => [record.id, record]));
  const minimumCorridorGap = TRAINING_STATIONS.slice(0, -1).reduce(
    (minimum, station, index) => {
      const next = TRAINING_STATIONS[index + 1];
      const fromReach = station.id === "corpus-data-preparation"
        ? 36
        : volumeById.get(station.id).depth / 2 - 0.65;
      const toReach = next.id === "corpus-data-preparation"
        ? 54
        : volumeById.get(next.id).depth / 2 - 0.65;
      return Math.min(minimum, 100 - fromReach - toReach);
    },
    Number.POSITIVE_INFINITY,
  );
  assert.ok(
    minimumCorridorGap >= 12,
    `the spacious rooms still need a usable corridor gap; received ${minimumCorridorGap}`,
  );
  assert.deepEqual(
    new Set([...shellSpecs.matchAll(/spatialStyle:\s*"([^"]+)"/g)].map((match) => match[1])),
    new Set([
      "panorama",
      "rail-gantry",
      "vertical-foundry",
      "split-wing",
      "microscope",
      "observatory",
    ]),
  );
  assert.match(
    semanticBuilder,
    /station\.id\s*===\s*"corpus-data-preparation"\s*\?\s*undefined\s*:\s*buildDistinctChamberShell\(context\)/,
    "every non-Corpus station should resolve its own spacious shell and exhibit transform",
  );
  assert.match(
    semanticBuilder,
    /station\.id\s*===\s*"corpus-data-preparation"\s*\?\s*buildCorpus\(context\)\s*:\s*undefined/,
    "Corpus alone must invoke its authored runtime",
  );
  assert.match(semanticBuilder, /processGroup\.scale\.setScalar\(distinctShellSpec\.exhibitScale\)/);
  assert.match(semanticBuilder, /group:\s*distinctShellSpec\s*\?\s*processGroup\s*:\s*group/);
  assert.equal(
    (semanticBuilder.match(/STATION_BUILDERS/g) ?? []).length,
    1,
    "the semantic runtime may validate the retired catalog but must not dispatch through it",
  );
  assert.match(semanticBuilder, /STATION_BUILDERS\.length/);
  assert.doesNotMatch(
    semanticBuilder,
    /STATION_BUILDERS\s*\[[^\]]+\]\s*\([^)]*context/,
    "non-Corpus legacy interiors must never be invoked beneath distinct processes",
  );
  assert.doesNotMatch(semanticBuilder, /\bbuildAnimatedProcessChamber\s*\(/);
  assert.doesNotMatch(semanticBuilder, /PROCESS_THEATER_SPECS/);
  assert.doesNotMatch(canvas, /PROCESS_THEATER_SPECS/);

  assert.match(canvas, /PROCESS_CHAMBER_CYCLE_SECONDS\s*=\s*15/);
  assert.match(
    canvas,
    /const\s+chamberProcessElapsed\s*=\s*positiveModulo\([\s\S]*?PROCESS_CHAMBER_CYCLE_SECONDS/,
  );
  assert.match(
    canvas,
    /const\s+chamberProcessProgress\s*=\s*reduceProcessMotion[\s\S]*?chamberProcessElapsed\s*\/\s*\(PROCESS_CHAMBER_CYCLE_SECONDS\s*-\s*3\)/,
  );
  const runtimeDriver =
    /stationRuntimes\.forEach\(\(runtime, index\) => \{[\s\S]*?\n\s*\}\);\n\n\s*\(Object\.keys/.exec(
      canvas,
    )?.[0] ?? "";
  assert.ok(runtimeDriver.length > 0, "station runtime driver should be discoverable");
  assert.match(
    runtimeDriver,
    /index\s*===\s*1[\s\S]*?state\.dataPrepProgress[\s\S]*?index\s*===\s*currentStation[\s\S]*?chamberProcessProgress/,
  );
  assert.match(
    runtimeDriver,
    /if\s*\(index\s*===\s*currentStation\s*&&\s*!roomVisible\)\s*\{\s*runtime\.update\?\.\(/,
  );
  assert.match(
    runtimeDriver,
    /guidedRide\s*&&\s*state\.playing[\s\S]*?guidedProcessProgress[\s\S]*?chamberProcessProgress/,
    "paused guided chambers must keep cycling through their full computation",
  );
  assert.doesNotMatch(runtimeDriver, /BACKPROP_START|isAnimatedProcessStation|phase\s*===/);
  const reverseAndUpdateIds = TRAINING_STATIONS.filter(
    (station) => station.phase === "backward" || station.phase === "update",
  ).map((station) => station.id);
  assert.ok(reverseAndUpdateIds.length > 0);
  assert.equal(
    reverseAndUpdateIds.every((id) => covered.has(id)),
    true,
    "backward and update chambers must receive the same cyclic progress driver",
  );

  assert.match(shared, /export function createValueBoard\s*\(/);
  assert.match(shared, /function formatValue\s*\(/);
  assert.match(shared, /new THREE\.CanvasTexture\s*\(/);
  assert.match(
    shared,
    /Math\.round\(Math\.max\(width \* 64, columns \* 48\)\)[\s\S]*?320,[\s\S]*?512/,
    "value-board texture widths must stay within the bounded information-density budget",
  );
  assert.match(
    shared,
    /Math\.round\(Math\.max\(width \* 64, longestLine \* 14\)\)[\s\S]*?256,[\s\S]*?512/,
    "panel texture widths must stay within the bounded information-density budget",
  );
  assert.equal(
    (shared.match(/generateMipmaps\s*=\s*false/g) ?? []).length,
    2,
    "process canvases must not allocate mipmap chains",
  );
  assert.equal(
    (shared.match(/canvas\.width - 24/g) ?? []).length,
    2,
    "value-board titles and subtitles must shrink to the bounded canvas width",
  );
  assert.match(
    shared,
    /processBaseDepthWrite[\s\S]*?Boolean\(transparentMaterial\.userData\.processBaseDepthWrite\)/,
    "animated fades must preserve materials that intentionally never write depth",
  );
  assert.match(shared, /export function createGlyph\s*\(/);
  assert.match(shared, /highlightedIndices/);
  assert.match(shared, /maskedIndices/);
  assert.match(shared, /unknownIndices/);
  for (const processSource of [early, attention, learning]) {
    assert.match(processSource, /createValueBoard/);
    assert.match(processSource, /createGlyph/);
  }

  assert.match(early, /SELECTED_TRACE\.embedding\.selectedTokenVector/);
  assert.match(early, /SELECTED_TRACE\.embedding\.selectedPositionVector/);
  assert.match(early, /SELECTED_TRACE\.embedding\.selectedHiddenVector/);
  assert.match(
    early,
    /selectedTokenVector[\s\S]*?selectedPositionVector[\s\S]*?createGlyph\("\+"[\s\S]*?createGlyph\("="/,
    "Embedding must show exact operands, plus, equals, and result",
  );
  assert.match(early, /"WQ \[8 x 8\]", "WK \[8 x 8\]", "WV \[8 x 8\]"/);
  assert.match(early, /createGlyph\("x"/);
  assert.match(early, /SELECTED_TRACE\.batch\.inputTokenIds\.flat\(\)/);
  assert.match(early, /SELECTED_TRACE\.output\.selectedLogits/);
  const transformerTowerBuilder =
    /function\s+buildTransformerTower\s*\([\s\S]*?\n}\s*\n\s*function\s+buildTransformerBlock\s*\(/.exec(
      early,
    )?.[0] ?? "";
  assert.ok(
    transformerTowerBuilder.length > 0,
    "transformer-tower process source should be discoverable",
  );
  assert.match(
    transformerTowerBuilder,
    /moveObject\(\s*h1,[\s\S]{0,180}?smoothStep\(p,\s*0\.4,\s*0\.54\)/,
    "h1 must be positioned on every frame so a wrapped cycle restores its start",
  );
  assert.match(
    transformerTowerBuilder,
    /moveObject\(\s*h2,[\s\S]{0,180}?smoothStep\(p,\s*0\.72,\s*0\.82\)/,
    "h2 must be positioned on every frame so a wrapped cycle restores its start",
  );
  assert.doesNotMatch(
    transformerTowerBuilder,
    /if\s*\(p\s*>=\s*(?:0\.4|0\.72)\)/,
    "tower state movement must not retain the previous cycle's endpoint",
  );

  assert.match(
    attention,
    /createValueBoard\(makeScoreMatrix\(false\),\s*6,\s*6/,
  );
  assert.match(attention, /createValueBoard\(makeMaskMatrix\(\),\s*6,\s*6/);
  assert.match(attention, /createGlyph\("\+"/);
  assert.match(attention, /CONCAT \[8\] -- NOT ADDITION/);
  assert.match(attention, /O = CONCAT x W_O/);
  assert.match(attention, /SELECTED_TRACE\.attention\.scaledScoresBeforeMask/);
  assert.match(attention, /SELECTED_TRACE\.attention\.attentionWeights/);
  assert.match(attention, /SELECTED_TRACE\.attention\.weightedValue/);
  assert.match(attention, /SELECTED_TRACE\.attention\.allowedValues/);
  assert.match(attention, /title:\s*"SOFTMAX A"/);
  assert.match(attention, /title:\s*"LN2\(U\) \[8\]"/);
  assert.match(attention, /\+ b_up \[32\]/);
  assert.match(attention, /\+ b_down \[8\]/);
  assert.match(
    attention,
    /const\s+approach\s*=\s*smoothStep\(p,\s*0\.52,\s*0\.68\)/,
    "the causal-mask operands must remain separated and readable at midpoint",
  );
  assert.match(
    attention,
    /setObjectOpacity\(plus,\s*visibilityWindow\(p,\s*0\.05,\s*0\.15,\s*0\.58,\s*0\.7\)\)/,
    "the causal-mask plus sign must remain visible at midpoint",
  );

  assert.match(learning, /SELECTED_TRACE\.output\.selectedLogits/);
  assert.match(learning, /SELECTED_TRACE\.output\.selectedProbabilities/);
  assert.match(
    learning,
    /SELECTED_TRACE\.output\.correctTokenProbabilities\.flat\(\)/,
  );
  assert.match(learning, /SELECTED_TRACE\.output\.perTokenLosses\.flat\(\)/);
  assert.match(learning, /L = 1\.427636920/);
  assert.match(learning, /ADAMW ASSEMBLY LINE/);
  assert.match(learning, /m1=-0\.00031/);
  assert.match(learning, /v1=9\.61e-9/);
  assert.match(learning, /m_hat=-0\.0031/);
  assert.match(learning, /v_hat=9\.61e-6/);
  assert.match(learning, /DELTA w[\s\S]*?\+0\.000999822774/);
  assert.match(learning, /PRECISION UPDATE BENCH/);
  assert.match(learning, /w \+ DELTA w = w'/);
  assert.match(learning, /0\.017400000000/);
  assert.match(learning, /0\.018399822774/);
  assert.match(learning, /matrixValuesBefore\[SELECTED_CELL_INDEX\]/);
  assert.match(learning, /matrixValuesAfter\[SELECTED_CELL_INDEX\]/);
  assert.match(learning, /dW = H\^T x dG \| 4 x 4 SLICE/);
  assert.match(learning, /rows 0:4, cols 0:4 of full dW_vocab \[8 x 16\]/);
  assert.match(learning, /MLP 1 \+ LN2 BACKWARD/);
  assert.match(learning, /ATTENTION 0 \+ LN1 BACKWARD/);
  assert.match(learning, /samplePath\(\s*packets\.merged/);
  assert.match(
    learning,
    /matrixPosition\.y \+ matrixHeight \/ 2 - 0\.72 - \(3 \+ 0\.5\) \* matrixCellHeight/,
    "the parameter selector must derive the center of row 3",
  );
  assert.match(
    learning,
    /updateBoardPosition\.x - updateBoardWidth \/ 2 \+ \(6 \+ 0\.5\) \* \(updateBoardWidth \/ 8\)/,
    "the update pulse must derive the center of column 6",
  );
  assert.doesNotMatch(
    learning,
    /vector\(0\.9,\s*0\.35,\s*-6\.0\)/,
    "the obsolete column-5 update target must not return",
  );

  assert.equal(
    countMatches(early, /updater\(0, 0, false\)/g),
    earlyCases.length - 1,
    "every early process builder must initialize a reduced-motion-safe state",
  );
  assert.match(
    attention,
    /function\s+finaliseUpdater[\s\S]{0,120}?updater\(0, 0, false\)/,
  );
  assert.equal(
    countMatches(attention, /return finaliseUpdater\(updater\);/g),
    attentionCases.length,
  );
  assert.match(
    learning,
    /function\s+finishBuilder[\s\S]{0,120}?updater\(0, 0, false\)/,
  );
  assert.equal(
    countMatches(learning, /return finishBuilder\(updater\);/g),
    learningCases.length,
  );
});

test("the spatial world uses isolated chambers, corridors, and one restrained beacon", async () => {
  const canvas = await readSource("app/components/TrainingWorldCanvas.tsx");

  assert.match(canvas, /function\s+createCorridorSystem\s*\(/);
  assert.match(canvas, /enclosed-station-corridors/);
  assert.match(canvas, /opaque-chamber-/);
  assert.match(
    canvas,
    /const\s+doorWidth\s*=\s*Math\.min\(\s*7\.2,\s*width\s*-\s*3\.2\s*\)/,
  );
  assert.match(canvas, /const\s+MIN_SPACIOUS_CHAMBER_SPAN\s*=\s*48/);
  assert.match(canvas, /const\s+MIN_SPACIOUS_CHAMBER_DEPTH\s*=\s*54/);
  assert.match(canvas, /const\s+width\s*=\s*Math\.max\(size\.x,\s*MIN_SPACIOUS_CHAMBER_SPAN\)/);
  assert.match(canvas, /const\s+chamberHeight\s*=\s*Math\.max\(size\.y,\s*MIN_SPACIOUS_CHAMBER_SPAN\)/);
  assert.match(canvas, /const\s+depth\s*=\s*Math\.max\(size\.z,\s*MIN_SPACIOUS_CHAMBER_DEPTH\)/);
  assert.match(canvas, /const\s+floorY\s*=\s*navigationDeckY\s*-\s*0\.18/);
  assert.match(canvas, /const\s+ceilingY\s*=\s*floorY\s*\+\s*chamberHeight/);
  assert.match(canvas, /const\s+verticalSpan\s*=\s*chamberHeight/);
  assert.match(canvas, /maxY:\s*ceilingY\s*-\s*1/);
  assert.match(canvas, /const\s+spawnInset\s*=\s*Math\.max\(8,\s*depth\s*\*\s*0\.16\)/);
  assert.match(canvas, /function\s+getSurfaceReliefTexture\s*\(/);
  assert.match(canvas, /normalMap:\s*getSurfaceReliefTexture\("wall"\)/);
  assert.match(canvas, /normalMap:\s*getSurfaceReliefTexture\("floor"\)/);
  assert.match(canvas, /function\s+tileableValueNoise|const\s+tileableValueNoise/);
  assert.match(canvas, /normalScale:\s*new\s+THREE\.Vector2\(0\.26,\s*0\.26\)/);
  assert.match(canvas, /backWallMaterial\.normalScale\.set\(0\.1,\s*0\.1\)/);
  assert.match(canvas, /new\s+THREE\.SpotLight\("#e9f1fb",\s*180,\s*68,\s*0\.72/);
  assert.match(canvas, /portalMinY:\s*doorBottom\s*\+\s*0\.55/);
  assert.match(canvas, /portalMaxY:\s*doorTop\s*-\s*0\.55/);
  assert.match(canvas, /guidedView\.guidedViewDistance\s*\/\s*routeLength/);
  assert.match(canvas, /lookProgress\s*=\s*THREE\.MathUtils\.clamp\(cameraProgress,\s*0,\s*1\)/);
  assert.match(canvas, /lookPoint\.addScaledVector\(up,\s*guidedView\.guidedFocusY\)/);
  assert.match(canvas, /const\s+corridorHeight\s*=\s*9\.4/);
  assert.match(canvas, /corridorEndProgress\s*<=\s*corridorStartProgress/);
  assert.match(canvas, /procedural-\$\{kind\}-surface-normal-relief/);
  assert.match(
    canvas,
    /runtime\.group\.visible\s*=\s*roomVisible[\s\S]{0,80}?\?\s*false[\s\S]{0,80}?:\s*guidedRide/,
  );
  assert.match(canvas, /navigationRegion\.kind\s*===\s*"tunnel"/);
  assert.match(canvas, /tunnelOffset\.dot\(tunnelRight\)/);
  assert.match(canvas, /worldToLocal\(arrivalLocalPosition\)/);
  assert.match(canvas, /function\s+createRouteBeacon\s*\(/);
  assert.match(canvas, /single-route-beacon/);

  assert.doesNotMatch(canvas, /function\s+createRouteParticles\s*\(/);
  assert.doesNotMatch(canvas, /activation-gradient-particles/);
  assert.doesNotMatch(canvas, /function\s+createEnvironmentRibs\s*\(/);
  assert.doesNotMatch(canvas, /persistent-semantic-ribs/);
  assert.doesNotMatch(canvas, /semantic-scale-dust/);
  assert.doesNotMatch(canvas, /observationLevels/);
  assert.doesNotMatch(canvas, /floorRing(?:Echo|Radius)?/);
  assert.doesNotMatch(canvas, /dais(?:Rim|Apron)/);
  assert.doesNotMatch(canvas, /function\s+createGuideTrack\s*\(/);
  assert.doesNotMatch(canvas, /function\s+addPortal\s*\(/);
});

test("the context-window exhibit avoids decorative floor rails", async () => {
  const early = await readSource("app/components/chambers/earlyProcesses.ts");

  assert.match(early, /early-process-context-window-rail-tunnel/);
  assert.doesNotMatch(early, /const\s+rail(?:Left|Right|Material)/);
});
