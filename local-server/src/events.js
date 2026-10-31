'use strict';

const clients = new Set();
const adapters = new Map();
let metadata = () => null;

/** Machine-only diagnostics may decorate confirmed DTOs without changing cloud feature state. */
function localize(event, payload) {
    return adapters.has(event) ? adapters.get(event)(payload) : payload;
}

/** Composition modules register render adapters explicitly, avoiding circular feature imports. */
function adapt(event, operation) {
    adapters.set(event, operation);
}

/** Write one named SSE event using the framing expected by dashboard clients. */
function sendSse(res, event, payload) {
    const info = metadata();
    const serialized = info && JSON.stringify(info);
    if (serialized && res.icbMetadata !== serialized) {
        res.icbMetadata = serialized;
        res.write(`event: icb-revisions\ndata: ${serialized}\n\n`);
    }
    payload = localize(event, payload);
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/** Fan out a snapshot and remove disconnected clients without interrupting other consumers. */
function broadcast(event, payload) {
    for (const client of clients) {
        try {
            sendSse(client, event, payload);
        } catch (_error) {
            clients.delete(client);
        }
    }
}

/** Count connection roles so the dashboard can verify a real overlay connection. */
function clientCounts() {
    // Lets the dashboard confirm the Meld overlay is genuinely connected
    // instead of asking the operator to eyeball it.
    const counts = { control: 0, overlay: 0, other: 0 };
    for (const client of clients) counts[client.icbRole || 'other'] += 1;
    return counts;
}

exports.setMetadata = (read) => {
    metadata = read;
};

Object.assign(exports, { broadcast, clients, sendSse, clientCounts, adapt, localize });
