'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 작은 던전: 화면·입력·소리. 규칙은 logic.js (LOGIC_MD). 여기서는 act() 가 알려 주는 events 를 보고 글·소리·효과를 만든다.
const L = LOGIC_MD;
const { W, H, VIEW } = L;
const T = 16, HUD = 18, LOG = 30, MAPH = VIEW * T;
const CW = VIEW * T, CHH = HUD + MAPH + LOG;                         // 캔버스 논리 크기 240 x 288
const TUTORIAL = /[?&]tutorial=1/.test(location.search);

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const landscapeTouch = () => matchMedia('(pointer:coarse) and (orientation:landscape)').matches;
function fit() {
  const controls = $('controls');
  const land = landscapeTouch();
  const ctrlH = land || getComputedStyle(controls).display === 'none' ? 0 : controls.offsetHeight + 8;
  const ctrlW = land ? $('stick').offsetWidth + $('acts').offsetWidth + 24 : 0;
  const scale = Math.min((innerWidth - 16 - ctrlW) / CW, (innerHeight - (land ? 8 : 16) - ctrlH) / CHH);
  const cssW = Math.max(150, Math.floor(CW * scale)), cssH = Math.floor(cssW * CHH / CW);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px'; $('wrap').style.setProperty('--s', String(cssW / CW));
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / CW, 0, 0, canvas.height / CHH, 0, 0);
  ctx.imageSmoothingEnabled = false;
}
addEventListener('resize', fit);
addEventListener('orientationchange', () => setTimeout(fit, 150));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('mdMuted') === '1';
function tone(freq, dur, type = 'square', vol = 0.04, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const melody = (notes, step, type = 'square', vol = 0.045) => notes.forEach((f, i) => { if (f) setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step); });
const sfx = {
  step: () => tone(120, 0.04, 'triangle', 0.03),
  hit: () => tone(260, 0.07, 'square', 0.04, -120),
  kill: () => { tone(420, 0.12, 'sawtooth', 0.045, -280); setTimeout(() => tone(200, 0.1, 'square', 0.035), 60); },
  hurt: () => tone(150, 0.2, 'sawtooth', 0.06, -70),
  shoot: () => tone(700, 0.09, 'square', 0.03, -400),
  pickup: () => melody([880, 1175], 50, 'triangle', 0.045),
  gold: () => tone(1500, 0.06, 'triangle', 0.04),
  potion: () => melody([523, 659, 784], 60, 'triangle', 0.05),
  bolt: () => { tone(200, 0.3, 'sawtooth', 0.06, -120); },
  tele: () => melody([784, 523, 1047], 70, 'sine', 0.05),
  levelup: () => melody([523, 659, 784, 1047], 70, 'triangle', 0.05),
  stairs: () => melody([392, 330, 262], 90, 'triangle', 0.05),
  boss: () => melody([110, 98, 110, 82], 140, 'sawtooth', 0.06),
  dead: () => melody([392, 311, 262, 196, 147], 150, 'square', 0.05),
  win: () => melody([523, 659, 784, 1047, 784, 1047, 1319, 1568], 100, 'triangle', 0.06),
  start: () => melody([262, 330, 392], 70, 'triangle', 0.04),
};

// ---------- 상태 ----------
let G = null;
let state = 'title';                           // title · play · paused · over
let diff = store.get('mdDiff') === 'easy' ? 'easy' : 'normal';
let best = Number(store.get('mdBest')) || 0;
let logs = [], fxs = [], clock = 0, shake = 0, bossWarned = false;
let banner = { text: '', sub: '', t: 0, color: '#fff' };

/* @test-hooks:start */
window.__md = { get G() { return G; }, get state() { return state; }, L, setG(g) { G = g; }, act: (a) => doAct(a), start: (o) => startGame(o), get joy() { return joy; }, tick: (dt) => joyTick(dt) };
/* @test-hooks:end */

