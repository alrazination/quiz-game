// ============================================================
//  CONFIGURATION — edit these, then rebuild & redeploy.
// ============================================================

// Your Cloudflare Worker URL, no trailing slash.
// You'll get this after `wrangler deploy` (Phase: Deploy backend).
export const WORKER_URL = 'https://quiz-game-worker.YOUR-SUBDOMAIN.workers.dev';

// Shown on screen before the server confirms the real event name.
export const EVENT_NAME_FALLBACK = 'Company Quiz Night';

// Derived WebSocket URLs (http -> ws, https -> wss). Don't edit below this line.
export const WS_BASE = WORKER_URL.replace(/^http/, 'ws');
export const PLAYER_WS_URL = (name: string, playerId: string) =>
  `${WS_BASE}/connect?role=player&name=${encodeURIComponent(name)}&playerId=${encodeURIComponent(playerId)}`;
export const HOST_WS_URL = (password: string) => `${WS_BASE}/connect?role=host&password=${encodeURIComponent(password)}`;
