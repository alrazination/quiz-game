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
 */

const SHARED_SECRET = 'REPLACE_WITH_A_LONG_RANDOM_STRING';

function doGet(e) {
  if (e.parameter.secret !== SHARED_SECRET) {
    return jsonResponse({ error: 'unauthorized' }, 403);
  }

  if (e.parameter.action === 'getParticipants') {
    return jsonResponse({ participants: readSheet_('Participants') });
  }
  if (e.parameter.action === 'getQuestions') {
    return jsonResponse({ questions: readSheet_('Questions') });
  }
  return jsonResponse({ error: 'unknown action' }, 400);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.secret !== SHARED_SECRET) {
    return jsonResponse({ error: 'unauthorized' }, 403);
  }

  if (body.action === 'saveResults') {
    writeResults_(body.results);
    return jsonResponse({ ok: true });
  }
  return jsonResponse({ error: 'unknown action' }, 400);
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

// Overwrites the Results tab with the final leaderboard.
function writeResults_(results) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Results');
  sheet.clearContents();
  sheet.appendRow(['rank', 'player_code', 'name', 'team', 'score']);
  results.forEach((r) => {
    sheet.appendRow([r.rank, r.player_code, r.name, r.team, r.score]);
  });
}

/**
 * OPTIONAL — for load testing only. Run this once from the Apps Script
 * editor (select the function name in the toolbar dropdown, click Run) to
 * add SIM0001..SIM(count) rows to Participants, matching what
 * scripts/simulate.js generates automatically when you don't pass --codes.
 * This is entirely browser-based — no local install needed.
 */
function addSimulationParticipants() {
  const count = 2000; // change if you want fewer/more test rows
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Participants');
  const rows = [];
  for (let i = 1; i <= count; i++) {
    const code = 'SIM' + String(i).padStart(4, '0');
    rows.push([code, 'Test Player ' + i, 'Simulated', true]);
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
}

// Run this afterward to remove all SIM rows before the real event.
function removeSimulationParticipants() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Participants');
  const values = sheet.getDataRange().getValues();
  for (let r = values.length - 1; r >= 1; r--) {
    if (String(values[r][0]).startsWith('SIM')) {
      sheet.deleteRow(r + 1);
    }
  }
}

function jsonResponse(obj, status) {
  const output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
