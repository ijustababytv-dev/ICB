'use strict';
const { fields, integer, text } = require('../activity/validation');
const { fail } = require('../activity/errors');
const { valid: gameFact } = require('../domain/game-facts');
const { digest } = require('./contracts');
const { RESOURCE_META } = require('../domain/resources');
const { normalizeSupport, SUPPORT } = require('../domain/support-normalize');
const { intentSpec, validIntent } = require('./intent-spec');

/** A collector input is ordered independently of optimistic operator edits. */
async function claimInput(client, owner, body) {
    if (!body.collector_id) throw fail(400, 'collector_required');
    const input = body.operands;
    integer(input.sequence, 1, Number.MAX_SAFE_INTEGER);
    text(input.source_key, 240);
    const at = Date.parse(input.at);
    if (!Number.isFinite(at) || at < Date.UTC(2020, 0, 1) || at > Date.now() + 300000)
        throw fail(400, 'invalid_timestamp');
    const prior = await client.query(
        'SELECT digest FROM collector_input_receipts WHERE owner_id=$1 AND source_key=$2',
        [owner.id, input.source_key]
    );
    const sourceDigest = digest({
        action: body.action,
        payload: Object.fromEntries(
            Object.entries(input).filter(([key]) => !['sequence', 'source_key', 'at'].includes(key))
        )
    });
    if (prior.rowCount && prior.rows[0].digest !== sourceDigest)
        throw fail(409, 'source_content_changed');
    const lease = await client.query(
        `SELECT 1 FROM collector_leases WHERE owner_id=$1 AND collector_id=$2
        AND started_at<=$3::timestamptz+interval '5 seconds' AND expires_at>=$3::timestamptz
        UNION ALL SELECT 1 FROM collector_history WHERE owner_id=$1 AND collector_id=$2
        AND started_at<=$3::timestamptz AND expires_at>=$3::timestamptz`,
        [owner.id, body.collector_id, input.at]
    );
    if (!lease.rowCount) throw fail(409, 'collector_lease_expired');
    await client.query(
        'INSERT INTO collector_sequences(owner_id,collector_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [owner.id, body.collector_id]
    );
    const previous = await client.query(
        'SELECT sequence FROM collector_sequences WHERE owner_id=$1 AND collector_id=$2 FOR UPDATE',
        [owner.id, body.collector_id]
    );
    if (Number(previous.rows[0].sequence) + 1 !== input.sequence)
        throw fail(409, 'collector_sequence_gap');
    if (!prior.rowCount)
        await client.query(
            'INSERT INTO collector_input_receipts(owner_id,collector_id,sequence,source_key,digest,occurred_at) VALUES($1,$2,$3,$4,$5,$6)',
            [owner.id, body.collector_id, input.sequence, input.source_key, sourceDigest, input.at]
        );
    await client.query(
        'UPDATE collector_sequences SET sequence=$3 WHERE owner_id=$1 AND collector_id=$2',
        [owner.id, body.collector_id, input.sequence]
    );
    return !prior.rowCount;
}

