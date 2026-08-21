import { useCallback, useState } from 'react';
import { useSocket } from '../lib/useSocket';
import { HOST_WS_URL, EVENT_NAME_FALLBACK, WORKER_URL } from '../config';
import type { ServerToHostMessage, Choice, GameStatus, LeaderboardEntry, Question } from '../types';
import { QrCode } from '../components/QrCode';
import { CountdownRing } from '../components/CountdownRing';
import { Leaderboard } from '../components/Leaderboard';
import { ConfirmModal } from '../components/ConfirmModal';

const OPT_KEYS: Choice[] = ['A', 'B', 'C', 'D'];

export function HostApp() {
  const [password, setPassword] = useState('');
  const [connectedPassword, setConnectedPassword] = useState<string | null>(null);

  const [eventName, setEventName] = useState(EVENT_NAME_FALLBACK);
  const [status, setStatus] = useState<GameStatus>('NOT_LOADED');
  const [questionNumber, setQuestionNumber] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [connectedPlayers, setConnectedPlayers] = useState(0);

  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [answerCounts, setAnswerCounts] = useState<Record<Choice, number> | null>(null);
  const [top50, setTop50] = useState<LeaderboardEntry[]>([]);

  const [preflight, setPreflight] = useState<ServerToHostMessage extends { type: 'preflight' } ? never : any>(null);
  const [confirmAction, setConfirmAction] = useState<null | 'restart' | 'end'>(null);

  const handleMessage = useCallback((msg: ServerToHostMessage) => {
    switch (msg.type) {
      case 'preflight':
        setPreflight(msg);
        break;
      case 'state':
        setEventName(msg.eventName);
        setStatus(msg.status);
        setQuestionNumber(msg.questionNumber);
        setTotalQuestions(msg.totalQuestions);
        setConnectedPlayers(msg.connectedPlayers);
        break;
      case 'question_started':
        setCurrentQuestion(msg.question);
        setQuestionNumber(msg.questionNumber);
        setTotalQuestions(msg.totalQuestions);
        setSecondsRemaining(msg.question.time_limit_seconds);
        setAnswerCounts(null);
        setStatus('QUESTION_ACTIVE');
        break;
      case 'tick':
        setSecondsRemaining(msg.secondsRemaining);
        break;
      case 'question_ended':
        setAnswerCounts(msg.answerCounts);
        setStatus('QUESTION_FINISHED');
        break;
      case 'leaderboard':
        setTop50(msg.top50);
        setConnectedPlayers(msg.connectedPlayers);
        setStatus('SHOWING_LEADERBOARD');
        break;
      case 'final_results':
        setTop50(msg.top50);
        setStatus('FINAL_RESULTS');
        break;
    }
  }, []);

  const wsUrl = connectedPassword ? HOST_WS_URL(connectedPassword) : null;
  const { connected, send } = useSocket(wsUrl, handleMessage);

  const joinUrl = typeof window !== 'undefined' ? window.location.origin + window.location.pathname.replace(/host\/?$/, '') : '';

  if (!connectedPassword) {
    return (
      <div className="screen">
        <div className="player-body">
          <div className="status-message">Host login</div>
          <div className="code-form">
            <input
              className="code-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Host password"
              onKeyDown={(e) => e.key === 'Enter' && setConnectedPassword(password)}
            />
            <button className="primary-btn" onClick={() => setConnectedPassword(password)} disabled={!password}>Connect</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="host-screen">
      <div className="host-top-bar">
        <div className="host-event-name">{eventName}</div>
        <div className="host-badge">{connected ? `${connectedPlayers.toLocaleString()} players connected` : 'Reconnecting…'}</div>
      </div>

      <div className="host-center">
        {status === 'NOT_LOADED' && <div className="status-message status-message--muted">Load questions & participants to begin.</div>}

        {status === 'WAITING' && (
          <div className="join-panel">
            <QrCode value={joinUrl} size={280} />
            <div>
              <div className="host-question-text" style={{ fontSize: 40 }}>JOIN THE GAME</div>
              <div className="join-code">{joinUrl}</div>
              <div className="host-question-number" style={{ marginTop: 16 }}>Waiting for host to start…</div>
            </div>
          </div>
        )}

        {(status === 'QUESTION_ACTIVE' || status === 'QUESTION_FINISHED') && currentQuestion && (
          <>
            <div className="host-question-number">QUESTION {questionNumber} / {totalQuestions}</div>
            <div className="host-question-text">{currentQuestion.question}</div>
            {status === 'QUESTION_ACTIVE' && <CountdownRing secondsRemaining={secondsRemaining} totalSeconds={currentQuestion.time_limit_seconds} />}
            <div className="host-options-grid">
              {OPT_KEYS.map((k) => {
                const text = currentQuestion[`option_${k.toLowerCase()}` as 'option_a'];
                const isCorrect = status === 'QUESTION_FINISHED' && currentQuestion.correct_answer === k;
                const dim = status === 'QUESTION_FINISHED' && currentQuestion.correct_answer !== k;
                return (
                  <div key={k} className={`host-option host-option--${k.toLowerCase()} ${isCorrect ? 'host-option--correct' : ''} ${dim ? 'host-option--dimmed' : ''}`}>
                    <span>{k}.</span> {text}
                    {status === 'QUESTION_FINISHED' && answerCounts && (
                      <span style={{ marginLeft: 'auto', fontSize: 18 }}>{answerCounts[k]}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {status === 'SHOWING_LEADERBOARD' && (
          <>
            <div className="host-question-text">LIVE LEADERBOARD</div>
            <Leaderboard entries={top50} />
          </>
        )}

        {status === 'FINAL_RESULTS' && (
          <>
            <div className="host-question-text">FINAL RESULTS</div>
            <div className="podium">
              {top50.slice(0, 3).map((p) => (
                <div key={p.player_id} className={`podium-place podium-place--${p.rank}`}>
                  <div className="podium-medal">{p.rank === 1 ? '\u{1F947}' : p.rank === 2 ? '\u{1F948}' : '\u{1F949}'}</div>
                  <div className="podium-name">{p.name}</div>
                  <div className="podium-score">{p.score.toLocaleString()}</div>
                </div>
              ))}
            </div>
            <Leaderboard entries={top50} />
          </>
        )}
      </div>

      <HostControls
        status={status}
        preflight={preflight}
        onLoadData={() => send({ type: 'load_data' })}
        onPreflight={() => send({ type: 'preflight_check' })}
        onStart={() => send({ type: 'start_game' })}
        onNext={() => send({ type: 'start_next_question' })}
        onPause={() => send({ type: 'pause' })}
        onResume={() => send({ type: 'resume' })}
        onShowLeaderboard={() => send({ type: 'show_leaderboard' })}
        onShowFinal={() => send({ type: 'show_final_results' })}
        onRestart={() => setConfirmAction('restart')}
        onEnd={() => setConfirmAction('end')}
      />

      {confirmAction === 'restart' && (
        <ConfirmModal
          message="Restart game? This will erase the current scores."
          confirmLabel="Restart"
          onConfirm={() => { send({ type: 'restart_game' }); setConfirmAction(null); }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === 'end' && (
        <ConfirmModal
          message="End game?"
          confirmLabel="End game"
          onConfirm={() => { send({ type: 'end_game' }); setConfirmAction(null); }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}

function HostControls(props: {
  status: GameStatus;
  preflight: any;
  onLoadData: () => void; onPreflight: () => void; onStart: () => void; onNext: () => void;
  onPause: () => void; onResume: () => void; onShowLeaderboard: () => void; onShowFinal: () => void;
  onRestart: () => void; onEnd: () => void;
}) {
  const { status } = props;
  return (
    <div>
      {props.preflight && status === 'WAITING' && (
        <div className="preflight-list" style={{ marginBottom: 16 }}>
          <div className="preflight-row"><span>Sheet accessible</span><span className={props.preflight.details.sheetAccessible ? 'preflight-ok' : 'preflight-bad'}>{props.preflight.details.sheetAccessible ? '✓' : '✗'}</span></div>
          <div className="preflight-row"><span>Questions loaded</span><span className="preflight-ok">{props.preflight.details.questionsLoaded}</span></div>
          <div className="preflight-row"><span>Overall</span><span className={props.preflight.ok ? 'preflight-ok' : 'preflight-bad'}>{props.preflight.ok ? '✓ READY TO START' : 'NOT READY'}</span></div>
        </div>
      )}
      <div className="host-controls">
        <button className="host-btn" onClick={props.onLoadData}>Load from Sheet</button>
        <button className="host-btn" onClick={props.onPreflight}>Pre-flight check</button>
        <button className="host-btn host-btn--primary" onClick={props.onStart} disabled={status !== 'WAITING' && status !== 'NOT_LOADED'}>Start game</button>
        <button className="host-btn host-btn--primary" onClick={props.onNext} disabled={!(status === 'WAITING' || status === 'QUESTION_FINISHED' || status === 'SHOWING_LEADERBOARD')}>Next question</button>
        <button className="host-btn" onClick={props.onPause} disabled={status !== 'QUESTION_ACTIVE'}>Pause</button>
        <button className="host-btn" onClick={props.onResume} disabled={status !== 'QUESTION_ACTIVE'}>Resume</button>
        <button className="host-btn" onClick={props.onShowLeaderboard} disabled={status !== 'QUESTION_FINISHED'}>Show leaderboard</button>
        <button className="host-btn" onClick={props.onShowFinal} disabled={status === 'NOT_LOADED' || status === 'FINAL_RESULTS'}>Show final results</button>
        <button className="host-btn host-btn--danger" onClick={props.onEnd}>End game</button>
        <button className="host-btn host-btn--danger" onClick={props.onRestart}>Restart game</button>
      </div>
    </div>
  );
}
