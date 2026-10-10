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
    if (artId === 'push') this.push(hand, art); else this.bolt(hand, art);
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

  clear() {
    for (const e of this.live) { if (e.mesh) this.physics.remove(e.mesh); e.trail.dispose(); }
    this.live = [];
  }

  update(dt, cam) {
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
