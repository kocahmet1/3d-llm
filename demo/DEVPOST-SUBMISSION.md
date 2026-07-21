# Earlier Devpost draft — use `DEVPOST-FINAL.md`

> This file is retained for reference. The audited, corrected, paste-ready
> version is `demo/DEVPOST-FINAL.md`; its checklist is
> `demo/SUBMISSION-CHECKLIST.md`.

Everything you need to finish the OpenAI Build Week submission. Paste the marked
sections into the form. Items only you can do are in the checklist at the bottom.

> ⚠️ Before you paste the Project Story: read it once and add one genuinely
> personal sentence (why *you* cared about this). Judges are told they can spot
> an unedited AI description — a single honest line in your own voice fixes that.

---

## 1) Elevator pitch (≤ 200 characters)

Your current one — "Training a toy llm with 3d visuals" — undersells it. Pick one:

- **A.** Walk through one entire LLM training step in first-person 3D — 25 chambers, every number real, a live voice guide, and a real PyTorch trainer that runs on your own text.
- **B.** A first-person 3D world that turns one language-model training step into a place you can walk through. Nothing hand-waved: every number comes from one real trace.
- **C.** See exactly what happens inside one LLM training step — a walkable 3D world with a realtime voice guide and a real local trainer built in.

(A is ~185 chars, B ~165, C ~135 — all fit.)

---

## 2) Built with (tags — paste into the "Built with" field)

`three.js` · `typescript` · `react` · `next.js` · `webgl` · `webrtc` · `python` · `pytorch` · `openai` · `openai-realtime-api` · `vite` · `tailwindcss` · `cloudflare-workers` · `drizzle` · `codex` · `gpt-5.6`

---

## 3) Project Story — paste into "About the project"

<!-- ===== BEGIN PASTE ===== -->

## Inspiration

Everyone learning how large language models work hits the same wall: the diagrams. A stack of boxes labeled "attention," an arrow that says "backprop," a loss that appears out of nowhere. I wanted to stop drawing the arrow and actually walk down it. What if one training step of a language model were a *place* — somewhere you could stand inside an attention head, watch the loss gather up its errors, and follow a gradient backward through the exact tower the activations climbed?

That's the whole idea. Not a claim that neural networks have a physical shape, but a **semantic infinite zoom**: training loop → model → Transformer block → attention → head → tensor → scalar. Moving forward is the forward pass; moving backward is backprop.

## What it does

It's a first-person 3D world — like a game — that walks you through **one complete LLM training step** across **25 stations** in six phases: orient, prepare the data, predict, measure the loss, trace gradients backward, and adjust the weights with AdamW. Then it shows the next step beginning with a changed model.

The part I care about most: **nothing is hand-waved.** Every number in every chamber comes from one deterministic teaching trace — a deliberately tiny decoder-only model (batch 2, sequence length 6, vocabulary 16, width 8, 2 blocks, 2 heads, 4-wide heads). The worked example follows the token `cat` predicting `sat`: a causal-attention score, a weighted value, and its share of the loss. The optimizer view follows one real parameter, `block.0.attention.WQ[3, 6]`, through its gradient, AdamW moments, decoupled weight decay, and final updated value. The softmax, the cross-entropy, and the AdamW update are all internally consistent — accurate enough that an ML researcher shouldn't find anything wrong, while still readable by a beginner.

$$L = -\frac{1}{N}\sum_{i=1}^{N} \log p_{\theta}\!\left(x_i^{\text{target}} \mid x_{<i}\right)$$

Every station has four explanation layers you can switch between: **Story** (plain language), **Structure** (real component and tensor names), **Math** (shapes, formulas, exact values), and **Code** (the matching excerpt from a *runnable* PyTorch trainer). Take it as a ~25-second **Overview** ride, a slower ~2.5-minute **Learn** pass, or step off and **Explore** on foot.

Two features I'm proud of:

- **A realtime voice guide.** Right-click any component — a query vector, the causal mask, a single logit — and it lifts onto a lit stage while an in-world guide (OpenAI Realtime API) walks over and explains *exactly* what you're pointing at. It can also drive the lesson through allowlisted function calls ("take me to cross-entropy," "show the math view," "choose the right branch"), each validated against a fixed set of controls — never arbitrary clicks, URLs, or scripts.
- **A real trainer.** The Custom Training Chamber isn't a video. Paste your own `.txt`, hit start, and a real decoder-only Transformer trains on your machine — authentic loss, validation, throughput, checkpoints — the same loop you just walked through. A sync script pulls the Code-view snippets straight from that Python source, so the lesson can't drift into fake pseudocode.

## How I built it (Codex + GPT-5.6)

Almost the entire project was built with **OpenAI Codex**, running **GPT-5.6 (Sol Ultra)**. I worked as the director: I set the machine-learning story, decided what each of the 25 chambers had to teach, reviewed every change, and made small manual edits throughout. A handful of smaller, local edits used other GPT models.

