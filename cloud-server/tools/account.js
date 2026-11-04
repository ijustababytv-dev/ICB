'use strict';
const { randomUUID } = require('node:crypto');
const { adminDatabase } = require('./admin-db');
const { hashPassword } = require('../src/activity/passwords');
const { loginName } = require('../src/activity/validation');

/** Provision one case-insensitive account; existing passwords require explicit rotation. */
async function provisionAccount(
    pool,
    username,
    password,
    timezone = 'America/Chicago',
    rotate = false
) {
    const name = loginName(username);
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date());
    const existing = await pool.query('SELECT id FROM accounts WHERE login_name=$1', [name]);
    if (existing.rowCount && !rotate) return existing.rows[0].id;
    const credentials = await hashPassword(password);
    const result = await pool.query(
        `INSERT INTO accounts(id,login_name,password_salt,password_hash,scrypt_n,scrypt_r,scrypt_p,reporting_timezone)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(login_name) DO UPDATE SET
        password_salt=EXCLUDED.password_salt,password_hash=EXCLUDED.password_hash,scrypt_n=EXCLUDED.scrypt_n,
        scrypt_r=EXCLUDED.scrypt_r,scrypt_p=EXCLUDED.scrypt_p RETURNING id`,
        [
            randomUUID(),
            name,
            credentials.salt,
            credentials.hash,
            credentials.n,
            credentials.r,
            credentials.p,
            timezone
        ]
    );
    return result.rows[0].id;
}

/** Read passwords only from the invoking process environment, never from CLI arguments. */
async function main() {
    const pool = adminDatabase();
    try {
        if (!process.env.ICB_ACCOUNT_PASSWORD) throw new Error('Missing private account password.');
        await provisionAccount(
            pool,
            process.env.ICB_ACCOUNT_USERNAME || 'ijustababytv',
            process.env.ICB_ACCOUNT_PASSWORD,
            process.env.ICB_REPORTING_TIMEZONE || 'America/Chicago',
            process.argv.includes('--rotate')
        );
        console.info('Account provisioned.');
    } finally {
        await pool.end();
    }
}

if (require.main === module)
    main().catch(() => {
        console.error('Account provisioning failed.');
        process.exitCode = 1;
    });
module.exports = { provisionAccount };
