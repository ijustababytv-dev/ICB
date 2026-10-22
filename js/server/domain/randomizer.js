'use strict';



/** Bound game/text lists, make IDs unique, and accept only HTTP(S) stream links. */
function randomizerClean(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const strList = (list, max) => (Array.isArray(list) ? list : []).map(v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max)).filter(Boolean).slice(0, 400);
  const games = [];
  for (const g of (Array.isArray(src.games) ? src.games : []).slice(0, 30)) {
    if (!g || typeof g !== 'object') continue;
    const name = String(g.name || '').trim().slice(0, 40);
    if (!name) continue;
    let id = String(g.id || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'game';
    while (games.some(x => x.id === id)) id += '-2';
    games.push({ id, name, titles: strList(g.titles, 200), golives: strList(g.golives, 500) });
  }
  const recent = {};
  if (src.recent && typeof src.recent === 'object') for (const [k, v] of Object.entries(src.recent).slice(0, 80)) recent[String(k).slice(0, 60)] = strList(v, 500).slice(0, 10);
  const link = /^https?:\/\/\S+$/i.test(String(src.link || '').trim()) ? String(src.link).trim().slice(0, 200) : '';
  return { games, link, recent };
}

Object.assign(exports, { randomizerClean });
