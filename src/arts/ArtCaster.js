import * as THREE from 'three';
import { ARTS } from './ArtRegistry.js';

// Minimal Arts: bolt (fast projectile) and push (cone impulse). Destruction hooks come later.
export class ArtCaster {
  constructor(scene, physics) {
    this.scene = scene; this.physics = physics; this.live = [];
  }

  cast(artId, hand) {
    if (!hand) return;
    const art = ARTS[artId] || ARTS.bolt;
    if (artId === 'push') this.push(hand, art); else this.bolt(hand, art);
  }

  bolt(hand, art) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: art.color }));
    m.position.copy(hand.tip).addScaledVector(hand.fwd, 0.1);
    this.scene.add(m);
    this.physics.addDynamicSphere(m, 0.05, hand.fwd.clone().multiplyScalar(14));
    this.live.push({ mesh: m, ttl: 6 });
  }

  push(hand, art) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.14, 24), new THREE.MeshBasicMaterial({ color: art.color, side: THREE.DoubleSide, transparent: true }));
    const dir = hand.normal; // push where the palm faces
    ring.position.copy(hand.wrist).addScaledVector(dir, 0.3);
    ring.lookAt(ring.position.clone().add(dir));
    this.scene.add(ring);
    this.live.push({ mesh: ring, ttl: 0.4, fx: true });
    const to = new THREE.Vector3();
    for (const { mesh, body } of this.physics.synced) {
      to.copy(mesh.position).sub(hand.wrist);
      const dist = to.length();
      if (dist > 8 || dist < 0.01 || to.normalize().dot(dir) < 0.8) continue;
      const k = 4 / Math.max(dist, 1);
      body.wakeUp();
      body.applyImpulse({ x: dir.x * k, y: dir.y * k + 0.5 * k, z: dir.z * k }, true);
    }
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      e.ttl -= dt;
      if (e.fx) { e.mesh.scale.multiplyScalar(1 + dt * 8); e.mesh.material.opacity = Math.max(0, e.ttl / 0.4); }
      if (e.ttl <= 0) {
        if (e.fx) e.mesh.removeFromParent(); else this.physics.remove(e.mesh);
        this.live.splice(i, 1);
      }
    }
  }
}
