// Logique du jeu, indépendante de Netlify (testable avec un faux stockage).
// Stockage : room/<code>/state, room/<code>/board (classement général), room/<code>/p/<pid> (un par joueur)

const COLORS = ['#e8455f','#e8b45a','#7fc4a8','#a98be0','#f08a4b','#5fb4e8','#f28dc0','#8fc45a','#3fc9c9','#e8e05a','#ff7b6b','#fbf1e4'];
const MAX_TAPS_PER_SEC = 16;
const COUNTDOWN_MS = 4500;
const MAX_PLAYERS = 60;
const DIST_MAX_MS = 90000;     // une course « distance » s'arrête au plus tard après 90 s
const CHRONO_GRACE_MS = 2500;  // délai pour recevoir les dernières tapes après le gong
const LENS = [50, 80, 130];
const DURS = [20, 40, 60, 80];

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const clean = (s, n) => String(s ?? '').replace(/[^a-z0-9]/gi, '').slice(0, n).toLowerCase();
const catOf = (st) => st.mode === 'chrono' ? `chrono-${st.dur}` : `dist-${st.len}`;

function publicState(st, now) {
  return {
    now, phase: st.phase, mode: st.mode || 'dist', len: st.len, dur: st.dur || 60,
    raceId: st.raceId, startAt: st.startAt, endAt: st.endAt || 0,
    participants: st.participants || [], results: st.results || null, cat: catOf(st),
    tournament: st.tournament || { scoring: "off", rounds: 3, played: 0, scores: [] },
  };
}

async function readPlayers(store, room) {
  const { blobs } = await store.list({ prefix: `room/${room}/p/` });
  const all = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' }).catch(() => null)));
  return all.filter(Boolean);
}

function computeResults(st, players) {
  const racers = players.filter(p => st.participants.includes(p.pid)).map(p => {
    const mine = p.raceId === st.raceId;
    return { pid: p.pid, name: p.name, color: p.color, taps: mine ? p.taps : 0, ms: mine ? p.finishMs : null };
  });
  if (st.mode === 'chrono') {
    racers.sort((a, b) => b.taps - a.taps);
    return racers.map((r, i) => ({
      pid: r.pid, name: r.name, color: r.color, rank: i && racers[i-1].taps === r.taps ? racers.findIndex(x => x.taps === r.taps) + 1 : i + 1, taps: r.taps,
      score: r.taps, msPerTap: r.taps ? Math.round(st.dur * 1000 / r.taps) : null,
    }));
  }
  racers.sort((a, b) => {
    const fa = a.ms != null, fb = b.ms != null;
    if (fa && fb) return a.ms - b.ms;
    if (fa !== fb) return fa ? -1 : 1;
    return b.taps - a.taps;
  });
  return racers.map((r, i) => ({
    pid: r.pid, name: r.name, color: r.color, rank: i && racers[i-1].ms === r.ms && (r.ms != null || racers[i-1].taps === r.taps) ? racers.findIndex(x => x.ms === r.ms && (r.ms != null || x.taps === r.taps)) + 1 : i + 1, taps: r.taps,
    pct: Math.round(Math.min(r.taps / st.len, 1) * 100), ms: r.ms ?? null, score: r.ms ?? null,
  }));
}

function updateBoard(board, st, results) {
  board = board || { cats: {} };
  const cat = catOf(st);
  const list = board.cats[cat] || [];
  const better = st.mode === 'chrono' ? (a, b) => a > b : (a, b) => a < b;
  for (const r of results) {
    if (r.score == null || r.score === 0) continue;
    const old = list.find(e => e.pid === r.pid);
    if (!old) list.push({ pid: r.pid, name: r.name, color: r.color, score: r.score, msPerTap: r.msPerTap ?? null, at: Date.now() });
    else {
      old.name = r.name; old.color = r.color;
      if (better(r.score, old.score)) { old.score = r.score; old.msPerTap = r.msPerTap ?? null; old.at = Date.now(); }
    }
  }
  list.sort((a, b) => st.mode === 'chrono' ? b.score - a.score : a.score - b.score);
  board.cats[cat] = list.slice(0, 100);
  return board;
}

