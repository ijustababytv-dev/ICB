'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomUUID, createHash } = require('node:crypto');
const { adminDatabase, databaseAdapter } = require('./admin-db');
const { featureSources, projectedHash } = require('./feature-source');
const { importFeature } = require('../src/features/commands');
const repository = require('../src/features/repository');
const { loginName } = require('../src/activity/validation');
const { claimCollector } = require('../src/activity/collectors');

/** Refuse a live local writer; this tool never stops or restarts the stream. */
function localRunning() {
    return new Promise((resolve) => {
        const socket = net.connect(8790, '127.0.0.1');
        socket.setTimeout(1000);
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('error', () => resolve(false));
        socket.once('timeout', () => {
            socket.destroy();
            resolve(false);
        });
    });
}

/** Import each feature once, then verify exact supported fields before allowing the local bridge to start. */
async function cutover(pool, owner, root, apply) {
    if (await localRunning())
        throw new Error(
            'Local server is running; use the normal operator shutdown before cutover.'
        );
    const directory = path.join(root, 'data');
    const outboxFile = path.join(directory, 'activity-outbox.json');
    const outbox = fs.existsSync(outboxFile)
        ? JSON.parse(fs.readFileSync(outboxFile, 'utf8'))
        : null;
    if (outbox && [...outbox.pending, ...outbox.quarantine].some((item) => item.kind !== 'state'))
        throw new Error(
            'Drain or explicitly reconcile pending activity before cutover. No ticket events were discarded.'
        );
    let sources = featureSources(directory, root);
    if (!apply)
        return {
            preview: true,
            features: sources.map(({ entry, exists, sha256 }) => ({
                feature: entry.feature,
                source: exists ? 'current file' : 'initial defaults',
                sha256
            }))
        };
    const completed = await pool.query(
        'SELECT count(*) AS n FROM feature_migrations WHERE owner_id=$1',
        [owner.id]
    );
    const resuming = fs.existsSync(path.join(directory, '.feature-cutover.json'));
    if (Number(completed.rows[0].n) === sources.length && !resuming)
        return { ok: true, already_complete: true, features: sources.length };
    if (Number(completed.rows[0].n) > 0 && !resuming)
        throw new Error('A partial cutover requires its original frozen manifest and backup.');
    if (outbox?.bound_owner && outbox.bound_owner !== owner.id)
        throw new Error('The transport checkpoint belongs to another owner.');
    const { freezeSources } = require('./cutover-freeze');
    const checkpoint = freezeSources(
        root,
        owner.id,
        sources,
        outbox?.collector_id,
        outbox?.last_ack
            ? JSON.stringify(outbox.last_ack)
            : 'no-pending-inputs:' + new Date().toISOString()
    );
    sources = checkpoint.sources;
    const { backup, lock, frozen } = checkpoint;
    const db = databaseAdapter(pool);
    const collector = frozen.collector_id;
    const watermark = frozen.watermark;
    await claimCollector(db, owner, collector);
    const results = [];
    const steam = sources.find((source) => source.entry.feature === 'steam');
    const legacyKey = steam && JSON.parse(steam.source.toString('utf8')).apiKey;
    if (legacyKey) {
        const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
        const secrets = new SecretsManagerClient({});
        try {
            await require('../src/features/integrations').putSteamSecret(
                db,
                owner.id,
                { command_id: frozen.steam_command_id, api_key: legacyKey },
                secrets,
                {
                    INTEGRATION_SECRET_PREFIX:
                        process.env.INTEGRATION_SECRET_PREFIX ||
                        (process.env.TF_VAR_db_identifier || 'baby-icb-postgres').slice(0, 40) +
                            '-integrations/'
                }
            );
        } finally {
            secrets.destroy();
        }
    }
    for (const source of sources) {
        await claimCollector(db, owner, collector);
        if (
            source.exists &&
            createHash('sha256').update(fs.readFileSync(source.file)).digest('hex') !==
                source.sha256
        )
            throw new Error('Frozen feature source changed: ' + source.entry.file);
        await importFeature(db, owner, source.entry.feature, {
            command_id: randomUUID(),
            collector_id: collector,
            source_sha256: source.sha256,
            input_watermark: watermark.slice(0, 240),
            payload: source.payload
        });
        const documents = await db.withClient((client) =>
            repository.loadDocuments(client, owner.id)
        );
        const expected = projectedHash(source.payload, source.payload);
        const actual = projectedHash(source.payload, documents[source.entry.file]);
        if (expected !== actual)
            throw new Error('Imported feature comparison failed: ' + source.entry.feature);
        results.push({
            feature: source.entry.feature,
            source_sha256: source.sha256,
            verified_sha256: actual
        });
    }
    const transport = outbox || { version: 1, collector_id: collector, last_ack: null };
    transport.pending = [];
    transport.quarantine = [];
    transport.feature_sequence = Number(
        (
            await pool.query(
                'SELECT sequence FROM collector_sequences WHERE owner_id=$1 AND collector_id=$2',
                [owner.id, collector]
            )
        ).rows[0]?.sequence || 0
    );
    transport.feature_protocol = 2;
    transport.bound_owner = owner.id;
    fs.writeFileSync(outboxFile + '.tmp', JSON.stringify(transport));
    fs.renameSync(outboxFile + '.tmp', outboxFile);
    fs.writeFileSync(
        path.join(backup, 'verification.json'),
        JSON.stringify({ owner: owner.id, watermark, features: results }, null, 2)
    );
    if (legacyKey && steam.exists) {
        const cleaned = JSON.parse(steam.source.toString('utf8'));
        delete cleaned.apiKey;
        fs.writeFileSync(steam.file + '.tmp', JSON.stringify(cleaned, null, 2));
        fs.renameSync(steam.file + '.tmp', steam.file);
    }
    fs.unlinkSync(lock);
    return { ok: true, verified: results.length, backup: path.relative(root, backup) };
}

/** Explicit administrative cutover; no local feature file is ever loaded as a runtime fallback. */
async function main() {
    const pool = adminDatabase();
    try {
        const owner = (
            await pool.query('SELECT id,reporting_timezone FROM accounts WHERE login_name=$1', [
                loginName(process.env.ICB_ACCOUNT_USERNAME || 'ijustababytv')
            ])
        ).rows[0];
        if (!owner) throw new Error('Account required.');
        console.info(
            JSON.stringify(
                await cutover(
                    pool,
                    owner,
                    path.resolve(__dirname, '../..'),
                    process.argv.includes('--apply')
                ),
                null,
                2
            )
        );
    } finally {
        await pool.end();
    }
}

if (require.main === module)
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
module.exports = { cutover };
