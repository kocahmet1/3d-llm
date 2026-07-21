# Inside One Training Step

Inside One Training Step is an interactive 3D journey through one complete
language-model training step. It follows a prepared batch through the forward
pass, next-token loss, backpropagation, and one AdamW weight update, then shows
the next step beginning with a changed model.

> **Built almost entirely with OpenAI Codex and GPT-5.6.** They were not a
> last-mile add-on or a decorative API credit: Codex, driven primarily by
> GPT-5.6, was the main engineering workflow behind nearly every major
> subsystem in this repository.

This is a **semantic infinite zoom** rather than a claim that neural networks
have a literal physical shape. Zoom communicates containment:

`training loop → model → Transformer block → attention → head → tensor → scalar`

Animation communicates time: activations move forward, loss gathers token
errors, gradients move backward through the same structures, and the optimizer
changes parameters only at the update phase.

## Built almost entirely with Codex + GPT-5.6

**OpenAI Codex, powered primarily by GPT-5.6 (Sol Ultra), was the engineering
partner for almost this entire project.** This was not a case of generating a
starter template and finishing the real work by hand. Codex + GPT-5.6 helped
take the project from its core teaching idea through architecture,
implementation, repeated visual and mathematical refinement, testing, and the
final demo workflow. Only a handful of smaller local edits used other GPT
models.

Nearly every major subsystem was developed through that collaboration:

- **The complete 3D experience:** the Three.js world, 25 distinct chambers,
  semantic camera route, first-person controls, teaching branches, spotlight
  system, animation choreography, lighting, occlusion work, and machine-room
  overview.
- **The teaching system:** the deterministic numeric trace, the Story /
  Structure / Math / Code layers, tensor-shape and formula displays, the six
  phase journey, and the accuracy corrections documented in
  [`ML-ACCURACY-REVIEW.md`](ML-ACCURACY-REVIEW.md).
- **The grounded voice guide:** Realtime WebRTC integration, frozen
  per-question context, detailed component targets, the in-world avatar, and
  the tightly allowlisted tools that let the guide operate the lesson without
  receiving arbitrary browser access.
- **The real training path:** the Python/PyTorch decoder-only Transformer,
  byte-level corpus preparation, validation, AdamW training, checkpoints,
  interruption recovery, local companion service, and checkpoint-backed text
  generation.
- **The reliability and delivery work:** source-synchronized Code excerpts,
  cross-layer contract tests, security-oriented credential handling, README and
  judge instructions, and the scripted director that records the competition
  demo.

I acted as the **product, teaching, and ML director**. I chose the central
metaphor, defined the learning sequence, decided what each station needed to
teach, set the visual and interaction goals, reviewed the generated work,
checked the machine-learning claims, rejected weak iterations, and made small
manual edits. Codex acted as the implementation and iteration engine: it read
the whole repository, proposed and executed cross-file changes, ran the tests,
diagnosed failures, and revised the result from my feedback. The workflow was
repeated hundreds of times rather than used for a single generation pass.

GPT-5.6's long-horizon reasoning is what made that workflow feasible. The world
only holds together because many invariants stay true simultaneously: every
displayed number resolves back to one source of truth in
`app/lib/trainingTrace.ts`; logits are stored as `log(p) + ln(10)` so softmax
reproduces the stored probabilities; attention input is consistently written
`N = LN₁(H)`; authentic Python excerpts stay synchronized with their chambers;
and adding one station can require coordinated changes to the trace, geometry,
HUD, assistant context, navigation, and tests. GPT-5.6 could keep that larger
system in view while Codex carried changes across it and I protected the
teaching story and ML accuracy.

That collaboration materially changed what one person could build in the
available time. Without Codex + GPT-5.6, this would likely have remained a
small visualization or a set of disconnected diagrams. With them, it became a
coherent 3D product, an internally verified teaching trace, a grounded voice
experience, and a runnable training system in one repository.

