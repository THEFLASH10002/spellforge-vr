import { distance, twoHandVec } from './PoseFeatures.js';

// Matches live hands against Sigils. A Sigil fires after being held `holdTime`
// seconds, then must be released (no match for `releaseTime`) before it can re-fire.
export class Recognizer {
  constructor({ holdTime = 0.4, releaseTime = 0.3, cooldown = 1.0 } = {}) {
    Object.assign(this, { holdTime, releaseTime, cooldown });
    this.sigils = [];
    this.onCast = () => {};
    this.hold = 0; this.key = null; this.armed = true; this.free = 0;
    this.cool = {};
    this.debug = null;
  }

  update(dt, L, R, headInv) {
    for (const k in this.cool) this.cool[k] = Math.max(0, this.cool[k] - dt);
    const two = L && R ? twoHandVec(L, R, headInv) : null;
    let best = null;
    for (const sg of this.sigils) {
      const tries = sg.hand === 'two' ? (two ? [['two', two]] : [])
        : sg.hand === 'any' ? [['left', L?.vec], ['right', R?.vec]]
        : [[sg.hand, (sg.hand === 'left' ? L : R)?.vec]];
      for (const [h, vec] of tries) {
        if (!vec) continue;
        const ratio = distance(vec, sg.vec, sg.w) / sg.thresh;
        if (!best || ratio < best.ratio) best = { sg, hand: h, ratio };
      }
    }
    this.debug = best;
    const hit = best && best.ratio < 1 ? best : null;
    if (!hit) {
      this.hold = 0; this.key = null;
      this.free += dt;
      if (this.free >= this.releaseTime) this.armed = true;
      return;
    }
    this.free = 0;
    const key = hit.sg.id + '|' + hit.hand;
    if (key !== this.key) { this.key = key; this.hold = 0; }
    this.hold += dt;
    if (this.hold >= this.holdTime && this.armed && !(this.cool[hit.sg.id] > 0)) {
      this.armed = false;
      this.cool[hit.sg.id] = hit.sg.cooldown ?? this.cooldown;
      const castHand = hit.hand === 'left' ? L : R;
      this.onCast(hit.sg, castHand, hit.hand);
    }
  }
}