export async function handle(req, store) {
  const now = Date.now();
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  let body = {};
  if (req.method === 'POST') {
    try { body = await req.json(); } catch { return json(400, { error: 'JSON invalide' }); }
  }
  const q = (k) => body[k] ?? url.searchParams.get(k);
  const room = clean(q('room'), 8);
  if (route === 'ping') return json(200, { ok: true, now });
  if (!room) return json(400, { error: 'Code de partie manquant' });

  const stateKey = `room/${room}/state`;
  const boardKey = `room/${room}/board`;
  const pKey = (pid) => `room/${room}/p/${pid}`;
  const st = await store.get(stateKey, { type: 'json' });
  if (st) { st.mode = st.mode || 'dist'; st.dur = st.dur || 60; }

  // ---------- ANIMATEUR ----------
  if (route === 'create' && req.method === 'POST') {
    const key = String(body.key || '').slice(0, 40);
    if (key.length < 12) return json(400, { error: 'Clé trop courte' });
    if (st && st.key !== key) return json(409, { error: 'Code déjà utilisé' });
    if (!st) {
      await store.setJSON(stateKey, { key, phase: 'lobby', mode: 'dist', len: 80, dur: 60, raceId: 0, startAt: 0, endAt: 0, participants: [], results: null, created: now });
    }
    return json(200, { ok: true, now });
  }

  if (route === 'host') {
    if (!st) return json(404, { error: 'Partie introuvable' });
    if (String(q('key') || '') !== st.key) return json(403, { error: 'Clé animateur invalide' });

    if (req.method === 'GET') {
      const [players, board] = await Promise.all([readPlayers(store, room), store.get(boardKey, { type: 'json' })]);
      return json(200, { state: publicState(st, now), players, board: board || { cats: {} } });
    }

    const action = body.action;
    if (action === 'config') {
      if (st.phase === 'race') return json(409, { error: 'Course en cours' });
      st.tournament ||= { scoring: 'off', rounds: 3, played: 0, scores: [] };
      const locked = st.tournament.scoring !== 'off' && st.tournament.played > 0;
      if (locked && (body.mode || body.len || body.dur)) return json(409, { error: 'Tournoi en cours : mode et réglage verrouillés jusqu\'à la fin.' });
      if (body.mode === 'chrono' || body.mode === 'dist') st.mode = body.mode;
      if (['off', 'top3', 'all'].includes(body.scoring) && !st.tournament.played) st.tournament.scoring = body.scoring;
      if ([3, 5].includes(+body.rounds) && !st.tournament.played) st.tournament.rounds = +body.rounds;
      if (LENS.includes(+body.len)) st.len = +body.len;
      if (DURS.includes(+body.dur)) st.dur = +body.dur;
    } else if (action === 'start') {
      const players = await readPlayers(store, room);
      if (st.phase === 'race') return json(409, { error: 'Course déjà en cours' });
      if (st.tournament?.scoring !== 'off' && st.tournament?.played >= st.tournament?.rounds) return json(409, { error: 'Tournoi terminé : remets le tournoi à zéro.' });
      if (!players.length) return json(400, { error: 'Aucun joueur' });
      st.raceId = (st.raceId || 0) + 1;
      st.participants = players.map(p => p.pid);
      st.startAt = now + COUNTDOWN_MS;
      st.endAt = st.startAt + (st.mode === 'chrono' ? st.dur * 1000 : DIST_MAX_MS);
      st.phase = 'race';
      st.results = null;
    } else if (action === 'end') {
      if (st.phase !== 'race') return json(200, { state: publicState(st, now) });
      const players = await readPlayers(store, room);
      st.results = computeResults(st, players);
      const tournament = st.tournament;
      if (tournament && tournament.scoring !== 'off') {
        const scores = tournament.scores || [];
        for (const r of st.results) {
          const points = tournament.scoring === 'top3' ? Math.max(0, 4 - r.rank) : Math.max(0, st.results.length - r.rank + 1);
          let entry = scores.find(x => x.pid === r.pid);
          if (!entry) { entry = { pid: r.pid, name: r.name, color: r.color, points: 0, wins: 0 }; scores.push(entry); }
          entry.name = r.name; entry.color = r.color; entry.points += points; r.points = points;
          entry.wins = (entry.wins || 0) + (r.rank === 1 ? 1 : 0);
          entry.lastRank = r.rank;
        }
        // départage : points, puis nombre de manches gagnées, puis classement de la dernière manche
        const cmp = (a, b) => (b.points - a.points) || ((b.wins || 0) - (a.wins || 0)) || ((a.lastRank ?? 999) - (b.lastRank ?? 999));
        scores.sort(cmp);
        scores.forEach((e, i) => { e.rank = i && cmp(scores[i - 1], e) === 0 ? scores[i - 1].rank : i + 1; });
        tournament.scores = scores; tournament.played++;
        tournament.done = tournament.played >= tournament.rounds;
      }
      st.phase = 'end';
      const board = updateBoard(await store.get(boardKey, { type: 'json' }), st, st.results);
      await store.setJSON(boardKey, board);
      await store.setJSON(stateKey, st);
      return json(200, { state: publicState(st, now), board });
    } else if (action === 'lobby') {
      st.phase = 'lobby';
      st.results = null;
    } else if (action === 'resettournament') {
      if (st.phase === 'race') return json(409, { error: 'Course en cours' });
      st.tournament = { scoring: st.tournament?.scoring || 'off', rounds: st.tournament?.rounds || 3, played: 0, scores: [], done: false };
    } else if (action === 'resetboard') {
      await store.setJSON(boardKey, { cats: {} });
      return json(200, { ok: true, board: { cats: {} } });
    } else if (action === 'kick') {
      await store.delete(pKey(clean(body.pid, 24)));
      return json(200, { ok: true });
    } else {
      return json(400, { error: 'Action inconnue' });
    }
    await store.setJSON(stateKey, st);
    return json(200, { state: publicState(st, now) });
  }

  // ---------- JOUEURS ----------
  if (!st) return json(404, { error: 'Partie introuvable. Rescanne le QR code affiché à l\'écran.' });
  const pid = clean(q('pid'), 24);
  if (pid.length < 6) return json(400, { error: 'Identifiant joueur invalide' });

  if (route === 'join' && req.method === 'POST') {
    const name = String(body.name || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
    if (!name) return json(400, { error: 'Il faut un prénom.' });
    const color = COLORS.includes(body.color) ? body.color : null;
    if (!color) return json(400, { error: 'Choisis une couleur.' });
    const players = await readPlayers(store, room);
    const others = players.filter(p => p.pid !== pid);
    const taken = others.map(p => p.color);
    if (taken.includes(color) && taken.length < COLORS.length) {
      return json(409, { error: 'Cette couleur vient d\'être prise, choisis-en une autre.', taken });
    }
    const existing = players.find(p => p.pid === pid);
    if (!existing && players.length >= MAX_PLAYERS) return json(403, { error: 'La partie est complète.' });
    const me = existing ? { ...existing, name, color } : { pid, name, color, raceId: null, taps: 0, finishMs: null, joined: now };
    await store.setJSON(pKey(pid), me);
    return json(200, { me, state: publicState(st, now) });
  }

  if (route === 'me') {
    const me = await store.get(pKey(pid), { type: 'json' });
    const out = { me: me || null, state: publicState(st, now) };
    if (!me) out.taken = (await readPlayers(store, room)).map(p => p.color);
    if (me && st.phase === 'end') {
      const board = await store.get(boardKey, { type: 'json' });
      const list = board?.cats?.[catOf(st)] || [];
      const i = list.findIndex(e => e.pid === pid);
      if (i >= 0) out.best = { ...list[i], rank: i + 1, total: list.length };
    }
    return json(200, out);
  }

  if (route === 'tap' && req.method === 'POST') {
    const state = publicState(st, now);
    const chrono = st.mode === 'chrono';
    const late = chrono ? now > st.endAt + CHRONO_GRACE_MS : now > st.endAt;
    if (st.phase !== 'race' || Number(body.raceId) !== st.raceId || !st.participants.includes(pid) || now < st.startAt || late) {
      return json(200, { state, accepted: null });
    }
    const me = await store.get(pKey(pid), { type: 'json' });
    if (!me) return json(200, { state, accepted: null, me: null });
    const elapsed = Math.min(now, chrono ? st.endAt : now) - st.startAt;
    const cap = Math.floor(elapsed * MAX_TAPS_PER_SEC / 1000) + 3;
    const wanted = Math.max(0, parseInt(body.taps, 10) || 0);
    const sameRace = me.raceId === st.raceId;
    const prev = sameRace ? me.taps : 0;
    const limit = chrono ? Infinity : st.len;
    const taps = Math.max(prev, Math.min(wanted, cap, limit));
    let changed = !sameRace || taps !== prev;
    if (!sameRace) { me.raceId = st.raceId; me.finishMs = null; }
    me.taps = taps;
    if (!chrono && taps >= st.len && me.finishMs == null) {
      // temps mesuré par le téléphone (précis à la ms), borné par ce qui est physiquement possible
      const minMs = Math.round(Math.max(0, st.len - 3) * 1000 / MAX_TAPS_PER_SEC);
      const maxMs = now - st.startAt;
      const claimed = Number(body.finishMs);
      me.finishMs = Number.isFinite(claimed) ? Math.round(Math.min(Math.max(claimed, minMs), maxMs)) : maxMs;
      changed = true;
    }
    if (changed) await store.setJSON(pKey(pid), me);
    return json(200, { state, accepted: taps, finishMs: me.finishMs ?? null });
  }

  return json(404, { error: 'Route inconnue' });
}
