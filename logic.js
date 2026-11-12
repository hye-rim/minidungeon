'use strict';
// 작은 던전 규칙 (DOM 없음). 화면은 game.js, 시험은 test/logic.test.js
// 한 칸씩 움직이는 턴제 던전: 내가 한 번 움직이거나 쉬면 괴물들이 한 번씩 움직인다. 같은 난수(시드)면 같은 던전이 나온다.
// 좌표는 칸(x 오른쪽, y 아래쪽). 움직임은 위아래좌우 네 방향만.
const LOGIC_MD = (() => {
  const W = 31, H = 31, FLOORS = 8, VIEW = 15;
  const DIFF = { easy: { name: '쉬움', hp: 34, mon: 0.8, dmg: 0.7, boss: 60 }, normal: { name: '보통', hp: 28, mon: 0.9, dmg: 0.85, boss: 70 } };
  const MONSTER = {
    rat: { name: '쥐', icon: '🐀', hp: 4, atk: 2, def: 0, xp: 2, from: 1, to: 3, w: 5 },
    bat: { name: '박쥐', icon: '🦇', hp: 5, atk: 2, def: 0, xp: 3, from: 1, to: 4, w: 4, erratic: true },
    slime: { name: '슬라임', icon: '🟢', hp: 10, atk: 3, def: 0, xp: 4, from: 2, to: 5, w: 4 },
    skeleton: { name: '해골', icon: '💀', hp: 12, atk: 5, def: 1, xp: 6, from: 3, to: 6, w: 4 },
    archer: { name: '고블린 궁수', icon: '🏹', hp: 8, atk: 4, def: 0, xp: 6, from: 3, to: 7, w: 3, range: 5 },
    orc: { name: '오크', icon: '👹', hp: 22, atk: 7, def: 2, xp: 12, from: 5, to: 8, w: 4 },
    mage: { name: '마법사', icon: '🧙', hp: 12, atk: 6, def: 0, xp: 12, from: 6, to: 8, w: 3, range: 6 },
    dragon: { name: '용', icon: '🐉', hp: 90, atk: 11, def: 3, xp: 100, from: 99, to: 99, w: 0, boss: true, range: 7 },
  };
  const WEAPONS = [{ name: '단검', atk: 1 }, { name: '검', atk: 3 }, { name: '도끼', atk: 5 }, { name: '대검', atk: 7 }];
  const ARMORS = [{ name: '가죽 옷', def: 1 }, { name: '사슬 갑옷', def: 2 }, { name: '판금 갑옷', def: 3 }, { name: '용비늘', def: 5 }];
  const PERKS = {
    hp: { name: '튼튼한 몸', icon: '❤️', desc: '최대 체력 +10, 10 회복' },
    atk: { name: '날카로운 손', icon: '⚔️', desc: '공격 +1' },
    def: { name: '단단한 피부', icon: '🛡️', desc: '방어 +1' },
    sight: { name: '밝은 눈', icon: '👁️', desc: '시야 +1칸', max: 3 },
    vamp: { name: '흡혈', icon: '🧛', desc: '괴물을 쓰러뜨리면 체력 +1' },
    luck: { name: '행운', icon: '🍀', desc: '다음 층부터 아이템이 더 많이 나온다', max: 3 },
  };
  const SCROLLS = { bolt: { name: '번개 두루마리', icon: '⚡', desc: '보이는 괴물 모두에게 큰 피해' }, tele: { name: '순간이동 두루마리', icon: '🌀', desc: '멀리 있는 아무 곳으로 이동' }, map: { name: '지도 두루마리', icon: '🗺️', desc: '이 층 전체를 본다' } };
  const needFor = (lv) => 8 + 6 * lv;

  const rng = (seed) => {                                    // mulberry32 (시험용 고정 난수)
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const emit = (st, e) => { st.events.push(e); };
  const ri = (st, a, b) => a + Math.floor(st.rand() * (b - a + 1));
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function newGame(rand = Math.random, opts = {}) {
    const d = DIFF[opts.diff] || DIFF.normal;
    const st = {
      rand, diff: opts.diff in DIFF ? opts.diff : 'normal', d, tutorial: !!opts.tutorial, floor: 0, turn: 0, events: [], phase: 'play', won: false, kills: 0, gold: 0, pending: 0, choices: null,
      p: { x: 0, y: 0, hp: d.hp, maxhp: d.hp, atk: 3, def: 0, level: 1, xp: 0, need: needFor(1), weapon: -1, armor: -1, sight: 6, regen: 0, perks: { hp: 0, atk: 0, def: 0, sight: 0, vamp: 0, luck: 0 } },
      inv: { potion: 1, bolt: 0, tele: 0, map: 0 }, monsters: [], items: [], seq: 1, dist: null,
    };
    descend(st, true);
    return st;
  }

  // ---------- 던전 만들기 ----------
  function carve(tiles, x, y) { tiles[y][x] = '.'; }
  function genFloor(st, n) {
    const tiles = Array.from({ length: H }, () => new Array(W).fill('#'));
    const rooms = [];
    if (n === FLOORS) {                                       // 마지막 층: 큰 방 하나에서 용과 싸운다
      const rw = 17, rh = 13, rx = Math.floor((W - rw) / 2), ry = Math.floor((H - rh) / 2);
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) carve(tiles, x, y);
      for (const [px, py] of [[rx + 4, ry + 3], [rx + rw - 5, ry + 3], [rx + 4, ry + rh - 4], [rx + rw - 5, ry + rh - 4]]) tiles[py][px] = '#';        // 기둥
      rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: rx + 8, cy: ry + rh - 2 });
      return { tiles, rooms };
    }
    const target = ri(st, 7, 10);
    for (let tries = 0; tries < 200 && rooms.length < target; tries++) {
      const w = ri(st, 4, 8), h = ri(st, 4, 7), x = ri(st, 1, W - w - 2), y = ri(st, 1, H - h - 2);
      if (rooms.some((r) => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) carve(tiles, xx, yy);
      rooms.push({ x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) });
    }
    const link = (a, b) => {
      let x = a.cx, y = a.cy;
      const horizFirst = st.rand() < 0.5;
      const walkX = () => { while (x !== b.cx) { x += Math.sign(b.cx - x); carve(tiles, x, y); } };
      const walkY = () => { while (y !== b.cy) { y += Math.sign(b.cy - y); carve(tiles, x, y); } };
      if (horizFirst) { walkX(); walkY(); } else { walkY(); walkX(); }
    };
    for (let i = 1; i < rooms.length; i++) link(rooms[i - 1], rooms[i]);
    if (rooms.length > 4) link(rooms[0], rooms[rooms.length - 1]);                                 // 한 번쯤 돌아가는 길
    return { tiles, rooms };
  }
  const floorCells = (st, room) => { const out = []; for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) if (st.tiles[y][x] === '.') out.push([x, y]); return out; };
  const occupied = (st, x, y) => (st.p.x === x && st.p.y === y) || st.monsters.some((m) => m.hp > 0 && m.x === x && m.y === y) || st.items.some((i) => i.x === x && i.y === y) || st.tiles[y][x] !== '.';

  function descend(st, first) {
    st.floor++;
    const { tiles, rooms } = genFloor(st, st.floor);
    st.tiles = tiles; st.rooms = rooms; st.monsters = []; st.items = [];
    st.seen = Array.from({ length: H }, () => new Array(W).fill(false)); st.vis = Array.from({ length: H }, () => new Array(W).fill(false));
    const start = rooms[0]; st.p.x = start.cx; st.p.y = start.cy;
    const boss = st.floor === FLOORS;
    if (!boss) {                                                        // 계단은 시작에서 가장 먼 방에
      let far = rooms[1], fd = -1; for (const r of rooms.slice(1)) { const d = Math.abs(r.cx - start.cx) + Math.abs(r.cy - start.cy); if (d > fd) { fd = d; far = r; } }
      st.tiles[far.cy][far.cx] = '>'; st.stairs = [far.cx, far.cy];
    } else st.stairs = null;
    // 괴물
    const pool = Object.entries(MONSTER).filter(([, m]) => !m.boss && st.floor >= m.from && st.floor <= m.to);
    const total = boss ? 0 : Math.round((3 + st.floor * 1.4) * st.d.mon);
    for (let i = 0; i < total; i++) {
      const room = rooms[1 + Math.floor(st.rand() * (rooms.length - 1))], cells = floorCells(st, room).filter(([x, y]) => !occupied(st, x, y));
      if (!cells.length) continue;
      const [x, y] = cells[Math.floor(st.rand() * cells.length)];
      let wsum = pool.reduce((a, [, m]) => a + m.w, 0), r = st.rand() * wsum, kind = pool[0][0];
      for (const [k, m] of pool) { r -= m.w; if (r <= 0) { kind = k; break; } }
      addMonster(st, kind, x, y, true);
    }
    if (boss) { const r = rooms[0]; addMonster(st, 'dragon', r.cx, r.y + 2, false); }
    // 아이템
    const luck = st.p.perks.luck, any = () => { const room = rooms[Math.floor(st.rand() * rooms.length)], cells = floorCells(st, room).filter(([x, y]) => !occupied(st, x, y)); return cells.length ? cells[Math.floor(st.rand() * cells.length)] : null; };
    const put = (kind, extra) => { const c = any(); if (c) st.items.push({ id: st.seq++, kind, x: c[0], y: c[1], ...extra }); };
    for (let i = 0, n = ri(st, 1, 2) + (luck ? 1 : 0); i < n; i++) put('potion');
    if (st.rand() < 0.5 + 0.15 * luck) put('scroll', { scroll: ['bolt', 'tele', 'map'][ri(st, 0, 2)] });
    if (st.rand() < 0.55 + 0.1 * luck && !boss) { const tier = Math.min(3, Math.floor((st.floor - 1) / 2.2) + (st.rand() < 0.3 ? 1 : 0)); put(st.rand() < 0.5 ? 'weapon' : 'armor', { tier: Math.min(3, tier) }); }
    for (let i = 0, n = ri(st, 3, 5); i < n; i++) put('gold', { value: 4 + st.floor * 3 + ri(st, 0, 5) });
    if (boss) { put('potion'); put('potion'); }
    if (st.tutorial && first) tutorialSetup(st);
    computeFov(st);
    emit(st, { t: 'floor', floor: st.floor });
  }
  function tutorialSetup(st) {
    st.monsters = []; const r = st.rooms[0], p = st.p;
    const spot = (dx, dy) => { for (let k = 2; k < 8; k++) for (const [ox, oy] of [[dx * k, dy * k]]) { const x = p.x + ox, y = p.y + oy; if (st.tiles[y] && st.tiles[y][x] === '.' && !occupied(st, x, y)) return [x, y]; } return null; };
    const cells = floorCells(st, r).filter(([x, y]) => !occupied(st, x, y) && Math.abs(x - p.x) + Math.abs(y - p.y) >= 3);
    const c = cells[0] || [p.x + 1, p.y]; const rat = addMonster(st, 'rat', c[0], c[1], false); rat.hp = rat.maxhp = 2; rat.atk = 1;
    st.items = st.items.filter((i) => i.kind !== 'potion'); const pc = cells[1] || cells[0]; if (pc) st.items.push({ id: st.seq++, kind: 'potion', x: pc[0], y: pc[1] });
    void spot;
  }
  function addMonster(st, kind, x, y, asleep) {
    const b = MONSTER[kind], k = st.d.dmg;
    const m = { id: st.seq++, kind, x, y, hp: b.hp, maxhp: b.hp, atk: Math.max(1, Math.round(b.atk * k)), def: b.def, xp: b.xp, asleep, cd: 0, flash: 0 };
    if (b.boss) m.hp = m.maxhp = st.d.boss;
    st.monsters.push(m); return m;
  }

  // ---------- 시야와 길 찾기 ----------
  const opaque = (st, x, y) => x < 0 || y < 0 || x >= W || y >= H || st.tiles[y][x] === '#';
  function los(st, x0, y0, x1, y1) {                                      // 두 칸 사이에 벽이 없나 (브레젠험)
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy, x = x0, y = y0;
    while (!(x === x1 && y === y1)) {
      const e2 = 2 * err; if (e2 > -dy) { err -= dy; x += sx; } if (e2 < dx) { err += dx; y += sy; }
      if (!(x === x1 && y === y1) && opaque(st, x, y)) return false;
    }
    return true;
  }
  function computeFov(st) {
    const p = st.p, R = p.sight;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) st.vis[y][x] = false;
    for (let y = Math.max(0, p.y - R); y <= Math.min(H - 1, p.y + R); y++) for (let x = Math.max(0, p.x - R); x <= Math.min(W - 1, p.x + R); x++) {
      if ((x - p.x) ** 2 + (y - p.y) ** 2 > R * R + 1) continue;
      if (los(st, p.x, p.y, x, y)) { st.vis[y][x] = true; st.seen[y][x] = true; }
    }
  }
  function distMap(st) {                                                  // 내 위치에서 각 칸까지 걸음 수
    const d = Array.from({ length: H }, () => new Array(W).fill(-1)); const q = [[st.p.x, st.p.y]]; d[st.p.y][st.p.x] = 0;
    for (let i = 0; i < q.length; i++) { const [x, y] = q[i]; for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && d[ny][nx] < 0 && st.tiles[ny][nx] !== '#') { d[ny][nx] = d[y][x] + 1; q.push([nx, ny]); } } }
    return d;
  }
  const monsterAt = (st, x, y) => st.monsters.find((m) => m.hp > 0 && m.x === x && m.y === y);
  const walkable = (st, x, y) => x >= 0 && y >= 0 && x < W && y < H && st.tiles[y][x] !== '#';

  // ---------- 전투 ----------
  const playerAtk = (st) => st.p.atk + (st.p.weapon >= 0 ? WEAPONS[st.p.weapon].atk : 0);
  const playerDef = (st) => st.p.def + (st.p.armor >= 0 ? ARMORS[st.p.armor].def : 0);
  const roll = (st, atk, def) => Math.max(1, atk + ri(st, -1, 1) - def);
  function hurtPlayer(st, dmg, src) {
    st.p.hp -= dmg; st.p.regen = 0; emit(st, { t: 'hurt', dmg, src });
    if (st.p.hp <= 0) { st.p.hp = 0; st.phase = 'dead'; emit(st, { t: 'dead', src }); }
  }
  function killMonster(st, m) {
    m.hp = 0; st.kills++; st.p.xp += m.xp; emit(st, { t: 'kill', kind: m.kind, x: m.x, y: m.y, xp: m.xp });
    if (st.p.perks.vamp) st.p.hp = Math.min(st.p.maxhp, st.p.hp + st.p.perks.vamp);
    if (st.rand() < 0.35 && !MONSTER[m.kind].boss) st.items.push({ id: st.seq++, kind: 'gold', x: m.x, y: m.y, value: 3 + st.floor * 2 });
    if (MONSTER[m.kind].boss) { st.phase = 'win'; st.won = true; emit(st, { t: 'win' }); }
    while (st.p.xp >= st.p.need && st.phase === 'play') { st.p.xp -= st.p.need; st.p.level++; st.p.need = needFor(st.p.level); st.pending++; }
  }

  // ---------- 괴물의 차례 ----------
  function monstersAct(st) {
    const d = distMap(st);
    for (const m of st.monsters) {
      if (m.hp <= 0 || st.phase !== 'play') continue;
      if (m.flash > 0) m.flash--;
      const b = MONSTER[m.kind], dist = Math.abs(m.x - st.p.x) + Math.abs(m.y - st.p.y), steps = d[m.y][m.x];
      if (m.asleep) {                                                    // 자고 있다가 가까이 오거나 소리가 나면 깬다
        if ((dist <= 5 && los(st, m.x, m.y, st.p.x, st.p.y)) || (steps > 0 && steps <= 8 && st.rand() < 0.08)) { m.asleep = false; emit(st, { t: 'wake', kind: m.kind }); } else continue;
      }
      if (steps < 0 || steps > 24) continue;
      if (b.boss) { m.cd++; if (m.cd % 8 === 0 && st.monsters.filter((o) => o.hp > 0).length < 7) { const c = DIRS.map(([dx, dy]) => [m.x + dx, m.y + dy]).find(([x, y]) => walkable(st, x, y) && !monsterAt(st, x, y) && !(x === st.p.x && y === st.p.y)); if (c) { addMonster(st, 'bat', c[0], c[1], false); emit(st, { t: 'summon' }); } } }
      // 가까이 붙었으면 때린다
      if (dist === 1) { hurtPlayer(st, roll(st, m.atk, playerDef(st)), m.kind); continue; }
      // 멀리서 쏘는 괴물
      if (b.range && dist <= b.range && (m.x === st.p.x || m.y === st.p.y) && los(st, m.x, m.y, st.p.x, st.p.y)) {
        if (b.boss) { if (m.cd % 3 === 0) { hurtPlayer(st, roll(st, Math.round(m.atk * 0.7), playerDef(st)), m.kind); emit(st, { t: 'shoot', kind: m.kind, x: m.x, y: m.y }); continue; } }
        else { hurtPlayer(st, roll(st, m.atk, playerDef(st)), m.kind); emit(st, { t: 'shoot', kind: m.kind, x: m.x, y: m.y }); continue; }
      }
      // 박쥐는 자꾸 엉뚱한 곳으로 날아간다
      let moves = DIRS.map(([dx, dy]) => [m.x + dx, m.y + dy]).filter(([x, y]) => walkable(st, x, y) && !monsterAt(st, x, y) && !(x === st.p.x && y === st.p.y));
      if (!moves.length) continue;
      if (b.erratic && st.rand() < 0.5) { const [x, y] = moves[Math.floor(st.rand() * moves.length)]; m.x = x; m.y = y; continue; }
      moves = moves.filter(([x, y]) => d[y][x] >= 0 && d[y][x] < steps);
      if (moves.length) { const [x, y] = moves[Math.floor(st.rand() * moves.length)]; m.x = x; m.y = y; }
    }
    st.monsters = st.monsters.filter((m) => m.hp > 0 || false);
  }

  // ---------- 한 번의 행동 ----------
  // action: { type:'move', dx, dy } · { type:'wait' } · { type:'descend' } · { type:'use', item:'potion'|'bolt'|'tele'|'map' }
  function endTurn(st) {
    const p = st.p;
    st.turn++;
    monstersAct(st);
    if (st.phase === 'dead' || st.phase === 'win') return;
    p.regen++; if (p.regen >= 7 && p.hp < p.maxhp) { p.hp++; p.regen = 0; }
    computeFov(st);
    if (st.pending > 0 && st.phase === 'play') openLevelUp(st);
  }
  function pickup(st) {
    const p = st.p;
    for (const it of st.items.slice()) {
      if (it.x !== p.x || it.y !== p.y) continue;
      st.items = st.items.filter((o) => o !== it);
      if (it.kind === 'potion') { st.inv.potion++; emit(st, { t: 'pickup', kind: 'potion' }); }
      else if (it.kind === 'scroll') { st.inv[it.scroll]++; emit(st, { t: 'pickup', kind: it.scroll }); }
      else if (it.kind === 'gold') { st.gold += it.value; emit(st, { t: 'pickup', kind: 'gold', value: it.value }); }
      else if (it.kind === 'weapon') { if (it.tier > p.weapon) { p.weapon = it.tier; emit(st, { t: 'equip', kind: 'weapon', name: WEAPONS[it.tier].name }); } else { st.gold += 5; emit(st, { t: 'pickup', kind: 'gold', value: 5 }); } }
      else if (it.kind === 'armor') { if (it.tier > p.armor) { p.armor = it.tier; emit(st, { t: 'equip', kind: 'armor', name: ARMORS[it.tier].name }); } else { st.gold += 5; emit(st, { t: 'pickup', kind: 'gold', value: 5 }); } }
    }
  }
  function act(st, a) {
    st.events = [];
    if (st.phase !== 'play') return false;
    const p = st.p;
    if (a.type === 'move') {
      const nx = p.x + a.dx, ny = p.y + a.dy;
      if (!walkable(st, nx, ny)) return false;
      const m = monsterAt(st, nx, ny);
      if (m) {
        m.asleep = false; const dmg = roll(st, playerAtk(st), m.def); m.hp -= dmg; m.flash = 2; emit(st, { t: 'attack', kind: m.kind, dmg, x: m.x, y: m.y });
        if (m.hp <= 0) killMonster(st, m);
      } else { p.x = nx; p.y = ny; emit(st, { t: 'move' }); pickup(st); }
    } else if (a.type === 'wait') { /* 쉰다 */ }
    else if (a.type === 'descend') {
      if (st.tiles[p.y][p.x] !== '>') return false;
      descend(st, false); emit(st, { t: 'descend', floor: st.floor }); return true;
    } else if (a.type === 'use') {
      const k = a.item;
      if (!st.inv[k] || st.inv[k] <= 0) return false;
      if (k === 'potion') { if (p.hp >= p.maxhp && !st.tutorial) return false; st.inv.potion--; p.hp = Math.min(p.maxhp, p.hp + 16); emit(st, { t: 'use', kind: 'potion' }); }
      else if (k === 'bolt') { st.inv.bolt--; const dmg = 10 + st.floor * 2; let n = 0; for (const m of st.monsters) if (m.hp > 0 && st.vis[m.y][m.x]) { m.hp -= dmg; m.asleep = false; m.flash = 2; n++; emit(st, { t: 'attack', kind: m.kind, dmg, x: m.x, y: m.y }); if (m.hp <= 0) killMonster(st, m); } emit(st, { t: 'use', kind: 'bolt', n }); }
      else if (k === 'tele') {
        st.inv.tele--; const cells = []; for (const r of st.rooms) for (const c of floorCells(st, r)) if (!occupied(st, c[0], c[1]) && Math.abs(c[0] - p.x) + Math.abs(c[1] - p.y) > 8) cells.push(c);
        if (cells.length) { const c = cells[Math.floor(st.rand() * cells.length)]; p.x = c[0]; p.y = c[1]; pickup(st); } emit(st, { t: 'use', kind: 'tele' });
      } else if (k === 'map') { st.inv.map--; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (st.tiles[y][x] !== '#') st.seen[y][x] = true; emit(st, { t: 'use', kind: 'map' }); }
    } else return false;
    if (st.phase === 'win') return true;
    endTurn(st);
    if (a.type === 'use' && st.phase === 'play' && st.pending > 0) openLevelUp(st);
    return true;
  }

  // ---------- 레벨 업 ----------
  function makeChoices(st) {
    const c = Object.keys(PERKS).filter((k) => !PERKS[k].max || st.p.perks[k] < PERKS[k].max);
    for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(st.rand() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; }
    return c.slice(0, 3);
  }
  function openLevelUp(st) { st.phase = 'levelup'; st.choices = makeChoices(st); emit(st, { t: 'levelup', level: st.p.level }); }
  function choose(st, i) {
    if (st.phase !== 'levelup' || !st.choices || !st.choices[i]) return false;
    const k = st.choices[i], p = st.p; p.perks[k]++;
    if (k === 'hp') { p.maxhp += 10; p.hp = Math.min(p.maxhp, p.hp + 10); } else if (k === 'atk') p.atk++; else if (k === 'def') p.def++; else if (k === 'sight') p.sight++;
    st.pending--; st.choices = null; st.phase = 'play'; emit(st, { t: 'choose', perk: k });
    computeFov(st);
    if (st.pending > 0) openLevelUp(st);
    return true;
  }
  const score = (st) => st.gold + st.floor * 100 + st.kills * 5 + (st.won ? 2000 + st.p.hp * 10 : 0);

  return { W, H, FLOORS, VIEW, DIFF, MONSTER, WEAPONS, ARMORS, PERKS, SCROLLS, DIRS, rng, newGame, act, choose, descend, computeFov, distMap, los, monsterAt, addMonster, walkable, playerAtk, playerDef, makeChoices, score, needFor, floorCells, occupied };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_MD;
