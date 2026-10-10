# SpellForge VR — Agent Handoff

Hackathon project (Hacklanta, 36h). Three.js WebXR hand-tracking spellcasting/destruction sandbox for **Meta Quest 2**.
Repo: `THEFLASH10002/spellforge-vr` (public). Local: `C:\Users\kenne\spellforge`. Owner GitHub: THEFLASH10002.
Original spec: `C:\Users\kenne\Downloads\SPELLFORGE_AGENT_CONTEXT_v2.md` (read it first).

## Standing constraints
- **Originality:** no franchise names/terms. Use "Sigils" (gestures), "Arts" (spells), "Sanctum" (domain). Spell names: Bolt, Repel, Pull, Blue (Gravity Well), Red (Repulsor), Purple (Nullpoint).
- **Licenses:** disclose third-party licenses in `ASSETS.md`. Do NOT commit assets with unknown license. Currently untracked/held out: `public/assets/models/{machiya,village,tree,book}.glb` (user hasn't told source/license).
- **Quest 2 perf:** target 72fps; `config/Quality.js` holds quality tiers. Keep draw calls/particles low, instanced geometry, stateless GPU particles.
- Token-conscious: user has limited budget; use smaller models for boilerplate, Sonnet 5.5 for hard stuff.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Stack
Three.js 0.182, Rapier (`@dimforge/rapier3d-compat`), `three-pinata` (Voronoi pre-fracture), Vite. GLB pipeline: GLTFLoader + Draco/meshopt, `SkeletonUtils.clone`, gltf-transform optimize (webp/meshopt). Custom GLSL shaders, toon shading + inverted-hull outlines, baked nebula texture, MIT-derived galaxy shader (credited in ASSETS.md).

## Running
- `npm run dev -- --host` (Vite on 5173), then `adb reverse tcp:5173 tcp:5173`, open `http://localhost:5173` in Quest browser. `npx vite build` to check compile. `deploy.sh` exists.
- Headless testing: puppeteer with scripted fake hands and the `window.spellforge` debug hook (exposes labels, unlocks, interact, loco, recognizer, recorder, THREE, assets, camera, sanctum, env, caster, director, renderer, scene, well, WELL, red, RED, nullOrb, NULL, spellbook, mood, MOOD). Test scripts live in `C:\Users\kenne\AppData\Local\Temp\gt\` (unlock.mjs, wizard.mjs, popup.mjs…) — not in repo.
- Workflow quirks: bash heredocs sometimes fail → write patch scripts with the Write tool and run with node. In GLSL, `#include` must be on its own line.

## Source map (`src/`)
- `main.js` — wiring: renderer, XR, unlocks, recognizer hooks, `spellPages()`, `tryFuse`, spellbook, HandLabels, panel, game loop, debug hook.
- `arts/ArtRegistry.js` (ARTS: bolt, push[Repel], well, repulsor, pull, nullpoint), `ArtCaster.js` (bolt/push/pull one-shots + channelled `pullHold` with hover-point spring), `GravityWell.js` (Blue/Red variants, `absorb()`), `NullOrb.js` (Purple, 2x size, slow, passes through terrain/objects, merge/throw/erase tube, `onFusion`).
- `gestures/PoseFeatures.js` (feature vector, HAND_DIM=23: curls[0..4], palm normal[5..7], tips[8..22]; `distance`, `twoHandVec`), `builtins.js` (built-in signs), `Recognizer.js`, `Recorder.js`.
- `progress/Unlocks.js` — localStorage key `spellforge.unlocks.v1`.
- `ui/Spellbook.js` (GLB book + canvas page card, locked "???" pages, FUSE, celebration popup, CREATE wizard), `ui/HandLabels.js`, `ui/Panel.js` (wrist-ish debug panel).
- `world/` Environment, Terrain (training ground center, elevated surroundings), Grass, Petals, Locomotion (right-hand strict pinch teleport via reference-space offset), HandInteract (punch/grab).
- `vfx/` Singularity, WellMood (lighting darkens/fades with Blue/Red), Cosmos, VoidDome, AuroraVeil, GalaxyPoints, NebulaBake, ScarTrail, Effects.
- `destruction/` Destructible, District. `enemies/Puppet.js` (dummies). `sanctum/` Sanctum + presets (Star Void + Low Gravity etc.). `assets/AssetManager.js`. `render/` Sky, Toon. `debug/Perf.js`. `demo/Director.js`.
- Docs: `ASSETS.md` (license log + credits), `ASSETS_NEEDED.md`, `README.md`.

## Gesture system
- Per-hand vector; weighted RMS distance / `thresh` = **ratio**; ratio < 1 fires after hold time (0.4s default). Best-ratio selection; two-hand matches beat the single-hand signs they contain.
- Hard gates `minCurl`/`maxCurl` on mean straightness of index..pinky (vec[1..4]).
- Built-in signs: Triple Fang (3 fingers out) = Bolt; Repel Palm (open palm, `minCurl 0.9`, thresh 0.15, palm-normal weight 0.5) = Repel; Grasp (all fingers ~half curled, `maxCurl 0.9`) = Pull, channelled/constant while held; Gravity-well sign (index+middle up) = Blue; Repulsor sign `tpl([0,E,C,C,E])` = Red; Sanctum sigil = two fists held 1.0s.
- Combination: two built-in signs, one per hand, forming a locked recipe, held 1.2s → `onCombine` unlocks result and saves a two-hand sigil.

## Unlock / combination system
- Start with only Bolt, Pull, Repel. Recipes: Bolt+Pull=Blue, Bolt+Repel=Red, Blue+Red=Purple (Purple also via fusing the two orbs: `nullOrb.onFusion`).
- Locked arts: recognizer skips their sigils; pages show "???" + hint; panel fallback buttons respect locks.
- `Unlocks.unlock()` returns true only on first unlock (prevents duplicate popups). "NEW SPELL UNLOCKED" popup via `spellbook.celebrate(id)`.
- Persistence in localStorage; stale custom sigils bound to locked arts are purged at load.

## Creation wizard (latest work)
Spellbook **CREATE** button under pages: pick art → pick hands (left/right/two) → Record (3s countdown, 1s capture) → saved or failure message. Casting paused while wizard open (`spellbook.creating`). `HandLabels` shows floating labels under hands ("Name · Art" / "Almost X" / "New pose"). Recorder rejects poses too similar to an existing same-type sign (`distance < thresh*1.2`).

## State at handoff
- Last commit `8972fb7` pushed: creation wizard, hand labels, curl gates, stale-save purge. Headless wizard test passes (saves a custom sign). Screenshots `wiz_*.png` in the Temp gt folder were mostly not visually reviewed; HandLabels not yet seen rendered.
- Dev server running on 5173 with `adb reverse` set.

## Needs headset verification
1. CREATE button / wizard buttons pokeable and reliable?
2. Hand labels legible?
3. Open palm → only Repel (not Grasp). If Grasp still fires, get `R curl` numbers (HUD).
4. Recorder similarity check may be too strict vs builtin Grasp (built-ins ignore fingertip weights); loosen if real poses get "Too similar to Grasp".

## Open TODOs
- Get license/source for `machiya.glb`, `village.glb`, `tree.glb`, `book.glb`; then add to repo + ASSETS.md.
- Audio/SFX (user said do last), README + Devpost text, demo video.
- Sanctum dome visuals "need some work" (user said revisit later).
- Optional: walk-in-place locomotion (offered, not requested).
- Earlier scale fixes: dummies vs house scale, lanterns clipping poles (reported, addressed in asset pass — re-verify).
