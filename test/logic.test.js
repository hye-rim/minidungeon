'use strict';

// 작은 던전 규칙 시험. 실행: node --test (디렉터리)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const evs = (st, t) => st.events.filter((e) => e.t === t);
const mv = (st, dx, dy) => L.act(st, { type: 'move', dx, dy });
// 시험용 작은 방: 가운데 (10,10) 에서 시작, 모든 칸이 바닥, 괴물·아이템 없음
function room(opts = {}) {
  const st = L.newGame(L.rng(opts.seed || 1), opts);
  for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) st.tiles[y][x] = (x >= 5 && x <= 25 && y >= 5 && y <= 25) ? '.' : '#';
  st.monsters = []; st.items = []; st.stairs = null; st.p.x = 10; st.p.y = 10; st.rooms = [{ x: 5, y: 5, w: 21, h: 21, cx: 15, cy: 15 }]; L.computeFov(st);
  return st;
}
const mon = (st, kind, x, y, asleep = false) => L.addMonster(st, kind, x, y, asleep);

test('every generated floor is connected: all rooms and the stairs can be reached, nothing overlaps, the start room is empty', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const st = L.newGame(L.rng(seed));
    for (let f = 1; f <= L.FLOORS; f++) {
      if (f > 1) L.descend(st, false);
      const d = L.distMap(st);
      assert.ok(st.tiles[st.p.y][st.p.x] === '.' && d[st.p.y][st.p.x] === 0, `seed ${seed} floor ${f}: start is on a floor tile`);
      for (const r of st.rooms) assert.ok(d[r.cy][r.cx] >= 0, `seed ${seed} floor ${f}: room reachable`);
      if (f < L.FLOORS) { assert.ok(st.stairs && d[st.stairs[1]][st.stairs[0]] > 4, `seed ${seed} floor ${f}: stairs reachable and not next to the start`); assert.strictEqual(st.tiles[st.stairs[1]][st.stairs[0]], '>'); }
      else assert.strictEqual(st.stairs, null, 'no stairs on the dragon floor');
      const seen = new Set();
      for (const m of st.monsters) { assert.strictEqual(st.tiles[m.y][m.x], '.'); const k = m.x + ',' + m.y; assert.ok(!seen.has(k), 'no two monsters on one tile'); seen.add(k); assert.ok(!(m.x === st.p.x && m.y === st.p.y)); }
      for (const it of st.items) assert.strictEqual(st.tiles[it.y][it.x], '.', 'items lie on floor');
      const start = st.rooms[0]; if (f < L.FLOORS) assert.ok(!st.monsters.some((m) => m.x >= start.x && m.x < start.x + start.w && m.y >= start.y && m.y < start.y + start.h), 'the start room has no monsters');
      assert.ok(st.items.some((i) => i.kind === 'potion'), 'a potion on every floor');
    }
  }
});

test('floors get more crowded and tougher with depth, and the last floor is the dragon arena', () => {
  const count = (f) => { let n = 0; for (let s = 1; s <= 20; s++) { const st = L.newGame(L.rng(s)); for (let k = 2; k <= f; k++) L.descend(st, false); n += st.monsters.length; } return n / 20; };
  assert.ok(count(6) > count(1) + 3, 'more monsters deeper');
  const early = L.newGame(L.rng(3)); assert.ok(early.monsters.every((m) => L.MONSTER[m.kind].from <= 1 && !L.MONSTER[m.kind].boss));
  const last = L.newGame(L.rng(3)); for (let k = 2; k <= L.FLOORS; k++) L.descend(last, false);
  assert.strictEqual(last.monsters.filter((m) => m.kind === 'dragon').length, 1); assert.strictEqual(last.rooms.length, 1);
  assert.strictEqual(last.monsters.find((m) => m.kind === 'dragon').maxhp, L.DIFF.normal.boss);
  const dungeon = (seed) => { const st = L.newGame(L.rng(seed)); return st.tiles.map((r) => r.join('')).join('|') + st.monsters.map((m) => m.kind + m.x + m.y).join(); };
  assert.strictEqual(dungeon(7), dungeon(7), 'the same seed gives the same dungeon'); assert.notStrictEqual(dungeon(7), dungeon(8));
});

