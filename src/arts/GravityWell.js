import * as THREE from 'three';
import { createOrb } from '../vfx/Singularity.js';
import { fx, Trail } from '../vfx/Effects.js';
import { terrainHeight } from '../world/Terrain.js';

// Gravity Well: hold a small singularity above the palm, charge it, throw it. It pulls everything toward
// its center (never pushes). Tunable at runtime via window.spellforge.WELL.
export const WELL = {
  chargeTime: 3,         // s to full charge
  maxMult: 2,            // charge multiplier at full charge
  hover: 0.2,            // m above the palm
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

const smooth = x => x * x * (3 - 2 * x);
const clamp01 = x => Math.min(1, Math.max(0, x));
const UP = new THREE.Vector3(0, 1, 0);

export class GravityWell {
  constructor({ scene, physics, env, targets }) {
    Object.assign(this, { scene, physics, env, targets });
    this.orb = createOrb();
    this.orb.group.visible = false;
    scene.add(this.orb.group);
    this.state = 'idle'; this.which = 'right'; this.t = 0; this.clock = 0; this.cool = 0;
    this.pos = new THREE.Vector3(); this.dir = new THREE.Vector3(0, 0, -1); this.headFwd = new THREE.Vector3(0, 0, -1);
    this.hist = []; this.fast = 0; this.lost = 0; this.pulse = 0; this.charge = 0; this.mult = 1;
    this.trail = null; this.status = 'ready'; this.first = true;
    this.tmp = new THREE.Vector3(); this.box = new THREE.Box3();
  }

  get active() { return this.state === 'charging'; } // main pauses the gesture recognizer while charging

  begin(which) {
    if (this.state !== 'idle' || this.cool > 0) return;
    this.which = which === 'left' ? 'left' : 'right'; // two-hand custom Sigils charge the right hand
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
    else { this.status = this.cool > 0 ? 'cooling' : 'ready'; this.env.setWell(null, 0); }
  }

  // ---- charging ----------------------------------------------------------------------------------
  charging(dt, head, L, R) {
    const hand = this.which === 'left' ? L : R;
    if (hand) {
      this.lost = 0;
      const target = this.tmp.copy(hand.wrist).addScaledVector(hand.fwd, 0.06).addScaledVector(hand.normal, WELL.hover);
      if (this.first) { this.pos.copy(target); this.first = false; } else this.pos.lerp(target, 1 - Math.exp(-WELL.smooth * dt));
      this.hist.push({ t: this.clock, p: hand.wrist.clone() });
      while (this.hist.length > 2 && this.clock - this.hist[0].t > 0.35) this.hist.shift();
    } else if ((this.lost += dt) > 0.8) { this.collapse(false); return; }

    this.t += dt;
    const c = (this.charge = clamp01(this.t / WELL.chargeTime));
    this.mult = 1 + (WELL.maxMult - 1) * c;
    const radius = 0.02 + 0.07 * smooth(c);
    this.orb.group.position.copy(this.pos);
    this.orb.update(this.clock, dt, c, radius);
    this.status = `charging ${Math.round(c * 100)}%`;

    if ((this.pulse -= dt) <= 0 && c > 0.4) { fx.shock(this.pos, UP, 0x5ac8ff, 0.8 + c); this.pulse = 0.9 - 0.5 * c; }
    // Light objects near the hand lean toward the forming orb; petals start to stream in.
    this.field(this.pos, 1.5 + 1.5 * c, 0.6, WELL.force * 0.25 * c, dt);
    this.env.setWell(this.pos, 0.25 + 0.35 * c);

    if (hand && this.t > WELL.minHold) this.detectThrow(hand, head);
    if (this.t > WELL.maxHold) this.launch(this.headFwd.clone());
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
    const throwing = (speed >= WELL.throwMinSpeed && dot >= WELL.throwDot) || (ext >= WELL.armExtend && v.dot(this.headFwd) >= WELL.armSpeed);
    this.fast = throwing ? this.fast + 1 : 0;
    if (this.fast >= 2) { // debounce: two consecutive frames
      const d = v.clone().normalize().multiplyScalar(0.75).addScaledVector(this.headFwd, 0.25).normalize(); // blend toward gaze to help aim
      this.launch(d);
    }
  }

  launch(dir) {
    this.state = 'flying'; this.dir.copy(dir); this.life = WELL.lifetime; this.cool = WELL.cooldown; this.hist = []; this.fast = 0;
    this.trail = new Trail(this.scene, 0x5ac8ff, 20);
    fx.burst(this.pos, 0x9fe0ff, 30, 3);
    fx.shock(this.pos, dir, 0x5ac8ff, 1.5);
  }

  // ---- flight --------------------------------------------------------------------------------------
  flying(dt, head) {
    const c = this.charge, radius = 0.07 + 0.05 * c, step = WELL.speed * dt, R = this.physics.R;
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
    fx.burst(this.pos, 0x7fd8ff, 2, 0.8);
    this.field(this.pos, WELL.radius * 0.7, WELL.strongRadius * 0.6, WELL.force * 0.5 * this.mult, dt); // pulls debris/ragdolls along the way
    this.env.setWell(this.pos, 0.6);
    this.status = 'flying';
    if ((this.life -= dt) <= 0) this.impact();
  }

  // ---- impact / singularity -----------------------------------------------------------------------
  impact() {
    this.state = 'singularity'; this.sT = 0; this.second = false;
    this.singT = WELL.singularity * (0.8 + 0.2 * this.mult);
    this.trail?.dispose(); this.trail = null;
    fx.shock(this.pos, UP, 0x5ac8ff, 4 + 2 * this.charge);
    fx.burst(this.pos, 0xbfe9ff, 40, 5);
    this.destroyNear(WELL.destroyBase + WELL.destroyPerCharge * this.charge);
  }

  // Shatter pieces within `r` of the anchor (distance to the piece's bounds, so large walls count).
  destroyNear(r) {
    for (const t of this.targets) {
      if (t.broken) continue;
      let d;
      if (t.center) d = t.center.distanceTo(this.pos);
      else { t.bounds ||= new THREE.Box3().setFromObject(t.mesh); d = t.bounds.distanceToPoint(this.pos); }
      if (d < r) t.shatter(this.pos, UP, 6, true); // pull = fragments / ragdoll parts head for the singularity
    }
  }

  singularity(dt) {
    this.sT += dt;
    const c = this.charge, k = this.sT / this.singT;
    const intens = 1 + 1.2 * smooth(clamp01(this.sT / 0.4));
    const radius = WELL.radius * (0.7 + 0.3 * this.mult);
    this.field(this.pos, radius, WELL.strongRadius * (0.8 + 0.2 * this.mult), WELL.force * this.mult * intens, dt);
    this.env.setWell(this.pos, 1);
    if (!this.second && this.sT > 0.9) { this.second = true; this.destroyNear((WELL.destroyBase + WELL.destroyPerCharge * c) * 1.5); }

    // Enemies still standing struggle toward the orb; the ones dragged into the strong radius ragdoll.
    for (const t of this.targets) {
      if (t.broken || !t.struggle) continue;
      const d = t.center.distanceTo(this.pos);
      if (d < radius * 1.3) {
        t.struggle(this.tmp.copy(this.pos).sub(t.center).setY(0).normalize(), clamp01(1 - d / (radius * 1.3)));
        if (d < WELL.strongRadius * 0.9) t.shatter(this.pos, UP, 5, true);
      }
    }

    // Visual: swell, hold, then collapse into a flash.
    const grow = 0.12 + 0.05 * c + 0.015 * Math.sin(this.clock * 9);
    const collapse = k > 0.85 ? 1 - smooth((k - 0.85) / 0.15) : 1;
    const dustY = Math.max(0.1, this.pos.y - terrainHeight(this.pos.x, this.pos.z));
    this.orb.update(this.clock, dt, 1, grow * collapse, 1, dustY);
    this.status = `collapsing ${Math.max(0, this.singT - this.sT).toFixed(1)}s`;
    if (this.sT >= this.singT) this.collapse(true);
  }

  collapse(flash) {
    if (flash) {
      fx.burst(this.pos, 0xbfe9ff, 80, 7);
      fx.shock(this.pos, UP, 0x6ac0ff, 6);
      this.env.onSpell(this.pos, 'cast'); // petals puff outward with the final flash
      for (const e of this.physics.synced) { // brief outward release as it winks out
        if (e.projectile) continue;
        const t = e.body.translation(), dx = t.x - this.pos.x, dy = t.y - this.pos.y, dz = t.z - this.pos.z, d = Math.hypot(dx, dy, dz) + 1e-3;
        if (d < 4) { const k = (1 - d / 4) * e.body.mass() * 2.5 / d; e.body.applyImpulse({ x: dx * k, y: dy * k + 0.5 * k * d, z: dz * k }, true); }
      }
    } else fx.burst(this.pos, 0x7fd8ff, 20, 2);
    this.state = 'idle'; this.orb.group.visible = false; this.trail?.dispose(); this.trail = null; this.env.setWell(null, 0);
    this.status = 'ready'; this.cool = Math.max(this.cool, 0.3);
  }

  reset() {
    this.state = 'idle'; this.orb.group.visible = false; this.trail?.dispose(); this.trail = null;
    this.cool = 0; this.env.setWell(null, 0); this.status = 'ready';
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
      const acc = Math.min(strength * f / (0.4 + m * 0.5), WELL.accCap), k = (m * acc * dt) / d;
      b.applyImpulse({ x: dx * k + dz * k * 0.3, y: dy * k, z: dz * k - dx * k * 0.3 }, true); // pull + a little swirl
      if (d < 0.7) { const v = b.linvel(); b.setLinvel({ x: v.x * 0.92, y: v.y * 0.92, z: v.z * 0.92 }, true); } // settle near the core
    }
  }
}
