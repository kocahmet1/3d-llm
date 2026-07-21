# Final submission checklist — deadline order

Official deadline: **July 21, 2026 at 5:00 PM PDT**, which is **July 22 at
03:00 in Istanbul**. Devpost says submissions cannot be edited after that time.

## Submit a valid entry first

- [ ] Decide your project name. Make Devpost match the existing app/README/
      video name, or deliberately update all of those surfaces.
- [ ] Paste the elevator pitch, Built with tags, and Project Story from
      `demo/DEVPOST-FINAL.md`.
- [ ] Replace both `PERSONALIZE` lines and read the story once in your own
      voice. Do not leave either marker in the submission.
- [ ] Select **Education** (recommended for this project's purpose).
- [ ] Choose the truthful submitter type and country of residence.
- [ ] Add every teammate and make sure each invitation is accepted.

## Repository — currently a blocker

- [ ] Wait until active Git processes finish. `.git/index.lock` currently
      exists; do not delete it while a Git operation may still be running.
- [ ] Review the working tree. It currently contains major modified and
      untracked product files, not just documentation.
- [ ] Commit every intended app, trainer, test, README, and `demo/` file.
- [ ] Create/connect a remote repository. This checkout currently has no
      remote URL configured, so there is no valid repository link to paste.
- [ ] Push the final commit and verify in the repository website that the
      machine room, assistant tools, demo director, README changes, and tests
      are present.
- [ ] If private, share it with **testing@devpost.com** and
      **build-week-event@openai.com**.
- [ ] Paste the repository URL into Additional info.

## Session ID

- [ ] Open the Codex thread where most core development happened.
- [ ] Type `/status` and copy its Session ID (the current hackathon FAQ's
      instruction). If that surface does not show it, run `/feedback`, choose
      to share the current session, submit, and copy the returned ID.
- [ ] Paste the ID into the form's “/feedback Session ID” field.

## Demo video

- [ ] Start the trainer and site with `npm run dev:training`.
- [ ] Open the **printed Local URL** with `?director=1` appended; do not assume
      `localhost:3000`.
- [ ] Dry-run **Fly without recording** once. Confirm the spotlight guide works
      and the Custom Training finale starts a real run.
- [ ] Record the take and use the narration in `demo/VOICEOVER.md`.
- [ ] Keep the final edit at **3:00 or shorter**. Cut waits/loading first; use
      1.1×–1.25× only if speech stays clear.
- [ ] Confirm the voiceover explicitly covers what you built, how you used
      Codex, and how GPT-5.6 helped.
- [ ] Upload it to YouTube as **Public** (not Private, Unlisted, Premiere, or
      still processing), open the link in a signed-out/incognito window, and
      paste the exact URL into Video demo link.

## Judge access and final click

- [ ] Paste the short instructions from `demo/JUDGE-TESTING.md` into the
      private judge-testing field.
- [ ] Add a stable hosted URL only if it works; never submit a localhost URL.
- [ ] Do not paste an API key into Devpost, the README, source control, or the
      video.
- [ ] Optional only if time remains: add 3–5 gallery images. Existing OG images
      are uploadable but about 16:9; Devpost recommends 3:2.
- [ ] Use Preview and test every link.
- [ ] Complete all five Devpost steps, click **Submit**, and confirm the project
      no longer says **DRAFT**.
