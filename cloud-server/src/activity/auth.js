'use strict';
const express = require('express');
const { createHash, randomBytes } = require('node:crypto');
const { verifyPassword } = require('./passwords');
const { fields, loginName } = require('./validation');
const { transaction } = require('./db');
const { fail } = require('./errors');

/** Hash opaque tokens and source throttle keys without persisting their original values. */
function digest(value) {
    return createHash('sha256').update(value).digest('hex');
}

/** Require an active owner session; caller-supplied ownership is never trusted. */
function authenticate(db) {
    return async function sessionMiddleware(req, _res, next) {
        const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
        if (!match) throw fail(401, 'authentication_required');
        const result = await db.withClient((client) =>
            client.query(
                `SELECT a.id, a.login_name, a.reporting_timezone, a.live_cutover_at, s.token_hash
             FROM sessions s JOIN accounts a ON a.id=s.owner_id
             WHERE s.token_hash=$1 AND NOT s.revoked AND s.expires_at>now() AND a.enabled`,
                [digest(match[1])]
            )
        );
        if (!result.rowCount) throw fail(401, 'authentication_required');
        req.owner = result.rows[0];
        next();
    };
}

/** Expose only non-sensitive account settings. */
function publicAccount(owner) {
    return {
        id: owner.id,
        username: owner.login_name,
        timezone: owner.reporting_timezone,
        cutover_at: owner.live_cutover_at
    };
}

/** Build login/logout routes with database-backed account and source throttles. */
function authRoutes(db) {
    const router = express.Router();
    router.post('/login', async (req, res) => {
        fields(req.body, ['username', 'password']);
        let login;
        try {
            login = loginName(req.body.username);
        } catch (_error) {
            login = '__invalid__';
        }
        const password = req.body.password;
        if (typeof password !== 'string' || Buffer.byteLength(password) > 256)
            throw fail(401, 'invalid_login');
        // API Gateway adds the real source as the first forwarded address; the adapter is the only caller.
        const source = process.env.AWS_LAMBDA_FUNCTION_NAME
            ? String(req.headers['x-forwarded-for'] || '').split(',')[0]
            : req.ip;
        const keys = [digest('account:' + login), digest('source:' + source)];
        const permitted = await transaction(db, async (client) => {
            for (const key of [...keys].sort()) {
                const result = await client.query(
                    `INSERT INTO login_attempts(attempt_key,failures,expires_at)
                    VALUES($1,1,now()+interval '10 minutes') ON CONFLICT(attempt_key) DO UPDATE SET
                    failures=CASE WHEN login_attempts.expires_at<=now() THEN 1 ELSE login_attempts.failures+1 END,
                    expires_at=CASE WHEN login_attempts.expires_at<=now() THEN now()+interval '10 minutes' ELSE login_attempts.expires_at END
                    RETURNING failures`,
                    [key]
                );
                if (result.rows[0].failures > (key === keys[0] ? 10 : 40)) return false;
            }
            return true;
        });
        if (!permitted) throw fail(429, 'login_throttled');
        const result = await db.withClient((client) =>
            client.query('SELECT * FROM accounts WHERE login_name=$1', [login])
        );
        const account = result.rows[0];
        if (!(await verifyPassword(password, account)) || !account.enabled)
            throw fail(401, 'invalid_login');
        const token = randomBytes(32).toString('base64url');
        await transaction(db, async (client) => {
            await client.query('DELETE FROM login_attempts WHERE attempt_key=$1', [keys[0]]);
            await client.query(
                `INSERT INTO sessions(token_hash,owner_id,expires_at) VALUES($1,$2,now()+interval '7 days')`,
                [digest(token), account.id]
            );
        });
        res.json({ ok: true, token, account: publicAccount(account) });
    });
    router.get('/me', authenticate(db), (req, res) =>
        res.json({ ok: true, account: publicAccount(req.owner) })
    );
    router.post('/logout', authenticate(db), async (req, res) => {
        fields(req.body, []);
        await db.withClient((client) =>
            client.query('UPDATE sessions SET revoked=true WHERE token_hash=$1 AND owner_id=$2', [
                req.owner.token_hash,
                req.owner.id
            ])
        );
        res.json({ ok: true });
    });
    return router;
}

module.exports = { authenticate, authRoutes, publicAccount, digest };