test('moving: walls block without using a turn, open floor moves one step and passes the turn', () => {
  const st = room(); st.p.x = 5; st.p.y = 5; const t0 = st.turn;
  assert.strictEqual(mv(st, -1, 0), false, 'a wall does not use a turn'); assert.strictEqual(st.turn, t0);
  assert.strictEqual(mv(st, 1, 0), true); assert.strictEqual(st.p.x, 6); assert.strictEqual(st.turn, t0 + 1);
  assert.strictEqual(L.act(st, { type: 'wait' }), true); assert.strictEqual(st.turn, t0 + 2);
  assert.strictEqual(L.act(st, { type: 'bogus' }), false);
});

test('bumping a monster attacks it with a sensible damage roll, kills give experience, and the monsters hit back', () => {
  const st = room(); const m = mon(st, 'slime', 11, 10); m.hp = m.maxhp = 100; const atk = L.playerAtk(st);
  const seen = new Set(); for (let i = 0; i < 60; i++) { m.hp = 100; st.p.hp = 9999; st.p.maxhp = 9999; L.act(st, { type: 'move', dx: 1, dy: 0 }); const a = evs(st, 'attack')[0]; seen.add(a.dmg); }
  assert.ok([...seen].every((d) => d >= atk - 1 && d <= atk + 1), 'damage is attack ± 1 (' + [...seen].join() + ')'); assert.ok(seen.size >= 2, 'the roll varies');
  assert.strictEqual(st.p.x, 10, 'attacking does not move');
  const k = room(); const rat = mon(k, 'rat', 11, 10); rat.hp = 1; const xp0 = k.p.xp; mv(k, 1, 0);
  assert.strictEqual(k.kills, 1); assert.strictEqual(k.p.xp, xp0 + L.MONSTER.rat.xp); assert.ok(evs(k, 'kill').length === 1);
  const h = room(); mon(h, 'orc', 11, 10); const hp0 = h.p.hp; L.act(h, { type: 'wait' }); assert.ok(h.p.hp < hp0, 'an adjacent orc hits when I wait');
  const g = room(); g.p.armor = 3; const o = mon(g, 'rat', 11, 10); const hp1 = g.p.hp; for (let i = 0; i < 10; i++) L.act(g, { type: 'wait' }); assert.ok(g.p.hp >= hp1 - 10 && g.p.hp > hp1 - 25, 'armor reduces damage'); void o;
});

test('monsters sleep until the player is close, then wake and chase by the shortest path; bats flutter around', () => {
  const st = room(); const far = mon(st, 'rat', 24, 24, true), near = mon(st, 'rat', 13, 10, true);
  L.act(st, { type: 'wait' }); assert.strictEqual(near.asleep, false, 'the near one woke'); assert.ok(evs(st, 'wake').length >= 1); assert.strictEqual(far.asleep, true, 'the far one still sleeps');
  const c = room(); const m = mon(c, 'skeleton', 18, 10); const d0 = Math.abs(m.x - c.p.x); L.act(c, { type: 'wait' }); L.act(c, { type: 'wait' }); assert.ok(Math.abs(m.x - c.p.x) < d0, 'it came closer');
  const w = room(); for (let y = 5; y <= 25; y++) w.tiles[y][14] = '#'; w.tiles[20][14] = '.'; const e = mon(w, 'rat', 18, 10); let steps = 0; for (let i = 0; i < 40 && Math.abs(e.x - w.p.x) + Math.abs(e.y - w.p.y) > 1; i++) { L.act(w, { type: 'wait' }); w.p.hp = w.p.maxhp; steps++; }
  assert.ok(steps > 10, 'it walks around the wall through the gap (' + steps + ' turns)');
  const b = room(); const bat = mon(b, 'bat', 20, 10); let wrong = 0; for (let i = 0; i < 40; i++) { const before = Math.abs(bat.x - b.p.x) + Math.abs(bat.y - b.p.y); L.act(b, { type: 'move', dx: 0, dy: 0 }) || L.act(b, { type: 'wait' }); b.p.hp = b.p.maxhp; const after = Math.abs(bat.x - b.p.x) + Math.abs(bat.y - b.p.y); if (after > before) wrong++; if (after <= 1) { bat.x = 20; bat.y = 10; } }
  assert.ok(wrong >= 3, 'a bat sometimes flies the wrong way (' + wrong + ')');
});

