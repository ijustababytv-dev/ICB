/** Giveaway report rendering. Loaded before the page startup script. */
function render(d) {
    const ev = d.events;
    const by = (t) => ev.filter((e) => e.type === t);

    const chats = by('chat'),
        follows = by('follow'),
        subs = by('sub'),
        gifts = by('gifts'),
        bits = by('bits'),
        raids = by('raid'),
        ticks = by('chat_unicorns'),
        manual = by('manual'),
        winners = by('winner');
    const sum = (a, f) => a.reduce((n, e) => n + (Number(f(e)) || 0), 0);

    const raw = ev.filter((e) => e.type === 'raw');
    const rk = (k) => raw.filter((e) => e.kind === k);

    const rawChats = rk('chat');
    const vc = rk('viewer_count')
        .map((e) => ({ t: Date.parse(e.at), v: Number(e.data && e.data.count) }))
        .filter((p) => Number.isFinite(p.v));
    const peak = vc.length ? Math.max(...vc.map((p) => p.v)) : null;
    const avg = vc.length ? Math.round(vc.reduce((n, p) => n + p.v, 0) / vc.length) : null;
    const peakAt = vc.length ? vc.find((p) => p.v === peak).t : null;
    const seen = new Set();
    rk('viewer_list').forEach((e) => {
        const list = (e.data && (e.data.viewers || e.data.users || e.data.list)) || [];
        (Array.isArray(list) ? list : []).forEach((v) => {
            const n = nameOf(v);
            if (n && !/^\+\d+ more$/.test(n)) seen.add(n);
        });
    });
    const chatNames = new Set(
        rawChats.map((e) => whoIn(e.data)).concat(chats.map((e) => e.username))
    );
    chatNames.forEach((n) => n && seen.add(n));
    const blockedSet = new Set((d.blocked || []).map((n) => String(n).toLowerCase()));
    [...seen].forEach((n) => {
        if (blockedSet.has(String(n).toLowerCase())) seen.delete(n);
    });
    const timeline = raw.filter(
        (e) =>
            e.kind === 'stream_status' ||
            e.kind === 'connection' ||
            String(e.kind).startsWith('meld.')
    );
    const tips = [];
    rawChats.forEach((e) =>
        (e.data && Array.isArray(e.data.donations) ? e.data.donations : []).forEach((dn) => {
            if (dn && dn.type && dn.type !== 'TWITCH_BITS')
                tips.push({
                    at: e.at,
                    who: whoIn(e.data),
                    type: String(dn.type).replace(/_/g, ' ').toLowerCase(),
                    amount: dn.amount,
                    currency: dn.currency || '',
                    count: dn.count || 1,
                    text: textOf(e.data)
                });
        })
    );
    const purchases = rk('purchase');
    const highlighted = rawChats.filter(
        (e) =>
            e.data &&
            Array.isArray(e.data.attributes) &&
            e.data.attributes.some((a) => /HIGHLIGHTED|ANNOUNCEMENT/.test(String(a)))
    );
    const stt = rk('stt');
    const other = raw.filter(
        (e) => !RAW_HANDLED.has(e.kind) && !String(e.kind).startsWith('meld.')
    );

    if (!ev.length) {
        $('page').innerHTML = `<h1>Stream Report <span>🦄</span></h1><div class="meta">${longDate(
            d.date
        )}</div>
        <div class="empty-night">Nothing recorded for this night yet.<br><br>Activity is logged live while ICB and the Meld listener layer are running — chats, follows, subs, gifted subs, cheers, raids, and giveaway activity.</div>`;
        return;
    }

    // Chatters + chat unicorns
    const chatters = {};
    chats.forEach((e) => {
        (chatters[e.username] ||= { msgs: 0, uni: 0 }).msgs++;
    });
    ticks.forEach((t) =>
        t.usernames.forEach((u) => {
            (chatters[u] ||= { msgs: 0, uni: 0 }).uni += t.each || 1;
        })
    );
    const chatterRows = Object.entries(chatters).sort(
        (a, b) => b[1].msgs - a[1].msgs || b[1].uni - a[1].uni
    );

    const subMonths = sum(
            subs.filter((e) => !e.blocked),
            (e) => e.months
        ),
        giftCount = sum(gifts, (e) => e.count),
        bitTotal = sum(bits, (e) => e.amount);
    const gifters = new Set(gifts.map((e) => e.username)).size;
    const unicornsOut =
        sum(ticks, (t) => t.usernames.length * (t.each || 1)) +
        sum(subs, (e) => e.unicorns) +
        sum(gifts, (e) => e.unicorns) +
        sum(bits, (e) => e.unicorns) +
        sum(manual, (e) => e.unicorns);
    const first = ev[0].at,
        last = ev[ev.length - 1].at;

    // Supporters: everyone who followed / subbed / gifted / cheered / raided
    const sup = {};
    const S = (n) => (sup[n] ||= { follow: false, months: 0, gifts: 0, bits: 0, raid: 0 });

    follows.forEach((e) => (S(e.username).follow = true));
    subs.forEach((e) => (S(e.username).months += e.months || 1));
    gifts.forEach((e) => (S(e.username).gifts += e.count || 0));
    bits.forEach((e) => (S(e.username).bits += e.amount || 0));
    raids.forEach((e) => {
        if (e.username) S(e.username).raid += e.viewers || 0;
    });
    const supRows = Object.entries(sup).sort(
        (a, b) =>
            b[1].gifts * 5 +
                b[1].months * 5 +
                b[1].bits / 100 -
                (a[1].gifts * 5 + a[1].months * 5 + a[1].bits / 100) || a[0].localeCompare(b[0])
    );

    $('page').innerHTML = `
      <h1>Stream Report <span>🦄</span></h1>
      <div class="meta">${longDate(d.date)} · activity from ${time(first)} to ${time(
        last
    )} · ijustababyTV</div>

      <div class="cards">
        <div class="c"><div class="n">${follows.length}</div><div class="l">New follows</div></div>
        <div class="c"><div class="n">${
            subs.length
        }</div><div class="l">Subs &amp; resubs</div><div class="x">${plural(
        subMonths,
        'month'
    )}</div></div>
        <div class="c"><div class="n">${giftCount}</div><div class="l">Gifted subs</div><div class="x">from ${plural(
        gifters,
        'gifter'
    )}</div></div>
        <div class="c"><div class="n">${bitTotal.toLocaleString()}</div><div class="l">Bits cheered</div><div class="x">${plural(
        bits.length,
        'cheer'
    )}</div></div>
        <div class="c"><div class="n">${
            raids.length
        }</div><div class="l">Raids</div><div class="x">${sum(
        raids,
        (e) => e.viewers
    )} viewers</div></div>
        <div class="c"><div class="n">${
            Object.keys(chatters).length
        }</div><div class="l">Chatters</div><div class="x">${chats.length.toLocaleString()} messages</div></div>
        <div class="c"><div class="n">${unicornsOut.toLocaleString()}</div><div class="l">Fluffy unicorns given</div></div>
        <div class="c"><div class="n">${
            winners.length
        }</div><div class="l">Giveaway winners</div></div>
        <div class="c"><div class="n">${
            peak ?? '—'
        }</div><div class="l">Peak viewers</div><div class="x">${
        peakAt ? 'at ' + time(new Date(peakAt).toISOString()) : 'no viewer counts yet'
    }</div></div>
        <div class="c"><div class="n">${avg ?? '—'}</div><div class="l">Average viewers</div></div>
        <div class="c"><div class="n">${
            seen.size
        }</div><div class="l">Different people</div><div class="x">watched or chatted</div></div>
        <div class="c"><div class="n">${
            tips.length + purchases.length
        }</div><div class="l">Tips &amp; purchases</div><div class="x">${plural(
        tips.length,
        'tip'
    )} · ${plural(purchases.length, 'purchase')}</div></div>
      </div>

      ${
          vc.length > 1
              ? `<h2>Viewers over the stream <small>peak ${peak} · average ${avg}</small></h2>${sparkline(
                    vc
                )}
        <div class="meta" style="margin:4px 0 0; display:flex; justify-content:space-between;"><span>${time(
            new Date(vc[0].t).toISOString()
        )}</span><span>${time(new Date(vc[vc.length - 1].t).toISOString())}</span></div>`
              : ''
      }

      <h2>Supporters <small>everyone who followed, subbed, gifted, cheered or raided</small></h2>
      ${table(
          [
              { label: 'Viewer' },
              { label: 'Followed' },
              { label: 'Sub months', num: 1 },
              { label: 'Gifted subs', num: 1 },
              { label: 'Bits', num: 1 },
              { label: 'Raid viewers', num: 1 }
          ],
          supRows.map(([n, s]) => [
              esc(n),
              s.follow ? '✓' : '',
              s.months || '',
              s.gifts || '',
              s.bits ? s.bits.toLocaleString() : '',
              s.raid || ''
          ])
      )}

      <h2>Follows <small>${follows.length}</small></h2>
      ${table(
          [{ label: 'Time', t: 1 }, { label: 'Viewer' }],
          follows.map((e) => [time(e.at), esc(e.username)])
      )}

      <h2>Subs &amp; resubs <small>${plural(subMonths, 'month')}</small></h2>
      ${table(
          [
              { label: 'Time', t: 1 },
              { label: 'Viewer' },
              { label: 'Type' },
              { label: 'Tier' },
              { label: 'Months', num: 1 },
              { label: '🦄 earned', num: 1 }
          ],
          subs.map((e) => [
              time(e.at),
              esc(e.username) + (e.blocked ? ' <span class="tag">not in giveaway</span>' : ''),
              subKind(e),
              tier(e.tier),
              e.months || 1,
              e.blocked ? '—' : e.unicorns ?? ''
          ])
      )}

      <h2>Gifted subs <small>${giftCount} total</small></h2>
      ${table(
          [
              { label: 'Time', t: 1 },
              { label: 'Gifter' },
              { label: 'Subs', num: 1 },
              { label: 'Tier' },
              { label: 'Went to' },
              { label: '🦄 earned', num: 1 }
          ],
          gifts.map((e) => [
              time(e.at),
              esc(e.username),
              e.count,
              tier(e.tier),
              esc((e.recipients || []).join(', ')),
              e.blocked ? '—' : e.unicorns ?? ''
          ])
      )}

      <h2>Cheers <small>${bitTotal.toLocaleString()} bits</small></h2>
      ${table(
          [
              { label: 'Time', t: 1 },
              { label: 'Viewer' },
              { label: 'Bits', num: 1 },
              { label: '🦄 earned', num: 1 }
          ],
          bits.map((e) => [
              time(e.at),
              esc(e.username),
              (e.amount || 0).toLocaleString(),
              e.blocked ? '—' : e.unicorns ?? ''
          ])
      )}

      <h2>Raids <small>${raids.length}</small></h2>
      ${table(
          [{ label: 'Time', t: 1 }, { label: 'Raider' }, { label: 'Viewers', num: 1 }],
          raids.map((e) => [time(e.at), esc(e.username || 'unknown'), e.viewers || 0])
      )}

      <h2>Giveaway winners <small>${winners.length}</small></h2>
      ${table(
          [
              { label: 'Time', t: 1 },
              { label: 'Winner' },
              { label: 'Prize' },
              { label: 'Their 🦄', num: 1 },
              { label: '🦄 in the drawing', num: 1 }
          ],
          winners.map((e) => [
              time(e.at),
              esc(e.username),
              e.prize === 'mystery-outfit' ? 'Mystery Outfit' : 'Plushie',
              e.unicorns ?? '',
              e.poolSize ?? ''
          ])
      )}

      <h2>Tips &amp; donations <small>Super Chats, Fourthwall, Kick, TikTok…</small></h2>
      ${table(
          [
              { label: 'Time', t: 1 },
              { label: 'Viewer' },
              { label: 'Type' },
              { label: 'Amount', num: 1 },
              { label: 'Message' }
          ],
          tips.map((t) => [
              time(t.at),
              esc(t.who),
              esc(t.type),
              esc(`${t.amount ?? ''} ${t.currency}`.trim()) + (t.count > 1 ? ` ×${t.count}` : ''),
              `<span class="msg">${esc(t.text)}</span>`
          ])
      )}

      <h2>Shop purchases <small>${purchases.length}</small></h2>
      ${table(
          [
              { label: 'Time', t: 1 },
              { label: 'Buyer' },
              { label: 'Amount', num: 1 },
              { label: 'Details' }
          ],
          purchases.map((e) => [
              time(e.at),
              esc(whoIn(e.data)),
              esc(
                  `${e.data && e.data.total_amount != null ? e.data.total_amount : ''} ${
                      (e.data && e.data.currency) || ''
                  }`.trim()
              ),
              summary(e.data)
          ])
      )}

      <h2>Highlighted messages &amp; announcements <small>${highlighted.length}</small></h2>
      ${table(
          [{ label: 'Time', t: 1 }, { label: 'Viewer' }, { label: 'Message' }],
          highlighted.map((e) => [
              time(e.at),
              esc(whoIn(e.data)),
              `<span class="msg">${esc(textOf(e.data))}</span>`
          ])
      )}

      <h2>Stream timeline <small>going live, scene changes, recording, connection</small></h2>
      ${table(
          [{ label: 'Time', t: 1 }, { label: 'What' }, { label: 'Details' }],
          timeline.map((e) => [
              time(e.at),
              esc(String(e.kind).replace('meld.', 'Meld ').replace(/_/g, ' ')),
              summary(e.data)
          ])
      )}

      <h2>Everyone who watched or chatted <small>${
          seen.size
      } people · grey = watched without chatting</small></h2>
      ${
          seen.size
              ? `<div class="names">${[...seen]
                    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
                    .map((n) => `<span class="${chatNames.has(n) ? '' : 'lurk'}">${esc(n)}</span>`)
                    .join('')}</div>`
              : '<div class="none">None this night.</div>'
      }

      ${
          other.length
              ? `<h2>Other events <small>${other.length}</small></h2>
      ${table(
          [{ label: 'Time', t: 1 }, { label: 'Event' }, { label: 'Who' }, { label: 'Details' }],
          other.map((e) => [time(e.at), esc(e.kind), esc(whoIn(e.data)), summary(e.data)])
      )}`
              : ''
      }

      <div class="two">
        <div>
          <h2>Chat <small>${plural(Object.keys(chatters).length, 'chatter')}</small></h2>
          ${table(
              [
                  { label: 'Viewer' },
                  { label: 'Messages', num: 1 },
                  { label: '🦄 from chat', num: 1 }
              ],
              chatterRows.map(([n, c]) => [esc(n), c.msgs, c.uni || ''])
          )}
        </div>
        <div>
          <h2>Added by hand <small>${manual.length}</small></h2>
          ${table(
              [
                  { label: 'Time', t: 1 },
                  { label: 'Viewer' },
                  { label: 'What' },
                  { label: '🦄', num: 1 }
              ],
              manual.map((e) => [
                  time(e.at),
                  esc(e.username),
                  `${e.amount} ${KIND[e.kind] || ''}${e.reason ? ' · ' + esc(e.reason) : ''}`,
                  (e.unicorns > 0 ? '+' : '') + e.unicorns
              ])
          )}
        </div>
      </div>

      <div class="long">
        <h2>Full chat log <small>${plural(rawChats.length, 'message')}</small></h2>
        ${table(
            [{ label: 'Time', t: 1 }, { label: 'Viewer' }, { label: 'Message' }],
            rawChats.map((e) => [
                time(e.at),
                esc(whoIn(e.data)),
                `<span class="msg">${
                    esc(textOf(e.data)) || '<span style="color:#999">(no text)</span>'
                }</span>`
            ])
        )}
        ${
            stt.length
                ? `<h2>Speech-to-text transcript <small>${stt.length} lines</small></h2>
        ${table(
            [{ label: 'Time', t: 1 }, { label: 'Said' }],
            stt.map((e) => [
                time(e.at),
                `<span class="msg">${esc(textOf(e.data)) || summary(e.data)}</span>`
            ])
        )}`
                : ''
        }
      </div>

      <div class="foot">Rates: ${d.rates.chatWindow} per 10 min of chat · ${
        d.rates.subMonth
    } per sub month · ${d.rates.giftedSub} per gifted sub · 1 per ${d.rates.bitsPerUnicorn} bits.
        Chat messages are counted from ICB's listener; your own account and blocked bots aren't counted in chat. Printed ${new Date().toLocaleString()}.</div>`;
}
