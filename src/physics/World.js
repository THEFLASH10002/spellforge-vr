import RAPIER from '@dimforge/rapier3d-compat';

const STEP = 1 / 60;

export class PhysicsWorld {
  static async create() {
    await RAPIER.init();
    return new PhysicsWorld();
  }
  constructor() {
    this.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.synced = []; // { mesh, body }
    this.acc = 0;
  }
  addStaticBox(mesh, hx, hy, hz) {
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.fixed().setTranslation(mesh.position.x, mesh.position.y, mesh.position.z));
    this.world.createCollider(this.R.ColliderDesc.cuboid(hx, hy, hz), body);
    return body;
  }
  addDynamicBox(mesh, hx, hy, hz) {
    const p = mesh.position;
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z));
    this.world.createCollider(this.R.ColliderDesc.cuboid(hx, hy, hz).setRestitution(0.2), body);
    this.synced.push({ mesh, body });
    return body;
  }
  addDynamicSphere(mesh, r, vel) {
    const p = mesh.position;
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setCcdEnabled(true)
        .setLinvel(vel.x, vel.y, vel.z));
    this.world.createCollider(this.R.ColliderDesc.ball(r).setRestitution(0.3).setDensity(4), body);
    this.synced.push({ mesh, body });
    return body;
  }
  remove(mesh) {
    const i = this.synced.findIndex(e => e.mesh === mesh);
    if (i < 0) return;
    this.world.removeRigidBody(this.synced[i].body);
    this.synced.splice(i, 1);
    mesh.removeFromParent();
  }
  step(dt) {
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= STEP) { this.world.step(); this.acc -= STEP; }
    for (const { mesh, body } of this.synced) {
      const t = body.translation(), r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
}
