'use strict';

/** Find the containing Palia week, including instants before Monday 04:00 UTC. */
function weekStartFor(at, cfg) {
    const weekday = Number(cfg.weekStartsUtc?.weekday ?? 1); // 1 = Monday
    const hour = Number(cfg.weekStartsUtc?.hour ?? 4);
    const d = new Date(at);
    const back = (d.getUTCDay() - weekday + 7) % 7;
    const start = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back, hour, 0, 0, 0)
    );
    if (start.getTime() > d.getTime()) start.setUTCDate(start.getUTCDate() - 7);
    return start.toISOString();
}

Object.assign(exports, { weekStartFor });
