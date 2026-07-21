const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const MAX_SDP_BYTES = 256 * 1024;
const UPSTREAM_TIMEOUT_MS = 20_000;
const MAX_AUTHORIZATION_HEADER_CHARACTERS = 768;

const REALTIME_SESSION_CONFIG = JSON.stringify({
  type: "realtime",
  model: "gpt-realtime-2.1",
  output_modalities: ["audio"],
  audio: {
    input: {
      transcription: {
        model: "gpt-4o-mini-transcribe",
      },
      turn_detection: {
        type: "semantic_vad",
        eagerness: "auto",
        create_response: true,
        interrupt_response: true,
      },
    },
    output: {
      voice: "marin",
    },
  },
});

export const runtime = "nodejs";

function errorResponse(
  status: number,
  error: string,
  details?: Record<string, unknown>,
) {
  return Response.json(
    { error, ...details },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function validateSdpOffer(sdp: string): string | null {
  if (sdp.length === 0) return "The SDP offer is empty.";
  if (new TextEncoder().encode(sdp).byteLength > MAX_SDP_BYTES) {
    return "The SDP offer is too large.";
  }
  if (sdp.includes("\0")) return "The SDP offer contains invalid bytes.";

  const normalized = sdp.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("v=0\n")) {
    return "The request body is not a valid SDP offer.";
  }
  if (!/^o=/m.test(normalized) || !/^t=/m.test(normalized)) {
    return "The SDP offer is missing required session fields.";
  }
  if (!/^m=audio\s/m.test(normalized)) {
    return "The SDP offer does not contain an audio media section.";
  }
  if (!/^a=(?:fingerprint|ice-ufrag):/m.test(normalized)) {
    return "The SDP offer is missing WebRTC transport attributes.";
  }

  return null;
}

function temporaryBearerKey(authorization: string | null) {
  if (!authorization) return { kind: "missing" as const };
  if (authorization.length > MAX_AUTHORIZATION_HEADER_CHARACTERS) {
    return { kind: "invalid" as const };
  }

  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  const key = match?.[1];
  if (
    !key ||
    key.length < 20 ||
    key.length > 512 ||
    !/^sk-[A-Za-z0-9_-]+$/.test(key)
  ) {
    return { kind: "invalid" as const };
  }

  return { kind: "valid" as const, key };
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    !contentType.startsWith("application/sdp") &&
    !contentType.startsWith("text/plain")
  ) {
    return errorResponse(
      415,
      "Expected an SDP offer with Content-Type application/sdp.",
    );
  }

  const requestOrigin = new URL(request.url).origin;
  const browserOrigin = request.headers.get("origin");
  if (browserOrigin !== requestOrigin) {
    return errorResponse(403, "Cross-origin Realtime session requests are not allowed.");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SDP_BYTES) {
    return errorResponse(413, "The SDP offer is too large.");
  }

  let temporaryCredential = temporaryBearerKey(
    request.headers.get("authorization"),
  );
  if (temporaryCredential.kind === "invalid") {
    return errorResponse(401, "The temporary OpenAI API key is invalid.");
  }

  let apiKey: string | undefined;
  const usingTemporaryApiKey = temporaryCredential.kind === "valid";
  if (temporaryCredential.kind === "valid") {
    apiKey = temporaryCredential.key;
  } else {
    apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return errorResponse(
        500,
        "The voice assistant is not configured on the server.",
      );
    }
  }

  let offerSdp: string;
  try {
    offerSdp = await request.text();
  } catch {
    return errorResponse(400, "The SDP offer could not be read.");
  }

  const validationError = validateSdpOffer(offerSdp);
  if (validationError) return errorResponse(400, validationError);

  const formData = new FormData();
  formData.set("sdp", offerSdp);
  formData.set("session", REALTIME_SESSION_CONFIG);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const abortUpstream = () => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", abortUpstream, { once: true });

  const upstreamHeaders = new Headers({ Accept: "application/sdp" });
  upstreamHeaders.set("Authorization", `Bearer ${apiKey}`);
  apiKey = undefined;
  temporaryCredential = { kind: "missing" };

  try {
    const upstream = await fetch(OPENAI_REALTIME_CALLS_URL, {
      method: "POST",
      headers: upstreamHeaders,
      body: formData,
      cache: "no-store",
      signal: controller.signal,
    });

    const requestId = upstream.headers.get("x-request-id") ?? undefined;

    if (!upstream.ok) {
      console.error("OpenAI Realtime session request failed.", {
        status: upstream.status,
        requestId,
      });

      if (
        usingTemporaryApiKey &&
        (upstream.status === 401 || upstream.status === 403)
      ) {
        return errorResponse(
          401,
          "OpenAI rejected the temporary API key. Check it and try again.",
          { requestId },
        );
      }
      if (upstream.status === 401 || upstream.status === 403) {
        return errorResponse(
          502,
          "The voice assistant's server credential was rejected.",
          { requestId },
        );
      }
      if (upstream.status === 429) {
        return errorResponse(429, "The voice service is busy. Try again shortly.", {
          requestId,
        });
      }
      return errorResponse(502, "OpenAI could not create the Realtime session.", {
        upstreamStatus: upstream.status,
        requestId,
      });
    }

    const responseBody = await upstream.text();

    if (!responseBody.replace(/\r\n/g, "\n").startsWith("v=0\n")) {
      console.error("OpenAI Realtime returned an invalid SDP answer.", {
        requestId,
      });
      return errorResponse(502, "The voice service returned an invalid response.", {
        requestId,
      });
    }

    return new Response(responseBody, {
      status: 200,
      headers: {
        "Content-Type": "application/sdp",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(requestId ? { "X-OpenAI-Request-Id": requestId } : {}),
      },
    });
  } catch {
    if (controller.signal.aborted) {
      if (request.signal.aborted) {
        return errorResponse(408, "The Realtime session request was cancelled.");
      }
      return errorResponse(504, "The voice service took too long to respond.");
    }

    console.error("OpenAI Realtime session request failed due to a network error.");
    return errorResponse(502, "The voice service could not be reached.");
  } finally {
    upstreamHeaders.delete("Authorization");
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortUpstream);
  }
}
