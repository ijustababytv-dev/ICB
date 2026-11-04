'use strict';
const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const PARAMETERS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Use an explicit, stored scrypt work factor with a unique salt for each account. */
async function hashPassword(password) {
    if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 256)
        throw new Error('Password must contain 8-256 bytes.');
    const salt = randomBytes(24).toString('hex');
    const hash = await derive(password, salt, 64, PARAMETERS);
    return { salt, hash: hash.toString('hex'), n: PARAMETERS.N, r: PARAMETERS.r, p: PARAMETERS.p };
}

/** Compare derived bytes in constant time; malformed/unknown accounts still do scrypt work. */
async function verifyPassword(password, account) {
    const valid =
        account &&
        account.scrypt_n === PARAMETERS.N &&
        account.scrypt_r === PARAMETERS.r &&
        account.scrypt_p === PARAMETERS.p;
    const salt = valid ? account.password_salt : '000000000000000000000000000000000000000000000000';
    const result = await derive(String(password || '').slice(0, 256), salt, 64, PARAMETERS);
    const expected = Buffer.from(valid ? account.password_hash : '00'.repeat(64), 'hex');
    return expected.length === result.length && timingSafeEqual(expected, result) && !!valid;
}

module.exports = { hashPassword, verifyPassword, PARAMETERS };
