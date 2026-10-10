import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { PhysicsWorld } from './physics/World.js';
import { setupHands } from './xr/HandInput.js';

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

setupHands(renderer, scene);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  physics.step(clock.getDelta());
  renderer.render(scene, camera);
});
