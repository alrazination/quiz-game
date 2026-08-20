import type {
  Participant, Question, GameStatus, PlayerScoreRecord, LeaderboardEntry,
  ServerToPlayerMessage, PlayerToServerMessage, ServerToHostMessage, HostToServerMessage,
} from './types';
import { calculateScore } from './scoring';
import { fetchParticipants, fetchQuestions, saveResults } from './sheets';

interface Env {
  SHEETS_WEBAPP_URL: string;
  SHEETS_SHARED_SECRET: string;
  HOST_PASSWORD: string;
  EVENT_NAME: string;
}

interface ConnMeta {
  role: 'player' | 'host';
  player_code?: string;
}

// One instance of this class = the entire live event. Every phone and the
// host screen connect to the SAME instance, so there is exactly one source
// of truth for the question, the clock, and every score.
export class GameRoom {
  state: DurableObjectState;
  env: Env;

  participants: Map<string, Participant> = new Map();
  questions: Question[] = [];
  scores: Map<string, PlayerScoreRecord> = new Map();

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

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get<{
        participants: [string, Participant][];
        questions: Question[];
        scores: [string, PlayerScoreRecord][];
        status: GameStatus;
        currentQuestionIndex: number;
      }>('game');
      if (saved) {
        this.participants = new Map(saved.participants);
        this.questions = saved.questions;
        this.scores = new Map(saved.scores);
        this.status = saved.status;
        this.currentQuestionIndex = saved.currentQuestionIndex;
        // If the object restarted mid-question, don't strand it: fall back
        // to WAITING rather than resuming a countdown with no timer.
        if (this.status === 'QUESTION_ACTIVE') this.status = 'QUESTION_FINISHED';
      }
    });
  }

  async persist() {
    await this.state.storage.put('game', {
      participants: Array.from(this.participants.entries()),
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
    const code = (url.searchParams.get('code') || '').trim().toUpperCase();
    const participant = this.participants.get(code);

    if (!participant || !participant.active) {
      return new Response('Invalid or inactive player code', { status: 403 });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();

    // Enforce single active session per player code.
    const existing = this.playerSockets.get(code);
    if (existing) {
      try { existing.close(4001, 'Replaced by new connection'); } catch {}
      this.connections.delete(existing);
    }

    this.connections.set(server, { role: 'player', player_code: code });
    this.playerSockets.set(code, server);

    if (!this.scores.has(code)) {
      this.scores.set(code, {
        player_code: code,
        name: participant.name,
        team: participant.team,
        score: 0,
        answers: {},
      });
    }

    server.addEventListener('message', (ev) => this.onPlayerMessage(server, code, ev));
    server.addEventListener('close', () => this.onPlayerDisconnect(server, code));
    server.addEventListener('error', () => this.onPlayerDisconnect(server, code));

    this.sendToPlayer(server, { type: 'joined', name: participant.name, team: participant.team });
    this.sendCurrentStateToPlayer(server, code);
    this.broadcastPlayerCountToHosts();

    return new Response(null, { status: 101, webSocket: client });
  }

  onPlayerDisconnect(ws: WebSocket, code: string) {
    this.connections.delete(ws);
    if (this.playerSockets.get(code) === ws) {
      this.playerSockets.delete(code);
    }
    this.broadcastPlayerCountToHosts();
    // Nothing else to do: score & answers are preserved in this.scores,
    // keyed by player_code, so reconnecting restores everything.
  }

  onPlayerMessage(ws: WebSocket, code: string, ev: MessageEvent) {
    let msg: PlayerToServerMessage;
    try { msg = JSON.parse(ev.data as string); } catch { return; }

    if (msg.type === 'submit_answer') {
      this.handleAnswer(code, msg.questionNumber, msg.choice);
    }
  }

  handleAnswer(code: string, questionNumber: number, choice: 'A' | 'B' | 'C' | 'D') {
    if (this.status !== 'QUESTION_ACTIVE' || this.paused) return;
    const q = this.questions[this.currentQuestionIndex];
    if (!q || q.question_number !== questionNumber) return; // stale/late message
    if (this.currentAnswers.has(code)) return; // only first answer counts

    // SERVER determines the time — never trust anything the phone sends.
    const atMs = Date.now();
    this.currentAnswers.set(code, { choice, atMs });

    const ws = this.playerSockets.get(code);
    if (ws) this.sendToPlayer(ws, { type: 'answer_received' });
  }

  sendCurrentStateToPlayer(ws: WebSocket, code: string) {
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
      if (this.currentAnswers.has(code)) {
        this.sendToPlayer(ws, { type: 'answer_received' });
      }
    } else if (this.status === 'FINAL_RESULTS') {
      this.sendFinalToOnePlayer(code);
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
      case 'show_leaderboard': this.status = 'SHOWING_LEADERBOARD'; this.persist(); this.broadcastLeaderboard(); break;
      case 'show_final_results': this.endGame(); break;
    }
  }

  // ---------------- Host actions ----------------

  async loadDataFromSheet() {
    try {
      const [participants, questions] = await Promise.all([
        fetchParticipants(this.env.SHEETS_WEBAPP_URL, this.env.SHEETS_SHARED_SECRET),
        fetchQuestions(this.env.SHEETS_WEBAPP_URL, this.env.SHEETS_SHARED_SECRET),
      ]);
      this.participants = new Map(participants.map((p) => [p.player_code.toUpperCase(), p]));
      this.questions = questions;
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
      ok: this.questions.length > 0 && this.participants.size > 0,
      details: {
        sheetAccessible,
        questionsLoaded: this.questions.length,
        participantsLoaded: this.participants.size,
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

    for (const [socket] of this.connections) {
      const meta = this.connections.get(socket);
      if (meta?.role === 'player') {
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

    for (const [code, ans] of this.currentAnswers.entries()) {
      const isCorrect = ans.choice === q.correct_answer;
      answerCounts[ans.choice]++;
      const responseTimeMs = ans.atMs - this.questionStartedAtMs;
      const points = calculateScore(isCorrect, responseTimeMs, q.time_limit_seconds);
      const record = this.scores.get(code);
      if (!record) continue;
      record.score += points;
      record.answers[q.question_number] = {
        choice: ans.choice, correct: isCorrect, points, response_time_ms: responseTimeMs,
      };
    }

    this.status = 'QUESTION_FINISHED';
    this.persist();

    for (const [socket, meta] of this.connections) {
      if (meta.role !== 'player' || !meta.player_code) continue;
      const record = this.scores.get(meta.player_code);
      const ans = this.currentAnswers.get(meta.player_code);
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
    this.broadcastLeaderboard();
  }

  endGame() {
    this.clearTimers();
    this.status = 'FINAL_RESULTS';
    this.persist();

    const top50 = this.computeLeaderboard(50);
    for (const [socket, meta] of this.connections) {
      if (meta.role === 'player' && meta.player_code) this.sendFinalToOnePlayer(meta.player_code, socket);
    }
    for (const ws of this.hostSockets) {
      this.sendToHost(ws, { type: 'final_results', top3: top50.slice(0, 3), top50 });
    }
    saveResults(this.env.SHEETS_WEBAPP_URL, this.env.SHEETS_SHARED_SECRET, top50).catch((e) =>
      console.error('saveResults failed (scores remain safe in the Durable Object)', e)
    );
  }

  restartGame() {
    this.clearTimers();
    this.scores = new Map(
      Array.from(this.participants.values()).map((p) => [
        p.player_code, { player_code: p.player_code, name: p.name, team: p.team, score: 0, answers: {} },
      ])
    );
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
  }

  // ---------------- Leaderboard / broadcast helpers ----------------

  computeLeaderboard(limit: number): LeaderboardEntry[] {
    const sorted = Array.from(this.scores.values()).sort((a, b) => b.score - a.score);
    return sorted.slice(0, limit).map((r, i) => ({
      rank: i + 1, player_code: r.player_code, name: r.name, team: r.team, score: r.score,
    }));
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
      if (meta.role === 'player' && meta.player_code) this.sendCurrentStateToPlayer(socket, meta.player_code);
    }
  }

  sendFinalToOnePlayer(code: string, socketOverride?: WebSocket) {
    const ws = socketOverride ?? this.playerSockets.get(code);
    if (!ws) return;
    const top50 = this.computeLeaderboard(50);
    const mine = Array.from(this.scores.values()).sort((a, b) => b.score - a.score)
      .findIndex((r) => r.player_code === code);
    const record = this.scores.get(code);
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
