import * as THREE from 'three';
import { makeHalo } from './Effects.js';
import { QUALITY } from '../config/Quality.js';

// Procedural gravity-orb visuals: noise core, two aura shells, dashed orbiting ribbons / wind rings,
// inward-spiraling particles, sparks that fly out and get pulled back, and ground dust.
// All additive + custom shaders; no full-screen bloom. Group is scaled by the orb radius (meters),
// so everything below is in orb-local units (core radius = 1).
const FULL = QUALITY.fx === 'full';
const ADD = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false };
const NOISE = `
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }`;
const SPHERE_VERT = `varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main(){ vP = normalize(position); vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;

const coreMat = pal => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uCharge: { value: 0 }, uA: { value: new THREE.Color(pal.coreA) }, uB: { value: new THREE.Color(pal.coreB) } }, ...ADD, vertexShader: SPHERE_VERT,
  fragmentShader: `${NOISE} uniform float uTime; uniform float uCharge; uniform vec3 uA; uniform vec3 uB; varying vec3 vN; varying vec3 vV; varying vec3 vP;
    void main(){
      float facing = abs(dot(normalize(vN), normalize(vV)));
      vec2 uv = vec2(atan(vP.z, vP.x) * 2.0 + uTime * 1.5, vP.y * 3.0);
      float nz = n(uv * 2.0 + uTime) * 0.5 + n(uv * 5.0 - uTime * 1.3) * 0.5;
      vec3 c = mix(uA, uB, 0.7 * pow(facing, 6.0 - uCharge * 1.5)); // electric blue, small hot center (never pure white)
      gl_FragColor = vec4(c * (0.65 + uCharge * 0.15) * (0.7 + 0.45 * nz), 0.9);
      #include <colorspace_fragment>
    }`,
});

const auraMat = (pow, ns, speed, color, alpha) => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uCharge: { value: 0 }, uPow: { value: pow }, uNs: { value: ns }, uSpeed: { value: speed }, uAlpha: { value: alpha }, uColor: { value: new THREE.Color(color) } },
  ...ADD, vertexShader: SPHERE_VERT,
  fragmentShader: `${NOISE} uniform float uTime; uniform float uCharge; uniform float uPow; uniform float uNs; uniform float uSpeed; uniform float uAlpha; uniform vec3 uColor;
    varying vec3 vN; varying vec3 vV; varying vec3 vP;
    void main(){
      float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPow);
      vec2 uv = vec2(atan(vP.z, vP.x) * 2.0 + uTime * uSpeed, vP.y * 3.0);
      float nz = n(uv * uNs + uTime * uSpeed * 0.5) * 0.6 + n(uv * uNs * 2.3 - uTime * uSpeed) * 0.4;
      gl_FragColor = vec4(uColor * (0.8 + nz), f * (0.35 + nz) * uAlpha * (0.6 + uCharge));
      #include <colorspace_fragment>
    }`,
});

const ribbonMat = (dash, speed, alpha, pal) => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uCharge: { value: 0 }, uDash: { value: dash }, uSpd: { value: speed }, uAlpha: { value: alpha }, uA: { value: new THREE.Color(pal.ribA) }, uB: { value: new THREE.Color(pal.ribB) } },
  ...ADD, side: THREE.DoubleSide,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform float uTime; uniform float uCharge; uniform float uDash; uniform float uSpd; uniform float uAlpha; uniform vec3 uA; uniform vec3 uB; varying vec2 vUv;
    void main(){
      float d = fract(vUv.x * uDash - uTime * uSpd);
      gl_FragColor = vec4(mix(uA, uB, d * d), pow(d, 3.0) * uAlpha * (0.5 + uCharge));
      #include <colorspace_fragment>
    }`,
});

