import * as THREE from 'three';
import { makeHalo } from './Effects.js';

// Spiral galaxy made of GPU-placed stars: every star is just an index, and its position along a spiral arm,
// size, brightness and colour are computed in the vertex/fragment shader (one draw call, no per-star data).
//
// Adapted from github.com/AmitDigga/threejs-galaxy-shader (MIT License, Copyright 2025 AMIT DIGGA): the spiral-arm
// placement (index -> arm, angle and radius with noise), the cubed-random point-size distribution (a few big stars,
// many dim ones), and the optional hollow centre. Changes for this project: colour is a blue / indigo / purple palette
// by radius with a warm bright core, point size is clamped for VR, camera-distance fade removed, the time term is
// slowed so the stars drift along the arms over minutes, and the whole galaxy gets a bright core + soft halo.
// MIT notice: https://github.com/AmitDigga/threejs-galaxy-shader/blob/main/LICENSE
const VERT = `
  uniform float u_pointSize; uniform float u_totalPoints; uniform float u_time; uniform float u_spiralCount; uniform float u_turns;
  uniform float u_hole; uniform float u_pxScale;
  attribute float a_index;
  varying float v_index; varying float v_radius; varying float v_bright;

  float rnd(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 noise3(float i){ return vec3(rnd(vec2(i)), rnd(vec2(i + 1.0)), rnd(vec2(i + 2.0))) * 2.0 - 1.0; }
  float r01(float i){ return rnd(vec2(i, i + 5.0)); }

  void main(){
    float pointsPerSpiral = floor(u_totalPoints / u_spiralCount);
    float spiralIndex = floor(a_index / pointsPerSpiral);
    float angleOffset = spiralIndex / u_spiralCount * 6.28318;
    float idx = mod(a_index, pointsPerSpiral);
    idx = mod(idx - mod(u_time, 1.0) * pointsPerSpiral, pointsPerSpiral);       // stars drift along their arm
    float rad = idx / pointsPerSpiral;
    float ang = rad * 6.28318 * u_turns + angleOffset;
    vec3 n = noise3(a_index) * 0.4;
    rad *= 1.0 + n.x * 0.5;                                                       // scatter in radius
    ang += n.y * 10.0 * 3.14159 / 180.0;                                          // scatter in angle
    float z = sin(n.z * 5.0 * 3.14159 / 180.0) * rad;                             // slight thickness
    vec3 full = noise3(a_index + 22.2) * 0.02;
    rad = max(rad, u_hole);                                                       // hollow centre (the core is a sprite)
    vec3 pos = vec3(cos(ang) * rad, sin(ang) * rad, z) + full;
    v_index = a_index; v_radius = clamp(rad, 0.0, 1.0);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    float scale = 4.0 * pow(r01(a_index + 7.0) + 0.1, 3.0) * pow(r01(a_index + 9.0) + 0.1, 3.0); // few big, many dim
    v_bright = 0.35 + 0.65 * r01(a_index + 3.0) + scale * 0.25;
    gl_PointSize = clamp(u_pointSize * scale * u_pxScale / max(-mv.z, 0.1), 1.6, 15.0);
  }`;

const FRAG = `
  uniform vec3 u_c0; uniform vec3 u_c1; uniform vec3 u_c2; uniform vec3 u_c3; uniform float u_fade;
  varying float v_index; varying float v_radius; varying float v_bright;
  void main(){
    vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p);
    if (d > 1.0) discard;
    float soft = pow(1.0 - d, 1.6);
    float t = clamp(v_radius, 0.0, 1.0) * 3.0;
    vec3 col = t < 1.0 ? mix(u_c0, u_c1, t) : t < 2.0 ? mix(u_c1, u_c2, t - 1.0) : mix(u_c2, u_c3, t - 2.0);
    gl_FragColor = vec4(col * v_bright, soft * u_fade);
    #include <colorspace_fragment>
  }`;

// count: number of stars. Returns a Group (add it to the scene, scale it to the galaxy's radius in meters, tilt it).
export function createGalaxy(count = 30000) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3)); // unused; positions come from the shader
  const idx = new Float32Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  geo.setAttribute('a_index', new THREE.BufferAttribute(idx, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      u_pointSize: { value: 120 }, u_totalPoints: { value: count }, u_time: { value: 0 }, u_spiralCount: { value: 3 }, u_turns: { value: 1.1 },
      u_hole: { value: 0.04 }, u_pxScale: { value: 1 }, u_fade: { value: 0 },
      u_c0: { value: new THREE.Color(1.0, 0.9, 0.72) },   // warm core
      u_c1: { value: new THREE.Color(0.55, 0.7, 1.0) },   // blue
      u_c2: { value: new THREE.Color(0.55, 0.3, 1.0) },   // purple
      u_c3: { value: new THREE.Color(0.22, 0.2, 0.8) },   // indigo rim
    },
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const group = new THREE.Group();
  group.add(points);
  const core = makeHalo(0xffe2b8, 0.28); core.material.opacity = 0.0; group.add(core);   // bright core (scaled by the group)
  const halo = makeHalo(0x6a56ff, 1.5); halo.material.opacity = 0.0; group.add(halo);     // soft disc glow
  return { group, mat, core, halo };
}
