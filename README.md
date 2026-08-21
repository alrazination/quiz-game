# Live Quiz Game

A simple, reliable, mobile-first live quiz for 1,000–2,000 simultaneous players.
Frontend on GitHub Pages, real-time backend on a single Cloudflare Worker +
Durable Object, questions/participants managed in Google Sheets.

This guide needs **nothing installed on your computer** — no Node.js, no Git,
no command line. Everything happens in your browser: you edit files on
GitHub.com directly, and GitHub Actions (GitHub's free cloud "robot") runs
`npm` and `wrangler` for you on its own servers every time you save a change.

> Prefer the command line, or want faster local iteration? The original
> local-CLI instructions still work — see **Appendix: local setup** at the
> bottom. Everything else in this README assumes the browser-only path.

Follow this top to bottom, in order.

---

## 0. Accounts you'll need (all free, all created in a browser)

1. A **GitHub** account: https://github.com/join
2. A free **Cloudflare** account: https://dash.cloudflare.com/sign-up
3. A **Google account** (for Google Sheets — you probably already have one).

---

## 1. Create your GitHub repository and upload the project

1. Go to https://github.com/new
2. Repository name: `quiz-game` (you can pick another name — just remember
   it, you'll need it again in step 5).
3. Set it to **Public** (free GitHub Pages requires a public repo).
4. Click **Create repository**.
5. On the new repo's page, click **uploading an existing file**.
6. Unzip the project on your computer (just to extract the files — no
   install needed, your operating system's built-in "Extract All" / "Unzip"
   does this). Then **drag the whole extracted `quiz-game` folder's
   contents** into the GitHub upload box in your browser. Modern browsers
   preserve the folder structure (`worker/`, `frontend/`, `apps-script/`,
   `scripts/`, `.github/`) when you drop a folder.
7. Scroll down, click **Commit changes**.

From here on, any time this guide says "edit a file," you'll do it by
opening that file on GitHub.com and clicking the **pencil (edit) icon** in
the top right, then **Commit changes** when done — no local editor needed.

---

## 2. Create the Google Sheet

1. Go to https://sheets.new — this creates a new blank spreadsheet.
2. Rename it (e.g. "Quiz Game Data").
3. Create three tabs at the bottom, named **exactly**: `Participants`,
   `Questions`, `Results`.
4. Leave **Participants** empty (just create the tab — no headers needed).
   You don't fill this in ahead of time: as people join the game by typing
   their name on their phone, the game writes each name into this tab for
   you automatically (in small batches, not one row per join, so it stays
   fast even with 2,000 people joining at once).
5. In **Questions**, row 1 (headers):
   `question_number | question | option_a | option_b | option_c | option_d | correct_answer | time_limit_seconds`
   Add 10–15 rows, one per question. `correct_answer` is the letter `A`, `B`,
   `C`, or `D`.
6. Leave **Results** empty for now — the game fills it in automatically
   after the event: `rank | name | score`

---

## 3. Connect the Google Sheet (Apps Script bridge)

This is the piece that lets Cloudflare read/write your Sheet **without** ever
putting a Google credential in GitHub or in the website's code.

1. In your Sheet, click **Extensions → Apps Script**.
2. Delete any starter code in the editor, then paste in the entire contents
   of `apps-script/Code.gs` from this project.
3. Near the top, find:
   ```js
   const SHARED_SECRET = 'REPLACE_WITH_A_LONG_RANDOM_STRING';
   ```
   Replace it with a long random string of your own — e.g. mash your keyboard
   for 30 characters. Save this value; you'll paste it into Cloudflare in a
   moment. Treat it like a password.
4. Click **Save** (disk icon).
5. Click **Deploy → New deployment**.
   - Click the gear icon next to "Select type" → choose **Web app**.
   - Description: anything, e.g. "quiz bridge".
   - Execute as: **Me**.
   - Who has access: **Anyone**.
   - Click **Deploy**.
6. The first time, Google will ask you to authorize the script — click
   through **Authorize access**, choose your Google account, click
   **Advanced → Go to (project name)**, then **Allow**. This is expected;
   it's Google warning you that a script you just wrote can edit your own Sheet.
7. Copy the **Web app URL** shown (looks like
   `https://script.google.com/macros/s/AKfycb.../exec`). Save it — this is
   your `SHEETS_WEBAPP_URL`.

Whenever you edit `Code.gs` later, you must **Deploy → Manage deployments →
edit (pencil) → New version → Deploy** for changes to take effect.

---

## 4. Get your Cloudflare API token and Account ID (browser only)

1. Log into https://dash.cloudflare.com
2. Your **Account ID** is shown on the right side of the main dashboard page
   (or under **Workers & Pages** → any page → "Account ID" in the sidebar).
   Copy it.
3. Go to https://dash.cloudflare.com/profile/api-tokens → **Create Token**.
4. Use the **Edit Cloudflare Workers** template → **Continue to summary** →
   **Create Token**. Copy the token shown (you won't be able to see it
   again — if you lose it, just create a new one).

---

## 5. Add secrets to your GitHub repository

These are never visible in your code — GitHub stores them encrypted and only
your Actions can use them.

1. In your repo, go to **Settings → Secrets and variables → Actions**.
2. Click **New repository secret** and add each of these one at a time:

   | Name | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | the token from step 4.4 |
   | `CLOUDFLARE_ACCOUNT_ID` | the Account ID from step 4.2 |
   | `SHEETS_WEBAPP_URL` | the Apps Script Web app URL from step 3.7 |
   | `SHEETS_SHARED_SECRET` | the exact same random string you put in `Code.gs` |
   | `HOST_PASSWORD` | a password you make up — the host will type this on the host screen at the event |

Optionally, edit `EVENT_NAME` directly in `worker/wrangler.toml` (pencil icon
→ edit → commit) to your event's name.

---

## 6. Deploy the backend (Cloudflare Worker)

This already happened once automatically when you uploaded the files in
step 1, because `.github/workflows/deploy-worker.yml` runs on every push to
`worker/`. But it needed the secrets from step 5 first, so let's re-run it:

1. Go to your repo's **Actions** tab.
2. Click **Deploy backend to Cloudflare** in the left sidebar.
3. Click **Run workflow → Run workflow**.
4. Wait for the green checkmark (about a minute).
5. Click into the finished run → the **Deploy Worker** step → expand it.
   You'll see a line like:
   ```
   https://quiz-game-worker.YOUR-SUBDOMAIN.workers.dev
   ```
   **Copy this URL** — this is your `WORKER_URL`.

---

## 7. Configure and deploy the frontend (GitHub Pages)

1. In your repo, go to **Settings → Pages**. Under "Build and deployment",
   set **Source: GitHub Actions**. (You only do this once.)
2. Open `frontend/src/config.ts` on GitHub.com, click the pencil icon, and set:
   ```ts
   export const WORKER_URL = 'https://quiz-game-worker.YOUR-SUBDOMAIN.workers.dev';
   ```
   (the URL from step 6.5, no trailing slash), then **Commit changes**.
3. Open `frontend/vite.config.ts` and confirm `base` matches your repo name
   exactly, e.g. `base: '/quiz-game/'`. Commit if you changed it.
4. Committing either file automatically triggers **Deploy frontend to
   GitHub Pages** (check the **Actions** tab to watch it run — takes about a
   minute).
5. Once it's green, your site is live at:
   ```
   https://YOUR-GITHUB-USERNAME.github.io/quiz-game/
   ```
   That's the **player** URL (put this on your QR code).
   The **host/projector** screen is the same URL with `#host` at the end:
   ```
   https://YOUR-GITHUB-USERNAME.github.io/quiz-game/#host
   ```

Whenever you edit any file under `frontend/` and commit, it redeploys
automatically — no command to remember.

---

## 8. First test (5–10 phones)

1. Open the host URL (`...#host`) on a laptop, enter your `HOST_PASSWORD`.
2. Click **Load from Sheet** — this pulls your Questions from the Google
   Sheet through the Apps Script bridge and caches them in the Durable
   Object.
3. Click **Pre-flight check**. You should see:
   ```
   ✓ READY TO START
   ```
   If not, it tells you exactly what's missing (sheet not reachable, no
   questions loaded, etc.) — fix that before continuing.
4. On a few phones, open the player URL, scan the QR code shown on the host
   screen, or type it in manually, and type a name to join — no code needed.
5. Click **Start game**, then **Next question**, and confirm: the question
   appears on the host screen, answer buttons appear on phones, submitting
   disables the buttons and shows "ANSWER RECEIVED", the countdown ends, and
   the correct answer is revealed. After ~5 seconds it automatically
   switches to the leaderboard, with rows animating up/down as scores
   change, and stays there until you click **Next question**.
6. Try turning a phone's Wi-Fi off and back on mid-game — it should
   reconnect and keep its score (as long as it's the same phone/browser —
   see note below).
7. When done, click **Restart game** to reset all scores to zero before the
   real event (confirm the dialog).

> **How reconnection works without a code:** the first time someone's phone
> opens the player page, it generates a random ID and stores it in that
> browser (not tied to their name — they could even change how they type
> their name and it's still treated as a new player, so ask people to join
> with a consistent name). Reopening the same URL in the same browser reuses
> that ID and keeps their score. A different phone, or clearing browser
> data, starts fresh.

---

## 9. Load-test with simulated players

This proves the backend holds up **before** 2,000 real people show up — and
it runs on GitHub's servers, not yours. No sheet setup needed — the
simulated players join by name, exactly like a real phone would.

1. In your repo's **Actions** tab, click **Load test** → **Run workflow**.
2. Fill in:
   - **players**: pick 100, 500, 1000, or 2000
   - **worker_url**: your Worker URL from step 6, but starting with `wss://`
     instead of `https://`, e.g. `wss://quiz-game-worker.you.workers.dev`
3. Click **Run workflow**. Meanwhile, open the host screen, **Load from
   Sheet**, **Start game**, and step through questions — watch the connected
   player count and leaderboard update as the simulated players ("Bot 0001",
   "Bot 0002", ...) answer.
4. Afterward, click **Restart game** on the host screen to clear the
   simulated scores before the real event. (The simulated names will also
   show up in your Participants tab — feel free to delete those rows.)

---

## 10. QR code

The host screen generates and displays the QR code automatically (pointing
at your player URL), with the URL printed underneath it — nothing extra to
set up. If you'd like a printed version for signage, take a screenshot of
that section of the host screen, or use any free QR generator with the same
URL, e.g. `https://YOUR-GITHUB-USERNAME.github.io/quiz-game/`.

---

## 11. Running the real event

1. Arrive early. Open the host screen (in any browser — nothing to install)
   on the laptop connected to the projector, log in with the host password.
2. **Load from Sheet**, then **Pre-flight check** — confirm ✓ READY TO START.
3. Display the host screen (join screen + QR code) while people arrive,
   scan in, and type their name on their phones — no codes to hand out.
4. Watch the connected-player count climb.
5. **Start game**, then **Next question** for each question, in order. After
   each question ends, the correct answer shows automatically for ~5
   seconds, then the leaderboard appears on its own with rows animating to
   their new positions — no button needed for that part. When you're ready,
   click **Next question** again.
6. After the last question, **Show final results** — this reveals the
   podium, shows the Top 50, and saves final standings to the **Results**
   tab in your Google Sheet automatically.

If the host laptop crashes: open the host URL on any other laptop, log in
with the same password — the game state lives on Cloudflare, not the
browser, so you pick up exactly where you left off.

---

## Secrets & configuration reference

| Name | Where it's used | Where you get it | Where it goes | Safe to expose? |
|---|---|---|---|---|
| `SHEETS_SHARED_SECRET` | Apps Script + Worker | You make it up (long random string) | `Code.gs` (const) **and** GitHub repo secret | **No** — keep private |
| `SHEETS_WEBAPP_URL` | Worker | Apps Script "Deploy" screen | GitHub repo secret | Treat as private (it's unauthenticated without the shared secret, but don't publish it) |
| `HOST_PASSWORD` | Worker, typed into host screen at event time | You make it up | GitHub repo secret | **No** — this gates the host controls |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions, to deploy | Cloudflare dashboard → API Tokens | GitHub repo secret | **No** — keep private |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions, to deploy | Cloudflare dashboard | GitHub repo secret | Not sensitive, but no reason to publish it |
| `EVENT_NAME` | Worker | You choose | `worker/wrangler.toml` `[vars]` | Yes, it's just a display label |
| `WORKER_URL` | Frontend | Printed in the Actions log after "Deploy backend to Cloudflare" | `frontend/src/config.ts` | Yes — this is public, players' phones must know it |

GitHub repo secrets (Settings → Secrets and variables → Actions) are
encrypted, never shown again after you save them, and are not readable from
your code — only usable inside your own Actions workflows.

Nothing above ever goes into **frontend** code except `WORKER_URL`, which is
meant to be public (it's the address players' phones connect to). No Google
credential and no host password are ever shipped to the browser.

---

## Configuration you might want to tweak

All in one place, no hunting through the codebase:

- **Scoring formula** — `worker/src/scoring.ts` (`MAX_POINTS`, `MIN_POINTS`)
- **Reveal / leaderboard timing** — `worker/src/game.ts` (`REVEAL_DURATION_MS`,
  `LEADERBOARD_DURATION_MS` near the top of the file)
- **Event name** — `worker/wrangler.toml` (`EVENT_NAME`)
- **Question count / timing** — set per-question in the `Questions` sheet
  (`time_limit_seconds`); no code change needed
- **Frontend colors/branding** — `frontend/src/styles.css` (`:root` tokens
  at the top)

---

## How this meets the 2,000-player requirement

- One Durable Object holds the whole event's state in memory — no database
  round-trips during play.
- Phones never poll and never receive the leaderboard; only the host screen
  does. Each phone gets a handful of tiny WebSocket messages per question.
- Google Sheets is only touched twice: once before the game (load) and once
  after (save results) — never during live play, so a shaky Sheets
  connection can't affect gameplay once it's started.
- All timing and correctness checks happen on the server; a phone's clock,
  battery state, or browser quirks can't affect anyone's score.
- Game state lives in the Durable Object, not any one browser — a host
  refresh or laptop swap doesn't restart the game.

## Project structure

```
quiz-game/
├── worker/            Cloudflare Worker + Durable Object (the game engine)
│   ├── src/
│   │   ├── index.ts    entry point / routing
│   │   ├── game.ts      Durable Object: all game logic & WebSocket handling
│   │   ├── scoring.ts   the ONE place the scoring formula lives
│   │   ├── sheets.ts    talks to the Apps Script bridge
│   │   └── types.ts     shared message/data types
│   └── wrangler.toml
├── frontend/           React + Vite, deployed to GitHub Pages
│   └── src/
│       ├── player/PlayerApp.tsx   the phone screen
│       ├── host/HostApp.tsx       the projector screen + controls
│       ├── components/            QR code, countdown ring, leaderboard, modal
│       ├── lib/useSocket.ts       WebSocket connection + auto-reconnect
│       └── config.ts              the ONE place to set WORKER_URL
├── apps-script/Code.gs  the only thing with Google Sheets access
├── scripts/simulate.js  load-test with fake players
├── .github/workflows/   the three Actions that build/deploy/test everything
└── README.md            this file
```

---

## Appendix: local setup (optional)

If you later install Node.js (https://nodejs.org, LTS version) and Git
(https://git-scm.com), you can also run everything from your own machine
instead of relying on GitHub Actions:

```
git clone https://github.com/YOUR-GITHUB-USERNAME/quiz-game.git
cd quiz-game/worker && npm install && npx wrangler login
npx wrangler secret put SHEETS_WEBAPP_URL
npx wrangler secret put SHEETS_SHARED_SECRET
npx wrangler secret put HOST_PASSWORD
npm run deploy

cd ../frontend && npm install && npm run build
npx gh-pages -d dist   # or just push to main and let Actions deploy it

cd ../scripts && npm install
node simulate.js --url wss://quiz-game-worker.you.workers.dev --players 500
```

This is entirely optional — the GitHub Actions workflows in `.github/workflows/`
do the same thing in the cloud, which is the path the rest of this README
uses.
