import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { toonify, outlineHull } from '../render/Toon.js';

const url = p => new URL(p, document.baseURI).href;

// Drop-in GLB slots. public/assets/manifest.json maps slot names to files; any missing slot or file
// returns null so the game falls back to its procedural placeholder. See ASSETS.md.
//   slots: { machiya: { file, fitHeight, scale, y, rotY, toon, outline, outlineWidth } }
//   decor: [ { file, fitHeight, points: [[x, z, rotYDeg], ...] } ]   (instanced, 1 draw call per mesh)
export class AssetManager {
  static async load() {
    const am = new AssetManager();
    am.manifest = { slots: {}, decor: [] };
    try {
      const r = await fetch(url('assets/manifest.json'), { cache: 'no-cache' });
      if (r.ok) am.manifest = { slots: {}, decor: [], ...(await r.json()) };
    } catch { /* no manifest: all procedural */ }

    const draco = new DRACOLoader().setDecoderPath(url('draco/'));
    am.loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
    am.raw = {};
    const jobs = Object.entries(am.manifest.slots).map(([name, cfg]) => am.fetchModel(cfg.file).then(g => { if (g) am.raw[name] = g; }));
    am.decorRaw = await Promise.all((am.manifest.decor || []).map(d => am.fetchModel(d.file)));
    await Promise.all(jobs);
    const found = Object.keys(am.raw);
    console.log(`[assets] GLB slots loaded: ${found.length ? found.join(', ') : 'none (procedural placeholders)'}`);
    return am;
  }

  async fetchModel(file) {
    try { return (await this.loader.loadAsync(url('assets/' + file))).scene; }
    catch (e) { console.warn(`[assets] could not load ${file}:`, e.message || e); return null; }
  }

  // Normalize: rotate, scale (fitHeight in meters or scale), center X/Z on origin, sit on y=0.
  prep(source, cfg) {
    const root = source.clone(true);
    if (cfg.toon !== false) toonify(root);
    root.rotation.y = THREE.MathUtils.degToRad(cfg.rotY || 0);
    root.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(root);
    const s = cfg.fitHeight ? cfg.fitHeight / Math.max(box.getSize(new THREE.Vector3()).y, 1e-3) : (cfg.scale || 1);
    root.scale.multiplyScalar(s);
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    root.position.set(-(box.min.x + box.max.x) / 2, -box.min.y + (cfg.y || 0), -(box.min.z + box.max.z) / 2);
    const wrap = new THREE.Group();
    wrap.add(root);
    if (cfg.outline !== false) outlineHull(root, cfg.outlineWidth ?? 0.02);
    return wrap;
  }

  // A fresh, normalized clone of a slot's model, or null if the slot has no GLB.
  get(name, defaults = {}) {
    const raw = this.raw[name];
    return raw ? this.prep(raw, { ...defaults, ...this.manifest.slots[name] }) : null;
  }

  // Instanced scatter props: one InstancedMesh per mesh in each decor GLB.
  buildDecor(scene) {
    let n = 0;
    (this.manifest.decor || []).forEach((d, i) => {
      const raw = this.decorRaw[i];
      if (!raw || !d.points?.length) return;
      const wrap = this.prep(raw, { ...d, outline: false });
      wrap.updateMatrixWorld(true);
      wrap.traverse(o => {
        if (!o.isMesh) return;
        const im = new THREE.InstancedMesh(o.geometry, o.material, d.points.length);
        const m = new THREE.Matrix4(), place = new THREE.Matrix4(), q = new THREE.Quaternion();
        d.points.forEach(([x, z, rot], k) => {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(rot || 0));
          place.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, 1, 1));
          im.setMatrixAt(k, m.multiplyMatrices(place, o.matrixWorld));
        });
        im.frustumCulled = false;
        scene.add(im); n++;
      });
    });
    if (n) console.log(`[assets] decor: ${n} instanced mesh(es)`);
  }
}
