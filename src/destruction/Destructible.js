import * as THREE from 'three';
import { DestructibleMesh, FractureOptions } from '@dgreenheck/three-pinata';
import { toon, addOutline } from '../render/Toon.js';
import { fx } from '../vfx/Effects.js';

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
    this.onReset?.();
    if (!this.broken && !this.carved) return;
    this.broken = false; this.carved = false; this.vap = [];
    for (const f of this.frags) {
      if (f.userData.body) { this.physics.world.removeRigidBody(f.userData.body); f.userData.body = null; }
      f.userData.gone = false; f.scale.setScalar(1); f.removeFromParent();
      f.position.copy(f.userData.home); f.quaternion.identity();
    }
    this.scene.add(this.mesh);
    if (this.collider) { this.physics.untag(this.collider); this.physics.world.removeCollider(this.collider, true); }
    this.collider = this.physics.addFixedCollider(this.makeDesc(), this.position, this);
  }

  // ---- Nullpoint carving: punch a hole instead of shattering ---------------------------------------------
  // Swap the intact mesh for its fragments as static pieces, then vaporize the ones inside the tube.
  startCarve() {
    if (this.carved || this.broken) return;
    this.carved = true; this.vap = [];
    if (this.collider) { this.physics.untag(this.collider); this.physics.world.removeCollider(this.collider, true); this.collider = null; }
    this.mesh.removeFromParent();
    this.onCarve?.(); // a GLB skin hides and the rest of its structure converts too
    const R = this.physics.R;
    for (const f of this.frags) {
      this.scene.add(f);
      if (f.userData.r === undefined) { f.geometry.computeBoundingSphere(); f.userData.r = f.geometry.boundingSphere.radius; }
      const body = this.physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(f.position.x, f.position.y, f.position.z));
      let desc = R.ColliderDesc.convexHull(f.geometry.attributes.position.array);
      if (!desc) desc = R.ColliderDesc.ball(f.userData.r);
      this.physics.world.createCollider(desc.setFriction(0.8), body);
      f.userData.body = body;
    }
  }

  // Remove every fragment whose bounds touch the tube around segment a->b (radius r). Returns how many.
  carve(a, b, r, segDist) {
    if (this.broken) return 0;
    this.startCarve();
    let n = 0;
    for (const f of this.frags) {
      if (f.userData.gone) continue;
      if (segDist(f.position, a, b) < r + f.userData.r * 0.6) {
        f.userData.gone = true; n++;
        if (f.userData.body) { this.physics.world.removeRigidBody(f.userData.body); f.userData.body = null; }
        this.vap.push({ mesh: f, t: 0 });
        fx.burst(f.position, 0xc070ff, 6, 2.5);
      }
    }
    if (this.frags.every(f => f.userData.gone)) this.broken = true;
    return n;
  }

  onHit(other) {
    if (this.broken || !other?.isProjectile) return;
    const v = other.body.linvel();
    const dir = new THREE.Vector3(v.x, v.y, v.z);
    const speed = dir.length();
    if (speed < 4) return;
    other.dead = true; // bolt is consumed by the impact
    this.shatter(other.mesh.position, dir.divideScalar(speed), speed);
  }

  // pull = true: fragments are drawn toward `point` (Gravity Well) instead of thrown away from it.
  shatter(point, dir, speed = 8, pull = false) {
    if (this.broken) return;
    this.broken = true;
    this.onShatter?.(point, dir, speed, pull); // lets a GLB skin hide and the rest of its structure follow
    fx.burst(point, 0xffe0a0, 28, 4);
    if (this.collider) { this.physics.untag(this.collider); this.physics.world.removeCollider(this.collider, true); this.collider = null; }
    this.mesh.removeFromParent();
    const R = this.physics.R;
    for (const f of this.frags) {
      if (f.userData.gone) continue; // vaporized by a Nullpoint
      if (f.userData.body) { this.physics.world.removeRigidBody(f.userData.body); f.userData.body = null; } // carved piece: fixed -> dynamic
      this.scene.add(f);
      const pos = f.geometry.attributes.position.array;
      const body = this.physics.world.createRigidBody(
        R.RigidBodyDesc.dynamic().setTranslation(f.position.x, f.position.y, f.position.z));
      let desc = R.ColliderDesc.convexHull(pos);
      if (!desc) { f.geometry.computeBoundingSphere(); desc = R.ColliderDesc.ball(f.geometry.boundingSphere.radius); }
      this.physics.world.createCollider(desc.setRestitution(0.1).setFriction(0.8), body);
      const away = new THREE.Vector3().copy(f.position).sub(point).normalize();
      if (pull) away.negate();
      const k = pull ? 1.5 + Math.random() * 2 : 2 + Math.random() * 3, dk = pull ? 0 : speed * 0.25;
      body.setLinvel({
        x: away.x * k + dir.x * dk,
        y: away.y * k + dir.y * dk + (pull ? 0.5 : 1.5),
        z: away.z * k + dir.z * dk,
      }, true);
      body.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 }, true);
      this.physics.synced.push({ mesh: f, body, debris: true });
      this.live.push({ mesh: f, ttl: 7 + Math.random() * 2 });
    }
    this.physics.trimDebris(200);
    for (const d of this.dependents) this.pending.push({ t: 0.12 + Math.random() * 0.2, fn: () => d.shatter(point, dir, speed * 0.4, pull) });
  }

  update(dt) {
    if (this.vap?.length) {
      for (let i = this.vap.length - 1; i >= 0; i--) { // vaporize: shrink away
        const v = this.vap[i]; v.t += dt / 0.45;
        v.mesh.scale.setScalar(Math.max(0, 1 - v.t));
        if (v.t >= 1) { v.mesh.removeFromParent(); this.vap.splice(i, 1); }
      }
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      this.pending[i].t -= dt;
      if (this.pending[i].t <= 0) this.pending.splice(i, 1)[0].fn();
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      if ((this.live[i].ttl -= dt) <= 0) this.physics.remove(this.live.splice(i, 1)[0].mesh);
    }
  }
}
