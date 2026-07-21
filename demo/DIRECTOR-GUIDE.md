# Demo Director — how to record the competition video

The app now has a built-in scripted flight that flies your exact storyboard
and records itself. Nothing about the normal visitor experience changes;
everything is dormant until you opt in.

## One-time setup

1. Start the dev server (or production build) as usual.
2. Start the trainer bridge in PowerShell (for the finale) and leave it
   running.
3. Open the **Local URL printed by the terminal**, append
   **`?director=1`**, and use that address in Chrome. The port may not be 3000.
   (`Ctrl+Shift+D` also toggles the panel on any page.)
4. **Enable the voice guide** (the assistant dock) and grant the mic —
   needed only for the live Q&A beat in the Causal Mask chamber.
5. Optional but recommended: 1920×1080 window, close other tabs.

## Recording a take

1. Click **● Record & fly** in the DEMO DIRECTOR panel (bottom-right).
2. Chrome shows a share picker — choose **This tab** (it's preselected).
   Tab capture records only the page: no browser chrome, no cursor.
3. Hands off. The flight runs itself:
   - machine-room orbit (close desk framing) → dive into Data Preparation
   - tracked data-prep watch, standing close to the boards (~19s)
   - four zooms, two chambers each: Data Prep (1 — first four stages only
     — +2), Tower (dive lands in 5, flies into 6+7), Backprop (19+20),
     AdamW (22 + fly-through of 23 + 24) — between zooms the camera
     **rises back to the machine room, glances at the next desk unit, and
     dives in**
   - signature moves: extreme close-up onto a Block 0 matrix (6), full
     circle to *behind* the attention matrices (7), sweep in Backprop
     Tower (20); the AdamW visit auto-cycles Story → Structure → Math →
     Code for the trainer-sync beat
   - **Backprop (19): the spotlight opens the mic hands-free — ask your
     question out loud** (e.g. *"what exactly is flowing backward through
     this matrix?"*) and the guide answers on camera (~11s window)
   - hop to Custom Training; the corpus auto-fills from **your local
     folder** (`C:\Users\Test1\Desktop\aaa` — every .txt/.md file, served
     by `/api/director/corpus`; set `DIRECTOR_CORPUS_DIR` for a different
     folder; built-in passage as fallback); the real run starts
   - after ~8s of training the camera returns to the machine room and the
     end card plays over the desk (the trainer keeps running)
   - the `.webm` downloads automatically.
4. `Esc` aborts a take (partial recording still downloads).
5. **▶ Fly without recording** does a dry run — use it to rehearse the
   guide question and check pacing.

## Tuning

All pacing lives in `app/lib/director/flightPlan.ts`:

- `PACING` — every duration (dwells, data-prep length, spotlight window,
  finale watch time…). Total runtime scales directly with these.
- `CHAMBER_VISITS` — which chambers get which treatment; swap a `std(n)`
  for a `showcase(n, "arc-right")` to promote a chamber.
- `ROOM_ORBIT` / `DATA_PREP_TRACK` — camera waypoints for the intro and
  the data-prep tracking shot.
- `FINALE_CORPUS` / `END_CARD` — the typed text and the closing card.

## Getting an MP4

Judges' platforms accept `.webm` less often than `.mp4`. Convert with:

```
ffmpeg -i inside-one-training-step-demo-<stamp>.webm -c:v libx264 -crf 18 -preset slow -c:a aac -b:a 192k demo.mp4
```

Then lay the voiceover (`demo/VOICEOVER.md`) over it in any editor —
or hand me the `.webm` + a voice track and I'll mux them.

## Known judgment calls

- The flight drives the same navigation paths a visitor uses (portals,
  tunnels, dives), so what's on film is the real product, not a cheat cam.
- If the trainer bridge is offline, the finale types the corpus, notes the
  trainer is offline, and proceeds to the end card gracefully.
- If the share picker is cancelled, the flight flies anyway without
  recording (rehearsal mode).