// ---------- 입력: 방향 패드 · 방향키/WASD · 화면 스와이프 · 화면 누르기(그 쪽으로 한 걸음) ----------
const KEYMAP = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0], k: [0, -1], j: [0, 1], h: [-1, 0], l: [1, 0] };
let moveCool = 0;
addEventListener('keydown', (e) => {
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (state === 'play') pause(); else if (state === 'paused') resume(); return; }
  if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
  if (!G) return;
  if (G.phase === 'levelup' && ['1', '2', '3'].includes(e.key)) { pickCard(Number(e.key) - 1); return; }
  if (state !== 'play' || G.phase !== 'play') return;
  if (KEYMAP[e.key]) { e.preventDefault(); const [dx, dy] = KEYMAP[e.key]; doAct({ type: 'move', dx, dy }); }
  else if (e.key === ' ' || e.key === '.' || e.key === 'Enter') { e.preventDefault(); waitOrDescend(); }
  else if (e.key === 'e' || e.key === 'E' || e.key === 'i' || e.key === 'I') openBag();
  else if (e.key === 'q' || e.key === 'Q') doAct({ type: 'use', item: 'potion' });
});
// ---------- 조이스틱: 아래의 조이스틱, 또는 화면을 누른 채 끌면 그 자리에 생기는 조이스틱. 누르고 있는 동안 그 방향으로 계속 걷는다 ----------
const STEP_EVERY = 0.14;                                                   // 누르고 있으면 0.14초마다 한 걸음
const joy = { active: false, id: null, kind: null, ax: 0, ay: 0, px: 0, py: 0, dir: null, cool: 0, suppress: false };
// 밀어 둔 방향: 가로·세로 중 더 많이 민 쪽. 방향이 바뀔 때는 조금 더 확실히 밀어야 바뀐다(떨림 방지)
function dirFromVec(dx, dy, dead, prev) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) < dead) return null;
  let horiz = ax >= ay;
  if (prev) horiz = prev[1] === 0 ? !(ay > ax * 1.3) : (ax > ay * 1.3);
  return horiz ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
}
function setJoyDir(dir) {
  const changed = (!dir) !== (!joy.dir) || (dir && joy.dir && (dir[0] !== joy.dir[0] || dir[1] !== joy.dir[1]));
  joy.dir = dir;
  if (changed) { joy.suppress = false; joy.cool = 0; if (dir) joyTick(0); }              // 방향이 정해지면 바로 한 걸음
}
function joyTick(dt) {
  if (joy.cool > 0) joy.cool -= dt;
  if (!joy.dir || joy.suppress || state !== 'play' || !G || G.phase !== 'play' || joy.cool > 0) return;
  joy.cool = STEP_EVERY; doAct({ type: 'move', dx: joy.dir[0], dy: joy.dir[1] });
}
function joyEnd() { joy.active = false; joy.id = null; joy.dir = null; joy.suppress = false; $('knob').style.transform = 'translate(0,0)'; }
// 아래 고정 조이스틱
const stickEl = $('stick');
function stickVec(e) { const r = stickEl.getBoundingClientRect(), R = r.width / 2; let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R); const d = Math.hypot(dx, dy); const k = d > R * 0.7 ? R * 0.7 / d : 1; $('knob').style.transform = `translate(${dx * k}px, ${dy * k}px)`; return [dx, dy, R * 0.28]; }
stickEl.addEventListener('pointerdown', (e) => { e.preventDefault(); try { stickEl.setPointerCapture(e.pointerId); } catch (_) {} joy.active = true; joy.id = e.pointerId; joy.kind = 'fixed'; const [dx, dy, dead] = stickVec(e); setJoyDir(dirFromVec(dx, dy, dead, null)); });
stickEl.addEventListener('pointermove', (e) => { if (!joy.active || joy.kind !== 'fixed' || e.pointerId !== joy.id) return; const [dx, dy, dead] = stickVec(e); setJoyDir(dirFromVec(dx, dy, dead, joy.dir)); });
const stickUp = (e) => { if (joy.kind === 'fixed' && e.pointerId === joy.id) joyEnd(); };
stickEl.addEventListener('pointerup', stickUp); stickEl.addEventListener('pointercancel', stickUp); stickEl.addEventListener('lostpointercapture', stickUp);
function waitOrDescend() {
  if (!G || state !== 'play' || G.phase !== 'play') return;
  if (G.tiles[G.p.y][G.p.x] === '>') doAct({ type: 'descend' }); else doAct({ type: 'wait' });
}
$('waitBt').addEventListener('pointerdown', (e) => { e.preventDefault(); waitOrDescend(); });
$('bagBt').addEventListener('pointerdown', (e) => { e.preventDefault(); openBag(); });
// 화면: 짧게 누르면 그쪽으로 한 걸음(먼 곳이면 길을 따라 한 걸음, 내 칸이면 대기·내려가기), 누른 채 끌면 그 자리에 조이스틱이 생긴다
let touch = null;
const FLOAT_START = 7, FLOAT_DEAD = 6, FLOAT_R = 22;
const cpos = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * CW, (e.clientY - r.top) / r.height * CHH]; };
$('wrap').addEventListener('pointerdown', (e) => { if (e.target.closest('#overlay') || e.target.closest('#top')) return; const [x, y] = cpos(e); touch = { x, y, moved: false, id: e.pointerId, cx: e.clientX, cy: e.clientY }; try { $('wrap').setPointerCapture(e.pointerId); } catch (_) {} });
$('wrap').addEventListener('pointermove', (e) => {
  if (!touch || e.pointerId !== touch.id || state !== 'play') return;
  const [x, y] = cpos(e), dx = x - touch.x, dy = y - touch.y;
  if (!touch.moved && Math.hypot(dx, dy) > FLOAT_START) { touch.moved = true; joy.active = true; joy.id = e.pointerId; joy.kind = 'float'; joy.ax = touch.x; joy.ay = touch.y; }
  if (touch.moved) { joy.px = x; joy.py = y; setJoyDir(dirFromVec(dx, dy, FLOAT_DEAD, joy.dir)); }
});
const touchEnd = (e, cancelled) => {
  if (!touch || e.pointerId !== touch.id) return;
  const t = touch; touch = null;
  if (t.moved) { if (joy.kind === 'float') joyEnd(); return; }
  if (cancelled || state !== 'play' || !G || G.phase !== 'play') return;
  const r = canvas.getBoundingClientRect(), mx = (e.clientX - r.left) / r.width * CW, my = (e.clientY - r.top) / r.height * CHH - HUD;
  if (my < 0 || my >= MAPH) return;
  const tx = Math.floor(mx / T) + camX(), ty = Math.floor(my / T) + camY();
  if (tx === G.p.x && ty === G.p.y) { waitOrDescend(); return; }
  const stepDir = pathStep(tx, ty); if (stepDir) doAct({ type: 'move', dx: stepDir[0], dy: stepDir[1] });
};
$('wrap').addEventListener('pointerup', (e) => touchEnd(e, false));
$('wrap').addEventListener('pointercancel', (e) => { touchEnd(e, true); });
// 눌러 둔 칸까지 가는 길의 첫걸음 (아는 칸만 걷는다)
function pathStep(tx, ty) {
  const p = G.p, prev = new Map(), q = [[p.x, p.y]]; prev.set(p.y * W + p.x, null);
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    if (x === tx && y === ty) { let c = [x, y], pr; while ((pr = prev.get(c[1] * W + c[0])) && !(pr[0] === p.x && pr[1] === p.y)) c = pr; return [c[0] - p.x, c[1] - p.y]; }
    for (const [dx, dy] of L.DIRS) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H || prev.has(ny * W + nx) || G.tiles[ny][nx] === '#' || !G.seen[ny][nx]) continue; prev.set(ny * W + nx, [x, y]); q.push([nx, ny]); }
  }
  return null;
}

