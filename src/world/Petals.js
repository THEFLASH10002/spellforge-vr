import * as THREE from 'three';
import { terrainHeight } from './Terrain.js';

// Falling cherry-blossom petals: one instanced draw call, fully stateless GPU animation (no physics).
// Each petal's position is a pure function of (time, seed): fall, sway, a global wind offset that
// wraps around the play area, then optional spell displacement (attract toward a hand, then burst).
const R = 28; // wrap half-size (m) around the origin

const vert = `
attribute vec4 aSeed; attribute vec3 aSpawn;
uniform float uTime; uniform vec2 uWind; uniform float uSize; uniform vec3 uHead;
uniform vec4 uAttract; uniform vec4 uBurst;
uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uTint; uniform float uTintK;
varying vec3 vCol; varying float vA; varying vec2 vQ;
void main(){
  float T = 9.0 + aSeed.x * 6.0;
  float ph = fract(uTime / T + aSeed.y);
  float top = aSpawn.y + 4.0 + aSeed.z * 6.0;
  float y = mix(top, aSpawn.y + 0.05, ph);
  float fl = sin(uTime * (1.5 + aSeed.w) + aSeed.x * 20.0);
  vec2 xz = aSpawn.xz + uWind * (0.4 + aSeed.w * 0.6)
          + vec2(sin(ph * 9.4 + aSeed.z * 6.28), cos(ph * 7.5 + aSeed.x * 6.28)) * (0.8 + aSeed.w)
          + vec2(fl * 0.2, fl * 0.15);
  xz = mod(xz + ${R.toFixed(1)}, ${(2 * R).toFixed(1)}) - ${R.toFixed(1)};
  vec3 c = vec3(xz.x, y, xz.y);

  vec3 toH = uAttract.xyz - c; float dH = length(toH);
  c += toH * uAttract.w * smoothstep(7.0, 0.5, dH) * 0.9;
  vec3 fromB = c - uBurst.xyz; float dB = length(fromB) + 0.001;
  c += (fromB / dB * 4.5 + vec3(0.0, 1.2, 0.0)) * uBurst.w * smoothstep(9.0, 0.5, dB);

  vA = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.85, 1.0, ph)); // fade in, and out as it reaches the ground
  vA *= 1.0 - smoothstep(16.0, 26.0, length(c - uHead));               // distance-based density

  vec4 mv = viewMatrix * vec4(c, 1.0);
  float ang = uTime * (0.8 + aSeed.w * 1.6) + aSeed.x * 6.28;
  vec2 q = position.xy * uSize * vec2(abs(cos(ang * 1.3)) * 0.7 + 0.3, 1.0); // flip as it flutters
  mv.xy += mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * q;
  gl_Position = projectionMatrix * mv;
  vCol = mix(mix(uColA, uColB, aSeed.z), uTint, uTintK) * (0.85 + 0.35 * aSeed.w);
  vQ = position.xy;
}`;

const frag = `
varying vec3 vCol; varying float vA; varying vec2 vQ;
void main(){
  float d = length(vQ * vec2(1.0, 0.8));
  float a = smoothstep(0.5, 0.3, d) * vA * 0.9;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol, a);
  #include <colorspace_fragment>
}`;

export class Petals {
  constructor(scene, count, treePts = []) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(count * 4), spawn = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      let x, z;
      if (treePts.length && Math.random() < 0.6) { // fed by trees
        const t = treePts[(Math.random() * treePts.length) | 0];
        x = t[0] + (Math.random() - 0.5) * 6; z = t[1] + (Math.random() - 0.5) * 6;
      } else { const a = Math.random() * 6.283, r = 3 + Math.sqrt(Math.random()) * 15; x = Math.cos(a) * r; z = Math.sin(a) * r; } // swirl over the arena
      seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
      spawn.set([x, terrainHeight(x, z), z], i * 3);
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.setAttribute('aSpawn', new THREE.InstancedBufferAttribute(spawn, 3));
    geo.instanceCount = count;

    this.u = {
      uTime: { value: 0 }, uWind: { value: new THREE.Vector2() }, uSize: { value: 0.13 }, uHead: { value: new THREE.Vector3() },
      uAttract: { value: new THREE.Vector4() }, uBurst: { value: new THREE.Vector4() },
      uColA: { value: new THREE.Color(0xffc2d6) }, uColB: { value: new THREE.Color(0xff86b4) },
      uTint: { value: new THREE.Color(0xffffff) }, uTintK: { value: 0 },
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.windMul = 1; this.gustT = 6; this.gustE = 0; this.spell = null;
  }

  setTint(color, k) { this.u.uTint.value.copy(color); this.u.uTintK.value = k; }
  gust(s = 1) { this.gustE = Math.max(this.gustE, s); }
  // Spell reaction: petals near `pos` get pulled in, then burst outward and drift back.
  trigger(pos, strength = 1) { this.spell = { t: 0, pos: pos.clone(), s: strength }; }

  update(dt, t, head) {
    const u = this.u;
    u.uTime.value = t; u.uHead.value.copy(head);
    // Wind: slow drifting direction + random gusts, integrated into a continuous offset.
    if ((this.gustT -= dt) <= 0) { this.gust(1); this.gustT = 8 + Math.random() * 8; }
    this.gustE = Math.max(0, this.gustE - dt * 0.35);
    const speed = (0.35 + this.gustE * 2.2) * this.windMul, dir = 0.6 + Math.sin(t * 0.05) * 0.6;
    u.uWind.value.x += Math.cos(dir) * speed * dt; u.uWind.value.y += Math.sin(dir) * speed * dt;
    // Spell envelope: attract 0.35 s, then a fast burst that decays.
    const sp = this.spell;
    if (sp) {
      sp.t += dt;
      const a = sp.t < 0.35 ? sp.t / 0.35 : Math.max(0, 1 - (sp.t - 0.35) / 0.1);
      const b = sp.t < 0.35 ? 0 : sp.t < 0.47 ? (sp.t - 0.35) / 0.12 : Math.max(0, 1 - (sp.t - 0.47) / 1.1);
      u.uAttract.value.set(sp.pos.x, sp.pos.y, sp.pos.z, a * 0.8 * sp.s);
      u.uBurst.value.set(sp.pos.x, sp.pos.y, sp.pos.z, b * sp.s);
      if (sp.t > 1.7) { this.spell = null; u.uAttract.value.w = u.uBurst.value.w = 0; }
    }
  }
}
