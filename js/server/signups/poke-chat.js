'use strict';
const { checkInViewer } = require('../domain/signup-checkins');
/** createPokeChat keeps related operations together and reads shared state at call time. */
module.exports = function createPokeChat(context) {
    function sashiChat(sender, parts) {
        const twitch = context.mDomainValidation.cleanString(sender).replace(/^@/, '').slice(0, 40);
        if (!twitch) return '';
        const text = context.mParty
            .partyDecode(
                (parts || [])
                    .filter((x) => x.t === 'text')
                    .map((x) => x.v)
                    .join(' ')
            )
            .trim()
            .replace(/\s+/g, ' ');
        const ev = context.sashiEv();
        if (!ev) return '';
        const key = twitch.toLowerCase();
        // Attendance stays available after signups close; repeated chat commands are idempotent.
        if (/^!(here|checkin|signin)$/i.test(text)) {
            const result = checkInViewer(ev, twitch);
            if (result.changed) {
                context.sashiPop();
                context.sashiSave();
            }
            return result.reply;
        }
        // "!show" / "!event" pops the sign-up on screen when it's set to "hidden until chat asks".
        if (/^!(show|event)$/i.test(text)) {
            if (context.sashi.onDemand && context.sashi.visible) {
                context.sashiReveal();
                return 'Showing the event sign-up';
            }
            return '';
        }
        // "!leave" takes their own name off the list (2026-10-11). Works even when sign-ups are closed.
        // (Party Sign-ups also hears !leave - that's fine, each only removes its own entries.)
        if (/^!leave$/i.test(text)) {
            const mine = ev.guests.find((g) => g.twitch && g.twitch.toLowerCase() === key);
            if (!mine) return '';
            ev.guests = ev.guests.filter((g) => g !== mine);
            context.sashiRenumber(ev);
            context.sashiSave();
            return `${mine.name} left`;
        }
        const mine = ev.guests.find((g) => g.twitch && g.twitch.toLowerCase() === key);
        // ----- events WITH roles: "!<role command> [Palia name]" -----
        if (ev.roles.length) {
            const m = /^!([a-z0-9_]+)(?: (.+))?$/i.exec(text);
            if (!m) return '';
            const role = ev.roles.find((r) => r.cmd === m[1].toLowerCase());
            if (!role) return '';
            if (!context.sashi.open) return `${twitch}: sign-ups are closed`;
            let name = m[2] ? context.sashiChatName(m[2]) : '';
            if (m[2] && !name) return '';
            if (!name) name = (mine && mine.name) || context.sashiNames(ev)[key] || twitch;
            const taken = ev.guests.find(
                (g) => g.name.toLowerCase() === name.toLowerCase() && g !== mine
            );
            if (taken) return `${name} is already signed up`;
            context.sashiRemember(ev, twitch, name);
            if (mine) {
                const moved = mine.role !== role.id;
                mine.name = name;
                if (moved) {
                    mine.role = role.id;
                    mine.at = Date.now();
                    ev.guests = ev.guests.filter((g) => g !== mine).concat([mine]);
                    context.sashiRenumber(ev);
                }
                context.sashiPop();
                context.sashiSave();
                return moved ? `${name} switched to ${role.label}` : `${name} updated`;
            }
            if (context.sashi.max && ev.guests.length >= context.sashi.max)
                return `Event is full (${context.sashi.max})`;
            ev.guests.push({
                n: ev.guests.length + 1,
                name,
                twitch,
                at: Date.now(),
                role: role.id
            });
            context.sashiPop();
            context.sashiSave();
            const pos = ev.guests.filter((g) => g.role === role.id).length;
            return role.spots && pos > role.spots
                ? `${name} is on the ${role.label} waitlist (#${pos - role.spots})`
                : `${name} signed up for ${role.label}`;
        }
        // ----- events WITHOUT roles: "!Palia Name" (2026-10-10 / -11 rules) -----
        if (!context.sashi.open) return '';
        // "!signup" alone = use the name we remember for this game (from their first sign-up).
        if (/^!signup$/i.test(text)) {
            const known = context.sashiNames(ev)[key];
            if (!known) return `${twitch}: type ! + your ${ev.game} name the first time`;
            if (mine) return '';
            if (ev.guests.some((g) => g.name.toLowerCase() === known.toLowerCase()))
                return `${known} is already signed up`;
            if (context.sashi.max && ev.guests.length >= context.sashi.max)
                return `Event is full (${context.sashi.max})`;
            ev.guests.push({
                n: ev.guests.length + 1,
                name: known,
                twitch,
                at: Date.now(),
                role: ''
            });
            context.sashiPop();
            context.sashiSave();
            return `${known} signed up (#${ev.guests.length})`;
        }
        const m = /^!([^\s!][^!]{0,31})$/.exec(text);
        if (!m) return '';
        const name = context.sashiChatName(m[1]);
        if (!name) return '';
        const low = name.toLowerCase(),
            first = low.split(' ')[0];
        // The first word decides whether it's another command ("!vote 2", "!tomato Kitsuu", "!hug Bob").
        const ign = context.sashiIgnored();
        if (ign.has(first) || ign.has(low) || /^(leave|party|show|here)\d*$/.test(first)) return '';
        const taken = ev.guests.find((g) => g.name.toLowerCase() === low);
        if (taken) return taken.twitch.toLowerCase() === key ? '' : `${name} is already signed up`;
        context.sashiRemember(ev, twitch, name);
        if (mine) {
            mine.name = name;
            context.sashiPop();
            context.sashiSave();
            return `${twitch} changed their name to ${name} (#${mine.n})`;
        }
        if (context.sashi.max && ev.guests.length >= context.sashi.max)
            return `Event is full (${context.sashi.max})`;
        ev.guests.push({ n: ev.guests.length + 1, name, twitch, at: Date.now(), role: '' });
        context.sashiPop();
        context.sashiSave();
        return `${name} signed up (#${ev.guests.length})`;
    }

    return { sashiChat: sashiChat };
};
