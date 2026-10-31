'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { importFeature, executeCommand } = require('../../src/features/commands');
const { gameFact } = require('../../../local-server/src/domain/game-facts');
const repository = require('../../src/features/repository');

/** Real parser facts cross the validated command boundary and retain one receipt even after re-batching. */
async function verifyGameProtocol(pool, db, owner, collector) {
    for (const feature of [
        'live',
        'resource-trackers',
        'weekly-accomplishments',
        'tradeup-config',
        'tradeup-state'
    ])
        await importFeature(db, owner, feature, {
            command_id: randomUUID(),
            collector_id: collector,
            source_sha256: 'd'.repeat(64),
            input_watermark: 'fixture:game',
            payload:
                feature === 'live'
                    ? {
                          resources: { amber: 2, essence: 3, sweetLeaf: 4 },
                          reconciliation: { required: false }
                      }
                    : {}
        });
    let sequence = Number(
        (
            await pool.query(
                'SELECT sequence FROM collector_sequences WHERE owner_id=$1 AND collector_id=$2',
                [owner.id, collector]
            )
        ).rows[0]?.sequence || 0
    );
    const session = randomUUID();
    const now = new Date().toISOString();
    const envelope = (action, operands) => ({
        protocol_version: 2,
        command_id: randomUUID(),
        expected_revision: 0,
        action,
        collector_id: collector,
        operands: {
            sequence: ++sequence,
            source_key: randomUUID(),
            at: now,
            session_id: session,
            ...operands
        }
    });

    const start = envelope('collector_start', {});
    await executeCommand(db, owner, 'live', start);
    const facts = [
        'Inventory gained: itemtype_crop_apple (1*) x5',
        'Inventory lost: itemtype_fertilizer_harvestbooster x2'
    ].map((line, n) => ({ source_key: session + ':' + n, at: now, fact: gameFact(line) }));
    assert.equal(gameFact('Primary gained: itemtype_crop_apple x999'), null);
    const first = envelope('game', { facts });
    assert.equal((await executeCommand(db, owner, 'live', first)).payload.accepted, 2);
    assert.equal((await executeCommand(db, owner, 'live', first)).duplicate, true);
    assert.equal(
        (await executeCommand(db, owner, 'live', envelope('game', { facts: [facts[0]] }))).payload
            .accepted,
        0
    );
    const changed = envelope('game', {
        facts: [
            {
                ...facts[0],
                fact: { ...facts[0].fact, items: [{ ...facts[0].fact.items[0], quantity: 500 }] }
            }
        ]
    });
    await assert.rejects(
        () => executeCommand(db, owner, 'live', changed),
        /game_source_content_changed/
    );
    sequence--;
    const documents = await db.withClient((client) => repository.loadDocuments(client, owner.id));
    assert.equal(documents['weekly-accomplishments.json'].progress['crops-30'].count, 5);
    assert.equal(documents['weekly-accomplishments.json'].progress['fertilizer-30'].count, 2);
    assert.equal(
        (
            await pool.query('SELECT count(*) AS n FROM game_event_receipts WHERE owner_id=$1', [
                owner.id
            ])
        ).rows[0].n,
        '2'
    );
    assert.equal((await executeCommand(db, owner, 'live', start)).duplicate, true);
    const replay = envelope('game', { facts });
    assert.equal((await executeCommand(db, owner, 'live', replay)).payload.accepted, 0);
}

module.exports = { verifyGameProtocol };
