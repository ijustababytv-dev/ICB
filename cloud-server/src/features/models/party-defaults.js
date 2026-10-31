'use strict';

/** Create an independent party record with its initial settings. */
function partyNewEvent(seq) {
    return {
        id: `e${seq}`,
        title: 'Overprep Party',
        when: '',
        subtitle: '',
        open: true,
        roles: [
            {
                id: 'r1',
                command: 'tomato',
                label: 'Tomato',
                emoji: '🍅',
                spots: 2,
                group: 'Overprep',
                bring: ''
            },
            {
                id: 'r2',
                command: 'rice',
                label: 'Rice',
                emoji: '🍚',
                spots: 2,
                group: 'Overprep',
                bring: ''
            }
        ],
        signups: [],
        rseq: 3
    };
}

module.exports = { partyNewEvent };
