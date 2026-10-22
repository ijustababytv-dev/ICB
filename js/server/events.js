'use strict';



const clients = new Set();

/** Write one named SSE event using the framing expected by dashboard clients. */
function sendSse(res, event, payload) {
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


Object.assign(exports, { broadcast, clients, sendSse, clientCounts });
