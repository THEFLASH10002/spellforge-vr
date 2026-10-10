import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon, makeSway, glowTexture } from '../render/Toon.js';
import { terrainHeight, PADS, FLAT, onPath } from './Terrain.js';
import { Petals } from './Petals.js';
import { QUALITY } from '../config/Quality.js';

const DEG = 180 / Math.PI;
const MOOD_DARK = new THREE.Color(0x0a1438), MOOD_BLUE = new THREE.Color(0x5aa0ff);
let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const ringPt = (deg, r) => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r];
const blocked = (x, z, pad = 3) => Math.hypot(x, z) < FLAT + 1.5 || onPath(x, z) || PADS.some(p => Math.hypot(x - p.x, z - p.z) < p.r + pad);
const pt = (x, z, rot, s = 1) => [x, z, rot, s, terrainHeight(x, z)];

// Tree sites in priority order (the first QUALITY.trees are used): arena rim, path flanks, behind
// buildings, then hills.
function treeSites() {
  const rim = [[35, 13.5], [70, 14.5], [110, 13], [150, 14], [200, 13.5], [235, 14.5], [285, 13], [320, 14]].map(([a, r]) => ringPt(a, r));
  const rest = [[-4.5, -15], [4.8, -16.5], [0, -27], [-17, -27], [15, -26], [-10, 27], [8, 29], [-28, 10], [29, 12], [-30, -20], [31, -18], [0, 35], [-22, 29]];
  return [...rim, ...rest].map(([x, z]) => pt(x, z, rand() * 360, 0.85 + rand() * 0.45));
}

const mergedBox = parts => mergeGeometries(parts.map(([w, h, d, x, y, z]) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)));

