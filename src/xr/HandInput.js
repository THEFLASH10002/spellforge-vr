import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

// Adds both tracked hands (with joint meshes) to `scene`. Returns hand objects
// whose `.joints` map holds the 25 XRHand joints by name.
export function setupHands(renderer, scene) {
  const factory = new XRHandModelFactory();
  const hands = [];
  for (let i = 0; i < 2; i++) {
    const hand = renderer.xr.getHand(i);
    hand.addEventListener('connected', e => { hand.userData.handedness = e.data.handedness; });
    hand.add(factory.createHandModel(hand, 'spheres'));
    scene.add(hand);
    hands.push(hand);
  }
  return hands;
}
