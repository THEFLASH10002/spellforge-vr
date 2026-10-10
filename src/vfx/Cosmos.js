import * as THREE from 'three';
import { QUALITY } from '../config/Quality.js';
import { bakeNebula } from './NebulaBake.js';
import { createGalaxy } from './GalaxyPoints.js';
import { terrainHeight } from '../world/Terrain.js';

// The Star Void's layered universe, all cheap and mostly stateless-GPU:
//   baked nebula (sampled by the sky dome) -> spiral galaxy overhead (MIT-derived, see GalaxyPoints.js)
//   -> close star motes in WORLD space (real head-motion parallax) -> drifting dust -> luminous ribbons
//   -> a cosmic mist floor that hugs the terrain, with a glowing sigil in the arena.
const ADD = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false };
const PX = 750; // approx pixels per meter of point size at 1 m (headset eye buffer)
const TAU = Math.PI * 2;

const STAR_COLOR = `vec3 starCol(float t){ return mix(mix(vec3(0.6, 0.75, 1.0), vec3(1.0), smoothstep(0.0, 0.5, t)), vec3(1.0, 0.78, 0.55), smoothstep(0.55, 1.0, t)); }`;

// ---- close star motes: fixed world positions around the player, so moving your head shifts them against the sky ----
function nearStars(count) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const r = 5 + Math.pow(Math.random(), 1.6) * 24, th = Math.random() * TAU, y = 0.6 + Math.random() * 20 * (1 - r / 40);
    pos.set([Math.cos(th) * r, y, Math.sin(th) * r], i * 3);
    seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFade: { value: 0 } }, ...ADD,
    vertexShader: `attribute vec4 aSeed; uniform float uTime; uniform float uFade; varying vec3 vCol; varying float vA;
      ${STAR_COLOR}
      void main(){
        vec3 p = position; float r = length(p.xz);
        float ang = uTime * 0.012 * (24.0 / (r + 4.0)); float s = sin(ang), c = cos(ang);   // closer stars drift faster
        p = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        float size = mix(0.035, 0.2, pow(aSeed.x, 3.0));
        gl_PointSize = clamp(size * ${PX.toFixed(1)} / max(-mv.z, 0.1), 1.5, 13.0);
        vCol = starCol(aSeed.y) * (0.6 + 0.8 * aSeed.x);
        vA = uFade * (0.55 + 0.45 * sin(uTime * (1.0 + aSeed.z * 3.0) + aSeed.w * 6.283));
      }`,
    fragmentShader: `varying vec3 vCol; varying float vA;
      void main(){
        vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p);
        if (d > 1.0) discard;
        gl_FragColor = vec4(vCol, pow(1.0 - d, 1.8) * vA);
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false;
  return { obj: pts, mat };
}

// ---- cosmic dust: motes drifting and slowly rising around the player ----
function dust(count) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const r = 1.5 + Math.sqrt(Math.random()) * 13, th = Math.random() * TAU;
    pos.set([Math.cos(th) * r, Math.random() * 7, Math.sin(th) * r], i * 3);
    seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFade: { value: 0 } }, ...ADD,
    vertexShader: `attribute vec4 aSeed; uniform float uTime; uniform float uFade; varying vec3 vCol; varying float vA;
      void main(){
        vec3 p = position;
        p.y = 0.4 + mod(position.y + uTime * (0.05 + 0.1 * aSeed.x), 7.0);
        p.xz += 0.9 * vec2(sin(uTime * 0.21 + aSeed.y * 6.283), cos(uTime * 0.17 + aSeed.z * 6.283));
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((0.03 + 0.06 * aSeed.w) * ${PX.toFixed(1)} / max(-mv.z, 0.1), 1.5, 9.0);
        vCol = mix(vec3(0.35, 0.5, 1.0), vec3(0.75, 0.4, 1.0), aSeed.y);
        vA = uFade * 0.55 * (0.5 + 0.5 * sin(uTime * 1.3 + aSeed.z * 20.0)) * smoothstep(0.0, 1.2, p.y) * smoothstep(7.4, 5.0, p.y);
      }`,
    fragmentShader: `varying vec3 vCol; varying float vA;
      void main(){
        vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p);
        if (d > 1.0) discard;
        gl_FragColor = vec4(vCol, pow(1.0 - d, 2.0) * vA);
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false;
  return { obj: pts, mat };
}

