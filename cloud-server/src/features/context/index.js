'use strict';
const { randomInt } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { definitions, configuration } = require('./config');
const { documentStorage } = require('./files');
const factories = require('../models');
const { reportingDay } = require('../../activity/reporting-day');
const { runtimeState } = require('./lifetime');

/** Build one isolated owner/transaction graph; factories cannot access the machine filesystem. */
function createContext(documents, options = {}) {
    const now = options.now || Date.now();
    const files = definitions();
    const state = documentStorage(documents, files, now, options);
    const runtime = runtimeState(state.documents, state.storage);
    const modules = new Map();
    const effects = [];
    const notices = [];
    const emitter = new EventEmitter();
    let input = {};
    /** Every deadline and occurrence in one command uses the database's transaction time. */
    class CommandDate extends Date {
        constructor(...args) {
            super(...(args.length ? args : [now]));
        }

        static now() {
            return now;
        }
    }
    const activity = {
        nightKey: (date) => reportingDay(date, options.timezone || 'America/Chicago'),

        logActivity: (entry) =>
            effects.push({ at: new Date(now).toISOString(), ...input, ...entry }),

        withEvent: (body, operation) => {
            const previous = input;
            input = body;
            try {
                return operation();
            } finally {
                input = previous;
            }
        },

        checkpoint: () => [],

        commit: () => true,

        recover: () => {}
    };
    const special = {
        'giveaway/defaults': require('../models/giveaway/defaults'),
        'giveaway/activity': activity,
        'activity/collector': { requireCapacity: () => {}, chat: () => {}, noteProblem: () => {} },

        'activity/listener-lease': { claim: () => true },

        reader: { scanLog: () => {}, forceRescan: false },

        'overlay-diagnostics': {
            noteOverlayRequest: () => {},

            notePoll: () => {},

            record: () => {}
        },
        health: { listenerStatus: {}, healthSummary: () => ({ cloud: true }) }
    };
    const context = {
        ...state,
        runtime,
        effects,
        notices,
        jobs: [],
        integrations: options.integrations || {},
        now,
        timezone: options.timezone || 'America/Chicago',
        Date: CommandDate,
        Math: Object.assign(Object.create(Math), {
            random: () => randomInt(0x100000000) / 0x100000000
        }),
        logger: {
            log: () => notices.push('model_notice'),

            warn: () => notices.push('model_warning')
        },
        config: configuration(files),
        network: {
            steamGet:
                options.steamGet ||
                (() => {
                    throw new Error('integration_worker_required');
                }),
            get: () => {
                throw new Error('integration_worker_required');
            }
        },
        staticFiles: { MIME: {} },
        body: { readBody: async (request) => request.body || {} },

        response: { sendJson: (_response, status, payload) => ({ status, payload }) },

        events: {
            broadcast: (type, payload) => {
                emitter.emit(type, payload);
            },

            on: (...args) => emitter.on(...args),

            off: (...args) => emitter.off(...args),

            clients: new Set(),
            sendSse: () => {}
        },
        /** Resolve explicit factories once, including the existing feature dependency cycles. */
        use(name) {
            if (special[name]) return special[name];
            if (modules.has(name)) return modules.get(name);
            const factory = factories[name];
            if (!factory) throw new Error('unknown_feature_dependency:' + name);
            const instance = {};
            modules.set(name, instance);
            factory(context, instance);
            return instance;
        }
    };
    /** Initialize the same collaborating features without starting timers or mutating durable state. */
    function initialize() {
        for (const name of Object.keys(factories)) context.use(name);
        context.use('sprite-tv').connectSpriteUpdates();
        context
            .use('giveaway/backups')
            .connectGiveaway(() => context.use('giveaway/state').giveaway);
        context
            .use('signups/commands')
            .connectSignups(
                context.use('signups/poke'),
                context.use('signups/burger'),
                context.use('signups/flow')
            );
        context.ready();
        return context;
    }

    context.initialize = initialize;
    return context;
}

module.exports = { createContext };
