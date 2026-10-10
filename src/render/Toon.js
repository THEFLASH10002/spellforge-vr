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

// ---- Blossom glow + wind sway -------------------------------------------------------------------------
const avgCache = new WeakMap();
function averageColor(tex) {
  if (avgCache.has(tex)) return avgCache.get(tex);
  let out = null;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const g = c.getContext('2d'); g.drawImage(tex.image, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gr = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; r += d[i]; gr += d[i + 1]; b += d[i + 2]; n++; }
    if (n) out = [r / n, gr / n, b / n];
  } catch { /* unreadable texture: skip */ }
  avgCache.set(tex, out);
  return out;
}

// Give pinkish materials (blossoms) an emissive glow modulated by their own texture, so trunks stay dark.
export function applyGlow(root, { color = '#ff7ab8', intensity = 0.45 } = {}) {
  const mats = new Set();
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (m.userData.glowChecked) continue;
      m.userData.glowChecked = true;
      const avg = m.map ? averageColor(m.map) : (m.color ? [m.color.r * 255, m.color.g * 255, m.color.b * 255] : null);
      if (avg && avg[0] > avg[1] * 1.12 && avg[2] > avg[1] * 0.75) { // pink: red high, blue not low (excludes brown bark and green leaves)
        m.emissive = new THREE.Color(color);
        if (m.map) m.emissiveMap = m.map;
        m.emissiveIntensity = intensity;
        mats.add(m);
      }
    }
  });
  return [...mats];
}

// Wind sway for InstancedMesh materials. Needs an instanced attribute aBase = (groundY, heightMeters).
export function makeSway(material, timeUniform, amount = 0.35) {
  if (material.userData.sway) return;
  material.userData.sway = true;
  material.onBeforeCompile = shader => {
    shader.uniforms.uSwayTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aBase;\nuniform float uSwayTime;')
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        #endif
        vec4 wp = modelMatrix * mvPosition;
        float hh = clamp((wp.y - aBase.x) / aBase.y, 0.0, 1.0);
        float sw = hh * hh * ${amount.toFixed(3)};
        wp.x += sin(uSwayTime * 1.1 + wp.z * 0.25 + aBase.x) * sw;
        wp.z += cos(uSwayTime * 0.9 + wp.x * 0.25) * sw * 0.7;
        mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  material.customProgramCacheKey = () => 'sway' + amount;
  material.needsUpdate = true;
}
