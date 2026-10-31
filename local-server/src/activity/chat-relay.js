'use strict';
const mWalkers = require('../walkers');
const mPoll = require('../poll');
const mTeams = require('../teams');
const mSignupsCommands = require('../signups/commands');
const mSignupsPoke = require('../signups/poke');
const mSignupsBurger = require('../signups/burger');
const mSignupsFlow = require('../signups/flow');
const mAniimo = require('../aniimo');
const mAvatars = require('../avatars');
const mSpriteJar = require('../sprite-jar');
const mHunt = require('../hunt');
const mParty = require('../party');
const mNeonChat = require('../neon-chat');
const mTurnLine = require('../turn-line');

/** Dispatch transient chat text to existing live features without persisting it. */
function relayChat(data) {
    const body = { data };
    if (body.data && typeof body.data.sender === 'string') {
        mNeonChat.neonChatRelay(body.data, mWalkers.walkerParts(body.data)); // never throws
        try {
            mWalkers.walkerChat(body.data.sender, mWalkers.walkerParts(body.data), false);
        } catch (_error) {}
        try {
            mPoll.pollChat(body.data.sender, mWalkers.walkerParts(body.data));
        } catch (_error) {}
        try {
            mTeams.teamsChat(body.data.sender, mWalkers.walkerParts(body.data));
        } catch (_error) {}
        let shDone = false; // "!show cake" / "!hide flow" ... (handled once, then the sign-ups skip it)
        try {
            shDone = mSignupsCommands.signupShowHideChat(
                body.data.sender,
                mWalkers.walkerParts(body.data)
            );
        } catch (_error) {}
        let tlDone = false; // "!turn" joins the Turn Line; the sign-ups below would read it as a name
        try {
            tlDone = mTurnLine.turnLineChat(body.data.sender, mWalkers.walkerParts(body.data));
        } catch (_error) {}
        if (!shDone && !tlDone) {
            try {
                mSignupsPoke.sashiChat(body.data.sender, mWalkers.walkerParts(body.data));
            } catch (_error) {}
            try {
                mSignupsBurger.bbsuChat(body.data.sender, mWalkers.walkerParts(body.data));
            } catch (_error) {}
            try {
                mSignupsFlow.ftsuChat(body.data.sender, mWalkers.walkerParts(body.data));
            } catch (_error) {}
        }
        try {
            mAniimo.dexChat(body.data.sender, mWalkers.walkerParts(body.data));
        } catch (_error) {}
        try {
            mAvatars.avChat(body.data.sender, mWalkers.walkerParts(body.data));
        } catch (_error) {}
        try {
            mSpriteJar.sjChat(body.data.sender, mWalkers.walkerParts(body.data));
        } catch (_error) {}
        try {
            mHunt.huntChat(body.data.sender, mWalkers.walkerParts(body.data));
        } catch (_error) {}
        if (!shDone)
            try {
                mParty.partyChat(body.data.sender, mWalkers.walkerParts(body.data));
            } catch (_error) {}
    }
}

module.exports = { relayChat };
