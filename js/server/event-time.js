'use strict';

const path = require('node:path');
const mConfig = require('./config');
const mStorage = require('./storage');
const mDomainTimezone = require('./domain/timezone');
const mDomainValidation = require('./domain/validation');
const mEvents = require('./events');
const mHttpResponse = require('./http/response');
const mHttpBody = require('./http/body');

// ---------------------------------------------------------------------------
// EVENT TIME CONVERTER (Baby, 2026-10-06) - she types when an event happens
// (in her own time zone) and the overlay shows that same moment in each zone
// with its day, e.g. "PDT  Sat, Oct 10  5:00 PM". The server turns her wall
// time into one exact moment (epoch ms); the overlay formats it per zone with
// Intl, so daylight-saving changes (PDT -> PST) are handled automatically.
//   - Overlay:   /eventtime.html      - Dashboard: /eventtime-control.html
//   - Saved in data/eventtime.json
// ---------------------------------------------------------------------------
const EVENTTIME_FILE = path.join(mConfig.DATA_DIR, 'eventtime.json');
/** Create independent initial event time settings for first-run or missing saved fields. */
function eventTimeDefaults() {
  return {
    title: 'Next Event', subtitle: '', date: '', time: '', sourceTz: 'America/Chicago', at: null,
    visible: true, showCountdown: true, layout: 'row',
    zones: [
      { label: '', tz: 'America/Los_Angeles', visible: true },
      { label: '', tz: 'America/Denver', visible: true },
      { label: '', tz: 'America/Chicago', visible: true },
      { label: '', tz: 'America/New_York', visible: true },
      { label: 'GMT +1', tz: 'Etc/GMT-1', visible: true },
      { label: 'GMT +2', tz: 'Etc/GMT-2', visible: true },
    ],
  };
}

// Offset (ms) of a zone at a given instant: wall-clock-as-UTC minus the instant.

// "2026-10-10" + "19:00" in America/Chicago -> exact epoch ms (or null).

/** Restore event time state from disk and supply defaults for missing fields. */
function eventTimeLoad() {
  const raw = mStorage.readJson(EVENTTIME_FILE, null) || {};
  const e = { ...eventTimeDefaults(), ...raw };
  e.zones = (Array.isArray(e.zones) ? e.zones : eventTimeDefaults().zones).slice(0, 12)
    .filter(z => z && mDomainTimezone.etValidTz(z.tz)).map(z => ({ label: mDomainValidation.cleanString(z.label).slice(0, 30), tz: String(z.tz), visible: z.visible !== false }));
  if (!mDomainTimezone.etValidTz(e.sourceTz)) e.sourceTz = 'America/Chicago';
  return e;
}
let eventTime = eventTimeLoad();
/** Persist operator changes to the event time state file. */
function eventTimeSave() { mStorage.writeJson(EVENTTIME_FILE, eventTime); mEvents.broadcast('eventtime', { ...eventTime, ok: true, now: Date.now() }); }
/** Validate and dispatch event time API requests, returning client errors for invalid input. */
async function handleEventTimeApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/eventtime' && method === 'GET') return mHttpResponse.sendJson(res, 200, { ok: true, ...eventTime, now: Date.now() });
    if (pathname === '/api/eventtime' && method === 'POST') {
      const b = await mHttpBody.readBody(req);
      if (typeof b.title === 'string') eventTime.title = mDomainValidation.cleanString(b.title).slice(0, 80);
      if (typeof b.subtitle === 'string') eventTime.subtitle = mDomainValidation.cleanString(b.subtitle).slice(0, 120);
      if (typeof b.visible === 'boolean') eventTime.visible = b.visible;
      if (typeof b.showCountdown === 'boolean') eventTime.showCountdown = b.showCountdown;
      if (b.layout === 'row' || b.layout === 'column') eventTime.layout = b.layout;
      if (typeof b.sourceTz === 'string' && mDomainTimezone.etValidTz(b.sourceTz)) eventTime.sourceTz = b.sourceTz;
      if (typeof b.date === 'string') eventTime.date = b.date.slice(0, 10);
      if (typeof b.time === 'string') eventTime.time = b.time.slice(0, 5);
      if (Array.isArray(b.zones)) {
        const z = b.zones.slice(0, 12).filter(x => x && mDomainTimezone.etValidTz(x.tz)).map(x => ({ label: mDomainValidation.cleanString(x.label).slice(0, 30), tz: String(x.tz), visible: x.visible !== false }));
        if (z.length) eventTime.zones = z;
      }
      eventTime.at = mDomainTimezone.etToEpoch(eventTime.date, eventTime.time, eventTime.sourceTz);
      if ((b.date || b.time) && eventTime.at === null) return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Pick a date and a time.' });
      eventTimeSave();
      return mHttpResponse.sendJson(res, 200, { ok: true, ...eventTime, now: Date.now() });
    }
    return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown event time route.' });
  } catch (error) {
    return mHttpResponse.sendJson(res, 400, { ok: false, error: error.message || 'Event time request failed.' });
  }
}

Object.assign(exports, { handleEventTimeApi });
