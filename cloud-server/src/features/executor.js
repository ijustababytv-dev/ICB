'use strict';
const { fail } = require('../activity/errors');
const { intentSpec, validIntent } = require('./intent-spec');
const ROUTES = [
    ['steam', /^\/api\/steam(?:\/|$)/, 'steam', 'handleSteamApi'],
    ['sprite-tv', /^\/api\/sprite-tv(?:\/|$)/, 'sprite-tv', 'handleSpriteTvApi'],
    ['weekly-accomplishments', /^\/api\/weekly(?:\/|$)/, 'routes/weekly', 'handleWeeklyApi', true],
    [
        'resource-trackers',
        /^\/api\/resource-trackers(?:\/|$)/,
        'routes/resources',
        'handleResourcesApi',
        true
    ],
    [
        'settings',
        /^\/api\/(?:settings|layout|ticker|state|actions)(?:\/|$)/,
        'routes/state',
        'handleStateApi',
        true
    ],
    ['live', /^\/api\/live(?:\/|$)/, 'routes/state', 'handleStateApi', true],
    ['randomizer', /^\/api\/randomizer$/, 'routes/settings', 'handleSettingsApi', true],
    ['todos', /^\/api\/todos(?:\/|$)/, 'routes/todos', 'handleTodosApi', true],
    ['tradeup-state', /^\/api\/tradeup(?:\/|$)/, 'tradeup', 'handleTradeupApi'],
    ['decor', /^\/api\/decor(?:\/|$)/, 'decor', 'handleDecorApi'],
    ['hub', /^\/api\/hub(?:\/|$)/, 'hub', 'handleHubApi'],
    ['walkers', /^\/api\/walkers(?:\/|$)/, 'walkers', 'handleWalkersApi'],
    ['poll', /^\/api\/poll(?:\/|$)/, 'poll', 'handlePollApi'],
    ['teams', /^\/api\/teams(?:\/|$)/, 'teams', 'handleTeamsApi'],
    ['eventtime', /^\/api\/eventtime$/, 'event-time', 'handleEventTimeApi'],
    ['parties', /^\/api\/party(?:\/|$)/, 'party', 'handlePartyApi'],
    ['newsticker', /^\/api\/newsticker(?:\/|$)/, 'news', 'handleNewsApi'],
    ['sashimi-signin', /^\/api\/sashimi(?:\/|$)/, 'signups/poke', 'handleSashiApi'],
    ['beanburger-signup', /^\/api\/beanburger-signup(?:\/|$)/, 'signups/burger', 'handleBbsuApi'],
    ['flowtree-signup', /^\/api\/flowtree-signup(?:\/|$)/, 'signups/flow', 'handleFtsuApi'],
    ['aniimo-dex', /^\/api\/aniimo(?:\/|$)/, 'aniimo', 'handleDexApi'],
    ['sprites', /^\/api\/sprites(?:\/|$)/, 'routes/sprites', 'handleSpritesApi', true],
    ['avatars', /^\/api\/avatars(?:\/|$)/, 'avatars', 'handleAvatarsApi'],
    ['countdowns', /^\/api\/countdowns$/, 'countdowns', 'handleCountdownsApi'],
    ['paliaclock', /^\/api\/paliaclock$/, 'palia-clock', 'handlePaliaClockApi'],
    ['hunt', /^\/api\/hunt(?:\/|$)/, 'hunt', 'handleHuntApi'],
    ['oceanfish', /^\/api\/oceanfish$/, 'ocean-fish', 'handleOceanFishApi'],
    ['streamframe', /^\/api\/streamframe$/, 'stream-frame', 'handleStreamFrameApi'],
    ['neonchat', /^\/api\/neonchat$/, 'neon-chat', 'handleNeonChatApi'],
    ['turnline', /^\/api\/turnline$/, 'turn-line', 'handleTurnLineApi'],
    [
        'giveaway',
        /^\/api\/giveaway\/(?:state|event|manual)$/,
        'routes/giveaway-events',
        'handleGiveawayEventsApi',
        true
    ],
    [
        'giveaway',
        /^\/api\/giveaway\/(?:draw|draw-test|winners\/reset)$/,
        'routes/giveaway-draws',
        'handleGiveawayDrawsApi',
        true
    ],
    [
        'giveaway',
        /^\/api\/giveaway\/backups(?:\/|$)/,
        'routes/giveaway-backups',
        'handleGiveawayBackupsApi',
        true
    ],
    ['giveaway', /^\/api\/giveaway(?:\/|$)/, 'routes/giveaway', 'handleGiveawayApi', true]
];