// ---------- 흐름 ----------
function startGame() {
  G = L.newGame(Math.random, { diff, tutorial: TUTORIAL });
  if (TUTORIAL) G.inv.map = 1;
  logs = []; fxs = []; shake = 0; bossWarned = false; state = 'play';
  $('overlay').classList.add('hidden');
  say(TUTORIAL ? '연습: 방향 패드로 걸어 보세요' : '지하 1층. 계단(>)을 찾아 내려가요');
  showBanner(TUTORIAL ? '연습' : '지하 1층', '', 1.4);
  sfx.start(); updateButtons();
}
function pause() {
  if (state !== 'play' || !G || G.phase !== 'play') return;
  state = 'paused';
  showOverlay('<h2>일시정지</h2><div class="row"><button data-act="resume">계속하기</button><button data-act="title" class="sub">처음 화면</button></div>');
}
function resume() { if (state === 'paused') { state = 'play'; $('overlay').classList.add('hidden'); } }
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function showBanner(text, sub = '', t = 1.4, color = '#fff') { banner = { text, sub, t, color }; }
function say(msg) { logs.push(msg); if (logs.length > 6) logs.shift(); }
function showTitle() {
  state = 'title';
  showOverlay(`
    <h1>작은 던전</h1>
    <p>한 칸씩 걷는 <b>턴제 던전</b>! 내가 한 번 움직이면 괴물도 한 번 움직여요.<br>지하 8층의 <b>용</b>을 쓰러뜨리면 이겨요 ⚔️<br>쓰러지면 처음부터 — 던전은 매번 달라요</p>
    <button class="opt" data-act="diff">🎚 난이도: ${L.DIFF[diff].name}</button>
    <button data-act="start">모험 시작</button>
    <p style="font-size:calc(10px * var(--s,1));color:#b8a888"><span class="pc">⌨️ 방향키·WASD 걷기 · 스페이스 대기/내려가기 · E 가방 · Q 포션</span><span class="touch">👆 조이스틱을 밀거나 화면을 끌기·누르기</span>${best ? ` · 최고 ${best.toLocaleString('ko-KR')}점` : ''}</p>`);
}
function cardHtml(k, i) { const p = L.PERKS[k]; const lv = G.p.perks[k] + 1; return `<button class="card" data-card="${i}"><span class="ico">${p.icon}</span><span><span class="nm">${i + 1}. ${p.name}<small>${lv > 1 ? 'Lv.' + lv : '새 능력'}</small></span><br><span class="ds">${p.desc}</span></span></button>`; }
function showLevelUp() { showOverlay(`<h2>⭐ 레벨 ${G.p.level}!</h2><p>능력 하나를 골라요</p><div class="cards">${G.choices.map(cardHtml).join('')}</div>`); }
function pickCard(i) {
  if (!G || G.phase !== 'levelup') return;
  if (L.choose(G, i)) { sfx.levelup(); tutorialSignal('choose'); $('overlay').classList.add('hidden'); if (G.phase === 'levelup') showLevelUp(); else updateButtons(); }
}
function openBag() {
  if (!G || state !== 'play' || G.phase !== 'play') return;
  const rows = [['potion', '🧪', '포션', `체력을 16 회복해요 (Q)`], ...Object.entries(L.SCROLLS).map(([k, s]) => [k, s.icon, s.name, s.desc])];
  showOverlay(`<h2>🎒 가방</h2><div class="cards">${rows.map(([k, ic, nm, ds]) => `<button class="card" data-item="${k}" ${G.inv[k] > 0 ? '' : 'disabled'}><span class="ico">${ic}</span><span><span class="nm">${nm}<small>× ${G.inv[k]}</small></span><br><span class="ds">${ds}</span></span></button>`).join('')}</div><p>⚔️ 공격 ${L.playerAtk(G)} · 🛡️ 방어 ${L.playerDef(G)}${G.p.weapon >= 0 ? ' · ' + L.WEAPONS[G.p.weapon].name : ''}${G.p.armor >= 0 ? ' · ' + L.ARMORS[G.p.armor].name : ''}</p><button class="sub" data-act="closebag">닫기</button>`);
}
function finish() {
  state = 'over';
  const sc = L.score(G), record = !TUTORIAL && sc > best;
  if (record) { best = sc; store.set('mdBest', String(best)); }
  showOverlay(`
    <h2>${G.won ? '🎉 용을 쓰러뜨렸다!' : '쓰러졌어요…'}</h2>
    <div class="big">${sc.toLocaleString('ko-KR')}</div>
    <p>${record ? '<b>🎉 최고 기록!</b><br>' : ''}지하 ${G.floor}층 · 레벨 ${G.p.level} · 괴물 ${G.kills}마리 · 금화 ${G.gold}<br>${G.turn}걸음 만에 ${G.won ? '이겼어요' : '끝났어요'}</p>
    <div class="row"><button data-act="again">다시 하기</button><button data-act="title" class="sub">처음 화면</button></div>`);
}
$('overlay').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  b.blur();
  if (b.dataset.card !== undefined) pickCard(Number(b.dataset.card));
  else if (b.dataset.item) { $('overlay').classList.add('hidden'); doAct({ type: 'use', item: b.dataset.item }); }
  else if (b.dataset.act === 'closebag') $('overlay').classList.add('hidden');
  else if (b.dataset.act === 'start' || b.dataset.act === 'again') startGame();
  else if (b.dataset.act === 'resume') resume();
  else if (b.dataset.act === 'diff') { diff = diff === 'easy' ? 'normal' : 'easy'; store.set('mdDiff', diff); showTitle(); }
  else if (b.dataset.act === 'title') showTitle();
});
function updateButtons() { if (!G) return; $('waitBt').textContent = G.tiles[G.p.y][G.p.x] === '>' ? '⬇ 내려가기' : '⏳ 대기'; }

