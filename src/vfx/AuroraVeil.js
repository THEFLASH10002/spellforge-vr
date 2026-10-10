import * as THREE from 'three';

// Hanging curtains of light in a ring around the player (the Star Void sky). One InstancedMesh, one draw call.
// Technique from AuroraAbility / Curtain in github.com/majidmanzarpour/threejs-vfx (MIT, (c) mohamedachrefelouafi):
// a sheet's coverage (alpha) and brightness (emission) fade up the sheet on DIFFERENT curves, so the top is bright
// yet see-through, like light in air, and vertical rays come from noise along the sheet's length. Rebuilt here as a cheap
// original shader (two-octave value noise, no scene-depth fade) for Quest 2.
const COUNT = 9;

export function createAuroraVeil() {
  const geo = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1, 1, 16);
  geo.setIndex(base.index); geo.setAttribute('position', base.attributes.position); geo.setAttribute('uv', base.attributes.uv);
  const ring = new Float32Array(COUNT * 4), look = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.3, r = 24 + Math.random() * 6;
    ring.set([a, r, 6 + Math.random() * 5, Math.random()], i * 4);                       // angle, radius, base height, seed
    look.set([18 + Math.random() * 10, 14 + Math.random() * 8, Math.random(), 0], i * 4); // width, height, hue mix
  }
  geo.setAttribute('aRing', new THREE.InstancedBufferAttribute(ring, 4));
  geo.setAttribute('aLook', new THREE.InstancedBufferAttribute(look, 4));
  geo.instanceCount = COUNT;

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFade: { value: 0 }, uA: { value: new THREE.Color(0x35e0c0) }, uB: { value: new THREE.Color(0xa050ff) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: `attribute vec4 aRing; attribute vec4 aLook; uniform float uTime; varying vec2 vUv; varying float vSeed; varying float vHue;
      void main(){
        vUv = uv; vSeed = aRing.w; vHue = aLook.z;
        float a = aRing.x, r = aRing.y;
        vec3 centre = vec3(cos(a) * r, aRing.z, sin(a) * r);
        vec3 tangent = vec3(-sin(a), 0.0, cos(a)), inward = vec3(-cos(a), 0.0, -sin(a));
        vec2 ext = (uv - 0.5) * vec2(aLook.x, aLook.y);
        float fold = sin(ext.x * 0.35 + uTime * 0.4 + aRing.w * 9.0) * 1.8 + sin(ext.x * 0.9 - uTime * 0.7) * 0.5; // slow ripple in and out
        float sway = sin(uTime * 0.25 + aRing.w * 5.0) * 2.0;
        vec3 world = centre + tangent * (ext.x + sway) + inward * fold * (0.4 + uv.y) + vec3(0.0, uv.y * aLook.y, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: `uniform float uTime; uniform float uFade; uniform vec3 uA; uniform vec3 uB; varying vec2 vUv; varying float vSeed; varying float vHue;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main(){
        float up = vUv.y;                                   // 0 = hanging base, 1 = top
        float ray = n(vec2(vUv.x * 16.0 + vSeed * 7.0, uTime * 0.5)) * 0.6 + n(vec2(vUv.x * 38.0 + vSeed * 3.0, uTime * 1.0)) * 0.4;
        // coverage and brightness ride DIFFERENT curves: the top is bright yet nearly see-through
        float alpha = mix(0.04, 0.9, pow(1.0 - up, 2.6)) * (0.3 + 0.7 * ray);
        float emis = mix(0.9, 1.4, pow(1.0 - up, 0.55));
        float edge = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
        vec3 col = mix(uA, uB, clamp(up * 1.2 + vHue * 0.4, 0.0, 1.0));
        float k = alpha * edge * uFade;
        gl_FragColor = vec4(col * emis * k, k);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 2;
  return { mesh, mat };
}
