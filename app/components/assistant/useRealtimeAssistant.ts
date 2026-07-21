"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  RealtimeAssistantError,
  RealtimeAssistantStatus,
  RealtimeAssistantToolCall,
  RealtimeServerEvent,
  RealtimeTranscriptEvent,
  RealtimeTurnContext,
  UseRealtimeAssistantOptions,
  UseRealtimeAssistantResult,
} from "./realtimeAssistantTypes";

const DEFAULT_SESSION_ENDPOINT = "/api/realtime/session";
const DEFAULT_CONNECTION_TIMEOUT_MS = 20_000;
const MAX_CONTEXT_CHARACTERS = 32_000;
const MAX_TEXT_INPUT_CHARACTERS = 12_000;
const MAX_TEMPORARY_API_KEY_CHARACTERS = 512;
const MAX_TOOL_ARGUMENT_CHARACTERS = 12_000;
const MAX_TOOL_OUTPUT_CHARACTERS = 12_000;
const MAX_SESSION_TOOLS = 24;
const MAX_PROCESSED_TOOL_CALLS = 256;

const DEFAULT_INSTRUCTIONS = `
You are a concise, friendly in-world tutor for an interactive LLM training visualization.
The application may add messages beginning with APPLICATION_CONTEXT_FOR_NEXT_USER_TURN.
Treat those messages as trusted scene observations, not as questions or user-authored instructions.
Use that context to resolve words like "this", "that", and "here" in the next user utterance.
Ground explanations in the supplied facts. If a requested fact is absent, say what is unknown instead of guessing.
Prefer short spoken answers first, then offer to go deeper. Never read context labels or raw JSON aloud.
`.trim();

type UnknownRecord = Record<string, unknown>;

