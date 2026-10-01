// palia-bridge/bridge-core.js
// Shared parsing + dedup logic for reading Palia's own raw game log
// (LogInventoryComponent lines) and turning them into the same
// "Inventory gained: itemtype_x xN" event lines that Palia Assistant
// used to write, so ICB's server.js can keep reading them unmodified.

'use strict';

// Matches lines like:
// [2026.09.17-23.31.16:029][779]LogInventoryComponent: MULTICAST ITEM ADDED: [FItemInfo Amount=1 ItemType=DA_ItemType_Mineral_Bar_Palium]
// Note: Unreal pads the frame counter with leading spaces (e.g. "[ 53]",
// "[  5]"), so the frame field must tolerate leading whitespace.
const LINE_PATTERN = /^\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})\]\[\s*(\d+)\]LogInventoryComponent:\s*(ITEM RECEIVED|ITEM ADDED|MULTICAST ITEM ADDED):\s*\[FItemInfo Amount=(\d+)\s+ItemType=([^\]]+)\]/;

// DA_ItemType_Currency_Echo_Amber -> itemtype_currency_echo_amber
function tokenFromItemType(itemType) {
  const stripped = itemType.replace(/^DA_ItemType_/i, '');
  return 'itemtype_' + stripped.toLowerCase();
}

// Parse the Unreal timestamp format (2026.09.17-23.31.16:029) into a Date.
function parseTimestamp(ts) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})$/.exec(ts);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, +ms));
}

// Parses one raw log line. Returns null if it's not a relevant inventory line.
function parseLine(line) {
  const m = LINE_PATTERN.exec(line);
  if (!m) return null;
  const [, ts, frame, kind, amountStr, itemType] = m;
  return {
    timestamp: ts,
    date: parseTimestamp(ts),
    frame: frame,
    kind: kind, // ITEM RECEIVED | ITEM ADDED | MULTICAST ITEM ADDED
    amount: parseInt(amountStr, 10),
    itemType: itemType,
    token: tokenFromItemType(itemType),
  };
}

// Dedup strategy: a single real event can produce up to 3 broadcast lines
// (ITEM RECEIVED, ITEM ADDED, MULTICAST ITEM ADDED), and for discrete
// crafted/cooked items MULTICAST ITEM ADDED can fire many times more (once
// per UI observer). Continuous currency gains (Echo Amber, Essence) rarely
// go through ITEM RECEIVED/ADDED at all.
//
// IMPORTANT: the frame number is NOT a reliable disambiguator on its own.
// A single real event's burst of broadcast lines can span more than one
// engine frame (observed directly in Baby's own log: one real Sashimi cook
// produced lines at frame 393 AND frame 395, ~30ms apart, all same
// token+amount) - keying on (frame, token, amount) treats that as TWO
// separate real events and double-counts it (this is the bug that made
// Sashimi/Fish Stew/Celebration Cake count down by 2 per cook instead of 1
// once starOnly was removed and these lines started actually matching).
//
// Fix: key on (token, amount) only, and use a tight TIME window instead of
// frame identity to decide "same burst" vs "new real event". Verified
// against real data: a same-event broadcast burst completes within ~30-40ms
// end to end, while the closest two genuinely separate real events sharing
// the exact same token+amount observed in Baby's logs were ~400ms apart
// (three consecutive real Echo Amber pickups of amount 36, at 448/473/508ms
// apart). A 200ms window comfortably merges the former and comfortably
// keeps the latter distinct.
class DedupTracker {
  constructor(windowMs = 200) {
    this.windowMs = windowMs;
    this.seen = new Map(); // key -> lastSeenEpochMs
  }

  key(evt) {
    return evt.token + '|' + evt.amount;
  }

  // Returns true if this event is a NEW real event (should be emitted),
  // false if it's a duplicate broadcast of one already counted.
  observe(evt) {
    const k = this.key(evt);
    const nowMs = evt.date ? evt.date.getTime() : Date.now();
    const last = this.seen.get(k);
    this.seen.set(k, nowMs);
    if (last !== undefined && Math.abs(nowMs - last) <= this.windowMs) {
      return false; // duplicate broadcast of the same real event
    }
    return true;
  }

  // Prune old entries so the map doesn't grow forever during long tailing.
  prune(nowMs, maxAgeMs = 60000) {
    for (const [k, t] of this.seen) {
      if (nowMs - t > maxAgeMs) this.seen.delete(k);
    }
  }
}

// ---------------------------------------------------------------------
// OwnEventClassifier (2026-09-27) - count ONLY Baby's own real gains.
//
// Why: Palia's log is written by her game client, and the client hears
// about inventory changes for EVERY player near her, not just her. Seen in
// her real logs: a group chopping one big tree gives her one "ITEM RECEIVED"
// and then 10+ "MULTICAST ITEM ADDED" lines of the same loot, one per nearby
// player. The old DedupTracker counted any MULTICAST line that wasn't within
// 200ms of an identical one, so busy areas made the trackers count other
// people's stuff (e.g. 9/27 log: 1,282 Ash Wood counted, she earned 325).
//
// What the log tells us (checked against 15 of her real log files):
//  1. "ITEM RECEIVED" is only ever written for HER character.
//  2. Her own account stat "ItemEarned_<id>" (tagged with her account id)
//     is logged right around each RECEIVED line. On a real gain it goes up by
//     exactly the amount (e.g. Ash Wood 5913 -> 5920 for "Amount=7"). When
//     she just moves items (e.g. pulling from storage) RECEIVED still fires
//     but the stat does NOT go up - those are skipped (this was part of why
//     Sashimi sometimes jumped by more than she cooked).
//  3. "ITEM ADDED" confirms the same gain again - ignored (would double).
//  4. "MULTICAST ITEM ADDED" fires for her AND everyone nearby - always
//     ignored. (Checked fishing specifically: the fishing "Finished" lines in
//     the log also fire for other people fishing near her - her own catches
//     all come with a RECEIVED line, so nothing of hers is lost.)
// RECEIVED lines are held for HOLD_MS (log time) so the stat line that
// follows each one has arrived before deciding.
// ---------------------------------------------------------------------
const GENERIC_LINE = /^\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})\]\[\s*\d+\](\w+):\s*(.*)$/;
const INVENTORY_LINE = /^(ITEM RECEIVED|ITEM ADDED|MULTICAST ITEM ADDED):\s*\[FItemInfo Amount=(-?\d+)\s+ItemType=([^\]]+)\]/;
const EARNED_STAT = /Updated value of stat ItemEarned_(\d+) to (\d+) for /;

