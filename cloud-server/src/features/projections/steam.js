'use strict';
const { replaceRows, readRows } = require('./rows');
const FIELDS = [
    'steamId',
    'profileInput',
    'appId',
    'enabled',
    'lastPoll',
    'lastOk',
    'lastError',
    'schemaAt',
    'known'
];

/** Preserve the first-success baseline flag separately from an empty achievement set. */
async function saveSteam(client, owner, doc) {
    const app = String(doc.appId || 4126040);
    await replaceRows(client, 'steam_accounts', owner, [
        {
            steam_id: doc.steamId || '',
            profile_input: doc.profileInput || '',
            app_id: Number(app),
            enabled: doc.enabled !== false,
            known_initialized: doc.known !== null && doc.known !== undefined,
            last_poll: doc.lastPoll || null,
            last_ok: doc.lastOk || null,
            last_error: String(doc.lastError || '').slice(0, 300),
            schema_at: doc.schemaAt || 0
        }
    ]);
    await replaceRows(
        client,
        'steam_achievements',
        owner,
        Object.entries(doc.known || {}).map(([id, time]) => ({
            app_id: app,
            achievement_id: id,
            details: {},
            unlocked_at: new Date(Number(time) * 1000).toISOString()
        })),
        { app_id: app }
    );
    return FIELDS;
}

/** An imported null known set remains null until a successful provider response establishes its baseline. */
async function loadSteam(client, owner, doc) {
    const row = (await readRows(client, 'steam_accounts', owner))[0];
    if (!row) return;
    Object.assign(doc, {
        steamId: row.steam_id,
        profileInput: row.profile_input,
        appId: Number(row.app_id),
        enabled: row.enabled,
        lastPoll: row.last_poll === null ? null : Number(row.last_poll),
        lastOk: row.last_ok === null ? null : Number(row.last_ok),
        lastError: row.last_error,
        schemaAt: Number(row.schema_at)
    });
    doc.known = row.known_initialized
        ? Object.fromEntries(
              (await readRows(client, 'steam_achievements', owner))
                  .filter((item) => item.app_id === String(row.app_id))
                  .map((item) => [
                      item.achievement_id,
                      Math.floor(item.unlocked_at.getTime() / 1000)
                  ])
          )
        : null;
}

module.exports = { saveSteam, loadSteam };
