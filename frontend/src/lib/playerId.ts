const STORAGE_KEY = 'quiz_player_id';

// A random ID generated once per device/browser and reused on every
// reconnect, so refreshing the page (or a dropped connection) doesn't
// create a duplicate player or lose the person's score. This never leaves
// the browser except as an opaque identifier — no account, no login.
export function getOrCreatePlayerId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // localStorage unavailable (private browsing etc.) — fall back to a
    // per-session ID; reconnection just won't survive a full page reload.
    return crypto.randomUUID();
  }
}
