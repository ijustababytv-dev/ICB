'use strict';

const mDomainResources = require('./resources');

/** Escape literal log tokens before placing them in a matching expression. */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Palia Assistant writes several event families to its log. Only "Inventory"
// and "Lockbox" lines represent an actual incremental gain/loss of one item
// stack. "Primary gained:"/"Primary lost:" lines are periodic full-container
// resyncs (Palia Assistant re-emitting the player's entire current inventory,
// verified against real logs to repeat identically hours apart) and must
// never be scored as deltas, or totals balloon every time a resync fires.
const EVENT_LINE_PATTERN = /\b(Inventory|Lockbox)\s+(gained|lost)\s*:/i;

/** Parse only real Inventory/Lockbox deltas; Primary resync dumps must never inflate totals. */
function lineDelta(line) {
  const eventMatch = line.match(EVENT_LINE_PATTERN);
  if (!eventMatch) return [];
  const sign = eventMatch[2].toLowerCase() === 'lost' ? -1 : 1;

  return Object.entries(mDomainResources.RESOURCE_META).flatMap(([resource, meta]) => {
    // Items can carry an inline quality/rarity marker, e.g. "itemtype_x (1*) x2".
    // The optional group below consumes that marker before the quantity so
    // starred variants are still counted instead of silently missed.
    const pattern = new RegExp(`${escapeRegExp(meta.token)}(?:\\s*\\([^)]*\\))?(?:\\s*(?:x|×|quantity)?\\s*[:=]?\\s*)(\\d+)`, 'i');
    const match = line.match(pattern);
    return match ? [{ resource, amount: sign * Number(match[1]), token: meta.token }] : [];
  });
}


// ---------------------------------------------------------------------------
// LINE QUANTITY HELPER
// Shared by the weekly-accomplishments and resource-tracker scanners.
// ---------------------------------------------------------------------------
function quantityFor(line, token) {
  // Items can carry an inline quality marker: "itemtype_forage_spice_sweetleaves (1*) x2"
  const pattern = new RegExp(`${escapeRegExp(token)}(?:\\s*\\([^)]*\\))?(?:\\s*(?:x|×)?\\s*)(\\d+)`, 'i');
  const match = line.match(pattern);
  return match ? Number(match[1]) : 0;
}

// Like quantityFor, but matches ANY token starting with the given prefix and
// sums every match on the line - e.g. prefix "itemtype_bug_" catches every
// distinct bug species token (each species is its own token in the logs)
// instead of needing one exact token per species. Used by slots that opt in
// via `tokenPrefix` instead of (or alongside) an exact `tokens` list.
function quantityForPrefix(line, prefix) {
  const pattern = new RegExp(`${escapeRegExp(prefix)}[a-z0-9_]*(?:\\s*\\([^)]*\\))?(?:\\s*(?:x|×)?\\s*)(\\d+)`, 'gi');
  let total = 0;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    total += Number(match[1]) || 0;
  }
  return total;
}


Object.assign(exports, { lineDelta, EVENT_LINE_PATTERN, quantityFor, quantityForPrefix, escapeRegExp });
