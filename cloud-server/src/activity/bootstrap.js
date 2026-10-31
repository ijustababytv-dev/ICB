'use strict';
const { createDatabase } = require('./db');
const { createApp } = require('./app');
const db = createDatabase();
const server = createApp(db).listen(Number(process.env.PORT || 8080), '0.0.0.0');

/** Release the HTTP listener and pooled database sockets on a normal shutdown. */
async function shutdown() {
    server.close();
    await db.close();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
