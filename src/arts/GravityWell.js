import * as THREE from 'three';
import { createOrb, PAL_BLUE, PAL_RED } from '../vfx/Singularity.js';
import { fx, Trail } from '../vfx/Effects.js';
import { terrainHeight } from '../world/Terrain.js';

// Gravity Well: hold a small singularity above the palm, charge it, throw it. It pulls everything toward
// its center (never pushes). Tunable at runtime via window.spellforge.WELL.
export const WELL = {
  chargeTime: 3,         // s to full charge
  maxMult: 2,            // charge multiplier at full charge
  hover: 0.18,           // m above the fingertip (world up)
  smooth: 25,            // hand-follow smoothing (higher = tighter)
  minHold: 0.5,          // s before a throw can register (stops the activation motion launching it)
  throwMinSpeed: 1.8,    // m/s hand speed to count as a throw
  throwDot: 0.55,        // min cos(angle) between hand motion and where the head faces
  armExtend: 0.5,        // fallback: wrist this far ahead of the head (m) ...
  armSpeed: 0.9,         // ... while moving forward at this speed (m/s)
  maxHold: 10,           // s: auto-launch if still held
  cooldown: 1.0,         // s after a launch before the next one
  speed: 14,             // m/s projectile speed
  lifetime: 4,           // s of flight before collapsing mid-air
  radius: 5,             // m attraction radius
  strongRadius: 2,       // m inner radius with extra pull
  singularity: 2.5,      // s the field stays active after impact
  force: 26,             // pull strength (m/s^2 scale)
  accCap: 45,            // hard cap on acceleration (stability)
  destroyBase: 2.0,      // m: structure pieces within this of the impact shatter...
  destroyPerCharge: 2.0, // ...plus this much at full charge
  maxDebris: 200,        // cap on active debris bodies
};

// Red = the repelling counterpart: same hold / charge / throw, but the field pushes outward and the impact is a blast.
export const RED = { ...WELL, force: 22, singularity: 1.4, destroyBase: 2.4, destroyPerCharge: 2.4, blastRadius: 6, blast: 13 };

export const BLUE_VARIANT = {
  id: 'well', sign: 1, cfg: WELL, pal: PAL_BLUE, color: 0x5ac8ff, light: 0x9fe0ff,
  mood: { light: 0x3a8cff, tint: 0x2f6cff, deep: 0x081230, sky: 0x14307a, petal: 0x5aa0ff, glow: 0x1466ff },
};
export const RED_VARIANT = {
  id: 'repulsor', sign: -1, cfg: RED, pal: PAL_RED, color: 0xff4a2a, light: 0xffc090,
  mood: { light: 0xff3a1a, tint: 0xff4a28, deep: 0x1a0408, sky: 0x4a0c14, petal: 0xff7a60, glow: 0xff3a14 },
};

const smooth = x => x * x * (3 - 2 * x);
const clamp01 = x => Math.min(1, Math.max(0, x));
const UP = new THREE.Vector3(0, 1, 0);

export class GravityWell {
  constructor({ scene, physics, env, targets, variant = BLUE_VARIANT }) {
    Object.assign(this, { scene, physics, env, targets });
    this.v = variant; this.cfg = variant.cfg; this.other = null; // other: the sibling spell (so both can't claim one hand)
    this.orb = createOrb(variant.pal);
    this.orb.group.visible = false;
    scene.add(this.orb.group);
    this.state = 'idle'; this.which = 'right'; this.t = 0; this.clock = 0; this.cool = 0;
    this.pos = new THREE.Vector3(); this.dir = new THREE.Vector3(0, 0, -1); this.headFwd = new THREE.Vector3(0, 0, -1);
    this.hist = []; this.fast = 0; this.lost = 0; this.pulse = 0; this.charge = 0; this.mult = 1;
    this.trail = null; this.status = 'ready'; this.first = true;
    this.moodTarget = 0; this.moodPos = this.pos; // read by WellMood: how dark/blue the scene should be, and where the light sits
    this.tmp = new THREE.Vector3(); this.box = new THREE.Box3();
  }

  get active() { return this.state === 'charging'; } // main pauses the gesture recognizer while charging