const particleMat = pal => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uCharge: { value: 0 }, uSize: { value: 0.32 }, uScale: { value: 0.05 }, uDust: { value: 0 }, uDustY: { value: 0 },
    uOut: { value: pal.out ? 1 : 0 }, uA: { value: new THREE.Color(pal.partA) }, uB: { value: new THREE.Color(pal.partB) }, uS: { value: new THREE.Color(pal.spark) } },
  ...ADD,
  vertexShader: `attribute vec4 aSeed; attribute float aKind;
    uniform float uTime; uniform float uCharge; uniform float uSize; uniform float uScale; uniform float uDust; uniform float uDustY;
    uniform float uOut; uniform vec3 uA; uniform vec3 uB; uniform vec3 uS;
    varying vec3 vCol; varying float vA;
    vec3 rot(vec3 v, vec3 k, float a){ return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a)); }
    void main(){
      float sp = 0.5 + aSeed.x * 0.7 + uCharge * 1.1;
      float ph = fract(uTime * sp * 0.45 + aSeed.y);
      float th = aSeed.z * 6.2832, cp = 2.0 * aSeed.w - 1.0, s2 = sqrt(1.0 - cp * cp);
      vec3 dir = vec3(s2 * cos(th), cp, s2 * sin(th));
      vec3 axis = normalize(vec3(sin(aSeed.x * 17.0), 1.0, cos(aSeed.y * 13.0)));
      vec3 p; float size = uSize; vA = 1.0;
      if (aKind < 0.5) { // spiral inward (space compressing) - or outward when uOut = 1 (repulsion)
        float q = mix(ph, 1.0 - ph, uOut);
        float r = (2.2 + aSeed.z * 2.6) * (1.0 - q);
        p = rot(dir, axis, ph * (5.0 + uCharge * 9.0) * (1.0 + aSeed.w) * mix(1.0, -1.0, uOut)) * r;
        vCol = mix(uA, uB, q); vA = smoothstep(0.0, 0.1, ph) * (0.35 + 0.65 * q) * mix(1.0, 1.0 - smoothstep(0.7, 1.0, ph), uOut);
      } else if (aKind < 1.5) { // sparks shoot out, get pulled back
        float r = 1.0 + 2.8 * sin(ph * 3.14159);
        p = rot(dir, axis, ph * 3.0) * r; vCol = uS; vA = 0.9 * sin(ph * 3.14159); size *= 0.7;
      } else { // ground dust spiraling in (singularity only)
        float a = aSeed.z * 6.2832 + ph * 5.0, r = mix(1.0 - ph, ph, uOut) * 3.2 / uScale + 0.5;
        p = vec3(cos(a) * r, -uDustY + aSeed.w * 0.5 / uScale, sin(a) * r);
        vCol = vec3(0.78, 0.7, 0.55); vA = uDust * smoothstep(0.0, 0.15, ph) * (1.0 - ph) * 0.7; size *= 3.0;
      }
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = size * uScale * 750.0 / max(-mv.z, 0.05);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `varying vec3 vCol; varying float vA;
    void main(){
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d) * vA;
      if (a < 0.01) discard;
      gl_FragColor = vec4(vCol, a);
      #include <colorspace_fragment>
    }`,
});

export const PAL_BLUE = { coreA: 0x0f66ff, coreB: 0xb3ebff, aura1: 0x1f7fff, aura2: 0x4fc8ff, ribA: 0x26a6ff, ribB: 0xe6ffff, partA: 0x33bfff, partB: 0xffffff, spark: 0x99e6ff, halo: 0x2f8fff, out: false };
export const PAL_RED = { coreA: 0xff1a0a, coreB: 0xffd2a0, aura1: 0xff2a14, aura2: 0xff8a3a, ribA: 0xff3a1a, ribB: 0xfff0d0, partA: 0xff3a22, partB: 0xffe0b0, spark: 0xffa060, halo: 0xff3a14, out: true };

export function createOrb(pal = PAL_BLUE) {
  const group = new THREE.Group();
  const mats = [];
  const reg = m => { mats.push(m); return m; };

  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), reg(coreMat(pal)));
  const aura1 = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 14), reg(auraMat(1.6, 3.0, 1.2, pal.aura1, 0.6)));
  const aura2 = new THREE.Mesh(new THREE.SphereGeometry(2.1, 20, 14), reg(auraMat(2.6, 2.0, -0.8, pal.aura2, 0.4)));
  group.add(core, aura1, aura2);

  // Spinning dashed rings: first three read as energy ribbons, the thin outer ones as wind streaks.
  const rings = [];
  [[1.5, 0.03, 4, 1.6, 0.9], [1.9, 0.03, 3, -1.2, 0.8], [2.3, 0.03, 5, 2.0, 0.7],
   [2.8, 0.014, 9, 2.6, 0.6], [3.4, 0.012, 11, -3.1, 0.5], [4.0, 0.01, 13, 3.6, 0.4]].forEach(([r, w, dash, spin, alpha], i) => {
    const holder = new THREE.Group();
    holder.rotation.set(i * 0.9 + 0.3, i * 1.7, i * 0.6);
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, w, 4, 64), reg(ribbonMat(dash, 0.7 + i * 0.15, alpha, pal)));
    holder.add(m); group.add(holder);
    rings.push({ m, spin });
  });

  const halo = makeHalo(pal.halo, 6);
  group.add(halo);

  const counts = FULL ? [150, 40, 40] : [90, 24, 24];
  const total = counts[0] + counts[1] + counts[2];
  const seed = new Float32Array(total * 4), kind = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    kind[i] = i < counts[0] ? 0 : i < counts[0] + counts[1] ? 1 : 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3)); // unused; positions come from the shader
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  const pm = reg(particleMat(pal));
  const pts = new THREE.Points(geo, pm);
  pts.frustumCulled = false;
  group.add(pts);

  return {
    group, halo,
    // radius: meters; charge: 0..1; dust: 0..1 (singularity ground dust); dustY: meters above ground.
    update(t, dt, charge, radius, dust = 0, dustY = 0) {
      const pulse = 1 + Math.sin(t * 13) * 0.05 * (0.4 + charge) + Math.sin(t * 31) * 0.02 * charge;
      group.scale.setScalar(Math.max(radius * pulse, 1e-3));
      for (const m of mats) { m.uniforms.uTime.value = t; m.uniforms.uCharge.value = charge; }
      pm.uniforms.uScale.value = Math.max(radius, 1e-3);
      pm.uniforms.uDust.value = dust; pm.uniforms.uDustY.value = dustY;
      for (const r of rings) r.m.rotation.z += dt * r.spin * (1 + charge * 2.5);
      halo.material.opacity = 0.18 + 0.17 * charge + Math.sin(t * 17) * 0.03;
    },
  };
}
