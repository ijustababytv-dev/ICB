'use strict';

/** Construct a transaction-scoped feature model with injected state and side effects. */
module.exports = function createModel(context, exports) {
    const Date = context.Date;
    const Math = context.Math;
    const console = context.logger;
    const path = require('node:path');
    const mConfig = context.config;
    const mStorage = context.storage;
    const mEvents = context.events;
    const mHttpResponse = context.response;
    const mHttpBody = context.body;
    const mDomainValidation = require('../../domain/validation');

    // ---------------------------------------------------------------------------
    // NEWS TICKER (Baby, 2026-10-08) - a full-width bar along the bottom of the
    // stream that scrolls her messages one after another, forever. Separate from
    // the older framed "Ticker Banner" (/ticker.html). She edits everything on the
    // dashboard: messages (add / reorder / turn off), a label pill ("📰 NEWS"),
    // colours, speed, size, and a one-off ALERT that takes over the bar for a while.
    //   - Overlay:   /newsticker.html      - Dashboard: /newsticker-control.html
    //   - Saved in data/newsticker.json
    // ---------------------------------------------------------------------------
    const NEWS_FILE = path.join(mConfig.DATA_DIR, 'newsticker.json');
    /** Create independent initial news settings for first-run or missing saved fields. */
    function newsDefaults() {
        return {
            visible: true,
            label: '📰 NEWS',
            showLabel: true,
            separator: '✦',
            speed: 110,
            gap: 1,
            barColor: '#1c0e28',
            barOpacity: 88,
            textColor: '#ffffff',
            labelColor: '#ff8fd8',
            labelText: '#1b0f2a',
            accent: '#b77cff',
            font: 34,
            messages: [{ id: 'm1', text: 'Welcome to ijustababyTv! 🦄', on: true }],
            seq: 2,
            alert: { text: '', until: 0, color: '#ff4655' }
        };
    }

    const newsHex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v) : null);

    /** Restore news state from disk and supply defaults for missing fields. */
    function newsLoad() {
        const raw = mStorage.readJson(NEWS_FILE, null) || {};
        const d = newsDefaults();
        return { ...d, ...raw, alert: { ...d.alert, ...(raw.alert || {}) } };
    }

    let news = newsLoad();
    /** Build the news response consumed by dashboards and overlays. */
    function newsPublic() {
        const alertOn = !!(news.alert.text && Date.now() < news.alert.until);
        return {
            ok: true,
            visible: news.visible,
            label: news.label,
            showLabel: news.showLabel,
            separator: news.separator,
            speed: news.speed,
            gap: news.gap === undefined ? 1 : news.gap,
            barColor: news.barColor,
            barOpacity: news.barOpacity,
            textColor: news.textColor,
            labelColor: news.labelColor,
            labelText: news.labelText,
            accent: news.accent,
            font: news.font,
            messages: news.messages.filter((m) => m.on && m.text).map((m) => m.text),
            alert: alertOn
                ? {
                      text: news.alert.text,
                      color: news.alert.color,
                      leftSec: Math.ceil((news.alert.until - Date.now()) / 1000)
                  }
                : null,
            now: Date.now()
        };
    }

    /** Persist operator changes to the news state file. */
    function newsSave() {
        mStorage.writeJson(NEWS_FILE, news);
        mEvents.broadcast('newsticker', newsPublic());
    }

    /** Validate and dispatch news API requests, returning client errors for invalid input. */
    async function handleNewsApi(req, res, pathname, method) {
        try {
            if (pathname === '/api/newsticker' && method === 'GET')
                return mHttpResponse.sendJson(res, 200, newsPublic());
            if (pathname === '/api/newsticker/admin' && method === 'GET')
                return mHttpResponse.sendJson(res, 200, {
                    ...newsPublic(),
                    all: news.messages,
                    alertRaw: news.alert
                });
            if (pathname === '/api/newsticker' && method === 'POST') {
                const b = await mHttpBody.readBody(req);
                if (typeof b.visible === 'boolean') news.visible = b.visible;
                if (typeof b.showLabel === 'boolean') news.showLabel = b.showLabel;
                if (typeof b.label === 'string')
                    news.label = mDomainValidation.cleanString(b.label).slice(0, 40);
                if (typeof b.separator === 'string')
                    news.separator = mDomainValidation.cleanString(b.separator).slice(0, 8);
                if (b.speed !== undefined)
                    news.speed = Math.max(20, Math.min(600, Math.round(Number(b.speed)) || 110));
                // Seconds the bar stays empty after a message has fully left the screen (2026-10-09: one message at a time).
                if (b.gap !== undefined)
                    news.gap = Math.max(0, Math.min(30, Math.round(Number(b.gap) * 10) / 10 || 0));
                if (b.font !== undefined)
                    news.font = Math.max(14, Math.min(90, Math.round(Number(b.font)) || 34));
                if (b.barOpacity !== undefined)
                    news.barOpacity = Math.max(
                        0,
                        Math.min(100, Math.round(Number(b.barOpacity)) || 0)
                    );
                for (const k of ['barColor', 'textColor', 'labelColor', 'labelText', 'accent'])
                    if (b[k] !== undefined && newsHex(b[k])) news[k] = b[k];
                if (Array.isArray(b.messages)) {
                    news.messages = b.messages
                        .slice(0, 40)
                        .map((m) => ({
                            id:
                                m && /^m\d{1,6}$/.test(String(m.id || ''))
                                    ? String(m.id)
                                    : `m${news.seq++}`,
                            text: mDomainValidation.cleanString(m && m.text).slice(0, 300),
                            on: !(m && m.on === false)
                        }))
                        .filter((m) => m.text);
                }
                // Alert: { alert: { text, seconds, color } } shows instead of the messages; { alert: null } stops it.
                if (b.alert === null) news.alert.until = 0;
                else if (b.alert && typeof b.alert === 'object') {
                    const t = mDomainValidation.cleanString(b.alert.text).slice(0, 300);
                    if (t) {
                        news.alert.text = t;
                        news.alert.until =
                            Date.now() +
                            Math.max(5, Math.min(3600, Math.round(Number(b.alert.seconds)) || 60)) *
                                1000;
                    }
                    if (newsHex(b.alert.color)) news.alert.color = b.alert.color;
                }
                newsSave();
                return mHttpResponse.sendJson(res, 200, { ok: true, ...newsPublic() });
            }
            return mHttpResponse.sendJson(res, 404, {
                ok: false,
                error: 'Unknown news ticker route.'
            });
        } catch (error) {
            return mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: error.message || 'News ticker request failed.'
            });
        }
    }

    Object.assign(exports, { newsHex, handleNewsApi });
};
