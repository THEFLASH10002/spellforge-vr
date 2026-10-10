import * as THREE from 'three';
import { toon } from '../render/Toon.js';

// Map: flat training ground at the center (r < FLAT), a slope rising to a plateau (the town),
// then rolling hills as a backdrop. Everything that needs ground height calls terrainHeight().
export const FLAT = 10.5, RISE_END = 18, PLATEAU = 3.6;

// Flattened building pads on the plateau (x, z, radius).
export const PADS = [
  { x: -9, z: -22, r: 8 },   // machiya (destructible)
  { x: 9, z: -21, r: 5 },    // pagoda (destructible)
  { x: -24, z: -6, r: 6 }, { x: 24, z: -5, r: 6 }, { x: -16, z: 18, r: 6 }, { x: 17, z: 17, r: 6 }, // village homes
];

const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
export function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return lerp(lerp(hash(i, j), hash(i + 1, j), u), lerp(hash(i, j + 1), hash(i + 1, j + 1), u), v);
}

// Ground without pads. The arena (r < FLAT) is dead flat at y = 0; from there the land rises gently and
// unevenly (higher toward the town ahead, low behind) so the arena reads as a clearing, not a pit.
function baseHeight(x, z) {
  const r = Math.hypot(x, z);
  const front = 0.5 + 0.5 * Math.cos(Math.atan2(x, -z)); // 1 straight ahead (the town), 0 behind
  const peak = 0.9 + 2.3 * front * front;                 // ~3.2 m ahead, ~0.9 m behind
  const t = ss(FLAT, 32, r);                              // long, gentle rise
  let y = t * peak + t * (vnoise(x * 0.07, z * 0.07) - 0.5) * 1.4;
  y += ss(34, 56, r) * (5 + vnoise(x * 0.05 + 9, z * 0.05) * 7); // backdrop hills farther out
  return y;
}

export function terrainHeight(x, z) {
  let y = baseHeight(x, z);
  for (const p of PADS) { // flatten building pads to the local ground level at their centre
    const m = 1 - ss(p.r, p.r + 4, Math.hypot(x - p.x, z - p.z));
    if (m > 0) y = lerp(y, baseHeight(p.x, p.z), m);
  }
  return y;
}

export const onPath = (x, z) => z < -10 && z > -21 && Math.abs(x) < 1.7; // stone path from the arena to the town

export function buildTerrain(physics, scene, seg = 80, size = 110) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), dirt = new THREE.Color(0xa88c5c), grassA = new THREE.Color(0x3c6e26),
    grassB = new THREE.Color(0x66a03a), rock = new THREE.Color(0x6a6a74), stone = new THREE.Color(0x8c8880);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = terrainHeight(x, z);
    pos.setY(i, y);
    const slope = Math.hypot(terrainHeight(x + 1, z) - y, terrainHeight(x, z + 1) - y);
    const n = vnoise(x * 0.35, z * 0.35), r = Math.hypot(x, z);
    c.copy(grassA).lerp(grassB, n);
    if (y > 8) c.multiplyScalar(0.8);
    c.lerp(rock, ss(0.8, 1.5, slope));
    if (onPath(x, z)) c.lerp(stone, 0.85);
    c.lerp(dirt.clone().multiplyScalar(0.9 + n * 0.2), 1 - ss(FLAT - 0.4, FLAT + 1.6, r)); // training ground
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, toon(0xffffff, { vertexColors: true }));

  const R = physics.R;
  physics.world.createCollider(R.ColliderDesc.trimesh(Float32Array.from(pos.array), Uint32Array.from(g.index.array)).setFriction(0.9));
  scene.add(mesh);
  return mesh;
}

// Painted sigil circle + stone boundary for the training ground.
export function buildTrainingGround(scene) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(240,226,190,0.7)'; g.lineWidth = 8;
  [[250, 8], [205, 5], [120, 5]].forEach(([r, w]) => { g.lineWidth = w; g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.stroke(); });
  g.lineWidth = 5;
  const pts = Array.from({ length: 8 }, (_, i) => [256 + Math.cos((i / 8) * Math.PI * 2) * 205, 256 + Math.sin((i / 8) * Math.PI * 2) * 205]);
  for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(...pts[i]); g.lineTo(...pts[(i + 3) % 8]); g.stroke(); } // octagram
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const decal = new THREE.Mesh(new THREE.CircleGeometry(5.5, 48), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  decal.rotation.x = -Math.PI / 2; decal.position.y = 0.03;
  const ring = new THREE.Mesh(new THREE.RingGeometry(FLAT - 0.5, FLAT, 64), new THREE.MeshBasicMaterial({ color: 0x3a3028, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
  scene.add(decal, ring);
}
