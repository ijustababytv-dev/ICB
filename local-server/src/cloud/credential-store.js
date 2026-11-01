'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const config = require('../config');

/** Use Windows CurrentUser DPAPI; sensitive bytes travel only through anonymous process pipes. */
function protect(bytes, decrypt = false) {
    if (process.platform !== 'win32') throw new Error('secure_storage_unavailable');
    const operation = decrypt ? 'Unprotect' : 'Protect';
    const script = `
        $ErrorActionPreference='Stop'
        try {
            Add-Type -AssemblyName System.Security
            $icbBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd())
            $icbEntropy=[Text.Encoding]::UTF8.GetBytes('ICB cloud session v1')
            $icbResult=[Security.Cryptography.ProtectedData]::${operation}(
                $icbBytes,$icbEntropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
            [Console]::Out.Write([Convert]::ToBase64String($icbResult))
        } catch { exit 1 }
    `;
    try {
        const output = execFileSync(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', script],
            {
                input: bytes.toString('base64'),
                encoding: 'utf8',
                windowsHide: true,
                timeout: 10000,
                maxBuffer: 65536,
                stdio: ['pipe', 'pipe', 'pipe']
            }
        );
        return Buffer.from(output.trim(), 'base64');
    } catch (_error) {
        throw new Error('secure_storage_unavailable');
    }
}

/** Keep production credentials outside OneDrive/repository backups; test data overrides remain isolated. */
function defaultFile() {
    if (process.env.ICB_CLEAN_DATA_DIR) return path.join(config.DATA_DIR, '.cloud-session.dpapi');
    const scope = createHash('sha256')
        .update(process.env.ICB_CLOUD_API_URL || '')
        .digest('hex')
        .slice(0, 24);
    if (!process.env.LOCALAPPDATA) return null;
    return path.join(process.env.LOCALAPPDATA, 'ICB', 'auth', scope + '.dpapi');
}

/** Persist only encrypted session material, replacing atomically and never storing the password. */
function createStore(file, crypt = protect) {
    return {
        read() {
            if (!file || !fs.existsSync(file)) return null;
            if (fs.statSync(file).size > 32768) throw new Error('invalid_saved_session');
            const clear = crypt(fs.readFileSync(file), true);
            try {
                return JSON.parse(clear.toString('utf8'));
            } finally {
                clear.fill(0);
            }
        },

        write(value) {
            if (!file) throw new Error('secure_storage_unavailable');
            const clear = Buffer.from(JSON.stringify(value));
            let encrypted;
            try {
                encrypted = crypt(clear);
            } finally {
                clear.fill(0);
            }
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const temporary = file + '.' + randomUUID() + '.tmp';
            try {
                fs.writeFileSync(temporary, encrypted, { flag: 'wx', mode: 0o600 });
                fs.renameSync(temporary, file);
            } finally {
                fs.rmSync(temporary, { force: true });
            }
        },

        clear() {
            if (file) fs.rmSync(file, { force: true });
        }
    };
}

module.exports = { createStore, protect, defaultFile };
