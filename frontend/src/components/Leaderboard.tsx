import { useLayoutEffect, useRef } from 'react';
import type { LeaderboardEntry } from '../types';

const MOVE_ICON: Record<LeaderboardEntry['movement'], string> = {
  up: '\u25B2', down: '\u25BC', same: '\u2013', new: 'NEW',
};

// Animates rows sliding to their new position when the leaderboard
// re-sorts (a classic FLIP animation), plus an up/down/new badge per row.
// No animation library needed — just measuring positions before/after.
export function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevTops = useRef<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    const nextTops = new Map<string, number>();
    for (const entry of entries) {
      const el = rowRefs.current.get(entry.player_id);
      if (!el) continue;
      const newTop = el.getBoundingClientRect().top;
      const prevTop = prevTops.current.get(entry.player_id);
      nextTops.set(entry.player_id, newTop);
      if (prevTop !== undefined && prevTop !== newTop) {
        const delta = prevTop - newTop;
        el.style.transition = 'none';
        el.style.transform = `translateY(${delta}px)`;
        // Force layout so the browser registers the starting transform
        // before we animate it away.
        void el.getBoundingClientRect();
        requestAnimationFrame(() => {
          el.style.transition = 'transform 550ms cubic-bezier(0.22, 1, 0.36, 1)';
          el.style.transform = '';
        });
      }
    }
    prevTops.current = nextTops;
  }, [entries]);

  return (
    <div className="leaderboard-list">
      {entries.map((e) => (
        <div
          key={e.player_id}
          ref={(el) => { if (el) rowRefs.current.set(e.player_id, el); else rowRefs.current.delete(e.player_id); }}
          className={`leaderboard-row ${e.rank <= 3 ? 'leaderboard-row--top3' : ''}`}
        >
          <div className="leaderboard-row__rank">#{e.rank}</div>
          <div className={`leaderboard-row__move leaderboard-row__move--${e.movement}`}>{MOVE_ICON[e.movement]}</div>
          <div className="leaderboard-row__name">{e.name}</div>
          <div className="leaderboard-row__score">{e.score.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}
