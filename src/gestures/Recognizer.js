import { distance, twoHandVec } from './PoseFeatures.js';
import { recipeFor } from '../progress/Unlocks.js';

const COMBO_HOLD = 1.2; // s: hold two base signs (one per hand) this long to combine them

// Matches live hands against Sigils. A Sigil fires after being held `holdTime` seconds, then must be released
// (no match for `releaseTime`) before it can re-fire.
//  * isLocked(sg): Sigils whose spell is not unlocked yet are ignored.
//  * Two-hand matches beat the single-hand matches they contain (so a saved two-hand sign casts as ONE spell).
//  * Combination: two built-in signs held at once, one per hand, that form a still-locked recipe (canCombine) are treated as a
//    deliberate combination: neither spell casts, and after COMBO_HOLD seconds onCombine(recipe, L, R, twoHandVec) fires.
export class Recognizer {
  constructor({ holdTime = 0.4, releaseTime = 0.3, cooldown = 1.0 } = {}) {
    Object.assign(this, { holdTime, releaseTime, cooldown });
    this.sigils = [];
    this.onCast = () => {};
    this.onCombine = () => {};
    this.isLocked = () => false;
    this.canCombine = () => false;
    this.hold = 0; this.key = null; this.armed = true; this.free = 0;
    this.cool = {};
    this.debug = null;
    this.active = null; // { sg, hand } while a Sigil is matched and held past its hold time (for channelled Arts)
    this.combo = null;  // { rec, pct } while two signs are being combined (for on-screen feedback)
  }

  update(dt, L, R, headInv) {
    this.active = null; this.combo = null;
    for (const k in this.cool) this.cool[k] = Math.max(0, this.cool[k] - dt);
    const two = L && R ? twoHandVec(L, R, headInv) : null;
    let bestOne = null, bestTwo = null;
    const single = { left: null, right: null };
    for (const sg of this.sigils) {
      if (this.isLocked(sg)) continue;
      if (sg.hand === 'two') {
        if (!two) continue;
        const ratio = distance(two, sg.vec, sg.w) / sg.thresh;
        if (!bestTwo || ratio < bestTwo.ratio) bestTwo = { sg, hand: 'two', ratio };
        continue;
      }
      const tries = sg.hand === 'any' ? [['left', L?.vec], ['right', R?.vec]] : [[sg.hand, (sg.hand === 'left' ? L : R)?.vec]];
      for (const [h, vec] of tries) {
        if (!vec) continue;
        const mean = (vec[1] + vec[2] + vec[3] + vec[4]) / 4; // average straightness of index..pinky
        if ((sg.minCurl && mean < sg.minCurl) || (sg.maxCurl && mean > sg.maxCurl)) continue; // hard gate, independent of palm direction
        const cand = { sg, hand: h, ratio: distance(vec, sg.vec, sg.w) / sg.thresh };
        if (!bestOne || cand.ratio < bestOne.ratio) bestOne = cand;
        if (!single[h] || cand.ratio < single[h].ratio) single[h] = cand;
      }
    }

    // Two built-in signs forming a still-locked recipe => a combination attempt (takes priority, suppresses both spells).
    let best = null;
    if (single.left && single.right && single.left.ratio < 1 && single.right.ratio < 1 && single.left.sg.builtin && single.right.sg.builtin) {
      const rec = recipeFor(single.left.sg.artId, single.right.sg.artId);
      if (rec && this.canCombine(rec)) best = { sg: { id: 'combo:' + rec.result, builtin: true, artId: rec.result, hold: COMBO_HOLD, cooldown: 2 }, hand: 'two', ratio: 0, rec };
    }
    if (!best) best = bestTwo && bestTwo.ratio < 1 ? bestTwo : bestOne;
    this.debug = bestTwo && (!bestOne || bestTwo.ratio < bestOne.ratio) ? bestTwo : bestOne;

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
    const need = hit.sg.hold ?? this.holdTime;
    if (hit.rec) this.combo = { rec: hit.rec, pct: Math.min(1, this.hold / need) };
    else if (this.hold >= need) this.active = { sg: hit.sg, hand: hit.hand };
    if (this.hold >= need && this.armed && !(this.cool[hit.sg.id] > 0)) {
      this.armed = false;
      this.cool[hit.sg.id] = hit.sg.cooldown ?? this.cooldown;
      if (hit.rec) this.onCombine(hit.rec, L, R, two);
      else this.onCast(hit.sg, hit.hand === 'left' ? L : R, hit.hand);
    }
  }
}
