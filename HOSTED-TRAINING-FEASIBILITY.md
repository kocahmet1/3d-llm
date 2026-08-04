# Hosted Training Feasibility Report

**Question:** Can the Custom Training chamber work on the hosted site, without users running the site locally?

**Answer: Yes.** There are four workable paths, ranging from ~2 days to ~4–6 weeks of effort. What makes this feasible is that the trainer's presets are tiny by design: micro ≈ 0.1M params, small ≈ 0.8M, local ≈ 5M, byte-level vocab (257), context 64–256. This is trainable on a phone's GPU, a free Colab, or fractions of a cent of server CPU.

## Why it doesn't work today

Two deliberate locks, not one:

1. The browser fetches `http://127.0.0.1:8765` directly (`app/lib/trainingClient.ts`), and browsers historically blocked public-HTTPS pages from reaching loopback.
2. `service.py` rejects any non-loopback `Origin` header and refuses to bind anything but 127.0.0.1/localhost.

The hosted site itself runs on Cloudflare Workers (JS only) — no Python, no PyTorch, no long-running processes. Also confirmed impossible: PyTorch in the browser via Pyodide/WASM (no torch build exists; [pyodide#1625](https://github.com/pyodide/pyodide/issues/1625) open since 2021), and Cloudflare Workers AI (inference-only, no custom training).

## Option A — Hosted page + user's local companion (effort: ~1–2 days)

**The blocker fell in October 2025.** Chrome 142 shipped [Local Network Access](https://developer.chrome.com/blog/local-network-access): a public HTTPS page may now fetch `http://127.0.0.1` if the user grants a permission prompt, and such requests are exempted from mixed-content blocking. So the *hosted* page can talk to a locally running companion — the user runs one command, not the whole site.

Changes: add an opt-in origin allowlist to `service.py` (e.g. `--allow-origin https://your-site.dev`, still binding loopback only); make the bridge URL a runtime setting in the chamber UI instead of build-time `NEXT_PUBLIC_CHAMBER_TRAINER_URL`; update the connection notice to explain the permission prompt. Optionally package the companion as `pipx run chamber-trainer serve` or a PyInstaller .exe so no Python setup is needed.

Caveats: reliable in Chromium browsers (142+); Firefox/Safari behavior varies. Compute is still the user's machine — but they no longer clone the repo or run `npm run dev:training`.

## Option B — Hosted page + free remote compute the user owns (effort: ~2–4 days)

An "Open in Colab" notebook: pip-installs `chamber_trainer`, starts the service, opens a `cloudflared`/ngrok tunnel, prints an HTTPS URL. The user pastes that URL into the chamber's bridge-URL field. Because the tunnel is HTTPS, this needs no LNA permission and works in every browser — and Colab's free tier gives the `cuda` device path a real GPU.

Changes: same runtime bridge-URL field as Option A, the origin allowlist, a `--host` escape hatch guarded behind an explicit flag (the service currently hard-refuses non-loopback binds), and one maintained notebook. Zero infrastructure cost to you; the compute belongs to the user.

## Option C — Real server-side training on Cloudflare Containers (effort: ~1–2 weeks)

The strongest "it just works for every visitor" option, and it stays in your existing deployment stack. [Cloudflare Containers went GA in April 2026](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/) — real Linux containers attached to Workers, so the *actual* `chamber_trainer` PyTorch package runs unchanged (CPU wheels). The architecture maps almost perfectly: one container instance per user session via a Durable Object, which matches the service's existing one-run-per-process design; the Worker routes `/trainer/*` to the session's container; scale-to-zero when idle.

Cost is trivial at this model scale: [pricing](https://developers.cloudflare.com/containers/pricing/) is $5/mo Workers Paid with 375 vCPU-minutes included, then $0.000020/vCPU-second (~$0.07/vCPU-hour). A micro/quick run costs well under a cent; even a thorough `local`-preset run for hours costs tens of cents. No GPU instances exist yet — CPU only — so the `local` preset is slow-but-fine, and micro/small are quick.

Work items: Dockerfile with CPU-only torch; replace the loopback origin check with Worker-injected session auth; persist checkpoints to R2 (there's a first-party [R2 FUSE mount example](https://developers.cloudflare.com/containers/examples/r2-fuse-mount/)); abuse controls (Turnstile, per-IP/session quotas, cap concurrent containers, cap steps — the guarded-config caps already exist); point the bridge client at same-origin `/trainer` instead of 127.0.0.1.

Risk: you now pay for strangers' compute. The caps make worst-case cost bounded and small, but it's a real operational commitment (quotas, monitoring).

## Option D — Training fully in the browser (effort: ~4–6 weeks)

The most on-mission version: every visitor's own device trains the model, zero servers, infinite scale. It is technically proven for exactly this model class — [`@genai-fi/nanogpt`](https://www.npmjs.com/package/@genai-fi/nanogpt) (University of Eastern Finland's Generation AI project, actively maintained — v0.22.0 published Aug 2026) trains GPT models in-browser on TensorFlow.js with WebGPU/WebGL/CPU backends. Your micro preset (~0.1M params, ctx 64) trains in seconds–minutes on WebGPU; small in minutes; `local` (~5M) is viable on WebGPU, slow on fallback. WebGPU now ships in Chrome/Edge (years), Firefox 141+, Safari 26+.

Work: reimplement in TS — byte tokenizer, corpus prep, decoder-only transformer, AdamW with decoupled weight decay (custom optimizer; tfjs has none built-in), cosine schedule, grad clip, eval, sampling, checkpoints to IndexedDB. Either build on `@genai-fi/nanogpt` or hand-roll on tfjs.

Two honest risks. First, tfjs is in maintenance mode at Google — it works and the WebGPU backend is decent, but it's not a growing platform. Second, integrity of the project's story: the README's claim is "the real PyTorch trainer, same code as the Code panel." A JS reimplementation is a *port*, and exact numerical parity with PyTorch will not hold. You'd present it as "train in your browser" while keeping the Python trainer as the source of truth for the Code excerpts — a framing change worth making deliberately.

## What I'd do

Ship A + B first (a few days total, mostly shared work: runtime bridge URL + origin allowlist). That alone changes the story from "clone the repo" to "click a Colab link or run one command." Then decide between C and D as the real product move: **C** if you want authentic PyTorch for every visitor with zero install and are willing to own quotas and a small bill; **D** if you want the pure "your browser is the training run" experience and accept a port. They also compose — D for micro/small in-browser, C as the backend for the `local` preset.

| | Effort | Cost to you | Works for | Authentic PyTorch |
|---|---|---|---|---|
| A. Local companion + LNA | ~1–2 days | $0 | Chromium users willing to run one command | Yes |
| B. Colab + tunnel | ~2–4 days | $0 | Anyone with a Google account (free GPU) | Yes |
| C. Cloudflare Containers | ~1–2 weeks | ~$5/mo + pennies/run | Every visitor, zero install | Yes |
| D. In-browser (tfjs/WebGPU) | ~4–6 weeks | $0 | Every visitor, zero install | No (JS port) |

## Sources

- [Chrome Local Network Access permission (Chrome 142)](https://developer.chrome.com/blog/local-network-access)
- [Cloudflare Containers & Sandboxes GA changelog](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/)
- [Cloudflare Containers pricing](https://developers.cloudflare.com/containers/pricing/)
- [@genai-fi/nanogpt on npm](https://www.npmjs.com/package/@genai-fi/nanogpt) / [GitHub](https://github.com/knicos/genai-nanogpt)
- [Pyodide PyTorch support issue](https://github.com/pyodide/pyodide/issues/1625)
