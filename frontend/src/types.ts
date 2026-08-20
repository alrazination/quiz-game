export type Choice = 'A' | 'B' | 'C' | 'D';

export type GameStatus =
  | 'NOT_LOADED' | 'WAITING' | 'QUESTION_ACTIVE' | 'QUESTION_FINISHED'
  | 'SHOWING_LEADERBOARD' | 'FINAL_RESULTS';

export interface LeaderboardEntry {
  rank: number;
  player_code: string;
  name: string;
  team: string;
  score: number;
}

export interface Question {
  question_number: number;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: Choice;
  time_limit_seconds: number;
}

export type ServerToPlayerMessage =
  | { type: 'joined'; name: string; team: string }
  | { type: 'error'; message: string }
  | { type: 'state'; status: GameStatus; questionNumber: number; totalQuestions: number; eventName: string }
  | { type: 'question'; questionNumber: number; totalQuestions: number; timeLimitSeconds: number; startedAtServerTime: number }
  | { type: 'answer_received' }
  | { type: 'reveal'; correct: Choice; yourChoice: Choice | null; yourPoints: number; yourTotalScore: number }
  | { type: 'final'; yourRank: number; yourScore: number; top3: LeaderboardEntry[] };

export type ServerToHostMessage =
  | { type: 'preflight'; ok: boolean; details: { sheetAccessible: boolean; questionsLoaded: number; participantsLoaded: number; durableObjectResponding: boolean } }
  | { type: 'state'; status: GameStatus; questionNumber: number; totalQuestions: number; connectedPlayers: number; eventName: string }
  | { type: 'question_started'; question: Question; questionNumber: number; totalQuestions: number; startedAtServerTime: number }
  | { type: 'tick'; secondsRemaining: number }
  | { type: 'question_ended'; correct: Choice; answerCounts: Record<Choice, number> }
  | { type: 'leaderboard'; top50: LeaderboardEntry[]; connectedPlayers: number }
  | { type: 'final_results'; top3: LeaderboardEntry[]; top50: LeaderboardEntry[] };
