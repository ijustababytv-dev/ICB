'use strict';
/** Static feature options, shared without changing runtime state. */
const WALKERS_DEFAULT_SETTINGS = {
    enabled: true,
    whoGets: 'everyone', // 'everyone' (Baby, 2026-10-01) | 'subs' (the original rule)
    subsAuto: true, // subscribers with no picked picture get a random subscriber-only one
    artFacesLeft: false, // set true if the unicorn pictures face LEFT (so they never walk backwards)
    size: 140, // unicorn height in px
    speed: 1, // walking speed multiplier
    afkMinutes: 10, // walk off after this long without chatting
    bubbleSeconds: 7, // how long a chat bubble stays up
    reminderEveryMinutes: 4,
    trickGap: 8, // average seconds between tricks
    entrance: 'drop',
    exitStyle: 'walk',
    // Names + chat look (Baby, 2026-09-29): name above the head, no bubble.
    namePosition: 'above', // 'above' | 'below' | 'hidden'
    nameFont: 'Baloo 2',
    nameSize: 22,
    nameColor: '#ffffff',
    nameBold: true,
    nameOutlineColor: '#3a1446',
    nameOutlineWidth: 3,
    nameBackground: false, // true = old pill behind the name
    nameBgColor: '#782896',
    showChat: true, // false = no chat speech bubbles (reminders still show)
    chatTextSize: 22,
    reminders: [
        'Check out !discord to join our cozy community!',
        'Remember to drink water! 💧',
        'Type !socials to find us everywhere!'
    ]
};

const WALKERS_LIMITS = {
    trickGap: [2, 30],
    size: [50, 300],
    speed: [0.3, 3],
    afkMinutes: [1, 120],
    bubbleSeconds: [2, 20],
    reminderEveryMinutes: [0, 60],
    nameSize: [10, 72],
    nameOutlineWidth: [0, 8],
    chatTextSize: [12, 44]
};

const WALKERS_ANIMS = [
    { id: 'hop', kind: 'move', label: 'Hop', desc: 'Bounces along the ground', on: true, often: 5 },
    {
        id: 'glide',
        kind: 'move',
        label: 'Glide',
        desc: 'Slides smoothly, leaning forward, no bouncing',
        on: true,
        often: 3
    },
    {
        id: 'float',
        kind: 'move',
        label: 'Float',
        desc: 'Hovers above the ground, drifting up and down',
        on: true,
        often: 2
    },
    {
        id: 'skip',
        kind: 'move',
        label: 'Skip',
        desc: 'Two little hops then a big one, over and over',
        on: true,
        often: 3
    },
    {
        id: 'trot',
        kind: 'move',
        label: 'Trot',
        desc: 'Quick little steps, a bit faster',
        on: true,
        often: 2
    },
    {
        id: 'waddle',
        kind: 'move',
        label: 'Waddle',
        desc: 'Rocks side to side with small, slow steps',
        on: true,
        often: 2
    },
    {
        id: 'pause',
        kind: 'trick',
        label: 'Stop & look',
        desc: 'Stops for a moment',
        on: true,
        often: 3
    },
    { id: 'bighop', kind: 'trick', label: 'Big hop', desc: 'One big jump', on: true, often: 3 },
    {
        id: 'spin',
        kind: 'trick',
        label: 'Spin',
        desc: 'Spins around on the spot',
        on: true,
        often: 2
    },
    {
        id: 'sparkle',
        kind: 'trick',
        label: 'Sparkles',
        desc: 'A burst of sparkles, hearts and stars',
        on: true,
        often: 2
    },
    {
        id: 'turn',
        kind: 'trick',
        label: 'Turn around',
        desc: 'Changes its mind and goes the other way',
        on: true,
        often: 2
    },
    {
        id: 'flip',
        kind: 'trick',
        label: 'Backflip',
        desc: 'Jumps and flips all the way over',
        on: true,
        often: 2
    },
    {
        id: 'twirljump',
        kind: 'trick',
        label: 'Twirl jump',
        desc: 'Leaps up and twirls twice in the air',
        on: true,
        often: 1
    },
    {
        id: 'bounce',
        kind: 'trick',
        label: 'Bouncy',
        desc: 'Three quick bounces in place',
        on: true,
        often: 2
    },
    {
        id: 'dance',
        kind: 'trick',
        label: 'Dance',
        desc: 'Wiggles and wobbles to the music',
        on: true,
        often: 2
    },
    {
        id: 'hearts',
        kind: 'trick',
        label: 'Hearts',
        desc: 'Little hearts float up from it',
        on: true,
        often: 2
    },
    {
        id: 'zoomies',
        kind: 'trick',
        label: 'Zoomies',
        desc: 'Sprints super fast for a moment',
        on: true,
        often: 1
    },
    {
        id: 'rainbow',
        kind: 'trick',
        label: 'Rainbow dash',
        desc: 'Runs fast leaving a rainbow trail',
        on: true,
        often: 1
    },
    {
        id: 'grow',
        kind: 'trick',
        label: 'Puff up',
        desc: 'Grows big, then pops back to normal',
        on: true,
        often: 1
    },
    {
        id: 'nap',
        kind: 'trick',
        label: 'Little nap',
        desc: 'Sits still for a few seconds with a Zzz',
        on: false,
        often: 1
    }
];

const WALKERS_ENTRANCES = {
    drop: 'Drop in from above',
    pop: 'Pop in (grows out of nothing)',
    floatdown: 'Float down slowly',
    slide: 'Walk in from the side'
};

const WALKERS_EXITS = {
    walk: 'Sleepy Zzz, then walk off',
    floataway: 'Sleepy Zzz, then float up and away',
    poof: 'Sleepy Zzz, then vanish in sparkles'
};

const WALKERS_FONTS = [
    'Baloo 2',
    'Comic Sans MS',
    'Arial',
    'Arial Black',
    'Trebuchet MS',
    'Segoe UI',
    'Verdana',
    'Georgia',
    'Impact',
    'Courier New',
    'Times New Roman'
];

const WALKERS_COLOR = /^#[0-9a-f]{6}$/i;
module.exports = {
    WALKERS_DEFAULT_SETTINGS,
    WALKERS_LIMITS,
    WALKERS_ANIMS,
    WALKERS_ENTRANCES,
    WALKERS_EXITS,
    WALKERS_FONTS,
    WALKERS_COLOR
};
