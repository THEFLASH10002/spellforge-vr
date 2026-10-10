import * as THREE from 'three';
import { ARTS } from '../arts/ArtRegistry.js';
import { fx, makeHalo } from '../vfx/Effects.js';
import { HAND_DIM } from '../gestures/PoseFeatures.js';
import { UNLOCK_NAMES } from '../progress/Unlocks.js';

// A floating spellbook. Every spell gets a page: the spell name, its Art + colour, and a drawing of the hand pose that was
// recorded. Locked spells show as "???" with a hint. Two ways to learn things here:
//   * saving a custom Sigil  -> "NEW SPELL DISCOVERED!" and its page flies out;
//   * unlocking a spell      -> "NEW SPELL UNLOCKED!" with its name and colour (Purple gets a much bigger show);
//   * FUSE: pick a spell page, press FUSE, pick another spell page, press FUSE again: a valid recipe unlocks the result.
// The model keeps its own animation (flapping pages, spinning rune rings); the readable page is a flat card above it.
const W = 512, H = 680;
const hex = c => '#' + c.toString(16).padStart(6, '0');
const FALLBACK_COLOR = 0xb98cff;
const ease = x => x * x * (3 - 2 * x);

// ---- drawing a hand pose from a Sigil's feature vector --------------------------------------------------------
// Canonical hand (palm length = 1, wrist at origin, +y toward the fingers, +x toward the index side): the stored
// fingertip positions are used when present (custom Sigils); built-ins only store finger curl, so tips are synthesized.
const KNUCKLE = [[0.55, 0.30], [0.32, 0.95], [0.0, 1.0], [-0.30, 0.95], [-0.58, 0.82]]; // thumb base, index, middle, ring, pinky
const DIR = [[0.7, 0.7], [0.12, 1], [0, 1], [-0.1, 1], [-0.25, 1]];
const LEN = [0.55, 0.85, 0.95, 0.85, 0.65];

function handShape(h) {
  const curls = Array.from(h.slice(0, 5));
  let stored = 0;
  for (let i = 8; i < HAND_DIM; i++) stored += Math.abs(h[i]);
  const tips = [];
  for (let i = 0; i < 5; i++) {
    if (stored > 0.5) tips.push([h[8 + i * 3], h[9 + i * 3], h[10 + i * 3]]);
    else { // synthesized from curl (built-in Sigils): shorter and bent when curled
      const e = Math.min(1, Math.max(0, (curls[i] - 0.5) / 0.47)), k = KNUCKLE[i], d = DIR[i], n = Math.hypot(d[0], d[1]);
      const len = LEN[i] * (0.28 + 0.72 * e);
      tips.push([k[0] + (d[0] / n) * len, k[1] + (d[1] / n) * len - (1 - e) * 0.25, 0]);
    }
  }
  return { curls, tips };
}

function drawHand(ctx, h, cx, cy, s, left, color) {
  const { curls, tips } = handShape(h);
  const X = x => cx + (left ? x : -x) * s, Y = y => cy - y * s;
  ctx.save();
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.shadowColor = color; ctx.shadowBlur = 22;
  const palm = [[-0.30, 0], KNUCKLE[4], KNUCKLE[3], KNUCKLE[2], KNUCKLE[1], KNUCKLE[0], [0.30, 0]];
  ctx.beginPath(); palm.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.closePath();
  ctx.fillStyle = color + '33'; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const k = KNUCKLE[i], t = tips[i], e = Math.min(1, Math.max(0, (curls[i] - 0.5) / 0.47));
    let dx = t[0] - k[0], dy = t[1] - k[1]; const l = Math.hypot(dx, dy) || 1;
    let px = -dy / l, py = dx / l;
    const mx = (k[0] + t[0]) / 2, my = (k[1] + t[1]) / 2;
    if ((0 - mx) * px + (0.5 - my) * py < 0) { px = -px; py = -py; } // bend toward the palm
    const bend = (1 - e) * 0.3 * l, jx = mx + px * bend, jy = my + py * bend;
    ctx.beginPath(); ctx.moveTo(X(k[0]), Y(k[1])); ctx.quadraticCurveTo(X(jx), Y(jy), X(t[0]), Y(t[1]));
    ctx.strokeStyle = color; ctx.lineWidth = s * 0.15; ctx.globalAlpha = 0.85; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(X(t[0]), Y(t[1]), s * (0.065 + 0.03 * Math.min(1, Math.max(0, t[2]))), 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.shadowBlur = 16; ctx.fill();
  }
  ctx.restore();
}