**Scope note:** the optional in-app voice guide is a separate product feature
built on the OpenAI **Realtime API** (a realtime speech model), documented under
[In-world voice guide](#in-world-voice-guide) below. GPT-5.6 was the
*development* model behind Codex, not the model serving the guide at runtime.

## The journey

The authored route contains 25 stations across six phases:

1. **Orient** — see the whole training loop.
2. **Prepare** — turn source text into context windows, inputs, and separately
   shifted next-token targets.
3. **Predict** — visit embeddings, the Transformer stack, one block, multi-head
   causal attention, the MLP, logits, and probabilities.
4. **Measure** — compare predictions with the target IDs and reduce 12 token
   penalties into one scalar cross-entropy loss.
5. **Trace** — follow sensitivity signals backward through the output and model,
   including the distinction between activation and parameter gradients.
6. **Adjust** — inspect AdamW state and update one selected parameter before the
   next step starts.

At six junctions, the route offers a left/right teaching branch. Examples
include attention versus MLP, query-key matching versus value gathering, and
activation-gradient versus parameter-gradient views.

## Modes and explanation depth

- **Overview** is a fast, approximately 25-second uninterrupted ride through
  the complete step.
- **Learn** slows the same route to approximately 2.5 minutes so labels and
  relationships are easier to follow.
- **Explore** pauses automatic travel for manual inspection.

Every station has four explanation layers:

- **Story** describes what is happening in beginner-friendly language.
- **Structure** names the actual components and tensor roles.
- **Math** exposes shapes, formulas, selected indices, and exact values.
- **Code** shows the corresponding excerpt from the runnable PyTorch trainer and
  links it back to the continuous optimizer loop.

The larger repeated structures in the scene communicate architecture and scale;
numeric labels come only from the small deterministic teaching trace below.
The runnable trainer uses the same operations and a matching tiny configuration,
but the exhibit's selected decimal values remain a separately controlled trace;
they are not claimed to be outputs from `configs/toy.toml`.

## Controls

| Input | Action |
| --- | --- |
| `W` / `S` | Continue along the lesson / return toward the previous station |
| `A` / `D` | Select the left / right branch at a junction |
| Mouse | Look around the 3D world |
| Mouse wheel | Travel along the route |
| `Space` | Play or pause the ride |
| Hold `V` | Ask the in-world voice guide about the exhibit under the reticle |
| Right click | Spotlight the component under the pointer (or under the center crosshair while the mouse is captured): a magnified replica takes center stage, the guide moves beside it and starts listening for your question |
| Right click on empty space / `Esc` | Release the spotlight and stop listening |
| Timeline | Scrub directly or select a station |

The on-screen phase rail, branch controls, mode selector, and Story / Structure /
Math / Code tabs provide pointer-accessible equivalents for the main lesson controls.

## In-world voice guide

The optional guide uses the OpenAI Realtime API to answer questions about the
part of the lesson you are pointing at. Select **Meet your guide**, aim the
center reticle at an exhibit, then hold `V` while speaking and release it to
ask. The on-screen **Hold to ask** button provides the same interaction for
pointer and keyboard users. You can interrupt an explanation with another turn
or turn the guide off at any time.

The guide can also operate the lesson through allowlisted Realtime function
calls. For example, say "go to the next chamber", "take me to cross-entropy",
"pause the journey", "show the math view", "switch to Explore mode", or
"choose the right branch". It can navigate among the 25 stable chamber IDs,
control journey and data-preparation playback, and change the ride, detail, or
branch mode. The browser validates every request against those exact controls,
updates React state, returns the real result to the model, and only then lets
the guide confirm what happened. It is not given arbitrary clicks, DOM
selectors, URLs, scripts, microphone controls, or credential access.

For an explicit selection, point at a component — with the cursor, or with the
center crosshair while the mouse is captured — and right-click it. A brief
laser flash confirms the pick, then a magnified replica rises onto a glowing
center stage in front of you, the chamber dims behind it, and the guide flies
over to stand beside the replica. While the guide is connected, the microphone
opens automatically: just ask your question aloud, and the guide detects when
you finish speaking. Follow-up questions reuse the open microphone until the
spotlight is released. Right-click a different component to replace the
spotlight, or right-click empty space (or press `Esc`) to dismiss it and stop
listening. Spotlighting works even while the voice guide is disconnected — it
is also a hands-on magnifier — and hold-`V` push-to-talk still works whenever
nothing is spotlighted.

The selected exhibit is frozen when speech starts, so moving the camera during
an answer does not silently change what words such as "this" and "that" mean.
The guide travels beside that target, faces it, and points while it explains.

### Configure Realtime voice

The recommended setup is a standard OpenAI API key in the server environment.
For a temporary PowerShell development session:

```powershell
$env:OPENAI_API_KEY="your-api-key"
npm run dev
```

For a deployed build, configure `OPENAI_API_KEY` in the hosting provider's
server-side secret settings. Do not put it in the JavaScript bundle or rename it
to a public variable such as `NEXT_PUBLIC_OPENAI_API_KEY`.

#### Temporary browser key (development only)

For short-lived testing, the guide also has an optional password field for an
OpenAI API key. This is a temporary bring-your-own-key escape hatch, not a
production credential design:

1. Open **Meet your guide**, paste the key into **Temporary API key**, and
   choose **Connect for this session**. Alternatively, choose **Use configured
   server key** without entering a key when `OPENAI_API_KEY` is configured.
2. The key remains only in the live React/hook memory needed to start that
   connection. It is never written to `localStorage`, `sessionStorage`, a
   cookie, a URL, or the application bundle.
3. Session setup sends it once in an authorization header to the same-origin
   `POST /api/realtime/session` route. That route uses it for the OpenAI
   Realtime call and never includes it in a response or log. The browser clears
   its reference after the setup attempt; reloading or reconnecting requires
   entering it again.

Use this option only from the hosted HTTPS page or from `localhost` on a
machine you trust. A key entered into any web page is available to that page's
runtime and browser developer tools for the duration of the request. For a
shared or production deployment, remove this temporary input and use a
server-side secret. If the browser must receive a credential, use a
server-issued, short-lived ephemeral client token flow instead of collecting
long-lived standard API keys in the UI.

The browser creates a WebRTC peer connection, captures microphone audio after
permission is granted, and sends its SDP offer to `POST /api/realtime/session`.
That server route uses an explicitly supplied one-use temporary header and
otherwise falls back to its configured server environment. A malformed
temporary header is rejected instead of silently switching credentials. The
route adds the session configuration and calls
`https://api.openai.com/v1/realtime/calls` with the selected key, then returns
only the SDP answer to the browser. Audio uses the WebRTC media connection and
Realtime events use its data channel. This follows OpenAI's recommended WebRTC
path for browser clients and the unified server interface described in the
[official WebRTC guide](https://developers.openai.com/api/docs/guides/realtime-webrtc).

If neither a temporary key nor `OPENAI_API_KEY` is available, the 3D lesson
still loads and all navigation and non-voice explanations continue to work.
Enabling the guide shows a contained "not configured" error without attempting
a direct browser-to-OpenAI API call.

### How the guide knows what you mean

Each voice turn receives a small, structured context snapshot rather than the
entire world:

1. Stable tutor instructions define tone, grounding, and the distinction
   between the tiny teaching trace and a production LLM.
2. A compact process overview locates the exhibit within data preparation,
   forward pass, loss, backward pass, and AdamW update.
3. The current chamber supplies its story, structure, math, shape, formula, and
   active teaching branch.
4. The raycast-selected component supplies its role, inputs, operation,
   outputs, exact trace values, and current visible animation state.

`app/lib/assistantContext.ts` owns those model-facing facts. Three.js matching
names and avatar presentation anchors live in a separate registry so scene
coordinates are never mistaken for teaching content. The per-turn snapshot is
deeply cloned and frozen before it is inserted as a text conversation item;
the Realtime session retains the spoken conversation itself. See OpenAI's
[Realtime conversation guide](https://developers.openai.com/api/docs/guides/realtime-conversations)
for the underlying conversation-item model.

## Deterministic teaching model

All displayed numerical relationships share one deliberately tiny decoder-only
model and one selected trace:

| Quantity | Value |
| --- | ---: |
| Batch size | 2 |
| Sequence length | 6 |
| Vocabulary size | 16 |
| Model width | 8 |
| Transformer blocks | 2 |
| Attention heads | 2 |
| Head width | 4 |
| Feed-forward width | 32 |
| Valid next-token predictions | 12 |

The selected example follows `cat` predicting `sat`, from a causal-attention
score and weighted value through the token loss. The optimizer view follows
`block.0.attention.WQ[3, 6]`: its forward value, accumulated gradient, AdamW
moments, decoupled weight decay, delta, and updated value are internally
consistent parts of the same trace. Token IDs remain addresses; gradients reach
selected embedding rows, not the integer IDs or tokenizer.

## Project architecture

- `app/lib/trainingTrace.ts` is the content and numeric source of truth: model
  dimensions, phases, stations, branch metadata, and selected exact values.
- `trainer/` is a real, configurable PyTorch training package with disk-backed
  corpus preparation, a decoder-only Transformer, AdamW, validation, and
  resumable checkpoints.
- `scripts/sync-training-code.mjs` extracts marked excerpts from that runnable
  Python source into `app/lib/generatedTrainingCode.ts`, preventing the Code
  view from drifting into separately maintained pseudocode.
- `app/components/TrainingExperience.tsx` owns ride state, timing, keyboard and
  wheel travel, and coordinates the world with the HUD.
- `app/components/TrainingWorldCanvas.tsx` builds and animates the Three.js
  world, camera route, semantic station geometry, opaque chambers, enclosed
  corridors, and guide line.
- `app/components/TrainingHUD.tsx` renders the phase rail, breadcrumbs,
  explanation layers, formula/shape readouts, branches, legend, and timeline.
- `app/page.tsx` and `app/layout.tsx` provide the route and site metadata.
- `tests/rendered-html.test.mjs` validates the production render plus important
  content, numeric, controls, and Three.js source contracts.

The guide route is a transparent `THREE.Line` with `LineBasicMaterial`, so it
stays a screen-space line rather than becoming a physical tube. Tubes elsewhere
in the world represent data paths and machinery, not the navigation guide.

Each station now occupies its own non-transparent chamber. Short rectangular
corridors join adjacent rooms, and distant station groups are hidden so content
from earlier or later concepts cannot visually overlap the current lesson. A
single dim moving beacon replaces the former multi-particle stream.

## Judge quick start

For the core 3D lesson (no API key or Python required), use Node.js 22.13 or
newer:

```powershell
npm ci
npm run dev
```

Open the **Local** URL printed by the terminal. The complete lesson, modes,
branches, HUD, Math/Code panels, and spotlight magnifier work without the voice
guide. To test the optional guide, set `OPENAI_API_KEY` on the server before
starting and allow microphone access.

For the real local trainer, install its environment once:

```powershell
cd trainer
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
cd ..
npm run dev:training
```

Run the last command once, leave it open, and open its printed Local URL. In
**Custom Training**, upload this `README.md` as a sample corpus and choose
**Micro**, **64 byte tokens**, **Quick**, and **CPU**. The companion is
loopback-only, so a hosted page cannot start it. Full test instructions are in
[`demo/JUDGE-TESTING.md`](demo/JUDGE-TESTING.md).

## Run locally

Node.js 22.13 or newer is required.

```bash
npm install
npm run dev
```

To open the site together with the real local PyTorch companion used by the
**Custom Training Chamber**, first install the trainer environment described
below, then run:

```bash
npm run dev:training
```

Run this command exactly once from the project root and leave that terminal
open. It starts both the website and the loopback-only Python companion. Open
the **Local** URL printed in that terminal. If the command is already running,
use its existing Local URL instead of starting a second copy; the launcher will
now refuse a duplicate trainer.

To recover an interrupted run, the original PowerShell window is not required.
If no trainer is currently connected, open any PowerShell, change to the
project root, run `npm run dev:training` once, leave it open, and open the Local
URL it prints. Select the saved run and click **Resume from checkpoint**. The
prepared corpus and saved configuration are reused automatically.

The chamber accepts local `.txt` and `.md` files, derives a guarded training
configuration from the selected preset, and shows authentic loss, validation,
throughput, fixed-seed text samples, checkpoints, and process logs. Training
continues in the local companion when the browser navigates away. The hosted
site cannot start PyTorch by itself, so its chamber shows a connection notice
until that loopback-only companion is running.

Useful project commands:

```bash
npm run build   # create the production bundle
npm test        # build, server-render, and run the contract suite
npm run lint    # run ESLint
npm run start   # serve an existing production build
npm run dev:training # run the site and local trainer together
```

## Run the real trainer

The visualizer and trainer live in the same repository but use separate
runtimes. Python 3.11 or newer is required for training:

```powershell
cd trainer
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
chamber-trainer train --config configs/toy.toml
```

If PowerShell blocks activation, use the environment's interpreter directly:

```powershell
.\.venv\Scripts\python.exe -m pip install -e .
.\.venv\Scripts\python.exe -m chamber_trainer train --config configs/toy.toml
```

The toy and local-corpus profiles use the same model and optimizer code. To
prepare a larger collection of `.txt` and `.md` files without loading the whole
corpus into memory:

```powershell
chamber-trainer prepare --input C:\path\to\corpus --output data\local
chamber-trainer train --config configs/local.toml
```

See `trainer/README.md` for configuration, device, precision, checkpoint, and
resume details.

The package also exposes the requested Bun-compatible server entry. After
installing dependencies, this command builds the site and then serves it:

```bash
bun run server
```

`server` is intentionally a foreground process; stop it with `Ctrl+C`.