test('archers and mages shoot along a clear line, walls block the line, and the dragon breathes fire and calls bats', () => {
  const st = room(); const a = mon(st, 'archer', 14, 10); const hp0 = st.p.hp; L.act(st, { type: 'wait' });
  assert.ok(st.p.hp < hp0 && evs(st, 'shoot').length === 1, 'shot from range');
  const w = room(); const a2 = mon(w, 'archer', 14, 10); w.tiles[10][12] = '#'; const hp1 = w.p.hp; L.act(w, { type: 'wait' }); assert.strictEqual(w.p.hp, hp1, 'a wall blocks the shot'); assert.ok(a2);
  const off = room(); mon(off, 'archer', 14, 14); const hp2 = off.p.hp; L.act(off, { type: 'wait' }); assert.strictEqual(off.p.hp, hp2, 'not in line: no shot (it walks closer)');
  const far = room(); mon(far, 'archer', 25, 10); const hp3 = far.p.hp; L.act(far, { type: 'wait' }); assert.strictEqual(far.p.hp, hp3, 'out of range');
  const d = room(); const dr = mon(d, 'dragon', 15, 10); dr.hp = dr.maxhp = 1000; let fire = 0, bats = 0; for (let i = 0; i < 24; i++) { d.p.hp = d.p.maxhp; d.p.x = 8; d.p.y = 10; dr.x = 15; dr.y = 10; L.act(d, { type: 'wait' }); fire += evs(d, 'shoot').length; bats += evs(d, 'summon').length; }
  assert.ok(fire >= 4, 'fire breath (' + fire + ')'); assert.ok(bats >= 2, 'the dragon calls bats (' + bats + ')');
});

test('potions heal up to the maximum and are kept when at full health, gold and gear are picked up, worse gear turns into gold', () => {
  const st = room(); st.p.hp = 5; st.inv.potion = 2; L.act(st, { type: 'use', item: 'potion' });
  assert.ok(st.p.hp >= 20 && st.p.hp <= st.p.maxhp && st.inv.potion === 1); const full = st.p.maxhp; st.p.hp = full; const t = st.turn; assert.strictEqual(L.act(st, { type: 'use', item: 'potion' }), false, 'no waste at full health'); assert.strictEqual(st.inv.potion, 1); assert.strictEqual(st.turn, t);
  const g = room(); g.items.push({ id: 90, kind: 'gold', x: 11, y: 10, value: 12 }, { id: 91, kind: 'weapon', x: 12, y: 10, tier: 1 }, { id: 92, kind: 'weapon', x: 13, y: 10, tier: 0 }, { id: 93, kind: 'armor', x: 14, y: 10, tier: 2 }, { id: 94, kind: 'potion', x: 15, y: 10 });
  for (let i = 0; i < 5; i++) mv(g, 1, 0);
  assert.strictEqual(g.gold, 12 + 5, 'gold and a worse weapon turned into gold'); assert.strictEqual(g.p.weapon, 1); assert.strictEqual(g.p.armor, 2); assert.ok(L.playerAtk(g) === 3 + L.WEAPONS[1].atk && L.playerDef(g) === L.ARMORS[2].def); assert.strictEqual(g.inv.potion, 2);
  assert.strictEqual(g.items.length, 0);
});