// ---- luminous ribbons: comet-like streaks of light looping around the player (one draw call) ----
function ribbons(count) {
  const N = 48, verts = [], idx = [];
  for (let i = 0; i <= N; i++) { const t = i / N; verts.push(-1, t, 0, 1, t, 0); }
  for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  g.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFade: { value: 0 } }, ...ADD, side: THREE.DoubleSide,
    vertexShader: `attribute vec4 aSeed; uniform float uTime; uniform float uFade; varying float vT; varying float vA; varying float vHue;
      vec3 curve(float s, vec4 sd){
        float ang = s * 0.35 + sd.x * 6.2832, rad = 7.0 + sd.y * 6.0 + sin(s * 0.5 + sd.z * 6.0) * 2.0;
        float h = 1.6 + sd.z * 4.5 + sin(s * 0.8 + sd.w * 6.0) * 1.4;
        return vec3(cos(ang) * rad, h, sin(ang) * rad);
      }
      void main(){
        float t = position.y;
        float s = uTime * (0.6 + aSeed.w * 0.5) + (t - 1.0) * 3.0;        // head at t = 1, tail trails behind
        vec3 P = curve(s, aSeed), tangent = normalize(curve(s + 0.05, aSeed) - P);
        vec3 side = normalize(cross(tangent, normalize(cameraPosition - P)));
        float w = 0.1 * pow(sin(3.14159 * t), 0.8) + 0.01;
        gl_Position = projectionMatrix * viewMatrix * vec4(P + side * position.x * w, 1.0);
        vT = t; vHue = aSeed.x; vA = pow(sin(3.14159 * t), 1.4) * uFade;
      }`,
    fragmentShader: `varying float vT; varying float vA; varying float vHue;
      void main(){
        vec3 col = mix(vec3(0.2, 0.8, 1.0), vec3(0.75, 0.3, 1.0), vHue) * (0.5 + 1.2 * vT);
        gl_FragColor = vec4(col * vA, vA * 0.8);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false;
  return { obj: mesh, mat };
}

// ---- cosmic floor: swirling mist hugging the terrain + a glowing sigil on the arena ----
function floor() {
  const size = 96, seg = 64, g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, terrainHeight(p.getX(i), p.getZ(i)) + 0.18); // hug the ground
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFade: { value: 0 } }, ...ADD, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; uniform float uFade; varying vec3 vP;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main(){
        float r = length(vP.xz), ang = atan(vP.z, vP.x);
        vec2 q = vP.xz * 0.11 + vec2(uTime * 0.02, -uTime * 0.015);
        float mist = n(q) * 0.55 + n(q * 2.3 - uTime * 0.03) * 0.3 + n(q * 5.0 + uTime * 0.05) * 0.15;
        float m = smoothstep(0.35, 0.9, mist);
        // arena sigil: concentric rings, eight spokes, a slowly counter-rotating star
        float rings = exp(-abs(r - 2.4) * 16.0) + exp(-abs(r - 5.4) * 16.0) + exp(-abs(r - 8.4) * 16.0) + exp(-abs(r - 10.3) * 18.0);
        float spokes = pow(abs(cos(ang * 4.0 + uTime * 0.1)), 40.0) * smoothstep(10.4, 9.6, r) * smoothstep(1.5, 2.5, r);
        float star = pow(abs(cos(ang * 4.0 - uTime * 0.15 + 0.39)), 60.0) * smoothstep(8.6, 8.0, r) * smoothstep(2.6, 3.2, r);
        float pulse = 0.75 + 0.25 * sin(uTime * 1.2 - r * 0.5);
        float sigil = (rings * 0.9 + spokes * 0.5 + star * 0.6) * smoothstep(11.0, 10.2, r) * pulse;
        float sp = step(0.994, h(floor(vP.xz * 5.0))) * (0.5 + 0.5 * sin(uTime * 3.0 + h(floor(vP.xz * 5.0)) * 20.0)); // sparkles in the mist
        vec3 col = mix(vec3(0.12, 0.2, 0.7), vec3(0.5, 0.2, 0.9), n(q * 1.7)) * m * 0.7 + vec3(0.45, 0.75, 1.0) * sigil + vec3(0.8, 0.7, 1.0) * sp * 0.8;
        float a = (m * 0.4 + sigil * 0.8 + sp * 0.6) * smoothstep(46.0, 12.0, r) * uFade;
        gl_FragColor = vec4(col * uFade, a);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false;
  return { obj: mesh, mat };
}

const smooth = x => x * x * (3 - 2 * x);
const clamp01 = x => Math.min(1, Math.max(0, x));

export class Cosmos {
  constructor({ scene, renderer, assets }) {
    const q = QUALITY.cosmos;
    // Nebula: a texture the user dropped in (manifest "textures.nebula") wins; otherwise bake one now (one-time cost).
    const custom = assets?.textures?.nebula;
    this.nebula = custom || bakeNebula(renderer, q.nebula, q.nebula / 2);
    this.nebulaEncoded = !custom;

    this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    this.galaxy = createGalaxy(q.galaxy);
    this.galaxy.group.position.set(0, 40, -26); this.galaxy.group.scale.setScalar(34); this.galaxy.group.rotation.x = 1.0; // tilted to face the player
    this.galaxy.mat.uniforms.u_pxScale.value = PX / 1200; // original shader convention: px scale relative to 1200
    this.group.add(this.galaxy.group);
    this.near = nearStars(q.near); this.dust = dust(q.dust); this.ribbons = ribbons(q.ribbons); this.floor = floor();
    this.parts = [this.near, this.dust, this.ribbons, this.floor];
    for (const p of this.parts) this.group.add(p.obj);
    this.floor.obj.renderOrder = 1; this.t = 0;
  }

  setVisible(v) { this.group.visible = v; }

  // fade: 0..1 (how much of the cosmos has appeared).
  update(dt, t, fade) {
    this.t = t;
    const f = smooth(clamp01(fade));
    for (const p of this.parts) { p.mat.uniforms.uTime.value = t; p.mat.uniforms.uFade.value = f; }
    const gm = this.galaxy.mat.uniforms;
    gm.u_time.value = t * 0.004; gm.u_fade.value = f;                     // stars drift along the arms over minutes
    this.galaxy.group.children[0].rotation.z += dt * 0.006;               // and the whole disc turns very slowly
    this.galaxy.core.material.opacity = 0.9 * f; this.galaxy.halo.material.opacity = 0.35 * f;
  }
}
