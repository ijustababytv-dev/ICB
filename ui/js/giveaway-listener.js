(function () {
    // Invisible utility layer, not meant to be seen on stream. Add this as a
    // Meld layer (any size - shrink it to a corner or hide it) so the
    // Firehose SDK can pick up the connection token Meld provides to its own
    // browser layers. This page does NO ticket math itself - it just relays
    // raw events to ICB, which does all the real logic (server.js, "STREAM
    // GIVEAWAY"). Plain ES5 only, same rule as every other Meld-hosted page.
    //
    // Event shapes checked against Meld's own firehose.js (v2) on 2026-09-25:
    //   chat  = the raw RICH_MESSAGE. Cheers ride along in msg.donations as
    //           { type: "TWITCH_BITS", amount, count }. Meld itself ignores
    //           those parts on HIGHLIGHTED / ANNOUNCEMENT messages; so do we.
    //   sub   = SUBSCRIPTION (new sub or RESUB, NOT gifted). months_purchased
    //           is 1 normally, more when someone buys several months at once.
    //   gifts = Meld bundles gifted subs into one event: { gifter, anonymous,
    //           count, recipients }. Gifted subs never arrive as "sub".
    //   follow = FOLLOW { follower }; raid = RAID { host, viewers } - relayed
    //           for the nightly report only, they don't earn unicorns.
    //   purchase = shop purchases (e.g. Fourthwall), NOT bits - not used.
    // Works from ICB (http://127.0.0.1:8790/giveaway-listener.html) AND when
    // pasted into a Meld element hosted elsewhere: anywhere else, talk to ICB
    // by its full address (ICB allows this - CORS is open to any page).
    var ICB =
        /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && location.port === '8790'
            ? ''
            : 'http://127.0.0.1:8790';
    var statusEl = document.getElementById('status');
    var firehose = null;
    var listenerId =
        'listener-' + new Date().getTime().toString(36) + '-' + Math.random().toString(36).slice(2);
    var collecting = true;
    var BIT_TYPES = { TWITCH_BITS: true };
    var SKIP_ATTRS = { HIGHLIGHTED: true, ANNOUNCEMENT: true };

    function setStatus(text) {
        if (statusEl) {
            statusEl.textContent = text;
        }
    }

    function post(path, payload) {
        if (!collecting && /^\/api\/activity\/(chat|support)$/.test(path)) {
            return;
        }
        payload.listener_id = listenerId;
        try {
            var x = new XMLHttpRequest();
            x.open('POST', ICB + path, true);
            x.setRequestHeader('Content-Type', 'application/json');
            x.send(JSON.stringify(payload));
        } catch (e) {
            /* best-effort - a dropped event is one fewer unicorn, not a crash */
        }
    }

    // Neon Chat (2026-10-25): keep the chatter's badge names and name colour for chat lines.
    // Only short text values are copied (never pictures); unknown shapes are simply skipped.
    function senderInfoOf(user) {
        var info = { badges: [], color: '' };
        if (!user || typeof user !== 'object') {
            return info;
        }
        var colorKeys = ['color', 'colour', 'name_color', 'display_color', 'chat_color'];
        for (var c = 0; c < colorKeys.length; c++) {
            var v = user[colorKeys[c]];
            if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) {
                info.color = v;
                break;
            }
        }
        var lists = [user.badges, user.roles, user.role];
        for (var l = 0; l < lists.length; l++) {
            var list = lists[l];
            if (typeof list === 'string') {
                list = [list];
            }
            if (!list || typeof list.length !== 'number') {
                continue;
            }
            for (var i = 0; i < list.length && info.badges.length < 10; i++) {
                var b = list[i];
                var name =
                    typeof b === 'string'
                        ? b
                        : b && (b.name || b.title || b.set_id || b.id || b.type || '');
                if (typeof name === 'string' && name) {
                    info.badges.push(name.slice(0, 40));
                }
            }
        }
        var flags = {
            is_moderator: 'moderator',
            is_mod: 'moderator',
            is_vip: 'vip',
            is_subscriber: 'subscriber',
            is_broadcaster: 'broadcaster'
        };
        for (var f in flags) {
            if (flags.hasOwnProperty(f) && user[f] === true) {
                info.badges.push(flags[f]);
            }
        }
        return info;
    }

    function usernameOf(user) {
        if (!user) {
            return '';
        }
        return user.displayname || user.username || '';
    }

    // Shrink transient live-display data: user objects become just their name, long
    // strings are trimmed, big lists capped (the viewer list keeps every name).
    var DROP_KEYS = {
        image_link: true,
        profile_image_url: true,
        avatar: true,
        streamer: true,
        badges_images: true
    };
    function compact(v, depth, kind) {
        if (v === null || v === undefined) {
            return v;
        }
        if (typeof v === 'string') {
            return v.length > 500 ? v.slice(0, 500) + '...' : v;
        }
        if (typeof v === 'number' || typeof v === 'boolean') {
            return v;
        }
        if (depth > 4) {
            return undefined;
        }
        if (Object.prototype.toString.call(v) === '[object Array]') {
            var cap = kind === 'viewer_list' ? 5000 : 40,
                out = [];
            for (var i = 0; i < v.length && i < cap; i++) {
                out.push(compact(v[i], depth + 1, kind));
            }
            if (v.length > cap) {
                out.push('+' + (v.length - cap) + ' more');
            }
            return out;
        }
        if (typeof v === 'object') {
            if (typeof v.displayname === 'string' && depth > 0) {
                return v.displayname;
            }
            var o = {};
            for (var k in v) {
                if (!Object.prototype.hasOwnProperty.call(v, k) || DROP_KEYS[k]) {
                    continue;
                }
                if (kind === 'gifts' && k === 'events') {
                    continue;
                } // the bundle already lists recipients
                var c = compact(v[k], depth + 1, kind);
                if (c !== undefined) {
                    o[k] = c;
                }
            }
            return o;
        }
        return undefined;
    }

    var MONEY_TYPES = {
        YOUTUBE_SUPER_CHAT: true,
        YOUTUBE_SUPER_STICKER: true,
        FOURTHWALL_DONATION: true
    };

    // Copy only actual provider identifiers. Generated local IDs cannot deduplicate upstream deliveries.
    function metadata(event, user) {
        var upid = user && typeof user.UPID === 'string' ? user.UPID : '';
        var suffix = upid.split(';').pop().toLowerCase();
        var platform = /^(twitch|youtube|kick|tiktok|fourthwall)$/.test(suffix)
            ? suffix
            : 'unknown';
        var id = event && (event.event_id || event.message_id || event.id);
        return {
            platform: platform,
            platform_user_id: upid || (user && typeof user.id === 'string' ? user.id : null),
            source_id: typeof id === 'string' && id.length <= 120 ? id : null
        };
    }

    function bitsIn(msg) {
        if (!msg || !msg.donations || !msg.donations.length) {
            return 0;
        }
        var attrs = msg.attributes || [];
        for (var a = 0; a < attrs.length; a++) {
            if (SKIP_ATTRS[String(attrs[a])]) {
                return 0;
            }
        }
        var total = 0;
        for (var i = 0; i < msg.donations.length; i++) {
            var d = msg.donations[i];
            if (!d || !BIT_TYPES[d.type]) {
                continue;
            }
            var count = typeof d.count === 'number' && d.count > 0 ? Math.floor(d.count) : 1;
            if (typeof d.amount === 'number' && d.amount > 0) {
                total += Math.round(d.amount) * count;
            }
        }
        return total;
    }

    // Tell ICB we're alive (and whether Meld's connection is open) so the
    // dashboard can show a green "listener connected" badge.
    // Self-repair: if Meld's connection hasn't been open for 90 s straight,
    // reload this page (same as right-click > reload in Meld). ICB Home's
    // "Reload the listener" button asks for the same thing through the
    // heartbeat reply. Meld's history replay on reconnect is skipped below,
    // so a reload never double-counts anything.
    var notConnectedSince = new Date().getTime();
    var SELF_RELOAD_MS = 90000;
    function reloadMe() {
        setStatus('reloading...');
        setTimeout(function () {
            location.reload();
        }, 300);
    }

    function heartbeat() {
        var state = !firehose ? 'no-sdk' : firehose.socketOpen ? 'connected' : 'connecting';
        var now = new Date().getTime();
        if (state === 'connected') {
            notConnectedSince = now;
        } else if (now - notConnectedSince > SELF_RELOAD_MS) {
            notConnectedSince = now;
            reloadMe();
            return;
        }
        try {
            var x = new XMLHttpRequest();
            x.open('POST', ICB + '/api/giveaway/listener', true);
            x.setRequestHeader('Content-Type', 'application/json');
            x.onreadystatechange = function () {
                if (x.readyState !== 4 || x.status !== 200) {
                    return;
                }
                try {
                    var reply = JSON.parse(x.responseText);
                    collecting = reply.collecting !== false;
                    if (!collecting) {
                        setStatus('Another listener is collecting. This copy is idle.');
                    }
                    if (reply.reload === true) {
                        reloadMe();
                    }
                } catch (e) {}
            };

            x.send(
                JSON.stringify({
                    firehose: state,
                    page: String(location.href).slice(0, 200),
                    listener_id: listenerId
                })
            );
        } catch (e) {}
        setStatus(
            state === 'connected'
                ? 'connected to Meld, relaying to ICB'
                : state === 'connecting'
                ? 'waiting for Meld...'
                : 'Firehose SDK not loaded'
        );
    }

    var bootAttempts = 0;
    // 2026-09-30: the SDK used to be a normal <script src> to Meld's CDN in
    // <head>. If that download stalled inside Meld, the page froze before any
    // of this ran - no heartbeat, "NOT running", fixed only by a restart.
    // Now: load ICB's own copy (meld-firehose.js, same file, served locally so
    // no internet needed) without blocking, and fall back to Meld's CDN if the
    // local copy is missing. Heartbeats run the whole time either way.
    var SDK_URLS = [ICB + '/meld-firehose.js', 'https://elements.meldstudio.co/cdn/v2/firehose.js'];
    var sdkTry = 0;
    function reloadSdk() {
        try {
            var sc = document.createElement('script');
            var src = SDK_URLS[sdkTry % SDK_URLS.length];
            sdkTry++;
            sc.src = src + (src.indexOf('?') < 0 ? '?' : '&') + 't=' + new Date().getTime();
            sc.async = true;
            document.getElementsByTagName('head')[0].appendChild(sc);
        } catch (e) {}
    }

    function boot() {
        bootAttempts++;
        if (typeof Firehose === 'undefined') {
            // Keep telling ICB we're alive while we wait, so the dashboard shows
            // "Firehose didn't load" instead of "NOT running". Every 30 tries we
            // re-add Meld's script in case the first download failed.
            heartbeat();
            if (bootAttempts > 30) {
                setStatus('Firehose SDK not loaded yet - retrying (check internet / Meld).');
            }
            if (bootAttempts % 8 === 0) {
                reloadSdk();
            } // try the next copy every ~8 s
            setTimeout(boot, bootAttempts > 30 ? 5000 : 1000);
            return;
        }

        // The older weekly listener retried SDK construction failures; preserve that recovery here.
        try {
            firehose = new Firehose();
        } catch (e) {
            setStatus('Meld SDK is unavailable; retrying.');
            heartbeat();
            setTimeout(boot, 5000);
            return;
        }
        var lastSocketState = null;
        setInterval(function () {
            var open = !!firehose.socketOpen;
            if (open !== lastSocketState) {
                lastSocketState = open;
                setStatus(
                    collecting
                        ? open
                            ? 'Connected to Meld, relaying to ICB'
                            : 'Waiting for Meld...'
                        : 'Another listener is collecting. This copy is idle.'
                );
            }
        }, 2000);
        firehose.on('error', function () {
            setStatus('Meld connection error; waiting for recovery.');
        });

        firehose.on('chat', function (msg) {
            var name = usernameOf(msg && msg.sender);
            if (!name) {
                return;
            }
            var data = compact(msg, 0, 'chat');
            data.senderInfo = senderInfoOf(msg.sender);
            var info = metadata(msg, msg.sender);
            info.data = data;
            post('/api/activity/chat', info);
            var bits = bitsIn(msg);
            if (bits > 0) {
                var cheer = metadata(msg, msg.sender);
                cheer.type = 'bits';
                cheer.username = name;
                cheer.amount = bits;
                post('/api/activity/support', cheer);
            }
            var donations = msg.donations || [];
            for (var d = 0; d < donations.length; d++) {
                var donation = donations[d];
                if (!donation || !MONEY_TYPES[donation.type]) {
                    continue;
                }
                var tip = metadata(msg, msg.sender);
                tip.type = 'tip';
                tip.username = name;
                tip.amount = donation.amount;
                tip.currency = donation.currency;
                tip.count = donation.count || 1;
                if (tip.source_id) {
                    tip.source_id += ':tip:' + d;
                }
                post('/api/activity/support', tip);
            }
        });

        firehose.on('sub', function (sub) {
            var name = usernameOf(sub && sub.subscriber);
            if (!name) {
                return;
            }
            var event = metadata(sub, sub.subscriber);
            event.type = 'sub';
            event.username = name;
            event.months =
                sub && typeof sub.months_purchased === 'number' && sub.months_purchased >= 1
                    ? Math.round(sub.months_purchased)
                    : 1;
            event.tier = sub && sub.sub_level;
            event.subType = sub && sub.sub_type;
            post('/api/activity/support', event);
        });

        firehose.on('gifts', function (bundle) {
            if (!bundle) {
                return;
            }
            var event = metadata(bundle, bundle.gifter);
            event.type = 'gifts';
            event.username = usernameOf(bundle.gifter);
            event.anonymous = !!bundle.anonymous || !event.username;
            event.count = bundle.count || 0;
            event.tier = bundle.sub_level;
            post('/api/activity/support', event);
        });

        firehose.on('follow', function (follow) {
            var name = usernameOf(follow && follow.follower);
            if (!name) {
                return;
            }
            var event = metadata(follow, follow.follower);
            event.type = 'follow';
            event.username = name;
            post('/api/activity/support', event);
        });

        firehose.on('raid', function (raid) {
            var user = raid && (raid.host || raid.raider || raid.sender);
            var event = metadata(raid, user);
            event.type = 'raid';
            event.username = usernameOf(user);
            event.viewers = raid && typeof raid.viewers === 'number' ? raid.viewers : 0;
            post('/api/activity/support', event);
        });

        firehose.on('purchase', function (purchase) {
            if (!purchase) {
                return;
            }
            var event = metadata(purchase, purchase.purchaser);
            event.type = 'purchase';
            event.username = usernameOf(purchase.purchaser);
            event.anonymous = !event.username;
            event.amount = purchase.total_amount;
            event.currency = purchase.currency;
            post('/api/activity/support', event);
        });

        // Connection observations stay in memory for troubleshooting, never in the activity archive.
        firehose.on('*', function (wrapped) {
            if (!wrapped || !wrapped.type || !/^(connection|stream_status)$/.test(wrapped.type)) {
                return;
            }
            post('/api/activity/raw', {
                kind: wrapped.type,
                data: compact(wrapped.event, 0, wrapped.type)
            });
        });

        heartbeat();
        setInterval(heartbeat, 5000);
    }

    reloadSdk();
    boot();
})();
