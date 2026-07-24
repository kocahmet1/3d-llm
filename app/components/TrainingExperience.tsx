"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrainingHUD } from "./TrainingHUD";
import { TrainingWorldCanvas } from "./TrainingWorldCanvas";
import { AssistantDock, useRealtimeAssistant } from "./assistant";
import {
  DATA_PREP_DURATION_SECONDS,
  TRAINING_STATIONS,
} from "../lib/trainingTrace";
import {
  buildAssistantTurnContextSnapshot,
  resolveAssistantTarget,
  SESSION_TUTOR_INSTRUCTIONS,
} from "../lib/assistantContext";
import {
  ASSISTANT_APP_TOOLS,
  parseAssistantAppCommand,
  resolveAssistantChamberIndex,
} from "../lib/assistantAppTools";
import type {
  BranchSide,
  DetailMode,
  IntroTourState,
  MachineRoomCue,
  NavigationMode,
  RideMode,
} from "../lib/worldTypes";
import type { RealtimeAssistantToolCall } from "./assistant";
import {
  registerDirectorExperience,
  unregisterDirectorExperience,
  type DirectorExperienceApi,
} from "../lib/director/registry";
import styles from "./TrainingExperience.module.css";

const OVERVIEW_DURATION_SECONDS = 25;
const LEARN_DURATION_SECONDS = 150;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

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
  // The experience opens in the machine room (first-person free roam), so the
  // very first HUD frame reflects that rather than flashing the guided-ride cue.
  const [navigationMode, setNavigationMode] =
    useState<NavigationMode>("machine-room");
  const [machineRoomCue, setMachineRoomCue] =
    useState<MachineRoomCue | null>(null);
  const [movementDiscovered, setMovementDiscovered] = useState(false);
  // First-visit guided tour: "touring" while the canvas drives the camera,
  // "handoff" briefly after it releases control (auto-dismissed below).
  const [introTour, setIntroTour] = useState<IntroTourState>(null);
  const [assistantTargetId, setAssistantTargetId] = useState<string | null>(
    null,
  );
  const [spotlightTargetId, setSpotlightTargetId] = useState<string | null>(
    null,
  );
  const previousBranchId = useRef<string | null>(null);
  const previousStationIndex = useRef(0);
  const assistantKeyHeld = useRef(false);
  const autoListenTargetRef = useRef<string | null>(null);

  // The hand-off notice ("you have control now") dismisses itself.
  useEffect(() => {
    if (introTour !== "handoff") return undefined;
    const timer = window.setTimeout(() => setIntroTour(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [introTour]);

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

  const clearAssistantSelection = useCallback(() => {
    setSpotlightTargetId(null);
    setAssistantTargetId(null);
  }, []);

  const navigateToStation = useCallback(
    (targetIndex: number) => {
      const boundedIndex = Math.min(
        TRAINING_STATIONS.length - 1,
        Math.max(0, targetIndex),
      );
      const destination = TRAINING_STATIONS[boundedIndex];
      const changed = boundedIndex !== stationIndex;

      if (changed) {
        setPlaying(false);
        clearAssistantSelection();
        setReportedStation(boundedIndex);
        setProgressState(
          boundedIndex / Math.max(1, TRAINING_STATIONS.length - 1),
        );
      }

      return {
        ok: true,
        changed,
        stationId: destination.id,
        stationTitle: destination.title,
        stationIndex: boundedIndex,
        message: changed
          ? `Moved to ${destination.title}.`
          : `Already at ${destination.title}.`,
      };
    },
    [clearAssistantSelection, stationIndex],
  );

  const changeRideMode = useCallback((mode: RideMode) => {
    setRideMode(mode);
    if (mode === "overview") {
      setDetailMode("story");
      setPlaying(true);
    } else if (mode === "learn") {
      setPlaying(true);
    } else {
      setPlaying(false);
    }
  }, []);

  const restart = useCallback(() => {
    clearAssistantSelection();
    setProgressState(0);
    setReportedStation(0);
    setPlaying(rideMode !== "explore");
  }, [clearAssistantSelection, rideMode]);

  const handleAssistantToolCall = useCallback(
    (call: RealtimeAssistantToolCall) => {
      const parsed = parseAssistantAppCommand(call.name, call.arguments);
      if (!parsed.ok) {
        return { ok: false, changed: false, error: parsed.error };
      }

      const command = parsed.command;
      if (command.kind === "navigate_chamber") {
        const targetIndex = resolveAssistantChamberIndex(
          stationIndex,
          command.destination,
        );
        if (targetIndex === null) {
          return {
            ok: false,
            changed: false,
            error: "That chamber does not exist.",
          };
        }
        return navigateToStation(targetIndex);
      }

      if (command.kind === "set_journey_playback") {
        if (command.action === "restart") {
          const firstStation = TRAINING_STATIONS[0];
          const restartPlaying = rideMode !== "explore";
          const changed =
            progress !== 0 ||
            stationIndex !== 0 ||
            playing !== restartPlaying;
          restart();
          return {
            ok: true,
            changed,
            action: command.action,
            stationId: firstStation.id,
            stationTitle: firstStation.title,
            message: "Restarted the journey from the first chamber.",
          };
        }
        if (command.action === "play") {
          if (rideMode === "explore") {
            return {
              ok: false,
              changed: false,
              error: "Journey playback is unavailable in Explore mode.",
            };
          }
          if (progress >= 1) {
            return {
              ok: true,
              changed: false,
              action: command.action,
              message: "The journey is already at the end. Restart it to play again.",
            };
          }
          const changed = !playing;
          setPlaying(true);
          return {
            ok: true,
            changed,
            action: command.action,
            message: changed
              ? "Resumed the journey."
              : "The journey is already playing.",
          };
        }

        const changed = playing;
        setPlaying(false);
        return {
          ok: true,
          changed,
          action: command.action,
          message: changed
            ? "Paused the journey."
            : "The journey is already paused.",
        };
      }

      if (command.kind === "set_detail_mode") {
        const changed = detailMode !== command.mode;
        setDetailMode(command.mode);
        return {
          ok: true,
          changed,
          mode: command.mode,
          message: changed
            ? `Switched to ${command.mode} detail.`
            : `${command.mode} detail is already selected.`,
        };
      }

      if (command.kind === "set_ride_mode") {
        const modeChanged = rideMode !== command.mode;
        const changed =
          modeChanged ||
          (command.mode === "overview" &&
            (detailMode !== "story" || !playing)) ||
          (command.mode === "learn" && !playing) ||
          (command.mode === "explore" && playing);
        changeRideMode(command.mode);
        return {
          ok: true,
          changed,
          mode: command.mode,
          message: modeChanged
            ? `Switched to ${command.mode} mode.`
            : changed
              ? `Reset ${command.mode} mode to its default playback state.`
            : `${command.mode} mode is already selected.`,
        };
      }

      if (command.kind === "choose_branch") {
        if (!currentStation.branch) {
          return {
            ok: false,
            changed: false,
            error: "The current chamber does not have a branch choice.",
          };
        }
        const changed = branchSide !== command.side;
        setBranchSide(command.side);
        return {
          ok: true,
          changed,
          side: command.side,
          branchLabel: currentStation.branch[command.side],
          stationId: currentStation.id,
          message: changed
            ? `Selected the ${command.side} branch.`
            : `The ${command.side} branch is already selected.`,
        };
      }

      if (stationIndex !== 1) {
        return {
          ok: false,
          changed: false,
          error:
            "Data-preparation playback is only available in the Corpus & Data Preparation chamber.",
        };
      }
      if (command.action === "restart") {
        const changed = dataPrepProgress !== 0 || !dataPrepPlaying;
        setDataPrepProgress(0);
        setDataPrepPlaying(true);
        return {
          ok: true,
          changed,
          action: command.action,
          message: "Restarted the data-preparation sequence.",
        };
      }
      if (command.action === "play") {
        if (dataPrepProgress >= 1) {
          return {
            ok: true,
            changed: false,
            action: command.action,
            message:
              "The data-preparation sequence is complete. Restart it to play again.",
          };
        }
        const changed = !dataPrepPlaying;
        setDataPrepPlaying(true);
        return {
          ok: true,
          changed,
          action: command.action,
          message: changed
            ? "Resumed data preparation."
            : "Data preparation is already playing.",
        };
      }

      const changed = dataPrepPlaying;
      setDataPrepPlaying(false);
      return {
        ok: true,
        changed,
        action: command.action,
        message: changed
          ? "Paused data preparation."
          : "Data preparation is already paused.",
      };
    },
    [
      branchSide,
      changeRideMode,
      currentStation,
      dataPrepPlaying,
      dataPrepProgress,
      detailMode,
      navigateToStation,
      playing,
      progress,
      restart,
      rideMode,
      stationIndex,
    ],
  );

  const makeAssistantTurnContext = useCallback(
    () =>
      buildAssistantTurnContextSnapshot({
        stationId: currentStation.id,
        explicitTargetId: assistantTargetId,
        detailMode,
        branchSide,
        visibleState: {
          stationIndex,
          journeyProgress: Number(progress.toFixed(4)),
          dataPreparationProgress: Number(dataPrepProgress.toFixed(4)),
          journeyPlaying: playing,
          rideMode,
        },
      }),
    [
      assistantTargetId,
      branchSide,
      currentStation.id,
      dataPrepProgress,
      detailMode,
      playing,
      progress,
      rideMode,
      stationIndex,
    ],
  );
  // While a component is spotlighted the session runs hands-free: the
  // microphone opens automatically and semantic VAD detects when the visitor
  // finishes asking. Without a spotlight, V remains classic push-to-talk.
  const voice = useRealtimeAssistant({
    turnMode: spotlightTargetId ? "semantic-vad" : "push-to-talk",
    instructions: SESSION_TUTOR_INSTRUCTIONS,
    tools: ASSISTANT_APP_TOOLS,
    onToolCall: handleAssistantToolCall,
    getTurnContext: makeAssistantTurnContext,
  });
  const {
    isEnabled: voiceEnabled,
    status: voiceStatus,
    startTalking,
    stopTalking,
    stopListening,
  } = voice;
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

  const startAssistantQuestion = useCallback(() => {
    if (!voiceEnabled || voiceStatus === "connecting" || voiceStatus === "error") {
      return;
    }
    const started = startTalking(makeAssistantTurnContext());
    if (started) setPlaying(false);
  }, [
    makeAssistantTurnContext,
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
    previousStationIndex.current = stationIndex;
  }, [stationIndex]);

  useEffect(() => {
    if (stationIndex !== 1 || !dataPrepPlaying) return;

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      setDataPrepProgress((value) => {
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
    const duration =
      rideMode === "overview"
        ? OVERVIEW_DURATION_SECONDS
        : LEARN_DURATION_SECONDS;

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

      const stationStep = 1 / ((TRAINING_STATIONS.length - 1) * 3);
      if (event.code === "ArrowRight") {
        event.preventDefault();
        setPlaying(false);
        setProgressState((value) => clamp01(value + stationStep));
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        setPlaying(false);
        setProgressState((value) => clamp01(value - stationStep));
      } else if (event.code === "Space") {
        event.preventDefault();
        setPlaying((value) => !value);
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
        setDataPrepPlaying(prepPlaying);
        setDataPrepProgress(clamp01(value));
      },
      setDetailMode: (mode) => setDetailMode(mode),
      getVoice: () => voiceStateRef.current,
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
    (targetId: string | null) => {
      setSpotlightTargetId(targetId);
      if (targetId) {
        // A spotlighted component pauses the ride and becomes the explicit
        // conversation target until the visitor releases it.
        setPlaying(false);
        setAssistantTargetId(targetId);
      } else {
        // Spotlight released: close the hands-free microphone.
        autoListenTargetRef.current = null;
        stopListening();
      }
    },
    [stopListening],
  );

  // As soon as a component is spotlighted (and whenever the guide becomes
  // ready while one is spotlighted), open the microphone so the visitor can
  // simply ask. Semantic VAD ends the turn; follow-up questions reuse the
  // still-open microphone until the spotlight is released.
  useEffect(() => {
    if (!voiceEnabled) {
      autoListenTargetRef.current = null;
      return;
    }
    if (!spotlightTargetId) return;
    if (voiceStatus !== "ready" && voiceStatus !== "listening") return;
    if (autoListenTargetRef.current === spotlightTargetId) return;
    if (startTalking(makeAssistantTurnContext())) {
      autoListenTargetRef.current = spotlightTargetId;
    }
  }, [
    makeAssistantTurnContext,
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
        branchSide={branchSide}
        detailMode={detailMode}
        rideMode={rideMode}
        assistantEnabled={voice.isEnabled}
        assistantStatus={voice.status}
        assistantAudioActivity={assistantAudioActivity}
        assistantTargetId={assistantTargetId}
        assistantTargetLocked={assistantTargetLocked}
        onProgressChange={handleWorldProgress}
        onManualNavigation={beginManualNavigation}
        onNavigationModeChange={setNavigationMode}
        onMachineRoomCueChange={setMachineRoomCue}
        onMovementDiscovered={handleMovementDiscovered}
        onIntroTourChange={setIntroTour}
        onStationChange={setReportedStation}
        onAssistantTargetChange={setAssistantTargetId}
        onAssistantFocusChange={handleAssistantFocusChange}
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
        stations={TRAINING_STATIONS}
        dataPrepProgress={dataPrepProgress}
        dataPrepPlaying={dataPrepPlaying}
        onProgressChange={(value) => {
          setPlaying(false);
          setProgress(value);
        }}
        onPlayingChange={setPlaying}
        onDataPrepProgressChange={(value) => {
          setDataPrepPlaying(false);
          setDataPrepProgress(clamp01(value));
        }}
        onDataPrepPlayingChange={setDataPrepPlaying}
        onDataPrepRestart={() => {
          setDataPrepProgress(0);
          setDataPrepPlaying(true);
        }}
        onRideModeChange={changeRideMode}
        onDetailModeChange={setDetailMode}
        onBranchChange={setBranchSide}
        onRestart={restart}
      />
      <AssistantDock
        enabled={voice.isEnabled}
        status={voice.status}
        targetLabel={assistantTarget.target.label}
        transcript={voice.transcript}
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
      <p className={styles.screenReaderStatus} aria-live="polite">
        {currentStation?.title}. {currentStation?.story}
      </p>
    </main>
  );
}
