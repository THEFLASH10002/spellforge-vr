import * as THREE from 'three';
import { ARTS } from './ArtRegistry.js';
import { fx, Trail, makeHalo } from '../vfx/Effects.js';

// Arts: bolt (glowing projectile with ribbon trail) and push (palm shockwave + cone impulse).
export class ArtCaster {
  constructor(scene, physics) {
    this.scene = scene; this.physics = physics; this.live = [];
    this.destructibles = []; // pieces the push Art can shatter directly
  }

  cast(artId, hand) {
    if (!hand) return;
    const art = ARTS[artId] || ARTS.bolt;
    fx.burst(hand.tip, art.color, 14, 1.5);
    this.env?.onSpell(artId === 'push' ? hand.wrist : hand.tip, artId === 'push' ? 'push' : 'cast');
    if (artId === 'push') this.push(hand, art); else if (artId === 'pull') this.pull(hand, art); else this.bolt(hand, art);
  }

  bolt(hand, art) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    m.add(makeHalo(art.color, 0.45));
    m.position.copy(hand.tip).addScaledVector(hand.fwd, 0.1);
    this.scene.add(m);
    const tag = { isProjectile: true, mesh: m };
    tag.body = this.physics.addDynamicSphere(m, 0.05, hand.fwd.clone().multiplyScalar(26), tag);
    this.live.push({ mesh: m, tag, ttl: 6, trail: new Trail(this.scene, art.color), fade: 0 });
  }

  push(hand, art) {
    const dir = hand.normal; // push where the palm faces
    fx.shock(hand.wrist.clone().addScaledVector(dir, 0.1), dir, art.color);
    const to = new THREE.Vector3();
    for (const d of this.destructibles) {
      if (d.broken) continue;
      to.copy(d.center || d.mesh.position).sub(hand.wrist);
      const dist = to.length();
      if (dist < 12 && to.normalize().dot(dir) > 0.85) d.shatter(hand.wrist, dir, 10);
    }
    for (const { mesh, body } of this.physics.synced) {
      to.copy(mesh.position).sub(hand.wrist);
      const dist = to.length();
      if (dist > 8 || dist < 0.01 || to.normalize().dot(dir) < 0.8) continue;
      const k = 4 / Math.max(dist, 1);
      body.wakeUp();
      body.applyImpulse({ x: dir.x * k, y: dir.y * k + 0.5 * k, z: dir.z * k }, true);
    }
  }

  // Pull (Grasp): a one-shot yank. Everything in a cone in front of the palm is dragged toward your hand: standing
  // enemies are ragdolled and pulled in, structure pieces in reach shatter toward you, and loose debris flies at you.
  pull(hand, art) {
    const dir = hand.normal; // the palm faces the target
    fx.shock(hand.wrist.clone().addScaledVector(dir, 1.1), dir, art.color, 3, 0.5, true); // collapsing wave
    fx.burst(hand.wrist, art.color, 20, 2);
    const to = new THREE.Vector3();
    for (const d of this.destructibles) {
      if (d.broken) continue;
      to.copy(d.center || d.mesh.position).sub(hand.wrist);
      const dist = to.length();
      if (dist < 10 && to.normalize().dot(dir) > 0.8) d.shatter(hand.wrist, dir, 10, true); // pieces / ragdolls head for the hand
    }
    for (const { mesh, body, projectile } of this.physics.synced) { // includes the fragments / ragdoll parts just created
      if (projectile) continue;
      to.copy(mesh.position).sub(hand.wrist);
      const dist = to.length();
      if (dist > 12 || dist < 0.4 || to.normalize().dot(dir) < 0.75) continue;
      const speed = Math.min(16, 5 + dist * 0.8); // mass-independent: heavy pieces fly too
      body.wakeUp();
      body.setLinvel({ x: -to.x * speed, y: -to.y * speed + 1.5, z: -to.z * speed }, true);
    }
    this.pulling = { t: 0, pos: hand.wrist.clone() }; // nearby petals stream toward the hand for a moment
  }

  // Pull, channelled: call every frame while the Grasp sign is held. Loose things in front of the palm accelerate toward the
  // hand, float against gravity, and gather and hover near the palm; enemies are ragdolled and dragged in. Release = they drop.
  pullHold(hand, dt) {
    const dir = hand.normal, art = ARTS.pull;
    const to = this.tmpTo ||= new THREE.Vector3();
    for (const d of this.destructibles) {
      if (d.broken) continue;
      to.copy(d.center || d.mesh.position).sub(hand.wrist);
      if (to.length() < (d.center ? 10 : 8) && to.normalize().dot(dir) > 0.8) d.shatter(hand.wrist, dir, 10, true);
    }
    const hover = this.tmpHover ||= new THREE.Vector3(), d = this.tmpD ||= new THREE.Vector3();
    hover.copy(hand.wrist).addScaledVector(dir, 0.9); hover.y += 0.05; // things gather just in front of the palm
    for (const e of this.physics.synced) {
      if (e.projectile || e.held) continue;
      to.copy(e.mesh.position).sub(hand.wrist);
      const dist = to.length();
      d.copy(hover).sub(e.mesh.position);
      const L = d.length();
      if (L > 2.2 && (dist > 13 || to.divideScalar(dist).dot(dir) < 0.7)) continue; // far: only what is in the cone; near: keep what is gathered
      const v = e.body.linvel();
      let vx = v.x, vy = v.y, vz = v.z;
      if (L > 1.4) { // far: accelerate toward the hover point (and nearly cancel gravity)
        const acc = 38 * Math.max(0, 1 - dist / 14) + 6; d.divideScalar(L);
        vx += d.x * acc * dt; vy += d.y * acc * dt + 9.0 * dt; vz += d.z * acc * dt;
      } else { // arrived: spring onto the hover point so it is caught instead of flying past
        const k = 0.35; vx += (d.x * 9 - vx) * k; vy += (d.y * 9 - vy) * k; vz += (d.z * 9 - vz) * k;
      }
      const sp = Math.hypot(vx, vy, vz); if (sp > 14) { const c = 14 / sp; vx *= c; vy *= c; vz *= c; }
      e.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    }
    this.pulling = { t: 0, pos: hand.wrist.clone() }; // keeps the petals streaming
    if ((this.pullRing = (this.pullRing ?? 0) - dt) <= 0) { this.pullRing = 0.35; fx.shock(hand.wrist.clone().addScaledVector(dir, 0.6), dir, art.color, 0.7, 0.35, true); } // small pulse rings, not a view-filling dome
  }

  clear() {
    for (const e of this.live) { if (e.mesh) this.physics.remove(e.mesh); e.trail.dispose(); }
    this.live = [];
  }

  update(dt, cam) {
    if (this.pulling) {
      this.pulling.t += dt;
      if (this.pulling.t < 0.8) {
        this.env?.setWell(this.pulling.pos, 0.8, 'pull');
        for (const { mesh, body, projectile } of this.physics.synced) { // catch: slow things that reach the hand instead of letting them fly past
          if (projectile || mesh.position.distanceTo(this.pulling.pos) > 1.6) continue;
          const v = body.linvel(); body.setLinvel({ x: v.x * 0.8, y: v.y * 0.8, z: v.z * 0.8 }, true);
        }
      }
      else { this.env?.setWell(null, 0, 'pull'); this.pulling = null; }
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      if (e.mesh) {
        e.ttl -= dt;
        e.trail.push(e.mesh.position);
        e.trail.update(cam, 0.05);
        if (e.ttl <= 0 || e.tag.dead) { this.physics.remove(e.mesh); e.mesh = null; e.fade = 1; }
      } else {
        e.fade -= dt * 3.5;
        e.trail.update(cam, 0.05, Math.max(0, e.fade));
        if (e.fade <= 0) { e.trail.dispose(); this.live.splice(i, 1); }
      }
    }
  }
}
