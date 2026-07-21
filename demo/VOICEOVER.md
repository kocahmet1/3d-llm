# Competition demo voiceover — final short version

Target: about **2:10 of narration**, plus an 8–10 second live guide answer and
visual pauses. This leaves useful safety margin under the hard three-minute
limit. Read it once in your own voice and change any wording that does not
match how you actually used Codex and GPT-5.6.

The credit section appears before the finale so the required Codex/GPT-5.6
explanation cannot be cut off if the final recording runs long.

---

**[Opening machine room]**

> This is *Inside One Training Step*, an explorable 3D world built to make one
> language-model training step visible. Instead of jumping between diagrams,
> you move with the data—from raw text to a changed model.

**[Data preparation]**

> The route spans twenty-five stations across data preparation, the forward
> pass, loss, backpropagation, and an AdamW update. The model is deliberately
> tiny, but the story is exact: batch two, six tokens, two Transformer blocks,
> and one controlled, internally consistent numeric trace.

**[Dive into the Transformer Tower — Block 0 close-up, then attention circled
from behind]**

> Diving into the Transformer Tower: token embeddings flow through Block 0,
> where normalized hidden states become queries, keys, and values, and the
> causal mask blocks future positions.

**[Spotlight a gradient exhibit in Backprop — the flight triggers this at
station 19, right after the dive into Backprop Return]**

> When I right-click a supported exhibit, it rises onto a spotlight stage. The
> OpenAI Realtime voice guide receives a frozen, structured snapshot of what I
> selected, so I can ask: “What exactly is flowing backward through this
> matrix?”

**[Let the guide answer for 8–10 seconds, then interrupt or cut.]**

**[Logits, loss, and backpropagation]**

> Then logits become probabilities, the correct targets produce twelve token
> penalties, and their mean becomes cross-entropy loss. Gradients travel
> backward through the same operations before AdamW updates the parameters.

**[AdamW chamber — the panel cycles Story → Structure → Math → Code on its own]**

> Each station has Story, Structure, Math, and Code views. The code is not
> pseudocode: marked excerpts are synchronized from the runnable PyTorch
> trainer in this repository.

**[Continue chamber footage — required build credit]**

> I built this primarily in Codex using GPT-5.6. I directed the teaching
> sequence and reviewed the machine-learning decisions; Codex helped implement
> and refactor the Three.js world, deterministic trace, interface, Realtime
> integration, demo director, and trainer. GPT-5.6's long-horizon reasoning
> helped keep those pieces and their shared invariants consistent as the
> project grew. The runtime voice guide is a separate Realtime API feature.

**[Custom Training Chamber]**

> Finally, the Custom Training Chamber accepts pasted text or text and Markdown
> files. A local PyTorch companion prepares a byte-level corpus, trains a real
> decoder-only Transformer, and reports training and validation loss,
> throughput, samples, and checkpoints.

**[End card]**

> This is one training step made explorable—and a real loop you can run
> yourself.

---

## Recording checks

- Record the narration separately over the finished screen capture.
- Keep the guide answer to 8–10 seconds; interrupt it cleanly if needed.
- Do not say that every number is a live trainer output. The exhibit uses a
  controlled teaching trace whose relationships were verified separately.
- Do not promise that loss falls monotonically. Show the authentic metrics.
- If your actual workflow differs from the Codex/GPT-5.6 paragraph, correct it
  before recording.
- Export at 3:00 or shorter and listen once to the entire final file.
