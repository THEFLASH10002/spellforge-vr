import * as THREE from 'three';
import { terrainHeight } from './Terrain.js';
import { glowTexture } from '../render/Toon.js';

// Moving around.
//  * Hands (the default): PINCH thumb + index to aim. A dotted arc and a landing ring show where you will go;
//    release the pinch to teleport. Works with either hand (not one that is holding an orb).
//  * Controllers (if used): left thumbstick walks, relative to where you face.
//  * Desktop: W A S D / arrow keys.
// In VR the player is moved by offsetting the XR reference space (the official three.js teleport technique), so hands,
// head and every world-space position stay consistent. Things that should stay with the player (the control panel and
// the spellbook) are carried along through `onMove(delta)`.
const MAX_REACH = 16;   // m: how far one teleport can go
const WORLD_R = 40;     // m: how far from the arena centre you may go
const PINCH_ON = 0.018, PINCH_OFF = 0.03;  // m between thumb tip and index tip: they must really touch (hysteresis avoids flicker)
const PINCH_HOLD = 0.2;                    // s the pinch must be held before the arc appears (a flick does nothing)
const OPEN_MIN = 0.85;                     // the other three fingers must stay this straight (an 'OK' sign, not a fist or claw)
const RAISED = 0.65;                       // m: the hand must be no lower than this below the head (not hanging at your side)
const SPEED = 2.4;      // m/s thumbstick / keyboard walking

