'use strict';

const mDomainLogParser = require('./log-parser');
const LIFETIME_SOURCE = { 'amber-echo': 'amber', essence: 'essence' };

/** Multiple startup log lines describe one login; reset again only after two minutes. */
function loginResetDue(lastSeen, now) { return now - lastSeen > 120000; }

/** Apply quantities, source/direction filters, countdowns, and independent collection slots. */
function applyResourceEvent(resourceTrackers, line) {
  const eventMatch = line.match(mDomainLogParser.EVENT_LINE_PATTERN);
  if (!eventMatch) return false;
  const source = eventMatch[1].toLowerCase();
  const direction = eventMatch[2].toLowerCase();
  const sign = direction === 'lost' ? -1 : 1;

  // Pull every token on the line together with whether it carried the (1*)
  // star-quality flag, same method weeklyScan uses - needed for cards like
  // Sashimi that only care about star-quality catches (starOnly: true).
  const found = [];
  const TOKEN_WITH_STAR = /(itemtype_[a-z0-9_]+)(\s*\(([0-9]+)\*\))?/gi;
  let starMatch;
  while ((starMatch = TOKEN_WITH_STAR.exec(line)) !== null) {
    found.push({ token: starMatch[1].toLowerCase(), star: Boolean(starMatch[2]) });
  }

  let changed = false;
  for (const card of resourceTrackers.cards) {
    // Lifetime cards mirror live.resources; the existing reader already owns
    // those numbers. Counting them here too would double them.
    if (card.mode === 'lifetime' && LIFETIME_SOURCE[card.id]) continue;
    // Countdown cards (Fish Stew, Sashimi) only move on their one declared
    // direction - e.g. only "lost" (fish consumed cooking), never "gained"
    // (fish caught). Without this, catching more Eldershark would wrongly
    // refill the count.
    if (card.direction && card.direction !== direction) continue;
    // Opt-in per-card source filter (added 2026-09-17 for the fishing-catch
    // trackers). EVENT_LINE_PATTERN treats "Inventory" and "Lockbox" lines as
    // equally real per the house rule table, but reading Baby's own logs
    // showed Eldershark's "Lockbox gained/lost" lines are actually periodic
    // full-lockbox-content dumps (a giant line mixing dozens of unrelated
    // decor items with a fish count that repeats the exact same value many
    // times in a row, e.g. "x61" eighteen times identically on 2026-09-16) -
    // the same "resync mistaken for a delta" bug shape as old Sashimi/Fish
    // Stew, just on Lockbox instead of Primary. A card can set
    // 'eventSource': 'inventory' to only count real "Inventory gained/lost"
    // lines and ignore Lockbox entirely. Omitted (the default for every
    // existing card) means "either source", unchanged from before.
    if (card.eventSource && card.eventSource !== source) continue;
    for (const token of card.tokens || []) {
      const qty = mDomainLogParser.quantityFor(line, token);
      if (!qty) continue;
      if (card.starOnly) {
        const hit = found.find(f => f.token === token.toLowerCase());
        if (!hit || !hit.star) continue;
      }
      // 'countEvents' counts one PER LOG LINE regardless of the stack size on
      // it - same meaning as the secondary-count flag below. Sashimi uses
      // this (redone 2026-09-06): a real cook produces a batch of 3 Sashimi
      // in one 'Inventory gained: itemtype_c_sashimi (1*) x3' line, but Baby
      // wants the countdown to drop by 1 per cook, not by 3.
      const amount = card.countEvents ? 1 : qty;
      // 'countdown' mode always SUBTRACTS on a qualifying, direction-filtered
      // match, regardless of the log line's natural gained(+)/lost(-) sign -
      // "countdown" means "this pool shrinks when its one watched event
      // fires," and which event that is is entirely decided by `direction`
      // above. (Fish Stew/the old Sashimi design used direction:"lost", where
      // the natural sign was already -1, so this was previously invisible;
      // the new Sashimi design watches a "gained" line instead and still
      // needs to count DOWN, which is why this is now explicit rather than
      // riding on the sign.)
      if (card.mode === 'countdown') {
        card.count = Math.max(0, card.count - amount);
      } else {
        card.count = Math.max(0, card.count + (sign * amount));
      }
      changed = true;
    }
  }

  // A card's optional secondary count (e.g. Ramen Plush's "Ramen Cooked" count
  // riding alongside its Plushies count) is scanned independently of the
  // primary loop above - it has its own tokens and its own direction filter,
  // and is never affected by the primary card's `direction`/`starOnly` rules.
  for (const card of resourceTrackers.cards) {
    if (!card.secondary) continue;
    const wantDirection = card.secondary.direction;
    if (wantDirection && wantDirection !== direction) continue;
    for (const token of card.secondary.tokens || []) {
      const qty = mDomainLogParser.quantityFor(line, token);
      if (!qty) continue;
      // 'countEvents' counts one PER LOG LINE regardless of the stack size on
      // it - e.g. cooking once hands Baby a batch of 3 Ramen in a single
      // "Inventory gained ... x3" line, but she wants "Ramen Cooked" to count
      // cooking actions (1), not items produced (3). Without this flag a
      // secondary count instead sums the real quantity, same as every
      // primary card count does.
      const amount = card.secondary.countEvents ? 1 : qty;
      card.secondaryCount = Math.max(0, (card.secondaryCount || 0) + (sign * amount));
      changed = true;
    }
  }

  // Multi-slot 'collection' cards (e.g. Queen Ushindi Collection) track
  // several independent materials on one card, each with its own tokens and
  // its own spot on the art - scanned the same way the primary loop above
  // scans a normal card's tokens, just once per slot instead of once per
  // card. Default is net gained-minus-lost (no direction filter), same as
  // Queen Ushindi - but a card can set a top-level `direction` (reusing the
  // same field an ordinary card uses) to restrict EVERY slot on it to only
  // that one direction. Long Tracker uses `direction: "gained"` so all five
  // materials (including Bugs) are a lifetime "total ever gained" that never
  // decrements when something is lost/sold/turned in, per Baby's choice.
  for (const card of resourceTrackers.cards) {
    if (!Array.isArray(card.slots)) continue;
    if (card.direction && card.direction !== direction) continue;
    if (card.eventSource && card.eventSource !== source) continue; // 2026-10-01, Pumpkin Rockhopper
    for (const slot of card.slots) {
      let qty = 0;
      for (const token of slot.tokens || []) qty += mDomainLogParser.quantityFor(line, token);
      if (slot.tokenPrefix) qty += mDomainLogParser.quantityForPrefix(line, slot.tokenPrefix);
      if (!qty) continue;
      slot.count = Math.max(0, (slot.count || 0) + (sign * qty));
      changed = true;
    }
  }
  return changed;
}

/** Session resets preserve an undo snapshot only when a nonzero count would be lost. */
function resetResourceSession(resourceTrackers, reason, at = Date.now()) {
  const previous = {};
  let any = false;
  for (const card of resourceTrackers.cards) {
    if (card.mode !== 'session') continue;
    previous[card.id] = card.count;
    if (card.count) any = true;
    card.count = 0;
  }
  // Only offer undo when there was something to lose.
  resourceTrackers.previous = any ? previous : {};
  resourceTrackers.lastResetAt = new Date(at).toISOString();
  resourceTrackers.lastResetReason = reason;

}

/** Undo one reset without modifying lifetime, countdown, or secondary progress. */
function undoResourceReset(resourceTrackers) {
  const previous = resourceTrackers.previous || {};
  if (!Object.keys(previous).length) return false;
  for (const card of resourceTrackers.cards) {
    if (card.mode !== 'session') continue;
    if (Number.isFinite(Number(previous[card.id]))) card.count = Number(previous[card.id]);
  }
  resourceTrackers.previous = {};

  return true;
}

module.exports = { LIFETIME_SOURCE, loginResetDue, applyResourceEvent, resetResourceSession, undoResourceReset };
