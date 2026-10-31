'use strict';

/** Construct a transaction-scoped feature model with injected state and side effects. */
module.exports = function createModel(context, exports) {
    const Date = context.Date;
    const Math = context.Math;
    const console = context.logger;
    const path = require('node:path');
    const mConfig = context.config;
    const mStorage = context.storage;
    const mDomainRandomizer = require('../../domain/randomizer');

    // ---------------------------------------------------------------------------
    // TITLE & GO-LIVE RANDOMIZER (Baby, 2026-10-03) - top of ICB Home. Lists of
    // stream titles and go-live messages per game; the page picks one of each at
    // random (avoiding the last few picks). Saved in data/randomizer.json.
    // ---------------------------------------------------------------------------
    const RANDOMIZER_DEFAULTS = {
        games: [
            {
                id: 'palia',
                name: 'Palia',
                titles: [
                    '🦄 Cozy Palia Vibes | Farming, Fishing & Good Company',
                    '🌸 Chill Palia Day in Kilima | Come Hang Out!',
                    '🎣 Fishing for Rare Catches in Palia | Chat & Chill',
                    '🐞 Bug Hunting Bonanza | Cozy Palia Stream',
                    '🍳 Cooking Up a Storm in Palia | Unicorn Giveaway Tonight!',
                    '🌙 Late Night Palia | Grinding with the Herd',
                    '🏡 Decorating My Palia Plot | Help Me Choose!',
                    '💖 Palia & Plushies | Chat Earns Fluffy Unicorns'
                ],
                golives: [
                    "✨ I'm LIVE in Palia! {title} — come hang out 🦄 {link}",
                    "🦄 The herd is gathering! We're live now: {title} {link}",
                    '🌸 Grab a cozy drink and join me — live in Palia! {link}',
                    '💖 Going live! Chat to earn fluffy unicorns tonight 🦄 {title} {link}',
                    "🎣 Rods out, snacks ready — I'm live! {title} {link}"
                ]
            }
        ],
        link: 'https://twitch.tv/ijustababytv',
        recent: {}
    };

    const RANDOMIZER_FILE = path.join(mConfig.DATA_DIR, 'randomizer.json');

    let randomizer = (() => {
        const saved = mStorage.readJson(RANDOMIZER_FILE, null);
        const r = mDomainRandomizer.randomizerClean(saved || RANDOMIZER_DEFAULTS);
        return r.games.length ? r : mDomainRandomizer.randomizerClean(RANDOMIZER_DEFAULTS);
    })();

    Object.assign(exports, { RANDOMIZER_FILE });

    // Accessors keep replacement state visible to routes and collaborating features.
    Object.defineProperties(exports, {
        randomizer: {
            enumerable: true,
            get: () => randomizer,

            set: (value) => {
                randomizer = value;
            }
        }
    });
};
