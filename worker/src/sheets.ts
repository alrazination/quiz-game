import type { Participant, Question, LeaderboardEntry } from './types';

// The Apps Script web app is the only thing that ever touches the Google
// Sheet. The Worker only knows its URL and a shared secret (never a Google
// credential). This keeps all Google auth out of GitHub and out of the
// frontend entirely.

export async function fetchParticipants(
  sheetsWebAppUrl: string,
  sharedSecret: string
): Promise<Participant[]> {
  const res = await fetch(`${sheetsWebAppUrl}?action=getParticipants&secret=${encodeURIComponent(sharedSecret)}`);
  if (!res.ok) throw new Error(`Sheets fetch failed: ${res.status}`);
  const data = await res.json() as { participants: any[] };
  return data.participants.map((p) => ({
    player_code: String(p.player_code).trim(),
    name: String(p.name).trim(),
    team: String(p.team ?? '').trim(),
    active: String(p.active).toUpperCase() === 'TRUE',
  }));
}

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

export async function saveResults(
  sheetsWebAppUrl: string,
  sharedSecret: string,
  results: LeaderboardEntry[]
): Promise<void> {
  await fetch(sheetsWebAppUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'saveResults', secret: sharedSecret, results }),
  });
  // Best-effort: if this fails after the event, scores are still safe inside
  // the Durable Object and can be re-exported (see /admin/export in index.ts).
}