// ---------- 행동을 실행하고 결과를 글·소리·효과로 ----------
function doAct(a) {
  if (!G || state !== 'play' || G.phase !== 'play') return false;
  const ok = L.act(G, a);
  for (const e of G.events) handle(e);
  if (G.phase === 'levelup') showLevelUp();
  if (G.phase === 'dead') { state = 'ending'; setTimeout(() => { if (state === 'ending') finish(); }, 900); }
  if (G.phase === 'win') { state = 'ending'; setTimeout(() => { if (state === 'ending') finish(); }, 1600); }
  updateButtons();
  return ok;
}
// 연습: 약한 쥐를 먼저 잡아 버린 사람도 '괴물 쓰러뜨리기' 단계를 할 수 있게, 쥐를 잡으면 시작 방에 새 쥐를 (세 번까지) 내보낸다
function tutorialRat() {
  if (G.floor !== 1 || G.kills > 3 || G.monsters.some((m) => m.hp > 0)) return;
  const cells = L.floorCells(G, G.rooms[0]).filter(([x, y]) => !L.occupied(G, x, y) && Math.abs(x - G.p.x) + Math.abs(y - G.p.y) >= 3);
  if (!cells.length) return;
  const [x, y] = cells[Math.floor(Math.random() * cells.length)], m = L.addMonster(G, 'rat', x, y, false); m.hp = m.maxhp = 2; m.atk = 1;
}
const nameOf = (k) => L.MONSTER[k].name;
function handle(e) {
  if (e.t === 'move') { sfx.step(); tutorialSignal('move'); }
  else if (e.t === 'attack') { sfx.hit(); say(`${nameOf(e.kind)}에게 ${e.dmg} 피해`); fxs.push({ kind: 'num', x: e.x, y: e.y, t: 0, life: 0.7, text: String(-e.dmg), color: '#fff' }); tutorialSignal('attack'); }
  else if (e.t === 'kill') { sfx.kill(); say(`${nameOf(e.kind)} 처치! 경험치 +${e.xp}`); tutorialSignal('kill'); if (TUTORIAL) tutorialRat(); }
  else if (e.t === 'hurt') { sfx.hurt(); joy.suppress = true; shake = 0.15; say(`${nameOf(e.src)}에게 ${e.dmg} 피해를 입었다`); fxs.push({ kind: 'num', x: G.p.x, y: G.p.y, t: 0, life: 0.7, text: String(-e.dmg), color: '#ff5a5a' }); }
  else if (e.t === 'shoot') sfx.shoot();
  else if (e.t === 'wake') say(`${nameOf(e.kind)}이(가) 깨어났다!`);
  else if (e.t === 'summon') say('용이 박쥐를 불렀다!');
  else if (e.t === 'pickup') {
    if (e.kind === 'gold') { sfx.gold(); say(`금화 ${e.value}`); } else { sfx.pickup(); say(e.kind === 'potion' ? '포션을 주웠다' : `${L.SCROLLS[e.kind].name}를 주웠다`); }
    tutorialSignal('pickup');
  }
  else if (e.t === 'equip') { sfx.pickup(); say(`${e.name}을(를) 장비했다`); tutorialSignal('equip'); }
  else if (e.t === 'use') {
    if (e.kind === 'potion') { sfx.potion(); say('포션을 마셨다'); } else if (e.kind === 'bolt') { sfx.bolt(); shake = 0.25; say('번개가 쳤다!'); } else if (e.kind === 'tele') { sfx.tele(); say('순간이동!'); } else { sfx.pickup(); say('이 층의 지도가 펼쳐졌다'); }
    tutorialSignal('use'); tutorialSignal(e.kind);
  }
  else if (e.t === 'levelup') { sfx.levelup(); tutorialSignal('levelup'); }
  else if (e.t === 'descend') { sfx.stairs(); say(`지하 ${e.floor}층`); showBanner(e.floor === L.FLOORS ? '용의 방' : `지하 ${e.floor}층`, e.floor === L.FLOORS ? '용을 쓰러뜨리면 이겨요' : '', 1.5, e.floor === L.FLOORS ? '#ff7a5a' : '#fff'); tutorialSignal('descend'); if (e.floor === L.FLOORS) sfx.boss(); }
  else if (e.t === 'dead') { sfx.dead(); showBanner('쓰러졌다…', '', 1.5, '#ff6a6a'); }
  else if (e.t === 'win') { sfx.win(); showBanner('용을 쓰러뜨렸다!', '', 2, '#7dff7d'); tutorialSignal('win'); }
}