class OwnEventClassifier {
  constructor(opts = {}) {
    this.holdMs = opts.holdMs || 1500;
    this.lineNo = 0;
    this.pending = [];            // RECEIVED events waiting for their stat line
    this.rcvIdx = [];             // line numbers of every RECEIVED line (recent)
    this.statEvents = [];         // { idx, ms, id, value, prev } for her ItemEarned stat
    this.statVal = new Map();     // stat id -> last value seen
    this.lastLogMs = 0;
    this.stats = { received: 0, movedNotEarned: 0, ignoredMulticast: 0, ignoredAdded: 0 };
  }

  // Feed one raw log line. Nothing is counted here - call flush() after.
  feed(line) {
    const idx = ++this.lineNo;
    const g = GENERIC_LINE.exec(line);
    if (!g) return;
    const date = parseTimestamp(g[1]);
    const ms = date ? date.getTime() : this.lastLogMs;
    if (ms > this.lastLogMs) this.lastLogMs = ms;
    const cat = g[2], msg = g[3];
    if (cat === 'LogAccomplishmentsManager') {
      const s = EARNED_STAT.exec(msg);
      if (s) {
        const value = parseInt(s[2], 10);
        const prev = this.statVal.get(s[1]);
        this.statVal.set(s[1], value);
        this.statEvents.push({ idx, ms, id: s[1], value, prev });
      }
      return;
    }
    if (cat !== 'LogInventoryComponent') return;
    const m = INVENTORY_LINE.exec(msg);
    if (!m) return;
    const amount = parseInt(m[2], 10);
    if (!(amount > 0)) return; // spends/removals (negative) are never "gained"
    const evt = { timestamp: g[1], date, kind: m[1], amount, itemType: m[3], token: tokenFromItemType(m[3]), ms, idx };
    if (evt.kind === 'ITEM ADDED') { this.stats.ignoredAdded++; return; }
    if (evt.kind === 'MULTICAST ITEM ADDED') { this.stats.ignoredMulticast++; return; }
    this.rcvIdx.push(idx);
    this.pending.push(evt);
  }

  // For a RECEIVED line: did her ItemEarned stat go up right after it?
  // Real gain:   stat "to 5913" | RECEIVED x7 | stat "to 5920"   (rises)
  // Moved only:  stat "to 25401" | RECEIVED x30 | (no rise follows)
  // true = earned, false = only moved, null = no stat lines around it
  // (stat logging isn't always active) - unknown is counted.
  _earned(evt) {
    let prevRcv = -Infinity, nextRcv = Infinity;
    for (const i of this.rcvIdx) {
      if (i < evt.idx) prevRcv = i;
      else if (i > evt.idx) { nextRcv = i; break; }
    }
    let pre = null, post = null;
    for (const s of this.statEvents) {
      if (s.idx < evt.idx) {
        if (s.idx > prevRcv && evt.ms - s.ms <= 5) pre = s;
      } else if (s.idx > evt.idx) {
        if (s.idx < nextRcv && s.ms - evt.ms <= 50) post = s;
        break;
      }
    }
    if (post) return post.prev === undefined ? null : post.value > post.prev;
    if (pre) return false;
    return null;
  }

  // Decide held events; returns the ones to count. force=true decides
  // everything now (use when the log has gone quiet).
  flush(force = false) {
    const out = [];
    const cutoff = this.lastLogMs - this.holdMs;
    const keep = [];
    for (const evt of this.pending) {
      if (!force && evt.ms > cutoff) { keep.push(evt); continue; }
      if (this._earned(evt) === false) { this.stats.movedNotEarned++; continue; }
      evt.source = 'received';
      this.stats.received++;
      out.push(evt);
    }
    this.pending = keep;
    this._prune();
    return out;
  }

  _prune() {
    const old = this.lastLogMs - 60000;
    this.statEvents = this.statEvents.filter(s => s.ms >= old);
    const oldestPending = this.pending.length ? this.pending[0].idx : this.lineNo;
    this.rcvIdx = this.rcvIdx.filter(i => i >= oldestPending - 5000);
  }
}

// Formats a deduped event into a synthetic Palia-Assistant-style log line.
// Example: 2026-09-20 02:15:33.123 -05:00 [INF] Inventory gained: itemtype_currency_echo_amber x20
function formatEventLine(evt, tzOffset = '-05:00') {
  const d = evt.date || new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
  return `${stamp} ${tzOffset} [INF] Inventory gained: ${evt.token} x${evt.amount}`;
}

module.exports = {
  LINE_PATTERN,
  tokenFromItemType,
  parseTimestamp,
  parseLine,
  DedupTracker,
  OwnEventClassifier,
  formatEventLine,
};