/** Match only known local contracts; no caller-selected module or external URL can be executed. */
function routeFor(raw) {
    if (
        typeof raw !== 'string' ||
        raw.length > 500 ||
        !raw.startsWith('/api/') ||
        /[\x00-\x1f\\]/.test(raw)
    )
        throw fail(400, 'invalid_feature_route');
    const url = new URL(raw, 'http://icb.invalid');
    if (url.origin !== 'http://icb.invalid') throw fail(400, 'invalid_feature_route');
    const route = ROUTES.find((item) => item[1].test(url.pathname));
    if (!route) throw fail(404, 'unknown_feature_route');
    return { route, url };
}

/** Execute the preserved, injected feature handler entirely inside an owner-scoped command. */
async function executeRequest(context, feature, operands) {
    require('../activity/validation').fields(operands, ['path', 'method', 'values']);
    const { route, url } = routeFor(operands.path);
    if (
        route[0] !== feature &&
        !(feature === 'settings' && ['/api/layout', '/api/ticker'].includes(url.pathname))
    )
        throw fail(400, 'feature_route_mismatch');
    const method = operands.method || 'GET';
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
        throw fail(405, 'invalid_feature_method');
    let [model, handler, useUrl] = route.slice(2);
    if (['/api/layout', '/api/ticker'].includes(url.pathname))
        [model, handler, useUrl] = ['routes/settings', 'handleSettingsApi', true];
    let values = operands.values || {};
    if (url.pathname.endsWith('/test') || (feature === 'hunt' && values.test)) {
        const test = feature === 'hunt' ? values.test : values;
        if (
            test.text !== undefined ||
            !test.intent ||
            !validIntent(intentSpec(context), test.intent.command, test.intent.arguments)
        )
            throw fail(400, 'semantic_test_required');
        const intent = test.intent;
        const text =
            '!' +
            (intent.command === 'signup_name'
                ? intent.arguments[0]
                : intent.command +
                  (intent.arguments.length ? ' ' + intent.arguments.join(' ') : ''));
        values =
            feature === 'hunt'
                ? { ...values, test: { name: test.name, text } }
                : { name: test.name, text };
    }
    const request = {
        method,
        url: url.pathname + url.search,
        body: values,
        headers: {}
    };
    const fn = context.use(model)[handler];
    const reply = useUrl
        ? await fn(request, {}, url)
        : await fn(request, {}, url.pathname, method, url);
    if (!reply || !Number.isInteger(reply.status)) throw fail(503, 'feature_response_unavailable');
    if (reply.status >= 400)
        throw Object.assign(fail(reply.status, 'feature_command_rejected'), {
            detail: reply.payload.error
        });
    return reply;
}

/** Resolve due timestamps on requests, never by assuming a Lambda process remains alive. */
function finalizeDue(context) {
    context.use('poll').expirePoll();
    context.use('countdowns').cdTick();
    context.use('hunt').huntTick();
    context.use('palia-clock').checkAlarms();
    context.use('weekly').rolloverWeeklyIfDue();
    const giveaway = context.use('giveaway/state');
    const anchor = Date.parse(giveaway.giveaway.windowStartedAt);
    if (Number.isFinite(anchor) && context.now >= anchor + 600000) giveaway.awardChatWindow();
}

module.exports = { ROUTES, routeFor, executeRequest, finalizeDue };
