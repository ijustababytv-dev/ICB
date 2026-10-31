'use strict';
/** Build Steam presentation and polling rules with injected transport and private credentials. */
module.exports = function createSteam(context, exports) {
    const Date = context.Date;
    const fs = context.files;
    const path = require('node:path');
    const mConfig = context.config;
    const mStorage = context.storage;
    const mEvents = context.events;
    const mDomainValidation = require('../../domain/validation');
    const mGiveawayActivity = context.use('giveaway/activity');
    const mHttpResponse = context.response;
    const mResources = context.use('resources');
    const mHttpBody = context.body;
    // ---------------------------------------------------------------------------
    // STEAM ACHIEVEMENTS (Baby, 2026-10-07) - Aniimo writes no gameplay events to
    // its logs, so ICB reads her Steam achievements through Steam's official Web
    // API instead (allowed; no game memory/network touching). Polls every N sec;
    // a newly unlocked achievement becomes an on-stream pop-up. Needs her own free
    // Steam Web API key + SteamID, and "Game details" set to Public on Steam.
    //   - Overlays: /steam.html?view=popup | ?view=progress | ?view=both
    //   - Dashboard: /steam-control.html     - Saved in data/steam.json
    //   The API key never leaves the server (overlays never see it).
    // ---------------------------------------------------------------------------
    const STEAM_FILE = path.join(mConfig.DATA_DIR, 'steam.json');

    /** Create independent initial steam settings for first-run or missing saved fields. */
    function steamDefaults() {
        return {
            apiKey: '',
            steamId: '',
            appId: 4126040,
            gameName: 'Aniimo',
            enabled: true,
            pollSec: 60,
            popupSec: 9,
            showRarity: true,
            progressTitle: 'Aniimo Achievements',
            pinnedStats: [],
            cardImage: null,
            cardBox: null,
            known: null,
            schema: {},
            statDefs: {},
            stats: {},
            rarity: {},
            popups: [],
            seq: 1,
            lastPoll: null,
            lastOk: null,
            lastError: '',
            schemaAt: 0
        };
    }

    /** Restore steam state from disk and supply defaults for missing fields. */
    function steamLoad() {
        const raw = mStorage.readJson(STEAM_FILE, null) || {};
        return { ...steamDefaults(), ...raw };
    }

    let steam = steamLoad();
    steam.apiKey =
        context.integrations.steamKey || (context.integrations.steamConfigured ? 'configured' : '');
    /** Persist operator changes to the steam state file. */
    function steamSave() {
        const { apiKey, ...saved } = steam;
        mStorage.writeJson(STEAM_FILE, saved);
        mEvents.broadcast('steam', steamPublic());
    }

    const steamGet = context.network.steamGet;

    const steamQ = (o) =>
        '?' +
        Object.entries(o)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('&');

    // Accepts a 17-digit SteamID64, a profile URL (/profiles/<id> or /id/<vanity>), or a bare vanity name.
    async function steamResolveId(input) {
        const s = mDomainValidation.cleanString(input).trim();
        let m = /(\d{17})/.exec(s);
        if (m) return m[1];
        m = /steamcommunity\.com\/id\/([^\/?#\s]+)/i.exec(s);
        const vanity = m ? m[1] : /^[A-Za-z0-9_-]{2,32}$/.test(s) ? s : '';
        if (!vanity) throw new Error("That doesn't look like a Steam profile link or ID.");
        if (!steam.apiKey) throw new Error('Add the API key first.');
        const r = await steamGet(
            '/ISteamUser/ResolveVanityURL/v1/' + steamQ({ key: steam.apiKey, vanityurl: vanity })
        );
        if (r && r.response && r.response.success === 1 && r.response.steamid)
            return r.response.steamid;
        throw new Error("Steam couldn't find that profile name.");
    }

    /** Cache achievement definitions and refresh optional global rarity data. */
    async function steamLoadSchema(force) {
        if (!force && Object.keys(steam.schema).length && Date.now() - steam.schemaAt < 12 * 3600e3)
            return;
        const r = await steamGet(
            '/ISteamUserStats/GetSchemaForGame/v2/' +
                steamQ({ key: steam.apiKey, appid: steam.appId, l: 'english' })
        );
        const g = (r && r.game) || {};
        const ach = (g.availableGameStats && g.availableGameStats.achievements) || [];
        const st = (g.availableGameStats && g.availableGameStats.stats) || [];
        if (g.gameName) steam.gameName = String(g.gameName).slice(0, 80);
        steam.schema = {};
        for (const a of ach)
            steam.schema[a.name] = {
                name: String(a.displayName || a.name).slice(0, 120),
                desc: String(a.description || '').slice(0, 300),
                icon: a.icon || '',
                iconGray: a.icongray || '',
                hidden: !!a.hidden
            };
        steam.statDefs = {};
        for (const s of st) steam.statDefs[s.name] = String(s.displayName || s.name).slice(0, 80);
        steam.schemaAt = Date.now();
        try {
            const p = await steamGet(
                '/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/' +
                    steamQ({ gameid: steam.appId })
            );
            const list =
                (p && p.achievementpercentages && p.achievementpercentages.achievements) || [];
            steam.rarity = {};
            for (const a of list) steam.rarity[a.name] = Math.round(Number(a.percent) * 10) / 10;
        } catch (_e) {
            /* rarity is a nice-to-have */
        }
    }

    let steamBusy = false;
    /** Compare achievement snapshots and create popups only for newly earned achievements. */
    async function steamPoll(force) {
        if (steamBusy) return { ok: false, error: 'Already checking.' };
        if (!steam.apiKey || (!steam.steamId && !steam.profileInput))
            return { ok: false, error: 'Add your API key and Steam profile first.' };
        steamBusy = true;
        steam.lastPoll = Date.now();
        try {
            if (!steam.steamId && steam.profileInput)
                steam.steamId = await steamResolveId(steam.profileInput);
            await steamLoadSchema(force);
            const r = await steamGet(
                '/ISteamUserStats/GetPlayerAchievements/v1/' +
                    steamQ({ key: steam.apiKey, steamid: steam.steamId, appid: steam.appId })
            );
            const ps = r && r.playerstats;
            if (!ps || ps.success === false) {
                const why = String((ps && ps.error) || 'no data');
                throw new Error(
                    /not public/i.test(why)
                        ? 'Your Steam "Game details" are private - set them to Public (see step 3).'
                        : /requested app has no stats/i.test(why)
                        ? 'Steam says this game has no achievements for that account yet.'
                        : `Steam: ${why}`
                );
            }
            const now = {};
            for (const a of ps.achievements || [])
                if (a.achieved)
                    now[a.apiname] = Number(a.unlocktime) || Math.floor(Date.now() / 1000);
            if (steam.known && typeof steam.known === 'object') {
                for (const [api, t] of Object.entries(now))
                    if (!(api in steam.known)) {
                        steam.popups.push({
                            id: steam.seq++,
                            apiname: api,
                            unlocktime: t,
                            at: Date.now()
                        });
                        mGiveawayActivity.logActivity({
                            type: 'steam_achievement',
                            game: steam.gameName,
                            name: (steam.schema[api] || {}).name || api
                        });
                    }
                if (steam.popups.length > 40) steam.popups = steam.popups.slice(-40);
            }
            steam.known = now; // first successful check = baseline, no pop-up flood
            try {
                const s = await steamGet(
                    '/ISteamUserStats/GetUserStatsForGame/v2/' +
                        steamQ({ key: steam.apiKey, steamid: steam.steamId, appid: steam.appId })
                );
                const list = (s && s.playerstats && s.playerstats.stats) || [];
                steam.stats = {};
                for (const x of list) steam.stats[x.name] = Number(x.value) || 0;
            } catch (_e) {
                /* many games publish no stats - fine */
            }
            steam.lastOk = Date.now();
            steam.lastError = '';
            steamSave();
            return { ok: true };
        } catch (error) {
            steam.lastError = error.message || 'Steam check failed.';
            steamSave();
            return { ok: false, error: steam.lastError };
        } finally {
            steamBusy = false;
        }
    }

    /** Build a display record from cached achievement metadata. */
    function steamAch(api) {
        const s = steam.schema[api] || {};
        return {
            apiname: api,
            name: s.name || api,
            desc: s.desc || '',
            icon: s.icon || '',
            rarity: steam.rarity[api] === undefined ? null : steam.rarity[api]
        };
    }

    /** Build the steam response consumed by dashboards and overlays. */
    function steamPublic() {
        const total = Object.keys(steam.schema).length;
        const known = steam.known || {};
        const recent = Object.entries(known)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([api, t]) => ({ ...steamAch(api), unlocktime: t }));
        const stats = (steam.pinnedStats || [])
            .filter((p) => p && p.name in steam.stats)
            .map((p) => ({
                name: p.name,
                label: p.label || steam.statDefs[p.name] || p.name,
                value: steam.stats[p.name]
            }));
        return {
            ok: true,
            configured: !!(steam.apiKey && steam.steamId),
            connected: !!steam.lastOk && !steam.lastError,
            gameName: steam.gameName,
            title: steam.progressTitle,
            total,
            unlocked: Object.keys(known).length,
            recent,
            stats,
            popupSec: steam.popupSec,
            showRarity: steam.showRarity,
            popups: steam.popups
                .slice(-10)
                .map((p) => ({ id: p.id, at: p.at, test: !!p.test, ...steamAch(p.apiname) })),
            card: steam.cardImage
                ? {
                      url: `/assets/resources/${encodeURIComponent(steam.cardImage)}`,
                      box: steam.cardBox || { left: 25, top: 60, width: 50, height: 25 }
                  }
                : null,
            now: Date.now()
        };
    }

    /** Poll only configured, enabled Steam profiles after their interval elapses. */
    function pollSteamIfDue() {
        if (
            steam.enabled &&
            steam.apiKey &&
            steam.steamId &&
            (!steam.lastPoll || Date.now() - steam.lastPoll >= Math.max(30, steam.pollSec) * 1000)
        )
            steamPoll(false).catch(() => {});
    }

    /** Validate and dispatch steam API requests, returning client errors for invalid input. */
    async function handleSteamApi(req, res, pathname, method) {
        try {
            if (pathname === '/api/steam' && method === 'GET')
                return mHttpResponse.sendJson(res, 200, steamPublic());
            if (pathname === '/api/steam/admin' && method === 'GET') {
                const known = steam.known || {};
                const achievements = Object.keys(steam.schema)
                    .map((api) => ({
                        ...steamAch(api),
                        unlocked: api in known,
                        unlocktime: known[api] || null,
                        hidden: steam.schema[api].hidden
                    }))
                    .sort(
                        (a, b) =>
                            b.unlocked - a.unlocked ||
                            (b.unlocktime || 0) - (a.unlocktime || 0) ||
                            (b.rarity || 0) - (a.rarity || 0)
                    );
                const stats = Object.keys(steam.stats).map((n) => ({
                    name: n,
                    label: steam.statDefs[n] || n,
                    value: steam.stats[n],
                    pinned: (steam.pinnedStats || []).some((p) => p.name === n)
                }));
                const art = (() => {
                    try {
                        return fs
                            .readdirSync(mResources.RESOURCE_ART_DIR)
                            .filter((f) => mDomainValidation.DECOR_IMAGE_EXT.test(f))
                            .sort((a, c) => a.localeCompare(c));
                    } catch (_e) {
                        return [];
                    }
                })();
                return mHttpResponse.sendJson(res, 200, {
                    ...steamPublic(),
                    art,
                    cardImage: steam.cardImage,
                    cardBox: steam.cardBox,
                    keySet: !!steam.apiKey,
                    keyHint: steam.apiKey ? 'Configured' : '',
                    steamId: steam.steamId,
                    appId: steam.appId,
                    enabled: steam.enabled,
                    pollSec: steam.pollSec,
                    lastPoll: steam.lastPoll,
                    lastOk: steam.lastOk,
                    lastError: steam.lastError,
                    achievements,
                    statList: stats,
                    pinnedStats: steam.pinnedStats
                });
            }
            const b = ['POST', 'PUT', 'PATCH'].includes(method)
                ? await mHttpBody.readBody(req)
                : {};
            if (pathname === '/api/steam/settings' && method === 'POST') {
                context.jobs.push({ kind: 'steam' });
                if (typeof b.steamId === 'string' && b.steamId.trim()) {
                    const profile = b.steamId.trim().slice(0, 180);
                    if (
                        !/^(?:[0-9]{17}|[A-Za-z0-9_-]{2,32}|https:\/\/steamcommunity\.com\/(?:profiles|id)\/[^\s?#]+\/?)$/.test(
                            profile
                        )
                    )
                        throw new Error('Invalid Steam profile.');
                    steam.profileInput = profile;
                    const id = /^[0-9]{17}$/.test(profile) ? profile : '';
                    if (id !== steam.steamId) {
                        steam.steamId = id;
                        steam.known = null;
                        steam.popups = [];
                    }
                }
                if (
                    b.appId !== undefined &&
                    /^\d{1,10}$/.test(String(b.appId)) &&
                    Number(b.appId) !== steam.appId
                ) {
                    steam.appId = Number(b.appId);
                    steam.schema = {};
                    steam.schemaAt = 0;
                    steam.known = null;
                    steam.popups = [];
                    steam.stats = {};
                }
                if (typeof b.enabled === 'boolean') steam.enabled = b.enabled;
                if (typeof b.showRarity === 'boolean') steam.showRarity = b.showRarity;
                if (b.pollSec !== undefined)
                    steam.pollSec = Math.max(
                        30,
                        Math.min(600, Math.round(Number(b.pollSec)) || 60)
                    );
                if (b.popupSec !== undefined)
                    steam.popupSec = Math.max(3, Math.min(30, Math.round(Number(b.popupSec)) || 9));
                if (typeof b.progressTitle === 'string')
                    steam.progressTitle = mDomainValidation
                        .cleanString(b.progressTitle)
                        .slice(0, 80);
                // Her own art card for the progress count (like the Palia tracker cards).
                if (b.cardImage !== undefined) {
                    const f = b.cardImage ? path.basename(String(b.cardImage)) : null;
                    steam.cardImage =
                        f &&
                        mDomainValidation.DECOR_IMAGE_EXT.test(f) &&
                        fs.existsSync(path.join(mResources.RESOURCE_ART_DIR, f))
                            ? f
                            : null;
                }
                if (b.cardBox && typeof b.cardBox === 'object') {
                    const n = (k) => Math.max(0, Math.min(100, Number(b.cardBox[k]) || 0));

                    steam.cardBox = {
                        left: n('left'),
                        top: n('top'),
                        width: n('width') || 50,
                        height: n('height') || 25
                    };
                }
                if (Array.isArray(b.pinnedStats))
                    steam.pinnedStats = b.pinnedStats
                        .slice(0, 6)
                        .filter((p) => p && typeof p.name === 'string')
                        .map((p) => ({
                            name: p.name.slice(0, 80),
                            label: mDomainValidation.cleanString(p.label).slice(0, 40)
                        }));
                steamSave();
                return mHttpResponse.sendJson(res, 200, { ok: true });
            }
            if (pathname === '/api/steam/check' && method === 'POST') {
                context.jobs.push({ kind: 'steam', force: true });
                return mHttpResponse.sendJson(res, 202, { ok: true, queued: true });
            }
            if (pathname === '/api/steam/test-popup' && method === 'POST') {
                const api = steam.schema[b.apiname] ? b.apiname : Object.keys(steam.schema)[0];
                if (!api)
                    return mHttpResponse.sendJson(res, 400, {
                        ok: false,
                        error: 'Connect to Steam first so ICB knows the achievement list.'
                    });
                steam.popups.push({ id: steam.seq++, apiname: api, at: Date.now(), test: true });
                steamSave();
                return mHttpResponse.sendJson(res, 200, { ok: true });
            }
            if (pathname === '/api/steam/forget' && method === 'POST') {
                steam.apiKey = '';
                steam.known = null;
                steam.popups = [];
                steam.lastOk = null;
                steam.lastError = '';
                steamSave();
                return mHttpResponse.sendJson(res, 200, { ok: true });
            }
            return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Unknown steam route.' });
        } catch (error) {
            return mHttpResponse.sendJson(res, 400, {
                ok: false,
                error: error.message || 'Steam request failed.'
            });
        }
    }

    Object.assign(exports, { handleSteamApi, steamPoll, steamPublic });

    exports.pollSteamIfDue = pollSteamIfDue;
};
