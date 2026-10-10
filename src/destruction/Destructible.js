import * as THREE from 'three';
import { DestructibleMesh, FractureOptions } from '@dgreenheck/three-pinata';
import { toon, addOutline } from '../render/Toon.js';

// A pre-fractured piece of scenery. The intact mesh (with a fixed collider) is shown until
// shatter(); then it is hidden and its fragments become dynamic Rapier bodies.
// Parent transform must be unrotated: three-pinata returns fragments centered with world positions.
export class Destructible {
  constructor(physics, scene, { geometry, position, color, innerColor = 0x3a2412, fragments = 14, mode }) {
    this.physics = physics; this.scene = scene;
    this.broken = false;
    this.dependents = []; // pieces resting on this one; they collapse shortly after
    this.live = [];       // { mesh, ttl }
    this.pending = [];    // { t, fn }

    const outer = toon(color);
    const inner = toon(innerColor);
    this.mesh = new DestructibleMesh(geometry, outer, inner);
    this.mesh.position.copy(position);
    scene.add(this.mesh);
    this.mesh.updateMatrixWorld(true);

    const isCyl = geometry.type === 'CylinderGeometry';
    this.frags = this.mesh.fracture(new FractureOptions({
      fractureMethod: 'voronoi',
      fragmentCount: fragments,
      voronoiOptions: { mode: mode || (isCyl ? '3D' : '2.5D') },
    }));

    addOutline(this.mesh, 0.03);
    const R = physics.R, p = geometry.parameters;
    const desc = isCyl ? R.ColliderDesc.cylinder(p.height / 2, p.radiusTop)
      : R.ColliderDesc.cuboid(p.width / 2, p.height / 2, p.depth / 2);
    this.makeDesc = () => (isCyl ? R.ColliderDesc.cylinder(p.height / 2, p.radiusTop)
      : R.ColliderDesc.cuboid(p.width / 2, p.height / 2, p.depth / 2));
    this.position = position.clone();
    for (const f of this.frags) f.userData.home = f.position.clone();
    this.collider = physics.addFixedCollider(desc, position, this);
  }

  // Restore the intact piece; fragment meshes are reused (no re-fracture hitch).
  reset() {
    for (const e of this.live) this.physics.remove(e.mesh);
    this.live = []; this.pending = [];
    if (!this.broken) return;
    this.broken = false;
    for (const f of this.frags) { f.position.copy(f.userData.home); f.quaternion.identity(); }
    this.scene.add(this.mesh);
    this.collider = this.physics.addFixedCollider(this.makeDesc(), this.position, this);
  }

  onHit(other) {
    if (this.broken || !other?.isProjectile) return;
    const v = other.body.linvel();
    const dir = new THREE.Vector3(v.x, v.y, v.z);
    const speed = dir.length();
    if (speed < 4) return;
    this.shatter(other.mesh.position, dir.divideScalar(speed), speed);
  }

  shatter(point, dir, speed = 8, delay = 0) {
    if (this.broken) return;
    this.broken = true;
    this.physics.untag(this.collider);
    this.physics.world.removeCollider(this.collider, true);
    this.mesh.removeFromParent();
    const R = this.physics.R;
    for (const f of this.frags) {
      this.scene.add(f);
      const pos = f.geometry.attributes.position.array;
      const body = this.physics.world.createRigidBody(
        R.RigidBodyDesc.dynamic().setTranslation(f.position.x, f.position.y, f.position.z));
      let desc = R.ColliderDesc.convexHull(pos);
      if (!desc) { f.geometry.computeBoundingSphere(); desc = R.ColliderDesc.ball(f.geometry.boundingSphere.radius); }
      this.physics.world.createCollider(desc.setRestitution(0.1).setFriction(0.8), body);
      const away = new THREE.Vector3().copy(f.position).sub(point).normalize();
      const k = 2 + Math.random() * 3;
      body.setLinvel({
        x: away.x * k + dir.x * speed * 0.25,
        y: away.y * k + dir.y * speed * 0.25 + 1.5,
        z: away.z * k + dir.z * speed * 0.25,
      }, true);
      body.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 }, true);
      this.physics.synced.push({ mesh: f, body });
      this.live.push({ mesh: f, ttl: 7 + Math.random() * 2 });
    }
    for (const d of this.dependents) this.pending.push({ t: 0.12 + Math.random() * 0.2, fn: () => d.shatter(point, dir, speed * 0.4) });
  }

  update(dt) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      this.pending[i].t -= dt;
      if (this.pending[i].t <= 0) this.pending.splice(i, 1)[0].fn();
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      if ((this.live[i].ttl -= dt) <= 0) this.physics.remove(this.live.splice(i, 1)[0].mesh);
    }
  }
}
