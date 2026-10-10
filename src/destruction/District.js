import * as THREE from 'three';
import { Destructible } from './Destructible.js';

// Japanese-vernacular district. Pieces are simple pre-fractured proxies (collision + debris).
// If a GLB exists for a structure's slot (see AssetManager / ASSETS.md) it is shown instead of the
// proxies until the first hit, then the whole structure collapses into the proxy debris.
export function buildDistrict(physics, scene, assets) {
  const all = [];
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const piece = (geometry, x, y, z, color, fragments) => {
    const d = new Destructible(physics, scene, { geometry, position: new THREE.Vector3(x, y, z), color, fragments });
    all.push(d);
    return d;
  };
  const stack = (...ps) => ps.forEach((p, i) => { if (ps[i + 1]) p.dependents.push(ps[i + 1]); });

  // Show `skin` in place of the proxy pieces; any hit collapses the whole structure.
  const skinned = (skin, x, z, pieces) => {
    if (!skin) return;
    skin.position.set(x, 0, z);
    scene.add(skin);
    let done = false;
    for (const p of pieces) {
      p.mesh.visible = false;
      p.onShatter = (pt, dir, speed) => {
        if (done) return;
        done = true; skin.visible = false;
        pieces.forEach((q, i) => { if (q !== p) q.pending.push({ t: 0.05 + i * 0.06, fn: () => q.shatter(pt, dir, speed * 0.6) }); });
      };
      p.onReset = () => { done = false; skin.visible = true; };
    }
  };

  // Machiya rowhouses: plaster body + tiled roof.
  [[-3.2, 0xe8e0d0], [-0.5, 0xd8cdb8]].forEach(([x, c]) => {
    const body = piece(box(2.4, 2.2, 2), x, 1.1, -6, c, 16);
    const roof = piece(box(2.9, 0.25, 2.5), x, 2.325, -6, 0x2f3440, 10);
    stack(body, roof);
    skinned(assets?.get('machiya', { fitHeight: 2.45 }), x, -6, [body, roof]);
  });

  // Pagoda: three tiers with eaves.
  const px = 3.8, pz = -7;
  const base = piece(box(2, 1, 2), px, 0.5, pz, 0x7a3b2a, 14);
  const t1 = piece(box(1.5, 0.9, 1.5), px, 1.45, pz, 0xa03030, 12);
  const r1 = piece(box(2.3, 0.16, 2.3), px, 2.03, pz, 0x2f3440, 10);
  const t2 = piece(box(1.15, 0.8, 1.15), px, 2.51, pz, 0xa03030, 12);
  const r2 = piece(box(1.9, 0.14, 1.9), px, 3.0, pz, 0x2f3440, 10);
  const t3 = piece(box(0.8, 0.7, 0.8), px, 3.42, pz, 0xa03030, 10);
  const r3 = piece(box(1.4, 0.14, 1.4), px, 3.84, pz, 0x2f3440, 8);
  stack(base, t1, r1, t2, r2, t3, r3);
  skinned(assets?.get('pagoda', { fitHeight: 3.91 }), px, pz, [base, t1, r1, t2, r2, t3, r3]);

  // Torii gate.
  const tx = 0.6, tz = -10;
  const pl = piece(new THREE.CylinderGeometry(0.18, 0.2, 3.2, 12), tx - 1.4, 1.6, tz, 0xd2402a, 12);
  const pr = piece(new THREE.CylinderGeometry(0.18, 0.2, 3.2, 12), tx + 1.4, 1.6, tz, 0xd2402a, 12);
  const nuki = piece(box(3, 0.18, 0.25), tx, 2.5, tz, 0xd2402a, 8);
  const kasagi = piece(box(3.9, 0.25, 0.35), tx, 3.3, tz, 0x1c1c22, 10);
  pl.dependents.push(nuki, kasagi); pr.dependents.push(nuki, kasagi);
  skinned(assets?.get('torii', { fitHeight: 3.43 }), tx, tz, [pl, pr, nuki, kasagi]);

  return {
    pieces: all,
    update(dt) { for (const d of all) d.update(dt); },
  };
}
