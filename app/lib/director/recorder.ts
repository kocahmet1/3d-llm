/**
 * In-app demo recorder. Captures the current tab (video + tab audio, so the
 * voice guide's live answer lands in the take) through getDisplayMedia and
 * MediaRecorder, and downloads a .webm when the flight ends. Chrome's tab
 * capture records only page content — no browser chrome, no OS cursor — so
 * the result is presentation-clean without fullscreen tricks.
 */

interface DisplayMediaExtras extends MediaStreamConstraints {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: "include" | "exclude";
  systemAudio?: "include" | "exclude";
}

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export interface DemoRecorder {
  stop(): Promise<Blob | null>;
  /** Fires if the user ends the share from the browser UI mid-flight. */
  onEnded: (handler: () => void) => void;
}

export async function startDemoRecorder(): Promise<DemoRecorder | null> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getDisplayMedia ||
    typeof MediaRecorder === "undefined"
  ) {
    return null;
  }

  let stream: MediaStream;
  try {
    const constraints: DisplayMediaExtras = {
      video: { frameRate: { ideal: 60, max: 60 } },
      audio: true,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      systemAudio: "include",
    };
    stream = await navigator.mediaDevices.getDisplayMedia(constraints);
  } catch {
    return null; // visitor dismissed the picker — fly without recording
  }

  const mimeType =
    MIME_CANDIDATES.find((candidate) =>
      MediaRecorder.isTypeSupported(candidate),
    ) ?? "";
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 14_000_000,
    audioBitsPerSecond: 160_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  let endedHandler: (() => void) | null = null;
  const [videoTrack] = stream.getVideoTracks();
  videoTrack?.addEventListener("ended", () => endedHandler?.());

  recorder.start(1000);

  let stopped = false;
  const stop = () =>
    new Promise<Blob | null>((resolve) => {
      if (stopped) {
        resolve(null);
        return;
      }
      stopped = true;
      const finish = () => {
        stream.getTracks().forEach((track) => track.stop());
        resolve(
          chunks.length
            ? new Blob(chunks, { type: mimeType || "video/webm" })
            : null,
        );
      };
      if (recorder.state === "inactive") {
        finish();
        return;
      }
      recorder.onstop = finish;
      try {
        recorder.stop();
      } catch {
        finish();
      }
    });

  return {
    stop,
    onEnded: (handler) => {
      endedHandler = handler;
    },
  };
}

export function downloadRecording(blob: Blob, filename?: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename ?? `inside-one-training-step-demo-${stamp}.webm`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
