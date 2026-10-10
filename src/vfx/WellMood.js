import * as THREE from 'three';

// Spell "mood": the scene dims and shifts toward a spell's color as it builds (blue for the Gravity Well,
// red for the Repulsor), a colored light spills onto nearby surfaces, and everything eases back slowly
// after the orb is gone. Supports several sources at once. Runs after the Sanctum each frame: with no
// Sanctum active it restores the base look first (so nothing accumulates); during a Sanctum it just
// modulates what the Sanctum wrote this frame.
export const MOOD = {
  riseTime: 0.45,   // s time-constant while building
  fadeTime: 2.4,    // s time-constant while fading after the orb is gone (slow)
  dimHemi: 0.68,    // ambient light removed at full mood
  dimSun: 0.85,     // key light removed at full mood
  glow: 70,         // point-light intensity at full mood
  glowRange: 11,    // m reach of the light
};

const c = hex => new THREE.Color(hex);

export class WellMood {
  // sources: spells exposing { v.mood (palette), moodTarget, moodPos }
  constructor({ scene, hemi, sun, sky, env, sanctum, sources }) {
    Object.assign(this, { scene, hemi, sun, sky, env, sanctum });
    const f = scene.fog, u = sky.u;
    this.base = {
      hemiI: hemi.intensity, hemiC: hemi.color.clone(), hemiG: hemi.groundColor.clone(), sunI: sun.intensity, sunC: sun.color.clone(),
      fogC: f.color.clone(), near: f.near, far: f.far, top: u.top.value.clone(), horizon: u.horizon.value.clone(), glow: u.glow.value.clone(),
      moon: sky.moon.material.color.clone(),
    };
    // One light per source, created up front (intensity 0) so lit shaders compile with it: no hitch later.
    this.src = sources.map(s => {
      const p = s.v.mood, light = new THREE.PointLight(p.light, 0, MOOD.glowRange, 2);
      scene.add(light);
      return { s, m: 0, light, pos: new THREE.Vector3(0, 1.4, -2), tint: c(p.tint), deep: c(p.deep), sky: c(p.sky), petal: c(p.petal), glow: c(p.glow) };
    });
  }

  restore() {
    const b = this.base, f = this.scene.fog, u = this.sky.u;
    this.hemi.intensity = b.hemiI; this.hemi.color.copy(b.hemiC); this.hemi.groundColor.copy(b.hemiG);
    this.sun.intensity = b.sunI; this.sun.color.copy(b.sunC);
    f.color.copy(b.fogC); f.near = b.near; f.far = b.far;
    u.top.value.copy(b.top); u.horizon.value.copy(b.horizon); u.glow.value.copy(b.glow);
    this.sky.moon.material.color.copy(b.moon);
  }

  update(dt) {
    const owned = this.sanctum.active; // the Sanctum controls the look this frame
    if (!owned) this.restore();
    const f = this.scene.fog, u = this.sky.u;
    let lead = null; // strongest source drives the grass glow / petal / mountain tint
    for (const e of this.src) {
      const target = e.s.moodTarget;
      e.m += (target - e.m) * (1 - Math.exp(-dt / (target > e.m ? MOOD.riseTime : MOOD.fadeTime)));
      if (e.s.moodPos) e.pos.copy(e.s.moodPos);
      const m = e.m;
      if (m < 0.003) { e.light.intensity = 0; continue; }
      this.hemi.intensity *= 1 - MOOD.dimHemi * m; this.hemi.color.lerp(e.tint, 0.3 * m); this.hemi.groundColor.lerp(e.deep, 0.5 * m);
      this.sun.intensity *= 1 - MOOD.dimSun * m; this.sun.color.lerp(e.tint, 0.4 * m);
      f.color.lerp(e.deep, 0.8 * m); f.near *= 1 - 0.3 * m; f.far *= 1 - 0.35 * m;
      u.top.value.lerp(e.deep, 0.9 * m); u.horizon.value.lerp(e.sky, 0.85 * m); u.glow.value.lerp(e.tint, 0.7 * m);
      this.sky.moon.material.color.lerp(e.deep, 0.7 * m);
      e.light.position.copy(e.pos);
      e.light.intensity = MOOD.glow * m;
      if (!lead || m > lead.m) lead = e;
    }
    if (lead) {
      this.env.setGlow(lead.pos, lead.m, lead.glow);
      if (!owned) this.env.setMoodTint(lead.m, lead.deep, lead.petal);
    } else {
      this.env.setGlow(this.src[0].pos, 0, this.src[0].glow);
      if (!owned) this.env.setMoodTint(0, this.src[0].deep, this.src[0].petal);
    }
  }
}
