export interface RealtimeResponseLifecycle {
  responding: boolean;
  pendingRequestToken: string | null;
  activeResponseId: string | null;
  awaitingAudioStop: boolean;
  ignoredResponseIds: readonly string[];
}

const MAX_IGNORED_RESPONSE_IDS = 32;

export const EMPTY_REALTIME_RESPONSE_LIFECYCLE: RealtimeResponseLifecycle =
  Object.freeze({
    responding: false,
    pendingRequestToken: null,
    activeResponseId: null,
    awaitingAudioStop: false,
    ignoredResponseIds: Object.freeze([]) as readonly string[],
  });

function rememberIgnored(
  state: RealtimeResponseLifecycle,
  responseId: string | null,
) {
  if (!responseId || state.ignoredResponseIds.includes(responseId)) {
    return state.ignoredResponseIds;
  }
  return [...state.ignoredResponseIds, responseId].slice(
    -MAX_IGNORED_RESPONSE_IDS,
  );
}

export function responseEventBelongsToActive(
  state: RealtimeResponseLifecycle,
  responseId: string | null,
) {
  if (
    responseId &&
    state.ignoredResponseIds.includes(responseId)
  ) {
    return false;
  }
  if (state.activeResponseId) {
    return !responseId || responseId === state.activeResponseId;
  }
  return false;
}

export function markRealtimeResponseRequested(
  state: RealtimeResponseLifecycle,
  requestToken: string,
): RealtimeResponseLifecycle {
  return {
    responding: true,
    pendingRequestToken: requestToken,
    activeResponseId: null,
    awaitingAudioStop: false,
    ignoredResponseIds: rememberIgnored(
      state,
      state.activeResponseId,
    ),
  };
}

export function markRealtimeResponseCreated(
  state: RealtimeResponseLifecycle,
  responseId: string | null,
  requestToken: string | null,
): RealtimeResponseLifecycle {
  if (
    !state.pendingRequestToken ||
    requestToken !== state.pendingRequestToken ||
    responseId &&
    state.ignoredResponseIds.includes(responseId)
  ) {
    return state;
  }
  return {
    responding: true,
    pendingRequestToken: null,
    activeResponseId: responseId,
    awaitingAudioStop: false,
    ignoredResponseIds: rememberIgnored(
      state,
      state.activeResponseId &&
        state.activeResponseId !== responseId
        ? state.activeResponseId
        : null,
    ),
  };
}

export function markRealtimeResponseGenerated(
  state: RealtimeResponseLifecycle,
  responseId: string | null,
): RealtimeResponseLifecycle {
  if (!responseEventBelongsToActive(state, responseId)) {
    return state;
  }
  return {
    ...state,
    responding: true,
    pendingRequestToken: null,
    activeResponseId: responseId ?? state.activeResponseId,
    awaitingAudioStop: true,
  };
}

export function markRealtimeResponseTerminated(
  state: RealtimeResponseLifecycle,
  responseId: string | null,
): RealtimeResponseLifecycle {
  if (!responseEventBelongsToActive(state, responseId)) {
    return state;
  }
  const ownedResponseId = responseId ?? state.activeResponseId;
  return {
    responding: false,
    pendingRequestToken: null,
    activeResponseId: null,
    awaitingAudioStop: false,
    ignoredResponseIds: rememberIgnored(state, ownedResponseId),
  };
}

export function markRealtimeAudioStopped(
  state: RealtimeResponseLifecycle,
  responseId: string | null,
): RealtimeResponseLifecycle {
  if (
    !state.awaitingAudioStop ||
    !responseEventBelongsToActive(state, responseId)
  ) {
    return state;
  }
  return markRealtimeResponseTerminated(state, responseId);
}

export function cancelRealtimeResponse(
  state: RealtimeResponseLifecycle,
): RealtimeResponseLifecycle {
  return {
    responding: false,
    pendingRequestToken: null,
    activeResponseId: null,
    awaitingAudioStop: false,
    ignoredResponseIds: rememberIgnored(
      state,
      state.activeResponseId,
    ),
  };
}