/** Reconstruct only the normalized operands of a recognized command, never its original message. */
async function applyIntent(context, input, client, owner) {
    fields(input, [
        'sequence',
        'source_key',
        'at',
        'kind',
        'sender',
        'command',
        'arguments',
        'subscriber',
        'support'
    ]);
    if (input.sender !== '') text(input.sender, 80);
    if (input.kind === 'support') {
        const support = input.support;
        fields(support, [
            'type',
            'months',
            'quantity',
            'bits',
            'currency',
            'money_minor',
            'raid_size',
            'tier',
            'subtype',
            'platform',
            'platform_user_id'
        ]);
        if (!SUPPORT.includes(support.type)) throw fail(400, 'invalid_support_type');
        const event = {
            ...support,
            username: input.sender,
            at: input.at,
            source_id: input.source_key,
            count: support.quantity,
            amount: support.bits,
            viewers: support.raid_size,
            subType: support.subtype
        };
        const normalized = normalizeSupport(event, context.timezone);
        if (!normalized) throw fail(400, 'invalid_support_fact');
        // Currency events are reporting-only; no client-provided ticket delta is accepted.
        if (['tip', 'purchase'].includes(support.type) || !input.sender) {
            context.effects.push(event);
            return { status: 200, payload: { ok: true } };
        }
        const reply = context
            .use('giveaway/activity')
            .withEvent(event, () => context.use('activity/giveaway-event').applyEvent(event));
        context.use('giveaway/state').saveGiveaway();
        return reply;
    }
    if (input.kind === 'presence') {
        const model = context.use('giveaway/state');
        const anchor = Date.parse(model.giveaway.windowStartedAt);
        const window = anchor + Math.floor((Date.parse(input.at) - anchor) / 600000) * 600000;
        const added = await client.query(
            `INSERT INTO chat_window_presence(owner_id,name_key,window_id,occurred_at,awarded_at)
            VALUES($1,$2,$3,$4,CASE WHEN $5 THEN now() ELSE NULL END) ON CONFLICT DO NOTHING RETURNING name_key`,
            [owner.id, input.sender.toLowerCase(), window, input.at, window < anchor]
        );
        if (added.rowCount && !model.isBlocked(input.sender)) {
            if (window < anchor) {
                const entrant = model.ensureEntrant(input.sender);
                const before = model.entrantTotal(entrant);
                entrant.counts.chatWindows++;
                model.recomputeEntrant(entrant);
                context.effects.push({
                    type: 'chat_window',
                    username: entrant.username,
                    at: new Date(window + 600000).toISOString(),
                    unicorns: model.entrantTotal(entrant) - before
                });
            } else
                context
                    .use('activity/giveaway-event')
                    .applyEvent({ type: 'chat', username: input.sender });
            model.saveGiveaway();
        }
        return { status: 200, payload: { ok: true } };
    }
    if (
        input.kind !== 'command' ||
        !/^[a-z0-9_]{1,40}$/.test(input.command || '') ||
        !Array.isArray(input.arguments) ||
        input.arguments.length > 20 ||
        input.arguments.some(
            (value) => typeof value !== 'string' || value.length > 80 || /[<>\r\n]/.test(value)
        )
    )
        throw fail(400, 'invalid_semantic_command');
    if (!validIntent(intentSpec(context), input.command, input.arguments))
        throw fail(400, 'unknown_semantic_command');
    const command =
        input.command === 'signup_name'
            ? input.arguments[0]
            : input.command + (input.arguments.length ? ' ' + input.arguments.join(' ') : '');
    const parts = [
        {
            t: 'text',
            v: '!' + command
        }
    ];
    const sender = input.sender;
    const results = [];
    for (const [model, fn] of [
        ['poll', 'pollChat'],
        ['teams', 'teamsChat']
    ])
        results.push(context.use(model)[fn](sender, parts));
    const shown = context.use('signups/commands').signupShowHideChat(sender, parts);
    const turn = context.use('turn-line').turnLineChat(sender, parts);
    if (!shown && !turn)
        for (const [model, fn] of [
            ['signups/poke', 'sashiChat'],
            ['signups/burger', 'bbsuChat'],
            ['signups/flow', 'ftsuChat']
        ])
            results.push(context.use(model)[fn](sender, parts));
    for (const [model, fn] of [
        ['aniimo', 'dexChat'],
        ['avatars', 'avChat'],
        ['sprite-jar', 'sjChat'],
        ['hunt', 'huntChat']
    ])
        results.push(context.use(model)[fn](sender, parts));
    if (!shown) results.push(context.use('party').partyChat(sender, parts));
    return { status: 200, payload: { ok: true, results: results.filter(Boolean) } };
}

/** Typed game facts drive lifetime, session and weekly rules on the same working set. */
function applyGame(context, input) {
    fields(input, ['sequence', 'source_key', 'at', 'fact']);
    const fact = input.fact;
    if (fact?.kind !== 'login' && !gameFact(fact)) throw fail(400, 'invalid_game_fact');
    if (fact.kind === 'login') fields(fact, ['kind', 'at']);
    else {
        fields(fact, ['source', 'direction', 'items']);
        if (fact.items.length > 500) throw fail(413, 'too_many_game_items');
        fact.items.forEach((item) => fields(item, ['token', 'quantity', 'star']));
    }
    const resources = context.use('resources');
    const weekly = context.use('weekly');
    if (resources.resourceTrackerScan({ ...fact, at: input.at }))
        resources.broadcastResourceTrackers();
    if (weekly.weeklyScan(fact)) weekly.broadcastWeekly();
    if (fact.kind !== 'login') {
        const state = context.use('state');
        let changed = false;
        for (const [id, meta] of Object.entries(RESOURCE_META)) {
            const item = fact.items.find((entry) => entry.token === meta.token);
            if (!item) continue;
            state.live.resources[id] = Math.max(
                0,
                (Number(state.live.resources[id]) || 0) +
                    item.quantity * (fact.direction === 'lost' ? -1 : 1)
            );
            changed = true;
        }
        if (changed) state.saveLive();
    }
    return { status: 200, payload: { ok: true } };
}

module.exports = { claimInput, applyIntent, applyGame };
