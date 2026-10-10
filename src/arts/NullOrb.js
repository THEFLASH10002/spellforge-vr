import * as THREE from 'three';
import { createOrb, PAL_PURPLE } from '../vfx/Singularity.js';
import { fx, Trail } from '../vfx/Effects.js';
import { terrainHeight } from '../world/Terrain.js';
import { ScarTrail } from '../vfx/ScarTrail.js';

// Nullpoint: hold Blue in one hand and Red in the other, bring them together and they merge into a purple
// orb that keeps charging. Throw it with both hands. It ignores all collisions and erases everything in a
// tube around its path: buildings get a hole (their pre-fractured chunks inside the tube are vaporized),
// enemies / debris / trees / props are removed, grass is cut, and the ground (which can't be cut) is
// marked with a glowing purple outline. Tunable at runtime via window.spellforge.NULL.
export const NULL = {
  mergeDist: 0.3,        // m between the two orbs to merge
  mergeMinCharge: 0.35,  // both orbs must be at least this charged
  mergeHold: 0.2,        // s the orbs must stay together
  chargeTime: 2.0,       // s to full charge (a merged orb starts at the higher of the two charges)
  hover: 0.3,            // m above the fingertips' midpoint (the orb is twice Blue/Red's size)
  smooth: 25,
  minHold: 0.4,          // s before a throw registers
  throwMinSpeed: 1.6, throwDot: 0.55, armExtend: 0.5, armSpeed: 0.9,
  maxHold: 10,
  speed: 10,             // m/s (slow and heavy)
  lifetime: 5,           // s (about 50 m of travel)
  tube: 1.2,             // m radius of the erase tube at no charge
  tubeCharge: 0.6,       // extra radius at full charge
  size: 2,               // orb size relative to Blue/Red (visual)
  scarEvery: 0.7,        // m between ground-outline cross-sections
  cooldown: 1.5,
};

const smooth = x => x * x * (3 - 2 * x);
const clamp01 = x => Math.min(1, Math.max(0, x));
const UP = new THREE.Vector3(0, 1, 0);
const _ab = new THREE.Vector3(), _ap = new THREE.Vector3();
// Distance from point p to segment a-b.
export function segDist(p, a, b) {
  _ab.copy(b).sub(a);
  const l2 = _ab.lengthSq();
  const t = l2 > 1e-9 ? clamp01(_ap.copy(p).sub(a).dot(_ab) / l2) : 0;
  return _ap.copy(a).addScaledVector(_ab, t).distanceTo(p);
}

export class NullOrb {
  constructor({ scene, physics, env, targets, assets, grass, well, red }) {
    Object.assign(this, { scene, physics, env, targets, assets, grass, well, red });
    this.orb = createOrb(PAL_PURPLE);
    this.orb.group.visible = false;
    scene.add(this.orb.group);
    this.scar = new ScarTrail(scene);
    // Read by WellMood (scene dims toward purple while it exists).
    this.v = { id: 'nullpoint', mood: { light: 0x9a3cff, tint: 0x8a3cff, deep: 0x0c0418, sky: 0x2a0c5a, petal: 0xc070ff, glow: 0x8a2cff } };
    this.moodTarget = 0; this.moodPos = new THREE.Vector3();
    this.state = 'idle'; this.status = 'ready'; this.clock = 0; this.cool = 0; this.mergeT = 0;
    this.pos = new THREE.Vector3(); this.prev = new THREE.Vector3(); this.dir = new THREE.Vector3(0, 0, -1); this.headFwd = new THREE.Vector3(0, 0, -1);
    this.hist = []; this.fast = 0; this.lost = 0; this.pulse = 0; this.charge = 0; this.t = 0; this.first = true;
    this.cutI = 0; this.cutAcc = 0; this.scarAcc = 0; this.trail = null; this.wantBegin = false;
    this.tmp = new THREE.Vector3(); this.mid = new THREE.Vector3(); this.wristM = new THREE.Vector3();
  }

  get active() { return this.state === 'charging'; } // both hands are busy holding it

  // Fallback (panel button): form the orb between the hands without the Blue+Red merge.
  begin() { if (this.state === 'idle' && this.cool <= 0) this.wantBegin = true; }
  launchNow() { if (this.state === 'charging') this.launch(this.headFwd.clone()); }
  // Test hook: put the orb at pos and throw it along dir.
  forceLaunch(pos, dir, charge = 1) {
    this.pos.copy(pos); this.charge = charge; this.state = 'charging'; this.orb.group.visible = true; this.launch(dir.clone().normalize());
  }

  update(dt, head, headQ, L, R) {
    this.clock += dt;
    if (this.cool > 0) this.cool -= dt;
    this.headFwd.set(0, 0, -1).applyQuaternion(headQ);
    if (this.state === 'idle') this.idle(dt, L, R);
    else if (this.state === 'charging') this.charging(dt, head, L, R);
    else if (this.state === 'flying') this.flying(dt, head);
    this.scar.update(dt, this.clock, this.state === 'flying');
    if (this.state !== 'flying' && this.state !== 'charging') { this.moodTarget = 0; this.env.setWell(null, 0, this.v.id); }
  }

