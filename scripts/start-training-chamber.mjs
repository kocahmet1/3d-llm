import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const trainerRoot = path.join(projectRoot, "trainer");
const pythonCandidates = process.platform === "win32"
  ? [
      path.join(trainerRoot, ".venv", "Scripts", "python.exe"),
      "py",
      "python",
    ]
  : [path.join(trainerRoot, ".venv", "bin", "python"), "python3", "python"];

const python = pythonCandidates.find((candidate) =>
  path.isAbsolute(candidate) ? existsSync(candidate) : true,
);

if (!python) {
  throw new Error("No Python runtime is available for the local trainer.");
}

const children = new Set();
const trainerInstanceId = randomUUID();
const trainerHealthUrl = "http://127.0.0.1:8765/health";
const trainerAlreadyRunningExitCode = 73;
let stopping = false;
let shutdownPromise;

function start(command, args, options, lifecycle = {}) {
  const requestTrainerStop = lifecycle.requestTrainerStop !== false;
  const child = spawn(command, args, {
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
  children.add(child);
  child.once("error", (error) => {
    console.error(`${path.basename(command)} could not start: ${error.message}`);
    void shutdown(1, { requestTrainerStop });
  });
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) {
      if (code !== 0 && code !== trainerAlreadyRunningExitCode) {
        console.error(
          `${path.basename(command)} stopped unexpectedly (${signal ?? `exit ${code}`}).`,
        );
      }
      void shutdown(code ?? (signal ? 1 : 0), { requestTrainerStop });
    }
  });
  return child;
}

async function readTrainerHealth() {
  try {
    const response = await fetch(trainerHealthUrl, {
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return null;
    const health = await response.json();
    return health?.service === "chamber-trainer-companion" ? health : null;
  } catch {
    return null;
  }
}

function printExistingTrainerMessage() {
  console.log(
    [
      "Training Chamber is already running at http://127.0.0.1:8765.",
      "No second trainer was started. Run `npm run dev:training` only once.",
      "Keep the existing PowerShell window open and use the Local URL it printed.",
    ].join("\n"),
  );
}

async function askTrainerToStopSafely() {
  try {
    const health = await readTrainerHealth();
    if (health?.instanceId !== trainerInstanceId) return;
    const current = await fetch("http://127.0.0.1:8765/runs/current", {
      signal: AbortSignal.timeout(1_500),
    });
    if (!current.ok) return;
    const snapshot = await current.json();
    if (!snapshot?.id || ["completed", "stopped", "failed"].includes(snapshot.status)) {
      return;
    }
    await fetch(`http://127.0.0.1:8765/runs/${snapshot.id}/stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Chamber-Trainer-Instance": trainerInstanceId,
      },
      body: "{}",
      signal: AbortSignal.timeout(1_500),
    });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const response = await fetch(
        `http://127.0.0.1:8765/runs/${snapshot.id}`,
        { signal: AbortSignal.timeout(1_500) },
      );
      if (!response.ok) return;
      const next = await response.json();
      if (["completed", "stopped", "failed"].includes(next.status)) return;
    }
  } catch {
    // The bridge may already be gone or handling Ctrl+C itself.
  }
}

function shutdown(code = 0, { requestTrainerStop = true } = {}) {
  if (shutdownPromise) return shutdownPromise;
  stopping = true;
  shutdownPromise = (async () => {
    if (requestTrainerStop) await askTrainerToStopSafely();
    const active = [...children];
    for (const child of active) child.kill("SIGTERM");
    await Promise.race([
      Promise.all(
        active.map(
          (child) =>
            new Promise((resolve) => {
              if (child.exitCode !== null || child.signalCode !== null) resolve();
              else child.once("exit", resolve);
            }),
        ),
      ),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
    process.exit(code);
  })();
  return shutdownPromise;
}

const pythonArgs = python === "py"
  ? ["-3", "-m", "chamber_trainer", "serve"]
  : ["-m", "chamber_trainer", "serve"];

const existingTrainer = await readTrainerHealth();
if (existingTrainer) {
  printExistingTrainerMessage();
  process.exit(0);
}

start(python, pythonArgs, {
  cwd: trainerRoot,
  env: {
    ...process.env,
    CHAMBER_TRAINER_INSTANCE_ID: trainerInstanceId,
    PYTHONPATH: path.join(trainerRoot, "src"),
    PYTHONUNBUFFERED: "1",
  },
}, { requestTrainerStop: false });

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  void shutdown(1);
  throw new Error("Run this launcher through npm so the site runtime can start.");
}

start(process.execPath, [npmCli, "run", "dev"], {
  cwd: projectRoot,
  env: process.env,
});

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