function drawSigil(ctx, sigil, cx, cy, s, color) {
  if (sigil.hand === 'two' && sigil.vec.length >= HAND_DIM * 2) {
    const sp = Math.min(3, Math.max(0.9, sigil.vec[HAND_DIM * 2] || 1.7)) * s * 0.5;
    drawHand(ctx, sigil.vec.slice(0, HAND_DIM), cx - sp, cy, s * 0.75, true, color);
    drawHand(ctx, sigil.vec.slice(HAND_DIM, HAND_DIM * 2), cx + sp, cy, s * 0.75, false, color);
  } else drawHand(ctx, sigil.vec.slice(0, HAND_DIM), cx, cy, s, sigil.hand === 'left', color);
}

// Two orbs (Blue + Red) merging into a Purple one: the picture for a fusion-only spell.
function drawFusion(ctx, cx, cy, color) {
  ctx.save();
  for (const [x, c] of [[-62, '#4fb4ff'], [62, '#ff4a2a']]) {
    const g = ctx.createRadialGradient(cx + x, cy, 4, cx + x, cy, 70);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, c); g.addColorStop(1, c + '00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx + x, cy, 70, 0, Math.PI * 2); ctx.fill();
  }
  ctx.shadowColor = color; ctx.shadowBlur = 30; ctx.strokeStyle = color; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(cx, cy, 46, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#05000d'; ctx.beginPath(); ctx.arc(cx, cy, 36, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---- the page ----------------------------------------------------------------------------------------------------------
// page: a Sigil, or { locked, hint } for a spell not unlocked yet, or { hand: 'fusion' } for a fusion-only spell.
function drawPage(ctx, page, index, total, extra = {}) {
  const art = ARTS[page.artId], color = page.locked ? '#7d73b3' : hex(art ? art.color : FALLBACK_COLOR);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1b1233'); g.addColorStop(1, '#0b0820');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(8, 8, W - 16, H - 16, 28); ctx.fill();
  ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = page.locked ? 8 : 30; ctx.strokeStyle = color; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.roundRect(14, 14, W - 28, H - 28, 24); ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 40; i++) { ctx.globalAlpha = 0.1 + 0.25 * ((i * 37) % 10) / 10; ctx.fillRect((i * 97) % W, (i * 53) % H, 2, 2); }
  ctx.globalAlpha = 0.5; ctx.strokeStyle = color; ctx.lineWidth = 2;
  for (const [x, y, sx, sy] of [[34, 34, 1, 1], [W - 34, 34, -1, 1], [34, H - 34, 1, -1], [W - 34, H - 34, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(x, y + 26 * sy); ctx.lineTo(x, y); ctx.lineTo(x + 26 * sx, y); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 12 * sx, y + 12 * sy, 4, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // title
  ctx.textAlign = 'center'; ctx.fillStyle = page.locked ? '#a9a0d8' : '#ffffff'; ctx.shadowColor = color; ctx.shadowBlur = page.locked ? 0 : 16;
  let size = 56; ctx.font = `bold ${size}px Georgia, serif`;
  while (ctx.measureText(page.name).width > W - 90 && size > 28) { size -= 4; ctx.font = `bold ${size}px Georgia, serif`; }
  ctx.fillText(page.name, W / 2, 98); ctx.shadowBlur = 0;
  // Art + colour chip
  const label = page.locked ? 'Locked' : (art ? art.name : 'Sanctum');
  ctx.font = '30px Georgia, serif'; ctx.fillStyle = color;
  ctx.fillText(label, W / 2 + 14, 148);
  ctx.beginPath(); ctx.arc(W / 2 - ctx.measureText(label).width / 2 - 8, 138, 10, 0, Math.PI * 2); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = page.locked ? 0 : 14; ctx.fill(); ctx.shadowBlur = 0;
  // picture on a glowing disc
  const cx = W / 2, cy = 400, r = 190;
  const rg = ctx.createRadialGradient(cx, cy, 10, cx, cy, r);
  rg.addColorStop(0, color + (page.locked ? '22' : '55')); rg.addColorStop(1, color + '00');
  ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = color + '88'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, r - 8, 0, Math.PI * 2); ctx.stroke();
  if (page.locked) {
    ctx.fillStyle = color; ctx.font = 'bold 190px Georgia, serif'; ctx.fillText('?', cx, cy + 60);
    ctx.font = '26px Georgia, serif'; ctx.fillStyle = '#c9c0ff'; ctx.fillText(page.hint || 'Undiscovered', cx, cy + 128);
  } else if (page.hand === 'fusion') drawFusion(ctx, cx, cy + 10, color);
  else drawSigil(ctx, page, cx, cy + 105, 135, color);
  // footer
  const who = page.locked ? 'Combine spells to unlock' : page.hand === 'fusion' ? 'Fusion spell' : page.hand === 'two' ? 'Two hands' : page.hand === 'left' ? 'Left hand' : page.hand === 'right' ? 'Right hand' : 'Either hand';
  ctx.font = '26px Georgia, serif'; ctx.fillStyle = '#c9c0ff';
  ctx.fillText(page.locked ? who : `${who}  ·  ${page.builtin ? 'Built-in' : 'Custom'}`, W / 2, H - 78);
  ctx.fillStyle = '#8a80c0'; ctx.font = '22px Georgia, serif';
  ctx.fillText(`Page ${index + 1} of ${total}`, W / 2, H - 44);
  // fuse state / feedback
  if (extra.fuseName) { ctx.fillStyle = '#ffd86b'; ctx.font = 'bold 24px Georgia, serif'; ctx.fillText(`FUSING: ${extra.fuseName}`, W / 2, 196); }
  if (extra.msg) {
    ctx.fillStyle = 'rgba(8,4,24,0.88)'; ctx.beginPath(); ctx.roundRect(36, H - 150, W - 72, 52, 14); ctx.fill();
    ctx.fillStyle = '#ffd86b'; ctx.font = 'bold 24px Georgia, serif'; ctx.fillText(extra.msg, W / 2, H - 116);
  }
}

// ---- small canvas textures -------------------------------------------------------------------------------------------
function arrowTexture(dir) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.shadowColor = '#b98cff'; g.shadowBlur = 18; g.fillStyle = 'rgba(30,20,60,0.85)'; g.strokeStyle = '#d8c8ff'; g.lineWidth = 5;
  g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(64 + dir * 20, 64); g.lineTo(64 - dir * 12, 40); g.lineTo(64 - dir * 12, 88); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function fuseTexture(active, text, dim = false) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 128;
  const g = c.getContext('2d'); g.globalAlpha = dim ? 0.45 : 1;
  g.shadowColor = active ? '#ffd86b' : '#b98cff'; g.shadowBlur = 20;
  g.fillStyle = active ? 'rgba(70,45,10,0.9)' : 'rgba(30,20,60,0.88)'; g.strokeStyle = active ? '#ffd86b' : '#d8c8ff'; g.lineWidth = 6;
  g.beginPath(); g.roundRect(8, 14, 304, 100, 40); g.fill(); g.stroke();
  g.shadowBlur = 0; g.fillStyle = '#ffffff'; g.textAlign = 'center'; let fs = 54; g.font = `bold ${fs}px Georgia, serif`;
  while (g.measureText(text).width > 260 && fs > 24) { fs -= 4; g.font = `bold ${fs}px Georgia, serif`; }
  g.fillText(text, 160, 82);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Banner: a small gold title over a large coloured line, e.g. "NEW SPELL UNLOCKED!" / "BLUE · Gravity Well".
function drawBanner(ctx, title, sub, color) {
  ctx.clearRect(0, 0, 1024, 256);
  ctx.textAlign = 'center';
  const fit = (text, px, max) => { let s = px; ctx.font = `bold ${s}px Georgia, serif`; while (ctx.measureText(text).width > max && s > 24) { s -= 4; ctx.font = `bold ${s}px Georgia, serif`; } };
  const grad = ctx.createLinearGradient(0, 30, 0, 110); grad.addColorStop(0, '#fff3b0'); grad.addColorStop(1, '#ffb347');
  fit(title, 84, 940); ctx.shadowColor = '#ff9a1f'; ctx.shadowBlur = 28; ctx.fillStyle = grad; ctx.fillText(title, 512, 102);
  ctx.shadowBlur = 6; ctx.fillText(title, 512, 102);
  if (sub) { fit(sub, 100, 940); ctx.shadowColor = color; ctx.shadowBlur = 36; ctx.fillStyle = '#ffffff'; ctx.fillText(sub, 512, 212); ctx.shadowBlur = 10; ctx.fillStyle = color; ctx.globalAlpha = 0.55; ctx.fillText(sub, 512, 212); ctx.globalAlpha = 1; }
}

// ---- creation wizard ---------------------------------------------------------------------------------------------------
const HAND_OPTS = [['right', 'Right hand'], ['left', 'Left hand'], ['two', 'Both hands']];
const NAME_A = ['Ember', 'Frost', 'Silent', 'Hollow', 'Gilded', 'Storm', 'Veiled', 'Crimson', 'Lunar', 'Iron', 'Astral', 'Verdant'];
const NAME_N = ['Fang', 'Crown', 'Veil', 'Tide', 'Spiral', 'Lantern', 'Thorn', 'Echo', 'Comet', 'Gate', 'Sigil', 'Bloom'];
const randomName = () => NAME_A[(Math.random() * NAME_A.length) | 0] + ' ' + NAME_N[(Math.random() * NAME_N.length) | 0];

function drawFrame(ctx, color) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1b1233'); g.addColorStop(1, '#0b0820');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(8, 8, W - 16, H - 16, 28); ctx.fill();
  ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 30; ctx.strokeStyle = color; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.roundRect(14, 14, W - 28, H - 28, 24); ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 40; i++) { ctx.globalAlpha = 0.1 + 0.25 * ((i * 37) % 10) / 10; ctx.fillRect((i * 97) % W, (i * 53) % H, 2, 2); }
  ctx.globalAlpha = 1;
}

// c: { step: 'art' | 'hands' | 'record' | 'fail', artIdx, handIdx, msg }; rec: { phase, t } from the Recorder.
function drawCreate(ctx, c, arts, rec) {
  const artId = arts[c.artIdx % arts.length], art = ARTS[artId], color = hex(art.color);
  drawFrame(ctx, color);
  ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.shadowColor = color; ctx.shadowBlur = 14;
  ctx.font = 'bold 44px Georgia, serif'; ctx.fillText('Create a new spell', W / 2, 84); ctx.shadowBlur = 0;
  const no = { art: 1, hands: 2, record: 3 }[c.step];
  ctx.font = '24px Georgia, serif'; ctx.fillStyle = '#c9c0ff';
  if (no) ctx.fillText('Step ' + no + ' of 3', W / 2, 122);
  const orb = (x, y, r) => { const g = ctx.createRadialGradient(x, y, 4, x, y, r); g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, color); g.addColorStop(1, color + '00'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
  if (c.step === 'art') {
    ctx.font = '28px Georgia, serif'; ctx.fillStyle = '#e6deff'; ctx.fillText('Which spell will this sign cast?', W / 2, 180);
    orb(W / 2, 340, 120);
    ctx.font = 'bold 56px Georgia, serif'; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 18; ctx.fillText(art.name, W / 2, 520); ctx.shadowBlur = 0;
    arts.forEach((id, i) => { ctx.beginPath(); ctx.arc(W / 2 + (i - (arts.length - 1) / 2) * 34, 566, i === c.artIdx % arts.length ? 10 : 6, 0, Math.PI * 2); ctx.fillStyle = hex(ARTS[id].color); ctx.globalAlpha = i === c.artIdx % arts.length ? 1 : 0.5; ctx.fill(); ctx.globalAlpha = 1; });
    ctx.font = '22px Georgia, serif'; ctx.fillStyle = '#9d94d6'; ctx.fillText('Use the arrows to choose, then NEXT', W / 2, 610);
  } else if (c.step === 'hands') {
    ctx.font = '28px Georgia, serif'; ctx.fillStyle = '#e6deff'; ctx.fillText('Which hand(s) make the sign?', W / 2, 180);
    const open = new Float32Array(HAND_DIM); open.set([0.97, 0.97, 0.97, 0.97, 0.97], 0);
    HAND_OPTS.forEach(([mode, label], i) => {
      const x = 90 + i * 166, sel = i === c.handIdx;
      ctx.save(); ctx.globalAlpha = sel ? 1 : 0.4;
      if (sel) { ctx.fillStyle = color + '33'; ctx.beginPath(); ctx.roundRect(x - 70, 250, 140, 230, 24); ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.stroke(); }
      if (mode === 'two') { drawHand(ctx, open, x - 24, 430, 46, true, color); drawHand(ctx, open, x + 24, 430, 46, false, color); }
      else drawHand(ctx, open, x, 430, 70, mode === 'left', color);
      ctx.restore();
      ctx.font = (sel ? 'bold ' : '') + '22px Georgia, serif'; ctx.fillStyle = sel ? '#ffffff' : '#9d94d6'; ctx.fillText(label, x, 512);
    });
    ctx.font = '26px Georgia, serif'; ctx.fillStyle = color; ctx.fillText('Casts: ' + art.name, W / 2, 570);
    ctx.font = '22px Georgia, serif'; ctx.fillStyle = '#9d94d6'; ctx.fillText('Arrows to choose, then RECORD', W / 2, 612);
  } else if (c.step === 'record') {
    ctx.font = '26px Georgia, serif'; ctx.fillStyle = color; ctx.fillText(art.name + ' · ' + HAND_OPTS[c.handIdx][1], W / 2, 170);
    if (rec.phase === 'countdown') {
      ctx.font = 'bold 200px Georgia, serif'; ctx.fillStyle = '#ffffff'; ctx.shadowColor = color; ctx.shadowBlur = 30; ctx.fillText(String(Math.max(1, Math.ceil(rec.t))), W / 2, 380); ctx.shadowBlur = 0;
      ctx.font = '28px Georgia, serif'; ctx.fillStyle = '#e6deff'; ctx.fillText('Get ready: make your sign', W / 2, 460);
    } else {
      ctx.font = 'bold 54px Georgia, serif'; ctx.fillStyle = '#ffd86b'; ctx.shadowColor = '#ff9a1f'; ctx.shadowBlur = 20; ctx.fillText('HOLD THE POSE', W / 2, 340); ctx.shadowBlur = 0;
      const p = Math.min(1, Math.max(0, 1 - rec.t)); ctx.fillStyle = '#2a2050'; ctx.beginPath(); ctx.roundRect(70, 390, W - 140, 34, 17); ctx.fill();
      ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(70, 390, Math.max(34, (W - 140) * p), 34, 17); ctx.fill();
    }
    ctx.font = '23px Georgia, serif'; ctx.fillStyle = '#9d94d6'; ctx.fillText('The words under your hands show what', W / 2, 530); ctx.fillText('spell each hand is making right now', W / 2, 560);
  } else if (c.step === 'fail') {
    ctx.font = 'bold 44px Georgia, serif'; ctx.fillStyle = '#ff9a9a'; ctx.fillText('Not saved', W / 2, 300);
    ctx.font = '28px Georgia, serif'; ctx.fillStyle = '#e6deff';
    const words = (c.msg || 'Tracking was lost. Try again.').split(' '); let line = '', y = 380;
    for (const w of words) { if (ctx.measureText(line + w).width > W - 120) { ctx.fillText(line, W / 2, y); line = ''; y += 40; } line += w + ' '; }
    ctx.fillText(line, W / 2, y);
  }
}

const labelCache = new Map();
function labelTexture(text, tone) { // 'normal' | 'gold' | 'dim'
  const key = text + '|' + tone;
  if (!labelCache.has(key)) labelCache.set(key, fuseTexture(tone === 'gold', text, tone === 'dim'));
  return labelCache.get(key);
}

export class Spellbook {
  // getPages(): the list of page objects (see drawPage). tryFuse(artA, artB): { status: 'unlocked' | 'known' | 'invalid' }.
  // recorder: the existing Recorder (the wizard records through it). getArts(): unlocked spell ids. persist(): save custom signs.
  constructor({ scene, assets, getPages, tryFuse, recorder, getArts, persist }) {
    this.getPages = getPages; this.tryFuse = tryFuse || (() => ({ status: 'invalid' }));
    this.recorder = recorder; this.getArts = getArts || (() => ['bolt']); this.persist = persist;
    this.mode = 'browse'; this.create = null; this.started = false; this.recT = 0;
    this.pages = []; this.index = 0; this.t = 0;
    this.flip = null; this.open = null; this.mixer = null; this.timeScale = 0.6;
    this.fuseA = null; this.msg = ''; this.msgT = 0;
    this.onCelebrate = null; // main hooks extra world effects (petals, scene flash) here

    this.root = new THREE.Group();
    this.root.position.set(-0.75, 1.15, -0.1); this.root.rotation.y = Math.atan2(0.75, 0.1); // starts beside you on the left (re-placed when VR starts)
    scene.add(this.root);
    this.baseY = this.root.position.y;

    // The book: your GLB (skinned, with its own flap + rune-ring animation), or a simple stand-in if the model is missing.
    this.pivot = new THREE.Group(); this.pivot.rotation.x = -0.3; this.root.add(this.pivot);
    const model = assets?.get('book', { fitHeight: 0.5, toon: false, outline: false });
    if (model) {
      this.pivot.add(model);
      const clips = assets.raw.book.animations || [];
      if (clips.length) { this.mixer = new THREE.AnimationMixer(model.children[0]); this.action = this.mixer.clipAction(clips[0]); this.action.play(); }
    } else this.pivot.add(this.fallbackBook());
    this.halo = makeHalo(0xb98cff, 0.9); this.halo.material.opacity = 0.25; this.halo.position.set(0, 0.08, 0); this.pivot.add(this.halo);

    // The page card that rises out of the book.
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    this.cardPivot = new THREE.Group(); this.cardPivot.position.set(0, 0.5, 0.06); this.cardPivot.rotation.x = -0.2; this.root.add(this.cardPivot);
    this.card = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3 * H / W), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    this.cardPivot.add(this.card);

    // Buttons (poke with a fingertip): page back, FUSE, page forward.
    this.buttons = [];
    const addBtn = (w, h, x, map, fn) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
      m.position.set(x, -0.235, 0.005); this.cardPivot.add(m);
      const b = { mesh: m, hw: w / 2, hh: h / 2, last: -1e9, fn }; this.buttons.push(b); return b;
    };
    this.prevBtn = addBtn(0.075, 0.075, -0.2, arrowTexture(-1), () => this.onArrow(-1));
    this.nextBtn = addBtn(0.075, 0.075, 0.2, arrowTexture(1), () => this.onArrow(1));
    // Two centre buttons whose job depends on the mode: browsing = FUSE | CREATE; creating = back/cancel | next/record/done.
    this.fuseBtn = addBtn(0.12, 0.048, -0.066, labelTexture('FUSE', 'normal'), () => this.onFuseBtn());
    this.createBtn = addBtn(0.12, 0.048, 0.074, labelTexture('CREATE', 'normal'), () => this.onCreateBtn());

    // Announcement banner above the card.
    this.bannerCanvas = document.createElement('canvas'); this.bannerCanvas.width = 1024; this.bannerCanvas.height = 256;
    this.bannerTex = new THREE.CanvasTexture(this.bannerCanvas); this.bannerTex.colorSpace = THREE.SRGBColorSpace;
    this.banner = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.66 * 256 / 1024), new THREE.MeshBasicMaterial({ map: this.bannerTex, transparent: true, depthWrite: false, opacity: 0 }));
    this.banner.position.set(0, 0.36, 0.1); this.cardPivot.add(this.banner);
    this.refresh();
  }

  fallbackBook() {
    const g = new THREE.Group(), page = new THREE.MeshBasicMaterial({ color: 0xe8dcc0, side: THREE.DoubleSide }), cover = new THREE.MeshBasicMaterial({ color: 0x4a2f6a });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), page); p.rotation.set(-Math.PI / 2 + 0.1, 0, s * 0.35); p.position.set(s * 0.11, 0.02, 0); g.add(p);
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.012, 0.31), cover); c.rotation.z = s * 0.35; c.position.set(s * 0.11, 0.008, 0); g.add(c);
    }
    return g;
  }

  // Rebuild the page list (called when anything is saved, renamed, rebound, cleared or unlocked).
  refresh() {
    this.pages = this.getPages();
    this.index = Math.min(this.index, Math.max(0, this.pages.length - 1));
    this.redraw();
  }

  redraw() {
    const c = this.create;
    if (this.mode === 'create' && c.step !== 'done') {
      drawCreate(this.ctx, c, this.getArts(), { phase: this.recorder.phase, t: this.recorder.t });
      this.tex.needsUpdate = true; this.setButtons();
      return;
    }
    const done = this.mode === 'create'; // step 'done': show the page that was just made
    const s = done ? c.sigil : this.pages[this.index];
    if (!s) return;
    const idx = done ? Math.max(0, this.pages.findIndex(p => p.id === s.id)) : this.index;
    drawPage(this.ctx, s, idx, this.pages.length, { msg: done ? 'Saved! Make this pose to cast it' : this.msg, fuseName: this.fuseA?.name });
    this.tex.needsUpdate = true; this.setButtons();
  }

  // ---- the creation wizard: CREATE -> pick the spell -> pick the hand(s) -> record -> done ----------------------------
  get creating() { return this.mode === 'create'; }

  setLabel(btn, text, tone) { const m = btn.mesh.material, t = labelTexture(text, tone); if (m.map !== t) { m.map = t; m.needsUpdate = true; } }
  setButtons() {
    if (this.mode === 'browse') { this.setLabel(this.fuseBtn, this.fuseA ? 'FUSE ?' : 'FUSE', this.fuseA ? 'gold' : 'normal'); this.setLabel(this.createBtn, 'CREATE', 'normal'); return; }
    const st = this.create.step;
    this.setLabel(this.fuseBtn, { art: 'CANCEL', hands: 'BACK', record: 'CANCEL', done: 'RENAME', fail: 'BACK' }[st], 'normal');
    this.setLabel(this.createBtn, { art: 'NEXT', hands: 'RECORD', record: '...', done: 'DONE', fail: 'RETRY' }[st], st === 'record' ? 'dim' : 'gold');
  }
  onArrow(d) { if (this.mode === 'browse') this.go(d); else this.createCycle(d); }
  onFuseBtn() { if (this.mode === 'browse') this.fusePress(); else this.createSecondary(); }
  onCreateBtn() { if (this.mode === 'browse') this.startCreate(); else this.createPrimary(); }

  startCreate() {
    if (this.open) return;
    this.mode = 'create'; this.create = { step: 'art', artIdx: 0, handIdx: 0, sigil: null, msg: '' };
    this.fuseA = null; this.msg = ''; this.started = false; this.redraw();
  }
  endCreate() { this.recorder.cancel(); this.mode = 'browse'; this.create = null; this.started = false; this.redraw(); }
  createCycle(d) {
    const c = this.create, n = this.getArts().length;
    if (c.step === 'art') c.artIdx = (c.artIdx + d + n) % n; else if (c.step === 'hands') c.handIdx = (c.handIdx + d + 3) % 3;
    this.redraw();
  }
  startRecording() {
    const c = this.create, arts = this.getArts();
    c.step = 'record'; this.started = true;
    this.recorder.start(HAND_OPTS[c.handIdx][0], arts[c.artIdx % arts.length]);
  }
  createPrimary() {
    const c = this.create;
    if (c.step === 'art') c.step = 'hands';
    else if (c.step === 'hands' || c.step === 'fail') this.startRecording();
    else if (c.step === 'done') { const id = c.sigil?.id; this.endCreate(); const i = this.pages.findIndex(p => p.id === id); if (i >= 0) { this.index = i; this.redraw(); } return; }
    this.redraw();
  }
  createSecondary() {
    const c = this.create;
    if (c.step === 'art') return this.endCreate();
    if (c.step === 'hands' || c.step === 'fail') c.step = c.step === 'hands' ? 'art' : 'hands';
    else if (c.step === 'record') { this.recorder.cancel(); this.started = false; c.step = 'hands'; }
    else if (c.step === 'done') { c.sigil.name = randomName(); this.persist?.(); this.refresh(); } // re-roll the name
    this.redraw();
  }


  say(msg, sec = 2.4) { this.msg = msg; this.msgT = sec; this.redraw(); }

  announce(title, sub, colorHex) {
    drawBanner(this.bannerCanvas.getContext('2d'), title, sub, hex(colorHex));
    this.bannerTex.needsUpdate = true;
  }

  // A new custom Sigil was saved: jump to its page and play the discovery.
  discover(sigil) {
    if (this.mode === 'create') { // saved through the wizard: give it a real name and show the result
      sigil.name = randomName(); this.persist?.();
      this.create.step = 'done'; this.create.sigil = sigil; this.started = false;
    }
    this.refresh();
    const i = this.pages.findIndex(p => p.id === sigil.id);
    if (i >= 0) this.index = i;
    const col = ARTS[sigil.artId]?.color ?? FALLBACK_COLOR;
    this.announce('NEW SPELL DISCOVERED!', sigil.name, col);
    this.startOpen(col, false);
  }

  // A spell was unlocked (hand-sign combination, orb fusion, or the FUSE button). Purple gets the big version.
  celebrate(artId) {
    const art = ARTS[artId]; if (!art) return;
    this.refresh();
    let i = this.pages.findIndex(p => p.artId === artId && !p.locked);
    if (i < 0) i = this.pages.findIndex(p => p.artId === artId);
    if (i >= 0) this.index = i;
    this.fuseA = null; this.msg = ''; this.msgT = 0;
    const [word, nm] = UNLOCK_NAMES[artId] || ['', art.name];
    this.announce('NEW SPELL UNLOCKED!', word ? `${word} · ${nm}` : nm, art.color);
    this.startOpen(art.color, artId === 'nullpoint');
    this.onCelebrate?.(artId);
  }

  startOpen(col, big) {
    this.redraw();
    this.open = { t: 0, big, dur: big ? 5.4 : 3.2, fired: 0 };
    this.flip = null; this.openColor = col;
    this.halo.material.color.set(col);
    const p = this.root.position.clone().add(new THREE.Vector3(0, 0.1, 0));
    fx.burst(p, col, big ? 90 : 60, big ? 4 : 3); fx.shock(p, new THREE.Vector3(0, 1, 0), col, big ? 2.4 : 1.6, 1.2);
  }

  go(d) {
    if (this.pages.length < 2 || this.flip || this.open) return;
    this.flip = { t: 0, to: (this.index + d + this.pages.length) % this.pages.length, swapped: false, d };
  }

  // FUSE: pick a spell page, press FUSE, pick another, press FUSE again.
  fusePress() {
    const pg = this.pages[this.index];
    if (!pg || this.open) return;
    if (pg.locked) return this.say('That spell is still locked');
    if (!this.fuseA) { this.fuseA = pg; this.fuseT = 20; return this.say(`Pick another spell, then FUSE`, 6); }
    if (this.fuseA.artId === pg.artId) { this.fuseA = null; return this.say('Fuse cancelled'); }
    const r = this.tryFuse(this.fuseA.artId, pg.artId);
    this.fuseA = null;
    if (r.status === 'known') this.say('Already unlocked');
    else if (r.status === 'invalid') this.say("These spells don't combine");
    // 'unlocked' => the unlock popup (celebrate) takes over
    this.redraw();
  }

  // Place the book beside the player on their left (call at session start).
  place(head, fwd) {
    const f = new THREE.Vector3(fwd.x, 0, fwd.z).normalize(), left = new THREE.Vector3(f.z, 0, -f.x); // left = up x forward
    const eye = Math.max(head.y, 1.2); // in a 'local' (not floor) space the head sits near y = 0, so never sink below chest height
    const p = head.clone().addScaledVector(f, 0.1).addScaledVector(left, 0.75); p.y = eye - 0.45;
    this.root.position.copy(p); this.baseY = p.y;
    this.root.rotation.y = Math.atan2(head.x - p.x, head.z - p.z);
  }

  // Fingertip pokes on the buttons (same idea as the control panel).
  poke(tips, now) {
    const v = new THREE.Vector3();
    for (const tip of tips) {
      if (!tip) continue;
      for (const b of this.buttons) {
        if (!b.mesh.visible) continue;
        b.mesh.worldToLocal(v.copy(tip));
        if (Math.abs(v.z) < 0.035 && Math.abs(v.x) < b.hw && Math.abs(v.y) < b.hh && now - b.last > 600) { b.last = now; b.fn(); }
      }
    }
  }

  // head/fwd (optional): if the book ever ends up inside you (< 0.45 m) or far away (> 3.5 m), put it back beside you.
  update(dt, t, head, fwd) {
    this.t += dt;
    if (head && fwd) {
      const d = Math.hypot(this.root.position.x - head.x, this.root.position.z - head.z);
      if ((d < 0.45 || d > 3.5) && t - (this.lastPlace ?? -9) > 1) { this.place(head, fwd); this.lastPlace = t; }
    }
    if (this.mode === 'create' && this.create.step === 'record') {
      if (this.started && !this.recorder.active) { // the recording ended without saving (a save would already have moved us to 'done')
        this.started = false; this.create.step = 'fail'; this.create.msg = this.recorder.message || 'Tracking was lost. Try again.'; this.redraw();
      } else if (this.recorder.active && (this.recT -= dt) <= 0) { this.recT = 0.12; this.redraw(); } // live countdown / progress
    }
    // message / fuse timeouts
    if (this.msgT > 0 && (this.msgT -= dt) <= 0) { this.msg = ''; this.redraw(); }
    if (this.fuseA && (this.fuseT -= dt) <= 0) { this.fuseA = null; this.say('Fuse timed out'); }
    // hover
    this.root.position.y = this.baseY + Math.sin(t * 1.3) * 0.02;
    this.root.rotation.z = Math.sin(t * 0.9) * 0.03;
    this.halo.material.opacity = 0.22 + 0.08 * Math.sin(t * 2.1);
    let speed = this.timeScale, scale = 1, cardK = 1, bannerA = 0, cardSpin = 0;

    if (this.open) { // the book bursts open, the banner shows, then the page flies out
      const o = this.open; o.t += dt;
      const a = o.t, big = o.big;
      speed = a < 1.2 ? 3 : this.timeScale;
      const peak = big ? 1.6 : 1.25;
      scale = a < 0.35 ? 0.8 + (peak - 0.8) * ease(a / 0.35) : a < 0.9 ? peak - (peak - 1) * ease((a - 0.35) / 0.55) : 1;
      this.halo.material.opacity = (big ? 1 : 0.7) * Math.max(0, 1 - a / (big ? 2.4 : 1.4)) + 0.25;
      this.halo.scale.setScalar(0.9 * (1 + (big ? 2.2 : 0.8) * Math.max(0, 1 - a / 1.2)));
      bannerA = a < 0.15 ? a / 0.15 : a < o.dur - 0.6 ? 1 : Math.max(0, 1 - (a - (o.dur - 0.6)) / 0.5);
      cardK = ease(Math.min(1, Math.max(0, (a - 0.5) / 0.9)));          // the page rises out of the book
      cardSpin = (1 - cardK) * Math.PI * 2;
      if (big) { // Purple: extra waves of particles and shockwaves
        const up = new THREE.Vector3(0, 1, 0), p = this.root.position.clone().add(new THREE.Vector3(0, 0.1, 0));
        if (o.fired === 0 && a > 0.5) { o.fired = 1; fx.burst(p, this.openColor, 100, 5); fx.shock(p, up, this.openColor, 3.4, 1.5); }
        if (o.fired === 1 && a > 1.0) { o.fired = 2; fx.burst(p, 0xffe0ff, 140, 6); fx.shock(p, up, 0xe0a0ff, 4.6, 1.8); }
      }
      if (a > o.dur) { this.open = null; this.halo.scale.setScalar(0.9); }
    }
    if (this.flip) { // page turn: card swings edge-on, swaps the page, swings back
      const f = this.flip; f.t += dt / 0.35;
      if (f.t >= 0.5 && !f.swapped) { f.swapped = true; this.index = f.to; this.redraw(); }
      cardSpin = f.d * (f.t < 0.5 ? ease(f.t * 2) : -ease((1 - f.t) * 2)) * (Math.PI / 2);
      if (f.t >= 1) this.flip = null;
    }
    this.pivot.scale.setScalar(scale);
    this.card.scale.setScalar(Math.max(0.001, cardK)); this.card.rotation.y = cardSpin;
    this.card.position.y = -(1 - cardK) * 0.4;
    this.banner.material.opacity = bannerA; this.banner.scale.setScalar(0.8 + 0.2 * Math.min(1, bannerA * 1.5));
    for (const b of this.buttons) b.mesh.visible = (this.mode === 'create' || this.pages.length > 1) && cardK > 0.9;
    this.fuseBtn.mesh.scale.setScalar(this.fuseA && this.mode === 'browse' ? 1 + 0.06 * Math.sin(t * 8) : 1); // the FUSE button pulses while a fuse is pending
    if (this.mixer) { this.action.timeScale = speed; this.mixer.update(dt); }
  }
}
