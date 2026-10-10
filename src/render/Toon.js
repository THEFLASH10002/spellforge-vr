import * as THREE from 'three';
import { QUALITY } from '../config/Quality.js';

// 3-step cel ramp shared by every toon material.
const ramp = new THREE.DataTexture(new Uint8Array([85, 165, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
ramp.needsUpdate = true;

export const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra });

// Inverted-hull outline for convex shapes (boxes, cylinders): same geometry, back faces, scaled up.
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x0b0714, side: THREE.BackSide });
export function addOutline(mesh, t = 0.025) {
  if (!QUALITY.outline) return null;
  mesh.geometry.computeBoundingBox();
  const s = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  o.scale.set(1 + (2 * t) / Math.max(s.x, 0.05), 1 + (2 * t) / Math.max(s.y, 0.05), 1 + (2 * t) / Math.max(s.z, 0.05));
  mesh.add(o);
  return o;
}

// Procedural cobblestone texture (greyscale; tinted by material color).
export function cobbleTexture(repeat = 20) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#7d8196'; g.fillRect(0, 0, 256, 256);
  const rows = 8, h = 256 / rows;
  for (let r = 0; r < rows; r++) {
    const cols = 6, w = 256 / cols, off = (r % 2) * w * 0.5;
    for (let k = -1; k < cols; k++) {
      const v = 150 + Math.floor(Math.random() * 90);
      g.fillStyle = `rgb(${v},${v},${v + 12})`;
      g.beginPath();
      g.roundRect(k * w + off + 3, r * h + 3, w - 6, h - 6, 8);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Soft radial glow sprite texture (for lantern halos).
export function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.35)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ---- GLB helpers ------------------------------------------------------------------------------------
const toonCache = new Map();

// Convert any imported materials to the toon ramp, keeping their color/maps.
export function toonify(root) {
  const conv = m => {
    if (m.isMeshToonMaterial) return m;
    let t = toonCache.get(m);
    if (!t) {
      t = new THREE.MeshToonMaterial({
        color: m.color ? m.color.clone() : 0xffffff, map: m.map, gradientMap: ramp,
        emissive: m.emissive ? m.emissive.clone() : 0x000000, emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity ?? 1,
        alphaTest: m.alphaTest, transparent: m.transparent, opacity: m.opacity, side: m.side, vertexColors: m.vertexColors,
      });
      toonCache.set(m, t);
    }
    return t;
  };
  root.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material); });
}

// Normal-extrusion outline for imported meshes (works best on smooth-shaded models).
// `t` is the outline width in WORLD meters; it is converted per mesh using that mesh's world scale
// (quantized/baked models carry large node scales, so a fixed local width would be wrong).
export function outlineHull(root, t = 0.02) {
  if (!QUALITY.outline) return;
  root.updateMatrixWorld(true);
  const base = new THREE.ShaderMaterial({
    uniforms: { thick: { value: t }, color: { value: new THREE.Color(0x0b0714) } }, side: THREE.BackSide,
    vertexShader: 'uniform float thick; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * thick, 1.0); }',
    fragmentShader: 'uniform vec3 color; void main(){ gl_FragColor = vec4(color, 1.0); }',
  });
  const meshes = [], ws = new THREE.Vector3();
  root.traverse(o => { if (o.isMesh && !o.isSkinnedMesh && !o.userData.isOutline && o.geometry.attributes.normal) meshes.push(o); });
  for (const m of meshes) {
    m.getWorldScale(ws);
    const mat = base.clone();
    mat.uniforms.thick.value = t / Math.max((ws.x + ws.y + ws.z) / 3, 1e-6);
    const h = new THREE.Mesh(m.geometry, mat); h.userData.isOutline = true; m.add(h);
  }
}
