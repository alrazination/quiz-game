import { GameRoom } from './game';

export { GameRoom };

interface Env {
  GAME_ROOM: DurableObjectNamespace;
  SHEETS_WEBAPP_URL: string;
  SHEETS_SHARED_SECRET: string;
  HOST_PASSWORD: string;
  EVENT_NAME: string;
}

// Everyone connects to the SAME Durable Object instance (one event = one
// room). This fixed name is arbitrary — it just has to be consistent.
const ROOM_NAME = 'main-event';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/connect') {
      const id = env.GAME_ROOM.idFromName(ROOM_NAME);
      const stub = env.GAME_ROOM.get(id);
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  },
};
