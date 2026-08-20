import { useCallback, useState } from 'react';
import { useSocket } from '../lib/useSocket';
import { PLAYER_WS_URL, EVENT_NAME_FALLBACK } from '../config';
import type { ServerToPlayerMessage, Choice, GameStatus } from '../types';

const OPTION_LABELS: Record<Choice, string> = { A: 'A', B: 'B', C: 'C', D: 'D' };
const OPTION_SHAPES: Record<Choice, string> = { A: '\u25B2', B: '\u25C6', C: '\u25CF', D: '\u25A0' };

export function PlayerApp() {
  const [code, setCode] = useState('');
  const [joinedCode, setJoinedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [eventName, setEventName] = useState(EVENT_NAME_FALLBACK);
  const [status, setStatus] = useState<GameStatus>('WAITING');
  const [questionNumber, setQuestionNumber] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [timeLimit, setTimeLimit] = useState(10);
  const [selected, setSelected] = useState<Choice | null>(null);
  const [answered, setAnswered] = useState(false);
  const [reveal, setReveal] = useState<{ correct: Choice; yourChoice: Choice | null; yourPoints: number; yourTotalScore: number } | null>(null);
  const [finalResult, setFinalResult] = useState<{ yourRank: number; yourScore: number } | null>(null);

  const handleMessage = useCallback((msg: ServerToPlayerMessage) => {
    switch (msg.type) {
      case 'joined':
        setPlayerName(msg.name);
        setError(null);
        break;
      case 'error':
        setError(msg.message);
        break;
      case 'state':
        setEventName(msg.eventName);
        setStatus(msg.status);
        setQuestionNumber(msg.questionNumber);
        setTotalQuestions(msg.totalQuestions);
        if (msg.status !== 'QUESTION_ACTIVE') { setSelected(null); setAnswered(false); setReveal(null); }
        break;
      case 'question':
        setStatus('QUESTION_ACTIVE');
        setQuestionNumber(msg.questionNumber);
        setTotalQuestions(msg.totalQuestions);
        setTimeLimit(msg.timeLimitSeconds);
        setSelected(null);
        setAnswered(false);
        setReveal(null);
        break;
      case 'answer_received':
        setAnswered(true);
        break;
      case 'reveal':
        setStatus('QUESTION_FINISHED');
        setReveal(msg);
        break;
      case 'final':
        setStatus('FINAL_RESULTS');
        setFinalResult({ yourRank: msg.yourRank, yourScore: msg.yourScore });
        break;
    }
  }, []);

  const wsUrl = joinedCode ? PLAYER_WS_URL(joinedCode) : null;
  const { send } = useSocket(wsUrl, handleMessage);

  function submitJoin() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setError(null);
    setJoinedCode(trimmed);
  }

  function submitAnswer(choice: Choice) {
    if (answered || status !== 'QUESTION_ACTIVE') return;
    setSelected(choice);
    send({ type: 'submit_answer', questionNumber, choice, clientSentAt: Date.now() });
  }

  // ---- Screen: enter code ----
  if (!joinedCode || (!playerName && !error)) {
    if (!joinedCode) {
      return (
        <div className="screen">
          <div className="player-body">
            <div className="player-header__event">{eventName}</div>
            <div className="status-message">Enter your player code</div>
            <div className="code-form">
              <input
                className="code-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitJoin()}
                placeholder="e.g. A1001"
                autoCapitalize="characters"
                autoCorrect="off"
                inputMode="text"
              />
              <button className="primary-btn" onClick={submitJoin} disabled={!code.trim()}>Join</button>
              {error && <div className="status-message status-message--incorrect" style={{ fontSize: 16 }}>{error}</div>}
            </div>
          </div>
        </div>
      );
    }
    // joined, waiting for server confirmation / handling error
    return (
      <div className="screen">
        <div className="player-body">
          {error ? (
            <>
              <div className="status-message status-message--incorrect">{error}</div>
              <button className="primary-btn" onClick={() => { setJoinedCode(null); setError(null); }}>Try again</button>
            </>
          ) : (
            <div className="status-message status-message--muted">Connecting…</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="player-header">
        <div className="player-header__event">{eventName}</div>
        <div className="player-header__player">Welcome, {playerName}!</div>
        {totalQuestions > 0 && status !== 'FINAL_RESULTS' && (
          <div className="player-header__progress">{questionNumber} / {totalQuestions}</div>
        )}
      </div>

      <div className="player-body">
        {status === 'WAITING' && <div className="status-message status-message--muted">Waiting for the game to start…</div>}

        {status === 'QUESTION_ACTIVE' && !answered && (
          <div className="answer-grid">
            {(['A', 'B', 'C', 'D'] as Choice[]).map((c) => (
              <button
                key={c}
                className={`answer-btn answer-btn--${c.toLowerCase()} ${selected === c ? 'answer-btn--selected' : ''}`}
                onClick={() => submitAnswer(c)}
                disabled={answered}
              >
                <span className="answer-btn__shape">{OPTION_SHAPES[c]}</span>
                {OPTION_LABELS[c]}
              </button>
            ))}
          </div>
        )}

        {status === 'QUESTION_ACTIVE' && answered && (
          <div className="status-message status-message--muted">ANSWER RECEIVED</div>
        )}

        {status === 'QUESTION_FINISHED' && reveal && (
          <>
            <div className={`status-message ${reveal.yourChoice === reveal.correct ? 'status-message--correct' : 'status-message--incorrect'}`}>
              {reveal.yourChoice === null ? 'No answer received' : reveal.yourChoice === reveal.correct ? 'Correct!' : 'Incorrect'}
            </div>
            <div className="score-badge">+{reveal.yourPoints}</div>
            <div className="status-message status-message--muted">Total: {reveal.yourTotalScore.toLocaleString()}</div>
          </>
        )}

        {status === 'SHOWING_LEADERBOARD' && (
          <div className="status-message status-message--muted">Check the main screen for the leaderboard!</div>
        )}

        {status === 'FINAL_RESULTS' && finalResult && (
          <>
            <div className="status-message">Final rank: #{finalResult.yourRank}</div>
            <div className="score-badge">{finalResult.yourScore.toLocaleString()}</div>
            <div className="status-message status-message--muted">Thanks for playing!</div>
          </>
        )}
      </div>
    </div>
  );
}
