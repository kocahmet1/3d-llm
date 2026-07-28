export type RealtimeAssistantStatus =
  | "off"
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type RealtimeAssistantTurnMode = "push-to-talk" | "semantic-vad";

export type SemanticVadEagerness = "low" | "medium" | "high" | "auto";

/**
 * Application-owned facts sent to the Realtime service. Keep this free of
 * secrets: it becomes part of the Realtime conversation.
 */
export type RealtimeTurnContext =
  | string
  | Readonly<object>;

export interface RealtimeAssistantError {
  message: string;
  fatal: boolean;
  code?: string;
  eventId?: string;
}

export interface RealtimeServerEvent extends Record<string, unknown> {
  type: string;
}

/**
 * Client-side timing markers for a single voice turn. `firstOutput` is the
 * first output-transcript event, which is a useful WebRTC-side proxy rather
 * than a claim about the first audible sample at the speaker.
 */
export interface RealtimeAssistantTurnTiming {
  turnId: number;
  speechStoppedToResponseMs?: number;
  speechStoppedToFirstOutputMs?: number;
  firstOutputToDoneMs?: number;
}

export interface RealtimeAssistantResponseRequest {
  /**
   * Response-scoped cue appended to the fully composed tutor instructions.
   * The hook preserves the session's grounding and safety instructions.
   */
  instructions: string;
  /** Optional exact spotlight snapshot for this proactive response. */
  context?: RealtimeTurnContext | null;
  /** Short string values echoed by Realtime for response correlation. */
  metadata?: Readonly<Record<string, string>>;
}

export interface UseRealtimeAssistantOptions {
  /** Same-origin endpoint that proxies SDP to OpenAI. */
  sessionEndpoint?: string;
  /** Push-to-talk is a natural fit for point-and-ask interactions. */
  turnMode?: RealtimeAssistantTurnMode;
  semanticVadEagerness?: SemanticVadEagerness;
  /** Persistent tutor instructions. */
  instructions?: string;
  /**
   * A frozen, trusted exhibit snapshot that remains in session instructions
   * until it is replaced or cleared. Use this for a hands-free spotlight.
   */
  persistentContext?: RealtimeTurnContext | null;
  /**
   * Supplies an application snapshot when a push-to-talk turn begins. The
   * value is serialized immediately, freezing the target for that turn.
   */
  getTurnContext?: () => RealtimeTurnContext | null | undefined;
  microphoneConstraints?: MediaTrackConstraints;
  connectionTimeoutMs?: number;
  onStatusChange?: (status: RealtimeAssistantStatus) => void;
  onTurnTiming?: (timing: RealtimeAssistantTurnTiming) => void;
  onError?: (error: RealtimeAssistantError) => void;
  onEvent?: (event: RealtimeServerEvent) => void;
  onRemoteStream?: (stream: MediaStream | null) => void;
}

export interface UseRealtimeAssistantResult {
  status: RealtimeAssistantStatus;
  isEnabled: boolean;
  isConnected: boolean;
  isTalking: boolean;
  error: string | null;
  remoteStream: MediaStream | null;
  /**
   * Connect using the server credential, or a temporary standard OpenAI API
   * key supplied for this one setup request. Temporary keys are never stored.
   */
  enable: (temporaryApiKey?: string) => Promise<boolean>;
  disable: () => void;
  /** Begin microphone capture. */
  startTalking: (context?: RealtimeTurnContext | null) => boolean;
  /** Commit captured audio and request a response in push-to-talk mode. */
  stopTalking: () => boolean;
  /** Ask the connected guide to speak without fabricating a user utterance. */
  requestResponse: (
    request: RealtimeAssistantResponseRequest,
  ) => boolean;
  /**
   * Close the microphone without committing a turn or requesting a response.
   * Ends a hands-free (semantic-VAD) listening session in any state.
   */
  stopListening: () => boolean;
  cancelResponse: () => boolean;
}
