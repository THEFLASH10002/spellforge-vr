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
    this.events = new RAPIER.EventQueue(true);
    this.tags = new Map(); // collider handle -> object with optional onHit(other)
    this.synced = []; // { mesh, body }
    this.acc = 0;
  }
  tag(collider, obj) {
    collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.tags.set(collider.handle, obj);
  }
  untag(collider) { this.tags.delete(collider.handle); }

  addStaticBox(mesh, hx, hy, hz) {
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.fixed().setTranslation(mesh.position.x, mesh.position.y, mesh.position.z));
    this.world.createCollider(this.R.ColliderDesc.cuboid(hx, hy, hz), body);
    return body;
  }
  // Fixed collider with no body (static scenery); returns the collider.
  addFixedCollider(desc, pos, tag) {
    const c = this.world.createCollider(desc.setTranslation(pos.x, pos.y, pos.z));
    if (tag) this.tag(c, tag);
    return c;
  }
  addDynamicBox(mesh, hx, hy, hz) {
    const p = mesh.position;
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z));
    this.world.createCollider(this.R.ColliderDesc.cuboid(hx, hy, hz).setRestitution(0.2), body);
    this.synced.push({ mesh, body });
    return body;
  }
  addDynamicSphere(mesh, r, vel, tag) {
    const p = mesh.position;
    const body = this.world.createRigidBody(
      this.R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setCcdEnabled(true)
        .setLinvel(vel.x, vel.y, vel.z));
    const c = this.world.createCollider(this.R.ColliderDesc.ball(r).setRestitution(0.3).setDensity(4), body);
    if (tag) this.tag(c, tag);
    this.synced.push({ mesh, body });
    return body;
  }
  remove(mesh) {
    const i = this.synced.findIndex(e => e.mesh === mesh);
    if (i < 0) return;
    const body = this.synced[i].body;
    for (let k = 0; k < body.numColliders(); k++) this.untag(body.collider(k));
    this.world.removeRigidBody(body);
    this.synced.splice(i, 1);
    mesh.removeFromParent();
  }
  step(dt) {
    this.acc = Math.min(this.acc + dt, 0.1);
    const hits = [];
    while (this.acc >= STEP) {
      this.world.step(this.events);
      this.events.drainCollisionEvents((h1, h2, started) => {
        if (started) hits.push([this.tags.get(h1), this.tags.get(h2)]);
      });
      this.acc -= STEP;
    }
    // Handlers run after the step so they may create/remove bodies safely.
    for (const [a, b] of hits) { a?.onHit?.(b); b?.onHit?.(a); }
    for (const { mesh, body } of this.synced) {
      const t = body.translation(), r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
}
