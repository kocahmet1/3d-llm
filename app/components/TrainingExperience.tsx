"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrainingHUD } from "./TrainingHUD";
import { TrainingWorldCanvas } from "./TrainingWorldCanvas";
import { IntroTitleCard } from "./IntroTitleCard";
import { AssistantDock, useRealtimeAssistant } from "./assistant";
import {
  chamberProcessDurationSeconds,
  chamberProcessLoops,
  CHAMBER_PROCESS_STOPS,
  DATA_PREP_DURATION_SECONDS,
  DATA_PREP_STAGES,
  DEFAULT_CHAMBER_PROCESS_STOPS,
  TRAINING_STATIONS,
} from "../lib/trainingTrace";
import {
  buildAssistantTurnContextSnapshot,
  resolveAssistantTarget,
  SESSION_TUTOR_INSTRUCTIONS,
  SPOTLIGHT_INTERACTION_CUE,
  SPOTLIGHT_INTRODUCTION_CUE,
} from "../lib/assistantContext";
import {
  attachComponentProcessContext,
  resolveComponentProcessDefinition,
  type AssistantTurnContextWithComponentProcess,
} from "../lib/componentProcesses";
import {
  advanceComponentSpotlight,
  beginComponentSpotlight,
  dismissComponentSpotlight,
  EMPTY_COMPONENT_SPOTLIGHT,
  type ComponentSpotlightSequence,
} from "../lib/componentSpotlight";
import type {
  BranchSide,
  ComponentSpotlightPhase,
  DetailMode,
  IntroTourState,
  MachineRoomCue,
  NavigationMode,
  RideMode,
} from "../lib/worldTypes";
import type { RealtimeServerEvent } from "./assistant/realtimeAssistantTypes";
import {
  registerDirectorExperience,
  unregisterDirectorExperience,
  type DirectorExperienceApi,
} from "../lib/director/registry";
import styles from "./TrainingExperience.module.css";

// The guided "Overview" ride runs at a calm, readable pace (the old quick
// 25s fly-through has been removed).
const OVERVIEW_DURATION_SECONDS = 150;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const SILENT_SPOTLIGHT_INTRO_MS = 3_500;
const VOICE_SPOTLIGHT_INTRO_TIMEOUT_MS = 12_000;
const VOICE_SPOTLIGHT_CONNECTING_TIMEOUT_MS = 22_000;
const VOICE_SPOTLIGHT_HARD_TIMEOUT_MS = 32_000;
const VOICE_SPOTLIGHT_INTERACTION_TIMEOUT_MS = 15_000;
const SPOTLIGHT_CUE_PURPOSE_KEY = "application_response_purpose";
const SPOTLIGHT_CUE_TARGET_KEY = "application_target_id";
const SPOTLIGHT_CUE_TOKEN_KEY = "application_focus_token";

type SpotlightCuePurpose =
  | "component-introduction"
  | "component-interaction";

interface SpotlightCueResponse {
  purpose: SpotlightCuePurpose;
  targetId: string;
  focusToken: number;
  completed: boolean;
}

interface SpotlightPhaseDeadline {
  key: string;
  expiresAt: number;
}

type UnknownRecord = Record<string, unknown>;

