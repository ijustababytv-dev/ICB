'use strict';

/** Publish recognized commands and operand categories; collectors discard unrelated chat immediately. */
function intentSpec(context) {
    const commands = {};
    /** Only configured words that can be safely reconstructed are eligible. */
    function add(word, kind) {
        const key = String(word || '')
            .replace(/^!/, '')
            .toLowerCase();
        if (/^[a-z0-9_]{1,40}$/.test(key)) commands[key] = kind;
    }

    for (const word of [
        'here',
        'checkin',
        'signin',
        'event',
        'leave',
        'signup',
        'dex',
        'mix',
        'shuffle',
        'open',
        'close',
        'undo',
        'unsticker'
    ])
        add(word, 'none');
    for (const word of ['vote', 'unvote']) add(word, 'numbers');
    for (const word of [
        'show',
        'hide',
        'party',
        'poke',
        'pokebowl',
        'pokebowls',
        'bowl',
        'sashimi',
        'burger',
        'burgers',
        'beanburger',
        'beanburgers',
        'flow',
        'flows',
        'flowtree',
        'flowtrees',
        'tree',
        'trees'
    ])
        add(word, 'selector');
    for (const word of [
        'team',
        'join',
        'need',
        'avatar',
        'page',
        'book',
        'stickers',
        'catch',
        'sticker',
        'sprite',
        'caught'
    ])
        add(word, 'name');
    for (let index = 1; index <= 7; index++) {
        add('party' + index, 'none');
        add('leave' + index, 'none');
    }
    add(context.use('turn-line').publicState().joinWord || 'turn', 'none');
    const teams = context.use('teams').teams;
    for (const word of [teams.item.command, ...(teams.item.aliases || '').split(/,\s*/)])
        add(word, 'amount');
    for (const item of context.use('hunt').hunt.items)
        for (const word of [item.command, ...(item.aliases || '').split(/,\s*/)])
            add(word, 'amount');
    for (const event of context.use('party').parties.events)
        for (const role of event.roles || [])
            for (let index = 0; index <= 7; index++)
                if (role.command) add(role.command + (index || ''), 'name');
    let nameSignup = false;
    for (const [module, field] of [
        ['signups/poke', 'sashi'],
        ['signups/burger', 'bbsu'],
        ['signups/flow', 'ftsu']
    ]) {
        const state = context.use(module)[field];
        const event = state.events.find((item) => item.id === state.live);
        for (const role of event?.roles || []) add(role.cmd, 'name');
        if (state.open && event && !event.roles?.length) nameSignup = true;
    }
    return { commands, name_signup: nameSignup };
}

/** Revalidate semantic operands; unknown commands cannot become an archive. */
function validIntent(spec, command, args) {
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) return false;
    if (command === 'signup_name')
        return spec.name_signup && args.length === 1 && /^[\p{L}\p{N} _'.-]{1,32}$/u.test(args[0]);
    const kind = spec.commands[command];
    if (!kind) return false;
    if (kind === 'none') return args.length === 0;
    if (kind === 'numbers')
        return args.length > 0 && args.length <= 20 && args.every((arg) => /^\d{1,3}$/.test(arg));
    if (kind === 'amount')
        return args.length <= 1 && (!args.length || /^[+-]?\d{1,6}$/.test(args[0]));
    return args.length <= 1 && (!args.length || /^[\p{L}\p{N} _'.-]{1,40}$/u.test(args[0]));
}

module.exports = { intentSpec, validIntent };
