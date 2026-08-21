import type {
  Question, GameStatus, PlayerScoreRecord, LeaderboardEntry, Movement,
  ServerToPlayerMessage, PlayerToServerMessage, ServerToHostMessage, HostToServerMessage,
} from './types';
import { calculateScore } from './scoring';
import { fetchQuestions, appendParticipants, saveResults } from './sheets';

interface Env {
  SHEETS_WEBAPP_URL: string;
  SHEETS_SHARED_SECRET: string;
  HOST_PASSWORD: string;
  EVENT_NAME: string;
}

interface ConnMeta {
  role: 'player' | 'host';
  player_id?: string;
}

const REVEAL_DURATION_MS = 5000;      // how long the correct answer is shown
const LEADERBOARD_DURATION_MS = 10000; // minimum time the leaderboard is shown
const NAME_MAX_LENGTH = 24;
const PARTICIPANT_FLUSH_INTERVAL_MS = 5000; // batch writes to the Sheet

// One instance of this class = the entire live event. Every phone and the
// host screen connect to the SAME instance, so there is exactly one source
// of truth for the question, the clock, and every score.
export class GameRoom {
  state: DurableObjectState;
  env: Env;

  questions: Question[] = [];
  scores: Map<string, PlayerScoreRecord> = new Map();
  lastLeaderboardRanks: Map<string, number> = new Map(); // for up/down animation

  status: GameStatus = 'NOT_LOADED';
  currentQuestionIndex = -1; // -1 = no question yet
  questionStartedAtMs = 0;
  currentAnswers: Map<string, { choice: 'A' | 'B' | 'C' | 'D'; atMs: number }> = new Map();
  paused = false;

  connections: Map<WebSocket, ConnMeta> = new Map();
  playerSockets: Map<string, WebSocket> = new Map();
  hostSockets: Set<WebSocket> = new Set();

  questionEndTimeout: ReturnType<typeof setTimeout> | null = null;
  tickInterval: ReturnType<typeof setInterval> | null = null;
  revealTimeout: ReturnType<typeof setTimeout> | null = null;

