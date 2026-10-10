import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { PhysicsWorld } from './physics/World.js';
import { setupHands } from './xr/HandInput.js';
import { extractHand } from './gestures/PoseFeatures.js';
import { Recognizer } from './gestures/Recognizer.js';
import { Recorder, loadCustom, saveCustom } from './gestures/Recorder.js';
import { BUILTINS } from './gestures/builtins.js';
import { ArtCaster } from './arts/ArtCaster.js';
import { ART_IDS, ARTS } from './arts/ArtRegistry.js';
import { Panel } from './ui/Panel.js';
import { buildDistrict } from './destruction/District.js';
import { Puppet } from './enemies/Puppet.js';
import { Director } from './demo/Director.js';
import { Sanctum } from './sanctum/Sanctum.js';
import { PRESETS, RULES } from './sanctum/presets.js';
import { QUALITY, QUALITY_NAME } from './config/Quality.js';
import { Perf } from './debug/Perf.js';
import { toon, cobbleTexture } from './render/Toon.js';
import { Sky } from './render/Sky.js';
import { fx } from './vfx/Effects.js';
import { AssetManager } from './assets/AssetManager.js';
import { buildTerrain, buildTrainingGround, terrainHeight, onPath, PADS, FLAT } from './world/Terrain.js';
import { Grass } from './world/Grass.js';
import { Environment } from './world/Environment.js';
import { GravityWell, WELL, RED, RED_VARIANT } from './arts/GravityWell.js';
import { WellMood, MOOD } from './vfx/WellMood.js';
import { NullOrb, NULL } from './arts/NullOrb.js';

const renderer = new THREE.WebGLRenderer({ antialias: QUALITY.aa, powerPreference: 'high-performance' });
renderer.setPixelRatio(QUALITY.pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setFramebufferScaleFactor(QUALITY.xrScale);
renderer.xr.setFoveation(QUALITY.foveation);
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer, {
  optionalFeatures: ['hand-tracking', 'local-floor'],
}));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d1a);
scene.fog = new THREE.Fog(0xd9998f, 22, 95); // rose haze matching the sunset horizon
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 200);
camera.position.set(0, 1.6, 0);
const hemi = new THREE.HemisphereLight(0xffc8a8, 0x5a4670, 1.35); // soft warm sky fill, plum bounce
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffb27a, 1.6); // warm key from behind-left so facades facing us stay lit
sun.position.set(-6, 10, 8);
scene.add(sun);
const sky = new Sky(scene);
fx.init(scene);

const physics = await PhysicsWorld.create();

const floor = buildTerrain(physics, scene); // (the Sanctum tints this material)
buildTrainingGround(scene);
const grass = new Grass(scene, QUALITY.grass);

const hands = setupHands(renderer, scene);
const handBy = side => hands.find(h => h.userData.handedness === side);


const assets = await AssetManager.load();
const district = buildDistrict(physics, scene, assets);
assets.buildDecor(scene);

// Village homes on the four side/back pads (static scenery, facing the arena) and sakura trees on the slopes.
const village = PADS.slice(2).map(p => [p.x, p.z, THREE.MathUtils.radToDeg(Math.atan2(-p.x, -p.z)), 1, terrainHeight(p.x, p.z)]);
assets.scatter(scene, 'village', village, { fitHeight: 4, eraseRadius: 5 });
const env = new Environment({ scene, assets, grass }); // blossom trees, petals, props, mountains

const puppets = [[-4, -5], [-1, -6.5], [2.5, -5.5], [5.5, -2.5]].map(([x, z], i) => new Puppet(physics, scene, x, z, i));

