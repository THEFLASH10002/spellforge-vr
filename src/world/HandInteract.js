import * as THREE from 'three';
import { fx } from '../vfx/Effects.js';

// Physical hands.
//  PUNCH: a fast fist knocks things away in the direction of the swing. Standing enemies are ragdolled and thrown;
//         loose debris and ragdoll limbs fly; structure pieces shatter on a hard hit.
//  GRAB:  close your hand into a fist next to a loose object to pick it up, carry it, and open your hand to throw it
//         (the hand's speed carries over). Closing a fist next to a STANDING enemy ragdolls it and grabs it.
// Everything is driven by the tracked palm point (a bit in front of the wrist), no controllers needed.
const FIST_ON = 0.66, FIST_OFF = 0.78;   // mean straightness of index..pinky: below ON = fist, above OFF = open (hysteresis)
const PUNCH_SPEED = 2.2;                 // m/s of the palm to count as a punch
const GRAB_REACH = 0.12;                 // m beyond an object's surface that you can grab from
const THROW_BOOST = 1.25, MAX_SPEED = 16;
const ZERO = new THREE.Vector3();

const radius = mesh => {
  const g = mesh.geometry;
  if (!g) return 0.1;
  if (!g.boundingSphere) g.computeBoundingSphere();
  return g.boundingSphere.radius * mesh.scale.x;
};

export class HandInteract {
  constructor({ physics, targets }) {
    this.physics = physics; this.targets = targets; this.clock = 0;
    const mk = () => ({ hist: [], vel: new THREE.Vector3(), palm: new THREE.Vector3(), fist: false, held: null });
    this.hand = { left: mk(), right: mk() };
    this.tmp = new THREE.Vector3(); this.dir = new THREE.Vector3();
  }

  isHolding(side) { return !!this.hand[side].held; }

  // L / R: extracted hands (or null). blocked(side): true if that hand is busy (holding an orb, aiming a teleport...).
  update(dt, L, R, blocked) {
    this.clock += dt;
    for (const side of ['left', 'right']) {
      const h = side === 'left' ? L : R, st = this.hand[side];
      if (!h || blocked(side)) { this.release(st); st.hist.length = 0; st.fist = false; continue; }
      st.palm.copy(h.wrist).addScaledVector(h.fwd, 0.09);
      st.hist.push({ t: this.clock, p: st.palm.clone() });
      while (st.hist.length > 2 && this.clock - st.hist[0].t > 0.14) st.hist.shift();
      const a = st.hist[0], b = st.hist[st.hist.length - 1], span = b.t - a.t;
      if (span > 0.04) st.vel.copy(b.p).sub(a.p).divideScalar(span); else st.vel.set(0, 0, 0);

      const mean = (h.curls[1] + h.curls[2] + h.curls[3] + h.curls[4]) / 4, was = st.fist;
      st.fist = was ? mean < FIST_OFF : mean < FIST_ON;
      if (st.fist && !was) this.tryGrab(st);
      if (!st.fist && was) this.release(st);
      if (st.held) this.drive(st);
      else if (st.fist) this.punch(st);
    }
  }

  // ---- grab ------------------------------------------------------------------------------------------------------
  tryGrab(st) {
    let best = null;
    for (const e of this.physics.synced) {
      if (e.projectile || e.held) continue;
      const p = e.body.translation(), d = Math.hypot(p.x - st.palm.x, p.y - st.palm.y, p.z - st.palm.z) - radius(e.mesh);
      if (d < GRAB_REACH && (!best || d < best.d)) best = { e, d };
    }
    if (!best) { // a standing enemy: ragdoll it, then take hold of the nearest limb
      for (const t of this.targets) {
        if (!t.erase || t.broken) continue;
        const c = t.group.position;
        if (Math.hypot(st.palm.x - c.x, st.palm.z - c.z) < 0.4 && st.palm.y > 0.1 && st.palm.y < 1.85) {
          t.shatter(st.palm, ZERO, 0, false);
          for (const part of Object.values(t.parts)) {
            const e = this.physics.synced.find(x => x.mesh === part.mesh);
            if (!e) continue;
            const d = part.mesh.position.distanceTo(st.palm);
            if (!best || d < best.d) best = { e, d };
          }
          break;
        }
      }
    }
    if (!best) return;
    const e = best.e, p = e.body.translation();
    const off = new THREE.Vector3(p.x, p.y, p.z).sub(st.palm);
    if (off.length() > 0.35) off.setLength(0.35);
    e.held = true; e.mesh.userData.held = true;
    st.held = { e, off, damp: e.body.angularDamping() };
    e.body.setAngularDamping(8);
    fx.burst(st.palm, 0xbfe9ff, 8, 1.2);
  }

