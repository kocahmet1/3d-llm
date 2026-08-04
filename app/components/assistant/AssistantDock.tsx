"use client";

import {
  useEffect,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import styles from "./AssistantDock.module.css";

export type AssistantDockStatus =
  | "off"
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export interface AssistantDockProps {
  enabled: boolean;
  status: AssistantDockStatus;
  targetLabel: string;
  /** Present while the spotlight is presenting a component. */
  processLabel?: string | null;
  processPhaseLabel?: string;
  error?: string | null;
  /**
   * True while a spotlighted exhibit keeps the microphone open hands-free;
   * the dock then invites speaking instead of asking for a held button.
   */
  handsFree?: boolean;
  /**
   * Shows the large "guide is live" coach notice beside the scene right
   * after activation, until the visitor uses the guide or dismisses it.
   */
  activationNoticeVisible?: boolean;
  onDismissActivationNotice?: () => void;
  onEnable: (temporaryApiKey?: string) => void;
  onDisable: () => void;
  onTalkStart: () => void;
  onTalkEnd: () => void;
}

const STATUS_COPY: Record<AssistantDockStatus, string> = {
  off: "Voice guide off",
  connecting: "Opening a private voice link…",
  ready: "Aim at an exhibit, then hold to ask",
  listening: "Listening…",
  thinking: "Thinking about this exhibit…",
  speaking: "Explaining… interrupt anytime",
  error: "Voice guide needs attention",
};

function Waveform({ active }: { active: boolean }) {
  return (
    <span className={styles.waveform} aria-hidden="true">
      {Array.from({ length: 7 }, (_, index) => (
        <span
          key={index}
          className={active ? styles.waveBarActive : undefined}
          style={{ animationDelay: `${index * -78}ms` }}
        />
      ))}
    </span>
  );
}

export function AssistantDock({
  enabled,
  status,
  targetLabel,
  processLabel,
  processPhaseLabel = "REPLAYING",
  error,
  handsFree = false,
  activationNoticeVisible = false,
  onDismissActivationNotice,
  onEnable,
  onDisable,
  onTalkStart,
  onTalkEnd,
}: AssistantDockProps) {
  const [showKeyEntry, setShowKeyEntry] = useState(false);
  const [temporaryApiKey, setTemporaryApiKey] = useState("");
  // Touch screens have no right mouse button; the spotlight hints switch
  // to their tap wording there.
  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarsePointer(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const busy = status === "connecting" || status === "thinking";
  const talking = status === "listening" || status === "speaking";
  const canTalk = enabled && status !== "connecting" && status !== "error";

  const releaseTalk = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onTalkEnd();
  };

  const connectWithTemporaryKey = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const key = temporaryApiKey.trim();
    if (!key) return;
    onEnable(key);
    setTemporaryApiKey("");
    setShowKeyEntry(false);
  };

  if (!enabled) {
    if (showKeyEntry) {
      return (
        <aside
          className={`${styles.dock} ${styles.dockSetup}`}
          aria-label="Connect the voice guide"
        >
          <header className={styles.setupHeader}>
            <span className={styles.guideGem} aria-hidden="true" />
            <span className={styles.titleBlock}>
              <strong>Connect your guide</strong>
              <small>Temporary bring-your-own-key mode</small>
            </span>
          </header>

          <p className={styles.setupCopy}>
            Enter an OpenAI API key for this voice session. It is sent once to
            this site&apos;s session endpoint and is not saved in browser storage.
          </p>

          <form onSubmit={connectWithTemporaryKey}>
            <label className={styles.keyLabel} htmlFor="temporary-openai-key">
              Temporary API key
            </label>
            <input
              id="temporary-openai-key"
              className={styles.keyInput}
              type="password"
              value={temporaryApiKey}
              onChange={(event) => setTemporaryApiKey(event.target.value)}
              placeholder="sk-…"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              minLength={20}
              pattern="sk-[A-Za-z0-9_-]+"
              title="Enter an OpenAI API key beginning with sk-."
              required
              aria-describedby="temporary-key-notice"
            />
            <p id="temporary-key-notice" className={styles.temporaryNotice}>
              Temporary testing only. A server-side key is safer for regular use.
            </p>
            <div className={styles.setupActions}>
              <button
                className={styles.connectButton}
                type="submit"
                disabled={temporaryApiKey.trim().length < 20}
              >
                Connect for this session
              </button>
              <button
                className={styles.serverButton}
                type="button"
                onClick={() => {
                  setTemporaryApiKey("");
                  setShowKeyEntry(false);
                  onEnable();
                }}
              >
                Use configured server key
              </button>
              <button
                className={styles.cancelButton}
                type="button"
                onClick={() => {
                  setTemporaryApiKey("");
                  setShowKeyEntry(false);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </aside>
      );
    }

    return (
      <aside className={`${styles.dock} ${styles.dockCollapsed}`} aria-label="Voice guide">
        <button
          className={styles.enableButton}
          type="button"
          onClick={() => setShowKeyEntry(true)}
          aria-label="Meet your guide"
          title="Meet your guide"
        >
          <span className={styles.guideGem} aria-hidden="true" />
          <span>
            <strong>Meet your guide</strong>
            <small>Point · ask</small>
          </span>
        </button>
      </aside>
    );
  }

  return (
    <>
      {activationNoticeVisible ? (
        <aside
          className={styles.activationNotice}
          role="status"
          aria-live="polite"
        >
          <header className={styles.noticeHeader}>
            <span className={styles.guideGem} aria-hidden="true" />
            <strong>Your guide is live</strong>
            <button
              type="button"
              className={styles.closeButton}
              aria-label="Dismiss guide tip"
              onClick={() => onDismissActivationNotice?.()}
            >
              ×
            </button>
          </header>
          <p className={styles.noticeHeadline}>
            {coarsePointer
              ? "Tap any component to highlight it"
              : "Right-click any component to highlight it"}
          </p>
          <p className={styles.noticeCopy}>
            The guide lifts it into the spotlight and explains what it does.
            {coarsePointer
              ? " Hold the mic button to ask your own questions."
              : " Hold V to ask your own questions. Right-click empty space to release."}
          </p>
        </aside>
      ) : null}
    <aside className={styles.dock} aria-label="Voice guide" data-status={status}>
      <header className={styles.header}>
        <span className={styles.guideGem} aria-hidden="true" />
        <span className={styles.titleBlock}>
          <strong>In-world guide</strong>
          <small>
            {handsFree && status === "listening"
              ? "Listening — ask about this component"
              : handsFree && status === "ready"
                ? "Spotlight ready — ask anytime"
                : STATUS_COPY[status]}
          </small>
        </span>
        <Waveform active={talking || busy} />
        <button
          type="button"
          className={styles.closeButton}
          aria-label="Turn off voice guide"
          onClick={() => {
            setTemporaryApiKey("");
            setShowKeyEntry(false);
            onDisable();
          }}
        >
          ×
        </button>
      </header>

      <div className={styles.targetRow}>
        <span>POINTING AT</span>
        <strong>{targetLabel}</strong>
      </div>
      {processLabel ? (
        <div className={`${styles.targetRow} ${styles.processRow}`}>
          <span>{processPhaseLabel}</span>
          <strong>{processLabel}</strong>
        </div>
      ) : null}

      <p className={styles.spotlightTip}>
        {processLabel || handsFree
          ? coarsePointer
            ? "Tap empty space to release the highlight"
            : "Right-click empty space or press Esc to release"
          : coarsePointer
            ? "Tap a component to highlight it"
            : "Right-click a component to highlight it"}
      </p>

      {error ? <p className={styles.error}>{error}</p> : null}
      {status === "error" ? (
        <button
          type="button"
          className={styles.retryButton}
          onClick={() => {
            onDisable();
            setShowKeyEntry(true);
          }}
        >
          Try another key
        </button>
      ) : null}

      <button
        type="button"
        className={`${styles.talkButton} ${status === "listening" ? styles.talkButtonActive : ""}`}
        disabled={!canTalk}
        aria-label="Hold to ask the guide"
        onPointerDown={(event) => {
          if (!canTalk) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          onTalkStart();
        }}
        onPointerUp={releaseTalk}
        onPointerCancel={releaseTalk}
        onLostPointerCapture={() => {
          if (status === "listening") onTalkEnd();
        }}
        onKeyDown={(event) => {
          if ((event.code === "Space" || event.code === "Enter") && !event.repeat) {
            event.preventDefault();
            onTalkStart();
          }
        }}
        onKeyUp={(event) => {
          if (event.code === "Space" || event.code === "Enter") {
            event.preventDefault();
            onTalkEnd();
          }
        }}
      >
        <span className={styles.micCore} aria-hidden="true" />
        <span>
          <strong>
            {handsFree && (status === "listening" || status === "ready")
              ? "Just speak — no button needed"
              : status === "listening"
                ? "Keep holding…"
                : "Hold to ask"}
          </strong>
          <small>
            {handsFree
              ? "spotlight keeps the microphone open"
              : "hold V · ask about this"}
          </small>
        </span>
      </button>
    </aside>
    </>
  );
}