const recognizer = new Recognizer();
recognizer.sigils = [...BUILTINS, ...loadCustom()];
const recorder = new Recorder(recognizer);
const caster = new ArtCaster(scene, physics);
const targets = [...district.pieces, ...puppets];
caster.destructibles = targets;
caster.env = env;
const sanctum = new Sanctum({ scene, physics, floor, hemi, sun, puppets, sky, assets, env, renderer, stars: QUALITY.stars });
const perf = new Perf();
let presetIdx = 0, ruleIdx = 0;
const director = new Director({ targets, caster, onReset: () => { sanctum.reset(); well.reset(); red.reset(); nullOrb.reset(); } });
let lastCast = '-';
let nextArt = 0;
const well = new GravityWell({ scene, physics, env, targets });            // Blue: pulls
const red = new GravityWell({ scene, physics, env, targets, variant: RED_VARIANT }); // Red: repels
well.other = red; red.other = well;
const nullOrb = new NullOrb({ scene, physics, env, targets, assets, grass, well, red }); // Purple: Blue + Red merged
const mood = new WellMood({ scene, hemi, sun, sky, env, sanctum, sources: [well, red, nullOrb] });
recognizer.onCast = (sigil, hand, which) => {
  lastCast = sigil.name;
  if (sigil.artId === 'sanctum') sanctum.activate(presetIdx, ruleIdx);
  else if (sigil.artId === 'well') well.begin(which); // hold + charge + throw (see GravityWell.js)
  else if (sigil.artId === 'repulsor') red.begin(which);
  else caster.cast(sigil.artId, hand);
};

const panel = new Panel();
panel.mesh.position.set(-0.55, 1.2, -0.7);
panel.mesh.rotation.y = 0.6;
scene.add(panel.mesh);
[['Rec Right', 'right', 10, 370], ['Rec Left', 'left', 176, 370], ['Rec Two', 'two', 342, 370]].forEach(([label, mode, x, y]) =>
  panel.addButton({ label, x, y, w: 160, h: 70, onPress: () => !recorder.active && recorder.start(mode, ART_IDS[nextArt]) }));
panel.addButton({ label: 'RESET', x: 10, y: 290, w: 118, h: 70, onPress: () => director.reset() });
panel.addButton({ label: 'Sanctum', x: 136, y: 290, w: 118, h: 70, onPress: () => sanctum.activate(presetIdx, ruleIdx) });
panel.addButton({ label: 'Look', x: 262, y: 290, w: 118, h: 70, onPress: () => { presetIdx = (presetIdx + 1) % PRESETS.length; } });
panel.addButton({ label: 'Rule', x: 388, y: 290, w: 114, h: 70, onPress: () => { ruleIdx = (ruleIdx + 1) % RULES.length; } });
panel.addButton({ label: 'Next Art', x: 10, y: 450, w: 240, h: 70, onPress: () => { nextArt = (nextArt + 1) % ART_IDS.length; } });
panel.addButton({ label: 'Clear Custom', x: 262, y: 450, w: 240, h: 70, onPress: () => recorder.clearCustom() });

// Gravity Well fallbacks: start charging without the hand sign, and launch without a throw.
panel.addButton({ label: 'Well: Charge', x: 10, y: 610, w: 240, h: 70, onPress: () => well.begin('right') });
panel.addButton({ label: 'Well: Launch', x: 262, y: 610, w: 240, h: 70, onPress: () => well.launchNow() });

panel.addButton({ label: 'Red: Charge', x: 10, y: 690, w: 240, h: 70, onPress: () => red.begin('left') });
panel.addButton({ label: 'Red: Launch', x: 262, y: 690, w: 240, h: 70, onPress: () => red.launchNow() });

panel.addButton({ label: 'Null: Merge', x: 10, y: 770, w: 240, h: 70, onPress: () => nullOrb.begin() });
panel.addButton({ label: 'Null: Launch', x: 262, y: 770, w: 240, h: 70, onPress: () => nullOrb.launchNow() });

