import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { PhysicsWorld } from './physics/World.js';
import { setupHands } from './xr/HandInput.js';
import { extractHand } from './gestures/PoseFeatures.js';
import { Recognizer } from './gestures/Recognizer.js';
import { Recorder, loadCustom } from './gestures/Recorder.js';
import { BUILTINS } from './gestures/builtins.js';
import { ArtCaster } from './arts/ArtCaster.js';
import { ART_IDS, ARTS } from './arts/ArtRegistry.js';
import { Panel } from './ui/Panel.js';
import { buildDistrict } from './destruction/District.js';

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
scene.add(new THREE.HemisphereLight(0x8899ff, 0x222233, 1.6));
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

// Placeholder targets for the Arts (replaced by destructible buildings later).
const targetMat = new THREE.MeshLambertMaterial({ color: 0xd9b36c });
for (let i = 0; i < 6; i++) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), targetMat);
  b.position.set(((i % 3) - 1) * 0.5, 0.2 + Math.floor(i / 3) * 0.4, -3);
  scene.add(b);
  physics.addDynamicBox(b, 0.2, 0.2, 0.2);
}

const district = buildDistrict(physics, scene);

const recognizer = new Recognizer();
recognizer.sigils = [...BUILTINS, ...loadCustom()];
const recorder = new Recorder(recognizer);
const caster = new ArtCaster(scene, physics);
caster.destructibles = district.pieces;
let lastCast = '-';
let nextArt = 0;
recognizer.onCast = (sigil, hand) => {
  lastCast = `${sigil.name} (${sigil.artId})`;
  caster.cast(sigil.artId, hand);
};

const panel = new Panel();
panel.mesh.position.set(-0.55, 1.25, -0.7);
panel.mesh.rotation.y = 0.6;
scene.add(panel.mesh);
[['Rec Right', 'right', 10, 330], ['Rec Left', 'left', 176, 330], ['Rec Two', 'two', 342, 330]].forEach(([label, mode, x, y]) =>
  panel.addButton({ label, x, y, w: 160, h: 70, onPress: () => !recorder.active && recorder.start(mode, ART_IDS[nextArt]) }));
panel.addButton({ label: 'Next Art', x: 10, y: 410, w: 240, h: 70, onPress: () => { nextArt = (nextArt + 1) % ART_IDS.length; } });
panel.addButton({ label: 'Clear Custom', x: 262, y: 410, w: 240, h: 70, onPress: () => recorder.clearCustom() });

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
  physics.step(dt);
  (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera).getWorldQuaternion(headQ);
  const headInv = headQ.clone().invert();
  const lh = handBy('left'), rh = handBy('right');
  const L = lh && extractHand(lh, 'left', headInv), R = rh && extractHand(rh, 'right', headInv);
  if (recorder.active) recorder.update(dt, L, R, headInv); else recognizer.update(dt, L, R, headInv);
  caster.update(dt);
  district.update(dt);
  panel.poke([L?.tip, R?.tip], performance.now());
  updateHud(dt, R);
  renderer.render(scene, camera);
});