export class Environment {
  constructor({ scene, assets, grass }) {
    this.scene = scene; this.assets = assets; this.grass = grass;
    this.grassBase = grass.uniforms.uTint.value.clone();
    this.wellPos = new THREE.Vector3(); this.wellK = 0; this.wellT = 0;

    // --- Cherry blossoms: GLB trees (glow + sway + variation come from the manifest), halos, petals ---
    const trees = treeSites().slice(0, QUALITY.trees);
    assets.scatter(scene, 'tree', trees, { fitHeight: 6, eraseRadius: 2.2, sway: true, vary: true, glow: { color: '#ff7ab8', intensity: 0.45 } });
    this.treeMats = assets.glowMats;
    this.baseEmissive = new THREE.Color(assets.manifest.slots.tree?.glow?.color || '#ff7ab8');
    this.haloMat = new THREE.SpriteMaterial({ map: glowTexture(), color: this.baseEmissive.clone(), opacity: 0.22, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    if (assets.raw.tree) { // fake bloom: one soft additive halo behind each crown (no post-processing)
      for (const [x, z, , s, y] of trees) { const h = new THREE.Sprite(this.haloMat); h.position.set(x, y + 4.2 * s, z); h.scale.setScalar(9 * s); scene.add(h); }
    }
    this.petals = new Petals(scene, QUALITY.petals, trees);

    // --- Props: GLB if the slot exists in the manifest, else a cheap procedural stand-in ---
    const k = QUALITY.props;
    const keep = (arr) => arr.slice(0, Math.max(1, Math.round(arr.length * k)));
    const wood = toon(0x7a5636), stone = toon(0x8d8a96);

    // Fence ring around the arena (gap where the path leaves).
    const fence = [];
    for (let a = 0; a < 360; a += 10) { if (a > 252 && a < 288) continue; const [x, z] = ringPt(a, 11.2); fence.push(pt(x, z, a + 90)); }
    this.prop('fence', mergedBox([[0.1, 1.0, 0.1, -1, 0.5, 0], [0.1, 1.0, 0.1, 1, 0.5, 0], [2.0, 0.08, 0.06, 0, 0.8, 0], [2.0, 0.08, 0.06, 0, 0.45, 0]]), wood, fence, { fitHeight: 1.0 });

    // Stone lanterns flanking the path.
    const sl = [];
    [-11.5, -15.5, -19.5].forEach(z => { sl.push(pt(-2.6, z, 0), pt(2.6, z, 0)); });
    this.prop('stone_lantern', mergedBox([[0.55, 0.15, 0.55, 0, 0.075, 0], [0.2, 0.6, 0.2, 0, 0.45, 0], [0.5, 0.42, 0.5, 0, 0.96, 0], [0.7, 0.12, 0.7, 0, 1.23, 0], [0.3, 0.15, 0.3, 0, 1.36, 0]]), stone, sl, { fitHeight: 1.45 });

    // Bushes and rocks scattered on slopes/plateau/hills.
    const bushes = [], rocks = [];
    while (bushes.length < 40) { const x = (rand() - 0.5) * 80, z = (rand() - 0.5) * 80; if (!blocked(x, z, 1) && Math.hypot(x, z) < 42) bushes.push(pt(x, z, rand() * 360, 0.7 + rand() * 0.9)); }
    while (rocks.length < 30) { const x = (rand() - 0.5) * 80, z = (rand() - 0.5) * 80; if (!blocked(x, z, 0.5) && Math.hypot(x, z) < 44) rocks.push(pt(x, z, rand() * 360, 0.5 + rand() * 1.1)); }
    this.prop('bush', new THREE.IcosahedronGeometry(0.6, 1).translate(0, 0.35, 0), toon(0x4a8a3c, { flatShading: true }), keep(bushes), { fitHeight: 1.0, vary: true });
    this.prop('rock', new THREE.DodecahedronGeometry(0.7, 0).scale(1, 0.65, 1), toon(0x7a7482, { flatShading: true }), keep(rocks), { fitHeight: 0.8, vary: true });

    // Small clutter near the arena rim.
    const barrels = [ringPt(118, 12.6), ringPt(124, 12.4), ringPt(121, 13.4)].map(([x, z]) => pt(x, z, rand() * 360));
    const crates = [ringPt(58, 12.6), ringPt(64, 12.4), ringPt(61, 13.3)].map(([x, z]) => pt(x, z, rand() * 90));
    const benches = [ringPt(200, 9.2), ringPt(340, 9.2)].map(([x, z]) => pt(x, z, Math.atan2(-x, -z) * DEG + 90));
    this.prop('barrel', new THREE.CylinderGeometry(0.32, 0.3, 0.8, 8).translate(0, 0.4, 0), toon(0x8a6038), barrels, { fitHeight: 0.8 });
    this.prop('crate', new THREE.BoxGeometry(0.6, 0.6, 0.6).translate(0, 0.3, 0), toon(0x9a7444), crates, { fitHeight: 0.6 });
    this.prop('bench', mergedBox([[1.4, 0.08, 0.4, 0, 0.45, 0], [0.08, 0.45, 0.36, -0.6, 0.22, 0], [0.08, 0.45, 0.36, 0.6, 0.22, 0]]), wood, benches, { fitHeight: 0.55 });
    this.prop('signboard', mergedBox([[0.08, 1.6, 0.08, 0, 0.8, 0], [0.9, 0.5, 0.06, 0, 1.35, 0]]), wood, [pt(-3.4, -10.8, 15)], { fitHeight: 1.6 });

    // Bamboo groves (procedural unless a "bamboo" GLB slot exists); sways in the wind.
    const bamboo = [];
    [[-18, -14], [20, 12]].forEach(([cx, cz]) => { for (let i = 0; i < 28; i++) { const x = cx + (rand() - 0.5) * 8, z = cz + (rand() - 0.5) * 8; bamboo.push(pt(x, z, 0, 0.8 + rand() * 0.6)); } });
    if (assets.raw.bamboo) assets.scatter(scene, 'bamboo', keep(bamboo), { fitHeight: 6, sway: true });
    else this.swayInstances(new THREE.CylinderGeometry(0.045, 0.055, 6, 5).translate(0, 3, 0), toon(0x68a04a), keep(bamboo), 6);

    // Distant mountain silhouettes (unlit, fog-independent) to bound the world.
    this.mountains = [];
    [[70, 0x7a5a8a, 12], [78, 0x95708f, 10]].forEach(([r, col, n]) => {
      const mat = new THREE.MeshBasicMaterial({ color: col, fog: false });
      const im = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), mat, n), m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand() * 0.4, h = 16 + rand() * 20, w = 14 + rand() * 10;
        m.compose(new THREE.Vector3(Math.cos(a) * r, h / 2 - 3, Math.sin(a) * r), new THREE.Quaternion(), new THREE.Vector3(w, h, w));
        im.setMatrixAt(i, m);
      }
      im.frustumCulled = false; scene.add(im);
      this.mountains.push({ mat, base: new THREE.Color(col) });
    });
  }

  // Place a prop: GLB from the manifest slot if present, otherwise an instanced procedural mesh.
  prop(name, geo, mat, pts, defaults = {}) {
    if (!pts.length) return;
    if (this.assets.raw[name]) { this.assets.scatter(this.scene, name, pts, defaults); return; }
    const im = new THREE.InstancedMesh(geo, mat, pts.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    pts.forEach(([x, z, rot, s = 1, y = 0], i) => {
      q.setFromAxisAngle(up, THREE.MathUtils.degToRad(rot || 0));
      im.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s)));
      if (defaults.vary) im.setColorAt(i, c.setRGB(0.8 + rand() * 0.25, 0.8 + rand() * 0.25, 0.8 + rand() * 0.25));
    });
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.frustumCulled = false;
    this.assets.registry.push({ im, points: pts, h: defaults.fitHeight || 1, r: defaults.eraseRadius ?? 0.8 });
    this.scene.add(im);
  }

  swayInstances(geo, mat, pts, height) {
    const ab = new Float32Array(pts.length * 2);
    pts.forEach(([, , , s = 1, y = 0], i) => { ab[i * 2] = y; ab[i * 2 + 1] = height * s; });
    geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(ab, 2));
    makeSway(mat, this.assets.swayTime, 0.5);
    const im = new THREE.InstancedMesh(geo, mat, pts.length), m = new THREE.Matrix4(), q = new THREE.Quaternion();
    pts.forEach(([x, z, , s = 1, y = 0], i) => im.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s))));
    im.frustumCulled = false;
    this.assets.registry.push({ im, points: pts, h: height, r: 0.4 });
    this.scene.add(im);
  }

  update(dt, t, head) {
    this.assets.update(t); this.petals.update(dt, t, head); this.grass.update(t);
    // Gravity Well: eased strength so petals/grass glide toward the singularity.
    this.wellK += (this.wellT - this.wellK) * Math.min(1, dt * 3);
    const p = this.wellPos, w = this.wellK;
    this.petals.u.uWell.value.set(p.x, p.y, p.z, w);
    this.grass.uniforms.uWell.value.set(p.x, p.y, p.z, w);
  }

  // Gravity Well mood: blue spill on the grass near `pos` (k 0..1).
  setGlow(pos, k, color) { this.grass.uniforms.uGlow.value.set(pos.x, pos.y, pos.z, k); if (color) this.grass.uniforms.uGlowCol.value.copy(color); }

  // Gravity Well mood (only while the Sanctum is not active): darken grass/mountains, tint petals blue.
  setMoodTint(m, dark = MOOD_DARK, petal = MOOD_BLUE) {
    this.grass.uniforms.uTint.value.copy(this.grassBase).multiplyScalar(1 - 0.45 * m);
    for (const mt of this.mountains) mt.mat.color.copy(mt.base).lerp(dark, 0.6 * m);
    this.petals.setTint(petal, 0.5 * m);
  }

  // Attract petals + grass toward `pos` with strength k (0..1). Pass (null, 0) to release.
  // k < 0 repels (Repulsor). `owner` stops an idle spell releasing a well another spell is holding.
  setWell(pos, k, owner = 'default') {
    if (k !== 0) { this.wellOwner = owner; if (pos) this.wellPos.copy(pos); this.wellT = k; }
    else if (this.wellOwner === owner || !this.wellOwner) this.wellT = 0;
  }

  // Spell reactions: casting pulls petals in then bursts them; Repel Palm also gusts the wind.
  onSpell(pos, kind) {
    this.petals.trigger(pos, kind === 'sanctum' ? 1.6 : 1);
    if (kind === 'push') this.petals.gust(1.4);
  }

  // Sanctum: blossoms/halos/petals/grass/mountains drift toward the Sanctum color, wind intensifies (k: 0..1).
  tint(pc, k) {
    for (const m of this.treeMats) m.emissive.copy(this.baseEmissive).lerp(pc.lantern, k);
    this.haloMat.color.copy(this.baseEmissive).lerp(pc.lantern, k);
    this.petals.setTint(pc.lantern, k * 0.85);
    this.petals.windMul = 1 + 2.2 * k;
    this.grass.uniforms.uTint.value.copy(this.grassBase).lerp(pc.hemiSky, k * 0.7);
    for (const mt of this.mountains) mt.mat.color.copy(mt.base).lerp(pc.skyHorizon, k * 0.8);
  }

  reset() {
    for (const m of this.treeMats) m.emissive.copy(this.baseEmissive);
    this.haloMat.color.copy(this.baseEmissive);
    this.petals.setTint(this.baseEmissive, 0);
    this.petals.windMul = 1;
    this.grass.uniforms.uTint.value.copy(this.grassBase);
    for (const mt of this.mountains) mt.mat.color.copy(mt.base);
  }
}
