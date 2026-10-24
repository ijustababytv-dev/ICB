'use strict';

const mRoutesSystem = require('../routes/system');
const mRoutesWeekly = require('../routes/weekly');
const mRoutesResources = require('../routes/resources');
const mRoutesSettings = require('../routes/settings');
const mRoutesTodos = require('../routes/todos');
const mRoutesState = require('../routes/state');
const mTradeup = require('../tradeup');
const mDecor = require('../decor');
const mHub = require('../hub');
const mHealth = require('../health');
const mWalkers = require('../walkers');
const mPoll = require('../poll');
const mTeams = require('../teams');
const mEventTime = require('../event-time');
const mParty = require('../party');
const mSteam = require('../steam');
const mNews = require('../news');
const mSignupsPoke = require('../signups/poke');
const mSignupsBurger = require('../signups/burger');
const mSignupsFlow = require('../signups/flow');
const mDesktop = require('../desktop');
const mAniimo = require('../aniimo');
const mSprites = require('../routes/sprites');
const mAvatars = require('../avatars');
const mCountdowns = require('../countdowns');
const mPaliaClock = require('../palia-clock');
const mHunt = require('../hunt');
const mSpriteTv = require('../sprite-tv');
const mOceanFish = require('../ocean-fish');
const mRoutesActivity = require('../routes/activity');
const mRoutesGiveawayEvents = require('../routes/giveaway-events');
const mRoutesGiveawayDraws = require('../routes/giveaway-draws');
const mRoutesGiveawayBackups = require('../routes/giveaway-backups');
const mRoutesGiveaway = require('../routes/giveaway');
const mHttpResponse = require('./response');

/** Dispatch API requests to the owning feature. */
async function handleApi(req, res, url) {
    const method = req.method || 'GET';
    const pathname = url.pathname.replace(/\/$/, '') || '/';
    if (pathname === '/api/sprite-tv' || pathname === '/api/sprite-tv/slideshow')
        return mSpriteTv.handleSpriteTvApi(req, res, pathname, method);
    if (['/api/health', '/api/diagnostics', '/api/tracker-skin-standard'].includes(pathname))
        return mRoutesSystem.handleSystemApi(req, res, url);
    if (pathname === '/api/weekly' || pathname.startsWith('/api/weekly/'))
        return mRoutesWeekly.handleWeeklyApi(req, res, url);
    if (pathname === '/api/resource-trackers' || pathname.startsWith('/api/resource-trackers/'))
        return mRoutesResources.handleResourcesApi(req, res, url);
    if (['/api/randomizer', '/api/layout', '/api/ticker'].includes(pathname))
        return mRoutesSettings.handleSettingsApi(req, res, url);
    if (pathname === '/api/todos' || pathname.startsWith('/api/todos/'))
        return mRoutesTodos.handleTodosApi(req, res, url);
    if (
        ['/api/state', '/api/settings', '/api/actions', '/api/live'].includes(pathname) ||
        pathname.startsWith('/api/live/')
    )
        return mRoutesState.handleStateApi(req, res, url);
    if (pathname.startsWith('/api/tradeup/'))
        return mTradeup.handleTradeupApi(req, res, pathname, method);
    if (pathname.startsWith('/api/decor/'))
        return mDecor.handleDecorApi(req, res, pathname, method);
    if (pathname === '/api/hub' || pathname.startsWith('/api/hub/'))
        return mHub.handleHubApi(req, res, pathname, method);
    if (pathname === '/api/connection-check' || pathname.startsWith('/api/connection-check/'))
        return mHealth.handleHealthApi(req, res, pathname, method);
    if (pathname.startsWith('/api/walkers/'))
        return mWalkers.handleWalkersApi(req, res, pathname, method, url);
    if (pathname.startsWith('/api/poll')) return mPoll.handlePollApi(req, res, pathname, method);
    if (pathname === '/api/teams' || pathname.startsWith('/api/teams/'))
        return mTeams.handleTeamsApi(req, res, pathname, method);
    if (pathname === '/api/eventtime')
        return mEventTime.handleEventTimeApi(req, res, pathname, method);
    if (pathname === '/api/party' || pathname.startsWith('/api/party/'))
        return mParty.handlePartyApi(req, res, pathname, method);
    if (pathname === '/api/steam' || pathname.startsWith('/api/steam/'))
        return mSteam.handleSteamApi(req, res, pathname, method);
    if (pathname === '/api/newsticker' || pathname.startsWith('/api/newsticker/'))
        return mNews.handleNewsApi(req, res, pathname, method);
    if (pathname === '/api/sashimi' || pathname.startsWith('/api/sashimi/'))
        return mSignupsPoke.handleSashiApi(req, res, pathname, method);
    if (pathname === '/api/beanburger-signup' || pathname.startsWith('/api/beanburger-signup/'))
        return mSignupsBurger.handleBbsuApi(req, res, pathname, method);
    if (pathname === '/api/flowtree-signup' || pathname.startsWith('/api/flowtree-signup/'))
        return mSignupsFlow.handleFtsuApi(req, res, pathname, method);
    if (pathname === '/api/desktop' || pathname.startsWith('/api/desktop/'))
        return mDesktop.handleDeskApi(req, res, pathname, method);
    if (pathname === '/api/aniimo' || pathname.startsWith('/api/aniimo/'))
        return mAniimo.handleDexApi(req, res, pathname, method);
    if (pathname === '/api/sprites' || pathname.startsWith('/api/sprites/'))
        return mSprites.handleSpritesApi(req, res, pathname, method);
    if (pathname === '/api/avatars' || pathname.startsWith('/api/avatars/'))
        return mAvatars.handleAvatarsApi(req, res, pathname, method);
    if (pathname === '/api/countdowns')
        return mCountdowns.handleCountdownsApi(req, res, pathname, method);
    if (pathname === '/api/paliaclock')
        return mPaliaClock.handlePaliaClockApi(req, res, pathname, method);
    if (pathname === '/api/hunt' || pathname.startsWith('/api/hunt/'))
        return mHunt.handleHuntApi(req, res, pathname, method);
    if (pathname === '/api/oceanfish')
        return mOceanFish.handleOceanFishApi(req, res, pathname, method);
    if (pathname.startsWith('/api/activity/'))
        return mRoutesActivity.handleActivityApi(req, res, url);
    if (['/api/giveaway/state', '/api/giveaway/event', '/api/giveaway/manual'].includes(pathname))
        return mRoutesGiveawayEvents.handleGiveawayEventsApi(req, res, url);
    if (
        ['/api/giveaway/draw', '/api/giveaway/draw-test', '/api/giveaway/winners/reset'].includes(
            pathname
        )
    )
        return mRoutesGiveawayDraws.handleGiveawayDrawsApi(req, res, url);
    if (pathname.startsWith('/api/giveaway/backups'))
        return mRoutesGiveawayBackups.handleGiveawayBackupsApi(req, res, url);
    if (pathname.startsWith('/api/giveaway/'))
        return mRoutesGiveaway.handleGiveawayApi(req, res, url);
    return mHttpResponse.sendJson(res, 404, { ok: false, error: 'Not found.' });
}

Object.assign(exports, { handleApi });