// Forge: name / rebind the most recent custom Sigil.
const ADJ = ['Ember', 'Frost', 'Silent', 'Hollow', 'Gilded', 'Storm', 'Veiled', 'Crimson', 'Lunar', 'Iron'];
const NOUN = ['Fang', 'Crown', 'Veil', 'Tide', 'Spiral', 'Lantern', 'Thorn', 'Echo', 'Comet', 'Gate'];
let nameIdx = 0;
const lastCustom = () => [...recognizer.sigils].reverse().find(s => !s.builtin);
panel.addButton({ label: 'Rename Last', x: 10, y: 530, w: 240, h: 70, onPress: () => {
  const s = lastCustom(); if (!s) return;
  nameIdx++;
  s.name = `${ADJ[nameIdx % ADJ.length]} ${NOUN[(nameIdx * 7 + 3) % NOUN.length]}`;
  saveCustom(recognizer.sigils);
} });
panel.addButton({ label: 'Rebind Last', x: 262, y: 530, w: 240, h: 70, onPress: () => {
  const s = lastCustom(); if (!s) return;
  s.artId = ART_IDS[(ART_IDS.indexOf(s.artId) + 1) % ART_IDS.length];
  saveCustom(recognizer.sigils);
} });

const headQ = new THREE.Quaternion(), headPos = new THREE.Vector3();
let hudT = 0;
function updateHud(dt, R) {
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.2;
  const rec = recorder.phase === 'countdown' ? `Get ready... ${recorder.t.toFixed(1)}`
    : recorder.phase === 'capture' ? 'HOLD POSE...' : (recorder.message || 'Idle');
  const dbg = recognizer.debug;
  panel.setLines([
    'SpellForge',
    rec,
    `${lastCast} | ${[['Blue', well], ['Red', red], ['Null', nullOrb]].filter(([, o]) => o.status !== 'ready').map(([n, o]) => `${n} ${o.status}`).join(' | ') || 'ready'}`,
    dbg ? `Best: ${dbg.sg.name} ${dbg.ratio.toFixed(2)} (<1 fires)` : 'Best: no hands',
    R ? `R curl ${R.curls.map(c => c.toFixed(2)).join(' ')}` : 'R hand: not tracked',
    `Next record art: ${ARTS[ART_IDS[nextArt]].name} | Sigils: ${recognizer.sigils.length}`,
    `Sanctum: ${PRESETS[presetIdx].name} + ${RULES[ruleIdx].name}`,
    `[${QUALITY_NAME}] ${perf.text}`,
    (c => c ? `Last custom: ${c.name} -> ${ARTS[c.artId]?.name}` : 'Last custom: none')(lastCustom()),
  ]);
  panel.draw();
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  perf.update(dt, renderer, physics);
  physics.step(dt * sanctum.timeScale);
  const headCam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  headCam.getWorldQuaternion(headQ);
  headCam.getWorldPosition(headPos);
  const headInv = headQ.clone().invert();
  const lh = handBy('left'), rh = handBy('right');
  const L = lh && extractHand(lh, 'left', headInv), R = rh && extractHand(rh, 'right', headInv);
  if (recorder.active) recorder.update(dt, L, R, headInv); else {
    // A hand that is holding an orb is busy; the other hand can still sign (so you can hold Blue and Red together).
    const busy = h => nullOrb.active || (well.active && well.which === h) || (red.active && red.which === h);
    recognizer.update(dt, busy('left') ? null : L, busy('right') ? null : R, headInv);
  }
  well.update(dt, headPos, headQ, L, R);
  red.update(dt, headPos, headQ, L, R);
  nullOrb.update(dt, headPos, headQ, L, R);
  caster.update(dt, headPos);
  fx.update(dt);
  env.update(dt, clock.elapsedTime, headPos);
  district.update(dt * sanctum.timeScale);
  sanctum.update(dt);
  mood.update(dt); // after the Sanctum so it can modulate (or restore) the look
  for (const p of puppets) p.update(dt, clock.elapsedTime);
  panel.poke([L?.tip, R?.tip], performance.now());
  updateHud(dt, R);
  renderer.render(scene, camera);
});

window.spellforge = { camera, sanctum, env, caster, director, renderer, scene, well, WELL, red, RED, nullOrb, NULL, mood, MOOD }; // debug/test hook