  // ---- merge ---------------------------------------------------------------------------------------
  idle(dt, L, R) {
    this.status = this.cool > 0 ? 'cooling' : 'ready';
    const w = this.well, r = this.red;
    if (this.cool <= 0 && w.state === 'charging' && r.state === 'charging' && w.charge >= NULL.mergeMinCharge && r.charge >= NULL.mergeMinCharge
      && w.pos.distanceTo(r.pos) < NULL.mergeDist) {
      if ((this.mergeT += dt) >= NULL.mergeHold) { this.merge(); return; }
    } else this.mergeT = 0;
    if (this.wantBegin) {
      this.wantBegin = false;
      const a = L?.tip || R?.tip, b = R?.tip || L?.tip;
      const mid = a && b ? this.mid.copy(a).add(b).multiplyScalar(0.5) : this.mid.copy(this.headFwd).multiplyScalar(0.5).add(new THREE.Vector3(0, 1.3, 0));
      this.startCharging(mid.clone(), 0.5);
    }
  }

  merge() {
    const w = this.well, r = this.red, mid = w.pos.clone().add(r.pos).multiplyScalar(0.5), c0 = Math.max(w.charge, r.charge);
    w.absorb(); r.absorb();
    fx.shock(mid, UP, 0xb050ff, 3, 1.0);
    fx.burst(mid, 0xe0a0ff, 60, 5);
    this.startCharging(mid, c0);
  }

  startCharging(pos, c0) {
    this.state = 'charging'; this.pos.copy(pos); this.first = true; this.charge = c0; this.t = c0 * NULL.chargeTime; this.tStart = this.clock;
    this.hist = []; this.fast = 0; this.lost = 0; this.pulse = 0; this.mergeT = 0;
    this.orb.group.visible = true;
  }

  // ---- charging (held between both hands) ---------------------------------------------------------------
  charging(dt, head, L, R) {
    const hands = [L, R].filter(Boolean);
    if (hands.length) {
      this.lost = 0;
      this.mid.set(0, 0, 0); this.wristM.set(0, 0, 0);
      for (const h of hands) { this.mid.add(h.tip); this.wristM.add(h.wrist); }
      this.mid.divideScalar(hands.length); this.wristM.divideScalar(hands.length);
      const target = this.tmp.copy(this.mid).addScaledVector(UP, NULL.hover);
      if (this.first) { this.pos.copy(target); this.first = false; } else this.pos.lerp(target, 1 - Math.exp(-NULL.smooth * dt));
      this.hist.push({ t: this.clock, p: this.wristM.clone() });
      while (this.hist.length > 2 && this.clock - this.hist[0].t > 0.35) this.hist.shift();
    } else if ((this.lost += dt) > 0.8) { this.finish(false); return; }

    this.t += dt;
    const c = (this.charge = clamp01(this.t / NULL.chargeTime)), radius = NULL.size * (0.04 + 0.05 * smooth(c));
    this.orb.group.position.copy(this.pos);
    this.orb.update(this.clock, dt, c, radius);
    this.orb.setHorizon(radius * 1.45, 1, 2 + 2 * c);
    this.status = `charging ${Math.round(c * 100)}%`;
    this.moodTarget = 0.25 + 0.65 * c; this.moodPos.copy(this.pos);
    this.env.setWell(this.pos, 0.4 + 0.4 * c, this.v.id);
    if ((this.pulse -= dt) <= 0 && c > 0.4) { fx.shock(this.pos, UP, 0xb050ff, 1 + c, 0.7); this.pulse = 0.8 - 0.4 * c; }
    if (hands.length && this.clock - this.tStart > NULL.minHold) this.detectThrow(head);
    if (this.t > NULL.maxHold) this.launch(this.headFwd.clone());
  }

  detectThrow(head) {
    const h = this.hist, last = h[h.length - 1];
    let first = last;
    for (let i = h.length - 1; i >= 0; i--) { first = h[i]; if (last.t - h[i].t >= 0.14) break; }
    const span = last.t - first.t;
    if (span < 0.06) return;
    const v = this.tmp.copy(last.p).sub(first.p).divideScalar(span), speed = v.length();
    const dot = speed > 1e-3 ? v.dot(this.headFwd) / speed : 0;
    const ext = this.wristM.clone().sub(head).dot(this.headFwd);
    const throwing = (speed >= NULL.throwMinSpeed && dot >= NULL.throwDot) || (ext >= NULL.armExtend && v.dot(this.headFwd) >= NULL.armSpeed);
    this.fast = throwing ? this.fast + 1 : 0;
    if (this.fast >= 2) this.launch(v.clone().normalize().multiplyScalar(0.75).addScaledVector(this.headFwd, 0.25).normalize());
  }

