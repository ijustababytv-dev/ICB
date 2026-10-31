'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { executeCommand } = require('../../src/features/commands');
const repository = require('../../src/features/repository');
const { claimJob } = require('../../src/worker/jobs');
const { maintenance } = require('../../src/worker/maintenance');
const { loadRecovery } = require('../../src/features/recovery');
const { featureReport } = require('../../src/features/reports');

/** Recovery, weighted drawings and immutable receipts share real SQL transactions and limited service grants. */
async function verifyRecoveryProtocol(pool, db, owner) {
    async function command(path, values) {
        const revision = (
            await db.withClient((client) => repository.authorities(client, owner.id))
        ).get('giveaway').revision;
        const body = {
            protocol_version: 2,
            command_id: randomUUID(),
            expected_revision: revision,
            action: 'request',
            operands: { path, method: 'POST', values }
        };
        return { body, result: await executeCommand(db, owner, 'giveaway', body) };
    }

    await command('/api/giveaway/manual', { username: 'Guest', amount: 5 });
    const draw = await command('/api/giveaway/draw', { prize: 'plushie' });
    assert.equal(
        (await executeCommand(db, owner, 'giveaway', draw.body)).payload.winner.draw_id,
        draw.result.payload.winner.draw_id
    );
    const stored = (
        await pool.query('SELECT eligibility,rates,result FROM giveaway_draws WHERE owner_id=$1', [
            owner.id
        ])
    ).rows;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].eligibility[0].tickets, 6);
    assert.equal(stored[0].result.username, 'Guest');
    assert.equal(stored[0].rates.bitsPerUnicorn, 100);
    await pool.query(
        "INSERT INTO integration_jobs(owner_id,kind,due_at) VALUES($1,'maintenance',now()) ON CONFLICT(owner_id,kind) DO UPDATE SET due_at=now()",
        [owner.id]
    );
    const claims = await Promise.all([claimJob(db), claimJob(db)]);
    const job = claims.find(Boolean);
    assert.ok(job);
    assert.equal(claims.filter(Boolean).length, 1);
    await maintenance(db, job);
    const snapshots = (
        await pool.query(
            "SELECT backup_name FROM feature_undo WHERE owner_id=$1 AND feature='giveaway' ORDER BY backup_name",
            [owner.id]
        )
    ).rows;
    assert.equal(snapshots.length, 2);
    const automatic = snapshots.find((row) => row.backup_name.startsWith('auto_')).backup_name;
    const metadata = await db.withClient((client) => loadRecovery(client, owner.id));
    assert.ok(
        metadata.every(([, content]) => content === '{}'),
        'Ordinary commands load no historical payloads.'
    );
    assert.ok(Object.values(metadata.metadata).every((entry) => entry.unicorns === 6));
    await command('/api/giveaway/manual', { username: 'Guest', amount: 7 });
    await command('/api/giveaway/backups/restore', { file: automatic });
    const after = (
        await pool.query(
            "SELECT tickets FROM giveaway_entrants WHERE owner_id=$1 AND name_key='Guest'",
            [owner.id]
        )
    ).rows[0];
    assert.equal(after.tickets, '6');
    assert.equal((await featureReport(db, owner, 'draws', {})).rows.length, 1);
    const archives = await featureReport(db, owner, 'archives', {});
    assert.ok(archives.rows.length >= 3);
    assert.ok(archives.rows.every((row) => row.before_state === undefined));
}

module.exports = { verifyRecoveryProtocol };
