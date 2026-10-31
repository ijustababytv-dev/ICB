'use strict';

const path = require('node:path');
const { URL } = require('node:url');
const mConfig = require('./config');
const mStorage = require('./storage');
const mEvents = require('./events');
const mHttpResponse = require('./http/response');
const mHttpBody = require('./http/body');
const mDomainValidation = require('./domain/validation');
const mDomainPaliaTime = require('./domain/palia-time');

// ---------------------------------------------------------------------------
// PALIA CLOCK (Baby, 2026-10-19). In-game Palia clock + alarms for stream, like
// https://ghervis.github.io/palia-time-notifier/ . Palia time comes straight from the real clock:
// one Palia day = one real hour, one Palia hour = 2.5 real minutes, and it is 6:00 AM in Palia at
// :15 past every real hour (UTC). Same formula as that site (STEADY_DAILY_MINUTE 15, start hour 6).
//   - Overlay /palia-clock.html, dashboard /palia-clock-control.html, data/paliaclock.json.
//   - Alarms fire every Palia day (= every real hour) unless "once"; the overlay shows the banner.
// ---------------------------------------------------------------------------
const PC_FILE = path.join(mConfig.DATA_DIR, 'paliaclock.json');

/** Create independent initial palia clock settings for first-run or missing saved fields. */
function pcDefaults() {
    return {
        visible: true,
        title: 'Palia Time',
        bannerSec: 8,
        sound: true,
        volume: 60,
        alarms: [
            {
                id: 'a1',
                time: '06:00',
                label: 'A new day in Palia!',
                icon: '🌅',
                on: true,
                once: false
            },
            {
                id: 'a2',
                time: '18:00',
                label: 'Evening in Palia',
                icon: '🌇',
                on: false,
                once: false
            },
            { id: 'a3', time: '00:00', label: 'Midnight', icon: '🌙', on: false, once: false }
        ],
        look: {
            theme: 'night',
            scale: 100,
            x: 88,
            y: 8,
            show24h: false,
            showReal: true,
            showNext: true,
            showDayBar: true
        },
        seq: 1
    };
}

/** Restore palia clock state from disk and supply defaults for missing fields. */
function pcLoad() {
    const raw = mStorage.readJson(PC_FILE, null) || {},
        d = pcDefaults();
    return {
        ...d,
        ...raw,
        look: { ...d.look, ...(raw.look || {}) },
        alarms: Array.isArray(raw.alarms) ? raw.alarms : d.alarms
    };
}

let pc = pcLoad(),
    pcEvents = [];
/** Persist operator changes to the palia clock state file. */
function pcSave() {
    mStorage.writeJson(PC_FILE, pc);
    mEvents.broadcast('paliaclock', { ok: true });
}

/** Retire one-time alarms after their occurrence and its display grace period. */
function checkAlarms() {
    // one-time alarms go away once they have rung
    const now = Date.now(),
        before = pc.alarms.length;
    pc.alarms = pc.alarms.filter((a) => !(a.once && a.until && a.until + 15000 < now));
    if (pc.alarms.length !== before) pcSave();
}

/** Validate and dispatch palia clock API requests, returning client errors for invalid input. */
async function handlePaliaClockApi(req, res, pathname, method) {
    try {
        if (pathname === '/api/paliaclock' && method === 'GET') {
            const since = Number(new URL(req.url, 'http://x').searchParams.get('since')) || 0;
            return mHttpResponse.sendJson(res, 200, {
                ok: true,
                ...pc,
                events: pcEvents.filter((e) => e.id > since),
                last: pc.seq - 1,
                now: Date.now()
            });
        }
        if (pathname === '/api/paliaclock' && method === 'POST') {
            const b = await mHttpBody.readBody(req),
                s = b.set || {};
            if (typeof s.title === 'string')
                pc.title = mDomainValidation.cleanString(s.title).slice(0, 40);
            for (const k of ['visible', 'sound']) if (typeof s[k] === 'boolean') pc[k] = s[k];
            if (s.bannerSec !== undefined)
                pc.bannerSec = Math.max(2, Math.min(60, Number(s.bannerSec) || 8));
            if (s.volume !== undefined)
                pc.volume = Math.max(0, Math.min(100, Number(s.volume) || 0));
            if (s.look) {
                const L = pc.look,
                    l = s.look;
                for (const k of ['show24h', 'showReal', 'showNext', 'showDayBar'])
                    if (typeof l[k] === 'boolean') L[k] = l[k];
                for (const [k, lo, hi] of [
                    ['scale', 20, 400],
                    ['x', 0, 100],
                    ['y', 0, 100]
                ])
                    if (l[k] !== undefined && Number.isFinite(Number(l[k])))
                        L[k] = Math.max(lo, Math.min(hi, Number(l[k])));
                if (['night', 'palia', 'pink', 'glass'].includes(l.theme)) L.theme = l.theme;
            }
            if (Array.isArray(b.alarms))
                pc.alarms = b.alarms.slice(0, 40).map(mDomainPaliaTime.pcCleanAlarm);
            if (b.addAlarm) {
                const a = mDomainPaliaTime.pcCleanAlarm(
                    { ...b.addAlarm, id: '' },
                    pc.alarms.length
                );
                if (a.once) a.until = mDomainPaliaTime.pcUntil(a.time, Date.now());
                pc.alarms.push(a);
            }
            if (b.inHours) {
                // quick timer: N Palia hours from now
                const n = Math.max(0.25, Math.min(24, Number(b.inHours.hours) || 1)),
                    at = Date.now() + n * 2.5 * 60000,
                    ph = mDomainPaliaTime.paliaHours(at);
                const t = `${String(Math.floor(ph)).padStart(2, '0')}:${String(
                    Math.floor((ph % 1) * 60)
                ).padStart(2, '0')}`;
                pc.alarms.push(
                    mDomainPaliaTime.pcCleanAlarm(
                        {
                            time: t,
                            label:
                                mDomainValidation.cleanString(b.inHours.label) ||
                                `${n} Palia hour${n === 1 ? '' : 's'} are up!`,
                            icon: '⏰',
                            once: true,
                            until: at,
                            id: ''
                        },
                        pc.alarms.length
                    )
                );
            }
            if (b.removeAlarm) pc.alarms = pc.alarms.filter((a) => a.id !== String(b.removeAlarm));
            if (b.test) {
                pcEvents.push({
                    id: pc.seq++,
                    kind: 'ring',
                    label: mDomainValidation.cleanString(b.test.label) || 'Test alarm!',
                    icon: mDomainValidation.cleanString(b.test.icon) || '🔔',
                    time: ''
                });
                if (pcEvents.length > 30) pcEvents = pcEvents.slice(-30);
            }
            pcSave();
            return mHttpResponse.sendJson(res, 200, { ok: true });
        }
        return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown palia clock route.' });
    } catch (error) {
        return mHttpResponse.sendJson(res, 400, {
            ok: false,
            error: error.message || 'Palia clock request failed.'
        });
    }
}

Object.assign(exports, { handlePaliaClockApi });

exports.checkAlarms = checkAlarms;
