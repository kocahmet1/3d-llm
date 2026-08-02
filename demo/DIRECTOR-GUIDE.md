# Demo Director — how to record the competition video

The app now has a built-in scripted flight that flies your exact storyboard
and records itself. Nothing about the normal visitor experience changes;
everything is dormant until you opt in.

## One-time setup

1. **Build first — do not record from `npm run dev`.** The dev server ships
   unminified modules and double-mounts the canvas under React StrictMode:

   ```bash
   npm run build
   npm run start
   ```

2. Open the **Local URL printed by the terminal**, append
   **`?director=1`**, and use that address in Chrome. The port may not be 3000.
   (`Ctrl+Shift+D` also toggles the panel on any page.)
3. Set the Windows display to **100% scaling** and size the window so the
   viewport is about **1920×1080**. The flight renders one device pixel per CSS
   pixel and captures at exactly the canvas backing-store size, so this makes
   the file a 1:1 read of the framebuffer — nothing upscaled, nothing softened.
4. Close DevTools and other tabs, and quit the Python trainer if it is running.

The flight no longer needs the trainer bridge or the mic — it stays inside
the world from first frame to end card.

## Smoothness

**Fly once without recording before every take.** The panel reports average
fps, worst-frame fps, and how many frames ran slow, and turns amber if the
take would be choppy. Frame drops never desynchronize the flight — it is
driven by elapsed time — so the only symptom is a jolt in the camera, which
you cannot hear in the labels.

What the flight already does for you, at arm time, before a frame is filmed:

- **Compiles every shader in the world.** Only the chamber you are standing in
  is visible, so three.js would otherwise compile each chamber's programs on
  the frame it first appears — a stall per chamber, a dozen times a take. The
  screen holds its last frame during the prewarm, so none of it is seen.
- **Renders at capture resolution.** A 2× display would otherwise draw four
  times the pixels that reach the encoder.
- **Prefers hardware H.264** and writes `.mp4` when Chrome offers it. Software
  VP9 competes with the render loop for the same cores. If you get a `.webm`,
  this machine had no H.264 encoder and the ffmpeg step below still applies.
- **Throttles its own status updates** so the panel is not re-rendering sixty
  times a second during the thing it is measuring.

## Recording a take

1. Click **● Record & fly** in the DEMO DIRECTOR panel (bottom-right).
2. Chrome shows a share picker — choose **This tab** (it's preselected).
   Tab capture records only the page: no browser chrome, no cursor.
3. Hands off. The flight runs itself, in three zooms and a closing beat:
   - **titles over the opening** — the site's own "Inside One Training Step"
     and "Built with GPT 5.6 Ultra & Codex" cards, at their normal durations.
     The overlay is transparent, so they play *across* the machine-room move
     rather than in front of it and cost the film no extra seconds. The Skip
     button is suppressed for a take.
   - **machine-room orbit** — close desk framing, a pan across the seven
     units, then a dive at the Data Preparation miniature
   - **the orientation gallery (0)** — the dive surfaces in the hall (it is
     the prologue to the machine and has no miniature of its own). Reads the
     first placard square-on for 3s, then walks the length of the hall at a
     normal pace and out through the doorway; the other four placards pass on
     alternating sides on the way
   - **the data wing on foot** — Corpus & Data Preparation (1) for 4s and
     Token Stream & Context (2) for 3s, both held on the exact mark a
     visitor walking in through the tunnel lands on
   - **Transformer Tower** — the tower hall (5) for 4s, Block 0 (6) for 3s,
     then the Multi-Head Attention Hall (7), where five of its weight
     matrices are highlighted one at a time by the same tool a visitor drives
     with a right-click: the red beam fires, the exhibit holds for a second,
     it drops, then the beam picks the next
   - **Backprop Return** — the output backprop hall (19) for 4s, the tower
     backprop hall (20) for 3s, then a sprint straight through the
     parameter matrix, the optimizer state and the weight update to the
     final chamber (24) for 2s
   - between zooms the camera **rises back to the machine room, glances at
     the next desk unit, and dives in**
   - **the closing beat** — home to the machine room, briskly across to the
     custom-training console, into the panel itself for 2.5s, back out to the
     room for a second, end card
   - the `.webm` downloads automatically.
4. `Esc` aborts a take (partial recording still downloads).
5. **▶ Fly without recording** does a dry run — use it to check pacing.

## Tuning

All pacing lives in `app/lib/director/flightPlan.ts`:

- `PACING` — every duration (the orientation beats, chamber dwells, the
  per-highlight second, the console hold…). Runtime scales directly with
  these.
- `OPENING_VISITS` / `DIVE_LEGS` — which chambers get which treatment.
  A visit's `choreo` picks its camera move (`landing` roots it on the
  arrival mark; `push`, `sweep-tilt`, `orbit-behind`, `extreme-close` and
  the rest move around), `highlights` lists exhibits to spotlight by target
  id, and `express` sprints through everything in between.
- `ORIENTATION` — the gallery waypoints, mirrored from the bay geometry in
  `components/chambers/orientationGallery.ts`.
- `ROOM_ORBIT` / `ROOM_PAN` / `ROOM_AIM` — the machine-room intro.
- `ATTENTION_HIGHLIGHTS` / `END_CARD` — the five matrices and the closing card.

## Getting an MP4

Takes come out as `.mp4` already on any machine whose Chrome offers a
hardware H.264 encoder. If yours produced a `.webm`, convert it:

```
ffmpeg -i inside-one-training-step-demo-<stamp>.webm -c:v libx264 -crf 18 -preset slow -c:a aac -b:a 192k demo.mp4
```

Then lay the voiceover (`demo/VOICEOVER.md`) over it in any editor —
or hand me the `.webm` + a voice track and I'll mux them.

## Known judgment calls

- The flight drives the same navigation paths a visitor uses (portals,
  tunnels, dives, the right-click highlight, the console screen), so what's
  on film is the real product, not a cheat cam.
- The HUD's coaching cues are suppressed for the duration of a take
  ("Left-click, then walk with WASD", "Aim at any station and scroll to move
  in", the machine-room prompts). They teach a visitor who is about to press
  something; a flight enters ten chambers, so they would otherwise fire
  almost continuously at a viewer who is not holding a mouse.
- The orientation hall's own guided walk is suppressed while a flight is
  driving, so the director's route through it owns the camera.
- Every transit has a timeout; if one overruns, the camera snaps to the
  destination rather than stranding the take in a corridor.
- If the share picker is cancelled, the flight flies anyway without
  recording (rehearsal mode).
