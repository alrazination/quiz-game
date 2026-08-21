/**
 * Quiz Game — Google Sheets bridge.
 *
 * This runs INSIDE Google (Apps Script), not on your computer or GitHub.
 * It is the only thing with permission to read/write your Sheet. The
 * Cloudflare Worker calls it over plain HTTPS with a shared secret —
 * no Google credentials ever leave Google's servers.
 *
 * SETUP (see README.md "Google Sheets integration" for the full walkthrough):
 *  1. Open your Google Sheet -> Extensions -> Apps Script.
 *  2. Paste this whole file in, replacing the default content.
 *  3. Set SHARED_SECRET below to a long random string (you'll reuse this
 *     exact value in Cloudflare's SHEETS_SHARED_SECRET secret).
 *  4. Deploy -> New deployment -> type "Web app".
 *       - Execute as: Me
 *       - Who has access: Anyone
 *  5. Copy the Web app URL -> that's your SHEETS_WEBAPP_URL for Cloudflare.
 *
 * Players are NOT pre-registered here. They join live by typing their name
 * — the game writes their name into the Participants tab automatically
 * (in small batches, not one call per join) so you end up with a live log
 * of everyone who played, without you having to prepare anything in advance.
 */

const SHARED_SECRET = 'REPLACE_WITH_A_LONG_RANDOM_STRING';

function doGet(e) {
  if (e.parameter.secret !== SHARED_SECRET) {
    return jsonResponse({ error: 'unauthorized' });
  }

  if (e.parameter.action === 'getQuestions') {
    return jsonResponse({ questions: readSheet_('Questions') });
  }
  return jsonResponse({ error: 'unknown action' });
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.secret !== SHARED_SECRET) {
    return jsonResponse({ error: 'unauthorized' });
  }

  if (body.action === 'addParticipants') {
    appendParticipants_(body.players);
    return jsonResponse({ ok: true });
  }
  if (body.action === 'saveResults') {
    writeResults_(body.results);
    return jsonResponse({ ok: true });
  }
  return jsonResponse({ error: 'unknown action' });
}

// Reads a sheet's rows into an array of plain objects keyed by header row.
function readSheet_(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const rows = values.slice(1).filter((row) => row.some((cell) => cell !== ''));
  return rows.map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

// Appends a batch of newly-joined players to the Participants tab.
// Columns: name | joined_at
function appendParticipants_(players) {
  if (!players || players.length === 0) return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Participants');
  ensureHeader_(sheet, ['name', 'joined_at']);
  const rows = players.map((p) => [p.name, p.joined_at]);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
}

// Overwrites the Results tab with the final leaderboard.
// Columns: rank | name | score
function writeResults_(results) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Results');
  sheet.clearContents();
  sheet.appendRow(['rank', 'name', 'score']);
  results.forEach((r) => {
    sheet.appendRow([r.rank, r.name, r.score]);
  });
}

function ensureHeader_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
}

function jsonResponse(obj) {
  const output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
