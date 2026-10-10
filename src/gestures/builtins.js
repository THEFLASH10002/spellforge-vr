import { HAND_DIM, SLOT, handWeights } from './PoseFeatures.js';

// Straightness targets: extended ~0.97, curled ~0.55. TUNE ON DEVICE using the HUD readout.
const E = 0.97, C = 0.55;

function tpl(curl, normal) {
  const v = new Float32Array(HAND_DIM);
  curl.forEach((x, i) => (v[SLOT.curl + i] = x));
  if (normal) v.set(normal, SLOT.normal);
  return v;
}

// Sanctum: both fists pressed together in front of the chest, held 1 s.
// Two-hand vector = [left, right, right-wrist minus left-wrist in head frame / palm length].
function sanctumSigil() {
  const len = HAND_DIM * 2 + 3, vec = new Float32Array(len), w = new Float32Array(len);
  const hw = handWeights({ curl: [0, 1, 1, 1, 1] });
  for (let h = 0; h < 2; h++) {
    [0, C, C, C, C].forEach((x, i) => (vec[h * HAND_DIM + SLOT.curl + i] = x));
    w.set(hw, h * HAND_DIM);
  }
  vec.set([1.7, 0, 0], HAND_DIM * 2); // wrists ~15 cm apart, side by side
  w.fill(0.7, HAND_DIM * 2);
  return { id: 'sanctum', name: 'Sanctum', hand: 'two', artId: 'sanctum', builtin: true, thresh: 0.2, hold: 1.0, cooldown: 4, vec, w };
}

// Built-in Sigils are rule-style: only curl (and optionally palm direction) are compared.
export const BUILTINS = [
  {
    // Fang: index finger out, middle/ring/pinky curled (thumb ignored). Fires the Bolt.
    id: 'twin-fang', name: 'Fang', hand: 'any', artId: 'bolt', builtin: true, thresh: 0.12,
    vec: tpl([0, E, C, C, C]),
    w: handWeights({ curl: [0, 1, 1, 1, 1] }), // thumb ignored
  },
  {
    id: 'repel-palm', name: 'Repel Palm', hand: 'any', artId: 'push', builtin: true, thresh: 0.2,
    vec: tpl([0.92, E, E, E, E], [0, 0, -1]), // open hand, palm facing away from head
    w: handWeights({ curl: [0.3, 1, 1, 1, 1], normal: 0.5 }), // thumb barely drops below 0.90, so low weight
  },
  {
    // Two fingers: index + middle up, ring/pinky curled (thumb ignored). Starts charging the Gravity Well (Blue).
    id: 'gravity-well', name: 'Gravity Well', hand: 'any', artId: 'well', builtin: true, thresh: 0.12,
    vec: tpl([0, E, E, C, C]),
    w: handWeights({ curl: [0, 1, 1, 1, 1] }),
  },
  {
    // Rock sign: index + pinky out, middle/ring curled (thumb ignored). Starts charging the Repulsor.
    id: 'repulsor', name: 'Repulsor', hand: 'any', artId: 'repulsor', builtin: true, thresh: 0.12,
    vec: tpl([0, E, C, C, E]),
    w: handWeights({ curl: [0, 1, 1, 1, 1] }),
  },
  sanctumSigil(),
];
