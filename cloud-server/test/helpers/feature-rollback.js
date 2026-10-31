'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { exportFeature, resumeFeature } = require('../../tools/feature-recovery');
const { restoreFeature } = require('../../tools/restore-feature');
const { executeCommand } = require('../../src/features/commands');
const { claimCollector } = require('../../src/activity/collectors');

/** Fresh exports fence every writer; rollback creates a new revision and retains the displaced cloud state. */
async function verifyFeatureRollback(pool, db, owner, collector) {
    const before = await exportFeature(db, owner, 'todos', false);
    const oldValue = before.payload.daily[0].current;
    await executeCommand(db, owner, 'todos', {
        protocol_version: 2,
        command_id: randomUUID(),
        expected_revision: before.feature_revision,
        action: 'request',
        operands: {
            path: '/api/todos/daily/' + before.payload.daily[0].id,
            method: 'PATCH',
            values: { delta: 1 }
        }
    });
    const current = await exportFeature(db, owner, 'todos', true);
    await assert.rejects(() => claimCollector(db, owner, collector), /feature_cutover_in_progress/);
    await assert.rejects(
        () =>
            executeCommand(db, owner, 'todos', {
                protocol_version: 2,
                command_id: randomUUID(),
                expected_revision: current.feature_revision,
                action: 'request',
                operands: { path: '/api/todos/daily', method: 'POST', values: { text: 'blocked' } }
            }),
        /feature_not_migrated/
    );
    const bad = structuredClone(current);
    bad.payload.daily[0].current++;
    await assert.rejects(() => resumeFeature(db, owner, bad), /verification/);
    const id = randomUUID();
    const restored = await restoreFeature(db, owner, current, before, id);
    assert.equal(
        (await restoreFeature(db, owner, current, before, id)).revision,
        restored.revision
    );
    assert.equal(
        Number(
            (await pool.query('SELECT current FROM todos WHERE owner_id=$1', [owner.id])).rows[0]
                .current
        ),
        oldValue
    );
    assert.equal(
        (
            await pool.query(
                'SELECT count(*) AS n FROM feature_undo WHERE owner_id=$1 AND feature=$2 AND id=$3',
                [owner.id, 'todos', id]
            )
        ).rows[0].n,
        '1'
    );
    await claimCollector(db, owner, collector);
}

module.exports = { verifyFeatureRollback };