test('scrolls: lightning hits only monsters in view, teleport moves far away, the map shows the whole floor', () => {
  const st = room(); st.inv.bolt = 1; const seenM = mon(st, 'orc', 13, 10), hidden = mon(st, 'orc', 20, 24); st.tiles[24][19] = '#'; st.tiles[23][20] = '#'; st.tiles[25][20] = '#'; st.tiles[24][21] = '#';
  for (let x = 7; x <= 19; x++) st.tiles[18][x] = '#'; L.computeFov(st); const h0 = seenM.hp, h1 = hidden.hp; L.act(st, { type: 'use', item: 'bolt' });
  assert.ok(seenM.hp < h0, 'the visible orc was hit'); assert.strictEqual(hidden.hp, h1, 'the hidden one was not'); assert.strictEqual(st.inv.bolt, 0);
  const t = room(); t.inv.tele = 1; const x0 = t.p.x, y0 = t.p.y; L.act(t, { type: 'use', item: 'tele' }); assert.ok(Math.abs(t.p.x - x0) + Math.abs(t.p.y - y0) > 8, 'far from where I stood');
  const m = L.newGame(L.rng(4)); m.inv.map = 1; const unseen = () => { let n = 0; for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) if (m.tiles[y][x] !== '#' && !m.seen[y][x]) n++; return n; };
  assert.ok(unseen() > 20); L.act(m, { type: 'use', item: 'map' }); assert.strictEqual(unseen(), 0);
  const none = room(); assert.strictEqual(L.act(none, { type: 'use', item: 'bolt' }), false, 'cannot use what I do not have');
});

test('sight: walls block it, it has a radius, and explored tiles are remembered', () => {
  const st = room(); st.p.sight = 5; for (let y = 5; y <= 25; y++) st.tiles[y][13] = '#'; L.computeFov(st);
  assert.ok(st.vis[10][12] && !st.vis[10][14], 'a wall hides what is behind it'); assert.ok(!st.vis[10][20], 'beyond the radius');
  assert.ok(L.los(st, 10, 10, 12, 12) && !L.los(st, 10, 10, 15, 10));
  const s = room(); s.p.sight = 4; L.computeFov(s); const seenBefore = s.seen[10][13]; s.p.x = 20; s.p.y = 20; L.computeFov(s); assert.ok(seenBefore && s.seen[10][13] && !s.vis[10][13], 'remembered but not currently visible');
});

test('levelling up offers three different perks, each does what it says, and the game waits for the choice', () => {
  const st = room(); const r = mon(st, 'rat', 11, 10); r.hp = 1; st.p.xp = st.p.need - 1; mv(st, 1, 0);
  assert.strictEqual(st.phase, 'levelup'); assert.strictEqual(st.choices.length, 3); assert.strictEqual(new Set(st.choices).size, 3); assert.strictEqual(st.p.level, 2);
  assert.strictEqual(L.act(st, { type: 'wait' }), false, 'no actions while choosing');
  const p = (k) => { const s = room(); s.phase = 'levelup'; s.choices = [k, 'atk', 'def']; s.pending = 1; return s; };
  const a = p('hp'); const mh = a.p.maxhp; a.p.hp = 1; L.choose(a, 0); assert.strictEqual(a.p.maxhp, mh + 10); assert.strictEqual(a.p.hp, 11);
  const b = p('atk'); const at = b.p.atk; L.choose(b, 0); assert.strictEqual(b.p.atk, at + 1); const c = p('def'); L.choose(c, 0); assert.strictEqual(c.p.def, 1); const d = p('sight'); const sg = d.p.sight; L.choose(d, 0); assert.strictEqual(d.p.sight, sg + 1);
  const e = p('vamp'); L.choose(e, 0); const rr = mon(e, 'rat', 11, 10); rr.hp = 1; e.p.hp = 5; mv(e, 1, 0); assert.ok(e.p.hp >= 6, 'vampire heals on a kill');
  const cap = room(); cap.p.perks.sight = 3; assert.ok(!L.makeChoices(cap).includes('sight'), 'sight stops at three'); assert.strictEqual(L.choose(room(), 0), false);
  const two = room(); mon(two, 'orc', 11, 10).hp = 1; two.p.xp = L.needFor(1) + L.needFor(2) + 100; two.p.xp = two.p.need * 3; mv(two, 1, 0); assert.strictEqual(two.phase, 'levelup'); L.choose(two, 0); assert.ok(two.phase === 'levelup' || two.pending === 0);
});

