'use strict';

/** Home preferences are confirmed cloud DTOs; startup navigation stays local. */
function hubPublic() {
    return require('./cloud/state-feed').watch('/api/hub') || { ok: false, tiles: [] };
}

module.exports = { hubPublic };
