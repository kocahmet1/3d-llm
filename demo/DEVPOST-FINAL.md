# OpenAI Build Week — final Devpost copy

Use this file as the source for the form. Before pasting the Project Story,
replace the two `PERSONALIZE` lines with your own honest sentences and verify
the Codex/GPT-5.6 credit reflects how you actually worked.

## Project name

The submitted name is your decision. The app, README, metadata, voiceover, and
video end card currently say **Inside One Training Step**, while the Devpost
draft says **3d Llm Training**. Pick the name you want and make every surface
match. The copy below uses the existing in-product name.

## Elevator pitch (under 200 characters)

Walk through one complete LLM training step in first-person 3D—25 chambers, one consistent numeric trace, a realtime voice guide, and a real local PyTorch trainer.

## Category

**Education** is the clearest fit: the primary audience and purpose are people
learning how language-model training works.

## Built with

Paste these as separate tags:

`Three.js` · `WebGL` · `TypeScript` · `React` · `Next.js` · `Vite` ·
`Vinext` · `Python` · `PyTorch` · `OpenAI Realtime API` · `WebRTC` ·
`Codex` · `GPT-5.6`

Only add `Cloudflare Workers` if the submitted demo is actually deployed on
that target. Do not add Drizzle; it is present only as unused scaffolding.

## Project Story — paste into “About the project”

<!-- BEGIN DEVPOST STORY -->

## Inspiration

**PERSONALIZE: Add one sentence in your own words about why you cared about making model training understandable.**

Most explanations of language-model training compress the hardest parts into boxes and arrows. Attention is a box, backpropagation is an arrow, and the loss appears almost by magic. I wanted to turn one complete training step into a place you could move through: follow the data forward, watch predictions become a loss, and then trace the gradients back to a concrete weight update.

The 3D world is a teaching metaphor, not a claim that a neural network has a literal physical shape. Space communicates containment—training loop → model → Transformer block → attention → head → tensor → scalar—while motion communicates time.

## What it does

Inside One Training Step is an interactive first-person 3D journey through one complete decoder-only language-model training step.

The authored route contains 25 stations across six phases:

1. Orient to the complete training loop
2. Prepare text, token windows, inputs, and shifted targets
3. Run embeddings, Transformer blocks, attention, the MLP, and vocabulary prediction
4. Measure cross-entropy loss
5. Follow gradients backward
6. Apply one AdamW update and begin the next step with a changed model

Visitors can take a fast Overview, a slower Learn ride, or switch to Explore and inspect the world manually. Six junctions offer alternate teaching branches. Every station also has four explanation layers: Story, Structure, Math, and Code.

The lesson uses a deliberately tiny teaching model: batch size 2, sequence length 6, vocabulary size 16, width 8, two Transformer blocks, two attention heads, and 12 next-token predictions. One worked example follows `cat` predicting `sat`, from attention scores and weighted values through its token loss. The optimizer view follows one selected parameter, `block.0.attention.WQ[3,6]`, through its gradient, AdamW moments, weight decay, and updated value.

All selected numeric relationships come from one controlled deterministic trace. Its softmax, cross-entropy, gradients, and AdamW calculations were checked for internal consistency. The trace is intentionally separate from the trainer's seeded random outputs, so the exhibit never pretends that curated teaching decimals came from a particular run.

The project also includes a contextual voice guide built with the OpenAI Realtime API over WebRTC. Right-clicking a supported exhibit lifts a magnified replica onto a spotlight stage. The guide receives a small, frozen snapshot describing the current chamber, selected exhibit, visible values, teaching branch, and explanation mode, so words such as “this” stay grounded even if the camera moves. Every station has accurate station-level context, while key chambers also have detailed component-level targets.

The guide can operate the lesson through a small allowlist of validated tools: navigating between chambers, pausing or continuing, switching explanation or ride modes, choosing a branch, and controlling data-preparation playback. It never receives a generic browser click, DOM selector, URL, or script tool.

Finally, the Custom Training Chamber connects to a real local PyTorch trainer. A visitor can paste text or add `.txt` and `.md` files, choose a guarded configuration, and train a small byte-level decoder-only Transformer on their own machine. The interface reports authentic training and validation loss, throughput, fixed-seed samples, logs, and checkpoints, and supports pause, stop, resume, and checkpoint recovery.

