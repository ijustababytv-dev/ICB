'use strict';

const mHttpBody = require('../http/body');
const mHttpResponse = require('../http/response');
const mGiveawayState = require('../giveaway/state');
const mGiveawayActivity = require('../giveaway/activity');
const mStorage = require('../storage');
const mGiveawayBackups = require('../giveaway/backups');

/** Handle giveaway draws requests; reject unmatched paths. */
async function handleGiveawayDrawsApi(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  // Draws a weighted-random winner. Plushie winners stay in the pool for
  // future draws; Mystery Outfit winners are excluded from future Mystery
  // Outfit draws only (still eligible for Plushie).
  if (pathname === '/api/giveaway/draw' && method === 'POST') {
    const body = await mHttpBody.readBody(req);
    const prize = body.prize === 'mystery-outfit' ? 'mystery-outfit' : (body.prize === 'plushie' ? 'plushie' : null);
    if (!prize) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'prize must be "plushie" or "mystery-outfit".' });

    const pool = [];
    for (const username of Object.keys(mGiveawayState.giveaway.entrants)) {
      const entrant = mGiveawayState.giveaway.entrants[username];
      if (prize === 'mystery-outfit' && entrant.mysteryOutfitWon) continue;
      if (mGiveawayState.isBlocked(username)) continue;
      const tickets = mGiveawayState.entrantTotal(entrant);
      for (let i = 0; i < tickets; i++) pool.push(username);
    }
    if (!pool.length) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'No eligible entrants with tickets for this drawing.' });

    const winnerName = pool[Math.floor(Math.random() * pool.length)];
    const winnerEntrant = mGiveawayState.giveaway.entrants[winnerName];
    if (prize === 'mystery-outfit') winnerEntrant.mysteryOutfitWon = true;
    // Bake in whatever the current custom prize name is right now (Baby,
    // 2026-09-26), so this winner's record keeps it even if the label
    // changes before the next draw. Empty means "use the generic wording".
    const prizeLabel = mGiveawayState.giveaway.display.currentPrizeLabel || '';
    const winnerRecord = { username: winnerName, prize, prizeLabel, tickets: mGiveawayState.entrantTotal(winnerEntrant), at: new Date().toISOString() };
    mGiveawayState.giveaway.winners.push(winnerRecord);
    mGiveawayActivity.logActivity({ type: 'winner', username: winnerName, prize, unicorns: winnerRecord.tickets, poolSize: pool.length });
    mGiveawayState.broadcastGiveaway();
    return mHttpResponse.sendJson(res, 200, { ok: true, winner: winnerRecord });
  }

  if (pathname === '/api/giveaway/draw-test' && method === 'POST') {
    const body = await mHttpBody.readBody(req);
    const prize = body.prize === 'mystery-outfit' ? 'mystery-outfit' : 'plushie';
    mGiveawayState.giveaway.testDraw = { seq: (mGiveawayState.giveaway.testDraw && mGiveawayState.giveaway.testDraw.seq || 0) + 1, prize };
    mGiveawayState.broadcastGiveaway();
    return mHttpResponse.sendJson(res, 200, { ok: true, testDraw: mStorage.clone(mGiveawayState.giveaway.testDraw) });
  }

  // Clears just the Winners Circle history (and the Mystery Outfit "already
  // won" lock, since that's tied to being in the winners list) - everything
  // else (entrants, fluffy unicorn counts, sub info, rates, board text,
  // blocked list) is left alone. Baby (2026-09-27): a way to reset the
  // winners list on its own, e.g. once a day, without touching the rest.
  // Manual only - she presses the button, nothing resets on a timer.
  if (pathname === '/api/giveaway/winners/reset' && method === 'POST') {
    mGiveawayBackups.backupGiveaway('before', 'reset-winners');
    const clearedCount = mGiveawayState.giveaway.winners.length;
    mGiveawayActivity.logActivity({ type: 'winners_reset', count: clearedCount });
    mGiveawayState.giveaway.winners = [];
    for (const username of Object.keys(mGiveawayState.giveaway.entrants)) {
      mGiveawayState.giveaway.entrants[username].mysteryOutfitWon = false;
    }
    mGiveawayState.broadcastGiveaway();
    return mHttpResponse.sendJson(res, 200, { ok: true, cleared: clearedCount });
  }
  return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
}


Object.assign(exports, { handleGiveawayDrawsApi });
