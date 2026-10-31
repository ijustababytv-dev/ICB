'use strict';

/** Construct a transaction-scoped feature model with injected state and side effects. */
module.exports = function createModel(context, exports) {
    const Date = context.Date;
    const Math = context.Math;
    const console = context.logger;
    const mOverlayDiagnostics = context.use('overlay-diagnostics');
    const mHttpResponse = context.response;
    const mWeekly = context.use('weekly');
    const mHttpBody = context.body;

    /** Handle weekly requests; reject unmatched paths. */
    async function handleWeeklyApi(req, res, url) {
        const method = req.method || 'GET';
        const pathname = url.pathname.replace(/\/$/, '') || '/';
        // ---------------- weekly accomplishments ----------------
        if (pathname === '/api/weekly' && method === 'GET') {
            mOverlayDiagnostics.notePoll(url.searchParams.get('src'));
            return mHttpResponse.sendJson(res, 200, { ok: true, weekly: mWeekly.weeklyView() });
        }

        if (pathname === '/api/weekly/undo-reset' && ['POST', 'PUT'].includes(method)) {
            if (!mWeekly.undoWeeklyReset())
                return mHttpResponse.sendJson(res, 400, { ok: false, error: 'Nothing to undo.' });
            return mHttpResponse.sendJson(res, 200, { ok: true, weekly: mWeekly.weeklyView() });
        }

        if (pathname === '/api/weekly/reset' && ['POST', 'PUT'].includes(method)) {
            // Manual "start the week over", separate from the automatic rollover.
            mWeekly.weekly.previous = {
                weekStart: mWeekly.weekly.weekStart,
                progress: mWeekly.weekly.items.map((i) => ({
                    id: i.id,
                    count: i.count,
                    done: Boolean(i.done)
                }))
            };
            for (const item of mWeekly.weekly.items) {
                item.count = 0;
                item.done = false;
            }
            mWeekly.weekly.lastResetAt = new Date().toISOString();
            mWeekly.broadcastWeekly();
            return mHttpResponse.sendJson(res, 200, { ok: true, weekly: mWeekly.weeklyView() });
        }

        {
            const match = pathname.match(/^\/api\/weekly\/([a-z0-9-]+)\/(toggle|set)$/i);
            if (match && ['POST', 'PUT'].includes(method)) {
                const item = mWeekly.findWeeklyItem(match[1].toLowerCase());
                if (!item)
                    return mHttpResponse.sendJson(res, 404, {
                        ok: false,
                        error: 'No accomplishment with that id.'
                    });
                const body = await mHttpBody.readBody(req);
                if (match[2] === 'toggle') {
                    // Ticking an automatic item by hand is allowed - the log can be wrong,
                    // and Baby is the authority. Ticking sets its counter to the target.
                    item.done = !item.done;
                    if (item.type === 'collect')
                        item.count = item.done ? Number(item.target || 1) : 0;
                } else {
                    const value = Math.trunc(Number(body.count));
                    if (!Number.isFinite(value))
                        return mHttpResponse.sendJson(res, 400, {
                            ok: false,
                            error: 'Send a whole number.'
                        });
                    item.count = Math.max(0, value);
                    item.done =
                        item.type === 'manual' ? item.done : item.count >= Number(item.target || 1);
                }
                mWeekly.broadcastWeekly();
                return mHttpResponse.sendJson(res, 200, { ok: true, weekly: mWeekly.weeklyView() });
            }
        }
        return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
    }

    Object.assign(exports, { handleWeeklyApi });
};