test('stairs only work when standing on them, lead to a new floor with the same hero, and the dragon floor ends in a win with a bonus score', () => {
  const st = L.newGame(L.rng(2)); assert.strictEqual(L.act(st, { type: 'descend' }), false, 'not on the stairs'); st.p.x = st.stairs[0]; st.p.y = st.stairs[1]; const hp = st.p.hp, gold = st.gold;
  assert.strictEqual(L.act(st, { type: 'descend' }), true); assert.strictEqual(st.floor, 2); assert.strictEqual(st.p.hp, hp); assert.strictEqual(st.gold, gold); assert.ok(evs(st, 'descend').length === 1);
  const b = L.newGame(L.rng(2)); for (let f = 2; f <= L.FLOORS; f++) L.descend(b, false); assert.strictEqual(b.floor, L.FLOORS);
  const dragon = b.monsters.find((m) => m.kind === 'dragon'); dragon.x = b.p.x + 1; dragon.y = b.p.y; dragon.hp = 1; b.p.atk = 50; const s0 = L.score(b); mv(b, 1, 0);
  assert.strictEqual(b.phase, 'win'); assert.ok(b.won && L.score(b) >= s0 + 2000); assert.ok(evs(b, 'win').length === 1); assert.strictEqual(L.act(b, { type: 'wait' }), false);
});

test('dying ends the game, the tutorial setup has a weak rat and a potion in the first room, and the score counts gold, depth and kills', () => {
  const st = room(); st.p.hp = 1; mon(st, 'orc', 11, 10); L.act(st, { type: 'wait' }); assert.strictEqual(st.phase, 'dead'); assert.strictEqual(L.act(st, { type: 'wait' }), false);
  const t = L.newGame(L.rng(1), { tutorial: true }); assert.strictEqual(t.monsters.length, 1); assert.ok(t.monsters[0].maxhp <= 2 && t.items.some((i) => i.kind === 'potion'));
  const r0 = t.rooms[0]; assert.ok(t.monsters[0].x >= r0.x && t.monsters[0].x < r0.x + r0.w);
  const sc = room(); sc.gold = 50; sc.kills = 4; sc.floor = 3; assert.strictEqual(L.score(sc), 50 + 300 + 20);
  const e = L.newGame(L.rng(1), { diff: 'easy' }), n = L.newGame(L.rng(1), { diff: 'normal' }); assert.ok(e.p.maxhp > n.p.maxhp && L.DIFF.easy.dmg < L.DIFF.normal.dmg && L.DIFF.easy.boss < L.DIFF.normal.boss);
});

test('balance check: a bot that only dives dies early, one that explores for items and rests goes much deeper and can win, more easily on easy', () => {
  const kit = botKit();
  const runs = (diff, mode, n) => { const r = []; for (let s = 1; s <= n; s++) r.push(kit.run(s, diff, mode)); return r; };
  const avg = (r) => r.reduce((a, x) => a + x.floor, 0) / r.length;
  const diveE = runs('easy', 'dive', 10), carefulE = runs('easy', 'careful', 10), carefulN = runs('normal', 'careful', 10);
  assert.ok(avg(carefulE) > avg(diveE) + 1.5, `exploring beats diving (${avg(carefulE).toFixed(1)} vs ${avg(diveE).toFixed(1)})`);
  assert.ok(avg(carefulN) > 4.5, 'a careful bot reaches the fifth floor on normal (' + avg(carefulN).toFixed(1) + ')');
  assert.ok(avg(carefulE) >= avg(carefulN) - 0.3, 'easy is not harder than normal');
  assert.ok(carefulE.some((x) => x.phase === 'win') || runs('easy', 'careful', 30).some((x) => x.phase === 'win'), 'the dragon can be beaten');
});

