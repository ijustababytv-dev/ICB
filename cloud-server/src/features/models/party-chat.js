'use strict';
/** createPartyChat keeps related operations together and reads shared state at call time. */
module.exports = function createPartyChat(context) {
    function partyChat(name, parts) {
        // NOTE: no isBlocked() here on purpose - the giveaway block list includes Baby herself
        // (IJustABabyTv), and she signs up for roles at her own parties (2026-10-07).
        name = context.mDomainValidation.cleanString(name).replace(/^@/, '').slice(0, 40);
        if (!name) return '';
        const text = context
            .partyDecode(
                (parts || [])
                    .filter((x) => x.t === 'text')
                    .map((x) => x.v)
                    .join(' ')
            )
            .trim();
        const m = /^!([a-z0-9_]+)\b\s*(.*)$/i.exec(text);
        if (!m) return '';
        const key = name.toLowerCase();
        const cmd = m[1].toLowerCase();
        const boards = context.partyLiveBoards();
        // Sign in when they arrive: "!here" (or !checkin / !signin) - on every live board they're signed up for.
        if (context.PARTY_CHECKIN_CMDS.has(cmd)) {
            const mine = boards.map((b) => b.ev.signups.find((x) => x.key === key)).filter(Boolean);
            if (!mine.length) return `${name} isn't signed up for a role`;
            const fresh = mine.filter((x) => !x.checkedIn);
            if (!fresh.length) return `${mine[0].palia} is already signed in`;
            for (const x of fresh) x.checkedIn = Date.now();
            context.partySave();
            return (
                `${fresh[0].palia} signed in ✅` +
                (fresh.length > 1 ? ` (${fresh.length} parties)` : '')
            );
        }
        // "!party 3" (or !party3 / !show 3) puts Board 3 on the Spotlight layer for a while.
        const pm = /^(?:party|show)([1-7])?$/.exec(cmd);
        if (pm) {
            const n = Number(pm[1] || (/^\s*([1-7])\b/.exec(m[2]) || [])[1]);
            if (!n) {
                if (context.parties.onDemand && boards.length) {
                    context.partyReveal('all');
                    return 'Showing the party boards';
                }
                return '';
            }
            if (context.parties.onDemand && context.parties.slots[n - 1]) context.partyReveal(n);
            if (context.parties.spotChat === false)
                return context.parties.onDemand ? `Showing Board ${n}` : '';
            return context.partySpotRequest(n, name)
                ? `Spotlight → Board ${n}`
                : `Board ${n} isn't live`;
        }
        // "!leave" drops them from every live board; "!leave3" only from Board 3.
        const lv = /^leave([1-7])?$/.exec(cmd);
        if (lv) {
            let removed = 0;
            for (const b of boards) {
                if (lv[1] && b.slot !== Number(lv[1])) continue;
                const before = b.ev.signups.length;
                b.ev.signups = b.ev.signups.filter((x) => x.key !== key);
                removed += before - b.ev.signups.length;
            }
            if (!removed) return `${name} wasn't signed up`;
            context.partySave();
            return `${name} left` + (removed > 1 ? ` ${removed} parties` : '');
        }
        // Which board? An exact command on a board whose command isn't shared, or "<command><board#>" (e.g. !tomato3).
        // A plain shared command (e.g. !tomato on two boards) goes to the lowest-numbered board that has it.
        let ev = null,
            role = null;
        // Prefer a board with sign-ups open; fall back to any board (so a closed board still says "closed").
        for (const b of boards.filter((x) => x.ev.open).concat(boards.filter((x) => !x.ev.open))) {
            const r = b.ev.roles.find((x) => x.command && x.command === cmd);
            if (r) {
                ev = b.ev;
                role = r;
                break;
            }
        }
        if (!role) {
            const sm = /^([a-z0-9_]+?)([1-7])$/.exec(cmd);
            if (sm) {
                const b = boards.find((x) => x.slot === Number(sm[2]));
                const r = b && b.ev.roles.find((x) => x.command === sm[1]);
                if (r) {
                    ev = b.ev;
                    role = r;
                }
            }
        }
        if (!role) return '';
        if (!ev.open) return `${name}: sign-ups are closed`;
        let palia = context.mDomainValidation
            .cleanString(m[2])
            .replace(/[<>]/g, '')
            .replace(/^\[|\]$/g, '')
            .trim()
            .slice(0, 32);
        if (!palia) palia = context.partyDecode(context.parties.names[key] || '') || name;
        context.parties.names[key] = palia;
        const existing = ev.signups.find((s) => s.key === key);
        if (existing && existing.role === role.id) {
            existing.palia = palia;
            context.partySave();
            return `${name} updated name to ${palia} (${role.label})`;
        }
        ev.signups = ev.signups.filter((s) => s.key !== key);
        ev.signups.push({
            key,
            twitch: name,
            palia,
            role: role.id,
            at: Date.now(),
            checkedIn: existing ? existing.checkedIn || null : null
        });
        if (context.parties.onDemand && context.parties.showOnSignup !== false) {
            const sl = context.partySlotOf(ev.id);
            if (sl) context.partyReveal(sl);
        }
        context.partySave();
        const pos = ev.signups.filter((s) => s.role === role.id).length;
        return pos > role.spots
            ? `${palia} is on the ${role.label} waitlist (#${pos - role.spots})`
            : `${palia} signed up for ${role.label}`;
    }

    return { partyChat: partyChat };
};
