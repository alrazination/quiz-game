/**
 * ============================================================
 *  SCORING FORMULA — the ONE place to change how points work.
 * ============================================================
 *
 * score = MAX_POINTS * (1 - response_time_seconds / time_limit_seconds)
 * A correct answer always earns at least MIN_POINTS.
 * A wrong answer always earns 0.
 *
 * Example with a 10-second question (MAX_POINTS=1000, MIN_POINTS=100):
 *   1s -> 900   2s -> 800   5s -> 500   8s -> 200   9s/10s -> 100
 */
export const MAX_POINTS = 1000;
export const MIN_POINTS = 100;

export function calculateScore(
  isCorrect: boolean,
  responseTimeMs: number,
  timeLimitSeconds: number
): number {
  if (!isCorrect) return 0;
  const responseTimeSeconds = responseTimeMs / 1000;
  const raw = MAX_POINTS * (1 - responseTimeSeconds / timeLimitSeconds);
  return Math.max(MIN_POINTS, Math.round(raw));
}
