import * as THREE from 'three';
import { terrainHeight } from '../world/Terrain.js';

// Glowing purple outline laid on the ground along a Nullpoint's path (terrain can't be cut, so we mark
// where it passed). A strip hugging the terrain: bright edges, faint fill, fades slowly once the orb is gone.
export class ScarTrail {
  constructor(scene, max = 200) {
    this.max = max; this.n = 0; this.fadeT = 0;
    const g = (this.geo = new THREE.BufferGeometry());
    this.pos = new Float32Array(max * 2 * 3);
    const uv = new Float32Array(max * 2 * 2), idx = [];
    for (let i = 0; i < max; i++) { uv.set([0, i, 1, i], i * 4); if (i < max - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uFade: { value: 1 }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uFade; uniform float uTime; varying vec2 vUv;
        void main(){
          float e = abs(vUv.x - 0.5) * 2.0;
          float edge = smoothstep(0.72, 0.95, e) * (1.0 - smoothstep(0.95, 1.0, e));
          float pulse = 0.8 + 0.2 * sin(uTime * 3.0 + vUv.y * 0.6);
          float a = (edge * 0.95 + 0.2) * uFade * pulse;
          gl_FragColor = vec4(mix(vec3(0.5, 0.1, 1.0), vec3(0.72, 0.3, 1.0), edge) * (0.8 + edge), a);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  // Add a cross-section at (x, z) for a path heading (dx, dz), `width` meters wide.
  add(x, z, dx, dz, width) {
    if (this.n >= this.max) return;
    const l = Math.hypot(dx, dz) || 1, px = -dz / l * width / 2, pz = dx / l * width / 2;
    const ax = x + px, az = z + pz, bx = x - px, bz = z - pz;
    this.pos.set([ax, terrainHeight(ax, az) + 0.08, az, bx, terrainHeight(bx, bz) + 0.08, bz], this.n * 6);
    this.n++;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, this.n - 1) * 6);
    this.fadeT = 0;
  }

  update(dt, t, active) {
    this.mat.uniforms.uTime.value = t;
    if (this.n === 0) return;
    if (!active) this.fadeT += dt;
    this.mat.uniforms.uFade.value = Math.max(0, 1 - this.fadeT / 25); // lingers ~25 s
    if (this.fadeT >= 25) this.reset();
  }

  reset() { this.n = 0; this.fadeT = 0; this.geo.setDrawRange(0, 0); this.mat.uniforms.uFade.value = 1; }
}
