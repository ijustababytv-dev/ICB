'use strict';

const mParty = require('../party');
const mEvents = require('../events');
let mSignupsPoke, mSignupsBurger, mSignupsFlow;

/** Connect the three independent boards after loading their saved state. */
function connectSignups(poke, burger, flow) {
    mSignupsPoke = poke;
    mSignupsBurger = burger;
    mSignupsFlow = flow;
}

const SIGNUP_SH_WORDS = {
    poke: ['poke', 'pokebowl', 'pokebowls', 'bowl', 'sashimi'],
    cake: ['cake', 'cakes', 'party'],
    burger: ['burger', 'burgers', 'beanburger', 'beanburgers'],
    flow: ['flow', 'flows', 'flowtree', 'flowtrees', 'tree', 'trees']
};
/** Route show/hide aliases once to the intended signup board without enrolling a viewer. */
function signupShowHideChat(sender, parts) {
    const text = mParty
        .partyDecode(
            (parts || [])
                .filter((x) => x.t === 'text')
                .map((x) => x.v)
                .join(' ')
        )
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
    const m = /^!(show|hide) (.{2,30})$/.exec(text);
    if (!m) return false;
    const word = m[2].replace(/[^a-z]/g, '');
    const which = Object.keys(SIGNUP_SH_WORDS).find((k) => SIGNUP_SH_WORDS[k].includes(word));
    if (!which) return false;
    const show = m[1] === 'show';
    if (which === 'cake') {
        mParty.partyChatHidden = !show;
        if (show) {
            if (mParty.parties.onDemand) mParty.partyReveal('all');
            else mEvents.broadcast('party', mParty.partyPublic());
        } else {
            for (const k of Object.keys(mParty.partyShowUntil)) delete mParty.partyShowUntil[k];
            mParty.partySpot.until = 0;
            mEvents.broadcast('party', mParty.partyPublic());
        }
        return true;
    }
    const w =
        which === 'poke'
            ? {
                  set: (v) => {
                      mSignupsPoke.sashiChatHidden = v;
                  },

                  s: mSignupsPoke.sashi,
                  until: (v) => {
                      mSignupsPoke.sashiShowUntil = v;
                  },

                  pub: mSignupsPoke.sashiPublic,
                  ch: 'sashimi'
              }
            : which === 'burger'
            ? {
                  set: (v) => {
                      mSignupsBurger.bbsuChatHidden = v;
                  },

                  s: mSignupsBurger.bbsu,
                  until: (v) => {
                      mSignupsBurger.bbsuShowUntil = v;
                  },

                  pub: mSignupsBurger.bbsuPublic,
                  ch: 'beanburger-signup'
              }
            : {
                  set: (v) => {
                      mSignupsFlow.ftsuChatHidden = v;
                  },

                  s: mSignupsFlow.ftsu,
                  until: (v) => {
                      mSignupsFlow.ftsuShowUntil = v;
                  },

                  pub: mSignupsFlow.ftsuPublic,
                  ch: 'flowtree-signup'
              };
    w.set(!show);
    w.until(show && w.s.onDemand ? Date.now() + (w.s.showSec || 30) * 1000 : 0);
    mEvents.broadcast(w.ch, w.pub());
    return true;
}

// Role commands on the live event of every sign-up widget (Poke Bowl, Bean Burger, Flow Tree), except `skip`.
// Used so "!Name" sign-ups never treat another widget's role command as a name, and to warn about clashes.
function signupRoleCmds(skip) {
    const set = new Set();
    const all = {
        sashi: () => mSignupsPoke.sashiEv(),

        bbsu: () => mSignupsBurger.bbsuEv(),

        ftsu: () => mSignupsFlow.ftsuEv()
    };
    for (const k of Object.keys(all)) {
        if (k === skip) continue;
        try {
            const ev = all[k]();
            if (ev) for (const r of ev.roles) if (r.cmd) set.add(r.cmd);
        } catch (_e) {}
    }
    return set;
}

Object.assign(exports, { connectSignups, signupRoleCmds, signupShowHideChat });