  launch(dir) {
    this.state = 'flying'; this.dir.copy(dir); this.life = NULL.lifetime; this.cool = NULL.cooldown; this.hist = []; this.fast = 0;
    this.prev.copy(this.pos); this.cutAcc = 0; this.scarAcc = 0;
    this.trail = new Trail(this.scene, 0xb050ff, 28);
    fx.burst(this.pos, 0xe0a0ff, 40, 4);
    fx.shock(this.pos, dir, 0xb050ff, 2, 0.8);
  }

  // ---- flight: nothing stops it ------------------------------------------------------------------------
  flying(dt, head) {
    const c = this.charge, R = NULL.tube + NULL.tubeCharge * c, step = NULL.speed * dt;
    this.prev.copy(this.pos);
    this.pos.addScaledVector(this.dir, step);
    this.sweep(this.prev, this.pos, R);

    const radius = NULL.size * (0.12 + 0.02 * c);
    this.orb.group.position.copy(this.pos);
    this.orb.update(this.clock, dt, 1, radius);
    this.orb.setHorizon(radius * 1.6, 1, 4);
    this.trail.push(this.pos); this.trail.update(head, 0.1 + 0.05 * c);
    fx.burst(this.pos, 0xc070ff, 2, 1);

    const gy = terrainHeight(this.pos.x, this.pos.z);
    const above = this.pos.y - gy;
    if (above >= 0 && above < 3 + R) { // above the land and near it: mark where it passed (nothing if it is underground)
      this.scarAcc += step; this.cutAcc += step;
      if (this.scarAcc >= NULL.scarEvery) { this.scar.add(this.pos.x, this.pos.z, this.dir.x, this.dir.z, R * 2); this.scarAcc = 0; }
      if (this.cutAcc >= R * 1.6) { this.grass.setCut(this.cutI++ % 32, this.pos.x, this.pos.z, R * 1.1); this.cutAcc = 0; }
    }
    this.status = 'flying'; this.moodTarget = 1; this.moodPos.copy(this.pos);
    this.env.setWell(this.pos, 0.7, this.v.id);
    if ((this.life -= dt) <= 0 || this.pos.length() > 80) this.finish(true);
  }

  // Erase everything the tube a->b (radius R) touches.
  sweep(a, b, R) {
    for (const t of this.targets) {
      if (t.erase) { if (!t.broken && segDist(t.center, a, b) < R + 0.7) t.erase(); continue; } // puppet
      if (t.broken) continue;
      if (!t.bs) { const box = new THREE.Box3().setFromObject(t.mesh); t.bs = { c: box.getCenter(new THREE.Vector3()), r: box.getSize(new THREE.Vector3()).length() / 2 }; }
      if (segDist(t.bs.c, a, b) <= R + t.bs.r) t.carve(a, b, R, segDist); // building piece: hole
    }
    const syn = this.physics.synced;
    for (let i = syn.length - 1; i >= 0; i--) { // loose debris, ragdoll parts
      const e = syn[i];
      if (e.projectile) continue;
      const p = e.body.translation();
      this.tmp.set(p.x, p.y, p.z);
      if (segDist(this.tmp, a, b) < R + 0.3) { fx.burst(this.tmp, 0xc070ff, 3, 2); this.physics.remove(e.mesh); }
    }
    for (const en of this.assets.registry) { // instanced scenery (trees, props, village homes)
      en.gone ||= new Uint8Array(en.points.length);
      en.orig ||= Float32Array.from(en.im.instanceMatrix.array);
      const arr = en.im.instanceMatrix.array;
      for (let i = 0; i < en.points.length; i++) {
        if (en.gone[i]) continue;
        const [x, z, , s = 1, y = 0] = en.points[i];
        this.tmp.set(x, y + en.h * s * 0.5, z);
        if (segDist(this.tmp, a, b) < R + en.r * s) {
          en.gone[i] = 1; arr.fill(0, i * 16, i * 16 + 16); en.im.instanceMatrix.needsUpdate = true;
          fx.burst(this.tmp, 0xc070ff, 10, 3);
        }
      }
    }
  }

  finish(flash) {
    if (flash) { fx.burst(this.pos, 0xe0a0ff, 60, 6); fx.shock(this.pos, UP, 0xb050ff, 5, 1.2); }
    this.state = 'idle'; this.orb.group.visible = false; this.orb.setHorizon(0); this.trail?.dispose(); this.trail = null;
    this.moodTarget = 0; this.env.setWell(null, 0, this.v.id); this.status = 'ready'; this.cool = Math.max(this.cool, 0.5);
  }

  reset() {
    this.state = 'idle'; this.orb.group.visible = false; this.orb.setHorizon(0); this.trail?.dispose(); this.trail = null;
    this.cool = 0; this.moodTarget = 0; this.status = 'ready'; this.wantBegin = false;
    this.scar.reset(); this.grass.clearCuts(); this.cutI = 0;
    for (const en of this.assets.registry) { // restore erased scenery
      if (!en.orig) continue;
      en.im.instanceMatrix.array.set(en.orig); en.im.instanceMatrix.needsUpdate = true; en.gone.fill(0);
    }
  }
}
