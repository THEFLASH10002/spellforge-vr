import * as THREE from 'three';
import { Destructible } from './Destructible.js';
import { terrainHeight } from '../world/Terrain.js';

// Destructible town structures placed on the terrain (machiya + pagoda on the plateau, torii at the
// foot of the slope). Pieces are simple pre-fractured proxies (collision + debris). If a GLB exists
// for a structure's slot (see AssetManager / ASSETS.md) it is shown instead of the proxies until the
// first hit, then the whole structure collapses.
export function buildDistrict(physics, scene, assets) {
  const all = [];
  let oy = 0; // ground height of the structure currently being built
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const piece = (geometry, x, y, z, color, fragments) => {
    const d = new Destructible(physics, scene, { geometry, position: new THREE.Vector3(x, y + oy, z), color, fragments });
    all.push(d);
    return d;
  };
  const stack = (...ps) => ps.forEach((p, i) => { if (ps[i + 1]) p.dependents.push(ps[i + 1]); });

  // Show `skin` in place of the proxy pieces; any hit collapses the whole structure.
  const skinned = (skin, x, z, pieces) => {
    if (!skin) return;
    skin.position.set(x, oy, z);
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

  // Machiya: with a GLB, one wide house (~8.8 x 5.3 m footprint at 4.5 m tall); otherwise two rowhouses.
  const hx = -9, hz = -22;
  oy = terrainHeight(hx, hz);
  const house = assets?.get('machiya', { fitHeight: 4.5 });
  if (house) {
    const body = piece(box(8.6, 3.8, 5.0), hx, 1.9, hz, 0xe8e0d0, 24);
    const roof = piece(box(9.4, 0.8, 5.8), hx, 4.1, hz, 0x2f3440, 14);
    stack(body, roof);
    skinned(house, hx, hz, [body, roof]);
  } else {
    [[-3.6, 0xe8e0d0], [3.6, 0xd8cdb8]].forEach(([dx, c]) => {
      const body = piece(box(3.6, 3.4, 3.2), hx + dx, 1.7, hz, c, 18);
      const roof = piece(box(4.3, 0.5, 3.8), hx + dx, 3.65, hz, 0x2f3440, 12);
      stack(body, roof);
    });
  }

  // Pagoda: three tiers with eaves, scaled so the whole thing is ~7 m tall.
  const pk = 7 / 3.91, px = 9, pz = -21;
  oy = terrainHeight(px, pz);
  const tier = (w, h, d, y, color, n) => piece(box(w * pk, h * pk, d * pk), px, y * pk, pz, color, n);
  const base = tier(2, 1, 2, 0.5, 0x7a3b2a, 14);
  const t1 = tier(1.5, 0.9, 1.5, 1.45, 0xa03030, 12);
  const r1 = tier(2.3, 0.16, 2.3, 2.03, 0x2f3440, 10);
  const t2 = tier(1.15, 0.8, 1.15, 2.51, 0xa03030, 12);
  const r2 = tier(1.9, 0.14, 1.9, 3.0, 0x2f3440, 10);
  const t3 = tier(0.8, 0.7, 0.8, 3.42, 0xa03030, 10);
  const r3 = tier(1.4, 0.14, 1.4, 3.84, 0x2f3440, 8);
  stack(base, t1, r1, t2, r2, t3, r3);
  skinned(assets?.get('pagoda', { fitHeight: 7 }), px, pz, [base, t1, r1, t2, r2, t3, r3]);

  // Torii gate at the foot of the slope (the path from the arena to the town), ~4.6 m tall.
  const tk = 4.6 / 3.43, tx = 0, tz = -13;
  oy = terrainHeight(tx, tz);
  const cyl = () => new THREE.CylinderGeometry(0.18 * tk, 0.2 * tk, 3.2 * tk, 12);
  const pl = piece(cyl(), tx - 1.4 * tk, 1.6 * tk, tz, 0xd2402a, 12);
  const pr = piece(cyl(), tx + 1.4 * tk, 1.6 * tk, tz, 0xd2402a, 12);
  const nuki = piece(box(3 * tk, 0.18 * tk, 0.25 * tk), tx, 2.5 * tk, tz, 0xd2402a, 8);
  const kasagi = piece(box(3.9 * tk, 0.25 * tk, 0.35 * tk), tx, 3.3 * tk, tz, 0x1c1c22, 10);
  pl.dependents.push(nuki, kasagi); pr.dependents.push(nuki, kasagi);
  skinned(assets?.get('torii', { fitHeight: 4.6 }), tx, tz, [pl, pr, nuki, kasagi]);

  return {
    pieces: all,
    update(dt) { for (const d of all) d.update(dt); },
  };
}
