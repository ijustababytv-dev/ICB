'use strict';

/** Use the shared signup presentation defaults without sharing mutable event state. */
module.exports = function flowDefaults(mSignupsPoke) {
    /** Create independent initial Flow Tree signup settings for first-run or missing saved fields. */
    function ftsuDefaults() {
        return {
            visible: true,
            open: true,
            live: 'e1',
            seq: 2,
            font: mSignupsPoke.sashi.font || 26,
            cols: mSignupsPoke.sashi.cols || 2,
            title: '🌳 Flow Tree Sign-Up',
            max: 0,
            ignore: '',
            accent: mSignupsPoke.sashi.accent || '#ff8fd8',
            panelColor: mSignupsPoke.sashi.panelColor || '#1c0e28',
            panelOpacity:
                mSignupsPoke.sashi.panelOpacity === undefined
                    ? 85
                    : mSignupsPoke.sashi.panelOpacity,
            showZones: true,
            showCountdown: true,
            rseq: 1,
            onDemand: !!mSignupsPoke.sashi.onDemand,
            showSec: mSignupsPoke.sashi.showSec || 30,
            showOnSignup: mSignupsPoke.sashi.showOnSignup !== false,
            zones: mSignupsPoke.sashi.zones.map((z) => ({ ...z })),
            events: [{ id: 'e1', name: 'Flow Trees', guests: [] }]
        };
    }

    return ftsuDefaults;
};
