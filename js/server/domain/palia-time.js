'use strict';

const mDomainValidation = require('./validation');

/** Map real UTC minutes to the 24-hour Palia day, which repeats every real hour. */
function paliaHours(ms) {   // 0..24 decimal Palia hour for a real time
  const d = new Date(ms); const m = d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000;
  return (((6 + (m - 15) / 2.5) % 24) + 24) % 24;
}

/** Normalize alarm labels and clamp clock values while preserving enable/one-time settings. */
function pcCleanAlarm(a, i) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(a.time || '')); const h = m ? Math.min(23, Number(m[1])) : 6, mi = m ? Math.min(59, Number(m[2])) : 0;
  return { id: mDomainValidation.cleanString(a.id).slice(0, 20) || `a${Date.now().toString(36)}${i}`, time: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`,
    label: mDomainValidation.cleanString(a.label).slice(0, 80), icon: mDomainValidation.cleanString(a.icon).slice(0, 8), on: a.on !== false, once: !!a.once, until: Number(a.until) || 0 };
}

/** Schedule the next Palia clock occurrence; an exact match waits until the following day. */
function pcUntil(time, from) {   // real ms epoch of the next time the Palia clock shows HH:MM
  const [h, m] = time.split(':').map(Number), now = paliaHours(from);
  let dh = ((h + m / 60) - now + 24) % 24; if (dh < 1 / 240) dh += 24;
  return from + dh * 2.5 * 60000;
}

Object.assign(exports, { pcCleanAlarm, pcUntil, paliaHours });
