import * as THREE from 'three';

// Gravity Well "mood": the scene dims and shifts blue as the spell builds, a blue light spills onto
// nearby surfaces, and everything eases back slowly after the orb collapses.
// Runs after the Sanctum each frame. When no Sanctum is active it restores the base look first
// (so nothing accumulates); during a Sanctum it just modulates what the Sanctum wrote this frame.
const BLUE = new THREE.Color(0x2f6cff), DEEP = new THREE.Color(0x081230), SKYBLUE = new THREE.Color(0x14307a);

export const MOOD = {
  riseTime: 0.45,   // s time-constant while building
  fadeTime: 2.4,    // s time-constant while fading after the orb is gone (slow)
  dimHemi: 0.68,    // ambient light removed at full mood
  dimSun: 0.85,     // key light removed at full mood
  glow: 70,         // blue point-light intensity at full mood
  glowRange: 11,    // m reach of the blue light
};

export class WellMood {
  constructor({ scene, hemi, sun, sky, env, sanctum }) {
    Object.assign(this, { scene, hemi, sun, sky, env, sanctum });
    this.m = 0; this.pos = new THREE.Vector3(0, 1.4, -2);
    // Created up front (intensity 0) so the lit shaders compile with it and there is no hitch later.
    this.light = new THREE.PointLight(0x3a8cff, 0, MOOD.glowRange, 2);
    this.light.position.copy(this.pos);
    scene.add(this.light);
    const f = scene.fog, u = sky.u;
    this.base = {
      hemiI: hemi.intensity, hemiC: hemi.color.clone(), hemiG: hemi.groundColor.clone(), sunI: sun.intensity, sunC: sun.color.clone(),
      fogC: f.color.clone(), near: f.near, far: f.far, top: u.top.value.clone(), horizon: u.horizon.value.clone(), glow: u.glow.value.clone(),
      moon: sky.moon.material.color.clone(),
    };
  }

  restore() {
    const b = this.base, f = this.scene.fog, u = this.sky.u;
    this.hemi.intensity = b.hemiI; this.hemi.color.copy(b.hemiC); this.hemi.groundColor.copy(b.hemiG);
    this.sun.intensity = b.sunI; this.sun.color.copy(b.sunC);
    f.color.copy(b.fogC); f.near = b.near; f.far = b.far;
    u.top.value.copy(b.top); u.horizon.value.copy(b.horizon); u.glow.value.copy(b.glow);
    this.sky.moon.material.color.copy(b.moon);
  }

  update(dt, well) {
    const target = well.moodTarget;
    this.m += (target - this.m) * (1 - Math.exp(-dt / (target > this.m ? MOOD.riseTime : MOOD.fadeTime)));
    if (well.moodPos) this.pos.copy(well.moodPos);
    const m = this.m, owned = this.sanctum.active; // owned: the Sanctum controls the look this frame
    if (!owned) this.restore();
    if (m < 0.003) {
      this.light.intensity = 0;
      this.env.setGlow(this.pos, 0);
      if (!owned) this.env.setMoodTint(0);
      return;
    }
    const f = this.scene.fog, u = this.sky.u;
    this.hemi.intensity *= 1 - MOOD.dimHemi * m; this.hemi.color.lerp(BLUE, 0.3 * m); this.hemi.groundColor.lerp(DEEP, 0.5 * m);
    this.sun.intensity *= 1 - MOOD.dimSun * m; this.sun.color.lerp(BLUE, 0.4 * m);
    f.color.lerp(DEEP, 0.8 * m); f.near *= 1 - 0.3 * m; f.far *= 1 - 0.35 * m;
    u.top.value.lerp(DEEP, 0.9 * m); u.horizon.value.lerp(SKYBLUE, 0.85 * m); u.glow.value.lerp(BLUE, 0.7 * m);
    this.sky.moon.material.color.lerp(DEEP, 0.7 * m);
    this.light.position.copy(this.pos);
    this.light.intensity = MOOD.glow * m;
    this.env.setGlow(this.pos, m);
    if (!owned) this.env.setMoodTint(m);
  }
}