function recordValue(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function stringValue(record: UnknownRecord | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function spotlightCueFromResponse(
  response: UnknownRecord | null,
): Omit<SpotlightCueResponse, "completed"> | null {
  const metadata = recordValue(response?.metadata);
  const purpose = stringValue(metadata, SPOTLIGHT_CUE_PURPOSE_KEY);
  const targetId = stringValue(metadata, SPOTLIGHT_CUE_TARGET_KEY);
  const rawFocusToken = stringValue(metadata, SPOTLIGHT_CUE_TOKEN_KEY);
  const focusToken = rawFocusToken ? Number(rawFocusToken) : Number.NaN;
  if (
    (purpose !== "component-introduction" &&
      purpose !== "component-interaction") ||
    !targetId ||
    !Number.isSafeInteger(focusToken) ||
    focusToken <= 0
  ) {
    return null;
  }
  return { purpose, targetId, focusToken };
}

function spotlightCueKey(
  purpose: SpotlightCuePurpose,
  targetId: string,
  focusToken: number,
) {
  return `${purpose}:${focusToken}:${targetId}`;
}

function spotlightFocusKey(targetId: string, focusToken: number) {
  return `${focusToken}:${targetId}`;
}

function useRemoteAudioActivity(
  stream: MediaStream | null,
  speaking: boolean,
) {
  const [activity, setActivity] = useState(0);

  useEffect(() => {
    if (!stream || !speaking || typeof AudioContext === "undefined") {
      const frame = requestAnimationFrame(() => setActivity(0));
      return () => cancelAnimationFrame(frame);
    }

    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    let previousPublishedAt = 0;

    const sample = (now: number) => {
      analyser.getByteTimeDomainData(samples);
      if (now - previousPublishedAt >= 72) {
        let energy = 0;
        for (const value of samples) {
          const centered = (value - 128) / 128;
          energy += centered * centered;
        }
        const rms = Math.sqrt(energy / samples.length);
        const next = clamp01((rms - 0.012) * 10);
        setActivity((current) =>
          Math.abs(current - next) > 0.025 ? next : current,
        );
        previousPublishedAt = now;
      }
      frame = requestAnimationFrame(sample);
    };

    void context.resume().catch(() => undefined);
    frame = requestAnimationFrame(sample);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      analyser.disconnect();
      void context.close().catch(() => undefined);
    };
  }, [speaking, stream]);

  return activity;
}

export function TrainingExperience() {
  // The experience opens inside the machine room, so the guided ride stays
  // paused until the visitor starts it from the HUD (or presses Space).
  const [progress, setProgressState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rideMode, setRideMode] = useState<RideMode>("overview");
  const [detailMode, setDetailMode] = useState<DetailMode>("story");
  const [branchSide, setBranchSide] = useState<BranchSide>("left");
  const [reportedStation, setReportedStation] = useState(0);
  const [dataPrepProgress, setDataPrepProgress] = useState(0);
  const [dataPrepPlaying, setDataPrepPlaying] = useState(true);
  // Transport for the animation inside whichever chamber the visitor is
  // standing in. Held here rather than on the render loop's own clock so it can
  // be paused and scrubbed; the canvas reads it and the HUD dial drives it.
  const [processProgress, setProcessProgress] = useState(0);
  const [processPlaying, setProcessPlaying] = useState(true);
  // The experience opens in the machine room (first-person free roam), so the
  // very first HUD frame reflects that rather than flashing the guided-ride cue.
  const [navigationMode, setNavigationMode] =
    useState<NavigationMode>("machine-room");
  const [machineRoomCue, setMachineRoomCue] =
    useState<MachineRoomCue | null>(null);
  const [movementDiscovered, setMovementDiscovered] = useState(false);
  // First-visit guided tour: "touring" while the canvas drives the camera,
  // "handoff" after it releases control (cleared by the canvas the moment
  // the visitor takes over with the mouse, keys, or touch).
  const [introTour, setIntroTour] = useState<IntroTourState>(null);
  /**
   * True while a director flight is filming. The HUD's coaching cues are
   * addressed to someone who just arrived and is about to press a key; in a
   * recorded walkthrough there is nobody to teach, and the flight enters
   * enough chambers that the prompts would fire almost continuously.
   */
  const [presenting, setPresenting] = useState(false);
  const [assistantTargetId, setAssistantTargetId] = useState<string | null>(
    null,
  );
  const [spotlightSequence, setSpotlightSequence] =
    useState<ComponentSpotlightSequence>(EMPTY_COMPONENT_SPOTLIGHT);
  const spotlightSequenceRef = useRef<ComponentSpotlightSequence>(
    EMPTY_COMPONENT_SPOTLIGHT,
  );
  const spotlightTargetId = spotlightSequence.targetId;
  const spotlightFocusToken = spotlightSequence.focusToken;
  const spotlightPhase = spotlightSequence.phase;
  const [spotlightContext, setSpotlightContext] =
    useState<AssistantTurnContextWithComponentProcess | null>(null);
  const previousBranchId = useRef<string | null>(null);
  const previousStationIndex = useRef(0);
  const assistantKeyHeld = useRef(false);
  const autoListenFocusRef = useRef<string | null>(null);
  const requestedSpotlightCuesRef = useRef(new Set<string>());
  const spotlightCueResponsesRef = useRef(
    new Map<string, SpotlightCueResponse>(),
  );
  const skippedInteractionCuesRef = useRef(new Set<string>());
  const spotlightInterruptFocusRef = useRef<string | null>(null);
  const spotlightPhaseDeadlineRef =
    useRef<SpotlightPhaseDeadline | null>(null);
  const voiceCleanupRef = useRef<() => void>(() => {});
  const previousVoiceEnabledRef = useRef(false);
  const [completedInteractionCueKey, setCompletedInteractionCueKey] =
    useState<string | null>(null);
  const [
    assistantFocusDismissGeneration,
    setAssistantFocusDismissGeneration,
  ] = useState(0);
  const componentReplayResumeRef = useRef<{
    stationId: string;
    transport: "chamber-process" | "data-preparation";
    wasPlaying: boolean;
    progress: number;
  } | null>(null);
  // The canvas assigns this once mounted; changeRideMode calls it to drop
  // the visitor into free-roam FPS mode the instant Explore is selected.
  const freeRoamRequestRef = useRef<(() => void) | null>(null);

  // The hand-off notice ("you have control now") stays up until the visitor
  // actually takes control; the canvas reports that moment through
  // onIntroTourChange(null), so there is no timer here.

  const derivedStation = useMemo(
    () =>
      Math.min(
        TRAINING_STATIONS.length - 1,
        Math.round(progress * (TRAINING_STATIONS.length - 1)),
      ),
    [progress],
  );
  const stationIndex =
    reportedStation === derivedStation ? reportedStation : derivedStation;
  const currentStation = TRAINING_STATIONS[stationIndex];

  // The dial is on screen wherever there is an animation to hold: everywhere
  // except the machine room, which has no chamber process.
  const processAvailable = navigationMode !== "machine-room";
  // The corpus chamber runs its own data-preparation sequence rather than a
  // chamber process, so there the dial drives that instead. Both it and the
  // stage strip are then views onto one value and cannot disagree.
  const dataPrepChamber = stationIndex === 1;
  const dialProgress = dataPrepChamber ? dataPrepProgress : processProgress;
  const dialPlaying = dataPrepChamber ? dataPrepPlaying : processPlaying;
  const processStops = dataPrepChamber
    ? DATA_PREP_STAGES.length
    : (CHAMBER_PROCESS_STOPS[currentStation?.id ?? ""] ??
      DEFAULT_CHAMBER_PROCESS_STOPS);

  const handleDialProgressChange = useCallback(
    (value: number) => {
      if (componentReplayResumeRef.current) return;
      if (dataPrepChamber) setDataPrepProgress(clamp01(value));
      else setProcessProgress(value);
    },
    [dataPrepChamber],
  );

  const handleDialPlayingChange = useCallback(
    (next: boolean) => {
      if (componentReplayResumeRef.current) return;
      // Taking hold of the dial takes the process off whatever was driving it.
      // On the guided ride the animation is paced by the camera's own position
      // along the route, so the ride has to stop — otherwise the next frame
      // would overwrite whatever the visitor just scrubbed to.
      if (!next) setPlaying(false);
      if (dataPrepChamber) setDataPrepPlaying(next);
      else setProcessPlaying(next);
    },
    [dataPrepChamber],
  );

  const restoreComponentReplayTransport = useCallback(() => {
    const resume = componentReplayResumeRef.current;
    componentReplayResumeRef.current = null;
    if (!resume || resume.stationId !== currentStation.id) return;
    if (resume.transport === "data-preparation") {
      setDataPrepProgress(resume.progress);
      setDataPrepPlaying(resume.wasPlaying);
    } else {
      setProcessProgress(resume.progress);
      setProcessPlaying(resume.wasPlaying);
    }
  }, [currentStation.id]);

  const handleCanvasProcessProgressChange = useCallback((value: number) => {
    if (componentReplayResumeRef.current) return;
    setProcessProgress(value);
  }, []);

  const clearSpotlightCueOwnership = useCallback(
    (sequence: ComponentSpotlightSequence) => {
      if (!sequence.targetId) return;
      requestedSpotlightCuesRef.current.delete(
        spotlightCueKey(
          "component-introduction",
          sequence.targetId,
          sequence.focusToken,
        ),
      );
      requestedSpotlightCuesRef.current.delete(
        spotlightCueKey(
          "component-interaction",
          sequence.targetId,
          sequence.focusToken,
        ),
      );
      skippedInteractionCuesRef.current.delete(
        spotlightCueKey(
          "component-interaction",
          sequence.targetId,
          sequence.focusToken,
        ),
      );
      for (const [responseId, cue] of spotlightCueResponsesRef.current) {
        if (
          cue.targetId === sequence.targetId &&
          cue.focusToken === sequence.focusToken
        ) {
          spotlightCueResponsesRef.current.delete(responseId);
        }
      }
    },
    [],
  );

  const clearAssistantSelection = useCallback(() => {
    const current = spotlightSequenceRef.current;
    clearSpotlightCueOwnership(current);
    voiceCleanupRef.current();
    spotlightInterruptFocusRef.current = null;
    spotlightPhaseDeadlineRef.current = null;
    const next = dismissComponentSpotlight(current);
    spotlightSequenceRef.current = next;
    setSpotlightSequence(next);
    setSpotlightContext(null);
    setCompletedInteractionCueKey(null);
    autoListenFocusRef.current = null;
    setAssistantTargetId(null);
    setAssistantFocusDismissGeneration((value) => value + 1);
    restoreComponentReplayTransport();
  }, [clearSpotlightCueOwnership, restoreComponentReplayTransport]);

  const changeRideMode = useCallback((mode: RideMode) => {
    setRideMode(mode);
    if (mode === "overview") {
      setDetailMode("story");
      setPlaying(true);
    } else {
      setPlaying(false);
      // Explore is meant to drop the visitor straight into FPS free-roam
      // rather than just stopping the ride and waiting for them to click
      // the scene themselves.
      freeRoamRequestRef.current?.();
    }
  }, []);

  const restart = useCallback(() => {
    clearAssistantSelection();
    setProgressState(0);
    setReportedStation(0);
    setPlaying(rideMode !== "explore");
  }, [clearAssistantSelection, rideMode]);

  const buildAssistantContextSnapshot = useCallback(
    (
      explicitTargetId: string | null,
      focusPhase: ComponentSpotlightPhase | null = null,
    ) => {
      const componentFocused = focusPhase !== null;
      const replayingComponentProcess =
        focusPhase === "interaction-replay";
      const snapshot = buildAssistantTurnContextSnapshot({
        stationId: currentStation.id,
        explicitTargetId,
        detailMode,
        branchSide,
        visibleState: {
          stationIndex,
          journeyProgress: Number(progress.toFixed(4)),
          dataPreparationProgress: Number(dataPrepProgress.toFixed(4)),
          dataPreparationPlaying:
            componentFocused &&
            currentStation.id === "corpus-data-preparation"
              ? false
              : dataPrepPlaying,
          chamberProcessProgress: Number(processProgress.toFixed(4)),
          chamberProcessPlaying: componentFocused
            ? false
            : processPlaying,
          componentProcessReplayActive: replayingComponentProcess,
          componentSpotlightPhase: focusPhase ?? "none",
          journeyPlaying: playing,
          rideMode,
        },
      });
      return attachComponentProcessContext(
        snapshot,
        explicitTargetId,
        focusPhase === "solo-introduction"
          ? "introducing-selected-component"
          : focusPhase === "interaction-replay"
            ? "playing-isolated-chamber-slice"
            : "available-on-spotlight",
      );
    },
    [
      branchSide,
      currentStation.id,
      dataPrepPlaying,
      dataPrepProgress,
      detailMode,
      playing,
      processPlaying,
      processProgress,
      progress,
      rideMode,
      stationIndex,
    ],
  );
  const makeAssistantTurnContext = useCallback(
    () => buildAssistantContextSnapshot(assistantTargetId, null),
    [assistantTargetId, buildAssistantContextSnapshot],
  );

  const advanceSpotlightToInteraction = useCallback(
    (targetId: string, focusToken: number) => {
      const current = spotlightSequenceRef.current;
      const next = advanceComponentSpotlight(
        current,
        targetId,
        focusToken,
      );
      if (next === current) return false;
      spotlightSequenceRef.current = next;
      setSpotlightSequence(next);
      spotlightPhaseDeadlineRef.current = {
        key: spotlightFocusKey(targetId, focusToken),
        expiresAt:
          performance.now() +
          VOICE_SPOTLIGHT_INTERACTION_TIMEOUT_MS,
      };
      setSpotlightContext(
        buildAssistantContextSnapshot(
          targetId,
          "interaction-replay",
        ),
      );
      return true;
    },
    [buildAssistantContextSnapshot],
  );

  const handleVoiceEvent = useCallback(
    (event: RealtimeServerEvent) => {
      if (event.type === "response.created") {
        const response = recordValue(event.response);
        const responseId = stringValue(response, "id");
        const cue = spotlightCueFromResponse(response);
        if (responseId && cue) {
          spotlightCueResponsesRef.current.set(responseId, {
            ...cue,
            completed: false,
          });
        }
        return;
      }

      if (
        event.type === "response.done" ||
        event.type === "response.cancelled"
      ) {
        const response = recordValue(event.response);
        const responseId =
          stringValue(response, "id") ??
          (typeof event.response_id === "string"
            ? event.response_id
            : null);
        if (!responseId) return;
        let cue = spotlightCueResponsesRef.current.get(responseId);
        if (!cue) {
          const parsedCue = spotlightCueFromResponse(response);
          if (parsedCue) {
            cue = { ...parsedCue, completed: false };
            spotlightCueResponsesRef.current.set(responseId, cue);
          }
        }
        if (!cue) return;

        const status =
          event.type === "response.cancelled"
            ? "cancelled"
            : stringValue(response, "status");
        if (status === "completed" || status === "incomplete") {
          cue.completed = true;
        } else if (status === "failed") {
          spotlightCueResponsesRef.current.delete(responseId);
          if (cue.purpose === "component-introduction") {
            advanceSpotlightToInteraction(
              cue.targetId,
              cue.focusToken,
            );
          } else {
            const current = spotlightSequenceRef.current;
            if (
              current.targetId === cue.targetId &&
              current.focusToken === cue.focusToken
            ) {
              setCompletedInteractionCueKey(
                spotlightCueKey(
                  cue.purpose,
                  cue.targetId,
                  cue.focusToken,
                ),
              );
            }
          }
        } else if (status === "cancelled") {
          spotlightCueResponsesRef.current.delete(responseId);
        }
        return;
      }

      if (event.type === "output_audio_buffer.stopped") {
        const responseId =
          typeof event.response_id === "string"
            ? event.response_id
            : null;
        if (!responseId) return;
        const cue = spotlightCueResponsesRef.current.get(responseId);
        if (!cue?.completed) return;
        spotlightCueResponsesRef.current.delete(responseId);
        if (cue.purpose === "component-introduction") {
          advanceSpotlightToInteraction(
            cue.targetId,
            cue.focusToken,
          );
        } else {
          const current = spotlightSequenceRef.current;
          if (
            current.targetId === cue.targetId &&
            current.focusToken === cue.focusToken
          ) {
            setCompletedInteractionCueKey(
              spotlightCueKey(
                cue.purpose,
                cue.targetId,
                cue.focusToken,
              ),
            );
          }
        }
        return;
      }

      if (event.type === "input_audio_buffer.speech_started") {
        const current = spotlightSequenceRef.current;
        if (!current.targetId) return;
        if (
          spotlightInterruptFocusRef.current !==
          spotlightFocusKey(current.targetId, current.focusToken)
        ) {
          return;
        }
        const interactionKey = spotlightCueKey(
          "component-interaction",
          current.targetId,
          current.focusToken,
        );
        if (current.phase === "solo-introduction") {
          skippedInteractionCuesRef.current.add(interactionKey);
          setCompletedInteractionCueKey(interactionKey);
          advanceSpotlightToInteraction(
            current.targetId,
            current.focusToken,
          );
        } else if (current.phase === "interaction-replay") {
          skippedInteractionCuesRef.current.add(interactionKey);
          setCompletedInteractionCueKey(interactionKey);
        }
      }
    },
    [advanceSpotlightToInteraction],
  );

  // While a component is spotlighted the session runs hands-free: the
  // guide narrates its two phases, then semantic VAD keeps follow-ups
  // hands-free. Without a spotlight, V remains classic push-to-talk.
  const voice = useRealtimeAssistant({
    turnMode: spotlightTargetId ? "semantic-vad" : "push-to-talk",
    semanticVadEagerness: "high",
    instructions: SESSION_TUTOR_INSTRUCTIONS,
    persistentContext: spotlightContext,
    getTurnContext: makeAssistantTurnContext,
    onEvent: handleVoiceEvent,
    onTurnTiming: (timing) => {
      if (process.env.NODE_ENV !== "production") {
        console.info("Voice guide turn timing", timing);
      }
    },
  });
  const {
    isEnabled: voiceEnabled,
    status: voiceStatus,
    startTalking,
    stopTalking,
    requestResponse,
    stopListening,
    cancelResponse,
  } = voice;
  useEffect(() => {
    voiceCleanupRef.current = () => {
      stopListening();
      cancelResponse();
    };
    return () => {
      voiceCleanupRef.current = () => {};
    };
  }, [cancelResponse, stopListening]);
  useEffect(() => {
    if (previousVoiceEnabledRef.current && !voiceEnabled) {
      clearSpotlightCueOwnership(spotlightSequenceRef.current);
      spotlightInterruptFocusRef.current = null;
      autoListenFocusRef.current = null;
    }
    previousVoiceEnabledRef.current = voiceEnabled;
  }, [clearSpotlightCueOwnership, voiceEnabled]);
  const assistantAudioActivity = useRemoteAudioActivity(
    voice.remoteStream,
    voice.status === "speaking",
  );
  const assistantTarget = useMemo(
    () =>
      resolveAssistantTarget({
        stationId: currentStation.id,
        explicitTargetId: assistantTargetId,
      }),
    [assistantTargetId, currentStation.id],
  );
  const assistantTargetLocked =
    voice.status === "listening" ||
    voice.status === "thinking" ||
    voice.status === "speaking";
  const activeComponentProcess = useMemo(
    () => resolveComponentProcessDefinition(spotlightTargetId),
    [spotlightTargetId],
  );

  const startAssistantQuestion = useCallback(() => {
    if (!voiceEnabled || voiceStatus === "connecting" || voiceStatus === "error") {
      return;
    }
    const started = startTalking(
      spotlightTargetId ? undefined : makeAssistantTurnContext(),
    );
    if (started) setPlaying(false);
  }, [
    makeAssistantTurnContext,
    spotlightTargetId,
    startTalking,
    voiceEnabled,
    voiceStatus,
  ]);

  const stopAssistantQuestion = useCallback(() => {
    stopTalking();
  }, [stopTalking]);

  const setProgress = useCallback((value: number) => {
    setProgressState(clamp01(value));
  }, []);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const respectReducedMotion = () => {
      if (componentReplayResumeRef.current) return;
      if (reduceMotion.matches) {
        setPlaying(false);
        setDataPrepPlaying(false);
        setDataPrepProgress(1);
      }
    };

    const frame = requestAnimationFrame(respectReducedMotion);
    reduceMotion.addEventListener("change", respectReducedMotion);

    return () => {
      cancelAnimationFrame(frame);
      reduceMotion.removeEventListener("change", respectReducedMotion);
    };
  }, []);

  useEffect(() => {
    if (stationIndex === 1 && previousStationIndex.current !== 1) {
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      setDataPrepProgress(reduceMotion ? 1 : 0);
      setDataPrepPlaying(!reduceMotion);
    }
    if (stationIndex !== previousStationIndex.current) {
      // Each chamber tells its own story from the beginning, so walking into
      // one rewinds its transport rather than dropping the visitor into the
      // middle of a process they have not seen start.
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      setProcessProgress(reduceMotion ? 1 : 0);
      setProcessPlaying(!reduceMotion);
    }
    previousStationIndex.current = stationIndex;
  }, [stationIndex]);

  // The transport's clock. It loops, because a chamber process has no end
  // state worth resting on — unlike data preparation, which finishes.
  const processDurationSeconds = chamberProcessDurationSeconds(currentStation.id);
  const processLoops = chamberProcessLoops(currentStation.id);
  useEffect(() => {
    if (!processPlaying) return undefined;

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      setProcessProgress((value) => {
        if (componentReplayResumeRef.current) return value;
        const next = value + delta / processDurationSeconds;
        if (processLoops) return next % 1;
        // A run-once chamber stops at its end rather than starting over. The
        // clock pauses itself there, so the transport stays exactly where the
        // animation finished and the dial can be scrubbed back into it.
        if (next >= 1) {
          setProcessPlaying(false);
          return 1;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [processPlaying, processDurationSeconds, processLoops]);

  useEffect(() => {
    if (stationIndex !== 1 || !dataPrepPlaying) return;

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      setDataPrepProgress((value) => {
        if (componentReplayResumeRef.current) return value;
        const next = clamp01(value + delta / DATA_PREP_DURATION_SECONDS);
        if (next >= 1) setDataPrepPlaying(false);
        return next;
      });
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dataPrepPlaying, stationIndex]);

  useEffect(() => {
    if (!currentStation?.branch) return;
    if (previousBranchId.current !== currentStation.id) {
      previousBranchId.current = currentStation.id;
      setBranchSide(currentStation.branch.default);
    }
  }, [currentStation]);

  const dataPrepBlocking = stationIndex === 1 && dataPrepProgress < 1;

  useEffect(() => {
    if (!playing || rideMode === "explore" || dataPrepBlocking) return;

    let frame = 0;
    let last = performance.now();
    // Only the guided "overview" ride auto-advances ("explore" returned above).
    const duration = OVERVIEW_DURATION_SECONDS;

    const tick = (now: number) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      setProgressState((value) => {
        const next = clamp01(value + delta / duration);
        if (next >= 1) setPlaying(false);
        return next;
      });
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dataPrepBlocking, playing, rideMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, button, select, textarea")) return;

      // Space is deliberately absent here: it belongs to the chamber process
      // dial, which TrainingWorldCanvas owns. The ride's own play/pause is
      // mouse-only, so one key never drives two transports at once.
      const stationStep = 1 / ((TRAINING_STATIONS.length - 1) * 3);
      if (event.code === "ArrowRight") {
        event.preventDefault();
        setPlaying(false);
        setProgressState((value) => clamp01(value + stationStep));
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        setPlaying(false);
        setProgressState((value) => clamp01(value - stationStep));
      } else if (event.code === "KeyQ") {
        setBranchSide("left");
      } else if (event.code === "KeyE") {
        setBranchSide("right");
      } else if (event.code === "Home") {
        event.preventDefault();
        setProgressState(0);
        setPlaying(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const isInteractiveTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      Boolean(
        target.closest(
          "input, button, select, textarea, a, [contenteditable='true']",
        ),
      );
    const releaseVoiceKey = () => {
      if (!assistantKeyHeld.current) return;
      assistantKeyHeld.current = false;
      stopAssistantQuestion();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.code !== "KeyV" ||
        event.repeat ||
        isInteractiveTarget(event.target) ||
        !voice.isEnabled ||
        voice.status === "connecting" ||
        voice.status === "error"
      ) {
        return;
      }
      event.preventDefault();
      assistantKeyHeld.current = true;
      startAssistantQuestion();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "KeyV" || isInteractiveTarget(event.target)) return;
      event.preventDefault();
      releaseVoiceKey();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseVoiceKey);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseVoiceKey);
    };
  }, [
    startAssistantQuestion,
    stopAssistantQuestion,
    voice.isEnabled,
    voice.status,
  ]);

  // The demo director (competition-video flight) drives the HUD-level state
  // through this small registered API; it has no effect until a flight runs.
  const voiceStateRef = useRef({ enabled: voice.isEnabled, status: voice.status });
  useEffect(() => {
    voiceStateRef.current = { enabled: voice.isEnabled, status: voice.status };
  }, [voice.isEnabled, voice.status]);
  useEffect(() => {
    const api: DirectorExperienceApi = {
      setProgress: (value) => {
        setPlaying(false);
        setProgressState(clamp01(value));
        setReportedStation(
          Math.min(
            TRAINING_STATIONS.length - 1,
            Math.round(clamp01(value) * (TRAINING_STATIONS.length - 1)),
          ),
        );
      },
      setPlaying: (value) => setPlaying(value),
      setDataPrep: (value, prepPlaying) => {
        if (componentReplayResumeRef.current) return;
        setDataPrepPlaying(prepPlaying);
        setDataPrepProgress(clamp01(value));
      },
      setDetailMode: (mode) => setDetailMode(mode),
      getVoice: () => voiceStateRef.current,
      setPresenting: (active) => setPresenting(active),
    };
    registerDirectorExperience(api);
    return () => unregisterDirectorExperience(api);
  }, []);

  const beginManualNavigation = useCallback(() => {
    setPlaying(false);
  }, []);

  const handleMovementDiscovered = useCallback(() => {
    setMovementDiscovered(true);
  }, []);

  const handleWorldProgress = useCallback((value: number) => {
    setPlaying(false);
    setProgressState(clamp01(value));
  }, []);

  const handleAssistantFocusChange = useCallback(
    (targetId: string | null, focusToken: number) => {
      if (targetId) {
        const currentFocus = spotlightSequenceRef.current;
        if (
          targetId === currentFocus.targetId &&
          focusToken === currentFocus.focusToken &&
          spotlightContext
        ) {
          return;
        }

        const replacingFocus =
          currentFocus.targetId !== null &&
          (currentFocus.targetId !== targetId ||
            currentFocus.focusToken !== focusToken);
        const replacingUnfocusedVoiceTurn =
          currentFocus.targetId === null &&
          (voiceStatus === "listening" ||
            voiceStatus === "thinking" ||
            voiceStatus === "speaking");
        if (replacingFocus || replacingUnfocusedVoiceTurn) {
          // The canvas swaps targets directly, without an intermediate release.
          // Stop A (or a normal unfocused turn) before the frozen snapshot for
          // the new component takes over.
          clearSpotlightCueOwnership(currentFocus);
          spotlightInterruptFocusRef.current = null;
          spotlightPhaseDeadlineRef.current = null;
          autoListenFocusRef.current = null;
          stopListening();
          // This also clears a generated response whose audio is still
          // draining after response.done.
          cancelResponse();
        }

        // A spotlighted component pauses the ride and becomes the explicit
        // conversation target until the visitor releases it. Build from the
        // explicit target before React state changes, so follow-ups stay tied
        // to exactly this captured scene.
        const componentProcess = resolveComponentProcessDefinition(targetId);
        if (componentProcess && !componentReplayResumeRef.current) {
          const dataPreparation =
            componentProcess.stationId === "corpus-data-preparation";
          componentReplayResumeRef.current = {
            stationId: componentProcess.stationId,
            transport: dataPreparation
              ? "data-preparation"
              : "chamber-process",
            wasPlaying: dataPreparation ? dataPrepPlaying : processPlaying,
            progress: dataPreparation ? dataPrepProgress : processProgress,
          };
          if (dataPreparation) setDataPrepPlaying(false);
          else setProcessPlaying(false);
        }

        const nextContext = buildAssistantContextSnapshot(
          targetId,
          componentProcess ? "solo-introduction" : null,
        );
        const nextSequence = componentProcess
          ? beginComponentSpotlight(targetId, focusToken)
          : {
              targetId,
              focusToken,
              phase: null,
            };
        spotlightSequenceRef.current = nextSequence;
        setSpotlightSequence(nextSequence);
        setSpotlightContext(nextContext);
        spotlightPhaseDeadlineRef.current = componentProcess
          ? {
              key: spotlightFocusKey(targetId, focusToken),
              expiresAt:
                performance.now() +
                VOICE_SPOTLIGHT_HARD_TIMEOUT_MS,
            }
          : null;
        spotlightInterruptFocusRef.current = null;
        setCompletedInteractionCueKey(null);
        autoListenFocusRef.current = null;
        setPlaying(false);
        setAssistantTargetId(targetId);
      } else {
        // Spotlight released: close the hands-free microphone and narration.
        const currentFocus = spotlightSequenceRef.current;
        clearSpotlightCueOwnership(currentFocus);
        spotlightInterruptFocusRef.current = null;
        spotlightPhaseDeadlineRef.current = null;
        autoListenFocusRef.current = null;
        const next = dismissComponentSpotlight(
          currentFocus,
        );
        spotlightSequenceRef.current = next;
        setSpotlightSequence(next);
        setSpotlightContext(null);
        setCompletedInteractionCueKey(null);
        stopListening();
        cancelResponse();
        restoreComponentReplayTransport();
      }
    },
    [
      buildAssistantContextSnapshot,
      cancelResponse,
      clearSpotlightCueOwnership,
      dataPrepPlaying,
      dataPrepProgress,
      processPlaying,
      processProgress,
      restoreComponentReplayTransport,
      spotlightContext,
      stopListening,
      voiceStatus,
    ],
  );

  // Phase one is proactive: the guide introduces the selected component while
  // it is the only object on stage.
  useEffect(() => {
    if (
      !voiceEnabled ||
      (voiceStatus !== "ready" && voiceStatus !== "listening") ||
      !activeComponentProcess ||
      !spotlightTargetId ||
      !spotlightContext ||
      spotlightPhase !== "solo-introduction"
    ) {
      return;
    }
    const cueKey = spotlightCueKey(
      "component-introduction",
      spotlightTargetId,
      spotlightFocusToken,
    );
    if (requestedSpotlightCuesRef.current.has(cueKey)) return;
    const focusKey = spotlightFocusKey(
      spotlightTargetId,
      spotlightFocusToken,
    );
    if (
      spotlightInterruptFocusRef.current !== focusKey &&
      !startTalking()
    ) {
      return;
    }
    spotlightInterruptFocusRef.current = focusKey;
    const requested = requestResponse({
      instructions: SPOTLIGHT_INTRODUCTION_CUE,
      context: spotlightContext,
      metadata: {
        [SPOTLIGHT_CUE_PURPOSE_KEY]: "component-introduction",
        [SPOTLIGHT_CUE_TARGET_KEY]: spotlightTargetId,
        [SPOTLIGHT_CUE_TOKEN_KEY]: String(spotlightFocusToken),
      },
    });
    if (requested) {
      requestedSpotlightCuesRef.current.add(cueKey);
    }
  }, [
    activeComponentProcess,
    requestResponse,
    spotlightContext,
    spotlightFocusToken,
    spotlightPhase,
    spotlightTargetId,
    startTalking,
    voiceEnabled,
    voiceStatus,
  ]);

  // Phase two starts the authored replay and receives its own causal narration.
  useEffect(() => {
    if (
      !voiceEnabled ||
      (voiceStatus !== "ready" && voiceStatus !== "listening") ||
      !activeComponentProcess ||
      !spotlightTargetId ||
      !spotlightContext ||
      spotlightPhase !== "interaction-replay"
    ) {
      return;
    }
    const cueKey = spotlightCueKey(
      "component-interaction",
      spotlightTargetId,
      spotlightFocusToken,
    );
    if (
      requestedSpotlightCuesRef.current.has(cueKey) ||
      skippedInteractionCuesRef.current.has(cueKey)
    ) {
      return;
    }
    const focusKey = spotlightFocusKey(
      spotlightTargetId,
      spotlightFocusToken,
    );
    if (
      spotlightInterruptFocusRef.current !== focusKey &&
      !startTalking()
    ) {
      return;
    }
    spotlightInterruptFocusRef.current = focusKey;
    const requested = requestResponse({
      instructions: SPOTLIGHT_INTERACTION_CUE,
      context: spotlightContext,
      metadata: {
        [SPOTLIGHT_CUE_PURPOSE_KEY]: "component-interaction",
        [SPOTLIGHT_CUE_TARGET_KEY]: spotlightTargetId,
        [SPOTLIGHT_CUE_TOKEN_KEY]: String(spotlightFocusToken),
      },
    });
    if (requested) {
      requestedSpotlightCuesRef.current.add(cueKey);
    }
  }, [
    activeComponentProcess,
    requestResponse,
    spotlightContext,
    spotlightFocusToken,
    spotlightPhase,
    spotlightTargetId,
    startTalking,
    voiceEnabled,
    voiceStatus,
  ]);

  // Voice-off, connection failure, or a lost response must never leave the
  // visual presentation stuck on the solo component forever. This is an
  // absolute deadline: pending server state cannot extend it.
  useEffect(() => {
    if (
      !activeComponentProcess ||
      !spotlightTargetId ||
      spotlightPhase !== "solo-introduction"
    ) {
      return undefined;
    }
    const focusKey = spotlightFocusKey(
      spotlightTargetId,
      spotlightFocusToken,
    );
    const phaseDeadline = spotlightPhaseDeadlineRef.current;
    const now = performance.now();
    const hardDeadline =
      phaseDeadline?.key === focusKey
        ? phaseDeadline.expiresAt
        : now + VOICE_SPOTLIGHT_HARD_TIMEOUT_MS;
    const phaseStartedAt =
      hardDeadline - VOICE_SPOTLIGHT_HARD_TIMEOUT_MS;
    const softDeadline =
      !voiceEnabled || voiceStatus === "error" || voiceStatus === "off"
        ? now + SILENT_SPOTLIGHT_INTRO_MS
        : voiceStatus === "connecting"
          ? phaseStartedAt + VOICE_SPOTLIGHT_CONNECTING_TIMEOUT_MS
          : now + VOICE_SPOTLIGHT_INTRO_TIMEOUT_MS;
    const deadline = Math.min(hardDeadline, softDeadline);
    const timer = window.setTimeout(() => {
      const current = spotlightSequenceRef.current;
      if (
        current.targetId !== spotlightTargetId ||
        current.focusToken !== spotlightFocusToken ||
        current.phase !== "solo-introduction"
      ) {
        return;
      }
      for (const [responseId, cue] of spotlightCueResponsesRef.current) {
        if (
          cue.purpose === "component-introduction" &&
          cue.targetId === spotlightTargetId &&
          cue.focusToken === spotlightFocusToken
        ) {
          spotlightCueResponsesRef.current.delete(responseId);
        }
      }
      cancelResponse();
      advanceSpotlightToInteraction(
        spotlightTargetId,
        spotlightFocusToken,
      );
    }, Math.max(0, deadline - now));
    return () => window.clearTimeout(timer);
  }, [
    activeComponentProcess,
    advanceSpotlightToInteraction,
    cancelResponse,
    spotlightFocusToken,
    spotlightPhase,
    spotlightTargetId,
    voiceEnabled,
    voiceStatus,
  ]);

  useEffect(() => {
    if (
      !voiceEnabled ||
      !activeComponentProcess ||
      !spotlightTargetId ||
      spotlightPhase !== "interaction-replay"
    ) {
      return undefined;
    }
    const cueKey = spotlightCueKey(
      "component-interaction",
      spotlightTargetId,
      spotlightFocusToken,
    );
    if (completedInteractionCueKey === cueKey) return undefined;
    const focusKey = spotlightFocusKey(
      spotlightTargetId,
      spotlightFocusToken,
    );
    const phaseDeadline = spotlightPhaseDeadlineRef.current;
    const now = performance.now();
    const deadline =
      phaseDeadline?.key === focusKey
        ? phaseDeadline.expiresAt
        : now + VOICE_SPOTLIGHT_INTERACTION_TIMEOUT_MS;
    const timer = window.setTimeout(() => {
      const current = spotlightSequenceRef.current;
      if (
        current.targetId !== spotlightTargetId ||
        current.focusToken !== spotlightFocusToken ||
        current.phase !== "interaction-replay"
      ) {
        return;
      }
      for (const [responseId, cue] of spotlightCueResponsesRef.current) {
        if (
          cue.purpose === "component-interaction" &&
          cue.targetId === spotlightTargetId &&
          cue.focusToken === spotlightFocusToken
        ) {
          spotlightCueResponsesRef.current.delete(responseId);
        }
      }
      cancelResponse();
      setCompletedInteractionCueKey(cueKey);
    }, Math.max(0, deadline - now));
    return () => window.clearTimeout(timer);
  }, [
    activeComponentProcess,
    cancelResponse,
    completedInteractionCueKey,
    spotlightFocusToken,
    spotlightPhase,
    spotlightTargetId,
    voiceEnabled,
  ]);

  // Once both scripted phases have run, semantic VAD keeps follow-up
  // questions hands-free until the visitor releases the spotlight.
  useEffect(() => {
    if (!voiceEnabled) {
      autoListenFocusRef.current = null;
      return;
    }
    if (
      !spotlightTargetId ||
      !spotlightContext ||
      spotlightPhase !== "interaction-replay"
    ) {
      return;
    }
    const cueKey = spotlightCueKey(
      "component-interaction",
      spotlightTargetId,
      spotlightFocusToken,
    );
    if (completedInteractionCueKey !== cueKey) return;
    if (voiceStatus !== "ready" && voiceStatus !== "listening") return;
    if (autoListenFocusRef.current === cueKey) return;
    if (startTalking()) {
      autoListenFocusRef.current = cueKey;
      spotlightInterruptFocusRef.current = spotlightFocusKey(
        spotlightTargetId,
        spotlightFocusToken,
      );
    }
  }, [
    completedInteractionCueKey,
    spotlightContext,
    spotlightFocusToken,
    spotlightPhase,
    spotlightTargetId,
    startTalking,
    voiceEnabled,
    voiceStatus,
  ]);

  // Station and unnamed fallback picks keep the original static spotlight
  // behavior. They get normal hands-free Q&A, but never component-only
  // scripts or a fabricated interaction phase.
  useEffect(() => {
    if (
      !voiceEnabled ||
      activeComponentProcess ||
      !spotlightTargetId ||
      spotlightPhase !== null ||
      !spotlightContext ||
      (voiceStatus !== "ready" && voiceStatus !== "listening")
    ) {
      return;
    }
    const focusKey = spotlightFocusKey(
      spotlightTargetId,
      spotlightFocusToken,
    );
    if (autoListenFocusRef.current === focusKey) return;
    if (startTalking()) {
      autoListenFocusRef.current = focusKey;
      spotlightInterruptFocusRef.current = focusKey;
    }
  }, [
    activeComponentProcess,
    spotlightContext,
    spotlightFocusToken,
    spotlightPhase,
    spotlightTargetId,
    startTalking,
    voiceEnabled,
    voiceStatus,
  ]);

  return (
    <main className={styles.experience}>
      <TrainingWorldCanvas
        progress={progress}
        stationIndex={stationIndex}
        playing={playing}
        dataPrepProgress={dataPrepProgress}
        processProgress={processProgress}
        processPlaying={dialPlaying}
        processLocked={Boolean(activeComponentProcess)}
        onProcessProgressChange={handleCanvasProcessProgressChange}
        onProcessPlayingChange={handleDialPlayingChange}
        branchSide={branchSide}
        detailMode={detailMode}
        rideMode={rideMode}
        assistantEnabled={voice.isEnabled}
        assistantStatus={voice.status}
        assistantAudioActivity={assistantAudioActivity}
        assistantTargetId={assistantTargetId}
        assistantTargetLocked={assistantTargetLocked}
        assistantFocusPhase={spotlightPhase}
        assistantFocusToken={spotlightFocusToken}
        assistantFocusDismissGeneration={
          assistantFocusDismissGeneration
        }
        onProgressChange={handleWorldProgress}
        onManualNavigation={beginManualNavigation}
        onNavigationModeChange={setNavigationMode}
        onMachineRoomCueChange={setMachineRoomCue}
        onMovementDiscovered={handleMovementDiscovered}
        onIntroTourChange={setIntroTour}
        onStationChange={setReportedStation}
        onAssistantTargetChange={setAssistantTargetId}
        onAssistantFocusChange={handleAssistantFocusChange}
        freeRoamRequestRef={freeRoamRequestRef}
      />
      <TrainingHUD
        progress={progress}
        stationIndex={stationIndex}
        playing={playing}
        rideMode={rideMode}
        detailMode={detailMode}
        branchSide={branchSide}
        navigationMode={navigationMode}
        machineRoomCue={machineRoomCue}
        movementDiscovered={movementDiscovered}
        introTour={introTour}
        presenting={presenting}
        stations={TRAINING_STATIONS}
        dataPrepProgress={dataPrepProgress}
        processProgress={dialProgress}
        processPlaying={dialPlaying}
        processLocked={Boolean(activeComponentProcess)}
        processStops={processStops}
        processAvailable={processAvailable}
        onProcessProgressChange={handleDialProgressChange}
        onProcessPlayingChange={handleDialPlayingChange}
        onProgressChange={(value) => {
          setPlaying(false);
          setProgress(value);
        }}
        onPlayingChange={setPlaying}
        onRideModeChange={changeRideMode}
        onDetailModeChange={setDetailMode}
        onBranchChange={setBranchSide}
        onRestart={restart}
      />
      {/* The voice guide points at chamber exhibits; the machine room has
          none, so the dock would be a dead control there. */}
      {navigationMode !== "machine-room" ? (
      <AssistantDock
        enabled={voice.isEnabled}
        status={voice.status}
        targetLabel={assistantTarget.target.label}
        processLabel={
          activeComponentProcess
            ? spotlightPhase === "solo-introduction"
              ? `${activeComponentProcess.label} · component introduction`
              : `${activeComponentProcess.label} · isolated chamber replay`
            : null
        }
        processPhaseLabel={
          spotlightPhase === "solo-introduction"
            ? "INTRODUCING"
            : "REPLAYING"
        }
        error={voice.error}
        handsFree={Boolean(spotlightTargetId)}
        onEnable={(temporaryApiKey) => {
          setPlaying(false);
          void voice.enable(temporaryApiKey);
        }}
        onDisable={() => {
          assistantKeyHeld.current = false;
          voice.disable();
        }}
        onTalkStart={startAssistantQuestion}
        onTalkEnd={stopAssistantQuestion}
      />
      ) : null}
      <p className={styles.screenReaderStatus} aria-live="polite">
        {currentStation?.title}. {currentStation?.story}
        {activeComponentProcess
          ? spotlightPhase === "solo-introduction"
            ? ` Introducing ${activeComponentProcess.label} by itself.`
            : ` Showing the isolated interaction replay for ${activeComponentProcess.label}.`
          : null}
      </p>
      <IntroTitleCard />
    </main>
  );
}
