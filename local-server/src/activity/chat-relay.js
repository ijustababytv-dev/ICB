'use strict';
const walkers = require('../walkers');
const avatars = require('../avatars');
const neonChat = require('../neon-chat');
const { partyDecode } = require('../domain/chat-text');
const { parseIntent } = require('../domain/feature-intents');
const feed = require('../cloud/state-feed');
const inputs = require('../cloud/inputs');

/** Original chat text reaches local RAM graphics only; cloud receives recognized commands and bounded operands. */
function relayChat(data, metadata = {}) {
    if (!data || typeof data.sender !== 'string') return;
    const parts = walkers.walkerParts(data);
    neonChat.neonChatRelay(data, parts);
    walkers.walkerChat(data.sender, parts, false);
    avatars.avChat(data.sender, parts);
    const intent = parseIntent(
        partyDecode(
            parts
                .filter((part) => part.t === 'text')
                .map((part) => part.v)
                .join(' ')
        ),
        feed.intents()
    );
    if (!intent) return;
    const source = metadata.source_id
        ? [metadata.platform || 'twitch', 'command', metadata.source_id].join(':')
        : undefined;
    return inputs.enqueue('giveaway', 'intent', {
        kind: 'command',
        sender: data.sender,
        ...intent,
        ...(source ? { source_key: source } : {})
    });
}

module.exports = { relayChat };
