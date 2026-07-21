"use client";

import {
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
  transcript: string;
  error?: string | null;
  /**
   * True while a spotlighted exhibit keeps the microphone open hands-free;
   * the dock then invites speaking instead of asking for a held button.
   */
  handsFree?: boolean;
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
  transcript,
  error,
  handsFree = false,
  onEnable,
  onDisable,
  onTalkStart,
  onTalkEnd,
}: AssistantDockProps) {
  const [showKeyEntry, setShowKeyEntry] = useState(false);
  const [temporaryApiKey, setTemporaryApiKey] = useState("");
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
        >
          <span className={styles.guideGem} aria-hidden="true" />
          <span>
            <strong>Meet your guide</strong>
            <small>Point · ask · navigate</small>
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside className={styles.dock} aria-label="Voice guide" data-status={status}>
      <header className={styles.header}>
        <span className={styles.guideGem} aria-hidden="true" />
        <span className={styles.titleBlock}>
          <strong>In-world guide</strong>
          <small>
            {handsFree && status === "listening"
              ? "Listening — ask or direct the lesson"
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

      {transcript ? <p className={styles.transcript}>{transcript}</p> : null}
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
        aria-label="Hold to ask the guide or control the lesson"
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
              : "hold V · try “next chamber”"}
          </small>
        </span>
      </button>
    </aside>
  );
}
