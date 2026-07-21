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
    contextModulesPromise = Promise.all([
      readSource("app/lib/trainingTrace.ts"),
      readSource("app/lib/assistantContext.ts"),
      readSource("app/lib/assistantAppTools.ts"),
    ]).then(async ([traceSource, contextSource, appToolsSource]) => {
      const traceUrl = asDataModule(
        transpile(traceSource, "trainingTrace.ts"),
      );
      const contextJavascript = transpile(
        contextSource,
        "assistantContext.ts",
      ).replace(
        /from\s+["']\.\/trainingTrace["']/,
        `from ${JSON.stringify(traceUrl)}`,
      );
      const appToolsJavascript = transpile(
        appToolsSource,
        "assistantAppTools.ts",
      ).replace(
        /from\s+["']\.\/trainingTrace["']/,
        `from ${JSON.stringify(traceUrl)}`,
      );

      assert.doesNotMatch(
        contextJavascript,
        /from\s+["']\.\/trainingTrace["']/,
        "the runtime test loader must replace the TypeScript module import",
      );
      assert.doesNotMatch(
        appToolsJavascript,
        /from\s+["']\.\/trainingTrace["']/,
        "the app-tool test loader must replace the TypeScript module import",
      );

      const [trace, context, appTools] = await Promise.all([
        import(traceUrl),
        import(asDataModule(contextJavascript)),
        import(asDataModule(appToolsJavascript)),
      ]);
      return { trace, context, appTools };
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
  const { context } = await loadContextModules();
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
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.visibleState), true);
  assert.equal(Object.isFrozen(snapshot.visibleState.animation), true);
  assert.equal(Object.isFrozen(snapshot.visibleState.highlightedPositions), true);
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

test("assistant app tools expose only allowlisted lesson controls", async () => {
  const { trace, appTools } = await loadContextModules();
  const tools = appTools.ASSISTANT_APP_TOOLS;
  const names = tools.map(({ name }) => name);

  assert.deepEqual(names, [
    "navigate_chamber",
    "set_journey_playback",
    "set_detail_mode",
    "set_ride_mode",
    "choose_branch",
    "control_data_preparation",
  ]);
  assert.equal(new Set(names).size, names.length);

  for (const tool of tools) {
    assert.equal(tool.type, "function");
    assert.equal(tool.parameters.type, "object");
    assert.equal(tool.parameters.additionalProperties, false);
    assert.equal(tool.parameters.required.length, 1);
  }

  const navigate = tools.find(({ name }) => name === "navigate_chamber");
  const destinations = navigate.parameters.properties.destination.enum;
  assert.deepEqual(destinations.slice(0, 4), [
    "next",
    "previous",
    "first",
    "last",
  ]);
  assert.deepEqual(
    destinations.slice(4),
    trace.TRAINING_STATIONS.map(({ id }) => id),
  );

  const serialized = JSON.stringify(tools);
  assert.doesNotMatch(
    serialized,
    /css.?selector|javascript|https?:|api.?key|microphone/i,
  );
});

test("assistant app commands reject malformed or unlisted arguments", async () => {
  const { trace, appTools } = await loadContextModules();
  const exactStationId = trace.TRAINING_STATIONS[9].id;

  assert.deepEqual(
    appTools.parseAssistantAppCommand("navigate_chamber", {
      destination: "next",
    }),
    {
      ok: true,
      command: { kind: "navigate_chamber", destination: "next" },
    },
  );
  assert.deepEqual(
    appTools.parseAssistantAppCommand("navigate_chamber", {
      destination: exactStationId,
    }),
    {
      ok: true,
      command: { kind: "navigate_chamber", destination: exactStationId },
    },
  );
  assert.equal(
    appTools.parseAssistantAppCommand("navigate_chamber", {
      destination: "not-a-real-chamber",
    }).ok,
    false,
  );
  assert.equal(
    appTools.parseAssistantAppCommand("navigate_chamber", {
      destination: "next",
      progress: 0.75,
    }).ok,
    false,
  );
  assert.equal(
    appTools.parseAssistantAppCommand("navigate_chamber", ["next"]).ok,
    false,
  );
  assert.equal(
    appTools.parseAssistantAppCommand("set_detail_mode", {
      mode: "hidden-admin-mode",
    }).ok,
    false,
  );
  assert.equal(
    appTools.parseAssistantAppCommand("run_javascript", {
      code: "location.reload()",
    }).ok,
    false,
  );
});

test("assistant chamber navigation resolves IDs and stops at boundaries", async () => {
  const { trace, appTools } = await loadContextModules();
  const lastIndex = trace.TRAINING_STATIONS.length - 1;
  const targetIndex = 7;

  assert.equal(appTools.resolveAssistantChamberIndex(0, "previous"), 0);
  assert.equal(appTools.resolveAssistantChamberIndex(0, "next"), 1);
  assert.equal(
    appTools.resolveAssistantChamberIndex(lastIndex, "next"),
    lastIndex,
  );
  assert.equal(
    appTools.resolveAssistantChamberIndex(
      0,
      trace.TRAINING_STATIONS[targetIndex].id,
    ),
    targetIndex,
  );
  assert.equal(
    appTools.resolveAssistantChamberIndex(4, "not-a-real-chamber"),
    null,
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
    assert.match(String(init.body.get("session")), /"type":"realtime"/);
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

test("voice UI exposes a clearly temporary, memory-only key flow", async () => {
  const [dock, hook, route, experience, canvas, appTools] = await Promise.all([
    readSource("app/components/assistant/AssistantDock.tsx"),
    readSource("app/components/assistant/useRealtimeAssistant.ts"),
    readSource("app/api/realtime/session/route.ts"),
    readSource("app/components/TrainingExperience.tsx"),
    readSource("app/components/TrainingWorldCanvas.tsx"),
    readSource("app/lib/assistantAppTools.ts"),
  ]);

  assert.match(dock, /Meet your guide/);
  assert.match(dock, /hold V.*next chamber/i);
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

  assert.match(hook, /new RTCPeerConnection\(\)/);
  assert.match(hook, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(hook, /DEFAULT_SESSION_ENDPOINT\s*=\s*"\/api\/realtime\/session"/);
  assert.match(hook, /conversation\.item\.create/);
  assert.match(hook, /APPLICATION_CONTEXT_FOR_NEXT_USER_TURN/);
  assert.match(hook, /tool_choice:\s*tools\.length\s*>\s*0\s*\?\s*"auto"/);
  assert.match(hook, /response\.function_call_arguments\.done/);
  assert.match(hook, /type:\s*"function_call_output"/);
  assert.match(hook, /call_id:\s*pendingCall\.callId/);
  assert.match(hook, /responseStatus\s*===\s*"completed"/);
  assert.match(hook, /processedFunctionCallIdsRef/);
  assert.match(hook, /pendingFunctionCallsRef/);
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
  assert.match(experience, /tools:\s*ASSISTANT_APP_TOOLS/);
  assert.match(experience, /onToolCall:\s*handleAssistantToolCall/);
  assert.match(experience, /resolveAssistantChamberIndex/);
  assert.match(experience, /voice\.enable\(temporaryApiKey\)/);
  assert.match(canvas, /new THREE\.Raycaster\(\)/);
  assert.match(canvas, /createAssistantController/);
  assert.match(canvas, /resolveAssistantTarget/);
  assert.match(appTools, /additionalProperties:\s*false/);
  assert.doesNotMatch(appTools, /document\.|window\.|dispatchEvent|eval\(/);

  assert.match(route, /process\.env\.OPENAI_API_KEY/);
  assert.match(route, /temporaryBearerKey/);
  assert.match(route, /request\.headers\.get\("authorization"\)/);
  assert.match(route, /api\.openai\.com\/v1\/realtime\/calls/);
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
