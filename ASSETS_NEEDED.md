# SpellForge VR — Assets That Would Improve the World Most

The game already runs with procedural stand-ins for everything below, so **nothing here is required to ship**.
Each row says what it replaces. Add a file to `public/assets/models/` (or `public/assets/textures/`) and one line to
`public/assets/manifest.json` and it replaces the stand-in with no code changes. Format and options: see `ASSETS.md`.

I could not browse for verified direct download links, so these are search terms and sites only. Check every license
yourself and log it in the table at the bottom of `ASSETS.md` before committing (the repo is public).

Sites: **Poly Pizza** (poly.pizza), **Sketchfab** (filter Downloadable + CC0/CC-BY, choose glTF), **Quaternius** (quaternius.com),
**Kenney** (kenney.nl), **Poly Haven** (polyhaven.com, all CC0), **OpenGameArt**.

## Already provided (in your models folder)
`machiya`, `pagoda`, `torii`, `lantern`, `village`, `tree` (see `manifest.json`). The tree already gets glow, wind sway and per-tree variation from code.

## Priority 1 — biggest visual gain

| # | Slot (manifest key) | Placement | File / dir | Budget | Required? | Search terms | Visual gain |
|---|---|---|---|---|---|---|---|
| 1 | `tree` (a 2nd and 3rd blossom variant) | Mixed in with the current tree | GLB, `models/tree2.glb`, `models/tree3.glb` | <= 3k tris, 512 px texture | Optional (needs a tiny code tweak to use several trees) | "sakura tree low poly", "cherry blossom tree stylized" | Less repetition |
| 2 | `fence` | Ring around the arena (36 segments) | GLB, `models/fence.glb`, ~2 m long segment along X | <= 300 tris | Optional | "japanese wooden fence", "bamboo fence low poly" | Replaces the plain fence |
| 3 | `stone_lantern` | Flanking the path (6) | GLB, `models/stone_lantern.glb` | <= 800 tris | Optional | "toro stone lantern", "japanese stone lantern low poly" | Strong shrine feel |
| 4 | `bush` | ~24 scattered (slopes, plateau) | GLB, `models/bush.glb` | <= 400 tris | Optional | "low poly bush", "stylized shrub", "hedge" | Fuller vegetation |
| 5 | `rock` | ~18 scattered | GLB, `models/rock.glb` | <= 300 tris | Optional | "low poly rock", "mossy rock stylized" | Terrain detail |
| 6 | grass texture (not wired yet) | Terrain | JPG 1024 `textures/grass.jpg` | 1k, tileable | Optional | Poly Haven: "grass", "aerial grass rock" | Richer ground (needs a small code hook) |
| 7 | dirt/sand texture (not wired yet) | Training ground | JPG 1024 `textures/dirt.jpg` | 1k, tileable | Optional | Poly Haven: "dirt", "sand", "gravel" | Arena floor detail |

## Priority 2 — density and character

| # | Slot | Placement | File | Budget | Required? | Search terms | Visual gain |
|---|---|---|---|---|---|---|---|
| 8 | `bamboo` | Two groves (28 stalks each) | GLB `models/bamboo.glb` (one stalk or small clump, ~6 m) | <= 200 tris | Optional | "bamboo low poly", "bamboo grove" | Replaces the cylinders; sways in wind |
| 9 | `barrel` | Cluster at the arena rim (3) | GLB `models/barrel.glb` | <= 300 tris | Optional | "wooden barrel low poly", "sake barrel" | Props |
| 10 | `crate` | Cluster at the arena rim (3) | GLB `models/crate.glb` | <= 150 tris | Optional | "wooden crate low poly" | Props |
| 11 | `bench` | Arena rim (2) | GLB `models/bench.glb` | <= 300 tris | Optional | "japanese bench", "wooden bench low poly" | Props |
| 12 | `signboard` | Start of the path (1) | GLB `models/signboard.glb` | <= 300 tris | Optional | "wooden signboard", "japanese sign post" | Props |
| 13 | more houses | Additional village homes / machiya variants | GLB, <= 8k tris each (the current `village.glb` is ~15k, already heavy) | <= 8k tris, 1024 px | Optional | "japanese house low poly", "machiya", "minka", "edo town house" | Denser village (need a few more pads in `Terrain.js`) |
| 14 | small shrine | On the plateau | GLB `models/shrine.glb` | <= 5k tris | Optional | "japanese shrine low poly", "hokora", "shinto shrine" | Landmark (needs one placement line) |

