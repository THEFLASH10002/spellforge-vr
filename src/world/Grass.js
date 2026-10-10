import * as THREE from 'three';
import { terrainHeight, PADS, FLAT, onPath } from './Terrain.js';

// Instanced grass: one draw call, procedural blades, wind sway in the vertex shader. No textures needed.
export class Grass {
  constructor(scene, count = 8000) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.045, 0, 0, 0.045, 0, 0, 0, 1, 0]), 3));
    geo.setAttribute('aTip', new THREE.BufferAttribute(new Float32Array([0, 0, 1]), 1));
    const off = new Float32Array(count * 3), rnd = new Float32Array(count * 2);
    let n = 0;
    while (n < count) {
      const x = (Math.random() - 0.5) * 100, z = (Math.random() - 0.5) * 100, r = Math.hypot(x, z);
      if (r < FLAT + 0.8 || r > 48 || onPath(x, z)) continue;
      if (PADS.some(p => Math.hypot(x - p.x, z - p.z) < p.r * 0.9)) continue;
      off.set([x, terrainHeight(x, z), z], n * 3);
      rnd.set([Math.random(), 0.45 + Math.random() * 0.55], n * 2);
      n++;
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
    geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 2));
    geo.instanceCount = count;

    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uWell: { value: new THREE.Vector4() }, uGlow: { value: new THREE.Vector4() }, uTint: { value: new THREE.Color(1.0, 0.92, 0.8) }, // warm sunset light
      uBase: { value: new THREE.Color(0x2f5e1e) }, uTip: { value: new THREE.Color(0x9ad258) },
    }]);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.DoubleSide, fog: true,
      vertexShader: `attribute vec3 aOffset; attribute vec2 aRand; attribute float aTip; uniform float uTime; uniform vec4 uWell; uniform vec4 uGlow;
        varying float vTip; varying float vShade; varying float vGlow;
        #include <fog_pars_vertex>
        void main(){
          float a = aRand.x * 6.2831; float s = sin(a), c = cos(a);
          vec3 p = position; p.y *= aRand.y * 0.9 + 0.2; float h = p.y;
          float w = sin(uTime * 1.7 + aOffset.x * 0.35 + aOffset.z * 0.27) * 0.2 * aTip * aTip * h;
          vec3 world = aOffset + vec3(p.x * c + w, p.y, -p.x * s + w * 0.5);
          vec2 dw = uWell.xz - aOffset.xz; // Gravity Well: blades lean toward the singularity
          float wf = uWell.w * smoothstep(8.0, 0.0, length(dw));
          world.xz += normalize(dw + vec2(0.0001)) * wf * 0.7 * aTip * aTip * h;
          world.y -= wf * 0.3 * aTip * h;
          vGlow = uGlow.w * smoothstep(9.0, 0.0, length(world - uGlow.xyz)); // blue spill from the Gravity Well
          vTip = aTip; vShade = 0.75 + aRand.x * 0.5;
          vec4 mvPosition = modelViewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform vec3 uTint; uniform vec3 uBase; uniform vec3 uTip; varying float vTip; varying float vShade; varying float vGlow;
        #include <fog_pars_fragment>
        void main(){
          vec3 col = mix(uBase, uTip, vTip) * uTint * vShade + vec3(0.08, 0.4, 1.0) * vGlow * (0.4 + 0.6 * vTip);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  update(t) { this.uniforms.uTime.value = t; }
}
