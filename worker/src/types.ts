// Shared types used across the Durable Object and Worker.

export interface Question {
  question_number: number;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: 'A' | 'B' | 'C' | 'D';
  time_limit_seconds: number;
}

export type GameStatus =
  | 'NOT_LOADED'      // questions not yet loaded from the sheet
  | 'WAITING'         // ready, players may join, host hasn't started
  | 'QUESTION_ACTIVE'
  | 'QUESTION_FINISHED'   // correct answer is being shown (~5s)
  | 'SHOWING_LEADERBOARD' // leaderboard is being shown (~10s, then stays until Next Question)
  | 'FINAL_RESULTS';

export interface PlayerScoreRecord {
  player_id: string;
  name: string;
  score: number;
  joinedAtMs: number;
  // per-question detail, keyed by question_number
  answers: Record<number, {
    choice: 'A' | 'B' | 'C' | 'D';
    correct: boolean;
    points: number;
    response_time_ms: number;
  }>;
}

export type Movement = 'up' | 'down' | 'same' | 'new';

export interface LeaderboardEntry {
  rank: number;
  player_id: string;
  name: string;
  score: number;
  previousRank: number | null;
  movement: Movement;
}

// ---- Messages: server -> player ----
export type ServerToPlayerMessage =
  | { type: 'joined'; playerId: string; name: string }
  | { type: 'error'; message: string }
  | { type: 'state'; status: GameStatus; questionNumber: number; totalQuestions: number; eventName: string }
  | { type: 'question'; questionNumber: number; totalQuestions: number; timeLimitSeconds: number; startedAtServerTime: number }
  | { type: 'answer_received' }
  | { type: 'reveal'; correct: 'A' | 'B' | 'C' | 'D'; yourChoice: 'A' | 'B' | 'C' | 'D' | null; yourPoints: number; yourTotalScore: number }
  | { type: 'final'; yourRank: number; yourScore: number; top3: LeaderboardEntry[] };

// ---- Messages: player -> server ----
export type PlayerToServerMessage =
  | { type: 'submit_answer'; questionNumber: number; choice: 'A' | 'B' | 'C' | 'D'; clientSentAt: number };

// ---- Messages: server -> host ----
export type ServerToHostMessage =
  | { type: 'preflight'; ok: boolean; details: PreflightDetails }
  | { type: 'state'; status: GameStatus; questionNumber: number; totalQuestions: number; connectedPlayers: number; eventName: string }
  | { type: 'question_started'; question: Question; questionNumber: number; totalQuestions: number; startedAtServerTime: number }
  | { type: 'tick'; secondsRemaining: number }
  | { type: 'question_ended'; correct: 'A' | 'B' | 'C' | 'D'; answerCounts: Record<'A' | 'B' | 'C' | 'D', number> }
  | { type: 'leaderboard'; top50: LeaderboardEntry[]; connectedPlayers: number }
  | { type: 'final_results'; top3: LeaderboardEntry[]; top50: LeaderboardEntry[] };

export interface PreflightDetails {
  sheetAccessible: boolean;
  questionsLoaded: number;
  durableObjectResponding: boolean;
}

// ---- Messages: host -> server ----
export type HostToServerMessage =
  | { type: 'load_data' } // fetch questions from the Google Sheet, cache them
  | { type: 'preflight_check' }
  | { type: 'start_game' }
  | { type: 'start_next_question' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'end_game' }
  | { type: 'restart_game' }
  | { type: 'show_leaderboard' }
  | { type: 'show_final_results' };