## Priority 3 — nice to have

| # | Asset | Why | Notes |
|---|---|---|---|
| 15 | Stone steps / stairs | Shrine steps at the foot of the slope | "stone stairs low poly", "shrine steps" |
| 16 | Wooden bridge + small pond (koi) | Garden area | "japanese bridge low poly", "koi pond" |
| 17 | Distant mountain / cliff GLB | Replaces the cone silhouettes | "low poly mountain", "cliff rock stylized" |
| 18 | Petal PNG (alpha) | Petals are procedural quads now; a real petal shape could look nicer | 64 px PNG with alpha, `textures/petal.png` (needs a small code hook) |
| 19 | Sunset panorama JPG | The sky is a gradient shader; a painted panorama could look richer | Poly Haven HDRIs are CC0 ("sunset", "evening sky"); needs a code hook and costs texture memory |

## Technical reminders
- glTF 2.0 `.glb`, meters, Y-up, front facing +Z. Props are auto-fitted by `fitHeight` and auto-centered.
- Compress big downloads: `npx @gltf-transform/cli@4 optimize in.glb out.glb --texture-compress webp --texture-size 1024 --compress meshopt`
  (see `ASSETS.md`; for models made of thousands of tiny disconnected pieces, e.g. individual roof tiles, normal
  simplification will not help — pick a lighter model instead).
- Whole-scene budget on Quest 2: about 150k triangles. The scene is already near that with the current village houses
  and trees (the on-panel `tris` readout shows the live total), so prefer **low-poly** props and reduce counts before adding more.

## Star Void sky: optional nebula texture (nothing here is required)

The Star Void Sanctum **generates its own nebula at load** (`src/vfx/NebulaBake.js`, a one-time bake, no download needed). If you want a
hand-made or photographic nebula instead, drop in an **equirectangular** panorama and it replaces the generated one.

**Install**
1. Put the image at `public/assets/textures/nebula.jpg` (create the `textures` folder next to `models`).
2. Add this to `public/assets/manifest.json` (next to `"slots"`):
```json
"textures": { "nebula": "textures/nebula.jpg" }
```
3. Reload. The console logs `[assets] textures loaded: nebula`. Remove the line to go back to the generated nebula.

**Image requirements:** equirectangular (2:1), JPG, **2048x1024** is plenty (1024x512 for a tight Quest budget), sRGB, dark background with
colored clouds (stars in the image are fine; the game adds its own). Avoid images with a bright sun or big hard-edged objects.

**Where to look (verify each license; I could not browse to confirm any of these):**
- **Poly Haven** (polyhaven.com, HDRIs, all CC0): search `space`, `night sky`. Few true space panoramas, but some night skies work. Download as JPG/tonemapped, 2k.
- **Solar System Scope** (solarsystemscope.com/textures): has a Milky Way / stars equirectangular map; check the license listed on that page (attribution may be required).
- **ESO** (eso.org/public/images, Milky Way panoramas) and **NASA/ESA** image libraries: panoramas are credited and usually freely reusable with credit; check each image page.
- **Procedural generators**: search `space skybox generator` (some output cube faces that you can convert to equirectangular).
Log any texture you add in the license table in `ASSETS.md`.

**Tuning (no assets needed):** star and particle counts per quality preset are in `src/config/Quality.js` under `cosmos`
(`galaxy`, `near`, `dust`, `ribbons`, `nebula` size). Lower them if the headset struggles, raise them on desktop.
