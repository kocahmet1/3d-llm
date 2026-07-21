# Judge testing instructions

## Short form-field version

Paste this into Devpost's private judge instructions field and replace the URL
placeholder if a hosted demo exists:

```text
Core demo: [HOSTED DEMO URL, if available]. The 3D lesson works without an API key. For a local run, use Node.js 22.13+, run `npm ci` then `npm run dev`, and open the Local URL printed by the terminal.

Voice guide (optional): configure `OPENAI_API_KEY` in the server environment before starting the site, allow microphone access, open “Meet your guide,” then hold V or right-click a supported exhibit. No credential is required to judge the core 3D lesson.

Real local trainer: Python 3.11+ and PyTorch 2.1+ are required on the same machine as the browser. From `trainer`, create `.venv` and run `.\.venv\Scripts\python.exe -m pip install -e .`; return to the repository root and run `npm run dev:training` once. Open the printed Local URL, enter Custom Training, upload `README.md`, choose Micro / 64 byte tokens / Quick / CPU, and start training. The hosted site cannot launch the loopback-only trainer.
```

Never put a personal API key in this field.

## Full local testing path

### Core 3D lesson

Requirements: Node.js 22.13 or newer and a WebGL-capable browser.

```powershell
npm ci
npm run dev
```

Open the **Local** URL printed by the terminal. Do not assume port 3000. The
complete lesson, modes, branches, HUD, Math/Code panels, and spotlight magnifier
work without Python and without an OpenAI key.

### Optional Realtime voice guide

```powershell
$env:OPENAI_API_KEY="your-api-key"
npm run dev
```

Allow microphone access. Open **Meet your guide**, then hold `V` while pointing
at an exhibit, or right-click a supported exhibit to spotlight it and speak.
This requires network/WebRTC access and a key with access to the configured
Realtime model.

### Real Custom Training Chamber

```powershell
cd trainer
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
cd ..
npm run dev:training
```

Run `npm run dev:training` only once and leave it open. Open its printed Local
URL, go to **Custom Training**, upload `README.md`, choose **Micro**, **64 byte
tokens**, **Quick**, and **CPU**, then choose **Start real training**. Watch the
real metrics/checkpoints; after completion, open the model-test view and
generate from the saved checkpoint.

The companion intentionally binds only to loopback, permits one active run,
and cannot be launched by a hosted webpage.

### Verification commands

```powershell
npm run code:check
npm run lint
npm test
cd trainer
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```
