#!/usr/bin/env node
/**
 * Simulates many players joining (by name, just like a real phone would)
 * and answering, against your REAL deployed Cloudflare Worker.
 *
 * Usage:
 *   node scripts/simulate.js --url wss://quiz-game-worker.you.workers.dev --players 500
 *
 * --url      Your worker's wss:// URL (same as WORKER_URL in config.ts, but ws->wss)
 * --players  How many simulated players to connect (e.g. 100, 500, 1000, 2000)
 * --answer-delay-ms   Max random delay before each fake player answers (default 4000)
 */
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const URL = arg('url');
const NUM_PLAYERS = parseInt(arg('players', '100'), 10);
const ANSWER_DELAY_MS = parseInt(arg('answer-delay-ms', '4000'), 10);

if (!URL) {
  console.error('Missing --url. Example: node scripts/simulate.js --url wss://quiz-game-worker.you.workers.dev --players 500');
  process.exit(1);
}

let joined = 0, joinFailed = 0, answered = 0, revealed = 0, disconnected = 0;
const startedAt = Date.now();

function connectPlayer(index) {
  const name = `Bot ${String(index + 1).padStart(4, '0')}`;
  const playerId = randomUUID();
  const ws = new WebSocket(`${URL}/connect?role=player&name=${encodeURIComponent(name)}&playerId=${playerId}`);
  let currentQuestion = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'joined') joined++;
    if (msg.type === 'error') { joinFailed++; console.error(`[${name}] join error: ${msg.message}`); }

    if (msg.type === 'question') {
      currentQuestion = msg.questionNumber;
      const delay = Math.random() * ANSWER_DELAY_MS;
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const choice = ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)];
        ws.send(JSON.stringify({ type: 'submit_answer', questionNumber: currentQuestion, choice, clientSentAt: Date.now() }));
        answered++;
      }, delay);
    }

    if (msg.type === 'reveal') revealed++;
  });

  ws.on('close', () => { disconnected++; });
  ws.on('error', () => {});
}

console.log(`Connecting ${NUM_PLAYERS} simulated players to ${URL} ...`);
for (let i = 0; i < NUM_PLAYERS; i++) {
  // Spread connections over a few seconds so it resembles a real crowd,
  // not an instantaneous burst.
  setTimeout(() => connectPlayer(i), Math.floor((i / NUM_PLAYERS) * 4000));
}

const statusInterval = setInterval(() => {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`[${elapsed}s] joined=${joined} joinFailed=${joinFailed} answered=${answered} revealed=${revealed} disconnected=${disconnected}`);
}, 3000);

process.on('SIGINT', () => { clearInterval(statusInterval); process.exit(0); });
