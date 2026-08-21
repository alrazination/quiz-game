import type { Question, LeaderboardEntry } from './types';

// The Apps Script web app is the only thing that ever touches the Google
// Sheet. The Worker only knows its URL and a shared secret (never a Google
// credential). This keeps all Google auth out of GitHub and out of the
// frontend entirely.

export async function fetchQuestions(
  sheetsWebAppUrl: string,
  sharedSecret: string
): Promise<Question[]> {
  const res = await fetch(`${sheetsWebAppUrl}?action=getQuestions&secret=${encodeURIComponent(sharedSecret)}`);
  if (!res.ok) throw new Error(`Sheets fetch failed: ${res.status}`);
  const data = await res.json() as { questions: any[] };
  return data.questions
    .map((q) => ({
      question_number: Number(q.question_number),
      question: String(q.question),
      option_a: String(q.option_a),
      option_b: String(q.option_b),
      option_c: String(q.option_c),
      option_d: String(q.option_d),
      correct_answer: String(q.correct_answer).trim().toUpperCase() as 'A' | 'B' | 'C' | 'D',
      time_limit_seconds: Number(q.time_limit_seconds) || 10,
    }))
    .sort((a, b) => a.question_number - b.question_number);
}

// Appends newly-joined player names to the Participants tab, in ONE batch
// call rather than one call per join — this is what keeps 2,000 people
// joining at once from hammering the Sheets API.
export async function appendParticipants(
  sheetsWebAppUrl: string,
  sharedSecret: string,
  players: { name: string; joined_at: string }[]
): Promise<void> {
  if (players.length === 0) return;
  await fetch(sheetsWebAppUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'addParticipants', secret: sharedSecret, players }),
  });
  // Best-effort: if this fails, names simply won't appear in the sheet log.
  // Nothing about live gameplay depends on it.
}

export async function saveResults(
  sheetsWebAppUrl: string,
  sharedSecret: string,
  results: LeaderboardEntry[]
): Promise<void> {
  await fetch(sheetsWebAppUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'saveResults',
      secret: sharedSecret,
      results: results.map((r) => ({ rank: r.rank, name: r.name, score: r.score })),
    }),
  });
  // Best-effort: if this fails after the event, scores are still safe inside
  // the Durable Object and can be re-exported.
}