  drive(st) {
    const { e, off } = st.held;
    if (!this.physics.synced.includes(e)) { st.held = null; return; } // the object was removed (despawned / erased)
    const p = e.body.translation();
    const tx = st.palm.x + off.x, ty = st.palm.y + off.y, tz = st.palm.z + off.z;
    let vx = (tx - p.x) * 18, vy = (ty - p.y) * 18, vz = (tz - p.z) * 18;
    const sp = Math.hypot(vx, vy, vz); if (sp > 10) { const c = 10 / sp; vx *= c; vy *= c; vz *= c; }
    e.body.setLinvel({ x: vx, y: vy, z: vz }, true); // velocity-driven so it still collides with the world
  }

  release(st) {
    const h = st.held;
    if (!h) return;
    st.held = null;
    h.e.held = false; h.e.mesh.userData.held = false;
    if (!this.physics.synced.includes(h.e)) return;
    const v = st.vel.clone().multiplyScalar(THROW_BOOST); if (v.length() > MAX_SPEED) v.setLength(MAX_SPEED);
    h.e.body.setAngularDamping(h.damp);
    h.e.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true); // thrown with the hand's momentum
  }

  // ---- punch -----------------------------------------------------------------------------------------------------
  punch(st) {
    const speed = st.vel.length();
    if (speed < PUNCH_SPEED) return;
    const dir = this.dir.copy(st.vel).divideScalar(speed), palm = st.palm;
    for (const t of this.targets) {
      if (t.erase) { // enemy
        if (t.broken) continue;
        const c = t.group.position;
        if (Math.hypot(palm.x - c.x, palm.z - c.z) < 0.4 && palm.y > 0.1 && palm.y < 1.85) {
          t.shatter(palm, dir, Math.min(30, speed * 3), false);
          fx.burst(palm, 0xffe0a0, 16, 3);
        }
      } else if (speed > 5 && !t.broken) { // a structure piece breaks on a hard hit
        t.bounds ||= new THREE.Box3().setFromObject(t.mesh);
        if (t.bounds.distanceToPoint(palm) < 0.15) { t.shatter(palm, dir, Math.min(25, speed * 2.5), false); fx.burst(palm, 0xffe0a0, 20, 3); }
      }
    }
    for (const e of this.physics.synced) { // loose debris, ragdoll limbs
      if (e.projectile || e.held || this.clock - (e.lastPunch ?? -1) < 0.25) continue;
      const p = e.body.translation();
      if (Math.hypot(p.x - palm.x, p.y - palm.y, p.z - palm.z) < radius(e.mesh) + 0.12) {
        e.lastPunch = this.clock;
        const v = this.tmp.copy(dir).multiplyScalar(Math.min(speed * 1.2, 18));
        e.body.setLinvel({ x: v.x, y: v.y + 0.5, z: v.z }, true);
        e.body.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 }, true);
        fx.burst(palm, 0xffe0a0, 6, 2);
      }
    }
  }

  reset() { for (const s of ['left', 'right']) { this.release(this.hand[s]); this.hand[s].hist.length = 0; this.hand[s].fist = false; } }
}
