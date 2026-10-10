# SpellForge VR — 3D Asset Guide

The game runs with built-in placeholder geometry. Any GLB you add replaces the matching placeholder
automatically; missing files just keep the placeholder. **Nothing else needs to change in code.**

## How to add a model

1. Put the `.glb` in `public/assets/models/`.
2. List it in `public/assets/manifest.json`:

```json
{
  "slots": {
    "machiya": { "file": "models/machiya.glb", "fitHeight": 2.45 },
    "pagoda":  { "file": "models/pagoda.glb",  "fitHeight": 3.9, "rotY": 0 },
    "torii":   { "file": "models/torii.glb",   "fitHeight": 3.4 },
    "lantern": { "file": "models/lantern.glb", "fitHeight": 2.1 }
  },
  "decor": [
    { "file": "models/stone_lantern.glb", "fitHeight": 1.2, "points": [[-2, -1, 0], [2, -1, 90]] }
  ]
}
```

3. Reload. The browser console logs `[assets] GLB slots loaded: ...` (and a warning for any file it could not load).

Per-slot options: `fitHeight` (meters; auto-scales the model), `scale` (if not using fitHeight), `y` (lift), `rotY` (degrees),
`toon` (false keeps original materials), `outline` (false disables the outline), `outlineWidth` (meters, default 0.02).
Models are auto-centered on X/Z and placed on the ground, so origin placement does not matter.
`decor` points are `[x, z, rotationDegrees]` and render as one instanced draw call per mesh.

**When a GLB is used:** it is shown until the first hit, then the whole structure collapses into pre-fractured debris
(fragments come from simple built-in proxy blocks, so debris will not match fine model detail). Colliders are the proxies too.

## Asset list (exact)

| Slot | Needed | Target size | Budget |
|---|---|---|---|
| `machiya` (x2, reused) | Japanese wooden townhouse / rowhouse, tiled roof | ~2.9 m wide, 2.5 m deep, 2.45 m tall | <= 8k tris, one <= 1024 px texture |
| `pagoda` | 3-tier pagoda (or small 3-story tower) | ~2.4 m wide, 3.9 m tall | <= 10k tris |
| `torii` | Shrine gate | ~3.9 m wide, 3.4 m tall | <= 3k tris |
| `lantern` (x12, reused) | Street lantern on post (or tall stone lantern) | ~2.1 m tall | <= 1.5k tris |
| `decor` (optional) | Stone lantern, fence segment, bench, barrels, signboard, sakura tree, shrubs | any | <= 1k tris each; instanced |
| ground texture (optional, not wired yet) | Tileable cobble/stone, 1k | - | - |
| puppet character (optional, later) | Rigged humanoid for skinned ragdoll | ~1.7 m | decide at the hour-20 gate; current puppets are segmented wooden mannequins by design |

### Model requirements
- glTF 2.0 binary (`.glb`), meters, Y-up, front facing +Z.
- Merge each building into as few meshes as possible (fewer draw calls). Prefer ONE material / texture atlas per model.
- Simple base-color textures are enough (materials are converted to toon shading). No need for PBR maps.
- Draco and meshopt compression are supported. KTX2 is not wired up.
- Whole scene budget on Quest 2: ~150k triangles, ~100 draw calls total.
- Smooth-shaded meshes outline best; set `"outline": false` for hard-edged low-poly if outlines show gaps.

## Where to look (verify each license yourself and record it below)

- **Poly Pizza** (poly.pizza): searchable, direct GLB download, mix of CC0 and CC-BY (CC-BY needs attribution). Search: `japanese`, `torii`, `pagoda`, `shrine`, `lantern`, `japan house`.
- **Kenney** (kenney.nl, also on itch.io): CC0. No dedicated Japanese pack found; good for generic props and kits. Ships glTF.
- **Quaternius** (quaternius.com): CC0 stylized packs; useful for props, trees, environment filler.
- **Sketchfab** (filter: Downloadable + license CC0/CC-BY, download as glTF): widest Japanese selection; needs a free login. Check the license on each model.
- **Paid options** (seen in search, license not verified): CGTrader Japanese pagoda + torii (~$6), "Sinto Shrine Essentials" on itch.io/Gumroad ($30, 20 models, GLB included). Read the license before use in a public repo.
- **Blender**: a low-poly machiya (box body + hip roof + lattice texture) is a ~30 minute job if nothing suitable is found.
- **Mixamo** (characters, optional): free with an Adobe ID. Its terms allow use in projects but not standalone redistribution of the raw files, so avoid committing raw Mixamo downloads to the public repo.

Do NOT use assets ripped from games or anime (no franchise assets; see the originality rules).

## License log (fill in as you add assets; copy into the README / Devpost disclosure)

| File | Source URL | Author | License |
|---|---|---|---|
| _none yet_ | | | |

Built-in: Draco decoder (`public/draco/`, Apache-2.0, from three.js).