  pendingParticipantWrites: { name: string; joined_at: string }[] = [];
  participantFlushInterval: ReturnType<typeof setInterval> | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get<{
        questions: Question[];
        scores: [string, PlayerScoreRecord][];
        status: GameStatus;
        currentQuestionIndex: number;
      }>('game');
      if (saved) {
        this.questions = saved.questions;
        this.scores = new Map(saved.scores);
        this.status = saved.status;
        this.currentQuestionIndex = saved.currentQuestionIndex;
        // If the object restarted mid-question, don't strand it: fall back
        // to a safe state rather than resuming a countdown with no timer.
        if (this.status === 'QUESTION_ACTIVE') this.status = 'QUESTION_FINISHED';
      }
    });
  }

  async persist() {
    await this.state.storage.put('game', {
      questions: this.questions,
      scores: Array.from(this.scores.entries()),
      status: this.status,
      currentQuestionIndex: this.currentQuestionIndex,
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/connect') {
      const role = url.searchParams.get('role');
      if (role === 'player') return this.handlePlayerConnect(request, url);
      if (role === 'host') return this.handleHostConnect(request, url);
      return new Response('Unknown role', { status: 400 });
    }

    return new Response('Not found', { status: 404 });
  }

  // ---------------- Player connection ----------------

  async handlePlayerConnect(request: Request, url: URL): Promise<Response> {
    const rawName = (url.searchParams.get('name') || '').trim();
    const name = rawName.slice(0, NAME_MAX_LENGTH);
    let playerId = (url.searchParams.get('playerId') || '').trim();

    if (!name) {
      return new Response('Name is required', { status: 400 });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    if (!playerId) {
      playerId = crypto.randomUUID();
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();

    // Enforce single active session per player.
    const existing = this.playerSockets.get(playerId);
    if (existing) {
      try { existing.close(4001, 'Replaced by new connection'); } catch {}
      this.connections.delete(existing);
    }

    this.connections.set(server, { role: 'player', player_id: playerId });
    this.playerSockets.set(playerId, server);

    const isNewPlayer = !this.scores.has(playerId);
    if (isNewPlayer) {
      const uniqueName = this.resolveUniqueName(name);
      this.scores.set(playerId, {
        player_id: playerId,
        name: uniqueName,
        score: 0,
        joinedAtMs: Date.now(),
        answers: {},
      });
      this.queueParticipantWrite(uniqueName);
      this.persist();
    }

    server.addEventListener('message', (ev) => this.onPlayerMessage(server, playerId, ev));
    server.addEventListener('close', () => this.onPlayerDisconnect(server, playerId));
    server.addEventListener('error', () => this.onPlayerDisconnect(server, playerId));

    const record = this.scores.get(playerId)!;
    this.sendToPlayer(server, { type: 'joined', playerId, name: record.name });
    this.sendCurrentStateToPlayer(server, playerId);
    this.broadcastPlayerCountToHosts();

    return new Response(null, { status: 101, webSocket: client });
  }

  // If this name collides with an existing player's name, append " #2",
  // " #3", etc. so the host screen and leaderboard never show two
  // identical-looking rows. Comparison ignores case and any suffix already
  // present, so "sam", "Sam", and "sam #2" are all treated as the same base.
  resolveUniqueName(rawName: string): string {
    const baseOf = (n: string) => {
      const m = n.match(/^(.*) #\d+$/);
      return (m ? m[1] : n).trim().toLowerCase();
    };
    const base = rawName.trim().toLowerCase();
    let count = 0;
    for (const record of this.scores.values()) {
      if (baseOf(record.name) === base) count++;
    }
    return count === 0 ? rawName : `${rawName} #${count + 1}`;
  }

  queueParticipantWrite(name: string) {
    this.pendingParticipantWrites.push({ name, joined_at: new Date().toISOString() });
    if (!this.participantFlushInterval) {
      this.participantFlushInterval = setInterval(() => this.flushParticipantWrites(), PARTICIPANT_FLUSH_INTERVAL_MS);
    }
  }

  async flushParticipantWrites() {
    if (this.pendingParticipantWrites.length === 0) {
      if (this.participantFlushInterval) { clearInterval(this.participantFlushInterval); this.participantFlushInterval = null; }
      return;
    }
    const batch = this.pendingParticipantWrites;
    this.pendingParticipantWrites = [];
    try {
      await appendParticipants(this.env.SHEETS_WEBAPP_URL, this.env.SHEETS_SHARED_SECRET, batch);
    } catch (err) {
      console.error('appendParticipants failed, will not retry this batch', err);
    }
  }

  onPlayerDisconnect(ws: WebSocket, playerId: string) {
    this.connections.delete(ws);
    if (this.playerSockets.get(playerId) === ws) {
      this.playerSockets.delete(playerId);
    }
    this.broadcastPlayerCountToHosts();
    // Nothing else to do: score & answers are preserved in this.scores,
    // keyed by player_id, so reconnecting (same playerId, from localStorage
    // on the same device) restores everything.
  }

  onPlayerMessage(ws: WebSocket, playerId: string, ev: MessageEvent) {
    let msg: PlayerToServerMessage;
    try { msg = JSON.parse(ev.data as string); } catch { return; }

    if (msg.type === 'submit_answer') {
      this.handleAnswer(playerId, msg.questionNumber, msg.choice);
    }
  }

  handleAnswer(playerId: string, questionNumber: number, choice: 'A' | 'B' | 'C' | 'D') {
    if (this.status !== 'QUESTION_ACTIVE' || this.paused) return;
    const q = this.questions[this.currentQuestionIndex];
    if (!q || q.question_number !== questionNumber) return; // stale/late message
    if (this.currentAnswers.has(playerId)) return; // only first answer counts

    // SERVER determines the time — never trust anything the phone sends.
    const atMs = Date.now();
    this.currentAnswers.set(playerId, { choice, atMs });

    const ws = this.playerSockets.get(playerId);
    if (ws) this.sendToPlayer(ws, { type: 'answer_received' });
  }

  sendCurrentStateToPlayer(ws: WebSocket, playerId: string) {
    this.sendToPlayer(ws, {
      type: 'state',
      status: this.status,
      questionNumber: this.currentQuestionIndex + 1,
      totalQuestions: this.questions.length,
      eventName: this.env.EVENT_NAME,
    });

    if (this.status === 'QUESTION_ACTIVE') {
      const q = this.questions[this.currentQuestionIndex];
      this.sendToPlayer(ws, {
        type: 'question',
        questionNumber: q.question_number,
        totalQuestions: this.questions.length,
        timeLimitSeconds: q.time_limit_seconds,
        startedAtServerTime: this.questionStartedAtMs,
      });
      if (this.currentAnswers.has(playerId)) {
        this.sendToPlayer(ws, { type: 'answer_received' });
      }
    } else if (this.status === 'FINAL_RESULTS') {
      this.sendFinalToOnePlayer(playerId);
    }
  }

  // ---------------- Host connection ----------------

  async handleHostConnect(request: Request, url: URL): Promise<Response> {
    const password = url.searchParams.get('password') || '';
    if (password !== this.env.HOST_PASSWORD) {
      return new Response('Invalid host password', { status: 403 });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();

    this.connections.set(server, { role: 'host' });
    this.hostSockets.add(server);

    server.addEventListener('message', (ev) => this.onHostMessage(server, ev));
    server.addEventListener('close', () => { this.connections.delete(server); this.hostSockets.delete(server); });
    server.addEventListener('error', () => { this.connections.delete(server); this.hostSockets.delete(server); });

    this.sendStateToHost(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  onHostMessage(ws: WebSocket, ev: MessageEvent) {
    let msg: HostToServerMessage;
    try { msg = JSON.parse(ev.data as string); } catch { return; }

    switch (msg.type) {
      case 'load_data': this.loadDataFromSheet(); break;
      case 'preflight_check': this.runPreflight(ws); break;
      case 'start_game': this.startGame(); break;
      case 'start_next_question': this.startNextQuestion(); break;
      case 'pause': this.paused = true; this.broadcastStateToHosts(); break;
      case 'resume': this.paused = false; this.broadcastStateToHosts(); break;
      case 'end_game': this.endGame(); break;
      case 'restart_game': this.restartGame(); break;
      case 'show_leaderboard': this.showLeaderboardNow(); break;
      case 'show_final_results': this.endGame(); break;
    }
  }

  // ---------------- Host actions ----------------

  async loadDataFromSheet() {
    try {
      this.questions = await fetchQuestions(this.env.SHEETS_WEBAPP_URL, this.env.SHEETS_SHARED_SECRET);
      this.status = 'WAITING';
      await this.persist();
    } catch (err) {
      // Leave existing cached data (if any) untouched on failure.
      console.error('loadDataFromSheet failed', err);
    }
    for (const ws of this.hostSockets) this.sendStateToHost(ws);
  }

  async runPreflight(ws: WebSocket) {
    let sheetAccessible = true;
    try {
      await fetchQuestions(this.env.SHEETS_WEBAPP_URL, this.env.SHEETS_SHARED_SECRET);
    } catch {
      sheetAccessible = false;
    }
    const msg: ServerToHostMessage = {
      type: 'preflight',
      ok: this.questions.length > 0,
      details: {
        sheetAccessible,
        questionsLoaded: this.questions.length,
        durableObjectResponding: true,
      },
    };
    this.sendToHost(ws, msg);
  }

  startGame() {
    if (this.questions.length === 0) return;
    this.currentQuestionIndex = -1;
    this.status = 'WAITING';
    this.persist();
    this.broadcastStateToHosts();
    this.broadcastStateToPlayers();
  }

  startNextQuestion() {
    if (this.currentQuestionIndex + 1 >= this.questions.length) return;
    this.clearTimers();
    this.currentQuestionIndex += 1;
    this.currentAnswers = new Map();
    this.paused = false;
    this.status = 'QUESTION_ACTIVE';
    this.questionStartedAtMs = Date.now();
    this.persist();

    const q = this.questions[this.currentQuestionIndex];

    for (const [socket, meta] of this.connections) {
      if (meta.role === 'player') {
        this.sendToPlayer(socket, {
          type: 'question',
          questionNumber: q.question_number,
          totalQuestions: this.questions.length,
          timeLimitSeconds: q.time_limit_seconds,
          startedAtServerTime: this.questionStartedAtMs,
        });
      }
    }
    for (const ws of this.hostSockets) {
      this.sendToHost(ws, {
        type: 'question_started',
        question: q,
        questionNumber: q.question_number,
        totalQuestions: this.questions.length,
        startedAtServerTime: this.questionStartedAtMs,
      });
    }

    // Host display tick (cosmetic countdown only — not authoritative).
    let secondsRemaining = q.time_limit_seconds;
    this.tickInterval = setInterval(() => {
      if (this.paused) return;
      secondsRemaining -= 1;
      for (const ws of this.hostSockets) {
        this.sendToHost(ws, { type: 'tick', secondsRemaining: Math.max(0, secondsRemaining) });
      }
      if (secondsRemaining <= 0 && this.tickInterval) {
        clearInterval(this.tickInterval);
        this.tickInterval = null;
      }
    }, 1000);

    // Authoritative end-of-question timer. Also backed by a DO alarm in case
    // the object is evicted mid-question (rare, but this is a live event).
    this.questionEndTimeout = setTimeout(() => this.endQuestion(), q.time_limit_seconds * 1000);
    this.state.storage.setAlarm(Date.now() + q.time_limit_seconds * 1000 + 2000);
  }

  async alarm() {
    // Fallback net: if a timer was lost (object evicted/restarted) but we're
    // still mid-question according to persisted state, end it now.
    if (this.status === 'QUESTION_ACTIVE') this.endQuestion();
  }

  endQuestion() {
    if (this.status !== 'QUESTION_ACTIVE') return;
    this.clearTimers();
    const q = this.questions[this.currentQuestionIndex];
    const answerCounts: Record<'A' | 'B' | 'C' | 'D', number> = { A: 0, B: 0, C: 0, D: 0 };

    for (const [playerId, ans] of this.currentAnswers.entries()) {
      const isCorrect = ans.choice === q.correct_answer;
      answerCounts[ans.choice]++;
      const responseTimeMs = ans.atMs - this.questionStartedAtMs;
      const points = calculateScore(isCorrect, responseTimeMs, q.time_limit_seconds);
      const record = this.scores.get(playerId);
      if (!record) continue;
      record.score += points;
      record.answers[q.question_number] = {
        choice: ans.choice, correct: isCorrect, points, response_time_ms: responseTimeMs,
      };
    }

    // Phase 1: show the correct answer (REVEAL_DURATION_MS).
    this.status = 'QUESTION_FINISHED';
    this.persist();

    for (const [socket, meta] of this.connections) {
      if (meta.role !== 'player' || !meta.player_id) continue;
      const record = this.scores.get(meta.player_id);
      const ans = this.currentAnswers.get(meta.player_id);
      this.sendToPlayer(socket, {
        type: 'reveal',
        correct: q.correct_answer,
        yourChoice: ans?.choice ?? null,
        yourPoints: ans ? (record?.answers[q.question_number]?.points ?? 0) : 0,
        yourTotalScore: record?.score ?? 0,
      });
    }
    for (const ws of this.hostSockets) {
      this.sendToHost(ws, { type: 'question_ended', correct: q.correct_answer, answerCounts });
    }

    // Phase 2: after a pause, automatically switch to the leaderboard.
    this.revealTimeout = setTimeout(() => this.showLeaderboardNow(), REVEAL_DURATION_MS);
  }

  showLeaderboardNow() {
    if (this.revealTimeout) { clearTimeout(this.revealTimeout); this.revealTimeout = null; }
    this.status = 'SHOWING_LEADERBOARD';
    this.persist();
    this.broadcastLeaderboard();
    // The leaderboard stays up for LEADERBOARD_DURATION_MS as a minimum
    // display time, then simply remains until the host clicks Next Question
    // — no need to time out into anything else.
  }

  endGame() {
    this.clearTimers();
    this.status = 'FINAL_RESULTS';
    this.persist();

    const top50 = this.computeLeaderboard(50);
    for (const [socket, meta] of this.connections) {
      if (meta.role === 'player' && meta.player_id) this.sendFinalToOnePlayer(meta.player_id, socket);
    }
    for (const ws of this.hostSockets) {
      this.sendToHost(ws, { type: 'final_results', top3: top50.slice(0, 3), top50 });
    }
    this.flushParticipantWrites().catch(() => {});
    saveResults(this.env.SHEETS_WEBAPP_URL, this.env.SHEETS_SHARED_SECRET, top50).catch((e) =>
      console.error('saveResults failed (scores remain safe in the Durable Object)', e)
    );
  }

  restartGame() {
    this.clearTimers();
    for (const record of this.scores.values()) {
      record.score = 0;
      record.answers = {};
    }
    this.lastLeaderboardRanks = new Map();
    this.currentQuestionIndex = -1;
    this.currentAnswers = new Map();
    this.status = 'WAITING';
    this.paused = false;
    this.persist();
    this.broadcastStateToHosts();
    this.broadcastStateToPlayers();
  }

  clearTimers() {
    if (this.questionEndTimeout) { clearTimeout(this.questionEndTimeout); this.questionEndTimeout = null; }
    if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null; }
    if (this.revealTimeout) { clearTimeout(this.revealTimeout); this.revealTimeout = null; }
  }

  // ---------------- Leaderboard / broadcast helpers ----------------

  computeLeaderboard(limit: number): LeaderboardEntry[] {
    const sorted = Array.from(this.scores.values()).sort((a, b) => b.score - a.score || a.joinedAtMs - b.joinedAtMs);
    const entries = sorted.slice(0, limit).map((r, i): LeaderboardEntry => {
      const rank = i + 1;
      const previousRank = this.lastLeaderboardRanks.get(r.player_id) ?? null;
      let movement: Movement = 'new';
      if (previousRank !== null) {
        movement = previousRank > rank ? 'up' : previousRank < rank ? 'down' : 'same';
      }
      return { rank, player_id: r.player_id, name: r.name, score: r.score, previousRank, movement };
    });
    // Remember ranks for next time's up/down comparison.
    this.lastLeaderboardRanks = new Map(entries.map((e) => [e.player_id, e.rank]));
    return entries;
  }

  broadcastLeaderboard() {
    const top50 = this.computeLeaderboard(50);
    for (const ws of this.hostSockets) {
      this.sendToHost(ws, { type: 'leaderboard', top50, connectedPlayers: this.playerSockets.size });
    }
  }

  broadcastPlayerCountToHosts() {
    for (const ws of this.hostSockets) this.sendStateToHost(ws);
  }

  broadcastStateToHosts() {
    for (const ws of this.hostSockets) this.sendStateToHost(ws);
  }

  broadcastStateToPlayers() {
    for (const [socket, meta] of this.connections) {
      if (meta.role === 'player' && meta.player_id) this.sendCurrentStateToPlayer(socket, meta.player_id);
    }
  }

  sendFinalToOnePlayer(playerId: string, socketOverride?: WebSocket) {
    const ws = socketOverride ?? this.playerSockets.get(playerId);
    if (!ws) return;
    const top50 = this.computeLeaderboard(50);
    const mine = Array.from(this.scores.values()).sort((a, b) => b.score - a.score)
      .findIndex((r) => r.player_id === playerId);
    const record = this.scores.get(playerId);
    this.sendToPlayer(ws, {
      type: 'final', yourRank: mine + 1, yourScore: record?.score ?? 0, top3: top50.slice(0, 3),
    });
  }

  sendStateToHost(ws: WebSocket) {
    this.sendToHost(ws, {
      type: 'state',
      status: this.status,
      questionNumber: this.currentQuestionIndex + 1,
      totalQuestions: this.questions.length,
      connectedPlayers: this.playerSockets.size,
      eventName: this.env.EVENT_NAME,
    });
  }

  sendToPlayer(ws: WebSocket, msg: ServerToPlayerMessage) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }
  sendToHost(ws: WebSocket, msg: ServerToHostMessage) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }
}