export class Locomotion {
  constructor({ renderer, scene, camera, onMove }) {
    Object.assign(this, { renderer, camera, onMove });
    this.pos = new THREE.Vector3();          // where the play-space origin currently is in the world
    this.base = null;
    this.pinching = { left: false, right: false };
    this.aim = null; this.hold = 0; this.cool = 0; this.valid = false;
    this.target = new THREE.Vector3(); this.keys = new Set(); this.tmpR = new THREE.Vector3(); this.pinchT = 0;
    renderer.xr.addEventListener('sessionstart', () => { this.base = renderer.xr.getReferenceSpace(); this.apply(); });
    renderer.xr.addEventListener('sessionend', () => { this.base = null; });
    addEventListener('keydown', e => this.keys.add(e.code));
    addEventListener('keyup', e => this.keys.delete(e.code));

    const n = 30;
    const g = new THREE.BufferGeometry();
    this.arc = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.arc, 3));
    this.dots = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.07, map: glowTexture(), color: 0x7fe8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    this.dots.frustumCulled = false; this.dots.visible = false; scene.add(this.dots);
    const mat = new THREE.MeshBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.ring = new THREE.Group();
    const r1 = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 40).rotateX(-Math.PI / 2), mat);
    const r2 = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24).rotateX(-Math.PI / 2), mat);
    this.ring.add(r1, r2); this.ring.visible = false; scene.add(this.ring);
  }

  // Put the play-space origin at the current `pos` (VR only).
  apply() {
    if (!this.base) return;
    const t = new XRRigidTransform({ x: -this.pos.x, y: -this.pos.y, z: -this.pos.z }, { x: 0, y: 0, z: 0, w: 1 });
    this.renderer.xr.setReferenceSpace(this.base.getOffsetReferenceSpace(t));
  }

  // Move the player's origin to (x, z) on the terrain.
  moveTo(x, z) {
    const r = Math.hypot(x, z);
    if (r > WORLD_R) { x *= WORLD_R / r; z *= WORLD_R / r; }
    const y = terrainHeight(x, z), d = new THREE.Vector3(x - this.pos.x, y - this.pos.y, z - this.pos.z);
    this.pos.set(x, y, z);
    if (this.base) this.apply();
    else this.camera.position.set(this.camera.position.x + d.x, 1.6 + y, this.camera.position.z + d.z); // desktop
    this.onMove?.(d);
  }

  // Show the aiming arc from a hand: `h` = { tip, fwd } (see extractHand).
  showArc(h, head) {
    const dir = this.tmpDir ||= new THREE.Vector3(), p = this.tmpP ||= new THREE.Vector3(), v = this.tmpV ||= new THREE.Vector3();
    dir.copy(h.fwd); dir.y += 0.25; dir.normalize();
    p.copy(h.tip); v.copy(dir).multiplyScalar(9);
    let hit = false, last = 0;
    for (let i = 0; i < 30; i++) {
      this.arc.set([p.x, p.y, p.z], i * 3); last = i;
      if (hit) continue;
      v.y -= 9.8 * 0.05; p.addScaledVector(v, 0.05);
      if (p.y <= terrainHeight(p.x, p.z) + 0.02) { hit = true; p.y = terrainHeight(p.x, p.z); this.target.copy(p); }
    }
    for (let i = last + 1; i < 30; i++) this.arc.set([p.x, p.y, p.z], i * 3);
    this.dots.geometry.attributes.position.needsUpdate = true;
    this.valid = hit && Math.hypot(this.target.x - head.x, this.target.z - head.z) <= MAX_REACH;
    this.dots.material.color.set(this.valid ? 0x7fe8ff : 0xff7a7a);
    this.dots.visible = true;
    this.ring.visible = this.valid;
    if (this.valid) this.ring.position.set(this.target.x, this.target.y + 0.03, this.target.z);
  }

  // Teleport so the player's HEAD ends up over the aimed point.
  commit(head) {
    if (!this.valid) return;
    this.moveTo(this.target.x - (head.x - this.pos.x), this.target.z - (head.z - this.pos.z));
    this.cool = 0.5;
  }

  // RIGHT hand only. A teleport needs a deliberate "OK" pinch: thumb and index touching, the other three fingers open,
  // the hand raised in front of you, held for a moment. Anything looser (a fist, a relaxed hand at your side) is ignored.
  update(dt, head, headQ, L, R, holding) {
    this.cool -= dt;
    this.pinching.left = false;
    const h = R, f = this.fwd ||= new THREE.Vector3();
    f.set(0, 0, -1).applyQuaternion(headQ);
    let aimed = false, now = false;
    if (h && !holding('right') && this.cool <= 0) {
      const d = h.thumb.distanceTo(h.tip);
      const open = (h.curls[2] + h.curls[3] + h.curls[4]) / 3 > OPEN_MIN;
      const raised = h.wrist.y > head.y - RAISED && this.tmpR.copy(h.wrist).sub(head).dot(f) > 0.15; // up and in front of you
      now = open && raised && (this.pinching.right ? d < PINCH_OFF : d < PINCH_ON);
    }
    this.pinching.right = now;
    this.pinchT = now ? (this.pinchT || 0) + dt : 0;
    if (now && this.pinchT > PINCH_HOLD) { this.aim = 'right'; this.hold += dt; this.showArc(h, head); aimed = true; }
    if (!aimed && this.aim) { // pinch released
      if (this.hold > 0.2) this.commit(head);
      this.aim = null; this.hold = 0; this.dots.visible = false; this.ring.visible = false;
    }
    if (!aimed) this.walk(dt, headQ);
  }

  // Thumbstick (VR controllers) or keyboard (desktop) walking, relative to where you face.
  walk(dt, headQ) {
    let mx = 0, mz = 0;
    const s = this.renderer.xr.getSession?.();
    if (s) for (const src of s.inputSources) {
      if (!src.gamepad || src.hand || src.handedness !== 'left') continue;
      const a = src.gamepad.axes, x = a[2] ?? a[0] ?? 0, y = a[3] ?? a[1] ?? 0;
      if (Math.hypot(x, y) > 0.15) { mx += x; mz += y; }
    }
    if (!s) {
      const k = this.keys;
      mx += (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      mz += (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    }
    if (!mx && !mz) return;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(headQ); f.y = 0; f.normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const m = r.multiplyScalar(mx).addScaledVector(f, -mz);
    if (m.lengthSq() > 1) m.normalize();
    this.moveTo(this.pos.x + m.x * SPEED * dt, this.pos.z + m.z * SPEED * dt);
  }
}
