import {
  setRemoteTrainerConnection,
} from "./trainingClient";

export interface ParsedTrainerLink {
  url: string;
  token: string | null;
}

/**
 * Accepts either the full connect link printed by the Colab notebook
 * (…/custom-training#trainer=…&trainerToken=…) or a bare trainer URL with an
 * optional ?trainerToken= query, and extracts the trainer address and token.
 */
export function parseTrainerConnectInput(raw: string): ParsedTrainerLink | null {
  const text = raw.trim();
  if (!text) return null;

  const hashIndex = text.indexOf("#");
  if (hashIndex >= 0) {
    const params = new URLSearchParams(text.slice(hashIndex + 1));
    const url = params.get("trainer");
    if (url) return { url, token: params.get("trainerToken") };
  }

  try {
    const parsed = new URL(text);
    const token = parsed.searchParams.get("trainerToken");
    parsed.searchParams.delete("trainerToken");
    parsed.hash = "";
    return { url: parsed.toString(), token };
  } catch {
    return null;
  }
}

/**
 * Adopts a #trainer=…&trainerToken=… fragment from the current location, then
 * strips it from the address bar so the token never lingers in the URL,
 * history, or anything the user copies. Returns true when a remote trainer
 * connection was adopted.
 */
export function adoptTrainerLinkFromLocation(): boolean {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash.includes("trainer=")) return false;
  const params = new URLSearchParams(hash);
  const url = params.get("trainer");
  if (!url) return false;
  try {
    setRemoteTrainerConnection(url, params.get("trainerToken"));
  } catch {
    return false;
  }
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
  return true;
}
