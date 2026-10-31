'use strict';
const { validIntent } = require('../../../cloud-server/src/features/intent-spec');

/** Convert known local syntax into typed operands and immediately discard the original chat text. */
function parseIntent(text, spec) {
    if (typeof text !== 'string' || !spec?.commands) return null;
    const input = text.trim().replace(/\s+/g, ' ');
    const match = /^!([a-z0-9_]+)\b\s*(.*)$/i.exec(input);
    if (!match) return null;
    const command = match[1].toLowerCase();
    const kind = spec.commands[command];
    let args;
    if (kind === 'none') args = match[2] ? null : [];
    else if (kind === 'numbers') args = (match[2].match(/\d+/g) || []).slice(0, 20);
    else if (kind === 'amount') {
        const amount = /^([+-]?\s*\d{1,6})(?:\s|$)/.exec(match[2]);
        args = amount ? [amount[1].replace(/\s/g, '')] : match[2] ? null : [];
    } else if (kind) args = match[2] ? [match[2].slice(0, 40)] : [];
    else if (spec.name_signup) {
        const name = input.slice(1);
        if (validIntent(spec, 'signup_name', [name]))
            return { command: 'signup_name', arguments: [name] };
        return null;
    } else return null;
    if (!args || !validIntent(spec, command, args)) return null;
    return { command, arguments: args };
}

module.exports = { parseIntent };
