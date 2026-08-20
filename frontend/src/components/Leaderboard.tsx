import type { LeaderboardEntry } from '../types';

export function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="leaderboard-list">
      {entries.map((e) => (
        <div key={e.player_code} className={`leaderboard-row ${e.rank <= 3 ? 'leaderboard-row--top3' : ''}`}>
          <div className="leaderboard-row__rank">#{e.rank}</div>
          <div className="leaderboard-row__name">
            {e.name}
            {e.team && <span className="leaderboard-row__team"> · {e.team}</span>}
          </div>
          <div className="leaderboard-row__score">{e.score.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}