What made **GPT-5.6** the right model was long-horizon reasoning. This world only holds together because a lot of invariants stay true at once: every displayed number traces back to one source of truth; logits are stored so softmax reproduces the stored probabilities; attention input is always written N = LN₁(H); and adding a single station means touching the trace, the geometry, the HUD, and the overview index together. Keeping all of that coherent across hundreds of iterations — a 25-chamber Three.js world, a real optimizer, and one consistent trace — is exactly what falls apart with a shorter-horizon model. Codex + GPT-5.6 held the whole structure at once while I kept the ML honest.

One note for judges: the in-app voice guide is a separate feature built on the OpenAI **Realtime API**, not GPT-5.6. GPT-5.6 was the *development* model behind Codex.

## Challenges I ran into

The hardest constraint was the dual audience — **beginner-legible and researcher-accurate at the same time.** It would have been easy to make it pretty and wrong. So I did a full ML accuracy review and fixed the subtle things: special-token injection in data prep, the final-layernorm backward, gradient clipping, and the distinction between activation gradients and parameter gradients — while being explicit about what's deliberately out of scope (dropout in the trace, SFT/RLHF).

The other hard part was purely 3D: keeping the world readable. Chambers had to be opaque so a later concept never bleeds into the current one; no component can sit dead-center in front of the matrix it's explaining; and the camera had to enter each chamber at eye level with the exhibits instead of craning up from the floor. Many iterations went into occlusion, lighting, and a cool slate-blue gallery palette that reads cleanly.

## What I learned

Building an explanation this literal forced me to actually understand every step — you can't animate a gradient you're fuzzy on. And Codex changed how I work: with a model that can hold the whole system at once, my job shifted from typing code to *directing* — specifying invariants, reviewing for correctness, and protecting the teaching story.

## What's next

Per-component voice targeting for all 25 stations (7 done so far), the post-training chambers (SFT / RLHF) that are currently out of scope, and a shareable hosted build so anyone can walk through a training step from a browser.

<!-- ===== END PASTE ===== -->

---

## 4) Pre-submit checklist — things to take care of

You had **~3 hours to deadline** on the screenshots, so do these in order.

### 🔴 Do first — the long pole is the video
1. **Record the demo video.** Your app records itself: run the dev server + trainer bridge, open `http://localhost:3000/?director=1`, enable the voice guide, click **● Record & fly**, choose **This tab**. Full steps in `demo/DIRECTOR-GUIDE.md`.
2. **Keep it under 3 minutes.** The flight is ~2:35–2:50. If it runs long: speed playback to 1.1–1.25×, cut silences/typing. (Tips are in the form's guidelines.)
3. **Add the voiceover** from `demo/VOICEOVER.md` — it already covers what you built, how you used Codex, and how you used GPT-5.6. Record narration *over* the finished video, not live.
4. **Convert `.webm` → `.mp4`** (ffmpeg one-liner in `DIRECTOR-GUIDE.md`), then **upload to YouTube as public** and paste the link into **Video demo link** (required).

### 🟠 Required form fields
5. **Code repo URL** (Additional info): paste your repo link. If it's **private, share it** with `testing@devpost.com` **and** `build-week-event@openai.com`.
6. **README** must highlight how Codex & GPT-5.6 were used — ✅ I just added that section (see `README.md`, "How this was built"). Confirm it's committed/pushed before you submit.
7. **/feedback Codex Session ID** (required): retrieve it and paste it in. See the hackathon **FAQs** for where to find it — it's a string of letters/numbers.
8. **Submitter Type**, **Country of Residence**, **Category** — pick these yourself (dropdowns; I can't see the options). For category, choose the one that best fits (likely a "best use of GPT-5.6 / Codex" or "education/creative" bucket — read the options).
9. **"Try it out" links**: your repo, and a hosted URL if you have one deployed (you have Cloudflare/wrangler set up). If there's no hosted build, point judges to the **Run locally** steps in the README.
10. **Judges' test instructions** (the "link for judges" box): note that the voice guide needs an `OPENAI_API_KEY` and the Custom Training Chamber runs a local PyTorch companion (`npm run dev:training`). Include any credentials there — that field is private.

### 🟡 Polish / confirm
11. **Image gallery**: add 3–5 screenshots (3:2 ratio). Good picks: the machine room, an attention chamber, the spotlight + voice guide, the Logits Landscape, the live loss curve in Custom Training. (You have some in `public/og-*.png`.)
12. **Elevator pitch**: swap in one of the options above (section 1).
13. **Team**: make sure any teammates are added and have *accepted* — unaccepted invites don't count.
14. **Plugin/dev-tool install field**: N/A unless you're pitching the trainer as a dev tool. If you are, point to the README's "Run the real trainer" section.
15. **Don't leave it as a draft.** Complete all 5 steps and actually hit **Submit** — a saved draft is not a submission.
