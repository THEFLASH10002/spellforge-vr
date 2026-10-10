import * as THREE from 'three';
import { toon, addOutline } from '../render/Toon.js';

// Segmented wooden kugutsu puppet. Alive: a swaying group of box parts with one fixed hit-collider.
// On hit: each part gets a dynamic Rapier body, joined by spherical joints (ragdoll).
// Original design; no skinning, so no bone/collider alignment problems.
const WOOD = 0xb08850, DARK = 0x6b4a2a, MASK = 0xf0eadb;

// name, center (x,y,z), half extents, joint to parent: [parent, anchor (x,y,z)]
const PARTS = [
  { n: 'pelvis', c: [0, 0.95, 0], h: [0.16, 0.1, 0.1], color: DARK },
  { n: 'torso', c: [0, 1.28, 0], h: [0.17, 0.22, 0.1], color: WOOD, j: ['pelvis', [0, 1.08, 0]] },
  { n: 'head', c: [0, 1.68, 0], h: [0.1, 0.12, 0.1], color: MASK, j: ['torso', [0, 1.52, 0]] },
  { n: 'armL', c: [-0.26, 1.2, 0], h: [0.045, 0.27, 0.045], color: WOOD, j: ['torso', [-0.23, 1.47, 0]] },
  { n: 'armR', c: [0.26, 1.2, 0], h: [0.045, 0.27, 0.045], color: WOOD, j: ['torso', [0.23, 1.47, 0]] },
  { n: 'legL', c: [-0.09, 0.425, 0], h: [0.065, 0.425, 0.065], color: DARK, j: ['pelvis', [-0.09, 0.85, 0]] },
  { n: 'legR', c: [0.09, 0.425, 0], h: [0.065, 0.425, 0.065], color: DARK, j: ['pelvis', [0.09, 0.85, 0]] },
];
const PUPPET_GROUPS = 0x0002fffd; // puppet parts do not collide with each other, only with the world

export class Puppet {
  constructor(physics, scene, x, z, phase = 0) {
    this.physics = physics; this.scene = scene;
    this.broken = false; this.phase = phase;
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);
    scene.add(this.group);
    this.mesh = this.group; // for callers that read mesh.position
    this.parts = {};
    for (const d of PARTS) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(d.h[0] * 2, d.h[1] * 2, d.h[2] * 2),
        toon(d.color));
      m.position.set(...d.c);
      this.group.add(m);
      addOutline(m, 0.012);
      this.parts[d.n] = { def: d, mesh: m };
    }
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.01), new THREE.MeshBasicMaterial({ color: 0xc0281e }));
    eyes.position.set(0, 0.02, 0.101);
    this.parts.head.mesh.add(eyes);
    this.makeHitbox();
  }

  get center() { return this.group.position.clone().setY(0.95); }

  makeHitbox() {
    const R = this.physics.R, p = this.group.position;
    this.hitbox = this.physics.addFixedCollider(R.ColliderDesc.cuboid(0.3, 0.9, 0.2), { x: p.x, y: 0.9, z: p.z }, this);
  }

  onHit(other) {
    if (this.broken || !other?.isProjectile) return;
    const v = other.body.linvel();
    const dir = new THREE.Vector3(v.x, v.y, v.z);
    const speed = dir.length();
    if (speed < 3) return;
    this.shatter(other.mesh.position, dir.divideScalar(speed), speed);
  }

  // Ragdoll (same entry point name as Destructible so Arts treat both alike).
  shatter(point, dir, speed = 8) {
    if (this.broken) return;
    this.broken = true;
    this.physics.untag(this.hitbox);
    this.physics.world.removeCollider(this.hitbox, true);
    const R = this.physics.R, w = this.physics.world;
    this.group.updateMatrixWorld(true);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion();
    for (const part of Object.values(this.parts)) {
      const m = part.mesh;
      m.getWorldPosition(wp); m.getWorldQuaternion(wq);
      this.scene.attach(m);
      const body = w.createRigidBody(R.RigidBodyDesc.dynamic()
        .setTranslation(wp.x, wp.y, wp.z).setRotation({ x: wq.x, y: wq.y, z: wq.z, w: wq.w })
        .setLinearDamping(0.2).setAngularDamping(0.8));
      w.createCollider(R.ColliderDesc.cuboid(...part.def.h).setCollisionGroups(PUPPET_GROUPS)
        .setRestitution(0.1).setFriction(0.9).setDensity(0.6), body);
      part.body = body;
      this.physics.synced.push({ mesh: m, body });
    }
    const a = new THREE.Vector3();
    for (const part of Object.values(this.parts)) {
      const j = part.def.j;
      if (!j) continue;
      const parent = this.parts[j[0]];
      a.set(...j[1]);
      this.group.localToWorld(a);
      const l1 = parent.mesh.worldToLocal(a.clone()), l2 = part.mesh.worldToLocal(a.clone());
      w.createImpulseJoint(R.JointData.spherical({ x: l1.x, y: l1.y, z: l1.z }, { x: l2.x, y: l2.y, z: l2.z }),
        parent.body, part.body, true);
    }
    for (const part of Object.values(this.parts)) {
      part.body.setLinvel({ x: dir.x * speed * 0.4, y: dir.y * speed * 0.4 + 2.5, z: dir.z * speed * 0.4 }, true);
      part.body.setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 }, true);
    }
  }

  reset() {
    if (this.broken) {
      for (const part of Object.values(this.parts)) {
        this.physics.remove(part.mesh); // removes body, joints, and detaches mesh
        this.group.add(part.mesh);
        part.mesh.position.set(...part.def.c);
        part.mesh.quaternion.identity();
        part.body = null;
      }
      this.broken = false;
      this.makeHitbox();
    }
  }

  update(dt, t) {
    if (this.broken) return;
    const s = Math.sin(t * 1.6 + this.phase);
    this.group.rotation.z = s * 0.03;
    this.parts.head.mesh.rotation.y = Math.sin(t * 0.8 + this.phase) * 0.4;
    this.parts.armL.mesh.rotation.z = s * 0.08;
    this.parts.armR.mesh.rotation.z = -s * 0.08;
  }
}
