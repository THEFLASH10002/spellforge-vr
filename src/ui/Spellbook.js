import * as THREE from 'three';
import { ARTS } from '../arts/ArtRegistry.js';
import { fx, makeHalo } from '../vfx/Effects.js';
import { HAND_DIM } from '../gestures/PoseFeatures.js';

// A floating spellbook. Every Sigil (built-in and custom) gets a page; when you save a new one the book bursts open,
// shows NEW SPELL DISCOVERED!, and the spell's page flies out as a glowing card (drawn on a CanvasTexture): the spell
// name, its Art + colour, and a drawing of the hand pose that was recorded. Poke the side arrows to turn pages.
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
  // palm
  const palm = [[-0.30, 0], KNUCKLE[4], KNUCKLE[3], KNUCKLE[2], KNUCKLE[1], KNUCKLE[0], [0.30, 0]];
  ctx.beginPath(); palm.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.closePath();
  ctx.fillStyle = color + '33'; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
  // fingers: knuckle -> bent middle -> tip
  for (let i = 0; i < 5; i++) {
    const k = KNUCKLE[i], t = tips[i], e = Math.min(1, Math.max(0, (curls[i] - 0.5) / 0.47));
    let dx = t[0] - k[0], dy = t[1] - k[1]; const l = Math.hypot(dx, dy) || 1;
    let px = -dy / l, py = dx / l; // perpendicular
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

// ---- the page ----------------------------------------------------------------------------------------------------------
function drawPage(ctx, sigil, index, total) {
  const art = ARTS[sigil.artId], color = hex(art ? art.color : FALLBACK_COLOR);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1b1233'); g.addColorStop(1, '#0b0820');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(8, 8, W - 16, H - 16, 28); ctx.fill();
  // glowing border in the spell's colour
  ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 30; ctx.strokeStyle = color; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.roundRect(14, 14, W - 28, H - 28, 24); ctx.stroke(); ctx.restore();
  // faint star specks + corner runes
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 40; i++) { ctx.globalAlpha = 0.1 + 0.25 * ((i * 37) % 10) / 10; ctx.fillRect((i * 97) % W, (i * 53) % H, 2, 2); }
  ctx.globalAlpha = 0.5; ctx.strokeStyle = color; ctx.lineWidth = 2;
  for (const [x, y, sx, sy] of [[34, 34, 1, 1], [W - 34, 34, -1, 1], [34, H - 34, 1, -1], [W - 34, H - 34, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(x, y + 26 * sy); ctx.lineTo(x, y); ctx.lineTo(x + 26 * sx, y); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 12 * sx, y + 12 * sy, 4, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // title
  ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.shadowColor = color; ctx.shadowBlur = 16;
  let size = 56; ctx.font = `bold ${size}px Georgia, serif`;
  while (ctx.measureText(sigil.name).width > W - 90 && size > 28) { size -= 4; ctx.font = `bold ${size}px Georgia, serif`; }
  ctx.fillText(sigil.name, W / 2, 98); ctx.shadowBlur = 0;
  // Art + colour chip
  const label = art ? art.name : 'Sanctum';
  ctx.font = '30px Georgia, serif'; ctx.fillStyle = color;
  ctx.fillText(label, W / 2 + 14, 148);
  ctx.beginPath(); ctx.arc(W / 2 - ctx.measureText(label).width / 2 - 8, 138, 10, 0, Math.PI * 2); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0;
  // gesture drawing on a glowing disc
  const cx = W / 2, cy = 400, r = 190;
  const rg = ctx.createRadialGradient(cx, cy, 10, cx, cy, r);
  rg.addColorStop(0, color + '55'); rg.addColorStop(1, color + '00');
  ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = color + '88'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, r - 8, 0, Math.PI * 2); ctx.stroke();
  drawSigil(ctx, sigil, cx, cy + 105, 135, color);
  // footer
  const who = sigil.hand === 'two' ? 'Two hands' : sigil.hand === 'left' ? 'Left hand' : sigil.hand === 'right' ? 'Right hand' : 'Either hand';
  ctx.font = '26px Georgia, serif'; ctx.fillStyle = '#c9c0ff';
  ctx.fillText(`${who}  ·  ${sigil.builtin ? 'Built-in' : 'Custom'}`, W / 2, H - 78);
  ctx.fillStyle = '#8a80c0'; ctx.font = '22px Georgia, serif';
  ctx.fillText(`Page ${index + 1} of ${total}`, W / 2, H - 44);
}

function arrowTexture(dir) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.shadowColor = '#b98cff'; g.shadowBlur = 18; g.fillStyle = 'rgba(30,20,60,0.85)'; g.strokeStyle = '#d8c8ff'; g.lineWidth = 5;
  g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(64 + dir * 20, 64); g.lineTo(64 - dir * 12, 40); g.lineTo(64 - dir * 12, 88); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function bannerTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  let fs = 84; g.font = `bold ${fs}px Georgia, serif`;
  while (g.measureText('NEW SPELL DISCOVERED!').width > 940 && fs > 30) { fs -= 4; g.font = `bold ${fs}px Georgia, serif`; } // fit the canvas
  const grad = g.createLinearGradient(0, 40, 0, 120); grad.addColorStop(0, '#fff3b0'); grad.addColorStop(1, '#c78bff');
  g.shadowColor = '#b060ff'; g.shadowBlur = 30; g.fillStyle = grad; g.fillText('NEW SPELL DISCOVERED!', 512, 112);
  g.shadowBlur = 8; g.fillText('NEW SPELL DISCOVERED!', 512, 112);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Spellbook {
  constructor({ scene, assets, getSigils }) {
    this.getSigils = getSigils; this.pages = []; this.index = 0; this.t = 0;
    this.flip = null; this.open = null; this.mixer = null; this.timeScale = 0.6;

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
    this.arrows = [-1, 1].map(d => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.075), new THREE.MeshBasicMaterial({ map: arrowTexture(d), transparent: true, depthWrite: false }));
      m.position.set(d * 0.2, -0.235, 0.005); m.userData = { dir: d, last: -1e9 };
      this.cardPivot.add(m); return m;
    });
    this.banner = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62 * 160 / 1024), new THREE.MeshBasicMaterial({ map: bannerTexture(), transparent: true, depthWrite: false, opacity: 0 }));
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

  // Rebuild the page list from the live Sigils (called when anything is saved, renamed, rebound or cleared).
  refresh() {
    this.pages = this.getSigils();
    this.index = Math.min(this.index, Math.max(0, this.pages.length - 1));
    this.redraw();
  }

  redraw() {
    const s = this.pages[this.index];
    if (!s) return;
    drawPage(this.ctx, s, this.index, this.pages.length);
    this.tex.needsUpdate = true;
  }

  // A new custom Sigil was saved: jump to its page and play the discovery.
  discover(sigil) {
    this.refresh();
    const i = this.pages.findIndex(p => p.id === sigil.id);
    if (i >= 0) this.index = i;
    this.redraw();
    this.open = { t: 0 };
    this.flip = null;
    const col = ARTS[sigil.artId]?.color ?? FALLBACK_COLOR, p = this.root.position.clone().add(new THREE.Vector3(0, 0.1, 0));
    fx.burst(p, col, 60, 3); fx.shock(p, new THREE.Vector3(0, 1, 0), col, 1.6, 1.2);
    this.halo.material.color.set(col);
  }

  go(d) {
    if (this.pages.length < 2 || this.flip || this.open) return;
    this.flip = { t: 0, to: (this.index + d + this.pages.length) % this.pages.length, swapped: false, d };
  }

  // Place the book in front of / slightly right of the player (call at session start).
  place(head, fwd) {
    const f = new THREE.Vector3(fwd.x, 0, fwd.z).normalize(), left = new THREE.Vector3(f.z, 0, -f.x); // left = up x forward
    const eye = Math.max(head.y, 1.2); // in a 'local' (not floor) space the head sits near y = 0, so never sink below chest height
    const p = head.clone().addScaledVector(f, 0.1).addScaledVector(left, 0.75); p.y = eye - 0.45; // beside you on your left, clear of the control panel
    this.root.position.copy(p); this.baseY = p.y;
    this.root.rotation.y = Math.atan2(head.x - p.x, head.z - p.z);
  }

  // Fingertip pokes on the page-turn arrows (same idea as the control panel).
  poke(tips, now) {
    const v = new THREE.Vector3();
    for (const tip of tips) {
      if (!tip) continue;
      for (const a of this.arrows) {
        a.worldToLocal(v.copy(tip));
        if (Math.abs(v.z) < 0.035 && Math.abs(v.x) < 0.0375 && Math.abs(v.y) < 0.0375 && now - a.userData.last > 600) { a.userData.last = now; this.go(a.userData.dir); }
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
    // hover
    this.root.position.y = this.baseY + Math.sin(t * 1.3) * 0.02;
    this.root.rotation.z = Math.sin(t * 0.9) * 0.03;
    this.halo.material.opacity = 0.22 + 0.08 * Math.sin(t * 2.1);
    let speed = this.timeScale, scale = 1, cardK = 1, bannerA = 0, cardSpin = 0;

    if (this.open) { // the book bursts open, the banner shows, then the page flies out
      const o = this.open; o.t += dt;
      const a = o.t;
      speed = a < 1.2 ? 3 : this.timeScale;
      scale = a < 0.35 ? 0.8 + 0.45 * ease(a / 0.35) : a < 0.9 ? 1.25 - 0.25 * ease((a - 0.35) / 0.55) : 1;
      this.halo.material.opacity = 0.7 * Math.max(0, 1 - a / 1.4) + 0.25;
      bannerA = a < 0.15 ? a / 0.15 : a < 2.4 ? 1 : Math.max(0, 1 - (a - 2.4) / 0.5);
      cardK = ease(Math.min(1, Math.max(0, (a - 0.5) / 0.9)));          // rises out of the book
      cardSpin = (1 - cardK) * Math.PI * 2;
      if (a > 3.0) this.open = null;
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
    for (const a of this.arrows) a.visible = this.pages.length > 1 && cardK > 0.9;
    if (this.mixer) { this.action.timeScale = speed; this.mixer.update(dt); }
  }
}
