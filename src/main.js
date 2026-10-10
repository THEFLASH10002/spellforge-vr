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

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setFramebufferScaleFactor(0.9);
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer, {
  optionalFeatures: ['hand-tracking', 'local-floor'],
}));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d1a);
scene.fog = new THREE.Fog(0x0b0d1a, 8, 40);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 100);
camera.position.set(0, 1.6, 0);
const hemi = new THREE.HemisphereLight(0x8899ff, 0x222233, 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffddaa, 1.2);
sun.position.set(3, 6, 2);
scene.add(sun);

const physics = await PhysicsWorld.create();

const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 0.2, 40),
  new THREE.MeshLambertMaterial({ color: 0x2a2f45 }));
floor.position.y = -0.1;
scene.add(floor);
physics.addStaticBox(floor, 20, 0.1, 20);

// Hour-4 gate: one box falls in front of the player.
const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3),
  new THREE.MeshLambertMaterial({ color: 0xe0503a }));
box.position.set(0, 2.5, -1.2);
scene.add(box);
physics.addDynamicBox(box, 0.15, 0.15, 0.15);

const hands = setupHands(renderer, scene);
const handBy = side => hands.find(h => h.userData.handedness === side);


const district = buildDistrict(physics, scene);
const puppets = [[-1.6, -3.5], [0.2, -4], [1.8, -3.5], [2, -5.2]].map(([x, z], i) => new Puppet(physics, scene, x, z, i));

const recognizer = new Recognizer();
recognizer.sigils = [...BUILTINS, ...loadCustom()];
const recorder = new Recorder(recognizer);
const caster = new ArtCaster(scene, physics);
const targets = [...district.pieces, ...puppets];
caster.destructibles = targets;
const sanctum = new Sanctum({ scene, physics, floor, hemi, sun, puppets });
let presetIdx = 0, ruleIdx = 0;
const director = new Director({ targets, caster, onReset: () => sanctum.reset() });
let lastCast = '-';
let nextArt = 0;
recognizer.onCast = (sigil, hand) => {
  lastCast = `${sigil.name} (${sigil.artId})`;
  if (sigil.artId === 'sanctum') sanctum.activate(presetIdx, ruleIdx);
  else caster.cast(sigil.artId, hand);
};

const panel = new Panel();
panel.mesh.position.set(-0.55, 1.25, -0.7);
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

const headQ = new THREE.Quaternion();
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
    `Cast: ${lastCast}`,
    dbg ? `Best: ${dbg.sg.name} ${dbg.ratio.toFixed(2)} (<1 fires)` : 'Best: no hands',
    R ? `R curl ${R.curls.map(c => c.toFixed(2)).join(' ')}` : 'R hand: not tracked',
    `Next record art: ${ARTS[ART_IDS[nextArt]].name} | Sigils: ${recognizer.sigils.length}`,
    `Sanctum: ${PRESETS[presetIdx].name} + ${RULES[ruleIdx].name}`,
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
  physics.step(dt * sanctum.timeScale);
  (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera).getWorldQuaternion(headQ);
  const headInv = headQ.clone().invert();
  const lh = handBy('left'), rh = handBy('right');
  const L = lh && extractHand(lh, 'left', headInv), R = rh && extractHand(rh, 'right', headInv);
  if (recorder.active) recorder.update(dt, L, R, headInv); else recognizer.update(dt, L, R, headInv);
  caster.update(dt);
  district.update(dt * sanctum.timeScale);
  sanctum.update(dt);
  for (const p of puppets) p.update(dt, clock.elapsedTime);
  panel.poke([L?.tip, R?.tip], performance.now());
  updateHud(dt, R);
  renderer.render(scene, camera);
});