  begin(which) {
    if (this.state !== 'idle' || this.cool > 0) return;
    const hand = which === 'left' ? 'left' : 'right';
    if (this.other?.active && this.other.which === hand) return; // that hand is already holding the other orb
    this.which = hand; // two-hand custom Sigils charge the right hand
    this.state = 'charging'; this.t = 0; this.hist = []; this.fast = 0; this.lost = 0; this.first = true; this.pulse = 0;
    this.orb.group.visible = true;
  }

  launchNow() { if (this.state === 'charging') this.launch(this.headFwd.clone()); }

  update(dt, head, headQ, L, R) {
    this.clock += dt;
    if (this.cool > 0) this.cool -= dt;
    this.headFwd.set(0, 0, -1).applyQuaternion(headQ);
    if (this.state === 'charging') this.charging(dt, head, L, R);
    else if (this.state === 'flying') this.flying(dt, head);
    else if (this.state === 'singularity') this.singularity(dt);
    else { this.status = this.cool > 0 ? 'cooling' : 'ready'; this.env.setWell(null, (0) * this.v.sign, this.v.id); }
  }

  // ---- charging ----------------------------------------------------------------------------------
  charging(dt, head, L, R) {
    const hand = this.which === 'left' ? L : R;
    if (hand) {
      this.lost = 0;
      // Above the fingertip in world-up (the palm normal points sideways in the pointer pose).
      const target = this.tmp.copy(hand.tip).addScaledVector(UP, this.cfg.hover);
      if (this.first) { this.pos.copy(target); this.first = false; } else this.pos.lerp(target, 1 - Math.exp(-this.cfg.smooth * dt));
      this.hist.push({ t: this.clock, p: hand.wrist.clone() });
      while (this.hist.length > 2 && this.clock - this.hist[0].t > 0.35) this.hist.shift();
    } else if ((this.lost += dt) > 0.8) { this.collapse(false); return; }

    this.t += dt;
    const c = (this.charge = clamp01(this.t / this.cfg.chargeTime));
    this.mult = 1 + (this.cfg.maxMult - 1) * c;
    const radius = 0.02 + 0.07 * smooth(c);
    this.orb.group.position.copy(this.pos);
    this.orb.update(this.clock, dt, c, radius);
    this.status = `charging ${Math.round(c * 100)}%`;
    this.moodTarget = 0.15 + 0.6 * c; // the world darkens and turns blue as it charges

    if ((this.pulse -= dt) <= 0 && c > 0.4) { fx.shock(this.pos, UP, this.v.color, 0.8 + c); this.pulse = 0.9 - 0.5 * c; }
    // Light objects near the hand lean toward the forming orb; petals start to stream in.
    this.field(this.pos, 1.5 + 1.5 * c, 0.6, this.cfg.force * 0.25 * c, dt);
    this.env.setWell(this.pos, (0.25 + 0.35 * c) * this.v.sign, this.v.id);

    if (hand && this.t > this.cfg.minHold) this.detectThrow(hand, head);
    if (this.t > this.cfg.maxHold) this.launch(this.headFwd.clone());
  }

  // Smoothed hand velocity over ~0.14 s; deliberate forward motion (or a forward arm push) throws.
  detectThrow(hand, head) {
    const h = this.hist, last = h[h.length - 1];
    let first = last;
    for (let i = h.length - 1; i >= 0; i--) { first = h[i]; if (last.t - h[i].t >= 0.14) break; }
    const span = last.t - first.t;
    if (span < 0.06) return;
    const v = this.tmp.copy(last.p).sub(first.p).divideScalar(span), speed = v.length();
    const dot = speed > 1e-3 ? v.dot(this.headFwd) / speed : 0;
    const ext = hand.wrist.clone().sub(head).dot(this.headFwd);
    const throwing = (speed >= this.cfg.throwMinSpeed && dot >= this.cfg.throwDot) || (ext >= this.cfg.armExtend && v.dot(this.headFwd) >= this.cfg.armSpeed);
    this.fast = throwing ? this.fast + 1 : 0;
    if (this.fast >= 2) { // debounce: two consecutive frames
      const d = v.clone().normalize().multiplyScalar(0.75).addScaledVector(this.headFwd, 0.25).normalize(); // blend toward gaze to help aim
      this.launch(d);
    }
  }

