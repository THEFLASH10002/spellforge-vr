import { HAND_DIM, distance, handWeights, twoHandVec } from './PoseFeatures.js';

const KEY = 'spellforge.sigils.v1';
const COUNTDOWN = 3, CAPTURE = 1;

export function loadCustom() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]').map(s => ({ ...s, vec: Float32Array.from(s.vec), w: Float32Array.from(s.w) }));
  } catch { return []; }
}
export function saveCustom(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.filter(s => !s.builtin).map(s => ({ ...s, vec: [...s.vec], w: [...s.w] })))); } catch {}
}

// Enrollment: countdown -> capture ~1 s of frames -> average -> similarity check -> save.
export class Recorder {
  constructor(recognizer) {
    this.rec = recognizer;
    this.phase = 'idle'; // idle | countdown | capture
    this.t = 0; this.frames = []; this.mode = 'right'; this.artId = 'bolt';
    this.message = '';
  }
  get active() { return this.phase !== 'idle'; }

  start(mode, artId) {
    Object.assign(this, { mode, artId, phase: 'countdown', t: COUNTDOWN, frames: [], message: '' });
  }

  update(dt, L, R, headInv) {
    if (this.phase === 'idle') return;
    this.t -= dt;
    if (this.phase === 'countdown') {
      if (this.t <= 0) { this.phase = 'capture'; this.t = CAPTURE; }
      return;
    }
    const v = this.mode === 'two' ? (L && R ? twoHandVec(L, R, headInv) : null)
      : (this.mode === 'left' ? L : R)?.vec;
    if (v) this.frames.push(Float32Array.from(v));
    if (this.t <= 0) this.finish();
  }

  finish() {
    this.phase = 'idle';
    const n = this.frames.length;
    if (n < 15) { this.message = `Lost tracking (${n} frames). Try again.`; return; }
    const dim = this.frames[0].length;
    const mean = new Float32Array(dim);
    for (const f of this.frames) for (let i = 0; i < dim; i++) mean[i] += f[i] / n;
    let sd = 0;
    for (const f of this.frames) for (let i = 0; i < dim; i++) sd += (f[i] - mean[i]) ** 2;
    sd = Math.sqrt(sd / (n * dim));
    const hw = handWeights({ curl: [3, 3, 3, 3, 3], normal: 1, tips: 1 });
    const w = new Float32Array(dim);
    if (this.mode === 'two') { w.set(hw, 0); w.set(hw, HAND_DIM); w.fill(1, HAND_DIM * 2); } else w.set(hw);
    const thresh = Math.min(0.3, Math.max(0.15, sd * 3 + 0.1));
    for (const o of this.rec.sigils) {
      if ((o.hand === 'two') !== (this.mode === 'two') || o.vec.length !== mean.length) continue;
      if (distance(mean, o.vec, o.w) < o.thresh * 1.2) { this.message = `Too similar to "${o.name}". Change your pose.`; return; }
    }
    const count = this.rec.sigils.filter(s => !s.builtin).length + 1;
    const sigil = { id: 'custom-' + Date.now(), name: `Sigil ${count}`, hand: this.mode, artId: this.artId, thresh, vec: mean, w };
    this.rec.sigils.push(sigil);
    saveCustom(this.rec.sigils);
    this.message = `Saved "${sigil.name}" -> ${this.artId}`;
    this.onSaved?.(sigil); // the spellbook adds a page
  }

  // Save a two-hand Sigil straight from a live two-hand vector (hand-sign combinations use this instead of the 1 s capture).
  makeTwoHandSigil(vec, artId, name) {
    const hw = handWeights({ curl: [3, 3, 3, 3, 3], normal: 1, tips: 1 });
    const w = new Float32Array(vec.length);
    w.set(hw, 0); w.set(hw, HAND_DIM); w.fill(1, HAND_DIM * 2);
    return { id: 'custom-' + Date.now(), name, hand: 'two', artId, thresh: 0.22, vec: Float32Array.from(vec), w };
  }
  addSigil(sigil) { this.rec.sigils.push(sigil); saveCustom(this.rec.sigils); this.onChanged?.(); }

  clearCustom() {
    this.rec.sigils = this.rec.sigils.filter(s => s.builtin);
    saveCustom(this.rec.sigils);
    this.message = 'Custom Sigils cleared';
    this.onChanged?.();
  }
}
