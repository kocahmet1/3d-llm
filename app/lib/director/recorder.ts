/**
 * In-app demo recorder. Captures the current tab (video + tab audio, so the
 * voice guide's live answer lands in the take) through getDisplayMedia and
 * MediaRecorder, and downloads the file when the flight ends. Chrome's tab
 * capture records only page content — no browser chrome, no OS cursor — so
 * the result is presentation-clean without fullscreen tricks.
 */

interface DisplayMediaExtras extends MediaStreamConstraints {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: "include" | "exclude";
  systemAudio?: "include" | "exclude";
}

/**
 * Container preference, best first.
 *
 * H.264 in MP4 goes first because Chrome hands it to the GPU's video encoder
 * on almost every machine that can run this scene at all. VP9 is software on
 * the same hardware, and a software encode of 1080p60 competes with the render
 * loop for exactly the cores the render loop needs — which is what a dropped
 * frame looks like on film. The quality trade is nil at the bitrates below,
 * and MP4 is what judges' platforms want anyway, so a good take no longer
 * needs an ffmpeg pass.
 */
const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2", // H.264 High, AAC
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2", // H.264 Baseline, AAC
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export interface DemoRecorderOptions {
  /**
   * Backing-store size of the canvas, in device pixels. Capturing at exactly
   * this size makes the file a 1:1 read of the framebuffer — no upscale to a
   * larger surface, no downscale from one, so nothing is softened on the way
   * out.
   */
  width?: number;
  height?: number;
  frameRate?: number;
}

export interface DemoRecorder {
  stop(): Promise<Blob | null>;
  /** Fires if the user ends the share from the browser UI mid-flight. */
  onEnded: (handler: () => void) => void;
  /** Container extension chosen for this take, "mp4" or "webm". */
  readonly extension: string;
  /** Whether the take is going through a hardware-friendly H.264 encoder. */
  readonly hardwareFriendly: boolean;
}

/** ~0.1 bits per pixel per frame, which is visually lossless for this scene. */
const bitrateFor = (width: number, height: number, fps: number): number => {
  const pixels = Math.max(1, width * height);
  const estimate = Math.round(pixels * fps * 0.1);
  return Math.min(40_000_000, Math.max(12_000_000, estimate));
};

export async function startDemoRecorder(
  options: DemoRecorderOptions = {},
): Promise<DemoRecorder | null> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getDisplayMedia ||
    typeof MediaRecorder === "undefined"
  ) {
    return null;
  }

  const frameRate = options.frameRate ?? 60;
  let stream: MediaStream;
  try {
    const video: MediaTrackConstraints = {
      frameRate: { ideal: frameRate, max: frameRate },
      ...(options.width && options.height
        ? {
            width: { ideal: options.width, max: options.width },
            height: { ideal: options.height, max: options.height },
          }
        : {}),
    };
    const constraints: DisplayMediaExtras = {
      video,
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
  const settings = stream.getVideoTracks()[0]?.getSettings();
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: bitrateFor(
      settings?.width ?? options.width ?? 1920,
      settings?.height ?? options.height ?? 1080,
      settings?.frameRate ?? frameRate,
    ),
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
    extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm",
    hardwareFriendly: mimeType.includes("avc1"),
  };
}

export function downloadRecording(
  blob: Blob,
  filename?: string,
  extension = "webm",
): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download =
    filename ?? `inside-one-training-step-demo-${stamp}.${extension}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