## How I built it

The browser experience is built with React, TypeScript, Three.js, and WebGL. A single source-of-truth trace defines the model dimensions, lesson phases, station content, branches, and selected numeric values. The scene and HUD consume that shared structure.

The trainer is a separate Python and PyTorch package implementing byte tokenization, disk-backed batching, a pre-LayerNorm decoder-only Transformer, cross-entropy, automatic differentiation, AdamW, validation, text generation, and resumable checkpoints. Marked excerpts are synchronized directly from that runnable Python source into each station's Code view, preventing the exhibit from drifting into separately maintained pseudocode.

I used Codex as my primary engineering workspace, with GPT-5.6 as the main development model. I supplied the teaching goals, interaction requirements, and accuracy constraints; Codex helped implement and repeatedly refactor the Three.js chambers, deterministic trace, interface, Realtime integration, demo director, and local trainer.

GPT-5.6 was especially useful when a change crossed several parts of the system at once. Adding or correcting one concept could require coordinated changes to the trace, geometry, HUD, voice-guide context, trainer excerpt, and tests while preserving the same mathematical invariants. Its long-horizon reasoning helped keep those pieces coherent as the project grew.

The runtime voice guide is a separate OpenAI Realtime API feature. GPT-5.6 was the development model used through Codex, not the model serving voice responses inside the app.

## Challenges I ran into

The hardest challenge was serving two audiences at once: making the experience legible to a beginner without making it misleading to someone who knows the machinery. I performed a dedicated ML accuracy review and corrected details including special-token injection, normalized attention input, final-LayerNorm backpropagation, gradient clipping, and the distinction between activation gradients, parameter gradients, and actual updates.

The second challenge was spatial readability. Each concept needed its own opaque chamber so future ideas would not bleed through the current lesson. Camera height, occlusion, lighting, labels, and component placement all required iteration so the world stayed readable while moving.

Grounding the voice guide presented a third challenge. The solution was to give it structured teaching context for the selected exhibit and tightly scoped lesson controls instead of broad access to the page.

## What I learned

Turning every transition into a visible event exposed places where a box-and-arrow explanation would have hidden uncertainty. If I could not say exactly what entered a chamber, what operation happened there, and what left it, the scene was not ready.

**PERSONALIZE: Add one concrete thing you learned, changed your mind about, or found unexpectedly difficult.**

Codex also changed the shape of the work. My role became less about typing every line and more about specifying invariants, reviewing behavior, testing the result, and protecting the teaching story across a growing system.

## What's next

I would like to extend detailed component-level voice targeting to more chambers, add post-training lessons such as supervised fine-tuning and preference optimization, improve accessibility and performance on more devices, and make the core experience easy to share from a hosted URL while keeping private corpus training local.

<!-- END DEVPOST STORY -->

## Try it out links

Add, in this order if available:

1. `[HOSTED DEMO URL]`
2. `[CODE REPOSITORY URL]`

Do not paste a localhost URL. The YouTube URL belongs in the required Video
demo link field.

## Additional-info fields

- **Submitter type:** choose the truthful option for you (individual, team, or
  organization).
- **Country of residence:** choose your actual country of residence.
- **Repository URL:** `[CODE REPOSITORY URL]`.
- **Judge link/instructions:** paste the short block from
  `demo/JUDGE-TESTING.md`.
- **Session ID:** in the primary Codex build thread, type `/status` and copy the
  Session ID. The current hackathon FAQ uses `/status` even though the form
  label still calls it a “/feedback Session ID.” If your Codex surface does not
  show it there, run `/feedback`, share that session, and copy the returned ID.
- **Plugin/developer-tool instructions:** leave blank or write “Not applicable—
  submitted in Education” unless you intentionally classify the project as a
  developer tool.

## One final truth check

Confirm before pasting that:

- GPT-5.6 really was the main development model for the work described.
- “Codex was my primary engineering workspace” matches your actual workflow.
- Any other material tools/models are credited if needed.
- The voice guide and trainer shown in the video are the versions in the
  submitted repository.
