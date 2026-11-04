'use strict';
const { randomUUID } = require('node:crypto');
const { transaction } = require('../activity/db');
const { fields, uuid, integer } = require('../activity/validation');
const { fail } = require('../activity/errors');
const repository = require('./repository');
const { byFile } = require('./catalog');
const { createContext } = require('./context');
const { readView, routeFor, finalizeDue } = require('./executor');
const { commitEffects } = require('./effects');
const { sanitize } = require('./contracts');
const { loadRecovery } = require('./recovery');
const { loadAssets } = require('./assets');
const { intentSpec } = require('./intent-spec');
const { integrationFlags } = require('./jobs');
const PAGE_BYTES = 2000000;

/** Page an immutable materialized result; no page reads a different mutable revision. */
function pagesFor(payload) {
    const parts = [{ documents: {}, views: {} }];
    for (const kind of ['documents', 'views'])
        for (const [key, value] of Object.entries(payload[kind])) {
            if (Buffer.byteLength(JSON.stringify(value)) > PAGE_BYTES - 2000)
                throw fail(413, 'feature_snapshot_too_large');
            let part = parts[parts.length - 1];
            part[kind][key] = value;
            if (Buffer.byteLength(JSON.stringify(part)) > PAGE_BYTES) {
                delete part[kind][key];
                part = { documents: {}, views: {} };
                part[kind][key] = value;
                parts.push(part);
            }
        }
    return parts.map((part, page) => ({
        ...payload,
        ...part,
        page,
        complete: page === parts.length - 1
    }));
}

/** One account feed supplies all active local overlays with one coherent owner revision. */
async function stateFeed(db, owner, input) {
    fields(input, ['after', 'paths', 'known_views', 'snapshot_token', 'page']);
    const after =
        input.after === undefined ? 0 : integer(Number(input.after), 0, Number.MAX_SAFE_INTEGER);
    if (input.snapshot_token) {
        uuid(input.snapshot_token);
        const page = integer(Number(input.page || 0), 0, 500);
        return db.withClient(async (client) => {
            const result = await client.query(
                'SELECT payload FROM feature_feed_snapshots WHERE owner_id=$1 AND token=$2 AND page=$3 AND expires_at>now()',
                [owner.id, input.snapshot_token, page]
            );
            if (!result.rowCount) throw fail(409, 'snapshot_expired');
            return result.rows[0].payload;
        });
    }
    const paths = input.paths || [];
    if (!Array.isArray(paths) || paths.length > 150) throw fail(400, 'invalid_feature_paths');
    paths.forEach(routeFor);
    const known = input.known_views || {};
    if (
        typeof known !== 'object' ||
        Array.isArray(known) ||
        Object.keys(known).length > 150 ||
        Object.entries(known).some(
            ([path, hash]) => !paths.includes(path) || !/^[a-f0-9]{64}$/.test(hash)
        )
    )
        throw fail(400, 'invalid_view_digest');
    return transaction(db, async (client) => {
        const clock = await repository.lockOwner(client, owner.id);
        if (after > Number(clock.revision)) throw fail(409, 'invalid_feature_revision');
        const authorities = await repository.authorities(client, owner.id);
        await require('./bootstrap').bootstrapOwner(client, owner, clock, authorities);
        const retained = await client.query(
            'SELECT min(revision) AS oldest FROM feature_changes WHERE owner_id=$1',
            [owner.id]
        );
        const fullSnapshot =
            after === 0 ||
            (retained.rows[0].oldest !== null && after < Number(retained.rows[0].oldest));
        const documents = await repository.loadDocuments(client, owner.id);
        const context = createContext(documents, {
            now: clock.now.getTime(),
            timezone: owner.reporting_timezone,
            assets: await loadAssets(client, owner.id),
            integrations: await integrationFlags(client, owner.id),
            backups: paths.some((path) => path.includes('/backups'))
                ? await loadRecovery(client, owner.id)
                : []
        }).initialize();
        finalizeDue(context);
        const views = {};
        for (const path of paths) {
            const feature = routeFor(path).route[0];
            if (authorities.get(feature)?.mode !== 'cloud') continue;
            views[path] = sanitize(await readView(context, feature, path));
            if (require('../domain/view-digest').viewDigest(views[path]) === known[path])
                delete views[path];
        }
        const revision = await repository.saveChanges(
            client,
            owner.id,
            context,
            clock.revision,
            authorities
        );
        await commitEffects(client, owner, context.effects);
        await require('./display-events').captureDisplayEvents(client, owner.id, context, revision);
        if (authorities.get('giveaway')?.mode === 'cloud')
            await client.query(
                "INSERT INTO integration_jobs(owner_id,kind,due_at) VALUES($1,'maintenance',now()+interval '5 minutes') ON CONFLICT DO NOTHING",
                [owner.id]
            );
        const source = Object.fromEntries(
            Object.entries(context.documents)
                .filter(
                    ([file]) =>
                        byFile.has(file) &&
                        authorities.get(byFile.get(file).feature)?.mode === 'cloud' &&
                        (fullSnapshot || authorities.get(byFile.get(file).feature).revision > after)
                )
                .map(([file, value]) => [file, sanitize(value)])
        );
        const payload = {
            ok: true,
            full_snapshot: fullSnapshot,
            intents: intentSpec(context),
            revision,
            server_time: clock.now.toISOString(),
            authorities: Object.fromEntries(
                [...authorities].map(([key, item]) => [
                    key,
                    {
                        ...item,
                        revision: context.dirty.has(
                            [...byFile.values()].find((entry) => entry.feature === key)?.file
                        )
                            ? revision
                            : item.revision
                    }
                ])
            ),
            documents: source,
            display_events: await require('./display-events').displayEvents(
                client,
                owner.id,
                after
            ),
            views
        };
        const pages = pagesFor(payload);
        await client.query(
            "DELETE FROM feature_changes WHERE owner_id=$1 AND created_at<now()-interval '24 hours'",
            [owner.id]
        );
        await client.query(
            'DELETE FROM feature_feed_snapshots WHERE owner_id=$1 AND expires_at<now()',
            [owner.id]
        );
        await client.query(
            "UPDATE owner_revisions SET active_at=now() WHERE owner_id=$1 AND active_at<now()-interval '30 seconds'",
            [owner.id]
        );
        if (pages.length === 1) return pages[0];
        const token = randomUUID();
        await client.query(
            'DELETE FROM feature_feed_snapshots WHERE owner_id=$1 AND expires_at<now()',
            [owner.id]
        );
        for (const page of pages) {
            page.snapshot_token = token;
            await client.query(
                "INSERT INTO feature_feed_snapshots(owner_id,token,watermark,page,payload,expires_at) VALUES($1,$2,$3,$4,$5::jsonb,now()+interval '2 minutes')",
                [owner.id, token, revision, page.page, JSON.stringify(page)]
            );
        }
        return pages[0];
    });
}

module.exports = { stateFeed, pagesFor };
