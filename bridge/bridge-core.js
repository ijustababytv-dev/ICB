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
  formatEventLine,
};
