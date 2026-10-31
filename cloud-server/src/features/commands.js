'use strict';
const { transaction } = require('../activity/db');
const { fail } = require('../activity/errors');
const contracts = require('./contracts');
const repository = require('./repository');
const { descriptor } = require('./catalog');
const { createContext } = require('./context');
const { executeRequest, finalizeDue } = require('./executor');
const { commitEffects } = require('./effects');
const { claimInput, applyIntent, applyGame } = require('./inputs');
const { loadRecovery, saveRecovery } = require('./recovery');
const { loadAssets } = require('./assets');
const { scheduleJobs, integrationFlags } = require('./jobs');

/** Commit a retry-stable command, all affected feature rows, revisions and summaries atomically. */
async function executeCommand(db, owner, feature, input) {
    descriptor(feature);
    const body = contracts.command(input);
    const hash = contracts.digest(body);
    return transaction(db, async (client) => {
        const clock = await repository.lockOwner(client, owner.id);
        const previous = await client.query(
            'SELECT digest,result FROM feature_commands WHERE owner_id=$1 AND feature=$2 AND command_id=$3',
            [owner.id, feature, body.command_id]
        );
        if (previous.rowCount) {
            if (previous.rows[0].digest !== hash) throw fail(409, 'command_content_changed');
            return { ...previous.rows[0].result, duplicate: true };
        }
        const authorities = await repository.authorities(client, owner.id);
        const active = authorities.get(feature);
        if (!active || active.mode !== 'cloud') throw fail(409, 'feature_not_migrated');
        if (body.action === 'request' && active.revision !== body.expected_revision)
            throw fail(409, 'stale_feature_revision');
        const collected = ['intent', 'game', 'collector_start'].includes(body.action);
        if (
            (body.action === 'intent' && feature !== 'giveaway') ||
            (['game', 'collector_start'].includes(body.action) && feature !== 'live')
        )
            throw fail(400, 'feature_action_mismatch');
        if (collected && !(await claimInput(client, owner, body))) {
            const result = {
                ok: true,
                duplicate: true,
                revision: Number(clock.revision),
                feature_revision: active.revision,
                status: 200,
                payload: { ok: true },
                server_time: clock.now.toISOString()
            };
            await client.query(
                'INSERT INTO feature_commands(owner_id,feature,command_id,digest,revision,result) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
                [owner.id, feature, body.command_id, hash, result.revision, JSON.stringify(result)]
            );
            return result;
        }
        const documents = await repository.loadDocuments(client, owner.id);
        const context = createContext(documents, {
            now: clock.now.getTime(),
            timezone: owner.reporting_timezone,
            backups: feature === 'giveaway' ? await loadRecovery(client, owner.id) : [],
            assets: await loadAssets(client, owner.id),
            integrations: await integrationFlags(client, owner.id)
        }).initialize();
        finalizeDue(context);
        let reply;
        if (body.action === 'request')
            reply = await executeRequest(context, feature, body.operands);
        else if (body.action === 'intent')
            reply = await applyIntent(context, body.operands, client, owner);
        else if (body.action === 'game') reply = applyGame(context, body.operands);
        else if (body.action === 'collector_start') {
            context.use('resources').resetCountdownStock();
            context.use('tradeup').resetBoard();
            reply = { status: 200, payload: { ok: true } };
        } else throw fail(400, 'unsupported_feature_action');
        const revision = await repository.saveChanges(
            client,
            owner.id,
            context,
            clock.revision,
            authorities
        );
        await commitEffects(client, owner, context.effects);
        await saveRecovery(client, owner.id, context, revision);
        await scheduleJobs(client, owner.id, context);
        const result = {
            ok: true,
            revision,
            feature_revision: context.dirty.has(descriptor(feature).file)
                ? revision
                : active.revision,
            status: reply.status,
            payload: reply.payload,
            server_time: clock.now.toISOString()
        };
        if (Buffer.byteLength(JSON.stringify(result)) > 2000000)
            throw fail(413, 'feature_result_too_large');
        await client.query(
            'INSERT INTO feature_commands(owner_id,feature,command_id,digest,revision,result) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
            [owner.id, feature, body.command_id, hash, revision, JSON.stringify(result)]
        );
        return {
            ...result,
            documents: Object.fromEntries(
                [...context.dirty]
                    .filter(
                        (file) =>
                            require('./catalog').byFile.has(file) &&
                            authorities.get(require('./catalog').byFile.get(file).feature)?.mode ===
                                'cloud'
                    )
                    .map((file) => [file, contracts.sanitize(context.documents[file])])
            )
        };
    });
}

/** One frozen local feature import establishes authority; repeated imports cannot overwrite cloud progress. */
async function importFeature(db, owner, feature, body) {
    const entry = descriptor(feature);
    const { fields, uuid } = require('../activity/validation');
    fields(body, ['command_id', 'source_sha256', 'input_watermark', 'payload', 'collector_id']);
    uuid(body.command_id);
    uuid(body.collector_id);
    if (
        !/^[a-f0-9]{64}$/.test(body.source_sha256) ||
        typeof body.input_watermark !== 'string' ||
        body.input_watermark.length > 240 ||
        /[\x00-\x1f]/.test(body.input_watermark)
    )
        throw fail(400, 'invalid_feature_import');
    const payload = contracts.sanitize(body.payload);
    contracts.safeValue(payload);
    return transaction(db, async (client) => {
        const clock = await repository.lockOwner(client, owner.id);
        const saved = await client.query(
            'SELECT source_sha256,revision FROM feature_migrations WHERE owner_id=$1 AND feature=$2',
            [owner.id, feature]
        );
        if (saved.rowCount) {
            if (saved.rows[0].source_sha256 !== body.source_sha256)
                throw fail(409, 'feature_already_migrated');
            return { ok: true, duplicate: true, revision: Number(saved.rows[0].revision) };
        }
        const lease = await client.query(
            'SELECT collector_id FROM collector_leases WHERE owner_id=$1 AND expires_at>now()',
            [owner.id]
        );
        if (lease.rows[0]?.collector_id !== body.collector_id)
            throw fail(409, 'collector_lease_expired');
        const revision = Number(clock.revision) + 1;
        await repository.saveDocument(client, owner.id, entry.file, payload);
        await client.query(
            "INSERT INTO feature_authority(owner_id,feature,mode,revision) VALUES($1,$2,'cloud',$3)",
            [owner.id, feature, revision]
        );
        await client.query(
            'INSERT INTO feature_migrations(owner_id,feature,source_sha256,cutover_at,input_watermark,revision) VALUES($1,$2,$3,now(),$4,$5)',
            [owner.id, feature, body.source_sha256, body.input_watermark, revision]
        );
        await client.query(
            'INSERT INTO feature_changes(owner_id,revision,feature,snapshot) VALUES($1,$2,$3,$4::jsonb)',
            [owner.id, revision, feature, JSON.stringify(payload)]
        );
        await client.query('UPDATE owner_revisions SET revision=$2 WHERE owner_id=$1', [
            owner.id,
            revision
        ]);
        return { ok: true, revision, feature_revision: revision };
    });
}

module.exports = { executeCommand, importFeature };
