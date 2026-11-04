'use strict';

/** Decode transient display text without importing any signup state or filesystem persistence. */
function partyDecode(t) {
    return String(t || '')
        .replace(/&#(\d{1,6});/g, (_m, n) => String.fromCodePoint(Math.min(0x10ffff, Number(n))))
        .replace(/&#x([0-9a-f]{1,6});/gi, (_m, n) =>
            String.fromCodePoint(Math.min(0x10ffff, parseInt(n, 16)))
        )
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

module.exports = { partyDecode };