  launch(dir) {
    this.state = 'flying'; this.dir.copy(dir); this.life = this.cfg.lifetime; this.cool = this.cfg.cooldown; this.hist = []; this.fast = 0;
    this.trail = new Trail(this.scene, this.v.color, 20);
    fx.burst(this.pos, this.v.light, 30, 3);
    fx.shock(this.pos, dir, this.v.color, 1.5);
  }

  // ---- flight --------------------------------------------------------------------------------------
  flying(dt, head) {
    const c = this.charge, radius = 0.07 + 0.05 * c, step = this.cfg.speed * dt, R = this.physics.R;
    const ray = new R.Ray({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, { x: this.dir.x, y: this.dir.y, z: this.dir.z });
    const hit = this.physics.world.castRay(ray, step + radius, true, R.QueryFilterFlags.EXCLUDE_DYNAMIC);
    if (hit) {
      const toi = hit.timeOfImpact ?? hit.toi ?? 0;
      this.pos.addScaledVector(this.dir, Math.max(0, toi - radius * 0.5));
      this.orb.group.position.copy(this.pos);
      this.impact();
      return;
    }
    this.pos.addScaledVector(this.dir, step);
    this.orb.group.position.copy(this.pos);
    this.orb.update(this.clock, dt, Math.max(c, 0.5), radius);
    this.trail.push(this.pos);
    this.trail.update(head, 0.05 + 0.05 * c);
    fx.burst(this.pos, this.v.light, 2, 0.8);
    this.field(this.pos, this.cfg.radius * 0.7, this.cfg.strongRadius * 0.6, this.cfg.force * 0.5 * this.mult, dt); // pulls debris/ragdolls along the way
    this.env.setWell(this.pos, (0.6) * this.v.sign, this.v.id);
    this.status = 'flying';
    this.moodTarget = 0.85;
    if ((this.life -= dt) <= 0) this.impact();
  }

  // ---- impact / singularity -----------------------------------------------------------------------
  impact() {
    this.state = 'singularity'; this.sT = 0; this.second = false;
    this.singT = this.cfg.singularity * (0.8 + 0.2 * this.mult);
    this.trail?.dispose(); this.trail = null;
    fx.shock(this.pos, UP, this.v.color, 4 + 2 * this.charge);
    fx.burst(this.pos, this.v.light, 40, 5);
    if (this.v.sign < 0) this.blast();
    this.destroyNear(this.cfg.destroyBase + this.cfg.destroyPerCharge * this.charge);
  }

  // Shatter pieces within `r` of the anchor (distance to the piece's bounds, so large walls count).
  destroyNear(r) {
    for (const t of this.targets) {
      if (t.broken) continue;
      let d;
      if (t.center) d = t.center.distanceTo(this.pos);
      else { t.bounds ||= new THREE.Box3().setFromObject(t.mesh); d = t.bounds.distanceToPoint(this.pos); }
      if (d >= r) continue;
      if (this.v.sign > 0) t.shatter(this.pos, UP, 6, true); // pull = fragments / ragdoll parts head for the singularity
      else { // repel: everything is thrown away from the orb
        const c = t.center || t.mesh.position;
        t.shatter(this.pos, this.tmp.copy(c).sub(this.pos).setY(0.4).normalize().clone(), 12 + 6 * this.charge, false);
      }
    }
  }

  singularity(dt) {
    this.sT += dt;
    const c = this.charge, k = this.sT / this.singT;
    const intens = this.v.sign > 0 ? 1 + 1.2 * smooth(clamp01(this.sT / 0.4)) : 1.4 * (1 - k); // pull builds; push is a decaying shove
    const radius = this.cfg.radius * (0.7 + 0.3 * this.mult);
    this.field(this.pos, radius, this.cfg.strongRadius * (0.8 + 0.2 * this.mult), this.cfg.force * this.mult * intens, dt);
    this.env.setWell(this.pos, (1) * this.v.sign, this.v.id);
    if (!this.second && this.v.sign > 0 && this.sT > 0.9) { this.second = true; this.destroyNear((this.cfg.destroyBase + this.cfg.destroyPerCharge * c) * 1.5); }

    // Enemies still standing struggle toward the orb; the ones dragged into the strong radius ragdoll.
    for (const t of this.targets) {
      if (this.v.sign < 0 || t.broken || !t.struggle) continue;
      const d = t.center.distanceTo(this.pos);
      if (d < radius * 1.3) {
        t.struggle(this.tmp.copy(this.pos).sub(t.center).setY(0).normalize(), clamp01(1 - d / (radius * 1.3)));
        if (d < this.cfg.strongRadius * 0.9) t.shatter(this.pos, UP, 5, true);
      }
    }

    // Visual: swell, hold, then collapse into a flash.
    const grow = 0.12 + 0.05 * c + 0.015 * Math.sin(this.clock * 9);
    const collapse = k > 0.85 ? 1 - smooth((k - 0.85) / 0.15) : 1;
    const dustY = Math.max(0.1, this.pos.y - terrainHeight(this.pos.x, this.pos.z));
    this.orb.update(this.clock, dt, 1, grow * collapse, 1, dustY);
    this.status = `collapsing ${Math.max(0, this.singT - this.sT).toFixed(1)}s`;
    this.moodTarget = 1.0;
    if (this.sT >= this.singT) this.collapse(true);
  }

  collapse(flash) {
    if (flash) {
      fx.burst(this.pos, this.v.light, 80, 7);
      fx.shock(this.pos, UP, this.v.color, 6);
      this.env.onSpell(this.pos, 'cast'); // petals puff outward with the final flash
      if (this.v.sign > 0) for (const e of this.physics.synced) { // brief outward release as it winks out
        if (e.projectile) continue;
        const t = e.body.translation(), dx = t.x - this.pos.x, dy = t.y - this.pos.y, dz = t.z - this.pos.z, d = Math.hypot(dx, dy, dz) + 1e-3;
        if (d < 4) { const k = (1 - d / 4) * e.body.mass() * 2.5 / d; e.body.applyImpulse({ x: dx * k, y: dy * k + 0.5 * k * d, z: dz * k }, true); }
      }
    } else fx.burst(this.pos, this.v.light, 20, 2);
    this.state = 'idle'; this.orb.group.visible = false; this.trail?.dispose(); this.trail = null; this.env.setWell(null, (0) * this.v.sign, this.v.id);
    this.status = 'ready'; this.cool = Math.max(this.cool, 0.3);
    this.moodTarget = 0; // WellMood eases the light back slowly (~2.5 s) after the blue is gone
  }

  reset() {
    this.state = 'idle'; this.orb.group.visible = false; this.trail?.dispose(); this.trail = null;
    this.cool = 0; this.env.setWell(null, (0) * this.v.sign, this.v.id); this.status = 'ready'; this.moodTarget = 0;
  }

  // Repel impact: an immediate outward shove on everything nearby (velocity change independent of mass, falling off with distance).
  blast() {
    const r = this.cfg.blastRadius, sp = this.cfg.blast * (0.6 + 0.4 * this.mult);
    for (const e of this.physics.synced) {
      if (e.projectile) continue;
      const t = e.body.translation(), dx = t.x - this.pos.x, dy = t.y - this.pos.y, dz = t.z - this.pos.z, d = Math.hypot(dx, dy, dz) + 1e-3;
      if (d > r) continue;
      const f = 1 - d / r, m = e.body.mass(), k = (m * sp * f) / d;
      e.body.applyImpulse({ x: dx * k, y: dy * k + m * sp * f * 0.35, z: dz * k }, true);
    }
  }

  // ---- the force field -------------------------------------------------------------------------------
  // Pulls every dynamic body toward `c`. Light bodies accelerate more; closer = stronger; acceleration is capped.
  field(c, radius, strong, strength, dt) {
    const r2 = radius * radius;
    for (const e of this.physics.synced) {
      if (e.projectile) continue;
      const b = e.body, p = b.translation();
      const dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) + 1e-4;
      let f = 1 - d / radius; f *= f;
      if (d < strong) f *= 2.2;
      const m = Math.max(b.mass(), 0.05);
      const acc = Math.min(strength * f / (0.4 + m * 0.5), this.cfg.accCap), k = (this.v.sign * m * acc * dt) / d;
      b.applyImpulse({ x: dx * k + dz * k * 0.3, y: dy * k, z: dz * k - dx * k * 0.3 }, true); // pull + a little swirl
      if (this.v.sign > 0 && d < 0.7) { const v = b.linvel(); b.setLinvel({ x: v.x * 0.92, y: v.y * 0.92, z: v.z * 0.92 }, true); } // settle near the core
    }
  }
}
