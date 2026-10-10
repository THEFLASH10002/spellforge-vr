import * as THREE from 'three';
import { QUALITY } from '../config/Quality.js';
import { glowTexture } from '../render/Toon.js';

// All effects are additive and cheap: ribbon trails, CPU-pooled sparks, and two small shaders.
const FULL = QUALITY.fx === 'full';
const ADD = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false };

// ---- Ribbon trail (camera-facing strip) -----------------------------------------------------
export class Trail {
  constructor(scene, color, n = 14) {
    this.n = n; this.hist = []; this.color = new THREE.Color(color);
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 2 * 4), 4));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, ...ADD }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  push(p) { this.hist.unshift(p.clone()); if (this.hist.length > this.n) this.hist.pop(); }
  update(cam, width = 0.05, fade = 1) {
    const h = this.hist, pos = this.geo.attributes.position.array, col = this.geo.attributes.color.array;
    const side = new THREE.Vector3(), tan = new THREE.Vector3(), toCam = new THREE.Vector3();
    for (let i = 0; i < h.length; i++) {
      const a = h[Math.max(i - 1, 0)], b = h[Math.min(i + 1, h.length - 1)];
      tan.copy(a).sub(b);
      toCam.copy(cam).sub(h[i]);
      side.crossVectors(tan, toCam).normalize().multiplyScalar(width * (1 - i / this.n));
      pos.set([h[i].x + side.x, h[i].y + side.y, h[i].z + side.z, h[i].x - side.x, h[i].y - side.y, h[i].z - side.z], i * 6);
      const al = (1 - i / this.n) * 0.9 * fade;
      col.set([this.color.r, this.color.g, this.color.b, al, this.color.r, this.color.g, this.color.b, al], i * 8);
    }
    this.geo.setDrawRange(0, Math.max(0, h.length - 1) * 6);
    this.geo.attributes.position.needsUpdate = this.geo.attributes.color.needsUpdate = true;
  }
  dispose() { this.mesh.removeFromParent(); this.geo.dispose(); this.mesh.material.dispose(); }
}

// ---- Glow halo sprite --------------------------------------------------------------------------
const glow = glowTexture();
export function makeHalo(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, opacity: 0.9, ...ADD }));
  s.scale.setScalar(size);
  return s;
}

// ---- Pooled spark particles ---------------------------------------------------------------------
class Sparks {
  constructor(scene, max) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.base = new Float32Array(max * 3);
    this.pos.fill(9999);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, ...ADD }));
    this.pts.frustumCulled = false;
    scene.add(this.pts);
  }
  emit(p, color, count = 20, speed = 3) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.i; this.i = (this.i + 1) % this.max;
      const v = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.3 + Math.random()));
      this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
      this.base.set([c.r, c.g, c.b], i * 3); this.life[i] = 0.5 + Math.random() * 0.5;
    }
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      this.life[i] -= dt;
      const o = i * 3;
      this.vel[o + 1] -= 5 * dt;
      for (let k = 0; k < 3; k++) { this.pos[o + k] += this.vel[o + k] * dt; this.col[o + k] = this.base[o + k] * Math.max(0, this.life[i]) * 2; }
    }
    this.pts.geometry.attributes.position.needsUpdate = this.pts.geometry.attributes.color.needsUpdate = true;
  }
}

// ---- Palm shockwave dome (fresnel + sweeping band) ------------------------------------------------
const domeGeo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
function shockMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { progress: { value: 0 }, color: { value: new THREE.Color(color) } },
    side: THREE.DoubleSide, ...ADD,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vH;
      void main(){ vH = position.y; vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float progress; uniform vec3 color; varying vec3 vN; varying vec3 vV; varying float vH;
      void main(){
        float fres = pow(1.0 - abs(dot(normalize(vN), vV)), 2.0);
        float band = smoothstep(0.3, 0.0, abs((1.0 - vH) - progress));
        float a = (fres * 0.8 + band * 0.7) * (1.0 - progress);
        gl_FragColor = vec4(color, a);
        #include <colorspace_fragment>
      }`,
  });
}

// ---- Sanctum dome (noise bands + rim), seen from inside ----------------------------------------------
export function domeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, intensity: { value: 1 }, color: { value: new THREE.Color(0x8fd0ff) } },
    side: THREE.BackSide, defines: FULL ? { FULL: 1 } : {}, ...ADD,
    vertexShader: 'varying vec3 vN; void main(){ vN = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float time; uniform float intensity; uniform vec3 color; varying vec3 vN;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main(){
        vec2 uv = vec2(atan(vN.z, vN.x) * 3.0, vN.y * 6.0);
        float a = n(uv * 2.0 + vec2(time * 0.3, time * 0.5)) * 0.6;
        #ifdef FULL
        a += n(uv * 5.0 - vec2(time * 0.4, 0.0)) * 0.4;
        #else
        a += 0.2;
        #endif
        float bands = smoothstep(0.5, 0.9, a);
        float rim = pow(1.0 - abs(vN.y), 3.0) * 0.5;
        float v = (bands + rim) * intensity;
        gl_FragColor = vec4(color, v);
        #include <colorspace_fragment>
      }`,
  });
}

// ---- Facade -----------------------------------------------------------------------------------------
export const fx = {
  sparks: null, shocks: [], scene: null,
  init(scene) { this.scene = scene; this.sparks = new Sparks(scene, FULL ? 400 : 200); },
  burst(p, color, count = 24, speed = 3) { this.sparks?.emit(p, color, count, speed); },
  shock(pos, dir, color, size = 5) {
    const mesh = new THREE.Mesh(domeGeo, shockMaterial(color));
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.scene.add(mesh);
    this.shocks.push({ mesh, t: 0, size });
  },
  update(dt) {
    this.sparks?.update(dt);
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i], p = (s.t += dt) / 0.55;
      s.mesh.scale.setScalar(0.3 + Math.min(p, 1) * s.size);
      s.mesh.material.uniforms.progress.value = Math.min(p, 1);
      if (p >= 1) { s.mesh.removeFromParent(); s.mesh.material.dispose(); this.shocks.splice(i, 1); }
    }
  },
};
