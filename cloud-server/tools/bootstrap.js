'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { adminDatabase } = require('./admin-db');
const { migrate } = require('./migrate');
const { executeGroup, applyGrants, applySchemaPermissions } = require('./schema');

/** Bootstrap separate SQL roles and preserve their generated credentials only in ignored local env files. */
async function main() {
    const root = path.resolve(__dirname, '../..');
    const privateFile = path.join(root, 'database/.env.admin');
    const exists = fs.existsSync(privateFile);
    const saved = exists ? JSON.parse(fs.readFileSync(privateFile, 'utf8')) : null;
    const migrationPassword = saved?.migration_password || randomBytes(32).toString('hex');
    const servicePassword =
        process.env.TF_VAR_activity_db_password ||
        saved?.service_password ||
        randomBytes(32).toString('hex');
    const master = adminDatabase();
    try {
        const roles = await master.query(
            "SELECT rolname FROM pg_roles WHERE rolname IN ('icb_migrator','icb_service')"
        );
        if (roles.rowCount && !exists)
            throw new Error('Existing roles require their original private credential file.');
        const client = await master.connect();
        try {
            await client.query(
                "SELECT set_config('icb.migration_password',$1,false),set_config('icb.service_password',$2,false)",
                [migrationPassword, servicePassword]
            );
            await client.query('BEGIN');
            try {
                await executeGroup(client, 'bootstrap');
                await executeGroup(client, 'schemas');
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
        } finally {
            client.release();
        }
        // Persist privately before using the generated roles so a failed migration remains recoverable.
        fs.writeFileSync(
            privateFile,
            JSON.stringify({
                migration_password: migrationPassword,
                service_password: servicePassword
            })
        );
        const migration = adminDatabase({
            ...process.env,
            PGUSER: 'icb_migrator',
            PGPASSWORD: migrationPassword
        });
        try {
            await migrate(migration);
            await applySchemaPermissions(master);
            await applyGrants(migration);
        } finally {
            await migration.end();
        }
        const tfEnv = path.join(root, 'terraform/.env');
        let content = fs.readFileSync(tfEnv, 'utf8');
        if (!/^TF_VAR_activity_db_password=/m.test(content)) {
            content += '\nTF_VAR_activity_db_password=' + servicePassword + '\n';
            fs.writeFileSync(tfEnv, content);
        }
        console.info(
            'Migration/service roles, schema, limited grants, and private credentials are ready.'
        );
    } finally {
        await master.end();
    }
}

if (require.main === module)
    main().catch(() => {
        console.error(
            'Database bootstrap failed; preserve private role credentials before retrying.'
        );
        process.exitCode = 1;
    });
