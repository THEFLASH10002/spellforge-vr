import * as THREE from 'three';
import { QUALITY } from '../config/Quality.js';

// "Void" Sanctum sky: a dome that closes from the horizon up to the zenith with a glowing front, then stands
// sealed as a black sky with slowly turning, twinkling stars. Cheap: one inverted sphere, a few hash lookups
// per pixel, no ray-marching.
// Design inspired by the Nightfall ability in github.com/majidmanzarpour/threejs-vfx (MIT, (c) mohamedachrefelouafi):
// a dome that closes over the area from the rim inward and leaves a darker frame with a slow starfield. That
// repo renders it as a ray-marched volume, which is far too costly for Quest 2, so this is an original cheap rebuild.
const FULL = QUALITY.fx === 'full';

export function createVoidDome() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uFront: { value: -0.3 },
      uEdge: { value: new THREE.Color(0xb98cff) }, uTint: { value: new THREE.Color(0x120626) }, uStar: { value: new THREE.Color(0xdfe6ff) },
    },
    side: THREE.BackSide, transparent: true, depthWrite: false, fog: false, defines: FULL ? { FULL: 1 } : {},
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; uniform float uFront; uniform vec3 uEdge; uniform vec3 uTint; uniform vec3 uStar; varying vec3 vDir;
      vec3 h3(vec3 p){ p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
        return fract(sin(p) * 43758.5453); }
      // sparse stars: one candidate per cell, a fraction of cells hold a star with a random offset, size and twinkle
      float stars(vec3 d, float scale, float density, float size, float t){
        vec3 p = d * scale, c = floor(p), f = fract(p);
        vec3 r = h3(c);
        if (r.x > density) return 0.0;
        vec3 off = 0.25 + 0.5 * h3(c + 7.0);
        float dist = length(f - off);
        float tw = 0.65 + 0.35 * sin(t * (1.5 + 3.0 * r.y) + r.z * 6.283);
        return smoothstep(size, 0.0, dist) * tw * (0.5 + r.y);
      }
      void main(){
        vec3 d = normalize(vDir);
        float a = uTime * 0.02, s = sin(a), co = cos(a); // slow turn of the whole sky
        vec3 rd = vec3(d.x * co - d.z * s, d.y, d.x * s + d.z * co);
        // The dome closes from the rim (low) up to the zenith: covered below the front.
        float cover = 1.0 - smoothstep(uFront - 0.06, uFront + 0.02, d.y);
        float edge = exp(-abs(d.y - uFront) * 22.0) * step(uFront, 0.99);
        // inside the void: near-black with a faint violet horizon glow and a soft galactic band
        vec3 col = uTint * pow(1.0 - clamp(d.y, 0.0, 1.0), 3.0) * 1.2;
        col += vec3(0.35, 0.18, 0.55) * smoothstep(0.3, 0.0, abs(dot(rd, normalize(vec3(0.3, 0.8, 0.5))))) * 0.14;
        float st = stars(rd, 55.0, 0.18, 0.2, uTime) + stars(rd, 22.0, 0.10, 0.28, uTime * 0.7) * 1.4;
        #ifdef FULL
        st += stars(rd, 120.0, 0.3, 0.16, uTime * 1.3) * 0.6;
        #endif
        col += uStar * st;
        col += uEdge * edge * 1.6;                       // glowing closing front
        float alpha = clamp(cover + edge * 0.5, 0.0, 1.0);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), mat);
  mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = -1;
  return { mesh, mat };
}