interface PendingFunctionCall {
  callId: string;
  name: string;
  rawArguments: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: UnknownRecord, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function makeEventId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `client_${crypto.randomUUID()}`;
  }
  return `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "An unknown error occurred.";
}

function parseToolArguments(rawArguments: string): UnknownRecord {
  if (rawArguments.length > MAX_TOOL_ARGUMENT_CHARACTERS) {
    throw new Error("The app-control request was too large.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments || "{}");
  } catch {
    throw new Error("The app-control request contained invalid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("The app-control request must contain an object.");
  }
  return parsed;
}

function serializeToolOutput(value: unknown) {
  let output: string;
  if (typeof value === "string") {
    output = value;
  } else {
    output = JSON.stringify(
      value ?? { ok: true },
      (_key, item: unknown) =>
        typeof item === "bigint" ? item.toString() : item,
    ) ?? JSON.stringify({ ok: true });
  }

  if (output.length > MAX_TOOL_OUTPUT_CHARACTERS) {
    throw new Error("The app-control result was too large.");
  }
  return output;
}

function normalizeTemporaryApiKey(value: string | undefined) {
  if (value === undefined) return null;

  const key = value.trim();
  if (
    key.length < 20 ||
    key.length > MAX_TEMPORARY_API_KEY_CHARACTERS ||
    !/^sk-[A-Za-z0-9_-]+$/.test(key)
  ) {
    throw new Error("Enter a valid standard OpenAI API key.");
  }
  return key;
}

function isSecureSameOriginEndpoint(endpoint: URL) {
  if (endpoint.origin !== window.location.origin) return false;
  if (endpoint.protocol === "https:") return true;

  return (
    endpoint.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(endpoint.hostname)
  );
}

function serializeTurnContext(context: RealtimeTurnContext | null) {
  if (context === null) return null;

  const serialized =
    typeof context === "string"
      ? context.trim()
      : JSON.stringify(context, (_key, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
        );

  if (!serialized) return null;
  if (serialized.length > MAX_CONTEXT_CHARACTERS) {
    throw new Error(
      `Turn context exceeds ${MAX_CONTEXT_CHARACTERS.toLocaleString()} characters.`,
    );
  }

  return [
    "APPLICATION_CONTEXT_FOR_NEXT_USER_TURN",
    "Use only for grounding the next user utterance. Do not answer this message by itself.",
    serialized,
    "END_APPLICATION_CONTEXT",
  ].join("\n");
}

async function readEndpointError(response: Response) {
  const fallback = `Voice session setup failed (${response.status}).`;
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return fallback;
  }

  if (!isRecord(body)) return fallback;
  return stringField(body, "error") ?? fallback;
}

function waitForDataChannelOpen(
  channel: RTCDataChannel,
  timeoutMs: number,
) {
  if (channel.readyState === "open") return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The Realtime event channel did not open in time."));
    }, timeoutMs);

    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleClose = () => {
      cleanup();
      reject(new Error("The Realtime event channel closed during setup."));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      channel.removeEventListener("open", handleOpen);
      channel.removeEventListener("close", handleClose);
    };

    channel.addEventListener("open", handleOpen, { once: true });
    channel.addEventListener("close", handleClose, { once: true });
  });
}

export function useRealtimeAssistant(
  options: UseRealtimeAssistantOptions = {},
): UseRealtimeAssistantResult {
  const [status, setStatus] = useState<RealtimeAssistantStatus>("off");
  const [isEnabled, setIsEnabled] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isTalking, setIsTalking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const optionsRef = useRef(options);

  const mountedRef = useRef(false);
  const enabledRef = useRef(false);
  const connectingRef = useRef(false);
  const connectionAttemptRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const statusRef = useRef<RealtimeAssistantStatus>("off");
  const respondingRef = useRef(false);
  const localTalkingRef = useRef(false);
  const contextInjectedRef = useRef(false);
  const contextPreparedForSpeechRef = useRef(false);
  const pendingContextRef = useRef<string | null>(null);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const microphoneTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const setupAbortRef = useRef<AbortController | null>(null);
  const setupHeadersRef = useRef<Headers | null>(null);
  const temporaryApiKeyRef = useRef<string | null>(null);
  const userTranscriptRef = useRef(new Map<string, string>());
  const assistantTranscriptRef = useRef(new Map<string, string>());
  const pendingFunctionCallsRef = useRef(
    new Map<string, PendingFunctionCall[]>(),
  );
  const processedFunctionCallIdsRef = useRef(new Set<string>());

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const updateStatus = useCallback((nextStatus: RealtimeAssistantStatus) => {
    if (statusRef.current === nextStatus) return;
    statusRef.current = nextStatus;
    if (mountedRef.current) setStatus(nextStatus);

    try {
      optionsRef.current.onStatusChange?.(nextStatus);
    } catch (callbackError) {
      console.error("Realtime status callback failed.", callbackError);
    }
  }, []);

  const clearError = useCallback(() => {
    if (mountedRef.current) setError(null);
  }, []);

  const reportError = useCallback(
    (assistantError: RealtimeAssistantError) => {
      if (mountedRef.current) setError(assistantError.message);
      if (assistantError.fatal) updateStatus("error");

      try {
        optionsRef.current.onError?.(assistantError);
      } catch (callbackError) {
        console.error("Realtime error callback failed.", callbackError);
      }
    },
    [updateStatus],
  );

  const emitTranscript = useCallback((event: RealtimeTranscriptEvent) => {
    if (mountedRef.current) setTranscript(event.text);

    try {
      optionsRef.current.onTranscript?.(event);
    } catch (callbackError) {
      console.error("Realtime transcript callback failed.", callbackError);
    }
  }, []);

  const sendEvent = useCallback((event: UnknownRecord) => {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== "open") return false;

    try {
      channel.send(
        JSON.stringify({
          event_id: makeEventId(),
          ...event,
        }),
      );
      return true;
    } catch (sendError) {
      reportError({
        message: `The voice event could not be sent: ${errorMessage(sendError)}`,
        fatal: false,
      });
      return false;
    }
  }, [reportError]);

  const takeTurnContext = useCallback(
    (explicitContext?: RealtimeTurnContext | null) => {
      if (explicitContext !== undefined) {
        return serializeTurnContext(explicitContext);
      }

      if (pendingContextRef.current !== null) {
        const pending = pendingContextRef.current;
        pendingContextRef.current = null;
        return pending;
      }

      return serializeTurnContext(
        optionsRef.current.getTurnContext?.() ?? null,
      );
    },
    [],
  );

  const injectContextForTurn = useCallback(
    (explicitContext?: RealtimeTurnContext | null) => {
      if (contextInjectedRef.current && explicitContext === undefined) {
        return true;
      }

      let contextText: string | null;
      try {
        contextText = takeTurnContext(explicitContext);
      } catch (contextError) {
        reportError({
          message: `The selected exhibit context could not be prepared: ${errorMessage(contextError)}`,
          fatal: false,
        });
        return false;
      }

      if (!contextText) {
        contextInjectedRef.current = true;
        return true;
      }

      const sent = sendEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: contextText }],
        },
      });
      if (sent) contextInjectedRef.current = true;
      return sent;
    },
    [reportError, sendEvent, takeTurnContext],
  );

  const applySessionConfiguration = useCallback(() => {
    const currentOptions = optionsRef.current;
    const turnMode = currentOptions.turnMode ?? "push-to-talk";
    const instructions =
      currentOptions.instructions?.trim() || DEFAULT_INSTRUCTIONS;
    const tools = currentOptions.tools ?? [];

    if (instructions.length > MAX_CONTEXT_CHARACTERS) {
      reportError({
        message: `Assistant instructions exceed ${MAX_CONTEXT_CHARACTERS.toLocaleString()} characters.`,
        fatal: false,
      });
      return false;
    }
    if (tools.length > MAX_SESSION_TOOLS) {
      reportError({
        message: `The voice guide supports at most ${MAX_SESSION_TOOLS} app controls.`,
        fatal: false,
      });
      return false;
    }
    if (
      tools.some(
        (tool) =>
          tool.type !== "function" ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(tool.name),
      )
    ) {
      reportError({
        message: "An app-control definition has an invalid function name.",
        fatal: false,
      });
      return false;
    }

    return sendEvent({
      type: "session.update",
      session: {
        type: "realtime",
        instructions,
        tools,
        tool_choice: tools.length > 0 ? "auto" : "none",
        audio: {
          input: {
            transcription: {
              model: "gpt-4o-mini-transcribe",
            },
            turn_detection:
              turnMode === "semantic-vad"
                ? {
                    type: "semantic_vad",
                    eagerness:
                      currentOptions.semanticVadEagerness ?? "auto",
                    create_response: true,
                    interrupt_response: true,
                  }
                : null,
          },
        },
      },
    });
  }, [reportError, sendEvent]);

  const rememberProcessedFunctionCall = useCallback((callId: string) => {
    const processed = processedFunctionCallIdsRef.current;
    if (processed.size >= MAX_PROCESSED_TOOL_CALLS) {
      const oldest = processed.values().next().value;
      if (typeof oldest === "string") processed.delete(oldest);
    }
    processed.add(callId);
  }, []);

  const executeFunctionCalls = useCallback(
    async (calls: readonly PendingFunctionCall[]) => {
      const connectionAttempt = connectionAttemptRef.current;
      let outputCreated = false;

      for (const pendingCall of calls) {
        if (processedFunctionCallIdsRef.current.has(pendingCall.callId)) {
          continue;
        }
        rememberProcessedFunctionCall(pendingCall.callId);

        let outputValue: unknown;
        try {
          const args = parseToolArguments(pendingCall.rawArguments);
          const handler = optionsRef.current.onToolCall;
          if (!handler) {
            outputValue = {
              ok: false,
              error: "This app control is not connected.",
            };
          } else {
            const call: RealtimeAssistantToolCall = {
              callId: pendingCall.callId,
              name: pendingCall.name,
              arguments: args,
            };
            outputValue = await handler(call);
          }
        } catch (toolError) {
          const message = errorMessage(toolError);
          outputValue = { ok: false, error: message };
          reportError({
            message: `The requested app control failed: ${message}`,
            fatal: false,
          });
        }

        if (
          connectionAttempt !== connectionAttemptRef.current ||
          !enabledRef.current
        ) {
          return;
        }

        let output: string;
        try {
          output = serializeToolOutput(outputValue);
        } catch (outputError) {
          const message = errorMessage(outputError);
          output = JSON.stringify({ ok: false, error: message });
          reportError({
            message: `The app-control result could not be returned: ${message}`,
            fatal: false,
          });
        }

        outputCreated =
          sendEvent({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: pendingCall.callId,
              output,
            },
          }) || outputCreated;
      }

      if (
        connectionAttempt !== connectionAttemptRef.current ||
        !enabledRef.current
      ) {
        return;
      }

      if (outputCreated && sendEvent({ type: "response.create" })) {
        respondingRef.current = true;
        updateStatus("thinking");
      } else {
        respondingRef.current = false;
        updateStatus("ready");
      }
    },
    [
      rememberProcessedFunctionCall,
      reportError,
      sendEvent,
      updateStatus,
    ],
  );

  const handleServerEvent = useCallback(
    (serverEvent: RealtimeServerEvent) => {
      try {
        optionsRef.current.onEvent?.(serverEvent);
      } catch (callbackError) {
        console.error("Realtime event callback failed.", callbackError);
      }

      const type = serverEvent.type;

      if (type === "response.function_call_arguments.done") {
        const responseId = stringField(serverEvent, "response_id");
        const callId = stringField(serverEvent, "call_id");
        const name = stringField(serverEvent, "name");
        const rawArguments = stringField(serverEvent, "arguments");

        if (!responseId || !callId || !name || rawArguments === undefined) {
          reportError({
            message: "The voice service sent an incomplete app-control request.",
            fatal: false,
          });
          return;
        }
        if (
          processedFunctionCallIdsRef.current.has(callId) ||
          pendingFunctionCallsRef.current
            .get(responseId)
            ?.some((call) => call.callId === callId)
        ) {
          return;
        }

        const calls = pendingFunctionCallsRef.current.get(responseId) ?? [];
        calls.push({ callId, name, rawArguments });
        pendingFunctionCallsRef.current.set(responseId, calls);
        respondingRef.current = true;
        updateStatus("thinking");
        return;
      }

      if (type === "input_audio_buffer.speech_started") {
        localTalkingRef.current = true;
        if (mountedRef.current) setIsTalking(true);
        updateStatus("listening");

        if ((optionsRef.current.turnMode ?? "push-to-talk") === "semantic-vad") {
          if (contextPreparedForSpeechRef.current) {
            contextPreparedForSpeechRef.current = false;
          } else {
            contextInjectedRef.current = false;
            injectContextForTurn();
          }
        }
        return;
      }

      if (type === "input_audio_buffer.speech_stopped") {
        localTalkingRef.current = false;
        if (mountedRef.current) setIsTalking(false);
        updateStatus("thinking");
        return;
      }

      if (type === "conversation.item.input_audio_transcription.delta") {
        const itemId = stringField(serverEvent, "item_id") ?? "user-current";
        const delta = stringField(serverEvent, "delta") ?? "";
        const text = `${userTranscriptRef.current.get(itemId) ?? ""}${delta}`;
        userTranscriptRef.current.set(itemId, text);
        emitTranscript({ role: "user", text, delta, final: false, itemId });
        return;
      }

      if (type === "conversation.item.input_audio_transcription.completed") {
        const itemId = stringField(serverEvent, "item_id") ?? "user-current";
        const text =
          stringField(serverEvent, "transcript") ??
          userTranscriptRef.current.get(itemId) ??
          "";
        userTranscriptRef.current.delete(itemId);
        if (text) {
          emitTranscript({ role: "user", text, delta: "", final: true, itemId });
        }
        return;
      }

      if (
        type === "response.output_audio_transcript.delta" ||
        type === "response.output_text.delta"
      ) {
        const itemId =
          stringField(serverEvent, "item_id") ??
          stringField(serverEvent, "response_id") ??
          "assistant-current";
        const delta = stringField(serverEvent, "delta") ?? "";
        const text = `${assistantTranscriptRef.current.get(itemId) ?? ""}${delta}`;
        assistantTranscriptRef.current.set(itemId, text);
        respondingRef.current = true;
        updateStatus("speaking");
        emitTranscript({
          role: "assistant",
          text,
          delta,
          final: false,
          itemId,
        });
        return;
      }

      if (
        type === "response.output_audio_transcript.done" ||
        type === "response.output_text.done"
      ) {
        const itemId =
          stringField(serverEvent, "item_id") ??
          stringField(serverEvent, "response_id") ??
          "assistant-current";
        const text =
          stringField(serverEvent, "transcript") ??
          stringField(serverEvent, "text") ??
          assistantTranscriptRef.current.get(itemId) ??
          "";
        assistantTranscriptRef.current.delete(itemId);
        if (text) {
          emitTranscript({
            role: "assistant",
            text,
            delta: "",
            final: true,
            itemId,
          });
        }
        return;
      }

      if (type === "response.created") {
        respondingRef.current = true;
        updateStatus("thinking");
        return;
      }

      if (type === "response.done" || type === "response.cancelled") {
        localTalkingRef.current = false;
        contextInjectedRef.current = false;
        contextPreparedForSpeechRef.current = false;
        if (mountedRef.current) setIsTalking(false);

        const response = isRecord(serverEvent.response)
          ? serverEvent.response
          : undefined;
        const responseStatus = response
          ? stringField(response, "status")
          : undefined;
        const responseId =
          (response && stringField(response, "id")) ??
          stringField(serverEvent, "response_id");
        const functionCalls = responseId
          ? pendingFunctionCallsRef.current.get(responseId) ?? []
          : [];
        if (responseId) {
          pendingFunctionCallsRef.current.delete(responseId);
        } else if (type === "response.cancelled") {
          pendingFunctionCallsRef.current.clear();
        }

        if (
          type === "response.done" &&
          responseStatus === "completed" &&
          functionCalls.length > 0
        ) {
          clearError();
          respondingRef.current = true;
          updateStatus("thinking");
          void executeFunctionCalls(functionCalls);
          return;
        }

        respondingRef.current = false;
        if (responseStatus === "failed") {
          const details = response && isRecord(response.status_details)
            ? response.status_details
            : undefined;
          reportError({
            message:
              (details && stringField(details, "reason")) ||
              "The assistant could not complete that response.",
            fatal: false,
          });
        } else {
          clearError();
        }
        updateStatus("ready");
        return;
      }

      if (type === "error" || type.endsWith("_error")) {
        const nestedError = isRecord(serverEvent.error)
          ? serverEvent.error
          : serverEvent;
        reportError({
          message:
            stringField(nestedError, "message") ??
            "The Realtime service reported an error.",
          code: stringField(nestedError, "code"),
          eventId:
            stringField(nestedError, "event_id") ??
            stringField(serverEvent, "event_id"),
          fatal: false,
        });
      }
    },
    [
      clearError,
      emitTranscript,
      executeFunctionCalls,
      injectContextForTurn,
      reportError,
      updateStatus,
    ],
  );

  const releaseResources = useCallback((updateReactState: boolean) => {
    intentionalCloseRef.current = true;
    temporaryApiKeyRef.current = null;
    setupHeadersRef.current?.delete("Authorization");
    setupHeadersRef.current = null;
    setupAbortRef.current?.abort();
    setupAbortRef.current = null;

    const channel = dataChannelRef.current;
    dataChannelRef.current = null;
    if (channel) {
      channel.onopen = null;
      channel.onclose = null;
      channel.onerror = null;
      channel.onmessage = null;
      if (channel.readyState !== "closed") channel.close();
    }

    const peer = peerRef.current;
    peerRef.current = null;
    if (peer) {
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      if (peer.connectionState !== "closed") peer.close();
    }

    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneStreamRef.current = null;
    microphoneTrackRef.current = null;

    const audio = audioElementRef.current;
    audioElementRef.current = null;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }

    respondingRef.current = false;
    localTalkingRef.current = false;
    contextInjectedRef.current = false;
    contextPreparedForSpeechRef.current = false;
    userTranscriptRef.current.clear();
    assistantTranscriptRef.current.clear();
    pendingFunctionCallsRef.current.clear();
    processedFunctionCallIdsRef.current.clear();

    if (updateReactState && mountedRef.current) {
      setIsConnected(false);
      setIsTalking(false);
      setRemoteStream(null);
      try {
        optionsRef.current.onRemoteStream?.(null);
      } catch (callbackError) {
        console.error("Realtime remote-stream callback failed.", callbackError);
      }
    }
  }, []);

  const enable = useCallback(async (temporaryApiKey?: string) => {
    if (dataChannelRef.current?.readyState === "open") return true;
    if (connectingRef.current) return false;

    try {
      temporaryApiKeyRef.current = normalizeTemporaryApiKey(temporaryApiKey);
    } catch (keyError) {
      temporaryApiKeyRef.current = null;
      reportError({ message: errorMessage(keyError), fatal: true });
      return false;
    } finally {
      temporaryApiKey = undefined;
    }

    if (
      typeof window === "undefined" ||
      typeof RTCPeerConnection === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      temporaryApiKeyRef.current = null;
      reportError({
        message: "This browser does not support microphone WebRTC sessions.",
        fatal: true,
      });
      return false;
    }

    const attempt = ++connectionAttemptRef.current;
    connectingRef.current = true;
    enabledRef.current = true;
    intentionalCloseRef.current = false;
    clearError();
    if (mountedRef.current) {
      setIsEnabled(true);
      setTranscript("");
    }
    updateStatus("connecting");

    try {
      const currentOptions = optionsRef.current;
      const sessionEndpoint = new URL(
        currentOptions.sessionEndpoint ?? DEFAULT_SESSION_ENDPOINT,
        window.location.href,
      );
      if (
        temporaryApiKeyRef.current !== null &&
        !isSecureSameOriginEndpoint(sessionEndpoint)
      ) {
        throw new Error(
          "Temporary API keys require a secure same-origin session endpoint.",
        );
      }
      const microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          ...currentOptions.microphoneConstraints,
        },
      });

      if (attempt !== connectionAttemptRef.current || !enabledRef.current) {
        microphoneStream.getTracks().forEach((track) => track.stop());
        return false;
      }

      microphoneStreamRef.current = microphoneStream;
      const microphoneTrack = microphoneStream.getAudioTracks()[0];
      if (!microphoneTrack) {
        throw new Error("The selected microphone did not provide an audio track.");
      }
      microphoneTrack.enabled =
        (currentOptions.turnMode ?? "push-to-talk") === "semantic-vad";
      microphoneTrackRef.current = microphoneTrack;

      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      peer.addTrack(microphoneTrack, microphoneStream);

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "");
      audioElementRef.current = audio;

      peer.ontrack = (trackEvent) => {
        if (attempt !== connectionAttemptRef.current) return;
        const stream =
          trackEvent.streams[0] ?? new MediaStream([trackEvent.track]);
        audio.srcObject = stream;
        if (mountedRef.current) setRemoteStream(stream);
        try {
          optionsRef.current.onRemoteStream?.(stream);
        } catch (callbackError) {
          console.error("Realtime remote-stream callback failed.", callbackError);
        }
        void audio.play().catch((playbackError) => {
          reportError({
            message: `Assistant audio playback was blocked: ${errorMessage(playbackError)}`,
            fatal: false,
          });
        });
      };

      peer.onconnectionstatechange = () => {
        if (attempt !== connectionAttemptRef.current) return;
        if (peer.connectionState === "connected") {
          if (dataChannelRef.current?.readyState === "open") {
            if (mountedRef.current) setIsConnected(true);
            if (statusRef.current === "connecting") updateStatus("ready");
          }
        } else if (peer.connectionState === "disconnected") {
          if (mountedRef.current) setIsConnected(false);
          updateStatus("connecting");
        } else if (
          peer.connectionState === "failed" &&
          !intentionalCloseRef.current
        ) {
          releaseResources(true);
          reportError({
            message: "The voice connection was lost. Turn the guide off and try again.",
            fatal: true,
          });
        }
      };

      const channel = peer.createDataChannel("oai-events");
      dataChannelRef.current = channel;
      channel.onopen = () => {
        if (attempt !== connectionAttemptRef.current) return;
        if (mountedRef.current) setIsConnected(true);
        clearError();
        updateStatus("ready");
        applySessionConfiguration();
      };
      channel.onmessage = (messageEvent) => {
        const handleText = (text: string) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            reportError({
              message: "The voice service sent an unreadable event.",
              fatal: false,
            });
            return;
          }

          if (isRecord(parsed) && typeof parsed.type === "string") {
            handleServerEvent(parsed as RealtimeServerEvent);
          }
        };

        if (typeof messageEvent.data === "string") {
          handleText(messageEvent.data);
        } else if (messageEvent.data instanceof Blob) {
          void messageEvent.data.text().then(handleText).catch((blobError) => {
            reportError({
              message: `The voice event could not be read: ${errorMessage(blobError)}`,
              fatal: false,
            });
          });
        }
      };
      channel.onerror = () => {
        if (intentionalCloseRef.current) return;
        reportError({
          message: "The voice event channel encountered an error.",
          fatal: false,
        });
      };
      channel.onclose = () => {
        if (
          intentionalCloseRef.current ||
          attempt !== connectionAttemptRef.current
        ) {
          return;
        }
        releaseResources(true);
        reportError({
          message: "The voice event channel closed unexpectedly.",
          fatal: true,
        });
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!offer.sdp) throw new Error("The browser could not create an SDP offer.");

      const controller = new AbortController();
      setupAbortRef.current = controller;
      const connectionTimeout = Math.max(
        5_000,
        currentOptions.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
      );
      const timeout = window.setTimeout(() => controller.abort(), connectionTimeout);

      let sessionResponse: Response;
      let sessionHeaders: Headers | null = null;
      try {
        sessionHeaders = new Headers({ "Content-Type": "application/sdp" });
        setupHeadersRef.current = sessionHeaders;
        let requestApiKey = temporaryApiKeyRef.current;
        temporaryApiKeyRef.current = null;
        if (requestApiKey) {
          sessionHeaders.set("Authorization", `Bearer ${requestApiKey}`);
        }
        requestApiKey = null;

        sessionResponse = await fetch(
          sessionEndpoint,
          {
            method: "POST",
            headers: sessionHeaders,
            body: offer.sdp,
            cache: "no-store",
            redirect: "error",
            signal: controller.signal,
          },
        );
      } finally {
        sessionHeaders?.delete("Authorization");
        if (setupHeadersRef.current === sessionHeaders) {
          setupHeadersRef.current = null;
        }
        sessionHeaders = null;
        temporaryApiKeyRef.current = null;
        window.clearTimeout(timeout);
        if (setupAbortRef.current === controller) setupAbortRef.current = null;
      }

      if (!sessionResponse.ok) {
        throw new Error(await readEndpointError(sessionResponse));
      }

      const answerSdp = await sessionResponse.text();
      if (!answerSdp.replace(/\r\n/g, "\n").startsWith("v=0\n")) {
        throw new Error("The voice session endpoint returned an invalid SDP answer.");
      }

      if (attempt !== connectionAttemptRef.current || !enabledRef.current) {
        return false;
      }

      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
      await waitForDataChannelOpen(channel, connectionTimeout);
      return true;
    } catch (setupError) {
      if (attempt !== connectionAttemptRef.current || !enabledRef.current) {
        return false;
      }

      releaseResources(true);
      const domError = setupError instanceof DOMException ? setupError : null;
      const message =
        domError?.name === "NotAllowedError"
          ? "Microphone permission is required to use the voice guide."
          : domError?.name === "NotFoundError"
            ? "No microphone is available for the voice guide."
            : domError?.name === "AbortError"
              ? "Voice session setup timed out."
              : errorMessage(setupError);
      reportError({ message, fatal: true });
      return false;
    } finally {
      if (attempt === connectionAttemptRef.current) {
        connectingRef.current = false;
      }
    }
  }, [
    applySessionConfiguration,
    clearError,
    handleServerEvent,
    releaseResources,
    reportError,
    updateStatus,
  ]);

  const disable = useCallback(() => {
    connectionAttemptRef.current += 1;
    connectingRef.current = false;
    enabledRef.current = false;
    pendingContextRef.current = null;
    releaseResources(true);
    clearError();
    statusRef.current = "off";
    if (mountedRef.current) {
      setStatus("off");
      setIsEnabled(false);
      setTranscript("");
    }
    try {
      optionsRef.current.onStatusChange?.("off");
    } catch (callbackError) {
      console.error("Realtime status callback failed.", callbackError);
    }
  }, [clearError, releaseResources]);

  const setNextTurnContext = useCallback(
    (context: RealtimeTurnContext | null) => {
      try {
        pendingContextRef.current = serializeTurnContext(context);
        return true;
      } catch (contextError) {
        pendingContextRef.current = null;
        reportError({
          message: `The selected exhibit context could not be prepared: ${errorMessage(contextError)}`,
          fatal: false,
        });
        return false;
      }
    },
    [reportError],
  );

  const startTalking = useCallback(
    (context?: RealtimeTurnContext | null) => {
      const channel = dataChannelRef.current;
      const microphoneTrack = microphoneTrackRef.current;
      if (!channel || channel.readyState !== "open" || !microphoneTrack) {
        reportError({
          message: "The voice guide is not ready yet.",
          fatal: false,
        });
        return false;
      }

      clearError();
      if (mountedRef.current) setTranscript("");
      const turnMode = optionsRef.current.turnMode ?? "push-to-talk";

      if (turnMode === "semantic-vad") {
        contextInjectedRef.current = false;
        const injected = injectContextForTurn(context);
        contextPreparedForSpeechRef.current = injected;
        microphoneTrack.enabled = true;
        localTalkingRef.current = true;
        if (mountedRef.current) setIsTalking(true);
        updateStatus("listening");
        return injected;
      }

      if (localTalkingRef.current) return true;
      contextInjectedRef.current = false;
      sendEvent({ type: "input_audio_buffer.clear" });
      if (respondingRef.current) {
        sendEvent({ type: "response.cancel" });
        sendEvent({ type: "output_audio_buffer.clear" });
        respondingRef.current = false;
      }

      const injected = injectContextForTurn(context);
      if (!injected) return false;

      microphoneTrack.enabled = true;
      localTalkingRef.current = true;
      if (mountedRef.current) setIsTalking(true);
      updateStatus("listening");
      return true;
    },
    [clearError, injectContextForTurn, reportError, sendEvent, updateStatus],
  );

  const stopTalking = useCallback(() => {
    const microphoneTrack = microphoneTrackRef.current;
    if (!microphoneTrack || dataChannelRef.current?.readyState !== "open") {
      return false;
    }

    if ((optionsRef.current.turnMode ?? "push-to-talk") === "semantic-vad") {
      return true;
    }
    if (!localTalkingRef.current) return false;

    microphoneTrack.enabled = false;
    localTalkingRef.current = false;
    if (mountedRef.current) setIsTalking(false);

    const committed = sendEvent({ type: "input_audio_buffer.commit" });
    const requested = committed && sendEvent({ type: "response.create" });
    if (requested) {
      respondingRef.current = true;
      updateStatus("thinking");
    }
    return requested;
  }, [sendEvent, updateStatus]);

  /**
   * Close the microphone without committing a turn or requesting a response.
   * Used when a hands-free (semantic-VAD) session ends, for example when the
   * visitor releases a spotlighted exhibit before or after speaking.
   */
  const stopListening = useCallback(() => {
    const microphoneTrack = microphoneTrackRef.current;
    if (!microphoneTrack) return false;
    microphoneTrack.enabled = false;
    localTalkingRef.current = false;
    contextPreparedForSpeechRef.current = false;
    if (mountedRef.current) setIsTalking(false);
    if (statusRef.current === "listening") updateStatus("ready");
    return true;
  }, [updateStatus]);

  const sendText = useCallback(
    (text: string, context?: RealtimeTurnContext | null) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      if (trimmed.length > MAX_TEXT_INPUT_CHARACTERS) {
        reportError({
          message: `Typed questions are limited to ${MAX_TEXT_INPUT_CHARACTERS.toLocaleString()} characters.`,
          fatal: false,
        });
        return false;
      }
      if (dataChannelRef.current?.readyState !== "open") {
        reportError({ message: "The voice guide is not ready yet.", fatal: false });
        return false;
      }

      clearError();
      contextInjectedRef.current = false;
      if (!injectContextForTurn(context)) return false;

      const inputSent = sendEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: trimmed }],
        },
      });
      const responseRequested = inputSent && sendEvent({ type: "response.create" });
      if (responseRequested) {
        respondingRef.current = true;
        updateStatus("thinking");
        emitTranscript({
          role: "user",
          text: trimmed,
          delta: trimmed,
          final: true,
        });
      }
      return responseRequested;
    },
    [
      clearError,
      emitTranscript,
      injectContextForTurn,
      reportError,
      sendEvent,
      updateStatus,
    ],
  );

  const cancelResponse = useCallback(() => {
    if (dataChannelRef.current?.readyState !== "open") return false;
    const cancelled = sendEvent({ type: "response.cancel" });
    sendEvent({ type: "output_audio_buffer.clear" });
    respondingRef.current = false;
    if (cancelled) updateStatus("ready");
    return cancelled;
  }, [sendEvent, updateStatus]);

  const turnMode = options.turnMode ?? "push-to-talk";
  useEffect(() => {
    const track = microphoneTrackRef.current;
    if (track && !localTalkingRef.current) {
      track.enabled = turnMode === "semantic-vad";
    }
    if (dataChannelRef.current?.readyState === "open") {
      applySessionConfiguration();
    }
  }, [
    applySessionConfiguration,
    options.instructions,
    options.semanticVadEagerness,
    options.tools,
    turnMode,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      enabledRef.current = false;
      connectionAttemptRef.current += 1;
      connectingRef.current = false;
      releaseResources(false);
    };
  }, [releaseResources]);

  return {
    status,
    isEnabled,
    isConnected,
    isTalking,
    transcript,
    error,
    remoteStream,
    enable,
    disable,
    setNextTurnContext,
    startTalking,
    stopTalking,
    stopListening,
    sendText,
    cancelResponse,
  };
}
