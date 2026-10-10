import * as THREE from 'three';
import { QUALITY } from '../config/Quality.js';

// "Void" Sanctum sky dome: closes from the horizon up to the zenith with a glowing front, then stands sealed as the
// distant backdrop of the cosmos: a baked nebula (see NebulaBake.js), varied-colour clustered stars with a few bright
// ones, a celestial horizon glow, a ringed planet and a moon. One inverted sphere, no ray-marching.
// The closing-dome idea is inspired by the Nightfall ability in github.com/majidmanzarpour/threejs-vfx (MIT,
// (c) mohamedachrefelouafi); that repo ray-marches it, which is too costly for Quest 2, so this is an original cheap rebuild.
const FULL = QUALITY.fx === 'full';

// nebula: a THREE.Texture (equirectangular). encoded: true if it is the gamma-encoded bake (decoded with pow 2.2).
export function createVoidDome(nebula, encoded = true) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uFront: { value: -0.3 }, uNebula: { value: nebula }, uEncoded: { value: encoded ? 1 : 0 }, uNebulaK: { value: 1 },
      uEdge: { value: new THREE.Color(0xb98cff) }, uHorizon: { value: new THREE.Color(0x8a5cff) },
    },
    side: THREE.BackSide, transparent: true, depthWrite: false, fog: false, defines: FULL ? { FULL: 1 } : {},
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; uniform float uFront; uniform sampler2D uNebula; uniform float uEncoded; uniform float uNebulaK;
      uniform vec3 uEdge; uniform vec3 uHorizon; varying vec3 vDir;

      vec3 h3(vec3 p){ p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
        return fract(sin(p) * 43758.5453); }
      vec3 starColor(float t){ // temperature: hot blue-white -> white -> warm orange
        return mix(mix(vec3(0.6, 0.75, 1.0), vec3(1.0), smoothstep(0.0, 0.5, t)), vec3(1.0, 0.78, 0.55), smoothstep(0.55, 1.0, t));
      }
      // One star candidate per cell. Density is modulated by coarse "cluster" cells, brightness follows a power law
      // (most dim, few bright), colour by temperature, bright stars get a halo and spikes, everything twinkles.
      vec3 stars(vec3 d, float scale, float density, float size, float t){
        vec3 p = d * scale, c = floor(p), f = fract(p), r = h3(c);
        float clump = h3(floor(d * 5.0)).x;
        density *= 0.35 + 1.8 * clump * clump;
        if (r.x > density) return vec3(0.0);
        vec3 off = 0.25 + 0.5 * h3(c + 7.0);
        vec3 q = f - off; float dist = length(q);
        float tw = 0.65 + 0.35 * sin(t * (1.5 + 3.0 * r.y) + r.z * 6.283);
        float bright = 0.25 + pow(r.y, 4.0) * 3.5;
        float core = smoothstep(size, 0.0, dist);
        float halo = smoothstep(size * 1.7, 0.0, dist) * step(0.9, r.y) * 0.45; // radii kept inside the cell (bigger gets clipped into squares)
        float spike = (smoothstep(size * 0.18, 0.0, abs(q.x)) + smoothstep(size * 0.18, 0.0, abs(q.y))) * smoothstep(size * 1.8, 0.0, dist) * step(0.95, r.y) * 0.6;
        return starColor(h3(c + 3.0).x) * (core + halo + spike) * tw * bright;
      }

      void main(){
        vec3 d = normalize(vDir);
        float a = uTime * 0.02, s = sin(a), co = cos(a);                       // slow turn of the sky
        vec3 rd = vec3(d.x * co - d.z * s, d.y, d.x * s + d.z * co);
        float cover = 1.0 - smoothstep(uFront - 0.06, uFront + 0.02, d.y);
        float edge = exp(-abs(d.y - uFront) * 22.0) * step(uFront, 0.99);

        // baked nebula
        vec2 uv = vec2(atan(rd.z, rd.x) / 6.2831853 + 0.5, asin(clamp(rd.y, -1.0, 1.0)) / 3.1415927 + 0.5);
        vec3 nb = texture2D(uNebula, uv).rgb; if (uEncoded > 0.5) nb = pow(nb, vec3(2.2));
        vec3 col = nb * uNebulaK;

        // stars: three depth layers, more in FULL
        vec3 st = stars(rd, 55.0, 0.18, 0.2, uTime) + stars(rd, 22.0, 0.10, 0.28, uTime * 0.7) * 1.4;
        #ifdef FULL
        st += stars(rd, 120.0, 0.3, 0.16, uTime * 1.3) * 0.6;
        #endif
        col += st;

        // celestial horizon: a luminous band, a thin bright line, and distant pillars of light
        float hz = exp(-abs(d.y - 0.03) * 11.0), line = exp(-abs(d.y - 0.005) * 90.0);
        float pillars = pow(max(0.0, sin(atan(d.z, d.x) * 9.0 + 1.0) * 0.5 + 0.5), 6.0) * exp(-d.y * 5.0) * smoothstep(-0.05, 0.1, d.y) * 0.25;
        col += uHorizon * (hz * 0.55 + line * 0.9 + pillars);

        // ringed gas giant low on the horizon
        {
          vec3 pc = normalize(vec3(-0.62, 0.21, -0.75)); float r0 = 0.12;
          vec3 t1 = normalize(cross(vec3(0.0, 1.0, 0.0), pc)), t2 = cross(pc, t1);
          vec2 lp = vec2(dot(d, t1), dot(d, t2)) / r0; float ang = acos(clamp(dot(d, pc), -1.0, 1.0));
          float disc = smoothstep(r0, r0 - 0.004, ang);
          vec3 nrm = vec3(lp, sqrt(max(0.0, 1.0 - dot(lp, lp))));
          float lit = clamp(dot(nrm, normalize(vec3(0.7, 0.45, 0.6))) * 0.9 + 0.12, 0.0, 1.0);
          vec3 band = mix(vec3(0.25, 0.18, 0.7), vec3(0.65, 0.35, 0.95), 0.5 + 0.5 * sin(lp.y * 11.0 + sin(lp.x * 3.0) * 0.8));
          vec3 planet = band * lit;
          float rim = exp(-(ang - r0) * 70.0) * step(r0, ang) * 0.9;           // atmosphere glow
          float rr = length(vec2(lp.x, lp.y / 0.24));
          float ring = smoothstep(1.45, 1.5, rr) * smoothstep(2.45, 2.3, rr) * (0.35 + 0.4 * sin(rr * 40.0)) * (1.0 - disc * step(0.0, lp.y))
            * step(0.0, dot(d, pc)) * smoothstep(r0 * 2.8, r0 * 2.3, ang); // only near the planet (not a band around the whole sky)
          col = mix(col, planet, disc) + vec3(0.55, 0.4, 1.0) * rim + vec3(0.7, 0.6, 1.0) * ring * 0.55;
        }
        // small pale moon
        {
          vec3 mc = normalize(vec3(0.7, 0.38, -0.6)); float ang = acos(clamp(dot(d, mc), -1.0, 1.0));
          float disc = smoothstep(0.048, 0.044, ang), halo = exp(-(ang - 0.04) * 40.0) * step(0.04, ang) * 0.5;
          col = mix(col, vec3(0.75, 0.82, 1.0) * (0.6 + 0.4 * smoothstep(0.048, -0.02, dot(d - mc, vec3(-0.6, 0.4, 0.5)))), disc) + vec3(0.4, 0.5, 1.0) * halo;
        }

        col += uEdge * edge * 1.6;                                              // glowing closing front
        float alpha = clamp(cover + edge * 0.5, 0.0, 1.0);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), mat);
  mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = -1;
  return { mesh, mat };
}
