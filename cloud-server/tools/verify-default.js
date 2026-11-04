'use strict';
const readline = require('node:readline');
const { request } = require('../../local-server/src/cloud/client');

/** Verify the requested initial password over the real API without writing or echoing it. */
async function main() {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    const input = readline.createInterface({ input: process.stdin, terminal: false });
    for await (const password of input) {
        input.close();
        const base = process.env.ICB_CLOUD_API_URL;
        const login = await request(base, '/v1/login', 'POST', {
            username: 'IJustABabyTV',
            password
        });
        if (login.status !== 200) throw new Error('Default login verification failed.');
        const report = await request(base, '/v1/reports/days', 'GET', undefined, login.data.token);
        const states = await request(base, '/v1/state', 'GET', undefined, login.data.token);
        await request(base, '/v1/logout', 'POST', {}, login.data.token);
        if (report.status !== 200 || states.status !== 200)
            throw new Error('Default account report verification failed.');
        console.info(
            JSON.stringify({
                default_account_login_verified: true,
                case_insensitive: true,
                report_days: report.data.days.length,
                state_files: states.data.states.length
            })
        );
        return;
    }
    throw new Error('Private password input required.');
}

if (require.main === module)
    main().catch(() => {
        console.error('Default account verification failed.');
        process.exitCode = 1;
    });