// ---------- 그리기 ----------
const RC = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const camX = () => Math.max(0, Math.min(W - VIEW, G.p.x - Math.floor(VIEW / 2)));
const camY = () => Math.max(0, Math.min(H - VIEW, G.p.y - Math.floor(VIEW / 2)));
function drawTile(x, y, sx, sy, lit) {
  const ch = G.tiles[y][x];
  if (ch === '#') {
    // 벽은 바닥에 붙은 것만 그린다
    let near = false; for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && G.tiles[ny][nx] !== '#' && G.seen[ny][nx]) { near = true; break; } }
    if (!near) return;
    RC(sx, sy, T, T, lit ? '#4a3a68' : '#2a2240'); RC(sx, sy, T, 1, lit ? '#6a5a88' : '#3a3258'); RC(sx + 7, sy + 1, 1, 7, lit ? '#2a1a48' : '#1a1230'); RC(sx + 3, sy + 8, 1, 7, lit ? '#2a1a48' : '#1a1230'); RC(sx, sy + 8, T, 1, lit ? '#2a1a48' : '#1a1230');
    return;
  }
  const h = hash(x, y);
  RC(sx, sy, T, T, lit ? '#5a5070' : '#3a3450');
  RC(sx, sy, T, 1, lit ? '#4a4060' : '#2e2842'); RC(sx, sy, 1, T, lit ? '#4a4060' : '#2e2842');
  if (h < 0.18) RC(sx + Math.floor(h * 70) % 12 + 2, sy + Math.floor(h * 200) % 12 + 2, 2, 1, lit ? '#6a6088' : '#443e5c');
  if (ch === '>') { RC(sx + 2, sy + 2, 12, 12, '#1a1428'); for (let k = 0; k < 4; k++) RC(sx + 3 + k, sy + 3 + k * 3, 10 - k * 2, 2, lit ? '#d8c8f0' : '#8a7aa8'); }
}
function drawEntities(cx, cy) {
  const em = (ch, x, y, size = 13) => { ctx.font = size + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, x * T - cx * T + T / 2, HUD + y * T - cy * T + T / 2 + 1); };
  for (const it of G.items) { if (!G.seen[it.y][it.x] || it.x < cx || it.x >= cx + VIEW || it.y < cy || it.y >= cy + VIEW) continue; ctx.globalAlpha = G.vis[it.y][it.x] ? 1 : 0.55; em(it.kind === 'potion' ? '🧪' : it.kind === 'scroll' ? '📜' : it.kind === 'gold' ? '🪙' : it.kind === 'weapon' ? '🗡️' : '🥋', it.x, it.y, 12); }
  ctx.globalAlpha = 1;
  for (const m of G.monsters) {
    if (m.hp <= 0 || !G.vis[m.y][m.x] || m.x < cx || m.x >= cx + VIEW || m.y < cy || m.y >= cy + VIEW) continue;
    const b = L.MONSTER[m.kind], big = b.boss;
    if (m.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect((m.x - cx) * T, HUD + (m.y - cy) * T, T, T); }
    em(b.icon, m.x, m.y, big ? 17 : 13);
    if (m.asleep) { ctx.font = 'bold 7px sans-serif'; ctx.fillStyle = '#9ad0ff'; ctx.textAlign = 'left'; ctx.fillText('z', (m.x - cx) * T + 10, HUD + (m.y - cy) * T + 4); }
    if (m.hp < m.maxhp) { RC((m.x - cx) * T + 1, HUD + (m.y - cy) * T + T - 2, T - 2, 2, '#400'); RC((m.x - cx) * T + 1, HUD + (m.y - cy) * T + T - 2, Math.max(1, Math.round((T - 2) * m.hp / m.maxhp)), 2, '#f44'); }
  }
  // 주인공
  const px = (G.p.x - cx) * T, py = HUD + (G.p.y - cy) * T, bob = Math.floor(clock * 4) % 2;
  RC(px + 4, py + 5 + bob, 8, 8, '#3a8ae8'); RC(px + 4, py + 5 + bob, 8, 2, '#8ac0ff'); RC(px + 5, py + 1 + bob, 6, 5, '#f8d8b0'); RC(px + 4, py + bob, 8, 2, '#c0c8d8'); RC(px + 6, py + 3 + bob, 1, 1, '#000'); RC(px + 9, py + 3 + bob, 1, 1, '#000');
  RC(px + 5, py + 13, 2, 2, '#2a2a4a'); RC(px + 9, py + 13, 2, 2, '#2a2a4a');
  if (G.p.weapon >= 0) RC(px + 12, py + 4 + bob, 2, 8, '#d0d8e8');
  if (G.p.armor >= 0) RC(px + 3, py + 8 + bob, 2, 4, '#a8b0c0');
}
function drawMap() {
  const cx = camX(), cy = camY();
  ctx.fillStyle = '#0a0812'; ctx.fillRect(0, HUD, CW, MAPH);
  for (let y = cy; y < cy + VIEW; y++) for (let x = cx; x < cx + VIEW; x++) {
    if (!G.seen[y][x]) continue;
    drawTile(x, y, (x - cx) * T, HUD + (y - cy) * T, G.vis[y][x]);
  }
  drawEntities(cx, cy);
  for (const f of fxs) if (f.kind === 'num') { const k = f.t / f.life; ctx.globalAlpha = 1 - k * k; ctx.fillStyle = f.color; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 2.5; const x = (f.x - cx) * T + T / 2, y = HUD + (f.y - cy) * T - k * 12; ctx.strokeText(f.text, x, y); ctx.fillText(f.text, x, y); ctx.globalAlpha = 1; }
  // 시야 밖 어둠
  ctx.fillStyle = 'rgba(10,8,18,.0)';
}
function drawHud() {
  const p = G.p;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, HUD);
  ctx.font = 'bold 8px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  RC(4, 5, 70, 8, '#401020'); RC(4, 5, Math.max(0, Math.round(70 * p.hp / p.maxhp)), 8, p.hp < p.maxhp * 0.3 ? '#ff4a4a' : '#ff7a9a');
  ctx.fillStyle = '#fff'; ctx.fillText(`${p.hp}/${p.maxhp}`, 8, 9.5);
  ctx.fillStyle = '#9ad0ff'; ctx.fillText(`Lv.${p.level}`, 80, 9.5);
  RC(104, 7, 30, 4, '#102040'); RC(104, 7, Math.round(30 * p.xp / p.need), 4, '#4aa8ff');
  ctx.fillStyle = '#ffd23a'; ctx.fillText(`🪙${G.gold}`, 140, 9.5);
  ctx.fillStyle = '#fff'; ctx.fillText(`B${G.floor}`, 180, 9.5);
  ctx.fillStyle = '#c8c8d8'; ctx.fillText(`🧪${G.inv.potion}`, 198, 9.5);
}
function drawLog() {
  const y0 = HUD + MAPH;
  ctx.fillStyle = '#100c18'; ctx.fillRect(0, y0, CW, LOG);
  ctx.font = '8px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const lines = logs.slice(-3);
  lines.forEach((m, i) => { ctx.fillStyle = i === lines.length - 1 ? '#fff' : i === lines.length - 2 ? '#b0a8c0' : '#706888'; ctx.fillText(m, 4, y0 + 2 + i * 9); });
  ctx.fillStyle = '#c8b898'; ctx.textAlign = 'right'; ctx.fillText(`⚔${L.playerAtk(G)} 🛡${L.playerDef(G)}`, CW - 4, y0 + 2);
}
function draw() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CHH);
  if (!G) { ctx.fillStyle = '#1a1424'; ctx.fillRect(0, HUD, CW, MAPH); return; }
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 12, (Math.random() - 0.5) * shake * 12);
  drawMap();
  ctx.restore();
  drawHud(); drawLog();
  if (joy.active && joy.kind === 'float') { ctx.globalAlpha = 0.35; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(joy.ax, joy.ay, FLOAT_R, 0, Math.PI * 2); ctx.fill(); const dx = joy.px - joy.ax, dy = joy.py - joy.ay, d = Math.hypot(dx, dy) || 1, k = Math.min(1, FLOAT_R * 0.8 / d); ctx.globalAlpha = 0.65; ctx.beginPath(); ctx.arc(joy.ax + dx * k, joy.ay + dy * k, 8, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
  if (banner.t > 0) {
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, HUD + 90, CW, banner.sub ? 40 : 26);
    ctx.fillStyle = banner.color; ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, CW / 2, HUD + 103);
    if (banner.sub) { ctx.font = 'bold 9px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(banner.sub, CW / 2, HUD + 120); }
  }
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - (last || ts)) / 1000);
  last = ts; clock += dt; joyTick(dt);
  if (banner.t > 0) banner.t -= dt;
  if (shake > 0) shake = Math.max(0, shake - dt);
  for (const f of fxs) f.t += dt;
  fxs = fxs.filter((f) => f.t < f.life);
  draw();
  requestAnimationFrame(frame);
}
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
function toggleMute() { muted = !muted; store.set('mdMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

fit();
showTitle();
requestAnimationFrame(frame);