test('a long random run keeps everything consistent: the hero stays on floor tiles, health stays in range, monsters never stack', () => {
  const rand = L.rng(11); const st = L.newGame(L.rng(6)); let n = 0;
  for (let i = 0; i < 4000 && st.phase !== 'dead' && st.phase !== 'win'; i++) {
    if (st.phase === 'levelup') { L.choose(st, Math.floor(rand() * 3)); continue; }
    const d = L.DIRS[Math.floor(rand() * 4)]; L.act(st, rand() < 0.1 ? { type: 'wait' } : rand() < 0.03 ? { type: 'descend' } : { type: 'move', dx: d[0], dy: d[1] }); n++;
    assert.ok(st.tiles[st.p.y][st.p.x] !== '#'); assert.ok(st.p.hp <= st.p.maxhp);
    const keys = new Set(); for (const m of st.monsters) if (m.hp > 0) { const k = m.x + ',' + m.y; assert.ok(!keys.has(k), 'stacked monsters'); keys.add(k); assert.ok(st.tiles[m.y][m.x] !== '#'); }
    if (st.rand() < 0.002 && st.tiles[st.p.y][st.p.x] === '>') L.act(st, { type: 'descend' });
  }
  assert.ok(n > 50);
});

// ---------- 시험용 봇 ----------
function botKit() {
  const DIRS = L.DIRS;
  const bfs = (st, sx, sy, goal) => {
    const W = L.W, H = L.H, prev = new Map(); const q = [[sx, sy]]; prev.set(sy * W + sx, null);
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i]; if (goal(x, y) && !(x === sx && y === sy)) { let c = [x, y], p; while ((p = prev.get(c[1] * W + c[0])) && !(p[0] === sx && p[1] === sy)) c = p; return [c[0] - sx, c[1] - sy]; }
      for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H || prev.has(ny * W + nx) || st.tiles[ny][nx] === '#') continue; prev.set(ny * W + nx, [x, y]); q.push([nx, ny]); }
    }
    return null;
  };
  const decide = (st, mode) => {
    const p = st.p;
    const adj = st.monsters.find((m) => m.hp > 0 && Math.abs(m.x - p.x) + Math.abs(m.y - p.y) === 1);
    const vis = st.monsters.filter((m) => m.hp > 0 && st.vis[m.y][m.x] && !m.asleep);
    if (p.hp < p.maxhp * 0.45 && st.inv.potion > 0 && (adj || vis.length)) return { type: 'use', item: 'potion' };
    if (vis.length >= 2 && st.inv.bolt > 0) return { type: 'use', item: 'bolt' };
    if (adj) return { type: 'move', dx: adj.x - p.x, dy: adj.y - p.y };
    if (p.hp < p.maxhp * 0.5 && st.inv.potion > 0 && mode === 'careful') return { type: 'use', item: 'potion' };
    if (p.hp < p.maxhp * 0.6 && !vis.length && mode === 'careful') return { type: 'wait' };
    if (st.tiles[p.y][p.x] === '>') { if (mode === 'careful' && p.hp < p.maxhp * 0.8 && !vis.length) return { type: 'wait' }; return { type: 'descend' }; }
    let d = null;
    if (mode !== 'dive') d = bfs(st, p.x, p.y, (x, y) => st.seen[y][x] && st.items.some((i) => i.x === x && i.y === y));
    if (!d && st.stairs && st.seen[st.stairs[1]][st.stairs[0]]) d = bfs(st, p.x, p.y, (x, y) => x === st.stairs[0] && y === st.stairs[1]);
    if (!d) d = bfs(st, p.x, p.y, (x, y) => st.tiles[y][x] !== '#' && !st.seen[y][x]);
    if (!d) d = bfs(st, p.x, p.y, (x, y) => st.stairs && x === st.stairs[0] && y === st.stairs[1]);
    return d ? { type: 'move', dx: d[0], dy: d[1] } : { type: 'wait' };
  };
  const perk = (st) => { const order = ['hp', 'atk', 'def', 'vamp', 'sight', 'luck']; let best = 0, bi = 99; st.choices.forEach((k, i) => { const r = order.indexOf(k); if (r < bi) { bi = r; best = i; } }); L.choose(st, best); };
  const run = (seed, diff, mode) => {
    const st = L.newGame(L.rng(seed), { diff }); let n = 0;
    while (st.phase !== 'dead' && st.phase !== 'win' && n < 20000) { if (st.phase === 'levelup') { perk(st); continue; } L.act(st, decide(st, mode)) || L.act(st, { type: 'wait' }); n++; }
    return { floor: st.floor, phase: st.phase };
  };
  return { run };
}
