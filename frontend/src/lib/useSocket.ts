import { useEffect, useRef, useState, useCallback } from 'react';

// Handles the messy parts of a live-event WebSocket: automatic reconnect
// with backoff, and a simple send() that's safe to call anytime.
export function useSocket<TIncoming>(
  url: string | null,
  onMessage: (msg: TIncoming) => void
) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const attemptRef = useRef(0);
  const closedByUsRef = useRef(false);

  const connect = useCallback(() => {
    if (!url) return;
    closedByUsRef.current = false;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      attemptRef.current = 0;
      setConnected(true);
    };
    ws.onmessage = (ev) => {
      try {
        onMessageRef.current(JSON.parse(ev.data));
      } catch {
        // ignore malformed message
      }
    };
    ws.onclose = () => {
      setConnected(false);
      if (closedByUsRef.current) return;
      const delay = Math.min(5000, 500 * 2 ** attemptRef.current);
      attemptRef.current += 1;
      setTimeout(connect, delay);
    };
    ws.onerror = () => ws.close();
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      closedByUsRef.current = true;
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((msg: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  return { connected, send };
}
