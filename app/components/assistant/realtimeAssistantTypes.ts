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
 * Application-owned facts that should be frozen for a single user turn.
 * Keep this free of secrets: it becomes part of the Realtime conversation.
 */
export type RealtimeTurnContext =
  | string
  | Readonly<object>;

export interface RealtimeTranscriptEvent {
  role: "user" | "assistant";
  text: string;
  delta: string;
  final: boolean;
  itemId?: string;
}

export interface RealtimeAssistantError {
  message: string;
  fatal: boolean;
  code?: string;
  eventId?: string;
}

export interface RealtimeServerEvent extends Record<string, unknown> {
  type: string;
}

export interface RealtimeAssistantToolDefinition {
  type: "function";
  name: string;
  description?: string;
  parameters?: Readonly<Record<string, unknown>>;
}

export interface RealtimeAssistantToolCall {
  callId: string;
  name: string;
  arguments: Readonly<Record<string, unknown>>;
}

export type RealtimeAssistantToolResult =
  | string
  | number
  | boolean
  | null
  | Readonly<Record<string, unknown>>
  | readonly unknown[];

export interface UseRealtimeAssistantOptions {
  /** Same-origin endpoint that proxies SDP to OpenAI. */
  sessionEndpoint?: string;
  /** Push-to-talk is a natural fit for point-and-ask interactions. */
  turnMode?: RealtimeAssistantTurnMode;
  semanticVadEagerness?: SemanticVadEagerness;
  /** Persistent tutor instructions. Per-target facts belong in turn context. */
  instructions?: string;
  /** Narrow application functions the Realtime model may request. */
  tools?: readonly RealtimeAssistantToolDefinition[];
  /**
   * Executes a requested tool in application code. The returned value is sent
   * back to the model before it gives the visitor a spoken confirmation.
   */
  onToolCall?: (
    call: RealtimeAssistantToolCall,
  ) =>
    | RealtimeAssistantToolResult
    | Promise<RealtimeAssistantToolResult>;
  /**
   * Called when speech begins if no context was explicitly supplied to
   * `startTalking`. The returned value is serialized immediately, freezing the
   * target for that turn.
   */
  getTurnContext?: () => RealtimeTurnContext | null | undefined;
  microphoneConstraints?: MediaTrackConstraints;
  connectionTimeoutMs?: number;
  onStatusChange?: (status: RealtimeAssistantStatus) => void;
  onTranscript?: (event: RealtimeTranscriptEvent) => void;
  onError?: (error: RealtimeAssistantError) => void;
  onEvent?: (event: RealtimeServerEvent) => void;
  onRemoteStream?: (stream: MediaStream | null) => void;
}

export interface UseRealtimeAssistantResult {
  status: RealtimeAssistantStatus;
  isEnabled: boolean;
  isConnected: boolean;
  isTalking: boolean;
  transcript: string;
  error: string | null;
  remoteStream: MediaStream | null;
  /**
   * Connect using the server credential, or a temporary standard OpenAI API
   * key supplied for this one setup request. Temporary keys are never stored.
   */
  enable: (temporaryApiKey?: string) => Promise<boolean>;
  disable: () => void;
  /** Store a serialized snapshot for the next detected or explicit voice turn. */
  setNextTurnContext: (context: RealtimeTurnContext | null) => boolean;
  /** Begin microphone capture (or prepare a semantic-VAD turn). */
  startTalking: (context?: RealtimeTurnContext | null) => boolean;
  /** Commit captured audio and request a response in push-to-talk mode. */
  stopTalking: () => boolean;
  /**
   * Close the microphone without committing a turn or requesting a response.
   * Ends a hands-free (semantic-VAD) listening session in any state.
   */
  stopListening: () => boolean;
  /** Send a typed question using the same conversation and context mechanism. */
  sendText: (
    text: string,
    context?: RealtimeTurnContext | null,
  ) => boolean;
  cancelResponse: () => boolean;
}
