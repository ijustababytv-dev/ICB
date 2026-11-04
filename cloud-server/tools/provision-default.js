'use strict';
const readline = require('node:readline');
const { adminDatabase } = require('./admin-db');
const { provisionAccount } = require('./account');

/** Consume one private stdin line so the initial account password never enters a command argument or source file. */
async function main() {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    const input = readline.createInterface({ input: process.stdin, terminal: false });
    for await (const line of input) {
        input.close();
        const pool = adminDatabase();
        try {
            await provisionAccount(pool, 'ijustababytv', line);
            console.info('Default account provisioned with case-insensitive login.');
        } finally {
            await pool.end();
        }
        return;
    }
    throw new Error('Private password input required.');
}

if (require.main === module)
    main().catch(() => {
        console.error('Default account provisioning failed.');
        process.exitCode = 1;
    });
