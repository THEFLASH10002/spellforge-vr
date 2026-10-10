import * as THREE from 'three';
import { PRESETS, RULES } from './presets.js';
import { toon, glowTexture } from '../render/Toon.js';
import { domeMaterial } from '../vfx/Effects.js';

const LAMP_BASE = 0xffb868; // warm street-lantern glow before the Sanctum recolors it

const clamp01 = x => Math.min(1, Math.max(0, x));
const smooth = x => x * x * (3 - 2 * x);
const LANTERNS = [[-5.6, -2], [-5.6, -5], [-5.6, -8], [-5.6, -11], [5.8, -2], [5.8, -5], [5.8, -8], [5.8, -11], [-2.8, -1.5], [2.8, -1.5], [-2, -9], [2.2, -9]];

// Personal domain: tweens sky/fog/lights/floor, ignites lanterns, collapses remaining puppets,
// then runs one gameplay rule (low gravity | slow time | pulse shockwaves) until reset.
export class Sanctum {
  constructor({ scene, physics, floor, hemi, sun, puppets, sky, assets, stars = 700 }) {
    Object.assign(this, { scene, physics, floor, hemi, sun, puppets, sky });
    this.timeScale = 1; this.active = false; this.t = 0; this.timers = [];
    this.orig = {
      bg: new THREE.Color(scene.background), fog: scene.fog.color.clone(), near: scene.fog.near, far: scene.fog.far,
      hemiSky: hemi.color.clone(), hemiGround: hemi.groundColor.clone(), hemiI: hemi.intensity,
      sun: sun.color.clone(), sunI: sun.intensity, floor: floor.material.color.clone(),
      skyTop: sky.u.top.value.clone(), skyHorizon: sky.u.horizon.value.clone(), skyGlow: sky.u.glow.value.clone(),
      moon: sky.moon.material.color.clone(),
    };
    const pole = toon(0x2a2018), glow = glowTexture();
    this.lamps = LANTERNS.map(([x, z]) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.8, 6), pole);
      p.position.set(x, 0.9, z);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.2), new THREE.MeshBasicMaterial({ color: LAMP_BASE }));
      lamp.position.set(x, 1.95, z);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glow, color: LAMP_BASE, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0.8,
      }));
      halo.position.copy(lamp.position); halo.scale.setScalar(1.1);
      lamp.userData.halo = halo;
      scene.add(p, lamp, halo);
      // A hanging-lantern GLB replaces the lamp box and hangs from a taller pole; the halo still recolors.
      const skin = assets?.get('lantern', { fitHeight: 0.6, outline: false });
      if (skin) {
        p.scale.y = 2.3 / 1.8; p.position.y = 1.15;
        skin.position.set(x, 1.7, z); scene.add(skin); lamp.visible = false;
      }
      return lamp;
    });
    const n = stars, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(18 + Math.random() * 22);
      pos.set([v.x, Math.abs(v.y) * 0.9 + 0.5, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.14, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.visible = false; scene.add(this.stars);
    this.ring = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), domeMaterial()); // shimmering barrier dome
    this.ring.frustumCulled = false; this.ring.visible = false; scene.add(this.ring);
  }

  activate(presetIdx = 0, ruleIdx = 0) {
    if (this.active) return;
    this.active = true; this.t = 0; this.pulse = 0; this.collapsed = false;
    this.p = PRESETS[presetIdx % PRESETS.length];
    this.rule = RULES[ruleIdx % RULES.length].id;
    this.pc = Object.fromEntries(['bg', 'fog', 'hemiSky', 'hemiGround', 'sun', 'lantern', 'stars', 'floor', 'skyTop', 'skyHorizon', 'skyGlow', 'moon'].map(k => [k, new THREE.Color(this.p[k])]));
    this.stars.material.color.copy(this.pc.stars);
    this.ring.material.uniforms.color.value.copy(this.pc.lantern);
    this.stars.visible = this.ring.visible = true;
    for (const { body } of this.physics.synced) body.wakeUp();
    if (this.rule === 'lowgrav') this.physics.world.gravity = { x: 0, y: -2.2, z: 0 };
    if (this.rule === 'slowmo') this.timeScale = 0.35;
  }

  reset() {
    this.active = false; this.timeScale = 1; this.timers = [];
    this.physics.world.gravity = { x: 0, y: -9.81, z: 0 };
    const o = this.orig, s = this.scene;
    s.background.copy(o.bg); s.fog.color.copy(o.fog); s.fog.near = o.near; s.fog.far = o.far;
    this.hemi.color.copy(o.hemiSky); this.hemi.groundColor.copy(o.hemiGround); this.hemi.intensity = o.hemiI;
    this.sun.color.copy(o.sun); this.sun.intensity = o.sunI; this.floor.material.color.copy(o.floor);
    for (const l of this.lamps) { l.material.color.set(LAMP_BASE); l.userData.halo.material.color.set(LAMP_BASE); }
    const u = this.sky.u;
    u.top.value.copy(o.skyTop); u.horizon.value.copy(o.skyHorizon); u.glow.value.copy(o.skyGlow);
    this.sky.moon.material.color.copy(o.moon);
    this.stars.visible = this.ring.visible = false;
    this.stars.material.opacity = 0;
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const t = this.t, k = smooth(clamp01(t / 2.5)), p = this.p, o = this.orig, pc = this.pc, s = this.scene;
    s.background.copy(o.bg).lerp(pc.bg, k);
    s.fog.color.copy(o.fog).lerp(pc.fog, k);
    s.fog.near = o.near + (p.fogNear - o.near) * k; s.fog.far = o.far + (p.fogFar - o.far) * k;
    this.hemi.color.copy(o.hemiSky).lerp(pc.hemiSky, k); this.hemi.groundColor.copy(o.hemiGround).lerp(pc.hemiGround, k);
    this.hemi.intensity = o.hemiI + (p.hemiI - o.hemiI) * k;
    this.sun.color.copy(o.sun).lerp(pc.sun, k); this.sun.intensity = o.sunI + (p.sunI - o.sunI) * k;
    this.floor.material.color.copy(o.floor).lerp(pc.floor, k);
    this.stars.material.opacity = k * 0.9; this.stars.rotation.y += dt * 0.03;
    const pr = clamp01(t / 1.6), du = this.ring.material.uniforms;
    this.ring.position.set(0, 1.2, -4);
    this.ring.scale.setScalar(2 + smooth(pr) * 32); // expands, then stays as a barrier
    du.time.value += dt; du.intensity.value = 0.35 + (1 - pr);
    const u = this.sky.u;
    u.top.value.copy(o.skyTop).lerp(pc.skyTop, k); u.horizon.value.copy(o.skyHorizon).lerp(pc.skyHorizon, k);
    u.glow.value.copy(o.skyGlow).lerp(pc.skyGlow, k); this.sky.moon.material.color.copy(o.moon).lerp(pc.moon, k);
    this.lamps.forEach((l, i) => {
      if (t > 0.6 + i * 0.12) l.material.color.lerp(pc.lantern, 0.12);
      l.userData.halo.material.color.copy(l.material.color);
    });

    if (!this.collapsed && t > 2.4) {
      this.collapsed = true;
      this.puppets.forEach((pp, i) => {
        if (pp.broken) return;
        this.timers.push({ t: i * 0.25, fn: () => {
          const d = new THREE.Vector3(Math.random() - 0.5, 0.3, Math.random() - 0.5).normalize();
          pp.shatter(pp.center, d, 6);
        } });
      });
    }
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if ((this.timers[i].t -= dt) <= 0) this.timers.splice(i, 1)[0].fn();
    }

    if (this.rule === 'shockwave' && t > 2.5 && (this.pulse -= dt) <= 0) {
      this.pulse = 2.5;
      const c = new THREE.Vector3(0, 0, -5), v = new THREE.Vector3();
      for (const { mesh, body } of this.physics.synced) {
        v.copy(mesh.position).sub(c); v.y = 0;
        if (v.length() > 14) continue;
        v.normalize();
        const lv = body.linvel();
        body.wakeUp();
        body.setLinvel({ x: lv.x + v.x * 3, y: lv.y + 3.5, z: lv.z + v.z * 3 }, true);
      }
    }
  }
}
